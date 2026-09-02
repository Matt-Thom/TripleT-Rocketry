"""Launch range / field specifications.

See: wiki/entities/launch-site.md
"""

from uuid import UUID, uuid4

from sqlalchemy import Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import AuditMixin


class LaunchSite(AuditMixin, Base):
    """Named launch field with optional waiver ceiling (AGL metres)."""

    __tablename__ = "launch_sites"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_altitude_agl_m: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    events = relationship("LaunchEvent", back_populates="site")
    flights = relationship("Flight", back_populates="launch_site")
