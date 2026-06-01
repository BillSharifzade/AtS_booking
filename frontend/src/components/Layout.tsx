import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { clearAuth, isAdmin, loadAuth } from "../auth";
import { useNotifications } from "../notifications";
import UserName from "./UserName";

const COLLAPSE_KEY = "ats_sidebar_collapsed";

const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");

export default function Layout() {
  const auth = loadAuth();
  const nav = useNavigate();
  const { pendingBookings } = useNotifications();
  const admin = isAdmin();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");

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

  return (
    <div className={`layout ${collapsed ? "collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.png" alt="AtS" />
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
          {/* Order: Заявки · Помещения (зоны) · Дашборд · Тексты бота · Журнал */}
          <NavLink to="/bookings" className={linkClass} title="Заявки">
            <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18" /><path d="M8 2v4M16 2v4" />
            </svg>
            <span>Заявки</span>
            {pendingBookings > 0 && <span className="nav-badge">{pendingBookings}</span>}
          </NavLink>

          <NavLink to="/coffee" className={linkClass} title="Кофе-брейки">
            <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" /><path d="M6 1v3M10 1v3M14 1v3" />
            </svg>
            <span>Кофе-брейки</span>
          </NavLink>

          <NavLink to="/rooms" className={linkClass} title="Помещения и зоны">
            <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 21h18" /><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" /><path d="M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01" />
            </svg>
            <span>Помещения</span>
          </NavLink>

          <NavLink to="/" end className={linkClass} title="Дашборд">
            <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
            </svg>
            <span>Дашборд</span>
          </NavLink>

          <NavLink to="/bot-texts" className={linkClass} title="Тексты бота">
            <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
            <span>Тексты бота</span>
          </NavLink>

          <NavLink to="/audit" className={linkClass} title="Журнал">
            <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" />
            </svg>
            <span>Журнал</span>
          </NavLink>

          {admin && (
            <NavLink to="/users" className={linkClass} title="Пользователи">
              <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>Пользователи</span>
            </NavLink>
          )}
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
