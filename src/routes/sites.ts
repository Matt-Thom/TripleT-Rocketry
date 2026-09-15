/**
 * Routes for Launch Sites CRUD operations.
 *
 * GET  /sites          - Lists all launch sites from D1.
 * GET  /sites/new      - Renders new site form.
 * POST /sites          - Inserts new launch_sites row in D1, redirects to /sites/:id.
 * GET  /sites/:id      - Retrieves site and hosted launch events, renders detail view.
 * GET  /sites/:id/edit - Renders edit site form.
 * POST /sites/:id/edit - Updates existing launch_sites row in D1.
 */

import { Hono } from 'hono'
import { html } from 'hono/html'
import { eq, desc, asc, and, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { pageLayout } from '../views/layout'
import { sitesListView, siteDetailView, newSiteFormView, editSiteFormView } from '../views/sites'
import { ensureAustralianLaunchSites } from '../db/context'
import { storageSitesListView, storageSiteFormView, storageSiteDetailView } from '../views/storage_sites'

type Bindings = {
  DB: D1Database
  ENVIRONMENT?: string
  PROJECT_ID?: string
}

const sites = new Hono<{ Bindings: Bindings }>()

/**
 * Access control middleware: Enforce authenticated flyer across all /sites routes.
 */
sites.use('*', async (c, next) => {
  const flyer = (c.get as any)('user')
  if (!flyer) {
    const acceptsHtml = c.req.header('accept')?.includes('text/html')
    if (acceptsHtml) {
      const targetUrl = encodeURIComponent(
        c.req.path + (c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : ''),
      )
      return c.redirect(`/login?redirect=${targetUrl}`, 302)
    }
    return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401)
  }
  await next()
})

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
  let returnTo: string | null = null

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
    returnTo =
      typeof json.return_to === 'string' && json.return_to.trim()
        ? json.return_to.trim()
        : typeof json.returnTo === 'string' && json.returnTo.trim()
        ? json.returnTo.trim()
        : null
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
    returnTo =
      typeof body.return_to === 'string' && body.return_to.trim()
        ? body.return_to.trim()
        : typeof body.returnTo === 'string' && body.returnTo.trim()
        ? body.returnTo.trim()
        : null
  }

  return { name, latitude, longitude, maxAltitudeAglM, notes, returnTo, isJson: contentType.includes('application/json') }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleListSites(c: any) {
  const db = drizzle(c.env.DB, { schema })
  await ensureAustralianLaunchSites(db)

  const allSites = await db
    .select()
    .from(schema.launchSites)
    .orderBy(asc(schema.launchSites.name))

  if (c.req.header('accept') === 'application/json') {
    return c.json(allSites)
  }

  const user = c.get('user') || null
  let storageSitesList: any[] = []
  if (user) {
    storageSitesList = await db
      .select()
      .from(schema.storageSites)
      .where(
        and(
          eq(schema.storageSites.userId, user.id),
          isNull(schema.storageSites.deletedAt),
        ),
      )
      .orderBy(asc(schema.storageSites.name))
  }

  return c.html(sitesListView(allSites, user, storageSitesList))
}

function handleNewSiteForm(c: any) {
  const user = c.get('user') || null
  return c.html(newSiteFormView(user))
}

