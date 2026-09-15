/**
 * Integration Test Suite: Motor Inventory Removal & Lifecycle Management (Requirement R4).
 *
 * Verifies:
 * 1. Single motor hard deletion when 0 flights and 0 transactions exist.
 *    - Permanent SQL DELETE: record completely removed from D1 motor_inventories table.
 *    - Zero orphaned transaction rows.
 * 2. Single motor regulatory disposal when linked flights exist.
 *    - Soft delete: deletedAt timestamp set, quantityOnHand set to 0.
 *    - disposedCount incremented by quantityOnHand.
 *    - Audit compliance: 'disposed' row inserted in inventory_transactions ledger.
 *    - Excluded from active inventory listings (GET /inventory and GET /inventory/motors).
 * 3. Single motor regulatory disposal when linked custody transactions exist.
 *    - Audit compliance: historical transactions preserved, new 'disposed' transaction logged.
 * 4. Batch deletion with mixed inventory states (hard-deletable + regulatory disposal).
 *    - Returns accurate count { success: true, deleted: X, disposed: Y }.
 * 5. Empty batch deletion handling (graceful 200/303 without state modification).
 * 6. Edge cases and attack surface hardening:
 *    - Non-existent motor inventory ID returns HTTP 404.
 *    - Already-deleted motor inventory ID returns HTTP 404.
 *    - Multi-tenant isolation: flyer cannot delete another flyer's motor (HTTP 403).
 * 7. Strict unauthenticated access control (HTTP 302 redirect / 401 Unauthorized).
 * 8. UI & Templates verification:
 *    - Multi-select checkboxes (name="selected_ids").
 *    - Header select-all checkbox (#select-all-motors).
 *    - Single-item delete form (action="/inventory/motors/:id/delete").
 *    - Batch delete toolbar & button (#batch-delete-btn).
 */

