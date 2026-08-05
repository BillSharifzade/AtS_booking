import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { clearAuth, isAdmin, loadAuth } from "../auth";
import { useNotifications } from "../notifications";
import UserName from "./UserName";

const COLLAPSE_KEY = "ats_sidebar_collapsed";
const GROUPS_KEY = "ats_sidebar_groups";

const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");

type Item = {
  to: string;
  label: string;
  title: string;
  icon: JSX.Element;
  end?: boolean;
  adminOnly?: boolean;
  /** Renders the pending-bookings counter next to the label. */
  badge?: boolean;
};

type Group = { id: string; label: string; icon: JSX.Element; items: Item[] };

const ico = (...paths: JSX.Element[]) => (
  <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {paths}
  </svg>
);

// Sidebar is grouped by what the section is *for*: day-to-day request handling,
// read-only reporting, and configuration. Order and labels come from the Jul-2026
// review (Заявки → Аналитика → Настройки).
const GROUPS: Group[] = [
  {
    id: "requests",
    label: "Заявки",
    icon: ico(<rect key="a" x="3" y="4" width="18" height="17" rx="2" />, <path key="b" d="M3 9h18" />, <path key="c" d="M8 2v4M16 2v4" />),
    items: [
      {
        to: "/bookings", label: "Заявки", title: "Заявки", badge: true,
        icon: ico(<rect key="a" x="3" y="4" width="18" height="17" rx="2" />, <path key="b" d="M3 9h18" />, <path key="c" d="M8 2v4M16 2v4" />),
      },
      {
        to: "/coffee", label: "Кофе-брейки", title: "Кофе-брейки",
        icon: ico(<path key="a" d="M18 8h1a4 4 0 0 1 0 8h-1" />, <path key="b" d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />, <path key="c" d="M6 1v3M10 1v3M14 1v3" />),
      },
      {
        to: "/checklist", label: "Чек-лист", title: "Чек-лист подготовки", adminOnly: true,
        icon: ico(<path key="a" d="M9 11l3 3L22 4" />, <path key="b" d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />),
      },
    ],
  },
  {
    id: "analytics",
    label: "Аналитика",
    icon: ico(<rect key="a" x="3" y="3" width="7" height="9" rx="1.5" />, <rect key="b" x="14" y="3" width="7" height="5" rx="1.5" />, <rect key="c" x="14" y="12" width="7" height="9" rx="1.5" />, <rect key="d" x="3" y="16" width="7" height="5" rx="1.5" />),
    items: [
      {
        to: "/", end: true, label: "Аналитика", title: "Аналитика",
        icon: ico(<rect key="a" x="3" y="3" width="7" height="9" rx="1.5" />, <rect key="b" x="14" y="3" width="7" height="5" rx="1.5" />, <rect key="c" x="14" y="12" width="7" height="9" rx="1.5" />, <rect key="d" x="3" y="16" width="7" height="5" rx="1.5" />),
      },
      {
        to: "/reviews", label: "Отзывы", title: "Отзывы",
        icon: ico(<path key="a" d="M12 2l2.6 6.3 6.8.5-5.2 4.4 1.6 6.6L12 16.8 6.2 20.4l1.6-6.6L2.6 8.8l6.8-.5z" />),
      },
      {
        to: "/audit", label: "Журнал", title: "Журнал",
        icon: ico(<path key="a" d="M3 12a9 9 0 1 0 3-6.7L3 8" />, <path key="b" d="M3 3v5h5" />, <path key="c" d="M12 7v5l3 2" />),
      },
    ],
  },
  {
    id: "settings",
    label: "Настройки",
    icon: ico(<circle key="a" cx="12" cy="12" r="3" />, <path key="b" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />),
    items: [
      {
        to: "/rooms", label: "Помещения", title: "Помещения и зоны",
        icon: ico(<path key="a" d="M3 21h18" />, <path key="b" d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" />, <path key="c" d="M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01" />),
      },
      {
        to: "/companies", label: "Компании", title: "Компании",
        icon: ico(<path key="a" d="M3 21h18" />, <path key="b" d="M5 21V7l8-4v18" />, <path key="c" d="M19 21V11l-6-4" />, <path key="d" d="M9 9v.01M9 12v.01M9 15v.01" />),
      },
      {
        to: "/props", label: "Оборудование", title: "Оборудование",
        icon: ico(<rect key="a" x="2" y="7" width="20" height="14" rx="2" />, <path key="b" d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />),
      },
      {
        to: "/offtimes", label: "Недоступность", title: "Недоступность помещений",
        icon: ico(<circle key="a" cx="12" cy="12" r="9" />, <path key="b" d="M5.6 5.6l12.8 12.8" />),
      },
      {
        to: "/knowledge", label: "База знаний", title: "База знаний",
        icon: ico(<path key="a" d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />, <path key="b" d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />),
      },
      {
        to: "/landing", label: "Лендинг", title: "Лендинг сайта", adminOnly: true,
        icon: ico(<rect key="a" x="3" y="3" width="18" height="18" rx="2" />, <path key="b" d="M3 9h18" />, <path key="c" d="M9 21V9" />),
      },
      {
        to: "/notify-settings", label: "Уведомления", title: "Уведомления администраторов",
        icon: ico(<path key="a" d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />, <path key="b" d="M13.7 21a2 2 0 0 1-3.4 0" />),
      },
      {
        to: "/bot-texts", label: "Тексты бота", title: "Тексты бота",
        icon: ico(<path key="a" d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />),
      },
      {
        to: "/users", label: "Пользователи", title: "Пользователи", adminOnly: true,
        icon: ico(<path key="a" d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />, <circle key="b" cx="9" cy="7" r="4" />, <path key="c" d="M23 21v-2a4 4 0 0 0-3-3.87" />, <path key="d" d="M16 3.13a4 4 0 0 1 0 7.75" />),
      },
    ],
  },
];

/** Which group owns the current URL — used to auto-open it on navigation. */
function groupForPath(pathname: string): string | null {
  let best: { id: string; len: number } | null = null;
  for (const g of GROUPS) {
    for (const item of g.items) {
      const hit = item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
      if (hit && (!best || item.to.length > best.len)) best = { id: g.id, len: item.to.length };
    }
  }
  return best?.id ?? null;
}

function loadOpenGroups(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    /* corrupted value — fall through to the default */
  }
  return Object.fromEntries(GROUPS.map((g) => [g.id, true]));
}

