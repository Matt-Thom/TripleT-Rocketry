/**
 * Routes for Launch Events / Meets CRUD operations.
 *
 * GET  /events       - Lists all launch events joined with host launch_sites from D1.
 * GET  /events/new   - Queries sites from D1, renders new event form.
 * POST /events       - Inserts new launch_events row in D1, redirects to /events/:id.
 * GET  /events/:id   - Retrieves event, host site, and logged flights, renders detail view.
 */

import { Hono } from 'hono'
import { html } from 'hono/html'
import { eq, desc, asc, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { pageLayout } from '../views/layout'
import { eventsListView, eventDetailView, newEventFormView } from '../views/events'

type Bindings = {
  DB: D1Database
  ENVIRONMENT?: string
  PROJECT_ID?: string
}

const events = new Hono<{ Bindings: Bindings }>()

/**
 * Helper to parse and normalize launch event form or JSON payload.
 */
async function parseEventInput(c: any) {
  const contentType = c.req.header('content-type') || ''
  let name = ''
  let launchSiteId = ''
  let startsOn: string | null = null
  let endsOn: string | null = null
  let padCount: number | null = null
  let weatherNotes: string | null = null
  let rsoUserId: string | null = null
  let lcoUserId: string | null = null

  if (contentType.includes('application/json')) {
    const json = await c.req.json().catch(() => ({}))
    name = typeof json.name === 'string' ? json.name.trim() : ''
    launchSiteId =
      typeof json.launch_site_id === 'string'
        ? json.launch_site_id.trim()
        : typeof json.launchSiteId === 'string'
        ? json.launchSiteId.trim()
        : ''
    startsOn =
      json.starts_on && typeof json.starts_on === 'string' && json.starts_on.trim()
        ? json.starts_on.trim()
        : json.startsOn && typeof json.startsOn === 'string' && json.startsOn.trim()
        ? json.startsOn.trim()
        : null
    endsOn =
      json.ends_on && typeof json.ends_on === 'string' && json.ends_on.trim()
        ? json.ends_on.trim()
        : json.endsOn && typeof json.endsOn === 'string' && json.endsOn.trim()
        ? json.endsOn.trim()
        : null
    const rawPadCount = json.pad_count ?? json.padCount
    padCount =
      rawPadCount != null && rawPadCount !== '' && !isNaN(Number(rawPadCount))
        ? Number(rawPadCount)
        : null
    weatherNotes =
      json.weather_notes && typeof json.weather_notes === 'string' && json.weather_notes.trim()
        ? json.weather_notes.trim()
        : json.weatherNotes && typeof json.weatherNotes === 'string' && json.weatherNotes.trim()
        ? json.weatherNotes.trim()
        : null
    rsoUserId =
      json.rso_user_id && typeof json.rso_user_id === 'string' && json.rso_user_id.trim()
        ? json.rso_user_id.trim()
        : json.rsoUserId && typeof json.rsoUserId === 'string' && json.rsoUserId.trim()
        ? json.rsoUserId.trim()
        : null
    lcoUserId =
      json.lco_user_id && typeof json.lco_user_id === 'string' && json.lco_user_id.trim()
        ? json.lco_user_id.trim()
        : json.lcoUserId && typeof json.lcoUserId === 'string' && json.lcoUserId.trim()
        ? json.lcoUserId.trim()
        : null
  } else {
    const body = await c.req.parseBody()
    name = typeof body.name === 'string' ? body.name.trim() : ''
    launchSiteId =
      typeof body.launch_site_id === 'string'
        ? body.launch_site_id.trim()
        : typeof body.launchSiteId === 'string'
        ? body.launchSiteId.trim()
        : ''
    startsOn =
      body.starts_on && typeof body.starts_on === 'string' && body.starts_on.trim()
        ? body.starts_on.trim()
        : body.startsOn && typeof body.startsOn === 'string' && body.startsOn.trim()
        ? body.startsOn.trim()
        : null
    endsOn =
      body.ends_on && typeof body.ends_on === 'string' && body.ends_on.trim()
        ? body.ends_on.trim()
        : body.endsOn && typeof body.endsOn === 'string' && body.endsOn.trim()
        ? body.endsOn.trim()
        : null
    const rawPadCount = body.pad_count ?? body.padCount
    padCount =
      rawPadCount != null && rawPadCount !== '' && !isNaN(Number(rawPadCount))
        ? Number(rawPadCount)
        : null
    weatherNotes =
      body.weather_notes && typeof body.weather_notes === 'string' && body.weather_notes.trim()
        ? body.weather_notes.trim()
        : body.weatherNotes && typeof body.weatherNotes === 'string' && body.weatherNotes.trim()
        ? body.weatherNotes.trim()
        : null
    rsoUserId =
      body.rso_user_id && typeof body.rso_user_id === 'string' && body.rso_user_id.trim()
        ? body.rso_user_id.trim()
        : body.rsoUserId && typeof body.rsoUserId === 'string' && body.rsoUserId.trim()
        ? body.rsoUserId.trim()
        : null
    lcoUserId =
      body.lco_user_id && typeof body.lco_user_id === 'string' && body.lco_user_id.trim()
        ? body.lco_user_id.trim()
        : body.lcoUserId && typeof body.lcoUserId === 'string' && body.lcoUserId.trim()
        ? body.lcoUserId.trim()
        : null
  }

  return {
    name,
    launchSiteId,
    startsOn,
    endsOn,
    padCount,
    weatherNotes,
    rsoUserId,
    lcoUserId,
    isJson: contentType.includes('application/json'),
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleListEvents(c: any) {
  const db = drizzle(c.env.DB, { schema })

  // Query launch events joined with host launch sites
  const rows = await db
    .select({
      event: schema.launchEvents,
      site: schema.launchSites,
    })
    .from(schema.launchEvents)
    .leftJoin(schema.launchSites, eq(schema.launchEvents.launchSiteId, schema.launchSites.id))
    .orderBy(desc(schema.launchEvents.startsOn), desc(schema.launchEvents.createdAt))

  // Collect unique user IDs for officer lookup
  const userIds = new Set<string>()
  for (const row of rows) {
    if (row.event.rsoUserId) userIds.add(row.event.rsoUserId)
    if (row.event.lcoUserId) userIds.add(row.event.lcoUserId)
  }

  const userMap = new Map<string, string>()
  if (userIds.size > 0) {
    const userRows = await db
      .select({ id: schema.users.id, displayName: schema.users.displayName })
      .from(schema.users)
      .where(inArray(schema.users.id, Array.from(userIds)))
    for (const u of userRows) {
      userMap.set(u.id, u.displayName)
    }
  }

  const eventsWithSites = rows.map((r) => ({
    ...r.event,
    site: r.site,
    siteName: r.site?.name ?? 'Launch Site',
    rsoName: r.event.rsoUserId ? userMap.get(r.event.rsoUserId) ?? r.event.rsoUserId : null,
    lcoName: r.event.lcoUserId ? userMap.get(r.event.lcoUserId) ?? r.event.lcoUserId : null,
  }))

  const user = c.get('user') || null
  if (c.req.header('accept') === 'application/json') {
    return c.json(eventsWithSites)
  }

  return c.html(eventsListView(eventsWithSites, user))
}

async function handleNewEventForm(c: any) {
  const user = c.get('user') || null
  const db = drizzle(c.env.DB, { schema })
  const allSites = await db
    .select()
    .from(schema.launchSites)
    .orderBy(asc(schema.launchSites.name))

  const selectedSiteId = c.req.query('launch_site_id') || null
  return c.html(newEventFormView(allSites, selectedSiteId, user))
}

async function handleCreateEvent(c: any) {
  const input = await parseEventInput(c)

  const user = c.get('user') || null

  if (!input.name || !input.launchSiteId) {
    const errorMsg = !input.name
      ? 'Event name is required'
      : 'Host launch site selection is required'

    if (input.isJson) {
      return c.json({ error: errorMsg }, 400)
    }
    return c.html(
      pageLayout({
        title: 'Validation Error',
        activeTab: 'events',
        user,
        content: html`
          <div class="max-w-md mx-auto bg-slate-850 border border-rose-800/80 rounded-xl p-6 text-center">
            <h2 class="text-xl font-bold text-rose-400">Missing Required Information</h2>
            <p class="text-sm text-slate-300 mt-2">${errorMsg}</p>
            <a href="/events/new" class="mt-4 inline-block px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm">&larr; Back to Form</a>
          </div>
        `,
      }),
      400
    )
  }

  const db = drizzle(c.env.DB, { schema })

  // Verify launch site exists
  const [site] = await db
    .select()
    .from(schema.launchSites)
    .where(eq(schema.launchSites.id, input.launchSiteId))

  if (!site) {
    if (input.isJson) {
      return c.json({ error: 'Selected launch site does not exist' }, 400)
    }
    return c.html(
      pageLayout({
        title: 'Invalid Launch Site',
        activeTab: 'events',
        user,
        content: html`
          <div class="max-w-md mx-auto bg-slate-850 border border-rose-800/80 rounded-xl p-6 text-center">
            <h2 class="text-xl font-bold text-rose-400">Invalid Launch Site</h2>
            <p class="text-sm text-slate-300 mt-2">The selected launch site was not found.</p>
            <a href="/events/new" class="mt-4 inline-block px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm">&larr; Back to Form</a>
          </div>
        `,
      }),
      400
    )
  }

  const [newEvent] = await db
    .insert(schema.launchEvents)
    .values({
      launchSiteId: input.launchSiteId,
      name: input.name,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      padCount: input.padCount,
      weatherNotes: input.weatherNotes,
      rsoUserId: input.rsoUserId,
      lcoUserId: input.lcoUserId,
    })
    .returning()

  if (input.isJson) {
    return c.json(newEvent, 201)
  }

  return c.redirect(`/events/${newEvent.id}`, 303)
}

async function handleEventDetail(c: any) {
  const user = c.get('user') || null
  const id = c.req.param('id')
  const db = drizzle(c.env.DB, { schema })

  // 1. Retrieve launch event
  const [event] = await db
    .select()
    .from(schema.launchEvents)
    .where(eq(schema.launchEvents.id, id))

  if (!event) {
    if (c.req.header('accept') === 'application/json') {
      return c.json({ error: 'Launch event not found' }, 404)
    }
    return c.html(
      pageLayout({
        title: 'Launch Event Not Found',
        activeTab: 'events',
        user,
        content: html`
          <div class="max-w-md mx-auto bg-slate-850 border border-slate-800 rounded-xl p-8 text-center my-12">
            <div class="text-4xl mb-2">🔍</div>
            <h1 class="text-xl font-bold text-white">Event Not Found</h1>
            <p class="text-sm text-slate-400 mt-2">The requested launch event could not be located in D1.</p>
            <a href="/events" class="mt-6 inline-flex items-center gap-1 text-sm text-brand-400 hover:text-brand-300 font-medium">
              &larr; Back to all launch events
            </a>
          </div>
        `,
      }),
      404
    )
  }

  // 2. Retrieve host site
  let site: typeof schema.launchSites.$inferSelect | null = null
  if (event.launchSiteId) {
    const [foundSite] = await db
      .select()
      .from(schema.launchSites)
      .where(eq(schema.launchSites.id, event.launchSiteId))
    site = foundSite ?? null
  }

  // 3. Retrieve officer user display names
  let rsoName: string | null = null
  let lcoName: string | null = null
  if (event.rsoUserId) {
    const [rsoUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, event.rsoUserId))
    rsoName = rsoUser?.displayName ?? event.rsoUserId
  }
  if (event.lcoUserId) {
    const [lcoUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, event.lcoUserId))
    lcoName = lcoUser?.displayName ?? event.lcoUserId
  }

  // 4. Retrieve logged flights for this event
  const loggedFlights = await db
    .select()
    .from(schema.flights)
    .where(eq(schema.flights.launchEventId, id))
    .orderBy(desc(schema.flights.flownAt), desc(schema.flights.flightNumber))

  const eventWithOfficers = {
    ...event,
    rsoName,
    lcoName,
  }

  if (c.req.header('accept') === 'application/json') {
    return c.json({ event: eventWithOfficers, site, flights: loggedFlights })
  }

  return c.html(eventDetailView(eventWithOfficers, site, loggedFlights, user))
}

// ---------------------------------------------------------------------------
// Route Bindings (Supports both mounted at '/events' and mounted at root '/')
// ---------------------------------------------------------------------------

// 1. New form (must precede /:id)
events.get('/new', handleNewEventForm)
events.get('/events/new', handleNewEventForm)

// 2. Specific event detail
events.get('/:id', handleEventDetail)
events.get('/events/:id', handleEventDetail)

// 3. List and create
events.get('/', handleListEvents)
events.get('/events', handleListEvents)
events.post('/', handleCreateEvent)
events.post('/events', handleCreateEvent)

export { events as eventsRoute, events as eventsRouter }
export default events
