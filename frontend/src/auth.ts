const KEY = "ats_auth";

export type Role = "admin" | "viewer";
export type Auth = { token: string; telegram_id: number; name: string; role: Role; expires_at: string };

export function loadAuth(): Auth | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Auth;
    if (new Date(a.expires_at).getTime() < Date.now()) {
      localStorage.removeItem(KEY);
      return null;
    }
    return a;
  } catch {
    return null;
  }
}

export function saveAuth(a: Auth) {
  localStorage.setItem(KEY, JSON.stringify(a));
}

export function clearAuth() {
  localStorage.removeItem(KEY);
}

export function isAdmin(): boolean {
  // Back-compat: a token saved before roles existed has no role → treat as admin.
  const a = loadAuth();
  return !a || a.role !== "viewer";
}
