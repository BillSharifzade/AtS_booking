import { loadAuth, clearAuth } from "./auth";

export const BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export function roomImageUrl(roomId: number, imageId: number): string {
  return `${BASE}/rooms/${roomId}/images/${imageId}/raw`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = loadAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (auth) headers["Authorization"] = `Bearer ${auth.token}`;

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    clearAuth();
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {}
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type Status = "new" | "processing" | "approved" | "rejected" | "completed" | "archived";

export type Zone = {
  id: number;
  name: string;
  room_count: number;
  total_capacity: number;
};

export type ZoneDay = { date: string; available: boolean };
export type ZoneSlot = { start: string; end: string };
export type ZoneImage = { room_id: number; image_id: number; room_name: string };

export type Room = {
  id: number;
  name: string;
  zone_id: number;
  zone_name: string;
  capacity: number;
  open_time: string;
  close_time: string;
  is_active: boolean;
  is_coffee_break: boolean;
  notes: string | null;
};

export type RoomImage = {
  id: number;
  room_id: number;
  content_type: string;
};

export type Booking = {
  id: number;
  room_id: number;
  company: string;
  contact_name: string;
  phone: string;
  customer_telegram_id: number;
  customer_username: string | null;
  event_type: string;
  event_name: string;
  description: string | null;
  attendees: number;
  coffee_break: boolean;
  coffee_headcount: number | null;
  coffee_status: string;
  coffee_room_id: number | null;
  starts_at: string;
  ends_at: string;
  status: Status;
  is_urgent: boolean;
  reject_reason: string | null;
  result_outcome: string | null;
  result_note: string | null;
  created_at: string;
  updated_at: string;
};

export type StatusHistory = {
  id: number;
  from_status: Status | null;
  to_status: Status;
  actor_telegram_id: number | null;
  note: string | null;
  created_at: string;
};

export type Feedback = { rating: number; comment: string | null; created_at: string };

export type CoffeeBreak = {
  id: number;
  event_name: string;
  starts_at: string;
  ends_at: string;
  zone: string;
  room: string;
  attendees: number;
  coffee_headcount: number | null;
  status: Status;
  coffee_status: string;
  coffee_room_id: number | null;
  coffee_room: string | null;
};

export type BookingWithRoom = Booking & {
  room: Room;
  status_history: StatusHistory[];
  feedback: Feedback | null;
};

export type Audit = {
  id: number;
  actor_telegram_id: number;
  action: string;
  target_type: string | null;
  target_id: number | null;
  payload: string | null;
  created_at: string;
};

export type NotificationsSummary = {
  pending_bookings: number;
  latest_booking_id: number;
  latest_chat_id: number;
  new_messages: number;
  unread_by_user: Record<string, number>;
};

export type ResolvedUser = {
  telegram_id: number;
  name: string | null;
  username: string | null;
};

export type BotText = {
  key: string;
  label: string;
  group: string;
  default: string;
  value: string;
  placeholders: string[];
  is_overridden: boolean;
};

export type ZoneStat = { zone: string; count: number; attendees: number };
export type RoomStat = { room: string; zone: string; count: number; hours: number };
export type UpcomingItem = {
  id: number;
  event_name: string;
  room: string;
  zone: string;
  starts_at: string;
  ends_at: string;
  attendees: number;
  is_urgent: boolean;
};
export type DashboardSummary = {
  date_from: string | null;
  date_to: string | null;
  total: number;
  by_status: Partial<Record<Status, number>>;
  urgent: number;
  total_attendees: number;
  coffee_breaks: number;
  coffee_headcount: number;
  avg_rating: number | null;
  feedback_count: number;
  by_zone: ZoneStat[];
  top_rooms: RoomStat[];
  upcoming: UpcomingItem[];
};

export type PanelUser = {
  telegram_id: number;
  role: string;
  name: string | null;
  created_at: string;
};

export type ChatMessage = {
  id: number;
  telegram_id: number;
  from_admin: boolean;
  admin_telegram_id: number | null;
  text: string;
  created_at: string;
};

export type NewBooking = {
  zone_id?: number;
  room_id?: number;
  company: string;
  contact_name: string;
  phone: string;
  customer_telegram_id: number;
  customer_username: string | null;
  event_type: string;
  event_name: string;
  description: string | null;
  attendees: number;
  coffee_break: boolean;
  coffee_headcount: number | null;
  is_urgent: boolean;
  starts_at: string;
  ends_at: string;
};

export const api = {
  requestCode: (telegram_id: number) =>
    request<void>("/auth/request-code", { method: "POST", body: JSON.stringify({ telegram_id }) }),
  verifyCode: (telegram_id: number, code: string) =>
    request<{ token: string; telegram_id: number; name: string; role: "admin" | "viewer"; expires_at: string }>(
      "/auth/verify-code",
      { method: "POST", body: JSON.stringify({ telegram_id, code }) },
    ),

  listPanelUsers: () => request<PanelUser[]>("/panel-users"),
  addPanelUser: (telegram_id: number, name: string | null) =>
    request<PanelUser>("/panel-users", { method: "POST", body: JSON.stringify({ telegram_id, name }) }),
  removePanelUser: (telegram_id: number) =>
    request<void>(`/panel-users/${telegram_id}`, { method: "DELETE" }),

  resolveUsers: (ids: number[]) => {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return Promise.resolve([] as ResolvedUser[]);
    return request<ResolvedUser[]>(`/users?ids=${unique.join(",")}`);
  },

  listZones: () => request<Zone[]>("/zones"),
  createZone: (name: string) =>
    request<Zone>("/zones", { method: "POST", body: JSON.stringify({ name }) }),
  updateZone: (id: number, name: string) =>
    request<Zone>(`/zones/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteZone: (id: number) => request<void>(`/zones/${id}`, { method: "DELETE" }),
  zoneDays: (id: number, from: string, to: string, attendees: number) =>
    request<ZoneDay[]>(`/zones/${id}/days?date_from=${from}&date_to=${to}&attendees=${attendees}`),
  zoneSlots: (id: number, on: string, attendees: number) =>
    request<ZoneSlot[]>(`/zones/${id}/slots?on=${on}&attendees=${attendees}`),
  zoneImages: (id: number) => request<ZoneImage[]>(`/zones/${id}/images`),

  listRooms: () => request<Room[]>("/rooms"),
  createRoom: (data: Partial<Room>) =>
    request<Room>("/rooms", { method: "POST", body: JSON.stringify(data) }),
  updateRoom: (id: number, data: Partial<Room>) =>
    request<Room>(`/rooms/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deactivateRoom: (id: number) =>
    request<void>(`/rooms/${id}`, { method: "DELETE" }),

  listRoomImages: (roomId: number) => request<RoomImage[]>(`/rooms/${roomId}/images`),
  uploadRoomImages: (roomId: number, images: { content_type: string; data: string }[]) =>
    request<RoomImage[]>(`/rooms/${roomId}/images`, { method: "POST", body: JSON.stringify({ images }) }),
  deleteRoomImage: (roomId: number, imageId: number) =>
    request<void>(`/rooms/${roomId}/images/${imageId}`, { method: "DELETE" }),

  listBookings: (params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
    return request<Booking[]>(`/bookings?${qs.toString()}`);
  },
  getBooking: (id: number) => request<BookingWithRoom>(`/bookings/${id}`),
  createBooking: (data: NewBooking) =>
    request<Booking>("/bookings", { method: "POST", body: JSON.stringify(data) }),
  approve: (id: number, note?: string) =>
    request<Booking>(`/bookings/${id}/approve`, { method: "POST", body: JSON.stringify({ note }) }),
  reject: (id: number, reason: string) =>
    request<Booking>(`/bookings/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  complete: (id: number, body?: { outcome?: string | null; note?: string | null }) =>
    request<Booking>(`/bookings/${id}/complete`, { method: "POST", body: JSON.stringify(body ?? {}) }),
  archive: (id: number) => request<Booking>(`/bookings/${id}/archive`, { method: "POST", body: "{}" }),
  reassign: (id: number, body: { room_id?: number; zone_id?: number }) =>
    request<BookingWithRoom>(`/bookings/${id}/reassign`, { method: "POST", body: JSON.stringify(body) }),
  listCoffee: () => request<CoffeeBreak[]>("/bookings/coffee"),
  setCoffee: (id: number, body: { coffee_status?: string; coffee_room_id?: number | null }) =>
    request<BookingWithRoom>(`/bookings/${id}/coffee`, { method: "PATCH", body: JSON.stringify(body) }),

  audit: () => request<Audit[]>("/audit"),

  listBotTexts: () => request<BotText[]>("/bot-texts"),
  updateBotText: (key: string, value: string) =>
    request<BotText>(`/bot-texts/${key}`, { method: "PUT", body: JSON.stringify({ value }) }),

  notifications: (afterChatId = 0) =>
    request<NotificationsSummary>(`/notifications?after_chat_id=${afterChatId}`),

  getChat: (telegramId: number, after = 0) =>
    request<ChatMessage[]>(`/chat/${telegramId}?after=${after}`),
  sendChat: (telegramId: number, text: string) =>
    request<ChatMessage>(`/chat/${telegramId}`, { method: "POST", body: JSON.stringify({ text }) }),

  dashboard: (from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set("date_from", from);
    if (to) qs.set("date_to", to);
    return request<DashboardSummary>(`/reports/summary?${qs.toString()}`);
  },

  // Streams the .xlsx as a blob (the shared request() helper only handles JSON) and
  // triggers a browser download. Honours the same auth + period as the dashboard.
  downloadReport: async (from?: string, to?: string) => {
    const auth = loadAuth();
    const qs = new URLSearchParams();
    if (from) qs.set("date_from", from);
    if (to) qs.set("date_to", to);
    const res = await fetch(`${BASE}/reports/bookings.xlsx?${qs.toString()}`, {
      headers: auth ? { Authorization: `Bearer ${auth.token}` } : {},
    });
    if (res.status === 401) {
      clearAuth();
      window.location.href = "/login";
      throw new Error("unauthorized");
    }
    if (!res.ok) throw new Error(`Не удалось сформировать отчёт (${res.status}).`);
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const match = cd.match(/filename="?([^"]+)"?/);
    const name = match?.[1] || "ats_bookings.xlsx";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