export default function Layout() {
  const auth = loadAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { pendingBookings } = useNotifications();
  const admin = isAdmin();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const [open, setOpen] = useState<Record<string, boolean>>(loadOpenGroups);

  // Navigating into a collapsed group (e.g. via a link in the page body) should
  // reveal where you landed rather than leave the sidebar looking unrelated.
  useEffect(() => {
    const active = groupForPath(pathname);
    if (active) setOpen((o) => (o[active] ? o : { ...o, [active]: true }));
  }, [pathname]);

  useEffect(() => {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(open));
  }, [open]);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  };
  const logout = () => {
    clearAuth();
    nav("/login");
  };

  const renderItem = (item: Item) => (
    <NavLink key={item.to} to={item.to} end={item.end} className={linkClass} title={item.title}>
      {item.icon}
      <span>{item.label}</span>
      {item.badge && pendingBookings > 0 && <span className="nav-badge">{pendingBookings}</span>}
    </NavLink>
  );

  return (
    <div className={`layout ${collapsed ? "collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="AtS" />
          <span className="brand-name">
            AtS
            <span className="brand-sub">Бронирование</span>
          </span>
          <button
            className="sidebar-toggle"
            onClick={toggle}
            aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
            title={collapsed ? "Развернуть" : "Свернуть"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>

        <nav>
          {GROUPS.map((group) => {
            const items = group.items.filter((i) => !i.adminOnly || admin);
            if (!items.length) return null;
            // Collapsed rail has no room for headers — show the icons as one flat list.
            if (collapsed) return <div key={group.id} className="nav-group flat">{items.map(renderItem)}</div>;
            const isOpen = open[group.id] !== false;
            const groupBadge = !isOpen && items.some((i) => i.badge) && pendingBookings > 0;
            return (
              <div key={group.id} className={`nav-group ${isOpen ? "open" : ""}`}>
                <button
                  type="button"
                  className="nav-group-head"
                  aria-expanded={isOpen}
                  onClick={() => setOpen((o) => ({ ...o, [group.id]: !isOpen }))}
                >
                  {group.icon}
                  <span>{group.label}</span>
                  {groupBadge && <span className="nav-badge">{pendingBookings}</span>}
                  <svg className="nav-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                <div className="nav-group-body">
                  <div className="nav-group-inner">{items.map(renderItem)}</div>
                </div>
              </div>
            );
          })}
        </nav>

        <div className="who">
          <span className="who-label">Вы вошли как</span>
          {auth && <UserName id={auth.telegram_id} fallbackName={auth.name || undefined} />}
          <button className="logout-btn" onClick={logout} title="Выйти">
            <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
            </svg>
            <span>Выйти</span>
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
