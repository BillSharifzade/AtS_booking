"""room capacity as free text

Changes rooms.capacity from an integer to a free-text label so admins can write
values like "До 10 человек" or "много". A best-effort number is parsed out of it in
the app for overbooking checks and room recommendation (services.bookings.capacity_number).

Existing integer values convert cleanly to their string form ("10").

Revision ID: 0014
Revises: 0013
Create Date: 2026-07-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "rooms",
        "capacity",
        existing_type=sa.Integer(),
        type_=sa.String(length=80),
        existing_nullable=False,
        postgresql_using="capacity::text",
    )


def downgrade() -> None:
    # Best-effort: strip non-digits back to an integer (rows with no digits become 0).
    op.alter_column(
        "rooms",
        "capacity",
        existing_type=sa.String(length=80),
        type_=sa.Integer(),
        existing_nullable=False,
        postgresql_using="COALESCE(NULLIF(regexp_replace(capacity, '\\D', '', 'g'), ''), '0')::integer",
    )
