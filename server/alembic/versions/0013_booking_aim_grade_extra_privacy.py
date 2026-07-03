"""booking aim, grade, extra services, privacy acknowledgement

Adds four booking fields shared across the bot, client mini app and website form:
  - bookings.aim — purpose of the booking ("Цель бронирования", free text)
  - bookings.grade — requester's grade ("Грейд", fixed dropdown, validated in app)
  - bookings.extra_services — extra on-site services needed (free text)
  - bookings.privacy_accepted — client acknowledged the participation rules

Revision ID: 0013
Revises: 0012
Create Date: 2026-07-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("bookings", sa.Column("aim", sa.String(length=300), nullable=True))
    op.add_column("bookings", sa.Column("grade", sa.String(length=60), nullable=True))
    op.add_column("bookings", sa.Column("extra_services", sa.Text(), nullable=True))
    op.add_column(
        "bookings",
        sa.Column("privacy_accepted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("bookings", "privacy_accepted")
    op.drop_column("bookings", "extra_services")
    op.drop_column("bookings", "grade")
    op.drop_column("bookings", "aim")
