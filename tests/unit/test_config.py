"""Unit tests for runtime settings.

See: wiki/concepts/phase1-implementation-plan.md
"""

import pytest

from app.config import Settings


def test_default_project_id() -> None:
    """Default project_id is the Forge project identifier."""
    settings = Settings()
    assert settings.project_id == "PROJ-075AA139"


def test_default_environment_is_development() -> None:
    """Default environment is development when unset."""
    settings = Settings()
    assert settings.environment == "development"


def test_database_url_can_be_overridden(monkeypatch: pytest.MonkeyPatch) -> None:
    """TRIPLET_DATABASE_URL overrides the default database URL."""
    monkeypatch.setenv(
        "TRIPLET_DATABASE_URL",
        "postgresql+asyncpg://user:pass@db:5432/rocket",
    )
    settings = Settings()
    assert settings.database_url.endswith("/rocket")


def test_environment_can_be_overridden(monkeypatch: pytest.MonkeyPatch) -> None:
    """TRIPLET_ENVIRONMENT overrides the default environment."""
    monkeypatch.setenv(
        "TRIPLET_ENVIRONMENT",
        "production",
    )
    settings = Settings()
    assert settings.environment == "production"


def test_project_id_can_be_overridden(monkeypatch: pytest.MonkeyPatch) -> None:
    """TRIPLET_PROJECT_ID overrides the default project identifier."""
    monkeypatch.setenv(
        "TRIPLET_PROJECT_ID",
        "PROJ-CUSTOM-999",
    )
    settings = Settings()
    assert settings.project_id == "PROJ-CUSTOM-999"


def test_get_settings_caching_and_cache_clear(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_settings() returns a cached singleton and can be cleared."""
    from app.config import get_settings

    get_settings.cache_clear()
    s1 = get_settings()
    s2 = get_settings()
    assert s1 is s2

    monkeypatch.setenv("TRIPLET_PROJECT_ID", "PROJ-CACHE-TEST")
    # Cached instance still has old project_id
    assert get_settings().project_id == s1.project_id

    # After clearing cache, new instance is constructed with updated env
    get_settings.cache_clear()
    s3 = get_settings()
    assert s3.project_id == "PROJ-CACHE-TEST"
    get_settings.cache_clear()


def test_extra_environment_variables_are_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    """Unrecognized TRIPLET_* env vars do not fail settings instantiation."""
    monkeypatch.setenv("TRIPLET_UNKNOWN_PROPERTY_NAME", "ignored_val")
    monkeypatch.setenv("TRIPLET_ANOTHER_EXTRA_KEY", "12345")
    settings = Settings()
    assert settings.project_id == "PROJ-075AA139"


def test_multiple_settings_overrides_simultaneously(monkeypatch: pytest.MonkeyPatch) -> None:
    """All settings can be overridden concurrently via environment variables."""
    monkeypatch.setenv(
        "TRIPLET_DATABASE_URL",
        "postgresql+asyncpg://admin:secret@db:5433/rocketry_prod?ssl=disable",
    )
    monkeypatch.setenv("TRIPLET_PROJECT_ID", "PROJ-STRESS-TEST")
    monkeypatch.setenv("TRIPLET_ENVIRONMENT", "staging")
    settings = Settings()
    assert (
        settings.database_url
        == "postgresql+asyncpg://admin:secret@db:5433/rocketry_prod?ssl=disable"
    )
    assert settings.project_id == "PROJ-STRESS-TEST"
    assert settings.environment == "staging"
