import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, DashboardSummary, Status } from "../api";
import { ROOM_STRUCT_LABELS, STATUS_LABELS } from "../labels";
import { CardSkeleton } from "../components/Skeleton";
import Stars from "../components/Stars";
import ChartCard from "../components/charts/ChartCard";
import HBarChart from "../components/charts/HBarChart";
import StatusChart, { StatusDatum } from "../components/charts/StatusChart";
import StructDonut, { StructDatum } from "../components/charts/StructDonut";
import TrendChart from "../components/charts/TrendChart";
import WeekdayChart from "../components/charts/WeekdayChart";
import { ru } from "../components/charts/theme";

// ---- date helpers (YYYY-MM-DD in local wall-clock; backend treats these as UTC days) ----
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

type Preset = "7d" | "30d" | "month" | "all" | "custom";

function presetRange(p: Exclude<Preset, "custom">): { from: string; to: string } {
  const today = new Date();
  if (p === "all") return { from: "", to: "" };
  if (p === "7d") return { from: iso(addDays(today, -6)), to: iso(today) };
  if (p === "30d") return { from: iso(addDays(today, -29)), to: iso(today) };
  // month
  return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
}

const PRESETS: { key: Exclude<Preset, "custom">; label: string }[] = [
  { key: "7d", label: "7 дней" },
  { key: "30d", label: "30 дней" },
  { key: "month", label: "Этот месяц" },
  { key: "all", label: "Всё время" },
];

const STATUS_ORDER: Status[] = ["new", "approved", "completed", "rejected", "archived"];
const RU_WEEKDAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

const hrs = (n: number) => n.toLocaleString("ru-RU");

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

