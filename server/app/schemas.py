from datetime import date, datetime, time

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
    end: time  # latest end reachable from this start within one room's free interval


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
    open_time: time
    close_time: time
    notes: str | None = None
    is_active: bool = True
    is_coffee_break: bool = False


class RoomUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    zone_id: int | None = None
    capacity: int | None = Field(default=None, gt=0)
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
    open_time: time
    close_time: time
    is_active: bool
    is_coffee_break: bool
    notes: str | None


class BookingCreate(BaseModel):
    # Provide either zone_id (system assigns a free room) or an explicit room_id.
    zone_id: int | None = None
    room_id: int | None = None
    company: str
    contact_name: str
    phone: str
    customer_telegram_id: int
    customer_username: str | None = None
    event_type: str
    event_name: str
    description: str | None = None
    attendees: int = Field(gt=0)
    coffee_break: bool = False
    coffee_headcount: int | None = Field(default=None, ge=0)
    is_urgent: bool = False
    starts_at: datetime
    ends_at: datetime


class BookingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    room_id: int
    company: str
    contact_name: str
    phone: str
    customer_telegram_id: int
    customer_username: str | None
    event_type: str
    event_name: str
    description: str | None
    attendees: int
    coffee_break: bool
    coffee_headcount: int | None
    coffee_status: str
    coffee_room_id: int | None
    starts_at: datetime
    ends_at: datetime
    status: BookingStatus
    is_urgent: bool
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
    comment: str | None
    created_at: datetime


class BookingWithRoom(BookingOut):
    room: RoomOut
    status_history: list[StatusHistoryOut] = []
    feedback: FeedbackOut | None = None


class ReassignIn(BaseModel):
    # Provide either an explicit room_id, or a zone_id to auto-pick the smallest free room.
    room_id: int | None = None
    zone_id: int | None = None


# Allowed coffee-break prep states (Module E).
COFFEE_STATUSES = {"pending", "ready", "served", "not_required"}


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
    by_zone: list[ZoneStat]
    top_rooms: list[RoomStat]
    upcoming: list[UpcomingItem]
