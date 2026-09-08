/**
 * Forensic Integrity Audit Test Suite for Milestone 4
 * TripleT-Rocketry
 *
 * Verifies:
 * 1. Authentic SQLite D1 soft-delete for zero-quantity motor dismissal via Drizzle ORM (sets deletedAt, preserves inventoryTransactions ledger).
 * 2. Boundary and authorization enforcement for dismissal (quantityOnHand > 0 rejected with 400; unauthorized user rejected with 403).
 * 3. Authentic SQLite D1 CRUD for Storage Sites (schema.storageSites) with multi-user isolation.
 * 4. Genuine numeric threshold evaluation for SafeWork SA > 3.0 kg propellant limit (3.0 kg succeeds without permit, 3.001 kg rejected without permit, 3.001 kg succeeds with permit).
 * 5. Dynamic attribute and form structure genuineness (no hardcoded test data).
 */

import { and, eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { signSession } from '../src/services/auth'
import {
  getDb,
  seedTestInventory,
  seedTestMotor,
  seedTestTransaction,
  seedTestUser,
  truncateDb,
} from './helpers/db'
import { assertHtmlResponse } from './helpers/html'
import { fetchGet, fetchPostForm } from './helpers/http'

beforeEach(truncateDb)

describe('Forensic Integrity Audit: Milestone 4', () => {
  describe('Check 1: Genuine Soft-Delete & Preservation of Historical Ledger', () => {
    it('sets deletedAt in SQLite D1 and preserves historical inventory transactions intact', async () => {
      const flyer = await seedTestUser({ displayName: `Pilot-${crypto.randomUUID().slice(0, 8)}` })
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: `M-${crypto.randomUUID().slice(0, 6)}` })

      // Seed zero-quantity motor inventory
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 0 })

      // Seed 2 distinct historical custody transactions referencing this inventory
      const tx1Note = `Historical transaction 1 - ${crypto.randomUUID()}`
      const tx2Note = `Historical transaction 2 - ${crypto.randomUUID()}`
      await seedTestTransaction(flyer.id, {
        motorInventoryId: inv.id,
        transactionType: 'received',
        quantity: 5,
        notes: tx1Note,
      })
      await seedTestTransaction(flyer.id, {
        motorInventoryId: inv.id,
        transactionType: 'used',
        quantity: 5,
        notes: tx2Note,
      })

      const db = getDb()

      // Verify before dismissal: deletedAt is null
      const [beforeInv] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))
      expect(beforeInv.deletedAt).toBeNull()

      // Submit dismissal
      const res = await fetchPostForm(
        `/inventory/${inv.id}/dismiss`,
        {},
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(res.status)

      // Direct SQLite verification: deletedAt is now populated with recent timestamp
      const [afterInv] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))
      expect(afterInv.deletedAt).toBeTypeOf('number')
      expect(afterInv.deletedAt!).toBeGreaterThan(0)
      expect(afterInv.updatedAt).toBeTypeOf('number')

      // Direct SQLite verification: historical transactions are 100% preserved (not deleted or truncated)
      const txs = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.motorInventoryId, inv.id))
      expect(txs.length).toBe(2)
      expect(txs.some((t) => t.notes === tx1Note)).toBe(true)
      expect(txs.some((t) => t.notes === tx2Note)).toBe(true)

      // Verify active inventory UI: dismissed motor row is removed from active table, but transactions remain in ledger
      const hubRes = await fetchGet('/inventory', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(hubRes, 200)
      const hubHtml = await hubRes.text()
      expect(hubHtml).not.toContain(`id="inventory-row-${inv.id}"`)
      expect(hubHtml).toContain('No motors currently tracked in your inventory.')
      expect(hubHtml).toContain(tx1Note)
      expect(hubHtml).toContain(tx2Note)
    })
  })

  describe('Check 2: Dismissal Boundaries & Authorization Enforcement', () => {
    it('strictly rejects dismissal with HTTP 400 when quantityOnHand > 0 and does not set deletedAt', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor()
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 3 })

      const res = await fetchPostForm(
        `/inventory/${inv.id}/dismiss`,
        {},
        { Cookie: `triplet_session=${token}` },
      )
      expect(res.status).toBe(400)
      const text = await res.text()
      expect(text).toContain('Cannot dismiss motor inventory with quantity on hand greater than 0')

      // Direct SQLite check: deletedAt must remain null
      const db = getDb()
      const [after] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))
      expect(after.deletedAt).toBeNull()
    })

    it('rejects dismissal with HTTP 403 when another flyer attempts to dismiss it', async () => {
      const owner = await seedTestUser()
      const attacker = await seedTestUser()
      const attackerToken = await signSession(attacker.id)
      const motor = await seedTestMotor()
      const inv = await seedTestInventory(owner.id, motor.id, { quantityOnHand: 0 })

      const res = await fetchPostForm(
        `/inventory/${inv.id}/dismiss`,
        {},
        { Cookie: `triplet_session=${attackerToken}` },
      )
      expect(res.status).toBe(403)

      // Direct SQLite check: deletedAt must remain null
      const db = getDb()
      const [after] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))
      expect(after.deletedAt).toBeNull()
    })
  })

  describe('Check 3: Genuine Storage Sites SQLite CRUD via Drizzle ORM', () => {
    it('persists, updates, and soft-deletes storage sites directly in SQLite schema.storageSites', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const siteName = `Magazine-${crypto.randomUUID()}`
      const siteLocation = `Bay-${crypto.randomUUID().slice(0, 4)}`
      const initialCapacity = 2.75
      const siteNotes = `Audit Note ${crypto.randomUUID()}`

      // CREATE
      const createRes = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: siteName,
          location: siteLocation,
          capacity_kg: initialCapacity,
          notes: siteNotes,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 201, 302, 303]).toContain(createRes.status)

      // Direct SQLite check
      const db = getDb()
      const [created] = await db
        .select()
        .from(schema.storageSites)
        .where(and(eq(schema.storageSites.name, siteName), eq(schema.storageSites.userId, flyer.id)))

      expect(created).toBeDefined()
      expect(created.location).toBe(siteLocation)
      expect(created.capacityKg).toBe(initialCapacity)
      expect(created.notes).toBe(siteNotes)
      expect(created.permitNumber).toBeNull()
      expect(created.deletedAt).toBeNull()

      // LIST
      const listRes = await fetchGet('/inventory/storage-sites', { Cookie: cookie })
      assertHtmlResponse(listRes, 200)
      const listHtml = await listRes.text()
      expect(listHtml).toContain(siteName)
      expect(listHtml).toContain(siteLocation)
      expect(listHtml).toContain('2.75')

      // UPDATE
      const updatedName = `Updated-${siteName}`
      const updateRes = await fetchPostForm(
        `/inventory/storage-sites/${created.id}/edit`,
        {
          name: updatedName,
          location: 'Updated Bay 9',
          capacity_kg: 2.9,
          notes: 'Updated note',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(updateRes.status)

      const [updated] = await db
        .select()
        .from(schema.storageSites)
        .where(eq(schema.storageSites.id, created.id))
      expect(updated.name).toBe(updatedName)
      expect(updated.capacityKg).toBe(2.9)
      expect(updated.location).toBe('Updated Bay 9')

      // DELETE
      const deleteRes = await fetchPostForm(
        `/inventory/storage-sites/${created.id}/delete`,
        {},
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(deleteRes.status)

      // Direct SQLite check: soft deleted
      const [deleted] = await db
        .select()
        .from(schema.storageSites)
        .where(eq(schema.storageSites.id, created.id))
      expect(deleted.deletedAt).toBeTypeOf('number')
      expect(deleted.deletedAt!).toBeGreaterThan(0)

      // Verify removed from active list
      const listAfterDelete = await fetchGet('/inventory/storage-sites', { Cookie: cookie })
      const listAfterDeleteHtml = await listAfterDelete.text()
      expect(listAfterDeleteHtml).not.toContain(updatedName)
    })

    it('enforces tenant data isolation between multiple flyers', async () => {
      const flyer1 = await seedTestUser()
      const flyer2 = await seedTestUser()
      const token1 = await signSession(flyer1.id)
      const token2 = await signSession(flyer2.id)

      const db = getDb()
      const site1Name = `Secret-Flyer1-Site-${crypto.randomUUID()}`
      const [inserted] = await db
        .insert(schema.storageSites)
        .values({
          userId: flyer1.id,
          name: site1Name,
          capacityKg: 1.5,
        })
        .returning()

      // Flyer 2 views list: must NOT see Flyer 1's site
      const listRes2 = await fetchGet('/inventory/storage-sites', {
        Cookie: `triplet_session=${token2}`,
      })
      const listHtml2 = await listRes2.text()
      expect(listHtml2).not.toContain(site1Name)

      // Flyer 2 attempts to view Flyer 1's site: must return 404
      const viewRes2 = await fetchGet(`/inventory/storage-sites/${inserted.id}`, {
        Cookie: `triplet_session=${token2}`,
      })
      expect(viewRes2.status).toBe(404)
    })
  })

  describe('Check 4: Genuine SafeWork SA Numeric Threshold Evaluation (> 3.0 kg)', () => {
    it('allows capacity <= 3.0 kg without permit and rejects capacity > 3.0 kg without permit', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      // Boundary: exactly 3.00 kg -> SUCCEEDS without permit
      const exactBoundaryRes = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Threshold 3.00 Site',
          capacity_kg: 3.0,
          permit_number: '',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 201, 302, 303]).toContain(exactBoundaryRes.status)

      // Boundary: 3.001 kg -> FAILS with 400 without permit
      const slightExcessRes = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Threshold 3.001 Site',
          capacity_kg: 3.001,
          permit_number: '',
        },
        { Cookie: cookie },
      )
      expect(slightExcessRes.status).toBe(400)
      const errText = await slightExcessRes.text()
      expect(errText).toContain('SafeWork SA regulations require a propellant storage license/permit for storage capacity exceeding 3.0 kg')

      // Boundary: 3.001 kg -> SUCCEEDS when valid permit is provided
      const slightExcessWithPermitRes = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Threshold 3.001 Site With Permit',
          capacity_kg: 3.001,
          permit_number: 'SA-PERMIT-3001',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 201, 302, 303]).toContain(slightExcessWithPermitRes.status)

      // Whitespace permit on > 3.0 kg -> FAILS with 400
      const whitespacePermitRes = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Whitespace Permit Site',
          capacity_kg: 4.5,
          permit_number: '     ',
        },
        { Cookie: cookie },
      )
      expect(whitespacePermitRes.status).toBe(400)
    })
  })

  describe('Check 5: Form View Dynamic Compliance Script & No Facade Patterns', () => {
    it('renders client-side reactive threshold script and dismiss form buttons for zero stock', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      // Check new storage site form view
      const formRes = await fetchGet('/inventory/storage-sites/new', { Cookie: cookie })
      assertHtmlResponse(formRes, 200)
      const formHtml = await formRes.text()

      expect(formHtml).toContain('id="capacity_kg"')
      expect(formHtml).toContain('id="permit_number"')
      expect(formHtml).toContain('id="safework-compliance-callout"')
      expect(formHtml).toContain('checkSafeWorkCompliance')
      expect(formHtml).toContain('val > 3.0')
      expect(formHtml).toContain('permitInput.setAttribute(\'required\'')

      // Check inventory hub with zero-quantity motor renders dismiss button
      const motorZero = await seedTestMotor({ model: 'ZERO-MOTOR-1' })
      const motorPositive = await seedTestMotor({ model: 'POS-MOTOR-1' })
      const invZero = await seedTestInventory(flyer.id, motorZero.id, { quantityOnHand: 0 })
      const invPos = await seedTestInventory(flyer.id, motorPositive.id, { quantityOnHand: 5 })

      const hubRes = await fetchGet('/inventory', { Cookie: cookie })
      const hubHtml = await hubRes.text()

      // invZero must have dismiss form
      expect(hubHtml).toContain(`/inventory/${invZero.id}/dismiss`)
      expect(hubHtml).toContain('Dismiss')

      // invPos must NOT have dismiss form
      expect(hubHtml).not.toContain(`/inventory/${invPos.id}/dismiss`)
    })
  })
})
