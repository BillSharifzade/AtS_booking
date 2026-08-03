"""Delete test bookings that start before a cutoff date.

Written to clear the bookings accumulated while testing, i.e. everything before
August 2026. DRY RUN BY DEFAULT — it prints what it would remove and changes nothing
until you pass --yes.

Child rows (status_history, feedback, booking_props, booking_checklist_items) all
declare ON DELETE CASCADE, so they go with their booking automatically. audit_log
entries are NOT foreign-keyed to bookings; they are left alone unless --purge-audit
is given, so the admin action history survives by default.

Usage (from the repo root, stack running):

    # see what would be deleted
    docker compose exec api python scripts/purge_bookings.py

    # actually delete
    docker compose exec api python scripts/purge_bookings.py --yes

    # different cutoff / also drop the matching audit rows
    docker compose exec api python scripts/purge_bookings.py --before 2026-07-01 --yes
    docker compose exec api python scripts/purge_bookings.py --purge-audit --yes
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import date, datetime, time, timezone
from pathlib import Path

# Run as `python scripts/purge_bookings.py` from the app root: sys.path[0] is then the
# scripts/ dir, so the package root has to be added explicitly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import delete, func, select  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    AuditLog,
    Booking,
    BookingChecklistItem,
    BookingProp,
    Feedback,
    StatusHistory,
)

DEFAULT_CUTOFF = date(2026, 8, 1)

# Child tables that cascade with a booking, for the "what will go" report.
CHILD_TABLES = [
    ("status_history", StatusHistory),
    ("feedback", Feedback),
    ("booking_props", BookingProp),
    ("booking_checklist_items", BookingChecklistItem),
]


async def run(cutoff: date, apply: bool, purge_audit: bool) -> int:
    # Booking times are stored as naive local wall-clock labelled UTC, so the cutoff is
    # built the same way (see the timezone convention in app/services/bookings.py).
    cutoff_dt = datetime.combine(cutoff, time.min, tzinfo=timezone.utc)

    async with SessionLocal() as session:
        ids = list(
            (await session.execute(select(Booking.id).where(Booking.starts_at < cutoff_dt))).scalars()
        )
        total = len(ids)
        print(f"Cutoff: bookings starting before {cutoff.isoformat()} (00:00)")
        print(f"Bookings matched: {total}")

        if not total:
            print("Nothing to delete.")
            return 0

        by_status = (
            await session.execute(
                select(Booking.status, func.count())
                .where(Booking.starts_at < cutoff_dt)
                .group_by(Booking.status)
            )
        ).all()
        for status, n in sorted(by_status, key=lambda r: str(r[0])):
            print(f"  {getattr(status, 'value', status):<12} {n}")

        rng = (
            await session.execute(
                select(func.min(Booking.starts_at), func.max(Booking.starts_at))
                .where(Booking.starts_at < cutoff_dt)
            )
        ).one()
        print(f"Date range: {rng[0]:%Y-%m-%d} … {rng[1]:%Y-%m-%d}")

        print("Cascading child rows:")
        for label, model in CHILD_TABLES:
            n = (
                await session.execute(
                    select(func.count()).select_from(model).where(model.booking_id.in_(ids))
                )
            ).scalar_one()
            print(f"  {label:<26} {n}")

        audit_n = (
            await session.execute(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.target_type == "booking", AuditLog.target_id.in_(ids))
            )
        ).scalar_one()
        print(f"  audit_log (booking entries)  {audit_n}"
              f"{' — will be deleted' if purge_audit else ' — kept (use --purge-audit to drop)'}")

        if not apply:
            print("\nDRY RUN — nothing was deleted. Re-run with --yes to apply.")
            return 0

        if purge_audit:
            await session.execute(
                delete(AuditLog).where(
                    AuditLog.target_type == "booking", AuditLog.target_id.in_(ids)
                )
            )
        # Child rows go via ON DELETE CASCADE.
        result = await session.execute(delete(Booking).where(Booking.starts_at < cutoff_dt))
        await session.commit()
        print(f"\nDeleted {result.rowcount} bookings.")
        return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument(
        "--before",
        type=date.fromisoformat,
        default=DEFAULT_CUTOFF,
        metavar="YYYY-MM-DD",
        help=f"delete bookings starting before this date (default {DEFAULT_CUTOFF.isoformat()})",
    )
    ap.add_argument("--yes", action="store_true", help="actually delete (without it this is a dry run)")
    ap.add_argument(
        "--purge-audit",
        action="store_true",
        help="also delete audit_log entries that point at the removed bookings",
    )
    args = ap.parse_args()
    return asyncio.run(run(args.before, args.yes, args.purge_audit))


if __name__ == "__main__":
    sys.exit(main())
