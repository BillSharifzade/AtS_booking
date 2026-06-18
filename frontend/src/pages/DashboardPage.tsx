import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, DashboardSummary, Status } from "../api";
import { ROOM_STRUCT_LABELS, STATUS_LABELS } from "../labels";
import { CardSkeleton } from "../components/Skeleton";
import Stars from "../components/Stars";

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

const STATUS_ORDER: Status[] = ["new", "processing", "approved", "completed", "rejected", "archived"];

const num = (n: number) => n.toLocaleString("ru-RU");

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="bar-track">
      <div className={`bar-fill ${className ?? ""}`} style={{ width: `${Math.max(pct, value > 0 ? 4 : 0)}%` }} />
    </div>
  );
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

  const statusMax = Math.max(1, ...STATUS_ORDER.map((s) => data?.by_status[s] ?? 0));
  const zoneMax = Math.max(1, ...(data?.by_zone ?? []).map((z) => z.count));

  return (
    <div className="dash">
      <div className="page-head">
        <h2>Дашборд</h2>
        <div className="page-head-actions">
          <button className="primary" onClick={download} disabled={downloading}>
            {downloading ? "Готовлю…" : "↓ Скачать XLSX"}
          </button>
        </div>
      </div>

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
        <>
          <div className="stat-grid">
            {kpis.map((k) => (
              <div key={k.label} className={`stat-card tone-${k.tone}`}>
                <div className="stat-value">{num(k.value)}</div>
                <div className="stat-label">{k.label}</div>
              </div>
            ))}
          </div>

          <div className="stat-row-mini">
            <span><b>{num(data.total_attendees)}</b> участников суммарно</span>
            <span><b>{num(data.coffee_breaks)}</b> с кофе-брейком ({num(data.coffee_headcount)} чел.)</span>
            <span><b>{data.approval_rate != null ? `${Math.round(data.approval_rate * 100)}%` : "—"}</b> одобрено</span>
            <span><b>{data.completion_rate != null ? `${Math.round(data.completion_rate * 100)}%` : "—"}</b> проведено</span>
            <span><b>{data.avg_lead_hours != null ? `${Math.round(data.avg_lead_hours)} ч` : "—"}</b> средний срок до события</span>
            <span><b>{num(data.active_rooms)}</b> активных помещений · <b>{num(data.active_companies)}</b> компаний</span>
          </div>

          <div className="dash-grid">
            <div className="card">
              <h3>По статусам</h3>
              <div className="bar-list">
                {STATUS_ORDER.map((s) => {
                  const v = data.by_status[s] ?? 0;
                  return (
                    <div className="bar-item" key={s}>
                      <div className="bar-name">{STATUS_LABELS[s]}</div>
                      <Bar value={v} max={statusMax} className={`bar-${s}`} />
                      <div className="bar-val">{num(v)}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <h3>Загруженность зон</h3>
              {data.by_zone.length === 0 ? (
                <div className="dash-empty">За период нет заявок.</div>
              ) : (
                <div className="bar-list">
                  {data.by_zone.map((z) => (
                    <div className="bar-item" key={z.zone}>
                      <div className="bar-name">{z.zone}</div>
                      <Bar value={z.count} max={zoneMax} className="bar-zone" />
                      <div className="bar-val">{num(z.count)} · {num(z.attendees)} чел.</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Ближайшие мероприятия</h3>
                <span className="muted" style={{ fontSize: 12 }}>подтверждённые</span>
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
                        <div className="up-meta">{u.room} · {u.zone} · {num(u.attendees)} чел.</div>
                      </div>
                      <span className="up-arrow">→</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h3>Самые загруженные помещения</h3>
              {data.top_rooms.length === 0 ? (
                <div className="dash-empty">За период нет заявок.</div>
              ) : (
                <table className="mini-table">
                  <thead>
                    <tr><th>Помещение</th><th>Зона</th><th>Заявок</th><th>Часов</th></tr>
                  </thead>
                  <tbody>
                    {data.top_rooms.map((r) => (
                      <tr key={`${r.room}/${r.zone}`}>
                        <td>{r.room}</td>
                        <td><span className="badge zone">{r.zone}</span></td>
                        <td>{num(r.count)}</td>
                        <td>{r.hours.toLocaleString("ru-RU")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <h3>Качество обслуживания</h3>
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
                  <div style={{ color: "var(--muted)" }}>{num(data.feedback_count)}</div>
                </div>
              )}
            </div>

            <div className="card">
              <h3>Топ компаний</h3>
              {data.top_companies.length === 0 ? (
                <div className="dash-empty">За период нет заявок.</div>
              ) : (
                <div className="bar-list">
                  {data.top_companies.map((c) => (
                    <div className="bar-item" key={c.company}>
                      <div className="bar-name">{c.company}</div>
                      <Bar value={c.count} max={Math.max(1, ...data.top_companies.map((x) => x.count))} className="bar-zone" />
                      <div className="bar-val">{num(c.count)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h3>Расстановки</h3>
              {Object.keys(data.by_struct).length === 0 ? (
                <div className="dash-empty">Расстановка не указывалась.</div>
              ) : (
                <div className="bar-list">
                  {Object.entries(data.by_struct).sort((a, b) => b[1] - a[1]).map(([s, v]) => (
                    <div className="bar-item" key={s}>
                      <div className="bar-name">{ROOM_STRUCT_LABELS[s] ?? s}</div>
                      <Bar value={v} max={Math.max(1, ...Object.values(data.by_struct))} className="bar-approved" />
                      <div className="bar-val">{num(v)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
