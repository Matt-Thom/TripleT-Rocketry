/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { D1Migration } from '@cloudflare/vitest-pool-workers'
import { applyD1Migrations, env } from 'cloudflare:test'

// `TEST_MIGRATIONS` is injected by vitest.config.ts, not by wrangler.jsonc, so
// it is deliberately absent from the generated `Env` type. Narrow it here
// rather than widening the production Env with a test-only binding.
const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] }

// Bring the local D1 up to head once per test worker, before any suite runs.
await applyD1Migrations(env.DB, TEST_MIGRATIONS)
