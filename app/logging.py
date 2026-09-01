"""Structured logging with trace_id and project_id context.

See: wiki/concepts/phase1-implementation-plan.md
"""

from typing import Any

import structlog

from app.config import get_settings


def configure_logging() -> None:
    """Configure structlog processors and contextvars for request traces."""
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(0),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
    settings = get_settings()
    structlog.contextvars.bind_contextvars(project_id=settings.project_id)


def bind_trace_context(*, trace_id: str, project_id: str) -> None:
    """Bind trace_id and project_id onto the current structlog context."""
    structlog.contextvars.bind_contextvars(
        trace_id=trace_id,
        project_id=project_id,
    )


def get_logger(**initial_values: Any) -> Any:
    """Return a bound structlog logger with optional extra context."""
    return structlog.get_logger(**initial_values)
