"""Parser for the monthly «Календарь мероприятий БТЦ AtS» xlsx.

Template (one sheet per month, e.g. "Июнь 2026"):
  row 1  — title
  row 2  — headers: Дата | Зал | Время | Мероприятие | Компании/Проект |
                     Тренер/Ведущий | Аудитория | Кофе Брейк | Кол-во участников |
                     Дни недели | (spacer) | №
  row 4+ — data. The Дата cell is *merged* across a day's multiple events, so it
           only carries a value on the first row of the day → we forward-fill it.
           Rows with a date but no event data (empty day) are skipped.

Robust to messy real data: extra spaces in time cells, non-numeric participant
cells, sheets in any order, and missing optional columns.
"""
from __future__ import annotations

import io
import re
from datetime import date, datetime, time

import openpyxl

# 1-based column indexes in the template.
COL_DATE = 1
COL_ROOM = 2
COL_TIME = 3
COL_TITLE = 4
COL_COMPANY = 5
COL_TRAINER = 6
COL_AUDIENCE = 7
COL_COFFEE = 8
COL_PARTICIPANTS = 9

_TIME_RE = re.compile(r"(\d{1,2})[:.](\d{2})")


def _clean(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _parse_times(text: str | None) -> tuple[time | None, time | None]:
    """Pull the first two HH:MM occurrences out of a free-text time cell."""
    if not text:
        return None, None
    found: list[time] = []
    for h, m in _TIME_RE.findall(text):
        try:
            hh, mm = int(h), int(m)
            if 0 <= hh < 24 and 0 <= mm < 60:
                found.append(time(hh, mm))
        except ValueError:
            continue
        if len(found) == 2:
            break
    start = found[0] if found else None
    end = found[1] if len(found) > 1 else None
    return start, end


def _parse_participants(v) -> int | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        try:
            return int(v)
        except (ValueError, OverflowError):
            return None
    m = re.search(r"\d+", str(v))
    return int(m.group()) if m else None


def _as_date(v) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return None


def parse_calendar_xlsx(raw: bytes) -> list[dict]:
    """Return a flat list of event dicts across every month sheet, in sheet order.
    Raises ValueError if the file can't be opened as an xlsx."""
    try:
        wb = openpyxl.load_workbook(io.BytesIO(raw), data_only=True, read_only=True)
    except Exception as exc:  # openpyxl raises assorted errors on bad input
        raise ValueError("Не удалось открыть файл как Excel (.xlsx).") from exc

    events: list[dict] = []
    order = 0
    for ws in wb.worksheets:
        current_date: date | None = None
        for row in ws.iter_rows(values_only=True):
            # Pad short rows so fixed indexes are always safe.
            cells = list(row) + [None] * (COL_PARTICIPANTS - len(row))

            d = _as_date(cells[COL_DATE - 1])
            if d is not None:
                current_date = d

            room = _clean(cells[COL_ROOM - 1])
            time_text = _clean(cells[COL_TIME - 1])
            title = _clean(cells[COL_TITLE - 1])
            company = _clean(cells[COL_COMPANY - 1])

            # Skip header/spacer rows and empty days (a date with no event content).
            if not any((room, time_text, title, company)):
                continue
            # Skip the header row itself if it slipped through.
            if title == "Мероприятие" or (title and title.startswith("Мероприятие ")):
                continue
            if current_date is None:
                continue

            start, end = _parse_times(time_text)
            events.append({
                "event_date": current_date,
                "start_time": start,
                "end_time": end,
                "time_text": time_text,
                "title": title or company or "Мероприятие",
                "room": room,
                "company": company,
                "trainer": _clean(cells[COL_TRAINER - 1]),
                "audience": _clean(cells[COL_AUDIENCE - 1]),
                "coffee": _clean(cells[COL_COFFEE - 1]),
                "participants": _parse_participants(cells[COL_PARTICIPANTS - 1]),
                "sort_order": order,
            })
            order += 1

    wb.close()
    return events
