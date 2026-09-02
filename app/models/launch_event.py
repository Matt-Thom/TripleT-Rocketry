"""Club meet / launch-day metadata with optional RSO/LCO.

See: wiki/entities/launch-event.md
"""

from datetime import date
from uuid import UUID, uuid4

from sqlalchemy import Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import AuditMixin


class LaunchEvent(AuditMixin, Base):
    """Named launch day. Stays in P1 with nullable Flight FKs."""

    __tablename__ = "launch_events"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    launch_site_id: Mapped[UUID] = mapped_column(
        ForeignKey("launch_sites.id"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    starts_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    ends_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    rso_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id"),
        nullable=True,
    )
    lco_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id"),
        nullable=True,
    )
    weather_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    pad_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    site = relationship("LaunchSite", back_populates="events")
    rso = relationship("User", foreign_keys=[rso_user_id])
    lco = relationship("User", foreign_keys=[lco_user_id])
    flights = relationship("Flight", back_populates="launch_event")
