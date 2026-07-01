from __future__ import annotations

import enum
from datetime import datetime, time

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class BookingStatus(str, enum.Enum):
    new = "new"
    processing = "processing"  # DEPRECATED/retired: no longer assigned; kept for legacy rows + PG enum.
    approved = "approved"
    rejected = "rejected"
    completed = "completed"
    archived = "archived"


class Zone(Base):
    """Admin-managed grouping of rooms (Module E). Replaces the old fixed A/Б/В enum:
    admins create/rename/delete zones, and a zone's capacity is the sum of its rooms."""

    __tablename__ = "zones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    rooms: Mapped[list[Room]] = relationship(back_populates="zone", order_by="Room.name")


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id"), nullable=False, index=True)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    # Floor area in square metres (admin-entered, optional).
    meter_squared: Mapped[int | None] = mapped_column(Integer)
    open_time: Mapped[time] = mapped_column(Time, nullable=False)
    close_time: Mapped[time] = mapped_column(Time, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Coffee-break rooms are catering/logistics spaces — not directly bookable by customers.
    is_coffee_break: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # selectin: zone is loaded eagerly whenever a Room loads, so async code/serialization
    # never triggers a lazy load (which would raise MissingGreenlet).
    zone: Mapped[Zone] = relationship(back_populates="rooms", lazy="selectin")
    bookings: Mapped[list[Booking]] = relationship(
        back_populates="room", foreign_keys="Booking.room_id"
    )
    images: Mapped[list[RoomImage]] = relationship(
        back_populates="room", cascade="all, delete-orphan", order_by="RoomImage.sort_order, RoomImage.id"
    )

    @property
    def zone_name(self) -> str:
        return self.zone.name


class RoomImage(Base):
    """Demonstration photos of a room (interior). Up to 10 per room, stored inline."""

    __tablename__ = "room_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(
        ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    content_type: Mapped[str] = mapped_column(String(60), nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Telegram file_id cached after first upload — lets the bot resend without re-uploading bytes.
    tg_file_id: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    room: Mapped[Room] = relationship(back_populates="images")


class Booking(Base):
    __tablename__ = "bookings"
    # Fetch server-side defaults/onupdate (e.g. updated_at) via RETURNING on
    # INSERT *and* UPDATE, so they're never left expired for response serialization.
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"), nullable=False)

    company: Mapped[str] = mapped_column(String(200), nullable=False)
    # Optional link to a curated Company record (clients pick from the active list).
    # The free-text `company` is kept as a denormalised label / legacy fallback.
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id"))
    contact_name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str] = mapped_column(String(40), nullable=False)
    customer_telegram_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    customer_username: Mapped[str | None] = mapped_column(String(100))

    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    event_name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    attendees: Mapped[int] = mapped_column(Integer, nullable=False)
    # Seating arrangement ("Расстановка"): theatre / class / banquet / u_shaped.
    # Stored as a plain string (not an enum) so a dynamic layout builder can
    # introduce custom layout keys later without a schema migration.
    room_struct: Mapped[str | None] = mapped_column(String(40))

    coffee_break: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # NB: despite the legacy column name, this now holds the NUMBER OF COFFEE BREAKS
    # requested during the event (not a head count). Only meaningful when coffee_break.
    coffee_headcount: Mapped[int | None] = mapped_column(Integer)
    # What's served: "standard" (печенье/кофе/чай/конфеты) or "other" (free-text below).
    coffee_type: Mapped[str | None] = mapped_column(String(20))
    coffee_other: Mapped[str | None] = mapped_column(Text)
    # Foreign guests → the coffee break is served in the event room itself, so no
    # separate coffee-break room is assigned.
    foreign_guests: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Coffee-break preparation (Module E): lifecycle + which coffee-break room serves it.
    # Values: pending / ready / served / not_required. Only meaningful when coffee_break.
    coffee_status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    coffee_room_id: Mapped[int | None] = mapped_column(ForeignKey("rooms.id"))

    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    status: Mapped[BookingStatus] = mapped_column(
        Enum(BookingStatus, name="booking_status"),
        default=BookingStatus.new,
        nullable=False,
        index=True,
    )
    is_urgent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reject_reason: Mapped[str | None] = mapped_column(Text)
    # Result captured at completion (Module F): outcome (held/partial/cancelled) + note.
    result_outcome: Mapped[str | None] = mapped_column(String(20))
    result_note: Mapped[str | None] = mapped_column(Text)

    reminder_day_sent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reminder_hour_sent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Two FKs point at rooms (event room + coffee room) → disambiguate with foreign_keys.
    room: Mapped[Room] = relationship(back_populates="bookings", foreign_keys=[room_id])
    coffee_room: Mapped[Room | None] = relationship(foreign_keys=[coffee_room_id])
    company_ref: Mapped[Company | None] = relationship(lazy="selectin")
    status_history: Mapped[list[StatusHistory]] = relationship(
        back_populates="booking", cascade="all, delete-orphan", order_by="StatusHistory.created_at"
    )
    feedback: Mapped[Feedback | None] = relationship(
        back_populates="booking", uselist=False, cascade="all, delete-orphan"
    )
    checklist: Mapped[list[BookingChecklistItem]] = relationship(
        back_populates="booking",
        cascade="all, delete-orphan",
        order_by="BookingChecklistItem.sort_order, BookingChecklistItem.id",
    )
    props: Mapped[list[BookingProp]] = relationship(
        back_populates="booking", cascade="all, delete-orphan"
    )


class StatusHistory(Base):
    __tablename__ = "status_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False)
    from_status: Mapped[BookingStatus | None] = mapped_column(Enum(BookingStatus, name="booking_status"))
    to_status: Mapped[BookingStatus] = mapped_column(Enum(BookingStatus, name="booking_status"), nullable=False)
    actor_telegram_id: Mapped[int | None] = mapped_column(BigInteger)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    booking: Mapped[Booking] = relationship(back_populates="status_history")


class LoginCode(Base):
    __tablename__ = "login_codes"
    __table_args__ = (UniqueConstraint("telegram_id", name="uq_login_code_tg"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    code_hash: Mapped[str] = mapped_column(String(120), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_telegram_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(40))
    target_id: Mapped[int | None] = mapped_column(Integer)
    payload: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class TgUser(Base):
    """Cache of Telegram profile data so the panel can show names instead of raw IDs."""

    __tablename__ = "tg_users"

    telegram_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    first_name: Mapped[str | None] = mapped_column(String(200))
    last_name: Mapped[str | None] = mapped_column(String(200))
    username: Mapped[str | None] = mapped_column(String(100))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    @property
    def real_name(self) -> str | None:
        """Human name if known (full name, else @username), otherwise None."""
        full = " ".join(p for p in (self.first_name, self.last_name) if p).strip()
        if full:
            return full
        return f"@{self.username}" if self.username else None

    @property
    def display_name(self) -> str:
        return self.real_name or f"ID {self.telegram_id}"


class BotText(Base):
    """Admin-editable overrides for the bot's conversational text responses."""

    __tablename__ = "bot_texts"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Feedback(Base):
    """Post-event feedback from the customer (Module F). One per booking."""

    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    booking_id: Mapped[int] = mapped_column(
        ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    rating: Mapped[int] = mapped_column(Integer, nullable=False)  # 1..5 overall
    # Per-aspect sub-ratings (1..5), optional so legacy single-rating feedback stays valid.
    room_rating: Mapped[int | None] = mapped_column(Integer)
    service_rating: Mapped[int | None] = mapped_column(Integer)
    props_rating: Mapped[int | None] = mapped_column(Integer)
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    booking: Mapped[Booking] = relationship(back_populates="feedback")


class PanelUser(Base):
    """Panel-managed accounts beyond the env superadmins (Module §2.3).
    Currently only read-only ``viewer`` (department-lead) accounts are created here;
    env ``ADMIN_TELEGRAM_IDS`` remain permanent admins and are never stored in this table."""

    __tablename__ = "panel_users"

    telegram_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="viewer")
    name: Mapped[str | None] = mapped_column(String(200))
    added_by: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ChatMessage(Base):
    """Direct messages between a requester (by telegram_id) and administrators,
    bridged through the bot. `from_admin` marks the direction."""

    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    from_admin: Mapped[bool] = mapped_column(Boolean, nullable=False)
    admin_telegram_id: Mapped[int | None] = mapped_column(BigInteger)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class Company(Base):
    """Admin-curated company directory. Clients pick their company from the active
    list when booking; the logo is stored inline (served via /companies/{id}/logo)."""

    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    website_url: Mapped[str | None] = mapped_column(String(300))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    logo_content_type: Mapped[str | None] = mapped_column(String(60))
    logo_data: Mapped[bytes | None] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def has_logo(self) -> bool:
        return self.logo_data is not None


class Prop(Base):
    """Equipment / supplies inventory ("Оборудование"). Two kinds:
    ``tech`` (countable units, e.g. projectors) and ``office`` (consumables with a
    custom unit, e.g. "пачка" of A4 paper, "бутылка" of water)."""

    __tablename__ = "props"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), default="tech", nullable=False)  # tech | office
    # Free-text unit for office consumables (e.g. "пачка", "бутылка"). None ⇒ plain "шт.".
    unit: Mapped[str | None] = mapped_column(String(40))
    amount: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BookingProp(Base):
    """Props requested for a specific booking, with the requested amount."""

    __tablename__ = "booking_props"
    __table_args__ = (UniqueConstraint("booking_id", "prop_id", name="uq_booking_prop"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    booking_id: Mapped[int] = mapped_column(
        ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    prop_id: Mapped[int] = mapped_column(ForeignKey("props.id", ondelete="CASCADE"), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    booking: Mapped[Booking] = relationship(back_populates="props")
    prop: Mapped[Prop] = relationship(lazy="selectin")

    @property
    def name(self) -> str:
        return self.prop.name

    @property
    def unit(self) -> str | None:
        return self.prop.unit

    @property
    def kind(self) -> str:
        return self.prop.kind


class ChecklistTemplateItem(Base):
    """A single stage in the global room-preparation checklist template.
    Copied onto every new booking as a BookingChecklistItem."""

    __tablename__ = "checklist_template_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    text: Mapped[str] = mapped_column(String(300), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BookingChecklistItem(Base):
    """Per-booking copy of a checklist stage; admins tick items as prep is done."""

    __tablename__ = "booking_checklist_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    booking_id: Mapped[int] = mapped_column(
        ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    text: Mapped[str] = mapped_column(String(300), nullable=False)
    done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    booking: Mapped[Booking] = relationship(back_populates="checklist")


class RoomOfftime(Base):
    """Admin-scheduled period during which a room is unavailable for booking
    (maintenance, private hold, etc.). Enforced in availability/conflict checks."""

    __tablename__ = "room_offtimes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(
        ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reason: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    room: Mapped[Room] = relationship(lazy="selectin")


class Article(Base):
    """Knowledge-base article ("База знаний"). Category mirrors a panel module."""

    __tablename__ = "articles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(60), nullable=False, default="general", index=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
