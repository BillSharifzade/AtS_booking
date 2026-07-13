from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import current_admin, current_user
from app.config import local_now
from app.db import get_session
from app.models import (
    Booking,
    BookingChecklistItem,
    BookingStatus,
    Feedback,
    Room,
    Zone,
)
from app.schemas import (
    COFFEE_STATUSES,
    RESULT_OUTCOMES,
    AlternativeSlot,
    ApproveIn,
    BookingChecklistItemOut,
    BookingChecklistToggle,
    BookingCreate,
    BookingOut,
    BookingPropOut,
    BookingWithRoom,
    CoffeeBreakOut,
    CoffeeUpdate,
    CompleteIn,
    ReassignIn,
    RejectIn,
    ReviewOut,
)
from app.services import availability as avail
from app.services import bookings as svc
from app.services.notifications import notify_new, notify_room_changed, notify_status_change

router = APIRouter(prefix="/bookings", tags=["bookings"])


@router.get("", response_model=list[BookingOut])
async def list_bookings(
    status: BookingStatus | None = None,
    zone: str | None = None,
    customer_telegram_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[Booking]:
    stmt = select(Booking).order_by(Booking.starts_at.desc())
    if status is not None:
        stmt = stmt.where(Booking.status == status)
    if customer_telegram_id is not None:
        stmt = stmt.where(Booking.customer_telegram_id == customer_telegram_id)
    if date_from is not None:
        stmt = stmt.where(Booking.starts_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(Booking.starts_at <= date_to)
    if zone is not None:
        stmt = stmt.join(Room).join(Zone).where(Zone.name == zone)
    return list((await session.execute(stmt)).scalars().all())


# NB: declared before "/{booking_id}" so "coffee" isn't parsed as a booking id.
@router.get("/coffee", response_model=list[CoffeeBreakOut])
async def coffee_breaks(
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[CoffeeBreakOut]:
    # Upcoming events that need coffee-break prep (Module E), soonest first.
    today_start = local_now().replace(hour=0, minute=0, second=0, microsecond=0)
    stmt = (
        select(Booking)
        .options(selectinload(Booking.room).selectinload(Room.zone), selectinload(Booking.coffee_room))
        .where(
            Booking.coffee_break.is_(True),
            Booking.status.in_([BookingStatus.new, BookingStatus.processing, BookingStatus.approved]),
            Booking.starts_at >= today_start,
        )
        .order_by(Booking.starts_at)
    )
    rows = (await session.execute(stmt)).scalars().all()
    return [
        CoffeeBreakOut(
            id=b.id,
            event_name=b.event_name,
            starts_at=b.starts_at,
            ends_at=b.ends_at,
            zone=b.room.zone.name if b.room and b.room.zone else "—",
            room=b.room.name if b.room else "—",
            attendees=b.attendees,
            coffee_headcount=b.coffee_headcount,
            coffee_type=b.coffee_type,
            coffee_other=b.coffee_other,
            foreign_guests=b.foreign_guests,
            status=b.status,
            coffee_status=b.coffee_status,
            coffee_room_id=b.coffee_room_id,
            coffee_room=b.coffee_room.name if b.coffee_room else None,
        )
        for b in rows
    ]


# NB: declared before "/{booking_id}" so "reviews" isn't parsed as a booking id.
@router.get("/reviews", response_model=list[ReviewOut])
async def list_reviews(
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ReviewOut]:
    """Admin reviews view: who / company / room / stars / comment (Module F, #12)."""
    stmt = (
        select(Booking, Feedback)
        .join(Feedback, Feedback.booking_id == Booking.id)
        .options(selectinload(Booking.room).selectinload(Room.zone))
        .order_by(Feedback.created_at.desc())
    )
    rows = (await session.execute(stmt)).all()
    return [
        ReviewOut(
            booking_id=b.id,
            event_name=b.event_name,
            company=b.company,
            room=b.room.name if b.room else "—",
            zone=b.room.zone.name if b.room and b.room.zone else "—",
            customer_telegram_id=b.customer_telegram_id,
            rating=f.rating,
            room_rating=f.room_rating,
            service_rating=f.service_rating,
            props_rating=f.props_rating,
            comment=f.comment,
            created_at=f.created_at,
        )
        for b, f in rows
    ]


@router.get("/{booking_id}", response_model=BookingWithRoom)
async def get_booking(
    booking_id: int,
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Booking:
    booking = await svc.get_booking_with_details(session, booking_id)
    if booking is None:
        raise HTTPException(404, "not found")
    return booking


@router.post("", response_model=BookingOut, status_code=201)
async def create_booking_endpoint(
    payload: BookingCreate,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> Booking:
    # Admin-initiated booking from the panel. (The bot creates bookings via the
    # service layer directly, so it never hits this endpoint.)
    # Either a zone (system assigns a free room) or an explicit room.
    if payload.zone_id is not None:
        room = await avail.assign_room(
            session, payload.zone_id, payload.attendees, payload.starts_at, payload.ends_at
        )
        if room is None:
            raise HTTPException(
                409,
                "Нет свободного помещения в выбранной зоне на это время "
                "для указанного числа участников.",
            )
    elif payload.room_id is not None:
        room = await session.get(Room, payload.room_id)
        if room is None or not room.is_active:
            raise HTTPException(400, "Помещение недоступно.")
    else:
        raise HTTPException(400, "Укажите зону или помещение.")
    try:
        booking = await svc.create_booking(
            session,
            room=room,
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
            customer_telegram_id=payload.customer_telegram_id,
            customer_username=payload.customer_username,
            company=payload.company,
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
            position=payload.position,
            trainer=payload.trainer,
            department=payload.department,
            target_employees=payload.target_employees,
            privacy_accepted=payload.privacy_accepted,
            props=[(p.prop_id, p.amount) for p in payload.props],
        )
        await svc.audit(session, admin_id, "booking.create", "booking", booking.id, f"«{booking.event_name}», {room.name}")
        await session.commit()
    except svc.BookingError as exc:
        await session.rollback()
        raise HTTPException(409, str(exc))
    await session.refresh(booking, attribute_names=["room"])
    await notify_new(booking, room)
    return booking


@router.get("/alternatives/search", response_model=list[AlternativeSlot])
async def alternatives(
    room_id: int = Query(...),
    starts_at: datetime = Query(...),
    ends_at: datetime = Query(...),
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[AlternativeSlot]:
    out: list[AlternativeSlot] = []
    for room, s, e in await svc.suggest_alternatives(session, room_id, starts_at, ends_at):
        out.append(AlternativeSlot(room_id=room.id, room_name=room.name, starts_at=s, ends_at=e))
    return out


@router.post("/{booking_id}/reassign", response_model=BookingWithRoom)
async def reassign(
    booking_id: int,
    payload: ReassignIn,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> Booking:
    # Module E: admin rebalancing — move a booking to another room or auto-assign in a zone.
    booking = await svc.get_booking_with_details(session, booking_id)
    if booking is None:
        raise HTTPException(404, "not found")
    target_room = None
    if payload.room_id is not None:
        target_room = await session.get(Room, payload.room_id)
        if target_room is None:
            raise HTTPException(400, "Помещение не найдено.")
    try:
        prev_room_name = booking.room.name
        room = await svc.reassign_booking(session, booking, room=target_room, zone_id=payload.zone_id)
        await svc.audit(
            session, admin_id, "booking.reassign", "booking", booking.id,
            f"«{booking.event_name}»: {prev_room_name} → {room.name}",
        )
        await session.commit()
    except svc.BookingError as exc:
        await session.rollback()
        raise HTTPException(409, str(exc))
    await session.refresh(booking, attribute_names=["room"])
    # Only an already-confirmed booking is "official", so only then tell the customer.
    if booking.status == BookingStatus.approved:
        await notify_room_changed(booking, booking.room)
    return await svc.get_booking_with_details(session, booking.id)


@router.patch("/{booking_id}/coffee", response_model=BookingWithRoom)
async def set_coffee(
    booking_id: int,
    payload: CoffeeUpdate,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> Booking:
    # Module E: set coffee-break prep status and/or the coffee-break room serving it.
    booking = await svc.get_booking_with_details(session, booking_id)
    if booking is None:
        raise HTTPException(404, "not found")
    if not booking.coffee_break:
        raise HTTPException(400, "У этой заявки нет кофе-брейка.")
    data = payload.model_dump(exclude_unset=True)
    if "coffee_status" in data:
        if data["coffee_status"] not in COFFEE_STATUSES:
            raise HTTPException(400, "Недопустимый статус кофе-брейка.")
        booking.coffee_status = data["coffee_status"]
    if "coffee_room_id" in data:
        rid = data["coffee_room_id"]
        if rid is not None:
            room = await session.get(Room, rid)
            if room is None or not room.is_active or not room.is_coffee_break:
                raise HTTPException(400, "Выберите активное помещение для кофе-брейка.")
        booking.coffee_room_id = rid
    await svc.audit(
        session, admin_id, "booking.coffee", "booking", booking.id,
        f"«{booking.event_name}»: статус={booking.coffee_status}, помещение={booking.coffee_room_id or '—'}",
    )
    await session.commit()
    return await svc.get_booking_with_details(session, booking_id)


@router.patch("/{booking_id}/checklist/{item_id}", response_model=BookingChecklistItemOut)
async def toggle_checklist_item(
    booking_id: int,
    item_id: int,
    payload: BookingChecklistToggle,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> BookingChecklistItem:
    # Per-booking prep checklist (#9): admins tick/untick stages.
    item = await session.get(BookingChecklistItem, item_id)
    if item is None or item.booking_id != booking_id:
        raise HTTPException(404, "Пункт чек-листа не найден.")
    item.done = payload.done
    await session.commit()
    await session.refresh(item)
    return item


@router.post("/{booking_id}/approve", response_model=BookingOut)
async def approve(
    booking_id: int,
    payload: ApproveIn,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> Booking:
    booking = await svc.get_booking_with_details(session, booking_id)
    if booking is None:
        raise HTTPException(404, "not found")
    try:
        await svc.transition(session, booking, BookingStatus.approved, admin_id, payload.note)
        detail = f"«{booking.event_name}»" + (f" — {payload.note}" if payload.note else "")
        await svc.audit(session, admin_id, "booking.approve", "booking", booking.id, detail)
        await session.commit()
    except svc.BookingError as exc:
        await session.rollback()
        raise HTTPException(409, str(exc))
    await session.refresh(booking, attribute_names=["room"])
    await notify_status_change(booking, booking.room, BookingStatus.approved)
    return booking


@router.post("/{booking_id}/reject", response_model=BookingOut)
async def reject(
    booking_id: int,
    payload: RejectIn,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> Booking:
    booking = await svc.get_booking_with_details(session, booking_id)
    if booking is None:
        raise HTTPException(404, "not found")
    try:
        await svc.transition(session, booking, BookingStatus.rejected, admin_id, payload.reason)
        await svc.audit(session, admin_id, "booking.reject", "booking", booking.id, f"«{booking.event_name}» — {payload.reason}")
        await session.commit()
    except svc.BookingError as exc:
        await session.rollback()
        raise HTTPException(409, str(exc))
    await session.refresh(booking, attribute_names=["room"])
    await notify_status_change(booking, booking.room, BookingStatus.rejected)
    return booking


@router.post("/{booking_id}/complete", response_model=BookingOut)
async def complete(
    booking_id: int,
    payload: CompleteIn | None = None,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> Booking:
    booking = await svc.get_booking_with_details(session, booking_id)
    if booking is None:
        raise HTTPException(404, "not found")
    payload = payload or CompleteIn()
    if payload.outcome is not None and payload.outcome not in RESULT_OUTCOMES:
        raise HTTPException(400, "Недопустимый итог мероприятия.")
    note = (payload.note or "").strip() or None
    try:
        # Result captured at completion (Module F): persisted on the booking + status note.
        booking.result_outcome = payload.outcome
        booking.result_note = note
        await svc.transition(session, booking, BookingStatus.completed, admin_id, note)
        detail = f"«{booking.event_name}»" + (f" — {payload.outcome}" if payload.outcome else "")
        await svc.audit(session, admin_id, "booking.complete", "booking", booking.id, detail)
        await session.commit()
    except svc.BookingError as exc:
        await session.rollback()
        raise HTTPException(409, str(exc))
    await session.refresh(booking, attribute_names=["room"])
    await notify_status_change(booking, booking.room, BookingStatus.completed)
    return booking


@router.post("/{booking_id}/archive", response_model=BookingOut)
async def archive(
    booking_id: int,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> Booking:
    booking = await svc.get_booking_with_details(session, booking_id)
    if booking is None:
        raise HTTPException(404, "not found")
    try:
        await svc.transition(session, booking, BookingStatus.archived, admin_id)
        await svc.audit(session, admin_id, "booking.archive", "booking", booking.id, f"«{booking.event_name}»")
        await session.commit()
    except svc.BookingError as exc:
        await session.rollback()
        raise HTTPException(409, str(exc))
    await session.refresh(booking, attribute_names=["room"])
    return booking
