/**
 * Challenger M4 Adversarial Verification Test Suite
 *
 * Requirements tested (Milestone 4 / Requirements R3 & R4):
 * 1. Dual-Deploy & Recovery Types Edge Cases:
 *    - Missing drogue size on dual_deploy
 *    - Negative drogue and main parachute sizes
 *    - Parachute / Streamer / Tumble / Other vs Dual Deploy drogue sanitization
 *    - Unrecognized recovery type fallback
 * 2. Rocket Configuration Versioning & History Preservation in D1:
 *    - v1 single deploy to v2 dual deploy persistence
 *    - is_current switching and history preservation
 *    - Multi-version audit trail (v1, v2, v3, v4)
 * 3. Reference Datum Clarity:
 *    - "Distance from Nose Cone Tip" explicit presence in forms and views
 *    - Metric and imperial persistence of datum clarity
 * 4. Flight Detail Views with Dual-Deploy Configurations:
 *    - Dual parachute rendering in metric and imperial
 *    - Single parachute, streamer, and tumble rendering
 * 5. Flights Unit Toggle & Navigation Polish:
 *    - Meters / Feet switcher and conversions
 *    - Header navigation audit (+ Log Flight removal from headers)
 */

import { env } from 'cloudflare:test'
import { describe, expect, it, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../../src/db/schema'
import {
  getDb,
  seedTestConfig,
  seedTestFlight,
  seedTestMotor,
  seedTestRocket,
  seedTestSite,
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

describe('Challenger M4: Adversarial Testing Suite (R3 & R4)', () => {
  describe('Vector 1: Dual-Deploy & Recovery Types Edge Cases', () => {
    it('1.1: accepts dual_deploy configuration when drogue parachute size is omitted/missing and stores null in D1', async () => {
      const user = await seedTestUser()

      // POST new rocket with dual_deploy but NO drogue size specified
      const res = await fetchPostForm('/rockets', {
        name: 'Dual Deploy Missing Drogue',
        status: 'flight_ready',
        recovery_type: 'dual_deploy',
        parachute_size_mm: 900,
        // drogue_parachute_size_mm omitted completely
      })

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [rocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.name, 'Dual Deploy Missing Drogue'))
      expect(rocket).toBeDefined()

      const [config] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))
      expect(config).toBeDefined()
      expect(config.recoveryType).toBe('dual_deploy')
      expect(config.parachuteSizeMm).toBeCloseTo(900)
      expect(config.drogueParachuteSizeMm).toBeNull()

      // Verify the rocket detail page renders without errors or NaN
      const detailRes = await fetchGet(`/rockets/${rocket.id}`)
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()
      expect(detailHtml).not.toContain('NaN')
      expect(detailHtml).not.toContain('undefined')
      expect(detailHtml).toMatch(/Main: 900mm/i)
    })

    it('1.2: handles empty string drogue_parachute_size_mm on subsequent configuration snapshots', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Titan IV' })

      const res = await fetchPostForm(`/rockets/${rocket.id}/configurations`, {
        version: 1,
        recovery_type: 'dual_deploy',
        parachute_size_mm: 1200,
        drogue_parachute_size_mm: '', // empty string
      })
      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [config] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))
      expect(config.recoveryType).toBe('dual_deploy')
      expect(config.parachuteSizeMm).toBeCloseTo(1200)
      expect(config.drogueParachuteSizeMm).toBeNull()
    })

    it('1.3: enforces null drogue_parachute_size_mm when recovery_type is parachute, ignoring supplied drogue input', async () => {
      const user = await seedTestUser()

      // User or attacker sends drogue parachute size for a single parachute recovery system
      const res = await fetchPostForm('/rockets', {
        name: 'Single Deploy With Rogue Drogue',
        status: 'flight_ready',
        recovery_type: 'parachute',
        parachute_size_mm: 600,
        drogue_parachute_size_mm: 300, // Should be purged/ignored!
      })
      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [rocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.name, 'Single Deploy With Rogue Drogue'))
      const [config] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))

      expect(config.recoveryType).toBe('parachute')
      expect(config.parachuteSizeMm).toBeCloseTo(600)
      // Must be null in D1!
      expect(config.drogueParachuteSizeMm).toBeNull()
    })

    it('1.4: enforces null drogue_parachute_size_mm when recovery_type is streamer, tumble, or other', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Multi Recovery Test' })

      for (const recType of ['streamer', 'tumble', 'other']) {
        const res = await fetchPostForm(`/rockets/${rocket.id}/configurations`, {
          recovery_type: recType,
          parachute_size_mm: 200,
          drogue_parachute_size_mm: 150, // Should be purged!
        })
        expect([200, 302, 303]).toContain(res.status)
      }

      const db = getDb()
      const configs = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))

      expect(configs.length).toBe(3)
      for (const cfg of configs) {
        expect(['streamer', 'tumble', 'other']).toContain(cfg.recoveryType)
        expect(cfg.drogueParachuteSizeMm).toBeNull()
      }
    })

    it('1.5: gracefully defaults unrecognized recovery_type to parachute and nullifies drogue', async () => {
      const user = await seedTestUser()

      const res = await fetchPostForm('/rockets', {
        name: 'Unrecognized Glider Airframe',
        status: 'flight_ready',
        recovery_type: 'glider_telemetry', // invalid
        parachute_size_mm: 500,
        drogue_parachute_size_mm: 250,
      })
      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [rocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.name, 'Unrecognized Glider Airframe'))
      const [config] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))

      expect(config.recoveryType).toBe('parachute')
      expect(config.drogueParachuteSizeMm).toBeNull()
    })

    it('1.6: handles negative drogue size input without throwing unhandled 500 errors', async () => {
      const user = await seedTestUser()

      const res = await fetchPostForm('/rockets', {
        name: 'Negative Drogue Test',
        status: 'flight_ready',
        recovery_type: 'dual_deploy',
        parachute_size_mm: 1000,
        drogue_parachute_size_mm: -200, // Negative input
      })
      // Server must handle gracefully (either redirect 303 or 400 validation error, NOT 500)
      expect([200, 302, 303, 400]).toContain(res.status)

      if ([200, 302, 303].includes(res.status)) {
        const db = getDb()
        const [rocket] = await db
          .select()
          .from(schema.rockets)
          .where(eq(schema.rockets.name, 'Negative Drogue Test'))
        const detailRes = await fetchGet(`/rockets/${rocket.id}`)
        assertHtmlResponse(detailRes, 200)
      }
    })
  })

  describe('Vector 2: Rocket Configuration Versioning & History Preservation', () => {
    it('2.1: preserves v1 single deploy and v2 dual deploy snapshots with independent integrity in D1', async () => {
      const user = await seedTestUser()

      // Step 1: Create rocket with v1 single deploy
      const res1 = await fetchPostForm('/rockets', {
        name: 'Evolutionary Flyer',
        status: 'flight_ready',
        recovery_type: 'parachute',
        parachute_size_mm: 600,
        cg_mm: 450,
        cp_mm: 580,
        stability_calibers: 1.4,
      })
      expect([200, 302, 303]).toContain(res1.status)

      const db = getDb()
      const [rocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.name, 'Evolutionary Flyer'))
      expect(rocket).toBeDefined()

      // Step 2: Add v2 dual deploy configuration
      const res2 = await fetchPostForm(`/rockets/${rocket.id}/configurations`, {
        recovery_type: 'dual_deploy',
        parachute_size_mm: 1200,
        drogue_parachute_size_mm: 350,
        cg_mm: 510,
        cp_mm: 640,
        stability_calibers: 1.6,
      })
      expect([200, 302, 303]).toContain(res2.status)

      // Step 3: Inspect D1 rows directly
      const configs = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))
        .orderBy(schema.rocketConfigurations.version)

      expect(configs.length).toBe(2)

      const v1 = configs[0]
      expect(v1.version).toBe(1)
      expect(v1.recoveryType).toBe('parachute')
      expect(v1.parachuteSizeMm).toBeCloseTo(600)
      expect(v1.drogueParachuteSizeMm).toBeNull()
      expect(v1.isCurrent).toBe(false) // Deactivated when v2 created

      const v2 = configs[1]
      expect(v2.version).toBe(2)
      expect(v2.recoveryType).toBe('dual_deploy')
      expect(v2.parachuteSizeMm).toBeCloseTo(1200)
      expect(v2.drogueParachuteSizeMm).toBeCloseTo(350)
      expect(v2.isCurrent).toBe(true) // Currently active
    })

    it('2.2: switches active configuration between v1 and v2 via set-current and reflects in spotlight card', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Switchable Rocket' })

      const cfg1 = await seedTestConfig(rocket.id, {
        version: 1,
        recoveryType: 'parachute',
        parachuteSizeMm: 500,
        isCurrent: true,
      })
      const cfg2 = await seedTestConfig(rocket.id, {
        version: 2,
        recoveryType: 'dual_deploy',
        parachuteSizeMm: 1100,
        drogueParachuteSizeMm: 300,
        isCurrent: false,
      })

      // View rocket detail when v1 is active
      const resV1 = await fetchGet(`/rockets/${rocket.id}`)
      assertHtmlResponse(resV1, 200)
      const htmlV1 = await resV1.text()
      // Spotlight should show v1
      expect(htmlV1).toContain('v1')
      expect(htmlV1).toContain('500mm')

      // Switch active to v2
      const switchRes = await fetchPostForm(`/rockets/${rocket.id}/configurations/${cfg2.id}/set-current`, {})
      expect([200, 302, 303]).toContain(switchRes.status)

      // Verify D1 states
      const db = getDb()
      const [updatedCfg1] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, cfg1.id))
      const [updatedCfg2] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, cfg2.id))

      expect(updatedCfg1.isCurrent).toBe(false)
      expect(updatedCfg2.isCurrent).toBe(true)

      // View rocket detail when v2 is active
      const resV2 = await fetchGet(`/rockets/${rocket.id}`)
      assertHtmlResponse(resV2, 200)
      const htmlV2 = await resV2.text()
      // Spotlight should now show v2 with dual deploy parachutes
      expect(htmlV2).toContain('v2')
      expect(htmlV2).toMatch(/Main: 1100mm,\s*Drogue: 300mm/i)
    })

    it('2.3: maintains 4-version configuration history across diverse recovery types (v1 single, v2 dual, v3 streamer, v4 dual)', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Full Lifecycle Airframe' })

      // Create v1, v2, v3, v4 snapshots
      await fetchPostForm(`/rockets/${rocket.id}/configurations`, {
        recovery_type: 'parachute',
        parachute_size_mm: 450,
      })
      await fetchPostForm(`/rockets/${rocket.id}/configurations`, {
        recovery_type: 'dual_deploy',
        parachute_size_mm: 1000,
        drogue_parachute_size_mm: 300,
      })
      await fetchPostForm(`/rockets/${rocket.id}/configurations`, {
        recovery_type: 'streamer',
        parachute_size_mm: 100,
      })
      await fetchPostForm(`/rockets/${rocket.id}/configurations`, {
        recovery_type: 'dual_deploy',
        parachute_size_mm: 1500,
        drogue_parachute_size_mm: 450,
      })

      const res = await fetchGet(`/rockets/${rocket.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // History table should list v1, v2, v3, v4
      expect(html).toContain('v1')
      expect(html).toContain('v2')
      expect(html).toContain('v3')
      expect(html).toContain('v4')
      // v4 should be active
      expect(html).toMatch(/Main: 1500mm,\s*Drogue: 450mm/i)
    })
  })

  describe('Vector 3: Reference Datum Clarity Across Forms and Views', () => {
    it('3.1: explicitly displays "Distance from Nose Cone Tip" in GET /rockets/new for CG and CP', async () => {
      await seedTestUser()
      const res = await fetchGet('/rockets/new')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'Distance from Nose Cone Tip')
      expect(html).toMatch(/Center of Gravity.*(mm)/i)
      expect(html).toMatch(/Center of Pressure.*(mm)/i)
    })

    it('3.2: explicitly displays "Distance from Nose Cone Tip" in GET /rockets/:id/configurations/new for CG and CP', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id)
      const res = await fetchGet(`/rockets/${rocket.id}/configurations/new`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'Distance from Nose Cone Tip')
    })

    it('3.3: explicitly displays "Distance from Nose Cone Tip" on active configuration spotlight card in GET /rockets/:id', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id)
      await seedTestConfig(rocket.id, {
        cgMm: 780,
        cpMm: 920,
        stabilityCalibers: 1.5,
        isCurrent: true,
      })

      const res = await fetchGet(`/rockets/${rocket.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'Distance from Nose Cone Tip')
      assertContains(html, '780 mm')
      assertContains(html, '920 mm')
    })

    it('3.4: explicitly notes "Distance from Nose Cone Tip" as table footnote/reference in GET /rockets/:id history table', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id)
      await seedTestConfig(rocket.id, { version: 1 })

      const res = await fetchGet(`/rockets/${rocket.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toMatch(/Reference datum for CG and CP:\s*Distance from Nose Cone Tip/i)
    })

    it('3.5: explicitly displays "Distance from Nose Cone Tip" on vehicle configuration card in GET /flights/:id', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id)
      const config = await seedTestConfig(rocket.id, {
        cgMm: 650,
        cpMm: 780,
      })
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 500,
      })

      const res = await fetchGet(`/flights/${flight.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'Distance from Nose Cone Tip')
      assertContains(html, '650mm / 780mm')
    })

    it('3.6: preserves "Distance from Nose Cone Tip" when viewing GET /flights/:id in imperial (?units=ft)', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id)
      const config = await seedTestConfig(rocket.id, {
        cgMm: 914.4, // 3.0 ft
        cpMm: 1219.2, // 4.0 ft
      })
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 1000,
      })

      const res = await fetchGet(`/flights/${flight.id}?units=ft`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'Distance from Nose Cone Tip')
      // In imperial, 914.4mm -> 3.0 ft, 1219.2mm -> 4.0 ft
      expect(html).toMatch(/3\.0\s*ft\s*\/\s*4\.0\s*ft/i)
    })
  })

  describe('Vector 4: Flight Detail Views with Dual-Deploy Rocket Configurations', () => {
    it('4.1: correctly renders both Main and Drogue parachutes on GET /flights/:id in metric mode', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Blackstone DD' })
      const config = await seedTestConfig(rocket.id, {
        recoveryType: 'dual_deploy',
        parachuteSizeMm: 1800,
        drogueParachuteSizeMm: 500,
      })
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 2500,
      })

      const res = await fetchGet(`/flights/${flight.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toMatch(/Dual Deploy/i)
      expect(html).toMatch(/Main:\s*1800mm/i)
      expect(html).toMatch(/Drogue:\s*500mm/i)
    })

    it('4.2: correctly converts both Main and Drogue parachutes to feet on GET /flights/:id?units=ft', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Imperial DD' })
      const config = await seedTestConfig(rocket.id, {
        recoveryType: 'dual_deploy',
        parachuteSizeMm: 1524, // 1524mm / 304.8 = 5.0 ft
        drogueParachuteSizeMm: 457.2, // 457.2mm / 304.8 = 1.5 ft
      })
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 1000,
      })

      const res = await fetchGet(`/flights/${flight.id}?units=ft`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toMatch(/Dual Deploy/i)
      expect(html).toMatch(/Main:\s*5\.0\s*ft/i)
      expect(html).toMatch(/Drogue:\s*1\.5\s*ft/i)
    })

    it('4.3: does not render drogue parachute for single parachute flight configs', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Single Deploy Only' })
      const config = await seedTestConfig(rocket.id, {
        recoveryType: 'parachute',
        parachuteSizeMm: 600,
        drogueParachuteSizeMm: null,
      })
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 400,
      })

      const res = await fetchGet(`/flights/${flight.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toMatch(/Parachute/i)
      expect(html).toMatch(/600mm/i)
      expect(html).not.toMatch(/Drogue/i)
    })

    it('4.4: renders dual deploy without drogue if drogueParachuteSizeMm is null', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id)
      const config = await seedTestConfig(rocket.id, {
        recoveryType: 'dual_deploy',
        parachuteSizeMm: 1200,
        drogueParachuteSizeMm: null,
      })
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 800,
      })

      const res = await fetchGet(`/flights/${flight.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toMatch(/Dual Deploy/i)
      expect(html).toMatch(/Main:\s*1200mm/i)
      expect(html).not.toContain('NaN')
      expect(html).not.toContain('undefined')
    })
  })

  describe('Vector 5: Flights Unit Toggle & Header Navigation Cleanliness', () => {
    it('5.1: unit switcher toggle exists on /flights with working m/ft options', async () => {
      await seedTestUser()
      const res = await fetchGet('/flights')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('href="/flights?units=m"')
      expect(html).toContain('href="/flights?units=ft"')
    })

    it('5.2: unit switcher toggle exists on /flights/:id with working m/ft options', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 600,
      })

      const res = await fetchGet(`/flights/${flight.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain(`href="/flights/${flight.id}?units=m"`)
      expect(html).toContain(`href="/flights/${flight.id}?units=ft"`)
    })

    it('5.3: altitude data attributes data-m and data-altitude are populated for client-side reactivity', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 1450,
      })

      const res = await fetchGet('/flights')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toMatch(/data-m=["']1450["']/)
      expect(html).toMatch(/data-altitude=["']1450["']/)
    })

    it('5.4: removes redundant "+ Log Flight" button from desktop and mobile headers across main routes', async () => {
      await seedTestUser()

      for (const path of ['/', '/flights', '/rockets', '/motors', '/inventory', '/sites']) {
        const res = await fetchGet(path)
        assertHtmlResponse(res, 200)
        const html = await res.text()

        // Desktop header button pattern: <div class="flex items-center space-x-4">...<a href="/flights/new"...>+ Log Flight
        const desktopHeaderPattern = /<div class=["']flex items-center space-x-4["']>[\s\S]*?<a href=["']\/flights\/new["'][^>]*>\s*\+ Log Flight/i
        expect(html).not.toMatch(desktopHeaderPattern)

        // Mobile header button pattern
        const mobileHeaderPattern = /<div class=["']md:hidden[^"']*["']>[\s\S]*?<a href=["']\/flights\/new["'][^>]*>\s*\+ Log Flight/i
        expect(html).not.toMatch(mobileHeaderPattern)
      }
    })

    it('5.5: ensures contextual flight logging links remain present on /flights and /rockets/:id', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id)

      // Contextual log flight on /flights
      const flightsRes = await fetchGet('/flights')
      assertHtmlResponse(flightsRes, 200)
      const flightsHtml = await flightsRes.text()
      expect(flightsHtml).toContain('href="/flights/new"')

      // Contextual log flight on /rockets/:id
      const rocketRes = await fetchGet(`/rockets/${rocket.id}`)
      assertHtmlResponse(rocketRes, 200)
      const rocketHtml = await rocketRes.text()
      expect(rocketHtml).toContain(`href="/flights/new?rocket_id=${rocket.id}"`)
    })
  })
})
