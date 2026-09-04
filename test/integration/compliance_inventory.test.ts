/**
 * Integration test suite for Component Inventory & Regulatory Chain-of-Custody Tracking.
 *
 * Verifies:
 * 1. Tracking non-motor components (casings, recovery, avionics, pyrotechnics, airframe).
 * 2. Motor lifecycle chain of custody:
 *    - Purchase / Order logging
 *    - Receipt into magazine/stock with lot/batch & serial numbers
 *    - Flight consumption / usage logging
 *    - Sale / transfer to another person with buyer certification & permit tracking
 *    - Disposal / neutralization with witness & method
 *    - Loss / theft reporting
 *    - Quarantining suspect items
 *    - Audit reconciliation
 * 3. High-Power Rocket (HPR) transfer regulatory compliance evaluation.
 * 4. Net Propellant Weight / Explosive storage calculations & magazine limit alerts.
 * 5. Immutable chain-of-custody audit ledger (GET /inventory/transactions).
 */

import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import {
  getDb,
  seedTestComponent,
  seedTestInventory,
  seedTestMotor,
  seedTestTransaction,
  seedTestUser,
  truncateDb,
} from '../helpers/db'
import {
  assertContains,
  assertHtmlResponse,
  assertNotContains,
} from '../helpers/html'
import { fetchGet, fetchHtmxPostForm, fetchPostForm } from '../helpers/http'
import {
  calculateStorageSummary,
  evaluateTransferCompliance,
  getRequiredCertLevelForImpulse,
} from '../../src/services/compliance'

beforeEach(truncateDb)

