from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import local_now
from app.models import (
    AuditLog,
    Booking,
    BookingChecklistItem,
    BookingProp,
    BookingStatus,
    ChecklistTemplateItem,
    Company,
    Prop,
    RoomOfftime,
    Room,
    StatusHistory,
)


URGENT_THRESHOLD = timedelta(days=2)

# Global operating window for events: 08:30–17:30 on weekdays, and a shorter
# 10:00–17:00 on Saturday. Rooms may still declare their own (narrower) hours; the
# effective window is the intersection of the room's hours and the day's window.
BUSINESS_OPEN = time(8, 30)
BUSINESS_CLOSE = time(17, 30)
SATURDAY_OPEN = time(10, 0)
SATURDAY_CLOSE = time(17, 0)


def business_hours(day: date) -> tuple[time, time]:
    """Global open/close for a given date. Saturday runs on a shorter schedule;
    Sunday is closed entirely and is rejected before this is ever consulted."""
    if day.weekday() == 5:
        return SATURDAY_OPEN, SATURDAY_CLOSE
    return BUSINESS_OPEN, BUSINESS_CLOSE


def effective_open(room: Room, day: date) -> time:
    """Earliest bookable start for a room on ``day``: max of its open time and the
    business open for that weekday."""
    return max(room.open_time, business_hours(day)[0])


def effective_close(room: Room, day: date) -> time:
    """Latest bookable end for a room on ``day``: min of its close time and the
    business close for that weekday."""
    return min(room.close_time, business_hours(day)[1])


def is_sunday(dt: datetime | date) -> bool:
    """Whether a date/datetime falls on a Sunday (bookings are not allowed then)."""
    return dt.weekday() == 6


_KOINOTI_RE = re.compile(r"ко[ий]?ноти\s*нав|koinoti\s*nav", re.IGNORECASE)


def is_koinoti(company: str | None) -> bool:
    """Whether a free-text company label looks like КОИНОТИ НАВ. Only a *fallback*:
    for companies picked from the directory the explicit
    ``Company.requires_department`` flag decides (see :func:`needs_department`)."""
    return bool(company and _KOINOTI_RE.search(company))


async def needs_department(
    session: AsyncSession, *, company_id: int | None, company: str | None
) -> bool:
    """Whether this booking must state the requester's департамент/отдел.

    Admins own the rule per company (Companies → «Спрашивать департамент»); the name
    heuristic is used only when the customer typed a company that isn't in the directory."""
    if company_id is not None:
        row = await session.get(Company, company_id)
        if row is not None:
            return bool(row.requires_department)
    return is_koinoti(company)


def capacity_number(text: str | None) -> int | None:
    """Best-effort integer parsed out of a free-text capacity label.
    Uses the LARGEST number present, so a range like "10-12" → 12 (the room
    genuinely holds 12) and "До 10 человек" → 10. Returns None when the label has
    no digits ("много", ""), which callers treat as "unknown / unlimited"."""
    if not text:
        return None
    nums = re.findall(r"\d+", text)
    return max(int(n) for n in nums) if nums else None


def room_fits(room: Room, attendees: int) -> bool:
    """Whether a room's capacity can hold ``attendees``. An unparseable label
    (no number) is treated as sufficient so a descriptive value like «много»
    never blocks a booking."""
    cap = capacity_number(room.capacity)
    return cap is None or cap >= attendees


def _capacity_sort_key(room: Room) -> tuple[bool, int, str]:
    """Order rooms smallest-sufficient first; unknown-capacity rooms sort last."""
    cap = capacity_number(room.capacity)
    return (cap is None, cap or 0, room.name)

# Valid seating arrangements ("Расстановка"). Kept as a plain set so a future dynamic
# layout builder can extend it. Mirrors schemas.ROOM_STRUCTS.
ROOM_STRUCTS = {"theatre", "class", "banquet", "u_shaped", "conference"}

# Valid requester grades ("Грейд заявителя"). Mirrors schemas.GRADES — the two
# «Руководитель отдела/департамента» entries were merged into one (migration 0019).
GRADES = {
    "Стажер",
    "Специалист",
    "Ведущий специалист",
    "Главный специалист",
    "Руководитель структурного подразделения",
}

# What can be served at a coffee break. Mirrors schemas.COFFEE_TYPES.
COFFEE_TYPES = {"standard", "other"}

