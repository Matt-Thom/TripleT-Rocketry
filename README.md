# TripleT-Rocketry

Flight Logbook + Range Companion for model and high-power rocketry.

This project is managed by Forge. See [`AI.md`](AI.md) for AI collaboration
guidance and `wiki/index.md` for architecture.

## Requirements

- Python 3.11+
- PostgreSQL
- [`uv`](https://docs.astral.sh/uv/)

## Configuration

All settings come from `TRIPLET_*` environment variables (or a local `.env`).
Copy the template and fill it in:

```bash
cp .env.example .env
```

`TRIPLET_DATABASE_URL` is **required** and has no default — the app fails to
start without it rather than falling back to a localhost guess.

## Running

```bash
uv sync --extra dev
uv run alembic upgrade head
uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
```

Probes: `GET /health` (liveness, no database) and `GET /ready` (readiness,
pings Postgres). Both echo an `X-Trace-Id` header.

## Tests

The suite runs against real Postgres and **creates and drops every table** in
the target database. It therefore requires a separate, disposable database
nominated through `TRIPLET_TEST_DATABASE_URL`; it will not fall back to
`TRIPLET_DATABASE_URL`. The database name must contain `test`.

```bash
createdb triplet_test
export TRIPLET_TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/triplet_test
uv run pytest
```

Lint:

```bash
uv run ruff check .
```
