from __future__ import annotations

import logging
from datetime import timezone

from aiogram.exceptions import TelegramAPIError
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from app.config import local_now, settings
from app.db import SessionLocal
from app.models import Booking, BookingStatus, Room
from app.services.access import all_admin_ids
from app.services.notify_prefs import current_prefs
from app.services.weekly_digest import event_announcement
from app.telegram import esc, get_bot, send_text

log = logging.getLogger(__name__)

# Longest customer name we'll paste into a greeting (a pasted paragraph shouldn't
# turn the first line of a notification into a wall of text).
MAX_NAME_LEN = 60


def addressee(booking: Booking) -> str | None:
    """How to address the customer in a DM — the contact name they gave, or nothing
    when it's missing/unusable (then messages stay impersonal instead of odd)."""
    name = (booking.contact_name or "").strip()
    if not name or len(name) > MAX_NAME_LEN:
        return None
    return esc(name)


def _hello(booking: Booking) -> str:
    """Opening line of a customer notification: personalised when we know the name."""
    name = addressee(booking)
    return f"Здравствуйте, {name}!\n\n" if name else ""


def _already_happened(booking: Booking) -> bool:
    """Whether the event is already over. Backdated records an admin enters after the
    fact must not tell the customer to "await confirmation" or announce the event in
    the group as if it were upcoming."""
    ends_at = booking.ends_at
    if ends_at is None:
        return False
    if ends_at.tzinfo is None:
        ends_at = ends_at.replace(tzinfo=timezone.utc)
    return ends_at < local_now()


async def _dm_admins(text: str, *, kind: str, is_urgent: bool = False) -> None:
    """Send an admin-facing DM, honouring the panel's notification preferences
    («Настройки → Уведомления»). ``kind`` is "new" or "status"."""
    prefs = await current_prefs()
    if kind == "new":
        if not prefs.new_bookings:
            return
        if prefs.urgent_only and not is_urgent:
            return
    elif kind == "status" and not prefs.status_changes:
        return
    for admin_id in await _admin_ids():
        await send_text(admin_id, text)


async def _admin_ids() -> set[int]:
    """Resolve every admin recipient (env superadmins + panel ``admin`` accounts).

    Opens its own short-lived session: notifications are sent *after* the request's
    session has been committed/closed, so we can't rely on a caller-supplied one."""
    try:
        async with SessionLocal() as session:
            return await all_admin_ids(session)
    except Exception:  # pragma: no cover - never let a lookup failure drop the notice
        log.exception("failed to resolve panel admins; falling back to env admins")
        return set(settings.admin_telegram_ids)


async def request_feedback(booking: Booking) -> None:
    """DM the customer a 1–5 rating request when their event completes (Module F).
    The bot process handles the ``fb:`` callbacks and the optional follow-up comment."""
    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=str(n), callback_data=f"fb:{booking.id}:overall:{n}") for n in range(1, 6)]
        ]
    )
    name = addressee(booking)
    lead = f"{name}, спасибо!" if name else "Спасибо!"
    try:
        await get_bot().send_message(
            booking.customer_telegram_id,
            f"{lead} Ваше мероприятие №{booking.id} «{esc(booking.event_name)}» завершено.\n"
            "Оцените мероприятие в целом от 1 до 5 — затем спросим про помещение, сервис и оборудование:",
            reply_markup=kb,
        )
    except TelegramAPIError:
        log.exception("feedback request failed for booking %s", booking.id)


def _fmt_dt(dt) -> str:
    return dt.strftime("%d.%m.%Y %H:%M")


ROOM_STRUCT_LABELS = {
    "theatre": "Театр",
    "class": "Класс",
    "banquet": "Банкет",
    "u_shaped": "П-образная",
    "conference": "Конференц",
}
COFFEE_TYPE_LABELS = {"standard": "стандартный (печенье, кофе, чай, конфеты)", "other": "другое"}


def _coffee_line(booking: Booking) -> str:
    if not booking.coffee_break:
        return "Кофе-брейк: нет"
    parts = ["Кофе-брейк: да"]
    if booking.coffee_headcount:
        parts.append(f"кол-во: {booking.coffee_headcount}")
    if booking.coffee_type:
        label = COFFEE_TYPE_LABELS.get(booking.coffee_type, booking.coffee_type)
        if booking.coffee_type == "other" and booking.coffee_other:
            label = f"другое — {esc(booking.coffee_other)}"
        parts.append(label)
    line = "Кофе-брейк: да (" + ", ".join(parts[1:]) + ")" if len(parts) > 1 else parts[0]
    if booking.foreign_guests:
        line += "\nГости иностранцы: да (кофе-брейк в зале мероприятия)"
    return line


