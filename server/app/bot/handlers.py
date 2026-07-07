from __future__ import annotations

import calendar as _cal
from datetime import date, datetime, time, timedelta, timezone

from aiogram import F, Router
from aiogram.filters import Command, CommandStart, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
    KeyboardButton,
    CallbackQuery,
    WebAppInfo,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from aiogram.types import BufferedInputFile, InputMediaPhoto

from app.bot import texts as t
from app.config import local_now, settings
from app.db import SessionLocal
from app.models import Booking, BookingProp, ChatMessage, Feedback, Room, RoomImage
from app.services import availability as avail
from app.services import bookings as svc
from app.services.bookings import GRADES
from app.schemas import GRADES as GRADE_ORDER
from app.services.notifications import ROOM_STRUCT_LABELS, notify_new
from app.services.ratelimit import allow
from app.services.reports import build_bookings_workbook, report_filename
from app.services.users import upsert_user
from app.telegram import esc, get_bot, send_document, send_text

router = Router()


class Chat_FSM(StatesGroup):
    active = State()


class Feedback_FSM(StatesGroup):
    # After tapping a rating, the bot waits for an optional free-text comment.
    comment = State()


class Booking_FSM(StatesGroup):
    # Room-first flow: pick room -> attendees -> calendar -> start -> end -> details.
    # (Zones are an admin-only grouping and are never shown to customers.)
    room = State()
    attendees = State()
    calendar = State()
    pick_start = State()
    pick_end = State()
    company = State()
    name = State()
    phone = State()
    event_type = State()
    event_name = State()
    description = State()
    aim = State()
    grade = State()
    extra_services = State()
    coffee = State()
    coffee_count = State()
    coffee_type = State()
    coffee_other = State()
    foreign_guests = State()
    urgent = State()
    confirm = State()
    # Error-recovery: edit one field then return to confirm (data["mode"]=="edit").
    fix = State()
    edit_coffee = State()


def _yesno_kb() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text="да"), KeyboardButton(text="нет")]],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


def _grade_kb() -> ReplyKeyboardMarkup:
    # One grade per row — the labels are long enough to wrap awkwardly side by side.
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text=g)] for g in GRADE_ORDER],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


@router.message(CommandStart())
async def start(msg: Message) -> None:
    kb = None
    if settings.miniapp_url:
        # WebApp buttons require HTTPS and only work in private chats — /start is private.
        kb = InlineKeyboardMarkup(
            inline_keyboard=[[
                InlineKeyboardButton(
                    text="🗓 Открыть бронирование",
                    web_app=WebAppInfo(url=settings.miniapp_url),
                )
            ]]
        )
    await msg.answer(t.START, reply_markup=kb)


@router.message(Command("whoami"))
async def whoami(msg: Message) -> None:
    await msg.answer(f"Ваш Telegram ID: <code>{msg.from_user.id}</code>")


@router.message(Command("report"))
async def report(msg: Message, state: FSMContext) -> None:
    # Admin-only: on-demand Excel export of all booking history (Integration 4.2).
    if msg.from_user.id not in settings.admin_telegram_ids:
        await msg.answer("Эта команда доступна только администраторам.")
        return
    await state.clear()
    await msg.answer("Готовлю отчёт по бронированиям…", reply_markup=ReplyKeyboardRemove())
    async with SessionLocal() as session:
        data = await build_bookings_workbook(session)
    ok = await send_document(
        msg.chat.id, data, report_filename(), caption="Бронирования AtS — полная выгрузка."
    )
    if not ok:
        await msg.answer("Не удалось отправить файл отчёта. Попробуйте позже.")


@router.message(Command("cancel"))
async def cancel(msg: Message, state: FSMContext) -> None:
    await state.clear()
    await msg.answer(t.CANCELLED, reply_markup=ReplyKeyboardRemove())


@router.message(Command("chat"))
async def chat_start(msg: Message, state: FSMContext) -> None:
    await state.clear()  # leave any booking flow
    await state.set_state(Chat_FSM.active)
    await msg.answer(t.CHAT_START, reply_markup=ReplyKeyboardRemove())


@router.message(Command("stop"), Chat_FSM.active)
async def chat_stop(msg: Message, state: FSMContext) -> None:
    await state.clear()
    await msg.answer(t.CHAT_STOPPED)


