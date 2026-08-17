import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api, Booking, Company, NewBooking, Prop, Room, RoomStruct, Status } from "../api";
import { isAdmin } from "../auth";
import StatusBadge from "../components/StatusBadge";
import { TableSkeleton } from "../components/Skeleton";
import KanbanBoard from "../components/KanbanBoard";
import DateTimePicker from "../components/DateTimePicker";
import RoomStructPicker from "../components/RoomStructPicker";
import { COFFEE_TYPE_LABELS, EVENT_TYPES, GRADES, needsDepartment } from "../labels";
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
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

type FormState = {
  room_id: string;
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
  aim: string;
  grade: string;
  extra_services: string;
  position: string;
  department: string;
  target_employees: string;
  attendees: string;
  coffee_break: boolean;
  coffee_headcount: string;
  coffee_type: string;
  foreign_guests: boolean;
  is_urgent: boolean;
  // Registering an event that already took place (past slots, no notifications).
  allow_past: boolean;
};

const EMPTY_FORM: FormState = {
  room_id: "",
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
  aim: "",
  grade: "",
  extra_services: "",
  position: "",
  department: "",
  target_employees: "",
  attendees: "1",
  coffee_break: false,
  coffee_headcount: "",
  coffee_type: "standard",
  foreign_guests: false,
  is_urgent: false,
  allow_past: false,
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
  const [rooms, setRooms] = useState<Room[]>([]);
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

  // Equipment is held only for the hours of an event, so availability is re-fetched
  // whenever the chosen slot changes (an item busy in the morning is free in the
  // afternoon). Amounts already typed are clamped to what the new slot leaves free.
  useEffect(() => {
    if (!creating || !form.date || !form.start || !form.end) return;
    let alive = true;
    api
      .listProps({
        activeOnly: true,
        startsAt: `${form.date}T${form.start}:00Z`,
        endsAt: `${form.date}T${form.end}:00Z`,
      })
      .then((list) => {
        if (!alive) return;
        setPropsList(list);
        setForm((f) => {
          const capped: Record<number, string> = {};
          for (const [id, amt] of Object.entries(f.props)) {
            const picked = parseInt(amt, 10) || 0;
            if (!picked) continue;
            const free = list.find((p) => p.id === Number(id))?.available ?? picked;
            if (picked > free) { if (free > 0) capped[Number(id)] = String(free); }
            else capped[Number(id)] = String(picked);
          }
          return { ...f, props: capped };
        });
      })
      .catch(() => { /* keep the plain stock list; creation still validates */ });
    return () => { alive = false; };
  }, [creating, form.date, form.start, form.end]);

  const openCreate = async () => {
    setError(null);
    setForm(EMPTY_FORM);
    setCreating(true);
    const [rs, cs, ps] = await Promise.all([
      api.listRooms(),
      api.listCompanies(true),
      api.listProps({ activeOnly: true }),
    ]);
    // Every active room — including coffee-break rooms, which admins may book directly.
    const bookable = rs.filter((r) => r.is_active);
    setRooms(bookable);
    setCompanies(cs);
    setPropsList(ps);
    if (bookable[0]) setForm((f) => ({ ...f, room_id: String(bookable[0].id) }));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const props = Object.entries(form.props)
        .map(([id, amt]) => ({ prop_id: Number(id), amount: parseInt(amt, 10) || 0 }))
        .filter((p) => p.amount > 0);
      const payload: NewBooking = {
        room_id: parseInt(form.room_id, 10),
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
        aim: form.aim.trim() || null,
        grade: form.grade || null,
        extra_services: form.extra_services.trim() || null,
        position: form.position.trim() || null,
        department: askDepartment ? form.department.trim() || null : null,
        target_employees: form.target_employees.trim() || null,
        attendees: parseInt(form.attendees, 10),
        coffee_break: form.coffee_break,
        coffee_headcount: form.coffee_break && form.coffee_headcount ? parseInt(form.coffee_headcount, 10) : null,
        coffee_type: form.coffee_break ? form.coffee_type : null,
        foreign_guests: form.coffee_break ? form.foreign_guests : false,
        is_urgent: form.is_urgent,
        allow_past: form.allow_past,
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

  const [actingId, setActingId] = useState<number | null>(null);
  // Approve / reject straight from the list. Update just this row in place
  // (optimistically, reverting on error) instead of reloading the whole table — a
  // reload re-mounts every row and replays the staggered fadeUp entrance animation,
  // which looks glitchy.
  const actOnRow = async (id: number, optimistic: Status, call: () => Promise<Booking>) => {
    const prev = bookings.find((b) => b.id === id)?.status;
    setActingId(id);
    setBookings((bs) => bs.map((b) => (b.id === id ? { ...b, status: optimistic } : b)));
    try {
      const updated = await call();
      setBookings((bs) => bs.map((b) => (b.id === id ? { ...b, status: updated.status } : b)));
    } catch {
      if (prev) setBookings((bs) => bs.map((b) => (b.id === id ? { ...b, status: prev } : b)));
    } finally {
      setActingId(null);
    }
  };
  const confirmFromList = (id: number) => actOnRow(id, "approved", () => api.approve(id));
  const rejectFromList = (id: number) => {
    const reason = window.prompt("Причина отклонения?");
    if (reason == null) return; // cancelled
    const r = reason.trim();
    if (!r) return; // a reason is required by the backend
    actOnRow(id, "rejected", () => api.reject(id, r));
  };

  // Permanent deletion — offered only for archived bookings (the backend enforces it
  // too). Confirmed in a modal because it can't be undone.
  const [deleteTarget, setDeleteTarget] = useState<Booking | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.deleteBooking(deleteTarget.id);
      setBookings((bs) => bs.filter((x) => x.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  };

  // Whether this booking must state the department — an explicit per-company switch
  // (falls back to the name rule for a company typed by hand).
  const selectedCompany = companies.find((c) => String(c.id) === form.company_id) ?? null;
  const askDepartment = needsDepartment(selectedCompany, form.company);

  // The non-standard coffee break is offered in VIP rooms only; everywhere else the
  // choice is hidden and the booking goes out standard.
  const selectedRoom = rooms.find((r) => String(r.id) === form.room_id) ?? null;
  const coffeeChoice = !!selectedRoom?.is_vip;

  const valid =
    form.room_id && form.date && form.start && form.end && form.company && form.contact_name &&
    form.phone && form.customer_telegram_id && form.event_type && form.event_name && form.attendees &&
    (!askDepartment || form.department.trim());

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
              {admin && <th>Действия</th>}
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
                {admin && (() => {
                  const canAct = b.status === "new" || b.status === "processing";
                  return (
                    <td onClick={(e) => e.stopPropagation()} style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                      {canAct ? (
                        <span className="row-actions">
                          <button
                            className="icon-btn-sq approve"
                            title="Подтвердить"
                            disabled={actingId === b.id}
                            onClick={(e) => { e.stopPropagation(); confirmFromList(b.id); }}
                          >✓</button>
                          <button
                            className="icon-btn-sq reject"
                            title="Отклонить"
                            disabled={actingId === b.id}
                            onClick={(e) => { e.stopPropagation(); rejectFromList(b.id); }}
                          >✕</button>
                        </span>
                      ) : b.status === "approved" || b.status === "completed" ? (
                        <span className="tick-done" title="Подтверждён">✓</span>
                      ) : b.status === "rejected" ? (
                        <span className="cross-done" title="Отклонена">✕</span>
                      ) : b.status === "archived" ? (
                        <button
                          className="icon-btn-sq delete"
                          title="Удалить заявку полностью"
                          disabled={actingId === b.id}
                          onClick={(e) => { e.stopPropagation(); setDeleteError(null); setDeleteTarget(b); }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
                          </svg>
                        </button>
                      ) : "—"}
                    </td>
                  );
                })()}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      </>
      )}

      {deleteTarget && createPortal(
        <div className="modal-overlay" onClick={() => !deleteBusy && setDeleteTarget(null)}>
          <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Удалить заявку №{deleteTarget.id}?</h3>
              <button className="icon-close" onClick={() => setDeleteTarget(null)} aria-label="Закрыть">✕</button>
            </div>
            <div className="modal-body">
              <p style={{ margin: 0 }}>
                «{deleteTarget.event_name}» — {deleteTarget.company}, {fmt(deleteTarget.starts_at)}.
              </p>
              <span className="field-hint">
                Заявка будет удалена безвозвратно вместе с историей статусов, отзывом, чек-листом
                и заявкой на оборудование. Запись о самом удалении останется в журнале действий.
              </span>
              {deleteError && <div className="error">{deleteError}</div>}
            </div>
            <div className="modal-foot">
              <button onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>Отмена</button>
              <button className="danger" onClick={confirmDelete} disabled={deleteBusy}>
                {deleteBusy ? "Удаление…" : "Удалить навсегда"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {creating && createPortal(
        <div className="modal-overlay" onClick={() => !busy && setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Новая заявка</h3>
              <button className="icon-close" onClick={() => setCreating(false)} aria-label="Закрыть">✕</button>
            </div>
            <div className="modal-body">
              {rooms.length === 0 ? (
                <div className="empty">Нет помещений. Создайте помещение в разделе «Помещения».</div>
              ) : (
                <>
                  <div className="row2">
                    <div className="field">
                      <label>Помещение</label>
                      <select value={form.room_id} onChange={(e) => {
                        // A non-VIP room offers no coffee-break choice — drop one
                        // picked while a VIP room was selected.
                        const room = rooms.find((r) => String(r.id) === e.target.value);
                        setForm({
                          ...form, room_id: e.target.value, date: "", start: "", end: "",
                          coffee_type: room?.is_vip ? form.coffee_type : "standard",
                        });
                      }}>
                        {rooms.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} · {r.zone_name} · до {r.capacity}{r.is_vip ? " · VIP" : ""}{r.is_coffee_break ? " · кофе-брейк" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field"><label>Участников</label>
                      <input inputMode="numeric" value={form.attendees}
                        onChange={(e) => setForm({ ...form, attendees: e.target.value, date: "", start: "", end: "" })} /></div>
                  </div>
                  <div className="field">
                    <label>Дата и время</label>
                    <label style={{ fontWeight: 400 }}>
                      <input type="checkbox" style={{ width: "auto", marginRight: 8 }}
                        checked={form.allow_past}
                        onChange={(e) => setForm({ ...form, allow_past: e.target.checked, date: "", start: "", end: "" })} />
                      Задним числом (мероприятие уже прошло)
                    </label>
                    <DateTimePicker
                      roomId={form.room_id ? parseInt(form.room_id, 10) : null}
                      attendees={attendeesNum}
                      allowPast={form.allow_past}
                      value={{ date: form.date, start: form.start, end: form.end }}
                      onChange={(v) => setForm({ ...form, date: v.date, start: v.start, end: v.end })}
                    />
                    <span className="field-hint">
                      {form.allow_past
                        ? "Доступны прошедшие даты. Заказчику и в группу AtS уведомления не отправляются — заявка вносится как запись."
                        : "Показаны свободные даты и время для выбранного помещения."}
                    </span>
                  </div>
                  <div className="row2">
                    <div className="field"><label>Название мероприятия</label>
                      <input value={form.event_name} onChange={(e) => setForm({ ...form, event_name: e.target.value })} /></div>
                    <div className="field"><label>Тип мероприятия</label>
                      <select value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })}>
                        <option value="">— выберите тип —</option>
                        {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select></div>
                  </div>
                  <div className="field"><label>Должность заявителя</label>
                    <input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="напр. HR-менеджер" /></div>
                  {askDepartment && (
                    <div className="field"><label>Департамент / Отдел</label>
                      <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="напр. Департамент цифровизации" /></div>
                  )}
                  <div className="field"><label>Для каких сотрудников предназначен тренинг</label>
                    <textarea rows={2} value={form.target_employees} onChange={(e) => setForm({ ...form, target_employees: e.target.value })}
                      placeholder="напр. руководители отделов продаж" /></div>
                  <div className="field"><label>Описание</label>
                    <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>

                  <div className="row2">
                    <div className="field"><label>Цель бронирования</label>
                      <input value={form.aim} onChange={(e) => setForm({ ...form, aim: e.target.value })} placeholder="напр. развитие навыков сотрудников" /></div>
                    <div className="field"><label>Грейд заявителя</label>
                      <select value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })}>
                        <option value="">— не указан —</option>
                        {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="field"><label>Дополнительные услуги</label>
                    <textarea rows={2} value={form.extra_services} onChange={(e) => setForm({ ...form, extra_services: e.target.value })}
                      placeholder="напр. расстановка мебели, техническая поддержка на месте, другое" /></div>

                  <div className="field">
                    <label>Расстановка</label>
                    <RoomStructPicker value={form.room_struct || null} onChange={(v) => setForm({ ...form, room_struct: v })} />
                  </div>

                  {propsList.length > 0 && (
                    <div className="field">
                      <label>Оборудование</label>
                      {propsList.map((p) => {
                        const free = p.available ?? p.amount;
                        return (
                          <div key={p.id} className="prop-pick-row">
                            <span className="prop-name">{p.name} <span className="prop-unit">· доступно {free} {p.unit || "шт."}</span></span>
                            <input
                              inputMode="numeric"
                              placeholder="0"
                              value={form.props[p.id] ?? ""}
                              max={free}
                              onChange={(e) => setForm({ ...form, props: { ...form.props, [p.id]: e.target.value } })}
                            />
                            <span className="prop-unit">{p.unit || "шт."}</span>
                          </div>
                        );
                      })}
                      <span className="field-hint">
                        {form.date && form.start && form.end
                          ? `Доступно на выбранное время ${form.start}–${form.end}: оборудование занято только на часы мероприятия и освобождается после него.`
                          : "Выберите дату и время — количество пересчитается под часы мероприятия."}
                      </span>
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
                          {coffeeChoice ? (
                            <select value={form.coffee_type} onChange={(e) => setForm({ ...form, coffee_type: e.target.value })}>
                              <option value="standard">{COFFEE_TYPE_LABELS.standard}</option>
                              <option value="other">{COFFEE_TYPE_LABELS.other}</option>
                            </select>
                          ) : (
                            <>
                              <input value={COFFEE_TYPE_LABELS.standard} disabled />
                              <span className="field-hint">Другой состав доступен только в VIP-аудиториях.</span>
                            </>
                          )}
                        </div>
                      </div>
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
              <button className="primary" onClick={submit} disabled={busy || !valid || rooms.length === 0}>
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
