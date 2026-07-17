import { useEffect, useMemo, useState } from "react";
import { api, ZoneSlot } from "../api";

export type SlotValue = { date: string; start: string; end: string };

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function pad(n: number) { return String(n).padStart(2, "0"); }
function ymd(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function toMin(t: string) { const [h, m] = t.split(":"); return Number(h) * 60 + Number(m); }
function toHM(min: number) { return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; }
function hm(t: string) { return t.slice(0, 5); }

export default function DateTimePicker({
  roomId,
  attendees,
  value,
  onChange,
}: {
  roomId: number | null;
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
  const [daysError, setDaysError] = useState<string | null>(null);
  const [slots, setSlots] = useState<ZoneSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  useEffect(() => {
    if (roomId == null || !attendees) { setDays({}); return; }
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    let active = true;
    setLoadingDays(true);
    setDaysError(null);
    api.roomDays(roomId, ymd(first), ymd(last), attendees)
      .then((rows) => { if (active) setDays(Object.fromEntries(rows.map((r) => [r.date, r.available]))); })
      .catch((e) => { if (active) { setDays({}); setDaysError((e as Error).message || "Не удалось загрузить даты"); } })
      .finally(() => { if (active) setLoadingDays(false); });
    return () => { active = false; };
  }, [roomId, attendees, month]);

  const anyAvailable = useMemo(() => Object.values(days).some(Boolean), [days]);

  useEffect(() => {
    if (roomId == null || !attendees || !value.date) { setSlots([]); return; }
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
    const lead = (first.getDay() + 6) % 7; // Monday-first
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

  const todayStr = ymd(new Date());

  if (roomId == null) {
    return <div className="dtp-hint">Сначала выберите помещение, чтобы увидеть свободные даты и время.</div>;
  }
  if (!attendees) {
    return <div className="dtp-hint">Укажите число участников, чтобы увидеть свободные даты.</div>;
  }

  return (
    <div className="dtp">
      <div className="dtp-cal">
        <div className="dtp-head">
          <button type="button" className="dtp-nav" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Предыдущий месяц">‹</button>
          <span className="dtp-month">{MONTHS[month.getMonth()]} {month.getFullYear()}</span>
          <button type="button" className="dtp-nav" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Следующий месяц">›</button>
        </div>
        <div className={`dtp-grid ${loadingDays ? "loading" : ""}`}>
          {WEEKDAYS.map((w) => <span key={w} className="dtp-dow">{w}</span>)}
          {cells.map((d, i) =>
            d == null ? (
              <span key={`b${i}`} className="dtp-day empty" />
            ) : (
              <button
                key={d}
                type="button"
                disabled={!days[d]}
                className={`dtp-day ${value.date === d ? "selected" : ""} ${d === todayStr ? "today" : ""}`}
                onClick={() => onChange({ date: d, start: "", end: "" })}
              >
                {Number(d.slice(8, 10))}
              </button>
            ),
          )}
        </div>
        {daysError ? (
          <div className="dtp-hint error-text">Не удалось загрузить свободные даты: {daysError}</div>
        ) : !loadingDays && !anyAvailable ? (
          <div className="dtp-hint">В этом помещении нет свободных дат в этом месяце для указанного числа участников. Попробуйте другой месяц или помещение.</div>
        ) : null}
      </div>

      <div className="dtp-times">
        {!value.date ? (
          <div className="dtp-hint">Выберите день в календаре.</div>
        ) : loadingSlots ? (
          <div className="dtp-hint">Загрузка свободного времени…</div>
        ) : startTimes.length === 0 ? (
          <div className="dtp-hint">На этот день нет свободного времени.</div>
        ) : (
          <>
            <label>Начало</label>
            <div className="slot-row">
              {startTimes.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`slot-btn ${value.start === t ? "on" : ""}`}
                  onClick={() => onChange({ ...value, start: t, end: "" })}
                >
                  {t}
                </button>
              ))}
            </div>
            {value.start && (
              <>
                <label style={{ marginTop: 14 }}>Окончание</label>
                <div className="slot-row">
                  {endTimes.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`slot-btn ${value.end === t ? "on" : ""}`}
                      onClick={() => onChange({ ...value, end: t })}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
