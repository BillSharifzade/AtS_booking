"""post-event feedback (Module F)

Adds a ``feedback`` table: one rating (1..5) + optional comment per booking.

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-01
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "feedback",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("booking_id", sa.Integer(), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["booking_id"], ["bookings.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("booking_id", name="uq_feedback_booking"),
    )
    op.create_index("ix_feedback_booking_id", "feedback", ["booking_id"])


def downgrade() -> None:
    op.drop_index("ix_feedback_booking_id", table_name="feedback")
    op.drop_table("feedback")
