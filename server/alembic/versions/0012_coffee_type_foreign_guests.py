"""coffee type/other, foreign guests

Reworks the coffee-break model:
  - bookings.coffee_type (standard | other) — what's served
  - bookings.coffee_other — free-text description when coffee_type == "other"
  - bookings.foreign_guests — when true, the coffee break is served in the event
    room itself (no separate coffee-break room needed)

Note: bookings.coffee_headcount now carries the NUMBER OF COFFEE BREAKS (not a
head count); this is a semantics change only, so no column rename is needed.

Revision ID: 0012
Revises: 0011
Create Date: 2026-07-01
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("bookings", sa.Column("coffee_type", sa.String(length=20), nullable=True))
    op.add_column("bookings", sa.Column("coffee_other", sa.Text(), nullable=True))
    op.add_column(
        "bookings",
        sa.Column("foreign_guests", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("bookings", "foreign_guests")
    op.drop_column("bookings", "coffee_other")
    op.drop_column("bookings", "coffee_type")
