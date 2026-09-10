/**
 * Forensic Integrity Audit Test Suite for Milestone 3
 * TripleT-Rocketry
 *
 * Verifies:
 * 1. Authentic SQLite D1 persistence of rsoName, lcoName, rsoUserId, lcoUserId via Drizzle ORM.
 * 2. Referential integrity sanitization against schema.users (invalid IDs coerced to null; valid IDs persisted).
 * 3. Client-side motor search filter DOM attributes and script genuineness (dynamic values, no hardcoding).
 * 4. Flight edit workflow (GET /flights/:id/edit prefill, POST /flights/:id/edit persistence).
 * 5. View rendering in flightDetailView (duty officers sign-off bar, dedicated duty officers card, edit flight action).
 */

import { eq } from 'drizzle-orm'
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

describe('Forensic Integrity Audit: Milestone 3', () => {
  describe('Check 1: Authentic SQLite Persistence of Flight-Level Duty Officers', () => {
    it('persists dynamic UUID strings for rsoName and lcoName into SQLite via form submission', async () => {
      const flyer = await seedTestUser({ displayName: `Pilot-${crypto.randomUUID().slice(0, 8)}` })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G', totalImpulseNs: 120 })
      const site = await seedTestSite()

      const dynamicRso = `RSO-Officer-${crypto.randomUUID()}`
      const dynamicLco = `LCO-Controller-${crypto.randomUUID()}`

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          rso_name: dynamicRso,
          lco_name: dynamicLco,
          altitude_agl_m: 450.5,
          outcome: 'successful',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('Location') ?? ''
      expect(location).toMatch(/\/flights\//)
      const flightId = location.split('/').pop()!

      // Direct verification in SQLite via Drizzle ORM
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flightId))

      expect(saved).toBeDefined()
      expect(saved.rsoName).toBe(dynamicRso)
      expect(saved.lcoName).toBe(dynamicLco)
      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBeNull()
      expect(saved.altitudeAglM).toBe(450.5)

      // Verify rendering in GET /flights/:id
      const detailRes = await fetchGet(`/flights/${flightId}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain(dynamicRso)
      expect(detailHtml).toContain(dynamicLco)
      expect(detailHtml).toContain(`/flights/${flightId}/edit`)
    })
  })

  describe('Check 2: Referential Integrity Sanitization of Officer User IDs', () => {
    it('sanitizes non-existent/bogus officer user IDs to null while preserving non-member names', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const bogusUserId1 = `bogus-uuid-${crypto.randomUUID()}`
      const bogusUserId2 = `fake-user-${crypto.randomUUID()}`
      const visitingRso = `Visiting Guest RSO ${crypto.randomUUID().slice(0, 6)}`
      const visitingLco = `Visiting Guest LCO ${crypto.randomUUID().slice(0, 6)}`

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          rso_name: visitingRso,
          lco_name: visitingLco,
          rso_user_id: bogusUserId1,
          lco_user_id: bogusUserId2,
          altitude_agl_m: 300,
          outcome: 'successful',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('Location') ?? ''
      const flightId = location.split('/').pop()!

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flightId))

      expect(saved).toBeDefined()
      // Foreign keys must be safely coerced to null to avoid FK crashes
      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBeNull()
      // Plaintext names must be preserved accurately
      expect(saved.rsoName).toBe(visitingRso)
      expect(saved.lcoName).toBe(visitingLco)
    })

    it('preserves valid user IDs and resolves display names from registered users table', async () => {
      const flyer = await seedTestUser({ displayName: 'Primary Flyer' })
      const rsoMember = await seedTestUser({ displayName: 'Certified RSO User' })
      const lcoMember = await seedTestUser({ displayName: 'Pad LCO User' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          rso_user_id: rsoMember.id,
          lco_user_id: lcoMember.id,
          altitude_agl_m: 250,
          outcome: 'successful',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('Location') ?? ''
      const flightId = location.split('/').pop()!

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flightId))

      expect(saved.rsoUserId).toBe(rsoMember.id)
      expect(saved.lcoUserId).toBe(lcoMember.id)
      expect(saved.rsoName).toBe('Certified RSO User')
      expect(saved.lcoName).toBe('Pad LCO User')

      // Check detail view resolves user displayName
      const detailRes = await fetchGet(`/flights/${flightId}`, {
        Cookie: `triplet_session=${token}`,
      })
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain('Certified RSO User')
      expect(detailHtml).toContain('Pad LCO User')
    })
  })

  describe('Check 3: Motor Search Filter DOM Attributes & Genuine Script Logic', () => {
    it('renders data-search, data-mfr, data-model, data-diameter attributes dynamically for motors', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const uniqueMfr = `CustomMfr-${crypto.randomUUID().slice(0, 6)}`
      const uniqueModel = `G999-${crypto.randomUUID().slice(0, 6)}`
      await seedTestMotor({
        manufacturer: uniqueMfr,
        model: uniqueModel,
        impulseClass: 'G',
        diameterMm: 38,
        delayS: 8,
      })

      const res = await fetchGet('/flights/new', {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Input field must not contaminate form POST data
      expect(html).toContain('id="motor-search-filter"')
      expect(html).not.toMatch(/<input[^>]+id="motor-search-filter"[^>]+name=/)

      // Option metadata verification
      expect(html).toContain(uniqueMfr)
      expect(html).toContain(uniqueModel)
      expect(html).toContain(`data-mfr="${uniqueMfr}"`)
      expect(html).toContain(`data-model="${uniqueModel}"`)
      expect(html).toContain('data-diameter="38"')
      expect(html).toContain('data-impulse="G"')
      expect(html).toContain('38mm')

      // JavaScript function presence and DOM filtering logic
      expect(html).toContain('initMotorSearchFilter')
      expect(html).toContain('data-search')
      expect(html).toContain('terms.every')
      expect(html).toContain('opt.hidden = true')
      expect(html).toContain('opt.hidden = false')
    })
  })

  describe('Check 4: Flight Edit Workflow (GET & POST /flights/:id/edit)', () => {
    it('pre-fills edit form with existing flight values and persists updates cleanly', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor1 = await seedTestMotor({ model: 'G70W' })
      const motor2 = await seedTestMotor({ model: 'G80W' })
      const site = await seedTestSite()

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor1.id,
        launchSiteId: site.id,
        altitudeAglM: 500,
        rsoName: 'Initial RSO',
        lcoName: 'Initial LCO',
        notes: 'Initial launch note',
      })

      // GET /flights/:id/edit
      const editRes = await fetchGet(`/flights/${flight.id}/edit`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(editRes, 200)
      const editHtml = await editRes.text()
      expect(editHtml).toContain('Initial RSO')
      expect(editHtml).toContain('Initial LCO')
      expect(editHtml).toContain('Initial launch note')
      expect(editHtml).toContain('Save Flight Changes')
      expect(editHtml).toContain(`action="/flights/${flight.id}/edit"`)

      // POST /flights/:id/edit
      const updatedRso = `Updated-RSO-${crypto.randomUUID().slice(0, 6)}`
      const updatedLco = `Updated-LCO-${crypto.randomUUID().slice(0, 6)}`
      const updatePostRes = await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          rocket_configuration_id: config.id,
          motor_id: motor2.id,
          launch_site_id: site.id,
          altitude_agl_m: 620.5,
          rso_name: updatedRso,
          lco_name: updatedLco,
          notes: 'Updated flight notes post-launch',
          outcome: 'successful',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(updatePostRes.status)
      expect(updatePostRes.headers.get('Location')).toBe(`/flights/${flight.id}`)

      // Verify updated record in SQLite via Drizzle ORM
      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flight.id))

      expect(updated.motorId).toBe(motor2.id)
      expect(updated.altitudeAglM).toBe(620.5)
      expect(updated.rsoName).toBe(updatedRso)
      expect(updated.lcoName).toBe(updatedLco)
      expect(updated.notes).toBe('Updated flight notes post-launch')
    })
  })
})
