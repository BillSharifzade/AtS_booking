from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import current_admin, current_user
from app.db import get_session
from app.models import Room, RoomOfftime
from app.schemas import OfftimeCreate, OfftimeOut, OfftimeUpdate
from app.services.bookings import audit

router = APIRouter(prefix="/offtimes", tags=["offtimes"])


def _to_out(o: RoomOfftime) -> OfftimeOut:
    return OfftimeOut(
        id=o.id,
        room_id=o.room_id,
        room_name=o.room.name if o.room else "—",
        starts_at=o.starts_at,
        ends_at=o.ends_at,
        reason=o.reason,
        description=o.description,
        created_at=o.created_at,
    )


@router.get("", response_model=list[OfftimeOut])
async def list_offtimes(
    room_id: int | None = None,
    upcoming_only: bool = False,
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[OfftimeOut]:
    stmt = (
        select(RoomOfftime)
        .options(selectinload(RoomOfftime.room))
        .order_by(RoomOfftime.starts_at.desc())
    )
    if room_id is not None:
        stmt = stmt.where(RoomOfftime.room_id == room_id)
    if upcoming_only:
        stmt = stmt.where(RoomOfftime.ends_at >= datetime.utcnow())
    rows = (await session.execute(stmt)).scalars().all()
    return [_to_out(o) for o in rows]


@router.post("", response_model=OfftimeOut, status_code=201)
async def create_offtime(
    payload: OfftimeCreate,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> OfftimeOut:
    if payload.ends_at <= payload.starts_at:
        raise HTTPException(400, "Окончание должно быть позже начала.")
    room = await session.get(Room, payload.room_id)
    if room is None:
        raise HTTPException(400, "Помещение не найдено.")
    off = RoomOfftime(**payload.model_dump())
    off.room = room
    session.add(off)
    await session.flush()
    await audit(
        session, admin_id, "offtime.create", "offtime", off.id,
        f"«{room.name}»: {payload.reason}",
    )
    await session.commit()
    await session.refresh(off)
    return _to_out(off)


@router.patch("/{offtime_id}", response_model=OfftimeOut)
async def update_offtime(
    offtime_id: int,
    payload: OfftimeUpdate,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> OfftimeOut:
    off = await session.get(RoomOfftime, offtime_id)
    if off is None:
        raise HTTPException(404, "Запись не найдена.")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(off, key, value)
    if "room_id" in data:
        room = await session.get(Room, off.room_id)
        if room is None:
            raise HTTPException(400, "Помещение не найдено.")
        off.room = room
    if off.ends_at <= off.starts_at:
        raise HTTPException(400, "Окончание должно быть позже начала.")
    await audit(session, admin_id, "offtime.update", "offtime", off.id, off.reason)
    await session.commit()
    await session.refresh(off)
    # Ensure the room relationship is loaded for serialization.
    await session.refresh(off, attribute_names=["room"])
    return _to_out(off)


@router.delete("/{offtime_id}", status_code=204)
async def delete_offtime(
    offtime_id: int,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    off = await session.get(RoomOfftime, offtime_id)
    if off is None:
        raise HTTPException(404, "Запись не найдена.")
    await session.delete(off)
    await audit(session, admin_id, "offtime.delete", "offtime", offtime_id, off.reason)
    await session.commit()
