/**
 * Adversarial Integration Test Suite for Preflight Soft-Gate Safety Rules
 * and D1 Persistence in TripleT-Rocketry.
 *
 * Verifies:
 * 1. Motor impulse classes (A-O) vs flyer certification levels (0-3) and transitions
 * 2. Aerodynamic stability calibers boundary conditions (0.99, 1.00, 1.01, negative, null)
 * 3. Airspace waiver altitude ceiling boundaries (ceiling, ceiling + 1, null)
 * 4. Full D1 round-trip persistence of soft_gate_warnings JSON and proceeded_despite_warnings boolean
 * 5. Rejection (HTTP 422) when warnings are present but unacknowledged
 * 6. Server-side override tamper resilience (client sends empty warnings, server calculates violations)
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import {
  getDb,
  seedTestCert,
  seedTestConfig,
  seedTestMotor,
  seedTestRocket,
  seedTestSite,
  seedTestUser,
  truncateDb,
} from '../helpers/db'
import {
  assertAlertBanner,
  assertContains,
} from '../helpers/html'
import {
  fetchHtmxPostForm,
  fetchPostForm,
} from '../helpers/http'

beforeEach(truncateDb)

describe('Adversarial Soft-Gates & D1 Persistence Integration', () => {
  describe('Adversarial HTMX Dynamic Soft-Gate Endpoint (POST /flights/preflight-check)', () => {
    it('boundary transition: Class G motor is clean for L0 flyer, Class H warns for L0 flyer', async () => {
      const flyer = await seedTestUser({ displayName: 'Level 0 Pilot' })
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.5 })
      const motorG = await seedTestMotor({ impulseClass: 'G', model: 'G80' })
      const motorH = await seedTestMotor({ impulseClass: 'H', model: 'H128W' })
      const site = await seedTestSite({ maxAltitudeAglM: 3000 })

      // Test Class G (clean)
      const resG = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motorG.id,
        launch_site_id: site.id,
        expected_altitude_m: 500,
      })
      expect(resG.status).toBe(200)
      const htmlG = await resG.text()
      expect(htmlG).not.toMatch(/requires Level 1/i)
      expect(htmlG).toMatch(/(ready|clear|safe|all checks pass)/i)

      // Test Class H (warns)
      const resH = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motorH.id,
        launch_site_id: site.id,
        expected_altitude_m: 500,
      })
      expect(resH.status).toBe(200)
      const htmlH = await resH.text()
      assertAlertBanner(htmlH, 'warning')
      expect(htmlH).toMatch(/requires Level 1/i)
      expect(htmlH).toMatch(/proceeded_despite_warnings/i)
    })

    it('boundary transition: Class I is clean for L1 flyer, Class J warns for L1 flyer', async () => {
      const flyer = await seedTestUser()
      await seedTestCert(flyer.id, { level: 1 })
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.5 })
      const motorI = await seedTestMotor({ impulseClass: 'I', model: 'I200' })
      const motorJ = await seedTestMotor({ impulseClass: 'J', model: 'J350' })
      const site = await seedTestSite({ maxAltitudeAglM: 3000 })

      // Class I at L1 (clean)
      const resI = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motorI.id,
        launch_site_id: site.id,
        expected_altitude_m: 800,
      })
      expect(resI.status).toBe(200)
      const htmlI = await resI.text()
      expect(htmlI).not.toMatch(/requires Level 2/i)

      // Class J at L1 (warns)
      const resJ = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motorJ.id,
        launch_site_id: site.id,
        expected_altitude_m: 800,
      })
      expect(resJ.status).toBe(200)
      const htmlJ = await resJ.text()
      assertAlertBanner(htmlJ, 'warning')
      expect(htmlJ).toMatch(/requires Level 2/i)
    })

    it('boundary transition: Class L is clean for L2 flyer, Class M warns for L2 flyer', async () => {
      const flyer = await seedTestUser()
      await seedTestCert(flyer.id, { level: 2 })
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.5 })
      const motorL = await seedTestMotor({ impulseClass: 'L', model: 'L1000' })
      const motorM = await seedTestMotor({ impulseClass: 'M', model: 'M2000' })
      const site = await seedTestSite({ maxAltitudeAglM: 5000 })

      // Class L at L2 (clean)
      const resL = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motorL.id,
        launch_site_id: site.id,
        expected_altitude_m: 1200,
      })
      expect(resL.status).toBe(200)
      const htmlL = await resL.text()
      expect(htmlL).not.toMatch(/requires Level 3/i)

      // Class M at L2 (warns)
      const resM = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motorM.id,
        launch_site_id: site.id,
        expected_altitude_m: 1200,
      })
      expect(resM.status).toBe(200)
      const htmlM = await resM.text()
      assertAlertBanner(htmlM, 'warning')
      expect(htmlM).toMatch(/requires Level 3/i)
    })

    it('stability caliber boundary: 0.99 warns, 1.00 is clean, 1.01 is clean, -0.5 warns, null is clean', async () => {
      const flyer = await seedTestUser()
      await seedTestCert(flyer.id, { level: 3 })
      const rocket = await seedTestRocket(flyer.id)
      const motor = await seedTestMotor({ impulseClass: 'D', model: 'D12-5' })
      const site = await seedTestSite({ maxAltitudeAglM: 2000 })

      // 0.99 calibers -> warns
      const config099 = await seedTestConfig(rocket.id, { version: 1, stabilityCalibers: 0.99 })
      const res099 = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config099.id,
        motor_id: motor.id,
        launch_site_id: site.id,
      })
      expect(res099.status).toBe(200)
      const html099 = await res099.text()
      assertAlertBanner(html099, 'warning')
      expect(html099).toMatch(/0\.99.*1\.0 caliber/i)

      // 1.00 caliber -> clean
      const config100 = await seedTestConfig(rocket.id, { version: 2, stabilityCalibers: 1.00 })
      const res100 = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config100.id,
        motor_id: motor.id,
        launch_site_id: site.id,
      })
      expect(res100.status).toBe(200)
      const html100 = await res100.text()
      expect(html100).not.toMatch(/below the 1\.0 caliber/i)

      // 1.01 calibers -> clean
      const config101 = await seedTestConfig(rocket.id, { version: 3, stabilityCalibers: 1.01 })
      const res101 = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config101.id,
        motor_id: motor.id,
        launch_site_id: site.id,
      })
      expect(res101.status).toBe(200)
      const html101 = await res101.text()
      expect(html101).not.toMatch(/below the 1\.0 caliber/i)

      // -0.5 calibers (negative stability) -> warns
      const configNeg = await seedTestConfig(rocket.id, { version: 4, stabilityCalibers: -0.5 })
      const resNeg = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: configNeg.id,
        motor_id: motor.id,
        launch_site_id: site.id,
      })
      expect(resNeg.status).toBe(200)
      const htmlNeg = await resNeg.text()
      assertAlertBanner(htmlNeg, 'warning')
      expect(htmlNeg).toMatch(/below the 1\.0 caliber/i)

      // null stability calibers -> clean
      const configNull = await seedTestConfig(rocket.id, { version: 5, stabilityCalibers: null })
      const resNull = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: configNull.id,
        motor_id: motor.id,
        launch_site_id: site.id,
      })
      expect(resNull.status).toBe(200)
      const htmlNull = await resNull.text()
      expect(htmlNull).not.toMatch(/below the 1\.0 caliber/i)
    })

    it('altitude ceiling boundary: ceiling is clean, ceiling + 1 warns, null ceiling is clean', async () => {
      const flyer = await seedTestUser()
      await seedTestCert(flyer.id, { level: 2 })
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.5 })
      const motor = await seedTestMotor({ impulseClass: 'I', model: 'I200' })
      const site1000 = await seedTestSite({ maxAltitudeAglM: 1000 })
      const siteNull = await seedTestSite({ maxAltitudeAglM: null })

      // expectedAltitude == ceiling (1000m == 1000m) -> clean
      const resEqual = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site1000.id,
        expected_altitude_m: 1000,
      })
      expect(resEqual.status).toBe(200)
      const htmlEqual = await resEqual.text()
      expect(htmlEqual).not.toMatch(/exceeds the site waiver ceiling/i)

      // expectedAltitude == ceiling + 1 (1001m > 1000m) -> warns
      const resOver = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site1000.id,
        expected_altitude_m: 1001,
      })
      expect(resOver.status).toBe(200)
      const htmlOver = await resOver.text()
      assertAlertBanner(htmlOver, 'warning')
      expect(htmlOver).toMatch(/exceeds the site waiver ceiling/i)

      // null ceiling -> clean
      const resNullCeiling = await fetchHtmxPostForm('/flights/preflight-check', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: siteNull.id,
        expected_altitude_m: 3500,
      })
      expect(resNullCeiling.status).toBe(200)
      const htmlNullCeiling = await resNullCeiling.text()
      expect(htmlNullCeiling).not.toMatch(/exceeds the site waiver ceiling/i)
    })
  })

  describe('Adversarial Warning Persistence & Override Logic (POST /flights)', () => {
    it('blocks flight creation with HTTP 422 when warnings exist and flyer did NOT check override', async () => {
      const flyer = await seedTestUser() // L0
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 0.85 }) // warns
      const motor = await seedTestMotor({ impulseClass: 'H', model: 'H128W' }) // warns
      const site = await seedTestSite({ maxAltitudeAglM: 500 })

      const res = await fetchPostForm('/flights', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        altitude_agl_m: 800, // warns: exceeds 500m
        // Note: proceeded_despite_warnings omitted!
      })

      expect(res.status).toBe(422)
      const html = await res.text()
      expect(html).toMatch(/Preflight safety warnings require explicit pilot confirmation/i)

      // Ensure NO flight was persisted in D1
      const db = getDb()
      const savedFlights = await db.select().from(schema.flights)
      expect(savedFlights).toHaveLength(0)
    })

    it('tamper resilience: server recalculates warnings even if client omitted soft_gate_warnings in form', async () => {
      const flyer = await seedTestUser() // L0
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 0.70 }) // warns
      const motor = await seedTestMotor({ impulseClass: 'J', model: 'J350' }) // warns (L2)
      const site = await seedTestSite({ maxAltitudeAglM: 1000 })

      // Malicious or broken client sends empty warnings array, unacknowledged
      const res = await fetchPostForm('/flights', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        soft_gate_warnings: JSON.stringify([]), // Forged clean
      })

      // Server must detect the actual violations and reject with 422
      expect(res.status).toBe(422)
      const html = await res.text()
      expect(html).toMatch(/requires Level 2/i)
      expect(html).toMatch(/below the 1\.0 caliber/i)
    })

    it('persists warnings JSON and proceeded_despite_warnings = true when flyer explicitly acknowledges', async () => {
      const flyer = await seedTestUser() // L0
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 0.85 })
      const motor = await seedTestMotor({ impulseClass: 'H', model: 'H128W' })
      const site = await seedTestSite({ maxAltitudeAglM: 2000 })

      const res = await fetchPostForm('/flights', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        flight_number: 101,
        altitude_agl_m: 650.0,
        outcome: 'successful',
        proceeded_despite_warnings: 'on', // Checkbox checked
      })

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.flightNumber, 101))

      expect(saved).toBeDefined()
      expect(saved.proceededDespiteWarnings).toBe(true)
      expect(Array.isArray(saved.softGateWarnings)).toBe(true)
      expect(saved.softGateWarnings!.length).toBeGreaterThanOrEqual(2)
      expect(saved.softGateWarnings!.some((w: string) => /requires Level 1/i.test(w))).toBe(true)
      expect(saved.softGateWarnings!.some((w: string) => /below the 1\.0 caliber/i.test(w))).toBe(true)
    })

    it('persists empty warnings array and proceeded_despite_warnings = false when configuration is completely safe', async () => {
      const flyer = await seedTestUser()
      await seedTestCert(flyer.id, { level: 2 })
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.6 })
      const motor = await seedTestMotor({ impulseClass: 'J', model: 'J350' })
      const site = await seedTestSite({ maxAltitudeAglM: 3000 })

      const res = await fetchPostForm('/flights', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        flight_number: 102,
        altitude_agl_m: 1200.0,
        outcome: 'successful',
        // Even if proceeded_despite_warnings was accidentally submitted as on:
        proceeded_despite_warnings: 'on',
      })

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.flightNumber, 102))

      expect(saved).toBeDefined()
      expect(saved.softGateWarnings).toEqual([])
      // Because mergedWarnings is empty, proceededDespiteWarnings must be false!
      expect(saved.proceededDespiteWarnings).toBe(false)
    })
  })
})
