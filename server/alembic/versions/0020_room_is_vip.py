"""rooms.is_vip — VIP rooms are the only ones offering a non-standard coffee break

Client rule: «выбор другого» on the coffee break is available only in the VIP rooms
(Vip-большой / Vip-малый), where it means a fixed set — «конфеты, сухофрукты, вода
0,5 л». Every other room can only get the standard coffee break.

Rather than hard-coding the two room names, the rule hangs off a per-room flag an
admin can toggle in the panel. Existing rooms whose name mentions "vip" are
backfilled to ``true`` so the two VIP auditoriums work without manual setup.

Revision ID: 0020
Revises: 0019
Create Date: 2026-08-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column("is_vip", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Backfill: "Vip-большой", "Vip-малый", "VIP малый" … all match.
    op.execute("UPDATE rooms SET is_vip = true WHERE name ILIKE '%vip%'")
    # Drop the default: the ORM supplies the value on insert.
    op.alter_column("rooms", "is_vip", server_default=None)
    # The bot no longer asks for a free-text coffee-break description, so drop any
    # admin override left behind for that prompt.
    op.execute("DELETE FROM bot_texts WHERE key = 'ENTER_COFFEE_OTHER'")


def downgrade() -> None:
    op.drop_column("rooms", "is_vip")
