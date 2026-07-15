import { useEffect, useMemo, useState } from "react";
import { api, Bootstrap, ClientBooking, companyLogoUrl, NewBooking, Prop, Room, RoomStruct, roomImageUrl } from "./api";
import { haptic, isTelegram } from "./telegram";
import logoUrl from "./assets/logo.png";
import { EVENT_TYPES, GRADES, isKoinoti, roomFits, ROOM_STRUCT_HINTS, ROOM_STRUCT_LABELS, ROOM_STRUCT_ORDER, RULES_INTRO, RULES_LINKS, RULES_RECOMMENDATIONS_URL, STATUS_LABELS, STATUS_TONE } from "./labels";
import RoomStructDiagram from "./components/RoomStructDiagram";
import Calendar, { SlotValue } from "./components/Calendar";
import Stars from "./components/Stars";
import Landing from "./components/Landing";

type Tab = "new" | "my";

const STEPS = ["Компания", "Расстановка", "Зал и дата", "Оборудование", "Детали", "Согласие", "Готово"] as const;
// Index of the last input step (the consent step, where the form is submitted).
const LAST_STEP = STEPS.length - 2;

type Form = {
  company_id: number | null;
  company: string;
  room_id: number | null;
  attendees: string;
  slot: SlotValue;
  room_struct: RoomStruct | null;
  props: Record<number, string>;
  event_name: string;
  event_type: string;
  description: string;
  aim: string;
  grade: string;
  extra_services: string;
  position: string;
  department: string;
  target_employees: string;
  contact_name: string;
  phone: string;
  coffee_break: boolean;
  coffee_headcount: string;
  coffee_type: "standard" | "other";
  coffee_other: string;
  foreign_guests: boolean;
  is_urgent: boolean;
  // Participation-rules acknowledgement (#4): one checkbox per required document.
  agree: boolean[];
};

const emptyForm = (name: string): Form => ({
  company_id: null, company: "", room_id: null, attendees: "10",
  slot: { date: "", start: "", end: "" }, room_struct: null, props: {},
  event_name: "", event_type: "", description: "", aim: "", grade: "", extra_services: "",
  position: "", department: "", target_employees: "",
  contact_name: name, phone: "",
  coffee_break: false, coffee_headcount: "", coffee_type: "standard", coffee_other: "", foreign_guests: false,
  is_urgent: false,
  agree: RULES_LINKS.map(() => false),
});

