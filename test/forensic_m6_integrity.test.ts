/**
 * Forensic Integrity Audit Test Suite for Milestone 6
 * TripleT-Rocketry
 *
 * Verifies:
 * 1. Schema & D1 SQLite Column Authenticity (real SQLite columns length_mm, body_diameter_mm).
 * 2. Authentic POST /rockets persistence with arbitrary non-standard values (not hardcoded).
 * 3. Genuine baseline configuration snapshot creation and D1 state.
 * 4. Robust handling of whitespace and empty inputs (parsed to null, not 0).
 * 5. Authentic airframe editing via POST /rockets/:id and /edit with partial update preservation.
 * 6. Authentic configuration snapshot versioning (v1 -> v2) and parent airframe synchronization.
 * 7. In-place configuration editing via POST /rockets/:id/configurations/:configId and /edit.
 * 8. Dynamic, non-hardcoded view rendering across detail cards, snapshot tables, and edit forms.
 * 9. Flight preflight safety review and flight detail view physical clearance rendering.
 * 10. Boundary and extreme float precision handling (micro and heavy-lift scales).
 */

import { and, eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { signSession } from '../src/services/auth'
import {
  getDb,
  seedTestConfig,
  seedTestFlight,
  seedTestMotor,
  seedTestRocket,
  seedTestSite,
  seedTestUser,
  truncateDb,
} from './helpers/db'
import { assertHtmlResponse } from './helpers/html'
import { fetchGet, fetchPostForm } from './helpers/http'

beforeEach(truncateDb)

describe('Forensic Integrity Audit: Milestone 6 (Requirement R6)', () => {
  describe('Check 1: Schema & SQLite Column Authenticity', () => {
    it('verifies lengthMm and bodyDiameterMm are real Drizzle fields mapping to SQLite columns', async () => {
      const db = getDb()
      const flyer = await seedTestUser({ role: 'flyer' })

      // Direct SQL-level verification via Drizzle schema definition
      expect(schema.rockets.lengthMm.name).toBe('length_mm')
      expect(schema.rockets.bodyDiameterMm.name).toBe('body_diameter_mm')
      expect(schema.rocketConfigurations.lengthMm.name).toBe('length_mm')
      expect(schema.rocketConfigurations.bodyDiameterMm.name).toBe('body_diameter_mm')

      // Insert directly to verify SQLite table structure
      const [insertedRocket] = await db
        .insert(schema.rockets)
        .values({
          name: 'Direct DB Test',
          ownerId: flyer.id,
          lengthMm: 1987.65,
          bodyDiameterMm: 82.35,
          createdBy: flyer.id,
        })
        .returning()

      expect(insertedRocket.lengthMm).toBe(1987.65)
      expect(insertedRocket.bodyDiameterMm).toBe(82.35)

      // Query raw database row to ensure SQLite column storage
      const [selected] = await db
        .select({
          len: schema.rockets.lengthMm,
          diam: schema.rockets.bodyDiameterMm,
        })
        .from(schema.rockets)
        .where(eq(schema.rockets.id, insertedRocket.id))

      expect(selected.len).toBe(1987.65)
      expect(selected.diam).toBe(82.35)
    })
  })

  describe('Check 2: Genuine POST /rockets Persistence & Baseline Snapshot Creation', () => {
    it('authentically parses and persists arbitrary dimensions to both rocket and baseline snapshot', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const db = getDb()

      const arbitraryLength = 2749.12
      const arbitraryDiam = 93.45

      const res = await fetchPostForm(
        '/rockets',
        {
          name: 'Forensic Airframe Alpha',
          length_mm: arbitraryLength,
          body_diameter_mm: arbitraryDiam,
          status: 'flight_ready',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') || ''
      const rocketId = location.split('/').pop()
      expect(rocketId).toBeTruthy()

      // Inspect SQLite row in rockets table
      const [rocketRow] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocketId!))

      expect(rocketRow).toBeDefined()
      expect(rocketRow.name).toBe('Forensic Airframe Alpha')
      expect(rocketRow.lengthMm).toBe(arbitraryLength)
      expect(rocketRow.bodyDiameterMm).toBe(arbitraryDiam)

      // Inspect SQLite row in rocketConfigurations table for baseline snapshot v1
      const [baselineConfig] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(
          and(
            eq(schema.rocketConfigurations.rocketId, rocketId!),
            eq(schema.rocketConfigurations.version, 1),
          ),
        )

      expect(baselineConfig).toBeDefined()
      expect(baselineConfig.version).toBe(1)
      expect(baselineConfig.lengthMm).toBe(arbitraryLength)
      expect(baselineConfig.bodyDiameterMm).toBe(arbitraryDiam)
      expect(baselineConfig.isCurrent).toBe(true)
    })

    it('correctly parses empty and whitespace strings to null without database coercion or crash', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const db = getDb()

      const res = await fetchPostForm(
        '/rockets',
        {
          name: 'Null Dimensions Rocket',
          length_mm: '   ',
          body_diameter_mm: '',
          status: 'in_build',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') || ''
      const rocketId = location.split('/').pop()!

      const [rocketRow] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocketId))

      expect(rocketRow.lengthMm).toBeNull()
      expect(rocketRow.bodyDiameterMm).toBeNull()
    })
  })

  describe('Check 3: Airframe Editing & Partial Update Preservation', () => {
    it('authentically updates rocket dimensions via POST /rockets/:id/edit and preserves omitted values', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const db = getDb()

      // Seed initial rocket with known dimensions
      const [rocket] = await db
        .insert(schema.rockets)
        .values({
          name: 'Initial Rocket',
          ownerId: flyer.id,
          status: 'in_build',
          lengthMm: 1200.0,
          bodyDiameterMm: 65.0,
          createdBy: flyer.id,
        })
        .returning()

      // Update only length, leaving bodyDiameterMm omitted
      const res = await fetchPostForm(
        `/rockets/${rocket.id}/edit`,
        {
          name: 'Updated Rocket Name',
          status: 'flight_ready',
          length_mm: 1350.5,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)

      const [updated] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocket.id))

      expect(updated.name).toBe('Updated Rocket Name')
      expect(updated.status).toBe('flight_ready')
      expect(updated.lengthMm).toBe(1350.5)
      // bodyDiameterMm should be preserved as 65.0
      expect(updated.bodyDiameterMm).toBe(65.0)
    })
  })

  describe('Check 4: Configuration Versioning & Parent Airframe Synchronization', () => {
    it('persists configuration v2 and synchronizes active dimensions to parent rocket', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const db = getDb()

      // Create rocket with baseline dimensions
      const [rocket] = await db
        .insert(schema.rockets)
        .values({
          name: 'Multi-Stage Carrier',
          ownerId: flyer.id,
          status: 'flight_ready',
          lengthMm: 1500.0,
          bodyDiameterMm: 76.0,
          createdBy: flyer.id,
        })
        .returning()

      await db.insert(schema.rocketConfigurations).values({
        rocketId: rocket.id,
        version: 1,
        lengthMm: 1500.0,
        bodyDiameterMm: 76.0,
        isCurrent: true,
        createdBy: flyer.id,
      })

      // Add configuration v2 with stretched booster dimensions
      const newLength = 2150.75
      const newDiameter = 98.2

      const res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations`,
        {
          length_mm: newLength,
          body_diameter_mm: newDiameter,
          dry_mass_g: 1100,
          loaded_mass_g: 1950,
          stability_calibers: 2.3,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)

      // Verify v1 is now not current
      const [v1] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(
          and(
            eq(schema.rocketConfigurations.rocketId, rocket.id),
            eq(schema.rocketConfigurations.version, 1),
          ),
        )
      expect(v1.isCurrent).toBe(false)

      // Verify v2 is current with new dimensions
      const [v2] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(
          and(
            eq(schema.rocketConfigurations.rocketId, rocket.id),
            eq(schema.rocketConfigurations.version, 2),
          ),
        )
      expect(v2).toBeDefined()
      expect(v2.isCurrent).toBe(true)
      expect(v2.lengthMm).toBe(newLength)
      expect(v2.bodyDiameterMm).toBe(newDiameter)

      // Verify parent rocket table was synchronized
      const [parentRocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocket.id))
      expect(parentRocket.lengthMm).toBe(newLength)
      expect(parentRocket.bodyDiameterMm).toBe(newDiameter)
    })

    it('updates existing configuration snapshot and synchronizes active rocket via POST /rockets/:id/configurations/:configId', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const db = getDb()

      const [rocket] = await db
        .insert(schema.rockets)
        .values({
          name: 'Tunable Airframe',
          ownerId: flyer.id,
          lengthMm: 1600.0,
          bodyDiameterMm: 76.0,
          createdBy: flyer.id,
        })
        .returning()

      const [config] = await db
        .insert(schema.rocketConfigurations)
        .values({
          rocketId: rocket.id,
          version: 1,
          lengthMm: 1600.0,
          bodyDiameterMm: 76.0,
          isCurrent: true,
          createdBy: flyer.id,
        })
        .returning()

      // Update configuration snapshot in-place
      const updatedLength = 1750.5
      const res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${config.id}`,
        {
          length_mm: updatedLength,
          body_diameter_mm: 80.0,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)

      // Verify config snapshot updated
      const [updatedConfig] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, config.id))
      expect(updatedConfig.lengthMm).toBe(updatedLength)
      expect(updatedConfig.bodyDiameterMm).toBe(80.0)

      // Verify parent rocket updated since config is current
      const [syncedRocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocket.id))
      expect(syncedRocket.lengthMm).toBe(updatedLength)
      expect(syncedRocket.bodyDiameterMm).toBe(80.0)
    })
  })

  describe('Check 5: Dynamic Template Rendering (Anti-Hardcoding & Anti-Facade)', () => {
    it('authentically renders arbitrary database values and conversions in rocket views', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const db = getDb()

      const testLength = 3218.4
      const testDiameter = 104.6

      const [rocket] = await db
        .insert(schema.rockets)
        .values({
          name: 'Dynamic Geometry Probe',
          ownerId: flyer.id,
          lengthMm: testLength,
          bodyDiameterMm: testDiameter,
          createdBy: flyer.id,
        })
        .returning()

      await db.insert(schema.rocketConfigurations).values({
        rocketId: rocket.id,
        version: 1,
        lengthMm: testLength,
        bodyDiameterMm: testDiameter,
        isCurrent: true,
        createdBy: flyer.id,
      })

      // GET /rockets/:id detail view
      const detailRes = await fetchGet(`/rockets/${rocket.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()

      // Must display exact millimeter and calculated centimeter conversions
      expect(detailHtml).toContain('3218.4 mm')
      expect(detailHtml).toContain('321.8 cm')
      expect(detailHtml).toContain('104.6 mm')
      expect(detailHtml).toContain('10.5 cm')

      // GET /rockets/:id/edit pre-populated form
      const editRes = await fetchGet(`/rockets/${rocket.id}/edit`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(editRes, 200)
      const editHtml = await editRes.text()

      expect(editHtml).toContain('value="3218.4"')
      expect(editHtml).toContain('value="104.6"')

      // GET /rockets/:id/configurations/new pre-populated form from active config
      const newConfigRes = await fetchGet(`/rockets/${rocket.id}/configurations/new`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(newConfigRes, 200)
      const newConfigHtml = await newConfigRes.text()

      expect(newConfigHtml).toContain('value="3218.4"')
      expect(newConfigHtml).toContain('value="104.6"')
    })
  })

  describe('Check 6: Flight Logging Preflight Review & Detail View Physical Clearance', () => {
    it('authentically passes geometry data into flight forms and flight detail clearance card', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const db = getDb()

      const flightLength = 2450.0
      const flightDiam = 85.0

      const [rocket] = await db
        .insert(schema.rockets)
        .values({
          name: 'Aero Vanguard',
          ownerId: flyer.id,
          lengthMm: flightLength,
          bodyDiameterMm: flightDiam,
          createdBy: flyer.id,
        })
        .returning()

      const [config] = await db
        .insert(schema.rocketConfigurations)
        .values({
          rocketId: rocket.id,
          version: 1,
          lengthMm: flightLength,
          bodyDiameterMm: flightDiam,
          isCurrent: true,
          createdBy: flyer.id,
        })
        .returning()

      const motor = await seedTestMotor()
      const site = await seedTestSite()

      // Verify GET /flights/new renders option attributes and preflight geometry display
      const newFlightRes = await fetchGet('/flights/new', {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(newFlightRes, 200)
      const newFlightHtml = await newFlightRes.text()

      expect(newFlightHtml).toContain('data-length="2450"')
      expect(newFlightHtml).toContain('data-diameter="85"')
      expect(newFlightHtml).toContain('L: 2450mm, Ø: 85mm')
      expect(newFlightHtml).toMatch(/Airframe Geometry (&|&amp;) Pad Fit/i)

      // Create a flight record
      const flightRes = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          outcome: 'successful',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(flightRes.status)
      const location = flightRes.headers.get('location') || ''
      const flightId = location.split('/').pop()!

      // View flight detail
      const viewFlightRes = await fetchGet(`/flights/${flightId}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(viewFlightRes, 200)
      const viewFlightHtml = await viewFlightRes.text()

      // Physical clearance card (RSO/LCO)
      expect(viewFlightHtml).toContain('Physical Clearance (RSO/LCO):')
      expect(viewFlightHtml).toContain('2450 mm (245.0 cm)')
      expect(viewFlightHtml).toContain('85 mm (8.5 cm)')

      // Vehicle Configuration card
      expect(viewFlightHtml).toContain('Airframe Length')
      expect(viewFlightHtml).toContain('Body Diameter')
    })
  })

  describe('Check 7: Extreme Scale and Decimal Precision Handling', () => {
    it('handles micro-scale (0.55 mm) and macro-scale (48500 mm) values without rounding corruption', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const db = getDb()

      const microLength = 0.55
      const microDiameter = 0.25

      const resMicro = await fetchPostForm(
        '/rockets',
        {
          name: 'Micro Precision Airframe',
          length_mm: microLength,
          body_diameter_mm: microDiameter,
          status: 'flight_ready',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(resMicro.status)
      const microId = (resMicro.headers.get('location') || '').split('/').pop()!

      const [microRow] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, microId))
      expect(microRow.lengthMm).toBe(microLength)
      expect(microRow.bodyDiameterMm).toBe(microDiameter)

      const macroLength = 48500.0
      const macroDiameter = 2400.0

      const resMacro = await fetchPostForm(
        '/rockets',
        {
          name: 'Orbital Heavy Booster',
          length_mm: macroLength,
          body_diameter_mm: macroDiameter,
          status: 'flight_ready',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(resMacro.status)
      const macroId = (resMacro.headers.get('location') || '').split('/').pop()!

      const [macroRow] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, macroId))
      expect(macroRow.lengthMm).toBe(macroLength)
      expect(macroRow.bodyDiameterMm).toBe(macroDiameter)
    })
  })
})
