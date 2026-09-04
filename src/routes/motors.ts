/**
 * Motor Catalog Routes (`src/routes/motors.ts`).
 *
 * Implements:
 * - `GET /motors`: Filterable motor catalog browser with user inventory stock counts.
 * - `GET /motors/:id`: Detailed engineering and certification specs view.
 * - `POST /inventory/:id/adjust`: Inline HTMX stock adjustment endpoint (cross-mounted per PROJECT.md).
 */

import { Hono } from 'hono'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { html } from 'hono/html'
import * as schema from '../db/schema'
import { getActiveFlyer } from '../db/context'
import type { TraceContext } from '../logging'
import { motorCatalogView, motorDetailView } from '../views/motors'
import { pageLayout } from '../views/layout'
import { adjustInventoryHandler } from './inventory'

type Bindings = {
  DB: D1Database
  ENVIRONMENT: string
  PROJECT_ID: string
}

type Variables = {
  trace: TraceContext
}

export const motorsRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>()

/**
 * Motor Catalog Listing Handler.
 * Supports filtering by `?impulse_class=...`.
 * Joins/maps active flyer's inventory stock on hand and expended counts.
 */
async function listMotorsHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user') || (await getActiveFlyer(db))

  const rawImpulseClass = c.req.query('impulse_class') || c.req.query('class') || null
  const impulseClassFilter = rawImpulseClass ? rawImpulseClass.toUpperCase().trim() : null

  let motorsList: (typeof schema.motors.$inferSelect)[] = []

  if (impulseClassFilter && impulseClassFilter !== 'ALL') {
    motorsList = await db
      .select()
      .from(schema.motors)
      .where(
        and(
          eq(schema.motors.impulseClass, impulseClassFilter as any),
          isNull(schema.motors.deletedAt),
        ),
      )
      .orderBy(
        asc(schema.motors.impulseClass),
        asc(schema.motors.totalImpulseNs),
        asc(schema.motors.model),
      )
  } else {
    motorsList = await db
      .select()
      .from(schema.motors)
      .where(isNull(schema.motors.deletedAt))
      .orderBy(
        asc(schema.motors.impulseClass),
        asc(schema.motors.totalImpulseNs),
        asc(schema.motors.model),
      )
  }

  // Retrieve active user's inventory records
  const inventoryRows = await db
    .select()
    .from(schema.motorInventories)
    .where(
      and(
        eq(schema.motorInventories.userId, flyer.id),
        isNull(schema.motorInventories.deletedAt),
      ),
    )

  const userInventoryMap: Record<
    string,
    { quantityOnHand: number; expendedCount: number; id: string }
  > = {}

  for (const inv of inventoryRows) {
    userInventoryMap[inv.motorId] = {
      quantityOnHand: inv.quantityOnHand,
      expendedCount: inv.expendedCount,
      id: inv.id,
    }
  }

  const content = motorCatalogView(motorsList, impulseClassFilter, userInventoryMap)

  const fullHtml = pageLayout({
    title: 'Motor Catalog',
    activeTab: 'motors',
    content,
    user: flyer,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
}

/**
 * Motor Detail Specs View Handler.
 */
async function getMotorDetailHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const id = c.req.param('id')

  const [motor] = await db
    .select()
    .from(schema.motors)
    .where(and(eq(schema.motors.id, id), isNull(schema.motors.deletedAt)))
    .limit(1)

  if (!motor) {
    const notFoundContent = html`
      <div class="py-16 text-center">
        <span class="text-6xl mb-4 block">🔍</span>
        <h1 class="text-2xl font-bold text-white">Motor Not Found</h1>
        <p class="mt-2 text-slate-400">The requested motor catalog entry could not be found.</p>
        <div class="mt-6">
          <a
            href="/motors"
            class="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 text-slate-950 font-semibold text-sm transition-colors"
          >
            Return to Motor Catalog
          </a>
        </div>
      </div>
    `
    const notFoundPage = pageLayout({
      title: 'Motor Not Found',
      activeTab: 'motors',
      content: notFoundContent,
    })
    return c.html(notFoundPage, 404, {
      'Content-Type': 'text/html; charset=utf-8',
    })
  }

  const flyer = (c.get as any)('user') || (await getActiveFlyer(db))

  // Query user inventory status for this specific motor
  const [inventoryItem] = await db
    .select()
    .from(schema.motorInventories)
    .where(
      and(
        eq(schema.motorInventories.userId, flyer.id),
        eq(schema.motorInventories.motorId, motor.id),
        isNull(schema.motorInventories.deletedAt),
      ),
    )
    .limit(1)

  const content = motorDetailView(motor, inventoryItem || null)

  const fullHtml = pageLayout({
    title: `${motor.manufacturer} ${motor.model} — Motor Specs`,
    activeTab: 'motors',
    content,
    user: flyer,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
}

// Catalog endpoints
motorsRouter.get('/', listMotorsHandler)
motorsRouter.get('/motors', listMotorsHandler)
motorsRouter.get('/motors/:id', getMotorDetailHandler)
motorsRouter.get('/:id', getMotorDetailHandler)

// Cross-route support for inventory adjustments per PROJECT.md
motorsRouter.post('/inventory/:id/adjust', adjustInventoryHandler)
motorsRouter.get('/inventory/:id/adjust', adjustInventoryHandler)

export default motorsRouter
