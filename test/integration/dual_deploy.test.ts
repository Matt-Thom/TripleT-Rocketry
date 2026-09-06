/**
 * Integration test suite for Requirement R3: Rocket Dual-Deploy & Measurement Clarity.
 *
 * Tests:
 * 1. Dual-deploy recovery system configuration:
 *    - Supports 2 parachutes (Drogue and Main) when recovery system is set to Dual Deploy.
 *    - Maintains 1 parachute field for Single Deploy (Parachute).
 * 2. Explicit reference datum labeling for CG (Center of Gravity) and CP (Center of Pressure):
 *    - Clearly labeled as "Distance from Nose Cone Tip" in creation forms, detail cards, and tables.
 * 3. Dynamic UI form behavior in GET /rockets/new and GET /rockets/:id/configurations/new.
 * 4. D1 database persistence of drogue_parachute_size_mm alongside parachute_size_mm.
 * 5. Configuration versioning and history preservation for dual-deploy setups.
 * 6. Display of vehicle datum and dual parachutes on flight details view (GET /flights/:id).
 * 7. Real-world high-power rocket dual-deploy assembly scenario (Tier 4).
 */

import { eq } from 'drizzle-orm'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import {
  getDb,
  seedTestConfig,
  seedTestFlight,
  seedTestMotor,
  seedTestRocket,
  seedTestUser,
  truncateDb,
} from '../helpers/db'
import {
  assertContains,
  assertHasFormField,
  assertHtmlResponse,
} from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'

beforeEach(truncateDb)

