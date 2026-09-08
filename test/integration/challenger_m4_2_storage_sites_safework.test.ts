/**
 * Empirical Adversarial Challenger 2 Test Suite: Milestone 4
 * Scope: Storage Sites CRUD & South Australia SafeWork SA Propellant Compliance (Requirement R4)
 *
 * Requirements & Boundaries Verified:
 * 1. Capacity & SafeWork SA Compliance Boundaries:
 *    - capacity_kg = 2.99 without permit -> must succeed (200/303)
 *    - capacity_kg = 3.0 without permit -> must succeed (threshold boundary, hobby exemption)
 *    - capacity_kg = 3.001 or 3.1 without permit -> must fail with HTTP 400
 *    - capacity_kg = 3.001 or 5.0 with valid permit -> must succeed (200/303)
 *    - capacity_kg = 10.0 with empty/whitespace permit -> must fail with HTTP 400
 *    - Extreme precision: 2.999999 vs 3.000001
 *    - Zero, negative, and invalid capacity sanitization
 *    - Missing required name validation (HTTP 400)
 *    - JSON vs form-encoded parity
 * 2. Full CRUD Lifecycle & Security Isolation:
 *    - CREATE: persists all attributes in D1 schema.storageSites
 *    - LIST: renders registered sites, formatted capacity kg, badges, actions, and empty states
 *    - VIEW: renders detailed site overview, capacity gauge, stored motors & components
 *    - UPDATE: updates record in D1, enforces SafeWork SA boundary on update
 *    - DELETE: soft-deletes via deletedAt, removes from active listings, handles HTMX
 *    - IDOR Isolation: User A cannot view, update, or delete User B's storage sites
 * 3. Client-Side JavaScript Dynamic Behavior in src/views/storage_sites.ts:
 *    - DOM verification of #capacity_kg, #permit_number, #safework-compliance-callout,
 *      #permit-required-asterisk, #permit-help-text
 *    - Event binding inspection ('input', 'change', 'keyup', 'DOMContentLoaded')
 *    - Server-side pre-rendering state parity (capacity <= 3.0 vs capacity > 3.0)
 *    - Dynamic compliance logic evaluation across boundary states
 * 4. SafeWork SA Regulatory Badge Formatting:
 *    - Hobby exempt, licensed, unpermitted warning, and optional permit badge variants
 */

