/**
 * Rockets & Versioned Configurations Router (Milestone 2).
 *
 * Implements the full CRUD and snapshot versioning endpoints:
 * - GET  /rockets                                Lists all rockets for active flyer with status and current config summary
 * - GET  /rockets/new                            Renders form to create airframe + baseline v1 snapshot
 * - POST /rockets                                Handles creation of airframe + initial v1 snapshot in D1
 * - GET  /rockets/:id                            Retrieves rocket, all versioned snapshots (v1, v2...), flight count
 * - GET  /rockets/:id/edit                       Renders edit airframe form
 * - POST /rockets/:id                            Updates airframe name/status
 * - GET  /rockets/:id/configurations/new         Renders form to add configuration snapshot v(N+1)
 * - POST /rockets/:id/configurations             Appends new version (v = max(v)+1), updates is_current
 * - POST /rockets/:id/configurations/:configId/set-current Switches active configuration snapshot
 */

import { Hono } from 'hono'
import { html } from 'hono/html'
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { getActiveFlyer } from '../db/context'
import type { TraceContext } from '../logging'
import { pageLayout } from '../views/layout'
import {
  editRocketFormView,
  newConfigFormView,
  newRocketFormView,
  rocketDetailView,
  rocketsListView,
  type RocketConfigSummary,
  type RocketListItem,
} from '../views/rockets'

type Bindings = {
  DB: D1Database
  ENVIRONMENT: string
  PROJECT_ID: string
}

type Variables = {
  trace: TraceContext
}

export const rocketsRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>()

function parseOptionalNumber(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null
  const n = Number(val)
  return isNaN(n) ? null : n
}

function parseOptionalString(val: unknown): string | null {
  if (val === undefined || val === null) return null
  const s = String(val).trim()
  return s.length > 0 ? s : null
}

const VALID_STATUSES = ['flight_ready', 'in_build', 'damaged', 'retired'] as const
type ValidStatus = (typeof VALID_STATUSES)[number]

const VALID_RECOVERY_TYPES = ['parachute', 'streamer', 'dual_deploy', 'tumble', 'other'] as const
type ValidRecovery = (typeof VALID_RECOVERY_TYPES)[number]

/**
 * GET /rockets
 * Lists all rockets for the active flyer with status badges, current configuration
 * summary, and flight count.
 */
