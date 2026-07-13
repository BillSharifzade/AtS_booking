import { authHeader } from "./telegram";

// API base: same-origin subpath in production (e.g. /booking/api), overridable for dev.
export const BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: authHeader(),
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = `Ошибка ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      /* non-JSON */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type RoomStruct = "theatre" | "class" | "banquet" | "u_shaped";
export type Status = "new" | "processing" | "approved" | "rejected" | "completed" | "archived";

export type Company = { id: number; name: string; website_url: string | null; is_active: boolean; has_logo: boolean };
// A bookable room (zones are admin-only and never exposed to clients). `photos` holds
// RoomImage ids; build the URL via roomImageUrl(room.id, imageId).
export type Room = { id: number; name: string; capacity: string; meter_squared: number | null; photos: number[] };
export type Prop = { id: number; name: string; kind: "tech" | "office"; unit: string | null; amount: number; available: number | null; description: string | null };
export type ClientUser = { telegram_id: number; name: string | null; username: string | null };
export type Bootstrap = { user: ClientUser; companies: Company[]; rooms: Room[]; props: Prop[] };
export type ZoneDay = { date: string; available: boolean };
export type ZoneSlot = { start: string; end: string };

export type ClientBooking = {
  id: number;
  event_name: string;
  room: string;
  starts_at: string;
  ends_at: string;
  attendees: number;
  status: Status;
  room_struct: RoomStruct | null;
  has_feedback: boolean;
  // Detail fields (booking detail modal).
  event_type: string | null;
  company: string | null;
  contact_name: string | null;
  phone: string | null;
  description: string | null;
  aim: string | null;
  grade: string | null;
  extra_services: string | null;
  position: string | null;
  trainer: string | null;
  department: string | null;
  target_employees: string | null;
  coffee_break: boolean;
  coffee_headcount: number | null;
  coffee_type: string | null;
  coffee_other: string | null;
  foreign_guests: boolean;
  is_urgent: boolean;
  created_at: string | null;
};

export type NewBooking = {
  room_id: number;
  company_id: number | null;
  company: string;
  contact_name: string;
  phone: string;
  event_type: string;
  event_name: string;
  description: string | null;
  aim: string | null;
  grade: string | null;
  extra_services: string | null;
  position: string | null;
  trainer: string | null;
  department: string | null;
  target_employees: string | null;
  attendees: number;
  room_struct: RoomStruct | null;
  coffee_break: boolean;
  coffee_headcount: number | null;
  coffee_type: string | null;
  coffee_other: string | null;
  foreign_guests: boolean;
  is_urgent: boolean;
  privacy_accepted: boolean;
  starts_at: string;
  ends_at: string;
  props: { prop_id: number; amount: number }[];
};

export const companyLogoUrl = (id: number) => `${BASE}/companies/${id}/logo`;
export const roomImageUrl = (roomId: number, imageId: number) => `${BASE}/rooms/${roomId}/images/${imageId}/raw`;

export const api = {
  bootstrap: () => request<Bootstrap>("/client/bootstrap"),
  roomDays: (id: number, from: string, to: string, attendees: number) =>
    request<ZoneDay[]>(`/client/rooms/${id}/days?date_from=${from}&date_to=${to}&attendees=${attendees}`),
  roomSlots: (id: number, on: string, attendees: number) =>
    request<ZoneSlot[]>(`/client/rooms/${id}/slots?on=${on}&attendees=${attendees}`),
  createBooking: (data: NewBooking) =>
    request<ClientBooking>("/client/bookings", { method: "POST", body: JSON.stringify(data) }),
  myBookings: () => request<ClientBooking[]>("/client/bookings"),
  submitFeedback: (id: number, data: { rating: number; room_rating: number | null; service_rating: number | null; props_rating: number | null; comment: string | null }) =>
    request<{ ok: boolean }>(`/client/bookings/${id}/feedback`, { method: "POST", body: JSON.stringify(data) }),
};
