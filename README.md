# TripleT-Rocketry

## Project Overview

TripleT-Rocketry is a personal-to-club-scale web application for model and
high-power rocketry. The product is a **Flight Logbook + Range Companion**:
flyers record user-owned rockets and versioned configurations (CG/CP, mass,
recovery), a motor catalog plus personal inventory, flights (weather, altitude,
outcomes), launch sites and events (RSO/LCO), and self-reported NAR/TRA
certifications. Safety is warnings-only — soft cert/impulse checks, not a
regulatory filing engine.

This tree is the WP0 scaffold plus the Phase 1 ORM. On disk today:

- FastAPI factory (`app/main.py`) with `GET /health` (liveness) and
  `GET /ready` (Postgres `SELECT 1`)
- Pydantic settings (`TRIPLET_*`) and structlog with `trace_id` / `project_id`
- Async SQLAlchemy session factory
- Nine reconciled models: `User`, `Certification`, `LaunchSite`, `Motor`,
  `MotorInventory`, `Rocket` / `RocketConfiguration`, `LaunchEvent`, `Flight`
- Alembic revisions `p1_001` then `p1_002`
- TDD tests under `tests/unit/` and `tests/integration/`

There is no domain CRUD, authentication UI, or HTMX surface yet. Later phases
(not implemented here) add components/builds and general inventory (Phase 2),
clubs/waivers/incidents (Phase 3), then contests and simulations (Phase 4).

## Initial Setup

### Prerequisites

- Python 3.11 or newer (`requires-python = ">=3.11"` in `pyproject.toml`)
- [uv](https://docs.astral.sh/uv/) for lockfile installs (`uv.lock` is present)

### Work root

Work from the project root: the directory that contains `pyproject.toml`,
`pytest.ini`, `alembic.ini`, `app/`, and `tests/`. Use whatever local clone or
worktree you already have. This README does not name a GitHub remote.

### Dependencies

Install runtime dependencies plus the `dev` extra (pytest, pytest-asyncio,
ruff) from the lockfile:

```bash
uv sync --extra dev
```

### Environment and config

Settings load from `TRIPLET_*` environment variables and an optional `.env`
file (`app/config.py`). `.env` is gitignored. A template is `.env.example`:

```text
TRIPLET_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/triplet
TRIPLET_PROJECT_ID=PROJ-075AA139
TRIPLET_ENVIRONMENT=development
```

Those strings are the in-repo local defaults (also in `alembic.ini`). Copy
`.env.example` to `.env` only if you need a local override. Do not commit
secrets. This repository does not document cloud URLs or production
credentials.

### Database and Alembic

`/ready` and `tests/integration/` use a real PostgreSQL database. Create a
local database named `triplet` that the configured role can reach. Override
the DSN with `TRIPLET_DATABASE_URL` if your instance differs.

Alembic is configured in `alembic.ini` (`script_location = alembic`).
Revisions on disk:

1. `alembic/versions/p1_001_initial_schema.py` — users, certifications,
   launch_sites, motors, rockets, rocket_configurations, flights
2. `alembic/versions/p1_002_inventory_and_events.py` — motor_inventories,
   launch_events, and nullable Flight FKs

Apply them with:

```bash
uv run alembic upgrade head
```

Integration fixtures create and drop tables with SQLAlchemy
`metadata.create_all` / `drop_all` against the same DSN; they do not run
Alembic. Postgres must still be running for the full suite.

## Setup and Test

1. Confirm Python 3.11+ and `uv` are on `PATH`.
2. Change to the project root (the directory that contains `pyproject.toml`).
3. Install dependencies from the lockfile:

   ```bash
   uv sync --extra dev
   ```

4. Start local PostgreSQL and ensure a `triplet` database exists at the DSN
   in `.env.example` (or set `TRIPLET_DATABASE_URL`).
5. Run the suite. `pytest.ini` and `[tool.pytest.ini_options]` in
   `pyproject.toml` both set `testpaths = tests` and `asyncio_mode = auto`:

   ```bash
   uv run pytest
   ```

   Unit tests only (no Postgres required):

   ```bash
   uv run pytest tests/unit
   ```

6. Success: pytest exits with code 0 and reports all collected tests passed.
   Failures in `tests/integration/` usually mean Postgres is unreachable at
   `TRIPLET_DATABASE_URL`. Unit tests cover enums, settings, ORM metadata,
   logging, and the session factory; integration tests cover `/health`,
   `/ready`, and a real-Postgres rollback session.
