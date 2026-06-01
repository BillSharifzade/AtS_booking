"""Zone-level availability (Module B/E).

A booking targets a single room, but customers pick a *zone* and the system assigns
a free room. These helpers compute, for a zone:
  - which calendar days have any free slot (for greying out the picker), and
  - the free start times on a given day, each with the latest reachable end.

All times use the system's UTC wall-clock (the rest of the app treats stored
datetimes as UTC), so room open/close times map directly onto the grid.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Booking, BookingStatus, Room
from app.services.bookings import rooms_with_capacity

SLOT = timedelta(minutes=30)
MIN_DURATION = timedelta(minutes=30)
_ACTIVE = [BookingStatus.new, BookingStatus.processing, BookingStatus.approved]

Interval = tuple[datetime, datetime]


def _combine(d: date, t: time) -> datetime:
    return datetime.combine(d, t, tzinfo=timezone.utc)


def _daterange(day_from: date, day_to: date):
    d = day_from
    while d <= day_to:
        yield d
        d += timedelta(days=1)


async def bookable_rooms(session: AsyncSession, zone_id: int, attendees: int) -> list[Room]:
    """Active, non-coffee rooms in the zone that hold ``attendees``, smallest first."""
    stmt = (
        select(Room)
        .where(
            Room.zone_id == zone_id,
            Room.is_active.is_(True),
            Room.is_coffee_break.is_(False),
            Room.capacity >= attendees,
        )
        .order_by(Room.capacity, Room.name)
    )
    return list((await session.execute(stmt)).scalars().all())


async def _busy_by_room(
    session: AsyncSession, room_ids: list[int], range_start: datetime, range_end: datetime
) -> dict[int, list[Interval]]:
    if not room_ids:
        return {}
    stmt = select(Booking.room_id, Booking.starts_at, Booking.ends_at).where(
        Booking.room_id.in_(room_ids),
        Booking.status.in_(_ACTIVE),
        Booking.starts_at < range_end,
        Booking.ends_at > range_start,
    )
    out: dict[int, list[Interval]] = defaultdict(list)
    for rid, s, e in (await session.execute(stmt)).all():
        if s.tzinfo is None:
            s = s.replace(tzinfo=timezone.utc)
        if e.tzinfo is None:
            e = e.replace(tzinfo=timezone.utc)
        out[rid].append((s, e))
    return out


def _free_intervals(open_dt: datetime, close_dt: datetime, busy: list[Interval]) -> list[Interval]:
    """Operating window minus busy intervals, clipped to [open, close]."""
    clipped = sorted(
        (max(s, open_dt), min(e, close_dt)) for s, e in busy if e > open_dt and s < close_dt
    )
    free: list[Interval] = []
    cursor = open_dt
    for s, e in clipped:
        if s > cursor:
            free.append((cursor, s))
        cursor = max(cursor, e)
    if cursor < close_dt:
        free.append((cursor, close_dt))
    return free


def _day_starts(
    rooms: list[Room], day: date, busy_by_room: dict[int, list[Interval]], now: datetime
) -> list[tuple[time, time]]:
    """Free start times (30-min grid) for the zone on ``day``, each with the latest
    end reachable within a single room's free interval. Past times are excluded."""
    intervals: list[Interval] = []
    overall_open: datetime | None = None
    overall_close: datetime | None = None
    for room in rooms:
        open_dt = _combine(day, room.open_time)
        close_dt = _combine(day, room.close_time)
        if close_dt <= open_dt:
            continue
        overall_open = open_dt if overall_open is None else min(overall_open, open_dt)
        overall_close = close_dt if overall_close is None else max(overall_close, close_dt)
        for fs in _free_intervals(open_dt, close_dt, busy_by_room.get(room.id, [])):
            if fs[1] - fs[0] >= MIN_DURATION:
                intervals.append(fs)
    if not intervals or overall_open is None or overall_close is None:
        return []

    starts: list[tuple[time, time]] = []
    cur = overall_open
    while cur + MIN_DURATION <= overall_close:
        if cur >= now:
            max_end: datetime | None = None
            for a, b in intervals:
                if a <= cur < b:
                    max_end = b if max_end is None else max(max_end, b)
            if max_end is not None and max_end - cur >= MIN_DURATION:
                starts.append((cur.timetz().replace(tzinfo=None), max_end.timetz().replace(tzinfo=None)))
        cur += SLOT
    return starts


async def zone_day_slots(
    session: AsyncSession, zone_id: int, day: date, attendees: int
) -> list[tuple[time, time]]:
    rooms = await bookable_rooms(session, zone_id, attendees)
    if not rooms:
        return []
    day_start = _combine(day, time(0, 0))
    busy = await _busy_by_room(session, [r.id for r in rooms], day_start, day_start + timedelta(days=1))
    return _day_starts(rooms, day, busy, datetime.now(timezone.utc))


async def zone_available_days(
    session: AsyncSession, zone_id: int, day_from: date, day_to: date, attendees: int
) -> dict[date, bool]:
    rooms = await bookable_rooms(session, zone_id, attendees)
    today = datetime.now(timezone.utc).date()
    if not rooms:
        return {d: False for d in _daterange(day_from, day_to)}
    range_start = _combine(day_from, time(0, 0))
    range_end = _combine(day_to, time(0, 0)) + timedelta(days=1)
    busy = await _busy_by_room(session, [r.id for r in rooms], range_start, range_end)
    now = datetime.now(timezone.utc)
    out: dict[date, bool] = {}
    for d in _daterange(day_from, day_to):
        out[d] = False if d < today else bool(_day_starts(rooms, d, busy, now))
    return out


async def assign_room(
    session: AsyncSession, zone_id: int, attendees: int, starts_at: datetime, ends_at: datetime
) -> Room | None:
    """Smallest bookable room in the zone that fits and is free for the slot."""
    rooms = await rooms_with_capacity(session, attendees, starts_at, ends_at, zone_id=zone_id)
    return rooms[0] if rooms else None