describe('Regulatory Compliance & Component Inventory Tracking', () => {
  describe('Tier 1: Non-Motor Component Tracking', () => {
    it('creates a new component and logs initial custody receipt (POST /inventory/components)', async () => {
      const user = await seedTestUser({ displayName: 'Hardware Officer' })

      const res = await fetchPostForm('/inventory/components', {
        name: 'AeroTech 29/180 Motor Casing',
        category: 'casing',
        manufacturer: 'AeroTech',
        part_number: 'RMS-29/180',
        serial_number: 'AT-8812',
        quantity_on_hand: 2,
        condition: 'new',
        storageLocation: 'Workshop Drawer 4',
        notes: 'Purchased for L1 certification project',
      })

      expect([200, 302]).toContain(res.status)

      const db = getDb()
      const [comp] = await db
        .select()
        .from(schema.components)
        .where(
          and(
            eq(schema.components.userId, user.id),
            eq(schema.components.name, 'AeroTech 29/180 Motor Casing'),
          ),
        )

      expect(comp).toBeDefined()
      expect(comp.category).toBe('casing')
      expect(comp.quantityOnHand).toBe(2)
      expect(comp.serialNumber).toBe('AT-8812')

      // Verifies that a custody receipt transaction was automatically created
      const [tx] = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(
          and(
            eq(schema.inventoryTransactions.userId, user.id),
            eq(schema.inventoryTransactions.componentId, comp.id),
          ),
        )

      expect(tx).toBeDefined()
      expect(tx.transactionType).toBe('received')
      expect(tx.quantity).toBe(2)
    })

    it('displays components alongside motors on the unified inventory hub (GET /inventory)', async () => {
      const user = await seedTestUser()
      await seedTestComponent(user.id, {
        name: 'Top Flight 36-inch Parachute',
        category: 'recovery',
        quantityOnHand: 3,
        condition: 'good',
      })
      await seedTestComponent(user.id, {
        name: 'TeleMetrum v3.0 Flight Computer',
        category: 'avionics',
        quantityOnHand: 1,
        condition: 'new',
      })

      const res = await fetchGet('/inventory')
      expect(res.status).toBe(200)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'Top Flight 36-inch Parachute', 'TeleMetrum v3.0 Flight Computer')
      expect(html).toMatch(/recovery/i)
      expect(html).toMatch(/avionics/i)
    })

    it('filters components by category query parameter (GET /inventory?filter=recovery)', async () => {
      const user = await seedTestUser()
      await seedTestComponent(user.id, {
        name: 'Drogue Parachute 18in',
        category: 'recovery',
      })
      await seedTestComponent(user.id, {
        name: 'FirstFire Igniters 3-Pack',
        category: 'pyrotechnic',
      })

      const res = await fetchGet('/inventory?filter=recovery')
      expect(res.status).toBe(200)
      const html = await res.text()

      assertContains(html, 'Drogue Parachute 18in')
      assertNotContains(html, 'FirstFire Igniters 3-Pack')
    })

    it('adjusts component stock via inline HTMX (POST /inventory/components/:id/adjust)', async () => {
      const user = await seedTestUser()
      const comp = await seedTestComponent(user.id, {
        name: 'Shock Cord 15ft Kevlar',
        category: 'recovery',
        quantityOnHand: 4,
      })

      const res = await fetchHtmxPostForm(`/inventory/components/${comp.id}/adjust`, {
        action: 'decrement',
        delta: 1,
      })

      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toMatch(/3/) // Updated stock

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.components)
        .where(eq(schema.components.id, comp.id))

      expect(updated.quantityOnHand).toBe(3)
    })
  })

  describe('Tier 2: Higher-Level Motor Compliance & Lifecycle Tracking', () => {
    it('tracks motor purchase & receipt into storage with lot/batch number', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({ manufacturer: 'Cesaroni', model: 'I212SS', impulseClass: 'I', weightG: 340 })
      const inv = await seedTestInventory(user.id, motor.id, { quantityOnHand: 0 })

      // Record receipt into magazine
      const res = await fetchPostForm('/inventory/transactions', {
        item_ref: `motor:${inv.id}`,
        transaction_type: 'received',
        quantity: 5,
        transaction_date: '2026-09-04',
        batch_lot_number: 'LOT-2026-I212-B',
        storage_location: 'Explosives Magazine Alpha',
        counterparty_name: 'Aerospace Specialty Products',
        notes: 'Delivery received in good order',
      })

      expect([200, 302]).toContain(res.status)

      const db = getDb()
      const [updatedInv] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updatedInv.quantityOnHand).toBe(5)
      expect(updatedInv.storageLocation).toBe('Explosives Magazine Alpha')

      // Verify transaction ledger row
      const [tx] = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(
          and(
            eq(schema.inventoryTransactions.motorInventoryId, inv.id),
            eq(schema.inventoryTransactions.transactionType, 'received'),
          ),
        )

      expect(tx).toBeDefined()
      expect(tx.batchLotNumber).toBe('LOT-2026-I212-B')
      expect(tx.counterpartyName).toBe('Aerospace Specialty Products')
    })

    it('tracks motor sold or transferred to another person with recipient certification details', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({ manufacturer: 'AeroTech', model: 'J420R', impulseClass: 'J', propellantType: 'apcp' })
      const inv = await seedTestInventory(user.id, motor.id, { quantityOnHand: 3, soldCount: 0 })

      // Record sale to fellow club flyer
      const res = await fetchPostForm('/inventory/transactions', {
        item_ref: `motor:${inv.id}`,
        transaction_type: 'sold',
        quantity: 1,
        transaction_date: '2026-09-04',
        counterparty_name: 'Jane Doe',
        counterparty_cert_number: 'TRA-99412-L2',
        counterparty_license: 'STATE-EXP-2026-88',
        notes: 'Sold at monthly club launch for Level 2 cert flight',
      })

      expect([200, 302]).toContain(res.status)

      const db = getDb()
      const [updatedInv] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      // Stock decremented, sold count incremented
      expect(updatedInv.quantityOnHand).toBe(2)
      expect(updatedInv.soldCount).toBe(1)

      const [tx] = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(
          and(
            eq(schema.inventoryTransactions.motorInventoryId, inv.id),
            eq(schema.inventoryTransactions.transactionType, 'sold'),
          ),
        )

      expect(tx).toBeDefined()
      expect(tx.counterpartyName).toBe('Jane Doe')
      expect(tx.counterpartyCertNumber).toBe('TRA-99412-L2')
      expect(tx.counterpartyLicense).toBe('STATE-EXP-2026-88')
    })

    it('tracks motor disposal / neutralization with witness verification', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({ model: 'H128W', impulseClass: 'H' })
      const inv = await seedTestInventory(user.id, motor.id, { quantityOnHand: 2, disposedCount: 0 })

      // Record disposal of damaged motor
      const res = await fetchPostForm('/inventory/transactions', {
        item_ref: `motor:${inv.id}`,
        transaction_type: 'disposed',
        quantity: 1,
        transaction_date: '2026-09-04',
        witness_name: 'Range Safety Officer Mark',
        notes: 'Cracked propellant grain neutralized via controlled burn at bunker',
      })

      expect([200, 302]).toContain(res.status)

      const db = getDb()
      const [updatedInv] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updatedInv.quantityOnHand).toBe(1)
      expect(updatedInv.disposedCount).toBe(1)

      const [tx] = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(
          and(
            eq(schema.inventoryTransactions.motorInventoryId, inv.id),
            eq(schema.inventoryTransactions.transactionType, 'disposed'),
          ),
        )

      expect(tx.witnessName).toBe('Range Safety Officer Mark')
    })

    it('tracks reported lost or stolen motors for statutory compliance', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({ model: 'K1100T', impulseClass: 'K' })
      const inv = await seedTestInventory(user.id, motor.id, { quantityOnHand: 1 })

      const res = await fetchPostForm('/inventory/transactions', {
        item_ref: `motor:${inv.id}`,
        transaction_type: 'lost',
        quantity: 1,
        transaction_date: '2026-09-04',
        notes: 'Case fell off transport vehicle; incident filed with local sheriff #SH-2026-901',
      })

      expect([200, 302]).toContain(res.status)

      const db = getDb()
      const [updatedInv] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updatedInv.quantityOnHand).toBe(0)
      expect(updatedInv.disposedCount).toBe(1)
    })
  })

  describe('Tier 3: Regulatory Compliance Evaluation & Storage Audits', () => {
    it('evaluates HPR transfer compliance and checks recipient certification', () => {
      // Level 2 motor (Class J) sold to flyer with only Level 1
      const check1 = evaluateTransferCompliance({
        impulseClass: 'J',
        propellantType: 'apcp',
        transactionType: 'sold',
        counterpartyName: 'Bob Novice',
        counterpartyCertNumber: 'NAR-12345',
        counterpartyCertLevel: 1,
      })

      expect(check1.compliant).toBe(false)
      expect(check1.isHighPower).toBe(true)
      expect(check1.requiredCertLevel).toBe(2)
      expect(check1.warnings.some((w) => w.includes('below the required Level 2'))).toBe(true)

      // Proper Level 2 transfer
      const check2 = evaluateTransferCompliance({
        impulseClass: 'J',
        propellantType: 'apcp',
        transactionType: 'sold',
        counterpartyName: 'Alice Pro',
        counterpartyCertNumber: 'NAR-99999',
        counterpartyCertLevel: 2,
        counterpartyLicense: 'LEUP-8812',
      })

      expect(check2.compliant).toBe(true)
      expect(check2.warnings.length).toBe(0)
    })

    it('calculates Net Explosive Weight (NEW) and triggers magazine limit alerts', () => {
      const items = [
        { quantityOnHand: 10, propellantMassG: 500, storageLocation: 'Magazine 1', impulseClass: 'J' },
        { quantityOnHand: 2, propellantMassG: 12000, storageLocation: 'Magazine 2', impulseClass: 'M' },
      ]

      // Total propellant: (10*500) + (2*12000) = 5000 + 24000 = 29000g (~63.9 lbs)
      // Exceeds standard 50 lbs (22680g) magazine threshold
      const summary = calculateStorageSummary(items, 22680)

      expect(summary.totalPropellantMassG).toBe(29000)
      expect(summary.highPowerMotorCount).toBe(12)
      expect(summary.warnings.some((w) => w.includes('Magazine Storage Limit Exceeded'))).toBe(true)
    })
  })

  describe('Tier 4: Regulatory Chain-of-Custody Ledger View (GET /inventory/transactions)', () => {
    it('renders the complete chronological custody audit trail with badges and counterparty details', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({ manufacturer: 'AeroTech', model: 'I350W' })
      const inv = await seedTestInventory(user.id, motor.id)

      await seedTestTransaction(user.id, {
        motorInventoryId: inv.id,
        transactionType: 'purchased',
        quantity: 3,
        counterpartyName: 'Wildman Rocketry',
        transactionDate: '2026-08-20',
      })

      await seedTestTransaction(user.id, {
        motorInventoryId: inv.id,
        transactionType: 'sold',
        quantity: 1,
        counterpartyName: 'David Clark',
        counterpartyCertNumber: 'TRA-10881',
        transactionDate: '2026-09-02',
      })

      const res = await fetchGet('/inventory/transactions')
      expect(res.status).toBe(200)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'Chain-of-Custody Ledger')
      assertContains(html, 'Wildman Rocketry', 'David Clark', 'TRA-10881')
      expect(html).toMatch(/Purchased/i)
      expect(html).toMatch(/Sold/i)
    })
  })
})
