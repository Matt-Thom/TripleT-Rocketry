"""Unit tests for reconciled Phase 1 ORM models.

See: wiki/concepts/phase1-implementation-plan.md
"""

from sqlalchemy import inspect

from app.models import (
    Certification,
    Flight,
    LaunchEvent,
    LaunchSite,
    Motor,
    MotorInventory,
    Rocket,
    RocketConfiguration,
    User,
)


def test_user_table_name() -> None:
    """User maps to the users table."""
    assert User.__tablename__ == "users"


def test_user_has_email_and_display_name() -> None:
    """User exposes identity columns used as the ownership root."""
    mapper = inspect(User)
    column_names = {column.key for column in mapper.columns}
    assert "email" in column_names
    assert "display_name" in column_names
    assert "password_hash" in column_names
    assert "is_active" in column_names


def test_nine_phase1_models_are_exported() -> None:
    """WP0 ORM surface is the reconciled nine-model Phase 1 set."""
    models = {
        User,
        Certification,
        LaunchSite,
        Motor,
        MotorInventory,
        Rocket,
        RocketConfiguration,
        LaunchEvent,
        Flight,
    }
    assert len(models) == 9


def test_motor_unique_constraint_on_manufacturer_model_delay() -> None:
    """Motor catalog rows are unique on manufacturer, model, and delay."""
    names = {constraint.name for constraint in Motor.__table__.constraints}
    assert "uq_motors_manufacturer_model_delay" in names


def test_rocket_configuration_unique_on_rocket_and_version() -> None:
    """Each rocket version number is unique per airframe."""
    table = RocketConfiguration.__table__
    names = {constraint.name for constraint in table.constraints}
    assert "uq_rocket_configurations_rocket_version" in names


def test_flight_inventory_and_event_fks_are_nullable() -> None:
    """MotorInventory and LaunchEvent stay in P1 with nullable Flight FKs."""
    table = Flight.__table__
    assert table.c.motor_inventory_id.nullable is True
    assert table.c.launch_event_id.nullable is True
    assert table.c.motor_id.nullable is True
    assert table.c.launch_site_id.nullable is True
    assert table.c.rocket_configuration_id.nullable is True


def test_motor_inventory_and_launch_event_table_names() -> None:
    """Inventory and events use dedicated tables in the P1 schema."""
    assert MotorInventory.__tablename__ == "motor_inventories"
    assert LaunchEvent.__tablename__ == "launch_events"


def test_models_instantiate_without_database() -> None:
    """ORM classes construct in memory without a live engine."""
    user = User(
        email="flyer@example.com",
        display_name="Flyer",
        password_hash="hashed",
    )
    site = LaunchSite(name="Local Field")
    motor = Motor(manufacturer="Estes", model="C6", delay_s=3.0)
    assert user.email == "flyer@example.com"
    assert site.name == "Local Field"
    assert motor.manufacturer == "Estes"
