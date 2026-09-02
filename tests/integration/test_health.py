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
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_health_does_not_disclose_configuration(client: AsyncClient) -> None:
    """The unauthenticated liveness probe leaks no configuration detail."""
    payload = (await client.get("/health")).json()
    assert set(payload) == {"status"}
    assert "project_id" not in payload
    assert "environment" not in payload


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


@pytest.mark.asyncio
async def test_ready_returns_503_when_database_fails(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """GET /ready returns HTTP 503 when the database ping throws an exception."""
    from unittest.mock import MagicMock

    def failing_session_factory() -> MagicMock:
        mock_ctx = MagicMock()
        mock_ctx.__aenter__.side_effect = ConnectionRefusedError("Database unreachable")
        mock_factory = MagicMock(return_value=mock_ctx)
        return mock_factory

    monkeypatch.setattr("app.main.get_session_factory", failing_session_factory)
    response = await client.get("/ready")
    assert response.status_code == 503
    payload = response.json()
    assert payload["status"] == "unavailable"
    assert payload["database"] == "error"
    assert "x-trace-id" in response.headers


@pytest.mark.asyncio
async def test_ready_preserves_custom_trace_id_on_failure(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """GET /ready preserves incoming X-Trace-Id even during 503 database failures."""
    from unittest.mock import MagicMock

    def failing_session_factory() -> MagicMock:
        mock_ctx = MagicMock()
        mock_ctx.__aenter__.side_effect = RuntimeError("DB pool exhausted")
        return MagicMock(return_value=mock_ctx)

    monkeypatch.setattr("app.main.get_session_factory", failing_session_factory)
    headers = {"X-Trace-Id": "test-trace-fail-9999"}
    response = await client.get("/ready", headers=headers)
    assert response.status_code == 503
    assert response.headers["x-trace-id"] == "test-trace-fail-9999"


@pytest.mark.asyncio
async def test_health_liveness_succeeds_even_when_database_down(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """GET /health (liveness) succeeds (HTTP 200) regardless of database state."""
    from unittest.mock import MagicMock

    def failing_session_factory() -> MagicMock:
        raise ConnectionRefusedError("DB is down")

    monkeypatch.setattr("app.main.get_session_factory", failing_session_factory)
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_ready_returns_503_when_factory_creation_fails(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """GET /ready returns HTTP 503 when get_session_factory itself fails."""

    def failing_get_factory() -> None:
        raise ValueError("Invalid database connection parameters")

    monkeypatch.setattr("app.main.get_session_factory", failing_get_factory)
    response = await client.get("/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "database": "error"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "header_name,header_value",
    [
        ("X-TRACE-ID", "custom-upper-1111"),
        ("x-trace-id", "custom-lower-2222"),
        ("X-Trace-Id", "custom-title-3333"),
        ("x-TrAcE-iD", "custom-mixed-4444"),
    ],
)
async def test_trace_id_case_insensitive_header_propagation(
    client: AsyncClient,
    header_name: str,
    header_value: str,
) -> None:
    """Incoming trace ID header is recognized case-insensitively and returned in response."""
    response = await client.get("/health", headers={header_name: header_value})
    assert response.status_code == 200
    assert response.headers["x-trace-id"] == header_value


@pytest.mark.asyncio
async def test_health_auto_generates_valid_uuid_when_no_trace_id(client: AsyncClient) -> None:
    """When no X-Trace-Id header is supplied, a valid UUID4 is generated."""
    from uuid import UUID

    response = await client.get("/health")
    assert response.status_code == 200
    trace_id = response.headers.get("x-trace-id")
    assert trace_id is not None
    # Must parse as valid UUID
    parsed = UUID(trace_id, version=4)
    assert str(parsed) == trace_id
