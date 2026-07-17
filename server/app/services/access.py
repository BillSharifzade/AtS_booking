"""Role resolution & panel-user management (Module §2.3, §5 RBAC).

Source of truth for "who can use the panel and as what role":
  - env ``ADMIN_TELEGRAM_IDS`` → permanent ``admin`` (superadmins, never stored in DB),
  - ``panel_users`` rows  → their stored role (``admin`` or ``viewer``).
Panel-managed admins have the same rights as env superadmins; the only difference is
that they can be removed here. Role is resolved fresh on every request, so changing or
removing a panel user takes effect immediately (not only when their token expires)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import PanelUser

ADMIN = "admin"
VIEWER = "viewer"


async def resolve_role(session: AsyncSession, telegram_id: int) -> str | None:
    """Return the effective role for an ID, or None if it has no panel access."""
    if telegram_id in settings.admin_telegram_ids:
        return ADMIN
    row = await session.get(PanelUser, telegram_id)
    return row.role if row is not None else None


async def all_admin_ids(session: AsyncSession) -> set[int]:
    """Every Telegram id that should receive admin notifications: the env superadmins
    plus any panel_users stored with the ``admin`` role. Viewers are read-only and are
    deliberately excluded."""
    ids = set(settings.admin_telegram_ids)
    rows = (
        await session.execute(select(PanelUser.telegram_id).where(PanelUser.role == ADMIN))
    ).scalars().all()
    ids.update(rows)
    return ids


async def get_panel_users(session: AsyncSession) -> list[PanelUser]:
    return list(
        (await session.execute(select(PanelUser).order_by(PanelUser.created_at))).scalars().all()
    )


async def add_panel_user(
    session: AsyncSession, telegram_id: int, role: str, name: str | None, added_by: int
) -> PanelUser:
    user = PanelUser(telegram_id=telegram_id, role=role, name=name, added_by=added_by)
    session.add(user)
    return user


async def remove_panel_user(session: AsyncSession, telegram_id: int) -> bool:
    user = await session.get(PanelUser, telegram_id)
    if user is None:
        return False
    await session.delete(user)
    return True