export default function DashboardPage() {
  const nav = useNavigate();
  const [preset, setPreset] = useState<Preset>("30d");
  const [range, setRange] = useState(() => presetRange("30d"));
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const choosePreset = (p: Exclude<Preset, "custom">) => {
    setPreset(p);
    setRange(presetRange(p));
  };

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .dashboard(range.from || undefined, range.to || undefined)
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [range.from, range.to]);
  useEffect(load, [load]);

  const download = async () => {
    setDownloading(true);
    try {
      await api.downloadReport(range.from || undefined, range.to || undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const pending = (data?.by_status.new ?? 0) + (data?.by_status.processing ?? 0);
  const kpis = useMemo(
    () => [
      { label: "Всего за период", value: data?.total ?? 0, tone: "accent" },
      { label: "Ожидают обработки", value: pending, tone: "new" },
      { label: "Подтверждены", value: data?.by_status.approved ?? 0, tone: "approved" },
      { label: "Завершены", value: data?.by_status.completed ?? 0, tone: "completed" },
      { label: "Отклонены", value: data?.by_status.rejected ?? 0, tone: "rejected" },
      { label: "Срочные", value: data?.urgent ?? 0, tone: "urgent" },
    ],
    [data, pending],
  );

  const statusData: StatusDatum[] = useMemo(
    () => STATUS_ORDER.map((s) => ({ status: s, label: STATUS_LABELS[s], count: data?.by_status[s] ?? 0 })),
    [data],
  );
  const structData: StructDatum[] = useMemo(
    () =>
      Object.entries(data?.by_struct ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({ key, label: ROOM_STRUCT_LABELS[key] ?? key, count })),
    [data],
  );
  const roomBars = useMemo(
    () =>
      (data?.top_rooms ?? []).map((r) => ({
        name: r.room,
        value: r.hours,
        tipTitle: `${r.room} · ${r.zone}`,
        tip: [
          { label: "часов", value: hrs(r.hours) },
          { label: "заявок", value: ru(r.count) },
          { label: "участников", value: ru(r.attendees) },
        ],
      })),
    [data],
  );
  const zoneBars = useMemo(
    () =>
      (data?.by_zone ?? []).map((z) => ({
        name: z.zone,
        value: z.count,
        tip: [
          { label: "заявок", value: ru(z.count) },
          { label: "участников", value: ru(z.attendees) },
        ],
      })),
    [data],
  );

  const weekdayTotal = (data?.by_weekday ?? []).reduce((s, w) => s + w.count, 0);

  return (
    <div className="dash">
      <div className="page-head">
        <h2>Аналитика</h2>
        <div className="page-head-actions">
          <button className="primary" onClick={download} disabled={downloading}>
            {downloading ? "Готовлю…" : "↓ Скачать XLSX"}
          </button>
        </div>
      </div>

      {/* One filter row scoping everything below it. */}
      <div className="dash-period">
        <div className="chips">
          {PRESETS.map((p) => (
            <span key={p.key} className={`chip ${preset === p.key ? "active" : ""}`} onClick={() => choosePreset(p.key)}>
              {p.label}
            </span>
          ))}
        </div>
        <div className="dash-range">
          <input
            type="date"
            value={range.from}
            max={range.to || undefined}
            onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, from: e.target.value })); }}
          />
          <span className="dash-range-sep">—</span>
          <input
            type="date"
            value={range.to}
            min={range.from || undefined}
            onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, to: e.target.value })); }}
          />
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {loading && !data ? (
        <div className="skeleton-grid" style={{ marginTop: 8 }}>
          <CardSkeleton lines={5} />
          <CardSkeleton lines={5} />
        </div>
      ) : !data ? (
        <div className="empty">Нет данных.</div>
      ) : (
        // Hold the previous render at reduced opacity on refetch — no skeleton flash.
        <div className={loading ? "dash-body refetching" : "dash-body"}>
          <div className="stat-grid">
            {kpis.map((k) => (
              <div key={k.label} className={`stat-card tone-${k.tone}`}>
                <div className="stat-value">{ru(k.value)}</div>
                <div className="stat-label">{k.label}</div>
              </div>
            ))}
          </div>

          <div className="stat-row-mini">
            <span><b>{hrs(data.total_hours)} ч</b> забронировано всего</span>
            <span><b>{data.bookings_per_week != null ? hrs(data.bookings_per_week) : "—"}</b> заявок в неделю</span>
            <span><b>{data.avg_booking_hours != null ? `${hrs(data.avg_booking_hours)} ч` : "—"}</b> средняя длительность</span>
            <span><b>{ru(data.total_attendees)}</b> участников суммарно</span>
            <span><b>{ru(data.coffee_breaks)}</b> с кофе-брейком (всего {ru(data.coffee_headcount)} кофе-брейков)</span>
            <span><b>{data.approval_rate != null ? `${Math.round(data.approval_rate * 100)}%` : "—"}</b> одобрено</span>
            <span><b>{data.completion_rate != null ? `${Math.round(data.completion_rate * 100)}%` : "—"}</b> проведено</span>
            <span><b>{data.avg_lead_hours != null ? `${Math.round(data.avg_lead_hours)} ч` : "—"}</b> средний срок до события</span>
            <span><b>{ru(data.active_rooms)}</b> активных помещений · <b>{ru(data.active_companies)}</b> компаний</span>
          </div>

          <div className="dash-grid">
            <ChartCard
              title="Частота бронирований"
              note={data.trend_bucket === "month" ? "по месяцам" : "по дням"}
              wide
              empty={data.trend.length === 0}
              table={
                <table className="mini-table">
                  <thead><tr><th>Период</th><th className="n">Заявок</th><th className="n">Часов</th></tr></thead>
                  <tbody>
                    {data.trend.map((p) => (
                      <tr key={p.key}><td>{p.label}</td><td className="n">{ru(p.count)}</td><td className="n">{hrs(p.hours)}</td></tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <TrendChart points={data.trend} />
            </ChartCard>

            <ChartCard
              title="По статусам"
              empty={data.total === 0}
              table={
                <table className="mini-table">
                  <thead><tr><th>Статус</th><th className="n">Заявок</th></tr></thead>
                  <tbody>
                    {statusData.map((s) => (
                      <tr key={s.status}><td>{s.label}</td><td className="n">{ru(s.count)}</td></tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <StatusChart data={statusData} />
            </ChartCard>

            <ChartCard
              title="По дням недели"
              empty={weekdayTotal === 0}
              table={
                <table className="mini-table">
                  <thead><tr><th>День</th><th className="n">Заявок</th><th className="n">Часов</th></tr></thead>
                  <tbody>
                    {data.by_weekday.map((w) => (
                      <tr key={w.weekday}><td>{RU_WEEKDAYS[w.weekday]}</td><td className="n">{ru(w.count)}</td><td className="n">{hrs(w.hours)}</td></tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <WeekdayChart data={data.by_weekday} />
            </ChartCard>

            <ChartCard
              title="По помещениям"
              note="забронированные часы"
              empty={roomBars.length === 0}
              table={
                <table className="mini-table">
                  <thead><tr><th>Помещение</th><th>Зона</th><th className="n">Заявок</th><th className="n">Часов</th><th className="n">Участников</th></tr></thead>
                  <tbody>
                    {data.top_rooms.map((r) => (
                      <tr key={`${r.room}/${r.zone}`}>
                        <td>{r.room}</td>
                        <td><span className="badge zone">{r.zone}</span></td>
                        <td className="n">{ru(r.count)}</td>
                        <td className="n">{hrs(r.hours)}</td>
                        <td className="n">{ru(r.attendees)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <HBarChart data={roomBars} valueLabel={(v) => `${hrs(v)} ч`} />
            </ChartCard>

            <ChartCard title="Загруженность зон" note="заявок" empty={zoneBars.length === 0}>
              <HBarChart data={zoneBars} valueLabel={(v) => ru(v)} nameWidth={92} />
            </ChartCard>

            <ChartCard title="Расстановки" empty={structData.length === 0}>
              <StructDonut data={structData} />
            </ChartCard>

            <section className="card">
              <div className="card-head"><h3>По компаниям</h3></div>
              {data.top_companies.length === 0 ? (
                <div className="dash-empty">За период нет заявок.</div>
              ) : (
                <table className="mini-table">
                  <thead>
                    <tr><th>Компания</th><th className="n">Заявок</th><th className="n">Часов</th><th className="n">Участников</th></tr>
                  </thead>
                  <tbody>
                    {data.top_companies.map((c) => (
                      <tr key={c.company}>
                        <td>{c.company}</td>
                        <td className="n">{ru(c.count)}</td>
                        <td className="n">{hrs(c.hours)}</td>
                        <td className="n">{ru(c.attendees)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="card">
              <div className="card-head"><h3>Качество обслуживания</h3></div>
              {data.feedback_count === 0 ? (
                <div className="dash-empty">Отзывов за период нет.</div>
              ) : (
                <div className="kv" style={{ gridTemplateColumns: "auto 1fr", rowGap: 12 }}>
                  {([["Общая", data.avg_rating], ["Помещение", data.avg_room_rating], ["Сервис", data.avg_service_rating], ["Оборудование", data.avg_props_rating]] as const).map(([label, v]) => (
                    <div key={label} style={{ display: "contents" }}>
                      <div className="k">{label}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Stars value={v != null ? Math.round(v) : null} showNum={false} />
                        <span className="rating-num">{v != null ? v.toLocaleString("ru-RU") : "—"}</span>
                      </div>
                    </div>
                  ))}
                  <div className="k" style={{ color: "var(--muted-2)" }}>Отзывов</div>
                  <div style={{ color: "var(--muted)" }}>{ru(data.feedback_count)}</div>
                </div>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h3>Ближайшие мероприятия</h3>
                <span className="chart-note">подтверждённые</span>
              </div>
              {data.upcoming.length === 0 ? (
                <div className="dash-empty">Запланированных мероприятий нет.</div>
              ) : (
                <div className="up-list">
                  {data.upcoming.map((u) => (
                    <button className="up-item" key={u.id} onClick={() => nav(`/bookings/${u.id}`)}>
                      <div className="up-when">{fmtDateTime(u.starts_at)}</div>
                      <div className="up-main">
                        <div className="up-title">
                          {u.event_name}
                          {u.is_urgent && <span className="badge urgent">срочно</span>}
                        </div>
                        <div className="up-meta">{u.room} · {u.zone} · {ru(u.attendees)} чел.</div>
                      </div>
                      <span className="up-arrow">→</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
