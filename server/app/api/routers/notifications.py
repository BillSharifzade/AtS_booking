from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user
from app.db import get_session
from app.models import Booking, BookingStatus, ChatMessage
from app.schemas import NotificationsOut

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationsOut)
async def summary(
    after_chat_id: int = 0,
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationsOut:
    pending = (
        await session.execute(
            select(func.count(Booking.id)).where(Booking.status == BookingStatus.new)
        )
    ).scalar_one()
    latest_booking_id = (await session.execute(select(func.coalesce(func.max(Booking.id), 0)))).scalar_one()
    latest_chat_id = (
        await session.execute(
            select(func.coalesce(func.max(ChatMessage.id), 0)).where(ChatMessage.from_admin.is_(False))
        )
    ).scalar_one()

    rows = (
        await session.execute(
            select(ChatMessage.telegram_id, func.count(ChatMessage.id))
            .where(ChatMessage.from_admin.is_(False), ChatMessage.id > after_chat_id)
            .group_by(ChatMessage.telegram_id)
        )
    ).all()
    unread_by_user = {str(tg): cnt for tg, cnt in rows}

    return NotificationsOut(
        pending_bookings=pending,
        latest_booking_id=latest_booking_id,
        latest_chat_id=latest_chat_id,
        new_messages=sum(unread_by_user.values()),
        unread_by_user=unread_by_user,
    )