def _booking_card(booking: Booking, room: Room, *, show_zone: bool = False) -> str:
    # Zones are an admin-only grouping — customers only ever see the room name.
    struct = ""
    if booking.room_struct:
        struct = f"Расстановка: {ROOM_STRUCT_LABELS.get(booking.room_struct, booking.room_struct)}\n"
    extras = ""
    if booking.position:
        extras += f"Должность заявителя: {esc(booking.position)}\n"
    if booking.department:
        extras += f"Департамент: {esc(booking.department)}\n"
    if booking.trainer:
        extras += f"Тренер: {esc(booking.trainer)}\n"
    if booking.grade:
        extras += f"Грейд заявителя: {esc(booking.grade)}\n"
    if booking.aim:
        extras += f"Цель: {esc(booking.aim)}\n"
    if booking.target_employees:
        extras += f"Для сотрудников: {esc(booking.target_employees)}\n"
    if booking.extra_services:
        extras += f"Доп. услуги: {esc(booking.extra_services)}\n"
    room_line = f"Помещение: {esc(room.name)}"
    if show_zone:
        room_line += f" (зона {esc(room.zone.name)})"
    return (
        f"<b>{esc(booking.event_name)}</b>\n"
        f"{room_line}\n"
        f"Когда: {_fmt_dt(booking.starts_at)} — {_fmt_dt(booking.ends_at)}\n"
        f"Тип: {esc(booking.event_type)}\n"
        f"Участников: {booking.attendees}\n"
        f"{struct}"
        f"{extras}"
        + _coffee_line(booking)
        + f"\nЗаказчик: {esc(booking.contact_name)}, {esc(booking.company)}\n"
        f"Телефон: {esc(booking.phone)}\n"
        f"#заявка_{booking.id}"
    )


async def notify_new(booking: Booking, room: Room) -> None:
    # A booking an admin registered after the fact ("задним числом") is a record, not a
    # request: nobody is waiting for it to be confirmed, so it stays silent.
    if _already_happened(booking):
        return

    customer_msg = (
        "{hello}Ваша заявка №{id} принята. Ожидайте подтверждения администратора.\n\n{card}".format(
            hello=_hello(booking), id=booking.id, card=_booking_card(booking, room)
        )
    )
    if booking.is_urgent:
        customer_msg += "\n\n<i>Срочное бронирование (менее 2 дней). С вами свяжется администратор.</i>"
    await send_text(booking.customer_telegram_id, customer_msg)

    admin_msg = ("Новая заявка №{id}{urgent}\n\n{card}").format(
        id=booking.id,
        urgent=" (СРОЧНАЯ)" if booking.is_urgent else "",
        card=_booking_card(booking, room, show_zone=True),
    )
    await _dm_admins(admin_msg, kind="new", is_urgent=booking.is_urgent)


# Short admin-facing label for each status a booking can transition into.
_STATUS_ADMIN_LABELS = {
    BookingStatus.approved: "подтверждена",
    BookingStatus.rejected: "отклонена",
    BookingStatus.completed: "завершена",
    BookingStatus.archived: "перенесена в архив",
}


async def notify_status_change(booking: Booking, room: Room, new_status: BookingStatus) -> None:
    past = _already_happened(booking)
    if new_status == BookingStatus.approved:
        # An already-held event (backdated record) is not news for the customer or the
        # group — confirming it is bookkeeping.
        if not past:
            await send_text(
                booking.customer_telegram_id,
                f"{_hello(booking)}Ваша заявка №{booking.id} подтверждена ✅\n\n"
                f"{_booking_card(booking, room)}",
            )
            # The group gets the agreed announcement format (same as the weekly digest),
            # not the internal card with phone/contact details.
            await send_text(settings.sat_bookings_group_chat_id, event_announcement(booking))
    elif new_status == BookingStatus.rejected:
        reason = f"\nПричина: {esc(booking.reject_reason)}" if booking.reject_reason else ""
        await send_text(
            booking.customer_telegram_id,
            f"{_hello(booking)}К сожалению, ваша заявка №{booking.id} "
            f"«{esc(booking.event_name)}» отклонена.{reason}",
        )
    elif new_status == BookingStatus.completed:
        await request_feedback(booking)

    # Other administrators are looped in only if they asked to be (по умолчанию — нет,
    # чтобы прилетали только новые/срочные заявки).
    label = _STATUS_ADMIN_LABELS.get(new_status)
    if label:
        admin_msg = f"Заявка №{booking.id} «{esc(booking.event_name)}» {label}."
        if new_status == BookingStatus.rejected and booking.reject_reason:
            admin_msg += f"\nПричина: {esc(booking.reject_reason)}"
        await _dm_admins(admin_msg, kind="status")


async def notify_room_changed(booking: Booking, room: Room) -> None:
    # Admin moved an already-approved booking to another room (Module E rebalancing).
    if _already_happened(booking):
        return
    await send_text(
        booking.customer_telegram_id,
        f"{_hello(booking)}По вашей заявке №{booking.id} «{esc(booking.event_name)}» "
        f"изменено помещение.\n\n{_booking_card(booking, room)}",
    )


async def notify_reminder(booking: Booking, room: Room, scope: str) -> None:
    # D-1 / H-1 reminders to the customer about the event they booked (Module D).
    name = addressee(booking)
    lead = f"{name}, напоминаем: " if name else "Напоминание: "
    start = _fmt_dt(booking.starts_at)
    if scope == "day":
        head = f"{lead}завтра, {start}, начнётся ваше мероприятие «{esc(booking.event_name)}»."
    else:
        head = (
            f"{lead}уже через час, в {booking.starts_at.strftime('%H:%M')}, "
            f"начнётся ваше мероприятие «{esc(booking.event_name)}»."
        )
    await send_text(
        booking.customer_telegram_id,
        f"{head}\nВы забронировали:\n\n{_booking_card(booking, room)}",
    )
