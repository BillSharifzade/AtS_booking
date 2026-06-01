from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot import texts
from app.db import SessionLocal
from app.models import BotText

log = logging.getLogger(__name__)


async def load_overrides(session: AsyncSession) -> dict[str, str]:
    rows = (await session.execute(select(BotText))).scalars().all()
    return {r.key: r.value for r in rows}


async def refresh_cache() -> None:
    """Reload bot-text overrides from the DB into the in-memory cache (bot process)."""
    async with SessionLocal() as session:
        overrides = await load_overrides(session)
    texts.set_overrides(overrides)
    log.debug("bot text overrides refreshed: %d active", len(overrides))
