/**
 * Dashboard route handler (GET /).
 *
 * Retrieves aggregate statistics (flight totals, active rocket counts, motor
 * stock on hand, nominal mission success rate) and recent flight records from D1,
 * then renders the dashboard view inside the base page layout.
 */

import { Hono } from 'hono'
import { count, desc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { getActiveFlyer } from '../db/context'
import type { TraceContext } from '../logging'
import { dashboardView, type RecentFlightItem } from '../views/dashboard'
import { pageLayout } from '../views/layout'

type Bindings = {
  DB: D1Database
  ENVIRONMENT: string
  PROJECT_ID: string
}

type Variables = {
  trace: TraceContext
}

export const dashboardRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>()

dashboardRouter.get('/', async (c) => {
  const db = drizzle(c.env.DB, { schema })

  // Ensure active flyer exists / is auto-seeded
  await getActiveFlyer(db)

  // 1. Total flights count
  const [flightCountResult] = await db
    .select({ count: count() })
    .from(schema.flights)
  const totalFlights = flightCountResult?.count ?? 0

  // 2. Active rockets count (status = flight_ready)
  const [rocketCountResult] = await db
    .select({ count: count() })
    .from(schema.rockets)
    .where(eq(schema.rockets.status, 'flight_ready'))
  const activeRockets = rocketCountResult?.count ?? 0

  // 3. Motor inventory total units on hand
  const [motorStockResult] = await db
    .select({
      total: sql<number>`coalesce(sum(${schema.motorInventories.quantityOnHand}), 0)`,
    })
    .from(schema.motorInventories)
  const motorStockOnHand = Number(motorStockResult?.total ?? 0)

  // 4. Mission success rate
  let successRatePercent: number | null = null
  if (totalFlights > 0) {
    const [successfulFlightsResult] = await db
      .select({ count: count() })
      .from(schema.flights)
      .where(eq(schema.flights.outcome, 'successful'))
    const successfulFlights = successfulFlightsResult?.count ?? 0
    successRatePercent = Math.round((successfulFlights / totalFlights) * 100)
  }

  // 5. Recent flights (latest 5)
  const recentFlightsRows = await db
    .select({
      id: schema.flights.id,
      flightNumber: schema.flights.flightNumber,
      flownAt: schema.flights.flownAt,
      altitudeAglM: schema.flights.altitudeAglM,
      outcome: schema.flights.outcome,
      softGateWarnings: schema.flights.softGateWarnings,
      proceededDespiteWarnings: schema.flights.proceededDespiteWarnings,
      rocketName: schema.rockets.name,
      motorMfr: schema.motors.manufacturer,
      motorModel: schema.motors.model,
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
    .orderBy(desc(schema.flights.flownAt), desc(schema.flights.createdAt))
    .limit(5)

  const recentFlights: RecentFlightItem[] = recentFlightsRows.map((f) => {
    const warnings = (f.softGateWarnings as string[] | null) || []
    return {
      id: f.id,
      flightNumber: f.flightNumber,
      flownAt: f.flownAt,
      altitudeAglM: f.altitudeAglM,
      outcome: f.outcome,
      rocketName: f.rocketName || null,
      motorName:
        f.motorMfr && f.motorModel
          ? `${f.motorMfr} ${f.motorModel}`
          : f.motorModel || null,
      hasWarnings: warnings.length > 0 || Boolean(f.proceededDespiteWarnings),
      warningCount: warnings.length,
    }
  })

  const content = dashboardView({
    totalFlights,
    activeRockets,
    motorStockOnHand,
    successRatePercent,
    recentFlights,
  })

  const user = (c.get as any)('user') || null
  const fullHtml = pageLayout({
    title: 'Dashboard',
    activeTab: 'dashboard',
    content,
    user,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
})
