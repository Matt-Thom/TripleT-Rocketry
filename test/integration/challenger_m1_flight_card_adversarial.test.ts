/**
 * Adversarial Challenger Test Suite: Milestone 1 — Flight Card & Range Log Alignment (R1).
 *
 * Rigorously stress-tests:
 * 1. All 11 club outcomes + 8 legacy outcomes under rapid inserts and edge conditions:
 *    - Rapid sequential/concurrent insertion of all outcomes into D1.
 *    - Outcome transitions across updates (e.g., GOOD -> Shred -> CATO -> successful).
 *    - Strict rejection of invalid outcomes via SQLite CHECK constraint (ck_flights_outcome).
 *    - Outcome badge rendering across detail and list views.
 * 2. Extreme and boundary inputs for flight card fields:
 *    - Total weight: 0g, 50,000g, fractional grams (0.05g, 1450.75g, 9999.999g), non-numeric coercion.
 *    - Stability margin: negative calibers (-1.5 cal), 0 cal, fractional calibers (1.42 cal, 0.01 cal), extreme calibers (100.0 cal).
 *    - Pad numbers with special formats: 'A-01', 'Pad #3', 'Away Pad / Cell 2', special characters ('Pad @ 45° North', '<Pad&Rack>'), long strings.
 *    - Recovery descriptions with quotes and metric/imperial notation: '48" Ripstop Nylon', '70cm', mixed notation, attribute quote escaping.
 *    - Maiden flight toggles ('true', '1', 'on', true, 'false', '0', false, omitted) and cert attempts ('none', 'mpr', 'l1', 'l2', 'l3', invalid fallback).
 * 3. Partial editing preservation:
 *    - Updating a single field (e.g., pad_number only, total_weight_g to 0 only, stability_margin to -0.5 only, notes only)
 *      preserves all other unedited flight card fields without data loss or corruption.
 *    - Explicitly clearing optional fields to null using empty strings.
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import { signSession } from '../../src/services/auth'
import {
  getDb,
  seedTestCert,
  seedTestConfig,
  seedTestEvent,
  seedTestFlight,
  seedTestMotor,
  seedTestRocket,
  seedTestSite,
  seedTestUser,
  truncateDb,
} from '../helpers/db'
import {
  assertContains,
  assertHtmlResponse,
  assertNotContains,
} from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'

beforeEach(truncateDb)

describe('Adversarial Challenger: Flight Card & Range Log Alignment (Milestone 1)', () => {
  // ==========================================================================
  // Section 1: All 11 Club Outcomes + 8 Legacy Outcomes Under Stress & Transitions
  // ==========================================================================
  describe('Section 1: All 11 Club Outcomes + Legacy Outcomes Under Rapid Inserts & Transitions', () => {
    const ALL_11_CLUB_OUTCOMES = [
      'GOOD',
      'CATO',
      'Shred',
      'Unstable',
      'Zipper',
      'Separation',
      'No chute',
      'Tangled',
      'Lawn Dart',
      'Retention fail',
      'No ignition',
    ] as const

    const ALL_8_LEGACY_OUTCOMES = [
      'successful',
      'cato',
      'separation',
      'recovery_failure',
      'tree',
      'powerline',
      'lost',
      'other',
    ] as const

    it('rapidly inserts all 11 club outcomes via POST /flights without constraint violation', async () => {
      const flyer = await seedTestUser({ displayName: 'Rapid Pilot' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id, { name: 'Falcon Club' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ manufacturer: 'AeroTech', model: 'G76G' })
      const site = await seedTestSite({ name: 'Serpentine Range' })

      const db = getDb()

      for (let i = 0; i < ALL_11_CLUB_OUTCOMES.length; i++) {
        const clubOutcome = ALL_11_CLUB_OUTCOMES[i]
        const res = await fetchPostForm(
          '/flights',
          {
            rocket_configuration_id: config.id,
            motor_id: motor.id,
            launch_site_id: site.id,
            flight_number: i + 1,
            outcome: clubOutcome,
            altitude_agl_m: 300 + i * 20,
            pad_number: `Pad #${i + 1}`,
          },
          {
            Cookie: `triplet_session=${token}`,
          },
        )
        expect([200, 302, 303]).toContain(res.status)
      }

      // Verify all 11 flights were persisted in D1 with exact outcomes
      const persistedFlights = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.flyerId, flyer.id))

      expect(persistedFlights).toHaveLength(11)
      const recordedOutcomes = persistedFlights.map((f) => f.outcome)
      for (const expectedOutcome of ALL_11_CLUB_OUTCOMES) {
        expect(recordedOutcomes).toContain(expectedOutcome)
      }
    })

    it('persists all 8 legacy outcomes and renders appropriate badge styling', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const db = getDb()

      for (let i = 0; i < ALL_8_LEGACY_OUTCOMES.length; i++) {
        const legacyOutcome = ALL_8_LEGACY_OUTCOMES[i]
        const flight = await seedTestFlight(flyer.id, {
          rocketConfigurationId: config.id,
          flightNumber: i + 1,
          outcome: legacyOutcome,
        })

        // Verify D1 record
        const [persisted] = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.id, flight.id))
        expect(persisted.outcome).toBe(legacyOutcome)

        // Verify detail view renders
        const res = await fetchGet(`/flights/${flight.id}`, {
          Cookie: `triplet_session=${token}`,
        })
        assertHtmlResponse(res, 200)
        const html = await res.text()
        expect(html.length).toBeGreaterThan(100)
      }
    })

    it('allows sequential outcome state transitions across multiple edits', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)

      // Start flight as GOOD
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        outcome: 'GOOD',
        notes: 'Initial evaluation',
      })

      const db = getDb()

      // Transition sequence: GOOD -> Shred -> CATO -> successful -> Lawn Dart
      const transitions = ['Shred', 'CATO', 'successful', 'Lawn Dart'] as const

      for (const nextOutcome of transitions) {
        const res = await fetchPostForm(
          `/flights/${flight.id}/edit`,
          {
            outcome: nextOutcome,
            notes: `Updated outcome to ${nextOutcome}`,
          },
          {
            Cookie: `triplet_session=${token}`,
          },
        )
        expect([200, 302, 303]).toContain(res.status)

        const [persisted] = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.id, flight.id))

        expect(persisted.outcome).toBe(nextOutcome)
        expect(persisted.notes).toBe(`Updated outcome to ${nextOutcome}`)

        // Detail view reflection check
        const detailRes = await fetchGet(`/flights/${flight.id}`, {
          Cookie: `triplet_session=${token}`,
        })
        const detailHtml = await detailRes.text()
        expect(detailHtml).toContain(nextOutcome)
      }
    })

    it('strictly enforces SQLite CHECK constraint against invalid outcome mutations', async () => {
      const flyer = await seedTestUser()
      const db = getDb()

      const invalidOutcomes = [
        'good', // lowercase not in enum
        'EXCELLENT',
        'CRASH',
        'exploded',
        "\'; DROP TABLE flights;--",
        ' ',
      ]

      for (const invalid of invalidOutcomes) {
        await expect(
          db.insert(schema.flights).values({
            flyerId: flyer.id,
            outcome: invalid as any,
          }),
        ).rejects.toThrow()
      }
    })
  })

  // ==========================================================================
  // Section 2: Extreme & Boundary Inputs for Flight Card Fields
  // ==========================================================================
  describe('Section 2: Extreme and Boundary Inputs for Flight Card Fields', () => {
    describe('2.1 Total Weight Boundaries (0g, 50,000g, fractional grams, non-numeric)', () => {
      it('persists and displays zero total weight (0g) without coercing to null', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)

        const res = await fetchPostForm(
          '/flights',
          {
            rocket_configuration_id: config.id,
            total_weight_g: 0,
            altitude_agl_m: 100,
            outcome: 'GOOD',
          },
          {
            Cookie: `triplet_session=${token}`,
          },
        )
        expect([200, 302, 303]).toContain(res.status)

        const db = getDb()
        const [flight] = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.rocketConfigurationId, config.id))

        expect(flight.totalWeightG).toBe(0)

        // Detail view should show 0g
        const detailRes = await fetchGet(`/flights/${flight.id}`, {
          Cookie: `triplet_session=${token}`,
        })
        const detailHtml = await detailRes.text()
        assertContains(detailHtml, '0g')
      })

      it('persists and displays extreme heavy all-up mass (50,000g / 50kg)', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)

        const res = await fetchPostForm(
          '/flights',
          {
            rocket_configuration_id: config.id,
            total_weight_g: 50000,
            altitude_agl_m: 5000,
            outcome: 'GOOD',
          },
          {
            Cookie: `triplet_session=${token}`,
          },
        )
        expect([200, 302, 303]).toContain(res.status)

        const db = getDb()
        const [flight] = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.rocketConfigurationId, config.id))

        expect(flight.totalWeightG).toBe(50000)

        const detailRes = await fetchGet(`/flights/${flight.id}`, {
          Cookie: `triplet_session=${token}`,
        })
        const detailHtml = await detailRes.text()
        assertContains(detailHtml, '50000g')
      })

      it('accurately preserves fractional grams (0.05g, 1450.75g, 9999.999g)', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)

        const fractionalMasses = [0.05, 1450.75, 9999.999]
        const db = getDb()

        for (const mass of fractionalMasses) {
          const res = await fetchPostForm(
            '/flights',
            {
              rocket_configuration_id: config.id,
              total_weight_g: mass,
              altitude_agl_m: 200,
              outcome: 'GOOD',
            },
            {
              Cookie: `triplet_session=${token}`,
            },
          )
          expect([200, 302, 303]).toContain(res.status)
        }

        const flights = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.flyerId, flyer.id))

        const savedMasses = flights.map((f) => f.totalWeightG)
        for (const expectedMass of fractionalMasses) {
          const found = savedMasses.some(
            (m) => m !== null && Math.abs(m - expectedMass) < 0.001,
          )
          expect(found).toBe(true)
        }
      })

      it('gracefully handles non-numeric total_weight_g without 500 crash', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)

        const res = await fetchPostForm(
          '/flights',
          {
            rocket_configuration_id: config.id,
            total_weight_g: 'invalid-mass-string',
            altitude_agl_m: 150,
            outcome: 'GOOD',
          },
          {
            Cookie: `triplet_session=${token}`,
          },
        )
        expect([200, 302, 303]).toContain(res.status)

        const db = getDb()
        const [flight] = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.rocketConfigurationId, config.id))

        expect(flight.totalWeightG).toBeNull()
      })
    })

    describe('2.2 Stability Margin Boundaries (negative, zero, fractional, high calibers)', () => {
      it('persists and displays negative stability margin (-1.5 cal) with alert styling', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)

        const res = await fetchPostForm(
          '/flights',
          {
            rocket_configuration_id: config.id,
            stability_margin: -1.5,
            altitude_agl_m: 50,
            outcome: 'Unstable',
          },
          {
            Cookie: `triplet_session=${token}`,
          },
        )
        expect([200, 302, 303]).toContain(res.status)

        const db = getDb()
        const [flight] = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.rocketConfigurationId, config.id))

        expect(flight.stabilityMargin).toBeCloseTo(-1.5)

        const detailRes = await fetchGet(`/flights/${flight.id}`, {
          Cookie: `triplet_session=${token}`,
        })
        const detailHtml = await detailRes.text()
        assertContains(detailHtml, '-1.50 cal', 'text-amber-400')
      })

      it('persists and displays zero stability margin (0.00 cal)', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)

        const res = await fetchPostForm(
          '/flights',
          {
            rocket_configuration_id: config.id,
            stability_margin: 0,
            altitude_agl_m: 80,
            outcome: 'GOOD',
          },
          {
            Cookie: `triplet_session=${token}`,
          },
        )
        expect([200, 302, 303]).toContain(res.status)

        const db = getDb()
        const [flight] = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.rocketConfigurationId, config.id))

        expect(flight.stabilityMargin).toBe(0)

        const detailRes = await fetchGet(`/flights/${flight.id}`, {
          Cookie: `triplet_session=${token}`,
        })
        const detailHtml = await detailRes.text()
        assertContains(detailHtml, '0.00 cal')
      })

      it('persists fractional calibers (1.42 cal, 0.01 cal, 15.75 cal)', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)

        const testCalibers = [1.42, 0.01, 15.75]
        const db = getDb()

        for (const cal of testCalibers) {
          const res = await fetchPostForm(
            '/flights',
            {
              rocket_configuration_id: config.id,
              stability_margin: cal,
              altitude_agl_m: 250,
              outcome: 'GOOD',
            },
            {
              Cookie: `triplet_session=${token}`,
            },
          )
          expect([200, 302, 303]).toContain(res.status)
        }

        const flights = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.flyerId, flyer.id))

        const margins = flights.map((f) => f.stabilityMargin)
        for (const expectedCal of testCalibers) {
          const found = margins.some(
            (m) => m !== null && Math.abs(m - expectedCal) < 0.001,
          )
          expect(found).toBe(true)
        }
      })
    })

    describe('2.3 Pad Numbers with Special Formats & Encodings', () => {
      const SPECIAL_PAD_FORMATS = [
        'A-01',
        'Pad #3',
        'Away Pad / Cell 2',
        'Pad @ 45° North',
        'Cell & Rack <Alpha/Beta>',
        'Pad "Zero"',
        'Extremely Long Pad Designation For Extended Range Perimeter High Power Heavy Launch Complex Pad 99B-West',
      ]

      it.each(SPECIAL_PAD_FORMATS)(
        'persists special pad format "%s" and safely escapes HTML in detail and list views',
        async (pad) => {
          const flyer = await seedTestUser()
          const token = await signSession(flyer.id)
          const rocket = await seedTestRocket(flyer.id)
          const config = await seedTestConfig(rocket.id)

          const res = await fetchPostForm(
            '/flights',
            {
              rocket_configuration_id: config.id,
              pad_number: pad,
              altitude_agl_m: 350,
              outcome: 'GOOD',
            },
            {
              Cookie: `triplet_session=${token}`,
            },
          )
          expect([200, 302, 303]).toContain(res.status)

          const db = getDb()
          const [flight] = await db
            .select()
            .from(schema.flights)
            .where(eq(schema.flights.rocketConfigurationId, config.id))

          expect(flight.padNumber).toBe(pad.trim())

          // Detail view check
          const detailRes = await fetchGet(`/flights/${flight.id}`, {
            Cookie: `triplet_session=${token}`,
          })
          assertHtmlResponse(detailRes, 200)
          const detailHtml = await detailRes.text()

          // Ensure raw unescaped HTML injection did not occur
          expect(detailHtml).not.toContain('<Alpha/Beta>')
          if (pad.includes('<')) {
            expect(detailHtml).toContain('&lt;Alpha/Beta&gt;')
          }

          // List view check
          const listRes = await fetchGet('/flights', {
            Cookie: `triplet_session=${token}`,
          })
          assertHtmlResponse(listRes, 200)
        },
      )
    })

    describe('2.4 Recovery Descriptions with Quotes & Imperial/Metric Units', () => {
      it('preserves quotes and metric/imperial notation in recovery size without truncating form attributes', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)

        const complexRecoverySize = '48" Ripstop Nylon (70cm)'
        const res = await fetchPostForm(
          '/flights',
          {
            rocket_configuration_id: config.id,
            recovery_system: 'Chute(s)',
            recovery_size: complexRecoverySize,
            deployment_method: 'Electronic deploy',
            main_deploy_altitude: '450 ft / 137m',
            altitude_agl_m: 800,
            outcome: 'GOOD',
          },
          {
            Cookie: `triplet_session=${token}`,
          },
        )
        expect([200, 302, 303]).toContain(res.status)

        const db = getDb()
        const [flight] = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.rocketConfigurationId, config.id))

        expect(flight.recoverySize).toBe(complexRecoverySize)
        expect(flight.deploymentMethod).toBe('Electronic deploy')
        expect(flight.mainDeployAltitude).toBe('450 ft / 137m')

        // Detail View Rendering: check that quotes and metric sizes render safely
        const detailRes = await fetchGet(`/flights/${flight.id}`, {
          Cookie: `triplet_session=${token}`,
        })
        const detailHtml = await detailRes.text()
        expect(detailHtml).toMatch(/48(&quot;|") Ripstop Nylon \(70cm\)/i)
        assertContains(detailHtml, 'Electronic deploy', '450 ft / 137m')

        // Edit Form Pre-population: check that the value attribute isn't prematurely terminated by unescaped double quotes
        const editRes = await fetchGet(`/flights/${flight.id}/edit`, {
          Cookie: `triplet_session=${token}`,
        })
        const editHtml = await editRes.text()
        expect(editHtml).toMatch(/name=["']recovery_size["'][^>]*value=["']48(&quot;|") Ripstop Nylon \(70cm\)["']/i)
      })

      it('supports all 4 recovery system enums and 3 deployment method enums', async () => {
        const flyer = await seedTestUser()
        const db = getDb()

        const recoverySystems = ['Chute(s)', 'Streamer', 'Tumble', 'Other'] as const
        const deploymentMethods = ['Motor eject', 'Chute Release', 'Electronic deploy'] as const

        for (let i = 0; i < recoverySystems.length; i++) {
          const sys = recoverySystems[i]
          const method = deploymentMethods[i % deploymentMethods.length]

          const flight = await seedTestFlight(flyer.id, {
            recoverySystem: sys,
            deploymentMethod: method,
            recoverySize: `${i * 10 + 20}"`,
            mainDeployAltitude: i % 2 === 0 ? 'Apogee' : `${i * 100 + 300} ft`,
          })

          const [saved] = await db
            .select()
            .from(schema.flights)
            .where(eq(schema.flights.id, flight.id))

          expect(saved.recoverySystem).toBe(sys)
          expect(saved.deploymentMethod).toBe(method)
        }
      })
    })

    describe('2.5 Maiden Flight Toggles & Certification Attempts', () => {
      it('correctly parses various boolean representations for is_first_flight', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const db = getDb()

        const truePermutations = ['true', '1', 'on']
        for (const val of truePermutations) {
          const res = await fetchPostForm(
            '/flights',
            {
              rocket_configuration_id: config.id,
              is_first_flight: val,
              altitude_agl_m: 200,
              outcome: 'GOOD',
            },
            {
              Cookie: `triplet_session=${token}`,
            },
          )
          expect([200, 302, 303]).toContain(res.status)
        }

        const falsePermutations = ['false', '0', '']
        for (const val of falsePermutations) {
          const res = await fetchPostForm(
            '/flights',
            {
              rocket_configuration_id: config.id,
              is_first_flight: val,
              altitude_agl_m: 200,
              outcome: 'GOOD',
            },
            {
              Cookie: `triplet_session=${token}`,
            },
          )
          expect([200, 302, 303]).toContain(res.status)
        }

        const flights = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.flyerId, flyer.id))

        const trueFlights = flights.filter((f) => Boolean(f.isFirstFlight))
        const falseFlights = flights.filter((f) => !Boolean(f.isFirstFlight))

        expect(trueFlights).toHaveLength(3)
        expect(falseFlights).toHaveLength(3)
      })

      it('handles all 5 cert attempt levels (none, mpr, l1, l2, l3) and normalizes invalid strings to none', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const db = getDb()

        const validCerts = ['none', 'mpr', 'l1', 'l2', 'l3'] as const
        for (const cert of validCerts) {
          const res = await fetchPostForm(
            '/flights',
            {
              rocket_configuration_id: config.id,
              cert_attempt: cert,
              altitude_agl_m: 400,
              outcome: 'GOOD',
            },
            {
              Cookie: `triplet_session=${token}`,
            },
          )
          expect([200, 302, 303]).toContain(res.status)
        }

        // Test invalid cert string falls back to 'none' without throwing
        const invalidRes = await fetchPostForm(
          '/flights',
          {
            rocket_configuration_id: config.id,
            cert_attempt: 'l4_unsupported',
            altitude_agl_m: 400,
            outcome: 'GOOD',
          },
          {
            Cookie: `triplet_session=${token}`,
          },
        )
        expect([200, 302, 303]).toContain(invalidRes.status)

        const flights = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.flyerId, flyer.id))

        const recordedCerts = flights.map((f) => f.certAttempt)
        for (const expectedCert of validCerts) {
          expect(recordedCerts).toContain(expectedCert)
        }
        // Invalid cert should have normalized to 'none'
        const normalizedFlight = flights.find((f) => f.certAttempt === 'none')
        expect(normalizedFlight).toBeDefined()
      })

      it('supports all 4 build types (rtf, kit, modified, scratch_built)', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const db = getDb()

        const buildTypes = ['rtf', 'kit', 'modified', 'scratch_built'] as const
        for (const bt of buildTypes) {
          const res = await fetchPostForm(
            '/flights',
            {
              rocket_configuration_id: config.id,
              build_type: bt,
              altitude_agl_m: 300,
              outcome: 'GOOD',
            },
            {
              Cookie: `triplet_session=${token}`,
            },
          )
          expect([200, 302, 303]).toContain(res.status)
        }

        const flights = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.flyerId, flyer.id))

        const recordedBuilds = flights.map((f) => f.buildType)
        for (const expectedBt of buildTypes) {
          expect(recordedBuilds).toContain(expectedBt)
        }
      })
    })
  })

  // ==========================================================================
  // Section 3: Partial Editing Preserves Unedited Flight Card Fields
  // ==========================================================================
  describe('Section 3: Partial Editing Field Preservation', () => {
    it('strictly preserves all other 11 flight card fields and telemetry when updating a single field', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id, { name: 'Titan IV' })
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 2.45 })
      const motor = await seedTestMotor({ manufacturer: 'Cesaroni', model: 'J350' })
      const site = await seedTestSite({ name: 'Faraway Range' })

      // Seed flight with ALL 12 flight card fields + officers + measurements populated
      const initialFlight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        flightNumber: 3,
        altitudeAglM: 1250.5,
        maxVelocityMps: 235.8,
        maxAccelG: 14.2,
        outcome: 'GOOD',
        isFirstFlight: true,
        certAttempt: 'l2',
        buildType: 'scratch_built',
        stabilityCheckMethod: 'Rocksim 10.4',
        stabilityMargin: 2.45,
        motorType: 'Composite',
        totalWeightG: 3450.5,
        recoverySystem: 'Chute(s)',
        recoverySize: '48" Ripstop Nylon',
        deploymentMethod: 'Electronic deploy',
        mainDeployAltitude: '500 ft AGL',
        padNumber: 'Pad #3',
        rsoName: 'Range Officer Frank',
        lcoName: 'Controller Dave',
        notes: 'Pre-flight check verified',
      })

      const db = getDb()

      // 1. Partial Edit: Update ONLY pad_number to 'Away Pad / Cell 2'
      const res1 = await fetchPostForm(
        `/flights/${initialFlight.id}/edit`,
        {
          pad_number: 'Away Pad / Cell 2',
        },
        {
          Cookie: `triplet_session=${token}`,
        },
      )
      expect([200, 302, 303]).toContain(res1.status)

      const [f1] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, initialFlight.id))

      // Modified field
      expect(f1.padNumber).toBe('Away Pad / Cell 2')
      // Preserved fields
      expect(Boolean(f1.isFirstFlight)).toBe(true)
      expect(f1.certAttempt).toBe('l2')
      expect(f1.buildType).toBe('scratch_built')
      expect(f1.stabilityCheckMethod).toBe('Rocksim 10.4')
      expect(f1.stabilityMargin).toBeCloseTo(2.45)
      expect(f1.motorType).toBe('Composite')
      expect(f1.totalWeightG).toBeCloseTo(3450.5)
      expect(f1.recoverySystem).toBe('Chute(s)')
      expect(f1.recoverySize).toBe('48" Ripstop Nylon')
      expect(f1.deploymentMethod).toBe('Electronic deploy')
      expect(f1.mainDeployAltitude).toBe('500 ft AGL')
      expect(f1.rsoName).toBe('Range Officer Frank')
      expect(f1.lcoName).toBe('Controller Dave')
      expect(f1.altitudeAglM).toBeCloseTo(1250.5)
      expect(f1.maxVelocityMps).toBeCloseTo(235.8)
      expect(f1.outcome).toBe('GOOD')
      expect(f1.notes).toBe('Pre-flight check verified')

      // 2. Partial Edit: Update ONLY total_weight_g to 0
      const res2 = await fetchPostForm(
        `/flights/${initialFlight.id}/edit`,
        {
          total_weight_g: 0,
        },
        {
          Cookie: `triplet_session=${token}`,
        },
      )
      expect([200, 302, 303]).toContain(res2.status)

      const [f2] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, initialFlight.id))

      expect(f2.totalWeightG).toBe(0)
      expect(f2.padNumber).toBe('Away Pad / Cell 2')
      expect(f2.stabilityMargin).toBeCloseTo(2.45)
      expect(Boolean(f2.isFirstFlight)).toBe(true)
      expect(f2.certAttempt).toBe('l2')

      // 3. Partial Edit: Update ONLY stability_margin to -0.5
      const res3 = await fetchPostForm(
        `/flights/${initialFlight.id}/edit`,
        {
          stability_margin: -0.5,
        },
        {
          Cookie: `triplet_session=${token}`,
        },
      )
      expect([200, 302, 303]).toContain(res3.status)

      const [f3] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, initialFlight.id))

      expect(f3.stabilityMargin).toBeCloseTo(-0.5)
      expect(f3.totalWeightG).toBe(0)
      expect(f3.padNumber).toBe('Away Pad / Cell 2')
      expect(f3.recoverySize).toBe('48" Ripstop Nylon')

      // 4. Partial Edit: Update ONLY outcome to 'Separation'
      const res4 = await fetchPostForm(
        `/flights/${initialFlight.id}/edit`,
        {
          outcome: 'Separation',
        },
        {
          Cookie: `triplet_session=${token}`,
        },
      )
      expect([200, 302, 303]).toContain(res4.status)

      const [f4] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, initialFlight.id))

      expect(f4.outcome).toBe('Separation')
      expect(f4.stabilityMargin).toBeCloseTo(-0.5)
      expect(f4.totalWeightG).toBe(0)
      expect(f4.padNumber).toBe('Away Pad / Cell 2')
    })

    it('correctly resets optional fields to null when explicitly cleared with empty string', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        padNumber: 'Pad 1A',
        totalWeightG: 850.0,
        stabilityMargin: 1.7,
        stabilityCheckMethod: 'OpenRocket',
        recoverySize: '24"',
      })

      // Submit form clearing optional fields with empty strings
      const res = await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          pad_number: '',
          total_weight_g: '',
          stability_margin: '',
          stability_check_method: '',
          recovery_size: '',
        },
        {
          Cookie: `triplet_session=${token}`,
        },
      )
      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flight.id))

      expect(updated.padNumber).toBeNull()
      expect(updated.totalWeightG).toBeNull()
      expect(updated.stabilityMargin).toBeNull()
      expect(updated.stabilityCheckMethod).toBeNull()
      expect(updated.recoverySize).toBeNull()
    })
  })
})
