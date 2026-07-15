import { useEffect, useRef, useState } from "react";
import { api, CalendarEvent, LandingContent, LandingEcosystemItem, LandingStat } from "../api";
import { isAdmin } from "../auth";

const BROWSER_URL = "браузерная версия клиентского приложения";

const RU_MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

// Read a File as bare base64 (no data: prefix) for the JSON upload.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result);
      resolve(res.includes(",") ? res.slice(res.indexOf(",") + 1) : res);
    };
    reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
    reader.readAsDataURL(file);
  });
}

function EventsManager() {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => api.listEvents().then(setEvents).catch((e) => setError((e as Error).message));
  useEffect(() => { load(); }, []);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      const b64 = await fileToBase64(file);
      const res = await api.importEvents(file.name, b64);
      setEvents(res.events);
      setMsg(`Загружено мероприятий: ${res.imported}. Месяцы: ${res.months.join(", ") || "—"}.`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const clear = async () => {
    if (!confirm("Удалить все мероприятия из календаря?")) return;
    setBusy(true); setError(null); setMsg(null);
    try { await api.clearEvents(); setEvents([]); setMsg("Календарь очищен."); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  // Group by "YYYY-MM" for a compact summary.
  const byMonth = new Map<string, number>();
  for (const ev of events ?? []) {
    const [y, m] = ev.event_date.split("-");
    const key = `${RU_MONTHS[Number(m) - 1]} ${y}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
  }

  return (
    <div className="entity-card" style={{ marginBottom: 18 }}>
      <div className="landing-sec-head">
        <h3 className="landing-sec">Календарь мероприятий</h3>
        <span className="badge zone">{events == null ? "…" : `${events.length} мероприятий`}</span>
      </div>
      <p className="muted" style={{ margin: "-4px 0 12px", fontSize: 13 }}>
        Загрузите Excel-файл по шаблону «Календарь мероприятий БТЦ AtS» (лист на каждый месяц; колонки:
        Дата · Зал · Время · Мероприятие · Компании/Проект · Тренер/Ведущий · Аудитория · Кофе Брейк · Кол-во участников).
        Загрузка <b>полностью заменяет</b> текущий календарь.
      </p>

      {msg && <div className="landing-ok">{msg}</div>}
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      {events != null && byMonth.size > 0 && (
        <div className="landing-months">
          {Array.from(byMonth.entries()).map(([k, n]) => (
            <span key={k} className="landing-month-pill">{k} · <b>{n}</b></span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
        <input ref={fileRef} type="file" accept=".xlsx" style={{ display: "none" }} onChange={onFile} disabled={busy} />
        <button className="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? "Обработка…" : "Загрузить .xlsx"}
        </button>
        {events != null && events.length > 0 && (
          <button className="danger" disabled={busy} onClick={clear}>Очистить</button>
        )}
      </div>
    </div>
  );
}

export default function LandingPage() {
  const admin = isAdmin();
  const [data, setData] = useState<LandingContent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getLanding().then(setData).catch((e) => setError((e as Error).message));
  }, []);

  if (error && !data) return <div className="empty error">{error}</div>;
  if (!data) return <div className="empty">Загрузка…</div>;

  const patch = (p: Partial<LandingContent>) => { setData({ ...data, ...p }); setSaved(false); };

  const setEco = (i: number, p: Partial<LandingEcosystemItem>) =>
    patch({ ecosystem: data.ecosystem.map((it, j) => (j === i ? { ...it, ...p } : it)) });
  const addEco = () => patch({ ecosystem: [...data.ecosystem, { number: "", title: "", subtitle: "" }] });
  const delEco = (i: number) => patch({ ecosystem: data.ecosystem.filter((_, j) => j !== i) });

  const setFeature = (i: number, v: string) =>
    patch({ features: data.features.map((it, j) => (j === i ? v : it)) });
  const addFeature = () => patch({ features: [...data.features, ""] });
  const delFeature = (i: number) => patch({ features: data.features.filter((_, j) => j !== i) });

  const setStat = (i: number, p: Partial<LandingStat>) =>
    patch({ stats: data.stats.map((it, j) => (j === i ? { ...it, ...p } : it)) });
  const addStat = () => patch({ stats: [...data.stats, { value: "", label: "" }] });
  const delStat = (i: number) => patch({ stats: data.stats.filter((_, j) => j !== i) });

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const clean: LandingContent = {
        ...data,
        ecosystem: data.ecosystem.filter((e) => e.title.trim() || e.subtitle.trim()),
        features: data.features.map((f) => f.trim()).filter(Boolean),
        stats: data.stats.filter((s) => s.value.trim() || s.label.trim()),
      };
      const out = await api.updateLanding(clean);
      setData(out); setSaved(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const ro = !admin;

  return (
    <div>
      <div className="page-head">
        <h2>Лендинг сайта</h2>
        {admin && (
          <button className="primary" disabled={busy} onClick={save}>
            {busy ? "Сохранение…" : saved ? "Сохранено ✓" : "Сохранить"}
          </button>
        )}
      </div>
      <p className="muted" style={{ marginTop: -6, marginBottom: 20 }}>
        Стартовая страница перед бронированием ({BROWSER_URL}). В Telegram мини-приложении не показывается.
      </p>

      {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="entity-card" style={{ marginBottom: 18 }}>
        <h3 className="landing-sec">Шапка</h3>
        <div className="field"><label>Заголовок</label>
          <input value={data.hero_title} disabled={ro} onChange={(e) => patch({ hero_title: e.target.value })} /></div>
        <div className="field"><label>Подзаголовок</label>
          <textarea rows={2} value={data.hero_subtitle} disabled={ro} onChange={(e) => patch({ hero_subtitle: e.target.value })} /></div>
        <div className="field"><label>Текст кнопки</label>
          <input value={data.cta_label} disabled={ro} onChange={(e) => patch({ cta_label: e.target.value })} placeholder="Забронировать" /></div>
      </div>

      <div className="entity-card" style={{ marginBottom: 18 }}>
        <div className="landing-sec-head">
          <h3 className="landing-sec">Экосистема</h3>
          {admin && <button className="ghost sm" onClick={addEco}>+ Карточка</button>}
        </div>
        {data.ecosystem.map((it, i) => (
          <div key={i} className="landing-row">
            <div className="field mini"><label>№</label>
              <input value={it.number} disabled={ro} onChange={(e) => setEco(i, { number: e.target.value })} placeholder="01" /></div>
            <div className="field grow"><label>Название</label>
              <input value={it.title} disabled={ro} onChange={(e) => setEco(i, { title: e.target.value })} /></div>
            <div className="field grow"><label>Описание</label>
              <input value={it.subtitle} disabled={ro} onChange={(e) => setEco(i, { subtitle: e.target.value })} /></div>
            {admin && <button className="icon-del" title="Удалить" onClick={() => delEco(i)}>✕</button>}
          </div>
        ))}
      </div>

      <div className="entity-card" style={{ marginBottom: 18 }}>
        <div className="landing-sec-head">
          <h3 className="landing-sec">Преимущества</h3>
          {admin && <button className="ghost sm" onClick={addFeature}>+ Пункт</button>}
        </div>
        {data.features.map((f, i) => (
          <div key={i} className="landing-row">
            <div className="field grow"><input value={f} disabled={ro} onChange={(e) => setFeature(i, e.target.value)} placeholder="напр. Индивидуальный подход" /></div>
            {admin && <button className="icon-del" title="Удалить" onClick={() => delFeature(i)}>✕</button>}
          </div>
        ))}
      </div>

      <div className="entity-card" style={{ marginBottom: 18 }}>
        <div className="landing-sec-head">
          <h3 className="landing-sec">Цифры</h3>
          {admin && <button className="ghost sm" onClick={addStat}>+ Показатель</button>}
        </div>
        {data.stats.map((s, i) => (
          <div key={i} className="landing-row">
            <div className="field mini"><label>Значение</label>
              <input value={s.value} disabled={ro} onChange={(e) => setStat(i, { value: e.target.value })} placeholder="1000+" /></div>
            <div className="field grow"><label>Подпись</label>
              <input value={s.label} disabled={ro} onChange={(e) => setStat(i, { label: e.target.value })} placeholder="проведённых занятий" /></div>
            {admin && <button className="icon-del" title="Удалить" onClick={() => delStat(i)}>✕</button>}
          </div>
        ))}
      </div>

      <div className="entity-card">
        <h3 className="landing-sec">Контакты и соцсети</h3>
        <div className="field"><label>Телефон</label>
          <input value={data.phone} disabled={ro} onChange={(e) => patch({ phone: e.target.value })} placeholder="+992 …" /></div>
        <div className="field"><label>Email</label>
          <input value={data.email} disabled={ro} onChange={(e) => patch({ email: e.target.value })} placeholder="info@ats.tj" /></div>
        <div className="field"><label>Instagram</label>
          <input value={data.socials.instagram} disabled={ro} onChange={(e) => patch({ socials: { ...data.socials, instagram: e.target.value } })} /></div>
        <div className="field"><label>Facebook</label>
          <input value={data.socials.facebook} disabled={ro} onChange={(e) => patch({ socials: { ...data.socials, facebook: e.target.value } })} /></div>
        <div className="field"><label>LinkedIn</label>
          <input value={data.socials.linkedin} disabled={ro} onChange={(e) => patch({ socials: { ...data.socials, linkedin: e.target.value } })} /></div>
        <div className="field"><label>Telegram</label>
          <input value={data.socials.telegram} disabled={ro} onChange={(e) => patch({ socials: { ...data.socials, telegram: e.target.value } })} /></div>
      </div>

      {admin && <div style={{ marginTop: 18 }}><EventsManager /></div>}
    </div>
  );
}
