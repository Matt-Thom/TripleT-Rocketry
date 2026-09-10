/**
 * Integration test suite for Flight Card & Range Log Alignment (Milestone 1 — Requirement R1).
 * Tests complete Google Sheet flight card field persistence in D1, expanded club outcomes,
 * event duty officer autofill with manual overrides, flight editing, and badge/telemetry rendering.
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
  assertHasFormField,
  assertHtmlResponse,
  assertNotContains,
} from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'

beforeEach(truncateDb)

describe('Flight Card & Range Log Alignment (Milestone 1 — Requirement R1)', () => {
  // ==========================================================================
  // Test 1: Flight Creation with All 12 Flight Card Fields Persisted to D1 & Detail View
  // ==========================================================================
  describe('Test 1: Flight Creation with All 12 Flight Card Fields Persisted to D1 & Verified on Detail View', () => {
    it('persists all 12 flight card fields to D1 and renders them on flight detail view', async () => {
      const flyer = await seedTestUser({ displayName: 'Flight Card Pilot' })
      await seedTestCert(flyer.id, { level: 1, certifyingBody: 'TRA' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id, { name: 'Hyperion Mk IV' })
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 2.15 })
      const motor = await seedTestMotor({ manufacturer: 'AeroTech', model: 'H128W', impulseClass: 'H' })
      const site = await seedTestSite({ name: 'Wooltana Station' })

      const flightCardPayload = {
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        log_type: 'actual',
        altitude_agl_m: 820.0,
        outcome: 'GOOD',
        // The 12 Flight Card Fields
        is_first_flight: 'true',
        cert_attempt: 'l1',
        build_type: 'scratch_built',
        stability_check_method: 'OpenRocket',
        stability_margin: 2.15,
        motor_type: 'Composite',
        total_weight_g: 1450.5,
        recovery_system: 'Chute(s)',
        recovery_size: '36"',
        deployment_method: 'Electronic deploy',
        main_deploy_altitude: '400 ft',
        pad_number: 'Pad B4',
        // Text Duty Officers
        rso_name: 'Andrew Buttery',
        lco_name: 'Jerome Pong',
        proceeded_despite_warnings: 'true',
        notes: 'Maiden L1 certification attempt under Tripoli rules',
      }

      const res = await fetchPostForm('/flights', flightCardPayload, {
        Cookie: `triplet_session=${token}`,
      })

      expect([200, 302, 303]).toContain(res.status)

      // 1. Direct D1 Database Assertion
      const db = getDb()
      const [savedFlight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(savedFlight).toBeDefined()
      expect(Boolean(savedFlight.isFirstFlight)).toBe(true)
      expect(savedFlight.certAttempt).toBe('l1')
      expect(savedFlight.buildType).toBe('scratch_built')
      expect(savedFlight.stabilityCheckMethod).toBe('OpenRocket')
      expect(savedFlight.stabilityMargin).toBeCloseTo(2.15)
      expect(savedFlight.motorType).toBe('Composite')
      expect(savedFlight.totalWeightG).toBeCloseTo(1450.5)
      expect(savedFlight.recoverySystem).toBe('Chute(s)')
      expect(savedFlight.recoverySize).toBe('36"')
      expect(savedFlight.deploymentMethod).toBe('Electronic deploy')
      expect(savedFlight.mainDeployAltitude).toBe('400 ft')
      expect(savedFlight.padNumber).toBe('Pad B4')
      expect(savedFlight.rsoName).toBe('Andrew Buttery')
      expect(savedFlight.lcoName).toBe('Jerome Pong')
      expect(savedFlight.outcome).toBe('GOOD')

      // 2. Flight Detail View (GET /flights/:id) Verification
      const detailRes = await fetchGet(`/flights/${savedFlight.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()

      assertContains(
        detailHtml,
        'Pad B4',
        'OpenRocket',
        '2.15',
        '1450.5',
        'Composite',
        'Chute(s)',
        'Electronic deploy',
        '400 ft',
        'Andrew Buttery',
        'Jerome Pong',
      )
      expect(detailHtml).toMatch(/36(&quot;|")/i)
    })
  })

  // ==========================================================================
  // Test 2: Expanded Club Outcomes
  // ==========================================================================
  describe('Test 2: Expanded Club Outcomes Inserted Without SQLite Constraint Violation', () => {
    const CLUB_OUTCOMES = [
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

    it.each(CLUB_OUTCOMES)(
      'accepts club outcome "%s" via direct D1 insertion and POST /flights without constraint violation',
      async (outcome) => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const motor = await seedTestMotor()
        const site = await seedTestSite()

        // 1. Direct D1 insert check
        const db = getDb()
        const [directFlight] = await db
          .insert(schema.flights)
          .values({
            flyerId: flyer.id,
            rocketConfigurationId: config.id,
            motorId: motor.id,
            launchSiteId: site.id,
            outcome: outcome as any,
          })
          .returning()

        expect(directFlight).toBeDefined()
        expect(directFlight.outcome).toBe(outcome)

        // 2. HTTP POST /flights check
        const res = await fetchPostForm(
          '/flights',
          {
            rocket_configuration_id: config.id,
            motor_id: motor.id,
            launch_site_id: site.id,
            outcome,
            altitude_agl_m: 500,
          },
          {
            Cookie: `triplet_session=${token}`,
          },
        )

        expect([200, 302, 303]).toContain(res.status)

        // 3. Detail View outcome badge rendering check
        const detailRes = await fetchGet(`/flights/${directFlight.id}`, {
          Cookie: `triplet_session=${token}`,
        })
        const detailHtml = await detailRes.text()
        expect(detailHtml).toContain(outcome)
      },
    )

    it('preserves legacy flight outcomes for backward compatibility', async () => {
      const flyer = await seedTestUser()
      const legacyOutcomes = [
        'successful',
        'cato',
        'separation',
        'recovery_failure',
        'tree',
        'powerline',
        'lost',
        'other',
      ] as const

      const db = getDb()
      for (const outcome of legacyOutcomes) {
        const [flight] = await db
          .insert(schema.flights)
          .values({
            flyerId: flyer.id,
            outcome,
          })
          .returning()
        expect(flight.outcome).toBe(outcome)
      }
    })

    it('strictly rejects arbitrary invalid outcome strings via SQLite CHECK constraint', async () => {
      const flyer = await seedTestUser()
      const db = getDb()

      await expect(
        db.insert(schema.flights).values({
          flyerId: flyer.id,
          outcome: 'invalid_exploded_flight' as any,
        }),
      ).rejects.toThrow()
    })
  })

  // ==========================================================================
  // Test 3: Event Duty Officer Autofill via GET /flights/new?launch_event_id=...
  // ==========================================================================
  describe('Test 3: Event Duty Officer Autofill via GET /flights/new?launch_event_id=...', () => {
    it('pre-populates RSO and LCO form inputs from event query parameter and embeds option data attributes', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestSite({ name: 'Lake Tyrrell Range' })

      const event = await seedTestEvent(site.id, {
        name: 'Spring Equinox Launch 2026',
        startsOn: '2026-09-21',
        endsOn: '2026-09-23',
        rsoName: 'Range Safety Chief Alan',
        lcoName: 'Pad Controller Brenda',
      })

      // Request new flight form with launch_event_id query param
      const res = await fetchGet(`/flights/new?launch_event_id=${event.id}`, {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Form inputs must exist
      assertHasFormField(html, 'rso_name')
      assertHasFormField(html, 'lco_name')
      assertHasFormField(html, 'launch_event_id')

      // Inputs must be pre-populated with event officers
      expect(html).toMatch(/name=["']rso_name["'][^>]*value=["']Range Safety Chief Alan["']/i)
      expect(html).toMatch(/name=["']lco_name["'][^>]*value=["']Pad Controller Brenda["']/i)

      // Event option must be selected and carry data attributes for client-side dropdown change
      expect(html).toContain(`value="${event.id}"`)
      expect(html).toContain('data-rso="Range Safety Chief Alan"')
      expect(html).toContain('data-lco="Pad Controller Brenda"')

      // Client-side script for dynamic autofill must be present
      expect(html).toContain('initEventDutyOfficerAutofill')
    })

    it('renders clean blank duty officer fields when no launch_event_id query parameter is provided', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/flights/new', {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertHasFormField(html, 'rso_name')
      assertHasFormField(html, 'lco_name')
      // No pre-filled names when no event selected
      expect(html).not.toMatch(/name=["']rso_name["'][^>]*value=["'][^"']+["']/i)
    })
  })

  // ==========================================================================
  // Test 4: Duty Officer Manual Override
  // ==========================================================================
  describe('Test 4: Duty Officer Manual Override', () => {
    it('persists manual duty officer overrides to D1 instead of default event officers', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      // Event has morning duty officers
      const event = await seedTestEvent(site.id, {
        name: 'South Australian Regional Meet',
        rsoName: 'Morning RSO Dave',
        lcoName: 'Morning LCO Emma',
      })

      // Flyer submits flight with launch_event_id but specifies afternoon shift rotation officers
      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          launch_event_id: event.id,
          altitude_agl_m: 640.0,
          rso_name: 'Afternoon RSO Sarah', // Manual override
          lco_name: 'Afternoon LCO Frank', // Manual override
          pad_number: 'Pad 2',
          outcome: 'GOOD',
        },
        {
          Cookie: `triplet_session=${token}`,
        },
      )

      expect([200, 302, 303]).toContain(res.status)

      // Direct D1 query assertion
      const db = getDb()
      const [savedFlight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(savedFlight).toBeDefined()
      expect(savedFlight.launchEventId).toBe(event.id)
      expect(savedFlight.rsoName).toBe('Afternoon RSO Sarah')
      expect(savedFlight.lcoName).toBe('Afternoon LCO Frank')
      expect(savedFlight.rsoName).not.toBe('Morning RSO Dave')
      expect(savedFlight.lcoName).not.toBe('Morning LCO Emma')

      // Detail view assertion
      const detailRes = await fetchGet(`/flights/${savedFlight.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      const detailHtml = await detailRes.text()

      assertContains(detailHtml, 'Afternoon RSO Sarah', 'Afternoon LCO Frank')
      assertNotContains(detailHtml, 'Morning RSO Dave', 'Morning LCO Emma')
    })
  })

  // ==========================================================================
  // Test 5: Flight Editing (GET/POST /flights/:id/edit)
  // ==========================================================================
  describe('Test 5: Flight Editing (GET/POST /flights/:id/edit)', () => {
    it('pre-populates all 12 flight card fields on GET /flights/:id/edit', async () => {
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
        flightNumber: 1,
        altitudeAglM: 450.0,
        isFirstFlight: true,
        certAttempt: 'mpr',
        buildType: 'kit',
        stabilityCheckMethod: 'Swing Test',
        stabilityMargin: 1.5,
        motorType: 'Black Powder',
        totalWeightG: 320.0,
        recoverySystem: 'Streamer',
        recoverySize: '2" x 30"',
        deploymentMethod: 'Motor eject',
        mainDeployAltitude: 'Apogee',
        padNumber: 'Pad 1',
        rsoName: 'Officer Bob',
        lcoName: 'Officer Alice',
      })

      const res = await fetchGet(`/flights/${flight.id}/edit`, {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Assert form input presence and pre-filled values
      expect(html).toContain('name="is_first_flight"')
      expect(html).toMatch(/name=["']is_first_flight["'][^>]*checked/i)
      expect(html).toContain('value="mpr"')
      expect(html).toContain('value="kit"')
      expect(html).toMatch(/name=["']stability_check_method["'][^>]*value=["']Swing Test["']/i)
      expect(html).toMatch(/name=["']stability_margin["'][^>]*value=["']1\.50?["']/i)
      expect(html).toMatch(/<option[^>]*value=["']Black Powder["'][^>]*selected/i)
      expect(html).toMatch(/name=["']total_weight_g["'][^>]*value=["']320(\.0)?["']/i)
      expect(html).toContain('value="Streamer"')
      expect(html).toMatch(/name=["']recovery_size["'][^>]*value=["']2(&quot;|")\s*x\s*30(&quot;|")["']/i)
      expect(html).toContain('value="Motor eject"')
      expect(html).toMatch(/name=["']main_deploy_altitude["'][^>]*value=["']Apogee["']/i)
      expect(html).toMatch(/name=["']pad_number["'][^>]*value=["']Pad 1["']/i)
      expect(html).toMatch(/name=["']rso_name["'][^>]*value=["']Officer Bob["']/i)
      expect(html).toMatch(/name=["']lco_name["'][^>]*value=["']Officer Alice["']/i)
    })

    it('updates modified flight card fields via POST /flights/:id/edit and persists changes to D1', async () => {
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
        isFirstFlight: true,
        certAttempt: 'none',
        buildType: 'kit',
        totalWeightG: 500.0,
        padNumber: 'Pad 1',
      })

      // Flyer upgrades flight to L1 certification flight and changes pad
      const res = await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          is_first_flight: 'false',
          cert_attempt: 'l1',
          build_type: 'modified',
          stability_check_method: 'Rocksim',
          stability_margin: 1.85,
          motor_type: 'Composite',
          total_weight_g: 580.0,
          recovery_system: 'Chute(s)',
          recovery_size: '24"',
          deployment_method: 'Chute Release',
          main_deploy_altitude: '300 ft',
          pad_number: 'Pad 4',
          outcome: 'GOOD',
        },
        {
          Cookie: `triplet_session=${token}`,
        },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [updatedFlight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flight.id))

      expect(updatedFlight).toBeDefined()
      expect(Boolean(updatedFlight.isFirstFlight)).toBe(false)
      expect(updatedFlight.certAttempt).toBe('l1')
      expect(updatedFlight.buildType).toBe('modified')
      expect(updatedFlight.stabilityCheckMethod).toBe('Rocksim')
      expect(updatedFlight.stabilityMargin).toBeCloseTo(1.85)
      expect(updatedFlight.motorType).toBe('Composite')
      expect(updatedFlight.totalWeightG).toBeCloseTo(580.0)
      expect(updatedFlight.recoverySystem).toBe('Chute(s)')
      expect(updatedFlight.recoverySize).toBe('24"')
      expect(updatedFlight.deploymentMethod).toBe('Chute Release')
      expect(updatedFlight.mainDeployAltitude).toBe('300 ft')
      expect(updatedFlight.padNumber).toBe('Pad 4')
      expect(updatedFlight.outcome).toBe('GOOD')
    })

    it('preserves existing flight card fields during partial edits (e.g. updating notes only)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        isFirstFlight: true,
        certAttempt: 'l2',
        buildType: 'scratch_built',
        stabilityMargin: 2.2,
        padNumber: 'Pad Away 1',
        totalWeightG: 2200.0,
        notes: 'Initial flight notes',
      })

      // Submit partial update modifying notes only
      const res = await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          notes: 'Updated flight notes with post-recovery observations',
        },
        {
          Cookie: `triplet_session=${token}`,
        },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [persistedFlight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flight.id))

      expect(persistedFlight.notes).toBe('Updated flight notes with post-recovery observations')
      // Untouched flight card fields must remain intact
      expect(Boolean(persistedFlight.isFirstFlight)).toBe(true)
      expect(persistedFlight.certAttempt).toBe('l2')
      expect(persistedFlight.buildType).toBe('scratch_built')
      expect(persistedFlight.stabilityMargin).toBeCloseTo(2.2)
      expect(persistedFlight.padNumber).toBe('Pad Away 1')
      expect(persistedFlight.totalWeightG).toBeCloseTo(2200.0)
    })
  })

  // ==========================================================================
  // Test 6: Display Assertions: Maiden Badge, Cert Attempt Badge, Pad, Recovery
  // ==========================================================================
  describe('Test 6: Display Assertions: Maiden Badge, Cert Attempt Badge, Pad Designation, Recovery Specs', () => {
    it('renders maiden flight badge, cert attempt badge, pad designation, and recovery specs on flight detail view', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id, { name: 'AeroTech Mirage' })
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.8 })
      const motor = await seedTestMotor({ manufacturer: 'Cesaroni', model: 'H120' })
      const site = await seedTestSite({ name: 'Coober Pedy Launch Site' })

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        flightNumber: 1,
        isFirstFlight: true,
        certAttempt: 'l1',
        buildType: 'scratch_built',
        stabilityCheckMethod: 'OpenRocket 23.09',
        stabilityMargin: 1.85,
        motorType: 'Composite',
        totalWeightG: 1320.0,
        recoverySystem: 'Chute(s)',
        recoverySize: '36"',
        deploymentMethod: 'Electronic deploy',
        mainDeployAltitude: '450 ft',
        padNumber: 'Pad Alpha 1',
        outcome: 'GOOD',
        rsoName: 'Chief Inspector Lee',
        lcoName: 'Pad Director Pat',
      })

      const res = await fetchGet(`/flights/${flight.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // 1. Header Badges
      assertContains(html, 'Maiden', 'L1 Cert Attempt')

      // 2. Pad & Outcome
      assertContains(html, 'Pad Alpha 1', 'GOOD')

      // 3. Vehicle & Aerodynamics
      assertContains(
        html,
        'Scratch Built',
        '1320g',
        'OpenRocket 23.09',
        '1.85 cal',
      )

      // 4. Recovery Specifications
      assertContains(
        html,
        'Chute(s)',
        'Electronic deploy',
        '450 ft',
      )
      expect(html).toMatch(/36(&quot;|")/i)

      // 5. Duty Officers
      assertContains(html, 'Chief Inspector Lee', 'Pad Director Pat')
    })

    it('omits maiden voyage and cert badges when flight is a standard non-maiden sport flight', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)

      const standardFlight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        flightNumber: 5,
        isFirstFlight: false,
        certAttempt: 'none',
        padNumber: null,
        outcome: 'successful',
      })

      const res = await fetchGet(`/flights/${standardFlight.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Must NOT contain badges
      assertNotContains(html, '✨ Maiden', 'Cert Attempt')
      // Pad unassigned placeholder
      assertContains(html, 'Launch Pad Designation', '—')
    })

    it('renders maiden badge, cert attempt badge, pad designation, and outcome badge in logbook list view', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id, { name: 'Pioneer 1' })
      const config = await seedTestConfig(rocket.id)

      await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        flightNumber: 1,
        isFirstFlight: true,
        certAttempt: 'l1',
        padNumber: 'Pad B2',
        outcome: 'GOOD',
      })

      const res = await fetchGet('/flights', {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // List view row assertions
      assertContains(html, 'Maiden', 'L1', 'Pad B2', 'GOOD')
    })
  })
})
