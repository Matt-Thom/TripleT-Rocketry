/**
 * Adversarial Challenger Integration Test Suite: Motor Inventory Removal & Lifecycle Management (Milestone M4)
 *
 * Adversarially stress-tests:
 * 1. Hard Deletion vs Regulatory Disposal branching under edge cases:
 *    - 0 flights, 0 transactions -> genuine SQL DELETE, 0 rows remaining, 0 transactions.
 *    - 1 flight, 0 transactions -> soft-deleted, regulatory disposal transaction created, excluded from active views.
 *    - 0 flights, 1 transaction -> soft-deleted, historical transaction preserved, disposal transaction added.
 *    - Multiple flights (3) and multiple transactions (2) -> all historical records preserved, disposal transaction created.
 *    - 0 quantity on hand with 0 flights/txs -> hard deleted cleanly.
 *    - 0 quantity on hand with linked flights -> disposal transaction logged with quantity: 0, soft-deleted.
 *    - Positive quantity on hand with pre-existing disposedCount -> disposedCount correctly incremented, stock zeroed.
 *    - Active inventory endpoint filtering (GET /inventory, GET /inventory/motors, GET /motors).
 * 2. Batch Deletion Stress:
 *    - Large mixed batch (30 motors with mixture of hard delete and disposal).
 *    - Duplicate IDs in batch request (deduplication check).
 *    - Malformed IDs, non-UUID strings, empty strings, SQL injection strings.
 *    - Empty batch selection via JSON and form body.
 *    - Deleting already deleted / disposed motors.
 *    - Alternative payload formats (comma-separated, selected_ids array, form data).
 * 3. Cross-Tenant Security & Isolation:
 *    - Flyer A attempting single delete of Flyer B's motor via POST /inventory/motors/:id/delete -> 403 Forbidden.
 *    - Flyer A attempting single delete of Flyer B's motor via DELETE /inventory/motors/:id -> 403 Forbidden.
 *    - Flyer A submitting batch delete containing both own motors and Flyer B's motors -> Flyer B's motors completely untouched.
 * 4. Unauthenticated Route Gating:
 *    - Single delete POST /inventory/motors/:id/delete (HTML 302, JSON 401).
 *    - Single delete DELETE /inventory/motors/:id (HTML 302, JSON 401).
 *    - Batch delete POST /inventory/motors/batch-delete (HTML 302, JSON 401).
 *    - Cookieless fallback rejection (triplet_logged_out=1).
 */

import { env, SELF } from 'cloudflare:test'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import { signSession } from '../../src/services/auth'
import {
  getDb,
  seedTestConfig,
  seedTestFlight,
  seedTestInventory,
  seedTestMotor,
  seedTestRocket,
  seedTestSite,
  seedTestTransaction,
  seedTestUser,
  truncateDb,
} from '../helpers/db'
import { fetchGet, fetchPostForm } from '../helpers/http'

beforeEach(async () => {
  await truncateDb()
  const now = Date.now()
  await env.DB.prepare(
    "INSERT OR REPLACE INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?, ?)",
  )
    .bind(now, now)
    .run()
})

