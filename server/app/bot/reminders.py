from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.config import local_now, settings
from app.db import SessionLocal
from app.models import Booking, BookingStatus
from app.services.bot_texts import refresh_cache
from app.services.notifications import notify_reminder
from app.services.reports import build_bookings_workbook
from app.services.weekly_digest import (
    build_weekly_digest,
    digest_caption,
    digest_filename,
    week_bounds,
)
from app.telegram import send_document, send_text


async def _scan_and_send() -> None:
    now = local_now()
    day_lo = now + timedelta(hours=23, minutes=30)
    day_hi = now + timedelta(hours=24, minutes=30)
    hour_lo = now + timedelta(minutes=55)
    hour_hi = now + timedelta(minutes=65)

    async with SessionLocal() as session:
        # D-1 reminders
        stmt = (
            select(Booking)
            .options(selectinload(Booking.room))
            .where(
                Booking.status == BookingStatus.approved,
                Booking.reminder_day_sent.is_(False),
                Booking.starts_at.between(day_lo, day_hi),
            )
        )
        for b in (await session.execute(stmt)).scalars().all():
            await notify_reminder(b, b.room, "day")
            b.reminder_day_sent = True

        # H-1 reminders
        stmt = (
            select(Booking)
            .options(selectinload(Booking.room))
            .where(
                Booking.status == BookingStatus.approved,
                Booking.reminder_hour_sent.is_(False),
                Booking.starts_at.between(hour_lo, hour_hi),
            )
        )
        for b in (await session.execute(stmt)).scalars().all():
            await notify_reminder(b, b.room, "hour")
            b.reminder_hour_sent = True

        await session.commit()


async def _send_weekly_report() -> None:
    """Weekly digest of the week's confirmed events (Integration 4.2): the plain-text
    announcement plus the matching Excel export, posted to the AtS group chat and
    mirrored to every admin. Both cover the same Mon–Sat window."""
    monday, saturday = week_bounds(local_now().date())
    async with SessionLocal() as session:
        messages = await build_weekly_digest(session, monday, saturday)
        data = await build_bookings_workbook(session, monday, saturday)
    fname = digest_filename(monday, saturday)
    caption = digest_caption(monday, saturday)
    # dict.fromkeys: dedupe while keeping the group first, in case an admin ID also
    # happens to be the configured group chat.
    chats = dict.fromkeys([settings.sat_bookings_group_chat_id, *sorted(settings.admin_telegram_ids)])
    for chat_id in chats:
        for message in messages:
            await send_text(chat_id, message)
        await send_document(chat_id, data, fname, caption=caption)


def start_scheduler() -> AsyncIOScheduler:
    # Cron jobs (weekly report) fire in the business timezone; interval jobs are
    # relative so the timezone doesn't affect them.
    sched = AsyncIOScheduler(timezone=settings.app_tz)
    sched.add_job(_scan_and_send, "interval", minutes=5, max_instances=1, coalesce=True)
    # Pick up admin edits to bot texts without restarting the bot.
    sched.add_job(refresh_cache, "interval", seconds=30, max_instances=1, coalesce=True)
    # Weekly booking report — Monday 08:00 (business time).
    sched.add_job(
        _send_weekly_report, "cron", day_of_week="mon", hour=8, minute=0,
        max_instances=1, coalesce=True,
    )
    sched.start()
    return sched
