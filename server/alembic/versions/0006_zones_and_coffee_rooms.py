"""zones as a table + coffee-break room flag

Replaces the fixed A/Б/В zone enum on rooms with an admin-managed ``zones`` table
(Module E). Adds ``rooms.zone_id`` FK and ``rooms.is_coffee_break``. Existing rooms
are migrated into seeded zones so no data is lost.

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "zones",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("name", name="uq_zones_name"),
    )
    # Seed zones matching the legacy fixed enum (Russian display names).
    op.execute("INSERT INTO zones (name) VALUES ('A'), ('Б'), ('В')")

    op.add_column("rooms", sa.Column("zone_id", sa.Integer(), nullable=True))
    op.add_column(
        "rooms",
        sa.Column("is_coffee_break", sa.Boolean(), server_default=sa.false(), nullable=False),
    )

    # Map the legacy enum value of each room to its seeded zone.
    op.execute("UPDATE rooms SET zone_id = z.id FROM zones z WHERE z.name = 'A' AND rooms.zone = 'A'")
    op.execute("UPDATE rooms SET zone_id = z.id FROM zones z WHERE z.name = 'Б' AND rooms.zone = 'B'")
    op.execute("UPDATE rooms SET zone_id = z.id FROM zones z WHERE z.name = 'В' AND rooms.zone = 'V'")
    # Safety net for any room left unmapped.
    op.execute("UPDATE rooms SET zone_id = (SELECT id FROM zones ORDER BY id LIMIT 1) WHERE zone_id IS NULL")

    op.alter_column("rooms", "zone_id", nullable=False)
    op.create_foreign_key("fk_rooms_zone_id", "rooms", "zones", ["zone_id"], ["id"])
    op.create_index("ix_rooms_zone_id", "rooms", ["zone_id"])
    # Drop the temporary server default; the model manages the default in Python.
    op.alter_column("rooms", "is_coffee_break", server_default=None)

    op.drop_column("rooms", "zone")
    op.execute("DROP TYPE IF EXISTS zone")


def downgrade() -> None:
    zone_enum = sa.Enum("A", "B", "V", name="zone")
    zone_enum.create(op.get_bind(), checkfirst=True)
    op.add_column("rooms", sa.Column("zone", zone_enum, nullable=True))
    op.execute("UPDATE rooms SET zone = 'A' FROM zones z WHERE rooms.zone_id = z.id AND z.name = 'A'")
    op.execute("UPDATE rooms SET zone = 'B' FROM zones z WHERE rooms.zone_id = z.id AND z.name = 'Б'")
    op.execute("UPDATE rooms SET zone = 'V' FROM zones z WHERE rooms.zone_id = z.id AND z.name = 'В'")
    op.execute("UPDATE rooms SET zone = 'A' WHERE zone IS NULL")
    op.alter_column("rooms", "zone", nullable=False)

    op.drop_index("ix_rooms_zone_id", table_name="rooms")
    op.drop_constraint("fk_rooms_zone_id", "rooms", type_="foreignkey")
    op.drop_column("rooms", "zone_id")
    op.drop_column("rooms", "is_coffee_break")
    op.drop_table("zones")
