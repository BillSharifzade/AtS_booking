import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api, Booking, Company, NewBooking, Prop, RoomStruct, Status, Zone } from "../api";
import { isAdmin } from "../auth";
import StatusBadge from "../components/StatusBadge";
import { TableSkeleton } from "../components/Skeleton";
import KanbanBoard from "../components/KanbanBoard";
import DateTimePicker from "../components/DateTimePicker";
import RoomStructPicker from "../components/RoomStructPicker";
import { useNotifications } from "../notifications";

const VIEW_KEY = "ats_bookings_view";
type View = "kanban" | "table";

const STATUS_FILTERS: { value: Status | "all"; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "new", label: "Новые" },
  { value: "approved", label: "Подтверждены" },
  { value: "rejected", label: "Отклонены" },
  { value: "completed", label: "Завершены" },
  { value: "archived", label: "Архив" },
];

function fmt(dt: string) {
  const d = new Date(dt);
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type FormState = {
  zone_id: string;
  date: string;
  start: string;
  end: string;
  company: string;
  company_id: string;
  room_struct: RoomStruct | "";
  props: Record<number, string>; // prop_id -> amount (string)
  contact_name: string;
  phone: string;
  customer_telegram_id: string;
  customer_username: string;
  event_type: string;
  event_name: string;
  description: string;
  attendees: string;
  coffee_break: boolean;
  coffee_headcount: string;
  coffee_type: string;
  coffee_other: string;
  foreign_guests: boolean;
  is_urgent: boolean;
};

const EMPTY_FORM: FormState = {
  zone_id: "",
  date: "",
  start: "",
  end: "",
  company: "",
  company_id: "",
  room_struct: "",
  props: {},
  contact_name: "",
  phone: "",
  customer_telegram_id: "",
  customer_username: "",
  event_type: "",
  event_name: "",
  description: "",
  attendees: "1",
  coffee_break: false,
  coffee_headcount: "",
  coffee_type: "standard",
  coffee_other: "",
  foreign_guests: false,
  is_urgent: false,
};

export default function BookingsPage() {
  const nav = useNavigate();
  const { unreadFor } = useNotifications();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState<Status | "all">("new");
  const [loading, setLoading] = useState(true);
  const admin = isAdmin();
  const [view, setView] = useState<View>(() => (localStorage.getItem(VIEW_KEY) as View) || "kanban");
  // Viewers (read-only) get the table only — the kanban board mutates via drag-and-drop.
  const shownView: View = admin ? view : "table";
  const [refreshToken, setRefreshToken] = useState(0);

  const [creating, setCreating] = useState(false);
  const [zones, setZones] = useState<Zone[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [propsList, setPropsList] = useState<Prop[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api
      .listBookings(filter === "all" ? {} : { status: filter })
      .then(setBookings)
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    if (shownView === "table") load();
  }, [filter, shownView]);

  const setViewPersisted = (v: View) => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  const openCreate = async () => {
    setError(null);
    setForm(EMPTY_FORM);
    setCreating(true);
    const [zs, cs, ps] = await Promise.all([
      api.listZones(),
      api.listCompanies(true),
      api.listProps({ activeOnly: true }),
    ]);
    setZones(zs);
    setCompanies(cs);
    setPropsList(ps);
    // Prefer the first zone that actually has rooms — auto-selecting an empty zone
    // would leave the date picker with every day disabled and no way to proceed.
    const firstUsable = zs.find((z) => z.room_count > 0) ?? zs[0];
    if (firstUsable) setForm((f) => ({ ...f, zone_id: String(firstUsable.id) }));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const props = Object.entries(form.props)
        .map(([id, amt]) => ({ prop_id: Number(id), amount: parseInt(amt, 10) || 0 }))
        .filter((p) => p.amount > 0);
      const payload: NewBooking = {
        zone_id: parseInt(form.zone_id, 10),
        company: form.company.trim(),
        company_id: form.company_id ? parseInt(form.company_id, 10) : null,
        room_struct: form.room_struct || null,
        props,
        contact_name: form.contact_name.trim(),
        phone: form.phone.trim(),
        customer_telegram_id: parseInt(form.customer_telegram_id, 10),
        customer_username: form.customer_username.trim() || null,
        event_type: form.event_type.trim(),
        event_name: form.event_name.trim(),
        description: form.description.trim() || null,
        attendees: parseInt(form.attendees, 10),
        coffee_break: form.coffee_break,
        coffee_headcount: form.coffee_break && form.coffee_headcount ? parseInt(form.coffee_headcount, 10) : null,
        coffee_type: form.coffee_break ? form.coffee_type : null,
        coffee_other: form.coffee_break && form.coffee_type === "other" ? form.coffee_other.trim() || null : null,
        foreign_guests: form.coffee_break ? form.foreign_guests : false,
        is_urgent: form.is_urgent,
        starts_at: `${form.date}T${form.start}:00Z`,
        ends_at: `${form.date}T${form.end}:00Z`,
      };
      await api.createBooking(payload);
      setCreating(false);
      setRefreshToken((t) => t + 1);
      if (view === "table") {
        setFilter("new");
        load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const valid =
    form.zone_id && form.date && form.start && form.end && form.company && form.contact_name &&
    form.phone && form.customer_telegram_id && form.event_type && form.event_name && form.attendees;

  const attendeesNum = parseInt(form.attendees, 10) || 0;

  return (
    <div>
      <div className="page-head">
        <h2>Заявки</h2>
        <div className="page-head-actions">
          {admin && (
            <div className="view-toggle">
              <button className={view === "kanban" ? "on" : ""} onClick={() => setViewPersisted("kanban")}>Канбан</button>
              <button className={view === "table" ? "on" : ""} onClick={() => setViewPersisted("table")}>Таблица</button>
            </div>
          )}
          {admin && <button className="primary" onClick={openCreate}>+ Создать заявку</button>}
        </div>
      </div>

      {shownView === "kanban" ? (
        <KanbanBoard refreshToken={refreshToken} />
      ) : (
      <>
      <div className="toolbar">
        <div className="chips">
          {STATUS_FILTERS.map((f) => (
            <span
              key={f.value}
              className={`chip ${filter === f.value ? "active" : ""}`}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </span>
          ))}
        </div>
      </div>
      {loading ? (
        <TableSkeleton cols={7} rows={6} />
      ) : bookings.length === 0 ? (
        <div className="empty">Заявок не найдено.</div>
      ) : (
        <table className="clickable-rows">
          <thead>
            <tr>
              <th>№</th>
              <th>Мероприятие</th>
              <th>Компания</th>
              <th>Начало</th>
              <th>Окончание</th>
              <th>Чел.</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => (
              <tr key={b.id} onClick={() => nav(`/bookings/${b.id}`)}>
                <td>{b.id}</td>
                <td>
                  <div>{b.event_name}</div>
                  {b.is_urgent && b.status !== "archived" && (
                    <div className="urgent-line"><span className="badge urgent">срочно</span></div>
                  )}
                </td>
                <td>
                  {b.company}
                  {unreadFor(b.customer_telegram_id) > 0 && (
                    <span className="chat-dot" title="Новые сообщения в чате">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z"/></svg>
                      {unreadFor(b.customer_telegram_id)}
                    </span>
                  )}
                </td>
                <td>{fmt(b.starts_at)}</td>
                <td>{fmt(b.ends_at)}</td>
                <td>{b.attendees}</td>
                <td>
                  <StatusBadge status={b.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      </>
      )}

      {creating && createPortal(
        <div className="modal-overlay" onClick={() => !busy && setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Новая заявка</h3>
              <button className="icon-close" onClick={() => setCreating(false)} aria-label="Закрыть">✕</button>
            </div>
            <div className="modal-body">
              {zones.length === 0 ? (
                <div className="empty">Нет зон. Создайте зону и помещения в разделе «Помещения».</div>
              ) : (
                <>
                  <div className="row2">
                    <div className="field">
                      <label>Зона</label>
                      <select value={form.zone_id} onChange={(e) => setForm({ ...form, zone_id: e.target.value, date: "", start: "", end: "" })}>
                        {zones.map((z) => (
                          <option key={z.id} value={z.id}>{z.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field"><label>Участников</label>
                      <input inputMode="numeric" value={form.attendees}
                        onChange={(e) => setForm({ ...form, attendees: e.target.value, date: "", start: "", end: "" })} /></div>
                  </div>
                  <div className="field">
                    <label>Дата и время</label>
                    <DateTimePicker
                      zoneId={form.zone_id ? parseInt(form.zone_id, 10) : null}
                      attendees={attendeesNum}
                      value={{ date: form.date, start: form.start, end: form.end }}
                      onChange={(v) => setForm({ ...form, date: v.date, start: v.start, end: v.end })}
                    />
                    <span className="field-hint">Система подберёт свободное помещение нужной вместимости в этой зоне.</span>
                  </div>
                  <div className="row2">
                    <div className="field"><label>Название мероприятия</label>
                      <input value={form.event_name} onChange={(e) => setForm({ ...form, event_name: e.target.value })} /></div>
                    <div className="field"><label>Тип мероприятия</label>
                      <input value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })} placeholder="совещание, тренинг…" /></div>
                  </div>
                  <div className="field"><label>Описание</label>
                    <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>

                  <div className="field">
                    <label>Расстановка</label>
                    <RoomStructPicker value={form.room_struct || null} onChange={(v) => setForm({ ...form, room_struct: v })} />
                  </div>

                  {propsList.length > 0 && (
                    <div className="field">
                      <label>Оборудование</label>
                      {propsList.map((p) => (
                        <div key={p.id} className="prop-pick-row">
                          <span className="prop-name">{p.name} <span className="prop-unit">· доступно {p.amount} {p.unit || "шт."}</span></span>
                          <input
                            inputMode="numeric"
                            placeholder="0"
                            value={form.props[p.id] ?? ""}
                            max={p.amount}
                            onChange={(e) => setForm({ ...form, props: { ...form.props, [p.id]: e.target.value } })}
                          />
                          <span className="prop-unit">{p.unit || "шт."}</span>
                        </div>
                      ))}
                      <span className="field-hint">Укажите нужное количество. При нехватке заявку не получится создать.</span>
                    </div>
                  )}
                  <div className="row2">
                    <div className="field"><label>Компания</label>
                      {companies.length > 0 ? (
                        <select
                          value={form.company_id}
                          onChange={(e) => {
                            const id = e.target.value;
                            const c = companies.find((x) => String(x.id) === id);
                            setForm({ ...form, company_id: id, company: c ? c.name : form.company });
                          }}
                        >
                          <option value="">— выберите компанию —</option>
                          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      ) : (
                        <input value={form.company} placeholder="Название компании" onChange={(e) => setForm({ ...form, company: e.target.value })} />
                      )}
                    </div>
                    <div className="field"><label>Контактное лицо</label>
                      <input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></div>
                  </div>
                  <div className="row2">
                    <div className="field"><label>Телефон</label>
                      <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                    <div className="field"><label>Telegram ID заказчика</label>
                      <input inputMode="numeric" value={form.customer_telegram_id} onChange={(e) => setForm({ ...form, customer_telegram_id: e.target.value })} placeholder="напр. 1320166360" /></div>
                  </div>
                  <div className="field"><label>Telegram @username (необязательно)</label>
                    <input value={form.customer_username} onChange={(e) => setForm({ ...form, customer_username: e.target.value })} /></div>
                  <div className="field" style={{ marginBottom: form.coffee_break ? 8 : undefined }}>
                    <label>
                      <input type="checkbox" style={{ width: "auto", marginRight: 8 }}
                        checked={form.coffee_break} onChange={(e) => setForm({ ...form, coffee_break: e.target.checked })} />
                      Кофе-брейк
                    </label>
                  </div>
                  {form.coffee_break && (
                    <>
                      <div className="row2">
                        <div className="field"><label>Кол-во кофе-брейков</label>
                          <input inputMode="numeric" value={form.coffee_headcount} onChange={(e) => setForm({ ...form, coffee_headcount: e.target.value })} /></div>
                        <div className="field"><label>Что нужно</label>
                          <select value={form.coffee_type} onChange={(e) => setForm({ ...form, coffee_type: e.target.value })}>
                            <option value="standard">Стандартный (печенье, кофе, чай, конфеты)</option>
                            <option value="other">Другое</option>
                          </select>
                        </div>
                      </div>
                      {form.coffee_type === "other" && (
                        <div className="field"><label>Опишите, что нужно</label>
                          <input value={form.coffee_other} onChange={(e) => setForm({ ...form, coffee_other: e.target.value })} placeholder="напр. фрукты, сэндвичи…" /></div>
                      )}
                      <div className="field">
                        <label>
                          <input type="checkbox" style={{ width: "auto", marginRight: 8 }}
                            checked={form.foreign_guests} onChange={(e) => setForm({ ...form, foreign_guests: e.target.checked })} />
                          Гости иностранцы
                        </label>
                        <span className="field-hint">Кофе-брейк организуется прямо в зале мероприятия — отдельное помещение не требуется.</span>
                      </div>
                    </>
                  )}
                  <div className="field">
                    <label>
                      <input type="checkbox" style={{ width: "auto", marginRight: 8 }}
                        checked={form.is_urgent} onChange={(e) => setForm({ ...form, is_urgent: e.target.checked })} />
                      Срочная заявка
                    </label>
                    <span className="field-hint">Заявки менее чем за 2 суток помечаются срочными автоматически.</span>
                  </div>
                  {error && <div className="error">{error}</div>}
                </>
              )}
            </div>
            <div className="modal-foot">
              <button onClick={() => setCreating(false)} disabled={busy}>Отмена</button>
              <button className="primary" onClick={submit} disabled={busy || !valid || zones.length === 0}>
                {busy ? "Создание…" : "Создать заявку"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
