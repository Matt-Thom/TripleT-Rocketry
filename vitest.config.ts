import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'

/**
 * Tests run inside workerd, against the real bindings declared in
 * wrangler.jsonc — a local (in-memory) D1, not a mock.
 *
 * The migrations are read here on the Node side and handed to the isolate as a
 * binding, because `setupFiles` run inside the Worker and have no filesystem.
 */
const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'))

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        compatibilityFlags: ['nodejs_compat'],
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
  },
})
