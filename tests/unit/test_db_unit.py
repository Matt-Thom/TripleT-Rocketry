"""Unit tests for database engine and session factory helpers.

See: wiki/concepts/phase1-implementation-plan.md
"""

from unittest.mock import MagicMock

from app.db import create_engine_from_url, get_session_factory


def test_create_engine_from_url_caching() -> None:
    """create_engine_from_url caches AsyncEngine instances per URL."""
    url1 = "postgresql+asyncpg://postgres:postgres@localhost:5432/triplet"
    url2 = "postgresql+asyncpg://postgres:postgres@localhost:5432/other"

    engine1a = create_engine_from_url(url1)
    engine1b = create_engine_from_url(url1)
    engine2 = create_engine_from_url(url2)

    assert engine1a is engine1b
    assert engine1a is not engine2


def test_get_session_factory_uses_passed_engine() -> None:
    """get_session_factory binds to the provided engine when specified."""
    mock_engine = MagicMock()
    factory = get_session_factory(engine=mock_engine)
    assert factory.kw.get("bind") is mock_engine
