"""Bot text responses.

Each text has a built-in default below. Administrators can override any of them
from the admin panel (stored in the ``bot_texts`` table); the bot process keeps an
in-memory copy of the overrides refreshed periodically.

Existing call sites use attribute access (``texts.START``). Module ``__getattr__``
resolves those to the current override, falling back to the default — so callers
don't need to change and don't need a DB round-trip per message.
"""
from __future__ import annotations

import re

# (key, group, label, default text)
_TEXT_DEFS: list[tuple[str, str, str, str]] = [
    (
        "START",
        "Команды",
        "Приветствие (/start)",
        "Здравствуйте! Это бот бронирования помещений AtS.\n\n"
        "Команды:\n"
        "/book — новая заявка\n"
        "/my — мои заявки\n"
        "/chat — связаться с администратором\n"
        "/cancel — отменить текущий ввод\n"
        "/whoami — узнать свой Telegram ID",
    ),
    ("CANCELLED", "Результаты", "Отмена ввода", "Отменено."),
    ("NO_ROOMS", "Результаты", "Нет доступных помещений", "Помещения пока не настроены. Обратитесь к администратору."),
    ("PICK_ZONE", "Процесс заявки", "Выбор зоны", "Выберите зону:"),
    ("PICK_DATE", "Процесс заявки", "Выбор даты", "Выберите дату (доступные дни — активны):"),
    ("PICK_START", "Процесс заявки", "Выбор времени начала", "Выберите время начала:"),
    ("PICK_END", "Процесс заявки", "Выбор времени окончания", "Выберите время окончания:"),
    ("NO_SLOTS", "Процесс заявки", "Нет свободного времени", "На этот день нет свободного времени. Выберите другой день."),
    ("ENTER_COMPANY", "Процесс заявки", "Запрос: компания", "Название компании?"),
    ("ENTER_NAME", "Процесс заявки", "Запрос: контактное лицо", "Контактное лицо (ФИО)?"),
    ("ENTER_PHONE", "Процесс заявки", "Запрос: телефон", "Контактный телефон?"),
    (
        "ENTER_EVENT_TYPE",
        "Процесс заявки",
        "Запрос: тип мероприятия",
        "Тип мероприятия (например: совещание, тренинг, презентация)?",
    ),
    ("ENTER_EVENT_NAME", "Процесс заявки", "Запрос: название мероприятия", "Название мероприятия?"),
    (
        "ENTER_DESCRIPTION",
        "Процесс заявки",
        "Запрос: описание",
        "Краткое описание мероприятия? (или «-» чтобы пропустить)",
    ),
    ("ENTER_ATTENDEES", "Процесс заявки", "Запрос: число участников", "Количество участников?"),
    ("COFFEE_QUESTION", "Процесс заявки", "Запрос: кофе-брейк", "Нужен кофе-брейк? (да/нет)"),
    ("ENTER_COFFEE_HEADCOUNT", "Процесс заявки", "Запрос: число на кофе-брейке", "Сколько человек на кофе-брейке?"),
    ("EDIT_COFFEE_PROMPT", "Процесс заявки", "Исправление: число на кофе-брейке", "Сколько человек на кофе-брейке? Введите 0, чтобы убрать кофе-брейк."),
    ("URGENT_QUESTION", "Процесс заявки", "Запрос: срочность", "Это срочная заявка? (да/нет)"),
    ("CONFIRM_PREFIX", "Процесс заявки", "Подтверждение: вступление", "Проверьте заявку:\n\n"),
    ("CONFIRM_QUESTION", "Процесс заявки", "Подтверждение: вопрос", "\n\nОтправить заявку? (да/нет)"),
    ("FIX_PROMPT", "Процесс заявки", "Что изменить при ошибке", "Что хотите изменить, чтобы исправить заявку?"),
    (
        "ALT_SAME_DAY",
        "Процесс заявки",
        "Альтернативы: свободное время в тот же день",
        "Это время уже занято. Свободные интервалы на {date} — выберите новое время начала:",
    ),
    (
        "ALT_NEXT_DAY",
        "Процесс заявки",
        "Альтернативы: ближайший свободный день",
        "На выбранный день свободного времени не осталось. Ближайший свободный день — {next}. Выберите дату:",
    ),
    (
        "ALT_NONE",
        "Процесс заявки",
        "Альтернативы: ничего не найдено",
        "На ближайший месяц свободного времени в этой зоне для такого числа участников нет. "
        "Попробуйте изменить зону или число участников.",
    ),
    ("INVALID_NUMBER", "Ошибки ввода", "Ошибка: не число", "Введите число."),
    ("INVALID_YESNO", "Ошибки ввода", "Ошибка: да/нет", "Ответьте «да» или «нет»."),
    ("SUCCESS", "Результаты", "Заявка создана", "Заявка №{id} создана."),
    ("ERROR", "Результаты", "Ошибка создания заявки", "Не удалось создать заявку: {reason}"),
    ("NO_BOOKINGS", "Результаты", "Нет заявок (/my)", "У вас нет заявок."),
    (
        "CHAT_START",
        "Чат с администратором",
        "Начало чата (/chat)",
        "Вы на связи с администратором. Напишите сообщение — оно будет передано. /stop — завершить чат.",
    ),
    ("CHAT_STOPPED", "Чат с администратором", "Завершение чата (/stop)", "Чат с администратором завершён."),
]

DEFAULTS: dict[str, str] = {k: d for k, _, _, d in _TEXT_DEFS}
GROUPS: dict[str, str] = {k: g for k, g, _, _ in _TEXT_DEFS}
LABELS: dict[str, str] = {k: lbl for k, _, lbl, _ in _TEXT_DEFS}
ORDER: list[str] = [k for k, _, _, _ in _TEXT_DEFS]

_overrides: dict[str, str] = {}


def placeholders(key: str) -> list[str]:
    """Named ``{placeholders}`` present in a key's default text."""
    return sorted(set(re.findall(r"{(\w+)}", DEFAULTS.get(key, ""))))


def set_overrides(values: dict[str, str]) -> None:
    global _overrides
    _overrides = {k: v for k, v in values.items() if k in DEFAULTS}


def get(key: str) -> str:
    return _overrides.get(key, DEFAULTS[key])


def __getattr__(name: str) -> str:
    if name in DEFAULTS:
        return get(name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
