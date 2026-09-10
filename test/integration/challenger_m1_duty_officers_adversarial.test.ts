/**
 * Adversarial Verification Test Suite: Range Operations & Duty Officer Workflows (Milestone 1)
 *
 * Authored by: M1 Range Ops Challenger (m1_challenger_2)
 * Scope:
 * 1. Duty officer autofill stress-testing:
 *    - Missing/empty/null event officers (clean empty inputs, no "null" or "undefined" leaks)
 *    - Events with special characters, quotes, ampersands, angle brackets, emojis in names and duty officers
 *    - Non-existent, malformed, and adversarial query params (?launch_event_id=...)
 * 2. Mid-day duty officer rotation workflows:
 *    - Form loading with default event officers
 *    - Multi-flight shift rotation: flight 1 with defaults, flight 2 with manual overrides
 *    - D1 persistence of overrides without cross-flight contamination
 *    - Subsequent GET requests (flight detail view and edit view) displaying overrides
 *    - Afternoon rotation update via POST /flights/:id/edit
 *    - Event record duty officer immutability (event remains unaffected by flight-level rotations)
 * 3. Soft-gate warning re-renders (HTTP 422 Unprocessable Entity):
 *    - Triggering multiple soft-gate safety warnings (cert level, stability margin, waiver ceiling)
 *    - Verification of HTTP 422 response
 *    - Full 12-field flight card inputs and duty officer state preservation without data loss
 *    - Subsequent authorized submission with proceeded_despite_warnings flag persisted to D1
 */

import { and, eq } from 'drizzle-orm'
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

