"""room demonstration images

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "room_images",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "room_id",
            sa.Integer,
            sa.ForeignKey("rooms.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("content_type", sa.String(60), nullable=False),
        sa.Column("data", sa.LargeBinary, nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("room_images")
