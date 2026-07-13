"""booking applicant position, trainer, department, target employees

Adds four booking fields shared across the bot, client mini app and website form:
  - bookings.position — applicant's job title ("Должность заявителя", free text)
  - bookings.trainer — event trainer ("Тренер мероприятия", for the AtS group template)
  - bookings.department — department, required only for КОИНОТИ НАВ events (free text)
  - bookings.target_employees — who the training is intended for
    ("Для каких сотрудников предназначен тренинг", free text)

Revision ID: 0015
Revises: 0014
Create Date: 2026-07-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("bookings", sa.Column("position", sa.String(length=200), nullable=True))
    op.add_column("bookings", sa.Column("trainer", sa.String(length=200), nullable=True))
    op.add_column("bookings", sa.Column("department", sa.String(length=200), nullable=True))
    op.add_column("bookings", sa.Column("target_employees", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("bookings", "target_employees")
    op.drop_column("bookings", "department")
    op.drop_column("bookings", "trainer")
    op.drop_column("bookings", "position")
