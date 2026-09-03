# TripleT-Rocketry

Flight Logbook + Range Companion for model and high-power rocketry.

This project is managed by Forge. See [`AI.md`](AI.md) for AI collaboration
guidance and `wiki/index.md` for architecture.

The service is a **Cloudflare Worker** (TypeScript + Hono) backed by
**D1**. See [`wiki/concepts/cloudflare-deployment.md`](wiki/concepts/cloudflare-deployment.md)
for the deployment topology and why the original FastAPI/PostgreSQL stack could
not be lifted onto Workers unchanged.

## Requirements

- Node.js 24+
- A Cloudflare account (only for deploying; local development needs no login)

## Running locally

```bash
npm install
cp .dev.vars.example .dev.vars      # keeps Wrangler away from the Python .env
npm run db:migrate:local            # apply migrations to the local D1
npm run dev                         # http://127.0.0.1:8787
```

Probes: `GET /health` (liveness, no database) and `GET /ready` (readiness,
queries D1). Both echo an `X-Trace-Id` header, honouring an inbound one.

## Tests

The suite runs inside `workerd` via `@cloudflare/vitest-pool-workers`, against
a real local D1 — never a mock. Migrations are applied to the test database
automatically, so there is nothing to set up:

```bash
npm test
npm run typecheck
```

## Database changes

`src/db/schema.ts` is the source of truth. After editing it:

```bash
npm run db:generate                 # writes a new file into migrations/
```

Commit the generated migration alongside the schema change — CI fails if the
two have drifted.

## Deploying

| Branch | Target | Hostname | Worker | D1 database |
|---|---|---|---|---|
| `develop` | staging | `rocketry-dev.thom.au` | `triplet-rocketry-staging` | `triplet-rocketry-staging` |
| `main` | production | `rocketry.thom.au` | `triplet-rocketry` | `triplet-rocketry` |

Pushes deploy automatically via `.github/workflows/deploy.yml`. Nothing else
deploys; pull requests run CI only.

First-time setup is documented in
[`wiki/concepts/cloudflare-deployment.md`](wiki/concepts/cloudflare-deployment.md)
— create the two D1 databases, paste their ids into `wrangler.jsonc`, and set
the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repository secrets. Both
hostnames are declared as `custom_domain` routes, so Wrangler provisions their
DNS records and certificates on the first deploy.

## Legacy FastAPI service

The original Python service still lives in `app/`, `alembic/` and `tests/`. It
is retained only as the reference the Worker was ported from and is **not
deployed**. See [`docs/legacy-fastapi.md`](docs/legacy-fastapi.md) for how to
run it, and `wiki/concepts/cloudflare-deployment.md` for the removal plan.
