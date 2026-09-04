/**
 * Flight logging and preflight range companion routes for TripleT-Rocketry.
 *
 * Implements Milestone 5 endpoints:
 * - GET /flights: Logbook listing with outcome badges and soft-gate safety indicators.
 * - GET /flights/new: Preflight flight creation form.
 * - POST /flights/preflight-check: Dynamic HTMX soft-gate evaluator.
 * - POST /flights: Flight record persistence, soft-gate enforcement (422 if unacknowledged),
 *                  and atomic motor inventory decrement.
 * - GET /flights/:id: Complete flight logbook view with telemetry, hardware, and safety record.
 */

import { Hono } from 'hono'
import { desc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { getActiveFlyer } from '../db/context'
import { evaluateSoftGates } from '../services/soft_gates'
import type { TraceContext } from '../logging'
import {
  flightDetailView,
  flightsListView,
  preflightFormView,
  preflightWarningFragment,
  type FlightListItem,
} from '../views/flights'
import { pageLayout } from '../views/layout'

type Bindings = {
  DB: D1Database
  ENVIRONMENT: string
  PROJECT_ID: string
}

type Variables = {
  trace: TraceContext
}

export const flightsRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>()

/**
 * GET /flights — Flight Logbook List View
 */
flightsRouter.get('/', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const activeFlyer = (c.get as any)('user') || (await getActiveFlyer(db))

  const flightRows = await db
    .select({
      id: schema.flights.id,
      flightNumber: schema.flights.flightNumber,
      flownAt: schema.flights.flownAt,
      altitudeAglM: schema.flights.altitudeAglM,
      maxVelocityMps: schema.flights.maxVelocityMps,
      outcome: schema.flights.outcome,
      softGateWarnings: schema.flights.softGateWarnings,
      proceededDespiteWarnings: schema.flights.proceededDespiteWarnings,
      rocketName: schema.rockets.name,
      configVersion: schema.rocketConfigurations.version,
      motorMfr: schema.motors.manufacturer,
      motorModel: schema.motors.model,
      siteName: schema.launchSites.name,
      eventName: schema.launchEvents.name,
    })
    .from(schema.flights)
    .leftJoin(
      schema.rocketConfigurations,
      eq(schema.flights.rocketConfigurationId, schema.rocketConfigurations.id),
    )
    .leftJoin(
      schema.rockets,
      eq(schema.rocketConfigurations.rocketId, schema.rockets.id),
    )
    .leftJoin(
      schema.motors,
      eq(schema.flights.motorId, schema.motors.id),
    )
    .leftJoin(
      schema.launchSites,
      eq(schema.flights.launchSiteId, schema.launchSites.id),
    )
    .leftJoin(
      schema.launchEvents,
      eq(schema.flights.launchEventId, schema.launchEvents.id),
    )
    .orderBy(desc(schema.flights.flownAt), desc(schema.flights.createdAt))

  const flights: FlightListItem[] = flightRows.map((f) => ({
    id: f.id,
    flightNumber: f.flightNumber,
    flownAt: f.flownAt,
    altitudeAglM: f.altitudeAglM,
    maxVelocityMps: f.maxVelocityMps,
    outcome: f.outcome,
    rocketName: f.rocketName || null,
    configVersion: f.configVersion || null,
    motorMfr: f.motorMfr || null,
    motorModel: f.motorModel || null,
    softGateWarnings: (f.softGateWarnings as string[] | null) || [],
    proceededDespiteWarnings: Boolean(f.proceededDespiteWarnings),
    siteName: f.siteName || null,
    eventName: f.eventName || null,
  }))

  const content = flightsListView(flights)
  const fullHtml = pageLayout({
    title: 'Flight Logbook',
    activeTab: 'flights',
    content,
    user: activeFlyer,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
})

/**
 * GET /flights/new — Flight Creation & Preflight Form
 */
flightsRouter.get('/new', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const activeFlyer = await getActiveFlyer(db)

  const [rockets, configurations, motors, inventoryRows, launchSites, launchEvents] =
    await Promise.all([
      db.select({ id: schema.rockets.id, name: schema.rockets.name }).from(schema.rockets),
      db
        .select({
          id: schema.rocketConfigurations.id,
          rocketId: schema.rocketConfigurations.rocketId,
          version: schema.rocketConfigurations.version,
          stabilityCalibers: schema.rocketConfigurations.stabilityCalibers,
          dryMassG: schema.rocketConfigurations.dryMassG,
          loadedMassG: schema.rocketConfigurations.loadedMassG,
        })
        .from(schema.rocketConfigurations),
      db
        .select({
          id: schema.motors.id,
          manufacturer: schema.motors.manufacturer,
          model: schema.motors.model,
          impulseClass: schema.motors.impulseClass,
          delayS: schema.motors.delayS,
        })
        .from(schema.motors)
        .orderBy(schema.motors.manufacturer, schema.motors.model),
      db
        .select({
          id: schema.motorInventories.id,
          motorId: schema.motorInventories.motorId,
          quantityOnHand: schema.motorInventories.quantityOnHand,
          expendedCount: schema.motorInventories.expendedCount,
          motorModel: schema.motors.model,
          motorMfr: schema.motors.manufacturer,
        })
        .from(schema.motorInventories)
        .leftJoin(schema.motors, eq(schema.motorInventories.motorId, schema.motors.id))
        .where(eq(schema.motorInventories.userId, activeFlyer.id)),
      db
        .select({
          id: schema.launchSites.id,
          name: schema.launchSites.name,
          maxAltitudeAglM: schema.launchSites.maxAltitudeAglM,
        })
        .from(schema.launchSites)
        .orderBy(schema.launchSites.name),
      db
        .select({
          id: schema.launchEvents.id,
          name: schema.launchEvents.name,
          launchSiteId: schema.launchEvents.launchSiteId,
        })
        .from(schema.launchEvents)
        .orderBy(schema.launchEvents.name),
    ])

  const inventories = inventoryRows.map((inv) => ({
    id: inv.id,
    motorId: inv.motorId,
    quantityOnHand: inv.quantityOnHand,
    expendedCount: inv.expendedCount,
    motorModel: inv.motorMfr && inv.motorModel ? `${inv.motorMfr} ${inv.motorModel}` : inv.motorModel,
  }))

  const content = preflightFormView({
    rockets,
    configurations,
    motors,
    inventories,
    launchSites,
    launchEvents,
    flyerCertLevel: activeFlyer.maxCertLevel,
  })

  const fullHtml = pageLayout({
    title: 'Log Flight',
    activeTab: 'flights',
    content,
    user: activeFlyer,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
})

/**
 * POST /flights/preflight-check — Dynamic HTMX Soft-Gate Evaluator
 */
flightsRouter.post('/preflight-check', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const body = await c.req.parseBody()

  // 1. Flyer certification level
  const flyerId = body['flyer_id'] ? String(body['flyer_id']).trim() : null
  let flyerCertLevel = 0

  if (flyerId) {
    const certs = await db
      .select()
      .from(schema.certifications)
      .where(eq(schema.certifications.userId, flyerId))
    for (const cert of certs) {
      if (typeof cert.level === 'number' && cert.level > flyerCertLevel) {
        flyerCertLevel = cert.level
      }
    }
  } else {
    const activeFlyer = await getActiveFlyer(db)
    flyerCertLevel = activeFlyer.maxCertLevel
  }

  // 2. Rocket configuration stability
  const rocketConfigId = body['rocket_configuration_id']
    ? String(body['rocket_configuration_id']).trim()
    : null
  let stabilityCalibers: number | null = null
  if (rocketConfigId) {
    const [cfg] = await db
      .select({ stabilityCalibers: schema.rocketConfigurations.stabilityCalibers })
      .from(schema.rocketConfigurations)
      .where(eq(schema.rocketConfigurations.id, rocketConfigId))
    if (cfg && cfg.stabilityCalibers !== null && cfg.stabilityCalibers !== undefined) {
      stabilityCalibers = Number(cfg.stabilityCalibers)
    }
  }

  // 3. Motor impulse class
  const motorId = body['motor_id'] ? String(body['motor_id']).trim() : null
  let motorImpulseClass: string | null = null
  let motorLabel: string | null = null
  if (motorId) {
    const [m] = await db
      .select({
        impulseClass: schema.motors.impulseClass,
        manufacturer: schema.motors.manufacturer,
        model: schema.motors.model,
      })
      .from(schema.motors)
      .where(eq(schema.motors.id, motorId))
    if (m) {
      motorImpulseClass = m.impulseClass ?? null
      motorLabel = `${m.manufacturer} ${m.model}`
    }
  }

  // 4. Launch site waiver ceiling
  const launchSiteId = body['launch_site_id'] ? String(body['launch_site_id']).trim() : null
  let siteMaxAltitudeM: number | null = null
  let siteName: string | null = null
  if (launchSiteId) {
    const [s] = await db
      .select({
        maxAltitudeAglM: schema.launchSites.maxAltitudeAglM,
        name: schema.launchSites.name,
      })
      .from(schema.launchSites)
      .where(eq(schema.launchSites.id, launchSiteId))
    if (s) {
      siteMaxAltitudeM = s.maxAltitudeAglM !== null && s.maxAltitudeAglM !== undefined ? Number(s.maxAltitudeAglM) : null
      siteName = s.name ?? null
    }
  }

  // 5. Expected / target altitude
  const altRaw = body['expected_altitude_m'] ?? body['altitude_agl_m']
  const expectedAltitudeM =
    altRaw !== undefined && altRaw !== null && altRaw !== '' && !isNaN(Number(altRaw))
      ? Number(altRaw)
      : null

  // Evaluate pure domain soft-gate rules
  const warnings = evaluateSoftGates({
    flyerCertLevel,
    motorImpulseClass,
    motorLabel,
    stabilityCalibers,
    expectedAltitudeM,
    siteMaxAltitudeM,
    siteName,
  })

  const fragment = preflightWarningFragment(warnings)
  return c.html(fragment, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
})

/**
 * POST /flights — Flight Creation & Override Persistence
 */
flightsRouter.post('/', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const activeFlyer = await getActiveFlyer(db)
  const body = await c.req.parseBody()

  // Flyer identity
  const flyerId = body['flyer_id'] ? String(body['flyer_id']).trim() : activeFlyer.id

  // Form field extractions
  const rocketConfigId = body['rocket_configuration_id']
    ? String(body['rocket_configuration_id']).trim()
    : null
  const motorId = body['motor_id'] ? String(body['motor_id']).trim() : null
  const motorInventoryId = body['motor_inventory_id']
    ? String(body['motor_inventory_id']).trim()
    : null
  const launchSiteId = body['launch_site_id'] ? String(body['launch_site_id']).trim() : null
  const launchEventId = body['launch_event_id'] ? String(body['launch_event_id']).trim() : null

  const altitudeAglM =
    body['altitude_agl_m'] !== undefined && body['altitude_agl_m'] !== '' && !isNaN(Number(body['altitude_agl_m']))
      ? Number(body['altitude_agl_m'])
      : null
  const expectedAltitudeM =
    body['expected_altitude_m'] !== undefined &&
    body['expected_altitude_m'] !== '' &&
    !isNaN(Number(body['expected_altitude_m']))
      ? Number(body['expected_altitude_m'])
      : altitudeAglM

  const altitudeMslM =
    body['altitude_msl_m'] !== undefined && body['altitude_msl_m'] !== '' && !isNaN(Number(body['altitude_msl_m']))
      ? Number(body['altitude_msl_m'])
      : null
  const maxVelocityMps =
    body['max_velocity_mps'] !== undefined && body['max_velocity_mps'] !== '' && !isNaN(Number(body['max_velocity_mps']))
      ? Number(body['max_velocity_mps'])
      : null
  const maxAccelG =
    body['max_accel_g'] !== undefined && body['max_accel_g'] !== '' && !isNaN(Number(body['max_accel_g']))
      ? Number(body['max_accel_g'])
      : null
  const flightNumber =
    body['flight_number'] !== undefined && body['flight_number'] !== '' && !isNaN(Number(body['flight_number']))
      ? parseInt(String(body['flight_number']), 10)
      : null

  const windMps =
    body['wind_mps'] !== undefined && body['wind_mps'] !== '' && !isNaN(Number(body['wind_mps']))
      ? Number(body['wind_mps'])
      : null
  const windDirDeg =
    body['wind_dir_deg'] !== undefined && body['wind_dir_deg'] !== '' && !isNaN(Number(body['wind_dir_deg']))
      ? Number(body['wind_dir_deg'])
      : null
  const temperatureC =
    body['temperature_c'] !== undefined && body['temperature_c'] !== '' && !isNaN(Number(body['temperature_c']))
      ? Number(body['temperature_c'])
      : null
  const visibilityM =
    body['visibility_m'] !== undefined && body['visibility_m'] !== '' && !isNaN(Number(body['visibility_m']))
      ? Number(body['visibility_m'])
      : null
  const ceilingM =
    body['ceiling_m'] !== undefined && body['ceiling_m'] !== '' && !isNaN(Number(body['ceiling_m']))
      ? Number(body['ceiling_m'])
      : null

  const outcome = (body['outcome'] as any) || 'successful'
  const notes = body['notes'] ? String(body['notes']) : null

  let flownAt = Date.now()
  if (body['flown_at']) {
    const parsedTime = Number(body['flown_at'])
    if (!isNaN(parsedTime)) {
      flownAt = parsedTime
    } else {
      const dateParsed = new Date(String(body['flown_at'])).getTime()
      if (!isNaN(dateParsed)) {
        flownAt = dateParsed
      }
    }
  }

  // Soft-gate safety evaluation
  let warnings: string[] = []

  // Check if warnings were pre-serialized in form
  if (body['soft_gate_warnings']) {
    try {
      const parsed = JSON.parse(String(body['soft_gate_warnings']))
      if (Array.isArray(parsed)) {
        warnings = parsed
      }
    } catch {
      // ignore parse failure and evaluate server-side
    }
  }

  // Always verify/evaluate server-side against live entities
  let flyerCertLevel = 0
  if (flyerId) {
    const certs = await db
      .select()
      .from(schema.certifications)
      .where(eq(schema.certifications.userId, flyerId))
    for (const cert of certs) {
      if (typeof cert.level === 'number' && cert.level > flyerCertLevel) {
        flyerCertLevel = cert.level
      }
    }
  }

  let stabilityCalibers: number | null = null
  if (rocketConfigId) {
    const [cfg] = await db
      .select({ stabilityCalibers: schema.rocketConfigurations.stabilityCalibers })
      .from(schema.rocketConfigurations)
      .where(eq(schema.rocketConfigurations.id, rocketConfigId))
    if (cfg && cfg.stabilityCalibers !== null && cfg.stabilityCalibers !== undefined) {
      stabilityCalibers = Number(cfg.stabilityCalibers)
    }
  }

  let motorImpulseClass: string | null = null
  let motorLabel: string | null = null
  if (motorId) {
    const [m] = await db
      .select({
        impulseClass: schema.motors.impulseClass,
        manufacturer: schema.motors.manufacturer,
        model: schema.motors.model,
      })
      .from(schema.motors)
      .where(eq(schema.motors.id, motorId))
    if (m) {
      motorImpulseClass = m.impulseClass ?? null
      motorLabel = `${m.manufacturer} ${m.model}`
    }
  }

  let siteMaxAltitudeM: number | null = null
  let siteName: string | null = null
  if (launchSiteId) {
    const [s] = await db
      .select({
        maxAltitudeAglM: schema.launchSites.maxAltitudeAglM,
        name: schema.launchSites.name,
      })
      .from(schema.launchSites)
      .where(eq(schema.launchSites.id, launchSiteId))
    if (s) {
      siteMaxAltitudeM = s.maxAltitudeAglM !== null && s.maxAltitudeAglM !== undefined ? Number(s.maxAltitudeAglM) : null
      siteName = s.name ?? null
    }
  }

  const serverWarnings = evaluateSoftGates({
    flyerCertLevel,
    motorImpulseClass,
    motorLabel,
    stabilityCalibers,
    expectedAltitudeM,
    siteMaxAltitudeM,
    siteName,
  })

  // Combine unique warnings
  const mergedWarnings = Array.from(new Set([...warnings, ...serverWarnings]))

  // Check user acknowledgment checkbox
  const proceededRaw = body['proceeded_despite_warnings']
  const isProceeded =
    proceededRaw === 'true' ||
    proceededRaw === '1' ||
    proceededRaw === 'on' ||
    proceededRaw === 'yes'

  // If warnings triggered and NOT acknowledged: return 422 Unprocessable Entity
  if (mergedWarnings.length > 0 && !isProceeded) {
    const [rockets, configurations, motors, inventoryRows, launchSites, launchEvents] =
      await Promise.all([
        db.select({ id: schema.rockets.id, name: schema.rockets.name }).from(schema.rockets),
        db
          .select({
            id: schema.rocketConfigurations.id,
            rocketId: schema.rocketConfigurations.rocketId,
            version: schema.rocketConfigurations.version,
            stabilityCalibers: schema.rocketConfigurations.stabilityCalibers,
            dryMassG: schema.rocketConfigurations.dryMassG,
            loadedMassG: schema.rocketConfigurations.loadedMassG,
          })
          .from(schema.rocketConfigurations),
        db
          .select({
            id: schema.motors.id,
            manufacturer: schema.motors.manufacturer,
            model: schema.motors.model,
            impulseClass: schema.motors.impulseClass,
            delayS: schema.motors.delayS,
          })
          .from(schema.motors)
          .orderBy(schema.motors.manufacturer, schema.motors.model),
        db
          .select({
            id: schema.motorInventories.id,
            motorId: schema.motorInventories.motorId,
            quantityOnHand: schema.motorInventories.quantityOnHand,
            expendedCount: schema.motorInventories.expendedCount,
            motorModel: schema.motors.model,
            motorMfr: schema.motors.manufacturer,
          })
          .from(schema.motorInventories)
          .leftJoin(schema.motors, eq(schema.motorInventories.motorId, schema.motors.id))
          .where(eq(schema.motorInventories.userId, activeFlyer.id)),
        db
          .select({
            id: schema.launchSites.id,
            name: schema.launchSites.name,
            maxAltitudeAglM: schema.launchSites.maxAltitudeAglM,
          })
          .from(schema.launchSites)
          .orderBy(schema.launchSites.name),
        db
          .select({
            id: schema.launchEvents.id,
            name: schema.launchEvents.name,
            launchSiteId: schema.launchEvents.launchSiteId,
          })
          .from(schema.launchEvents)
          .orderBy(schema.launchEvents.name),
      ])

    const inventories = inventoryRows.map((inv) => ({
      id: inv.id,
      motorId: inv.motorId,
      quantityOnHand: inv.quantityOnHand,
      expendedCount: inv.expendedCount,
      motorModel: inv.motorMfr && inv.motorModel ? `${inv.motorMfr} ${inv.motorModel}` : inv.motorModel,
    }))

    const content = preflightFormView({
      rockets,
      configurations,
      motors,
      inventories,
      launchSites,
      launchEvents,
      flyerCertLevel,
      initialValues: body,
      warnings: mergedWarnings,
      error: 'Preflight safety warnings require explicit pilot confirmation before logging.',
    })

    const fullHtml = pageLayout({
      title: 'Preflight Safety Warnings',
      activeTab: 'flights',
      content,
      user: (c.get as any)('user') || null,
    })

    return c.html(fullHtml, 422, {
      'Content-Type': 'text/html; charset=utf-8',
    })
  }

  // Insert flight record
  const flightId = crypto.randomUUID()
  const [newFlight] = await db
    .insert(schema.flights)
    .values({
      id: flightId,
      flyerId,
      rocketConfigurationId: rocketConfigId,
      motorId,
      motorInventoryId,
      launchSiteId,
      launchEventId,
      flightNumber,
      flownAt,
      altitudeAglM,
      altitudeMslM,
      maxVelocityMps,
      maxAccelG,
      windMps,
      windDirDeg,
      temperatureC,
      visibilityM,
      ceilingM,
      outcome,
      notes,
      softGateWarnings: mergedWarnings,
      proceededDespiteWarnings: mergedWarnings.length > 0 && isProceeded,
    })
    .returning()

  // Atomically decrement motor inventory if an inventory item was selected
  if (motorInventoryId) {
    await db
      .update(schema.motorInventories)
      .set({
        quantityOnHand: sql`max(0, ${schema.motorInventories.quantityOnHand} - 1)`,
        expendedCount: sql`${schema.motorInventories.expendedCount} + 1`,
      })
      .where(eq(schema.motorInventories.id, motorInventoryId))
  }

  return c.redirect(`/flights/${newFlight.id}`, 303)
})

/**
 * GET /flights/:id — Flight Detail View
 */
flightsRouter.get('/:id', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const flightId = c.req.param('id')

  const [flight] = await db
    .select()
    .from(schema.flights)
    .where(eq(schema.flights.id, flightId))

  if (!flight) {
    const errorHtml = pageLayout({
      title: 'Flight Not Found',
      activeTab: 'flights',
      content: preflightWarningFragment(['The requested flight log does not exist or has been removed.']),
    })
    return c.html(errorHtml, 404, {
      'Content-Type': 'text/html; charset=utf-8',
    })
  }

  const [flyer, config, motor, site, event] = await Promise.all([
    flight.flyerId
      ? db
          .select({
            id: schema.users.id,
            displayName: schema.users.displayName,
            email: schema.users.email,
          })
          .from(schema.users)
          .where(eq(schema.users.id, flight.flyerId))
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    flight.rocketConfigurationId
      ? db
          .select()
          .from(schema.rocketConfigurations)
          .where(eq(schema.rocketConfigurations.id, flight.rocketConfigurationId))
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    flight.motorId
      ? db
          .select()
          .from(schema.motors)
          .where(eq(schema.motors.id, flight.motorId))
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    flight.launchSiteId
      ? db
          .select()
          .from(schema.launchSites)
          .where(eq(schema.launchSites.id, flight.launchSiteId))
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    flight.launchEventId
      ? db
          .select()
          .from(schema.launchEvents)
          .where(eq(schema.launchEvents.id, flight.launchEventId))
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ])

  let rocket: { id: string; name: string; status: string | null } | null = null
  if (config?.rocketId) {
    const [r] = await db
      .select({
        id: schema.rockets.id,
        name: schema.rockets.name,
        status: schema.rockets.status,
      })
      .from(schema.rockets)
      .where(eq(schema.rockets.id, config.rocketId))
    rocket = r ?? null
  }

  const content = flightDetailView({
    flight: {
      ...flight,
      softGateWarnings: (flight.softGateWarnings as string[] | null) || [],
      proceededDespiteWarnings: Boolean(flight.proceededDespiteWarnings),
    },
    config,
    rocket,
    motor,
    site,
    event,
    flyer,
  })

  const title = rocket ? `${rocket.name} — Flight #${flight.flightNumber || 1}` : 'Flight Details'
  const fullHtml = pageLayout({
    title,
    activeTab: 'flights',
    content,
    user: (c.get as any)('user') || flyer,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
})