async def _relay_to_admins(msg: Message) -> None:
    """Store an incoming chat message and notify all admins (they reply from the panel)."""
    text = (msg.text or "").strip()
    if not text:
        return
    # Throttle per user so the bot can't be used to flood admins. ~8 msgs/minute.
    if not allow(f"chatrelay:{msg.from_user.id}", limit=8, window_seconds=60):
        await msg.answer("Слишком много сообщений подряд. Подождите немного.")
        return
    async with SessionLocal() as session:
        session.add(ChatMessage(telegram_id=msg.from_user.id, from_admin=False, text=text))
        await upsert_user(
            session,
            msg.from_user.id,
            first_name=msg.from_user.first_name,
            last_name=msg.from_user.last_name,
            username=msg.from_user.username,
        )
        await session.commit()
    who = msg.from_user.full_name or (f"@{msg.from_user.username}" if msg.from_user.username else f"ID {msg.from_user.id}")
    for admin_id in settings.admin_telegram_ids:
        await send_text(admin_id, f"Сообщение от {esc(who)}: {esc(text)}\nОтветить можно в админ-панели.")


@router.message(Chat_FSM.active)
async def chat_relay(msg: Message, state: FSMContext) -> None:
    await _relay_to_admins(msg)


MONTHS_RU = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]
WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]


async def _bookable_rooms_list(session: AsyncSession) -> list[Room]:
    """Active, non-coffee rooms, smallest-sufficient capacity first (unknown last).
    Customers pick a room directly — zones are never surfaced."""
    rooms = (
        await session.execute(
            select(Room).where(Room.is_active.is_(True), Room.is_coffee_break.is_(False))
        )
    ).scalars().all()
    return sorted(rooms, key=svc._capacity_sort_key)


def _rooms_kb(rooms: list[Room]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=f"{r.name} · {r.capacity}", callback_data=f"room:{r.id}")]
            for r in rooms
        ]
    )


@router.message(Command("book"))
async def book_start(msg: Message, state: FSMContext) -> None:
    async with SessionLocal() as session:  # type: AsyncSession
        rooms = await _bookable_rooms_list(session)
    if not rooms:
        await msg.answer(t.NO_ROOMS)
        return
    await state.clear()
    await state.set_state(Booking_FSM.room)
    await state.update_data(mode="new")
    await msg.answer(t.PICK_ROOM, reply_markup=_rooms_kb(rooms))


@router.callback_query(Booking_FSM.room, F.data.startswith("room:"))
async def pick_room(cq: CallbackQuery, state: FSMContext) -> None:
    await state.update_data(room_id=int(cq.data.split(":")[1]))
    await cq.answer()
    data = await state.get_data()
    if data.get("mode") == "edit":
        await _show_calendar(cq.message, state)
    else:
        await state.set_state(Booking_FSM.attendees)
        await cq.message.answer(t.ENTER_ATTENDEES, reply_markup=ReplyKeyboardRemove())


@router.message(Booking_FSM.attendees)
async def get_attendees(msg: Message, state: FSMContext) -> None:
    try:
        n = int(msg.text.strip())
        if n <= 0:
            raise ValueError
    except ValueError:
        await msg.answer(t.INVALID_NUMBER)
        return
    await state.update_data(attendees=n)
    await _show_calendar(msg, state)


async def _calendar_markup(session: AsyncSession, room_id: int, attendees: int, year: int, month: int) -> InlineKeyboardMarkup:
    today = local_now().date()
    ndays = _cal.monthrange(year, month)[1]
    first = date(year, month, 1)
    avail_map = await avail.room_available_days(session, room_id, first, date(year, month, ndays), attendees)

    prev_y, prev_m = (year - 1, 12) if month == 1 else (year, month - 1)
    next_y, next_m = (year + 1, 1) if month == 12 else (year, month + 1)
    if (year, month) <= (today.year, today.month):
        left = InlineKeyboardButton(text=" ", callback_data="cal:x")
    else:
        left = InlineKeyboardButton(text="‹", callback_data=f"cal:nav:{prev_y:04d}-{prev_m:02d}")
    rows = [
        [left,
         InlineKeyboardButton(text=f"{MONTHS_RU[month - 1]} {year}", callback_data="cal:x"),
         InlineKeyboardButton(text="›", callback_data=f"cal:nav:{next_y:04d}-{next_m:02d}")],
        [InlineKeyboardButton(text=w, callback_data="cal:x") for w in WEEKDAYS_RU],
    ]
    week = [InlineKeyboardButton(text=" ", callback_data="cal:x") for _ in range(first.weekday())]
    for d in range(1, ndays + 1):
        cur = date(year, month, d)
        if avail_map.get(cur, False):
            week.append(InlineKeyboardButton(text=str(d), callback_data=f"cal:day:{cur.isoformat()}"))
        else:
            week.append(InlineKeyboardButton(text=f"·{d}", callback_data="cal:no"))
        if len(week) == 7:
            rows.append(week)
            week = []
    if week:
        while len(week) < 7:
            week.append(InlineKeyboardButton(text=" ", callback_data="cal:x"))
        rows.append(week)
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def _show_calendar(msg: Message, state: FSMContext) -> None:
    data = await state.get_data()
    today = local_now().date()
    year = int(data.get("cal_year", today.year))
    month = int(data.get("cal_month", today.month))
    async with SessionLocal() as session:
        kb = await _calendar_markup(session, data["room_id"], data["attendees"], year, month)
    await state.update_data(cal_year=year, cal_month=month)
    await state.set_state(Booking_FSM.calendar)
    await msg.answer(t.PICK_DATE, reply_markup=kb)