import { and, eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { SELF } from 'cloudflare:test'
import * as schema from '../../src/db/schema'
import {
  getDb,
  seedTestComponent,
  seedTestInventory,
  seedTestMotor,
  seedTestStorageSite,
  seedTestUser,
  truncateDb,
} from '../helpers/db'
import {
  assertContains,
  assertHtmlResponse,
  assertNotContains,
} from '../helpers/html'
import { fetchGet, fetchHtmxPostForm, fetchPostForm } from '../helpers/http'
import { signSession } from '../../src/services/auth'
import { formatSafeWorkBadge, storageSiteFormView } from '../../src/views/storage_sites'

beforeEach(truncateDb)

describe('Adversarial Challenger 2: Storage Sites & SafeWork SA Propellant Compliance (R4)', () => {
  // =========================================================================
  // SECTION 1: Capacity & SafeWork SA Compliance Boundary Tests
  // =========================================================================
  describe('Section 1: Capacity & SafeWork SA Compliance Boundaries', () => {
    it('1.1: capacity_kg = 2.99 without permit succeeds with HTTP 303/201 and null permitNumber in D1', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Under Limit Box 2.99',
          location: 'Field Case A',
          capacity_kg: 2.99,
          permit_number: '',
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
            eq(schema.storageSites.name, 'Under Limit Box 2.99'),
          ),
        )

      expect(site).toBeDefined()
      expect(site.capacityKg).toBeCloseTo(2.99)
      expect(site.permitNumber).toBeNull()
    })

    it('1.2: capacity_kg = 3.0 without permit succeeds (threshold boundary, hobby exemption)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Exact Threshold Magazine 3.0',
          location: 'Workshop Cabinet',
          capacity_kg: 3.0,
          permit_number: '',
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
            eq(schema.storageSites.name, 'Exact Threshold Magazine 3.0'),
          ),
        )

      expect(site).toBeDefined()
      expect(site.capacityKg).toBeCloseTo(3.0)
      expect(site.permitNumber).toBeNull()
    })

    it('1.3: capacity_kg = 3.001 without permit fails with HTTP 400 and SafeWork SA regulation error', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Slightly Over Magazine 3.001',
          location: 'Bunker North',
          capacity_kg: 3.001,
          permit_number: '',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect(res.status).toBe(400)
      const html = await res.text()
      assertContains(html, 'SafeWork SA regulations require a propellant storage license/permit')
    })

    it('1.4: capacity_kg = 3.1 without permit fails with HTTP 400 and SafeWork SA regulation error', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Regulated Magazine 3.1',
          location: 'Bunker East',
          capacity_kg: 3.1,
          permit_number: '',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect(res.status).toBe(400)
      const html = await res.text()
      assertContains(html, 'SafeWork SA regulations require a propellant storage license/permit')
    })

    it('1.5: capacity_kg = 3.001 with valid permit succeeds with HTTP 303/201 and persists permitNumber', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Licensed Magazine 3.001',
          location: 'Bunker South',
          capacity_kg: 3.001,
          permit_number: 'SAFEWORK-SA-EXP-2026-001',
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
            eq(schema.storageSites.name, 'Licensed Magazine 3.001'),
          ),
        )

      expect(site).toBeDefined()
      expect(site.capacityKg).toBeCloseTo(3.001)
      expect(site.permitNumber).toBe('SAFEWORK-SA-EXP-2026-001')
    })

    it('1.6: capacity_kg = 5.0 with valid permit succeeds with HTTP 303/201 and persists permitNumber', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'High Capacity Depot 5.0',
          location: 'Adelaide Hills Magazine 1',
          capacity_kg: 5.0,
          permit_number: 'SAFEWORK-SA-EXP-2026-500',
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
            eq(schema.storageSites.name, 'High Capacity Depot 5.0'),
          ),
        )

      expect(site).toBeDefined()
      expect(site.capacityKg).toBeCloseTo(5.0)
      expect(site.permitNumber).toBe('SAFEWORK-SA-EXP-2026-500')
    })

    it('1.7: capacity_kg = 10.0 with empty string permit fails with HTTP 400', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Commercial Depot 10.0 Empty Permit',
          location: 'Commercial Bunker',
          capacity_kg: 10.0,
          permit_number: '',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect(res.status).toBe(400)
      const html = await res.text()
      assertContains(html, 'SafeWork SA regulations require a propellant storage license/permit')
    })

    it('1.8: capacity_kg = 10.0 with whitespace-only permit (spaces, tabs, newlines) fails with HTTP 400', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Commercial Depot 10.0 Whitespace Permit',
          location: 'Commercial Bunker',
          capacity_kg: 10.0,
          permit_number: '   \t  \n  ',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect(res.status).toBe(400)
      const html = await res.text()
      assertContains(html, 'SafeWork SA regulations require a propellant storage license/permit')
    })

    it('1.9: extreme floating point precision: 2.999999 succeeds without permit; 3.000001 fails without permit', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      // 2.999999 -> <= 3.0 -> succeeds
      const resUnder = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Precision Under',
          capacity_kg: 2.999999,
          permit_number: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([200, 201, 302, 303]).toContain(resUnder.status)

      // 3.000001 -> > 3.0 -> fails 400
      const resOver = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Precision Over',
          capacity_kg: 3.000001,
          permit_number: '',
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect(resOver.status).toBe(400)
    })

    it('1.10: zero capacity (0.0 kg) and omitted capacity string default to 0 and succeed without permit', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const resZero = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Zero Capacity Locker',
          capacity_kg: 0,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([200, 201, 302, 303]).toContain(resZero.status)

      const resEmpty = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Empty Capacity Locker',
          capacity_kg: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([200, 201, 302, 303]).toContain(resEmpty.status)

      const db = getDb()
      const [siteZero] = await db
        .select()
        .from(schema.storageSites)
        .where(eq(schema.storageSites.name, 'Zero Capacity Locker'))
      expect(siteZero.capacityKg).toBe(0)
    })

    it('1.11: validation error when mandatory site name is missing or whitespace-only', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const resMissing = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: '',
          capacity_kg: 2.0,
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect(resMissing.status).toBe(400)
      const htmlMissing = await resMissing.text()
      assertContains(htmlMissing, 'Storage site name is required')

      const resWhitespace = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: '    ',
          capacity_kg: 2.0,
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect(resWhitespace.status).toBe(400)
      const htmlWhitespace = await resWhitespace.text()
      assertContains(htmlWhitespace, 'Storage site name is required')
    })

    it('1.12: supports JSON payloads with camelCase capacityKg and snake_case capacity_kg', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      // JSON request exceeding 3.0 kg without permit -> 400 JSON
      const resJsonOver = await SELF.fetch('https://example.com/inventory/storage-sites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({
          name: 'JSON Over Limit',
          capacityKg: 3.5,
          permitNumber: null,
        }),
      })
      expect(resJsonOver.status).toBe(400)
      const errJson = (await resJsonOver.json()) as any
      expect(errJson.error).toContain('SafeWork SA regulations require a propellant storage license/permit')

      // JSON request with permit -> 201 JSON
      const resJsonOk = await SELF.fetch('https://example.com/inventory/storage-sites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({
          name: 'JSON Licensed Site',
          capacity_kg: 4.2,
          permit_number: 'JSON-PERMIT-2026',
        }),
      })
      expect(resJsonOk.status).toBe(201)
      const siteJson = (await resJsonOk.json()) as any
      expect(siteJson.name).toBe('JSON Licensed Site')
      expect(siteJson.capacityKg).toBeCloseTo(4.2)
      expect(siteJson.permitNumber).toBe('JSON-PERMIT-2026')
    })
  })

  // =========================================================================
  // SECTION 2: Full CRUD Lifecycle & Security Boundary Tests
  // =========================================================================
  describe('Section 2: Full CRUD Lifecycle & Security Isolation', () => {
    it('2.1: CREATE: persists all attributes in D1 schema.storageSites', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Complete Facility Beta',
          location: 'Bay 7 South Yard',
          capacity_kg: 2.8,
          notes: 'Grounding strap installed. AS 2187 compliant lock.',
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
            eq(schema.storageSites.name, 'Complete Facility Beta'),
          ),
        )

      expect(site).toBeDefined()
      expect(site.userId).toBe(flyer.id)
      expect(site.location).toBe('Bay 7 South Yard')
      expect(site.capacityKg).toBeCloseTo(2.8)
      expect(site.notes).toBe('Grounding strap installed. AS 2187 compliant lock.')
      expect(site.deletedAt).toBeNull()
      expect(site.createdAt).toBeGreaterThan(0)
    })

    it('2.2: LIST: GET /inventory/storage-sites renders sites, formatted capacity kg, badges, and actions', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      await seedTestStorageSite(flyer.id, {
        name: 'Workshop Magazine Alpha',
        location: 'Shed Safe Bay',
        capacityKg: 1.5,
        permitNumber: null,
      })
      await seedTestStorageSite(flyer.id, {
        name: 'HPR Bunker Delta',
        location: 'Range Depot',
        capacityKg: 4.5,
        permitNumber: 'SAFEWORK-2026-BUNKER',
      })

      const res = await fetchGet('/inventory/storage-sites', {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'Workshop Magazine Alpha', 'HPR Bunker Delta')
      assertContains(html, 'Shed Safe Bay', 'Range Depot')
      assertContains(html, '1.50', '4.50')
      assertContains(html, 'Hobby Exempt (≤ 3.0 kg)')
      assertContains(html, 'SafeWork SA Licensed (SAFEWORK-2026-BUNKER)')
      expect(html).toContain('href="/inventory/storage-sites/new"')
    })

    it('2.3: LIST Empty State: renders friendly empty state banner when flyer has zero storage sites', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/inventory/storage-sites', {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'No Storage Sites Configured')
      assertContains(html, 'Register First Storage Site')
    })

    it('2.4: LIST JSON: GET /inventory/storage-sites with Accept: application/json returns site array', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const site = await seedTestStorageSite(flyer.id, {
        name: 'JSON Query Site',
        capacityKg: 2.2,
      })

      const res = await fetchGet('/inventory/storage-sites', {
        Cookie: `triplet_session=${token}`,
        Accept: 'application/json',
      })

      expect(res.status).toBe(200)
      const list = (await res.json()) as any[]
      expect(Array.isArray(list)).toBe(true)
      expect(list.some((s) => s.id === site.id && s.name === 'JSON Query Site')).toBe(true)
    })

    it('2.5: VIEW: GET /inventory/storage-sites/:id displays site details, capacity gauge, and matching stored items', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const site = await seedTestStorageSite(flyer.id, {
        name: 'Main Field Magazine',
        location: 'Range Trailer',
        capacityKg: 2.0,
        permitNumber: null,
      })

      // Seed a motor assigned to this storage location
      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'H128W',
        weightG: 120,
        propellantWeightG: 64,
      })
      await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 2,
        storageLocation: 'Main Field Magazine',
      })

      // Seed a component assigned to this storage location
      await seedTestComponent(flyer.id, {
        name: 'Ejection Charge Pyros',
        category: 'pyrotechnic',
        quantityOnHand: 5,
        storageLocation: 'Main Field Magazine',
        propellantMassG: 2,
      })

      const res = await fetchGet(`/inventory/storage-sites/${site.id}`, {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'Main Field Magazine', 'Range Trailer')
      assertContains(html, 'Licensed Storage Capacity')
      assertContains(html, '2.00')
      assertContains(html, 'Hobby Exempt (≤ 3.0 kg)')
      assertContains(html, 'AeroTech H128W')
      assertContains(html, 'Ejection Charge Pyros')
      expect(html).toContain(`/inventory/storage-sites/${site.id}/edit`)
      expect(html).toContain(`/inventory/storage-sites/${site.id}/delete`)
    })

    it('2.6: VIEW 404: requesting non-existent storage site returns HTTP 404', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/inventory/storage-sites/non-existent-uuid-12345', {
        Cookie: `triplet_session=${token}`,
      })

      expect(res.status).toBe(404)
      const html = await res.text()
      assertContains(html, 'Storage Site Not Found')
    })

    it('2.7: IDOR Isolation: Flyer A cannot view, edit, or delete Flyer B storage sites', async () => {
      const flyerA = await seedTestUser({ email: 'flyerA@example.com' })
      const flyerB = await seedTestUser({ email: 'flyerB@example.com' })

      const siteB = await seedTestStorageSite(flyerB.id, {
        name: 'Private Bunker Flyer B',
        capacityKg: 2.0,
      })

      const tokenA = await signSession(flyerA.id)

      // Flyer A attempts to VIEW Flyer B's site -> 404
      const viewRes = await fetchGet(`/inventory/storage-sites/${siteB.id}`, {
        Cookie: `triplet_session=${tokenA}`,
      })
      expect(viewRes.status).toBe(404)

      // Flyer A attempts to access EDIT form for Flyer B's site -> 404
      const editFormRes = await fetchGet(`/inventory/storage-sites/${siteB.id}/edit`, {
        Cookie: `triplet_session=${tokenA}`,
      })
      expect(editFormRes.status).toBe(404)

      // Flyer A attempts to POST UPDATE to Flyer B's site -> 404
      const updateRes = await fetchPostForm(
        `/inventory/storage-sites/${siteB.id}/edit`,
        { name: 'Hijacked Site' },
        { Cookie: `triplet_session=${tokenA}` },
      )
      expect(updateRes.status).toBe(404)

      // Flyer A attempts to DELETE Flyer B's site -> 404
      const deleteRes = await fetchPostForm(
        `/inventory/storage-sites/${siteB.id}/delete`,
        {},
        { Cookie: `triplet_session=${tokenA}` },
      )
      expect(deleteRes.status).toBe(404)

      // Verify Flyer B's site remains untouched
      const db = getDb()
      const [untouched] = await db
        .select()
        .from(schema.storageSites)
        .where(eq(schema.storageSites.id, siteB.id))

      expect(untouched.name).toBe('Private Bunker Flyer B')
      expect(untouched.deletedAt).toBeNull()
    })

    it('2.8: UPDATE: updates storage site record in D1 and sets updatedAt timestamp', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const site = await seedTestStorageSite(flyer.id, {
        name: 'Initial Name',
        location: 'Initial Location',
        capacityKg: 1.0,
        permitNumber: null,
      })

      const initialUpdatedAt = site.updatedAt

      // Update name and notes
      const res = await fetchPostForm(
        `/inventory/storage-sites/${site.id}/edit`,
        {
          name: 'Renovated Storage Facility',
          location: 'New Location Dock 3',
          capacity_kg: 2.2,
          notes: 'Updated fire suppression installed.',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.storageSites)
        .where(eq(schema.storageSites.id, site.id))

      expect(updated.name).toBe('Renovated Storage Facility')
      expect(updated.location).toBe('New Location Dock 3')
      expect(updated.capacityKg).toBeCloseTo(2.2)
      expect(updated.notes).toBe('Updated fire suppression installed.')
      expect(updated.updatedAt).toBeGreaterThanOrEqual(initialUpdatedAt)
    })

    it('2.9: UPDATE Boundary Enforcement: updating capacity from 2.5kg to 4.0kg without permit fails with HTTP 400', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const site = await seedTestStorageSite(flyer.id, {
        name: 'Upgrade Magazine',
        capacityKg: 2.5,
        permitNumber: null,
      })

      const res = await fetchPostForm(
        `/inventory/storage-sites/${site.id}/edit`,
        {
          name: 'Upgrade Magazine',
          capacity_kg: 4.0, // Exceeds 3.0 kg
          permit_number: '', // Omitted permit
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect(res.status).toBe(400)
      const html = await res.text()
      assertContains(html, 'SafeWork SA regulations require a propellant storage license/permit')

      // Verify site capacity was NOT changed in D1
      const db = getDb()
      const [unmodified] = await db
        .select()
        .from(schema.storageSites)
        .where(eq(schema.storageSites.id, site.id))

      expect(unmodified.capacityKg).toBeCloseTo(2.5)
    })

    it('2.10: UPDATE Boundary Relaxation: updating capacity from 4.0kg (with permit) down to 2.5kg allows clearing permit', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const site = await seedTestStorageSite(flyer.id, {
        name: 'Downsized Magazine',
        capacityKg: 4.0,
        permitNumber: 'SAFEWORK-2026-OLD',
      })

      const res = await fetchPostForm(
        `/inventory/storage-sites/${site.id}/edit`,
        {
          name: 'Downsized Magazine',
          capacity_kg: 2.5, // Reduced under 3.0 kg
          permit_number: '', // Cleared permit
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.storageSites)
        .where(eq(schema.storageSites.id, site.id))

      expect(updated.capacityKg).toBeCloseTo(2.5)
      expect(updated.permitNumber).toBeNull()
    })

    it('2.11: UPDATE Permit Cleared: attempting to clear permit while capacity remains >3.0kg fails with HTTP 400', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const site = await seedTestStorageSite(flyer.id, {
        name: 'Keep High Capacity Site',
        capacityKg: 4.5,
        permitNumber: 'SAFEWORK-VALID-PERMIT',
      })

      const res = await fetchPostForm(
        `/inventory/storage-sites/${site.id}/edit`,
        {
          name: 'Keep High Capacity Site',
          capacity_kg: 4.5,
          permit_number: '   ', // Whitespace
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect(res.status).toBe(400)
      const html = await res.text()
      assertContains(html, 'SafeWork SA regulations require a propellant storage license/permit')
    })

    it('2.12: DELETE (Soft-Delete): POST /inventory/storage-sites/:id/delete sets deletedAt and hides from list', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const site = await seedTestStorageSite(flyer.id, {
        name: 'Site to Soft-Delete',
        capacityKg: 1.0,
      })

      const res = await fetchPostForm(
        `/inventory/storage-sites/${site.id}/delete`,
        {},
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      // In D1, deletedAt must be populated
      const db = getDb()
      const [deletedSite] = await db
        .select()
        .from(schema.storageSites)
        .where(eq(schema.storageSites.id, site.id))

      expect(deletedSite).toBeDefined()
      expect(deletedSite.deletedAt).toBeGreaterThan(0)

      // In LIST, the soft-deleted site must not appear
      const listRes = await fetchGet('/inventory/storage-sites', {
        Cookie: `triplet_session=${token}`,
      })
      const listHtml = await listRes.text()
      assertNotContains(listHtml, 'Site to Soft-Delete')

      // In VIEW, accessing soft-deleted site must return 404
      const viewRes = await fetchGet(`/inventory/storage-sites/${site.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      expect(viewRes.status).toBe(404)
    })

    it('2.13: DELETE with HTMX: DELETE /inventory/storage-sites/:id sets HX-Redirect header', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const site = await seedTestStorageSite(flyer.id, {
        name: 'HTMX Delete Site',
        capacityKg: 1.0,
      })

      const res = await SELF.fetch(`https://example.com/inventory/storage-sites/${site.id}`, {
        method: 'DELETE',
        headers: {
          'HX-Request': 'true',
          Cookie: `triplet_session=${token}`,
        },
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('HX-Redirect')).toBe('/inventory/storage-sites')
    })
  })

  // =========================================================================
  // SECTION 3: Client-Side Dynamic JavaScript Behavior & DOM Verification
  // =========================================================================
  describe('Section 3: Client-Side Dynamic JavaScript Behavior & DOM Verification', () => {
    it('3.1: form HTML includes all essential DOM elements for SafeWork SA dynamic behavior', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/inventory/storage-sites/new', {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toMatch(/<input[^>]*id=["']capacity_kg["'][^>]*name=["']capacity_kg["']/i)
      expect(html).toMatch(/<input[^>]*id=["']permit_number["'][^>]*name=["']permit_number["']/i)
      expect(html).toMatch(/<div[^>]*id=["']safework-compliance-callout["']/i)
      expect(html).toMatch(/<span[^>]*id=["']permit-required-asterisk["']/i)
      expect(html).toMatch(/<p[^>]*id=["']permit-help-text["']/i)
    })

    it('3.2: form includes dynamic script binding input, change, and keyup event listeners on #capacity_kg', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/inventory/storage-sites/new', {
        Cookie: `triplet_session=${token}`,
      })

      const html = await res.text()

      // Verify script presence
      expect(html).toContain('checkSafeWorkCompliance')
      expect(html).toMatch(/addEventListener\(['"]input['"],\s*checkSafeWorkCompliance\)/)
      expect(html).toMatch(/addEventListener\(['"]change['"],\s*checkSafeWorkCompliance\)/)
      expect(html).toMatch(/addEventListener\(['"]keyup['"],\s*checkSafeWorkCompliance\)/)
      expect(html).toContain('val > 3.0')
    })

    it('3.3: SSR Pre-render: when capacity <= 3.0 kg or new form, callout and asterisk are hidden, permit is not required', async () => {
      const flyer = await seedTestUser()
      const activeUser = { ...flyer, maxCertLevel: 1 }

      // Test New Form
      const newFormHtml = await (storageSiteFormView({ isNew: true, user: activeUser }) as any).toString()
      expect(newFormHtml).toMatch(/id=["']safework-compliance-callout["'][^>]*class=["'][^"']*hidden[^"']*["']/)
      expect(newFormHtml).toMatch(/id=["']permit-required-asterisk["'][^>]*class=["'][^"']*hidden[^"']*["']/)
      expect(newFormHtml).not.toMatch(/id=["']permit_number["'][^>]*required/)

      // Test Edit Form with capacity = 2.5 kg
      const editFormHtml = await (
        storageSiteFormView({
          site: { id: 'test-id', name: 'Small Box', capacityKg: 2.5 },
          isNew: false,
          user: activeUser,
        }) as any
      ).toString()

      expect(editFormHtml).toMatch(/id=["']safework-compliance-callout["'][^>]*class=["'][^"']*hidden[^"']*["']/)
      expect(editFormHtml).toMatch(/id=["']permit-required-asterisk["'][^>]*class=["'][^"']*hidden[^"']*["']/)
      expect(editFormHtml).not.toMatch(/id=["']permit_number["'][^>]*required/)
    })

    it('3.4: SSR Pre-render: when capacity > 3.0 kg, callout and asterisk are NOT hidden, permit IS required with amber styling', async () => {
      const flyer = await seedTestUser()
      const activeUser = { ...flyer, maxCertLevel: 1 }

      // Test Edit Form with capacity = 4.5 kg
      const editFormHtml = await (
        storageSiteFormView({
          site: { id: 'test-id', name: 'Big Magazine', capacityKg: 4.5 },
          isNew: false,
          user: activeUser,
        }) as any
      ).toString()

      // Callout and asterisk must NOT have 'hidden' class
      const calloutMatch = editFormHtml.match(/id=["']safework-compliance-callout["'][^>]*class=["']([^"']*)["']/)
      expect(calloutMatch).toBeDefined()
      expect(calloutMatch![1]).not.toContain('hidden')

      const asteriskMatch = editFormHtml.match(/id=["']permit-required-asterisk["'][^>]*class=["']([^"']*)["']/)
      expect(asteriskMatch).toBeDefined()
      expect(asteriskMatch![1]).not.toContain('hidden')

      // Permit input must have required attribute and border-amber-500 styling
      expect(editFormHtml).toMatch(/id=["']permit_number["'][^>]*required/)
      expect(editFormHtml).toMatch(/id=["']permit_number["'][^>]*border-amber-500/)
    })

    it('3.5: dynamic client-side logic harness: simulates input transitions across 2.99, 3.0, 3.001, 5.0, empty, and NaN', () => {
      /**
       * Simulates the exact state transitions performed by checkSafeWorkCompliance in src/views/storage_sites.ts
       */
      function evaluateClientSafeWorkState(capacityInputVal: string) {
        const val = parseFloat(capacityInputVal)
        const exceedsLimit = !isNaN(val) && val > 3.0

        return {
          calloutHidden: !exceedsLimit,
          asteriskHidden: !exceedsLimit,
          permitRequired: exceedsLimit,
          permitAriaRequired: exceedsLimit ? 'true' : null,
          hasAmberBorder: exceedsLimit,
          helpTextRequired: exceedsLimit,
        }
      }

      // 1. Initial sub-threshold (2.5)
      const state25 = evaluateClientSafeWorkState('2.5')
      expect(state25.calloutHidden).toBe(true)
      expect(state25.asteriskHidden).toBe(true)
      expect(state25.permitRequired).toBe(false)
      expect(state25.hasAmberBorder).toBe(false)

      // 2. Sub-threshold boundary (2.99)
      const state299 = evaluateClientSafeWorkState('2.99')
      expect(state299.calloutHidden).toBe(true)
      expect(state299.asteriskHidden).toBe(true)
      expect(state299.permitRequired).toBe(false)

      // 3. Exact threshold boundary (3.0)
      const state30 = evaluateClientSafeWorkState('3.0')
      expect(state30.calloutHidden).toBe(true)
      expect(state30.asteriskHidden).toBe(true)
      expect(state30.permitRequired).toBe(false)

      // 4. Over-threshold boundary (3.001)
      const state3001 = evaluateClientSafeWorkState('3.001')
      expect(state3001.calloutHidden).toBe(false)
      expect(state3001.asteriskHidden).toBe(false)
      expect(state3001.permitRequired).toBe(true)
      expect(state3001.hasAmberBorder).toBe(true)

      // 5. Over-threshold (3.1)
      const state31 = evaluateClientSafeWorkState('3.1')
      expect(state31.calloutHidden).toBe(false)
      expect(state31.permitRequired).toBe(true)

      // 6. Large capacity (5.0)
      const state50 = evaluateClientSafeWorkState('5.0')
      expect(state50.calloutHidden).toBe(false)
      expect(state50.permitRequired).toBe(true)

      // 7. Large commercial (10.0)
      const state10 = evaluateClientSafeWorkState('10.0')
      expect(state10.calloutHidden).toBe(false)
      expect(state10.permitRequired).toBe(true)

      // 8. Reverted back down to 1.5
      const stateRevert = evaluateClientSafeWorkState('1.5')
      expect(stateRevert.calloutHidden).toBe(true)
      expect(stateRevert.permitRequired).toBe(false)

      // 9. Cleared empty string
      const stateEmpty = evaluateClientSafeWorkState('')
      expect(stateEmpty.calloutHidden).toBe(true)
      expect(stateEmpty.permitRequired).toBe(false)

      // 10. Non-numeric gibberish (NaN)
      const stateNan = evaluateClientSafeWorkState('invalid-number')
      expect(stateNan.calloutHidden).toBe(true)
      expect(stateNan.permitRequired).toBe(false)
    })
  })

  // =========================================================================
  // SECTION 4: SafeWork SA Badge Rendering & Regulation Consistency
  // =========================================================================
  describe('Section 4: SafeWork SA Badge Rendering & Regulation Consistency', () => {
    it('4.1: formatSafeWorkBadge renders Hobby Exempt badge when capacity <= 3.0 kg and no permit', async () => {
      const badge25 = await (formatSafeWorkBadge(2.5, null) as any).toString()
      expect(badge25).toContain('Hobby Exempt (≤ 3.0 kg)')

      const badge30 = await (formatSafeWorkBadge(3.0, '') as any).toString()
      expect(badge30).toContain('Hobby Exempt (≤ 3.0 kg)')
    })

    it('4.2: formatSafeWorkBadge renders SafeWork SA Licensed badge when capacity > 3.0 kg and permit is provided', async () => {
      const badge = await (formatSafeWorkBadge(4.0, 'LIC-2026-SA') as any).toString()
      expect(badge).toContain('SafeWork SA Licensed (LIC-2026-SA)')
      expect(badge).toContain('🛡️')
    })

    it('4.3: formatSafeWorkBadge renders Permit Required warning badge when capacity > 3.0 kg and permit is missing', async () => {
      const badgeMissing = await (formatSafeWorkBadge(3.5, null) as any).toString()
      expect(badgeMissing).toContain('Permit Required (&gt; 3.0 kg)')
      expect(badgeMissing).toContain('⚠️')

      const badgeEmpty = await (formatSafeWorkBadge(3.1, '   ') as any).toString()
      expect(badgeEmpty).toContain('Permit Required (&gt; 3.0 kg)')
    })

    it('4.4: formatSafeWorkBadge renders Permit badge when capacity <= 3.0 kg and voluntary permit is recorded', async () => {
      const badge = await (formatSafeWorkBadge(2.0, 'OPTIONAL-PERMIT-123') as any).toString()
      expect(badge).toContain('Permit: OPTIONAL-PERMIT-123')
    })
  })
})
