import base64
import binascii

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_admin, current_user
from app.db import get_session
from app.models import Booking, Company
from app.schemas import CompanyCreate, CompanyOut, CompanyUpdate
from app.services.bookings import audit

router = APIRouter(prefix="/companies", tags=["companies"])

MAX_LOGO_BYTES = 3 * 1024 * 1024


def _decode_logo(data_b64: str) -> bytes:
    try:
        raw = base64.b64decode(data_b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "Повреждённые данные логотипа.")
    if len(raw) > MAX_LOGO_BYTES:
        raise HTTPException(400, "Логотип больше 3 МБ.")
    return raw


@router.get("", response_model=list[CompanyOut])
async def list_companies(
    active_only: bool = False,
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[Company]:
    stmt = select(Company).order_by(Company.name)
    if active_only:
        stmt = stmt.where(Company.is_active.is_(True))
    return list((await session.execute(stmt)).scalars().all())


@router.post("", response_model=CompanyOut, status_code=201)
async def create_company(
    payload: CompanyCreate,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> Company:
    exists = (
        await session.execute(select(Company.id).where(func.lower(Company.name) == payload.name.lower()))
    ).first()
    if exists:
        raise HTTPException(409, "Компания с таким названием уже существует.")
    company = Company(
        name=payload.name,
        website_url=payload.website_url,
        is_active=payload.is_active,
    )
    if payload.logo_data:
        company.logo_data = _decode_logo(payload.logo_data)
        company.logo_content_type = payload.logo_content_type or "image/png"
    session.add(company)
    await session.flush()
    await audit(session, admin_id, "company.create", "company", company.id, f"«{company.name}»")
    await session.commit()
    await session.refresh(company)
    return company


@router.patch("/{company_id}", response_model=CompanyOut)
async def update_company(
    company_id: int,
    payload: CompanyUpdate,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> Company:
    company = await session.get(Company, company_id)
    if company is None:
        raise HTTPException(404, "Компания не найдена.")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        dup = (
            await session.execute(
                select(Company.id).where(
                    func.lower(Company.name) == data["name"].lower(), Company.id != company_id
                )
            )
        ).first()
        if dup:
            raise HTTPException(409, "Компания с таким названием уже существует.")
        company.name = data["name"]
    if "website_url" in data:
        company.website_url = data["website_url"]
    if "is_active" in data and data["is_active"] is not None:
        company.is_active = data["is_active"]
    if "logo_data" in data:
        if data["logo_data"]:
            company.logo_data = _decode_logo(data["logo_data"])
            company.logo_content_type = data.get("logo_content_type") or company.logo_content_type or "image/png"
        else:
            company.logo_data = None
            company.logo_content_type = None
    await audit(session, admin_id, "company.update", "company", company.id, f"«{company.name}»")
    await session.commit()
    await session.refresh(company)
    return company


@router.delete("/{company_id}", status_code=204)
async def delete_company(
    company_id: int,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    company = await session.get(Company, company_id)
    if company is None:
        raise HTTPException(404, "Компания не найдена.")
    # Detach existing bookings (their free-text `company` label is preserved) so the
    # FK constraint doesn't block deletion.
    await session.execute(
        update(Booking).where(Booking.company_id == company_id).values(company_id=None)
    )
    await session.delete(company)
    await audit(session, admin_id, "company.delete", "company", company_id, f"«{company.name}»")
    await session.commit()


@router.get("/{company_id}/logo")
async def get_company_logo(
    company_id: int,
    session: AsyncSession = Depends(get_session),
) -> Response:
    # Public: company logos are shown to clients in the booking mini app/bot.
    company = await session.get(Company, company_id)
    if company is None or company.logo_data is None:
        raise HTTPException(404, "Логотип не найден.")
    return Response(
        content=company.logo_data,
        media_type=company.logo_content_type or "image/png",
        headers={"Cache-Control": "max-age=3600", "X-Content-Type-Options": "nosniff"},
    )
