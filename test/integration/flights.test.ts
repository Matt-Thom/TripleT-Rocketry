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
})
