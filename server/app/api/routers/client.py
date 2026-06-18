"""Client-facing API for the Telegram Mini Web App (#13).

Auth is by Telegram ``initData`` (see deps.current_customer) — these endpoints are
used by customers booking for themselves, not by panel admins. Booking creation goes
through the same service layer as the bot, so all validation/notifications are shared.
"""
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import current_customer
from app.db import get_session
from app.models import Booking, BookingStatus, Company, Feedback, Prop, Room, Zone
from app.schemas import (
    ClientBookingCreate,
    ClientBookingOut,
    ClientBootstrap,
    ClientUser,
    CompanyOut,
    FeedbackCreate,
    PropOut,
    ZoneDayOut,
    ZoneOut,
    ZoneSlotOut,
)
from app.services import availability as avail
from app.services import bookings as svc
from app.services.notifications import notify_new
from app.services.users import upsert_user

router = APIRouter(prefix="/client", tags=["client"])

MAX_DAY_RANGE = 92


def _user_name(user: dict) -> str | None:
    full = " ".join(p for p in (user.get("first_name"), user.get("last_name")) if p).strip()
    return full or (f"@{user['username']}" if user.get("username") else None)


async def _zones_out(session: AsyncSession) -> list[ZoneOut]:
    zones = (
        await session.execute(select(Zone).options(selectinload(Zone.rooms)).order_by(Zone.name))
    ).scalars().all()
    out: list[ZoneOut] = []
    for z in zones:
        bookable = [r for r in z.rooms if r.is_active and not r.is_coffee_break]
        # Only surface zones a customer can actually book into.
        if bookable:
            out.append(ZoneOut(id=z.id, name=z.name, room_count=len(bookable),
                               total_capacity=sum(r.capacity for r in bookable)))
    return out


@router.get("/bootstrap", response_model=ClientBootstrap)
async def bootstrap(
    user: dict = Depends(current_customer),
    session: AsyncSession = Depends(get_session),
) -> ClientBootstrap:
    """Everything the mini app needs on launch: the user, active companies, bookable
    zones, and active equipment."""
    companies = (
        await session.execute(select(Company).where(Company.is_active.is_(True)).order_by(Company.name))
    ).scalars().all()
    props = (
        await session.execute(select(Prop).where(Prop.is_active.is_(True)).order_by(Prop.kind, Prop.name))
    ).scalars().all()
    return ClientBootstrap(
        user=ClientUser(telegram_id=user["id"], name=_user_name(user), username=user.get("username")),
        companies=[CompanyOut.model_validate(c) for c in companies],
        zones=await _zones_out(session),
        props=[PropOut.model_validate(p) for p in props],
    )


@router.get("/zones/{zone_id}/days", response_model=list[ZoneDayOut])
async def zone_days(
    zone_id: int,
    date_from: date = Query(...),
    date_to: date = Query(...),
    attendees: int = Query(1, ge=1),
    _: dict = Depends(current_customer),
    session: AsyncSession = Depends(get_session),
) -> list[ZoneDayOut]:
    if date_to < date_from:
        raise HTTPException(400, "date_to before date_from")
    if (date_to - date_from).days > MAX_DAY_RANGE:
        date_to = date_from + timedelta(days=MAX_DAY_RANGE)
    days = await avail.zone_available_days(session, zone_id, date_from, date_to, attendees)
    return [ZoneDayOut(date=d, available=a) for d, a in sorted(days.items())]


@router.get("/zones/{zone_id}/slots", response_model=list[ZoneSlotOut])
async def zone_slots(
    zone_id: int,
    on: date = Query(...),
    attendees: int = Query(1, ge=1),
    _: dict = Depends(current_customer),
    session: AsyncSession = Depends(get_session),
) -> list[ZoneSlotOut]:
    slots = await avail.zone_day_slots(session, zone_id, on, attendees)
    return [ZoneSlotOut(start=s, end=e) for s, e in slots]


