from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_admin, current_user
from app.db import get_session
from app.models import ChatMessage
from app.schemas import ChatMessageOut, ChatSendIn
from app.services.bookings import audit
from app.telegram import esc, send_text

router = APIRouter(prefix="/chat", tags=["chat"])


@router.get("/{telegram_id}", response_model=list[ChatMessageOut])
async def history(
    telegram_id: int,
    after: int = 0,
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ChatMessage]:
    stmt = select(ChatMessage).where(ChatMessage.telegram_id == telegram_id)
    if after:
        stmt = stmt.where(ChatMessage.id > after)
    stmt = stmt.order_by(ChatMessage.created_at, ChatMessage.id)
    return list((await session.execute(stmt)).scalars().all())


@router.post("/{telegram_id}", response_model=ChatMessageOut, status_code=201)
async def send(
    telegram_id: int,
    payload: ChatSendIn,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> ChatMessage:
    msg = ChatMessage(
        telegram_id=telegram_id,
        from_admin=True,
        admin_telegram_id=admin_id,
        text=payload.text,
    )
    session.add(msg)
    await session.flush()
    # target_id is int32; telegram ids exceed it, so keep the id in the payload.
    snippet = payload.text if len(payload.text) <= 60 else payload.text[:57] + "…"
    await audit(session, admin_id, "chat.send", "chat", None, f"заказчику {telegram_id}: «{snippet}»")
    await session.commit()
    await session.refresh(msg)
    await send_text(telegram_id, f"Администратор: {esc(payload.text)}")
    return msg