rocketsRouter.get('/', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user') || (await getActiveFlyer(db))

  // Retrieve non-deleted rockets for active flyer
  const flyerRockets = await db
    .select()
    .from(schema.rockets)
    .where(and(eq(schema.rockets.ownerId, flyer.id), isNull(schema.rockets.deletedAt)))
    .orderBy(desc(schema.rockets.createdAt))

  const rocketIds = flyerRockets.map((r) => r.id)

  // Fetch all configs for these rockets in batch
  const allConfigs =
    rocketIds.length > 0
      ? await db
          .select()
          .from(schema.rocketConfigurations)
          .where(
            and(
              inArray(schema.rocketConfigurations.rocketId, rocketIds),
              isNull(schema.rocketConfigurations.deletedAt),
            ),
          )
          .orderBy(desc(schema.rocketConfigurations.version))
      : []

  // Group configs by rocketId
  const configsByRocketId = new Map<string, RocketConfigSummary[]>()
  for (const cfg of allConfigs) {
    const list = configsByRocketId.get(cfg.rocketId) || []
    list.push(cfg)
    configsByRocketId.set(cfg.rocketId, list)
  }

  // Fetch flight counts per rocket via rocket configurations join
  const flightCounts =
    rocketIds.length > 0
      ? await db
          .select({
            rocketId: schema.rocketConfigurations.rocketId,
            count: count(),
          })
          .from(schema.flights)
          .innerJoin(
            schema.rocketConfigurations,
            eq(schema.flights.rocketConfigurationId, schema.rocketConfigurations.id),
          )
          .where(inArray(schema.rocketConfigurations.rocketId, rocketIds))
          .groupBy(schema.rocketConfigurations.rocketId)
      : []

  const flightCountsByRocketId = new Map<string, number>()
  for (const fc of flightCounts) {
    if (fc.rocketId) {
      flightCountsByRocketId.set(fc.rocketId, fc.count)
    }
  }

  const rocketListItems: RocketListItem[] = flyerRockets.map((r) => {
    const rocketConfigs = configsByRocketId.get(r.id) || []
    // Active configuration is either marked isCurrent or highest version
    const currentConfig = rocketConfigs.find((cfg) => cfg.isCurrent) || rocketConfigs[0] || null
    const flightCount = flightCountsByRocketId.get(r.id) ?? 0

    return {
      id: r.id,
      name: r.name,
      status: r.status,
      currentConfig,
      flightCount,
    }
  })

  const content = rocketsListView(rocketListItems)

  const fullHtml = pageLayout({
    title: 'Rockets & Airframes',
    activeTab: 'rockets',
    content,
    user: flyer,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
})

/**
 * GET /rockets/new
 * Renders the new rocket form to establish airframe and baseline v1 snapshot.
 */
rocketsRouter.get('/new', async (c) => {
  const content = newRocketFormView()

  const fullHtml = pageLayout({
    title: 'New Rocket Airframe',
    activeTab: 'rockets',
    content,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
})

/**
 * POST /rockets
 * Handles creation of new rocket airframe AND initial version 1 config snapshot in D1.
 * Sets version = 1, is_current = 1. Redirects to /rockets/:id.
 */
rocketsRouter.post('/', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const flyer = await getActiveFlyer(db)

  const body = await c.req.parseBody()

  const name = parseOptionalString(body.name)
  if (!name) {
    const content = newRocketFormView('Rocket airframe name is required.')
    return c.html(
      pageLayout({
        title: 'New Rocket Airframe',
        activeTab: 'rockets',
        content,
      }),
      400,
      { 'Content-Type': 'text/html; charset=utf-8' },
    )
  }

  const rawStatus = parseOptionalString(body.status) || 'flight_ready'
  const status: ValidStatus = VALID_STATUSES.includes(rawStatus as any)
    ? (rawStatus as ValidStatus)
    : 'flight_ready'

  // Insert airframe
  const [newRocket] = await db
    .insert(schema.rockets)
    .values({
      ownerId: flyer.id,
      name,
      status,
      createdBy: flyer.id,
    })
    .returning()

  // Parse baseline configuration snapshot fields (both snake_case and camelCase supported)
  const airframeMaterial = parseOptionalString(body.airframe_material ?? body.airframeMaterial)
  const finCount = parseOptionalNumber(body.fin_count ?? body.finCount)
  const dryMassG = parseOptionalNumber(body.dry_mass_g ?? body.dryMassG)
  const loadedMassG = parseOptionalNumber(body.loaded_mass_g ?? body.loadedMassG)
  const ballastG = parseOptionalNumber(body.ballast_g ?? body.ballastG)
  const cgMm = parseOptionalNumber(body.cg_mm ?? body.cgMm)
  const cpMm = parseOptionalNumber(body.cp_mm ?? body.cpMm)
  const stabilityCalibers = parseOptionalNumber(body.stability_calibers ?? body.stabilityCalibers)

  const rawRecovery = parseOptionalString(body.recovery_type ?? body.recoveryType)
  const recoveryType: ValidRecovery | null = VALID_RECOVERY_TYPES.includes(rawRecovery as any)
    ? (rawRecovery as ValidRecovery)
    : rawRecovery
      ? 'parachute'
      : null

  const parachuteSizeMm = parseOptionalNumber(body.parachute_size_mm ?? body.parachuteSizeMm)
  const motorMountDiameterMm = parseOptionalNumber(
    body.motor_mount_diameter_mm ?? body.motorMountDiameterMm,
  )

  // Insert baseline version 1 configuration snapshot
  await db.insert(schema.rocketConfigurations).values({
    rocketId: newRocket.id,
    version: 1,
    airframeMaterial,
    finCount,
    dryMassG,
    loadedMassG,
    ballastG,
    cgMm,
    cpMm,
    stabilityCalibers,
    recoveryType,
    parachuteSizeMm,
    motorMountDiameterMm,
    isCurrent: true,
    createdBy: flyer.id,
  })

  return c.redirect(`/rockets/${newRocket.id}`, 303)
})

/**
 * GET /rockets/:id
 * Retrieves rocket, all versioned configs ordered by version desc, and flight count.
 * Renders detail view.
 */
rocketsRouter.get('/:id', async (c) => {
  const { id } = c.req.param()
  const db = drizzle(c.env.DB, { schema })

  const [rocket] = await db
    .select()
    .from(schema.rockets)
    .where(and(eq(schema.rockets.id, id), isNull(schema.rockets.deletedAt)))

  if (!rocket) {
    const errorHtml = pageLayout({
      title: 'Rocket Not Found',
      activeTab: 'rockets',
      content: html`
        <div class="max-w-xl mx-auto text-center py-16">
          <span class="text-4xl block mb-4">🔍</span>
          <h1 class="text-2xl font-bold text-white mb-2">Airframe Not Found</h1>
          <p class="text-slate-400 text-sm mb-6">The requested rocket airframe does not exist or has been deleted.</p>
          <a href="/rockets" class="inline-flex items-center px-4 py-2 text-sm font-semibold rounded-lg text-slate-950 bg-brand-400 hover:bg-brand-300">
            Return to Fleet
          </a>
        </div>
      `,
    })
    return c.html(errorHtml, 404, { 'Content-Type': 'text/html; charset=utf-8' })
  }

  // Resolve owner display name
  let ownerName = 'TripleT Pilot'
  if (rocket.ownerId) {
    const [owner] = await db
      .select({ displayName: schema.users.displayName })
      .from(schema.users)
      .where(eq(schema.users.id, rocket.ownerId))
    if (owner?.displayName) {
      ownerName = owner.displayName
    }
  }

  // Fetch all versioned configurations for this rocket, ordered by version descending
  const configurations = await db
    .select()
    .from(schema.rocketConfigurations)
    .where(
      and(
        eq(schema.rocketConfigurations.rocketId, id),
        isNull(schema.rocketConfigurations.deletedAt),
      ),
    )
    .orderBy(desc(schema.rocketConfigurations.version))

  // Fetch flight count for this rocket across all its configurations
  const [flightCountRes] = await db
    .select({ count: count() })
    .from(schema.flights)
    .innerJoin(
      schema.rocketConfigurations,
      eq(schema.flights.rocketConfigurationId, schema.rocketConfigurations.id),
    )
    .where(eq(schema.rocketConfigurations.rocketId, id))

  const flightCount = flightCountRes?.count ?? 0

  const content = rocketDetailView({
    rocket,
    configurations,
    flightCount,
    ownerName,
  })

  const fullHtml = pageLayout({
    title: `${rocket.name} — Airframe Details`,
    activeTab: 'rockets',
    content,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
})

/**
 * GET /rockets/:id/edit
 * Renders the form to edit rocket name or status.
 */
rocketsRouter.get('/:id/edit', async (c) => {
  const { id } = c.req.param()
  const db = drizzle(c.env.DB, { schema })

  const [rocket] = await db
    .select()
    .from(schema.rockets)
    .where(and(eq(schema.rockets.id, id), isNull(schema.rockets.deletedAt)))

  if (!rocket) {
    return c.text('Rocket not found', 404)
  }

  const content = editRocketFormView(rocket)

  const fullHtml = pageLayout({
    title: `Edit ${rocket.name}`,
    activeTab: 'rockets',
    content,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
})

/**
 * POST /rockets/:id
 * Updates rocket airframe name and status.
 */
rocketsRouter.post('/:id', async (c) => {
  const { id } = c.req.param()
  const db = drizzle(c.env.DB, { schema })

  const [rocket] = await db
    .select()
    .from(schema.rockets)
    .where(and(eq(schema.rockets.id, id), isNull(schema.rockets.deletedAt)))

  if (!rocket) {
    return c.text('Rocket not found', 404)
  }

  const body = await c.req.parseBody()
  const name = parseOptionalString(body.name)
  if (!name) {
    const content = editRocketFormView(rocket, 'Rocket name is required.')
    return c.html(
      pageLayout({
        title: `Edit ${rocket.name}`,
        activeTab: 'rockets',
        content,
      }),
      400,
      { 'Content-Type': 'text/html; charset=utf-8' },
    )
  }

  const rawStatus = parseOptionalString(body.status) || rocket.status
  const status: ValidStatus = VALID_STATUSES.includes(rawStatus as any)
    ? (rawStatus as ValidStatus)
    : (rocket.status as ValidStatus)

  await db
    .update(schema.rockets)
    .set({
      name,
      status,
      updatedAt: Date.now(),
    })
    .where(eq(schema.rockets.id, id))

  return c.redirect(`/rockets/${id}`, 303)
})

/**
 * GET /rockets/:id/configurations/new
 * Renders form to add configuration snapshot v(N+1), pre-populated with previous
 * version values.
 */
rocketsRouter.get('/:id/configurations/new', async (c) => {
  const { id } = c.req.param()
  const db = drizzle(c.env.DB, { schema })

  const [rocket] = await db
    .select()
    .from(schema.rockets)
    .where(and(eq(schema.rockets.id, id), isNull(schema.rockets.deletedAt)))

  if (!rocket) {
    return c.text('Rocket not found', 404)
  }

  // Retrieve existing configurations to find active or latest snapshot
  const existingConfigs = await db
    .select()
    .from(schema.rocketConfigurations)
    .where(
      and(
        eq(schema.rocketConfigurations.rocketId, id),
        isNull(schema.rocketConfigurations.deletedAt),
      ),
    )
    .orderBy(desc(schema.rocketConfigurations.version))

  const previousConfig = existingConfigs.find((c) => c.isCurrent) || existingConfigs[0] || null

  const content = newConfigFormView(rocket, previousConfig)

  const fullHtml = pageLayout({
    title: `New Configuration Snapshot — ${rocket.name}`,
    activeTab: 'rockets',
    content,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
})

/**
 * POST /rockets/:id/configurations
 * Appends new version (version = max(version) + 1), sets previous configs is_current = 0,
 * new config is_current = 1. Redirects to /rockets/:id.
 */
rocketsRouter.post('/:id/configurations', async (c) => {
  const { id } = c.req.param()
  const db = drizzle(c.env.DB, { schema })
  const flyer = await getActiveFlyer(db)

  const [rocket] = await db
    .select()
    .from(schema.rockets)
    .where(and(eq(schema.rockets.id, id), isNull(schema.rockets.deletedAt)))

  if (!rocket) {
    return c.text('Rocket not found', 404)
  }

  const body = await c.req.parseBody()

  // Determine next version number
  const existingConfigs = await db
    .select()
    .from(schema.rocketConfigurations)
    .where(
      and(
        eq(schema.rocketConfigurations.rocketId, id),
        isNull(schema.rocketConfigurations.deletedAt),
      ),
    )

  const maxVersion = existingConfigs.reduce((max, cfg) => Math.max(max, cfg.version), 0)
  const requestedVersion = parseOptionalNumber(body.version)

  let nextVersion: number
  if (existingConfigs.length === 0) {
    nextVersion = requestedVersion && requestedVersion >= 1 ? requestedVersion : 1
  } else if (requestedVersion && requestedVersion > maxVersion) {
    nextVersion = requestedVersion
  } else {
    nextVersion = maxVersion + 1
  }

  // Deactivate all previous configuration snapshots for this rocket
  await db
    .update(schema.rocketConfigurations)
    .set({ isCurrent: false })
    .where(eq(schema.rocketConfigurations.rocketId, id))

  // Extract new snapshot parameters
  const airframeMaterial = parseOptionalString(body.airframe_material ?? body.airframeMaterial)
  const finCount = parseOptionalNumber(body.fin_count ?? body.finCount)
  const dryMassG = parseOptionalNumber(body.dry_mass_g ?? body.dryMassG)
  const loadedMassG = parseOptionalNumber(body.loaded_mass_g ?? body.loadedMassG)
  const ballastG = parseOptionalNumber(body.ballast_g ?? body.ballastG)
  const cgMm = parseOptionalNumber(body.cg_mm ?? body.cgMm)
  const cpMm = parseOptionalNumber(body.cp_mm ?? body.cpMm)
  const stabilityCalibers = parseOptionalNumber(body.stability_calibers ?? body.stabilityCalibers)

  const rawRecovery = parseOptionalString(body.recovery_type ?? body.recoveryType)
  const recoveryType: ValidRecovery | null = VALID_RECOVERY_TYPES.includes(rawRecovery as any)
    ? (rawRecovery as ValidRecovery)
    : rawRecovery
      ? 'parachute'
      : null

  const parachuteSizeMm = parseOptionalNumber(body.parachute_size_mm ?? body.parachuteSizeMm)
  const motorMountDiameterMm = parseOptionalNumber(
    body.motor_mount_diameter_mm ?? body.motorMountDiameterMm,
  )

  // Insert new configuration snapshot with isCurrent = true
  await db.insert(schema.rocketConfigurations).values({
    rocketId: id,
    version: nextVersion,
    airframeMaterial,
    finCount,
    dryMassG,
    loadedMassG,
    ballastG,
    cgMm,
    cpMm,
    stabilityCalibers,
    recoveryType,
    parachuteSizeMm,
    motorMountDiameterMm,
    isCurrent: true,
    createdBy: flyer.id,
  })

  return c.redirect(`/rockets/${id}`, 303)
})

/**
 * POST /rockets/:id/configurations/:configId/set-current
 * Switches the active configuration snapshot for this rocket.
 */
rocketsRouter.post('/:id/configurations/:configId/set-current', async (c) => {
  const { id, configId } = c.req.param()
  const db = drizzle(c.env.DB, { schema })

  const [targetConfig] = await db
    .select()
    .from(schema.rocketConfigurations)
    .where(
      and(
        eq(schema.rocketConfigurations.id, configId),
        eq(schema.rocketConfigurations.rocketId, id),
        isNull(schema.rocketConfigurations.deletedAt),
      ),
    )

  if (!targetConfig) {
    return c.text('Configuration snapshot not found', 404)
  }

  // Deactivate all snapshots for this rocket
  await db
    .update(schema.rocketConfigurations)
    .set({ isCurrent: false })
    .where(eq(schema.rocketConfigurations.rocketId, id))

  // Activate target configuration
  await db
    .update(schema.rocketConfigurations)
    .set({ isCurrent: true })
    .where(eq(schema.rocketConfigurations.id, configId))

  return c.redirect(`/rockets/${id}`, 303)
})
