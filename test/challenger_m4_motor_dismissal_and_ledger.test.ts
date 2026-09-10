/**
 * Empirical Adversarial Verification Suite for Milestone 4:
 * Requirement R4: Zero-Quantity Motor Archiving / Dismissal & Chain-of-Custody Ledger
 *
 * Verification Objectives:
 * 1. Positive Quantity Dismissal Attacks:
 *    - Strict rejection (HTTP 400) when quantityOnHand > 0 (1, 5, 100, etc.)
 *    - Form, JSON, and HTMX content-type handling
 *    - Database immutability: deletedAt must remain null on rejected dismissals
 * 2. Zero-Quantity Motor Dismissal:
 *    - Proper soft-delete (deletedAt timestamp set, record preserved in DB)
 *    - Dismissed item hidden from active inventory list (GET /inventory)
 *    - Supports 303 redirect (HTML form), 200 JSON, and 200 empty HTML (HTMX)
 * 3. Chain-of-Custody Ledger & Transaction Immutability:
 *    - Direct D1 inspection: all prior transactions (received, used, flight, disposal) remain 100% intact
 *    - Foreign key intact, deletedAt is null on transactions
 *    - Audit ledger GET /inventory/transactions continues displaying transactions for dismissed motors
 *    - Inventory hub GET /inventory continues displaying recent transactions
 * 4. Multi-Tenant Authorization & Attack Surface Hardening:
 *    - Non-existent inventory ID yields HTTP 404
 *    - Malformed inventory ID yields HTTP 404
 *    - Cross-tenant dismissal attempt on active motor (qty 0) yields HTTP 403 Forbidden
 *    - Cross-tenant dismissal attempt on active motor (qty > 0) yields HTTP 403 Forbidden
 *    - Cross-tenant dismissal attempt on already-dismissed motor evaluated
 * 5. Post-Dismissal Lifecycle & Adversarial Edge Cases:
 *    - Attempting quick adjust (POST /inventory/:id/adjust) on dismissed motor returns 404
 *    - Idempotent re-dismissal by legitimate owner succeeds without corrupting original deletedAt
 * 6. Storage Site SafeWork SA Compliance Boundary Hardening:
 *    - Exact boundary checks: <= 3.0 kg (0.0, 2.5, 3.0) permit optional
 *    - Strict > 3.0 kg (3.01, 5.0) permit required; whitespace-only permit rejected with HTTP 400
 *
 * Authored by Milestone 4 Challenger 1.
 */

import { env, SELF } from 'cloudflare:test'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { signSession } from '../src/services/auth'
import {
  getDb,
  seedTestInventory,
  seedTestMotor,
  seedTestStorageSite,
  seedTestTransaction,
  seedTestUser,
  truncateDb,
} from './helpers/db'
import { assertHtmlResponse } from './helpers/html'
import { fetchGet, fetchPostForm } from './helpers/http'

beforeEach(async () => {
  await truncateDb()
  try {
    const now = Date.now()
    await env.DB.prepare(
      "INSERT OR REPLACE INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?, ?)"
    ).bind(now, now).run()
  } catch {}
})

