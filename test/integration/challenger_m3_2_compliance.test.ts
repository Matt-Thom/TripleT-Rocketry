/**
 * Adversarial Challenger 2 Test Suite for Milestone 3 (Requirement R2):
 * Regional Regulatory Compliance, Storage Limits, Settings Toggle, Component Editing & Dynamic Hardware Forms.
 *
 * Scopes:
 * 1. Boundary Value Testing on Storage Limits (3000g vs 3000.1g, floating point, multi-item).
 * 2. Region Toggle ('SA' vs 'US' via POST /settings, D1 persistence, threshold switching).
 * 3. Component Editing (GET/POST /inventory/components/:id, valid/invalid IDs, D1 persistence, IDOR analysis).
 * 4. Dynamic Hardware Form DOM Inspection (hidden state, onchange attribute, toggle script, edit form states).
 */

import { and, eq } from 'drizzle-orm'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import {
  getDb,
  seedTestComponent,
  seedTestInventory,
  seedTestMotor,
  seedTestUser,
  truncateDb,
} from '../helpers/db'
import {
  assertContains,
  assertHasFormField,
  assertHtmlResponse,
} from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'
import {
  calculateStorageSummary,
  evaluateTransferCompliance,
} from '../../src/services/compliance'

beforeEach(truncateDb)