// Slots are stored as wall-clock with a trailing "Z"; format in UTC so the
// displayed time matches what the user picked (and the raw end-time slice),
// instead of being shifted into the browser's local timezone.
function fmt(dt: string) {
  return new Date(dt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconArea() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function IconRoom() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 21h18" />
      <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" />
      <path d="M9 8h.01M9 12h.01M15 8h.01M15 12h.01" />
    </svg>
  );
}

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("new");
  // Browser visitors land on a marketing page first; Telegram opens straight into
  // the booking flow (isTelegram ⇒ already "entered").
  const [entered, setEntered] = useState(isTelegram);

  useEffect(() => {
    api.bootstrap().then(setBoot).catch((e) => setError((e as Error).message));
  }, []);

  if (!entered) return <Landing onBook={() => setEntered(true)} />;
  if (error) return <div className="screen"><div className="empty error-box">{error}</div></div>;
  if (!boot) return <div className="screen"><div className="loader">Загрузка…</div></div>;

  return (
    <div className={`app${isTelegram ? "" : " mode-desktop"}`}>
      <header className="topbar">
        <div className="brand-row">
          <button
            className="brand as-link"
            onClick={() => { if (!isTelegram) { setEntered(false); haptic(); } }}
            title={isTelegram ? undefined : "На лендинг"}
          >
            <img className="brand-logo" src={logoUrl} alt="AtS" /><span>Бронирование</span>
          </button>
          <div className="topbar-right">
            {!isTelegram && (
              <button className="home-btn" onClick={() => { setEntered(false); haptic(); }}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 12l9-9 9 9" /><path d="M5 10v10h14V10" />
                </svg>
                <span>На лендинг</span>
              </button>
            )}
            {!isTelegram && <span className="guest-pill">Гость</span>}
          </div>
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

  // Warn when the chosen room can't hold the requested headcount (#1). Mirrors the
  // backend room_fits(): an unparseable capacity («много») never triggers the warning.
  const selectedRoom = useMemo(
    () => boot.rooms.find((r) => r.id === form.room_id) ?? null,
    [boot.rooms, form.room_id],
  );
  const roomOverCapacity = !!(selectedRoom && attendeesNum > 0 && !roomFits(selectedRoom.capacity, attendeesNum));

  // Mirror the backend rule (services/bookings.is_urgent): bookings starting in
  // <2 days are urgent automatically, so the checkbox is forced on and locked.
  const autoUrgent = useMemo(() => {
    if (!form.slot.date || !form.slot.start) return false;
    const startsAt = new Date(`${form.slot.date}T${form.slot.start}:00Z`).getTime();
    return startsAt - Date.now() < 2 * 24 * 60 * 60 * 1000;
  }, [form.slot.date, form.slot.start]);

  const canNext = useMemo(() => {
    switch (step) {
      case 0: return !!(form.company_id || form.company.trim());
      case 1: return true; // room_struct optional
      case 2: return !!(form.room_id && attendeesNum > 0 && form.slot.date && form.slot.start && form.slot.end);
      case 3: return true; // props optional
      case 4: return !!(form.event_name.trim() && form.event_type.trim() && form.aim.trim() && form.grade &&
        form.position.trim() && form.target_employees.trim() &&
        (!isKoinoti(form.company) || form.department.trim()) &&
        form.contact_name.trim() && form.phone.trim() &&
        (!form.coffee_break || (form.coffee_headcount && (form.coffee_type !== "other" || form.coffee_other.trim()))));
      case 5: return form.agree.every(Boolean); // must acknowledge every document
      default: return true;
    }
  }, [step, form, attendeesNum]);

  const submit = async () => {
    setBusy(true); setErr(null);
    const props = Object.entries(form.props)
      .map(([id, amt]) => ({ prop_id: Number(id), amount: parseInt(amt, 10) || 0 }))
      .filter((p) => p.amount > 0);
    const payload: NewBooking = {
      room_id: form.room_id!,
      company_id: form.company_id,
      company: form.company.trim(),
      contact_name: form.contact_name.trim(),
      phone: form.phone.trim(),
      event_type: form.event_type.trim(),
      event_name: form.event_name.trim(),
      description: form.description.trim() || null,
      aim: form.aim.trim() || null,
      grade: form.grade || null,
      extra_services: form.extra_services.trim() || null,
      position: form.position.trim() || null,
      department: isKoinoti(form.company) ? form.department.trim() || null : null,
      target_employees: form.target_employees.trim() || null,
      privacy_accepted: form.agree.every(Boolean),
      attendees: attendeesNum,
      room_struct: form.room_struct,
      coffee_break: form.coffee_break,
      coffee_headcount: form.coffee_break && form.coffee_headcount ? parseInt(form.coffee_headcount, 10) : null,
      coffee_type: form.coffee_break ? form.coffee_type : null,
      coffee_other: form.coffee_break && form.coffee_type === "other" ? form.coffee_other.trim() || null : null,
      foreign_guests: form.coffee_break ? form.foreign_guests : false,
      is_urgent: form.is_urgent,
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
          <p>Помещение: <b>{created.room}</b></p>
          <p className="muted">{fmt(created.starts_at)} — {created.ends_at.slice(11, 16)}</p>
          <p className="muted">Мы свяжемся с вами после подтверждения.</p>
          <button className="primary big" onClick={onDone}>Мои заявки</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen wizard">
      <Stepper step={step} />

      <div className="wiz-main">
      <div className="step-body" key={step}>
      {step === 0 && (
        <Section title="Кто бронирует?">
          {boot.companies.length > 0 ? (
            <div className="company-grid">
              {boot.companies.map((c) => (
                <button
                  key={c.id}
                  className={`company-card ${form.company_id === c.id ? "on" : ""}`}
                  onClick={() => { set({ company_id: c.id, company: c.name }); haptic(); }}
                >
                  <div className="company-logo">
                    {c.has_logo
                      ? <img src={companyLogoUrl(c.id)} alt="" loading="lazy" />
                      : <span className="company-initials">{c.name.trim().charAt(0).toUpperCase()}</span>}
                  </div>
                  <span className="company-name">{c.name}</span>
                  {form.company_id === c.id && <span className="company-check">✓</span>}
                </button>
              ))}
            </div>
          ) : (
            <Field label="Компания"><input value={form.company} onChange={(e) => set({ company: e.target.value })} placeholder="Название компании" /></Field>
          )}
        </Section>
      )}

      {step === 2 && (
        <Section title="Помещение, участники и время">
          <Field label="Помещение">
            {boot.rooms.length > 0 ? (
              <div className="room-grid">
                {boot.rooms.map((r: Room) => (
                  <button
                    key={r.id}
                    className={`room-card ${form.room_id === r.id ? "on" : ""}`}
                    onClick={() => { set({ room_id: r.id, slot: { date: "", start: "", end: "" } }); haptic(); }}
                  >
                    <div className="room-photo">
                      {r.photos.length > 0 ? (
                        <img src={roomImageUrl(r.id, r.photos[0])} alt={r.name} loading="lazy" />
                      ) : (
                        <span className="room-photo-empty"><IconRoom /></span>
                      )}
                      {r.photos.length > 1 && <span className="room-photo-count">{r.photos.length} фото</span>}
                      <span className="room-check" aria-hidden>✓</span>
                    </div>
                    <div className="room-info">
                      <span className="room-name">{r.name}</span>
                      <div className="room-meta">
                        <span className="room-chip"><IconUsers />{r.capacity}</span>
                        {r.meter_squared ? <span className="room-chip alt"><IconArea />{r.meter_squared} м²</span> : null}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="hint">Пока нет доступных помещений для брони. Администратору нужно добавить хотя бы одно активное помещение (не «кофе-брейк»).</div>
            )}
          </Field>
          <Field label="Участников">
            <input inputMode="numeric" value={form.attendees} onChange={(e) => set({ attendees: e.target.value, slot: { date: "", start: "", end: "" } })} />
          </Field>
          {roomOverCapacity && (
            <div className="warn-box">
              Лимит помещения превышен{selectedRoom?.capacity ? ` (вместимость «${selectedRoom.capacity}»)` : ""}, пожалуйста выберите другое помещение или уменьшите число участников.
            </div>
          )}
          {roomOverCapacity ? null : form.room_id && attendeesNum > 0 ? (
            <Calendar roomId={form.room_id} attendees={attendeesNum} value={form.slot} onChange={(slot) => set({ slot })} />
          ) : (
            <div className="hint">Выберите помещение и число участников, чтобы увидеть свободные даты.</div>
          )}
        </Section>
      )}

      {step === 1 && (
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
            boot.props.map((p: Prop) => {
              const avail = p.available ?? p.amount;
              const picked = parseInt(form.props[p.id] || "0", 10);
              const left = avail - picked;
              return (
                <div key={p.id} className="prop-row">
                  <div className="prop-info">
                    <div className="prop-name">{p.name}</div>
                    <div className={`prop-sub ${left <= 0 ? "out" : ""}`}>
                      {avail <= 0 ? "нет в наличии" : `осталось ${left} из ${avail} ${p.unit || "шт."}`}
                    </div>
                  </div>
                  <Stepper2
                    value={picked}
                    max={avail}
                    onChange={(v) => set({ props: { ...form.props, [p.id]: String(v) } })}
                  />
                </div>
              );
            })
          )}
        </Section>
      )}

      {step === 4 && (
        <Section title="Детали мероприятия">
          <div className="grid2">
            <Field label="Название"><input value={form.event_name} onChange={(e) => set({ event_name: e.target.value })} placeholder="напр. Стратегическая сессия" /></Field>
            <Field label="Тип мероприятия">
              <select value={form.event_type} onChange={(e) => set({ event_type: e.target.value })}>
                <option value="">— выберите тип —</option>
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid2">
            <Field label="Цель бронирования"><input value={form.aim} onChange={(e) => set({ aim: e.target.value })} placeholder="напр. развитие навыков сотрудников" /></Field>
            <Field label="Грейд">
              <select value={form.grade} onChange={(e) => set({ grade: e.target.value })}>
                <option value="">— выберите грейд —</option>
                {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Должность заявителя"><input value={form.position} onChange={(e) => set({ position: e.target.value })} placeholder="напр. HR-менеджер" /></Field>
          {isKoinoti(form.company) && (
            <Field label="Департамент / Отдел">
              <input value={form.department} onChange={(e) => set({ department: e.target.value })} placeholder="напр. Департамент цифровизации" />
            </Field>
          )}
          <Field label="Для каких сотрудников предназначен тренинг">
            <textarea rows={2} value={form.target_employees} onChange={(e) => set({ target_employees: e.target.value })}
              placeholder="напр. руководители отделов продаж" />
          </Field>
          <Field label="Описание (необязательно)"><textarea rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} /></Field>
          <Field label="Дополнительные услуги (необязательно)">
            <textarea rows={2} value={form.extra_services} onChange={(e) => set({ extra_services: e.target.value })}
              placeholder="напр. расстановка мебели, техническая поддержка на месте, другое" />
          </Field>
          <div className="grid2">
            <Field label="Контактное лицо"><input value={form.contact_name} onChange={(e) => set({ contact_name: e.target.value })} /></Field>
            <Field label="Телефон"><input value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+992…" /></Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={form.coffee_break} onChange={(e) => set({ coffee_break: e.target.checked })} />
            Нужен кофе-брейк
          </label>
          {form.coffee_break && (
            <>
              <Field label="Кол-во кофе-брейков"><input inputMode="numeric" value={form.coffee_headcount} onChange={(e) => set({ coffee_headcount: e.target.value })} /></Field>
              <Field label="Что нужно">
                <div className="seg">
                  <button type="button" className={`seg-btn ${form.coffee_type === "standard" ? "on" : ""}`} onClick={() => { set({ coffee_type: "standard" }); haptic(); }}>Стандартный</button>
                  <button type="button" className={`seg-btn ${form.coffee_type === "other" ? "on" : ""}`} onClick={() => { set({ coffee_type: "other" }); haptic(); }}>Другое</button>
                </div>
                <p className="field-note">{form.coffee_type === "standard" ? "Печенье, кофе, чай, конфеты." : "Опишите, что нужно на кофе-брейке."}</p>
              </Field>
              {form.coffee_type === "other" && (
                <Field label="Что именно"><input value={form.coffee_other} onChange={(e) => set({ coffee_other: e.target.value })} placeholder="напр. фрукты, сэндвичи…" /></Field>
              )}
              <label className="check">
                <input type="checkbox" checked={form.foreign_guests} onChange={(e) => set({ foreign_guests: e.target.checked })} />
                Гости иностранцы
              </label>
              <p className="check-hint">Если да — кофе-брейк организуем прямо в зале мероприятия, отдельное помещение не нужно.</p>
            </>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={form.is_urgent || autoUrgent}
              disabled={autoUrgent}
              onChange={(e) => set({ is_urgent: e.target.checked })}
            />
            Срочная заявка
          </label>
          <p className="check-hint">
            {autoUrgent
              ? "Заявка автоматически срочная: до мероприятия меньше 2 дней."
              : "Отметьте, если заявку нужно обработать в приоритете."}
          </p>
        </Section>
      )}

      {step === 5 && (
        <Section title="Ознакомление с правилами">
          <p className="rules-intro">
            {RULES_INTRO}{" "}
            <a href={RULES_RECOMMENDATIONS_URL} target="_blank" rel="noreferrer">рекомендациями</a>.
          </p>
          <div className="consent-list">
            {RULES_LINKS.map((doc, i) => (
              <label key={i} className="consent-item">
                <input
                  type="checkbox"
                  checked={form.agree[i]}
                  onChange={(e) => set({ agree: form.agree.map((v, j) => (j === i ? e.target.checked : v)) })}
                />
                <span>
                  {doc.label}
                  {doc.url && doc.url !== "#" && (
                    <> — <a href={doc.url} target="_blank" rel="noreferrer">открыть файл</a></>
                  )}
                </span>
              </label>
            ))}
          </div>
          <p className="check-hint">Чтобы отправить заявку, подтвердите ознакомление со всеми пунктами.</p>
        </Section>
      )}

      </div>

      {err && <div className="error-box">{err}</div>}

      <div className="wizard-foot">
        {step > 0 && <button className="ghost" disabled={busy} onClick={() => setStep((s) => s - 1)}>Назад</button>}
        {step < LAST_STEP && <button className="primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>Далее</button>}
        {step === LAST_STEP && <button className="primary" disabled={!canNext || busy} onClick={submit}>{busy ? "Отправка…" : "Отправить заявку"}</button>}
      </div>
      </div>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="steps">
      {STEPS.slice(0, LAST_STEP + 1).map((s, i) => (
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
  const [detailFor, setDetailFor] = useState<ClientBooking | null>(null);

  const load = () => api.myBookings().then(setItems).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); }, []);

  if (err) return <div className="screen"><div className="error-box">{err}</div></div>;
  if (!items) return <div className="screen"><div className="loader">Загрузка…</div></div>;
  if (items.length === 0) return <div className="screen"><div className="empty">У вас пока нет заявок.</div></div>;

  return (
    <div className="screen">
      <div className="booking-grid">
      {items.map((b) => (
        <div key={b.id} className="booking-card" role="button" tabIndex={0} onClick={() => { setDetailFor(b); haptic(); }}>
          <div className="bc-head">
            <span className="bc-title">{b.event_name}</span>
            <span className={`status ${STATUS_TONE[b.status]}`}>{STATUS_LABELS[b.status]}</span>
          </div>
          <div className="bc-meta">{b.room} · {b.attendees} чел.</div>
          <div className="bc-when">{fmt(b.starts_at)} — {b.ends_at.slice(11, 16)}</div>
          {b.is_urgent && <span className="bc-urgent">Срочно</span>}
          {(b.status === "completed" || b.status === "archived") && !b.has_feedback && (
            <button className="primary sm" onClick={(e) => { e.stopPropagation(); setFeedbackFor(b); }}>Оставить отзыв</button>
          )}
          {b.has_feedback && <div className="bc-fb">✓ Отзыв отправлен</div>}
        </div>
      ))}
      </div>
      {detailFor && (
        <BookingDetail
          booking={detailFor}
          onClose={() => setDetailFor(null)}
          onFeedback={() => { const b = detailFor; setDetailFor(null); setFeedbackFor(b); }}
        />
      )}
      {feedbackFor && (
        <FeedbackSheet booking={feedbackFor} onClose={() => setFeedbackFor(null)} onSaved={() => { setFeedbackFor(null); load(); }} />
      )}
    </div>
  );
}

function BookingDetail({ booking: b, onClose, onFeedback }: { booking: ClientBooking; onClose: () => void; onFeedback: () => void }) {
  const canReview = (b.status === "completed" || b.status === "archived") && !b.has_feedback;
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="detail-head">
          <h2>{b.event_name}</h2>
          <span className={`status ${STATUS_TONE[b.status]}`}>{STATUS_LABELS[b.status]}</span>
        </div>
        <dl className="detail-list">
          <DetailRow label="Заявка" value={`№${b.id}`} />
          <DetailRow label="Когда" value={`${fmt(b.starts_at)} — ${b.ends_at.slice(11, 16)}`} />
          <DetailRow label="Помещение" value={b.room} />
          <DetailRow label="Участников" value={`${b.attendees} чел.`} />
          {b.event_type && <DetailRow label="Тип" value={b.event_type} />}
          {b.aim && <DetailRow label="Цель" value={b.aim} />}
          {b.grade && <DetailRow label="Грейд" value={b.grade} />}
          {b.position && <DetailRow label="Должность заявителя" value={b.position} />}
          {b.department && <DetailRow label="Департамент" value={b.department} />}
          {b.target_employees && <DetailRow label="Для сотрудников" value={b.target_employees} />}
          {b.extra_services && <DetailRow label="Доп. услуги" value={b.extra_services} />}
          {b.company && <DetailRow label="Компания" value={b.company} />}
          {b.contact_name && <DetailRow label="Контакт" value={b.contact_name} />}
          {b.phone && <DetailRow label="Телефон" value={b.phone} />}
          {b.room_struct && <DetailRow label="Расстановка" value={ROOM_STRUCT_LABELS[b.room_struct]} />}
          {b.coffee_break && (
            <DetailRow
              label="Кофе-брейк"
              value={
                [
                  b.coffee_headcount ? `${b.coffee_headcount} шт.` : null,
                  b.coffee_type === "other" ? (b.coffee_other || "другое") : "стандартный",
                  b.foreign_guests ? "в зале (гости иностранцы)" : null,
                ].filter(Boolean).join(" · ")
              }
            />
          )}
          <DetailRow label="Срочная" value={b.is_urgent ? "да" : "нет"} />
          {b.description && <DetailRow label="Описание" value={b.description} />}
          {b.created_at && <DetailRow label="Создана" value={fmt(b.created_at)} />}
        </dl>
        {b.has_feedback && <div className="bc-fb">✓ Отзыв отправлен</div>}
        <div className="wizard-foot">
          {canReview && <button className="primary" onClick={onFeedback}>Оставить отзыв</button>}
          <button className="ghost" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
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
