"""Pytest fixtures for WP0. Never mocks the database.

The engine fixture issues ``create_all`` / ``drop_all`` DDL, so the suite
refuses to run unless the operator has explicitly nominated a throwaway
database via ``TRIPLET_TEST_DATABASE_URL``. See ``_require_test_database_url``.

See: wiki/concepts/phase1-implementation-plan.md
"""

import os
from collections.abc import AsyncIterator
from urllib.parse import urlsplit

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

TEST_DATABASE_URL_ENV = "TRIPLET_TEST_DATABASE_URL"

_MISSING_TEST_DB_MESSAGE = f"""
{TEST_DATABASE_URL_ENV} is not set.

This suite creates and DROPS every table in the target database, so it will
not fall back to TRIPLET_DATABASE_URL or to any built-in default. Point it at
a disposable database whose name contains "test", for example:

    createdb triplet_test
    export {TEST_DATABASE_URL_ENV}=postgresql+asyncpg://postgres:postgres@localhost:5432/triplet_test
"""


def _require_test_database_url() -> str:
    """Return the nominated test database URL, or abort the run.

    Guards the ``drop_all`` in the ``engine`` fixture: without this, an unset
    environment silently resolved to the developer's default local database.
    """
    url = os.environ.get(TEST_DATABASE_URL_ENV, "").strip()
    if not url:
        raise pytest.UsageError(_MISSING_TEST_DB_MESSAGE)

    database = urlsplit(url).path.lstrip("/")
    if not database:
        raise pytest.UsageError(
            f"{TEST_DATABASE_URL_ENV} has no database name in its path: {url!r}"
        )
    if "test" not in database.lower():
        raise pytest.UsageError(
            f"Refusing to run: {TEST_DATABASE_URL_ENV} points at database "
            f"{database!r}, whose name does not contain 'test'. This suite drops "
            f"every table it finds. Rename the database or pick another one."
        )
    return url


def pytest_configure(config: pytest.Config) -> None:
    """Pin the application settings to the nominated test database."""
    url = _require_test_database_url()
    # The app under test must talk to the same throwaway database the fixtures
    # manage, so override rather than inherit any ambient TRIPLET_DATABASE_URL.
    os.environ["TRIPLET_DATABASE_URL"] = url
    get_settings.cache_clear()


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
            await connection.execute(text("DROP TABLE IF EXISTS alembic_version CASCADE"))
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