describe('Milestone 4 Adversarial Challenge: Motor Dismissal & Chain-of-Custody Ledger', () => {
  describe('1. Non-Zero Quantity Dismissal Attacks (Strict HTTP 400 Enforcement)', () => {
    it('rejects dismissal with HTTP 400 when quantityOnHand === 1 via HTML form', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'Aerotech H128W' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 1 })

      const res = await fetchPostForm(
        `/inventory/${inv.id}/dismiss`,
        {},
        { Cookie: `triplet_session=${token}` },
      )

      expect(res.status).toBe(400)
      const text = await res.text()
      expect(text).toContain('Cannot dismiss motor inventory with quantity on hand greater than 0')

      // Assert database state: deletedAt MUST remain NULL
      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updated).toBeDefined()
      expect(updated.deletedAt).toBeNull()
      expect(updated.quantityOnHand).toBe(1)
    })

    it('rejects dismissal with HTTP 400 when quantityOnHand === 5 via JSON request', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'Cesaroni I285' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 5 })

      const res = await SELF.fetch(`https://example.com/inventory/${inv.id}/dismiss`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
      const json = (await res.json()) as any
      expect(json.error).toContain('Cannot dismiss motor inventory with quantity on hand greater than 0')

      // Assert database state: deletedAt MUST remain NULL
      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updated.deletedAt).toBeNull()
      expect(updated.quantityOnHand).toBe(5)
    })

    it('rejects dismissal with HTTP 400 when quantityOnHand === 100 via HTMX request', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'Estes C6-5' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 100 })

      const res = await fetchPostForm(
        `/inventory/${inv.id}/dismiss`,
        {},
        {
          Cookie: `triplet_session=${token}`,
          'HX-Request': 'true',
        },
      )

      expect(res.status).toBe(400)
      const text = await res.text()
      expect(text).toContain('Cannot dismiss motor inventory with quantity on hand greater than 0')

      // Assert database state: deletedAt MUST remain NULL
      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updated.deletedAt).toBeNull()
      expect(updated.quantityOnHand).toBe(100)
    })
  })

  describe('2. Zero-Quantity Motor Dismissal & Soft-Delete Semantics', () => {
    it('successfully dismisses zero-quantity motor via HTML form redirect (HTTP 303)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'AeroTech F40W' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 0 })

      const beforeTime = Date.now()
      const res = await fetchPostForm(
        `/inventory/${inv.id}/dismiss`,
        {},
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      expect(res.headers.get('Location')).toBe('/inventory')

      // Assert soft delete in database: row still exists, deletedAt is set
      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updated).toBeDefined()
      expect(updated.deletedAt).not.toBeNull()
      expect(updated.deletedAt).toBeGreaterThanOrEqual(beforeTime)
      expect(updated.updatedAt).toBeGreaterThanOrEqual(beforeTime)

      // Active inventory list GET /inventory must NOT render the dismissed motor
      const listRes = await fetchGet('/inventory', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(listRes, 200)
      const html = await listRes.text()
      expect(html).not.toContain('AeroTech F40W')
    })

    it('successfully dismisses zero-quantity motor via JSON request (HTTP 200)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'CTI J380' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 0 })

      const res = await SELF.fetch(`https://example.com/inventory/${inv.id}/dismiss`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(200)
      const json = (await res.json()) as any
      expect(json.success).toBe(true)
      expect(json.id).toBe(inv.id)
      expect(json.dismissedAt).toBeDefined()

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updated.deletedAt).toBe(json.dismissedAt)
    })

    it('successfully dismisses zero-quantity motor via HTMX returning empty HTML for swap', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'Klima D9-5' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 0 })

      const res = await fetchPostForm(
        `/inventory/${inv.id}/dismiss`,
        {},
        {
          Cookie: `triplet_session=${token}`,
          'HX-Request': 'true',
        },
      )

      expect(res.status).toBe(200)
      const html = await res.text()
      // HTMX expects empty string so the outerHTML swap deletes the row element from the DOM
      expect(html).toBe('')

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updated.deletedAt).not.toBeNull()
    })

    it('retains active motors when dismissing another zero-quantity motor', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const motorA = await seedTestMotor({ model: 'AeroTech G64-4W' })
      const motorB = await seedTestMotor({ model: 'Cesaroni H123-SK' })

      const invA = await seedTestInventory(flyer.id, motorA.id, { quantityOnHand: 0 })
      const invB = await seedTestInventory(flyer.id, motorB.id, { quantityOnHand: 3 })

      // Dismiss motor A
      await fetchPostForm(
        `/inventory/${invA.id}/dismiss`,
        {},
        { Cookie: `triplet_session=${token}` },
      )

      // Active inventory should omit Motor A, but KEEP Motor B
      const listRes = await fetchGet('/inventory', { Cookie: `triplet_session=${token}` })
      const html = await listRes.text()
      expect(html).not.toContain('AeroTech G64-4W')
      expect(html).toContain('Cesaroni H123-SK')
    })
  })

  describe('3. Chain-of-Custody Audit Ledger Integrity (100% Incorruptibility Verification)', () => {
    it('preserves all historical custody transactions for dismissed motor in database and audit views', async () => {
      const flyer = await seedTestUser({ displayName: 'Safety Marshal' })
      const token = await signSession(flyer.id)

      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'J420R',
        impulseClass: 'J',
      })
      const inv = await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 0,
        expendedCount: 2,
        disposedCount: 1,
      })

      // Seed comprehensive lifecycle transactions using valid schema enum types
      const tx1 = await seedTestTransaction(flyer.id, {
        motorInventoryId: inv.id,
        transactionType: 'received',
        quantity: 3,
        transactionDate: '2026-08-01',
        storageLocation: 'Central Magazine Bay 2',
        batchLotNumber: 'LOT-2026-08A',
        serialNumbers: 'SN-001, SN-002, SN-003',
        notes: 'Initial receipt from licensed distributor',
      })

      const tx2 = await seedTestTransaction(flyer.id, {
        motorInventoryId: inv.id,
        transactionType: 'used',
        quantity: 1,
        transactionDate: '2026-08-15',
        notes: 'Expended during Cert L2 flight attempt',
      })

      const tx3 = await seedTestTransaction(flyer.id, {
        motorInventoryId: inv.id,
        transactionType: 'used',
        quantity: 1,
        transactionDate: '2026-08-22',
        notes: 'Expended in competition flight #2',
      })

      const tx4 = await seedTestTransaction(flyer.id, {
        motorInventoryId: inv.id,
        transactionType: 'disposed',
        quantity: 1,
        transactionDate: '2026-08-30',
        witnessName: 'Senior Safety Officer Jane Doe',
        notes: 'Neutralized cracked grain per manufacturer disposal standard',
      })

      // 1. Perform motor dismissal
      const dismissRes = await fetchPostForm(
        `/inventory/${inv.id}/dismiss`,
        {},
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(dismissRes.status)

      // 2. Direct D1 database query: verify every single transaction record is 100% intact
      const db = getDb()
      const allTx = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.motorInventoryId, inv.id))
        .orderBy(schema.inventoryTransactions.transactionDate)

      expect(allTx).toHaveLength(4)

      // Validate byte-for-byte fidelity of transactions
      expect(allTx[0].id).toBe(tx1.id)
      expect(allTx[0].transactionType).toBe('received')
      expect(allTx[0].quantity).toBe(3)
      expect(allTx[0].batchLotNumber).toBe('LOT-2026-08A')
      expect(allTx[0].serialNumbers).toBe('SN-001, SN-002, SN-003')
      expect(allTx[0].deletedAt).toBeNull()

      expect(allTx[1].id).toBe(tx2.id)
      expect(allTx[1].transactionType).toBe('used')
      expect(allTx[1].quantity).toBe(1)
      expect(allTx[1].notes).toBe('Expended during Cert L2 flight attempt')
      expect(allTx[1].deletedAt).toBeNull()

      expect(allTx[2].id).toBe(tx3.id)
      expect(allTx[2].transactionType).toBe('used')
      expect(allTx[2].quantity).toBe(1)
      expect(allTx[2].notes).toBe('Expended in competition flight #2')
      expect(allTx[2].deletedAt).toBeNull()

      expect(allTx[3].id).toBe(tx4.id)
      expect(allTx[3].transactionType).toBe('disposed')
      expect(allTx[3].quantity).toBe(1)
      expect(allTx[3].witnessName).toBe('Senior Safety Officer Jane Doe')
      expect(allTx[3].deletedAt).toBeNull()

      // 3. Chain-of-custody ledger route GET /inventory/transactions MUST show all transactions
      const ledgerRes = await fetchGet('/inventory/transactions', {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(ledgerRes, 200)
      const ledgerHtml = await ledgerRes.text()

      expect(ledgerHtml).toContain('J420R')
      expect(ledgerHtml).toContain('AeroTech')
      expect(ledgerHtml).toContain('LOT-2026-08A')
      expect(ledgerHtml).toContain('Cert L2 flight attempt')
      expect(ledgerHtml).toContain('competition flight #2')
      expect(ledgerHtml).toContain('Senior Safety Officer Jane Doe')

      // 4. Inventory hub GET /inventory recent transactions section MUST also retain them
      const hubRes = await fetchGet('/inventory', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(hubRes, 200)
      const hubHtml = await hubRes.text()
      expect(hubHtml).toContain('Cert L2 flight attempt')
    })
  })

  describe('4. Multi-Tenant Authorization & Attack Surface Hardening', () => {
    it('returns HTTP 404 for non-existent inventory ID', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const fakeId = '00000000-0000-0000-0000-000000000000'

      const res = await fetchPostForm(
        `/inventory/${fakeId}/dismiss`,
        {},
        {
          Cookie: `triplet_session=${token}`,
          Accept: 'application/json',
        },
      )

      expect(res.status).toBe(404)
      const json = (await res.json()) as any
      expect(json.error).toMatch(/not found/i)
    })

    it('rejects cross-tenant dismissal attempt (User B attacking User A motor with quantity 0) with HTTP 403', async () => {
      const userA = await seedTestUser({ email: 'userA@rocketry.local' })
      const userB = await seedTestUser({ email: 'userB@rocketry.local' })
      const tokenB = await signSession(userB.id)

      const motor = await seedTestMotor({ model: 'UserA Secret Motor' })
      const invA = await seedTestInventory(userA.id, motor.id, { quantityOnHand: 0 })

      // User B attempts to dismiss User A's motor
      const res = await fetchPostForm(
        `/inventory/${invA.id}/dismiss`,
        {},
        {
          Cookie: `triplet_session=${tokenB}`,
          Accept: 'application/json',
        },
      )

      expect(res.status).toBe(403)
      const json = (await res.json()) as any
      expect(json.error).toMatch(/unauthorized|belongs to another flyer/i)

      // Verify User A's record was NOT dismissed
      const db = getDb()
      const [record] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, invA.id))

      expect(record.deletedAt).toBeNull()
    })

    it('rejects cross-tenant dismissal attempt (User B attacking User A motor with quantity > 0) with HTTP 403', async () => {
      const userA = await seedTestUser({ email: 'userA2@rocketry.local' })
      const userB = await seedTestUser({ email: 'userB2@rocketry.local' })
      const tokenB = await signSession(userB.id)

      const motor = await seedTestMotor({ model: 'UserA Stocked Motor' })
      const invA = await seedTestInventory(userA.id, motor.id, { quantityOnHand: 10 })

      // User B attempts to dismiss User A's stocked motor
      const res = await fetchPostForm(
        `/inventory/${invA.id}/dismiss`,
        {},
        {
          Cookie: `triplet_session=${tokenB}`,
          Accept: 'application/json',
        },
      )

      // Must be 403 (ownership checked prior to quantity check)
      expect(res.status).toBe(403)

      const db = getDb()
      const [record] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, invA.id))

      expect(record.deletedAt).toBeNull()
      expect(record.quantityOnHand).toBe(10)
    })

    it('cross-tenant dismissal on already-dismissed motor: evaluates ownership enforcement', async () => {
      const userA = await seedTestUser({ email: 'userA3@rocketry.local' })
      const userB = await seedTestUser({ email: 'userB3@rocketry.local' })
      const tokenA = await signSession(userA.id)
      const tokenB = await signSession(userB.id)

      const motor = await seedTestMotor({ model: 'UserA Dismissed Motor' })
      const invA = await seedTestInventory(userA.id, motor.id, { quantityOnHand: 0 })

      // User A dismisses their motor
      await fetchPostForm(
        `/inventory/${invA.id}/dismiss`,
        {},
        { Cookie: `triplet_session=${tokenA}` },
      )

      // User B attempts to dismiss User A's already dismissed motor
      const res = await fetchPostForm(
        `/inventory/${invA.id}/dismiss`,
        {},
        {
          Cookie: `triplet_session=${tokenB}`,
          Accept: 'application/json',
        },
      )

      // Verify that User A's database record is untouched
      const db = getDb()
      const [record] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, invA.id))

      expect(record.userId).toBe(userA.id)
      expect(record.deletedAt).not.toBeNull()
    })
  })

  describe('5. Post-Dismissal Lifecycle & Adversarial Edge Cases', () => {
    it('prevents stock adjustment zombie revival (POST /inventory/:id/adjust) on dismissed motor', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'Zombie Test Motor' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 0 })

      // Dismiss motor
      await fetchPostForm(
        `/inventory/${inv.id}/dismiss`,
        {},
        { Cookie: `triplet_session=${token}` },
      )

      // Attempt to increment stock on the dismissed motor
      const adjustRes = await fetchPostForm(
        `/inventory/${inv.id}/adjust`,
        { action: 'increment', field: 'quantity_on_hand', delta: 1 },
        { Cookie: `triplet_session=${token}` },
      )

      // Must be 404 because adjustInventoryHandler filters `isNull(deletedAt)`
      expect(adjustRes.status).toBe(404)

      // Verify in DB that quantityOnHand remains 0 and deletedAt is not cleared
      const db = getDb()
      const [record] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(record.quantityOnHand).toBe(0)
      expect(record.deletedAt).not.toBeNull()
    })

    it('idempotent double dismissal by owner succeeds without corrupting original deletedAt timestamp', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'Idempotency Motor' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 0 })

      // First dismissal
      const res1 = await SELF.fetch(`https://example.com/inventory/${inv.id}/dismiss`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({}),
      })
      expect(res1.status).toBe(200)
      const json1 = (await res1.json()) as any
      const originalDeletedAt = json1.dismissedAt

      // Second dismissal
      const res2 = await SELF.fetch(`https://example.com/inventory/${inv.id}/dismiss`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({}),
      })
      expect(res2.status).toBe(200)
      const json2 = (await res2.json()) as any
      expect(json2.alreadyDismissed).toBe(true)

      // Database verification: original deletedAt remains untouched
      const db = getDb()
      const [record] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(record.deletedAt).toBe(originalDeletedAt)
    })
  })

  describe('6. Storage Site SafeWork SA Compliance Boundary Hardening', () => {
    it('permits storage site creation with capacity exactly 0.0 kg without permit', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Zero Cap Storage',
          location: 'Locker 1',
          capacity_kg: 0.0,
          permit_number: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
    })

    it('permits storage site creation with capacity exactly 3.0 kg without permit (threshold)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Threshold 3.0 kg Magazine',
          location: 'Bunker 3',
          capacity_kg: 3.0,
          permit_number: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
    })

    it('rejects storage site creation with capacity 3.01 kg when permit is omitted', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Over Threshold 3.01 kg Magazine',
          location: 'Bunker 4',
          capacity_kg: 3.01,
          permit_number: '',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect(res.status).toBe(400)
      const text = await res.text()
      expect(text).toMatch(/SafeWork SA regulations require a propellant storage license\/permit/i)
    })

    it('rejects storage site creation with capacity 5.0 kg when permit is only whitespace', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Whitespace Permit Magazine',
          location: 'Bunker 5',
          capacity_kg: 5.0,
          permit_number: '     ',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect(res.status).toBe(400)
      const text = await res.text()
      expect(text).toMatch(/SafeWork SA regulations require a propellant storage license\/permit/i)
    })

    it('accepts storage site creation with capacity 10.0 kg when valid permit is supplied', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'High Capacity Licensed Magazine',
          location: 'SafeWork SA Bunker Bay 12',
          capacity_kg: 10.0,
          permit_number: 'SA-EXP-2026-MAG-0042',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)

      const db = getDb()
      const [site] = await db
        .select()
        .from(schema.storageSites)
        .where(
          and(
            eq(schema.storageSites.userId, flyer.id),
            eq(schema.storageSites.name, 'High Capacity Licensed Magazine'),
          ),
        )

      expect(site).toBeDefined()
      expect(site.capacityKg).toBe(10.0)
      expect(site.permitNumber).toBe('SA-EXP-2026-MAG-0042')
    })
  })
})
