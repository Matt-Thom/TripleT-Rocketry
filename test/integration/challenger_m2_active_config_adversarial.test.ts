/**
 * Empirical Adversarial Challenger Test Suite: Milestone 2 (Requirement R2)
 * Scope: Active Configuration Workflow, Dynamic Airframe Synchronization,
 *        Preflight Clearance & Flight Log Integration, and Visual Decoupling.
 *
 * Requirements Tested:
 * 1. Active Configuration Sync:
 *    - Direct editing via POST /rockets/:id/configurations/:activeConfigId/edit updates D1 config row
 *      AND synchronizes schema.rockets.lengthMm and schema.rockets.bodyDiameterMm.
 *    - Inactive snapshot editing strictly leaves schema.rockets airframe dimensions untouched.
 *    - Handles floating point measurements (e.g. 1485.5 mm, 66.2 mm) without truncation.
 *    - Prevents cross-rocket configuration tampering (HTTP 404).
 * 2. Preflight Check & Flight Log Integration:
 *    - Dynamic soft-gate evaluator (POST /flights/preflight-check) immediately evaluates updated
 *      stability calibers from active config snapshot in D1 (< 1.0 triggers safety alert; >= 1.0 clears it).
 *    - Preflight creation form (GET /flights/new) immediately reflects updated active config dimensions
 *      in <select name="rocket_configuration_id"> (data-length, data-diameter) and in the
 *      #preflight-airframe-geometry-card display (mm and cm).
 *    - Flight detail view (GET /flights/:id) displays updated CG/CP datum position, stability margin,
 *      and physical clearance (RSO/LCO) verification.
 * 3. Visual Metrics Card Assertions & Decoupling:
 *    - Decoupled cards for "Motor Mount Diameter" and "Recovery / Chute Specifications".
 *    - Renders accurately across recovery types: tumble, streamer, parachute, dual_deploy.
 *    - Handles null/empty chute sizes and null motor mount diameter gracefully ('—' without NaN/undefined).
 *    - Strictly enforces absence of the legacy fused string "Motor Mount / Chute" across all views.
 */

import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import { signSession } from '../../src/services/auth'
import {
  getDb,
  seedTestCert,
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
  assertNotContains,
} from '../helpers/html'
import { fetchGet, fetchHtmxPostForm, fetchPostForm } from '../helpers/http'

beforeEach(truncateDb)

