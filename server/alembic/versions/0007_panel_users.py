"""panel users (read-only viewers / department leads)

Adds a ``panel_users`` table for panel-managed accounts beyond the env superadmins
(Module §2.3). Only read-only ``viewer`` accounts live here; ``ADMIN_TELEGRAM_IDS``
stay permanent admins and are not stored.

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-01
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "panel_users",
        sa.Column("telegram_id", sa.BigInteger(), primary_key=True, autoincrement=False),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="viewer"),
        sa.Column("name", sa.String(length=200), nullable=True),
        sa.Column("added_by", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    # Default was only needed for existing-row backfill (none here); model sets it in Python.
    op.alter_column("panel_users", "role", server_default=None)


def downgrade() -> None:
    op.drop_table("panel_users")
