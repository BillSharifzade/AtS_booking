from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_admin, current_user
from app.db import get_session
from app.models import Booking, BookingStatus, ChatMessage
from app.schemas import NotificationsOut, NotifyPrefs
from app.services.bookings import audit
from app.services.notify_prefs import load_prefs, save_prefs

router = APIRouter(prefix="/notifications", tags=["notifications"])


# NB: declared before the bare "" route only for readability — paths don't collide.
@router.get("/settings", response_model=NotifyPrefs)
async def get_settings(
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> NotifyPrefs:
    """What administrators currently receive in Telegram."""
    return await load_prefs(session)


@router.put("/settings", response_model=NotifyPrefs)
async def update_settings(
    payload: NotifyPrefs,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> NotifyPrefs:
    await save_prefs(session, payload)
    on = [k for k, v in payload.model_dump().items() if v]
    await audit(session, admin_id, "notify.settings", "settings", None, ", ".join(on) or "всё выключено")
    await session.commit()
    return payload


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
