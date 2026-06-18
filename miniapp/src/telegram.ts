// Thin wrapper over the Telegram Mini App SDK (window.Telegram.WebApp).
// Degrades gracefully when opened in a normal browser (dev): initData is empty and
// theme helpers no-op, so the UI still renders for local work.

type TgWebApp = {
  initData: string;
  initDataUnsafe?: { user?: { id: number; first_name?: string; last_name?: string; username?: string } };
  colorScheme?: "light" | "dark";
  themeParams?: Record<string, string>;
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  MainButton?: {
    setText: (t: string) => void;
    show: () => void;
    hide: () => void;
    enable: () => void;
    disable: () => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  HapticFeedback?: { impactOccurred: (s: string) => void; notificationOccurred: (s: string) => void };
  showAlert?: (msg: string) => void;
  close?: () => void;
};

export const tg: TgWebApp | null =
  (typeof window !== "undefined" && (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp) || null;

export function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor?.("#0c0d10");
    tg.setBackgroundColor?.("#f4f5f7");
  } catch {
    /* older clients */
  }
}

// The signed initData string used for API auth. Empty in a plain browser.
export function initData(): string {
  return tg?.initData || "";
}

// True when actually running inside the Telegram client (signed initData present).
export const isTelegram = !!(tg && tg.initData);

// A stable per-browser id so the app works OUTSIDE Telegram (no "missing init
// data" wall). Persisted in localStorage; the backend hashes it to a guest id.
function guestToken(): string {
  const KEY = "ats_guest_id";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() ?? `g_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

// Authorization header value: Telegram-signed when in Telegram, else guest.
export function authHeader(): string {
  const data = initData();
  return data ? `tma ${data}` : `guest ${guestToken()}`;
}

export function haptic(kind: "light" | "success" | "error" = "light") {
  if (!tg?.HapticFeedback) return;
  if (kind === "light") tg.HapticFeedback.impactOccurred("light");
  else tg.HapticFeedback.notificationOccurred(kind);
}

export function alertUser(msg: string) {
  if (tg?.showAlert) tg.showAlert(msg);
  else window.alert(msg);
}
