/**
 * Inventory & Regulatory Chain-of-Custody Router (`src/routes/inventory.ts`).
 *
 * Implements:
 * - `GET /inventory`: Unified hub for motor and component inventory with regulatory compliance stats.
 * - `POST /inventory`: Adds a catalog motor to user inventory.
 * - `POST /inventory/:id/adjust`: HTMX inline motor stock adjustment.
 * - `GET /inventory/components/new`: New component form (casings, recovery, avionics, pyros).
 * - `POST /inventory/components`: Adds non-motor component and logs initial custody receipt.
 * - `POST /inventory/components/:id/adjust`: HTMX inline component stock adjustment.
 * - `GET /inventory/transactions`: Full regulatory chain-of-custody audit ledger.
 * - `GET /inventory/transactions/new`: Form to log custody movements, transfers, sales, and disposals.
 * - `POST /inventory/transactions`: Records movement event with HPR transfer compliance verification.
 */

import { Hono } from 'hono'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { getActiveFlyer } from '../db/context'
import type { TraceContext } from '../logging'
import {
  inventoryRowFragment,
  type InventoryItemWithMotor,
} from '../views/motors'
import {
  inventoryHubView,
  addComponentFormView,
  editComponentFormView,
  custodyLedgerView,
  recordTransactionFormView,
  getCategoryBadgeClasses,
  getConditionBadgeClasses,
} from '../views/inventory'
import {
  calculateStorageSummary,
  evaluateTransferCompliance,
  type InventoryItemForStorage,
} from '../services/compliance'
import { pageLayout } from '../views/layout'
import { html } from 'hono/html'
import {
  storageSitesListView,
  storageSiteFormView,
  storageSiteDetailView,
  type StorageSite,
} from '../views/storage_sites'

type Bindings = {
  DB: D1Database
  ENVIRONMENT: string
  PROJECT_ID: string
}

type Variables = {
  trace: TraceContext
}

export const inventoryRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>()

/**
 * List User Inventory Hub (GET /inventory).
 */