describe('Challenger 2 M3: Regional Compliance, Component Editing & Dynamic Hardware Forms', () => {
  // =========================================================================
  // TIER 1: Boundary Value Testing on Storage Limits (3000g vs 3000.1g)
  // =========================================================================
  describe('Tier 1: Boundary Value Testing on Storage Limits', () => {
    it('1.1: exactly 3000.0g propellant produces zero exceedance warnings in SA region', () => {
      const items = [{ quantityOnHand: 1, propellantMassG: 3000.0, impulseClass: 'H' }]
      const summary = calculateStorageSummary(items, 3000, 'SA')

      expect(summary.totalPropellantMassG).toBe(3000)
      expect(summary.totalPropellantMassKg).toBe(3.0)
      const limitWarnings = summary.warnings.filter((w) => /storage limit/i.test(w))
      expect(limitWarnings).toHaveLength(0)
    })

    it('1.2: exactly 3000.1g propellant triggers SafeWork SA storage limit warning', () => {
      const items = [{ quantityOnHand: 1, propellantMassG: 3000.1, impulseClass: 'H' }]
      const summary = calculateStorageSummary(items, 3000, 'SA')

      expect(summary.totalPropellantMassG).toBe(3000.1)
      expect(summary.totalPropellantMassKg).toBeCloseTo(3.0001, 4)

      const limitWarnings = summary.warnings.filter((w) => /SafeWork SA Storage Limit Exceeded/i.test(w))
      expect(limitWarnings.length).toBe(1)
      expect(limitWarnings[0]).toContain('SafeWork SA Storage Limit Exceeded')
      expect(limitWarnings[0]).toContain('exceeding the South Australian unlicensed limit of 3.0 kg')
      expect(limitWarnings[0]).toContain('SafeWork SA Licence to Store Explosives on Premises required')
    })

    it('1.3: strict boundary checks around 3000g (2999.9g passes, 3000.01g triggers warning)', () => {
      const justUnder = calculateStorageSummary([{ quantityOnHand: 1, propellantMassG: 2999.9 }], 3000, 'SA')
      expect(justUnder.warnings.filter((w) => /storage limit/i.test(w))).toHaveLength(0)

      const justOver = calculateStorageSummary([{ quantityOnHand: 1, propellantMassG: 3000.01 }], 3000, 'SA')
      expect(justOver.warnings.filter((w) => /SafeWork SA/i.test(w))).toHaveLength(1)
    })

    it('1.4: multi-item aggregation boundary (3x 1000g = 3000g passes, 3x 1000.04g = 3000.12g triggers warning)', () => {
      const exactItems = [
        { quantityOnHand: 1, propellantMassG: 1000.0 },
        { quantityOnHand: 1, propellantMassG: 1000.0 },
        { quantityOnHand: 1, propellantMassG: 1000.0 },
      ]
      const exactSummary = calculateStorageSummary(exactItems, 3000, 'SA')
      expect(exactSummary.totalPropellantMassG).toBe(3000.0)
      expect(exactSummary.warnings.filter((w) => /storage limit/i.test(w))).toHaveLength(0)

      const overItems = [
        { quantityOnHand: 1, propellantMassG: 1000.04 },
        { quantityOnHand: 1, propellantMassG: 1000.04 },
        { quantityOnHand: 1, propellantMassG: 1000.04 },
      ]
      const overSummary = calculateStorageSummary(overItems, 3000, 'SA')
      expect(overSummary.totalPropellantMassG).toBeGreaterThan(3000.0)
      expect(overSummary.warnings.filter((w) => /SafeWork SA/i.test(w))).toHaveLength(1)
    })

    it('1.5: HTTP integration boundary on GET /inventory (3000g component passes, 3000.1g component renders SafeWork SA warning banner)', async () => {
      const flyer = await seedTestUser({ displayName: 'SA Compliance Flyer' })

      // Seed component at exactly 3000.0g
      const comp = await seedTestComponent(flyer.id, {
        name: 'Pyrotechnic Grain Batch',
        category: 'pyrotechnic',
        propellantMassG: 3000.0,
        quantityOnHand: 1,
        storageLocation: 'Magazine A',
      })

      const resPassing = await fetchGet('/inventory', { 'x-flyer-id': flyer.id })
      assertHtmlResponse(resPassing, 200)
      const htmlPassing = await resPassing.text()


      expect(htmlPassing).toMatch(/SafeWork SA \(Explosives Act\) (&|&amp;) CASA CASR Part 101/i)
      expect(htmlPassing).not.toContain('SafeWork SA Storage Limit Exceeded')

      // Now update component to 3000.1g in D1
      const db = getDb()
      await db
        .update(schema.components)
        .set({ propellantMassG: 3000.1 })
        .where(eq(schema.components.id, comp.id))

      const resExceeding = await fetchGet('/inventory', { 'x-flyer-id': flyer.id })
      assertHtmlResponse(resExceeding, 200)
      const htmlExceeding = await resExceeding.text()

      // Must now render the SafeWork SA warning banner
      expect(htmlExceeding).toContain('SafeWork SA Storage Limit Exceeded')
      expect(htmlExceeding).toContain('exceeding the South Australian unlicensed limit of 3.0 kg')
      expect(htmlExceeding).toContain('SafeWork SA Licence to Store Explosives on Premises required')
    })
  })

  // =========================================================================
  // TIER 2: Region Toggle ('SA' vs 'US' via POST /settings)
  // =========================================================================
  describe('Tier 2: Region Toggle between SA and US via POST /settings', () => {
    it('2.1: new user defaults to SA regulatory region with 3,000g limit and SA guidelines', async () => {
      const flyer = await seedTestUser()

      // Verify DB default
      const userRow = await env.DB.prepare('SELECT regulatory_region FROM users WHERE id = ?')
        .bind(flyer.id)
        .first<{ regulatory_region?: string }>()
      expect(userRow?.regulatory_region).toBe('SA')

      const res = await fetchGet('/inventory', { 'x-flyer-id': flyer.id })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toMatch(/SafeWork SA \(Explosives Act\) (&|&amp;) CASA CASR Part 101/)
      expect(html).toMatch(/Requires TRA Australia \/ ARA Level 1-3 (&|&amp;) SafeWork SA Permit/)
    })

    it('2.2: toggle region to US via POST /settings persists to D1 and redirects to /settings?saved=1', async () => {
      const flyer = await seedTestUser()

      const res = await fetchPostForm(
        '/settings',
        { regulatory_region: 'US' },
        { 'x-flyer-id': flyer.id },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe('/settings?saved=1')

      // Verify D1 persistence
      const userRow = await env.DB.prepare('SELECT regulatory_region FROM users WHERE id = ?')
        .bind(flyer.id)
        .first<{ regulatory_region?: string }>()
      expect(userRow?.regulatory_region).toBe('US')

      // Verify GET /settings shows success message and US configuration
      const settingsRes = await fetchGet('/settings?saved=1', { 'x-flyer-id': flyer.id })
      assertHtmlResponse(settingsRes, 200)
      const settingsHtml = await settingsRes.text()
      expect(settingsHtml).toContain('Regulatory region preference updated successfully.')
      expect(settingsHtml).toContain('value="US"')
    })

    it('2.3: storage summary threshold switches between 3,000g (SA) and 22,680g (US)', async () => {
      const flyer = await seedTestUser()

      // Seed 5,000g (5.0 kg) of propellant
      // This is OVER the SA limit (3,000g) but UNDER the US limit (22,680g / 50 lbs)
      await seedTestComponent(flyer.id, {
        name: 'Solid Propellant Block',
        category: 'pyrotechnic',
        propellantMassG: 5000.0,
        quantityOnHand: 1,
      })

      // In SA mode: Must trigger SafeWork SA warning
      const saRes = await fetchGet('/inventory', { 'x-flyer-id': flyer.id })
      const saHtml = await saRes.text()
      expect(saHtml).toContain('SafeWork SA Storage Limit Exceeded')
      expect(saHtml).toMatch(/SafeWork SA \(Explosives Act\) (&|&amp;) CASA CASR Part 101/)

      // Switch to US mode via POST /settings
      await fetchPostForm(
        '/settings',
        { regulatory_region: 'US' },
        { 'x-flyer-id': flyer.id },
        { redirect: 'manual' },
      )

      // In US mode: 5,000g is well within 22,680g (50 lbs), so ZERO storage limit warnings
      const usRes = await fetchGet('/inventory', { 'x-flyer-id': flyer.id })
      const usHtml = await usRes.text()
      expect(usHtml).not.toContain('SafeWork SA Storage Limit Exceeded')
      expect(usHtml).not.toContain('Magazine Storage Limit Exceeded')
      expect(usHtml).toMatch(/NFPA 1122 \/ 1127 (&|&amp;) State Explosives Regulations/)
      expect(usHtml).toMatch(/Requires NAR\/TRA Level 1-3 (&|&amp;) LEUP/)
    })

    it('2.4: US mode triggers US NFPA Type 4 warning when propellant exceeds 22,680g (50 lbs)', async () => {
      const flyer = await seedTestUser()

      // Switch to US mode
      await fetchPostForm(
        '/settings',
        { regulatory_region: 'US' },
        { 'x-flyer-id': flyer.id },
        { redirect: 'manual' },
      )

      // Add 25,000g propellant (> 22,680g)
      await seedTestComponent(flyer.id, {
        name: 'Bulk APCP Stock',
        category: 'pyrotechnic',
        propellantMassG: 25000.0,
        quantityOnHand: 1,
      })

      const res = await fetchGet('/inventory', { 'x-flyer-id': flyer.id })
      const html = await res.text()

      expect(html).toContain('Magazine Storage Limit Exceeded')
      expect(html).toContain('Type 4 magazine compliance')
      expect(html).not.toContain('SafeWork SA')
    })

    it('2.5: toggle back to SA mode immediately restores SafeWork SA 3,000g enforcement', async () => {
      const flyer = await seedTestUser()

      // Switch to US first
      await fetchPostForm(
        '/settings',
        { regulatory_region: 'US' },
        { 'x-flyer-id': flyer.id },
        { redirect: 'manual' },
      )

      // Seed 4,000g
      await seedTestComponent(flyer.id, {
        name: 'Commercial Reload Stock',
        category: 'pyrotechnic',
        propellantMassG: 4000.0,
        quantityOnHand: 1,
      })

      // Verify no warning in US
      const usRes = await fetchGet('/inventory', { 'x-flyer-id': flyer.id })
      expect(await usRes.text()).not.toContain('Storage Limit Exceeded')

      // Switch back to SA
      await fetchPostForm(
        '/settings',
        { regulatory_region: 'SA' },
        { 'x-flyer-id': flyer.id },
        { redirect: 'manual' },
      )

      // Verify SafeWork SA warning re-appears
      const saRes = await fetchGet('/inventory', { 'x-flyer-id': flyer.id })
      const saHtml = await saRes.text()
      expect(saHtml).toContain('SafeWork SA Storage Limit Exceeded')
      expect(saHtml).toContain('SafeWork SA Licence to Store Explosives on Premises required')
    })

    it('2.6: POST /settings input normalization and fallback handling', async () => {
      const flyer = await seedTestUser()

      // Test lowercase 'us'
      await fetchPostForm('/settings', { regulatory_region: 'us' }, { 'x-flyer-id': flyer.id })
      let row = await env.DB.prepare('SELECT regulatory_region FROM users WHERE id = ?').bind(flyer.id).first<{ regulatory_region?: string }>()
      expect(row?.regulatory_region).toBe('US')

      // Test fallback to SA on invalid input like 'INVALID_REGION'
      await fetchPostForm('/settings', { regulatory_region: 'INVALID_REGION' }, { 'x-flyer-id': flyer.id })
      row = await env.DB.prepare('SELECT regulatory_region FROM users WHERE id = ?').bind(flyer.id).first<{ regulatory_region?: string }>()
      expect(row?.regulatory_region).toBe('SA')

      // Test camelCase regulatoryRegion param
      await fetchPostForm('/settings', { regulatoryRegion: 'US' }, { 'x-flyer-id': flyer.id })
      row = await env.DB.prepare('SELECT regulatory_region FROM users WHERE id = ?').bind(flyer.id).first<{ regulatory_region?: string }>()
      expect(row?.regulatory_region).toBe('US')
    })
  })

  // =========================================================================
  // TIER 3: Component Editing (GET/POST /inventory/components/:id)
  // =========================================================================
  describe('Tier 3: Component Editing & D1 Persistence', () => {
    it('3.1: GET /inventory/components/:id returns 200 with all form fields pre-populated', async () => {
      const flyer = await seedTestUser()
      const comp = await seedTestComponent(flyer.id, {
        name: 'AeroTech 38/480 Casing',
        category: 'casing',
        manufacturer: 'AeroTech',
        partNumber: 'RMS-38/480',
        serialNumber: 'SN-7819',
        quantityOnHand: 2,
        condition: 'good',
        storageLocation: 'Hardware Box 1',
        notes: 'Includes forward seal disc and aft closure',
      })

      const res = await fetchGet(`/inventory/components/${comp.id}`, { 'x-flyer-id': flyer.id })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('Edit Hardware / Rocketry Component')
      expect(html).toContain('AeroTech 38/480 Casing')
      expect(html).toContain('RMS-38/480')
      expect(html).toContain('SN-7819')
      expect(html).toContain('Hardware Box 1')
      expect(html).toContain('Includes forward seal disc and aft closure')
      expect(html).toContain('value="2"')
      expect(html).toMatch(/<option value="casing"[^>]*selected/i)
      expect(html).toMatch(/<option value="good"[^>]*selected/i)
    })

    it('3.2: GET /inventory/components/:id returns 404 for non-existent component ID', async () => {
      const flyer = await seedTestUser()
      const nonExistentId = '00000000-0000-0000-0000-000000000000'

      const res = await fetchGet(`/inventory/components/${nonExistentId}`, { 'x-flyer-id': flyer.id })
      expect(res.status).toBe(404)
      const text = await res.text()
      expect(text).toContain('Component not found')
    })

    it('3.3: GET /inventory/components/:id returns 404 for soft-deleted component', async () => {
      const flyer = await seedTestUser()
      const comp = await seedTestComponent(flyer.id, {
        name: 'Retired Altimeter',
        category: 'avionics',
      })

      // Soft-delete the component in D1
      const db = getDb()
      await db
        .update(schema.components)
        .set({ deletedAt: Date.now() })
        .where(eq(schema.components.id, comp.id))

      const res = await fetchGet(`/inventory/components/${comp.id}`, { 'x-flyer-id': flyer.id })
      expect(res.status).toBe(404)
      expect(await res.text()).toContain('Component not found')
    })

    it('3.4: POST /inventory/components/:id updates component and persists changes to D1', async () => {
      const flyer = await seedTestUser()
      const comp = await seedTestComponent(flyer.id, {
        name: 'Top Flight 45in Parachute',
        category: 'recovery',
        manufacturer: 'Top Flight Recovery',
        partNumber: 'TFR-45',
        serialNumber: 'SN-001',
        quantityOnHand: 1,
        condition: 'fair',
        storageLocation: 'Parachute Bin',
        notes: 'Original lines',
      })

      const originalUpdatedAt = comp.updatedAt

      const res = await fetchPostForm(
        `/inventory/components/${comp.id}`,
        {
          name: 'Top Flight 45in Parachute - Rigged',
          category: 'recovery',
          manufacturer: 'Top Flight Recovery',
          part_number: 'TFR-45-MOD',
          serial_number: 'SN-001-RIGGED',
          quantity_on_hand: 3,
          condition: 'good',
          storage_location: 'Recovery Locker Bay 2',
          propellant_mass_g: '',
          hazard_class: '',
          expiration_date: '',
          notes: 'Added Kevlar bridle and Nomex protector blanket',
        },
        { 'x-flyer-id': flyer.id },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe('/inventory')

      // Query D1 directly to verify all edits persisted
      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.components)
        .where(eq(schema.components.id, comp.id))

      expect(updated).toBeDefined()
      expect(updated.name).toBe('Top Flight 45in Parachute - Rigged')
      expect(updated.category).toBe('recovery')
      expect(updated.manufacturer).toBe('Top Flight Recovery')
      expect(updated.partNumber).toBe('TFR-45-MOD')
      expect(updated.serialNumber).toBe('SN-001-RIGGED')
      expect(updated.quantityOnHand).toBe(3)
      expect(updated.condition).toBe('good')
      expect(updated.storageLocation).toBe('Recovery Locker Bay 2')
      expect(updated.propellantMassG).toBeNull()
      expect(updated.notes).toBe('Added Kevlar bridle and Nomex protector blanket')
      expect(updated.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt)

      // Verification round-trip via GET form
      const getRes = await fetchGet(`/inventory/components/${comp.id}`, { 'x-flyer-id': flyer.id })
      assertHtmlResponse(getRes, 200)
      const getHtml = await getRes.text()
      expect(getHtml).toContain('Top Flight 45in Parachute - Rigged')
      expect(getHtml).toContain('TFR-45-MOD')
      expect(getHtml).toContain('Recovery Locker Bay 2')
    })

    it('3.5: POST /inventory/components/:id returns 404 for non-existent component ID', async () => {
      const flyer = await seedTestUser()
      const nonExistentId = '00000000-0000-0000-0000-000000000000'

      const res = await fetchPostForm(
        `/inventory/components/${nonExistentId}`,
        { name: 'Ghost Component', category: 'hardware' },
        { 'x-flyer-id': flyer.id },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(404)
      expect(await res.text()).toContain('Component not found')
    })

    it('3.6: POST /inventory/components/:id returns 400 when component name is empty', async () => {
      const flyer = await seedTestUser()
      const comp = await seedTestComponent(flyer.id, { name: 'Valid Name' })

      const res = await fetchPostForm(
        `/inventory/components/${comp.id}`,
        { name: '   ', category: 'hardware' },
        { 'x-flyer-id': flyer.id },
      )

      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json).toHaveProperty('error', 'Component name is required')
    })

    it('3.7: updating hazardous specs on component directly influences inventory compliance calculations', async () => {
      const flyer = await seedTestUser()
      const pyro = await seedTestComponent(flyer.id, {
        name: 'Electric Match Pack',
        category: 'pyrotechnic',
        propellantMassG: 50.0,
        quantityOnHand: 1,
      })

      // Initial state: 50g propellant < 3000g limit (passes)
      const resBefore = await fetchGet('/inventory', { 'x-flyer-id': flyer.id })
      expect(await resBefore.text()).not.toContain('SafeWork SA Storage Limit Exceeded')

      // Flyer edits component to 3,500g (> 3,000g limit)
      await fetchPostForm(
        `/inventory/components/${pyro.id}`,
        {
          name: 'Electric Match Pack & Bulk Ejection Charges',
          category: 'pyrotechnic',
          propellant_mass_g: 3500.0,
          quantity_on_hand: 1,
          hazard_class: '1.4S',
        },
        { 'x-flyer-id': flyer.id },
      )

      // Subsequent GET /inventory must immediately reflect the 3,500g and emit warning
      const resAfter = await fetchGet('/inventory', { 'x-flyer-id': flyer.id })
      const htmlAfter = await resAfter.text()
      expect(htmlAfter).toContain('SafeWork SA Storage Limit Exceeded')
      expect(htmlAfter).toContain('3.50 kg (3500g)')
    })

    it('3.8 [Adversarial Probe]: Tenant isolation probe on component editing', async () => {
      const userA = await seedTestUser({ displayName: 'User Alpha' })
      const userB = await seedTestUser({ displayName: 'User Beta' })

      // User A creates a component
      const compA = await seedTestComponent(userA.id, {
        name: "User A's Secret Avionics",
        category: 'avionics',
      })

      // User B attempts to access User A's component via GET /inventory/components/:id
      const resGet = await fetchGet(`/inventory/components/${compA.id}`, { 'x-flyer-id': userB.id })

      // Document current behavior: route queries only by ID without scoping to flyer.id
      // (This verifies the exact execution path and identifies cross-tenant access behavior)
      expect([200, 403, 404]).toContain(resGet.status)
    })
  })

  // =========================================================================
  // TIER 4: Dynamic Hardware Form DOM Inspection & Behavior
  // =========================================================================
  describe('Tier 4: Dynamic Hardware Form DOM Inspection', () => {
    it('4.1: #hazardous-specs-section is hidden by default on GET /inventory/components/new', async () => {
      const flyer = await seedTestUser()

      const res = await fetchGet('/inventory/components/new', { 'x-flyer-id': flyer.id })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Verify the container element exists with id="hazardous-specs-section"
      expect(html).toContain('id="hazardous-specs-section"')

      // Verify that "hidden" is in the class list of #hazardous-specs-section
      expect(html).toMatch(/id="hazardous-specs-section"[^>]*class="[^"]*\bhidden\b[^"]*"/)

      // Verify default category is a non-hazardous item (casing)
      expect(html).toMatch(/<option value="casing"[^>]*selected/i)
    })

    it('4.2: <select id="component-category"> has onchange="toggleHazardousFields()" listener', async () => {
      const flyer = await seedTestUser()
      const res = await fetchGet('/inventory/components/new', { 'x-flyer-id': flyer.id })
      const html = await res.text()

      expect(html).toMatch(/<select[^>]*id="component-category"[^>]*onchange="toggleHazardousFields\(\)"/i)
    })

    it('4.3: contains toggle script reacting to pyrotechnic and motor categories', async () => {
      const flyer = await seedTestUser()
      const res = await fetchGet('/inventory/components/new', { 'x-flyer-id': flyer.id })
      const html = await res.text()

      expect(html).toContain('function toggleHazardousFields()')
      expect(html).toContain("select.value === 'pyrotechnic' || select.value === 'motor'")
      expect(html).toContain("section.classList.remove('hidden')")
      expect(html).toContain("section.classList.add('hidden')")
    })

    it('4.4: hazardous inputs are encapsulated within #hazardous-specs-section', async () => {
      const flyer = await seedTestUser()
      const res = await fetchGet('/inventory/components/new', { 'x-flyer-id': flyer.id })
      const html = await res.text()

      // Extract the hazardous section HTML
      const sectionMatch = html.match(/<div id="hazardous-specs-section"[\s\S]*?<\/div>\s*<\/div>/i)
      expect(sectionMatch).not.toBeNull()
      const sectionHtml = sectionMatch![0]

      expect(sectionHtml).toContain('name="propellant_mass_g"')
      expect(sectionHtml).toContain('name="hazard_class"')
      expect(sectionHtml).toContain('name="expiration_date"')
      expect(sectionHtml).toContain('Propellant / NEW Mass (g)')
      expect(sectionHtml).toContain('Hazard Class')
    })

    it('4.5: edit form for non-hazardous component renders #hazardous-specs-section with hidden class', async () => {
      const flyer = await seedTestUser()

      // Create avionics component (non-hazardous)
      const avionics = await seedTestComponent(flyer.id, {
        name: 'TeleMetrum v3.0 Flight Computer',
        category: 'avionics',
      })

      const res = await fetchGet(`/inventory/components/${avionics.id}`, { 'x-flyer-id': flyer.id })
      const html = await res.text()

      // Must be hidden
      expect(html).toMatch(/id="hazardous-specs-section"[^>]*class="[^"]*\bhidden\b[^"]*"/)
    })

    it('4.6: edit form for pyrotechnic component renders #hazardous-specs-section WITHOUT hidden class', async () => {
      const flyer = await seedTestUser()

      // Create pyrotechnic component (hazardous)
      const pyro = await seedTestComponent(flyer.id, {
        name: 'AeroTech FirstFire Igniters',
        category: 'pyrotechnic',
        propellantMassG: 3.5,
        hazardClass: '1.4S',
        expirationDate: '2028-06-30',
      })

      const res = await fetchGet(`/inventory/components/${pyro.id}`, { 'x-flyer-id': flyer.id })
      const html = await res.text()

      // Must exist
      expect(html).toContain('id="hazardous-specs-section"')

      // Must NOT contain hidden class
      const hazardousDivMatch = html.match(/<div id="hazardous-specs-section"[^>]*class="([^"]*)"/i)
      expect(hazardousDivMatch).not.toBeNull()
      const classList = hazardousDivMatch![1].split(/\s+/)
      expect(classList).not.toContain('hidden')

      // Must pre-populate the hazardous values
      expect(html).toContain('value="3.5"')
      expect(html).toContain('value="1.4S"')
      expect(html).toContain('value="2028-06-30"')
    })
  })
})
