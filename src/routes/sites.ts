/**
 * Routes for Launch Sites CRUD operations.
 *
 * GET  /sites       - Lists all launch sites from D1.
 * GET  /sites/new   - Renders new site form.
 * POST /sites       - Inserts new launch_sites row in D1, redirects to /sites/:id.
 * GET  /sites/:id   - Retrieves site and hosted launch events, renders detail view.
 */

import { Hono } from 'hono'
import { html } from 'hono/html'
import { eq, desc, asc } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { pageLayout } from '../views/layout'
import { sitesListView, siteDetailView, newSiteFormView } from '../views/sites'

type Bindings = {
  DB: D1Database
  ENVIRONMENT?: string
  PROJECT_ID?: string
}

const sites = new Hono<{ Bindings: Bindings }>()

/**
 * Helper to parse and normalize site form or JSON payload.
 */
async function parseSiteInput(c: any) {
  const contentType = c.req.header('content-type') || ''
  let name = ''
  let latitude: number | null = null
  let longitude: number | null = null
  let maxAltitudeAglM: number | null = null
  let notes: string | null = null

  if (contentType.includes('application/json')) {
    const json = await c.req.json().catch(() => ({}))
    name = typeof json.name === 'string' ? json.name.trim() : ''
    latitude =
      json.latitude != null && json.latitude !== '' && !isNaN(Number(json.latitude))
        ? Number(json.latitude)
        : null
    longitude =
      json.longitude != null && json.longitude !== '' && !isNaN(Number(json.longitude))
        ? Number(json.longitude)
        : null
    const rawCeiling = json.max_altitude_agl_m ?? json.maxAltitudeAglM
    maxAltitudeAglM =
      rawCeiling != null && rawCeiling !== '' && !isNaN(Number(rawCeiling))
        ? Number(rawCeiling)
        : null
    notes = typeof json.notes === 'string' && json.notes.trim() ? json.notes.trim() : null
  } else {
    const body = await c.req.parseBody()
    name = typeof body.name === 'string' ? body.name.trim() : ''
    latitude =
      body.latitude != null && body.latitude !== '' && !isNaN(Number(body.latitude))
        ? Number(body.latitude)
        : null
    longitude =
      body.longitude != null && body.longitude !== '' && !isNaN(Number(body.longitude))
        ? Number(body.longitude)
        : null
    const rawCeiling = body.max_altitude_agl_m ?? body.maxAltitudeAglM
    maxAltitudeAglM =
      rawCeiling != null && rawCeiling !== '' && !isNaN(Number(rawCeiling))
        ? Number(rawCeiling)
        : null
    notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null
  }

  return { name, latitude, longitude, maxAltitudeAglM, notes, isJson: contentType.includes('application/json') }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleListSites(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const allSites = await db
    .select()
    .from(schema.launchSites)
    .orderBy(asc(schema.launchSites.name))

  if (c.req.header('accept') === 'application/json') {
    return c.json(allSites)
  }

  return c.html(sitesListView(allSites))
}

function handleNewSiteForm(c: any) {
  return c.html(newSiteFormView())
}

async function handleCreateSite(c: any) {
  const input = await parseSiteInput(c)

  if (!input.name) {
    if (input.isJson) {
      return c.json({ error: 'Site name is required' }, 400)
    }
    return c.html(
      pageLayout({
        title: 'Validation Error',
        activeTab: 'sites',
        content: html`
          <div class="max-w-md mx-auto bg-slate-850 border border-rose-800/80 rounded-xl p-6 text-center">
            <h2 class="text-xl font-bold text-rose-400">Missing Required Field</h2>
            <p class="text-sm text-slate-300 mt-2">Launch site name is required.</p>
            <a href="/sites/new" class="mt-4 inline-block px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm">&larr; Back to Form</a>
          </div>
        `,
      }),
      400
    )
  }

  const db = drizzle(c.env.DB, { schema })
  const [newSite] = await db
    .insert(schema.launchSites)
    .values({
      name: input.name,
      latitude: input.latitude,
      longitude: input.longitude,
      maxAltitudeAglM: input.maxAltitudeAglM,
      notes: input.notes,
    })
    .returning()

  if (input.isJson) {
    return c.json(newSite, 201)
  }

  return c.redirect(`/sites/${newSite.id}`, 303)
}

async function handleSiteDetail(c: any) {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB, { schema })

  const [site] = await db
    .select()
    .from(schema.launchSites)
    .where(eq(schema.launchSites.id, id))

  if (!site) {
    if (c.req.header('accept') === 'application/json') {
      return c.json({ error: 'Launch site not found' }, 404)
    }
    return c.html(
      pageLayout({
        title: 'Launch Site Not Found',
        activeTab: 'sites',
        content: html`
          <div class="max-w-md mx-auto bg-slate-850 border border-slate-800 rounded-xl p-8 text-center my-12">
            <div class="text-4xl mb-2">🔍</div>
            <h1 class="text-xl font-bold text-white">Site Not Found</h1>
            <p class="text-sm text-slate-400 mt-2">The requested launch site could not be located in D1.</p>
            <a href="/sites" class="mt-6 inline-flex items-center gap-1 text-sm text-brand-400 hover:text-brand-300 font-medium">
              &larr; Back to all launch sites
            </a>
          </div>
        `,
      }),
      404
    )
  }

  const events = await db
    .select()
    .from(schema.launchEvents)
    .where(eq(schema.launchEvents.launchSiteId, id))
    .orderBy(desc(schema.launchEvents.startsOn), desc(schema.launchEvents.createdAt))

  if (c.req.header('accept') === 'application/json') {
    return c.json({ site, events })
  }

  return c.html(siteDetailView(site, events))
}

// ---------------------------------------------------------------------------
// Route Bindings (Supports both mounted at '/sites' and mounted at root '/')
// ---------------------------------------------------------------------------

// 1. New form (must precede /:id)
sites.get('/new', handleNewSiteForm)
sites.get('/sites/new', handleNewSiteForm)

// 2. Specific site detail
sites.get('/:id', handleSiteDetail)
sites.get('/sites/:id', handleSiteDetail)

// 3. List and create
sites.get('/', handleListSites)
sites.get('/sites', handleListSites)
sites.post('/', handleCreateSite)
sites.post('/sites', handleCreateSite)

export { sites as sitesRoute, sites as sitesRouter }
export default sites
