"""Admin Telegram-notification preferences.

Which events reach administrators' DMs is configurable from the panel («Настройки →
Уведомления») instead of being hardwired: the default is *only new requests* (and
optionally only the urgent ones), so routine approve/reject/complete/archive traffic
no longer floods every admin.

Stored as one JSON document in the generic ``site_content`` key/value table (key
``notify_prefs``), so no migration is needed and the shape can grow.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal
from app.models import SiteContent
from app.schemas import NotifyPrefs

log = logging.getLogger(__name__)

PREFS_KEY = "notify_prefs"


async def load_prefs(session: AsyncSession) -> NotifyPrefs:
    """Current preferences, falling back to the defaults until an admin saves."""
    row = await session.get(SiteContent, PREFS_KEY)
    if row is None:
        return NotifyPrefs()
    try:
        return NotifyPrefs.model_validate(json.loads(row.value))
    except (ValueError, TypeError):
        # Corrupt/legacy JSON — defaults rather than a 500 (or a dropped notification).
        return NotifyPrefs()


async def save_prefs(session: AsyncSession, prefs: NotifyPrefs) -> None:
    row = await session.get(SiteContent, PREFS_KEY)
    payload = json.dumps(prefs.model_dump(), ensure_ascii=False)
    if row is None:
        session.add(SiteContent(key=PREFS_KEY, value=payload))
    else:
        row.value = payload


async def current_prefs() -> NotifyPrefs:
    """Preferences for senders that run outside a request (notifications, bot).

    Opens its own short-lived session; never raises — a lookup failure must not stop a
    notification, so it falls back to the defaults."""
    try:
        async with SessionLocal() as session:
            return await load_prefs(session)
    except Exception:  # pragma: no cover - defensive: never drop a notice
        log.exception("failed to load notification preferences; using defaults")
        return NotifyPrefs()