import { env, SELF } from 'cloudflare:test'
import { and, eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import { signSession } from '../../src/services/auth'
import {
  getDb,
  seedTestFlight,
  seedTestInventory,
  seedTestMotor,
  seedTestRocket,
  seedTestConfig,
  seedTestSite,
  seedTestTransaction,
  seedTestUser,
  truncateDb,
} from '../helpers/db'
import { fetchGet, fetchPostForm, fetchPostJson } from '../helpers/http'

beforeEach(async () => {
  await truncateDb()
  const now = Date.now()
  await env.DB.prepare(
    "INSERT OR REPLACE INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?, ?)",
  )
    .bind(now, now)
    .run()
})

describe('Requirement R4: Motor Inventory Removal & Lifecycle Management', () => {
  describe('1. Single Motor Hard Deletion (0 Flights & 0 Transactions)', () => {
    it('permanently deletes motor from database via JSON API when 0 flights and 0 transactions exist', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'AeroTech G80T' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 5 })

      const res = await SELF.fetch(`https://example.com/inventory/motors/${inv.id}/delete`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.success).toBe(true)
      expect(data.id).toBe(inv.id)
      expect(data.action).toBe('deleted')

      // Verify permanent hard deletion from D1 database
      const db = getDb()
      const rows = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(rows.length).toBe(0)

      // Verify zero transactions created or orphaned
      const txs = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.motorInventoryId, inv.id))

      expect(txs.length).toBe(0)
    })

    it('permanently deletes motor and returns HTTP 303 redirect when submitted via HTML form', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'Cesaroni F36' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 2 })

      const res = await fetchPostForm(
        `/inventory/motors/${inv.id}/delete`,
        {},
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe('/inventory')

      // Verify record is completely absent in database
      const db = getDb()
      const [record] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(record).toBeUndefined()
    })
  })

  describe('2. Single Motor Regulatory Disposal (Linked Flight Records)', () => {
    it('performs regulatory disposal and soft delete when linked flights exist', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'AeroTech H128W', impulseClass: 'H' })
      const inv = await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 3,
        disposedCount: 0,
      })

      // Link a flight log to this motor inventory item
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const site = await seedTestSite()
      await seedTestFlight(flyer.id, {
        motorInventoryId: inv.id,
        motorId: motor.id,
        rocketConfigurationId: config.id,
        launchSiteId: site.id,
      })

      // Execute removal
      const res = await SELF.fetch(`https://example.com/inventory/motors/${inv.id}/delete`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.success).toBe(true)
      expect(data.id).toBe(inv.id)
      expect(data.action).toBe('disposed')

      // Verify database state: row is preserved, soft-deleted, stock zeroed, disposed count incremented
      const db = getDb()
      const [updatedInv] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updatedInv).toBeDefined()
      expect(updatedInv.deletedAt).not.toBeNull()
      expect(typeof updatedInv.deletedAt).toBe('number')
      expect(updatedInv.quantityOnHand).toBe(0)
      expect(updatedInv.disposedCount).toBe(3)

      // Verify regulatory chain-of-custody disposal transaction in ledger
      const [disposalTx] = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(
          and(
            eq(schema.inventoryTransactions.motorInventoryId, inv.id),
            eq(schema.inventoryTransactions.transactionType, 'disposed'),
          ),
        )

      expect(disposalTx).toBeDefined()
      expect(disposalTx.quantity).toBe(3)
      expect(disposalTx.userId).toBe(flyer.id)
      expect(disposalTx.notes).toContain('Regulatory disposal')

      // Verify motor does not appear in active inventory list (GET /inventory)
      const activeRes = await fetchGet('/inventory', {
        Accept: 'application/json',
        Cookie: `triplet_session=${token}`,
      })
      expect(activeRes.status).toBe(200)
      const activeData = (await activeRes.json()) as any
      const activeMotorIds = activeData.motors.map((m: any) => m.id)
      expect(activeMotorIds).not.toContain(inv.id)

      // Verify motor does not appear in GET /inventory/motors
      const motorsRes = await fetchGet('/inventory/motors', {
        Accept: 'application/json',
        Cookie: `triplet_session=${token}`,
      })
      expect(motorsRes.status).toBe(200)
      const motorsData = (await motorsRes.json()) as any
      const motorsIds = motorsData.motors.map((m: any) => m.id)
      expect(motorsIds).not.toContain(inv.id)
    })
  })

  describe('3. Single Motor Regulatory Disposal (Linked Custody Transactions)', () => {
    it('performs regulatory disposal and soft delete when historical custody transactions exist', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'AeroTech I200W', impulseClass: 'I' })
      const inv = await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 2,
        disposedCount: 1,
      })

      // Link a custody acquisition transaction
      await seedTestTransaction(flyer.id, {
        motorInventoryId: inv.id,
        transactionType: 'received',
        quantity: 3,
        notes: 'Initial receipt at club launch',
      })

      // Execute removal
      const res = await SELF.fetch(`https://example.com/inventory/motors/${inv.id}/delete`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.action).toBe('disposed')

      // Verify database state: soft-deleted, stock 0, disposed count = 1 + 2 = 3
      const db = getDb()
      const [updatedInv] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updatedInv).toBeDefined()
      expect(updatedInv.deletedAt).not.toBeNull()
      expect(updatedInv.quantityOnHand).toBe(0)
      expect(updatedInv.disposedCount).toBe(3)

      // Both historical 'received' transaction and new 'disposed' transaction exist
      const allTxs = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.motorInventoryId, inv.id))

      expect(allTxs.length).toBe(2)
      const txTypes = allTxs.map((t) => t.transactionType)
      expect(txTypes).toContain('received')
      expect(txTypes).toContain('disposed')
    })
  })

  describe('4. Batch Deletion (POST /inventory/motors/batch-delete)', () => {
    it('handles mixed batch deletion: hard deletes unreferenced motors and performs regulatory disposal on referenced ones', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'Cesaroni Pro38 G65' })

      // Motor A: 0 flights, 0 transactions -> should HARD DELETE
      const invA = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 1 })

      // Motor B: Linked flight -> should REGULATORY DISPOSAL & SOFT DELETE
      const invB = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 2, disposedCount: 0 })
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      await seedTestFlight(flyer.id, {
        motorInventoryId: invB.id,
        motorId: motor.id,
        rocketConfigurationId: config.id,
      })

      // Motor C: Linked transaction -> should REGULATORY DISPOSAL & SOFT DELETE
      const invC = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 4, disposedCount: 0 })
      await seedTestTransaction(flyer.id, {
        motorInventoryId: invC.id,
        transactionType: 'received',
        quantity: 4,
      })

      // Motor D: 0 flights, 0 transactions -> should HARD DELETE
      const invD = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 3 })

      // Submit batch delete via JSON
      const res = await SELF.fetch('https://example.com/inventory/motors/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({
          ids: [invA.id, invB.id, invC.id, invD.id],
        }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.success).toBe(true)
      expect(data.deleted).toBe(2)
      expect(data.disposed).toBe(2)

      // Direct DB verification
      const db = getDb()

      // Motor A and D must be completely absent from database
      const [dbA] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, invA.id))
      const [dbD] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, invD.id))
      expect(dbA).toBeUndefined()
      expect(dbD).toBeUndefined()

      // Motor B and C must be soft-deleted with quantityOnHand = 0
      const [dbB] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, invB.id))
      const [dbC] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, invC.id))
      expect(dbB).toBeDefined()
      expect(dbB.deletedAt).not.toBeNull()
      expect(dbB.quantityOnHand).toBe(0)
      expect(dbB.disposedCount).toBe(2)

      expect(dbC).toBeDefined()
      expect(dbC.deletedAt).not.toBeNull()
      expect(dbC.quantityOnHand).toBe(0)
      expect(dbC.disposedCount).toBe(4)

      // 'disposed' transactions created for B and C
      const txB = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(
          and(
            eq(schema.inventoryTransactions.motorInventoryId, invB.id),
            eq(schema.inventoryTransactions.transactionType, 'disposed'),
          ),
        )
      expect(txB.length).toBe(1)

      const txC = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(
          and(
            eq(schema.inventoryTransactions.motorInventoryId, invC.id),
            eq(schema.inventoryTransactions.transactionType, 'disposed'),
          ),
        )
      expect(txC.length).toBe(1)
    })

    it('handles batch delete submitted via URL-encoded form data with HTTP 303 redirect', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'Estes D12-5' })

      const inv1 = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 2 })
      const inv2 = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 3 })

      const formBody = new URLSearchParams()
      formBody.append('selected_ids', inv1.id)
      formBody.append('selected_ids', inv2.id)

      const res = await SELF.fetch('https://example.com/inventory/motors/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: `triplet_session=${token}`,
        },
        body: formBody.toString(),
        redirect: 'manual',
      })

      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe('/inventory')

      // Verify both were hard-deleted
      const db = getDb()
      const remaining = await db
        .select()
        .from(schema.motorInventories)
        .where(
          and(
            eq(schema.motorInventories.userId, flyer.id),
            isNull(schema.motorInventories.deletedAt),
          ),
        )
      expect(remaining.length).toBe(0)
    })

    it('handles empty batch deletion selection gracefully without errors or changes', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      // JSON API with empty selection
      const res = await SELF.fetch('https://example.com/inventory/motors/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({ ids: [] }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.success).toBe(true)
      expect(data.deleted).toBe(0)
      expect(data.disposed).toBe(0)

      // Form submission with empty selection
      const formRes = await fetchPostForm(
        '/inventory/motors/batch-delete',
        {},
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect(formRes.status).toBe(303)
      expect(formRes.headers.get('location')).toBe('/inventory')
    })
  })

  describe('5. Edge Cases, Multi-Tenant Protection & Error Handling', () => {
    it('returns HTTP 404 when deleting a non-existent motor inventory ID', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const nonExistentId = crypto.randomUUID()

      const res = await SELF.fetch(`https://example.com/inventory/motors/${nonExistentId}/delete`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
      })

      expect(res.status).toBe(404)
      const data = (await res.json()) as any
      expect(data.error).toContain('not found')
    })

    it('returns HTTP 404 when attempting to delete an already deleted/disposed motor', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor()
      const inv = await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 0,
        deletedAt: Date.now() - 10000,
      })

      const res = await SELF.fetch(`https://example.com/inventory/motors/${inv.id}/delete`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
      })

      expect(res.status).toBe(404)
    })

    it('strictly prevents cross-tenant deletion: Flyer B cannot delete Flyer A motor (HTTP 403)', async () => {
      const flyerA = await seedTestUser({ email: 'flyer-a@example.com' })
      const flyerB = await seedTestUser({ email: 'flyer-b@example.com' })
      const tokenB = await signSession(flyerB.id)

      const motor = await seedTestMotor()
      const invA = await seedTestInventory(flyerA.id, motor.id, { quantityOnHand: 5 })

      // Flyer B attacks Flyer A's motor
      const res = await SELF.fetch(`https://example.com/inventory/motors/${invA.id}/delete`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: `triplet_session=${tokenB}`,
        },
      })

      expect(res.status).toBe(403)
      const data = (await res.json()) as any
      expect(data.error).toContain('Unauthorized')

      // Assert Flyer A's motor remains completely untouched
      const db = getDb()
      const [intact] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, invA.id))

      expect(intact).toBeDefined()
      expect(intact.deletedAt).toBeNull()
      expect(intact.quantityOnHand).toBe(5)
    })
  })

  describe('6. Security & Unauthenticated Route Gating', () => {
    it('redirects unauthenticated browser requests (HTML) to /login with HTTP 302', async () => {
      const res = await SELF.fetch('https://example.com/inventory/motors/some-id/delete', {
        method: 'POST',
        headers: {
          Accept: 'text/html',
        },
        redirect: 'manual',
      })

      expect(res.status).toBe(302)
      const loc = res.headers.get('location') || ''
      expect(loc).toContain('/login')
    })

    it('rejects unauthenticated API requests (JSON) with HTTP 401 Unauthorized', async () => {
      const res = await SELF.fetch('https://example.com/inventory/motors/some-id/delete', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
        redirect: 'manual',
      })

      expect(res.status).toBe(401)
      const data = (await res.json()) as any
      expect(data.error).toBe('Unauthorized')
    })

    it('rejects unauthenticated batch delete requests with 302 or 401', async () => {
      const htmlRes = await SELF.fetch('https://example.com/inventory/motors/batch-delete', {
        method: 'POST',
        headers: {
          Accept: 'text/html',
        },
        redirect: 'manual',
      })
      expect(htmlRes.status).toBe(302)

      const jsonRes = await SELF.fetch('https://example.com/inventory/motors/batch-delete', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
        redirect: 'manual',
      })
      expect(jsonRes.status).toBe(401)
    })
  })

  describe('7. UI Templates & Markup Verification', () => {
    it('renders multi-select checkboxes, select-all header, single delete button, and batch delete toolbar', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ manufacturer: 'AeroTech', model: 'M1315W' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 2 })

      const res = await fetchGet('/inventory', {
        Cookie: `triplet_session=${token}`,
      })

      expect(res.status).toBe(200)
      const html = await res.text()

      // Header select-all checkbox
      expect(html).toContain('id="select-all-motors"')

      // Batch delete form & button
      expect(html).toContain('id="motor-batch-delete-form"')
      expect(html).toContain('action="/inventory/motors/batch-delete"')
      expect(html).toContain('id="batch-delete-btn"')
      expect(html).toContain('Delete Selected')

      // Row multi-select checkbox with inventory ID
      expect(html).toContain(`name="selected_ids"`)
      expect(html).toContain(`value="${inv.id}"`)
      expect(html).toContain('form="motor-batch-delete-form"')

      // Single delete button with action pointing to single delete endpoint
      expect(html).toContain(`action="/inventory/motors/${inv.id}/delete"`)
      expect(html).toContain('method="POST"')
      expect(html).toContain('Delete')
    })
  })
})
