"""Async SQLAlchemy engine, session factory, and request dependency.

See: wiki/concepts/phase1-implementation-plan.md
"""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings
from app.logging import get_logger

logger = get_logger()


class Base(DeclarativeBase):
    """Declarative base for all Phase 1 ORM models."""


def create_engine_from_url(url: str) -> AsyncEngine:
    """Create an async engine for the given PostgreSQL URL."""
    return create_async_engine(url, pool_pre_ping=True)


def get_engine() -> AsyncEngine:
    """Return an async engine using process settings."""
    return create_engine_from_url(get_settings().database_url)


def get_session_factory(
    engine: AsyncEngine | None = None,
) -> async_sessionmaker[AsyncSession]:
    """Return an async sessionmaker with expire_on_commit=False."""
    bind = engine if engine is not None else get_engine()
    return async_sessionmaker(
        bind=bind,
        expire_on_commit=False,
        class_=AsyncSession,
    )


async def get_db() -> AsyncIterator[AsyncSession]:
    """Yield a per-request AsyncSession and roll back on error."""
    factory = get_session_factory()
    session = factory()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        logger.exception("database_session_failed")
        raise
    finally:
        await session.close()
