"""Client-facing API for the Telegram Mini Web App (#13).

Auth is by Telegram ``initData`` (see deps.current_customer) — these endpoints are
used by customers booking for themselves, not by panel admins. Booking creation goes
through the same service layer as the bot, so all validation/notifications are shared.
"""
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import current_customer
from app.db import get_session
from app.models import Booking, BookingProp, BookingStatus, Company, Feedback, Prop, Room, RoomImage
from app.schemas import (
    ClientBookingCreate,
    ClientBookingOut,
    ClientBootstrap,
    ClientRoomOut,
    ClientUser,
    CompanyOut,
    FeedbackCreate,
    PropOut,
    ZoneDayOut,
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


def _booking_out(b: Booking, has_feedback: bool, room_name: str) -> ClientBookingOut:
    """Map a Booking to the client view (list card + detail modal share one shape)."""
    return ClientBookingOut(
        id=b.id, event_name=b.event_name, room=room_name,
        starts_at=b.starts_at, ends_at=b.ends_at, attendees=b.attendees,
        status=b.status, room_struct=b.room_struct, has_feedback=has_feedback,
        event_type=b.event_type, company=b.company, contact_name=b.contact_name,
        phone=b.phone, description=b.description, aim=b.aim, grade=b.grade,
        extra_services=b.extra_services, coffee_break=b.coffee_break,
        coffee_headcount=b.coffee_headcount, coffee_type=b.coffee_type,
        coffee_other=b.coffee_other, foreign_guests=b.foreign_guests,
        is_urgent=b.is_urgent, created_at=b.created_at,
    )


async def _rooms_out(session: AsyncSession) -> list[ClientRoomOut]:
    """Bookable rooms for the client — zones are an admin-only grouping and are not
    exposed. Ordered smallest-sufficient capacity first (unknown-capacity rooms last)."""
    rooms = (
        await session.execute(
            select(Room).where(Room.is_active.is_(True), Room.is_coffee_break.is_(False))
        )
    ).scalars().all()
    rooms = sorted(rooms, key=svc._capacity_sort_key)
    # Photo ids per room (raw bytes are served publicly, so the client builds the URL
    # and lazy-loads them).
    img_rows = (
        await session.execute(
            select(RoomImage.room_id, RoomImage.id)
            .join(Room, Room.id == RoomImage.room_id)
            .where(Room.is_active.is_(True), Room.is_coffee_break.is_(False))
            .order_by(RoomImage.room_id, RoomImage.sort_order, RoomImage.id)
        )
    ).all()
    photos_by_room: dict[int, list[int]] = {}
    for rid, iid in img_rows:
        photos_by_room.setdefault(rid, []).append(iid)
    return [
        ClientRoomOut(
            id=r.id, name=r.name, capacity=r.capacity, meter_squared=r.meter_squared,
            photos=photos_by_room.get(r.id, [])[:8],
        )
        for r in rooms
    ]


async def _props_out(session: AsyncSession) -> list[PropOut]:
    """Active equipment with REAL-TIME availability (total stock minus amounts held
    by active bookings) — matches what `validate_props` enforces at creation."""
    props = (
        await session.execute(select(Prop).where(Prop.is_active.is_(True)).order_by(Prop.kind, Prop.name))
    ).scalars().all()
    committed = dict(
        (
            await session.execute(
                select(BookingProp.prop_id, func.coalesce(func.sum(BookingProp.amount), 0))
                .join(Booking, Booking.id == BookingProp.booking_id)
                .where(Booking.status.in_(svc.ACTIVE_STATUSES))
                .group_by(BookingProp.prop_id)
            )
        ).all()
    )
    out: list[PropOut] = []
    for p in props:
        po = PropOut.model_validate(p)
        po.available = max(p.amount - committed.get(p.id, 0), 0)
        out.append(po)
    return out


@router.get("/bootstrap", response_model=ClientBootstrap)
async def bootstrap(
    user: dict = Depends(current_customer),
    session: AsyncSession = Depends(get_session),
) -> ClientBootstrap:
    """Everything the mini app needs on launch: the user, active companies, bookable
    rooms, and active equipment."""
    companies = (
        await session.execute(select(Company).where(Company.is_active.is_(True)).order_by(Company.name))
    ).scalars().all()
    return ClientBootstrap(
        user=ClientUser(telegram_id=user["id"], name=_user_name(user), username=user.get("username")),
        companies=[CompanyOut.model_validate(c) for c in companies],
        rooms=await _rooms_out(session),
        props=await _props_out(session),
    )


@router.get("/rooms/{room_id}/days", response_model=list[ZoneDayOut])
async def room_days(
    room_id: int,
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
    days = await avail.room_available_days(session, room_id, date_from, date_to, attendees)
    return [ZoneDayOut(date=d, available=a) for d, a in sorted(days.items())]


@router.get("/rooms/{room_id}/slots", response_model=list[ZoneSlotOut])
async def room_slots(
    room_id: int,
    on: date = Query(...),
    attendees: int = Query(1, ge=1),
    _: dict = Depends(current_customer),
    session: AsyncSession = Depends(get_session),
) -> list[ZoneSlotOut]:
    slots = await avail.room_day_slots(session, room_id, on, attendees)
    return [ZoneSlotOut(start=s, end=e) for s, e in slots]


@router.post("/bookings", response_model=ClientBookingOut, status_code=201)
async def create_booking(
    payload: ClientBookingCreate,
    user: dict = Depends(current_customer),
    session: AsyncSession = Depends(get_session),
) -> ClientBookingOut:
    room = await session.get(Room, payload.room_id)
    if room is None or not room.is_active or room.is_coffee_break:
        raise HTTPException(404, "Помещение недоступно для бронирования.")
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
            coffee_type=payload.coffee_type,
            coffee_other=payload.coffee_other,
            foreign_guests=payload.foreign_guests,
            urgent=payload.is_urgent,
            room_struct=payload.room_struct,
            company_id=payload.company_id,
            aim=payload.aim,
            grade=payload.grade,
            extra_services=payload.extra_services,
            privacy_accepted=payload.privacy_accepted,
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
    return _booking_out(booking, False, room.name)


@router.get("/bookings", response_model=list[ClientBookingOut])
async def my_bookings(
    user: dict = Depends(current_customer),
    session: AsyncSession = Depends(get_session),
) -> list[ClientBookingOut]:
    stmt = (
        select(Booking)
        .options(selectinload(Booking.room), selectinload(Booking.feedback))
        .where(Booking.customer_telegram_id == user["id"])
        .order_by(Booking.starts_at.desc())
    )
    rows = (await session.execute(stmt)).scalars().all()
    return [
        _booking_out(b, b.feedback is not None, b.room.name if b.room else "—")
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