@router.callback_query(Booking_FSM.calendar, F.data.startswith("cal:"))
async def calendar_cb(cq: CallbackQuery, state: FSMContext) -> None:
    parts = cq.data.split(":", 2)
    kind = parts[1] if len(parts) > 1 else "x"
    if kind == "nav":
        year, month = (int(x) for x in parts[2].split("-"))
        await state.update_data(cal_year=year, cal_month=month)
        data = await state.get_data()
        async with SessionLocal() as session:
            kb = await _calendar_markup(session, data["room_id"], data["attendees"], year, month)
        try:
            await cq.message.edit_reply_markup(reply_markup=kb)
        except Exception:  # noqa: BLE001 - "message not modified" etc.
            pass
        await cq.answer()
    elif kind == "day":
        await state.update_data(bdate=parts[2])
        await cq.answer()
        await _show_starts(cq.message, state)
    elif kind == "no":
        await cq.answer("На этот день нет свободного времени", show_alert=False)
    else:
        await cq.answer()


@router.message(Booking_FSM.calendar)
async def calendar_text(msg: Message, state: FSMContext) -> None:
    await _show_calendar(msg, state)


def _times_kb(times: list[str], prefix: str) -> InlineKeyboardMarkup:
    rows: list[list[InlineKeyboardButton]] = []
    row: list[InlineKeyboardButton] = []
    for tm in times:
        row.append(InlineKeyboardButton(text=tm, callback_data=f"{prefix}:{tm}"))
        if len(row) == 4:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    return InlineKeyboardMarkup(inline_keyboard=rows)


def _gen_ends(start: str, max_end: str) -> list[str]:
    sh, sm = (int(x) for x in start.split(":"))
    eh, em = (int(x) for x in max_end.split(":"))
    cur = sh * 60 + sm + 30
    end = eh * 60 + em
    out: list[str] = []
    while cur <= end:
        out.append(f"{cur // 60:02d}:{cur % 60:02d}")
        cur += 30
    return out


async def _show_starts(msg: Message, state: FSMContext) -> None:
    data = await state.get_data()
    async with SessionLocal() as session:
        slots = await avail.room_day_slots(
            session, data["room_id"], date.fromisoformat(data["bdate"]), data["attendees"]
        )
    if not slots:
        await msg.answer(t.NO_SLOTS)
        await _show_calendar(msg, state)
        return
    slot_map = {s.strftime("%H:%M"): e.strftime("%H:%M") for s, e in slots}
    await state.update_data(slot_map=slot_map)
    await state.set_state(Booking_FSM.pick_start)
    await msg.answer(t.PICK_START, reply_markup=_times_kb(list(slot_map.keys()), "st"))


@router.callback_query(Booking_FSM.pick_start, F.data.startswith("st:"))
async def pick_start(cq: CallbackQuery, state: FSMContext) -> None:
    start = cq.data.split(":", 1)[1]
    await state.update_data(start=start)
    await cq.answer()
    await _show_ends(cq.message, state)


async def _show_ends(msg: Message, state: FSMContext) -> None:
    data = await state.get_data()
    start = data.get("start")
    max_end = (data.get("slot_map") or {}).get(start)
    if not max_end:
        await _show_starts(msg, state)
        return
    await state.set_state(Booking_FSM.pick_end)
    await msg.answer(t.PICK_END, reply_markup=_times_kb(_gen_ends(start, max_end), "en"))


@router.message(Booking_FSM.pick_start)
async def pick_start_text(msg: Message, state: FSMContext) -> None:
    await _show_starts(msg, state)


@router.callback_query(Booking_FSM.pick_end, F.data.startswith("en:"))
async def pick_end(cq: CallbackQuery, state: FSMContext) -> None:
    await state.update_data(end=cq.data.split(":", 1)[1])
    await cq.answer()
    data = await state.get_data()
    if data.get("mode") == "edit":
        await _show_confirm(cq.message, state)
    else:
        await state.set_state(Booking_FSM.company)
        await cq.message.answer(t.ENTER_COMPANY, reply_markup=ReplyKeyboardRemove())


@router.message(Booking_FSM.pick_end)
async def pick_end_text(msg: Message, state: FSMContext) -> None:
    await _show_ends(msg, state)