# Statuses that "hold" a resource (room slot / prop stock).
ACTIVE_STATUSES = [BookingStatus.new, BookingStatus.processing, BookingStatus.approved]


class BookingError(Exception):
    pass


async def has_offtime(
    session: AsyncSession, room_id: int, starts_at: datetime, ends_at: datetime
) -> RoomOfftime | None:
    """Scheduled-unavailability overlap for a room (Module: off-time scheduler)."""
    stmt = select(RoomOfftime).where(
        RoomOfftime.room_id == room_id,
        RoomOfftime.starts_at < ends_at,
        RoomOfftime.ends_at > starts_at,
    )
    return (await session.execute(stmt)).scalars().first()


def day_bounds(day: date) -> tuple[datetime, datetime]:
    """Half-open [00:00, next-day 00:00) window for a booking day. Booking times are
    stored as naive local wall-clock labelled UTC (see the timezone convention), so the
    bounds are built the same way and compare directly against starts_at."""
    start = datetime.combine(day, time.min, tzinfo=timezone.utc)
    return start, start + timedelta(days=1)


async def props_committed(
    session: AsyncSession,
    day: date,
    *,
    exclude_booking_id: int | None = None,
) -> dict[int, int]:
    """How much of each prop is already held on `day`, as {prop_id: amount}.

    Equipment is handed out and returned per event day, so stock is scoped to the
    calendar day of the booking. Previously this summed EVERY active booking with no
    time bound, which meant a single clicker used once stayed "in use" forever and
    blocked every future request for it."""
    day_start, day_end = day_bounds(day)
    stmt = (
        select(BookingProp.prop_id, func.coalesce(func.sum(BookingProp.amount), 0))
        .join(Booking, Booking.id == BookingProp.booking_id)
        .where(
            Booking.status.in_(ACTIVE_STATUSES),
            Booking.starts_at >= day_start,
            Booking.starts_at < day_end,
        )
        .group_by(BookingProp.prop_id)
    )
    if exclude_booking_id is not None:
        stmt = stmt.where(Booking.id != exclude_booking_id)
    return dict((await session.execute(stmt)).all())


async def validate_props(
    session: AsyncSession,
    requested: list[tuple[int, int]],
    *,
    day: date,
    exclude_booking_id: int | None = None,
) -> list[tuple[Prop, int]]:
    """Validate a list of (prop_id, amount) against stock for `day`: a prop's `amount`
    must cover everything committed by active bookings ON THAT DAY plus this request.
    Returns the resolved (Prop, amount) pairs or raises BookingError."""
    if not requested:
        return []
    committed = await props_committed(session, day, exclude_booking_id=exclude_booking_id)
    resolved: list[tuple[Prop, int]] = []
    for prop_id, amount in requested:
        prop = await session.get(Prop, prop_id)
        if prop is None or not prop.is_active:
            raise BookingError("Выбранное оборудование недоступно.")
        held = committed.get(prop_id, 0)
        if held + amount > prop.amount:
            available = max(prop.amount - held, 0)
            unit = prop.unit or "шт."
            raise BookingError(
                f"Недостаточно «{prop.name}» на выбранную дату: "
                f"доступно {available} {unit}, запрошено {amount}."
            )
        # Count this request too, so asking for the same prop twice in one booking
        # can't slip past the check.
        committed[prop_id] = held + amount
        resolved.append((prop, amount))
    return resolved


def _to_local_time(dt: datetime) -> time:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.time()


async def has_conflict(
    session: AsyncSession,
    room_id: int,
    starts_at: datetime,
    ends_at: datetime,
    exclude_id: int | None = None,
) -> bool:
    stmt = select(Booking.id).where(
        Booking.room_id == room_id,
        Booking.status.in_([BookingStatus.new, BookingStatus.processing, BookingStatus.approved]),
        Booking.starts_at < ends_at,
        Booking.ends_at > starts_at,
    )
    if exclude_id is not None:
        stmt = stmt.where(Booking.id != exclude_id)
    return (await session.execute(stmt)).first() is not None


