import { defineConfig } from 'drizzle-kit'

/**
 * Generates D1 migrations from src/db/schema.ts into ./migrations, the same
 * directory `wrangler d1 migrations apply` reads. drizzle-kit's meta/ sidecar
 * lives alongside; wrangler only picks up the .sql files.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
})
