"""Airframe vehicle and versioned configuration snapshots.

See: wiki/entities/rocket.md
"""

from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import AuditMixin
from app.models.enums import RecoveryType, RocketStatus


class Rocket(AuditMixin, Base):
    """User-owned airframe. Flights hang off RocketConfiguration, not this."""

    __tablename__ = "rockets"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    owner_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[RocketStatus] = mapped_column(
        default=RocketStatus.IN_BUILD,
        nullable=False,
    )

    owner = relationship("User", back_populates="rockets", foreign_keys=[owner_id])
    configurations = relationship(
        "RocketConfiguration",
        back_populates="rocket",
    )


class RocketConfiguration(AuditMixin, Base):
    """Immutable-ish snapshot of mass, CG/CP, recovery, and motor mount."""

    __tablename__ = "rocket_configurations"
    __table_args__ = (
        UniqueConstraint(
            "rocket_id",
            "version",
            name="uq_rocket_configurations_rocket_version",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    rocket_id: Mapped[UUID] = mapped_column(
        ForeignKey("rockets.id"),
        nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    airframe_material: Mapped[str | None] = mapped_column(
        String(80),
        nullable=True,
    )
    fin_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dry_mass_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    loaded_mass_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    ballast_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    cg_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    cp_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    stability_calibers: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )
    recovery_type: Mapped[RecoveryType | None] = mapped_column(nullable=True)
    parachute_size_mm: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )
    motor_mount_diameter_mm: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )
    is_current: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    rocket = relationship("Rocket", back_populates="configurations")
    flights = relationship("Flight", back_populates="rocket_configuration")
