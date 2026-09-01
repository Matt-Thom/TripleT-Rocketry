"""Core flight logbook entity.

See: wiki/entities/flight.md
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import AuditMixin
from app.models.enums import FlightOutcome


class Flight(AuditMixin, Base):
    """Logged flight. Inventory and event FKs are nullable in P1."""

    __tablename__ = "flights"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    flyer_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
    )
    rocket_configuration_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("rocket_configurations.id"),
        nullable=True,
    )
    motor_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("motors.id"),
        nullable=True,
    )
    motor_inventory_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("motor_inventories.id"),
        nullable=True,
    )
    launch_site_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("launch_sites.id"),
        nullable=True,
    )
    launch_event_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("launch_events.id"),
        nullable=True,
    )
    flight_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    flown_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    altitude_agl_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    altitude_msl_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_velocity_mps: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_accel_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_mps: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_dir_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    temperature_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    visibility_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    ceiling_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    outcome: Mapped[FlightOutcome | None] = mapped_column(nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    media_urls: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    soft_gate_warnings: Mapped[list | None] = mapped_column(
        JSONB,
        nullable=True,
    )
    proceeded_despite_warnings: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    flyer = relationship("User")
    rocket_configuration = relationship(
        "RocketConfiguration",
        back_populates="flights",
    )
    motor = relationship("Motor", back_populates="flights")
    motor_inventory = relationship("MotorInventory", back_populates="flights")
    launch_site = relationship("LaunchSite", back_populates="flights")
    launch_event = relationship("LaunchEvent", back_populates="flights")
