"""companies, props, checklist, off-time, articles, room_struct, feedback sub-ratings

Adds the second feature wave:
  - companies (curated directory, inline logo) + bookings.company_id
  - props inventory (tech/office) + booking_props (requested amounts)
  - global checklist template + per-booking checklist items
  - room_offtimes (scheduled room unavailability)
  - articles (knowledge base)
  - rooms.meter_squared, bookings.room_struct
  - feedback room/service/props sub-ratings

Revision ID: 0011
Revises: 0010
Create Date: 2026-06-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- companies -------------------------------------------------------
    op.create_table(
        "companies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("website_url", sa.String(length=300), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("logo_content_type", sa.String(length=60), nullable=True),
        sa.Column("logo_data", sa.LargeBinary(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("name", name="uq_company_name"),
    )

    # --- props -----------------------------------------------------------
    op.create_table(
        "props",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False, server_default="tech"),
        sa.Column("unit", sa.String(length=40), nullable=True),
        sa.Column("amount", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # --- checklist template ---------------------------------------------
    op.create_table(
        "checklist_template_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("text", sa.String(length=300), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # --- articles --------------------------------------------------------
    op.create_table(
        "articles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("category", sa.String(length=60), nullable=False, server_default="general"),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_articles_category", "articles", ["category"])

    # --- new columns on existing tables ---------------------------------
    op.add_column("rooms", sa.Column("meter_squared", sa.Integer(), nullable=True))
    op.add_column("bookings", sa.Column("company_id", sa.Integer(), nullable=True))
    op.add_column("bookings", sa.Column("room_struct", sa.String(length=40), nullable=True))
    op.create_foreign_key(
        "fk_bookings_company_id", "bookings", "companies", ["company_id"], ["id"]
    )
    op.add_column("feedback", sa.Column("room_rating", sa.Integer(), nullable=True))
    op.add_column("feedback", sa.Column("service_rating", sa.Integer(), nullable=True))
    op.add_column("feedback", sa.Column("props_rating", sa.Integer(), nullable=True))

    # --- tables that reference bookings ---------------------------------
    op.create_table(
        "booking_props",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("booking_id", sa.Integer(), nullable=False),
        sa.Column("prop_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(["booking_id"], ["bookings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["prop_id"], ["props.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("booking_id", "prop_id", name="uq_booking_prop"),
    )
    op.create_index("ix_booking_props_booking_id", "booking_props", ["booking_id"])

    op.create_table(
        "booking_checklist_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("booking_id", sa.Integer(), nullable=False),
        sa.Column("text", sa.String(length=300), nullable=False),
        sa.Column("done", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["booking_id"], ["bookings.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_booking_checklist_items_booking_id", "booking_checklist_items", ["booking_id"]
    )

    op.create_table(
        "room_offtimes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("room_id", sa.Integer(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_room_offtimes_room_id", "room_offtimes", ["room_id"])
    op.create_index("ix_room_offtimes_starts_at", "room_offtimes", ["starts_at"])


def downgrade() -> None:
    op.drop_table("room_offtimes")
    op.drop_table("booking_checklist_items")
    op.drop_table("booking_props")
    op.drop_column("feedback", "props_rating")
    op.drop_column("feedback", "service_rating")
    op.drop_column("feedback", "room_rating")
    op.drop_constraint("fk_bookings_company_id", "bookings", type_="foreignkey")
    op.drop_column("bookings", "room_struct")
    op.drop_column("bookings", "company_id")
    op.drop_column("rooms", "meter_squared")
    op.drop_index("ix_articles_category", table_name="articles")
    op.drop_table("articles")
    op.drop_table("checklist_template_items")
    op.drop_table("props")
    op.drop_table("companies")
