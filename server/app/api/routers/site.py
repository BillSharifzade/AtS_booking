"""Public website content (browser client) + its admin editor.

The browser booking flow opens on a landing page whose content is managed by
admins in the panel. GET is public (the landing is shown before any auth); PUT is
admin-only. Content is stored as a single JSON document in ``site_content`` under
the key ``landing`` — falling back to :data:`DEFAULT_LANDING` until an admin saves.
"""
import base64
import binascii
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_admin
from app.db import get_session
from app.models import CalendarEvent, SiteContent
from app.schemas import (
    CalendarEventOut,
    CalendarImport,
    CalendarImportResult,
    LandingContent,
    LandingEcosystemItem,
    LandingSocials,
    LandingStat,
)
from app.services.bookings import audit
from app.services.calendar_import import parse_calendar_xlsx

router = APIRouter(prefix="/site", tags=["site"])

LANDING_KEY = "landing"

MAX_XLSX_BYTES = 8 * 1024 * 1024

_RU_MONTHS = [
    "", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]

# Seed content (the AtS ecosystem copy). Used until an admin saves an override.
DEFAULT_LANDING = LandingContent(
    hero_title="Экосистема AtS",
    hero_subtitle="Пространство для обучения, развития и мероприятий — забронируйте зал для вашего события.",
    cta_label="Забронировать",
    ecosystem=[
        LandingEcosystemItem(number="01", title="Тренинг центр «AtS»",
                             subtitle="Центр личностного и профессионального развития."),
        LandingEcosystemItem(number="02", title="ДИРЦ «AtS Gen»",
                             subtitle="Детский интеллектуально развивающий центр."),
        LandingEcosystemItem(number="03", title="Book Space «AtS»",
                             subtitle="Закрытый книжный клуб."),
    ],
    features=["Геймификация занятий", "Прокачка скиллов", "Индивидуальный подход"],
    stats=[
        LandingStat(value="1000+", label="проведённых занятий"),
        LandingStat(value="6k+", label="участников"),
        LandingStat(value="14", label="компаний"),
        LandingStat(value="500+", label="мероприятий «AtS»"),
    ],
    phone="+992 98 620 6262",
    email="info@ats.tj",
    socials=LandingSocials(
        instagram="https://www.instagram.com/ats_trainingcenter/",
        facebook="https://www.facebook.com/AtS.tjk",
        linkedin="https://www.linkedin.com/company/training-center-ats/",
        telegram="https://t.me/TreningcentreAtS",
    ),
)


async def _load_landing(session: AsyncSession) -> LandingContent:
    row = await session.get(SiteContent, LANDING_KEY)
    if row is None:
        return DEFAULT_LANDING
    try:
        return LandingContent.model_validate(json.loads(row.value))
    except (ValueError, TypeError):
        # Corrupt/legacy JSON — fall back to defaults rather than 500.
        return DEFAULT_LANDING


@router.get("/landing", response_model=LandingContent)
async def get_landing(session: AsyncSession = Depends(get_session)) -> LandingContent:
    """Public: the landing content shown before the booking flow (browser client)."""
    return await _load_landing(session)


@router.put("/landing", response_model=LandingContent)
async def update_landing(
    payload: LandingContent,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> LandingContent:
    """Admin: replace the landing content."""
    value = json.dumps(payload.model_dump(), ensure_ascii=False)
    row = await session.get(SiteContent, LANDING_KEY)
    if row is None:
        session.add(SiteContent(key=LANDING_KEY, value=value))
    else:
        row.value = value
    await audit(session, admin_id, "site.landing.update", "site_content", None, LANDING_KEY)
    await session.commit()
    return payload


# ---- Events calendar ----

async def _all_events(session: AsyncSession) -> list[CalendarEvent]:
    return list(
        (
            await session.execute(
                select(CalendarEvent).order_by(
                    CalendarEvent.event_date,
                    CalendarEvent.sort_order,
                    CalendarEvent.id,
                )
            )
        ).scalars().all()
    )


@router.get("/events", response_model=list[CalendarEventOut])
async def list_events(session: AsyncSession = Depends(get_session)) -> list[CalendarEvent]:
    """Public: all calendar events (landing page groups them by month/day)."""
    return await _all_events(session)


@router.post("/events/import", response_model=CalendarImportResult)
async def import_events(
    payload: CalendarImport,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> CalendarImportResult:
    """Admin: replace the whole events calendar from an uploaded xlsx (base64)."""
    try:
        raw = base64.b64decode(payload.data, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "Повреждённый файл.")
    if len(raw) > MAX_XLSX_BYTES:
        raise HTTPException(400, "Файл больше 8 МБ.")

    try:
        parsed = parse_calendar_xlsx(raw)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if not parsed:
        raise HTTPException(
            400,
            "В файле не найдено мероприятий. Проверьте, что это календарь по шаблону "
            "(колонки: Дата, Зал, Время, Мероприятие, …).",
        )

    # Replace-all: the uploaded file is the authoritative calendar.
    await session.execute(delete(CalendarEvent))
    session.add_all([CalendarEvent(**e) for e in parsed])
    await audit(
        session, admin_id, "site.events.import", "calendar_events", None,
        f"{payload.filename or 'xlsx'}: {len(parsed)}",
    )
    await session.commit()

    events = await _all_events(session)
    months = sorted({(e.event_date.year, e.event_date.month) for e in events})
    return CalendarImportResult(
        imported=len(events),
        months=[f"{_RU_MONTHS[m]} {y}" for y, m in months],
        events=[CalendarEventOut.model_validate(e) for e in events],
    )


@router.delete("/events", status_code=204)
async def clear_events(
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Admin: remove all calendar events."""
    await session.execute(delete(CalendarEvent))
    await audit(session, admin_id, "site.events.clear", "calendar_events", None, None)
    await session.commit()
