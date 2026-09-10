/**
 * Adversarial Challenger Test Suite for Milestone 2:
 * Flight Logbook Usability (R2) — Flight Log Type & Unified Motor Stock
 *
 * Stress-tests and empirically verifies:
 * 1. Flight Log Type ('preflight' vs 'actual') persistence, defaults, and boundary inputs.
 * 2. Unified Motor Selection & Atomic Inventory Decrement:
 *    - 'actual' flight with stock decrements quantityOnHand by 1 and increments expendedCount.
 *    - Consecutive 'actual' flights deplete stock down to 0 without going negative.
 *    - Clean fallback to catalog model when user has 0 inventory stock or no inventory record.
 *    - Multi-user inventory isolation under concurrent / interleaved flights.
 *    - Inventory decrement occurs when preflight soft-gate warnings are acknowledged.
 * 3. Preflight Simulation & Inventory Preservation:
 *    - 'preflight' simulation with inventory stock preserves quantityOnHand and expendedCount.
 *    - Multiple consecutive preflight simulations leave inventory untouched.
 *    - Interleaved workflows (preflight -> actual -> preflight).
 *    - Inventory remains preserved even when preflight soft-gate warnings are overridden.
 * 4. Visual Badges on Flight Lists and Detail Views:
 *    - Cyan '📋 Planned / Sim' badge for preflight.
 *    - Indigo '🚀 Actual Flight' badge for actual.
 *    - Null / undefined / legacy logType resilience.
 * 5. Flight Edit Workflow & Log Type Mutation / Preservation:
 *    - Transition preflight -> actual updates D1 and detail view.
 *    - Transition actual -> preflight updates D1 and detail view.
 *    - Editing flight without log_type in payload preserves existing logType.
 *    - Pre-population of edit form selector options.
 * 6. Form UI & Unified Selector Layout Integrity:
 *    - Single #motor_id dropdown with stock decorations and hidden motor_inventory_id.
 *    - Absence of duplicate visible motor_inventory_id select element.
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import { signSession } from '../../src/services/auth'
import { renderFlightLogTypeBadge } from '../../src/views/flights'
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
  assertContains,
  assertHasFormField,
  assertHtmlResponse,
} from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'

beforeEach(truncateDb)

describe('Adversarial Challenger M2: Flight Log Type & Unified Motor Stock', () => {
  // =========================================================================
  // 1. Flight Log Type Persistence & Boundary Defaults
  // =========================================================================
  describe('1. Flight Log Type Persistence & Boundary Inputs', () => {
    it('persists log_type as "actual" when explicitly submitted', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'D', model: 'D12-5' })
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'actual',
          altitude_agl_m: 220,
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const flights = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(flights).toHaveLength(1)
      expect(flights[0].logType).toBe('actual')
    })

    it('persists log_type as "preflight" when explicitly submitted', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'E', model: 'E16-4' })
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'preflight',
          altitude_agl_m: 350,
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const flights = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(flights).toHaveLength(1)
      expect(flights[0].logType).toBe('preflight')
    })

    it('defaults log_type to "actual" when log_type field is omitted from submission', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'C', model: 'C6-5' })
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          // log_type intentionally omitted
          altitude_agl_m: 150,
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
      expect(saved.logType).toBe('actual')
    })

    it('safely falls back to "actual" when log_type contains malformed / unexpected values', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'B', model: 'B6-4' })
      const site = await seedTestSite()

      for (const weirdType of ['BOGUS_TYPE', 'simulated', '123', 'PREFLIGHT', '']) {
        const res = await fetchPostForm(
          '/flights',
          {
            flyer_id: flyer.id,
            rocket_configuration_id: config.id,
            motor_id: motor.id,
            launch_site_id: site.id,
            log_type: weirdType,
            altitude_agl_m: 100,
          },
          { Cookie: `triplet_session=${token}` },
        )
        expect([200, 302, 303]).toContain(res.status)
      }

      const db = getDb()
      const allFlights = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(allFlights).toHaveLength(5)
      for (const f of allFlights) {
        expect(f.logType).toBe('actual')
      }
    })
  })

  // =========================================================================
  // 2. Unified Motor Selection & Atomic Decrement for Actual Flights
  // =========================================================================
  describe('2. Unified Motor Selection & Atomic Decrement for Actual Flights', () => {
    it('decrements quantityOnHand by 1 and increments expendedCount by 1 on actual flight', async () => {
      const flyer = await seedTestUser()
      await seedTestCert(flyer.id, { level: 2 })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ manufacturer: 'AeroTech', model: 'H128W', impulseClass: 'H' })
      const site = await seedTestSite()

      const initialInv = await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 4,
        expendedCount: 1,
      })

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'actual',
          altitude_agl_m: 600,
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [updatedInv] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, initialInv.id))

      expect(updatedInv.quantityOnHand).toBe(3)
      expect(updatedInv.expendedCount).toBe(2)

      const [flight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(flight.motorInventoryId).toBe(initialInv.id)
      expect(flight.motorId).toBe(motor.id)
    })

    it('decrements inventory stock when preflight soft-gate warnings are acknowledged', async () => {
      const flyer = await seedTestUser() // Level 0 flyer (no cert)
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ manufacturer: 'AeroTech', model: 'H128W', impulseClass: 'H' })
      const site = await seedTestSite()

      const inv = await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 3,
        expendedCount: 0,
      })

      // Flyer acknowledges warning
      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'actual',
          altitude_agl_m: 700,
          proceeded_despite_warnings: 'true',
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [updatedInv] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updatedInv.quantityOnHand).toBe(2)
      expect(updatedInv.expendedCount).toBe(1)

      const [flight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(flight.proceededDespiteWarnings).toBe(true)
      expect(flight.motorInventoryId).toBe(inv.id)
    })

    it('handles consecutive actual flights down to 0 inventory without going negative', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ manufacturer: 'Cesaroni', model: 'G75', impulseClass: 'G' })
      const site = await seedTestSite()

      // Flyer has exactly 2 motors in stock
      const inv = await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 2,
        expendedCount: 0,
      })

      const db = getDb()

      // Flight 1: actual launch
      await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'actual',
          altitude_agl_m: 400,
        },
        { Cookie: `triplet_session=${token}` },
      )

      let [invAfter1] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))
      expect(invAfter1.quantityOnHand).toBe(1)
      expect(invAfter1.expendedCount).toBe(1)

      // Flight 2: actual launch (depletes stock to 0)
      await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'actual',
          altitude_agl_m: 410,
        },
        { Cookie: `triplet_session=${token}` },
      )

      let [invAfter2] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))
      expect(invAfter2.quantityOnHand).toBe(0)
      expect(invAfter2.expendedCount).toBe(2)

      // Flight 3: flyer logs an actual flight when stock is 0 (falls back to catalog)
      const res3 = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'actual',
          altitude_agl_m: 420,
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect([200, 302, 303]).toContain(res3.status)

      let [invAfter3] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))
      // Stock must NOT become negative
      expect(invAfter3.quantityOnHand).toBe(0)
      expect(invAfter3.expendedCount).toBe(2)

      // Total of 3 flights logged
      const flights = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))
        .orderBy(schema.flights.createdAt)

      expect(flights).toHaveLength(3)
      // Flight 1 & 2 linked to inventory
      expect(flights[0].motorInventoryId).toBe(inv.id)
      expect(flights[1].motorInventoryId).toBe(inv.id)
      // Flight 3 fell back cleanly to catalog motor without inventory link
      expect(flights[2].motorInventoryId).toBeNull()
      expect(flights[2].motorId).toBe(motor.id)
    })

    it('cleanly falls back to catalog model when user has an inventory row with 0 stock', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'F', model: 'F32' })
      const site = await seedTestSite()

      // Inventory row exists but quantity is already 0
      const inv = await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 0,
        expendedCount: 5,
      })

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'actual',
          altitude_agl_m: 300,
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [updatedInv] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updatedInv.quantityOnHand).toBe(0)
      expect(updatedInv.expendedCount).toBe(5)

      const [flight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(flight.motorId).toBe(motor.id)
      expect(flight.motorInventoryId).toBeNull()
    })

    it('cleanly falls back to catalog model when user has NO inventory record at all', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'D', model: 'D12-3' })
      const site = await seedTestSite()

      // No inventory seeded for this motor or user
      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'actual',
          altitude_agl_m: 180,
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [flight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(flight).toBeDefined()
      expect(flight.motorId).toBe(motor.id)
      expect(flight.motorInventoryId).toBeNull()
    })

    it('isolates inventory between multiple flyers logging the same catalog motor', async () => {
      const userA = await seedTestUser({ email: 'userA@test.com', displayName: 'Flyer A' })
      const userB = await seedTestUser({ email: 'userB@test.com', displayName: 'Flyer B' })
      const tokenB = await signSession(userB.id)

      const motor = await seedTestMotor({ manufacturer: 'AeroTech', model: 'G64W', impulseClass: 'G' })
      const site = await seedTestSite()

      // User A has 5 units in stock; User B has 0 units
      const invA = await seedTestInventory(userA.id, motor.id, { quantityOnHand: 5, expendedCount: 0 })

      const rocketB = await seedTestRocket(userB.id)
      const configB = await seedTestConfig(rocketB.id)

      // User B logs an actual flight with the motor
      const resB = await fetchPostForm(
        '/flights',
        {
          flyer_id: userB.id,
          rocket_configuration_id: configB.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'actual',
          altitude_agl_m: 450,
        },
        { Cookie: `triplet_session=${tokenB}` },
      )
      expect([200, 302, 303]).toContain(resB.status)

      const db = getDb()
      // User A's stock must remain 5!
      const [checkedInvA] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, invA.id))

      expect(checkedInvA.quantityOnHand).toBe(5)
      expect(checkedInvA.expendedCount).toBe(0)

      // User B's flight must have fallen back cleanly to catalog motor
      const [flightB] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, configB.id))

      expect(flightB.flyerId).toBe(userB.id)
      expect(flightB.motorId).toBe(motor.id)
      expect(flightB.motorInventoryId).toBeNull()
    })
  })

  // =========================================================================
  // 3. Preflight Simulation & Inventory Preservation
  // =========================================================================
  describe('3. Preflight Simulation & Inventory Preservation', () => {
    it('does NOT decrement inventory stock or increment expendedCount for preflight simulation', async () => {
      const flyer = await seedTestUser()
      await seedTestCert(flyer.id, { level: 2 })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'H', model: 'H165R' })
      const site = await seedTestSite()

      const inv = await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 7,
        expendedCount: 2,
      })

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'preflight',
          altitude_agl_m: 900,
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [invAfter] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(invAfter.quantityOnHand).toBe(7)
      expect(invAfter.expendedCount).toBe(2)

      const [flight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(flight.logType).toBe('preflight')
      expect(flight.motorId).toBe(motor.id)
    })

    it('preserves inventory across multiple repeated preflight simulations', async () => {
      const flyer = await seedTestUser()
      await seedTestCert(flyer.id, { level: 2 })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'I', model: 'I200W' })
      const site = await seedTestSite()

      const inv = await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 3,
        expendedCount: 0,
      })

      // Run 4 preflight simulations
      for (let i = 1; i <= 4; i++) {
        const res = await fetchPostForm(
          '/flights',
          {
            flyer_id: flyer.id,
            rocket_configuration_id: config.id,
            motor_id: motor.id,
            launch_site_id: site.id,
            log_type: 'preflight',
            altitude_agl_m: 800 + i * 50,
          },
          { Cookie: `triplet_session=${token}` },
        )
        expect([200, 302, 303]).toContain(res.status)
      }

      const db = getDb()
      const [invAfter] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      // Inventory remains strictly untouched
      expect(invAfter.quantityOnHand).toBe(3)
      expect(invAfter.expendedCount).toBe(0)

      const simFlights = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(simFlights).toHaveLength(4)
      for (const sf of simFlights) {
        expect(sf.logType).toBe('preflight')
      }
    })

    it('preserves inventory even when preflight simulation acknowledges soft-gate warnings', async () => {
      const flyer = await seedTestUser() // Level 0 flyer (no cert)
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'H', model: 'H128W' })
      const site = await seedTestSite()

      const inv = await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 5,
        expendedCount: 0,
      })

      // Flyer acknowledges warning for a preflight simulation
      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'preflight',
          altitude_agl_m: 800,
          proceeded_despite_warnings: 'true',
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [invAfter] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      // Crucial: Preflight must NOT decrement even with warnings acknowledged!
      expect(invAfter.quantityOnHand).toBe(5)
      expect(invAfter.expendedCount).toBe(0)

      const [flight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(flight.logType).toBe('preflight')
      expect(flight.proceededDespiteWarnings).toBe(true)
    })

    it('handles interleaved preflight simulations and actual launches correctly', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G', model: 'G80-7' })
      const site = await seedTestSite()

      const inv = await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 2,
        expendedCount: 0,
      })

      const db = getDb()

      // Step 1: Preflight sim (stock 2 -> 2)
      await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'preflight',
          altitude_agl_m: 500,
        },
        { Cookie: `triplet_session=${token}` },
      )
      let [inv1] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, inv.id))
      expect(inv1.quantityOnHand).toBe(2)
      expect(inv1.expendedCount).toBe(0)

      // Step 2: Actual launch 1 (stock 2 -> 1)
      await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'actual',
          altitude_agl_m: 495,
        },
        { Cookie: `triplet_session=${token}` },
      )
      let [inv2] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, inv.id))
      expect(inv2.quantityOnHand).toBe(1)
      expect(inv2.expendedCount).toBe(1)

      // Step 3: Preflight sim 2 (stock 1 -> 1)
      await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'preflight',
          altitude_agl_m: 520,
        },
        { Cookie: `triplet_session=${token}` },
      )
      let [inv3] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, inv.id))
      expect(inv3.quantityOnHand).toBe(1)
      expect(inv3.expendedCount).toBe(1)

      // Step 4: Actual launch 2 (stock 1 -> 0)
      await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'actual',
          altitude_agl_m: 510,
        },
        { Cookie: `triplet_session=${token}` },
      )
      let [inv4] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, inv.id))
      expect(inv4.quantityOnHand).toBe(0)
      expect(inv4.expendedCount).toBe(2)

      // Step 5: Preflight sim 3 with 0 stock (succeeds without error, stock stays 0)
      const res5 = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          log_type: 'preflight',
          altitude_agl_m: 530,
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect([200, 302, 303]).toContain(res5.status)
      let [inv5] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, inv.id))
      expect(inv5.quantityOnHand).toBe(0)
      expect(inv5.expendedCount).toBe(2)

      const allLogged = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))
      expect(allLogged).toHaveLength(5)
    })
  })

  // =========================================================================
  // 4. Visual Badges on Flight Lists & Detail Views
  // =========================================================================
  describe('4. Visual Badges on Flight Lists & Detail Views', () => {
    it('renders cyan Planned/Sim badge for preflight logs and indigo Actual badge for actual logs in list view', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()

      await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        logType: 'preflight',
      })
      await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        logType: 'actual',
      })

      const res = await fetchGet('/flights', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Cyan Planned / Sim badge
      expect(html).toContain('📋 Planned / Sim')
      expect(html).toContain('bg-cyan-500/20')
      expect(html).toContain('text-cyan-300')

      // Indigo Actual Flight badge
      expect(html).toContain('🚀 Actual Flight')
      expect(html).toContain('bg-indigo-500/20')
      expect(html).toContain('text-indigo-300')
    })

    it('renders correct badges on flight detail view for both preflight and actual flights', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()

      const simFlight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        logType: 'preflight',
      })
      const actFlight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        logType: 'actual',
      })

      // 1. Sim Detail View
      const simRes = await fetchGet(`/flights/${simFlight.id}`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(simRes, 200)
      const simHtml = await simRes.text()
      expect(simHtml).toContain('📋 Planned / Sim')
      expect(simHtml).toContain('Flight Stage')
      // Both header badge and metrics card badge
      const simMatches = (simHtml.match(/📋 Planned \/ Sim/g) || []).length
      expect(simMatches).toBeGreaterThanOrEqual(2)

      // 2. Actual Detail View
      const actRes = await fetchGet(`/flights/${actFlight.id}`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(actRes, 200)
      const actHtml = await actRes.text()
      expect(actHtml).toContain('🚀 Actual Flight')
      expect(actHtml).toContain('Flight Stage')
      const actMatches = (actHtml.match(/🚀 Actual Flight/g) || []).length
      expect(actMatches).toBeGreaterThanOrEqual(2)
    })

    it('safely renders "🚀 Actual Flight" when logType is null, undefined, or empty (legacy DB state)', async () => {
      // Direct helper unit assertions
      const nullBadge = (await renderFlightLogTypeBadge(null)).toString()
      expect(nullBadge).toContain('🚀 Actual Flight')

      const undefBadge = (await renderFlightLogTypeBadge(undefined)).toString()
      expect(undefBadge).toContain('🚀 Actual Flight')

      const emptyBadge = (await renderFlightLogTypeBadge('')).toString()
      expect(emptyBadge).toContain('🚀 Actual Flight')

      // Preflight helper check
      const simBadge = (await renderFlightLogTypeBadge('preflight')).toString()
      expect(simBadge).toContain('📋 Planned / Sim')
    })
  })

  // =========================================================================
  // 5. Editing Existing Flights & LogType Transition Integrity
  // =========================================================================
  describe('5. Editing Existing Flights & LogType Transition Integrity', () => {
    it('successfully transitions an existing flight from preflight to actual via POST /flights/:id/edit', async () => {
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
        logType: 'preflight',
        notes: 'Initial simulation plan',
      })

      // Submit edit changing log_type to 'actual'
      const editRes = await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          log_type: 'actual',
          notes: 'Flown successfully at launch meet',
          altitude_agl_m: 550,
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect([200, 302, 303]).toContain(editRes.status)

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flight.id))

      expect(updated.logType).toBe('actual')
      expect(updated.notes).toBe('Flown successfully at launch meet')

      // Verify detail view now renders Actual badge
      const detailRes = await fetchGet(`/flights/${flight.id}`, { Cookie: `triplet_session=${token}` })
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain('🚀 Actual Flight')
    })

    it('successfully transitions an existing flight from actual to preflight via POST /flights/:id/edit', async () => {
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
        logType: 'actual',
        notes: 'Mistakenly logged as actual',
      })

      // Submit edit changing log_type to 'preflight'
      const editRes = await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          log_type: 'preflight',
          notes: 'Corrected to planned simulation',
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect([200, 302, 303]).toContain(editRes.status)

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flight.id))

      expect(updated.logType).toBe('preflight')
      expect(updated.notes).toBe('Corrected to planned simulation')

      // Verify detail view now renders Preflight badge
      const detailRes = await fetchGet(`/flights/${flight.id}`, { Cookie: `triplet_session=${token}` })
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain('📋 Planned / Sim')
    })

    it('preserves existing logType when edit request omits log_type parameter', async () => {
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
        logType: 'preflight',
        notes: 'Simulation flight',
      })

      // Submit edit without log_type
      const editRes = await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          notes: 'Only updating notes, log_type not in payload',
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect([200, 302, 303]).toContain(editRes.status)

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flight.id))

      expect(updated.notes).toBe('Only updating notes, log_type not in payload')
      // Existing logType must be preserved
      expect(updated.logType).toBe('preflight')
    })

    it('pre-populates selected option in edit form (GET /flights/:id/edit)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()

      // 1. Sim flight edit form
      const simFlight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        logType: 'preflight',
      })
      const simRes = await fetchGet(`/flights/${simFlight.id}/edit`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(simRes, 200)
      const simHtml = await simRes.text()
      expect(simHtml).toMatch(/<option value="preflight"[^>]*selected/)

      // 2. Actual flight edit form
      const actFlight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        logType: 'actual',
      })
      const actRes = await fetchGet(`/flights/${actFlight.id}/edit`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(actRes, 200)
      const actHtml = await actRes.text()
      expect(actHtml).toMatch(/<option value="actual"[^>]*selected/)
    })
  })

  // =========================================================================
  // 6. Unified Motor Selection UI & Form Element Integrity
  // =========================================================================
  describe('6. Unified Motor Selection UI & Form Element Integrity', () => {
    it('renders single motor_id dropdown with stock badges, hidden motor_inventory_id, and no duplicate select', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motorStock = await seedTestMotor({ manufacturer: 'AeroTech', model: 'H128W' })
      const motorEmpty = await seedTestMotor({ manufacturer: 'Cesaroni', model: 'I200' })
      await seedTestInventory(flyer.id, motorStock.id, { quantityOnHand: 6 })

      const res = await fetchGet('/flights/new', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Unified motor selector dropdown
      expect(html).toContain('name="motor_id"')
      expect(html).toContain('id="motor_id"')

      // Motor with stock includes badge and data attributes
      expect(html).toContain('— [In Stock: 6]')
      expect(html).toContain('data-stock="6"')

      // Motor without stock has data-stock="0" and no stock badge
      expect(html).toContain('data-stock="0"')

      // Live stock status card placeholder exists
      expect(html).toContain('id="motor-stock-status"')

      // Hidden motor_inventory_id input exists
      expect(html).toContain('<input type="hidden" name="motor_inventory_id"')

      // Duplicate visible <select name="motor_inventory_id"> must NOT exist
      expect(html).not.toContain('<select name="motor_inventory_id"')

      // Log Type select dropdown exists with both options
      assertHasFormField(html, 'log_type')
      expect(html).toContain('value="actual"')
      expect(html).toContain('value="preflight"')
    })
  })
})
