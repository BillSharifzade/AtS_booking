from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_admin, current_user
from app.db import get_session
from app.models import Prop
from app.schemas import PropCreate, PropOut, PropUpdate
from app.services import bookings as svc
from app.services.bookings import audit

router = APIRouter(prefix="/props", tags=["props"])


@router.get("", response_model=list[PropOut])
async def list_props(
    active_only: bool = False,
    kind: str | None = None,
    starts_at: datetime | None = Query(None, description="Event start — fills `available` for those hours"),
    ends_at: datetime | None = Query(None, description="Event end — fills `available` for those hours"),
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[PropOut]:
    stmt = select(Prop).order_by(Prop.kind, Prop.name)
    if active_only:
        stmt = stmt.where(Prop.is_active.is_(True))
    if kind is not None:
        stmt = stmt.where(Prop.kind == kind)
    props = list((await session.execute(stmt)).scalars().all())
    # Stock is held only for the hours of an event, so `available` is meaningful only
    # once a slot is known (the panel's booking form passes one). Plain inventory
    # listings leave it None and show the total `amount`.
    if starts_at is None or ends_at is None or ends_at <= starts_at:
        return [PropOut.model_validate(p) for p in props]
    committed = await svc.props_committed(session, starts_at, ends_at)
    out: list[PropOut] = []
    for p in props:
        po = PropOut.model_validate(p)
        po.available = max(p.amount - committed.get(p.id, 0), 0)
        out.append(po)
    return out


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
