"""Pytest fixtures for WP0. Never mocks the database.

See: wiki/concepts/phase1-implementation-plan.md
"""

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.db import Base, get_db
from app.main import create_app
from app.models import (  # noqa: F401 — register mappers on Base.metadata
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


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    """Force the asyncio backend for pytest-asyncio / anyio."""
    return "asyncio"


@pytest.fixture(scope="session")
async def engine() -> AsyncIterator[AsyncEngine]:
    """Session-scoped async engine bound to real Postgres."""
    settings = get_settings()
    engine = create_async_engine(
        settings.database_url,
        poolclass=NullPool,
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield engine
    finally:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
        await engine.dispose()


@pytest.fixture
async def db_session(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    """Per-test AsyncSession bound to a transaction that rolls back."""
    connection = await engine.connect()
    transaction = await connection.begin()
    factory = async_sessionmaker(
        bind=connection,
        expire_on_commit=False,
        class_=AsyncSession,
    )
    session = factory()
    try:
        yield session
    finally:
        await session.close()
        await transaction.rollback()
        await connection.close()


@pytest.fixture
async def client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    """HTTPX async client wired to the FastAPI factory and test session."""
    app = create_app()

    async def _override_get_db() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        yield http
    app.dependency_overrides.clear()


@pytest.fixture
async def ping_db(db_session: AsyncSession) -> None:
    """Sanity-check that the rollback session can talk to Postgres."""
    result = await db_session.execute(text("SELECT 1"))
    assert result.scalar_one() == 1
