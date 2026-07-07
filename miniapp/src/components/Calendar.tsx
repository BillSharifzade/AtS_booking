import { useEffect, useMemo, useState } from "react";
import { api, ZoneSlot } from "../api";

export type SlotValue = { date: string; start: string; end: string };

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (t: string) => { const [h, m] = t.split(":"); return Number(h) * 60 + Number(m); };
const toHM = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const hm = (t: string) => t.slice(0, 5);

export default function Calendar({
  roomId,
  attendees,
  value,
  onChange,
}: {
  roomId: number;
  attendees: number;
  value: SlotValue;
  onChange: (v: SlotValue) => void;
}) {
  const [month, setMonth] = useState<Date>(() => {
    const base = value.date ? new Date(`${value.date}T00:00:00`) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [days, setDays] = useState<Record<string, boolean>>({});
  const [loadingDays, setLoadingDays] = useState(false);
  const [slots, setSlots] = useState<ZoneSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  useEffect(() => {
    if (!attendees) { setDays({}); return; }
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    let active = true;
    setLoadingDays(true);
    api.roomDays(roomId, ymd(first), ymd(last), attendees)
      .then((rows) => { if (active) setDays(Object.fromEntries(rows.map((r) => [r.date, r.available]))); })
      .catch(() => { if (active) setDays({}); })
      .finally(() => { if (active) setLoadingDays(false); });
    return () => { active = false; };
  }, [roomId, attendees, month]);

  useEffect(() => {
    if (!attendees || !value.date) { setSlots([]); return; }
    let active = true;
    setLoadingSlots(true);
    api.roomSlots(roomId, value.date, attendees)
      .then((s) => { if (active) setSlots(s); })
      .catch(() => { if (active) setSlots([]); })
      .finally(() => { if (active) setLoadingSlots(false); });
    return () => { active = false; };
  }, [roomId, attendees, value.date]);

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7;
    const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: (string | null)[] = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= total; d++) out.push(ymd(new Date(month.getFullYear(), month.getMonth(), d)));
    return out;
  }, [month]);

  const startTimes = useMemo(() => slots.map((s) => hm(s.start)), [slots]);
  const endTimes = useMemo(() => {
    if (!value.start) return [];
    const slot = slots.find((s) => hm(s.start) === value.start);
    if (!slot) return [];
    const out: string[] = [];
    for (let m = toMin(value.start) + 30; m <= toMin(hm(slot.end)); m += 30) out.push(toHM(m));
    return out;
  }, [slots, value.start]);

  const anyAvailable = Object.values(days).some(Boolean);
  const todayStr = ymd(new Date());

  return (
    <div className="cal">
      <div className="cal-head">
        <button type="button" className="cal-nav" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
        <span className="cal-month">{MONTHS[month.getMonth()]} {month.getFullYear()}</span>
        <button type="button" className="cal-nav" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
      </div>
      <div className={`cal-grid ${loadingDays ? "loading" : ""}`}>
        {WEEKDAYS.map((w) => <span key={w} className="cal-dow">{w}</span>)}
        {cells.map((d, i) => d == null
          ? <span key={`b${i}`} className="cal-day empty" />
          : (
            <button
              key={d}
              type="button"
              disabled={!days[d]}
              className={`cal-day ${value.date === d ? "selected" : ""} ${d === todayStr ? "today" : ""}`}
              onClick={() => onChange({ date: d, start: "", end: "" })}
            >
              {Number(d.slice(8, 10))}
            </button>
          ))}
      </div>
      {!loadingDays && !anyAvailable && <div className="hint">В этом месяце нет свободных дат. Полистайте вперёд.</div>}

      {value.date && (
        <div className="cal-times">
          {loadingSlots ? (
            <div className="hint">Загрузка времени…</div>
          ) : startTimes.length === 0 ? (
            <div className="hint">На этот день нет свободного времени.</div>
          ) : (
            <>
              <div className="cal-label">Начало</div>
              <div className="slot-row">
                {startTimes.map((t) => (
                  <button key={t} type="button" className={`slot ${value.start === t ? "on" : ""}`} onClick={() => onChange({ ...value, start: t, end: "" })}>{t}</button>
                ))}
              </div>
              {value.start && (
                <>
                  <div className="cal-label" style={{ marginTop: 12 }}>Окончание</div>
                  <div className="slot-row">
                    {endTimes.map((t) => (
                      <button key={t} type="button" className={`slot ${value.end === t ? "on" : ""}`} onClick={() => onChange({ ...value, end: t })}>{t}</button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
