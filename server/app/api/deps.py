from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.security import decode_jwt
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
