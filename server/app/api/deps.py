from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.security import InitDataError, decode_jwt, validate_init_data
from app.services.access import ADMIN, resolve_role


async def current_user(
    authorization: str = Header(default=""),
    session: AsyncSession = Depends(get_session),
) -> tuple[int, str]:
    """Authenticate the bearer token and resolve the caller's *current* role from the
    source of truth (env admins + panel_users). Used by read-only endpoints — both
    admins and viewers pass. Returns (telegram_id, role)."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing token")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        tg_id = decode_jwt(token)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")
    role = await resolve_role(session, tg_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="no panel access")
    return tg_id, role


async def current_admin(user: tuple[int, str] = Depends(current_user)) -> int:
    """Require an admin. Used by every mutating endpoint; viewers get 403."""
    tg_id, role = user
    if role != ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="требуются права администратора")
    return tg_id


async def current_customer(authorization: str = Header(default="")) -> dict:
    """Authenticate a Telegram Mini App client via its signed ``initData``.

    The mini app sends ``Authorization: tma <initData>`` (Telegram's convention).
    Returns the verified Telegram user dict (id / first_name / last_name / username).
    Customers are NOT panel users — this is a separate, self-serve auth path.
    """
    if not authorization.startswith("tma "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing init data")
    init_data = authorization.removeprefix("tma ").strip()
    try:
        return validate_init_data(init_data)
    except InitDataError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid init data")
