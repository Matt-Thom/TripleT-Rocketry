"""Integration tests for async Postgres connectivity.

See: wiki/concepts/phase1-implementation-plan.md
"""

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

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
from app.models.enums import (
    CertifyingBody,
    CertLevel,
    FlightOutcome,
    ImpulseClass,
    PropellantType,
    RecoveryType,
    RocketStatus,
)


@pytest.mark.asyncio
async def test_select_one(db_session: AsyncSession) -> None:
    """Rollback session executes SELECT 1 against real Postgres."""
    result = await db_session.execute(text("SELECT 1"))
    assert result.scalar_one() == 1


@pytest.mark.asyncio
async def test_user_round_trip_rolls_back(db_session: AsyncSession) -> None:
    """Inserted rows are visible in-session and rolled back after the test."""
    user = User(
        email="wp0@example.com",
        display_name="WP0 Flyer",
        password_hash="hashed",
    )
    db_session.add(user)
    await db_session.flush()
    loaded = await db_session.get(User, user.id)
    assert loaded is not None
    assert loaded.email == "wp0@example.com"


@pytest.mark.asyncio
async def test_all_nine_models_relationship_graph_rolls_back(
    db_session: AsyncSession,
) -> None:
    """Verify end-to-end ORM graph with all 9 models and explicit FK relationships."""
    user = User(
        email="builder@example.com",
        display_name="Master Builder",
        password_hash="hashed",
    )
    db_session.add(user)
    await db_session.flush()

    cert = Certification(
        user_id=user.id,
        certifying_body=CertifyingBody.NAR,
        level=CertLevel.LEVEL_2,
        cert_number="NAR-99999",
        created_by=user.id,
    )
    db_session.add(cert)

    site = LaunchSite(
        name="Black Rock Desert",
        latitude=40.8,
        longitude=-119.0,
        max_altitude_agl_m=15000.0,
        created_by=user.id,
    )
    db_session.add(site)

    motor = Motor(
        manufacturer="Aerotech",
        model="J350W",
        delay_s=14.0,
        impulse_class=ImpulseClass.J,
        propellant_type=PropellantType.APCP,
        created_by=user.id,
    )
    db_session.add(motor)
    await db_session.flush()

    inventory = MotorInventory(
        user_id=user.id,
        motor_id=motor.id,
        quantity_on_hand=3,
        expended_count=0,
        created_by=user.id,
    )
    db_session.add(inventory)

    rocket = Rocket(
        owner_id=user.id,
        name="Hyperion",
        status=RocketStatus.FLIGHT_READY,
        created_by=user.id,
    )
    db_session.add(rocket)
    await db_session.flush()

    config = RocketConfiguration(
        rocket_id=rocket.id,
        version=1,
        dry_mass_g=1200.0,
        recovery_type=RecoveryType.DUAL_DEPLOY,
        created_by=user.id,
    )
    db_session.add(config)

    event = LaunchEvent(
        launch_site_id=site.id,
        name="BALLS 2026",
        rso_user_id=user.id,
        lco_user_id=user.id,
        created_by=user.id,
    )
    db_session.add(event)
    await db_session.flush()

    flight = Flight(
        flyer_id=user.id,
        rocket_configuration_id=config.id,
        motor_id=motor.id,
        motor_inventory_id=inventory.id,
        launch_site_id=site.id,
        launch_event_id=event.id,
        flight_number=1,
        altitude_agl_m=4200.0,
        outcome=FlightOutcome.SUCCESSFUL,
        created_by=user.id,
    )
    db_session.add(flight)
    await db_session.flush()

    # Query User with back-populated relationships
    stmt_user = (
        select(User)
        .where(User.id == user.id)
        .options(
            selectinload(User.certifications),
            selectinload(User.rockets),
            selectinload(User.motor_inventories),
        )
    )
    loaded_user = (await db_session.execute(stmt_user)).scalar_one()
    assert len(loaded_user.certifications) == 1
    assert loaded_user.certifications[0].cert_number == "NAR-99999"
    assert loaded_user.certifications[0].user.id == user.id
    assert len(loaded_user.rockets) == 1
    assert loaded_user.rockets[0].name == "Hyperion"
    assert len(loaded_user.motor_inventories) == 1
    assert loaded_user.motor_inventories[0].quantity_on_hand == 3

    # Query Flight with all populated FK targets
    stmt_flight = (
        select(Flight)
        .where(Flight.id == flight.id)
        .options(
            selectinload(Flight.flyer),
            selectinload(Flight.rocket_configuration),
            selectinload(Flight.motor),
            selectinload(Flight.motor_inventory),
            selectinload(Flight.launch_site),
            selectinload(Flight.launch_event),
        )
    )
    loaded_flight = (await db_session.execute(stmt_flight)).scalar_one()
    assert loaded_flight.flyer.id == user.id
    assert loaded_flight.rocket_configuration.version == 1
    assert loaded_flight.motor.model == "J350W"
    assert loaded_flight.motor_inventory.quantity_on_hand == 3
    assert loaded_flight.launch_site.name == "Black Rock Desert"
    assert loaded_flight.launch_event.name == "BALLS 2026"

    # Query LaunchSite with back-populated events and flights
    stmt_site = (
        select(LaunchSite)
        .where(LaunchSite.id == site.id)
        .options(
            selectinload(LaunchSite.events),
            selectinload(LaunchSite.flights),
        )
    )
    loaded_site = (await db_session.execute(stmt_site)).scalar_one()
    assert len(loaded_site.events) == 1
    assert loaded_site.events[0].name == "BALLS 2026"
    assert len(loaded_site.flights) == 1

    # Query LaunchEvent with site, rso, lco, and flights
    stmt_event = (
        select(LaunchEvent)
        .where(LaunchEvent.id == event.id)
        .options(
            selectinload(LaunchEvent.site),
            selectinload(LaunchEvent.rso),
            selectinload(LaunchEvent.lco),
            selectinload(LaunchEvent.flights),
        )
    )
    loaded_event = (await db_session.execute(stmt_event)).scalar_one()
    assert loaded_event.site.name == "Black Rock Desert"
    assert loaded_event.rso.id == user.id
    assert loaded_event.lco.id == user.id
    assert len(loaded_event.flights) == 1

    # Query Motor with inventories and flights
    stmt_motor = (
        select(Motor)
        .where(Motor.id == motor.id)
        .options(
            selectinload(Motor.inventories),
            selectinload(Motor.flights),
        )
    )
    loaded_motor = (await db_session.execute(stmt_motor)).scalar_one()
    assert len(loaded_motor.inventories) == 1
    assert len(loaded_motor.flights) == 1

    # Query Rocket with configurations and flights
    stmt_rocket = (
        select(Rocket)
        .where(Rocket.id == rocket.id)
        .options(
            selectinload(Rocket.owner),
            selectinload(Rocket.configurations).selectinload(RocketConfiguration.flights),
        )
    )
    loaded_rocket = (await db_session.execute(stmt_rocket)).scalar_one()
    assert loaded_rocket.owner.id == user.id
    assert len(loaded_rocket.configurations) == 1
    assert len(loaded_rocket.configurations[0].flights) == 1
