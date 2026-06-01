"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-05-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE TYPE zone AS ENUM ('A', 'B', 'V')")
    op.execute(
        "CREATE TYPE booking_status AS ENUM "
        "('new', 'processing', 'approved', 'rejected', 'completed', 'archived')"
    )
    zone = postgresql.ENUM(name="zone", create_type=False)
    booking_status = postgresql.ENUM(name="booking_status", create_type=False)

    op.create_table(
        "rooms",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(120), nullable=False, unique=True),
        sa.Column("zone", zone, nullable=False),
        sa.Column("capacity", sa.Integer, nullable=False),
        sa.Column("open_time", sa.Time, nullable=False),
        sa.Column("close_time", sa.Time, nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "bookings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("room_id", sa.Integer, sa.ForeignKey("rooms.id"), nullable=False),
        sa.Column("company", sa.String(200), nullable=False),
        sa.Column("contact_name", sa.String(200), nullable=False),
        sa.Column("phone", sa.String(40), nullable=False),
        sa.Column("customer_telegram_id", sa.BigInteger, nullable=False, index=True),
        sa.Column("customer_username", sa.String(100)),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("event_name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("attendees", sa.Integer, nullable=False),
        sa.Column("coffee_break", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("coffee_headcount", sa.Integer),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", booking_status, nullable=False, server_default="new", index=True),
        sa.Column("is_urgent", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("reject_reason", sa.Text),
        sa.Column("reminder_day_sent", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("reminder_hour_sent", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_bookings_room_time", "bookings", ["room_id", "starts_at", "ends_at"])

    op.create_table(
        "status_history",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("booking_id", sa.Integer, sa.ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_status", booking_status),
        sa.Column("to_status", booking_status, nullable=False),
        sa.Column("actor_telegram_id", sa.BigInteger),
        sa.Column("note", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "login_codes",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("telegram_id", sa.BigInteger, nullable=False, index=True),
        sa.Column("code_hash", sa.String(120), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.UniqueConstraint("telegram_id", name="uq_login_code_tg"),
    )

    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("actor_telegram_id", sa.BigInteger, nullable=False, index=True),
        sa.Column("action", sa.String(80), nullable=False),
        sa.Column("target_type", sa.String(40)),
        sa.Column("target_id", sa.Integer),
        sa.Column("payload", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
    )


def downgrade() -> None:
    op.drop_table("audit_log")
    op.drop_table("login_codes")
    op.drop_table("status_history")
    op.drop_index("ix_bookings_room_time", table_name="bookings")
    op.drop_table("bookings")
    op.drop_table("rooms")
    op.execute("DROP TYPE IF EXISTS booking_status")
    op.execute("DROP TYPE IF EXISTS zone")
