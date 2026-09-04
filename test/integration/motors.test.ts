/**
 * Integration test suite for Motor Catalog Browsing & User Inventory Tracking.
 * Tests catalog listing, impulse class filtering (A-O), detailed specs view,
 * inventory listing, adding motors to inventory, and inline HTMX stock adjustments.
 */

import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import {
  getDb,
  seedTestInventory,
  seedTestMotor,
  seedTestUser,
  truncateDb,
} from '../helpers/db'
import {
  assertContains,
  assertHtmlResponse,
  assertNotContains,
} from '../helpers/html'
import { fetchGet, fetchHtmxPostForm, fetchPostForm } from '../helpers/http'

beforeEach(truncateDb)

describe('Motor Catalog & Inventory Workflows (Milestone 3)', () => {
  describe('Tier 1: Motor Catalog Listing (GET /motors)', () => {
    it('returns HTTP 200 with HTML content for motor catalog', async () => {
      const res = await fetchGet('/motors')
      expect(res.status).toBe(200)
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/motor/i)
      expect(html).toMatch(/catalog/i)
    })

    it('renders seeded motors with manufacturer, model, and impulse class', async () => {
      await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'Pro29 3G',
        impulseClass: 'G',
        totalImpulseNs: 140.0,
      })
      await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'I200W',
        impulseClass: 'I',
        totalImpulseNs: 420.0,
      })

      const res = await fetchGet('/motors')
      expect(res.status).toBe(200)
      const html = await res.text()
      assertContains(html, 'Cesaroni', 'Pro29 3G', 'AeroTech', 'I200W')
      expect(html).toMatch(/140(\.0)?\s*N·s/)
      expect(html).toMatch(/420(\.0)?\s*N·s/)
    })
  })

  describe('Tier 2: Impulse Class Filtering (GET /motors?impulse_class=X)', () => {
    it('filters motors by impulse class parameter', async () => {
      await seedTestMotor({
        manufacturer: 'Estes',
        model: 'C6-5',
        impulseClass: 'C',
      })
      await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'H128W',
        impulseClass: 'H',
      })

      // Query specifically for class H
      const resH = await fetchGet('/motors?impulse_class=H')
      expect(resH.status).toBe(200)
      const htmlH = await resH.text()
      assertContains(htmlH, 'H128W')
      assertNotContains(htmlH, 'C6-5')

      // Query specifically for class C
      const resC = await fetchGet('/motors?impulse_class=C')
      expect(resC.status).toBe(200)
      const htmlC = await resC.text()
      assertContains(htmlC, 'C6-5')
      assertNotContains(htmlC, 'H128W')
    })

    it('displays empty state message when filtering returns no results', async () => {
      await seedTestMotor({
        manufacturer: 'Estes',
        model: 'A8-3',
        impulseClass: 'A',
      })

      const res = await fetchGet('/motors?impulse_class=O')
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toMatch(/No Motors Found/i)
    })
  })

  describe('Tier 3: Motor Detail View (GET /motors/:id)', () => {
    it('returns full specs view for a specific motor', async () => {
      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'K550W',
        impulseClass: 'K',
        totalImpulseNs: 1800.0,
        averageThrustN: 550.0,
        maxThrustN: 720.0,
        burnTimeS: 3.2,
        delayS: 14,
        diameterMm: 54,
        weightG: 1420.0,
        casingReusable: true,
        certifyingOrg: 'TRA',
        certNumber: 'TRA-M-2024-K550',
      })

      const res = await fetchGet(`/motors/${motor.id}`)
      expect(res.status).toBe(200)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(
        html,
        'AeroTech',
        'K550W',
        'TRA',
        'TRA-M-2024-K550',
        '1800',
        '550',
        '720',
        'Reloadable',
      )
    })

    it('returns 404 for non-existent motor ID', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000'
      const res = await fetchGet(`/motors/${fakeId}`)
      expect(res.status).toBe(404)
      const html = await res.text()
      expect(html).toMatch(/Motor Not Found/i)
    })
  })

  describe('Tier 4: User Inventory Tracking & Display', () => {
    it('displays user stock quantity on hand and expended counts on catalog', async () => {
      const user = await seedTestUser({ displayName: 'Motor Chief' })
      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'G76G',
        impulseClass: 'G',
      })
      await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 5,
        expendedCount: 2,
      })

      const res = await fetchGet('/motors')
      expect(res.status).toBe(200)
      const html = await res.text()
      assertContains(html, 'G76G')
      expect(html).toMatch(/(5\s*(on hand|in stock)|quantity|on hand)/i)
    })

    it('renders user inventory tracker view (GET /inventory)', async () => {
      const user = await seedTestUser({ displayName: 'Logistics Officer' })
      const m1 = await seedTestMotor({ manufacturer: 'Estes', model: 'D12-5', impulseClass: 'D' })
      const m2 = await seedTestMotor({ manufacturer: 'Cesaroni', model: 'H153', impulseClass: 'H' })

      await seedTestInventory(user.id, m1.id, { quantityOnHand: 4, expendedCount: 1 })
      await seedTestInventory(user.id, m2.id, { quantityOnHand: 2, expendedCount: 3 })

      const res = await fetchGet('/inventory')
      expect(res.status).toBe(200)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'D12-5', 'H153', 'Estes', 'Cesaroni')
      // Stock summaries: 4+2=6 on hand, 1+3=4 expended
      expect(html).toMatch(/6/)
      expect(html).toMatch(/4/)
    })

    it('adds a motor from catalog to inventory (POST /inventory)', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({ manufacturer: 'AeroTech', model: 'E20-4W', impulseClass: 'E' })

      const res = await fetchPostForm('/inventory', {
        motor_id: motor.id,
        quantity_on_hand: 3,
        notes: 'Bought at launch field',
      })

      expect([200, 302]).toContain(res.status)

      const db = getDb()
      const [inv] = await db
        .select()
        .from(schema.motorInventories)
        .where(
          and(
            eq(schema.motorInventories.userId, user.id),
            eq(schema.motorInventories.motorId, motor.id),
          ),
        )

      expect(inv).toBeDefined()
      expect(inv.quantityOnHand).toBe(3)
      expect(inv.notes).toBe('Bought at launch field')
    })
  })

  describe('Tier 5: Inline HTMX Stock Adjustments', () => {
    it('handles HTMX inline quantity increment and updates D1 inventory record', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({ model: 'J350W', impulseClass: 'J' })
      const inventory = await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 2,
        expendedCount: 1,
      })

      // Send HTMX increment action
      const res = await fetchHtmxPostForm(`/inventory/${inventory.id}/adjust`, {
        action: 'increment',
        delta: 1,
      })

      expect(res.status).toBe(200)
      const fragment = await res.text()
      expect(fragment).toMatch(/3/) // Updated quantity on hand

      // Direct D1 verification
      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inventory.id))

      expect(updated.quantityOnHand).toBe(3)
      expect(updated.expendedCount).toBe(1)
    })

    it('handles HTMX expend action (decrements quantityOnHand, increments expendedCount)', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({ model: 'K550W', impulseClass: 'K' })
      const inventory = await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 4,
        expendedCount: 0,
      })

      // Send HTMX expend action
      const res = await fetchHtmxPostForm(`/inventory/${inventory.id}/adjust`, {
        action: 'expend',
        delta: 1,
      })

      expect(res.status).toBe(200)
      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inventory.id))

      expect(updated.quantityOnHand).toBe(3)
      expect(updated.expendedCount).toBe(1)
    })

    it('clamps quantityOnHand to 0 minimum when decrementing', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({ model: 'C6-7', impulseClass: 'C' })
      const inventory = await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 0,
        expendedCount: 5,
      })

      const res = await fetchHtmxPostForm(`/inventory/${inventory.id}/adjust`, {
        action: 'decrement',
        delta: 1,
      })

      expect(res.status).toBe(200)
      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inventory.id))

      expect(updated.quantityOnHand).toBe(0) // Clamped to 0
      expect(updated.expendedCount).toBe(5)
    })
  })
})
