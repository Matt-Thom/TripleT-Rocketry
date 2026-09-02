"""Unit tests for the destructive-test database guard.

The engine fixture in tests/conftest.py issues drop_all against the configured
database. These tests pin the guard that decides which database that may be.

See: tests/conftest.py
"""

import pytest

from tests.conftest import TEST_DATABASE_URL_ENV, _require_test_database_url


def test_missing_env_var_aborts(monkeypatch: pytest.MonkeyPatch) -> None:
    """An unset TRIPLET_TEST_DATABASE_URL aborts the run rather than defaulting."""
    monkeypatch.delenv(TEST_DATABASE_URL_ENV, raising=False)
    with pytest.raises(pytest.UsageError, match="is not set"):
        _require_test_database_url()


def test_blank_env_var_aborts(monkeypatch: pytest.MonkeyPatch) -> None:
    """A whitespace-only value is treated as unset."""
    monkeypatch.setenv(TEST_DATABASE_URL_ENV, "   ")
    with pytest.raises(pytest.UsageError, match="is not set"):
        _require_test_database_url()


def test_database_without_test_in_name_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    """A production-looking database name is refused before any DDL runs."""
    monkeypatch.setenv(
        TEST_DATABASE_URL_ENV,
        "postgresql+asyncpg://postgres:postgres@localhost:5432/triplet",
    )
    with pytest.raises(pytest.UsageError, match="does not contain 'test'"):
        _require_test_database_url()


def test_url_without_database_name_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    """A URL with no database component is refused."""
    monkeypatch.setenv(
        TEST_DATABASE_URL_ENV,
        "postgresql+asyncpg://postgres:postgres@localhost:5432",
    )
    with pytest.raises(pytest.UsageError, match="no database name"):
        _require_test_database_url()


@pytest.mark.parametrize(
    "database",
    ["triplet_test", "test_triplet", "TripletTest", "test"],
)
def test_test_database_names_are_accepted(
    monkeypatch: pytest.MonkeyPatch,
    database: str,
) -> None:
    """Any database whose name marks it as a test database is accepted."""
    url = f"postgresql+asyncpg://postgres:postgres@localhost:5432/{database}"
    monkeypatch.setenv(TEST_DATABASE_URL_ENV, url)
    assert _require_test_database_url() == url
