/**
 * TripleT-Rocketry Worker — WP0 surface: /health and /ready.
 *
 * Port of the FastAPI application factory (previously app/main.py) onto
 * Cloudflare Workers + D1. Behaviour is intended to be observationally
 * identical: same routes, same bodies, same status codes, same X-Trace-Id
 * propagation.
 *
 * See: wiki/concepts/phase1-implementation-plan.md
 */

import { Hono } from 'hono'
import { log, type TraceContext } from './logging'

type Bindings = {
  DB: D1Database
  ENVIRONMENT: string
  PROJECT_ID: string
}

type Variables = {
  trace: TraceContext
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

/**
 * Bind X-Trace-Id and project_id for every request.
 *
 * An inbound X-Trace-Id is honoured so a trace survives across services; the
 * header lookup is case-insensitive because the Headers API normalises names.
 */
app.use('*', async (c, next) => {
  const trace: TraceContext = {
    traceId: c.req.header('x-trace-id') || crypto.randomUUID(),
    projectId: c.env.PROJECT_ID,
  }
  c.set('trace', trace)
  await next()
  c.header('X-Trace-Id', trace.traceId)
})

/**
 * Liveness probe. Does not touch the database.
 *
 * Deliberately returns no configuration detail: this endpoint is
 * unauthenticated, and project_id / environment are already carried on every
 * log line via the trace context.
 */
app.get('/health', (c) => c.json({ status: 'ok' }))

/** Readiness probe. Pings D1 with SELECT 1. */
app.get('/ready', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first()
    return c.json({ status: 'ready', database: 'ok' })
  } catch (err) {
    log('warning', 'readiness_probe_failed', c.get('trace'), {
      error: err instanceof Error ? err.message : String(err),
    })
    return c.json({ status: 'unavailable', database: 'error' }, 503)
  }
})

app.notFound((c) => c.json({ detail: 'Not Found' }, 404))

app.onError((err, c) => {
  log('error', 'unhandled_exception', c.get('trace'), { error: String(err) })
  return c.json({ detail: 'Internal Server Error' }, 500)
})

export default app
