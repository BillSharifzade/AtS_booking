import { useEffect, useMemo, useState } from "react";
import { api, Bootstrap, ClientBooking, NewBooking, Prop, RoomStruct } from "./api";
import { haptic, isTelegram } from "./telegram";
import { ROOM_STRUCT_HINTS, ROOM_STRUCT_LABELS, ROOM_STRUCT_ORDER, STATUS_LABELS, STATUS_TONE } from "./labels";
import RoomStructDiagram from "./components/RoomStructDiagram";
import Calendar, { SlotValue } from "./components/Calendar";
import Stars from "./components/Stars";

type Tab = "new" | "my";

const STEPS = ["Компания", "Зал и дата", "Расстановка", "Оборудование", "Детали", "Готово"] as const;

type Form = {
  company_id: number | null;
  company: string;
  zone_id: number | null;
  attendees: string;
  slot: SlotValue;
  room_struct: RoomStruct | null;
  props: Record<number, string>;
  event_name: string;
  event_type: string;
  description: string;
  contact_name: string;
  phone: string;
  coffee_break: boolean;
  coffee_headcount: string;
};

const emptyForm = (name: string): Form => ({
  company_id: null, company: "", zone_id: null, attendees: "10",
  slot: { date: "", start: "", end: "" }, room_struct: null, props: {},
  event_name: "", event_type: "", description: "", contact_name: name, phone: "",
  coffee_break: false, coffee_headcount: "",
});