export async function listInventoryHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user') || (await getActiveFlyer(db))
  const query = c.req.query()
  const filter = query.filter || 'all'

  // 1. Query Motors joined with catalog motors
  const motorRows = await db
    .select({
      id: schema.motorInventories.id,
      userId: schema.motorInventories.userId,
      motorId: schema.motorInventories.motorId,
      quantityOnHand: schema.motorInventories.quantityOnHand,
      expendedCount: schema.motorInventories.expendedCount,
      soldCount: schema.motorInventories.soldCount,
      disposedCount: schema.motorInventories.disposedCount,
      acquiredOn: schema.motorInventories.acquiredOn,
      purchasedOn: schema.motorInventories.purchasedOn,
      receivedOn: schema.motorInventories.receivedOn,
      batchLotNumber: schema.motorInventories.batchLotNumber,
      serialNumber: schema.motorInventories.serialNumber,
      storageLocation: schema.motorInventories.storageLocation,
      notes: schema.motorInventories.notes,
      createdAt: schema.motorInventories.createdAt,
      updatedAt: schema.motorInventories.updatedAt,
      createdBy: schema.motorInventories.createdBy,
      deletedAt: schema.motorInventories.deletedAt,
      motor: {
        id: schema.motors.id,
        manufacturer: schema.motors.manufacturer,
        model: schema.motors.model,
        impulseClass: schema.motors.impulseClass,
        totalImpulseNs: schema.motors.totalImpulseNs,
        averageThrustN: schema.motors.averageThrustN,
        burnTimeS: schema.motors.burnTimeS,
        delayS: schema.motors.delayS,
        diameterMm: schema.motors.diameterMm,
        propellantType: schema.motors.propellantType,
        casingReusable: schema.motors.casingReusable,
        hardware: schema.motors.hardware,
        weightG: schema.motors.weightG,
        propellantWeightG: schema.motors.propellantWeightG,
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
    .orderBy(
      asc(schema.motors.impulseClass),
      asc(schema.motors.totalImpulseNs),
      asc(schema.motors.model),
    )

  // 2. Query other components
  const componentRows = await db
    .select()
    .from(schema.components)
    .where(
      and(
        eq(schema.components.userId, flyer.id),
        isNull(schema.components.deletedAt),
      ),
    )
    .orderBy(asc(schema.components.category), asc(schema.components.name))

  // 3. Query recent custody transactions
  const transactionRows = await db
    .select({
      id: schema.inventoryTransactions.id,
      userId: schema.inventoryTransactions.userId,
      motorInventoryId: schema.inventoryTransactions.motorInventoryId,
      componentId: schema.inventoryTransactions.componentId,
      transactionType: schema.inventoryTransactions.transactionType,
      quantity: schema.inventoryTransactions.quantity,
      transactionDate: schema.inventoryTransactions.transactionDate,
      counterpartyName: schema.inventoryTransactions.counterpartyName,
      counterpartyCertNumber: schema.inventoryTransactions.counterpartyCertNumber,
      counterpartyLicense: schema.inventoryTransactions.counterpartyLicense,
      counterpartyContact: schema.inventoryTransactions.counterpartyContact,
      referenceId: schema.inventoryTransactions.referenceId,
      flightId: schema.inventoryTransactions.flightId,
      batchLotNumber: schema.inventoryTransactions.batchLotNumber,
      serialNumbers: schema.inventoryTransactions.serialNumbers,
      storageLocation: schema.inventoryTransactions.storageLocation,
      unitCost: schema.inventoryTransactions.unitCost,
      witnessName: schema.inventoryTransactions.witnessName,
      complianceNotes: schema.inventoryTransactions.complianceNotes,
      notes: schema.inventoryTransactions.notes,
      createdAt: schema.inventoryTransactions.createdAt,
      updatedAt: schema.inventoryTransactions.updatedAt,
      createdBy: schema.inventoryTransactions.createdBy,
      deletedAt: schema.inventoryTransactions.deletedAt,
      motor: {
        id: schema.motors.id,
        manufacturer: schema.motors.manufacturer,
        model: schema.motors.model,
        impulseClass: schema.motors.impulseClass,
      },
      component: {
        id: schema.components.id,
        name: schema.components.name,
        category: schema.components.category,
      },
    })
    .from(schema.inventoryTransactions)
    .leftJoin(
      schema.motorInventories,
      eq(schema.inventoryTransactions.motorInventoryId, schema.motorInventories.id),
    )
    .leftJoin(schema.motors, eq(schema.motorInventories.motorId, schema.motors.id))
    .leftJoin(
      schema.components,
      eq(schema.inventoryTransactions.componentId, schema.components.id),
    )
    .where(
      and(
        eq(schema.inventoryTransactions.userId, flyer.id),
        isNull(schema.inventoryTransactions.deletedAt),
      ),
    )
    .orderBy(desc(schema.inventoryTransactions.transactionDate), desc(schema.inventoryTransactions.createdAt))
    .limit(20)

  // 4. Calculate Storage & Compliance Summary
  const itemsForStorage: InventoryItemForStorage[] = [
    ...motorRows.map((m) => ({
      quantityOnHand: m.quantityOnHand,
      storageLocation: m.storageLocation,
      propellantMassG: m.motor?.propellantWeightG ?? m.motor?.weightG ?? 0,
      impulseClass: m.motor?.impulseClass,
      condition: 'new',
    })),
    ...componentRows.map((c) => ({
      quantityOnHand: c.quantityOnHand,
      storageLocation: c.storageLocation,
      propellantMassG: c.propellantMassG || 0,
      condition: c.condition,
      expirationDate: c.expirationDate,
    })),
  ]

  const userRegion: 'SA' | 'US' = (flyer as any)?.regulatoryRegion === 'US' ? 'US' : 'SA'
  const limitG = userRegion === 'US' ? 22680 : 3000
  const storageSummary = calculateStorageSummary(itemsForStorage, limitG, userRegion)

  const content = inventoryHubView({
    motors: motorRows,
    components: componentRows,
    transactions: transactionRows,
    storageSummary,
    activeFilter: filter,
    region: userRegion,
  })

  const fullHtml = pageLayout({
    title: 'Flight & Component Inventory',
    activeTab: 'inventory',
    content,
    user: flyer,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
}

/**
 * Add Motor to Inventory (POST /inventory).
 */
export async function addInventoryHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = await getActiveFlyer(db)

  let body: any = {}
  const contentType = c.req.header('content-type') || ''
  if (contentType.includes('application/json')) {
    body = await c.req.json().catch(() => ({}))
  } else {
    body = await c.req.parseBody().catch(() => ({}))
  }

  const motorId = String(body.motor_id || body.motorId || '').trim()
  const rawQty = body.quantity_on_hand || body.quantityOnHand
  const quantityToAdd = Math.max(1, parseInt(String(rawQty ?? 1), 10) || 1)
  const notes = body.notes ? String(body.notes).trim() : null
  const acquiredOn =
    body.acquired_on || body.acquiredOn
      ? String(body.acquired_on || body.acquiredOn).trim()
      : new Date().toISOString().slice(0, 10)
  const storageLocation = body.storage_location ? String(body.storage_location).trim() : 'Explosives Magazine 1'
  const batchLotNumber = body.batch_lot_number ? String(body.batch_lot_number).trim() : null

  if (!motorId) {
    return c.json({ error: 'Missing motor_id parameter' }, 400)
  }

  // Verify motor exists in catalog
  const [motor] = await db
    .select()
    .from(schema.motors)
    .where(and(eq(schema.motors.id, motorId), isNull(schema.motors.deletedAt)))
    .limit(1)

  if (!motor) {
    return c.json({ error: 'Motor not found in catalog' }, 404)
  }

  // Check if flyer already has an inventory entry for this motor
  const [existing] = await db
    .select()
    .from(schema.motorInventories)
    .where(
      and(
        eq(schema.motorInventories.userId, flyer.id),
        eq(schema.motorInventories.motorId, motorId),
        isNull(schema.motorInventories.deletedAt),
      ),
    )
    .limit(1)

  let motorInvId: string
  if (existing) {
    motorInvId = existing.id
    await db
      .update(schema.motorInventories)
      .set({
        quantityOnHand: existing.quantityOnHand + quantityToAdd,
        notes: notes || existing.notes,
        storageLocation: storageLocation || existing.storageLocation,
        batchLotNumber: batchLotNumber || existing.batchLotNumber,
        updatedAt: Date.now(),
      })
      .where(eq(schema.motorInventories.id, existing.id))
  } else {
    const [inserted] = await db
      .insert(schema.motorInventories)
      .values({
        userId: flyer.id,
        motorId,
        quantityOnHand: quantityToAdd,
        expendedCount: 0,
        acquiredOn,
        purchasedOn: acquiredOn,
        receivedOn: acquiredOn,
        storageLocation,
        batchLotNumber,
        notes,
      })
      .returning()
    motorInvId = inserted.id
  }

  // Log an automatic custody receipt record
  await db.insert(schema.inventoryTransactions).values({
    userId: flyer.id,
    motorInventoryId: motorInvId,
    transactionType: 'received',
    quantity: quantityToAdd,
    transactionDate: acquiredOn,
    storageLocation,
    batchLotNumber,
    notes: notes || `Stocked ${quantityToAdd}x ${motor.manufacturer} ${motor.model}`,
  })

  if (c.req.header('hx-request')) {
    c.header('HX-Redirect', '/inventory')
    return c.text('OK')
  }

  return c.redirect('/inventory')
}

/**
 * Adjust Motor Inventory Stock (POST /inventory/:id/adjust).
 */
export async function adjustInventoryHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const id = c.req.param('id')

  let body: any = {}
  const contentType = c.req.header('content-type') || ''
  if (contentType.includes('application/json')) {
    body = await c.req.json().catch(() => ({}))
  } else {
    body = await c.req.parseBody().catch(() => ({}))
  }
  const query = c.req.query()

  const action = String(body.action || query.action || '').toLowerCase().trim()
  const field = String(body.field || query.field || '').toLowerCase().trim()
  const rawDelta = body.delta !== undefined ? body.delta : query.delta
  const delta = rawDelta !== undefined ? parseInt(String(rawDelta), 10) : 1
  const effectiveDelta = isNaN(delta) ? 1 : delta

  // Fetch current inventory item
  const [inv] = await db
    .select()
    .from(schema.motorInventories)
    .where(and(eq(schema.motorInventories.id, id), isNull(schema.motorInventories.deletedAt)))
    .limit(1)

  if (!inv) {
    return c.text('<tr class="text-red-500"><td colspan="7">Inventory item not found</td></tr>', 404)
  }

  let newOnHand = inv.quantityOnHand
  let newExpended = inv.expendedCount
  let txType = 'audit_adjustment'
  let txQty = Math.abs(effectiveDelta)

  if (action === 'increment') {
    newOnHand = Math.max(0, inv.quantityOnHand + effectiveDelta)
    txType = 'received'
  } else if (action === 'decrement') {
    newOnHand = Math.max(0, inv.quantityOnHand - Math.abs(effectiveDelta))
    txType = 'disposed'
  } else if (action === 'expend') {
    if (inv.quantityOnHand > 0) {
      const step = Math.abs(effectiveDelta)
      newOnHand = Math.max(0, inv.quantityOnHand - step)
      newExpended = Math.max(0, inv.expendedCount + step)
      txType = 'used'
      txQty = step
    }
  } else if (action === 'restore') {
    const step = Math.abs(effectiveDelta)
    newExpended = Math.max(0, inv.expendedCount - step)
    newOnHand = Math.max(0, inv.quantityOnHand + step)
    txType = 'received'
    txQty = step
  } else if (field === 'quantity_on_hand' || field === 'quantityonhand') {
    newOnHand = Math.max(0, inv.quantityOnHand + effectiveDelta)
  } else if (field === 'expended_count' || field === 'expendedcount') {
    newExpended = Math.max(0, inv.expendedCount + effectiveDelta)
    txType = 'used'
  } else {
    newOnHand = Math.max(0, inv.quantityOnHand + effectiveDelta)
  }

  // Update record in D1
  const [updated] = await db
    .update(schema.motorInventories)
    .set({
      quantityOnHand: newOnHand,
      expendedCount: newExpended,
      updatedAt: Date.now(),
    })
    .where(eq(schema.motorInventories.id, id))
    .returning()

  // Log transaction
  await db.insert(schema.inventoryTransactions).values({
    userId: inv.userId,
    motorInventoryId: inv.id,
    transactionType: txType as any,
    quantity: txQty,
    transactionDate: new Date().toISOString().slice(0, 10),
    storageLocation: inv.storageLocation,
    notes: `Quick adjust action: ${action || field || 'stock update'}`,
  })

  // Retrieve motor specs for rendering the row
  const [motor] = await db
    .select()
    .from(schema.motors)
    .where(eq(schema.motors.id, updated.motorId))
    .limit(1)

  const item: InventoryItemWithMotor = {
    ...updated,
    motor: motor || {
      id: updated.motorId,
      manufacturer: 'Unknown',
      model: 'Unknown',
      impulseClass: null,
      delayS: null,
      diameterMm: null,
      totalImpulseNs: null,
    },
  }

  const fragment = inventoryRowFragment(item)

  return c.html(fragment, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
}

/**
 * Dismiss / Archive Zero-Quantity Motor from Active Inventory (POST /inventory/:id/dismiss).
 *
 * Sets `deletedAt = Date.now()` on `schema.motorInventories` when `quantityOnHand === 0`.
 * Preserves all historical records in `schema.inventoryTransactions` (chain-of-custody ledger).
 *
 * Rejects with HTTP 400 if `quantityOnHand > 0`.
 * Rejects with HTTP 403/404 if unauthorized or not found.
 * Supports HTML form (303 redirect), HTMX (200 empty fragment), and JSON API requests.
 */
export async function dismissInventoryHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user') || (await getActiveFlyer(db))
  const id = c.req.param('id')

  if (!id) {
    return c.json({ error: 'Missing inventory ID parameter' }, 400)
  }

  // Find active inventory item
  const [inv] = await db
    .select()
    .from(schema.motorInventories)
    .where(
      and(
        eq(schema.motorInventories.id, id),
        isNull(schema.motorInventories.deletedAt),
      ),
    )
    .limit(1)

  const isJson =
    c.req.header('accept')?.includes('application/json') ||
    c.req.header('content-type')?.includes('application/json')
  const isHtmx = c.req.header('hx-request') === 'true'

  if (!inv) {
    // Check if item exists but is already dismissed (idempotent handling)
    const [alreadyDismissed] = await db
      .select()
      .from(schema.motorInventories)
      .where(eq(schema.motorInventories.id, id))
      .limit(1)

    if (alreadyDismissed) {
      if (isJson) {
        return c.json({ success: true, alreadyDismissed: true, id }, 200)
      }
      if (isHtmx) {
        return c.html('', 200)
      }
      return c.redirect('/inventory', 303)
    }

    return c.json({ error: 'Motor inventory record not found' }, 404)
  }

  // Authorization check: flyer must own the inventory record
  if (flyer && inv.userId !== flyer.id) {
    return c.json({ error: 'Unauthorized: Motor inventory item belongs to another flyer' }, 403)
  }

  // Boundary check: motor must have quantityOnHand === 0
  if (inv.quantityOnHand > 0) {
    const errorMsg = 'Cannot dismiss motor inventory with quantity on hand greater than 0'
    if (isJson) {
      return c.json({ error: errorMsg }, 400)
    }
    return c.text(errorMsg, 400)
  }

  // Soft delete motor record by setting deletedAt timestamp
  const now = Date.now()
  await db
    .update(schema.motorInventories)
    .set({
      deletedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.motorInventories.id, id))

  if (isJson) {
    return c.json({ success: true, id, dismissedAt: now }, 200)
  }

  if (isHtmx) {
    // Return empty HTML so HTMX outerHTML swap removes the row
    return c.html('', 200)
  }

  // Standard HTML form submission: 303 redirect back to inventory hub
  return c.redirect('/inventory', 303)
}

/**
 * Component Form View (GET /inventory/components/new).
 */
export async function newComponentFormHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = await getActiveFlyer(db)
  const content = addComponentFormView()
  const fullHtml = pageLayout({
    title: 'Add Component',
    activeTab: 'inventory',
    content,
    user: flyer,
  })
  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
}

/**
 * Add Component (POST /inventory/components).
 */
export async function addComponentHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = await getActiveFlyer(db)

  let body: any = {}
  const contentType = c.req.header('content-type') || ''
  if (contentType.includes('application/json')) {
    body = await c.req.json().catch(() => ({}))
  } else {
    body = await c.req.parseBody().catch(() => ({}))
  }

  const name = String(body.name || '').trim()
  const category = String(body.category || 'other').trim()
  const quantityOnHand = Math.max(0, parseInt(String(body.quantity_on_hand ?? 1), 10) || 0)
  const manufacturer = body.manufacturer ? String(body.manufacturer).trim() : null
  const partNumber = body.part_number ? String(body.part_number).trim() : null
  const serialNumber = body.serial_number ? String(body.serial_number).trim() : null
  const lotNumber = body.lot_number ? String(body.lot_number).trim() : null
  const condition = String(body.condition || 'new').trim()
  const storageLocation = body.storage_location ? String(body.storage_location).trim() : null
  const hazardClass = body.hazard_class ? String(body.hazard_class).trim() : null
  const propellantMassG = body.propellant_mass_g ? parseFloat(String(body.propellant_mass_g)) : null
  const expirationDate = body.expiration_date ? String(body.expiration_date).trim() : null
  const notes = body.notes ? String(body.notes).trim() : null
  const today = new Date().toISOString().slice(0, 10)

  if (!name) {
    return c.json({ error: 'Component name is required' }, 400)
  }

  const [comp] = await db
    .insert(schema.components)
    .values({
      userId: flyer.id,
      name,
      category: category as any,
      manufacturer,
      partNumber,
      serialNumber,
      lotNumber,
      quantityOnHand,
      condition: condition as any,
      storageLocation,
      hazardClass,
      propellantMassG,
      expirationDate,
      acquiredOn: today,
      purchasedOn: today,
      receivedOn: today,
      notes,
    })
    .returning()

  // Log custody receipt
  await db.insert(schema.inventoryTransactions).values({
    userId: flyer.id,
    componentId: comp.id,
    transactionType: 'received',
    quantity: quantityOnHand,
    transactionDate: today,
    storageLocation,
    serialNumbers: serialNumber,
    batchLotNumber: lotNumber,
    notes: `Initial stock receipt for ${comp.name}`,
  })

  return c.redirect('/inventory')
}

