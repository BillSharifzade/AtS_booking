"""telegram user cache + bot text overrides

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tg_users",
        sa.Column("telegram_id", sa.BigInteger, primary_key=True, autoincrement=False),
        sa.Column("first_name", sa.String(200)),
        sa.Column("last_name", sa.String(200)),
        sa.Column("username", sa.String(100)),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "bot_texts",
        sa.Column("key", sa.String(80), primary_key=True),
        sa.Column("value", sa.Text, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("bot_texts")
    op.drop_table("tg_users")
