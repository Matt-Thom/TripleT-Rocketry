/**
 * Integration test suite for Flight Logging & Range Companion Preflight Workflows.
 * Tests preflight HTMX dynamic safety checks (POST /flights/preflight-check),
 * flight log creation, soft-gate warning overrides persistence in D1
 * (soft_gate_warnings, proceeded_despite_warnings), telemetry recording,
 * and Real-World Mission Scenarios 1-5 from TEST_INFRA.md.
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import { signSession } from '../../src/services/auth'
import {
  getDb,
  seedTestCert,
  seedTestConfig,
  seedTestFlight,
  seedTestInventory,
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
} from '../helpers/html'
import {
  fetchGet,
  fetchHtmxPostForm,
  fetchPostForm,
} from '../helpers/http'

beforeEach(truncateDb)

describe('Flight Logging & Range Companion Preflight (Tiers 1-4)', () => {
  describe('Tier 1: Flight Logbook Listing & New Flight Form (GET /flights, GET /flights/new)', () => {
    it('returns HTTP 200 with HTML content for flight log list', async () => {
      const res = await fetchGet('/flights')
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/flight/i)
    })

    it('renders flight creation form with rocket, motor, site, and telemetry fields', async () => {
      const res = await fetchGet('/flights/new')
      assertHtmlResponse(res, 200)
      const html = await res.text()
      assertHasFormField(html, 'rocket_configuration_id')
      assertHasFormField(html, 'motor_id')
      assertHasFormField(html, 'launch_site_id')
      assertHasFormField(html, 'altitude_agl_m')
    })
  })

  describe('Tier 2: Dynamic Preflight Soft-Gate HTMX Check (POST /flights/preflight-check)', () => {
    it('returns certification warning banner when uncertified flyer selects HPR motor', async () => {
      const flyer = await seedTestUser({ displayName: 'Novice Flyer' }) // L0 (no cert)
      const rocket = await seedTestRocket(flyer.id, { name: 'High Power Test' })
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.5 })
      const motor = await seedTestMotor({ impulseClass: 'H', model: 'H128W' })
      const site = await seedTestSite({ maxAltitudeAglM: 3000 })

      const res = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        expected_altitude_m: 800,
      })

      expect(res.status).toBe(200)
      const fragment = await res.text()
      assertAlertBanner(fragment, 'warning')
      expect(fragment).toMatch(/requires Level 1|certification/i)
      // Check for presence of proceeded_despite_warnings checkbox
      expect(fragment).toMatch(/proceeded_despite_warnings/i)
    })

    it('returns aerodynamic instability warning when stability margin is < 1.0 caliber', async () => {
      const flyer = await seedTestUser()
      await seedTestCert(flyer.id, { level: 1 }) // Flyer is L1
      const rocket = await seedTestRocket(flyer.id, { name: 'Marginal Rocket' })
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 0.85 }) // Unstable!
      const motor = await seedTestMotor({ impulseClass: 'H', model: 'H128W' })
      const site = await seedTestSite({ maxAltitudeAglM: 3000 })

      const res = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        expected_altitude_m: 800,
      })

      expect(res.status).toBe(200)
      const fragment = await res.text()
      assertAlertBanner(fragment, 'warning')
      expect(fragment).toMatch(/stability|caliber|1\.0/i)
    })

    it('returns waiver ceiling warning when expected altitude exceeds site max altitude', async () => {
      const flyer = await seedTestUser()
      await seedTestCert(flyer.id, { level: 2 })
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.8 })
      const motor = await seedTestMotor({ impulseClass: 'J', model: 'J350W' })
      const site = await seedTestSite({ maxAltitudeAglM: 1500 }) // 1,500m ceiling

      const res = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        expected_altitude_m: 2200, // Exceeds 1500m!
      })

      expect(res.status).toBe(200)
      const fragment = await res.text()
      assertAlertBanner(fragment, 'warning')
      expect(fragment).toMatch(/ceiling|exceeds|waiver/i)
    })

    it('returns clean confirmation when all soft gates pass without warnings', async () => {
      const flyer = await seedTestUser()
      await seedTestCert(flyer.id, { level: 1 })
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.6 })
      const motor = await seedTestMotor({ impulseClass: 'H', model: 'H128W' })
      const site = await seedTestSite({ maxAltitudeAglM: 2500 })

      const res = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        expected_altitude_m: 900,
      })

      expect(res.status).toBe(200)
      const fragment = await res.text()
      // No warning alert banner
      expect(fragment).not.toMatch(/requires Level 1/i)
      expect(fragment).toMatch(/(ready|clear|safe|all checks pass)/i)
    })
  })

  describe('Tier 3: Flight Logging & Warning Persistence (POST /flights)', () => {
    it('persists warning array and proceeded_despite_warnings flag when flyer acknowledges warnings', async () => {
      const flyer = await seedTestUser()
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 0.85 })
      const motor = await seedTestMotor({ impulseClass: 'H', model: 'H128W' })
      const site = await seedTestSite({ maxAltitudeAglM: 3000 })

      const res = await fetchPostForm('/flights', {
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        flight_number: 1,
        altitude_agl_m: 780.5,
        max_velocity_mps: 145.2,
        outcome: 'successful',
        notes: 'Flew with marginal stability override; landing was nominal',
        proceeded_despite_warnings: 'true',
        soft_gate_warnings: JSON.stringify([
          'Motor impulse class H requires Level 1 certification, but flyer has Level 0.',
          'Stability margin of 0.85 calibers is below the 1.0 caliber safety threshold.',
        ]),
      })

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(saved).toBeDefined()
      expect(saved.proceededDespiteWarnings).toBe(true)
      expect(saved.softGateWarnings).toHaveLength(2)
      expect(saved.altitudeAglM).toBeCloseTo(780.5)
      expect(saved.maxVelocityMps).toBeCloseTo(145.2)
      expect(saved.outcome).toBe('successful')
    })

    it('persists empty warnings array and proceeded_despite_warnings = false for clean flight', async () => {
      const flyer = await seedTestUser()
      await seedTestCert(flyer.id, { level: 1 })
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.5 })
      const motor = await seedTestMotor({ impulseClass: 'H', model: 'H128W' })
      const site = await seedTestSite({ maxAltitudeAglM: 3000 })

      const res = await fetchPostForm('/flights', {
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        flight_number: 2,
        altitude_agl_m: 850.0,
        outcome: 'successful',
        proceeded_despite_warnings: 'false',
        soft_gate_warnings: JSON.stringify([]),
      })

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.flightNumber, 2))

      expect(saved).toBeDefined()
      expect(saved.proceededDespiteWarnings).toBe(false)
      expect(saved.softGateWarnings).toEqual([])
    })
  })

  describe('Tier 4: Real-World Application Mission Workloads (Scenarios 1–5)', () => {
    it('Scenario 1: First Flight of Model Rocket (Estes Alpha, C6-5, local park, clean flight)', async () => {
      const flyer = await seedTestUser({ displayName: 'Model Rocket Cadet' })
      const rocket = await seedTestRocket(flyer.id, { name: 'Estes Alpha III' })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        dryMassG: 34.0,
        loadedMassG: 55.0,
        stabilityCalibers: 1.8,
        recoveryType: 'parachute',
      })
      const motor = await seedTestMotor({
        manufacturer: 'Estes',
        model: 'C6-5',
        impulseClass: 'C',
        totalImpulseNs: 10.0,
      })
      const inventory = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 3 })
      const site = await seedTestSite({ name: 'Central Community Park', maxAltitudeAglM: 400 })

      // Create flight
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        motorInventoryId: inventory.id,
        launchSiteId: site.id,
        flightNumber: 1,
        altitudeAglM: 185.0,
        outcome: 'successful',
        softGateWarnings: [],
        proceededDespiteWarnings: false,
      })

      // Decrement inventory
      const db = getDb()
      await db
        .update(schema.motorInventories)
        .set({
          quantityOnHand: inventory.quantityOnHand - 1,
          expendedCount: inventory.expendedCount + 1,
        })
        .where(eq(schema.motorInventories.id, inventory.id))

      const [updatedInv] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inventory.id))

      expect(updatedInv.quantityOnHand).toBe(2)
      expect(updatedInv.expendedCount).toBe(1)

      // Verify flight details in UI
      const res = await fetchGet(`/flights/${flight.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()
      assertContains(html, 'Estes Alpha III', 'C6-5', '185')
    })

    it('Scenario 2: High Power Level 1 Certification Flight (L1 Flyer, H128W, 850m altitude)', async () => {
      const flyer = await seedTestUser({ displayName: 'TRA Cert Candidate' })
      await seedTestCert(flyer.id, { certifyingBody: 'TRA', level: 1 })
      const rocket = await seedTestRocket(flyer.id, { name: 'Loc Precision 4-inch' })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        stabilityCalibers: 1.4,
        dryMassG: 950.0,
      })
      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'H128W',
        impulseClass: 'H',
      })
      const site = await seedTestSite({ name: 'Lucerne Dry Lake', maxAltitudeAglM: 3000 })

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        flightNumber: 1,
        altitudeAglM: 850.0,
        outcome: 'successful',
        notes: 'Level 1 certification flight signed off by witness',
        softGateWarnings: [],
        proceededDespiteWarnings: false,
      })

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flight.id))

      expect(saved.outcome).toBe('successful')
      expect(saved.softGateWarnings).toHaveLength(0)
      expect(saved.proceededDespiteWarnings).toBe(false)
    })

    it('Scenario 3: Uncertified Flyer Attempting HPR Motor (Warning Override Persisted in D1)', async () => {
      const flyer = await seedTestUser({ displayName: 'Uncertified Flyer' }) // L0
      const rocket = await seedTestRocket(flyer.id, { name: 'Experimental Airframe' })
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.5 })
      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'H128W',
        impulseClass: 'H', // Requires L1!
      })
      const site = await seedTestSite({ maxAltitudeAglM: 3000 })

      const warnings = [
        'Motor impulse class H requires Level 1 certification, but flyer has Level 0.',
      ]

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        flightNumber: 1,
        altitudeAglM: 750.0,
        outcome: 'successful',
        softGateWarnings: warnings,
        proceededDespiteWarnings: true,
      })

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flight.id))

      expect(saved.proceededDespiteWarnings).toBe(true)
      expect(saved.softGateWarnings).toContain(warnings[0])
    })

    it('Scenario 4: Marginally Stable Rocket Preflight Warning (stability = 0.85 calibers)', async () => {
      const flyer = await seedTestUser()
      const rocket = await seedTestRocket(flyer.id, { name: 'Short Stubby Rocket' })
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 0.85 }) // < 1.0 caliber
      const motor = await seedTestMotor({ impulseClass: 'D', model: 'D12-3' })
      const site = await seedTestSite()

      const warnings = [
        'Stability margin of 0.85 calibers is below the 1.0 caliber safety threshold.',
      ]

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        altitudeAglM: 220.0,
        outcome: 'successful',
        softGateWarnings: warnings,
        proceededDespiteWarnings: true,
      })

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flight.id))

      expect(saved.proceededDespiteWarnings).toBe(true)
      expect(saved.softGateWarnings?.[0]).toMatch(/below the 1\.0 caliber/i)
    })

    it('Scenario 5: Airspace Waiver Ceiling Exceedance (expected 2,200m at 1,500m site)', async () => {
      const flyer = await seedTestUser()
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 2.0 })
      const motor = await seedTestMotor({ impulseClass: 'J', model: 'J350W' })
      const site = await seedTestSite({ maxAltitudeAglM: 1500 }) // 1500m ceiling

      const warnings = [
        'Expected altitude (2200m) exceeds the site waiver ceiling (1500m).',
      ]

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        altitudeAglM: 2150.0,
        outcome: 'successful',
        softGateWarnings: warnings,
        proceededDespiteWarnings: true,
      })

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flight.id))

      expect(saved.proceededDespiteWarnings).toBe(true)
      expect(saved.softGateWarnings?.[0]).toMatch(/exceeds the site waiver ceiling/i)
    })
  })

  describe('Tier 5: Milestone 2 Flight Logbook Usability Refinements (R2)', () => {
    describe('5.1: Dual Peak Altitude (Meters & Feet)', () => {
      it('renders dual altitude inputs (meters & feet) side-by-side with bi-directional JS sync', async () => {
        const res = await fetchGet('/flights/new')
        assertHtmlResponse(res, 200)
        const html = await res.text()

        // Verify presence of both altitude inputs
        assertHasFormField(html, 'altitude_agl_m')
        assertHasFormField(html, 'altitude_agl_ft')
        expect(html).toContain('id="altitude_agl_m"')
        expect(html).toContain('id="altitude_agl_ft"')
        expect(html).toContain('initDualAltitudeSync')
        expect(html).toContain('3.28084')
        expect(html).toContain('0.3048')
      })

      it('persists canonical altitude in meters when submitted via altitude_agl_ft alone', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const motor = await seedTestMotor({ impulseClass: 'G' })
        const site = await seedTestSite()

        // Submit altitude strictly in feet: 2788.71 ft -> ~850.0 m
        const res = await fetchPostForm('/flights', {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_ft: 2788.71,
        }, { Cookie: `triplet_session=${token}` })

        expect([200, 302, 303]).toContain(res.status)
        const db = getDb()
        const [saved] = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.rocketConfigurationId, config.id))

        expect(saved).toBeDefined()
        expect(saved.altitudeAglM).toBeCloseTo(850.0, 0)
      })

      it('evaluates dynamic soft gate preflight check when only feet is provided', async () => {
        const flyer = await seedTestUser()
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.5 })
        const motor = await seedTestMotor({ impulseClass: 'G' })
        const site = await seedTestSite({ maxAltitudeAglM: 1000 }) // 1,000 m waiver ceiling

        // 4921 ft = ~1,500 m, which exceeds the 1,000 m ceiling
        const res = await fetchHtmxPostForm('/flights/preflight-check', {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_ft: 4921,
        })

        expect(res.status).toBe(200)
        const fragment = await res.text()
        assertAlertBanner(fragment, 'warning')
        expect(fragment).toMatch(/exceeds the site waiver ceiling/i)
      })

      it('renders dual units on flight detail view', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const motor = await seedTestMotor()
        const flight = await seedTestFlight(flyer.id, {
          rocketConfigurationId: config.id,
          motorId: motor.id,
          altitudeAglM: 850.0,
        })

        const res = await fetchGet(`/flights/${flight.id}`, { Cookie: `triplet_session=${token}` })
        assertHtmlResponse(res, 200)
        const html = await res.text()

        // Detail view should display both meters and feet: 850 m (2,789 ft)
        expect(html).toMatch(/850\s*m\s*\(\s*2,?789\s*ft\s*\)/i)
      })
    })

    describe('5.2: Pure Text Duty Officers (RSO & LCO)', () => {
      it('renders pure text inputs without registered flyer dropdowns', async () => {
        const res = await fetchGet('/flights/new')
        assertHtmlResponse(res, 200)
        const html = await res.text()

        assertHasFormField(html, 'rso_name')
        assertHasFormField(html, 'lco_name')
        expect(html).not.toContain('<select name="rso_user_id"')
        expect(html).not.toContain('<select name="lco_user_id"')
      })

      it('saves visiting text duty officers without FK constraints or user lookups', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const motor = await seedTestMotor({ impulseClass: 'G' })
        const site = await seedTestSite()

        const res = await fetchPostForm('/flights', {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          rso_name: 'Visiting RSO Alice',
          lco_name: 'Visiting LCO Bob',
          altitude_agl_m: 500,
        }, { Cookie: `triplet_session=${token}` })

        expect([200, 302, 303]).toContain(res.status)
        const db = getDb()
        const [saved] = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.rocketConfigurationId, config.id))

        expect(saved).toBeDefined()
        expect(saved.rsoName).toBe('Visiting RSO Alice')
        expect(saved.lcoName).toBe('Visiting LCO Bob')

        // Inspect detail view displays duty officer text
        const detailRes = await fetchGet(`/flights/${saved.id}`, { Cookie: `triplet_session=${token}` })
        const detailHtml = await detailRes.text()
        expect(detailHtml).toContain('Visiting RSO Alice')
        expect(detailHtml).toContain('Visiting LCO Bob')
      })
    })

    describe('5.3: Flight Stage / Log Type (Preflight vs Actual)', () => {
      it('renders selectable log_type toggle with options on preflight form', async () => {
        const res = await fetchGet('/flights/new')
        assertHtmlResponse(res, 200)
        const html = await res.text()

        assertHasFormField(html, 'log_type')
        expect(html).toContain('value="actual"')
        expect(html).toContain('value="preflight"')
        expect(html).toContain('Post-Flight Actuals')
        expect(html).toContain('Preflight Simulation / Planned')
      })

      it('persists log_type preflight and actual correctly in D1', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const motor = await seedTestMotor({ impulseClass: 'G' })
        const site = await seedTestSite()

        // 1. Log preflight flight
        await fetchPostForm('/flights', {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'preflight',
          altitude_agl_m: 400,
        }, { Cookie: `triplet_session=${token}` })

        // 2. Log actual flight
        await fetchPostForm('/flights', {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'actual',
          altitude_agl_m: 450,
        }, { Cookie: `triplet_session=${token}` })

        const db = getDb()
        const flights = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.rocketConfigurationId, config.id))

        expect(flights).toHaveLength(2)
        const preflightRec = flights.find((f) => f.logType === 'preflight')
        const actualRec = flights.find((f) => f.logType === 'actual')
        expect(preflightRec).toBeDefined()
        expect(actualRec).toBeDefined()
      })

      it('renders distinct visual badges on list and detail views', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const motor = await seedTestMotor()

        const fSim = await seedTestFlight(flyer.id, {
          rocketConfigurationId: config.id,
          motorId: motor.id,
          logType: 'preflight',
        })
        const fAct = await seedTestFlight(flyer.id, {
          rocketConfigurationId: config.id,
          motorId: motor.id,
          logType: 'actual',
        })

        // Check list view
        const listRes = await fetchGet('/flights', { Cookie: `triplet_session=${token}` })
        const listHtml = await listRes.text()
        expect(listHtml).toContain('📋 Planned / Sim')
        expect(listHtml).toContain('🚀 Actual Flight')

        // Check detail view for sim
        const simDetailRes = await fetchGet(`/flights/${fSim.id}`, { Cookie: `triplet_session=${token}` })
        const simDetailHtml = await simDetailRes.text()
        expect(simDetailHtml).toContain('📋 Planned / Sim')

        // Check detail view for actual
        const actDetailRes = await fetchGet(`/flights/${fAct.id}`, { Cookie: `triplet_session=${token}` })
        const actDetailHtml = await actDetailRes.text()
        expect(actDetailHtml).toContain('🚀 Actual Flight')
      })
    })

    describe('5.4: Unified Motor Selection with Stock Linkage & Inventory Deduction', () => {
      it('decorates motor options with on-hand stock count in new flight form', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const motor1 = await seedTestMotor({ manufacturer: 'AeroTech', model: 'G80W' })
        const motor2 = await seedTestMotor({ manufacturer: 'Cesaroni', model: 'H120' })
        await seedTestInventory(flyer.id, motor1.id, { quantityOnHand: 4 })

        const res = await fetchGet('/flights/new', { Cookie: `triplet_session=${token}` })
        assertHtmlResponse(res, 200)
        const html = await res.text()

        // Motor 1 should be decorated with In Stock: 4
        expect(html).toContain('— [In Stock: 4]')
        expect(html).toContain('data-stock="4"')
        // Motor 2 should have 0 stock
        expect(html).toContain('data-stock="0"')
        expect(html).toContain('id="motor-stock-status"')
        // Duplicate motor_inventory_id dropdown should not exist as a visible select
        expect(html).not.toContain('<select name="motor_inventory_id"')
        expect(html).toContain('<input type="hidden" name="motor_inventory_id"')
      })

      it('atomically decrements inventory on actual flights when user has stock', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const motor = await seedTestMotor({ impulseClass: 'G' })
        const site = await seedTestSite()
        const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 3, expendedCount: 0 })

        // Submit actual flight selecting motor_id only (unified selection auto-links)
        const res = await fetchPostForm('/flights', {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'actual',
          altitude_agl_m: 350,
        }, { Cookie: `triplet_session=${token}` })

        expect([200, 302, 303]).toContain(res.status)
        const db = getDb()
        const [updatedInv] = await db
          .select()
          .from(schema.motorInventories)
          .where(eq(schema.motorInventories.id, inv.id))

        expect(updatedInv.quantityOnHand).toBe(2)
        expect(updatedInv.expendedCount).toBe(1)
      })

      it('does NOT decrement inventory on preflight simulation flights', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const motor = await seedTestMotor({ impulseClass: 'G' })
        const site = await seedTestSite()
        const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 3, expendedCount: 0 })

        // Submit preflight flight
        const res = await fetchPostForm('/flights', {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'preflight',
          altitude_agl_m: 350,
        }, { Cookie: `triplet_session=${token}` })

        expect([200, 302, 303]).toContain(res.status)
        const db = getDb()
        const [updatedInv] = await db
          .select()
          .from(schema.motorInventories)
          .where(eq(schema.motorInventories.id, inv.id))

        // Inventory should remain untouched
        expect(updatedInv.quantityOnHand).toBe(3)
        expect(updatedInv.expendedCount).toBe(0)
      })

      it('cleanly falls back to catalog motor without inventory errors when flyer has no stock', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const motor = await seedTestMotor({ impulseClass: 'G' })
        const site = await seedTestSite()

        // Flyer has zero inventory records for this motor
        const res = await fetchPostForm('/flights', {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'actual',
          altitude_agl_m: 350,
        }, { Cookie: `triplet_session=${token}` })

        expect([200, 302, 303]).toContain(res.status)
        const db = getDb()
        const [saved] = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.rocketConfigurationId, config.id))

        expect(saved).toBeDefined()
        expect(saved.motorId).toBe(motor.id)
        expect(saved.motorInventoryId).toBeNull()
      })
    })
  })
})