/**
 * Adjust Component Stock (POST /inventory/components/:id/adjust).
 */
export async function adjustComponentHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const id = c.req.param('id')

  let body: any = {}
  const contentType = c.req.header('content-type') || ''
  if (contentType.includes('application/json')) {
    body = await c.req.json().catch(() => ({}))
  } else {
    body = await c.req.parseBody().catch(() => ({}))
  }
  const query = c.req.query()

  const action = String(body.action || query.action || '').toLowerCase().trim()
  const delta = parseInt(String(body.delta || query.delta || 1), 10) || 1

  const [comp] = await db
    .select()
    .from(schema.components)
    .where(and(eq(schema.components.id, id), isNull(schema.components.deletedAt)))
    .limit(1)

  if (!comp) {
    return c.text('Component not found', 404)
  }

  let newQty = comp.quantityOnHand
  let txType = 'audit_adjustment'
  if (action === 'increment') {
    newQty = comp.quantityOnHand + Math.abs(delta)
    txType = 'received'
  } else if (action === 'decrement') {
    newQty = Math.max(0, comp.quantityOnHand - Math.abs(delta))
    txType = 'disposed'
  }

  const [updated] = await db
    .update(schema.components)
    .set({
      quantityOnHand: newQty,
      updatedAt: Date.now(),
    })
    .where(eq(schema.components.id, id))
    .returning()

  await db.insert(schema.inventoryTransactions).values({
    userId: comp.userId,
    componentId: comp.id,
    transactionType: txType as any,
    quantity: Math.abs(delta),
    transactionDate: new Date().toISOString().slice(0, 10),
    storageLocation: comp.storageLocation,
    notes: `Component stock adjusted: ${action}`,
  })

  // Return HTML partial row for HTMX swap
  const cat = getCategoryBadgeClasses(updated.category)
  const cond = getConditionBadgeClasses(updated.condition)

  const rowHtml = `
    <tr id="component-row-${updated.id}" class="hover:bg-slate-800/40 transition-colors">
      <td class="py-3.5 pl-4 pr-3 sm:pl-6 font-semibold text-white">
        <a href="/inventory/components/${updated.id}" class="hover:text-brand-400 transition-colors">
          ${updated.name}
        </a>
      </td>
      <td class="px-3 py-3.5">
        <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${cat.badgeClasses}">
          ${cat.icon} ${cat.label}
        </span>
      </td>
      <td class="px-3 py-3.5">
        <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cond.badgeClasses}">
          ${cond.label}
        </span>
      </td>
      <td class="px-3 py-3.5">
        <div class="flex items-center space-x-2">
          <button
            type="button"
            hx-post="/inventory/components/${updated.id}/adjust"
            hx-vals='{"action": "decrement", "delta": 1}'
            hx-target="#component-row-${updated.id}"
            hx-swap="outerHTML"
            class="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center justify-center border border-slate-700 disabled:opacity-40"
            ${updated.quantityOnHand <= 0 ? 'disabled' : ''}
          >-</button>
          <span class="font-mono font-bold text-base text-white w-8 text-center">${updated.quantityOnHand}</span>
          <button
            type="button"
            hx-post="/inventory/components/${updated.id}/adjust"
            hx-vals='{"action": "increment", "delta": 1}'
            hx-target="#component-row-${updated.id}"
            hx-swap="outerHTML"
            class="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center justify-center border border-slate-700"
          >+</button>
        </div>
      </td>
      <td class="px-3 py-3.5 text-xs text-slate-400">
        <div>${updated.storageLocation || 'Workshop'}</div>
      </td>
      <td class="py-3.5 pl-3 pr-4 sm:pr-6 text-right">
        <a href="/inventory/transactions/new?component_id=${updated.id}" class="text-xs font-semibold text-purple-400 hover:underline mr-3">Transfer →</a>
        <a href="/inventory/components/${updated.id}" class="text-xs font-semibold text-brand-400 hover:underline">Edit</a>
      </td>
    </tr>
  `

  return c.html(rowHtml, 200, { 'Content-Type': 'text/html; charset=utf-8' })
}

