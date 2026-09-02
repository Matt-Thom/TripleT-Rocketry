---
id: qry-phase1-step-implemented
type: query
title: Phase 1 Step Implemented
source: forge
project_id: PROJ-075AA139
---

# Phase 1 Step Implemented

**Work package:** WP0 Scaffold only (next incomplete WP from [[queries/phase1-build-status]]).
**Scope:** packaging, FastAPI factory + `/health` `/ready`, structlog (`trace_id` / `project_id`), async SQLAlchemy, reconciled 9-model ORM, Alembic `p1_001` then `p1_002`, TDD tests. No domain CRUD. MotorInventory and LaunchEvent remain in the P1 schema with nullable Flight FKs.

## Files changed

### Packaging / config

- `pyproject.toml`
- `pytest.ini`
- `alembic.ini`

### Application

- `app/__init__.py`
- `app/config.py`
- `app/logging.py`
- `app/db.py`
- `app/main.py`
- `app/models/__init__.py`
- `app/models/base.py`
- `app/models/enums.py`
- `app/models/user.py`
- `app/models/certification.py`
- `app/models/launch_site.py`
- `app/models/motor.py`
- `app/models/motor_inventory.py`
- `app/models/rocket.py`
- `app/models/launch_event.py`
- `app/models/flight.py`

### Alembic

- `alembic/env.py`
- `alembic/script.py.mako`
- `alembic/versions/p1_001_initial_schema.py`
- `alembic/versions/p1_002_inventory_and_events.py`

### Tests (written TDD-first, before production code)

- `tests/__init__.py`
- `tests/conftest.py`
- `tests/unit/__init__.py`
- `tests/unit/test_enums.py`
- `tests/unit/test_config.py`
- `tests/unit/test_models.py`
- `tests/integration/__init__.py`
- `tests/integration/test_health.py`
- `tests/integration/test_db.py`

### Wiki

- `wiki/queries/phase1-step-implemented.md` (this page)
- `wiki/log.md` (one chronological WP0 line appended)

## Tests added

- `tests/unit/test_enums.py` — impulse A–O, cert levels, flight outcomes
- `tests/unit/test_config.py` — settings defaults / env override
- `tests/unit/test_models.py` — 9 models, table names, unique constraints, nullable Flight FKs
- `tests/integration/test_health.py` — `GET /health`, `GET /ready`, `X-Trace-Id`
- `tests/integration/test_db.py` — async `SELECT 1` and User round-trip on real Postgres (rollback session; never mocked)

## Pytest command

```
uv run pytest
```

If Anvil/Docker is unavailable, the full suite remains on disk and pytest is **not** claimed to have passed.
