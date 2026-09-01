"""Self-reported NAR/TRA certification records.

See: wiki/entities/certification.md
"""

from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import AuditMixin
from app.models.enums import CertifyingBody


class Certification(AuditMixin, Base):
    """Flyer certification. Soft-gate input only — never a government store."""

    __tablename__ = "certifications"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
    )
    certifying_body: Mapped[CertifyingBody] = mapped_column(nullable=False)
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    cert_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expires_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    user = relationship("User", back_populates="certifications")
