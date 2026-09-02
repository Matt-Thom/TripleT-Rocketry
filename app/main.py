"""FastAPI application factory with /health and /ready probes.

See: wiki/concepts/phase1-implementation-plan.md
"""

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request, Response
from sqlalchemy import text

from app.config import get_settings
from app.db import get_session_factory
from app.logging import bind_trace_context, configure_logging, get_logger

logger = get_logger()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Configure structured logging for the process lifetime."""
    configure_logging()
    logger.info("app_startup")
    yield
    logger.info("app_shutdown")


def create_app() -> FastAPI:
    """Build the WP0 FastAPI application (no domain CRUD)."""
    settings = get_settings()
    app = FastAPI(
        title="TripleT-Rocketry",
        version="0.1.0",
        lifespan=lifespan,
    )

    @app.middleware("http")
    async def trace_middleware(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """Bind X-Trace-Id and project_id for every request."""
        trace_id = request.headers.get("x-trace-id") or str(uuid4())
        bind_trace_context(trace_id=trace_id, project_id=settings.project_id)
        response = await call_next(request)
        response.headers["X-Trace-Id"] = trace_id
        return response

    @app.get("/health")
    async def health() -> dict[str, str]:
        """Liveness probe. Does not touch the database.

        Deliberately returns no configuration detail: this endpoint is
        unauthenticated, and project_id / environment are already carried on
        every log line via the structlog trace context.
        """
        return {"status": "ok"}

    @app.get("/ready")
    async def ready(response: Response) -> dict[str, str]:
        """Readiness probe. Pings Postgres with SELECT 1."""
        try:
            factory = get_session_factory()
            async with factory() as session:
                await session.execute(text("SELECT 1"))
            return {"status": "ready", "database": "ok"}
        except Exception as exc:
            logger.warning("readiness_probe_failed", error=str(exc))
            response.status_code = 503
            return {"status": "unavailable", "database": "error"}

    return app
