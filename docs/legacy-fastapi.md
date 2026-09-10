# Legacy FastAPI service

The Python service under `app/`, `alembic/` and `tests/` was the WP0 scaffold
before the project moved to Cloudflare Workers. It is kept in the tree as the
reference implementation the Worker was ported from — so the port can be
audited endpoint-by-endpoint — and is scheduled for removal once the Worker has
reached parity in production.

It is **not deployed anywhere.**

## Running it

Requires Python 3.11+, [`uv`](https://docs.astral.sh/uv/) and PostgreSQL.

```bash
cp .env.example .env                # fill in TRIPLET_DATABASE_URL
uv sync --extra dev
uv run alembic upgrade head
uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
```

If you have Docker but no local PostgreSQL:

```bash
docker run -d --name triplet-pg \
  -e POSTGRES_USER=3t-rocketry -e POSTGRES_PASSWORD=<password from .env> \
  -e POSTGRES_DB=triplet -p 5432:5432 postgres:16-alpine
docker exec triplet-pg psql -U 3t-rocketry -d triplet -c 'CREATE DATABASE triplet_test;'
```

## Tests

The suite creates and **drops every table** in the target database, so it
requires a separate disposable database named through
`TRIPLET_TEST_DATABASE_URL`; it will not fall back to `TRIPLET_DATABASE_URL`,
and the database name must contain `test`.

```bash
export TRIPLET_TEST_DATABASE_URL='postgresql+asyncpg://USER:PASSWORD@localhost:5432/triplet_test'
uv run pytest
uv run ruff check .
```

Note: `tests/conftest.py` parses this URL with `urllib.parse.urlsplit`, so any
reserved character in the password (`#`, `@`, `/`, `?`) must be percent-encoded
or the database name will not be found. SQLAlchemy tolerates a raw `#` in
`TRIPLET_DATABASE_URL`; the test harness does not.
