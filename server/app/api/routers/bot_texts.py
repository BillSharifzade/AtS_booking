import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_admin, current_user
from app.bot import texts
from app.db import get_session
from app.models import BotText
from app.schemas import BotTextOut, BotTextUpdate
from app.services.bookings import audit
from app.services.bot_texts import load_overrides

router = APIRouter(prefix="/bot-texts", tags=["bot-texts"])


def _to_out(key: str, override: str | None) -> BotTextOut:
    return BotTextOut(
        key=key,
        label=texts.LABELS[key],
        group=texts.GROUPS[key],
        default=texts.DEFAULTS[key],
        value=override if override is not None else texts.DEFAULTS[key],
        placeholders=texts.placeholders(key),
        is_overridden=override is not None,
    )


@router.get("", response_model=list[BotTextOut])
async def list_texts(
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[BotTextOut]:
    overrides = await load_overrides(session)
    return [_to_out(key, overrides.get(key)) for key in texts.ORDER]


@router.put("/{key}", response_model=BotTextOut)
async def update_text(
    key: str,
    payload: BotTextUpdate,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> BotTextOut:
    if key not in texts.DEFAULTS:
        raise HTTPException(404, "Неизвестный ключ текста.")

    allowed = set(texts.placeholders(key))
    used = set(re.findall(r"{(\w+)}", payload.value))
    extra = used - allowed
    if extra:
        raise HTTPException(
            400,
            "Недопустимые подстановки: "
            + ", ".join("{" + p + "}" for p in sorted(extra))
            + (". Доступны: " + ", ".join("{" + p + "}" for p in sorted(allowed)) if allowed else "."),
        )

    row = await session.get(BotText, key)
    if payload.value == texts.DEFAULTS[key]:
        # Saving the default = clear the override.
        if row is not None:
            await session.delete(row)
        override = None
    else:
        if row is None:
            row = BotText(key=key, value=payload.value)
            session.add(row)
        else:
            row.value = payload.value
        override = payload.value

    await audit(session, admin_id, "bottext.update", "bottext", None, texts.LABELS[key])
    await session.commit()
    return _to_out(key, override)
