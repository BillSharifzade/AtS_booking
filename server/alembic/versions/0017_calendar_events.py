"""calendar_events (public website events calendar)

Stores the public "Календарь мероприятий" shown on the browser landing page.
Populated by admins uploading the monthly calendar xlsx.

Revision ID: 0017
Revises: 0016
Create Date: 2026-07-15
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "calendar_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_date", sa.Date(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=True),
        sa.Column("end_time", sa.Time(), nullable=True),
        sa.Column("time_text", sa.String(length=60), nullable=True),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("room", sa.String(length=160), nullable=True),
        sa.Column("company", sa.String(length=200), nullable=True),
        sa.Column("trainer", sa.String(length=160), nullable=True),
        sa.Column("audience", sa.String(length=200), nullable=True),
        sa.Column("coffee", sa.String(length=120), nullable=True),
        sa.Column("participants", sa.Integer(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_calendar_events_event_date", "calendar_events", ["event_date"])


def downgrade() -> None:
    op.drop_index("ix_calendar_events_event_date", table_name="calendar_events")
    op.drop_table("calendar_events")