async def _send_room_photos(chat_id: int, room_id: int) -> None:
    """Send a room's demonstration photos (album) to the chat, if any exist.

    Reuses Telegram's cached file_id after the first upload, so repeat sends don't
    re-upload the bytes (Telegram serves them from its own CDN — much faster).
    """
    async with SessionLocal() as session:
        imgs = (
            await session.execute(
                select(RoomImage).where(RoomImage.room_id == room_id).order_by(RoomImage.sort_order, RoomImage.id)
            )
        ).scalars().all()
        if not imgs:
            return
        imgs = imgs[:3]
        bot = get_bot()

        def _media_for(img: RoomImage):
            return img.tg_file_id or BufferedInputFile(img.data, filename=f"room_{img.id}.jpg")

        try:
            sent = None
            if len(imgs) == 1:
                msg = await bot.send_photo(chat_id, _media_for(imgs[0]))
                sent = [msg]
            else:
                sent = await bot.send_media_group(
                    chat_id, media=[InputMediaPhoto(media=_media_for(img)) for img in imgs]
                )
        except Exception:  # noqa: BLE001 - never block the booking flow on a media failure
            import logging

            logging.getLogger(__name__).exception("failed to send room photos room=%s", room_id)
            return

        # Backfill any missing file_ids from the just-sent messages.
        changed = False
        for img, message in zip(imgs, sent):
            if not img.tg_file_id and message.photo:
                img.tg_file_id = message.photo[-1].file_id
                changed = True
        if changed:
            await session.commit()


@router.message(Booking_FSM.company)
async def get_company(msg: Message, state: FSMContext) -> None:
    await state.update_data(company=msg.text.strip())
    await state.set_state(Booking_FSM.name)
    await msg.answer(t.ENTER_NAME)


@router.message(Booking_FSM.name)
async def get_name(msg: Message, state: FSMContext) -> None:
    await state.update_data(contact_name=msg.text.strip())
    await state.set_state(Booking_FSM.phone)
    await msg.answer(t.ENTER_PHONE)


@router.message(Booking_FSM.phone)
async def get_phone(msg: Message, state: FSMContext) -> None:
    await state.update_data(phone=msg.text.strip())
    await state.set_state(Booking_FSM.event_type)
    await msg.answer(t.ENTER_EVENT_TYPE)


@router.message(Booking_FSM.event_type)
async def get_event_type(msg: Message, state: FSMContext) -> None:
    await state.update_data(event_type=msg.text.strip())
    await state.set_state(Booking_FSM.event_name)
    await msg.answer(t.ENTER_EVENT_NAME)


@router.message(Booking_FSM.event_name)
async def get_event_name(msg: Message, state: FSMContext) -> None:
    await state.update_data(event_name=msg.text.strip())
    await state.set_state(Booking_FSM.description)
    await msg.answer(t.ENTER_DESCRIPTION)


@router.message(Booking_FSM.description)
async def get_description(msg: Message, state: FSMContext) -> None:
    desc = msg.text.strip()
    await state.update_data(description=None if desc == "-" else desc)
    await state.set_state(Booking_FSM.aim)
    await msg.answer(t.ENTER_AIM, reply_markup=ReplyKeyboardRemove())


@router.message(Booking_FSM.aim)
async def get_aim(msg: Message, state: FSMContext) -> None:
    aim = msg.text.strip()
    await state.update_data(aim=None if aim == "-" else aim)
    await state.set_state(Booking_FSM.grade)
    await msg.answer(t.PICK_GRADE, reply_markup=_grade_kb())


@router.message(Booking_FSM.grade)
async def get_grade(msg: Message, state: FSMContext) -> None:
    grade = msg.text.strip()
    if grade not in GRADES:
        await msg.answer(t.INVALID_GRADE, reply_markup=_grade_kb())
        return
    await state.update_data(grade=grade)
    await state.set_state(Booking_FSM.extra_services)
    await msg.answer(t.ENTER_EXTRA_SERVICES, reply_markup=ReplyKeyboardRemove())


@router.message(Booking_FSM.extra_services)
async def get_extra_services(msg: Message, state: FSMContext) -> None:
    extra = msg.text.strip()
    await state.update_data(extra_services=None if extra == "-" else extra)
    await state.set_state(Booking_FSM.coffee)
    await msg.answer(t.COFFEE_QUESTION, reply_markup=_yesno_kb())


