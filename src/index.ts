/**
 * TripleT-Rocketry Worker — Main router and application entry.
 *
 * Secures the application with authenticated access and multi-user support,
 * mounts the web UI dashboard and domain sub-routers (auth, flights, rockets, motors,
 * inventory, sites, events), preserves health and readiness probes, and
 * provides responsive HTML error handling alongside JSON API fallback.
 */

import { Hono } from 'hono'
import { html } from 'hono/html'
import { log, type TraceContext } from './logging'
import type { ActiveFlyer } from './db/context'
import { authMiddleware } from './middleware/auth'
import { authRouter } from './routes/auth'
import { dashboardRouter } from './routes/dashboard'
import { rocketsRouter } from './routes/rockets'
import { motorsRouter } from './routes/motors'
import { inventoryRouter } from './routes/inventory'
import { sitesRouter } from './routes/sites'
import { eventsRouter } from './routes/events'
import { flightsRouter } from './routes/flights'
import { pageLayout } from './views/layout'

type Bindings = {
  DB: D1Database
  ENVIRONMENT: string
  PROJECT_ID: string
  AUTH_SECRET?: string
}

type Variables = {
  trace: TraceContext
  user?: ActiveFlyer
  activeFlyer?: ActiveFlyer
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

/**
 * Bind X-Trace-Id and project_id for every request.
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
 * Authentication & multi-user session middleware across the application.
 */
app.use('*', authMiddleware)

/**
 * Mount auth routes (login, register, logout, pilot switcher)
 */
app.route('/', authRouter)

/**
 * Mount all domain sub-routers
 */
app.route('/', dashboardRouter)
app.route('/rockets', rocketsRouter)
app.route('/motors', motorsRouter)
app.route('/inventory', inventoryRouter)
app.route('/sites', sitesRouter)
app.route('/events', eventsRouter)
app.route('/flights', flightsRouter)

/**
 * Liveness probe. Does not touch the database.
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

/**
 * Content-negotiating 404 handler
 */
app.notFound((c) => {
  const acceptsHtml = c.req.header('accept')?.includes('text/html')
  if (acceptsHtml) {
    const errorView = html`
      <div class="py-16 text-center">
        <span class="text-6xl mb-4 block">🛸</span>
        <h1 class="text-3xl font-extrabold text-white">404 — Page Not Found</h1>
        <p class="mt-2 text-slate-400 max-w-md mx-auto">
          The trajectory you requested is outside range airspace.
        </p>
        <div class="mt-6">
          <a href="/" class="inline-flex items-center px-4 py-2 text-sm font-semibold rounded-lg bg-brand-500 hover:bg-brand-400 text-slate-950 transition-colors">
            Return to Dashboard
          </a>
        </div>
      </div>
    `
    const notFoundPage = pageLayout({
      title: 'Page Not Found',
      activeTab: 'dashboard',
      content: errorView,
      user: c.get('user') || null,
    })
    return c.html(notFoundPage, 404)
  }
  return c.json({ detail: 'Not Found' }, 404)
})

/**
 * Content-negotiating 500 handler
 */
app.onError((err, c) => {
  log('error', 'unhandled_exception', c.get('trace'), { error: String(err) })
  const acceptsHtml = c.req.header('accept')?.includes('text/html')
  if (acceptsHtml) {
    const errorView = html`
      <div class="py-16 text-center">
        <span class="text-6xl mb-4 block">⚠️</span>
        <h1 class="text-3xl font-extrabold text-white">500 — System Anomaly</h1>
        <p class="mt-2 text-slate-400 max-w-md mx-auto">
          An unexpected anomaly occurred on the launch range.
        </p>
        <div class="mt-6">
          <a href="/" class="inline-flex items-center px-4 py-2 text-sm font-semibold rounded-lg bg-brand-500 hover:bg-brand-400 text-slate-950 transition-colors">
            Return to Dashboard
          </a>
        </div>
      </div>
    `
    const errorPage = pageLayout({
      title: 'Internal Server Error',
      activeTab: 'dashboard',
      content: errorView,
      user: c.get('user') || null,
    })
    return c.html(errorPage, 500)
  }
  return c.json({ detail: 'Internal Server Error' }, 500)
})

export default app
