"""User-owned motor stock and expenditure.

See: wiki/entities/inventory.md
"""

from datetime import date
from uuid import UUID, uuid4

from sqlalchemy import Date, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import AuditMixin


class MotorInventory(AuditMixin, Base):
    """Per-user motor stock. Stays in P1 with nullable Flight FKs."""

    __tablename__ = "motor_inventories"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
    )
    motor_id: Mapped[UUID] = mapped_column(
        ForeignKey("motors.id"),
        nullable=False,
    )
    quantity_on_hand: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )
    expended_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )
    acquired_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    user = relationship("User", back_populates="motor_inventories")
    motor = relationship("Motor", back_populates="inventories")
    flights = relationship("Flight", back_populates="motor_inventory")