@router.post("/bookings", response_model=ClientBookingOut, status_code=201)
async def create_booking(
    payload: ClientBookingCreate,
    user: dict = Depends(current_customer),
    session: AsyncSession = Depends(get_session),
) -> ClientBookingOut:
    room = await avail.assign_room(session, payload.zone_id, payload.attendees, payload.starts_at, payload.ends_at)
    if room is None:
        raise HTTPException(409, "Нет свободного помещения в выбранной зоне на это время для указанного числа участников.")
    # If a company was picked, trust the curated record's name over any client-sent label.
    company_name = payload.company
    if payload.company_id is not None:
        company = await session.get(Company, payload.company_id)
        if company is None or not company.is_active:
            raise HTTPException(400, "Выбранная компания недоступна.")
        company_name = company.name
    try:
        booking = await svc.create_booking(
            session,
            room=room,
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
            customer_telegram_id=user["id"],
            customer_username=user.get("username"),
            company=company_name,
            contact_name=payload.contact_name,
            phone=payload.phone,
            event_type=payload.event_type,
            event_name=payload.event_name,
            description=payload.description,
            attendees=payload.attendees,
            coffee_break=payload.coffee_break,
            coffee_headcount=payload.coffee_headcount,
            urgent=payload.is_urgent,
            room_struct=payload.room_struct,
            company_id=payload.company_id,
            props=[(p.prop_id, p.amount) for p in payload.props],
        )
        await upsert_user(
            session, user["id"],
            first_name=user.get("first_name"), last_name=user.get("last_name"), username=user.get("username"),
        )
        await session.commit()
        await session.refresh(booking, attribute_names=["room"])
    except svc.BookingError as exc:
        await session.rollback()
        raise HTTPException(409, str(exc))
    await notify_new(booking, room)
    return ClientBookingOut(
        id=booking.id, event_name=booking.event_name, room=room.name, zone=room.zone_name,
        starts_at=booking.starts_at, ends_at=booking.ends_at, attendees=booking.attendees,
        status=booking.status, room_struct=booking.room_struct, has_feedback=False,
    )


@router.get("/bookings", response_model=list[ClientBookingOut])
async def my_bookings(
    user: dict = Depends(current_customer),
    session: AsyncSession = Depends(get_session),
) -> list[ClientBookingOut]:
    stmt = (
        select(Booking)
        .options(selectinload(Booking.room).selectinload(Room.zone), selectinload(Booking.feedback))
        .where(Booking.customer_telegram_id == user["id"])
        .order_by(Booking.starts_at.desc())
    )
    rows = (await session.execute(stmt)).scalars().all()
    return [
        ClientBookingOut(
            id=b.id, event_name=b.event_name,
            room=b.room.name if b.room else "—",
            zone=b.room.zone.name if b.room and b.room.zone else "—",
            starts_at=b.starts_at, ends_at=b.ends_at, attendees=b.attendees,
            status=b.status, room_struct=b.room_struct, has_feedback=b.feedback is not None,
        )
        for b in rows
    ]


@router.post("/bookings/{booking_id}/feedback", status_code=201)
async def submit_feedback(
    booking_id: int,
    payload: FeedbackCreate,
    user: dict = Depends(current_customer),
    session: AsyncSession = Depends(get_session),
) -> dict:
    booking = await session.get(Booking, booking_id)
    if booking is None or booking.customer_telegram_id != user["id"]:
        raise HTTPException(404, "Заявка не найдена.")
    if booking.status not in (BookingStatus.completed, BookingStatus.archived):
        raise HTTPException(400, "Отзыв можно оставить только после завершения мероприятия.")
    existing = (
        await session.execute(select(Feedback).where(Feedback.booking_id == booking_id))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(409, "Отзыв по этой заявке уже оставлен.")
    session.add(Feedback(
        booking_id=booking_id,
        rating=payload.rating,
        room_rating=payload.room_rating,
        service_rating=payload.service_rating,
        props_rating=payload.props_rating,
        comment=(payload.comment or "").strip() or None,
    ))
    await session.commit()
    return {"ok": True}
