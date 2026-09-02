"""Runtime settings for the Flight Logbook scaffold.

See: wiki/concepts/phase1-implementation-plan.md
"""

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Pydantic settings loaded from TRIPLET_* environment variables."""

    model_config = SettingsConfigDict(
        env_prefix="TRIPLET_",
        env_file=".env",
        extra="ignore",
    )

    # Required, deliberately without a default. A fallback default here would
    # let the app (and the test suite, which issues DDL) silently connect to
    # whatever happens to be listening on localhost when the operator forgot
    # to configure TRIPLET_DATABASE_URL. Fail closed instead.
    database_url: str
    project_id: str = "PROJ-075AA139"
    environment: str = "development"

    @field_validator("database_url")
    @classmethod
    def _reject_blank_database_url(cls, value: str) -> str:
        """Reject an empty or whitespace-only TRIPLET_DATABASE_URL."""
        if not value.strip():
            raise ValueError("TRIPLET_DATABASE_URL must not be empty")
        return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide cached settings instance."""
    return Settings()
