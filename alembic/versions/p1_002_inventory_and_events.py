"""Add motor inventories, launch events, and nullable Flight FKs.

Revision ID: p1_002
Revises: p1_001
Create Date: 2026-09-01

See: wiki/concepts/phase1-implementation-plan.md
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "p1_002"
down_revision: str | None = "p1_001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create inventory and event tables; wire nullable FKs onto flights."""
    op.create_table(
        "motor_inventories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("motor_id", sa.Uuid(), nullable=False),
        sa.Column("quantity_on_hand", sa.Integer(), nullable=False),
        sa.Column("expended_count", sa.Integer(), nullable=False),
        sa.Column("acquired_on", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["motor_id"], ["motors.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "launch_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("launch_site_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=True),
        sa.Column("ends_on", sa.Date(), nullable=True),
        sa.Column("rso_user_id", sa.Uuid(), nullable=True),
        sa.Column("lco_user_id", sa.Uuid(), nullable=True),
        sa.Column("weather_notes", sa.Text(), nullable=True),
        sa.Column("pad_count", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["launch_site_id"], ["launch_sites.id"]),
        sa.ForeignKeyConstraint(["rso_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["lco_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.add_column(
        "flights",
        sa.Column("motor_inventory_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "flights",
        sa.Column("launch_event_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_flights_motor_inventory_id",
        "flights",
        "motor_inventories",
        ["motor_inventory_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_flights_launch_event_id",
        "flights",
        "launch_events",
        ["launch_event_id"],
        ["id"],
    )


def downgrade() -> None:
    """Remove inventory/event tables and the Flight FK columns."""
    op.drop_constraint(
        "fk_flights_launch_event_id",
        "flights",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_flights_motor_inventory_id",
        "flights",
        type_="foreignkey",
    )
    op.drop_column("flights", "launch_event_id")
    op.drop_column("flights", "motor_inventory_id")
    op.drop_table("launch_events")
    op.drop_table("motor_inventories")