// Slots are stored as wall-clock with a trailing "Z"; format in UTC so the
// displayed time matches what the user picked (and the raw end-time slice),
// instead of being shifted into the browser's local timezone.
function fmt(dt: string) {
  return new Date(dt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("new");

  useEffect(() => {
    api.bootstrap().then(setBoot).catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="screen"><div className="empty error-box">{error}</div></div>;
  if (!boot) return <div className="screen"><div className="loader">Загрузка…</div></div>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-row">
          <div className="brand"><span className="brand-mark">AtS</span><span>Бронирование</span></div>
          {!isTelegram && <span className="guest-pill">Гость</span>}
        </div>
        <div className="tabs" data-active={tab}>
          <span className="tab-pill" aria-hidden />
          <button className={tab === "new" ? "on" : ""} onClick={() => { setTab("new"); haptic(); }}>Новая заявка</button>
          <button className={tab === "my" ? "on" : ""} onClick={() => { setTab("my"); haptic(); }}>Мои заявки</button>
        </div>
      </header>
      {tab === "new" ? <Wizard boot={boot} onDone={() => setTab("my")} /> : <MyBookings />}
    </div>
  );
}

function Wizard({ boot, onDone }: { boot: Bootstrap; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(() => emptyForm(boot.user.name ?? ""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<ClientBooking | null>(null);

  const attendeesNum = parseInt(form.attendees, 10) || 0;
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const canNext = useMemo(() => {
    switch (step) {
      case 0: return !!(form.company_id || form.company.trim());
      case 1: return !!(form.zone_id && attendeesNum > 0 && form.slot.date && form.slot.start && form.slot.end);
      case 2: return true; // room_struct optional
      case 3: return true; // props optional
      case 4: return !!(form.event_name.trim() && form.event_type.trim() && form.contact_name.trim() && form.phone.trim() && (!form.coffee_break || form.coffee_headcount));
      default: return true;
    }
  }, [step, form, attendeesNum]);

  const submit = async () => {
    setBusy(true); setErr(null);
    const props = Object.entries(form.props)
      .map(([id, amt]) => ({ prop_id: Number(id), amount: parseInt(amt, 10) || 0 }))
      .filter((p) => p.amount > 0);
    const payload: NewBooking = {
      zone_id: form.zone_id!,
      company_id: form.company_id,
      company: form.company.trim(),
      contact_name: form.contact_name.trim(),
      phone: form.phone.trim(),
      event_type: form.event_type.trim(),
      event_name: form.event_name.trim(),
      description: form.description.trim() || null,
      attendees: attendeesNum,
      room_struct: form.room_struct,
      coffee_break: form.coffee_break,
      coffee_headcount: form.coffee_break && form.coffee_headcount ? parseInt(form.coffee_headcount, 10) : null,
      starts_at: `${form.slot.date}T${form.slot.start}:00Z`,
      ends_at: `${form.slot.date}T${form.slot.end}:00Z`,
      props,
    };
    try {
      const b = await api.createBooking(payload);
      haptic("success");
      setCreated(b);
      setStep(STEPS.length - 1);
    } catch (e) {
      haptic("error");
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="screen">
        <div className="success-card">
          <div className="success-check">✓</div>
          <h2>Заявка №{created.id} создана</h2>
          <p>Помещение: <b>{created.room}</b> (зона {created.zone})</p>
          <p className="muted">{fmt(created.starts_at)} — {created.ends_at.slice(11, 16)}</p>
          <p className="muted">Мы свяжемся с вами после подтверждения.</p>
          <button className="primary big" onClick={onDone}>Мои заявки</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <Stepper step={step} />

      <div className="step-body" key={step}>
      {step === 0 && (
        <Section title="Кто бронирует?">
          {boot.companies.length > 0 ? (
            <div className="pick-list">
              {boot.companies.map((c) => (
                <button key={c.id} className={`pick ${form.company_id === c.id ? "on" : ""}`} onClick={() => set({ company_id: c.id, company: c.name })}>
                  <span className="pick-title">{c.name}</span>
                  {form.company_id === c.id && <span className="pick-check">✓</span>}
                </button>
              ))}
            </div>
          ) : (
            <Field label="Компания"><input value={form.company} onChange={(e) => set({ company: e.target.value })} placeholder="Название компании" /></Field>
          )}
        </Section>
      )}

      {step === 1 && (
        <Section title="Зал, участники и время">
          <Field label="Зона">
            <div className="chip-row">
              {boot.zones.map((z) => (
                <button key={z.id} className={`chip ${form.zone_id === z.id ? "on" : ""}`} onClick={() => set({ zone_id: z.id, slot: { date: "", start: "", end: "" } })}>
                  {z.name} <span className="chip-sub">до {z.total_capacity}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Участников">
            <input inputMode="numeric" value={form.attendees} onChange={(e) => set({ attendees: e.target.value, slot: { date: "", start: "", end: "" } })} />
          </Field>
          {form.zone_id && attendeesNum > 0 ? (
            <Calendar zoneId={form.zone_id} attendees={attendeesNum} value={form.slot} onChange={(slot) => set({ slot })} />
          ) : (
            <div className="hint">Выберите зону и число участников, чтобы увидеть свободные даты.</div>
          )}
        </Section>
      )}

      {step === 2 && (
        <Section title="Расстановка" subtitle="Как расставить мебель относительно экрана">
          <div className="struct-list">
            {ROOM_STRUCT_ORDER.map((s) => (
              <button key={s} className={`struct ${form.room_struct === s ? "on" : ""}`} onClick={() => { set({ room_struct: s }); haptic(); }}>
                <RoomStructDiagram struct={s} />
                <span className="struct-name">{ROOM_STRUCT_LABELS[s]}</span>
                <span className="struct-hint">{ROOM_STRUCT_HINTS[s]}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {step === 3 && (
        <Section title="Оборудование" subtitle="Необязательно — укажите, что нужно">
          {boot.props.length === 0 ? (
            <div className="hint">Список оборудования пуст.</div>
          ) : (
            boot.props.map((p: Prop) => (
              <div key={p.id} className="prop-row">
                <div className="prop-info">
                  <div className="prop-name">{p.name}</div>
                  <div className="prop-sub">доступно {p.amount} {p.unit || "шт."}</div>
                </div>
                <Stepper2
                  value={parseInt(form.props[p.id] || "0", 10)}
                  max={p.amount}
                  onChange={(v) => set({ props: { ...form.props, [p.id]: String(v) } })}
                />
              </div>
            ))
          )}
        </Section>
      )}

      {step === 4 && (
        <Section title="Детали мероприятия">
          <Field label="Название"><input value={form.event_name} onChange={(e) => set({ event_name: e.target.value })} placeholder="напр. Стратегическая сессия" /></Field>
          <Field label="Тип"><input value={form.event_type} onChange={(e) => set({ event_type: e.target.value })} placeholder="совещание, тренинг…" /></Field>
          <Field label="Описание (необязательно)"><textarea rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} /></Field>
          <div className="row2">
            <Field label="Контактное лицо"><input value={form.contact_name} onChange={(e) => set({ contact_name: e.target.value })} /></Field>
            <Field label="Телефон"><input value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+7…" /></Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={form.coffee_break} onChange={(e) => set({ coffee_break: e.target.checked })} />
            Нужен кофе-брейк
          </label>
          {form.coffee_break && (
            <Field label="Человек на кофе-брейке"><input inputMode="numeric" value={form.coffee_headcount} onChange={(e) => set({ coffee_headcount: e.target.value })} /></Field>
          )}
        </Section>
      )}

      </div>

      {err && <div className="error-box">{err}</div>}

      <div className="wizard-foot">
        {step > 0 && <button className="ghost" disabled={busy} onClick={() => setStep((s) => s - 1)}>Назад</button>}
        {step < 4 && <button className="primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>Далее</button>}
        {step === 4 && <button className="primary" disabled={!canNext || busy} onClick={submit}>{busy ? "Отправка…" : "Отправить заявку"}</button>}
      </div>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="steps">
      {STEPS.slice(0, 5).map((s, i) => (
        <div key={s} className={`step ${i === step ? "current" : ""} ${i < step ? "done" : ""}`}>
          <span className="step-dot">{i < step ? "✓" : i + 1}</span>
          <span className="step-name">{s}</span>
        </div>
      ))}
    </div>
  );
}

function Stepper2({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="qty">
      <button type="button" disabled={value <= 0} onClick={() => onChange(Math.max(0, value - 1))}>−</button>
      <span>{value}</span>
      <button type="button" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <h2 className="section-title">{title}</h2>
      {subtitle && <p className="section-sub">{subtitle}</p>}
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}

function MyBookings() {
  const [items, setItems] = useState<ClientBooking[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<ClientBooking | null>(null);

  const load = () => api.myBookings().then(setItems).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); }, []);

  if (err) return <div className="screen"><div className="error-box">{err}</div></div>;
  if (!items) return <div className="screen"><div className="loader">Загрузка…</div></div>;
  if (items.length === 0) return <div className="screen"><div className="empty">У вас пока нет заявок.</div></div>;

  return (
    <div className="screen">
      {items.map((b) => (
        <div key={b.id} className="booking-card">
          <div className="bc-head">
            <span className="bc-title">{b.event_name}</span>
            <span className={`status ${STATUS_TONE[b.status]}`}>{STATUS_LABELS[b.status]}</span>
          </div>
          <div className="bc-meta">{b.room} · {b.zone} · {b.attendees} чел.</div>
          <div className="bc-when">{fmt(b.starts_at)} — {b.ends_at.slice(11, 16)}</div>
          {b.room_struct && <div className="bc-struct">Расстановка: {ROOM_STRUCT_LABELS[b.room_struct]}</div>}
          {(b.status === "completed" || b.status === "archived") && !b.has_feedback && (
            <button className="primary sm" onClick={() => setFeedbackFor(b)}>Оставить отзыв</button>
          )}
          {b.has_feedback && <div className="bc-fb">✓ Отзыв отправлен</div>}
        </div>
      ))}
      {feedbackFor && (
        <FeedbackSheet booking={feedbackFor} onClose={() => setFeedbackFor(null)} onSaved={() => { setFeedbackFor(null); load(); }} />
      )}
    </div>
  );
}

function FeedbackSheet({ booking, onClose, onSaved }: { booking: ClientBooking; onClose: () => void; onSaved: () => void }) {
  const [overall, setOverall] = useState(0);
  const [room, setRoom] = useState(0);
  const [service, setService] = useState(0);
  const [props, setProps] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!overall) { setErr("Поставьте общую оценку."); return; }
    setBusy(true); setErr(null);
    try {
      await api.submitFeedback(booking.id, {
        rating: overall,
        room_rating: room || null,
        service_rating: service || null,
        props_rating: props || null,
        comment: comment.trim() || null,
      });
      haptic("success");
      onSaved();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="sheet-overlay" onClick={() => !busy && onClose()}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <h2>Отзыв · «{booking.event_name}»</h2>
        <RateRow label="Общая оценка" value={overall} onChange={setOverall} />
        <RateRow label="Помещение" value={room} onChange={setRoom} />
        <RateRow label="Сервис" value={service} onChange={setService} />
        <RateRow label="Оборудование" value={props} onChange={setProps} />
        <Field label="Комментарий (необязательно)">
          <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        {err && <div className="error-box">{err}</div>}
        <div className="wizard-foot">
          <button className="ghost" disabled={busy} onClick={onClose}>Отмена</button>
          <button className="primary" disabled={busy} onClick={save}>{busy ? "Отправка…" : "Отправить"}</button>
        </div>
      </div>
    </div>
  );
}

function RateRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="rate-row">
      <span className="rate-label">{label}</span>
      <Stars value={value} onChange={onChange} size={26} />
    </div>
  );
}
