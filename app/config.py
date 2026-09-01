"""Runtime settings for the Flight Logbook scaffold.

See: wiki/concepts/phase1-implementation-plan.md
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Pydantic settings loaded from TRIPLET_* environment variables."""

    model_config = SettingsConfigDict(
        env_prefix="TRIPLET_",
        env_file=".env",
        extra="ignore",
    )

    database_url: str = (
        "postgresql+asyncpg://postgres:postgres@localhost:5432/triplet"
    )
    project_id: str = "PROJ-075AA139"
    environment: str = "development"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide cached settings instance."""
    return Settings()
