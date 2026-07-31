import { useEffect, useMemo, useState } from "react";
import { api, MonthCalendar, PublicBooking } from "../api";
import { haptic } from "../telegram";

// Month grid of the CURRENT month's confirmed bookings, shown on the landing.
// The month comes from the server (business timezone) and rolls over on its own.

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
// Genitive, for "5 августа" — the nominative label ("Август 2026") comes from the API.
const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Russian plural: plural(n, ["час", "часа", "часов"]). */
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** Hours may be fractional ("94,5 часа"), where the genitive singular is standard. */
function hoursWord(n: number): string {
  return Number.isInteger(n) ? plural(n, ["час", "часа", "часов"]) : "часа";
}

/** Local wall-clock date as YYYY-MM-DD — event_date is a bare date, so no UTC shift. */
function todayIso() {
  const n = new Date();
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}

type Cell = { iso: string; day: number } | null;

function buildCells(month: string): Cell[] {
  const [y, m] = month.split("-").map(Number);
  // getUTCDay() is 0=Sunday; the grid starts on Monday.
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Cell[] = Array.from({ length: firstWeekday }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push({ iso: `${y}-${pad(m)}-${pad(d)}`, day: d });
  return cells;
}

function EventRow({ ev }: { ev: PublicBooking }) {
  return (
    <article className={`mc-ev ${ev.held ? "held" : ""}`}>
      <span className="mc-ev-time">{ev.start_time}–{ev.end_time}</span>
      <div className="mc-ev-main">
        <span className="mc-ev-title">{ev.event_name}</span>
        <div className="mc-ev-chips">
          {ev.held && <span className="mc-chip done">Проведено</span>}
          <span className="mc-chip">{ev.event_type}</span>
          <span className="mc-chip">{ev.room}</span>
          <span className="mc-chip alt">{ev.company}</span>
          <span className="mc-chip ghost">{ev.attendees} чел.</span>
        </div>
      </div>
    </article>
  );
}

export default function MonthEvents() {
  const [data, setData] = useState<MonthCalendar | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    api.monthCalendar().then(setData).catch(() => setData(null));
  }, []);

  const byDay = useMemo(() => {
    const map = new Map<string, PublicBooking[]>();
    for (const ev of data?.events ?? []) {
      const list = map.get(ev.event_date);
      if (list) list.push(ev);
      else map.set(ev.event_date, [ev]);
    }
    return map;
  }, [data]);

  // Land on today when it has events, otherwise the first busy day of the month.
  useEffect(() => {
    if (!data || selected) return;
    const today = todayIso();
    if (byDay.has(today)) setSelected(today);
    else {
      const first = data.events[0]?.event_date;
      if (first) setSelected(first);
    }
  }, [data, byDay, selected]);

  if (!data) return null;
  if (data.total === 0) return null; // nothing confirmed this month → hide the section

  const cells = buildCells(data.month);
  const today = todayIso();
  const dayEvents = selected ? byDay.get(selected) ?? [] : [];

  return (
    <section className="lp-events mc">
      <h2 className="lp-sec-title">Мероприятия месяца</h2>
      <p className="lp-sec-sub">Подтверждённые бронирования — {data.label.toLowerCase()}.</p>

      <div className="mc-summary">
        <span><b>{data.total}</b> {plural(data.total, ["мероприятие", "мероприятия", "мероприятий"])}</span>
        <span><b>{data.total_hours.toLocaleString("ru-RU")}</b> {hoursWord(data.total_hours)}</span>
        <span><b>{data.total_attendees.toLocaleString("ru-RU")}</b> {plural(data.total_attendees, ["участник", "участника", "участников"])}</span>
      </div>

      <div className="mc-grid" role="grid" aria-label={`Календарь: ${data.label}`}>
        {WEEKDAYS.map((w) => (
          <span key={w} className="mc-wd">{w}</span>
        ))}
        {cells.map((c, i) => {
          if (!c) return <span key={`b${i}`} className="mc-cell empty" aria-hidden />;
          const evs = byDay.get(c.iso) ?? [];
          const cls = [
            "mc-cell",
            evs.length ? "has" : "none",
            c.iso === today ? "today" : "",
            c.iso === selected ? "on" : "",
          ].filter(Boolean).join(" ");
          return (
            <button
              key={c.iso}
              type="button"
              className={cls}
              disabled={evs.length === 0}
              onClick={() => { setSelected(c.iso); haptic(); }}
              aria-label={`${c.day} ${MONTHS_GEN[Number(c.iso.slice(5, 7)) - 1]}: ${evs.length} ${plural(evs.length, ["мероприятие", "мероприятия", "мероприятий"])}`}
            >
              <span className="mc-day">{c.day}</span>
              {evs.length > 0 && (
                <span className="mc-dots">
                  {evs.slice(0, 3).map((e) => (
                    <i key={e.id} className={`mc-dot ${e.held ? "held" : ""}`} />
                  ))}
                  {evs.length > 3 && <i className="mc-more">+{evs.length - 3}</i>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="mc-day-panel">
          <div className="mc-day-head">
            {Number(selected.slice(8, 10))} {MONTHS_GEN[Number(selected.slice(5, 7)) - 1]}
            <span className="mc-day-count">{dayEvents.length} шт.</span>
          </div>
          <div className="mc-day-list">
            {dayEvents.map((ev) => <EventRow key={ev.id} ev={ev} />)}
          </div>
        </div>
      )}
    </section>
  );
}
