/**
 * Milestone 3 Challenger 2 Adversarial Verification Test Suite:
 * Flight-Level Duty Officers (RSO & LCO) Tracking, Rotation, and Display.
 *
 * Empirical verification of:
 * 1. Flight creation with all four presence permutations:
 *    - Neither RSO nor LCO
 *    - RSO only
 *    - LCO only
 *    - Both RSO and LCO
 * 2. Registered user IDs vs visiting plain text names (e.g. "Capt. Jack Smith"):
 *    - Registered member IDs linked via foreign key
 *    - Visiting plain text names without foreign key violations
 *    - Resilience against invalid / non-existent user IDs (sanitization to null)
 *    - Hybrid combination (registered RSO + visiting LCO)
 * 3. Multiple flights under the same launch event with rotating duty officers:
 *    - Each flight independently preserves its own RSO and LCO
 *    - Event record remains unaffected
 *    - Editing a flight's duty officers isolates changes without cross-flight contamination
 * 4. UI display verification in flightDetailView (GET /flights/:id):
 *    - Range Duty Officers sign-off bar
 *    - Card 5 ("Range Safety & Launch Duty Officers")
 *    - Distinction between assigned officers and unassigned states
 * 5. Adversarial robustness:
 *    - XSS injection prevention in duty officer names
 *    - Preservation of motor inventory on duty officer edits
 *    - Edit form pre-filling (GET /flights/:id/edit)
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../../src/db/schema'
import { signSession } from '../../src/services/auth'
import {
  getDb,
  seedTestCert,
  seedTestConfig,
  seedTestEvent,
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
  assertNotContains,
} from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'

beforeEach(truncateDb)

describe('M3 Challenger 2: Flight-Level Duty Officers & Rotation (Adversarial Verification)', () => {
  // =========================================================================
  // CATEGORY 1: Four Duty Officer Presence Combinations at Flight Creation
  // =========================================================================
  describe('Category 1: Duty Officer Presence Permutations (Neither, RSO-only, LCO-only, Both)', () => {
    it('1.1: Neither RSO nor LCO assigned — persists nulls and renders unassigned placeholders', async () => {
      const flyer = await seedTestUser({ displayName: 'Solo Pilot' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          flight_number: 101,
          altitude_agl_m: 450,
          outcome: 'successful',
          rso_name: '',
          lco_name: '',
          rso_user_id: '',
          lco_user_id: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)

      // Query D1 directly to verify database level persistence
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.flightNumber, 101))

      expect(saved).toBeDefined()
      expect(saved.rsoName).toBeNull()
      expect(saved.lcoName).toBeNull()
      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBeNull()

      // Inspect HTML rendered by flightDetailView
      const detailRes = await fetchGet(`/flights/${saved.id}`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(detailRes, 200)
      const html = await detailRes.text()

      // Card 5 & sign-off bar should indicate Unassigned state
      expect(html).toMatch(/Range Safety & Launch Duty Officers/i)
      expect(html).toMatch(/Unassigned \/ Open Range/i)
      expect(html).toMatch(/Unassigned \/ Self-Launch/i)
    })

    it('1.2: RSO only assigned (LCO unassigned) — persists RSO and leaves LCO unassigned', async () => {
      const flyer = await seedTestUser({ displayName: 'Certified Flyer' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          flight_number: 102,
          altitude_agl_m: 520,
          outcome: 'successful',
          rso_name: 'Range Safety Dan (TRA #4102)',
          lco_name: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.flightNumber, 102))

      expect(saved).toBeDefined()
      expect(saved.rsoName).toBe('Range Safety Dan (TRA #4102)')
      expect(saved.lcoName).toBeNull()
      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBeNull()

      const detailRes = await fetchGet(`/flights/${saved.id}`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(detailRes, 200)
      const html = await detailRes.text()

      expect(html).toContain('Range Safety Dan (TRA #4102)')
      expect(html).toMatch(/Unassigned \/ Self-Launch/i)
    })

    it('1.3: LCO only assigned (RSO unassigned) — persists LCO and leaves RSO unassigned', async () => {
      const flyer = await seedTestUser({ displayName: 'Pad Flyer' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          flight_number: 103,
          altitude_agl_m: 610,
          outcome: 'successful',
          rso_name: '',
          lco_name: 'Launch Controller Alice',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.flightNumber, 103))

      expect(saved).toBeDefined()
      expect(saved.rsoName).toBeNull()
      expect(saved.lcoName).toBe('Launch Controller Alice')
      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBeNull()

      const detailRes = await fetchGet(`/flights/${saved.id}`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(detailRes, 200)
      const html = await detailRes.text()

      expect(html).toContain('Launch Controller Alice')
      expect(html).toMatch(/Unassigned \/ Open Range/i)
    })

    it('1.4: Both RSO and LCO assigned — persists both duty officers independently', async () => {
      const flyer = await seedTestUser({ displayName: 'Dual Officer Flyer' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          flight_number: 104,
          altitude_agl_m: 780,
          outcome: 'successful',
          rso_name: 'Safety Chief Sarah',
          lco_name: 'Pad Controller Bob',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.flightNumber, 104))

      expect(saved).toBeDefined()
      expect(saved.rsoName).toBe('Safety Chief Sarah')
      expect(saved.lcoName).toBe('Pad Controller Bob')
      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBeNull()

      const detailRes = await fetchGet(`/flights/${saved.id}`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(detailRes, 200)
      const html = await detailRes.text()

      expect(html).toContain('Safety Chief Sarah')
      expect(html).toContain('Pad Controller Bob')
      expect(html).not.toMatch(/Unassigned \/ Open Range/i)
      expect(html).not.toMatch(/Unassigned \/ Self-Launch/i)
    })
  })

  // =========================================================================
  // CATEGORY 2: Registered User IDs vs Visiting Plain Text Names
  // =========================================================================
  describe('Category 2: Registered User IDs vs Visiting Plain Text Names vs Invalid IDs', () => {
    it('2.1: Flight creation with registered member IDs links foreign keys and auto-resolves names', async () => {
      const flyer = await seedTestUser({ displayName: 'Pilot Jane' })
      const token = await signSession(flyer.id)
      const rsoUser = await seedTestUser({ displayName: 'Dr. Evelyn Vance (RSO Member)' })
      const lcoUser = await seedTestUser({ displayName: 'Gordon Freeman (LCO Member)' })

      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          flight_number: 201,
          altitude_agl_m: 600,
          outcome: 'successful',
          rso_user_id: rsoUser.id,
          lco_user_id: lcoUser.id,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.flightNumber, 201))

      expect(saved.rsoUserId).toBe(rsoUser.id)
      expect(saved.lcoUserId).toBe(lcoUser.id)
      // Verify name autopopulation from registered user display name
      expect(saved.rsoName).toBe('Dr. Evelyn Vance (RSO Member)')
      expect(saved.lcoName).toBe('Gordon Freeman (LCO Member)')

      const detailRes = await fetchGet(`/flights/${saved.id}`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(detailRes, 200)
      const html = await detailRes.text()

      expect(html).toContain('Dr. Evelyn Vance (RSO Member)')
      expect(html).toContain('Gordon Freeman (LCO Member)')
    })

    it('2.2: Flight creation with visiting plain text names (non-registered) records text without FK constraint failure', async () => {
      const flyer = await seedTestUser({ displayName: 'Host Flyer' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite()

      const visitingRSO = 'Capt. Jack Smith (Guest Safety Officer)'
      const visitingLCO = 'Commander Keen (Visiting Prefect)'

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          flight_number: 202,
          altitude_agl_m: 650,
          outcome: 'successful',
          rso_name: visitingRSO,
          lco_name: visitingLCO,
          rso_user_id: '',
          lco_user_id: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.flightNumber, 202))

      expect(saved.rsoName).toBe(visitingRSO)
      expect(saved.lcoName).toBe(visitingLCO)
      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBeNull()

      const detailRes = await fetchGet(`/flights/${saved.id}`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(detailRes, 200)
      const html = await detailRes.text()

      expect(html).toContain(visitingRSO)
      expect(html).toContain(visitingLCO)
    })

    it('2.3: Non-existent / invalid UUID passed in rso_user_id is sanitized to null preventing D1 FK crash', async () => {
      const flyer = await seedTestUser({ displayName: 'Flyer Security Test' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite()

      // Submit an arbitrary non-existent UUID or malicious string as rso_user_id
      const bogusUserId = '00000000-dead-beef-0000-000000000000'

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          flight_number: 203,
          altitude_agl_m: 700,
          outcome: 'successful',
          rso_name: 'Visiting Non-Member Inspector',
          rso_user_id: bogusUserId,
          lco_user_id: 'arbitrary-malformed-string',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      // Must succeed without SQLite 500 error or FOREIGN KEY constraint failed crash
      expect([200, 201, 302, 303]).toContain(res.status)

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.flightNumber, 203))

      expect(saved).toBeDefined()
      // Bogus IDs must be sanitized to null
      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBeNull()
      // Plain text name should be preserved
      expect(saved.rsoName).toBe('Visiting Non-Member Inspector')
    })

    it('2.4: Hybrid assignment — registered RSO member paired with visiting non-member LCO', async () => {
      const flyer = await seedTestUser({ displayName: 'Hybrid Test Flyer' })
      const token = await signSession(flyer.id)
      const memberRSO = await seedTestUser({ displayName: 'Major Samantha Carter' })
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          flight_number: 204,
          altitude_agl_m: 710,
          outcome: 'successful',
          rso_user_id: memberRSO.id,
          rso_name: memberRSO.displayName,
          lco_name: 'Visiting Tech Jackson',
          lco_user_id: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.flightNumber, 204))

      expect(saved.rsoUserId).toBe(memberRSO.id)
      expect(saved.rsoName).toBe('Major Samantha Carter')
      expect(saved.lcoUserId).toBeNull()
      expect(saved.lcoName).toBe('Visiting Tech Jackson')

      const detailRes = await fetchGet(`/flights/${saved.id}`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(detailRes, 200)
      const html = await detailRes.text()

      expect(html).toContain('Major Samantha Carter')
      expect(html).toContain('Visiting Tech Jackson')
    })
  })

  // =========================================================================
  // CATEGORY 3: Rotation Independence Across Multiple Flights in Same Event
  // =========================================================================
  describe('Category 3: Duty Officer Rotation Independence Under Same Launch Event', () => {
    it('3.1: Multiple flights under the same launch event record distinct rotating duty officers independently', async () => {
      const flyer = await seedTestUser({ displayName: 'Event Competitor' })
      const token = await signSession(flyer.id)
      const site = await seedTestSite({ name: 'Coburn Regional Launch Field' })
      const event = await seedTestEvent(site.id, { name: 'Spring Equinox HPR Meet 2026' })

      const rocket = await seedTestRocket(flyer.id, { name: 'Vanguard Delta' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })

      // Officer Pool
      const officerAlice = await seedTestUser({ displayName: 'Officer Alice' })
      const officerBob = await seedTestUser({ displayName: 'Officer Bob' })
      const visitingCharlie = 'Charlie Visiting RSO'
      const visitingDave = 'Dave Visiting LCO'

      // Shift 1 (09:00): Flight 1 with RSO Alice & LCO Bob
      const res1 = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          launch_event_id: event.id,
          flight_number: 1,
          altitude_agl_m: 500,
          outcome: 'successful',
          rso_user_id: officerAlice.id,
          rso_name: officerAlice.displayName,
          lco_user_id: officerBob.id,
          lco_name: officerBob.displayName,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([200, 201, 302, 303]).toContain(res1.status)

      // Shift 2 (11:30): Flight 2 — Alice rotates off, Bob rotates to RSO, Charlie takes LCO
      const res2 = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          launch_event_id: event.id,
          flight_number: 2,
          altitude_agl_m: 650,
          outcome: 'successful',
          rso_user_id: officerBob.id,
          rso_name: officerBob.displayName,
          lco_name: visitingCharlie,
          lco_user_id: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([200, 201, 302, 303]).toContain(res2.status)

      // Shift 3 (14:00): Flight 3 — Charlie takes RSO, Dave takes LCO
      const res3 = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          launch_event_id: event.id,
          flight_number: 3,
          altitude_agl_m: 800,
          outcome: 'successful',
          rso_name: visitingCharlie,
          lco_name: visitingDave,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([200, 201, 302, 303]).toContain(res3.status)

      // Shift 4 (16:30): Flight 4 — Open pad session, neither duty officer logged
      const res4 = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          launch_event_id: event.id,
          flight_number: 4,
          altitude_agl_m: 350,
          outcome: 'successful',
          rso_name: '',
          lco_name: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([200, 201, 302, 303]).toContain(res4.status)

      // Verify all 4 flights directly in D1
      const db = getDb()
      const eventFlights = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.launchEventId, event.id))

      expect(eventFlights).toHaveLength(4)

      const f1 = eventFlights.find((f) => f.flightNumber === 1)!
      const f2 = eventFlights.find((f) => f.flightNumber === 2)!
      const f3 = eventFlights.find((f) => f.flightNumber === 3)!
      const f4 = eventFlights.find((f) => f.flightNumber === 4)!

      // Flight 1 Verification
      expect(f1.rsoName).toBe('Officer Alice')
      expect(f1.lcoName).toBe('Officer Bob')
      expect(f1.rsoUserId).toBe(officerAlice.id)
      expect(f1.lcoUserId).toBe(officerBob.id)

      // Flight 2 Verification (Bob as RSO, Charlie as LCO)
      expect(f2.rsoName).toBe('Officer Bob')
      expect(f2.lcoName).toBe(visitingCharlie)
      expect(f2.rsoUserId).toBe(officerBob.id)
      expect(f2.lcoUserId).toBeNull()

      // Flight 3 Verification (Charlie as RSO, Dave as LCO)
      expect(f3.rsoName).toBe(visitingCharlie)
      expect(f3.lcoName).toBe(visitingDave)
      expect(f3.rsoUserId).toBeNull()
      expect(f3.lcoUserId).toBeNull()

      // Flight 4 Verification (Neither)
      expect(f4.rsoName).toBeNull()
      expect(f4.lcoName).toBeNull()
      expect(f4.rsoUserId).toBeNull()
      expect(f4.lcoUserId).toBeNull()

      // Verify HTML Views: Each flight renders ONLY its own duty officers
      const htmlF1 = await (await fetchGet(`/flights/${f1.id}`, { Cookie: `triplet_session=${token}` })).text()
      expect(htmlF1).toContain('Officer Alice')
      expect(htmlF1).toContain('Officer Bob')
      expect(htmlF1).not.toContain(visitingDave)

      const htmlF2 = await (await fetchGet(`/flights/${f2.id}`, { Cookie: `triplet_session=${token}` })).text()
      expect(htmlF2).toContain('Officer Bob')
      expect(htmlF2).toContain(visitingCharlie)
      expect(htmlF2).not.toContain('Officer Alice')
      expect(htmlF2).not.toContain(visitingDave)

      const htmlF3 = await (await fetchGet(`/flights/${f3.id}`, { Cookie: `triplet_session=${token}` })).text()
      expect(htmlF3).toContain(visitingCharlie)
      expect(htmlF3).toContain(visitingDave)
      expect(htmlF3).not.toContain('Officer Alice')

      const htmlF4 = await (await fetchGet(`/flights/${f4.id}`, { Cookie: `triplet_session=${token}` })).text()
      expect(htmlF4).toMatch(/Unassigned \/ Open Range/i)
      expect(htmlF4).toMatch(/Unassigned \/ Self-Launch/i)
    })

    it('3.2: Updating a flight via POST /flights/:id/edit modifies its duty officers without affecting peer flights', async () => {
      const flyer = await seedTestUser({ displayName: 'Edit Isolation Flyer' })
      const token = await signSession(flyer.id)
      const site = await seedTestSite()
      const event = await seedTestEvent(site.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })

      const flightA = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        launchEventId: event.id,
        flightNumber: 501,
        rsoName: 'Original RSO Alpha',
        lcoName: 'Original LCO Beta',
      })

      const flightB = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        launchEventId: event.id,
        flightNumber: 502,
        rsoName: 'Untouched RSO Gamma',
        lcoName: 'Untouched LCO Delta',
      })

      // Update flightA's duty officers
      const updateRes = await fetchPostForm(
        `/flights/${flightA.id}/edit`,
        {
          rso_name: 'Rotated RSO Omega',
          lco_name: 'Rotated LCO Sigma',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(updateRes.status)

      const db = getDb()
      const [updatedA] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flightA.id))

      const [unchangedB] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flightB.id))

      expect(updatedA.rsoName).toBe('Rotated RSO Omega')
      expect(updatedA.lcoName).toBe('Rotated LCO Sigma')

      // Flight B must remain strictly intact
      expect(unchangedB.rsoName).toBe('Untouched RSO Gamma')
      expect(unchangedB.lcoName).toBe('Untouched LCO Delta')
    })
  })

  // =========================================================================
  // CATEGORY 4: Adversarial Edge Cases (XSS, Pre-filling & Inventory Preservation)
  // =========================================================================
  describe('Category 4: Adversarial Edge Cases & Security', () => {
    it('4.1: Duty officer names containing script tags / HTML are properly sanitized and escaped in detail view', async () => {
      const flyer = await seedTestUser({ displayName: 'Security Auditor' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite()

      const xssRso = '<script>alert("rso-xss")</script>'
      const xssLco = '<b onmouseover="alert(\'lco-xss\')">Malicious LCO</b>'

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          flight_number: 401,
          altitude_agl_m: 550,
          outcome: 'successful',
          rso_name: xssRso,
          lco_name: xssLco,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([200, 201, 302, 303]).toContain(res.status)

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.flightNumber, 401))

      const detailRes = await fetchGet(`/flights/${saved.id}`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(detailRes, 200)
      const html = await detailRes.text()

      // The raw script tag must NOT exist in the unescaped DOM
      expect(html).not.toContain('<script>alert("rso-xss")</script>')
      // Must be safely escaped
      expect(html).toContain('&lt;script&gt;alert(&quot;rso-xss&quot;)&lt;/script&gt;')
    })

    it('4.2: GET /flights/:id/edit pre-fills current duty officers and displays them in edit form', async () => {
      const flyer = await seedTestUser({ displayName: 'Edit Viewer' })
      const token = await signSession(flyer.id)
      const officer = await seedTestUser({ displayName: 'Officer Pre-fill' })
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite()

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        rsoName: 'Chief Officer Hawkins',
        lcoName: 'Pad Specialist Byers',
        rsoUserId: officer.id,
      })

      const editRes = await fetchGet(`/flights/${flight.id}/edit`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(editRes, 200)
      const html = await editRes.text()

      assertHasFormField(html, 'rso_name')
      assertHasFormField(html, 'lco_name')
      expect(html).toContain('value="Chief Officer Hawkins"')
      expect(html).toContain('value="Pad Specialist Byers"')
      expect(html).toContain(`value="${officer.id}" selected`)
    })

    it('4.3: Editing duty officers via POST /flights/:id/edit preserves motor inventory quantity without double decrement', async () => {
      const flyer = await seedTestUser({ displayName: 'Inventory Auditor' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite()
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 5, expendedCount: 1 })

      // Seed flight associated with this inventory item
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        motorInventoryId: inv.id,
        launchSiteId: site.id,
        rsoName: 'Initial RSO',
      })

      // Edit flight to rotate duty officer
      const editRes = await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          rso_name: 'Rotated Officer After Flight',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(editRes.status)

      // Verify inventory was NOT decremented again
      const db = getDb()
      const [invAfter] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(invAfter.quantityOnHand).toBe(5)
      expect(invAfter.expendedCount).toBe(1)
    })
  })
})