@router.message(Booking_FSM.coffee)
async def get_coffee(msg: Message, state: FSMContext) -> None:
    ans = msg.text.strip().lower()
    if ans not in ("да", "нет"):
        await msg.answer(t.INVALID_YESNO)
        return
    if ans == "да":
        await state.update_data(coffee=True)
        await state.set_state(Booking_FSM.coffee_count)
        await msg.answer(t.ENTER_COFFEE_HEADCOUNT, reply_markup=ReplyKeyboardRemove())
    else:
        await state.update_data(
            coffee=False, coffee_count=None, coffee_type=None, coffee_other=None, foreign_guests=False
        )
        await _ask_urgent(msg, state)


@router.message(Booking_FSM.coffee_count)
async def get_coffee_count(msg: Message, state: FSMContext) -> None:
    try:
        n = int(msg.text.strip())
        if n < 1:
            raise ValueError
    except ValueError:
        await msg.answer(t.INVALID_NUMBER)
        return
    await state.update_data(coffee_count=n)
    await _ask_coffee_type(msg, state)


def _coffee_type_kb() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text="стандарт"), KeyboardButton(text="другое")]],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


async def _ask_coffee_type(msg: Message, state: FSMContext) -> None:
    await state.set_state(Booking_FSM.coffee_type)
    await msg.answer(t.COFFEE_TYPE_QUESTION, reply_markup=_coffee_type_kb())


@router.message(Booking_FSM.coffee_type)
async def get_coffee_type(msg: Message, state: FSMContext) -> None:
    ans = msg.text.strip().lower()
    if ans.startswith("стандарт"):
        await state.update_data(coffee_type="standard", coffee_other=None)
        await _ask_foreign(msg, state)
    elif ans.startswith("друг"):
        await state.update_data(coffee_type="other")
        await state.set_state(Booking_FSM.coffee_other)
        await msg.answer(t.ENTER_COFFEE_OTHER, reply_markup=ReplyKeyboardRemove())
    else:
        await msg.answer(t.COFFEE_TYPE_QUESTION, reply_markup=_coffee_type_kb())


@router.message(Booking_FSM.coffee_other)
async def get_coffee_other(msg: Message, state: FSMContext) -> None:
    text = (msg.text or "").strip()
    if not text:
        await msg.answer(t.ENTER_COFFEE_OTHER)
        return
    await state.update_data(coffee_other=text)
    await _ask_foreign(msg, state)


async def _ask_foreign(msg: Message, state: FSMContext) -> None:
    await state.set_state(Booking_FSM.foreign_guests)
    await msg.answer(t.FOREIGN_GUESTS_QUESTION, reply_markup=_yesno_kb())


@router.message(Booking_FSM.foreign_guests)
async def get_foreign_guests(msg: Message, state: FSMContext) -> None:
    ans = msg.text.strip().lower()
    if ans not in ("да", "нет"):
        await msg.answer(t.INVALID_YESNO)
        return
    await state.update_data(foreign_guests=ans == "да")
    await _ask_urgent(msg, state)


async def _ask_urgent(msg: Message, state: FSMContext) -> None:
    await state.set_state(Booking_FSM.urgent)
    await msg.answer(t.URGENT_QUESTION, reply_markup=_yesno_kb())


@router.message(Booking_FSM.urgent)
async def get_urgent(msg: Message, state: FSMContext) -> None:
    ans = msg.text.strip().lower()
    if ans not in ("да", "нет"):
        await msg.answer(t.INVALID_YESNO)
        return
    await state.update_data(urgent=ans == "да")
    await _show_confirm(msg, state)


_COFFEE_TYPE_RU = {"standard": "стандарт (печенье, кофе, чай, конфеты)", "other": "другое"}


def _coffee_summary(data: dict) -> str:
    if not data.get("coffee"):
        return "Кофе-брейк: нет"
    bits: list[str] = []
    if data.get("coffee_count"):
        bits.append(f"кол-во: {data['coffee_count']}")
    ctype = data.get("coffee_type") or "standard"
    if ctype == "other" and data.get("coffee_other"):
        bits.append(f"другое — {esc(data['coffee_other'])}")
    else:
        bits.append(_COFFEE_TYPE_RU.get(ctype, ctype))
    line = "Кофе-брейк: да (" + ", ".join(bits) + ")"
    if data.get("foreign_guests"):
        line += "\nГости иностранцы: да (кофе-брейк в зале)"
    return line