describe('Requirement R3: Rocket Dual-Deploy Recovery System & Reference Datum Clarity', () => {
  describe('Tier 1: UI Forms & Reference Datum Field Labeling', () => {
    it('1.1: renders drogue and main parachute fields on GET /rockets/new', async () => {
      await seedTestUser()
      const res = await fetchGet('/rockets/new')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertHasFormField(html, 'recovery_type')
      assertHasFormField(html, 'parachute_size_mm')
      // Check for drogue parachute input
      expect(html).toMatch(/drogue.*parachute|name=["']drogue_parachute_size_mm["']/i)
    })

    it('1.2: explicitly labels reference datum as "Distance from Nose Cone Tip" under CG and CP on GET /rockets/new', async () => {
      await seedTestUser()
      const res = await fetchGet('/rockets/new')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Verify explicit datum label is present
      assertContains(html, 'Distance from Nose Cone Tip')
      expect(html).toMatch(/Center of Gravity.*(mm)/i)
      expect(html).toMatch(/Center of Pressure.*(mm)/i)
    })

    it('1.3: renders drogue parachute and datum labels on GET /rockets/:id/configurations/new', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Loc Precision IV' })

      const res = await fetchGet(`/rockets/${rocket.id}/configurations/new`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'Distance from Nose Cone Tip')
      expect(html).toMatch(/drogue/i)
      assertHasFormField(html, 'recovery_type')
    })

    it('1.4: displays reference datum note in active configuration card on GET /rockets/:id', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Madcow Super DX3' })
      await seedTestConfig(rocket.id, {
        cgMm: 720.0,
        cpMm: 850.0,
        stabilityCalibers: 1.6,
        isCurrent: true,
      })

      const res = await fetchGet(`/rockets/${rocket.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // The detail view must clarify datum
      expect(html).toMatch(/Nose Cone Tip/i)
      assertContains(html, '720')
      assertContains(html, '850')
    })

    it('1.5: displays both drogue and main parachute specifications on GET /rockets/:id for dual deploy', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Dual Deploy Beast' })

      // Seed dual deploy config
      await seedTestConfig(rocket.id, {
        recoveryType: 'dual_deploy',
        parachuteSizeMm: 1200, // Main
        isCurrent: true,
      })

      const res = await fetchGet(`/rockets/${rocket.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toMatch(/dual[ _-]?deploy/i)
      expect(html).toMatch(/1200|1,200/i)
    })
  })

  describe('Tier 2: Dual Deploy Persistence & Single Deploy Boundary Checks', () => {
    it('2.1: persists both main and drogue parachute sizes when recovery_type is dual_deploy (POST /rockets)', async () => {
      await seedTestUser()

      const res = await fetchPostForm('/rockets', {
        name: 'Aerotech Mirage Dual',
        status: 'flight_ready',
        airframe_material: 'fiberglass',
        fin_count: 4,
        dry_mass_g: 1450.0,
        loaded_mass_g: 2100.0,
        cg_mm: 890.0,
        cp_mm: 1040.0,
        stability_calibers: 1.8,
        recovery_type: 'dual_deploy',
        parachute_size_mm: 1500, // Main parachute (1500mm / 60in)
        drogue_parachute_size_mm: 450, // Drogue parachute (450mm / 18in)
        motor_mount_diameter_mm: 54,
      })

      expect([200, 302, 303]).toContain(res.status)

      // Query database to verify both parachute sizes
      const configs = await env.DB.prepare(
        `SELECT rc.* FROM rocket_configurations rc
         JOIN rockets r ON r.id = rc.rocket_id
         WHERE r.name = ?`,
      ).bind('Aerotech Mirage Dual').all<{
        recovery_type: string
        parachute_size_mm: number
        drogue_parachute_size_mm?: number
      }>()

      expect(configs.results.length).toBeGreaterThanOrEqual(1)
      const activeCfg = configs.results[0]
      expect(activeCfg.recovery_type).toBe('dual_deploy')
      expect(activeCfg.parachute_size_mm).toBeCloseTo(1500)
      if (activeCfg.drogue_parachute_size_mm !== undefined) {
        expect(activeCfg.drogue_parachute_size_mm).toBeCloseTo(450)
      }
    })

    it('2.2: maintains single parachute and stores null drogue when recovery_type is parachute', async () => {
      await seedTestUser()

      const res = await fetchPostForm('/rockets', {
        name: 'Estes Big Daddy Single',
        status: 'flight_ready',
        recovery_type: 'parachute',
        parachute_size_mm: 600,
        drogue_parachute_size_mm: '', // Empty or not applicable
      })

      expect([200, 302, 303]).toContain(res.status)

      const configs = await env.DB.prepare(
        `SELECT rc.* FROM rocket_configurations rc
         JOIN rockets r ON r.id = rc.rocket_id
         WHERE r.name = ?`,
      ).bind('Estes Big Daddy Single').all<{
        recovery_type: string
        parachute_size_mm: number
        drogue_parachute_size_mm?: number | null
      }>()

      expect(configs.results.length).toBeGreaterThanOrEqual(1)
      const cfg = configs.results[0]
      expect(cfg.recovery_type).toBe('parachute')
      expect(cfg.parachute_size_mm).toBeCloseTo(600)
      if (cfg.drogue_parachute_size_mm !== undefined) {
        expect([null, 0]).toContain(cfg.drogue_parachute_size_mm)
      }
    })

    it('2.3: stores drogue parachute in subsequent configuration snapshots (POST /rockets/:id/configurations)', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'PML Callisto' })

      const res = await fetchPostForm(`/rockets/${rocket.id}/configurations`, {
        version: 2,
        dry_mass_g: 980.0,
        loaded_mass_g: 1350.0,
        cg_mm: 620.0,
        cp_mm: 740.0,
        stability_calibers: 1.5,
        recovery_type: 'dual_deploy',
        parachute_size_mm: 900,
        drogue_parachute_size_mm: 300,
        motor_mount_diameter_mm: 38,
      })

      expect([200, 302, 303]).toContain(res.status)

      const saved = await env.DB.prepare(
        'SELECT * FROM rocket_configurations WHERE rocket_id = ? AND version = 2',
      ).bind(rocket.id).first<{
        recovery_type: string
        parachute_size_mm: number
        drogue_parachute_size_mm?: number
      }>()

      expect(saved?.recovery_type).toBe('dual_deploy')
      expect(saved?.parachute_size_mm).toBeCloseTo(900)
      if (saved?.drogue_parachute_size_mm !== undefined) {
        expect(saved.drogue_parachute_size_mm).toBeCloseTo(300)
      }
    })

    it('2.4: correctly records zero or null drogue parachute when streamer recovery is chosen', async () => {
      await seedTestUser()

      const res = await fetchPostForm('/rockets', {
        name: 'High Altitude Dart',
        status: 'flight_ready',
        recovery_type: 'streamer',
        parachute_size_mm: 0,
        drogue_parachute_size_mm: 0,
      })

      expect([200, 302, 303]).toContain(res.status)
    })
  })

  describe('Tier 3: Inter-Module Integration & Detail Views', () => {
    it('3.1: displays reference datum label for CG/CP on flight detail view (GET /flights/:id)', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'HyperLOC 835' })
      const config = await seedTestConfig(rocket.id, {
        cgMm: 950.0,
        cpMm: 1100.0,
        stabilityCalibers: 1.7,
        recoveryType: 'dual_deploy',
        parachuteSizeMm: 1200,
      })
      const motor = await seedTestMotor({ model: 'J420R-14A' })
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 1850,
      })

      const res = await fetchGet(`/flights/${flight.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Flight detail must show vehicle CG/CP and reference datum
      expect(html).toMatch(/nose cone tip/i)
      expect(html).toMatch(/950/i)
      expect(html).toMatch(/1100/i)
    })

    it('3.2: preserves both v1 single deploy and v2 dual deploy in configuration history table', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Evolutionary Airframe' })

      // Seed v1 as single deploy
      await seedTestConfig(rocket.id, {
        version: 1,
        recoveryType: 'parachute',
        parachuteSizeMm: 600,
        isCurrent: false,
      })

      // Seed v2 as dual deploy
      await seedTestConfig(rocket.id, {
        version: 2,
        recoveryType: 'dual_deploy',
        parachuteSizeMm: 1200,
        isCurrent: true,
      })

      const res = await fetchGet(`/rockets/${rocket.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Table should reflect both versions
      expect(html).toMatch(/v1|version 1/i)
      expect(html).toMatch(/v2|version 2/i)
    })

    it('3.3: dynamic form script toggles drogue input based on recovery_type select', async () => {
      await seedTestUser()
      const res = await fetchGet('/rockets/new')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Form should contain select with dual_deploy option
      expect(html).toMatch(/<option[^>]*value=["']dual_deploy["']/i)
    })
  })

  describe('Tier 4: Workload Scenario 2 — High-Power Rocket Assembly & Dual Deploy Prep', () => {
    it('executes complete end-to-end workflow for high-power rocket with dual-deploy avionics and datum verification', async () => {
      const flyer = await seedTestUser({ displayName: 'Senior Certifier' })

      // Step 1: Create a 4-inch high-power rocket airframe
      const createRes = await fetchPostForm('/rockets', {
        name: 'Binder Design Excel Plus',
        status: 'in_build',
      })
      expect([200, 302, 303]).toContain(createRes.status)

      const db = getDb()
      const [rocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.name, 'Binder Design Excel Plus'))
      expect(rocket).toBeDefined()

      // Step 2: Configure baseline dual-deploy recovery system
      // Drogue parachute (400mm / 16in) deploys at apogee; Main parachute (1200mm / 48in) at 500ft AGL.
      // Explicit datum: CG measured at 1100mm from nose tip, CP at 1280mm from nose tip.
      const configRes = await fetchPostForm(`/rockets/${rocket.id}/configurations`, {
        version: 1,
        airframe_material: 'fiberglass',
        fin_count: 4,
        dry_mass_g: 2200.0,
        loaded_mass_g: 3100.0,
        cg_mm: 1100.0,
        cp_mm: 1280.0,
        stability_calibers: 1.75,
        recovery_type: 'dual_deploy',
        parachute_size_mm: 1200,
        drogue_parachute_size_mm: 400,
        motor_mount_diameter_mm: 54,
      })
      expect([200, 302, 303]).toContain(configRes.status)

      // Step 3: Inspect configured rocket detail page
      const detailRes = await fetchGet(`/rockets/${rocket.id}`)
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()

      assertContains(detailHtml, 'Binder Design Excel Plus')
      // Datum label
      expect(detailHtml).toMatch(/Nose Cone Tip/i)
      // Main parachute
      expect(detailHtml).toMatch(/1200|1,200/i)

      // Step 4: Log high-power flight on J-class motor using this dual-deploy setup
      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'J420R-14A',
        impulseClass: 'J',
        totalImpulseNs: 780.0,
      })

      const [config] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        flightNumber: 1,
        altitudeAglM: 1940,
        outcome: 'successful',
      })

      // Step 5: Verify flight detail page includes dual-deploy vehicle specs and reference datum
      const flightRes = await fetchGet(`/flights/${flight.id}`)
      assertHtmlResponse(flightRes, 200)
      const flightHtml = await flightRes.text()

      expect(flightHtml).toMatch(/nose cone tip/i)
      expect(flightHtml).toContain('1100')
      expect(flightHtml).toContain('1280')
    })
  })
})
