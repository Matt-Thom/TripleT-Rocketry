"""Integration tests for liveness and readiness probes.

See: wiki/concepts/phase1-implementation-plan.md
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_returns_ok(client: AsyncClient) -> None:
    """GET /health reports liveness without touching the database."""
    response = await client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["project_id"] == "PROJ-075AA139"
    assert "environment" in payload


@pytest.mark.asyncio
async def test_health_sets_trace_id_header(client: AsyncClient) -> None:
    """Liveness responses echo an X-Trace-Id header."""
    response = await client.get("/health")
    assert "x-trace-id" in response.headers
    assert response.headers["x-trace-id"]


@pytest.mark.asyncio
async def test_ready_pings_database(client: AsyncClient) -> None:
    """GET /ready returns ready after a SELECT 1 against Postgres."""
    response = await client.get("/ready")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["database"] == "ok"
