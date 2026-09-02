"""Unit tests for structured logging.

See: wiki/concepts/phase1-implementation-plan.md
"""

import structlog

from app.logging import bind_trace_context, configure_logging, get_logger


def test_configure_logging_binds_project_id() -> None:
    """configure_logging initializes structlog and binds default project context."""
    configure_logging()
    ctx = structlog.contextvars.get_contextvars()
    assert ctx.get("project_id") == "PROJ-075AA139"


def test_bind_trace_context() -> None:
    """bind_trace_context sets trace_id and project_id in contextvars."""
    bind_trace_context(trace_id="unit-trace-12345", project_id="PROJ-CUSTOM-77")
    ctx = structlog.contextvars.get_contextvars()
    assert ctx.get("trace_id") == "unit-trace-12345"
    assert ctx.get("project_id") == "PROJ-CUSTOM-77"


def test_get_logger_returns_bound_logger() -> None:
    """get_logger returns a structlog logger with any passed initial values."""
    logger = get_logger(module="test_module")
    assert logger is not None
