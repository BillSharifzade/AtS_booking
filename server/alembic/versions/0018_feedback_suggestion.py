"""feedback.suggestion (second open field in the rating step)

Adds a separate free-text answer for «Предложения по улучшению», kept apart from the
existing `comment` so the two questions stay distinguishable in the panel.

Revision ID: 0018
Revises: 0017
Create Date: 2026-08-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("feedback", sa.Column("suggestion", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("feedback", "suggestion")
