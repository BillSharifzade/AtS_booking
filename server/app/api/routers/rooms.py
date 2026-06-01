import base64
import binascii

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_admin, current_user
from app.db import get_session
from app.models import Room, RoomImage, Zone
from app.schemas import RoomCreate, RoomImageOut, RoomImagesIn, RoomOut, RoomUpdate
from app.services.bookings import audit

router = APIRouter(prefix="/rooms", tags=["rooms"])

MAX_IMAGES_PER_ROOM = 3
MAX_IMAGE_BYTES = 5 * 1024 * 1024


def _looks_like_image(raw: bytes) -> bool:
    """Sniff common image magic bytes so a declared content_type can't disguise other data."""
    return (
        raw.startswith(b"\x89PNG\r\n\x1a\n")  # PNG
        or raw.startswith(b"\xff\xd8\xff")  # JPEG
        or raw[:6] in (b"GIF87a", b"GIF89a")  # GIF
        or (raw[:4] == b"RIFF" and raw[8:12] == b"WEBP")  # WEBP
    )


@router.get("", response_model=list[RoomOut])
async def list_rooms(
    active_only: bool = False, session: AsyncSession = Depends(get_session)
) -> list[Room]:
    stmt = select(Room).order_by(Room.zone_id, Room.name)
    if active_only:
        stmt = stmt.where(Room.is_active.is_(True))
    return list((await session.execute(stmt)).scalars().all())


@router.post("", response_model=RoomOut, status_code=201)
async def create_room(
    payload: RoomCreate,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> Room:
    if payload.close_time <= payload.open_time:
        raise HTTPException(400, "close_time must be after open_time")
    zone = await session.get(Zone, payload.zone_id)
    if zone is None:
        raise HTTPException(400, "Выбранная зона не найдена.")
    room = Room(**payload.model_dump())
    room.zone = zone  # keep the relationship loaded for serialization
    session.add(room)
    await session.flush()
    kind = "кофе-брейк" if room.is_coffee_break else "помещение"
    detail = (
        f"«{room.name}» ({kind}), зона {zone.name}, до {room.capacity} чел., "
        f"{room.open_time.strftime('%H:%M')}–{room.close_time.strftime('%H:%M')}"
    )
    await audit(session, admin_id, "room.create", "room", room.id, detail)
    await session.commit()
    return room


_ROOM_FIELD_LABELS = {
    "name": "название",
    "zone_id": "зона",
    "capacity": "вместимость",
    "open_time": "открытие",
    "close_time": "закрытие",
    "notes": "заметки",
    "is_active": "активность",
    "is_coffee_break": "кофе-брейк",
}


@router.patch("/{room_id}", response_model=RoomOut)
async def update_room(
    room_id: int,
    payload: RoomUpdate,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> Room:
    room = await session.get(Room, room_id)
    if room is None:
        raise HTTPException(404, "room not found")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(room, key, value)
    if "zone_id" in data:
        zone = await session.get(Zone, room.zone_id)
        if zone is None:
            raise HTTPException(400, "Выбранная зона не найдена.")
        room.zone = zone  # refresh the loaded relationship to the new zone
    if room.close_time <= room.open_time:
        raise HTTPException(400, "close_time must be after open_time")
    changed = ", ".join(_ROOM_FIELD_LABELS.get(k, k) for k in data) or "—"
    await audit(session, admin_id, "room.update", "room", room.id, f"«{room.name}»: {changed}")
    await session.commit()
    return room


@router.delete("/{room_id}", status_code=204)
async def delete_room(
    room_id: int,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    room = await session.get(Room, room_id)
    if room is None:
        raise HTTPException(404, "room not found")
    # Soft-delete: deactivate so existing bookings keep their FK.
    room.is_active = False
    await audit(session, admin_id, "room.deactivate", "room", room.id, room.name)
    await session.commit()


# ---------- Room images (interior demonstration photos) ----------

@router.get("/{room_id}/images", response_model=list[RoomImageOut])
async def list_room_images(
    room_id: int,
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[RoomImage]:
    stmt = (
        select(RoomImage)
        .where(RoomImage.room_id == room_id)
        .order_by(RoomImage.sort_order, RoomImage.id)
    )
    return list((await session.execute(stmt)).scalars().all())


@router.post("/{room_id}/images", response_model=list[RoomImageOut], status_code=201)
async def add_room_images(
    room_id: int,
    payload: RoomImagesIn,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> list[RoomImage]:
    room = await session.get(Room, room_id)
    if room is None:
        raise HTTPException(404, "room not found")

    existing = (
        await session.execute(select(func.count(RoomImage.id)).where(RoomImage.room_id == room_id))
    ).scalar_one()
    if existing + len(payload.images) > MAX_IMAGES_PER_ROOM:
        raise HTTPException(400, f"Не более {MAX_IMAGES_PER_ROOM} фото на помещение.")

    next_order = (
        await session.execute(
            select(func.coalesce(func.max(RoomImage.sort_order), -1)).where(RoomImage.room_id == room_id)
        )
    ).scalar_one() + 1

    created: list[RoomImage] = []
    for i, img in enumerate(payload.images):
        try:
            raw = base64.b64decode(img.data, validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(400, "Повреждённые данные изображения.")
        if len(raw) > MAX_IMAGE_BYTES:
            raise HTTPException(400, "Изображение больше 5 МБ.")
        if not _looks_like_image(raw):
            raise HTTPException(400, "Файл не является поддерживаемым изображением.")
        row = RoomImage(room_id=room_id, content_type=img.content_type, data=raw, sort_order=next_order + i)
        session.add(row)
        created.append(row)

    await session.flush()
    await audit(session, admin_id, "room.images_add", "room", room_id, f"{room.name}: +{len(created)} фото")
    await session.commit()
    for row in created:
        await session.refresh(row)
    return created


@router.delete("/{room_id}/images/{image_id}", status_code=204)
async def delete_room_image(
    room_id: int,
    image_id: int,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    img = await session.get(RoomImage, image_id)
    if img is None or img.room_id != room_id:
        raise HTTPException(404, "image not found")
    await session.delete(img)
    await audit(session, admin_id, "room.images_remove", "room", room_id, f"фото #{image_id}")
    await session.commit()


@router.get("/{room_id}/images/{image_id}/raw")
async def get_room_image_raw(
    room_id: int,
    image_id: int,
    session: AsyncSession = Depends(get_session),
) -> Response:
    # Public: these are just room interior photos, shown to customers in the bot too.
    img = await session.get(RoomImage, image_id)
    if img is None or img.room_id != room_id:
        raise HTTPException(404, "image not found")
    return Response(
        content=img.data,
        media_type=img.content_type,
        headers={"Cache-Control": "max-age=3600", "X-Content-Type-Options": "nosniff"},
    )
