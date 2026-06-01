from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_session
from app.models import LoginCode
from app.schemas import AuthRequest, AuthToken, AuthVerify
from app.security import create_jwt, generate_login_code, hash_code, verify_code
from app.services.access import resolve_role
from app.services.bookings import audit
from app.services.ratelimit import allow
from app.services.users import fetch_and_cache
from app.telegram import send_text

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/request-code", status_code=204)
async def request_code(payload: AuthRequest, session: AsyncSession = Depends(get_session)) -> None:
    # Always respond 204 regardless of whether the ID has access — never reveal which
    # Telegram IDs are admins/viewers, and throttle to avoid spamming with code DMs.
    if await resolve_role(session, payload.telegram_id) is None:
        return
    # Max 3 code requests per 10 minutes per ID; silently drop beyond that.
    if not allow(f"reqcode:{payload.telegram_id}", limit=3, window_seconds=600):
        return

    code = generate_login_code()
    code_hash = hash_code(code)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.login_code_ttl_seconds)

    await session.execute(delete(LoginCode).where(LoginCode.telegram_id == payload.telegram_id))
    session.add(LoginCode(telegram_id=payload.telegram_id, code_hash=code_hash, expires_at=expires_at))
    # Cache the admin's Telegram profile so the panel can show their name, not the ID.
    await fetch_and_cache(session, payload.telegram_id)
    await session.commit()

    await send_text(
        payload.telegram_id,
        f"Ваш код для входа в панель администратора: <b>{code}</b>\n"
        f"Действует {settings.login_code_ttl_seconds // 60} минут.",
    )


@router.post("/verify-code", response_model=AuthToken)
async def verify_code_endpoint(
    payload: AuthVerify, session: AsyncSession = Depends(get_session)
) -> AuthToken:
    if not allow(f"verify:{payload.telegram_id}", limit=10, window_seconds=600):
        raise HTTPException(status_code=429, detail="слишком много попыток, попробуйте позже")
    stmt = select(LoginCode).where(LoginCode.telegram_id == payload.telegram_id)
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=400, detail="код не запрошен")
    if row.expires_at < datetime.now(timezone.utc):
        await session.delete(row)
        await session.commit()
        raise HTTPException(status_code=400, detail="код истёк")
    if row.attempts >= 5:
        raise HTTPException(status_code=429, detail="слишком много попыток")
    if not verify_code(payload.code, row.code_hash):
        row.attempts += 1
        await session.commit()
        raise HTTPException(status_code=400, detail="неверный код")

    role = await resolve_role(session, payload.telegram_id)
    if role is None:
        # Access revoked between requesting and verifying the code.
        raise HTTPException(status_code=403, detail="нет доступа к панели")

    await session.delete(row)
    user = await fetch_and_cache(session, payload.telegram_id)
    await audit(session, payload.telegram_id, "auth.login", None, None, f"вход в панель ({role})")
    await session.commit()

    name = user.display_name if user is not None else f"ID {payload.telegram_id}"
    token, expires_at = create_jwt(payload.telegram_id, role)
    return AuthToken(
        token=token, telegram_id=payload.telegram_id, name=name, role=role, expires_at=expires_at
    )