describe('M1 Range Ops Challenger: Adversarial Duty Officers & Range Logging', () => {
  // ==========================================================================
  // 1. DUTY OFFICER AUTOFILL STRESS-TESTING
  // ==========================================================================
  describe('1. Duty Officer Autofill Stress-Testing', () => {
    it('1.1: Event with null or empty duty officers produces clean blank inputs without "null" or "undefined" leaks', async () => {
      const flyer = await seedTestUser({ displayName: 'Range Ops Pilot' })
      const token = await signSession(flyer.id)
      const site = await seedTestSite({ name: 'Coober Pedy Desert Range' })

      // Event with explicit null duty officers
      const nullEvent = await seedTestEvent(site.id, {
        name: 'Desert Open Fly 2026',
        startsOn: '2026-10-01',
        endsOn: '2026-10-02',
        rsoName: null,
        lcoName: null,
      })

      const resNull = await fetchGet(`/flights/new?launch_event_id=${nullEvent.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(resNull, 200)
      const htmlNull = await resNull.text()

      // Form inputs must be present
      assertHasFormField(htmlNull, 'rso_name')
      assertHasFormField(htmlNull, 'lco_name')

      // Must NOT leak stringified "null" or "undefined"
      expect(htmlNull).not.toMatch(/name=["']rso_name["'][^>]*value=["']null["']/i)
      expect(htmlNull).not.toMatch(/name=["']lco_name["'][^>]*value=["']null["']/i)
      expect(htmlNull).not.toMatch(/name=["']rso_name["'][^>]*value=["']undefined["']/i)
      expect(htmlNull).not.toMatch(/name=["']lco_name["'][^>]*value=["']undefined["']/i)

      // Value attribute should be empty: value=""
      expect(htmlNull).toMatch(/name=["']rso_name["'][^>]*value=["']["']/i)
      expect(htmlNull).toMatch(/name=["']lco_name["'][^>]*value=["']["']/i)

      // Event option data attributes must be clean empty strings
      expect(htmlNull).toContain(`value="${nullEvent.id}"`)
      expect(htmlNull).toContain('data-rso=""')
      expect(htmlNull).toContain('data-lco=""')

      // Asymmetric duty officers: RSO set, LCO null
      const asymmetricEvent = await seedTestEvent(site.id, {
        name: 'Solo Safety Officer Meet',
        startsOn: '2026-10-05',
        rsoName: 'Solitary Safety Chief',
        lcoName: null,
      })

      const resAsym = await fetchGet(`/flights/new?launch_event_id=${asymmetricEvent.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(resAsym, 200)
      const htmlAsym = await resAsym.text()

      expect(htmlAsym).toMatch(/name=["']rso_name["'][^>]*value=["']Solitary Safety Chief["']/i)
      expect(htmlAsym).toMatch(/name=["']lco_name["'][^>]*value=["']["']/i)
      expect(htmlAsym).not.toMatch(/name=["']lco_name["'][^>]*value=["']null["']/i)
      expect(htmlAsym).toContain('data-rso="Solitary Safety Chief"')
      expect(htmlAsym).toContain('data-lco=""')
    })

    it('1.2: Event and duty officers with special characters, quotes, angle brackets, and emojis are safely escaped without syntax corruption', async () => {
      const flyer = await seedTestUser({ displayName: 'Adversarial Pilot' })
      const token = await signSession(flyer.id)
      const site = await seedTestSite({ name: 'Red Dust Launch Field' })

      const complexEventName = 'Launch & "Blastoff" <2026> \'Adelaide\' 🚀'
      const complexRso = 'Dr. O\'Connor & "Safety" <Officer>'
      const complexLco = 'Pad-Controller #1 (Alpha & Omega) <LCO>'

      const event = await seedTestEvent(site.id, {
        name: complexEventName,
        rsoName: complexRso,
        lcoName: complexLco,
      })

      const res = await fetchGet(`/flights/new?launch_event_id=${event.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Ensure form inputs exist and values are HTML-entity encoded (no raw < or unescaped unclosed quotes)
      assertHasFormField(html, 'rso_name')
      assertHasFormField(html, 'lco_name')

      // RSO input must contain encoded entities or properly escaped representation
      expect(html).toMatch(/name=["']rso_name["'][^>]*value=["']Dr\.\s*O(&#39;|')Connor\s*&amp;\s*(&quot;|")Safety(&quot;|")\s*&lt;Officer&gt;["']/i)
      // LCO input must contain encoded entities
      expect(html).toMatch(/name=["']lco_name["'][^>]*value=["']Pad-Controller\s*#1\s*\(Alpha\s*&amp;\s*Omega\)\s*&lt;LCO&gt;["']/i)

      // Raw unescaped dangerous tags must NOT be present
      expect(html).not.toContain('<Officer>')
      expect(html).not.toContain('<LCO>')

      // Event option data attributes must be escaped
      expect(html).toContain(`value="${event.id}"`)
      expect(html).toMatch(/data-rso=["']Dr\.\s*O(&#39;|')Connor\s*&amp;\s*(&quot;|")Safety(&quot;|")\s*&lt;Officer&gt;["']/i)
    })

    it('1.3: Non-existent, malformed, and adversarial query params return HTTP 200 with clean fallback defaults', async () => {
      const flyer = await seedTestUser({ displayName: 'Resilience Pilot' })
      const token = await signSession(flyer.id)

      const adversarialQueryParams = [
        'ffffffff-ffff-ffff-ffff-ffffffffffff', // Non-existent UUID
        'not-a-valid-uuid-12345',               // Arbitrary string
        "' OR '1'='1",                          // SQL injection attempt
        '<script>alert(1)</script>',            // XSS probe
        '../../etc/passwd',                     // Path traversal attempt
      ]

      for (const badId of adversarialQueryParams) {
        const encodedParam = encodeURIComponent(badId)
        const res = await fetchGet(`/flights/new?launch_event_id=${encodedParam}`, {
          Cookie: `triplet_session=${token}`,
        })

        // Must NOT crash or return 500
        assertHtmlResponse(res, 200)
        const html = await res.text()

        // Duty officer inputs must remain clean and empty
        assertHasFormField(html, 'rso_name')
        assertHasFormField(html, 'lco_name')
        expect(html).toMatch(/name=["']rso_name["'][^>]*value=["']["']/i)
        expect(html).toMatch(/name=["']lco_name["'][^>]*value=["']["']/i)
        expect(html).not.toContain(badId) // Malicious string must not be injected raw into HTML
      }
    })
  })

  // ==========================================================================
  // 2. MID-DAY DUTY OFFICER ROTATION WORKFLOWS
  // ==========================================================================
  describe('2. Mid-Day Duty Officer Rotation Workflows', () => {
    it('2.1: Multi-stage duty officer rotation preserves overrides across creation, detail display, and edit cycles without cross-flight contamination', async () => {
      const flyer = await seedTestUser({ displayName: 'Competition Flyer' })
      await seedTestCert(flyer.id, { level: 2, certifyingBody: 'TRA' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id, { name: 'Titan IV' })
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 2.2 })
      const motor = await seedTestMotor({ manufacturer: 'AeroTech', model: 'J350W', impulseClass: 'J' })
      const site = await seedTestSite({ name: 'Whalers Way Launch Complex' })

      // Meet with Morning Shift duty officers
      const event = await seedTestEvent(site.id, {
        name: 'South Australian State Championships',
        rsoName: 'Morning RSO Sarah Connor',
        lcoName: 'Morning LCO Kyle Reese',
      })

      // ----------------------------------------------------------------------
      // Step A: Morning Flight 1 created using event defaults
      // ----------------------------------------------------------------------
      const formLoadRes = await fetchGet(`/flights/new?launch_event_id=${event.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(formLoadRes, 200)
      const formLoadHtml = await formLoadRes.text()
      expect(formLoadHtml).toMatch(/name=["']rso_name["'][^>]*value=["']Morning RSO Sarah Connor["']/i)
      expect(formLoadHtml).toMatch(/name=["']lco_name["'][^>]*value=["']Morning LCO Kyle Reese["']/i)

      const flight1Res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          launch_event_id: event.id,
          log_type: 'actual',
          altitude_agl_m: 1100.0,
          flight_number: 1,
          outcome: 'GOOD',
          pad_number: 'Pad 1',
          rso_name: 'Morning RSO Sarah Connor',
          lco_name: 'Morning LCO Kyle Reese',
          proceeded_despite_warnings: 'true',
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect([200, 302, 303]).toContain(flight1Res.status)

      const db = getDb()
      const [savedFlight1] = await db
        .select()
        .from(schema.flights)
        .where(
          and(
            eq(schema.flights.flyerId, flyer.id),
            eq(schema.flights.flightNumber, 1),
          ),
        )
      expect(savedFlight1).toBeDefined()
      expect(savedFlight1.rsoName).toBe('Morning RSO Sarah Connor')
      expect(savedFlight1.lcoName).toBe('Morning LCO Kyle Reese')

      // Verify Flight 1 detail view renders Morning Shift officers
      const detail1Res = await fetchGet(`/flights/${savedFlight1.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(detail1Res, 200)
      const detail1Html = await detail1Res.text()
      assertContains(detail1Html, 'Morning RSO Sarah Connor', 'Morning LCO Kyle Reese')

      // ----------------------------------------------------------------------
      // Step B: Mid-Day Flight 2 created with Shift Rotation Manual Overrides
      // ----------------------------------------------------------------------
      const flight2Res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          launch_event_id: event.id,
          log_type: 'actual',
          altitude_agl_m: 1250.0,
          flight_number: 2,
          outcome: 'GOOD',
          pad_number: 'Pad 3',
          // Mid-day rotation overrides
          rso_name: 'Midday RSO Marcus Wright',
          lco_name: 'Midday LCO Blair Williams',
          proceeded_despite_warnings: 'true',
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect([200, 302, 303]).toContain(flight2Res.status)

      const [savedFlight2] = await db
        .select()
        .from(schema.flights)
        .where(
          and(
            eq(schema.flights.flyerId, flyer.id),
            eq(schema.flights.flightNumber, 2),
          ),
        )
      expect(savedFlight2).toBeDefined()
      expect(savedFlight2.rsoName).toBe('Midday RSO Marcus Wright')
      expect(savedFlight2.lcoName).toBe('Midday LCO Blair Williams')

      // Assert Flight 1 was NOT contaminated by Flight 2's rotation override
      const [recheckedFlight1] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, savedFlight1.id))
      expect(recheckedFlight1.rsoName).toBe('Morning RSO Sarah Connor')
      expect(recheckedFlight1.lcoName).toBe('Morning LCO Kyle Reese')

      // Verify Flight 2 detail view displays Midday officers and NOT Morning officers
      const detail2Res = await fetchGet(`/flights/${savedFlight2.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(detail2Res, 200)
      const detail2Html = await detail2Res.text()
      assertContains(detail2Html, 'Midday RSO Marcus Wright', 'Midday LCO Blair Williams')
      assertNotContains(detail2Html, 'Morning RSO Sarah Connor', 'Morning LCO Kyle Reese')

      // ----------------------------------------------------------------------
      // Step C: Edit Flight 2 to reflect Late Afternoon Shift Rotation
      // ----------------------------------------------------------------------
      const editGetRes = await fetchGet(`/flights/${savedFlight2.id}/edit`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(editGetRes, 200)
      const editGetHtml = await editGetRes.text()
      expect(editGetHtml).toMatch(/name=["']rso_name["'][^>]*value=["']Midday RSO Marcus Wright["']/i)
      expect(editGetHtml).toMatch(/name=["']lco_name["'][^>]*value=["']Midday LCO Blair Williams["']/i)

      // Post update with late afternoon duty officers
      const editPostRes = await fetchPostForm(
        `/flights/${savedFlight2.id}/edit`,
        {
          rso_name: 'Evening RSO Elena Rodriguez',
          lco_name: 'Evening LCO Zach Thorne',
          pad_number: 'Pad 3 (Shift 3)',
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect([200, 302, 303]).toContain(editPostRes.status)

      // Verify updated record in D1
      const [updatedFlight2] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, savedFlight2.id))
      expect(updatedFlight2.rsoName).toBe('Evening RSO Elena Rodriguez')
      expect(updatedFlight2.lcoName).toBe('Evening LCO Zach Thorne')
      expect(updatedFlight2.padNumber).toBe('Pad 3 (Shift 3)')

      // Verify Flight 2 detail view reflects the evening rotation
      const finalDetailRes = await fetchGet(`/flights/${savedFlight2.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(finalDetailRes, 200)
      const finalDetailHtml = await finalDetailRes.text()
      assertContains(finalDetailHtml, 'Evening RSO Elena Rodriguez', 'Evening LCO Zach Thorne')
      assertNotContains(finalDetailHtml, 'Midday RSO Marcus Wright', 'Midday LCO Blair Williams')

      // ----------------------------------------------------------------------
      // Step D: Verify Launch Event designated officers remain strictly immutable
      // ----------------------------------------------------------------------
      const [checkedEvent] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, event.id))
      expect(checkedEvent.rsoName).toBe('Morning RSO Sarah Connor')
      expect(checkedEvent.lcoName).toBe('Morning LCO Kyle Reese')
    })
  })

  // ==========================================================================
  // 3. SOFT-GATE WARNING RE-RENDERS (HTTP 422) & DATA PRESERVATION
  // ==========================================================================
  describe('3. Soft-Gate Warning Re-renders (HTTP 422) & Form State Preservation', () => {
    it('3.1: All 12 flight card inputs and rotating duty officers are 100% preserved without data loss on HTTP 422 re-render', async () => {
      // Pilot with cert level 0
      const flyer = await seedTestUser({ displayName: 'Uncertified Junior Pilot' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id, { name: 'Adversarial Explorer' })
      // Rocket config with stabilityCalibers = 0.85 (triggers stability warning < 1.0 caliber)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 0.85 })
      // High-power H motor (requires Level 1 cert, flyer has 0 -> triggers cert warning)
      const motor = await seedTestMotor({ manufacturer: 'AeroTech', model: 'H165R', impulseClass: 'H' })
      // Site with maxAltitudeAglM = 600m (flight altitude 950m -> triggers airspace ceiling warning)
      const site = await seedTestSite({ name: 'Restricted Airspace Field', maxAltitudeAglM: 600 })
      const event = await seedTestEvent(site.id, { name: 'Safety Review Launch Meet' })

      // Complete 12 flight card payload + duty officers + telemetry
      const submissionPayload = {
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        launch_event_id: event.id,
        log_type: 'actual',
        altitude_agl_m: 950.0,
        outcome: 'GOOD',
        // The 12 Flight Card Fields
        is_first_flight: 'true',
        cert_attempt: 'l1',
        build_type: 'scratch_built',
        stability_check_method: 'OpenRocket v23.09 Sim',
        stability_margin: 0.85,
        motor_type: 'Composite',
        total_weight_g: 1650.25,
        recovery_system: 'Chute(s)',
        recovery_size: '48"',
        deployment_method: 'Electronic deploy',
        main_deploy_altitude: '450 ft',
        pad_number: 'Pad C1',
        // Duty Officers
        rso_name: 'Chief Inspector Gordon',
        lco_name: 'Range Controller Sarah',
        // Additional telemetry & notes
        max_velocity_mps: 195.4,
        max_accel_g: 15.8,
        wind_mps: 4.5,
        temperature_c: 28.0,
        notes: 'Adversarial soft-gate test verifying zero data loss on 422 re-renders',
        // Explicitly omit proceeded_despite_warnings to trigger 422
      }

      // POST to /flights without warning acknowledgment
      const res = await fetchPostForm('/flights', submissionPayload, {
        Cookie: `triplet_session=${token}`,
      })

      // Must return HTTP 422 Unprocessable Entity
      expect(res.status).toBe(422)
      const html = await res.text()

      // 1. Verify Warning Banner and Warnings are rendered
      expect(html).toContain('Preflight Safety Warning')
      expect(html).toContain('Soft Gate Override Required')
      // Rule 1 warning: Motor impulse H requires Level 1, flyer has 0
      expect(html).toContain('Motor impulse class H requires Level 1 certification, but flyer has Level 0.')
      // Rule 2 warning: Stability margin 0.85 below 1.0 caliber threshold
      expect(html).toContain('Stability margin of 0.85 calibers is below the 1.0 caliber safety threshold.')
      // Rule 3 warning: Expected altitude 950m exceeds site waiver ceiling 600m
      expect(html).toContain('Expected altitude (950m) exceeds the site waiver ceiling (600m).')

      // Acknowledgment checkbox must be present in the re-rendered form
      assertHasFormField(html, 'proceeded_despite_warnings')

      // 2. Empirically verify ALL 12 Flight Card Fields are preserved in the re-rendered HTML:
      // Field 1: is_first_flight (checked)
      expect(html).toMatch(/name=["']is_first_flight["'][^>]*checked/i)

      // Field 2: cert_attempt (l1 selected)
      expect(html).toMatch(/<option[^>]*value=["']l1["'][^>]*selected/i)

      // Field 3: build_type (scratch_built selected)
      expect(html).toMatch(/<option[^>]*value=["']scratch_built["'][^>]*selected/i)

      // Field 4: stability_check_method
      expect(html).toMatch(/name=["']stability_check_method["'][^>]*value=["']OpenRocket v23\.09 Sim["']/i)

      // Field 5: stability_margin
      expect(html).toMatch(/name=["']stability_margin["'][^>]*value=["']0\.85["']/i)

      // Field 6: motor_type (Composite selected)
      expect(html).toMatch(/<option[^>]*value=["']Composite["'][^>]*selected/i)

      // Field 7: total_weight_g
      expect(html).toMatch(/name=["']total_weight_g["'][^>]*value=["']1650\.25["']/i)

      // Field 8: recovery_system (Chute(s) selected)
      expect(html).toMatch(/<option[^>]*value=["']Chute\(s\)["'][^>]*selected/i)

      // Field 9: recovery_size (escaped quote 48" or 48&quot;)
      expect(html).toMatch(/name=["']recovery_size["'][^>]*value=["']48(&quot;|")["']/i)

      // Field 10: deployment_method (Electronic deploy selected)
      expect(html).toMatch(/<option[^>]*value=["']Electronic deploy["'][^>]*selected/i)

      // Field 11: main_deploy_altitude
      expect(html).toMatch(/name=["']main_deploy_altitude["'][^>]*value=["']450 ft["']/i)

      // Field 12: pad_number
      expect(html).toMatch(/name=["']pad_number["'][^>]*value=["']Pad C1["']/i)

      // 3. Empirically verify Duty Officer inputs are preserved:
      expect(html).toMatch(/name=["']rso_name["'][^>]*value=["']Chief Inspector Gordon["']/i)
      expect(html).toMatch(/name=["']lco_name["'][^>]*value=["']Range Controller Sarah["']/i)

      // 4. Empirically verify Telemetry, Notes, and Entity Selectors are preserved:
      expect(html).toMatch(/name=["']altitude_agl_m["'][^>]*value=["']950(\.0)?["']/i)
      expect(html).toMatch(/name=["']max_velocity_mps["'][^>]*value=["']195\.4["']/i)
      expect(html).toMatch(/name=["']max_accel_g["'][^>]*value=["']15\.8["']/i)
      expect(html).toMatch(/name=["']wind_mps["'][^>]*value=["']4\.5["']/i)
      expect(html).toMatch(/name=["']temperature_c["'][^>]*value=["']28(\.0)?["']/i)
      expect(html).toContain('Adversarial soft-gate test verifying zero data loss on 422 re-renders')
      expect(html).toMatch(/<option[^>]*value=["']GOOD["'][^>]*selected/i)
      expect(html).toMatch(/<option[^>]*value=["']actual["'][^>]*selected/i)
      expect(html).toMatch(new RegExp(`<option[^>]*value=["']${config.id}["'][^>]*selected`, 'i'))
      expect(html).toMatch(new RegExp(`<option[^>]*value=["']${motor.id}["'][^>]*selected`, 'i'))
      expect(html).toMatch(new RegExp(`<option[^>]*value=["']${site.id}["'][^>]*selected`, 'i'))
      expect(html).toMatch(new RegExp(`<option[^>]*value=["']${event.id}["'][^>]*selected`, 'i'))

      // 5. Subsequent Submission with Authorization Flag:
      // Now resubmit with proceeded_despite_warnings = 'true'
      const authorizedRes = await fetchPostForm(
        '/flights',
        {
          ...submissionPayload,
          proceeded_despite_warnings: 'true',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([200, 302, 303]).toContain(authorizedRes.status)

      // Query D1 directly and assert full 12-field persistence + duty officers + warning authorization
      const db = getDb()
      const [persistedFlight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(persistedFlight).toBeDefined()
      expect(Boolean(persistedFlight.isFirstFlight)).toBe(true)
      expect(persistedFlight.certAttempt).toBe('l1')
      expect(persistedFlight.buildType).toBe('scratch_built')
      expect(persistedFlight.stabilityCheckMethod).toBe('OpenRocket v23.09 Sim')
      expect(persistedFlight.stabilityMargin).toBeCloseTo(0.85)
      expect(persistedFlight.motorType).toBe('Composite')
      expect(persistedFlight.totalWeightG).toBeCloseTo(1650.25)
      expect(persistedFlight.recoverySystem).toBe('Chute(s)')
      expect(persistedFlight.recoverySize).toBe('48"')
      expect(persistedFlight.deploymentMethod).toBe('Electronic deploy')
      expect(persistedFlight.mainDeployAltitude).toBe('450 ft')
      expect(persistedFlight.padNumber).toBe('Pad C1')
      expect(persistedFlight.rsoName).toBe('Chief Inspector Gordon')
      expect(persistedFlight.lcoName).toBe('Range Controller Sarah')
      expect(Boolean(persistedFlight.proceededDespiteWarnings)).toBe(true)
    })

    it('3.2: Re-rendered form correctly preserves non-maiden voyage (is_first_flight unchecked) and cert_attempt="none"', async () => {
      const flyer = await seedTestUser({ displayName: 'Senior Sport Flyer' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 0.7 }) // Warning: stability < 1.0
      const motor = await seedTestMotor({ impulseClass: 'D' })
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: 250,
          outcome: 'GOOD',
          // Non-maiden flight (omit is_first_flight or false)
          cert_attempt: 'none',
          build_type: 'kit',
          stability_margin: 0.7,
          total_weight_g: 120,
          pad_number: 'Pad 2',
          rso_name: 'Officer Davis',
          lco_name: 'Officer Clark',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect(res.status).toBe(422)
      const html = await res.text()

      // is_first_flight must NOT be checked
      expect(html).not.toMatch(/name=["']is_first_flight["'][^>]*checked/i)

      // cert_attempt="none" must be selected
      expect(html).toMatch(/<option[^>]*value=["']none["'][^>]*selected/i)

      // Duty officers and other fields must be preserved
      expect(html).toMatch(/name=["']rso_name["'][^>]*value=["']Officer Davis["']/i)
      expect(html).toMatch(/name=["']lco_name["'][^>]*value=["']Officer Clark["']/i)
      expect(html).toMatch(/name=["']pad_number["'][^>]*value=["']Pad 2["']/i)
    })
  })
})
