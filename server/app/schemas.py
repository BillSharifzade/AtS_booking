from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import BookingStatus


class ZoneCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class ZoneUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class ZoneOut(BaseModel):
    id: int
    name: str
    room_count: int
    total_capacity: int


class ZoneDayOut(BaseModel):
    date: date
    available: bool


class ZoneSlotOut(BaseModel):
    start: time
    end: time


class ZoneImageOut(BaseModel):
    room_id: int
    image_id: int
    room_name: str


class RoomImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    room_id: int
    content_type: str


class RoomImageIn(BaseModel):
    content_type: str = Field(pattern=r"^image/(png|jpeg|jpg|webp|gif)$")
    data: str = Field(min_length=1, description="Base64-encoded image bytes")


class RoomImagesIn(BaseModel):
    images: list[RoomImageIn] = Field(min_length=1, max_length=3)


class RoomCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    zone_id: int
    capacity: int = Field(gt=0)
    meter_squared: int | None = Field(default=None, ge=0)
    open_time: time
    close_time: time
    notes: str | None = None
    is_active: bool = True
    is_coffee_break: bool = False


class RoomUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    zone_id: int | None = None
    capacity: int | None = Field(default=None, gt=0)
    meter_squared: int | None = Field(default=None, ge=0)
    open_time: time | None = None
    close_time: time | None = None
    notes: str | None = None
    is_active: bool | None = None
    is_coffee_break: bool | None = None


class RoomOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    zone_id: int
    zone_name: str
    capacity: int
    meter_squared: int | None
    open_time: time
    close_time: time
    is_active: bool
    is_coffee_break: bool
    notes: str | None


# Seating arrangements ("Расстановка"). Stored as plain strings on Booking so a future
# dynamic layout builder can add custom keys without a schema change.
ROOM_STRUCTS = {"theatre", "class", "banquet", "u_shaped"}

# Requester grade ("Грейд") — a fixed dropdown. Order defines how the UIs list it.
GRADES = [
    "Стажер",
    "Специалист",
    "Ведущий специалист",
    "Главный специалист",
    "Руководитель отдела",
    "Руководитель департамента",
]


class PropRequest(BaseModel):
    prop_id: int
    amount: int = Field(gt=0)


class BookingCreate(BaseModel):
    # Provide either zone_id (system assigns a free room) or an explicit room_id.
    zone_id: int | None = None
    room_id: int | None = None
    company: str
    company_id: int | None = None
    contact_name: str
    phone: str
    customer_telegram_id: int
    customer_username: str | None = None
    event_type: str
    event_name: str
    description: str | None = None
    aim: str | None = Field(default=None, max_length=300)
    grade: str | None = None
    extra_services: str | None = None
    attendees: int = Field(gt=0)
    room_struct: str | None = None
    coffee_break: bool = False
    # Number of coffee breaks during the event (legacy field name).
    coffee_headcount: int | None = Field(default=None, ge=0)
    coffee_type: str | None = None  # "standard" | "other"
    coffee_other: str | None = Field(default=None, max_length=500)
    foreign_guests: bool = False
    is_urgent: bool = False
    privacy_accepted: bool = False
    starts_at: datetime
    ends_at: datetime
    props: list[PropRequest] = []


class BookingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    room_id: int
    company: str
    contact_name: str
    phone: str
    customer_telegram_id: int
    customer_username: str | None
    company_id: int | None
    event_type: str
    event_name: str
    description: str | None
    aim: str | None
    grade: str | None
    extra_services: str | None
    attendees: int
    room_struct: str | None
    coffee_break: bool
    coffee_headcount: int | None
    coffee_type: str | None
    coffee_other: str | None
    foreign_guests: bool
    coffee_status: str
    coffee_room_id: int | None
    starts_at: datetime
    ends_at: datetime
    status: BookingStatus
    is_urgent: bool
    privacy_accepted: bool
    reject_reason: str | None
    result_outcome: str | None
    result_note: str | None
    created_at: datetime
    updated_at: datetime


class StatusHistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    from_status: BookingStatus | None
    to_status: BookingStatus
    actor_telegram_id: int | None
    note: str | None
    created_at: datetime


class FeedbackOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    rating: int
    room_rating: int | None
    service_rating: int | None
    props_rating: int | None
    comment: str | None
    created_at: datetime


class BookingChecklistItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    text: str
    done: bool
    sort_order: int


class BookingChecklistToggle(BaseModel):
    done: bool


class BookingPropOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    prop_id: int
    name: str
    amount: int
    unit: str | None
    kind: str


class BookingWithRoom(BookingOut):
    room: RoomOut
    status_history: list[StatusHistoryOut] = []
    feedback: FeedbackOut | None = None
    checklist: list[BookingChecklistItemOut] = []
    props: list[BookingPropOut] = []