async def _show_confirm(msg: Message, state: FSMContext) -> None:
    data = await state.get_data()
    async with SessionLocal() as session:
        room = await session.get(Room, data["room_id"])
    summary = (
        f"Помещение: {esc(room.name)} ({esc(room.capacity)})\n"
        f"Дата: {data['bdate']}\n"
        f"Время: {data['start']}–{data['end']}\n"
        f"Тип: {esc(data['event_type'])}\n"
        f"Название: {esc(data['event_name'])}\n"
        f"Описание: {esc(data.get('description')) or '—'}\n"
        f"Цель: {esc(data.get('aim')) or '—'}\n"
        f"Грейд: {esc(data.get('grade')) or '—'}\n"
        f"Доп. услуги: {esc(data.get('extra_services')) or '—'}\n"
        f"Участников: {data['attendees']}\n"
        + _coffee_summary(data)
        + f"\nСрочная: {'да' if data.get('urgent') else 'нет'}"
        + f"\nКомпания: {esc(data['company'])}\n"
        f"Контакт: {esc(data['contact_name'])}, {esc(data['phone'])}"
    )
    await state.set_state(Booking_FSM.confirm)
    await msg.answer(t.CONFIRM_PREFIX + summary + t.CONFIRM_QUESTION, reply_markup=_yesno_kb())


@router.message(Booking_FSM.confirm)
async def confirm(msg: Message, state: FSMContext) -> None:
    ans = msg.text.strip().lower()
    if ans not in ("да", "нет"):
        await msg.answer(t.INVALID_YESNO)
        return
    if ans == "нет":
        await state.clear()
        await msg.answer(t.CANCELLED, reply_markup=ReplyKeyboardRemove())
        return

    data = await state.get_data()
    bd = date.fromisoformat(data["bdate"])
    sh = datetime.strptime(data["start"], "%H:%M").time()
    eh = datetime.strptime(data["end"], "%H:%M").time()
    starts_at = datetime.combine(bd, sh, tzinfo=timezone.utc)
    ends_at = datetime.combine(bd, eh, tzinfo=timezone.utc)

    async with SessionLocal() as session:
        # The customer chose a specific room; create_booking re-validates capacity,
        # operating hours, conflicts and off-time (raising BookingError on failure).
        room = await session.get(Room, data["room_id"])
        if room is None or not room.is_active or room.is_coffee_break:
            await _offer_alternatives(msg, state, "Выбранное помещение больше недоступно.")
            return
        try:
            booking = await svc.create_booking(
                session,
                room=room,
                starts_at=starts_at,
                ends_at=ends_at,
                customer_telegram_id=msg.from_user.id,
                customer_username=msg.from_user.username,
                company=data["company"],
                contact_name=data["contact_name"],
                phone=data["phone"],
                event_type=data["event_type"],
                event_name=data["event_name"],
                description=data.get("description"),
                aim=data.get("aim"),
                grade=data.get("grade"),
                extra_services=data.get("extra_services"),
                attendees=data["attendees"],
                coffee_break=data["coffee"],
                coffee_headcount=data.get("coffee_count"),
                coffee_type=data.get("coffee_type"),
                coffee_other=data.get("coffee_other"),
                foreign_guests=data.get("foreign_guests", False),
                urgent=data.get("urgent", False),
            )
            await upsert_user(
                session,
                msg.from_user.id,
                first_name=msg.from_user.first_name,
                last_name=msg.from_user.last_name,
                username=msg.from_user.username,
            )
            await session.commit()
            await session.refresh(booking, attribute_names=["room"])
        except svc.BookingError as exc:
            await session.rollback()
            await _offer_alternatives(msg, state, str(exc))
            return

    await state.clear()
    await msg.answer(
        t.SUCCESS.format(id=booking.id) + f"\nПомещение: {esc(booking.room.name)}",
        reply_markup=ReplyKeyboardRemove(),
    )
    await _send_room_photos(msg.chat.id, booking.room_id)
    await notify_new(booking, booking.room)


def _fix_menu_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Дата и время", callback_data="fix:when")],
            [InlineKeyboardButton(text="Помещение", callback_data="fix:room")],
            [InlineKeyboardButton(text="Число участников", callback_data="fix:attendees")],
            [InlineKeyboardButton(text="Кофе-брейк (число)", callback_data="fix:coffee")],
            [InlineKeyboardButton(text="Отменить заявку", callback_data="fix:cancel")],
        ]
    )