describe('Empirical Adversarial Challenger: M2 Active Config & Metrics Decoupling', () => {
  // =========================================================================
  // SECTION 1: Active Configuration Sync & Boundary Isolation
  // =========================================================================
  describe('1. Active Configuration Sync & Historical Boundary Isolation', () => {
    it('1.1: editing active configuration updates D1 config row and synchronizes schema.rockets dimensions', async () => {
      const flyer = await seedTestUser({ displayName: 'Lead Aerodynamicist' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      // Baseline rocket airframe
      const rocket = await seedTestRocket(flyer.id, {
        name: 'Hyperion Starchaser',
        lengthMm: 1250.0,
        bodyDiameterMm: 54.0,
      })

      // Active configuration snapshot
      const activeConfig = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1250.0,
        bodyDiameterMm: 54.0,
        dryMassG: 750.0,
        loadedMassG: 1100.0,
        cgMm: 680.0,
        cpMm: 810.0,
        stabilityCalibers: 2.4,
        motorMountDiameterMm: 29.0,
        recoveryType: 'parachute',
        parachuteSizeMm: 600.0,
        notes: 'Baseline factory configuration',
        isCurrent: true,
      })

      // POST edit to active configuration with decimal precision
      const updatedPayload = {
        length_mm: 1485.5,
        body_diameter_mm: 66.2,
        dry_mass_g: 825.4,
        loaded_mass_g: 1240.0,
        ballast_g: 35.0,
        cg_mm: 745.0,
        cp_mm: 890.0,
        stability_calibers: 2.19,
        motor_mount_diameter_mm: 38.0,
        recovery_type: 'dual_deploy',
        parachute_size_mm: 850.0,
        drogue_parachute_size_mm: 300.0,
        notes: 'Stretched booster with 38mm mount and dual deploy',
      }

      const res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${activeConfig.id}/edit`,
        updatedPayload,
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()

      // 1. Verify updated row in rocketConfigurations
      const [persistedConfig] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, activeConfig.id))

      expect(persistedConfig).toBeDefined()
      expect(persistedConfig.lengthMm).toBeCloseTo(1485.5)
      expect(persistedConfig.bodyDiameterMm).toBeCloseTo(66.2)
      expect(persistedConfig.dryMassG).toBeCloseTo(825.4)
      expect(persistedConfig.loadedMassG).toBeCloseTo(1240.0)
      expect(persistedConfig.ballastG).toBeCloseTo(35.0)
      expect(persistedConfig.cgMm).toBeCloseTo(745.0)
      expect(persistedConfig.cpMm).toBeCloseTo(890.0)
      expect(persistedConfig.stabilityCalibers).toBeCloseTo(2.19)
      expect(persistedConfig.motorMountDiameterMm).toBeCloseTo(38.0)
      expect(persistedConfig.recoveryType).toBe('dual_deploy')
      expect(persistedConfig.parachuteSizeMm).toBeCloseTo(850.0)
      expect(persistedConfig.drogueParachuteSizeMm).toBeCloseTo(300.0)
      expect(persistedConfig.notes).toBe('Stretched booster with 38mm mount and dual deploy')
      expect(persistedConfig.isCurrent).toBe(true)

      // 2. Verify parent rocket airframe is synchronized
      const [parentRocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocket.id))

      expect(parentRocket.lengthMm).toBeCloseTo(1485.5)
      expect(parentRocket.bodyDiameterMm).toBeCloseTo(66.2)

      // 3. Verify GET /rockets/:id renders updated spotlight and notes
      const detailRes = await fetchGet(`/rockets/${rocket.id}`, { Cookie: cookie })
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()

      assertContains(detailHtml, '1485.5 mm', '66.2 mm')
      assertContains(detailHtml, 'Stretched booster with 38mm mount and dual deploy')
      assertNotContains(detailHtml, 'Motor Mount / Chute')
    })

    it('1.2: editing inactive configuration strictly leaves parent rocket airframe dimensions unchanged', async () => {
      const flyer = await seedTestUser({ displayName: 'Archival Auditor' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Chronos Multi-Stage',
        lengthMm: 2100.0,
        bodyDiameterMm: 98.0,
      })

      // Historical inactive v1
      const configV1 = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1750.0,
        bodyDiameterMm: 80.0,
        isCurrent: false,
        notes: 'Prototype v1',
      })

      // Active v2
      const configV2 = await seedTestConfig(rocket.id, {
        version: 2,
        lengthMm: 2100.0,
        bodyDiameterMm: 98.0,
        isCurrent: true,
        notes: 'Current flight airframe',
      })

      // Edit historical snapshot v1
      const editRes = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${configV1.id}/edit`,
        {
          length_mm: 1780.0,
          body_diameter_mm: 82.0,
          dry_mass_g: 990.0,
          notes: 'Corrected blueprint v1',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(editRes.status)

      const db = getDb()

      // Config v1 updated in D1
      const [updatedV1] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, configV1.id))
      expect(updatedV1.lengthMm).toBeCloseTo(1780.0)
      expect(updatedV1.bodyDiameterMm).toBeCloseTo(82.0)
      expect(updatedV1.notes).toBe('Corrected blueprint v1')
      expect(updatedV1.isCurrent).toBe(false)

      // Active v2 untouched in D1
      const [untouchedV2] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, configV2.id))
      expect(untouchedV2.lengthMm).toBeCloseTo(2100.0)
      expect(untouchedV2.bodyDiameterMm).toBeCloseTo(98.0)
      expect(untouchedV2.isCurrent).toBe(true)

      // Parent rocket MUST strictly remain synchronized with active v2
      const [parentRocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocket.id))
      expect(parentRocket.lengthMm).toBeCloseTo(2100.0)
      expect(parentRocket.bodyDiameterMm).toBeCloseTo(98.0)
    })

    it('1.3: preserves existing airframe dimensions on partial configuration edits without length/diameter', async () => {
      const flyer = await seedTestUser({ displayName: 'Partial Field Tester' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Endeavour Probe',
        lengthMm: 1150.0,
        bodyDiameterMm: 50.0,
      })

      const activeConfig = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1150.0,
        bodyDiameterMm: 50.0,
        dryMassG: 450.0,
        notes: 'Original note',
        isCurrent: true,
      })

      // Update only notes and dry mass (no length_mm or body_diameter_mm in payload)
      const res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${activeConfig.id}/edit`,
        {
          dry_mass_g: 480.0,
          notes: 'Updated notes only',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [config] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, activeConfig.id))

      expect(config.dryMassG).toBeCloseTo(480.0)
      expect(config.lengthMm).toBeCloseTo(1150.0)
      expect(config.bodyDiameterMm).toBeCloseTo(50.0)
      expect(config.notes).toBe('Updated notes only')

      const [parent] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocket.id))

      expect(parent.lengthMm).toBeCloseTo(1150.0)
      expect(parent.bodyDiameterMm).toBeCloseTo(50.0)
    })

    it('1.4: rejects cross-rocket configuration tampering with HTTP 404', async () => {
      const flyer = await seedTestUser({ displayName: 'Security Auditor' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocketA = await seedTestRocket(flyer.id, { name: 'Rocket Alpha' })
      const rocketB = await seedTestRocket(flyer.id, { name: 'Rocket Beta' })
      const configB = await seedTestConfig(rocketB.id, { version: 1, isCurrent: true })

      // Attempt to edit configB under rocketA's route
      const crossEditRes = await fetchPostForm(
        `/rockets/${rocketA.id}/configurations/${configB.id}/edit`,
        { notes: 'Illegitimate cross-rocket edit' },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect(crossEditRes.status).toBe(404)
      const resText = await crossEditRes.text()
      expect(resText).toMatch(/Configuration snapshot not found/i)
    })
  })

  // =========================================================================
  // SECTION 2: Preflight Check & Flight Log Integration
  // =========================================================================
  describe('2. Preflight Check & Flight Log Integration', () => {
    it('2.1: dynamic preflight check (/flights/preflight-check) immediately evaluates updated stability margin', async () => {
      const flyer = await seedTestUser({ displayName: 'Safety Evaluator' })
      await seedTestCert(flyer.id, { level: 1 })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Aero Dynamicist' })
      const motor = await seedTestMotor({ impulseClass: 'H', manufacturer: 'AeroTech', model: 'H128W' })
      const site = await seedTestSite({ maxAltitudeAglM: 2500 })

      // Active config initially with compliant stability margin: 1.75 calibers
      const activeConfig = await seedTestConfig(rocket.id, {
        version: 1,
        stabilityCalibers: 1.75,
        lengthMm: 1300.0,
        bodyDiameterMm: 60.0,
        motorMountDiameterMm: 29.0,
        isCurrent: true,
      })

      // 1. Initial preflight-check: Compliant stability -> no stability warnings
      const checkRes1 = await fetchHtmxPostForm(
        '/flights/preflight-check',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: activeConfig.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: 800,
        },
        { Cookie: cookie },
      )

      assertHtmlResponse(checkRes1, 200)
      const html1 = await checkRes1.text()
      expect(html1).not.toContain('Stability margin of')
      expect(html1).not.toContain('below the 1.0 caliber safety threshold')

      // 2. Direct edit of active configuration: reduce stability calibers to 0.65 (< 1.0 threshold)
      const updateRes = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${activeConfig.id}/edit`,
        {
          stability_calibers: 0.65,
          notes: 'Shifted CG aft for experimental test',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(updateRes.status)

      // 3. Subsequent preflight-check immediately evaluates updated 0.65 margin from D1
      const checkRes2 = await fetchHtmxPostForm(
        '/flights/preflight-check',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: activeConfig.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: 800,
        },
        { Cookie: cookie },
      )

      assertHtmlResponse(checkRes2, 200)
      const html2 = await checkRes2.text()
      expect(html2).toContain('Stability margin of 0.65 calibers is below the 1.0 caliber safety threshold.')

      // 4. Edit active configuration again: restore stability calibers to 2.05
      const restoreRes = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${activeConfig.id}/edit`,
        {
          stability_calibers: 2.05,
          notes: 'Added nose ballast to restore 2.05 calibers',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(restoreRes.status)

      // 5. Preflight check now immediately clears the warning
      const checkRes3 = await fetchHtmxPostForm(
        '/flights/preflight-check',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: activeConfig.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: 800,
        },
        { Cookie: cookie },
      )

      assertHtmlResponse(checkRes3, 200)
      const html3 = await checkRes3.text()
      expect(html3).not.toContain('Stability margin of')
      expect(html3).not.toContain('below the 1.0 caliber safety threshold')
    })

    it('2.2: preflight form options and review card immediately reflect active config updates', async () => {
      const flyer = await seedTestUser({ displayName: 'Pad Inspector' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Valkyrie Interceptor',
        lengthMm: 1100.0,
        bodyDiameterMm: 54.0,
      })

      const activeConfig = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1100.0,
        bodyDiameterMm: 54.0,
        stabilityCalibers: 1.5,
        isCurrent: true,
      })

      // 1. Initial GET /flights/new renders baseline geometry
      const newFormRes1 = await fetchGet('/flights/new', { Cookie: cookie })
      assertHtmlResponse(newFormRes1, 200)
      const html1 = await newFormRes1.text()

      expect(html1).toContain(`value="${activeConfig.id}"`)
      expect(html1).toContain('data-length="1100"')
      expect(html1).toContain('data-diameter="54"')
      expect(html1).toContain('L: 1100mm, Ø: 54mm')
      expect(html1).toContain('1100 mm (110.0 cm)')
      expect(html1).toContain('54 mm (5.4 cm)')

      // 2. Direct edit of active configuration: update length, diameter, and stability
      const updateRes = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${activeConfig.id}/edit`,
        {
          length_mm: 1320.5,
          body_diameter_mm: 66.0,
          stability_calibers: 2.35,
          notes: 'Extended payload bay',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(updateRes.status)

      // 3. Subsequent GET /flights/new reflects updated configuration in dropdown and preflight card
      const newFormRes2 = await fetchGet('/flights/new', { Cookie: cookie })
      assertHtmlResponse(newFormRes2, 200)
      const html2 = await newFormRes2.text()

      expect(html2).toContain(`value="${activeConfig.id}"`)
      expect(html2).toContain('data-length="1320.5"')
      expect(html2).toContain('data-diameter="66"')
      expect(html2).toContain('L: 1320.5mm, Ø: 66mm')
      expect(html2).toContain('2.35 cal')
      expect(html2).toContain('1320.5 mm (132.1 cm)')
      expect(html2).toContain('66 mm (6.6 cm)')
    })

    it('2.3: flight log and flight detail view render updated CG/CP, stability, and RSO/LCO clearance', async () => {
      const flyer = await seedTestUser({ displayName: 'Range Safety Officer' })
      await seedTestCert(flyer.id, { level: 1 })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Titan Explorer',
        lengthMm: 1650.0,
        bodyDiameterMm: 75.0,
      })

      const activeConfig = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1650.0,
        bodyDiameterMm: 75.0,
        cgMm: 850.0,
        cpMm: 1020.0,
        stabilityCalibers: 2.27,
        motorMountDiameterMm: 38.0,
        recoveryType: 'parachute',
        parachuteSizeMm: 750.0,
        isCurrent: true,
      })

      const motor = await seedTestMotor({
        impulseClass: 'H',
        manufacturer: 'Cesaroni',
        model: 'H153',
        diameterMm: 38,
      })
      const site = await seedTestSite({ name: 'Argonia Rocket Pasture', maxAltitudeAglM: 3500 })

      // Edit active configuration to update CG/CP and motor mount
      const updateRes = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${activeConfig.id}/edit`,
        {
          cg_mm: 885.0,
          cp_mm: 1055.0,
          motor_mount_diameter_mm: 54.0,
          stability_calibers: 2.27,
          notes: 'Adapted for 54mm casing',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(updateRes.status)

      // Create flight record using this updated configuration
      const flightPayload = {
        flyer_id: flyer.id,
        rocket_configuration_id: activeConfig.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        altitude_agl_m: 1420,
        outcome: 'GOOD',
        log_type: 'actual',
        rso_name: 'Andrew Buttery',
        lco_name: 'Jerome Pong',
        proceeded_despite_warnings: 'off',
      }

      const createRes = await fetchPostForm('/flights', flightPayload, { Cookie: cookie }, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(createRes.status)

      const db = getDb()
      const [flight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.flyerId, flyer.id))

      expect(flight).toBeDefined()

      // Fetch flight detail view GET /flights/:id
      const flightRes = await fetchGet(`/flights/${flight.id}`, { Cookie: cookie })
      assertHtmlResponse(flightRes, 200)
      const flightHtml = await flightRes.text()

      // 1. Airframe Physical Clearance Verification (RSO / LCO)
      expect(flightHtml).toContain('Physical Clearance (RSO/LCO):')
      expect(flightHtml).toContain('1650 mm (165.0 cm)')
      expect(flightHtml).toContain('75 mm (7.5 cm)')
      expect(flightHtml).toContain('(Pad fit & launch rail clearance verified)')

      // 2. Center of Gravity (CG) and Center of Pressure (CP)
      expect(flightHtml).toContain('data-cg="885"')
      expect(flightHtml).toContain('data-cp="1055"')
      expect(flightHtml).toContain('885mm / 1055mm')
      expect(flightHtml).toContain('Distance from Nose Cone Tip')

      // 3. Stability margin
      expect(flightHtml).toContain('2.27 cal')

      // 4. Officers and outcomes
      expect(flightHtml).toContain('Andrew Buttery')
      expect(flightHtml).toContain('Jerome Pong')
      expect(flightHtml).toContain('GOOD')

      // 5. Absence of legacy fused string
      assertNotContains(flightHtml, 'Motor Mount / Chute')
    })
  })

  // =========================================================================
  // SECTION 3: Visual Decoupling & Recovery Types Stress Test
  // =========================================================================
  describe('3. Visual Metrics Card Assertions & Decoupling', () => {
    it('3.1: renders tumble recovery type with null chute sizes gracefully', async () => {
      const flyer = await seedTestUser({ displayName: 'Tumble Specialist' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Tumble Dart' })
      await seedTestConfig(rocket.id, {
        version: 1,
        recoveryType: 'tumble',
        parachuteSizeMm: null,
        drogueParachuteSizeMm: null,
        motorMountDiameterMm: 24.0,
        isCurrent: true,
      })

      const res = await fetchGet(`/rockets/${rocket.id}`, { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Motor Mount Diameter Card
      assertContains(html, 'Motor Mount Diameter')
      expect(html).toMatch(/24(\.0)?mm/)
      assertContains(html, 'Motor Casing Size')

      // Recovery / Chute Specifications Card
      assertContains(html, 'Recovery / Chute Specifications')
      assertContains(html, 'Tumble')
      // Null chute displays '—'
      expect(html).toMatch(/<div class="text-\[10px\] text-slate-400 mt-0\.5">\s*—\s*<\/div>/)

      // Strict check: legacy fused string NEVER present
      assertNotContains(html, 'Motor Mount / Chute')
    })

    it('3.2: renders streamer recovery type with width/diameter measurement', async () => {
      const flyer = await seedTestUser({ displayName: 'Streamer Flyer' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Sky Ribbon' })
      await seedTestConfig(rocket.id, {
        version: 1,
        recoveryType: 'streamer',
        parachuteSizeMm: 50.0,
        motorMountDiameterMm: 18.0,
        isCurrent: true,
      })

      const res = await fetchGet(`/rockets/${rocket.id}`, { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'Motor Mount Diameter')
      expect(html).toMatch(/18(\.0)?mm/)

      assertContains(html, 'Recovery / Chute Specifications')
      assertContains(html, 'Streamer')
      expect(html).toMatch(/50(\.0)?mm/)

      assertNotContains(html, 'Motor Mount / Chute')
    })

    it('3.3: renders single parachute recovery type with null parachute size gracefully', async () => {
      const flyer = await seedTestUser({ displayName: 'Chute Tester' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Floater Alpha' })
      await seedTestConfig(rocket.id, {
        version: 1,
        recoveryType: 'parachute',
        parachuteSizeMm: null,
        motorMountDiameterMm: 29.0,
        isCurrent: true,
      })

      const res = await fetchGet(`/rockets/${rocket.id}`, { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'Recovery / Chute Specifications')
      assertContains(html, 'Parachute')
      expect(html).toMatch(/<div class="text-\[10px\] text-slate-400 mt-0\.5">\s*—\s*<\/div>/)

      assertNotContains(html, 'Motor Mount / Chute')
    })

    it('3.4: renders dual_deploy recovery type under complete, partial, and null chute sizes', async () => {
      const flyer = await seedTestUser({ displayName: 'Dual Deploy Expert' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      // Scenario A: Both main and drogue chutes specified
      const rocketA = await seedTestRocket(flyer.id, { name: 'Stratosphere DD Full' })
      await seedTestConfig(rocketA.id, {
        version: 1,
        recoveryType: 'dual_deploy',
        parachuteSizeMm: 1200.0,
        drogueParachuteSizeMm: 350.0,
        motorMountDiameterMm: 54.0,
        isCurrent: true,
      })

      const resA = await fetchGet(`/rockets/${rocketA.id}`, { Cookie: cookie })
      assertHtmlResponse(resA, 200)
      const htmlA = await resA.text()

      assertContains(htmlA, 'Motor Mount Diameter')
      expect(htmlA).toMatch(/54(\.0)?mm/)
      assertContains(htmlA, 'Recovery / Chute Specifications')
      assertContains(htmlA, 'Dual Deploy')
      expect(htmlA).toMatch(/Main:\s*1200(\.0)?mm/)
      expect(htmlA).toMatch(/Drogue:\s*350(\.0)?mm/)
      assertNotContains(htmlA, 'Motor Mount / Chute')

      // Scenario B: Main specified, drogue is null
      const rocketB = await seedTestRocket(flyer.id, { name: 'Stratosphere DD No Drogue' })
      await seedTestConfig(rocketB.id, {
        version: 1,
        recoveryType: 'dual_deploy',
        parachuteSizeMm: 900.0,
        drogueParachuteSizeMm: null,
        motorMountDiameterMm: 38.0,
        isCurrent: true,
      })

      const resB = await fetchGet(`/rockets/${rocketB.id}`, { Cookie: cookie })
      assertHtmlResponse(resB, 200)
      const htmlB = await resB.text()

      assertContains(htmlB, 'Dual Deploy')
      expect(htmlB).toMatch(/Main:\s*900(\.0)?mm/)
      expect(htmlB).not.toContain('Drogue:')
      assertNotContains(htmlB, 'Motor Mount / Chute')

      // Scenario C: Both main and drogue are null
      const rocketC = await seedTestRocket(flyer.id, { name: 'Stratosphere DD Null Both' })
      await seedTestConfig(rocketC.id, {
        version: 1,
        recoveryType: 'dual_deploy',
        parachuteSizeMm: null,
        drogueParachuteSizeMm: null,
        motorMountDiameterMm: 29.0,
        isCurrent: true,
      })

      const resC = await fetchGet(`/rockets/${rocketC.id}`, { Cookie: cookie })
      assertHtmlResponse(resC, 200)
      const htmlC = await resC.text()

      assertContains(htmlC, 'Dual Deploy')
      expect(htmlC).toContain('Main: —')
      assertNotContains(htmlC, 'Motor Mount / Chute')
    })

    it('3.5: renders motor mount diameter with null value gracefully without NaN', async () => {
      const flyer = await seedTestUser({ displayName: 'Null Diameter Tester' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Glider Experimental' })
      await seedTestConfig(rocket.id, {
        version: 1,
        motorMountDiameterMm: null,
        recoveryType: 'tumble',
        isCurrent: true,
      })

      const res = await fetchGet(`/rockets/${rocket.id}`, { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'Motor Mount Diameter')
      // Must render '—' and NOT 'nullmm', 'undefinedmm', or 'NaN'
      expect(html).not.toContain('nullmm')
      expect(html).not.toContain('undefinedmm')
      expect(html).not.toContain('NaN')

      assertNotContains(html, 'Motor Mount / Chute')
    })

    it('3.6: exhaustive verification that "Motor Mount / Chute" legacy string never appears in any rocket or flight view', async () => {
      const flyer = await seedTestUser({ displayName: 'Legacy String Verifier' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'String Sentinel' })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        motorMountDiameterMm: 29.0,
        recoveryType: 'parachute',
        parachuteSizeMm: 500.0,
        isCurrent: true,
      })

      // 1. Rocket Detail View
      const rocketRes = await fetchGet(`/rockets/${rocket.id}`, { Cookie: cookie })
      const rocketHtml = await rocketRes.text()
      assertNotContains(rocketHtml, 'Motor Mount / Chute')

      // 2. Rocket Config Edit Form
      const editConfigRes = await fetchGet(
        `/rockets/${rocket.id}/configurations/${config.id}/edit`,
        { Cookie: cookie },
      )
      const editConfigHtml = await editConfigRes.text()
      assertNotContains(editConfigHtml, 'Motor Mount / Chute')

      // 3. Flight Creation Form
      const flightNewRes = await fetchGet('/flights/new', { Cookie: cookie })
      const flightNewHtml = await flightNewRes.text()
      assertNotContains(flightNewHtml, 'Motor Mount / Chute')
    })
  })
})
