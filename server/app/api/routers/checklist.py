from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_admin, current_user
from app.db import get_session
from app.models import ChecklistTemplateItem
from app.schemas import ChecklistItemCreate, ChecklistItemOut, ChecklistItemUpdate
from app.services.bookings import audit

router = APIRouter(prefix="/checklist-template", tags=["checklist"])


@router.get("", response_model=list[ChecklistItemOut])
async def list_items(
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ChecklistTemplateItem]:
    stmt = select(ChecklistTemplateItem).order_by(
        ChecklistTemplateItem.sort_order, ChecklistTemplateItem.id
    )
    return list((await session.execute(stmt)).scalars().all())


@router.post("", response_model=ChecklistItemOut, status_code=201)
async def create_item(
    payload: ChecklistItemCreate,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> ChecklistTemplateItem:
    next_order = (
        await session.execute(select(func.coalesce(func.max(ChecklistTemplateItem.sort_order), -1)))
    ).scalar_one() + 1
    item = ChecklistTemplateItem(text=payload.text, sort_order=next_order)
    session.add(item)
    await session.flush()
    await audit(session, admin_id, "checklist.create", "checklist_item", item.id, payload.text)
    await session.commit()
    await session.refresh(item)
    return item


@router.patch("/{item_id}", response_model=ChecklistItemOut)
async def update_item(
    item_id: int,
    payload: ChecklistItemUpdate,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> ChecklistTemplateItem:
    item = await session.get(ChecklistTemplateItem, item_id)
    if item is None:
        raise HTTPException(404, "Пункт не найден.")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await audit(session, admin_id, "checklist.update", "checklist_item", item.id, item.text)
    await session.commit()
    await session.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
async def delete_item(
    item_id: int,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    item = await session.get(ChecklistTemplateItem, item_id)
    if item is None:
        raise HTTPException(404, "Пункт не найден.")
    await session.delete(item)
    await audit(session, admin_id, "checklist.delete", "checklist_item", item_id, item.text)
    await session.commit()
