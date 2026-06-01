from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user
from app.db import get_session
from app.schemas import UserOut
from app.services.users import resolve_many

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserOut])
async def resolve_users(
    ids: str = Query("", description="Comma-separated Telegram IDs"),
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[UserOut]:
    id_list = [int(x) for x in ids.split(",") if x.strip().lstrip("-").isdigit()]
    resolved = await resolve_many(session, id_list)
    out: list[UserOut] = []
    for tg_id in dict.fromkeys(id_list):
        user = resolved.get(tg_id)
        out.append(
            UserOut(
                telegram_id=tg_id,
                name=user.real_name if user is not None else None,
                username=user.username if user is not None else None,
            )
        )
    return out