/**
 * Component Edit Form View (GET /inventory/components/:id).
 */
export async function editComponentFormHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user') || (await getActiveFlyer(db))
  const id = c.req.param('id')

  const [comp] = await db
    .select()
    .from(schema.components)
    .where(and(eq(schema.components.id, id), isNull(schema.components.deletedAt)))
    .limit(1)

  if (!comp) {
    return c.text('Component not found', 404)
  }

  const content = editComponentFormView(comp)
  const fullHtml = pageLayout({
    title: `Edit Component — ${comp.name}`,
    activeTab: 'inventory',
    content,
    user: flyer,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
}

/**
 * Update Component Handler (POST /inventory/components/:id).
 */
export async function updateComponentHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user') || (await getActiveFlyer(db))
  const id = c.req.param('id')

  let body: any = {}
  const contentType = c.req.header('content-type') || ''
  if (contentType.includes('application/json')) {
    body = await c.req.json().catch(() => ({}))
  } else {
    body = await c.req.parseBody().catch(() => ({}))
  }

  const name = String(body.name || '').trim()
  const category = String(body.category || 'other').trim()
  const manufacturer = body.manufacturer ? String(body.manufacturer).trim() : null
  const partNumber = body.part_number || body.partNumber ? String(body.part_number || body.partNumber).trim() : null
  const serialNumber = body.serial_number || body.serialNumber ? String(body.serial_number || body.serialNumber).trim() : null
  const rawQty = body.quantity_on_hand !== undefined ? body.quantity_on_hand : body.quantityOnHand
  const quantityOnHand = Math.max(0, parseInt(String(rawQty ?? 0), 10) || 0)
  const condition = String(body.condition || 'new').trim()
  const storageLocation = body.storage_location || body.storageLocation ? String(body.storage_location || body.storageLocation).trim() : null
  const propellantMassG = body.propellant_mass_g || body.propellantMassG ? parseFloat(String(body.propellant_mass_g || body.propellantMassG)) : null
  const hazardClass = body.hazard_class || body.hazardClass ? String(body.hazard_class || body.hazardClass).trim() : null
  const expirationDate = body.expiration_date || body.expirationDate ? String(body.expiration_date || body.expirationDate).trim() : null
  const notes = body.notes ? String(body.notes).trim() : null

  if (!name) {
    return c.json({ error: 'Component name is required' }, 400)
  }

  const [existing] = await db
    .select()
    .from(schema.components)
    .where(and(eq(schema.components.id, id), isNull(schema.components.deletedAt)))
    .limit(1)

  if (!existing) {
    return c.text('Component not found', 404)
  }

  await db
    .update(schema.components)
    .set({
      name,
      category: category as any,
      manufacturer,
      partNumber,
      serialNumber,
      quantityOnHand,
      condition: condition as any,
      storageLocation,
      propellantMassG,
      hazardClass,
      expirationDate,
      notes,
      updatedAt: Date.now(),
    })
    .where(eq(schema.components.id, id))

  return c.redirect('/inventory', 303)
}

