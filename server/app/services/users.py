from __future__ import annotations

import logging

from aiogram.exceptions import TelegramAPIError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import TgUser
from app.telegram import get_bot

log = logging.getLogger(__name__)


async def upsert_user(
    session: AsyncSession,
    telegram_id: int,
    *,
    first_name: str | None = None,
    last_name: str | None = None,
    username: str | None = None,
) -> TgUser:
    user = await session.get(TgUser, telegram_id)
    if user is None:
        user = TgUser(telegram_id=telegram_id)
        session.add(user)
    # Only overwrite with non-empty values so a partial source can't wipe known data.
    if first_name is not None:
        user.first_name = first_name
    if last_name is not None:
        user.last_name = last_name
    if username is not None:
        user.username = username
    return user


async def fetch_and_cache(session: AsyncSession, telegram_id: int) -> TgUser | None:
    """Best-effort: ask Telegram for the chat profile and cache it. Returns None on failure."""
    try:
        chat = await get_bot().get_chat(telegram_id)
    except TelegramAPIError:
        log.info("get_chat failed for %s (user may not have started the bot)", telegram_id)
        return None
    return await upsert_user(
        session,
        telegram_id,
        first_name=chat.first_name,
        last_name=chat.last_name,
        username=chat.username,
    )


async def resolve_many(session: AsyncSession, ids: list[int]) -> dict[int, TgUser]:
    """Resolve a batch of telegram IDs to cached profiles, fetching misses from Telegram."""
    if not ids:
        return {}
    unique = list(dict.fromkeys(ids))
    rows = (
        await session.execute(select(TgUser).where(TgUser.telegram_id.in_(unique)))
    ).scalars().all()
    found = {u.telegram_id: u for u in rows}

    missing = [i for i in unique if i not in found]
    fetched_any = False
    for tg_id in missing:
        user = await fetch_and_cache(session, tg_id)
        if user is not None:
            found[tg_id] = user
            fetched_any = True
    if fetched_any:
        await session.commit()
    return found
