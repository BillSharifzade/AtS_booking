from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_admin, current_user
from app.db import get_session
from app.models import Prop
from app.schemas import PropCreate, PropOut, PropUpdate
from app.services.bookings import audit

router = APIRouter(prefix="/props", tags=["props"])


@router.get("", response_model=list[PropOut])
async def list_props(
    active_only: bool = False,
    kind: str | None = None,
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[Prop]:
    stmt = select(Prop).order_by(Prop.kind, Prop.name)
    if active_only:
        stmt = stmt.where(Prop.is_active.is_(True))
    if kind is not None:
        stmt = stmt.where(Prop.kind == kind)
    return list((await session.execute(stmt)).scalars().all())


@router.post("", response_model=PropOut, status_code=201)
async def create_prop(
    payload: PropCreate,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> Prop:
    prop = Prop(**payload.model_dump())
    session.add(prop)
    await session.flush()
    await audit(session, admin_id, "prop.create", "prop", prop.id, f"«{prop.name}» ({prop.kind}), {prop.amount}")
    await session.commit()
    await session.refresh(prop)
    return prop


@router.patch("/{prop_id}", response_model=PropOut)
async def update_prop(
    prop_id: int,
    payload: PropUpdate,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> Prop:
    prop = await session.get(Prop, prop_id)
    if prop is None:
        raise HTTPException(404, "Оборудование не найдено.")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(prop, key, value)
    await audit(session, admin_id, "prop.update", "prop", prop.id, f"«{prop.name}»")
    await session.commit()
    await session.refresh(prop)
    return prop


@router.delete("/{prop_id}", status_code=204)
async def delete_prop(
    prop_id: int,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    prop = await session.get(Prop, prop_id)
    if prop is None:
        raise HTTPException(404, "Оборудование не найдено.")
    await session.delete(prop)
    await audit(session, admin_id, "prop.delete", "prop", prop_id, f"«{prop.name}»")
    await session.commit()