async function handleCreateSite(c: any) {
  const input = await parseSiteInput(c)

  if (!input.name) {
    if (input.isJson) {
      return c.json({ error: 'Site name is required' }, 400)
    }
    const user = c.get('user') || null
    return c.html(
      pageLayout({
        title: 'Validation Error',
        activeTab: 'sites',
        user,
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

  const returnTo = input.returnTo || c.req.query('return_to') || null
  if (returnTo && typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')) {
    const sep = returnTo.includes('?') ? '&' : '?'
    return c.redirect(`${returnTo}${sep}launch_site_id=${newSite.id}`, 303)
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
    const user = c.get('user') || null
    return c.html(
      pageLayout({
        title: 'Launch Site Not Found',
        activeTab: 'sites',
        user,
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

  const user = c.get('user') || null
  return c.html(siteDetailView(site, events, user))
}

async function handleEditSiteForm(c: any) {
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
    const user = c.get('user') || null
    return c.html(
      pageLayout({
        title: 'Launch Site Not Found',
        activeTab: 'sites',
        user,
        content: html`
          <div class="max-w-md mx-auto bg-slate-850 border border-slate-800 rounded-xl p-8 text-center my-12">
            <div class="text-4xl mb-2">🔍</div>
            <h1 class="text-xl font-bold text-white">Site Not Found</h1>
            <a href="/sites" class="mt-6 inline-flex items-center text-sm text-brand-400">&larr; Back to launch sites</a>
          </div>
        `,
      }),
      404
    )
  }

  const user = c.get('user') || null
  return c.html(editSiteFormView(site, user))
}

async function handleUpdateSite(c: any) {
  const id = c.req.param('id')
  const input = await parseSiteInput(c)

  if (!input.name) {
    if (input.isJson) {
      return c.json({ error: 'Site name is required' }, 400)
    }
    const user = c.get('user') || null
    return c.html(
      pageLayout({
        title: 'Validation Error',
        activeTab: 'sites',
        user,
        content: html`
          <div class="max-w-md mx-auto bg-slate-850 border border-rose-800/80 rounded-xl p-6 text-center">
            <h2 class="text-xl font-bold text-rose-400">Missing Required Field</h2>
            <p class="text-sm text-slate-300 mt-2">Launch site name is required.</p>
            <a href="/sites/${id}/edit" class="mt-4 inline-block px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm">&larr; Back to Edit Form</a>
          </div>
        `,
      }),
      400
    )
  }

  const db = drizzle(c.env.DB, { schema })

  // Check exists
  const [existing] = await db
    .select()
    .from(schema.launchSites)
    .where(eq(schema.launchSites.id, id))

  if (!existing) {
    if (input.isJson) {
      return c.json({ error: 'Launch site not found' }, 404)
    }
    return c.redirect('/sites', 302)
  }

  const [updatedSite] = await db
    .update(schema.launchSites)
    .set({
      name: input.name,
      latitude: input.latitude,
      longitude: input.longitude,
      maxAltitudeAglM: input.maxAltitudeAglM,
      notes: input.notes,
      updatedAt: Date.now(),
    })
    .where(eq(schema.launchSites.id, id))
    .returning()

  if (input.isJson) {
    return c.json(updatedSite, 200)
  }

  return c.redirect(`/sites/${id}`, 303)
}

// ---------------------------------------------------------------------------
// Propellant Storage Sites & Magazines Handlers (Requirement R3)
// ---------------------------------------------------------------------------

/**
 * Helper to parse storage site input supporting both form-encoded and JSON payloads.
 */
export async function parseStorageSiteInput(c: any) {
  const contentType = c.req.header('content-type') || ''
  const isJson = contentType.includes('application/json')
  let body: any = {}
  if (isJson) {
    body = await c.req.json().catch(() => ({}))
  } else {
    body = await c.req.parseBody().catch(() => ({}))
  }

  const name = String(body.name || '').trim()
  const locationRaw = body.location !== undefined && body.location !== null ? String(body.location).trim() : null
  const location = locationRaw && locationRaw.length > 0 ? locationRaw : null

  const rawCapacity = body.capacity_kg !== undefined ? body.capacity_kg : body.capacityKg
  let capacityKg = 0
  if (rawCapacity !== undefined && rawCapacity !== null && rawCapacity !== '') {
    const parsed = parseFloat(String(rawCapacity))
    capacityKg = isNaN(parsed) ? 0 : parsed
  }

  const rawPermit = body.permit_number !== undefined ? body.permit_number : body.permitNumber
  const permitTrimmed = rawPermit !== undefined && rawPermit !== null ? String(rawPermit).trim() : null
  const permitNumber = permitTrimmed && permitTrimmed.length > 0 ? permitTrimmed : null

  const notesRaw = body.notes !== undefined && body.notes !== null ? String(body.notes).trim() : null
  const notes = notesRaw && notesRaw.length > 0 ? notesRaw : null

  return { name, location, capacityKg, permitNumber, notes, isJson }
}

/**
 * List Storage Sites (GET /sites/storage-sites).
 */
export async function listStorageSitesHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user')
  if (!flyer) return c.redirect('/login')

  const storageSitesList = await db
    .select()
    .from(schema.storageSites)
    .where(
      and(
        eq(schema.storageSites.userId, flyer.id),
        isNull(schema.storageSites.deletedAt),
      ),
    )
    .orderBy(asc(schema.storageSites.name))

  if (c.req.header('accept')?.includes('application/json')) {
    return c.json(storageSitesList)
  }

  const content = storageSitesListView(storageSitesList, flyer)
  const fullHtml = pageLayout({
    title: 'Propellant Storage Sites & Physical Storage Magazines',
    activeTab: 'sites',
    content,
    user: flyer,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
}

/**
 * Storage Site Create Form (GET /sites/storage-sites/new).
 */
export async function newStorageSiteFormHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user')
  if (!flyer) return c.redirect('/login')

  const content = storageSiteFormView({
    isNew: true,
    user: flyer,
  })
  const fullHtml = pageLayout({
    title: 'New Storage Site',
    activeTab: 'sites',
    content,
    user: flyer,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
}

/**
 * Create Storage Site (POST /sites/storage-sites).
 */
export async function createStorageSiteHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user')
  if (!flyer) return c.redirect('/login')

  const input = await parseStorageSiteInput(c)

  if (!input.name) {
    const errorMsg = 'Storage site name is required'
    if (input.isJson) return c.json({ error: errorMsg }, 400)
    const content = storageSiteFormView({
      site: input,
      error: errorMsg,
      isNew: true,
      user: flyer,
    })
    return c.html(
      pageLayout({ title: 'New Storage Site', activeTab: 'sites', content, user: flyer }),
      400,
      { 'Content-Type': 'text/html; charset=utf-8' },
    )
  }

  const [site] = await db
    .insert(schema.storageSites)
    .values({
      userId: flyer.id,
      name: input.name,
      location: input.location,
      capacityKg: input.capacityKg,
      permitNumber: input.permitNumber,
      notes: input.notes,
    })
    .returning()

  if (input.isJson) {
    return c.json(site, 201)
  }

  return c.redirect(`/sites/storage-sites/${site.id}`, 303)
}

/**
 * View Storage Site Details (GET /sites/storage-sites/:id).
 */
export async function viewStorageSiteHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user')
  if (!flyer) return c.redirect('/login')
  const id = c.req.param('id')

  const [site] = await db
    .select()
    .from(schema.storageSites)
    .where(
      and(
        eq(schema.storageSites.id, id),
        eq(schema.storageSites.userId, flyer.id),
        isNull(schema.storageSites.deletedAt),
      ),
    )
    .limit(1)

  if (!site) {
    if (c.req.header('accept')?.includes('application/json')) {
      return c.json({ error: 'Storage site not found' }, 404)
    }
    return c.html(
      pageLayout({
        title: 'Site Not Found',
        activeTab: 'sites',
        user: flyer,
        content: html`
          <div class="max-w-md mx-auto bg-slate-850 border border-slate-800 rounded-xl p-6 text-center">
            <h2 class="text-xl font-bold text-slate-200">Storage Site Not Found</h2>
            <p class="text-sm text-slate-400 mt-2">The requested storage site does not exist or has been removed.</p>
            <a href="/sites/storage-sites" class="mt-4 inline-block px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm">&larr; Back to Storage Sites</a>
          </div>
        `,
      }),
      404,
      { 'Content-Type': 'text/html; charset=utf-8' },
    )
  }

  // Find motors and components located at this site
  const siteMotors = await db
    .select({
      id: schema.motorInventories.id,
      quantityOnHand: schema.motorInventories.quantityOnHand,
      storageLocation: schema.motorInventories.storageLocation,
      motor: {
        manufacturer: schema.motors.manufacturer,
        model: schema.motors.model,
        impulseClass: schema.motors.impulseClass,
        propellantWeightG: schema.motors.propellantWeightG,
        weightG: schema.motors.weightG,
      },
    })
    .from(schema.motorInventories)
    .innerJoin(schema.motors, eq(schema.motorInventories.motorId, schema.motors.id))
    .where(
      and(
        eq(schema.motorInventories.userId, flyer.id),
        isNull(schema.motorInventories.deletedAt),
      ),
    )

  const siteComponents = await db
    .select()
    .from(schema.components)
    .where(
      and(
        eq(schema.components.userId, flyer.id),
        isNull(schema.components.deletedAt),
      ),
    )

  const matchingMotors = siteMotors.filter(
    (m) =>
      m.storageLocation &&
      (m.storageLocation.toLowerCase() === site.name.toLowerCase() ||
        (site.location && m.storageLocation.toLowerCase() === site.location.toLowerCase())),
  )
  const matchingComponents = siteComponents.filter(
    (comp) =>
      comp.storageLocation &&
      (comp.storageLocation.toLowerCase() === site.name.toLowerCase() ||
        (site.location && comp.storageLocation.toLowerCase() === site.location.toLowerCase())),
  )

  if (c.req.header('accept')?.includes('application/json')) {
    return c.json({ site, motors: matchingMotors, components: matchingComponents })
  }

  const content = storageSiteDetailView(site, { motors: matchingMotors, components: matchingComponents }, flyer)
  const fullHtml = pageLayout({
    title: `Storage Site — ${site.name}`,
    activeTab: 'sites',
    content,
    user: flyer,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
}

/**
 * Storage Site Edit Form (GET /sites/storage-sites/:id/edit).
 */
export async function editStorageSiteFormHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user')
  if (!flyer) return c.redirect('/login')
  const id = c.req.param('id')

  const [site] = await db
    .select()
    .from(schema.storageSites)
    .where(
      and(
        eq(schema.storageSites.id, id),
        eq(schema.storageSites.userId, flyer.id),
        isNull(schema.storageSites.deletedAt),
      ),
    )
    .limit(1)

  if (!site) {
    return c.text('Storage site not found', 404)
  }

  const content = storageSiteFormView({
    site,
    isNew: false,
    user: flyer,
  })
  const fullHtml = pageLayout({
    title: `Edit Storage Site — ${site.name}`,
    activeTab: 'sites',
    content,
    user: flyer,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
}

/**
 * Update Storage Site (POST /sites/storage-sites/:id/edit and POST /sites/storage-sites/:id).
 */
export async function updateStorageSiteHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user')
  if (!flyer) return c.redirect('/login')
  const id = c.req.param('id')

  const [existing] = await db
    .select()
    .from(schema.storageSites)
    .where(
      and(
        eq(schema.storageSites.id, id),
        eq(schema.storageSites.userId, flyer.id),
        isNull(schema.storageSites.deletedAt),
      ),
    )
    .limit(1)

  if (!existing) {
    return c.text('Storage site not found', 404)
  }

  const input = await parseStorageSiteInput(c)

  if (!input.name) {
    const errorMsg = 'Storage site name is required'
    if (input.isJson) return c.json({ error: errorMsg }, 400)
    const content = storageSiteFormView({
      site: { ...existing, ...input, id },
      error: errorMsg,
      isNew: false,
      user: flyer,
    })
    return c.html(
      pageLayout({ title: `Edit Storage Site — ${existing.name}`, activeTab: 'sites', content, user: flyer }),
      400,
      { 'Content-Type': 'text/html; charset=utf-8' },
    )
  }

  const [updated] = await db
    .update(schema.storageSites)
    .set({
      name: input.name,
      location: input.location,
      capacityKg: input.capacityKg,
      permitNumber: input.permitNumber,
      notes: input.notes,
      updatedAt: Date.now(),
    })
    .where(and(eq(schema.storageSites.id, id), eq(schema.storageSites.userId, flyer.id)))
    .returning()

  if (input.isJson) {
    return c.json(updated, 200)
  }

  return c.redirect(`/sites/storage-sites/${id}`, 303)
}

/**
 * Delete Storage Site (POST /sites/storage-sites/:id/delete and DELETE /sites/storage-sites/:id).
 */
export async function deleteStorageSiteHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user')
  if (!flyer) return c.redirect('/login')
  const id = c.req.param('id')

  const [existing] = await db
    .select()
    .from(schema.storageSites)
    .where(
      and(
        eq(schema.storageSites.id, id),
        eq(schema.storageSites.userId, flyer.id),
        isNull(schema.storageSites.deletedAt),
      ),
    )
    .limit(1)

  if (!existing) {
    return c.text('Storage site not found', 404)
  }

  // Soft delete
  await db
    .update(schema.storageSites)
    .set({
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where(and(eq(schema.storageSites.id, id), eq(schema.storageSites.userId, flyer.id)))

  if (c.req.header('hx-request')) {
    const isInventory = c.req.path.includes('/inventory')
    c.header('HX-Redirect', isInventory ? '/inventory/storage-sites' : '/sites/storage-sites')
    return c.text('OK')
  }

  if (c.req.header('accept')?.includes('application/json')) {
    return c.json({ success: true, id }, 200)
  }

  return c.redirect('/sites/storage-sites', 303)
}

// ---------------------------------------------------------------------------
// Route Bindings
// ---------------------------------------------------------------------------

// 1. Storage Sites New Form (Registered first to avoid /:id wildcard collisions)
sites.get('/storage-sites/new', newStorageSiteFormHandler)
sites.get('/sites/storage-sites/new', newStorageSiteFormHandler)

// 2. Storage Sites Edit Form & Updates
sites.get('/storage-sites/:id/edit', editStorageSiteFormHandler)
sites.get('/sites/storage-sites/:id/edit', editStorageSiteFormHandler)
sites.post('/storage-sites/:id/edit', updateStorageSiteHandler)
sites.post('/sites/storage-sites/:id/edit', updateStorageSiteHandler)

// 3. Storage Sites Delete
sites.post('/storage-sites/:id/delete', deleteStorageSiteHandler)
sites.post('/sites/storage-sites/:id/delete', deleteStorageSiteHandler)
sites.delete('/storage-sites/:id', deleteStorageSiteHandler)
sites.delete('/sites/storage-sites/:id', deleteStorageSiteHandler)

// 4. Storage Sites Detail & POST-as-update
sites.get('/storage-sites/:id', viewStorageSiteHandler)
sites.get('/sites/storage-sites/:id', viewStorageSiteHandler)
sites.post('/storage-sites/:id', updateStorageSiteHandler)
sites.post('/sites/storage-sites/:id', updateStorageSiteHandler)

// 5. Storage Sites List & Create
sites.get('/storage-sites', listStorageSitesHandler)
sites.get('/sites/storage-sites', listStorageSitesHandler)
sites.post('/storage-sites', createStorageSiteHandler)
sites.post('/sites/storage-sites', createStorageSiteHandler)

// 6. Launch Site: New form
sites.get('/new', handleNewSiteForm)
sites.get('/sites/new', handleNewSiteForm)

// 7. Launch Site: Edit form & update
sites.get('/:id/edit', handleEditSiteForm)
sites.get('/sites/:id/edit', handleEditSiteForm)
sites.post('/:id/edit', handleUpdateSite)
sites.post('/sites/:id/edit', handleUpdateSite)
sites.put('/:id', handleUpdateSite)
sites.put('/sites/:id', handleUpdateSite)

// 8. Launch Site: Detail
sites.get('/:id', handleSiteDetail)
sites.get('/sites/:id', handleSiteDetail)

// 9. Launch Site: List and create
sites.get('/', handleListSites)
sites.get('/sites', handleListSites)
sites.post('/', handleCreateSite)
sites.post('/sites', handleCreateSite)

export { sites as sitesRoute, sites as sitesRouter }
export default sites
