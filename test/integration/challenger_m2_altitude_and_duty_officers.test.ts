/**
 * Milestone 2 Challenger 1 Adversarial Verification Test Suite:
 * Dual Altitude Units & Pure Text Duty Officers (R2).
 *
 * Empirical verification of:
 * 1. Dual Peak Altitude Units:
 *    - Entering feet only (e.g. 5280 ft) computes canonical meters (~1609.3 m) in D1.
 *    - Entering meters only persists directly and displays both units.
 *    - Negative altitude entry (e.g. -10 m, -32.8 ft) for barometric depression.
 *    - Floating point boundary values, zero altitude, extremely high altitude (space / 100km).
 * 2. Pure Text Duty Officers:
 *    - Special characters, quotes, and symbols.
 *    - Full UTF-8 Unicode emojis in officer names.
 *    - Long names (255 characters) without truncation or SQLite crashes.
 *    - Empty strings and whitespace-only values stored as null without FK errors.
 *    - Visiting officers not present in the users table.
 *    - Invalid user ID sanitization preventing FK constraint violations.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../../src/db/schema'
import { signSession } from '../../src/services/auth'
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
  assertAlertBanner,
  assertContains,
  assertHasFormField,
  assertHtmlResponse,
  assertNotContains,
} from '../helpers/html'
import { fetchGet, fetchHtmxPostForm, fetchPostForm } from '../helpers/http'

beforeEach(truncateDb)

describe('Milestone 2 Challenger 1: Dual Altitude Units & Pure Text Duty Officers (R2)', () => {
  // =========================================================================
  // CATEGORY 1: Feet Only Altitude Entry & Canonical D1 Persistence
  // =========================================================================
  describe('Category 1: Feet Only Altitude Entry & Canonical D1 Persistence', () => {
    it('1.1: entering feet only (5280 ft) computes canonical meters (~1609.34 m) in D1', async () => {
      const flyer = await seedTestUser({ displayName: 'Imperial Flyer' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite({ maxAltitudeAglM: 5000 })

      // Submit altitude strictly in feet: 5280 ft = 1 mile = 1609.344 m
      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_ft: 5280,
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(saved).toBeDefined()
      expect(saved.altitudeAglM).not.toBeNull()
      // 5280 * 0.3048 = 1609.344 -> rounded to 1609.34
      expect(saved.altitudeAglM).toBeCloseTo(1609.34, 1)
    })

    it('1.2: form submission with empty string altitude_agl_m and 5280 ft computes canonical meters', async () => {
      const flyer = await seedTestUser({ displayName: 'Web Form Flyer' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite({ maxAltitudeAglM: 5000 })

      // Simulates browser submitting empty string for altitude_agl_m
      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: '',
          altitude_agl_ft: '5280',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(saved).toBeDefined()
      expect(saved.altitudeAglM).toBeCloseTo(1609.34, 1)
    })

    it('1.3: updating flight via POST /flights/:id/edit with feet only (3280.84 ft) updates canonical meters', async () => {
      const flyer = await seedTestUser({ displayName: 'Editor Flyer' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite({ maxAltitudeAglM: 5000 })

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        altitudeAglM: 500,
      })

      // Update to 3280.84 ft (~1000.0 m) with empty meters
      const res = await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: '',
          altitude_agl_ft: '3280.84',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flight.id))

      expect(updated).toBeDefined()
      expect(updated.altitudeAglM).toBeCloseTo(1000.0, 0)
    })

    it('1.4: preflight soft gate evaluation computes meters from feet only and flags ceiling violations', async () => {
      const flyer = await seedTestUser()
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.5 })
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite({ maxAltitudeAglM: 1000 }) // 1,000 m ceiling

      // 5280 ft = ~1609.34 m, which exceeds the 1,000 m ceiling
      const res = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        altitude_agl_m: '',
        altitude_agl_ft: '5280',
      })

      expect(res.status).toBe(200)
      const fragment = await res.text()
      assertAlertBanner(fragment, 'warning')
      expect(fragment).toMatch(/exceeds the site waiver ceiling/i)
      expect(fragment).toContain('1609.34m')
      expect(fragment).toContain('1000m')
    })

    it('1.5: preflight soft gate with feet within ceiling passes without ceiling warning', async () => {
      const flyer = await seedTestUser()
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.5 })
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite({ maxAltitudeAglM: 1000 })

      // 1000 ft = ~304.8 m, well below 1,000 m ceiling
      const res = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        altitude_agl_m: '',
        altitude_agl_ft: '1000',
      })

      expect(res.status).toBe(200)
      const fragment = await res.text()
      expect(fragment).not.toMatch(/exceeds the site waiver ceiling/i)
    })

    it('1.6: client-side dual altitude bi-directional sync script is embedded in flight form', async () => {
      const res = await fetchGet('/flights/new')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Side-by-side inputs
      assertHasFormField(html, 'altitude_agl_m')
      assertHasFormField(html, 'altitude_agl_ft')

      // Check client JS sync implementation details
      expect(html).toContain('function initDualAltitudeSync()')
      expect(html).toContain('mInput.addEventListener(\'input\'')
      expect(html).toContain('ftInput.addEventListener(\'input\'')
      expect(html).toContain('3.28084')
      expect(html).toContain('0.3048')
      expect(html).toContain('isSyncing')
      expect(html).toContain('dispatchEvent(new Event(\'change\'')
    })
  })

  // =========================================================================
  // CATEGORY 2: Meters Only Entry & Dual Unit Display
  // =========================================================================
  describe('Category 2: Meters Only Entry & Dual Unit Display', () => {
    it('2.1: entering meters only (1000 m) persists directly in D1', async () => {
      const flyer = await seedTestUser({ displayName: 'Metric Flyer' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite({ maxAltitudeAglM: 5000 })

      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: 1000,
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(saved).toBeDefined()
      expect(saved.altitudeAglM).toBe(1000)
    })

    it('2.2: flight detail view renders both meters and feet in metric view', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 1000,
      })

      const res = await fetchGet(`/flights/${flight.id}?units=m`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Should display meters primary and feet secondary: 1,000 m (3,281 ft)
      expect(html).toMatch(/1,?000\s*m\s*\(\s*3,?281\s*ft\s*\)/i)
    })

    it('2.3: flight detail view renders both feet and meters in imperial view', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 1000,
      })

      const res = await fetchGet(`/flights/${flight.id}?units=ft`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Should display feet primary and meters secondary: 3,281 ft (1,000 m)
      expect(html).toMatch(/3,?281\s*ft\s*\(\s*1,?000\s*m\s*\)/i)
    })

    it('2.4: flight edit form pre-populates meters and computed feet values', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 1000,
      })

      const res = await fetchGet(`/flights/${flight.id}/edit`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Meters input should be 1000
      expect(html).toContain('value="1000"')
      // Feet input should be (1000 * 3.28084).toFixed(1) = 3280.8
      expect(html).toContain('value="3280.8"')
    })

    it('2.5: flight listing table displays dual unit representation', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 850,
      })

      const res = await fetchGet('/flights', {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Listing contains 850 m and data attributes
      expect(html).toContain('data-m="850"')
      expect(html).toMatch(/850/i)
    })
  })

  // =========================================================================
  // CATEGORY 3: Negative Altitude Entry (Barometric Depression)
  // =========================================================================
  describe('Category 3: Negative Altitude Entry (Barometric Depression)', () => {
    it('3.1: negative altitude in meters (-10 m) persists in D1 without error', async () => {
      const flyer = await seedTestUser({ displayName: 'Depression Pilot' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: -10,
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(saved).toBeDefined()
      expect(saved.altitudeAglM).toBe(-10)
    })

    it('3.2: negative altitude in feet (-32.8 ft) computes and persists ~-10.0 m in D1', async () => {
      const flyer = await seedTestUser({ displayName: 'Imperial Depression Flyer' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: '',
          altitude_agl_ft: '-32.8',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(saved).toBeDefined()
      // -32.8 * 0.3048 = -9.99744 -> -10.00
      expect(saved.altitudeAglM).toBeCloseTo(-10.0, 1)
    })

    it('3.3: flight detail view displays negative altitude in both metric and imperial units', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: -10,
      })

      const res = await fetchGet(`/flights/${flight.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // -10 m (-33 ft)
      expect(html).toContain('-10 m')
      expect(html).toContain('-33 ft')
    })

    it('3.4: dynamic preflight check with negative altitude does not crash or trigger ceiling warning', async () => {
      const flyer = await seedTestUser()
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.5 })
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite({ maxAltitudeAglM: 1000 })

      const res = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        altitude_agl_m: -10,
      })

      expect(res.status).toBe(200)
      const fragment = await res.text()
      expect(fragment).not.toMatch(/exceeds the site waiver ceiling/i)
    })

    it('3.5: updating flight to negative altitude persists in D1', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 100,
      })

      const res = await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          altitude_agl_m: -25.5,
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flight.id))

      expect(updated).toBeDefined()
      expect(updated.altitudeAglM).toBe(-25.5)
    })
  })

  // =========================================================================
  // CATEGORY 4: Floating Point Boundaries, Zero, & Space / 100km Karman Line
  // =========================================================================
  describe('Category 4: Floating Point Boundaries, Zero, & Space / 100km Karman Line', () => {
    it('4.1: zero altitude in meters (0 m) persists as 0 in D1 and displays 0 m (0 ft)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: 0,
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(saved).toBeDefined()
      expect(saved.altitudeAglM).toBe(0)

      // Detail view
      const detailRes = await fetchGet(`/flights/${saved.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      const detailHtml = await detailRes.text()
      expect(detailHtml).toMatch(/0\s*m\s*\(\s*0\s*ft\s*\)/i)
    })

    it('4.2: zero altitude in feet (0 ft) persists as 0 in D1', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: '',
          altitude_agl_ft: 0,
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(saved).toBeDefined()
      expect(saved.altitudeAglM).toBe(0)
    })

    it('4.3: high precision floating point altitude (123.4567 m) persists accurately', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: 123.4567,
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(saved).toBeDefined()
      expect(saved.altitudeAglM).toBeCloseTo(123.4567, 4)
    })

    it('4.4: 100km space altitude without authorization triggers 422, but persists with override authorization', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite({ maxAltitudeAglM: 3000 })

      // 1. Without authorization override: soft-gate triggers 422 Unprocessable Entity
      const unauthRes = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: 100000,
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect(unauthRes.status).toBe(422)
      const unauthHtml = await unauthRes.text()
      expect(unauthHtml).toMatch(/exceeds the site waiver ceiling/i)

      // 2. With authorization override (proceeded_despite_warnings = true): persists successfully
      const authRes = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: 100000,
          proceeded_despite_warnings: 'true',
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect([200, 302, 303]).toContain(authRes.status)

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(saved).toBeDefined()
      expect(saved.altitudeAglM).toBe(100000)

      // Detail view should render 100,000 m (328,084 ft)
      const detailRes = await fetchGet(`/flights/${saved.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      const detailHtml = await detailRes.text()
      expect(detailHtml).toMatch(/100,?000\s*m\s*\(\s*328,?084\s*ft\s*\)/i)
    })

    it('4.5: extremely high altitude in feet (328084 ft) computes canonical Karman line ~100,000 m in D1', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite({ maxAltitudeAglM: null }) // Unlimited waiver ceiling

      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: '',
          altitude_agl_ft: 328084,
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(saved).toBeDefined()
      // 328084 * 0.3048 = 100000.0032
      expect(saved.altitudeAglM).toBeCloseTo(100000.0, 0)
    })

    it('4.6: 100km space altitude against site ceiling triggers preflight ceiling soft gate', async () => {
      const flyer = await seedTestUser()
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.5 })
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite({ maxAltitudeAglM: 3000 })

      const res = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        altitude_agl_m: 100000,
      })

      expect(res.status).toBe(200)
      const fragment = await res.text()
      assertAlertBanner(fragment, 'warning')
      expect(fragment).toMatch(/exceeds the site waiver ceiling/i)
      expect(fragment).toContain('100000m')
      expect(fragment).toContain('3000m')
    })

    it('4.7: 100km space altitude against unlimited site ceiling (null) produces no ceiling warning', async () => {
      const flyer = await seedTestUser()
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.5 })
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite({ maxAltitudeAglM: null })

      const res = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        altitude_agl_m: 100000,
      })

      expect(res.status).toBe(200)
      const fragment = await res.text()
      expect(fragment).not.toMatch(/exceeds the site waiver ceiling/i)
    })
  })

  // =========================================================================
  // CATEGORY 5: Pure Text Duty Officers Adversarial Testing
  // =========================================================================
  describe('Category 5: Pure Text Duty Officers Adversarial Testing', () => {
    it('5.1: special characters, quotes, and punctuation in officer names persist and display safely', async () => {
      const flyer = await seedTestUser({ displayName: 'Punctuation Pilot' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const specialRso = `O'Connor & "Maverick" / Safety-Lead #1 <Sec>`
      const specialLco = `Pad-Master [Bravo-9] & Co. (Alpha)`

      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: 500,
          rso_name: specialRso,
          lco_name: specialLco,
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(saved).toBeDefined()
      expect(saved.rsoName).toBe(specialRso)
      expect(saved.lcoName).toBe(specialLco)

      // Verify safe HTML escaping in detail view
      const detailRes = await fetchGet(`/flights/${saved.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain("O&#39;Connor &amp; &quot;Maverick&quot; / Safety-Lead #1 &lt;Sec&gt;")
      expect(detailHtml).toContain('Pad-Master [Bravo-9] &amp; Co. (Alpha)')
      expect(detailHtml).not.toContain('<Sec>')

      // Verify edit form handles quotes and special characters in attributes safely
      const editRes = await fetchGet(`/flights/${saved.id}/edit`, {
        Cookie: `triplet_session=${token}`,
      })
      const editHtml = await editRes.text()
      expect(editHtml).toContain('&quot;Maverick&quot;')
      expect(editHtml).toContain('&lt;Sec&gt;')
      expect(editHtml).not.toContain('<Sec>')
    })

    it('5.2: full UTF-8 Unicode emojis in officer names persist in D1 and render in detail view', async () => {
      const flyer = await seedTestUser({ displayName: 'Emoji Flyer' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const emojiRso = '🛡️ Safety Sam 🦺 🚀'
      const emojiLco = '⚡ Controller Chris 🛰️ 🎯'

      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: 600,
          rso_name: emojiRso,
          lco_name: emojiLco,
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(saved).toBeDefined()
      expect(saved.rsoName).toBe(emojiRso)
      expect(saved.lcoName).toBe(emojiLco)

      const detailRes = await fetchGet(`/flights/${saved.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain(emojiRso)
      expect(detailHtml).toContain(emojiLco)
    })

    it('5.3: long officer names (255 characters) persist without SQLite errors or truncation', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const longRso = 'RSO-Officer-' + 'A'.repeat(243) // 255 chars
      const longLco = 'LCO-Director-' + 'B'.repeat(242) // 255 chars

      expect(longRso.length).toBe(255)
      expect(longLco.length).toBe(255)

      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: 700,
          rso_name: longRso,
          lco_name: longLco,
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(saved).toBeDefined()
      expect(saved.rsoName).toBe(longRso)
      expect(saved.lcoName).toBe(longLco)

      const detailRes = await fetchGet(`/flights/${saved.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain(longRso)
      expect(detailHtml).toContain(longLco)
    })

    it('5.4: empty strings for rso_name and lco_name store as null without FK errors', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: 800,
          rso_name: '',
          lco_name: '',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(saved).toBeDefined()
      expect(saved.rsoName).toBeNull()
      expect(saved.lcoName).toBeNull()
      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBeNull()

      // Detail view shows 'Unassigned' fallback
      const detailRes = await fetchGet(`/flights/${saved.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain('Unassigned')
    })

    it('5.5: whitespace-only strings are trimmed to null without FK errors', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: 800,
          rso_name: '   ',
          lco_name: ' \t\n ',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(saved).toBeDefined()
      expect(saved.rsoName).toBeNull()
      expect(saved.lcoName).toBeNull()
    })

    it('5.6: arbitrary visiting duty officer names not in users table persist cleanly', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const visitingRso = 'Visiting flyer from NZ Club'
      const visitingLco = 'Guest Marshall Dave'

      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: 800,
          rso_name: visitingRso,
          lco_name: visitingLco,
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(saved).toBeDefined()
      expect(saved.rsoName).toBe(visitingRso)
      expect(saved.lcoName).toBe(visitingLco)
      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBeNull()
    })

    it('5.7: non-existent UUID in rso_user_id/lco_user_id is safely sanitized to null', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const bogusId1 = '00000000-0000-0000-0000-000000000001'
      const bogusId2 = '00000000-0000-0000-0000-000000000002'

      // Submit bogus user IDs alongside text names
      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: 800,
          rso_user_id: bogusId1,
          lco_user_id: bogusId2,
          rso_name: 'Sanitized RSO',
          lco_name: 'Sanitized LCO',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(saved).toBeDefined()
      expect(saved.rsoName).toBe('Sanitized RSO')
      expect(saved.lcoName).toBe('Sanitized LCO')
      // Foreign keys sanitized to null, preventing crash
      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBeNull()
    })

    it('5.8: editing flight updates duty officers, and clearing them sets to null', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        rsoName: 'Initial RSO',
        lcoName: 'Initial LCO',
      })

      // 1. Update to new names
      await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          rso_name: 'Rotated RSO Bob',
          lco_name: 'Rotated LCO Alice',
        },
        { Cookie: `triplet_session=${token}` },
      )

      const db = getDb()
      let [current] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flight.id))
      expect(current.rsoName).toBe('Rotated RSO Bob')
      expect(current.lcoName).toBe('Rotated LCO Alice')

      // 2. Clear officers by submitting empty strings
      await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          rso_name: '',
          lco_name: '',
        },
        { Cookie: `triplet_session=${token}` },
      )

      ;[current] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flight.id))
      expect(current.rsoName).toBeNull()
      expect(current.lcoName).toBeNull()
    })
  })
})