def validate_window(room: Room, starts_at: datetime, ends_at: datetime) -> None:
    if ends_at <= starts_at:
        raise BookingError("Время окончания должно быть позже времени начала.")
    if starts_at.date() != ends_at.date():
        raise BookingError("Мероприятие должно начаться и закончиться в один день.")
    if is_sunday(starts_at):
        raise BookingError("Бронирование в воскресенье недоступно. Выберите другой день.")
    s = _to_local_time(starts_at)
    e = _to_local_time(ends_at)
    open_t = effective_open(room, starts_at.date())
    close_t = effective_close(room, starts_at.date())
    if s < open_t or e > close_t:
        raise BookingError(
            f"Мероприятие можно проводить с {open_t.strftime('%H:%M')} до {close_t.strftime('%H:%M')}."
        )


def _as_utc(dt: datetime) -> datetime:
    """Stored datetimes are naive local wall-clock labelled UTC — normalise so they can
    be compared with ``local_now()``."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def is_urgent(starts_at: datetime) -> bool:
    return (_as_utc(starts_at) - local_now()) < URGENT_THRESHOLD


def is_past(starts_at: datetime) -> bool:
    """Whether a slot has already started (business time)."""
    return _as_utc(starts_at) < local_now()


async def suggest_alternatives(
    session: AsyncSession,
    room_id: int,
    starts_at: datetime,
    ends_at: datetime,
    limit: int = 5,
) -> list[tuple[Room, datetime, datetime]]:
    duration = ends_at - starts_at
    # Coffee-break rooms are logistics-only and never offered as a bookable slot.
    rooms = (
        await session.execute(
            select(Room).where(Room.is_active.is_(True), Room.is_coffee_break.is_(False))
        )
    ).scalars().all()
    suggestions: list[tuple[Room, datetime, datetime]] = []
    for room in rooms:
        # Try same day, shifted by 30-minute steps backward and forward, up to ±3h.
        for offset_min in (0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180, -180):
            cand_start = starts_at + timedelta(minutes=offset_min)
            cand_end = cand_start + duration
            try:
                validate_window(room, cand_start, cand_end)
            except BookingError:
                continue
            if await has_conflict(session, room.id, cand_start, cand_end):
                continue
            suggestions.append((room, cand_start, cand_end))
            if len(suggestions) >= limit:
                return suggestions
            break
    return suggestions


async def rooms_with_capacity(
    session: AsyncSession,
    attendees: int,
    starts_at: datetime,
    ends_at: datetime,
    exclude_id: int | None = None,
    zone_id: int | None = None,
) -> list[Room]:
    """Active rooms that hold ``attendees``, are open at that time, and have no conflict.
    Ordered by smallest sufficient capacity first. Optionally scoped to one zone."""
    stmt = select(Room).where(
        Room.is_active.is_(True),
        Room.is_coffee_break.is_(False),
    )
    if zone_id is not None:
        stmt = stmt.where(Room.zone_id == zone_id)
    # Capacity is a free-text label, so the fit test/ordering happen in Python.
    rooms = [r for r in (await session.execute(stmt)).scalars().all() if room_fits(r, attendees)]
    rooms.sort(key=_capacity_sort_key)
    out: list[Room] = []
    for room in rooms:
        if exclude_id is not None and room.id == exclude_id:
            continue
        try:
            validate_window(room, starts_at, ends_at)
        except BookingError:
            continue
        if await has_conflict(session, room.id, starts_at, ends_at):
            continue
        if await has_offtime(session, room.id, starts_at, ends_at):
            continue
        out.append(room)
    return out


async def create_booking(
    session: AsyncSession,
    *,
    room: Room,
    starts_at: datetime,
    ends_at: datetime,
    customer_telegram_id: int,
    customer_username: str | None,
    company: str,
    contact_name: str,
    phone: str,
    event_type: str,
    event_name: str,
    description: str | None,
    attendees: int,
    coffee_break: bool,
    coffee_headcount: int | None,
    coffee_type: str | None = None,
    coffee_other: str | None = None,
    foreign_guests: bool = False,
    urgent: bool = False,
    room_struct: str | None = None,
    company_id: int | None = None,
    aim: str | None = None,
    grade: str | None = None,
    extra_services: str | None = None,
    position: str | None = None,
    trainer: str | None = None,
    department: str | None = None,
    target_employees: str | None = None,
    privacy_accepted: bool = False,
    allow_past: bool = False,
    props: list[tuple[int, int]] | None = None,
) -> Booking:
    validate_window(room, starts_at, ends_at)
    # Registering an event after it happened is an admin-only action (`allow_past`);
    # customers booking through the bot / mini app can only pick future slots.
    in_past = is_past(starts_at)
    if in_past and not allow_past:
        raise BookingError("Эта дата уже прошла. Выберите другое время.")
    if not room_fits(room, attendees):
        alts = await rooms_with_capacity(session, attendees, starts_at, ends_at, exclude_id=room.id)
        head = f"Вместимость «{room.name}» — {room.capacity}, а участников {attendees}."
        if alts:
            names = "; ".join(f"«{r.name}» (зона {r.zone.name}, {r.capacity})" for r in alts[:5])
            raise BookingError(f"{head} Подходящие помещения: {names}.")
        raise BookingError(f"{head} Нет свободных помещений с нужной вместимостью на это время.")
    # Coffee break: a dedicated coffee-break room is no longer required (an admin can
    # assign one later, and foreign-guest breaks are served in the event room itself).
    # `coffee_headcount` now = the number of coffee breaks during the event.
    coffee_type_val: str | None = None
    coffee_other_val: str | None = None
    if coffee_break:
        coffee_type_val = coffee_type or "standard"
        if coffee_type_val not in COFFEE_TYPES:
            raise BookingError("Неизвестный тип кофе-брейка.")
        if coffee_type_val == "other":
            coffee_other_val = (coffee_other or "").strip() or None
            if coffee_other_val is None:
                raise BookingError("Опишите, что нужно на кофе-брейке.")
    if await has_conflict(session, room.id, starts_at, ends_at):
        raise BookingError("Слот уже занят.")
    off = await has_offtime(session, room.id, starts_at, ends_at)
    if off is not None:
        raise BookingError(f"«{room.name}» недоступно в это время: {off.reason}.")
    if room_struct is not None and room_struct not in ROOM_STRUCTS:
        raise BookingError("Неизвестная расстановка.")
    grade_val = (grade or "").strip() or None
    if grade_val is not None and grade_val not in GRADES:
        raise BookingError("Неизвестный грейд.")
    aim_val = (aim or "").strip() or None
    extra_services_val = (extra_services or "").strip() or None
    position_val = (position or "").strip() or None
    trainer_val = (trainer or "").strip() or None
    target_employees_val = (target_employees or "").strip() or None
    # Only companies flagged for it (КОИНОТИ НАВ by default) must state the
    # participant's department/отдел.
    department_val = (department or "").strip() or None
    if department_val is None and await needs_department(
        session, company_id=company_id, company=company
    ):
        raise BookingError("Для мероприятий этой компании укажите департамент/отдел.")
    # Validate prop stock up-front so we don't create a booking we can't fulfil.
    # Stock is per event day — see props_committed().
    resolved_props = await validate_props(session, props or [], day=starts_at.date())

    # Spec rule: bookings <2 days out are always urgent; the user can also opt in.
    # A backdated record is never "urgent" — there is nothing left to hurry for.
    booking = Booking(
        room_id=room.id,
        company=company,
        company_id=company_id,
        contact_name=contact_name,
        phone=phone,
        customer_telegram_id=customer_telegram_id,
        customer_username=customer_username,
        event_type=event_type,
        event_name=event_name,
        description=description,
        aim=aim_val,
        grade=grade_val,
        extra_services=extra_services_val,
        position=position_val,
        trainer=trainer_val,
        department=department_val,
        target_employees=target_employees_val,
        privacy_accepted=privacy_accepted,
        attendees=attendees,
        room_struct=room_struct,
        coffee_break=coffee_break,
        coffee_headcount=coffee_headcount if coffee_break else None,
        coffee_type=coffee_type_val,
        coffee_other=coffee_other_val,
        foreign_guests=foreign_guests if coffee_break else False,
        starts_at=starts_at,
        ends_at=ends_at,
        status=BookingStatus.new,
        is_urgent=False if in_past else (urgent or is_urgent(starts_at)),
    )
    session.add(booking)
    await session.flush()
    session.add(
        StatusHistory(
            booking_id=booking.id,
            from_status=None,
            to_status=BookingStatus.new,
            actor_telegram_id=customer_telegram_id,
            note="created",
        )
    )
    for prop, amount in resolved_props:
        session.add(BookingProp(booking_id=booking.id, prop_id=prop.id, amount=amount))
    # Copy the global prep-checklist template onto the booking.
    template = (
        await session.execute(
            select(ChecklistTemplateItem).order_by(
                ChecklistTemplateItem.sort_order, ChecklistTemplateItem.id
            )
        )
    ).scalars().all()
    for item in template:
        session.add(
            BookingChecklistItem(
                booking_id=booking.id, text=item.text, done=False, sort_order=item.sort_order
            )
        )
    return booking


ALLOWED_TRANSITIONS: dict[BookingStatus, set[BookingStatus]] = {
    # `processing` is retired: it's never a destination anymore. Kept as a SOURCE
    # only so any legacy booking already in this status can still be resolved.
    BookingStatus.new: {BookingStatus.approved, BookingStatus.rejected},
    BookingStatus.processing: {BookingStatus.approved, BookingStatus.rejected},
    BookingStatus.approved: {BookingStatus.completed, BookingStatus.rejected},
    BookingStatus.rejected: {BookingStatus.archived},
    BookingStatus.completed: {BookingStatus.archived},
    BookingStatus.archived: set(),
}


async def transition(
    session: AsyncSession,
    booking: Booking,
    to_status: BookingStatus,
    actor_telegram_id: int,
    note: str | None = None,
) -> None:
    if to_status not in ALLOWED_TRANSITIONS[booking.status]:
        raise BookingError(f"Недопустимый переход: {booking.status.value} → {to_status.value}")
    session.add(
        StatusHistory(
            booking_id=booking.id,
            from_status=booking.status,
            to_status=to_status,
            actor_telegram_id=actor_telegram_id,
            note=note,
        )
    )
    booking.status = to_status
    if to_status == BookingStatus.rejected and note:
        booking.reject_reason = note


async def reassign_booking(
    session: AsyncSession,
    booking: Booking,
    *,
    room: Room | None = None,
    zone_id: int | None = None,
) -> Room:
    """Admin rebalancing (Module E): move a booking to another room, or auto-pick the
    smallest free room in a target zone. Keeps the same time window; re-validates
    capacity, operating hours and conflicts (the booking's own slot is excluded so a
    no-op / same-room reassignment doesn't false-positive). Sets ``booking.room_id``."""
    if booking.status in (BookingStatus.completed, BookingStatus.archived):
        raise BookingError("Нельзя переназначить завершённую или архивную заявку.")

    if room is not None:
        if not room.is_active or room.is_coffee_break:
            raise BookingError("Это помещение недоступно для бронирования.")
        if not room_fits(room, booking.attendees):
            raise BookingError(
                f"Вместимость «{room.name}» — {room.capacity}, а участников {booking.attendees}."
            )
        validate_window(room, booking.starts_at, booking.ends_at)
        if await has_conflict(
            session, room.id, booking.starts_at, booking.ends_at, exclude_id=booking.id
        ):
            raise BookingError(f"«{room.name}» занято в это время.")
        if await has_offtime(session, room.id, booking.starts_at, booking.ends_at):
            raise BookingError(f"«{room.name}» недоступно в это время (запланирован простой).")
        target = room
    elif zone_id is not None:
        stmt = select(Room).where(
            Room.is_active.is_(True),
            Room.is_coffee_break.is_(False),
            Room.zone_id == zone_id,
        )
        candidates = [
            r for r in (await session.execute(stmt)).scalars().all()
            if room_fits(r, booking.attendees)
        ]
        candidates.sort(key=_capacity_sort_key)
        target = None
        for r in candidates:
            try:
                validate_window(r, booking.starts_at, booking.ends_at)
            except BookingError:
                continue
            if await has_conflict(
                session, r.id, booking.starts_at, booking.ends_at, exclude_id=booking.id
            ):
                continue
            target = r
            break
        if target is None:
            raise BookingError(
                "В выбранной зоне нет свободного помещения на это время "
                "для указанного числа участников."
            )
    else:
        raise BookingError("Укажите помещение или зону.")

    booking.room_id = target.id
    return target


async def get_booking_with_details(session: AsyncSession, booking_id: int) -> Booking | None:
    stmt = (
        select(Booking)
        .where(Booking.id == booking_id)
        .options(
            selectinload(Booking.room),
            selectinload(Booking.status_history),
            selectinload(Booking.feedback),
            selectinload(Booking.checklist),
            selectinload(Booking.props),
        )
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def audit(
    session: AsyncSession,
    actor_telegram_id: int,
    action: str,
    target_type: str | None = None,
    target_id: int | None = None,
    payload: str | None = None,
) -> None:
    session.add(
        AuditLog(
            actor_telegram_id=actor_telegram_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            payload=payload,
        )
    )