async def _offer_alternatives(msg: Message, state: FSMContext, reason: str) -> None:
    """Validation/availability error: keep all entered data, explain the problem, and
    proactively suggest concrete alternatives the customer can tap (Module B):
      1. free start times on the same day for the chosen room,
      2. otherwise the nearest free day within a month (jump the calendar there),
      3. otherwise nothing fits — fall back to changing room / attendee count.
    A fix menu is always offered too, so room/participants/cancel stay reachable."""
    await state.update_data(mode="edit")
    await msg.answer(t.ERROR.format(reason=esc(reason)), reply_markup=ReplyKeyboardRemove())

    data = await state.get_data()
    day = data.get("bdate")
    offered = False
    if day:
        d0 = date.fromisoformat(day)
        async with SessionLocal() as session:
            slots = await avail.room_day_slots(session, data["room_id"], d0, data["attendees"])
        if slots:
            slot_map = {s.strftime("%H:%M"): e.strftime("%H:%M") for s, e in slots}
            await state.update_data(slot_map=slot_map)
            await state.set_state(Booking_FSM.pick_start)
            await msg.answer(t.ALT_SAME_DAY.format(date=day), reply_markup=_times_kb(list(slot_map.keys()), "st"))
            offered = True
        else:
            async with SessionLocal() as session:
                days = await avail.room_available_days(
                    session, data["room_id"], d0, d0 + timedelta(days=30), data["attendees"]
                )
            nxt = next((d for d in sorted(days) if days[d]), None)
            if nxt:
                await state.update_data(cal_year=nxt.year, cal_month=nxt.month)
                await msg.answer(t.ALT_NEXT_DAY.format(next=nxt.strftime("%d.%m.%Y")))
                await _show_calendar(msg, state)
                offered = True

    if not offered:
        await state.set_state(Booking_FSM.fix)
        await msg.answer(t.ALT_NONE)
    # Escape hatch — always available, in any of the states set above.
    await msg.answer(t.FIX_PROMPT, reply_markup=_fix_menu_kb())


@router.message(Booking_FSM.fix)
async def fix_fallback(msg: Message, state: FSMContext) -> None:
    await msg.answer(t.FIX_PROMPT, reply_markup=_fix_menu_kb())


# No state filter: the fix menu may be shown while in pick_start/calendar/fix states
# (see _offer_alternatives), and the "fix:" prefix is unique to this menu.
@router.callback_query(F.data.startswith("fix:"))
async def fix_choice(cq: CallbackQuery, state: FSMContext) -> None:
    what = cq.data.split(":")[1]
    await cq.answer()
    # All edits return to the confirmation step instead of restarting the flow.
    await state.update_data(mode="edit")
    if what == "cancel":
        await state.clear()
        await cq.message.answer(t.CANCELLED)
    elif what == "when":
        await _show_calendar(cq.message, state)
    elif what == "room":
        async with SessionLocal() as session:
            rooms = await _bookable_rooms_list(session)
        if not rooms:
            await cq.message.answer(t.NO_ROOMS)
            return
        await state.set_state(Booking_FSM.room)
        await cq.message.answer(t.PICK_ROOM, reply_markup=_rooms_kb(rooms))
    elif what == "attendees":
        await state.set_state(Booking_FSM.attendees)
        await cq.message.answer(t.ENTER_ATTENDEES)
    elif what == "coffee":
        await state.set_state(Booking_FSM.edit_coffee)
        await cq.message.answer(t.EDIT_COFFEE_PROMPT)


@router.message(Booking_FSM.edit_coffee)
async def edit_coffee(msg: Message, state: FSMContext) -> None:
    try:
        n = int(msg.text.strip())
        if n < 0:
            raise ValueError
    except ValueError:
        await msg.answer(t.INVALID_NUMBER)
        return
    # 0 means "no coffee-break" — drop the flag so the booking can pass validation.
    if n == 0:
        await state.update_data(
            coffee=False, coffee_count=None, coffee_type=None, coffee_other=None, foreign_guests=False
        )
    else:
        await state.update_data(coffee=True, coffee_count=n)
    await _show_confirm(msg, state)


def _my_coffee_line(b: Booking) -> str:
    if not b.coffee_break:
        return ""
    bits: list[str] = []
    if b.coffee_headcount:
        bits.append(f"кол-во {b.coffee_headcount}")
    ctype = b.coffee_type or "standard"
    if ctype == "other" and b.coffee_other:
        bits.append(f"другое — {esc(b.coffee_other)}")
    else:
        bits.append(_COFFEE_TYPE_RU.get(ctype, ctype))
    if b.foreign_guests:
        bits.append("в зале, гости иностранцы")
    return "  кофе-брейк: " + ", ".join(bits)


@router.message(Command("my"))
async def my(msg: Message) -> None:
    async with SessionLocal() as session:
        rows = (
            await session.execute(
                select(Booking)
                .options(
                    selectinload(Booking.room),
                    selectinload(Booking.props).selectinload(BookingProp.prop),
                )
                .where(Booking.customer_telegram_id == msg.from_user.id)
                .order_by(Booking.starts_at.desc())
                .limit(20)
            )
        ).scalars().all()
    if not rows:
        await msg.answer(t.NO_BOOKINGS)
        return
    lines = []
    for b in rows:
        r = b.room
        block = (
            f"№{b.id} — {esc(b.event_name)}\n"
            f"  {esc(r.name) if r else '—'}, {b.starts_at.strftime('%d.%m %H:%M')}–{b.ends_at.strftime('%H:%M')}\n"
            f"  статус: {b.status.value}"
        )
        extra: list[str] = []
        if b.grade:
            extra.append(f"  грейд: {esc(b.grade)}")
        if b.aim:
            extra.append(f"  цель: {esc(b.aim)}")
        if b.extra_services:
            extra.append(f"  доп. услуги: {esc(b.extra_services)}")
        if b.room_struct:
            extra.append(f"  расстановка: {ROOM_STRUCT_LABELS.get(b.room_struct, b.room_struct)}")
        coffee = _my_coffee_line(b)
        if coffee:
            extra.append(coffee)
        if b.props:
            extra.append(
                "  оборудование: "
                + ", ".join(f"{esc(bp.prop.name)}×{bp.amount}" for bp in b.props)
            )
        if extra:
            block += "\n" + "\n".join(extra)
        lines.append(block)
    await msg.answer("\n\n".join(lines))


