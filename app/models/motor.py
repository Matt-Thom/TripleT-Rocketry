"""Certified motor catalog (design, not stock).

See: wiki/entities/motor.md
"""

from uuid import UUID, uuid4

from sqlalchemy import Boolean, Float, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import AuditMixin
from app.models.enums import CertifyingOrg, ImpulseClass, PropellantType


class Motor(AuditMixin, Base):
    """Catalog motor performance row. Inventory is a separate entity."""

    __tablename__ = "motors"
    __table_args__ = (
        UniqueConstraint(
            "manufacturer",
            "model",
            "delay_s",
            name="uq_motors_manufacturer_model_delay",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    manufacturer: Mapped[str] = mapped_column(String(120), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    impulse_class: Mapped[ImpulseClass | None] = mapped_column(nullable=True)
    total_impulse_ns: Mapped[float | None] = mapped_column(Float, nullable=True)
    average_thrust_n: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_thrust_n: Mapped[float | None] = mapped_column(Float, nullable=True)
    burn_time_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    delay_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    propellant_type: Mapped[PropellantType | None] = mapped_column(
        nullable=True,
    )
    diameter_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    length_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    casing_reusable: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )
    cert_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    certifying_org: Mapped[CertifyingOrg | None] = mapped_column(nullable=True)
    weight_g: Mapped[float | None] = mapped_column(Float, nullable=True)

    inventories = relationship("MotorInventory", back_populates="motor")
    flights = relationship("Flight", back_populates="motor")
