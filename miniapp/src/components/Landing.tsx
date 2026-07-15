import { useEffect, useMemo, useState } from "react";
import { api, CalendarEvent, LandingContent } from "../api";
import { haptic } from "../telegram";
import logoUrl from "../assets/logo.png";

const RU_MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const RU_WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

function monthKey(iso: string) { return iso.slice(0, 7); } // "YYYY-MM"
function monthLabel(key: string) { const [y, m] = key.split("-"); return `${RU_MONTHS[Number(m) - 1]} ${y}`; }
// event_date is a bare "YYYY-MM-DD" — parse as UTC to avoid any timezone shift.
function weekday(iso: string) { return RU_WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]; }
function dayNum(iso: string) { return iso.slice(8, 10); }

function EventsCalendar() {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [month, setMonth] = useState<string | null>(null);

  useEffect(() => { api.events().then(setEvents).catch(() => setEvents([])); }, []);

  const months = useMemo(() => {
    const set = new Set((events ?? []).map((e) => monthKey(e.event_date)));
    return Array.from(set).sort();
  }, [events]);

  // Default to the current month if present, else the nearest upcoming, else the latest.
  useEffect(() => {
    if (month || months.length === 0) return;
    const nowKey = new Date().toISOString().slice(0, 7);
    setMonth(months.find((m) => m >= nowKey) ?? months[months.length - 1]);
  }, [months, month]);

  if (events === null) return null; // silent until loaded
  if (events.length === 0) return null; // no events → hide the whole section

  const active = month ?? months[months.length - 1];
  const monthEvents = events.filter((e) => monthKey(e.event_date) === active);

  // Group the selected month by day, preserving date + within-day order.
  const days: { date: string; items: CalendarEvent[] }[] = [];
  for (const ev of monthEvents) {
    let bucket = days.find((d) => d.date === ev.event_date);
    if (!bucket) { bucket = { date: ev.event_date, items: [] }; days.push(bucket); }
    bucket.items.push(ev);
  }

  return (
    <section className="lp-events">
      <h2 className="lp-sec-title">Календарь мероприятий</h2>
      <p className="lp-sec-sub">Расписание тренингов, воркшопов и мероприятий AtS.</p>

      {months.length > 1 && (
        <div className="lp-months">
          {months.map((m) => (
            <button key={m} className={`lp-month ${m === active ? "on" : ""}`} onClick={() => { setMonth(m); haptic(); }}>
              {monthLabel(m)}
            </button>
          ))}
        </div>
      )}

      <div className="lp-days">
        {days.map((d) => (
          <div key={d.date} className="lp-day">
            <div className="lp-day-date">
              <span className="lp-day-num">{dayNum(d.date)}</span>
              <span className="lp-day-wd">{weekday(d.date)}</span>
            </div>
            <div className="lp-day-events">
              {d.items.map((ev) => (
                <article key={ev.id} className="lp-ev">
                  {ev.time_text && <span className="lp-ev-time">{ev.time_text.replace(/\s+/g, "")}</span>}
                  <div className="lp-ev-main">
                    <span className="lp-ev-title">{ev.title}</span>
                    <div className="lp-ev-chips">
                      {ev.room && <span className="lp-ev-chip">{ev.room}</span>}
                      {ev.company && <span className="lp-ev-chip alt">{ev.company}</span>}
                      {ev.participants ? <span className="lp-ev-chip ghost">{ev.participants} чел.</span> : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// Public landing page shown before the booking flow in the browser client.
// Content is admin-managed (panel → «Лендинг»); Telegram mini app skips this.

function IconInstagram() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><path d="M17.5 6.5h.01" />
    </svg>
  );
}
function IconFacebook() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
      <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.45 2.89h-2.33v6.99A10 10 0 0 0 22 12z" />
    </svg>
  );
}
function IconLinkedIn() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.4c0-1.29-.02-2.95-1.8-2.95-1.8 0-2.08 1.4-2.08 2.85V21H9z" />
    </svg>
  );
}
function IconTelegram() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
      <path d="M21.9 4.3 18.6 19.5c-.24 1.1-.9 1.36-1.83.85l-5.04-3.71-2.43 2.34c-.27.27-.5.5-1 .5l.36-5.1L18.9 6.1c.4-.36-.09-.56-.62-.2L7.1 13.1l-4.98-1.56c-1.08-.34-1.1-1.08.23-1.6L20.5 2.7c.9-.33 1.69.2 1.4 1.6z" />
    </svg>
  );
}

const SOCIAL_ICONS = {
  instagram: IconInstagram,
  facebook: IconFacebook,
  linkedin: IconLinkedIn,
  telegram: IconTelegram,
} as const;

export default function Landing({ onBook }: { onBook: () => void }) {
  const [data, setData] = useState<LandingContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.landing().then(setData).catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="screen"><div className="empty error-box">{error}</div></div>;
  if (!data) return <div className="lp-loading"><div className="loader">Загрузка…</div></div>;

  const book = () => { haptic("success"); onBook(); };
  const cta = data.cta_label || "Забронировать";
  const socials = (Object.keys(SOCIAL_ICONS) as (keyof typeof SOCIAL_ICONS)[])
    .map((k) => ({ k, url: data.socials?.[k]?.trim() }))
    .filter((s) => s.url);

  return (
    <div className="landing">
      <header className="lp-hero">
        <div className="lp-hero-bg" aria-hidden />
        <div className="lp-hero-inner">
          <img className="lp-logo" src={logoUrl} alt="AtS" />
          {data.hero_title && <h1 className="lp-title">{data.hero_title}</h1>}
          {data.hero_subtitle && <p className="lp-sub">{data.hero_subtitle}</p>}
          <button className="lp-cta" onClick={book}>{cta}<span className="lp-cta-arrow" aria-hidden>→</span></button>
          {data.features.length > 0 && (
            <div className="lp-features">
              {data.features.map((f, i) => <span key={i} className="lp-feat">{f}</span>)}
            </div>
          )}
        </div>
      </header>

      <div className="lp-body">
        {data.stats.length > 0 && (
          <section className="lp-stats">
            {data.stats.map((s, i) => (
              <div key={i} className="lp-stat">
                <span className="lp-stat-val">{s.value}</span>
                <span className="lp-stat-label">{s.label}</span>
              </div>
            ))}
          </section>
        )}

        {data.ecosystem.length > 0 && (
          <section className="lp-eco">
            {data.ecosystem.map((e, i) => (
              <article key={i} className="lp-eco-card">
                {e.number && <span className="lp-eco-num">{e.number}</span>}
                <h3 className="lp-eco-title">{e.title}</h3>
                {e.subtitle && <p className="lp-eco-sub">{e.subtitle}</p>}
              </article>
            ))}
          </section>
        )}

        <EventsCalendar />

        <section className="lp-final">
          <h2 className="lp-final-title">Готовы начать?</h2>
          <p className="lp-final-sub">Выберите зал, дату и оформите заявку за пару минут.</p>
          <button className="lp-cta" onClick={book}>{cta}<span className="lp-cta-arrow" aria-hidden>→</span></button>
        </section>

        <footer className="lp-foot">
          <div className="lp-contacts">
            {data.phone && <a href={`tel:${data.phone.replace(/[^\d+]/g, "")}`}>{data.phone}</a>}
            {data.email && <a href={`mailto:${data.email}`}>{data.email}</a>}
          </div>
          {socials.length > 0 && (
            <div className="lp-socials">
              {socials.map(({ k, url }) => {
                const Icon = SOCIAL_ICONS[k];
                return (
                  <a key={k} href={url} target="_blank" rel="noreferrer" className="lp-social" aria-label={k}>
                    <Icon />
                  </a>
                );
              })}
            </div>
          )}
          <span className="lp-copy">© AtS</span>
        </footer>
      </div>
    </div>
  );
}
