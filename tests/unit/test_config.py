"""Unit tests for runtime settings.

See: wiki/concepts/phase1-implementation-plan.md
"""

from app.config import Settings


def test_default_project_id() -> None:
    """Default project_id is the Forge project identifier."""
    settings = Settings()
    assert settings.project_id == "PROJ-075AA139"


def test_default_environment_is_development() -> None:
    """Default environment is development when unset."""
    settings = Settings()
    assert settings.environment == "development"


def test_database_url_can_be_overridden(monkeypatch: object) -> None:
    """TRIPLET_DATABASE_URL overrides the default database URL."""
    monkeypatch.setenv(  # type: ignore[attr-defined]
        "TRIPLET_DATABASE_URL",
        "postgresql+asyncpg://user:pass@db:5432/rocket",
    )
    settings = Settings()
    assert settings.database_url.endswith("/rocket")
