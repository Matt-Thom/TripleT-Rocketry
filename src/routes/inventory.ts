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
      propellantMassG: m.motor?.weightG || 0,
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

  const storageSummary = calculateStorageSummary(itemsForStorage)

  const content = inventoryHubView({
    motors: motorRows,
    components: componentRows,
    transactions: transactionRows,
    storageSummary,
    activeFilter: filter,
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
    return c.json({ error: 'Must select a motor or component' }, 400)
  }

  // If transferring/selling a motor, perform regulatory compliance evaluation
  let complianceNotes = ''
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

// Chain-of-custody transactions
inventoryRouter.get('/transactions', custodyLedgerHandler)
inventoryRouter.get('/transactions/new', newTransactionFormHandler)
inventoryRouter.post('/transactions', createTransactionHandler)

export default inventoryRouter
