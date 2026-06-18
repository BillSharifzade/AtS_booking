from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.security import InitDataError, decode_jwt, guest_user, validate_init_data
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
    """Authenticate a mini app client. Two self-serve modes (NOT panel users):

    - Inside Telegram: ``Authorization: tma <initData>`` — verified Telegram user.
    - Plain browser:   ``Authorization: guest <token>`` — a per-browser guest
      identity (stable negative id), so the app also works outside Telegram.

    Returns a user dict (id / first_name / last_name / username [/ is_guest]).
    """
    if authorization.startswith("tma "):
        init_data = authorization.removeprefix("tma ").strip()
        try:
            return validate_init_data(init_data)
        except InitDataError:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid init data")
    if authorization.startswith("guest "):
        token = authorization.removeprefix("guest ").strip()
        try:
            return guest_user(token)
        except InitDataError:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid guest token")
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing init data")