/**
 * View Full Custody Ledger (GET /inventory/transactions).
 */
export async function custodyLedgerHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = await getActiveFlyer(db)

  const transactions = await db
    .select({
      id: schema.inventoryTransactions.id,
      userId: schema.inventoryTransactions.userId,
      motorInventoryId: schema.inventoryTransactions.motorInventoryId,
      componentId: schema.inventoryTransactions.componentId,
      transactionType: schema.inventoryTransactions.transactionType,
      quantity: schema.inventoryTransactions.quantity,
      transactionDate: schema.inventoryTransactions.transactionDate,
      counterpartyName: schema.inventoryTransactions.counterpartyName,
      counterpartyCertNumber: schema.inventoryTransactions.counterpartyCertNumber,
      counterpartyLicense: schema.inventoryTransactions.counterpartyLicense,
      counterpartyContact: schema.inventoryTransactions.counterpartyContact,
      referenceId: schema.inventoryTransactions.referenceId,
      flightId: schema.inventoryTransactions.flightId,
      batchLotNumber: schema.inventoryTransactions.batchLotNumber,
      serialNumbers: schema.inventoryTransactions.serialNumbers,
      storageLocation: schema.inventoryTransactions.storageLocation,
      unitCost: schema.inventoryTransactions.unitCost,
      witnessName: schema.inventoryTransactions.witnessName,
      complianceNotes: schema.inventoryTransactions.complianceNotes,
      notes: schema.inventoryTransactions.notes,
      createdAt: schema.inventoryTransactions.createdAt,
      updatedAt: schema.inventoryTransactions.updatedAt,
      createdBy: schema.inventoryTransactions.createdBy,
      deletedAt: schema.inventoryTransactions.deletedAt,
      motor: {
        id: schema.motors.id,
        manufacturer: schema.motors.manufacturer,
        model: schema.motors.model,
        impulseClass: schema.motors.impulseClass,
      },
      component: {
        id: schema.components.id,
        name: schema.components.name,
        category: schema.components.category,
      },
    })
    .from(schema.inventoryTransactions)
    .leftJoin(
      schema.motorInventories,
      eq(schema.inventoryTransactions.motorInventoryId, schema.motorInventories.id),
    )
    .leftJoin(schema.motors, eq(schema.motorInventories.motorId, schema.motors.id))
    .leftJoin(
      schema.components,
      eq(schema.inventoryTransactions.componentId, schema.components.id),
    )
    .where(
      and(
        eq(schema.inventoryTransactions.userId, flyer.id),
        isNull(schema.inventoryTransactions.deletedAt),
      ),
    )
    .orderBy(desc(schema.inventoryTransactions.transactionDate), desc(schema.inventoryTransactions.createdAt))

  const content = custodyLedgerView(transactions)
  const fullHtml = pageLayout({
    title: 'Chain-of-Custody Ledger',
    activeTab: 'inventory',
    content,
    user: flyer,
  })

  return c.html(fullHtml, 200, { 'Content-Type': 'text/html; charset=utf-8' })
}

