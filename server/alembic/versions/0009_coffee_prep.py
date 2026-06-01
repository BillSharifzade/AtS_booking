"""coffee-break preparation workflow (Module E)

Adds ``bookings.coffee_status`` (pending/ready/served/not_required) and
``bookings.coffee_room_id`` (which coffee-break room serves the event).

Revision ID: 0009
Revises: 0008
Create Date: 2026-06-01
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bookings",
        sa.Column("coffee_status", sa.String(length=20), server_default="pending", nullable=False),
    )
    op.add_column("bookings", sa.Column("coffee_room_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_bookings_coffee_room_id", "bookings", "rooms", ["coffee_room_id"], ["id"]
    )
    # Default was only needed to backfill existing rows; model manages it in Python.
    op.alter_column("bookings", "coffee_status", server_default=None)


def downgrade() -> None:
    op.drop_constraint("fk_bookings_coffee_room_id", "bookings", type_="foreignkey")
    op.drop_column("bookings", "coffee_room_id")
    op.drop_column("bookings", "coffee_status")