describe('Adversarial Challenger M4: Motor Inventory Removal & Lifecycle Management', () => {
  describe('1. Hard Deletion vs Regulatory Disposal Lifecycle Branching', () => {
    it('permanently hard deletes motor when 0 flights and 0 transactions exist (SELECT returns empty, 0 audit txs)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'AeroTech F50T' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 4 })

      const res = await SELF.fetch(`https://example.com/inventory/motors/${inv.id}/delete`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.success).toBe(true)
      expect(body.id).toBe(inv.id)
      expect(body.action).toBe('deleted')

      // Direct SQL check: motor_inventories record is completely purged
      const db = getDb()
      const motorRows = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))
      expect(motorRows.length).toBe(0)

      // Verify zero audit transactions created
      const txRows = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.motorInventoryId, inv.id))
      expect(txRows.length).toBe(0)
    })

    it('performs regulatory disposal and soft-delete when 1 flight and 0 transactions exist', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'Cesaroni H110' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 2, disposedCount: 0 })

      // Seed 1 flight log
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const site = await seedTestSite()
      const flight = await seedTestFlight(flyer.id, {
        motorInventoryId: inv.id,
        motorId: motor.id,
        rocketConfigurationId: config.id,
        launchSiteId: site.id,
      })

      const res = await SELF.fetch(`https://example.com/inventory/motors/${inv.id}/delete`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.success).toBe(true)
      expect(body.action).toBe('disposed')

      // Verify DB state: soft-deleted, stock zeroed, disposed count updated
      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))
      expect(updated).toBeDefined()
      expect(updated.deletedAt).not.toBeNull()
      expect(typeof updated.deletedAt).toBe('number')
      expect(updated.quantityOnHand).toBe(0)
      expect(updated.disposedCount).toBe(2)

      // Flight record remains intact and linked
      const [flightInDb] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flight.id))
      expect(flightInDb).toBeDefined()
      expect(flightInDb.motorInventoryId).toBe(inv.id)

      // Disposal transaction created in ledger
      const [tx] = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(
          and(
            eq(schema.inventoryTransactions.motorInventoryId, inv.id),
            eq(schema.inventoryTransactions.transactionType, 'disposed'),
          ),
        )
      expect(tx).toBeDefined()
      expect(tx.quantity).toBe(2)
      expect(tx.userId).toBe(flyer.id)
      expect(tx.notes).toContain('Regulatory disposal')
    })

    it('performs regulatory disposal and soft-delete when 0 flights and 1 historical transaction exist', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'AeroTech J350W' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 5, disposedCount: 0 })

      // Seed 1 receipt custody transaction
      const receiptTx = await seedTestTransaction(flyer.id, {
        motorInventoryId: inv.id,
        transactionType: 'received',
        quantity: 5,
        notes: 'Initial magazine intake',
      })

      const res = await SELF.fetch(`https://example.com/inventory/motors/${inv.id}/delete`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.action).toBe('disposed')

      // Check DB: historical receipt transaction preserved AND new disposal transaction added
      const db = getDb()
      const allTxs = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.motorInventoryId, inv.id))
      expect(allTxs.length).toBe(2)

      const receiptInDb = allTxs.find((t) => t.id === receiptTx.id)
      expect(receiptInDb).toBeDefined()
      expect(receiptInDb?.transactionType).toBe('received')
      expect(receiptInDb?.quantity).toBe(5)

      const disposalInDb = allTxs.find((t) => t.transactionType === 'disposed')
      expect(disposalInDb).toBeDefined()
      expect(disposalInDb?.quantity).toBe(5)

      // Motor record soft-deleted
      const [invInDb] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))
      expect(invInDb.deletedAt).not.toBeNull()
      expect(invInDb.quantityOnHand).toBe(0)
      expect(invInDb.disposedCount).toBe(5)
    })

    it('preserves all records when motor has multiple flights (3) and multiple transactions (2)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'AeroTech K550W' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 1, disposedCount: 1 })

      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const site = await seedTestSite()

      // 3 flights
      const flight1 = await seedTestFlight(flyer.id, {
        motorInventoryId: inv.id,
        motorId: motor.id,
        rocketConfigurationId: config.id,
        flightNumber: 1,
      })
      const flight2 = await seedTestFlight(flyer.id, {
        motorInventoryId: inv.id,
        motorId: motor.id,
        rocketConfigurationId: config.id,
        flightNumber: 2,
      })
      const flight3 = await seedTestFlight(flyer.id, {
        motorInventoryId: inv.id,
        motorId: motor.id,
        rocketConfigurationId: config.id,
        flightNumber: 3,
      })

      // 2 historical transactions
      const tx1 = await seedTestTransaction(flyer.id, {
        motorInventoryId: inv.id,
        transactionType: 'received',
        quantity: 3,
      })
      const tx2 = await seedTestTransaction(flyer.id, {
        motorInventoryId: inv.id,
        transactionType: 'used',
        quantity: 1,
      })

      const res = await SELF.fetch(`https://example.com/inventory/motors/${inv.id}/delete`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.action).toBe('disposed')

      const db = getDb()
      // All 3 flights still exist and remain linked to inv.id
      const flightsInDb = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.motorInventoryId, inv.id))
      expect(flightsInDb.length).toBe(3)
      const flightIds = flightsInDb.map((f) => f.id)
      expect(flightIds).toContain(flight1.id)
      expect(flightIds).toContain(flight2.id)
      expect(flightIds).toContain(flight3.id)

      // 3 transactions total: 2 historical + 1 disposal
      const txsInDb = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.motorInventoryId, inv.id))
      expect(txsInDb.length).toBe(3)
      const disposalTx = txsInDb.find((t) => t.transactionType === 'disposed')
      expect(disposalTx).toBeDefined()
      expect(disposalTx?.quantity).toBe(1)

      // Motor soft deleted with disposedCount = 1 + 1 = 2
      const [invInDb] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))
      expect(invInDb.deletedAt).not.toBeNull()
      expect(invInDb.quantityOnHand).toBe(0)
      expect(invInDb.disposedCount).toBe(2)
    })

    it('hard deletes a motor with 0 quantity on hand when 0 flights and 0 transactions exist', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'Estes C6-5' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 0 })

      const res = await SELF.fetch(`https://example.com/inventory/motors/${inv.id}/delete`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.action).toBe('deleted')

      const db = getDb()
      const rows = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))
      expect(rows.length).toBe(0)
    })

    it('creates a 0-quantity disposal transaction and soft-deletes when quantity on hand is 0 but linked flights exist', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'AeroTech G40W' })
      const inv = await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 0,
        disposedCount: 2,
      })

      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      await seedTestFlight(flyer.id, {
        motorInventoryId: inv.id,
        motorId: motor.id,
        rocketConfigurationId: config.id,
      })

      const res = await SELF.fetch(`https://example.com/inventory/motors/${inv.id}/delete`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.action).toBe('disposed')

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))
      expect(updated.deletedAt).not.toBeNull()
      expect(updated.quantityOnHand).toBe(0)
      expect(updated.disposedCount).toBe(2) // 2 + 0

      // Disposal transaction has quantity 0
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
      expect(disposalTx.quantity).toBe(0)
    })

    it('excludes soft-deleted motors from active inventory views (GET /inventory, GET /inventory/motors, GET /motors)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'AeroTech H180W' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 3 })

      // Seed flight to trigger disposal
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      await seedTestFlight(flyer.id, {
        motorInventoryId: inv.id,
        motorId: motor.id,
        rocketConfigurationId: config.id,
      })

      // Soft delete via delete endpoint
      await SELF.fetch(`https://example.com/inventory/motors/${inv.id}/delete`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
      })

      // 1. GET /inventory JSON
      const invRes = await fetchGet('/inventory', {
        Accept: 'application/json',
        Cookie: `triplet_session=${token}`,
      })
      const invJson = (await invRes.json()) as any
      const activeIdsInHub = invJson.motors.map((m: any) => m.id)
      expect(activeIdsInHub).not.toContain(inv.id)

      // 2. GET /inventory/motors JSON
      const invMotorsRes = await fetchGet('/inventory/motors', {
        Accept: 'application/json',
        Cookie: `triplet_session=${token}`,
      })
      const invMotorsJson = (await invMotorsRes.json()) as any
      const activeIdsInInvMotors = invMotorsJson.motors.map((m: any) => m.id)
      expect(activeIdsInInvMotors).not.toContain(inv.id)

      // 3. GET /motors HTML catalog view: verify page renders and does not display this inventory item as active stock
      const motorsRes = await fetchGet('/motors', {
        Cookie: `triplet_session=${token}`,
      })
      expect(motorsRes.status).toBe(200)
      const motorsHtml = await motorsRes.text()
      expect(motorsHtml).toContain('Motor Catalog')
      expect(motorsHtml).not.toContain(`value="${inv.id}"`)

      // 4. Ledger verification: Recent transactions in /inventory JSON lists the disposal transaction
      const recentTxs = invJson.transactions || []
      const disposalInRecent = recentTxs.find(
        (tx: any) => tx.motorInventoryId === inv.id && tx.transactionType === 'disposed',
      )
      expect(disposalInRecent).toBeDefined()
      expect(disposalInRecent.quantity).toBe(3)
    })

    it('handles repeated deletion attempts: second attempt on hard-deleted motor returns 404', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor()
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 2 })

      // First attempt: succeeds with 200 deleted
      const res1 = await SELF.fetch(`https://example.com/inventory/motors/${inv.id}/delete`, {
        method: 'POST',
        headers: { Accept: 'application/json', Cookie: `triplet_session=${token}` },
      })
      expect(res1.status).toBe(200)
      const data1 = (await res1.json()) as any
      expect(data1.action).toBe('deleted')

      // Second attempt: returns 404
      const res2 = await SELF.fetch(`https://example.com/inventory/motors/${inv.id}/delete`, {
        method: 'POST',
        headers: { Accept: 'application/json', Cookie: `triplet_session=${token}` },
      })
      expect(res2.status).toBe(404)
    })

    it('handles repeated deletion attempts: second attempt on disposed motor returns 404 without double disposal', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor()
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 2, disposedCount: 0 })
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      await seedTestFlight(flyer.id, {
        motorInventoryId: inv.id,
        motorId: motor.id,
        rocketConfigurationId: config.id,
      })

      // First attempt: succeeds with 200 disposed
      const res1 = await SELF.fetch(`https://example.com/inventory/motors/${inv.id}/delete`, {
        method: 'POST',
        headers: { Accept: 'application/json', Cookie: `triplet_session=${token}` },
      })
      expect(res1.status).toBe(200)
      const data1 = (await res1.json()) as any
      expect(data1.action).toBe('disposed')

      // Second attempt: returns 404
      const res2 = await SELF.fetch(`https://example.com/inventory/motors/${inv.id}/delete`, {
        method: 'POST',
        headers: { Accept: 'application/json', Cookie: `triplet_session=${token}` },
      })
      expect(res2.status).toBe(404)

      // Ensure ledger has exactly 1 disposal transaction, not 2
      const db = getDb()
      const txs = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(
          and(
            eq(schema.inventoryTransactions.motorInventoryId, inv.id),
            eq(schema.inventoryTransactions.transactionType, 'disposed'),
          ),
        )
      expect(txs.length).toBe(1)
    })

    it('accumulates pre-existing disposedCount correctly when disposing positive quantity on hand', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor()
      const inv = await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 7,
        disposedCount: 5,
      })
      await seedTestTransaction(flyer.id, {
        motorInventoryId: inv.id,
        transactionType: 'received',
        quantity: 12,
      })

      const res = await SELF.fetch(`https://example.com/inventory/motors/${inv.id}/delete`, {
        method: 'POST',
        headers: { Accept: 'application/json', Cookie: `triplet_session=${token}` },
      })
      expect(res.status).toBe(200)

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))
      expect(updated.disposedCount).toBe(12) // 5 + 7
      expect(updated.quantityOnHand).toBe(0)
    })
  })

  describe('2. Batch Deletion Stress & Resiliency', () => {
    it('executes a large mixed batch of 30 motors (10 hard-delete, 10 flights, 10 transactions) accurately', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'Large Batch Test Motor' })
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)

      const hardDeleteIds: string[] = []
      const flightDisposalIds: string[] = []
      const txDisposalIds: string[] = []

      // 10 hard-delete items
      for (let i = 0; i < 10; i++) {
        const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: i + 1 })
        hardDeleteIds.push(inv.id)
      }

      // 10 items with flights
      for (let i = 0; i < 10; i++) {
        const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: i + 1 })
        await seedTestFlight(flyer.id, {
          motorInventoryId: inv.id,
          motorId: motor.id,
          rocketConfigurationId: config.id,
        })
        flightDisposalIds.push(inv.id)
      }

      // 10 items with custody transactions
      for (let i = 0; i < 10; i++) {
        const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: i + 1 })
        await seedTestTransaction(flyer.id, {
          motorInventoryId: inv.id,
          transactionType: 'received',
          quantity: i + 1,
        })
        txDisposalIds.push(inv.id)
      }

      const allIds = [...hardDeleteIds, ...flightDisposalIds, ...txDisposalIds]
      expect(allIds.length).toBe(30)

      const res = await SELF.fetch('https://example.com/inventory/motors/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({ ids: allIds }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.success).toBe(true)
      expect(body.deleted).toBe(10)
      expect(body.disposed).toBe(20)

      const db = getDb()

      // Verify all 10 hard-delete records are completely absent
      const remainingHardDeleted = await db
        .select()
        .from(schema.motorInventories)
        .where(inArray(schema.motorInventories.id, hardDeleteIds))
      expect(remainingHardDeleted.length).toBe(0)

      // Verify all 20 disposal records are soft-deleted with quantityOnHand = 0
      const disposalIds = [...flightDisposalIds, ...txDisposalIds]
      const remainingDisposed = await db
        .select()
        .from(schema.motorInventories)
        .where(inArray(schema.motorInventories.id, disposalIds))
      expect(remainingDisposed.length).toBe(20)
      for (const row of remainingDisposed) {
        expect(row.deletedAt).not.toBeNull()
        expect(row.quantityOnHand).toBe(0)
      }

      // Verify exactly 20 'disposed' transactions were created
      const disposalTxs = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(
          and(
            inArray(schema.inventoryTransactions.motorInventoryId, disposalIds),
            eq(schema.inventoryTransactions.transactionType, 'disposed'),
          ),
        )
      expect(disposalTxs.length).toBe(20)
    })

    it('deduplicates redundant IDs in batch request without double-disposing or inflating counts', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor()

      // Inv A: hard delete
      const invA = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 2 })

      // Inv B: disposal (with flight)
      const invB = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 3, disposedCount: 0 })
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      await seedTestFlight(flyer.id, {
        motorInventoryId: invB.id,
        motorId: motor.id,
        rocketConfigurationId: config.id,
      })

      // Send payload with triple duplicates of each ID
      const res = await SELF.fetch('https://example.com/inventory/motors/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({
          ids: [invA.id, invA.id, invA.id, invB.id, invB.id, invB.id],
        }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.success).toBe(true)
      expect(body.deleted).toBe(1)
      expect(body.disposed).toBe(1)

      const db = getDb()
      // Exactly 1 disposal transaction exists for Inv B
      const txs = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(
          and(
            eq(schema.inventoryTransactions.motorInventoryId, invB.id),
            eq(schema.inventoryTransactions.transactionType, 'disposed'),
          ),
        )
      expect(txs.length).toBe(1)
      expect(txs[0].quantity).toBe(3)

      const [invBInDb] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, invB.id))
      expect(invBInDb.disposedCount).toBe(3)
    })

    it('gracefully handles malformed IDs, empty strings, and SQL injection strings in batch payload', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor()
      const validInv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 1 })

      const maliciousOrMalformedIds = [
        '',
        '   ',
        'not-a-valid-uuid',
        '12345678',
        "'; DROP TABLE motor_inventories; --",
        '<script>alert("xss")</script>',
        'undefined',
        'null',
        validInv.id,
      ]

      const res = await SELF.fetch('https://example.com/inventory/motors/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({ ids: maliciousOrMalformedIds }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.success).toBe(true)
      expect(body.deleted).toBe(1) // Only validInv was deleted
      expect(body.disposed).toBe(0)

      // Verify table was NOT dropped and DB remains intact
      const db = getDb()
      const [deletedCheck] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, validInv.id))
      expect(deletedCheck).toBeUndefined()
    })

    it('safely skips already deleted/disposed motors during batch delete without throwing errors', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor()

      // Motor 1: Already soft-deleted in past
      const alreadyDisposed = await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 0,
        deletedAt: Date.now() - 50000,
        disposedCount: 5,
      })

      // Motor 2: Active hard-deletable motor
      const activeMotor = await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 2,
      })

      const res = await SELF.fetch('https://example.com/inventory/motors/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({ ids: [alreadyDisposed.id, activeMotor.id] }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.success).toBe(true)
      expect(body.deleted).toBe(1)
      expect(body.disposed).toBe(0)

      // Verify active motor was deleted and already-disposed was untouched
      const db = getDb()
      const [activeDb] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, activeMotor.id))
      expect(activeDb).toBeUndefined()

      const [disposedDb] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, alreadyDisposed.id))
      expect(disposedDb.disposedCount).toBe(5)
    })

    it('supports comma-separated string format in batch request payload', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor()

      const inv1 = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 1 })
      const inv2 = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 2 })

      const res = await SELF.fetch('https://example.com/inventory/motors/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({ ids: `${inv1.id}, ${inv2.id}` }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.success).toBe(true)
      expect(body.deleted).toBe(2)

      const db = getDb()
      const remaining = await db
        .select()
        .from(schema.motorInventories)
        .where(inArray(schema.motorInventories.id, [inv1.id, inv2.id]))
      expect(remaining.length).toBe(0)
    })

    it('handles empty batch requests via JSON and form data gracefully without state modification', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      // JSON empty
      const jsonRes = await SELF.fetch('https://example.com/inventory/motors/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({ ids: [] }),
      })
      expect(jsonRes.status).toBe(200)
      const jsonBody = (await jsonRes.json()) as any
      expect(jsonBody.success).toBe(true)
      expect(jsonBody.deleted).toBe(0)
      expect(jsonBody.disposed).toBe(0)

      // Form empty
      const formRes = await fetchPostForm(
        '/inventory/motors/batch-delete',
        {},
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect(formRes.status).toBe(303)
      expect(formRes.headers.get('location')).toBe('/inventory')
    })

    it('supports URL-encoded form data with multiple selected_ids and selected_ids[] keys', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor()

      const inv1 = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 2 })
      const inv2 = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 3 })

      const formBody = new URLSearchParams()
      formBody.append('selected_ids', inv1.id)
      formBody.append('selected_ids[]', inv2.id)

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

      const db = getDb()
      const remaining = await db
        .select()
        .from(schema.motorInventories)
        .where(inArray(schema.motorInventories.id, [inv1.id, inv2.id]))
      expect(remaining.length).toBe(0)
    })

    it('gracefully handles non-array and weird type payloads in JSON without throwing 500', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      // Payload with number
      const res1 = await SELF.fetch('https://example.com/inventory/motors/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({ ids: 99999 }),
      })
      expect(res1.status).toBe(200)

      // Payload with null
      const res2 = await SELF.fetch('https://example.com/inventory/motors/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({ selected_ids: null }),
      })
      expect(res2.status).toBe(200)

      // Empty object
      const res3 = await SELF.fetch('https://example.com/inventory/motors/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({}),
      })
      expect(res3.status).toBe(200)
    })
  })

  describe('3. Multi-Tenant Security & Tenant Isolation', () => {
    it('strictly forbids Flyer A from single-deleting Flyer B inventory via POST /inventory/motors/:id/delete (HTTP 403)', async () => {
      const flyerA = await seedTestUser({ email: 'pilot-a@example.com' })
      const flyerB = await seedTestUser({ email: 'pilot-b@example.com' })
      const tokenA = await signSession(flyerA.id)

      const motor = await seedTestMotor()
      const invB = await seedTestInventory(flyerB.id, motor.id, { quantityOnHand: 10 })

      // Flyer A attempts to delete Flyer B's motor
      const res = await SELF.fetch(`https://example.com/inventory/motors/${invB.id}/delete`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: `triplet_session=${tokenA}`,
        },
      })

      expect(res.status).toBe(403)
      const body = (await res.json()) as any
      expect(body.error).toContain('Unauthorized')

      // Assert Flyer B's motor is completely untouched
      const db = getDb()
      const [intact] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, invB.id))
      expect(intact).toBeDefined()
      expect(intact.deletedAt).toBeNull()
      expect(intact.quantityOnHand).toBe(10)
    })

    it('strictly forbids Flyer A from single-deleting Flyer B inventory via DELETE /inventory/motors/:id (HTTP 403)', async () => {
      const flyerA = await seedTestUser({ email: 'pilot-a2@example.com' })
      const flyerB = await seedTestUser({ email: 'pilot-b2@example.com' })
      const tokenA = await signSession(flyerA.id)

      const motor = await seedTestMotor()
      const invB = await seedTestInventory(flyerB.id, motor.id, { quantityOnHand: 8 })

      const res = await SELF.fetch(`https://example.com/inventory/motors/${invB.id}`, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          Cookie: `triplet_session=${tokenA}`,
        },
      })

      expect(res.status).toBe(403)

      const db = getDb()
      const [intact] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, invB.id))
      expect(intact).toBeDefined()
      expect(intact.deletedAt).toBeNull()
      expect(intact.quantityOnHand).toBe(8)
    })

    it('strictly isolates batch deletion: Flyer A cannot batch delete or dispose Flyer B motors in mixed payload', async () => {
      const flyerA = await seedTestUser({ email: 'alice@example.com' })
      const flyerB = await seedTestUser({ email: 'bob@example.com' })
      const tokenA = await signSession(flyerA.id)

      const motor = await seedTestMotor()
      const rocket = await seedTestRocket(flyerB.id)
      const config = await seedTestConfig(rocket.id)

      // Flyer A owns invA1 (hard-deletable) and invA2 (disposal with transaction)
      const invA1 = await seedTestInventory(flyerA.id, motor.id, { quantityOnHand: 2 })
      const invA2 = await seedTestInventory(flyerA.id, motor.id, { quantityOnHand: 3 })
      await seedTestTransaction(flyerA.id, {
        motorInventoryId: invA2.id,
        transactionType: 'received',
        quantity: 3,
      })

      // Flyer B owns invB1 (hard-deletable) and invB2 (disposal with flight)
      const invB1 = await seedTestInventory(flyerB.id, motor.id, { quantityOnHand: 4 })
      const invB2 = await seedTestInventory(flyerB.id, motor.id, { quantityOnHand: 5, disposedCount: 0 })
      await seedTestFlight(flyerB.id, {
        motorInventoryId: invB2.id,
        motorId: motor.id,
        rocketConfigurationId: config.id,
      })

      // Flyer A attacks with batch payload targeting all 4
      const res = await SELF.fetch('https://example.com/inventory/motors/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${tokenA}`,
        },
        body: JSON.stringify({
          ids: [invA1.id, invA2.id, invB1.id, invB2.id],
        }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.success).toBe(true)
      // Only Flyer A's motors were processed
      expect(body.deleted).toBe(1)
      expect(body.disposed).toBe(1)

      const db = getDb()

      // Flyer A's invA1 deleted, invA2 disposed
      const [dbA1] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, invA1.id))
      expect(dbA1).toBeUndefined()

      const [dbA2] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, invA2.id))
      expect(dbA2).toBeDefined()
      expect(dbA2.deletedAt).not.toBeNull()
      expect(dbA2.quantityOnHand).toBe(0)

      // Flyer B's invB1 and invB2 are COMPLETELY UNTOUCHED
      const [dbB1] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, invB1.id))
      expect(dbB1).toBeDefined()
      expect(dbB1.deletedAt).toBeNull()
      expect(dbB1.quantityOnHand).toBe(4)

      const [dbB2] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, invB2.id))
      expect(dbB2).toBeDefined()
      expect(dbB2.deletedAt).toBeNull()
      expect(dbB2.quantityOnHand).toBe(5)
      expect(dbB2.disposedCount).toBe(0)

      // No disposal transactions were generated for Flyer B
      const bTxs = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(
          and(
            eq(schema.inventoryTransactions.motorInventoryId, invB2.id),
            eq(schema.inventoryTransactions.transactionType, 'disposed'),
          ),
        )
      expect(bTxs.length).toBe(0)
    })

    it('ultimate composite stress: handles mixed tenants, duplicates, malformed IDs, and already-deleted records in a single batch', async () => {
      const flyerA = await seedTestUser({ email: 'composite-a@example.com' })
      const flyerB = await seedTestUser({ email: 'composite-b@example.com' })
      const tokenA = await signSession(flyerA.id)

      const motor = await seedTestMotor()
      const rocketA = await seedTestRocket(flyerA.id)
      const configA = await seedTestConfig(rocketA.id)
      const rocketB = await seedTestRocket(flyerB.id)
      const configB = await seedTestConfig(rocketB.id)

      // Flyer A motors
      const invA1 = await seedTestInventory(flyerA.id, motor.id, { quantityOnHand: 1 })
      const invA2 = await seedTestInventory(flyerA.id, motor.id, { quantityOnHand: 2, disposedCount: 0 })
      await seedTestFlight(flyerA.id, {
        motorInventoryId: invA2.id,
        motorId: motor.id,
        rocketConfigurationId: configA.id,
      })
      const invA3 = await seedTestInventory(flyerA.id, motor.id, { quantityOnHand: 3, disposedCount: 0 })
      await seedTestTransaction(flyerA.id, {
        motorInventoryId: invA3.id,
        transactionType: 'received',
        quantity: 3,
      })
      const invA_old = await seedTestInventory(flyerA.id, motor.id, {
        quantityOnHand: 0,
        deletedAt: Date.now() - 60000,
        disposedCount: 10,
      })

      // Flyer B motors
      const invB1 = await seedTestInventory(flyerB.id, motor.id, { quantityOnHand: 4 })
      const invB2 = await seedTestInventory(flyerB.id, motor.id, { quantityOnHand: 5, disposedCount: 0 })
      await seedTestFlight(flyerB.id, {
        motorInventoryId: invB2.id,
        motorId: motor.id,
        rocketConfigurationId: configB.id,
      })

      // Composite adversarial payload
      const payload = [
        invA1.id,
        invA1.id, // duplicate
        invA1.id, // duplicate
        invA2.id,
        invA2.id, // duplicate
        invA3.id,
        invA_old.id, // already deleted
        invB1.id, // Flyer B
        invB1.id, // Flyer B duplicate
        invB2.id, // Flyer B
        crypto.randomUUID(), // non-existent
        "'; DROP TABLE motor_inventories; --", // SQL injection
        'not-a-valid-uuid', // malformed
        '', // empty
        '   ', // whitespace
      ]

      const res = await SELF.fetch('https://example.com/inventory/motors/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${tokenA}`,
        },
        body: JSON.stringify({ ids: payload }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.success).toBe(true)
      expect(body.deleted).toBe(1) // invA1
      expect(body.disposed).toBe(2) // invA2 and invA3

      const db = getDb()

      // invA1 permanently hard-deleted
      const [dbA1] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, invA1.id))
      expect(dbA1).toBeUndefined()

      // invA2 and invA3 soft-deleted
      const [dbA2] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, invA2.id))
      expect(dbA2.deletedAt).not.toBeNull()
      expect(dbA2.quantityOnHand).toBe(0)
      expect(dbA2.disposedCount).toBe(2)

      const [dbA3] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, invA3.id))
      expect(dbA3.deletedAt).not.toBeNull()
      expect(dbA3.quantityOnHand).toBe(0)
      expect(dbA3.disposedCount).toBe(3)

      // invA_old unchanged
      const [dbAOld] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, invA_old.id))
      expect(dbAOld.disposedCount).toBe(10)

      // Flyer B motors completely untouched
      const [dbB1] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, invB1.id))
      expect(dbB1).toBeDefined()
      expect(dbB1.deletedAt).toBeNull()
      expect(dbB1.quantityOnHand).toBe(4)

      const [dbB2] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, invB2.id))
      expect(dbB2).toBeDefined()
      expect(dbB2.deletedAt).toBeNull()
      expect(dbB2.quantityOnHand).toBe(5)
      expect(dbB2.disposedCount).toBe(0)
    })
  })

  describe('4. Authentication & Route Gating Strictness', () => {
    it('redirects unauthenticated HTML requests to /login with 302 for single delete POST and DELETE verbs', async () => {
      // POST /inventory/motors/:id/delete
      const postRes = await SELF.fetch('https://example.com/inventory/motors/any-id/delete', {
        method: 'POST',
        headers: { Accept: 'text/html' },
        redirect: 'manual',
      })
      expect(postRes.status).toBe(302)
      expect(postRes.headers.get('location')).toContain('/login')

      // DELETE /inventory/motors/:id
      const deleteRes = await SELF.fetch('https://example.com/inventory/motors/any-id', {
        method: 'DELETE',
        headers: { Accept: 'text/html' },
        redirect: 'manual',
      })
      expect(deleteRes.status).toBe(302)
      expect(deleteRes.headers.get('location')).toContain('/login')
    })

    it('rejects unauthenticated JSON requests with 401 Unauthorized for single delete POST and DELETE verbs', async () => {
      // POST /inventory/motors/:id/delete
      const postRes = await SELF.fetch('https://example.com/inventory/motors/any-id/delete', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        redirect: 'manual',
      })
      expect(postRes.status).toBe(401)
      const postData = (await postRes.json()) as any
      expect(postData.error).toBe('Unauthorized')

      // DELETE /inventory/motors/:id
      const deleteRes = await SELF.fetch('https://example.com/inventory/motors/any-id', {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
        redirect: 'manual',
      })
      expect(deleteRes.status).toBe(401)
      const deleteData = (await deleteRes.json()) as any
      expect(deleteData.error).toBe('Unauthorized')
    })

    it('rejects unauthenticated batch delete requests with 302 (HTML) or 401 (JSON)', async () => {
      const htmlRes = await SELF.fetch('https://example.com/inventory/motors/batch-delete', {
        method: 'POST',
        headers: { Accept: 'text/html' },
        redirect: 'manual',
      })
      expect(htmlRes.status).toBe(302)
      expect(htmlRes.headers.get('location')).toContain('/login')

      const jsonRes = await SELF.fetch('https://example.com/inventory/motors/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ ids: ['some-id'] }),
        redirect: 'manual',
      })
      expect(jsonRes.status).toBe(401)
      const jsonData = (await jsonRes.json()) as any
      expect(jsonData.error).toBe('Unauthorized')
    })

    it('rejects requests with triplet_logged_out=1 cookie without deleting anything', async () => {
      const flyer = await seedTestUser()
      const motor = await seedTestMotor()
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 5 })

      const res = await SELF.fetch(`https://example.com/inventory/motors/${inv.id}/delete`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: 'triplet_logged_out=1',
        },
        redirect: 'manual',
      })

      expect(res.status).toBe(401)

      // Motor remains untouched in DB
      const db = getDb()
      const [intact] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))
      expect(intact).toBeDefined()
      expect(intact.deletedAt).toBeNull()
    })
  })
})
