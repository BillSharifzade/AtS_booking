from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.config import settings
from app.db import SessionLocal
from app.models import Booking, BookingStatus
from app.services.bot_texts import refresh_cache
from app.services.notifications import notify_reminder
from app.services.reports import build_bookings_workbook, report_filename
from app.telegram import send_document


async def _scan_and_send() -> None:
    now = datetime.now(timezone.utc)
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
    """Weekly Excel digest of all bookings to every admin (Integration 4.2)."""
    if not settings.admin_telegram_ids:
        return
    async with SessionLocal() as session:
        data = await build_bookings_workbook(session)
    fname = report_filename()
    for admin_id in settings.admin_telegram_ids:
        await send_document(
            admin_id, data, fname, caption="Еженедельный отчёт по бронированиям AtS."
        )


def start_scheduler() -> AsyncIOScheduler:
    sched = AsyncIOScheduler(timezone="UTC")
    sched.add_job(_scan_and_send, "interval", minutes=5, max_instances=1, coalesce=True)
    # Pick up admin edits to bot texts without restarting the bot.
    sched.add_job(refresh_cache, "interval", seconds=30, max_instances=1, coalesce=True)
    # Weekly booking report — Monday 08:00 UTC.
    sched.add_job(
        _send_weekly_report, "cron", day_of_week="mon", hour=8, minute=0,
        max_instances=1, coalesce=True,
    )
    sched.start()
    return sched
