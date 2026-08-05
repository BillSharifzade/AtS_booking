"""companies.requires_department + merged «Руководитель структурного подразделения» grade

Two client-requested changes:

1. Whether the booking form asks for a департамент/отдел is no longer inferred from the
   company *name* (the КОИНОТИ НАВ regex) but stored per company, so admins decide which
   companies see the field. Existing companies whose name matches the old rule are
   backfilled to ``true`` so behaviour is unchanged for them.
2. «Руководитель отдела» and «Руководитель департамента» are merged into a single
   «Руководитель структурного подразделения» grade; existing bookings are rewritten so
   old rows stay inside the (validated) dropdown.

Revision ID: 0019
Revises: 0018
Create Date: 2026-08-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0019"
down_revision: Union[str, None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_GRADE = "Руководитель структурного подразделения"
OLD_GRADES = ("Руководитель отдела", "Руководитель департамента")


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column("requires_department", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Keep today's behaviour for the companies the name rule already covered.
    op.execute(
        """
        UPDATE companies
           SET requires_department = true
         WHERE name ~* 'ко[ий]?ноти[[:space:]]*нав|koinoti[[:space:]]*nav'
        """
    )
    op.execute(
        sa.text("UPDATE bookings SET grade = :new WHERE grade IN :old").bindparams(
            sa.bindparam("new", NEW_GRADE), sa.bindparam("old", OLD_GRADES, expanding=True)
        )
    )


def downgrade() -> None:
    # The two merged grades can't be told apart anymore; map them back to the broader one.
    op.execute(
        sa.text("UPDATE bookings SET grade = :old WHERE grade = :new").bindparams(
            sa.bindparam("old", OLD_GRADES[1]), sa.bindparam("new", NEW_GRADE)
        )
    )
    op.drop_column("companies", "requires_department")
