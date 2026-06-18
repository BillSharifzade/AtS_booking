from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import current_user
from app.db import get_session
from app.models import Booking, BookingStatus, Company, Feedback, Room, Zone
from app.schemas import CompanyStat, DashboardSummary, RoomStat, UpcomingItem, ZoneStat
from app.services.bookings import audit
from app.services.reports import build_bookings_workbook, period_bounds, report_filename

router = APIRouter(prefix="/reports", tags=["reports"])

XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/bookings.xlsx")
async def bookings_xlsx(
    date_from: date | None = None,
    date_to: date | None = None,
    user: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    data = await build_bookings_workbook(session, date_from, date_to)
    payload = f"выгрузка бронирований (xlsx) {date_from or '…'}–{date_to or '…'}"
    await audit(session, user[0], "report.export", "report", None, payload)
    await session.commit()
    fname = report_filename()
    return Response(
        content=data,
        media_type=XLSX_MEDIA,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/summary", response_model=DashboardSummary)
async def summary(
    date_from: date | None = None,
    date_to: date | None = None,
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> DashboardSummary:
    """Aggregated dashboard stats over a [date_from, date_to] booking range.
    Everything is computed in SQL (a handful of grouped queries) rather than pulling
    rows into Python — cheap regardless of how many bookings exist."""
    f = period_bounds(date_from, date_to)

    # Status breakdown.
    status_rows = (
        await session.execute(select(Booking.status, func.count()).where(*f).group_by(Booking.status))
    ).all()
    by_status = {s.value: c for s, c in status_rows}

    # Scalar aggregates in one pass.
    total, attendees_sum, urgent, coffee_count, coffee_head = (
        await session.execute(
            select(
                func.count(Booking.id),
                func.coalesce(func.sum(Booking.attendees), 0),
                func.coalesce(func.sum(case((Booking.is_urgent, 1), else_=0)), 0),
                func.coalesce(func.sum(case((Booking.coffee_break, 1), else_=0)), 0),
                func.coalesce(
                    func.sum(case((Booking.coffee_break, func.coalesce(Booking.coffee_headcount, 0)), else_=0)),
                    0,
                ),
            ).where(*f)
        )
    ).one()

    # Average ratings (overall + per aspect) + feedback count over the period.
    avg_rating, avg_room, avg_service, avg_props, feedback_count = (
        await session.execute(
            select(
                func.avg(Feedback.rating),
                func.avg(Feedback.room_rating),
                func.avg(Feedback.service_rating),
                func.avg(Feedback.props_rating),
                func.count(Feedback.id),
            )
            .select_from(Feedback)
            .join(Booking, Feedback.booking_id == Booking.id)
            .where(*f)
        )
    ).one()

    # Average lead time (booking made → event start), in hours.
    avg_lead = (
        await session.execute(
            select(func.avg(func.extract("epoch", Booking.starts_at - Booking.created_at)) / 3600.0).where(*f)
        )
    ).scalar_one()

    # Seating-arrangement breakdown.
    struct_rows = (
        await session.execute(
            select(Booking.room_struct, func.count())
            .where(*f, Booking.room_struct.is_not(None))
            .group_by(Booking.room_struct)
        )
    ).all()
    by_struct = {s: c for s, c in struct_rows}

    # Top companies by booking count.
    company_rows = (
        await session.execute(
            select(Booking.company, func.count(Booking.id))
            .where(*f)
            .group_by(Booking.company)
            .order_by(func.count(Booking.id).desc())
            .limit(5)
        )
    ).all()
    top_companies = [CompanyStat(company=c or "—", count=n) for c, n in company_rows]

    # Inventory counts (current, not range-bound).
    active_rooms = (
        await session.execute(select(func.count(Room.id)).where(Room.is_active.is_(True)))
    ).scalar_one()
    active_companies = (
        await session.execute(select(func.count(Company.id)).where(Company.is_active.is_(True)))
    ).scalar_one()

    # Funnel rates derived from the status breakdown.
    n_completed = by_status.get("completed", 0)
    n_approved = by_status.get("approved", 0)
    n_rejected = by_status.get("rejected", 0)
    decided = n_approved + n_completed + n_rejected
    approval_rate = round((n_approved + n_completed) / decided, 3) if decided else None
    confirmed = n_approved + n_completed
    completion_rate = round(n_completed / confirmed, 3) if confirmed else None

    # Bookings & attendees per zone.
    zone_rows = (
        await session.execute(
            select(Zone.name, func.count(Booking.id), func.coalesce(func.sum(Booking.attendees), 0))
            .select_from(Booking)
            .join(Room, Booking.room_id == Room.id)
            .join(Zone, Room.zone_id == Zone.id)
            .where(*f)
            .group_by(Zone.name)
            .order_by(func.count(Booking.id).desc())
        )
    ).all()
    by_zone = [ZoneStat(zone=z, count=c, attendees=a) for z, c, a in zone_rows]

    # Busiest rooms by booking count, with total booked hours.
    hours_expr = func.coalesce(func.sum(func.extract("epoch", Booking.ends_at - Booking.starts_at)), 0) / 3600.0
    room_rows = (
        await session.execute(
            select(Room.name, Zone.name, func.count(Booking.id), hours_expr)
            .select_from(Booking)
            .join(Room, Booking.room_id == Room.id)
            .join(Zone, Room.zone_id == Zone.id)
            .where(*f)
            .group_by(Room.name, Zone.name)
            .order_by(func.count(Booking.id).desc(), hours_expr.desc())
            .limit(6)
        )
    ).all()
    top_rooms = [RoomStat(room=r, zone=z, count=c, hours=round(float(h), 1)) for r, z, c, h in room_rows]

    # Next approved events from now (operational "what's next", independent of the range).
    now = datetime.now(timezone.utc)
    upcoming_bookings = (
        await session.execute(
            select(Booking)
            .options(selectinload(Booking.room).selectinload(Room.zone))
            .where(Booking.status == BookingStatus.approved, Booking.starts_at >= now)
            .order_by(Booking.starts_at.asc())
            .limit(6)
        )
    ).scalars().all()
    upcoming = [
        UpcomingItem(
            id=b.id,
            event_name=b.event_name,
            room=b.room.name if b.room else "—",
            zone=b.room.zone.name if b.room and b.room.zone else "—",
            starts_at=b.starts_at,
            ends_at=b.ends_at,
            attendees=b.attendees,
            is_urgent=b.is_urgent,
        )
        for b in upcoming_bookings
    ]

    return DashboardSummary(
        date_from=date_from,
        date_to=date_to,
        total=total,
        by_status=by_status,
        urgent=urgent,
        total_attendees=attendees_sum,
        coffee_breaks=coffee_count,
        coffee_headcount=coffee_head,
        avg_rating=round(float(avg_rating), 2) if avg_rating is not None else None,
        feedback_count=feedback_count,
        avg_room_rating=round(float(avg_room), 2) if avg_room is not None else None,
        avg_service_rating=round(float(avg_service), 2) if avg_service is not None else None,
        avg_props_rating=round(float(avg_props), 2) if avg_props is not None else None,
        completion_rate=completion_rate,
        approval_rate=approval_rate,
        avg_lead_hours=round(float(avg_lead), 1) if avg_lead is not None else None,
        active_rooms=active_rooms,
        active_companies=active_companies,
        by_zone=by_zone,
        top_rooms=top_rooms,
        top_companies=top_companies,
        by_struct=by_struct,
        upcoming=upcoming,
    )
