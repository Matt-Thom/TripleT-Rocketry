"""Integration tests for async Postgres connectivity.

See: wiki/concepts/phase1-implementation-plan.md
"""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User


@pytest.mark.asyncio
async def test_select_one(db_session: AsyncSession) -> None:
    """Rollback session executes SELECT 1 against real Postgres."""
    result = await db_session.execute(text("SELECT 1"))
    assert result.scalar_one() == 1


@pytest.mark.asyncio
async def test_user_round_trip_rolls_back(db_session: AsyncSession) -> None:
    """Inserted rows are visible in-session and rolled back after the test."""
    user = User(
        email="wp0@example.com",
        display_name="WP0 Flyer",
        password_hash="hashed",
    )
    db_session.add(user)
    await db_session.flush()
    loaded = await db_session.get(User, user.id)
    assert loaded is not None
    assert loaded.email == "wp0@example.com"