# ---------- Post-event feedback (Module F, #12: aspect sub-ratings) ----------
# Rating is collected in order: overall → room → service → props → comment.
_FB_NEXT = {"overall": "room", "room": "service", "service": "props", "props": None}
_FB_QUESTION = {
    "overall": "мероприятие в целом",
    "room": "помещение",
    "service": "сервис",
    "props": "оборудование",
}


def _fb_kb(bid: int, aspect: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=str(n), callback_data=f"fb:{bid}:{aspect}:{n}") for n in range(1, 6)]
        ]
    )


@router.callback_query(F.data.startswith("fb:"))
async def feedback_rate(cq: CallbackQuery, state: FSMContext) -> None:
    parts = cq.data.split(":")
    # Back-compat: legacy "fb:{bid}:{n}" is treated as the overall rating.
    if len(parts) == 3:
        aspect, (bid_s, n_s) = "overall", (parts[1], parts[2])
    else:
        _, bid_s, aspect, n_s = parts
    bid, rating = int(bid_s), int(n_s)
    if aspect not in _FB_NEXT or not 1 <= rating <= 5:
        await cq.answer()
        return
    async with SessionLocal() as session:
        booking = await session.get(Booking, bid)
        # Only the booking's own customer may rate it.
        if booking is None or booking.customer_telegram_id != cq.from_user.id:
            await cq.answer("Заявка не найдена.", show_alert=True)
            return
        fb = (
            await session.execute(select(Feedback).where(Feedback.booking_id == bid))
        ).scalar_one_or_none()
        if fb is None:
            # rating is NOT NULL; seed it with this tap (overwritten below if aspect==overall).
            fb = Feedback(booking_id=bid, rating=rating)
            session.add(fb)
        if aspect == "overall":
            fb.rating = rating
        elif aspect == "room":
            fb.room_rating = rating
        elif aspect == "service":
            fb.service_rating = rating
        elif aspect == "props":
            fb.props_rating = rating
        await session.commit()
    await cq.answer("Принято!")
    nxt = _FB_NEXT[aspect]
    if nxt is not None:
        try:
            await cq.message.edit_text(
                f"Оцените {_FB_QUESTION[nxt]} от 1 до 5:", reply_markup=_fb_kb(bid, nxt)
            )
        except Exception:  # noqa: BLE001 - message edit is best-effort
            pass
        return
    # All aspects rated → ask for the optional free-text comment.
    try:
        await cq.message.edit_text(
            f"Спасибо за оценки по заявке №{bid}!\n"
            "Напишите короткий комментарий или отправьте /skip."
        )
    except Exception:  # noqa: BLE001 - message edit is best-effort
        pass
    await state.clear()
    await state.set_state(Feedback_FSM.comment)
    await state.update_data(fb_booking_id=bid)


@router.message(Command("skip"), Feedback_FSM.comment)
async def feedback_skip(msg: Message, state: FSMContext) -> None:
    await state.clear()
    await msg.answer("Спасибо за ваш отзыв!")


@router.message(Feedback_FSM.comment)
async def feedback_comment(msg: Message, state: FSMContext) -> None:
    data = await state.get_data()
    bid = data.get("fb_booking_id")
    text = (msg.text or "").strip()
    async with SessionLocal() as session:
        fb = (
            await session.execute(select(Feedback).where(Feedback.booking_id == bid))
        ).scalar_one_or_none()
        if fb is not None and text:
            fb.comment = text
            await session.commit()
    await state.clear()
    await msg.answer("Спасибо за ваш отзыв!")


# Registered LAST: any plain text from a user who isn't in the booking/chat flow is
# treated as a message to the admin, so customers can simply reply without /chat.
@router.message(StateFilter(None))
async def idle_message(msg: Message, state: FSMContext) -> None:
    if not msg.text or msg.text.startswith("/"):
        return
    await _relay_to_admins(msg)