class ReassignIn(BaseModel):
    # Provide either an explicit room_id, or a zone_id to auto-pick the smallest free room.
    room_id: int | None = None
    zone_id: int | None = None


# Allowed coffee-break prep states (Module E).
COFFEE_STATUSES = {"pending", "ready", "served", "not_required"}

# What's served at the coffee break: a fixed standard set, or free-text "other".
COFFEE_TYPES = {"standard", "other"}


class CoffeeUpdate(BaseModel):
    # Both optional; use model_fields_set to tell "unset" from "explicit null".
    coffee_status: str | None = None
    coffee_room_id: int | None = None


class CoffeeBreakOut(BaseModel):
    id: int
    event_name: str
    starts_at: datetime
    ends_at: datetime
    zone: str
    room: str
    attendees: int
    coffee_headcount: int | None
    coffee_type: str | None
    coffee_other: str | None
    foreign_guests: bool
    status: BookingStatus
    coffee_status: str
    coffee_room_id: int | None
    coffee_room: str | None


class ApproveIn(BaseModel):
    note: str | None = None


# Allowed completion outcomes (Module F).
RESULT_OUTCOMES = {"held", "partial", "cancelled"}


class CompleteIn(BaseModel):
    outcome: str | None = None
    note: str | None = None


class RejectIn(BaseModel):
    reason: str = Field(min_length=1)


class AuthRequest(BaseModel):
    telegram_id: int


class AuthVerify(BaseModel):
    telegram_id: int
    code: str = Field(min_length=4, max_length=10)


class AuthToken(BaseModel):
    token: str
    telegram_id: int
    name: str
    role: str
    expires_at: datetime


class PanelUserCreate(BaseModel):
    telegram_id: int
    name: str | None = Field(default=None, max_length=200)
    role: Literal["admin", "viewer"] = "viewer"


class PanelUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    telegram_id: int
    role: str
    name: str | None
    created_at: datetime


class UserOut(BaseModel):
    telegram_id: int
    name: str | None = None
    username: str | None = None


class AlternativeSlot(BaseModel):
    room_id: int
    room_name: str
    starts_at: datetime
    ends_at: datetime


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    actor_telegram_id: int
    action: str
    target_type: str | None
    target_id: int | None
    payload: str | None
    created_at: datetime


class BotTextOut(BaseModel):
    key: str
    label: str
    group: str
    default: str
    value: str
    placeholders: list[str] = []
    is_overridden: bool


class BotTextUpdate(BaseModel):
    value: str = Field(min_length=1)


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    telegram_id: int
    from_admin: bool
    admin_telegram_id: int | None
    text: str
    created_at: datetime


class ChatSendIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class NotificationsOut(BaseModel):
    pending_bookings: int
    latest_booking_id: int
    latest_chat_id: int
    new_messages: int
    unread_by_user: dict[str, int]


class ZoneStat(BaseModel):
    zone: str
    count: int
    attendees: int


class RoomStat(BaseModel):
    room: str
    zone: str
    count: int
    hours: float


class UpcomingItem(BaseModel):
    id: int
    event_name: str
    room: str
    zone: str
    starts_at: datetime
    ends_at: datetime
    attendees: int
    is_urgent: bool


class CompanyStat(BaseModel):
    company: str
    count: int


class DashboardSummary(BaseModel):
    date_from: date | None
    date_to: date | None
    total: int
    by_status: dict[str, int]
    urgent: int
    total_attendees: int
    coffee_breaks: int
    coffee_headcount: int
    avg_rating: float | None
    feedback_count: int
    avg_room_rating: float | None = None
    avg_service_rating: float | None = None
    avg_props_rating: float | None = None
    completion_rate: float | None = None
    approval_rate: float | None = None
    avg_lead_hours: float | None = None
    active_rooms: int = 0
    active_companies: int = 0
    by_zone: list[ZoneStat]
    top_rooms: list[RoomStat]
    top_companies: list[CompanyStat] = []
    by_struct: dict[str, int] = {}
    upcoming: list[UpcomingItem]


# ----- Companies (#4) -----
class CompanyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    website_url: str | None = Field(default=None, max_length=300)
    is_active: bool = True
    # Optional inline logo (base64), picked via the image picker.
    logo_content_type: str | None = Field(default=None, pattern=r"^image/(png|jpeg|jpg|webp|gif|svg\+xml)$")
    logo_data: str | None = None  # base64


class CompanyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    website_url: str | None = Field(default=None, max_length=300)
    is_active: bool | None = None
    logo_content_type: str | None = Field(default=None, pattern=r"^image/(png|jpeg|jpg|webp|gif|svg\+xml)$")
    logo_data: str | None = None  # base64; pass "" to clear


class CompanyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    website_url: str | None
    is_active: bool
    has_logo: bool
    created_at: datetime


# ----- Props / Оборудование (#6) -----
PROP_KINDS = {"tech", "office"}


class PropCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    kind: Literal["tech", "office"] = "tech"
    unit: str | None = Field(default=None, max_length=40)
    amount: int = Field(default=0, ge=0)
    description: str | None = None
    is_active: bool = True


class PropUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    kind: Literal["tech", "office"] | None = None
    unit: str | None = Field(default=None, max_length=40)
    amount: int | None = Field(default=None, ge=0)
    description: str | None = None
    is_active: bool | None = None


class PropOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    kind: str
    unit: str | None
    amount: int
    # Real-time stock left after subtracting amounts held by active bookings.
    # None in admin contexts (total stock matters there); set by the client bootstrap.
    available: int | None = None
    description: str | None
    is_active: bool
    created_at: datetime


# ----- Checklist template (#7) -----
class ChecklistItemCreate(BaseModel):
    text: str = Field(min_length=1, max_length=300)


class ChecklistItemUpdate(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=300)
    sort_order: int | None = None


class ChecklistItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    text: str
    sort_order: int


# ----- Off-time scheduler (#8) -----
class OfftimeCreate(BaseModel):
    room_id: int
    starts_at: datetime
    ends_at: datetime
    reason: str = Field(min_length=1, max_length=160)
    description: str | None = None


class OfftimeUpdate(BaseModel):
    room_id: int | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    reason: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = None


class OfftimeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    room_id: int
    room_name: str
    starts_at: datetime
    ends_at: datetime
    reason: str
    description: str | None
    created_at: datetime


# ----- Articles / База знаний (#10) -----
class ArticleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=60)
    body: str = Field(min_length=1)


class ArticleUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = Field(default=None, min_length=1, max_length=60)
    body: str | None = Field(default=None, min_length=1)


class ArticleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    category: str
    body: str
    created_at: datetime
    updated_at: datetime


# ----- Reviews (#12) -----
class FeedbackCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    room_rating: int | None = Field(default=None, ge=1, le=5)
    service_rating: int | None = Field(default=None, ge=1, le=5)
    props_rating: int | None = Field(default=None, ge=1, le=5)
    comment: str | None = None


# ----- Client Telegram Mini App (#13) -----
class ClientUser(BaseModel):
    telegram_id: int
    name: str | None = None
    username: str | None = None


class ClientBootstrap(BaseModel):
    user: ClientUser
    companies: list[CompanyOut]
    zones: list[ZoneOut]
    props: list[PropOut]


class ClientBookingCreate(BaseModel):
    zone_id: int
    company_id: int | None = None
    company: str = Field(min_length=1, max_length=200)
    contact_name: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=1, max_length=40)
    event_type: str = Field(min_length=1, max_length=100)
    event_name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    aim: str | None = Field(default=None, max_length=300)
    grade: str | None = None
    extra_services: str | None = None
    attendees: int = Field(gt=0)
    room_struct: str | None = None
    coffee_break: bool = False
    # Number of coffee breaks during the event (legacy field name).
    coffee_headcount: int | None = Field(default=None, ge=0)
    coffee_type: str | None = None  # "standard" | "other"
    coffee_other: str | None = Field(default=None, max_length=500)
    foreign_guests: bool = False
    is_urgent: bool = False
    # Client acknowledged the participation rules (required by the form).
    privacy_accepted: bool = False
    starts_at: datetime
    ends_at: datetime
    props: list[PropRequest] = []


class ClientBookingOut(BaseModel):
    """Booking view for the client's "my bookings" list and detail modal."""
    id: int
    event_name: str
    room: str
    zone: str
    starts_at: datetime
    ends_at: datetime
    attendees: int
    status: BookingStatus
    room_struct: str | None
    has_feedback: bool
    # Detail fields (surfaced in the booking detail modal).
    event_type: str | None = None
    company: str | None = None
    contact_name: str | None = None
    phone: str | None = None
    description: str | None = None
    aim: str | None = None
    grade: str | None = None
    extra_services: str | None = None
    coffee_break: bool = False
    coffee_headcount: int | None = None
    coffee_type: str | None = None
    coffee_other: str | None = None
    foreign_guests: bool = False
    is_urgent: bool = False
    created_at: datetime | None = None


class ReviewOut(BaseModel):
    """Admin-facing review row: who/company/room/stars/comment."""
    booking_id: int
    event_name: str
    company: str
    room: str
    zone: str
    customer_telegram_id: int
    rating: int
    room_rating: int | None
    service_rating: int | None
    props_rating: int | None
    comment: str | None
    created_at: datetime
