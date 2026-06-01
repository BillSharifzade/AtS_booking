from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_admin, current_user
from app.db import get_session
from app.models import Room, RoomImage, Zone
from app.schemas import (
    ZoneCreate,
    ZoneDayOut,
    ZoneImageOut,
    ZoneOut,
    ZoneSlotOut,
    ZoneUpdate,
)
from app.services import availability as avail
from app.services.bookings import audit

router = APIRouter(prefix="/zones", tags=["zones"])

MAX_DAY_RANGE = 62


async def _list_with_totals(session: AsyncSession) -> list[ZoneOut]:
    # Zone capacity is the sum of its rooms' capacities (Module E).
    stmt = (
        select(
            Zone.id,
            Zone.name,
            func.count(Room.id),
            func.coalesce(func.sum(Room.capacity), 0),
        )
        .outerjoin(Room, Room.zone_id == Zone.id)
        .group_by(Zone.id, Zone.name)
        .order_by(Zone.name)
    )
    rows = (await session.execute(stmt)).all()
    return [
        ZoneOut(id=zid, name=name, room_count=int(count), total_capacity=int(cap))
        for zid, name, count, cap in rows
    ]


@router.get("", response_model=list[ZoneOut])
async def list_zones(
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ZoneOut]:
    return await _list_with_totals(session)


@router.post("", response_model=ZoneOut, status_code=201)
async def create_zone(
    payload: ZoneCreate,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> ZoneOut:
    name = payload.name.strip()
    exists = (await session.execute(select(Zone.id).where(Zone.name == name))).first()
    if exists is not None:
        raise HTTPException(400, "Зона с таким названием уже существует.")
    zone = Zone(name=name)
    session.add(zone)
    await session.flush()
    await audit(session, admin_id, "zone.create", "zone", zone.id, f"«{name}»")
    await session.commit()
    return ZoneOut(id=zone.id, name=zone.name, room_count=0, total_capacity=0)


@router.patch("/{zone_id}", response_model=ZoneOut)
async def update_zone(
    zone_id: int,
    payload: ZoneUpdate,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> ZoneOut:
    zone = await session.get(Zone, zone_id)
    if zone is None:
        raise HTTPException(404, "zone not found")
    name = payload.name.strip()
    clash = (
        await session.execute(select(Zone.id).where(Zone.name == name, Zone.id != zone_id))
    ).first()
    if clash is not None:
        raise HTTPException(400, "Зона с таким названием уже существует.")
    zone.name = name
    await audit(session, admin_id, "zone.update", "zone", zone.id, f"«{name}»")
    await session.commit()
    totals = {z.id: z for z in await _list_with_totals(session)}
    return totals[zone_id]


@router.delete("/{zone_id}", status_code=204)
async def delete_zone(
    zone_id: int,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    zone = await session.get(Zone, zone_id)
    if zone is None:
        raise HTTPException(404, "zone not found")
    room_count = (
        await session.execute(select(func.count(Room.id)).where(Room.zone_id == zone_id))
    ).scalar_one()
    if room_count:
        raise HTTPException(400, "Нельзя удалить зону, пока в ней есть помещения.")
    await session.delete(zone)
    await audit(session, admin_id, "zone.delete", "zone", zone_id, f"«{zone.name}»")
    await session.commit()


@router.get("/{zone_id}/days", response_model=list[ZoneDayOut])
async def zone_days(
    zone_id: int,
    date_from: date = Query(...),
    date_to: date = Query(...),
    attendees: int = Query(1, ge=1),
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ZoneDayOut]:
    if date_to < date_from:
        raise HTTPException(400, "date_to before date_from")
    if (date_to - date_from).days > MAX_DAY_RANGE:
        date_to = date_from + timedelta(days=MAX_DAY_RANGE)
    days = await avail.zone_available_days(session, zone_id, date_from, date_to, attendees)
    return [ZoneDayOut(date=d, available=a) for d, a in sorted(days.items())]


@router.get("/{zone_id}/slots", response_model=list[ZoneSlotOut])
async def zone_slots(
    zone_id: int,
    on: date = Query(...),
    attendees: int = Query(1, ge=1),
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ZoneSlotOut]:
    slots = await avail.zone_day_slots(session, zone_id, on, attendees)
    return [ZoneSlotOut(start=s, end=e) for s, e in slots]


@router.get("/{zone_id}/images", response_model=list[ZoneImageOut])
async def zone_images(
    zone_id: int,
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ZoneImageOut]:
    stmt = (
        select(RoomImage.room_id, RoomImage.id, Room.name)
        .join(Room, Room.id == RoomImage.room_id)
        .where(Room.zone_id == zone_id)
        .order_by(Room.name, RoomImage.sort_order, RoomImage.id)
    )
    rows = (await session.execute(stmt)).all()
    return [ZoneImageOut(room_id=rid, image_id=iid, room_name=name) for rid, iid, name in rows]
