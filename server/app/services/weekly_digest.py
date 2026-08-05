"""Weekly "предстоящие мероприятия" digest for the AtS group chat (Integration 4.2).

Renders the confirmed bookings of the current business week as the plain-text
announcement the team posts in Telegram — one block per day, numbered events inside
each day — to be sent alongside the .xlsx export scoped to the same week.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.bot import texts
from app.models import Booking, BookingStatus
from app.telegram import esc

WEEKDAY_NAMES = (
    "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье",
)

# Registration opens shortly before the event and is announced as a "from-to" range.
# It is never earlier than REG_EARLIEST so the first slot of the day (business hours
# start at 08:30) doesn't invite people before the building is open.
REG_LEAD = timedelta(minutes=15)
REG_EARLIEST = time(8, 20)

# Mon–Fri are always listed, even when empty. Saturday is bookable too (only Sunday
# is closed — see services.bookings.is_sunday), so it's appended only when it
# actually has events, keeping the usual five-day shape of the announcement.
_ALWAYS_SHOWN_WEEKDAYS = 5

# Telegram rejects a single message longer than 4096 characters.
TG_MESSAGE_LIMIT = 4096

_KEYCAPS = ("1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟")


def week_bounds(today: date) -> tuple[date, date]:
    """Monday–Saturday of the business week containing ``today`` (Sunday is closed)."""
    monday = today - timedelta(days=today.weekday())
    return monday, monday + timedelta(days=5)


def _day_range_utc(day_from: date, day_to: date) -> tuple[datetime, datetime]:
    """Half-open [start, end) bounds for an inclusive day range, in the same
    naive-local-labelled-UTC form that ``Booking.starts_at`` is stored in."""
    start = datetime.combine(day_from, time.min, tzinfo=timezone.utc)
    end = datetime.combine(day_to, time.min, tzinfo=timezone.utc) + timedelta(days=1)
    return start, end


def _marker(index: int) -> str:
    """1-based position of an event inside its day, as a keycap emoji."""
    return _KEYCAPS[index - 1] if index <= len(_KEYCAPS) else f"{index})"


def _hhmm(dt: datetime) -> str:
    return dt.strftime("%H:%M")


def _registration(starts_at: datetime) -> str:
    opens = starts_at - REG_LEAD
    floor = starts_at.replace(
        hour=REG_EARLIEST.hour, minute=REG_EARLIEST.minute, second=0, microsecond=0
    )
    # Hold registration back to REG_EARLIEST — but never past the event itself, or the
    # range would read backwards for a slot that somehow starts before REG_EARLIEST.
    if opens < floor < starts_at:
        opens = floor
    return f"{_hhmm(opens)}-{_hhmm(starts_at)}"


def _event_lines(booking: Booking, marker: str) -> str:
    """One event block. Optional fields are dropped instead of printed empty."""
    lines = [f"{marker} Формат мероприятия: {esc(booking.event_type)}"]
    if booking.event_name:
        lines.append(f"📝 Тема: {esc(booking.event_name)}")
    if booking.trainer:
        lines.append(f"🙎‍♂️ Тренер/Ведущий: {esc(booking.trainer)}")
    lines.append(f"👩‍💻 Аудитория: {esc(booking.room.name)}")
    lines.append(f"🔔 Регистрация: {_registration(booking.starts_at)}")
    lines.append(f"⏳ Время: {_hhmm(booking.starts_at)}-{_hhmm(booking.ends_at)}")
    lines.append(f"🏢 Компания: {esc(booking.company)}")
    lines.append(f"👥 Участники: {booking.attendees}")
    return "\n".join(lines)


def _event_block(booking: Booking, index: int) -> str:
    """One numbered event of a day inside the weekly digest."""
    return _event_lines(booking, _marker(index))


# Header of the single-event announcement posted to the AtS group when a booking is
# confirmed. The body reuses the weekly-digest block so both messages read the same.
ANNOUNCE_TITLE = "📣 Новое мероприятие"


def event_announcement(booking: Booking) -> str:
    """Group-chat announcement for ONE confirmed booking, in the agreed weekly-digest
    format (day header + the same field block) rather than the internal admin card."""
    day = booking.starts_at.date()
    return (
        f"{ANNOUNCE_TITLE}\n"
        f"📅 {WEEKDAY_NAMES[day.weekday()]} {day:%d.%m.%Y}\n\n"
        f"{_event_lines(booking, '▪️')}"
    )


def _day_block(day: date, bookings: list[Booking]) -> str:
    header = f"{WEEKDAY_NAMES[day.weekday()]} {day:%d.%m}"
    if not bookings:
        return f"{header} {texts.get('WEEKLY_NO_EVENTS')}"
    events = [_event_block(b, i) for i, b in enumerate(bookings, start=1)]
    return header + "\n" + "\n\n".join(events)


async def fetch_week_bookings(
    session: AsyncSession, monday: date, saturday: date
) -> list[Booking]:
    """Confirmed bookings of the week, ordered chronologically. Only ``approved``
    events are announced — new/rejected requests must not reach the group chat."""
    start, end = _day_range_utc(monday, saturday)
    stmt = (
        select(Booking)
        .options(selectinload(Booking.room))
        .where(
            Booking.status == BookingStatus.approved,
            Booking.starts_at >= start,
            Booking.starts_at < end,
        )
        .order_by(Booking.starts_at, Booking.id)
    )
    return list((await session.execute(stmt)).scalars().all())


def render_digest(monday: date, saturday: date, bookings: list[Booking]) -> list[str]:
    """The announcement as a list of blocks (intro + one per day), ready to be joined
    with a blank line or packed into several Telegram messages."""
    by_day: dict[date, list[Booking]] = {}
    for b in bookings:
        by_day.setdefault(b.starts_at.date(), []).append(b)

    # Greeting/heading are admin-editable from the panel ("Тексты бота").
    blocks = [f"{texts.get('WEEKLY_GREETING')}\n\n{texts.get('WEEKLY_HEADING')}"]
    day = monday
    while day <= saturday:
        events = by_day.get(day, [])
        # Saturday only shows up when something is actually booked on it.
        if events or (day - monday).days < _ALWAYS_SHOWN_WEEKDAYS:
            blocks.append(_day_block(day, events))
        day += timedelta(days=1)
    return blocks


def pack_messages(blocks: list[str], limit: int = TG_MESSAGE_LIMIT) -> list[str]:
    """Greedily join blocks into as few messages as possible, splitting only on block
    boundaries so a day is never cut in half."""
    messages: list[str] = []
    current = ""
    for block in blocks:
        candidate = f"{current}\n\n{block}" if current else block
        if current and len(candidate) > limit:
            messages.append(current)
            current = block
        else:
            current = candidate
    if current:
        messages.append(current)
    # A single block longer than the limit (a day packed with events) still has to be
    # cut somewhere — fall back to hard slicing so nothing is silently dropped.
    out: list[str] = []
    for msg in messages:
        while len(msg) > limit:
            out.append(msg[:limit])
            msg = msg[limit:]
        out.append(msg)
    return out


async def build_weekly_digest(
    session: AsyncSession, monday: date, saturday: date
) -> list[str]:
    """Full announcement for the given week, split into sendable Telegram messages."""
    bookings = await fetch_week_bookings(session, monday, saturday)
    return pack_messages(render_digest(monday, saturday, bookings))


def digest_filename(monday: date, saturday: date) -> str:
    return f"ats_events_{monday:%Y-%m-%d}_{saturday:%Y-%m-%d}.xlsx"


def digest_caption(monday: date, saturday: date) -> str:
    """Caption for the attached .xlsx — admin-editable, with a {period} placeholder."""
    return texts.get("WEEKLY_CAPTION").replace("{period}", f"{monday:%d.%m}–{saturday:%d.%m}")
