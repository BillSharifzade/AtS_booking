from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_admin
from app.config import settings
from app.db import get_session
from app.schemas import PanelUserCreate, PanelUserOut
from app.services.access import (
    add_panel_user,
    get_panel_users,
    remove_panel_user,
    resolve_role,
)
from app.services.bookings import audit
from app.services.users import fetch_and_cache

router = APIRouter(prefix="/panel-users", tags=["panel-users"])


@router.get("", response_model=list[PanelUserOut])
async def list_panel_users(
    _: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
):
    return await get_panel_users(session)


@router.post("", response_model=PanelUserOut, status_code=201)
async def create_panel_user(
    payload: PanelUserCreate,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
):
    # Panel admins (department leads as viewers) are created here; env admins stay superadmins.
    if payload.telegram_id in settings.admin_telegram_ids:
        raise HTTPException(409, "Этот ID уже является администратором.")
    if await resolve_role(session, payload.telegram_id) is not None:
        raise HTTPException(409, "Пользователь уже добавлен.")
    user = await add_panel_user(session, payload.telegram_id, payload.role, payload.name, admin_id)
    # Cache the Telegram profile so the panel can show a name (best-effort).
    await fetch_and_cache(session, payload.telegram_id)
    label = "администратор" if payload.role == "admin" else "наблюдатель"
    await audit(
        session, admin_id, "panel_user.add", "panel_user", None,
        f"{label} {payload.name or payload.telegram_id} ({payload.telegram_id})",
    )
    await session.commit()
    await session.refresh(user)
    return user


@router.delete("/{telegram_id}", status_code=204)
async def delete_panel_user(
    telegram_id: int,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
):
    if not await remove_panel_user(session, telegram_id):
        raise HTTPException(404, "Пользователь не найден.")
    await audit(session, admin_id, "panel_user.remove", "panel_user", None, f"пользователь {telegram_id}")
    await session.commit()
