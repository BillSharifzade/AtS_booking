import { api, ResolvedUser } from "./api";

// Module-level cache. Many <UserName> components mount at once (audit log rows,
// history rows); requests made in the same tick are batched into one /users call.
const cache = new Map<number, ResolvedUser>();
const pending = new Set<number>();
const listeners = new Set<() => void>();
let scheduled = false;

function notify() {
  listeners.forEach((l) => l());
}

async function flush() {
  scheduled = false;
  const todo = [...pending].filter((id) => !cache.has(id));
  pending.clear();
  if (todo.length === 0) return;
  try {
    const users = await api.resolveUsers(todo);
    users.forEach((u) => cache.set(u.telegram_id, u));
    notify();
  } catch {
    /* leave uncached; components fall back to showing the ID */
  }
}

export function requestUser(id: number) {
  if (cache.has(id) || pending.has(id)) return;
  pending.add(id);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flush);
  }
}

export function getCachedName(id: number): string | null {
  return cache.get(id)?.name ?? null;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
