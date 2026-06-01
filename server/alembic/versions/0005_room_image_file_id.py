"""cache telegram file_id for room images

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("room_images", sa.Column("tg_file_id", sa.String(200)))


def downgrade() -> None:
    op.drop_column("room_images", "tg_file_id")
