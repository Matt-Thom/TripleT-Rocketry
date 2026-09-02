"""Initial Phase 1 schema: 7 base tables plus audit columns.

Revision ID: p1_001
Revises:
Create Date: 2026-09-01

See: wiki/concepts/phase1-implementation-plan.md
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "p1_001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create users, certifications, sites, motors, rockets, configs, flights."""
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_table(
        "certifications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("certifying_body", sa.String(length=16), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("cert_number", sa.String(length=64), nullable=True),
        sa.Column("expires_on", sa.Date(), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("override_reason", sa.Text(), nullable=True),
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
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "launch_sites",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("max_altitude_agl_m", sa.Float(), nullable=True),
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
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "motors",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("manufacturer", sa.String(length=120), nullable=False),
        sa.Column("model", sa.String(length=120), nullable=False),
        sa.Column("impulse_class", sa.String(length=8), nullable=True),
        sa.Column("total_impulse_ns", sa.Float(), nullable=True),
        sa.Column("average_thrust_n", sa.Float(), nullable=True),
        sa.Column("max_thrust_n", sa.Float(), nullable=True),
        sa.Column("burn_time_s", sa.Float(), nullable=True),
        sa.Column("delay_s", sa.Float(), nullable=True),
        sa.Column("propellant_type", sa.String(length=32), nullable=True),
        sa.Column("diameter_mm", sa.Float(), nullable=True),
        sa.Column("length_mm", sa.Float(), nullable=True),
        sa.Column("casing_reusable", sa.Boolean(), nullable=False),
        sa.Column("cert_number", sa.String(length=64), nullable=True),
        sa.Column("certifying_org", sa.String(length=16), nullable=True),
        sa.Column("weight_g", sa.Float(), nullable=True),
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
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "manufacturer",
            "model",
            "delay_s",
            name="uq_motors_manufacturer_model_delay",
        ),
    )
    op.create_table(
        "rockets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
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
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "rocket_configurations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("rocket_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("airframe_material", sa.String(length=80), nullable=True),
        sa.Column("fin_count", sa.Integer(), nullable=True),
        sa.Column("dry_mass_g", sa.Float(), nullable=True),
        sa.Column("loaded_mass_g", sa.Float(), nullable=True),
        sa.Column("ballast_g", sa.Float(), nullable=True),
        sa.Column("cg_mm", sa.Float(), nullable=True),
        sa.Column("cp_mm", sa.Float(), nullable=True),
        sa.Column("stability_calibers", sa.Float(), nullable=True),
        sa.Column("recovery_type", sa.String(length=32), nullable=True),
        sa.Column("parachute_size_mm", sa.Float(), nullable=True),
        sa.Column("motor_mount_diameter_mm", sa.Float(), nullable=True),
        sa.Column("is_current", sa.Boolean(), nullable=False),
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
        sa.ForeignKeyConstraint(["rocket_id"], ["rockets.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "rocket_id",
            "version",
            name="uq_rocket_configurations_rocket_version",
        ),
    )
    jsonb = postgresql.JSONB(astext_type=sa.Text())
    op.create_table(
        "flights",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("flyer_id", sa.Uuid(), nullable=False),
        sa.Column("rocket_configuration_id", sa.Uuid(), nullable=True),
        sa.Column("motor_id", sa.Uuid(), nullable=True),
        sa.Column("launch_site_id", sa.Uuid(), nullable=True),
        sa.Column("flight_number", sa.Integer(), nullable=True),
        sa.Column("flown_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("altitude_agl_m", sa.Float(), nullable=True),
        sa.Column("altitude_msl_m", sa.Float(), nullable=True),
        sa.Column("max_velocity_mps", sa.Float(), nullable=True),
        sa.Column("max_accel_g", sa.Float(), nullable=True),
        sa.Column("wind_mps", sa.Float(), nullable=True),
        sa.Column("wind_dir_deg", sa.Float(), nullable=True),
        sa.Column("temperature_c", sa.Float(), nullable=True),
        sa.Column("visibility_m", sa.Float(), nullable=True),
        sa.Column("ceiling_m", sa.Float(), nullable=True),
        sa.Column("outcome", sa.String(length=32), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("media_urls", jsonb, nullable=True),
        sa.Column("soft_gate_warnings", jsonb, nullable=True),
        sa.Column("proceeded_despite_warnings", sa.Boolean(), nullable=False),
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
        sa.ForeignKeyConstraint(["flyer_id"], ["users.id"]),
        sa.ForeignKeyConstraint(
            ["rocket_configuration_id"],
            ["rocket_configurations.id"],
        ),
        sa.ForeignKeyConstraint(["motor_id"], ["motors.id"]),
        sa.ForeignKeyConstraint(["launch_site_id"], ["launch_sites.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    """Drop the seven base tables in reverse dependency order."""
    op.drop_table("flights")
    op.drop_table("rocket_configurations")
    op.drop_table("rockets")
    op.drop_table("motors")
    op.drop_table("launch_sites")
    op.drop_table("certifications")
    op.drop_table("users")
