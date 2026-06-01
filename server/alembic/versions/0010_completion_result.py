"""completion result capture (Module F)

Adds ``bookings.result_outcome`` (held/partial/cancelled) and ``bookings.result_note``,
captured when an admin completes an event.

Revision ID: 0010
Revises: 0009
Create Date: 2026-06-01
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("bookings", sa.Column("result_outcome", sa.String(length=20), nullable=True))
    op.add_column("bookings", sa.Column("result_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("bookings", "result_note")
    op.drop_column("bookings", "result_outcome")
