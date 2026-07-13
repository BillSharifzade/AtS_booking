from __future__ import annotations

import logging

from aiogram.exceptions import TelegramAPIError
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from app.config import settings
from app.models import Booking, BookingStatus, Room
from app.telegram import esc, get_bot, send_text

log = logging.getLogger(__name__)


async def request_feedback(booking: Booking) -> None:
    """DM the customer a 1–5 rating request when their event completes (Module F).
    The bot process handles the ``fb:`` callbacks and the optional follow-up comment."""
    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=str(n), callback_data=f"fb:{booking.id}:overall:{n}") for n in range(1, 6)]
        ]
    )
    try:
        await get_bot().send_message(
            booking.customer_telegram_id,
            f"Мероприятие №{booking.id} «{esc(booking.event_name)}» завершено. Спасибо!\n"
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
        extras += f"Грейд: {esc(booking.grade)}\n"
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
    customer_msg = (
        "Заявка №{id} принята. Ожидайте подтверждения администратора.\n\n{card}".format(
            id=booking.id, card=_booking_card(booking, room)
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
    for admin_id in settings.admin_telegram_ids:
        await send_text(admin_id, admin_msg)


async def notify_status_change(booking: Booking, room: Room, new_status: BookingStatus) -> None:
    if new_status == BookingStatus.approved:
        await send_text(
            booking.customer_telegram_id,
            f"Заявка №{booking.id} подтверждена.\n\n{_booking_card(booking, room)}",
        )
        await send_text(
            settings.sat_bookings_group_chat_id,
            f"Новое мероприятие\n\n{_booking_card(booking, room, show_zone=True)}",
        )
    elif new_status == BookingStatus.rejected:
        reason = f"\nПричина: {esc(booking.reject_reason)}" if booking.reject_reason else ""
        await send_text(
            booking.customer_telegram_id,
            f"Заявка №{booking.id} отклонена.{reason}",
        )
    elif new_status == BookingStatus.completed:
        await request_feedback(booking)


async def notify_room_changed(booking: Booking, room: Room) -> None:
    # Admin moved an already-approved booking to another room (Module E rebalancing).
    await send_text(
        booking.customer_telegram_id,
        f"По заявке №{booking.id} изменено помещение.\n\n{_booking_card(booking, room)}",
    )


async def notify_reminder(booking: Booking, room: Room, scope: str) -> None:
    # D-1 / H-1 reminders to the customer about the event they booked (Module D).
    start = _fmt_dt(booking.starts_at)
    if scope == "day":
        head = f"Напоминание: завтра, {start}, начнётся ваше мероприятие «{esc(booking.event_name)}»."
    else:
        head = (
            f"Напоминание: уже через час, в {booking.starts_at.strftime('%H:%M')}, "
            f"начнётся ваше мероприятие «{esc(booking.event_name)}»."
        )
    await send_text(
        booking.customer_telegram_id,
        f"{head}\nВы забронировали:\n\n{_booking_card(booking, room)}",
    )