/**
 * Record New Transaction Form (GET /inventory/transactions/new).
 */
export async function newTransactionFormHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user') || (await getActiveFlyer(db))
  const query = c.req.query()

  const motorInvId = query.motor_inventory_id || query.motorInventoryId
  const componentId = query.component_id || query.componentId

  const motors = await db
    .select({
      id: schema.motorInventories.id,
      userId: schema.motorInventories.userId,
      motorId: schema.motorInventories.motorId,
      quantityOnHand: schema.motorInventories.quantityOnHand,
      expendedCount: schema.motorInventories.expendedCount,
      soldCount: schema.motorInventories.soldCount,
      disposedCount: schema.motorInventories.disposedCount,
      acquiredOn: schema.motorInventories.acquiredOn,
      purchasedOn: schema.motorInventories.purchasedOn,
      receivedOn: schema.motorInventories.receivedOn,
      batchLotNumber: schema.motorInventories.batchLotNumber,
      serialNumber: schema.motorInventories.serialNumber,
      storageLocation: schema.motorInventories.storageLocation,
      notes: schema.motorInventories.notes,
      createdAt: schema.motorInventories.createdAt,
      updatedAt: schema.motorInventories.updatedAt,
      createdBy: schema.motorInventories.createdBy,
      deletedAt: schema.motorInventories.deletedAt,
      motor: {
        id: schema.motors.id,
        manufacturer: schema.motors.manufacturer,
        model: schema.motors.model,
        impulseClass: schema.motors.impulseClass,
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

  const components = await db
    .select()
    .from(schema.components)
    .where(
      and(
        eq(schema.components.userId, flyer.id),
        isNull(schema.components.deletedAt),
      ),
    )

  const content = recordTransactionFormView({
    motors,
    components,
    preselectedMotorInvId: motorInvId,
    preselectedComponentId: componentId,
  })

  const fullHtml = pageLayout({
    title: 'Record Movement Event',
    activeTab: 'inventory',
    content,
    user: flyer,
  })

  return c.html(fullHtml, 200, { 'Content-Type': 'text/html; charset=utf-8' })
}

/**
 * Record New Custody Transaction (POST /inventory/transactions).
 */
export async function createTransactionHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = await getActiveFlyer(db)

  let body: any = {}
  const contentType = c.req.header('content-type') || ''
  if (contentType.includes('application/json')) {
    body = await c.req.json().catch(() => ({}))
  } else {
    body = await c.req.parseBody().catch(() => ({}))
  }

  const itemRef = String(body.item_ref || body.itemRef || '').trim()
  const transactionType = String(body.transaction_type || body.transactionType || 'received').trim()
  const quantity = Math.max(1, parseInt(String(body.quantity || 1), 10) || 1)
  const transactionDate = String(body.transaction_date || body.transactionDate || new Date().toISOString().slice(0, 10)).trim()
  const counterpartyName = body.counterparty_name ? String(body.counterparty_name).trim() : null
  const counterpartyCertNumber = body.counterparty_cert_number ? String(body.counterparty_cert_number).trim() : null
  const counterpartyLicense = body.counterparty_license ? String(body.counterparty_license).trim() : null
  const counterpartyContact = body.counterparty_contact ? String(body.counterparty_contact).trim() : null
  const batchLotNumber = body.batch_lot_number ? String(body.batch_lot_number).trim() : null
  const storageLocation = body.storage_location ? String(body.storage_location).trim() : null
  const witnessName = body.witness_name ? String(body.witness_name).trim() : null
  const notes = body.notes ? String(body.notes).trim() : null

  let motorInvId: string | null = null
  let componentId: string | null = null

  if (itemRef.startsWith('motor:')) {
    motorInvId = itemRef.slice(6)
  } else if (itemRef.startsWith('component:')) {
    componentId = itemRef.slice(10)
  } else if (body.motor_inventory_id || body.motorInventoryId) {
    motorInvId = body.motor_inventory_id || body.motorInventoryId
  } else if (body.component_id || body.componentId) {
    componentId = body.component_id || body.componentId
  }

  if (!motorInvId && !componentId) {
    // Check if flyer has an existing motor inventory record to associate with
    const [defaultInv] = await db
      .select({ id: schema.motorInventories.id })
      .from(schema.motorInventories)
      .where(
        and(
          eq(schema.motorInventories.userId, flyer.id),
          isNull(schema.motorInventories.deletedAt),
        ),
      )
      .limit(1)

    if (defaultInv) {
      motorInvId = defaultInv.id
    } else {
      const [defaultComp] = await db
        .select({ id: schema.components.id })
        .from(schema.components)
        .where(
          and(
            eq(schema.components.userId, flyer.id),
            isNull(schema.components.deletedAt),
          ),
        )
        .limit(1)
      if (defaultComp) {
        componentId = defaultComp.id
      }
    }
  }

  if (!motorInvId && !componentId) {
    return c.json({ error: 'Must select a motor or component' }, 400)
  }

  // If transferring/selling a motor, perform regulatory compliance evaluation
  let complianceNotes = String(body.compliance_notes || body.complianceNotes || '').trim()
  if (motorInvId) {
    const [inv] = await db
      .select({
        id: schema.motorInventories.id,
        quantityOnHand: schema.motorInventories.quantityOnHand,
        expendedCount: schema.motorInventories.expendedCount,
        soldCount: schema.motorInventories.soldCount,
        disposedCount: schema.motorInventories.disposedCount,
        storageLocation: schema.motorInventories.storageLocation,
        motor: {
          impulseClass: schema.motors.impulseClass,
          propellantType: schema.motors.propellantType,
        },
      })
      .from(schema.motorInventories)
      .innerJoin(schema.motors, eq(schema.motorInventories.motorId, schema.motors.id))
      .where(eq(schema.motorInventories.id, motorInvId))
      .limit(1)

    if (inv) {
      if (['sold', 'transferred_out'].includes(transactionType)) {
        const complianceResult = evaluateTransferCompliance({
          impulseClass: inv.motor.impulseClass,
          propellantType: inv.motor.propellantType,
          transactionType,
          counterpartyName,
          counterpartyCertNumber,
          counterpartyLicense,
        })
        if (complianceResult.warnings.length > 0) {
          complianceNotes = complianceResult.warnings.join('; ')
        }
      }

      // Update motor balances according to transaction type
      let newOnHand = inv.quantityOnHand
      let newExpended = inv.expendedCount
      let newSold = inv.soldCount || 0
      let newDisposed = inv.disposedCount || 0

      if (['received', 'purchased', 'transferred_in'].includes(transactionType)) {
        newOnHand += quantity
      } else if (['sold', 'transferred_out'].includes(transactionType)) {
        newOnHand = Math.max(0, newOnHand - quantity)
        newSold += quantity
      } else if (['used'].includes(transactionType)) {
        newOnHand = Math.max(0, newOnHand - quantity)
        newExpended += quantity
      } else if (['disposed', 'destroyed', 'lost', 'stolen'].includes(transactionType)) {
        newOnHand = Math.max(0, newOnHand - quantity)
        newDisposed += quantity
      }

      await db
        .update(schema.motorInventories)
        .set({
          quantityOnHand: newOnHand,
          expendedCount: newExpended,
          soldCount: newSold,
          disposedCount: newDisposed,
          storageLocation: storageLocation || inv.storageLocation,
          updatedAt: Date.now(),
        })
        .where(eq(schema.motorInventories.id, inv.id))
    }
  } else if (componentId) {
    const [comp] = await db
      .select()
      .from(schema.components)
      .where(eq(schema.components.id, componentId))
      .limit(1)

    if (comp) {
      let newOnHand = comp.quantityOnHand
      let newExpended = comp.quantityExpended
      let newDisposed = comp.quantityDisposed

      if (['received', 'purchased', 'transferred_in'].includes(transactionType)) {
        newOnHand += quantity
      } else if (['sold', 'transferred_out'].includes(transactionType)) {
        newOnHand = Math.max(0, newOnHand - quantity)
        newDisposed += quantity
      } else if (['used'].includes(transactionType)) {
        newOnHand = Math.max(0, newOnHand - quantity)
        newExpended += quantity
      } else if (['disposed', 'destroyed', 'lost', 'stolen'].includes(transactionType)) {
        newOnHand = Math.max(0, newOnHand - quantity)
        newDisposed += quantity
      }

      await db
        .update(schema.components)
        .set({
          quantityOnHand: newOnHand,
          quantityExpended: newExpended,
          quantityDisposed: newDisposed,
          storageLocation: storageLocation || comp.storageLocation,
          updatedAt: Date.now(),
        })
        .where(eq(schema.components.id, comp.id))
    }
  }

  // Insert immutable audit transaction record
  await db.insert(schema.inventoryTransactions).values({
    userId: flyer.id,
    motorInventoryId: motorInvId,
    componentId,
    transactionType: transactionType as any,
    quantity,
    transactionDate,
    counterpartyName,
    counterpartyCertNumber,
    counterpartyLicense,
    counterpartyContact,
    batchLotNumber,
    storageLocation,
    witnessName,
    complianceNotes: complianceNotes || null,
    notes,
  })

  return c.redirect('/inventory/transactions')
}

// Router mounts
inventoryRouter.get('/', listInventoryHandler)
inventoryRouter.get('/inventory', listInventoryHandler)
inventoryRouter.post('/', addInventoryHandler)
inventoryRouter.post('/inventory', addInventoryHandler)

// Motor adjust
inventoryRouter.post('/:id/adjust', adjustInventoryHandler)
inventoryRouter.post('/inventory/:id/adjust', adjustInventoryHandler)
inventoryRouter.get('/:id/adjust', adjustInventoryHandler)
inventoryRouter.get('/inventory/:id/adjust', adjustInventoryHandler)

// Components
inventoryRouter.get('/components/new', newComponentFormHandler)
inventoryRouter.post('/components', addComponentHandler)
inventoryRouter.post('/components/:id/adjust', adjustComponentHandler)
inventoryRouter.get('/components/:id', editComponentFormHandler)
inventoryRouter.post('/components/:id', updateComponentHandler)

// Chain-of-custody transactions
inventoryRouter.get('/transactions', custodyLedgerHandler)
inventoryRouter.get('/transactions/new', newTransactionFormHandler)
inventoryRouter.post('/transactions', createTransactionHandler)

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
 * List Storage Sites (GET /inventory/storage-sites).
 */
export async function listStorageSitesHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user') || (await getActiveFlyer(db))
  if (!flyer) return c.redirect('/login')

  const sites = await db
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
    return c.json(sites)
  }

  const content = storageSitesListView(sites, flyer)
  const fullHtml = pageLayout({
    title: 'Propellant Storage Sites & Physical Storage Magazines',
    activeTab: 'inventory',
    content,
    user: flyer,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
}

/**
 * Storage Site Create Form (GET /inventory/storage-sites/new).
 */
export async function newStorageSiteFormHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user') || (await getActiveFlyer(db))
  if (!flyer) return c.redirect('/login')

  const content = storageSiteFormView({
    isNew: true,
    user: flyer,
  })
  const fullHtml = pageLayout({
    title: 'New Storage Site',
    activeTab: 'inventory',
    content,
    user: flyer,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
}

/**
 * Create Storage Site (POST /inventory/storage-sites).
 */
export async function createStorageSiteHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user') || (await getActiveFlyer(db))
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
      pageLayout({ title: 'New Storage Site', activeTab: 'inventory', content, user: flyer }),
      400,
      { 'Content-Type': 'text/html; charset=utf-8' },
    )
  }

  // SafeWork SA Compliance Rule: capacityKg > 3.0 strictly requires regulatory permit
  if (input.capacityKg > 3.0 && (!input.permitNumber || input.permitNumber.trim().length === 0)) {
    const errorMsg = 'SafeWork SA regulations require a propellant storage license/permit for storage capacity exceeding 3.0 kg'
    if (input.isJson) return c.json({ error: errorMsg }, 400)
    const content = storageSiteFormView({
      site: input,
      error: errorMsg,
      isNew: true,
      user: flyer,
    })
    return c.html(
      pageLayout({ title: 'New Storage Site', activeTab: 'inventory', content, user: flyer }),
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

  return c.redirect('/inventory/storage-sites', 303)
}

/**
 * View Storage Site Details (GET /inventory/storage-sites/:id).
 */
export async function viewStorageSiteHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user') || (await getActiveFlyer(db))
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
        activeTab: 'inventory',
        user: flyer,
        content: html`
          <div class="max-w-md mx-auto bg-slate-850 border border-slate-800 rounded-xl p-6 text-center">
            <h2 class="text-xl font-bold text-slate-200">Storage Site Not Found</h2>
            <p class="text-sm text-slate-400 mt-2">The requested storage site does not exist or has been removed.</p>
            <a href="/inventory/storage-sites" class="mt-4 inline-block px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm">&larr; Back to Storage Sites</a>
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
    activeTab: 'inventory',
    content,
    user: flyer,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
}

/**
 * Storage Site Edit Form (GET /inventory/storage-sites/:id/edit).
 */
export async function editStorageSiteFormHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user') || (await getActiveFlyer(db))
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
    activeTab: 'inventory',
    content,
    user: flyer,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
}

/**
 * Update Storage Site (POST /inventory/storage-sites/:id/edit and POST /inventory/storage-sites/:id).
 */
export async function updateStorageSiteHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user') || (await getActiveFlyer(db))
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
      pageLayout({ title: `Edit Storage Site — ${existing.name}`, activeTab: 'inventory', content, user: flyer }),
      400,
      { 'Content-Type': 'text/html; charset=utf-8' },
    )
  }

  // SafeWork SA Compliance Rule: capacityKg > 3.0 strictly requires regulatory permit
  if (input.capacityKg > 3.0 && (!input.permitNumber || input.permitNumber.trim().length === 0)) {
    const errorMsg = 'SafeWork SA regulations require a propellant storage license/permit for storage capacity exceeding 3.0 kg'
    if (input.isJson) return c.json({ error: errorMsg }, 400)
    const content = storageSiteFormView({
      site: { ...existing, ...input, id },
      error: errorMsg,
      isNew: false,
      user: flyer,
    })
    return c.html(
      pageLayout({ title: `Edit Storage Site — ${existing.name}`, activeTab: 'inventory', content, user: flyer }),
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

  return c.redirect('/inventory/storage-sites', 303)
}

/**
 * Delete Storage Site (POST /inventory/storage-sites/:id/delete and DELETE /inventory/storage-sites/:id).
 */
export async function deleteStorageSiteHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const flyer = (c.get as any)('user') || (await getActiveFlyer(db))
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
    c.header('HX-Redirect', '/inventory/storage-sites')
    return c.text('OK')
  }

  if (c.req.header('accept')?.includes('application/json')) {
    return c.json({ success: true, id }, 200)
  }

  return c.redirect('/inventory/storage-sites', 303)
}

// Storage Sites CRUD Routes
inventoryRouter.get('/storage-sites', listStorageSitesHandler)
inventoryRouter.get('/inventory/storage-sites', listStorageSitesHandler)
inventoryRouter.get('/storage-sites/new', newStorageSiteFormHandler)
inventoryRouter.get('/inventory/storage-sites/new', newStorageSiteFormHandler)
inventoryRouter.post('/storage-sites', createStorageSiteHandler)
inventoryRouter.post('/inventory/storage-sites', createStorageSiteHandler)
inventoryRouter.get('/storage-sites/:id', viewStorageSiteHandler)
inventoryRouter.get('/inventory/storage-sites/:id', viewStorageSiteHandler)
inventoryRouter.get('/storage-sites/:id/edit', editStorageSiteFormHandler)
inventoryRouter.get('/inventory/storage-sites/:id/edit', editStorageSiteFormHandler)
inventoryRouter.post('/storage-sites/:id/edit', updateStorageSiteHandler)
inventoryRouter.post('/inventory/storage-sites/:id/edit', updateStorageSiteHandler)
inventoryRouter.post('/storage-sites/:id', updateStorageSiteHandler)
inventoryRouter.post('/inventory/storage-sites/:id', updateStorageSiteHandler)
inventoryRouter.post('/storage-sites/:id/delete', deleteStorageSiteHandler)
inventoryRouter.post('/inventory/storage-sites/:id/delete', deleteStorageSiteHandler)
inventoryRouter.delete('/storage-sites/:id', deleteStorageSiteHandler)
inventoryRouter.delete('/inventory/storage-sites/:id', deleteStorageSiteHandler)

// Motor Dismissal Routes
inventoryRouter.post('/:id/dismiss', dismissInventoryHandler)
inventoryRouter.post('/inventory/:id/dismiss', dismissInventoryHandler)
inventoryRouter.post('/motors/:id/dismiss', dismissInventoryHandler)
inventoryRouter.delete('/:id', dismissInventoryHandler)
inventoryRouter.delete('/inventory/:id', dismissInventoryHandler)

export default inventoryRouter
