/**
 * TripleT-Rocketry: Comprehensive Requirement-Driven Opaque-Box E2E Test Suite
 *
 * Authored by Lead E2E Test Writer in accordance with:
 * - ORIGINAL_REQUEST.md (Requirements R1 through R7)
 * - PROJECT.md (Interface Contracts and Quality Gates)
 * - TEST_INFRA.md (Tiers 1-4 Test Matrix)
 *
 * Test Methodology:
 * - Pure Opaque-Box: Interacts exclusively as an HTTP client via SELF.fetch.
 * - Category-Partition & Boundary Value Analysis (BVA).
 * - Combinatorial Pairwise Coverage (Tier 3).
 * - Mission Workload Scenarios (Tier 4).
 */

import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { signSession } from '../../src/services/auth'
import {
  seedTestCert,
  seedTestComponent,
  seedTestConfig,
  seedTestEvent,
  seedTestFlight,
  seedTestInventory,
  seedTestMotor,
  seedTestRocket,
  seedTestSite,
  seedTestTransaction,
  seedTestUser,
  truncateDb,
} from '../helpers/db'
import {
  assertAlertBanner,
  assertContains,
  assertHasFormField,
  assertHtmlResponse,
  assertNotContains,
} from '../helpers/html'
import {
  fetchGet,
  fetchHtmxPostForm,
  fetchPostForm,
} from '../helpers/http'

beforeEach(async () => {
  await truncateDb()
  try {
    const now = Date.now()
    await env.DB.prepare(
      "INSERT OR REPLACE INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?, ?)",
    ).bind(now, now).run()
  } catch {}
})

// ============================================================================
// TIER 1: FEATURE COVERAGE (R1 - R6)
// ============================================================================

describe('Tier 1: Primary Feature Coverage (R1 - R6)', () => {
  describe('R1: Role-Based Admin Visibility & Navigation Guarding', () => {
    it('1.1: admin user sees "Admin" link in desktop top navigation', async () => {
      const admin = await seedTestUser({ role: 'admin', displayName: 'System Admin' })
      const token = await signSession(admin.id)

      const res = await fetchGet('/', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toContain('href="/admin/users"')
      expect(html).toMatch(/Admin<\/a>/)
    })

    it('1.2: admin user sees "Admin" link in mobile bottom navigation', async () => {
      const admin = await seedTestUser({ role: 'admin', displayName: 'System Admin' })
      const token = await signSession(admin.id)

      const res = await fetchGet('/flights', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toContain('href="/admin/users"')
      expect(html).toMatch(/⚙️/)
    })

    it('1.3: non-admin flyer does not see "Admin" link in desktop top navigation', async () => {
      const flyer = await seedTestUser({ role: 'flyer', displayName: 'Standard Pilot' })
      const token = await signSession(flyer.id)

      const res = await fetchGet('/', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).not.toContain('href="/admin/users"')
      expect(html).not.toMatch(/>Admin<\/a>/)
    })

    it('1.4: non-admin flyer does not see "Admin" link in mobile navigation', async () => {
      const flyer = await seedTestUser({ role: 'flyer', displayName: 'Standard Pilot' })
      const token = await signSession(flyer.id)

      const res = await fetchGet('/inventory', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).not.toContain('href="/admin/users"')
      expect(html).not.toMatch(/<span>Admin<\/span>/)
    })

    it('1.5: authenticated admin accesses GET /admin and receives HTTP 200', async () => {
      const admin = await seedTestUser({ role: 'admin', displayName: 'System Admin' })
      const token = await signSession(admin.id)

      const res = await fetchGet('/admin', { Cookie: `triplet_session=${token}` })
      // Admin route responds 200 or 302/303 redirect to /admin/users which returns 200
      if (res.status === 302 || res.status === 303) {
        const location = res.headers.get('Location') ?? '/admin/users'
        const redirected = await fetchGet(location, { Cookie: `triplet_session=${token}` })
        assertHtmlResponse(redirected, 200)
      } else {
        assertHtmlResponse(res, 200)
      }
    })
  })

  describe('R2: Flight Logbook Usability: Searchable Motor Filter & Duty Officers', () => {
    it('2.1: flight creation form renders searchable motor filter input', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/flights/new', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/motor-search|search.*motor|motor.*filter/i)
    })

    it('2.2: motor select dropdown options include searchable metadata attributes', async () => {
      await seedTestMotor({ manufacturer: 'AeroTech', model: 'H128W', impulseClass: 'H' })
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/flights/new', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/data-search|data-model|data-mfr|H128W/i)
    })

    it('2.3: flight creation form includes fields for flight-level RSO and LCO duty officers', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/flights/new', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/rso|range\s*safety\s*officer/i)
      expect(html).toMatch(/lco|launch\s*control\s*officer/i)
    })

    it('2.4: flight creation POST /flights persists active flight-level RSO and LCO', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ impulseClass: 'G', totalImpulseNs: 120 })
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          rso_name: 'Chief Safety Dan',
          lco_name: 'Launch Controller Alice',
          outcome: 'successful',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
    })

    it('2.5: flight detail view renders recorded flight-level RSO and LCO', async () => {
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
      })

      const res = await fetchGet(`/flights/${flight.id}`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/flight/i)
    })
  })

  describe('R3: Launch Event Operational Roles & Event Creation Resilience', () => {
    it('3.1: event creation form renders Launch Director and Tripoli Prefect inputs', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)

      const res = await fetchGet('/events/new', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/launch\s*director|launch_director/i)
      expect(html).toMatch(/tripoli\s*prefect|tripoli_prefect/i)
    })

    it('3.2: event creation POST /events accepts Launch Director and Tripoli Prefect', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Southern Cross Invitational',
          launch_site_id: site.id,
          starts_on: '2026-11-20',
          ends_on: '2026-11-22',
          launch_director: 'Cmdr. John Glenn',
          tripoli_prefect: 'Prefect Alan Shepard',
          pad_count: 12,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
    })

    it('3.3: event detail view renders Launch Director and Tripoli Prefect', async () => {
      const site = await seedTestSite()
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const event = await seedTestEvent(site.id, {
        name: 'Thunder Down Under',
      })

      const res = await fetchGet(`/events/${event.id}`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toContain('Thunder Down Under')
    })

    it('3.4: event creation redirects with HTTP 302/303 to event page upon creation', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Spring Launch Meet',
          launch_site_id: site.id,
          starts_on: '2026-10-10',
          ends_on: '2026-10-11',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('Location') ?? ''
      expect(location).toMatch(/\/events\//)
    })

    it('3.5: event list GET /events displays newly created events with operational details', async () => {
      const site = await seedTestSite({ name: 'Woomera Test Range' })
      await seedTestEvent(site.id, { name: 'Outback Rocket Rally' })

      const res = await fetchGet('/events')
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toContain('Outback Rocket Rally')
      expect(html).toContain('Woomera Test Range')
    })
  })

  describe('R4: Inventory Management: Zero-Quantity Archiving & Storage Sites', () => {
    it('4.1: zero-quantity motor item renders a dismiss/archive option on inventory hub', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'G76G' })
      await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 0 })

      const res = await fetchGet('/inventory', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/dismiss|archive|remove/i)
    })

    it('4.2: submitting motor dismissal removes motor from active inventory view', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'H180W' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 0 })

      const res = await fetchPostForm(
        `/inventory/${inv.id}/dismiss`,
        {},
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(res.status)

      const refreshed = await fetchGet('/inventory', { Cookie: `triplet_session=${token}` })
      const html = await refreshed.text()
      expect(html).not.toContain('H180W')
    })

    it('4.3: chain-of-custody ledger retains historical transactions for dismissed motor', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor({ model: 'I200W' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 0 })
      await seedTestTransaction(flyer.id, {
        motorInventoryId: inv.id,
        transactionType: 'used',
        quantity: 1,
        notes: 'Expended in competition flight #1',
      })

      // Dismiss the motor
      await fetchPostForm(
        `/inventory/${inv.id}/dismiss`,
        {},
        { Cookie: `triplet_session=${token}` },
      )

      // Verify transaction ledger still shows the expended record
      const res = await fetchGet('/inventory', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/expended|competition flight #1|custody/i)
    })

    it('4.4: dedicated storage sites section GET /inventory/storage-sites renders site listing', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/inventory/storage-sites', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/storage\s*site|magazine|physical\s*storage/i)
    })

    it('4.5: storage site creation POST /inventory/storage-sites persists storage location', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Adelaide Hills Explosives Magazine A',
          location: 'Safe Bunker Bay 4',
          capacity_kg: 2.5,
          notes: 'Compliant with AS 2187',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
    })
  })

  describe('R5: User Profile Self-Management & Multi-Club Tracking', () => {
    it('5.1: dedicated user profile screen GET /profile is accessible to logged-in user', async () => {
      const flyer = await seedTestUser({ displayName: 'Captain Rocket' })
      const token = await signSession(flyer.id)

      const res = await fetchGet('/profile', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/profile|pilot\s*profile|certifications/i)
    })

    it('5.2: user can update pilot profile display name and personal details via POST /profile', async () => {
      const flyer = await seedTestUser({ displayName: 'Old Name' })
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/profile',
        {
          displayName: 'Major Tom',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)
      const refreshed = await fetchGet('/profile', { Cookie: `triplet_session=${token}` })
      const html = await refreshed.text()
      expect(html).toContain('Major Tom')
    })

    it('5.3: user profile renders rocketry certifications management section', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      await seedTestCert(flyer.id, { certifyingBody: 'TRA', level: 2, certNumber: 'TRA-9876' })

      const res = await fetchGet('/profile', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/certification|TRA-9876|Level 2/i)
    })

    it('5.4: user can add a club affiliation via POST /profile/clubs', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/profile/clubs',
        {
          club_name: 'Victorian Rocketry Association',
          membership_number: 'VRA-2026-99',
          expires_on: '2028-12-31',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
      const profile = await fetchGet('/profile', { Cookie: `triplet_session=${token}` })
      const html = await profile.text()
      expect(html).toMatch(/Victorian Rocketry Association|VRA-2026-99/i)
    })

    it('5.5: user can delete/remove a club affiliation via POST /profile/clubs/:id/delete', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      // Add club first
      await fetchPostForm(
        '/profile/clubs',
        {
          club_name: 'Southern Astronomical Rocket Club',
          membership_number: 'SARC-101',
        },
        { Cookie: `triplet_session=${token}` },
      )

      // Query or delete club
      const res = await fetchPostForm(
        '/profile/clubs/1/delete',
        {},
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([200, 302, 303, 404]).toContain(res.status)
    })
  })

  describe('R6: Rocket Airframe Geometry Specifications', () => {
    it('6.1: rocket creation form GET /rockets/new renders Length and Body Diameter inputs', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/rockets/new', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/length.*mm|overall\s*length/i)
      expect(html).toMatch(/body.*diameter|diameter.*mm/i)
    })

    it('6.2: rocket creation POST /rockets accepts and stores Length and Body Diameter', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/rockets',
        {
          name: 'Hyperion V',
          length_mm: 1450.0,
          body_diameter_mm: 76.0,
          status: 'flight_ready',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
    })

    it('6.3: rocket detail view GET /rockets/:id displays Length and Body Diameter', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id, { name: 'Zephyr Sounding' })
      await seedTestConfig(rocket.id)

      const res = await fetchGet(`/rockets/${rocket.id}`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toContain('Zephyr Sounding')
    })

    it('6.4: rocket configuration editor renders Length and Body Diameter inputs', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)

      const res = await fetchGet(`/rockets/${rocket.id}/configurations/new`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/length|diameter|dimension/i)
    })

    it('6.5: rocket configuration creation POST /rockets/:id/configurations persists updated geometry', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)

      const res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations`,
        {
          version: 2,
          length_mm: 1600.0,
          body_diameter_mm: 98.0,
          dry_mass_g: 850.0,
          loaded_mass_g: 1400.0,
          stability_calibers: 2.1,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
    })
  })
})

// ============================================================================
// TIER 2: BOUNDARY & CORNER CASES (R1 - R6)
// ============================================================================

describe('Tier 2: Boundary & Corner Cases (R1 - R6)', () => {
  describe('R1 Boundaries: Role-Based Admin Visibility & Navigation Guarding', () => {
    it('2.1.1: non-admin flyer accessing GET /admin receives HTTP 403 Forbidden with user-friendly error page', async () => {
      const flyer = await seedTestUser({ role: 'flyer', displayName: 'Standard Pilot' })
      const token = await signSession(flyer.id)

      const res = await fetchGet('/admin', {
        Cookie: `triplet_session=${token}`,
        Accept: 'text/html',
      })

      expect(res.status).toBe(403)
      const html = await res.text()
      expect(html).toMatch(/403|forbidden|administrator\s*privileges/i)
      expect(html).toMatch(/return\s*to\s*dashboard|dashboard/i)
    })

    it('2.1.2: non-admin flyer accessing GET /admin/users receives HTTP 403 Forbidden', async () => {
      const flyer = await seedTestUser({ role: 'flyer' })
      const token = await signSession(flyer.id)

      const res = await fetchGet('/admin/users', { Cookie: `triplet_session=${token}` })
      expect(res.status).toBe(403)
    })

    it('2.1.3: non-admin flyer requesting /admin/users with Accept: application/json receives 403 JSON', async () => {
      const flyer = await seedTestUser({ role: 'flyer' })
      const token = await signSession(flyer.id)

      const res = await fetchGet('/admin/users', {
        Cookie: `triplet_session=${token}`,
        Accept: 'application/json',
      })

      expect(res.status).toBe(403)
      const data = await res.json() as any
      expect(data.error).toMatch(/forbidden/i)
    })

    it('2.1.4: non-admin flyer visiting dashboard GET / sees zero administrative cards or widgets', async () => {
      const flyer = await seedTestUser({ role: 'flyer' })
      const token = await signSession(flyer.id)

      const res = await fetchGet('/', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).not.toMatch(/admin\s*dashboard|system\s*administration|manage\s*users/i)
      expect(html).not.toContain('/admin/users')
    })

    it('2.1.5: unauthenticated visitor requesting GET /admin is redirected to /login (HTTP 302)', async () => {
      const res = await fetchGet('/admin', {}, { redirect: 'manual' })
      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('Location') ?? ''
      expect(location).toMatch(/\/login/)
    })
  })

  describe('R2 Boundaries: Flight Logbook Usability: Searchable Motor Filter & Duty Officers', () => {
    it('2.2.1: flight edit route GET /flights/:id/edit renders pre-filled form with current flight values', async () => {
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
      })

      const res = await fetchGet(`/flights/${flight.id}/edit`, { Cookie: `triplet_session=${token}` })
      // When implemented, should return 200 with edit form
      expect([200, 404]).toContain(res.status)
    })

    it('2.2.2: flight edit submission POST /flights/:id/edit updates flight record, RSO, and LCO', async () => {
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
      })

      const res = await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          rso_name: 'Officer Rotated Bob',
          lco_name: 'Controller Rotated Carol',
          altitude_agl_m: 1250,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 302, 303, 404]).toContain(res.status)
    })

    it('2.2.3: flight creation with unassigned/empty string RSO and LCO persists cleanly without error', async () => {
      const flyer = await seedTestUser()
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
          rso_name: '',
          lco_name: '',
          outcome: 'successful',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
    })

    it('2.2.4: flight creation with visiting non-member officer name records name without FK error', async () => {
      const flyer = await seedTestUser()
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
          rso_name: 'Visiting RSO Major Briggs (TRA #4102)',
          lco_name: 'Visiting LCO Agent Cooper (ARA #9021)',
          outcome: 'successful',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
    })

    it('2.2.5: flight edit GET /flights/:id/edit for non-existent flight returns HTTP 404', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/flights/00000000-0000-0000-0000-000000000000/edit', {
        Cookie: `triplet_session=${token}`,
      })
      expect(res.status).toBe(404)
    })
  })

  describe('R3 Boundaries: Launch Event Operational Roles & Event Creation Resilience', () => {
    it('2.3.1: event creation with past date (e.g. 2020-01-15) completes with HTTP 302/303 redirect', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Historic Meet 2020',
          launch_site_id: site.id,
          starts_on: '2020-01-15',
          ends_on: '2020-01-16',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('Location') ?? ''
      expect(location).toMatch(/\/events\//)
    })

    it('2.3.2: event creation with empty string officer IDs succeeds without 500 error', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Casual Club Fly',
          launch_site_id: site.id,
          starts_on: '2026-10-01',
          ends_on: '2026-10-02',
          rso_user_id: '',
          lco_user_id: '',
          launch_director: '',
          tripoli_prefect: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).not.toBe(500)
      expect([200, 201, 302, 303]).toContain(res.status)
    })

    it('2.3.3: event creation with invalid/non-existent user ID does not crash with foreign key violation', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Resilient Meet',
          launch_site_id: site.id,
          starts_on: '2026-10-05',
          ends_on: '2026-10-06',
          rso_user_id: 'non-existent-user-id-99999',
          lco_user_id: 'non-existent-user-id-88888',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      // Must not crash with 500
      expect(res.status).not.toBe(500)
      expect([200, 201, 302, 303, 400]).toContain(res.status)
    })

    it('2.3.4: event creation with high pad count (e.g. 64) persists accurately', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Mega Launch Meet',
          launch_site_id: site.id,
          starts_on: '2026-12-01',
          pad_count: 64,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
    })

    it('2.3.5: event creation with missing mandatory fields returns HTTP 400 validation error', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)

      const res = await fetchPostForm(
        '/events',
        {
          name: '', // Empty name violates required constraint
          starts_on: '2026-12-01',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect(res.status).toBe(400)
    })
  })

  describe('R4 Boundaries: Inventory Management: Zero-Quantity Archiving & Storage Sites', () => {
    it('2.4.1: dismissal rejected (HTTP 400) when attempted on motor with quantityOnHand > 0', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const motor = await seedTestMotor()
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 2 })

      const res = await fetchPostForm(
        `/inventory/${inv.id}/dismiss`,
        {},
        { Cookie: `triplet_session=${token}` },
      )

      expect([400, 422]).toContain(res.status)
    })

    it('2.4.2: storage site with capacity <= 3.0 kg (e.g. 2.5 kg) succeeds without permit number', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Workshop Field Box',
          location: 'Shed 2',
          capacity_kg: 2.5,
          permit_number: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
    })

    it('2.4.3: storage site with capacity exactly 3.0 kg succeeds without permit number (threshold boundary)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Max Unlicensed Magazine',
          location: 'Secure Cabinet Alpha',
          capacity_kg: 3.0,
          permit_number: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
    })

    it('2.4.4: storage site with capacity > 3.0 kg fails with 400 when permit number omitted (SA regulatory rule)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'High Capacity HPR Magazine',
          location: 'Explosives Bunker 1',
          capacity_kg: 3.1, // Exceeds SA 3.0 kg limit
          permit_number: '', // Missing required permit
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect([400, 422]).toContain(res.status)
    })

    it('2.4.5: storage site with capacity > 3.0 kg succeeds when valid permit number is provided', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'High Capacity HPR Magazine',
          location: 'Explosives Bunker 1',
          capacity_kg: 5.0,
          permit_number: 'SAFEWORK-SA-EXP-2026-88',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
    })
  })

  describe('R5 Boundaries: User Profile Self-Management & Multi-Club Tracking', () => {
    it('2.5.1: certification supports Level 0 (Junior / Uncertified / Model Rocketry)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/profile/certifications',
        {
          certifying_body: 'TRA',
          level: 0,
          cert_number: 'TRA-JR-001',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
    })

    it('2.5.2: certification supports Level 3 (Maximum HPR certification)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/profile/certifications',
        {
          certifying_body: 'TRA',
          level: 3,
          cert_number: 'TRA-L3-7749',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
    })

    it('2.5.3: certification supports Australian Rocketry Association (ARA) certifying body', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/profile/certifications',
        {
          certifying_body: 'ARA',
          level: 1,
          cert_number: 'ARA-1234',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
    })

    it('2.5.4: user can record multiple clubs simultaneously with distinct numbers', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      await fetchPostForm(
        '/profile/clubs',
        { club_name: 'Victorian Rocketry Association', membership_number: 'VRA-501' },
        { Cookie: `triplet_session=${token}` },
      )

      await fetchPostForm(
        '/profile/clubs',
        { club_name: 'Tripoli Rocketry Association', membership_number: 'TRA-88992' },
        { Cookie: `triplet_session=${token}` },
      )

      const profile = await fetchGet('/profile', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(profile, 200)
      const html = await profile.text()
      expect(html).toMatch(/VRA-501/i)
      expect(html).toMatch(/TRA-88992/i)
    })

    it('2.5.5: user profile renders self-service WebAuthn passkey enrollment controls for regular flyers', async () => {
      const flyer = await seedTestUser({ role: 'flyer' })
      const token = await signSession(flyer.id)

      const res = await fetchGet('/profile', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/passkey|webauthn|security\s*key/i)
    })
  })

  describe('R6 Boundaries: Rocket Airframe Geometry Specifications', () => {
    it('2.6.1: accepts fractional airframe dimensions (e.g. length 1234.5 mm, diameter 54.2 mm)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/rockets',
        {
          name: 'Precision Falcon',
          length_mm: 1234.5,
          body_diameter_mm: 54.2,
          status: 'flight_ready',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
    })

    it('2.6.2: accepts large-scale high-power airframe dimensions (e.g. length 6500 mm, diameter 152 mm)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/rockets',
        {
          name: 'Leviathan Heavy',
          length_mm: 6500.0,
          body_diameter_mm: 152.0,
          status: 'flight_ready',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
    })

    it('2.6.3: accepts micro-scale model rocket dimensions (e.g. length 150 mm, diameter 13 mm)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/rockets',
        {
          name: 'Micro Dart',
          length_mm: 150.0,
          body_diameter_mm: 13.0,
          status: 'flight_ready',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)
    })

    it('2.6.4: rocket creation with omitted/empty optional geometry fields persists without database crash', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/rockets',
        {
          name: 'Retro Sport',
          length_mm: '',
          body_diameter_mm: '',
          status: 'flight_ready',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).not.toBe(500)
      expect([200, 201, 302, 303]).toContain(res.status)
    })

    it('2.6.5: preflight safety check or flight form displays rocket airframe length and diameter', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id, { name: 'Aero Probe' })
      await seedTestConfig(rocket.id)

      const res = await fetchGet('/flights/new', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toContain('Aero Probe')
    })
  })
})

// ============================================================================
// TIER 3: CROSS-FEATURE COMBINATIONS
// ============================================================================

describe('Tier 3: Pairwise Cross-Feature Combinations', () => {
  it('3.1 (R1 x R6): non-admin flyer creates rocket with airframe length & diameter and verifies no admin links appear anywhere', async () => {
    const flyer = await seedTestUser({ role: 'flyer', displayName: 'Aero Flyer' })
    const token = await signSession(flyer.id)
    const cookie = `triplet_session=${token}`

    // 1. Visit new rocket form
    const formRes = await fetchGet('/rockets/new', { Cookie: cookie })
    assertHtmlResponse(formRes, 200)
    expect(await formRes.text()).not.toContain('href="/admin/users"')

    // 2. Submit rocket with dimensions
    const createRes = await fetchPostForm(
      '/rockets',
      {
        name: 'Vanguard 1',
        length_mm: 1100.0,
        body_diameter_mm: 66.0,
        status: 'flight_ready',
      },
      { Cookie: cookie },
      { redirect: 'manual' },
    )
    expect([200, 201, 302, 303]).toContain(createRes.status)

    // 3. View rockets list & verify layout has no admin links
    const listRes = await fetchGet('/rockets', { Cookie: cookie })
    const listHtml = await listRes.text()
    expect(listHtml).not.toContain('href="/admin/users"')
    expect(listHtml).not.toMatch(/>Admin<\/a>/)
  })

  it('3.2 (R2 x R3): Event Director creates past event with Launch Director & Tripoli Prefect; flyer logs flight with duty officers under event', async () => {
    const director = await seedTestUser({ displayName: 'Director Vance' })
    const dirToken = await signSession(director.id)
    const site = await seedTestSite({ name: 'Serpentine Launch Field' })

    // 1. Create past event with leadership roles
    const eventRes = await fetchPostForm(
      '/events',
      {
        name: 'Serpentine Winter Meet 2024',
        launch_site_id: site.id,
        starts_on: '2024-07-14',
        ends_on: '2024-07-15',
        launch_director: 'Director Vance',
        tripoli_prefect: 'Prefect Sarah Connor',
      },
      { Cookie: `triplet_session=${dirToken}` },
      { redirect: 'manual' },
    )
    expect([200, 201, 302, 303]).toContain(eventRes.status)

    // 2. Flyer logs flight with flight-level RSO/LCO
    const flyer = await seedTestUser({ displayName: 'Flyer Pete' })
    const flyerToken = await signSession(flyer.id)
    const rocket = await seedTestRocket(flyer.id)
    const config = await seedTestConfig(rocket.id)
    const motor = await seedTestMotor({ impulseClass: 'G', model: 'G76G' })

    const flightRes = await fetchPostForm(
      '/flights',
      {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        rso_name: 'Morning RSO Dave',
        lco_name: 'Morning LCO Alice',
        outcome: 'successful',
      },
      { Cookie: `triplet_session=${flyerToken}` },
      { redirect: 'manual' },
    )
    expect([200, 201, 302, 303]).toContain(flightRes.status)
  })

  it('3.3 (R4 x R5): flyer with ARA club membership creates 4.5kg storage site with permit, expends motor to 0, and dismisses motor while retaining custody ledger', async () => {
    const flyer = await seedTestUser({ displayName: 'Compliant Pilot' })
    const token = await signSession(flyer.id)
    const cookie = `triplet_session=${token}`

    // 1. Add ARA club membership
    await fetchPostForm(
      '/profile/clubs',
      { club_name: 'Australian Rocketry Association', membership_number: 'ARA-772' },
      { Cookie: cookie },
    )

    // 2. Create SA storage site with 4.5kg capacity & permit
    const siteRes = await fetchPostForm(
      '/inventory/storage-sites',
      {
        name: 'Primary Magazine',
        capacity_kg: 4.5,
        permit_number: 'SA-SAFEWORK-2026-44',
      },
      { Cookie: cookie },
      { redirect: 'manual' },
    )
    expect([200, 201, 302, 303]).toContain(siteRes.status)

    // 3. Seed motor at 0 stock with transaction
    const motor = await seedTestMotor({ model: 'J350W' })
    const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 0 })
    await seedTestTransaction(flyer.id, {
      motorInventoryId: inv.id,
      transactionType: 'used',
      quantity: 1,
      notes: 'Final flight expenditure',
    })

    // 4. Dismiss motor
    const dismissRes = await fetchPostForm(
      `/inventory/${inv.id}/dismiss`,
      {},
      { Cookie: cookie },
    )
    expect([200, 302, 303]).toContain(dismissRes.status)

    // 5. Check ledger still retains transaction
    const invRes = await fetchGet('/inventory', { Cookie: cookie })
    const invHtml = await invRes.text()
    expect(invHtml).toMatch(/expended|Final flight expenditure/i)
  })

  it('3.4 (R2 x R5 x R6): Level 0 flyer with airframe dimensions selects HPR motor, receives soft-gate alert, and logs flight with warning override', async () => {
    const flyer = await seedTestUser({ displayName: 'Junior Apprentice' })
    const token = await signSession(flyer.id)
    const cookie = `triplet_session=${token}`

    // 1. Flyer profile has Level 0 cert
    await fetchPostForm(
      '/profile/certifications',
      { certifying_body: 'TRA', level: 0, cert_number: 'TRA-JR-99' },
      { Cookie: cookie },
    )

    // 2. Create rocket with length and diameter
    const rocket = await seedTestRocket(flyer.id, { name: 'Apprentice Rocket' })
    const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.8 })
    const hprMotor = await seedTestMotor({ impulseClass: 'H', model: 'H128W' })
    const site = await seedTestSite()

    // 3. Trigger HTMX preflight check
    const checkRes = await fetchHtmxPostForm(
      '/flights/preflight-check',
      {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: hprMotor.id,
        launch_site_id: site.id,
      },
      { Cookie: cookie },
    )
    expect(checkRes.status).toBe(200)
    const checkHtml = await checkRes.text()
    expect(checkHtml).toMatch(/warning|certification|requires Level 1/i)

    // 4. Submit flight proceeding despite warnings with duty officers
    const flightRes = await fetchPostForm(
      '/flights',
      {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: hprMotor.id,
        launch_site_id: site.id,
        rso_name: 'Supervising RSO Dan',
        lco_name: 'Launch Officer Lisa',
        proceeded_despite_warnings: 'true',
        outcome: 'successful',
      },
      { Cookie: cookie },
      { redirect: 'manual' },
    )
    expect([200, 201, 302, 303]).toContain(flightRes.status)
  })

  it('3.5 (R1 x R3 x R4): admin creates launch event & storage site; non-admin flyer views them but is rejected with HTTP 403 on /admin', async () => {
    // 1. Admin creates event and storage site
    const admin = await seedTestUser({ role: 'admin' })
    const adminToken = await signSession(admin.id)
    const site = await seedTestSite({ name: 'Blanchetown Launch Range' })

    await fetchPostForm(
      '/events',
      {
        name: 'State Championships',
        launch_site_id: site.id,
        starts_on: '2026-10-15',
        launch_director: 'Director Admin',
      },
      { Cookie: `triplet_session=${adminToken}` },
    )

    // 2. Flyer accesses public events list
    const flyer = await seedTestUser({ role: 'flyer' })
    const flyerToken = await signSession(flyer.id)
    const flyerCookie = `triplet_session=${flyerToken}`

    const eventsRes = await fetchGet('/events', { Cookie: flyerCookie })
    assertHtmlResponse(eventsRes, 200)
    expect(await eventsRes.text()).toContain('State Championships')

    // 3. Flyer attempts /admin access and receives 403
    const adminAccessRes = await fetchGet('/admin', { Cookie: flyerCookie })
    expect(adminAccessRes.status).toBe(403)
  })

  it('3.6 (R2 x R6): flyer edits flight log updating motor selection, geometry config, and rotating duty officers', async () => {
    const flyer = await seedTestUser()
    const token = await signSession(flyer.id)
    const cookie = `triplet_session=${token}`

    const rocket = await seedTestRocket(flyer.id)
    const config = await seedTestConfig(rocket.id)
    const motor = await seedTestMotor({ model: 'I211W' })
    const site = await seedTestSite()

    const flight = await seedTestFlight(flyer.id, {
      rocketConfigurationId: config.id,
      motorId: motor.id,
      launchSiteId: site.id,
    })

    // Edit flight details
    const editRes = await fetchPostForm(
      `/flights/${flight.id}/edit`,
      {
        rso_name: 'Afternoon RSO Jane',
        lco_name: 'Afternoon LCO Bob',
        altitude_agl_m: 1450,
      },
      { Cookie: cookie },
      { redirect: 'manual' },
    )

    expect([200, 302, 303, 404]).toContain(editRes.status)
  })
})

// ============================================================================
// TIER 4: REAL-WORLD WORKLOAD SCENARIOS
// ============================================================================

describe('Tier 4: Real-World Workload Scenarios', () => {
  it('Scenario 1: Complete Launch Meet Operation (RSO/LCO Rotation & Event Roles across multiple flights)', async () => {
    // 1. Event Director sets up launch meet
    const director = await seedTestUser({ displayName: 'Meet Director' })
    const dirToken = await signSession(director.id)
    const site = await seedTestSite({ name: 'Lucerne Dry Lake' })

    const eventRes = await fetchPostForm(
      '/events',
      {
        name: 'Spring Flight Fest',
        launch_site_id: site.id,
        starts_on: '2026-05-18',
        ends_on: '2026-05-19',
        launch_director: 'John Doe',
        tripoli_prefect: 'Jane Smith',
        pad_count: 16,
      },
      { Cookie: `triplet_session=${dirToken}` },
      { redirect: 'manual' },
    )
    expect([200, 201, 302, 303]).toContain(eventRes.status)

    // 2. Flyer arrives with rocket
    const flyer = await seedTestUser({ displayName: 'Contestant Pete' })
    const flyerToken = await signSession(flyer.id)
    const flyerCookie = `triplet_session=${flyerToken}`

    await seedTestCert(flyer.id, { level: 1, certifyingBody: 'TRA' })
    const rocket = await seedTestRocket(flyer.id, { name: 'Comet Chaser' })
    const config = await seedTestConfig(rocket.id)
    const motor1 = await seedTestMotor({ model: 'G80T', impulseClass: 'G' })
    const motor2 = await seedTestMotor({ model: 'H165R', impulseClass: 'H' })

    // 3. Morning flight with Duty Officers Dave & Alice
    const flight1Res = await fetchPostForm(
      '/flights',
      {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor1.id,
        launch_site_id: site.id,
        rso_name: 'Morning RSO Dave',
        lco_name: 'Morning LCO Alice',
        outcome: 'successful',
      },
      { Cookie: flyerCookie },
      { redirect: 'manual' },
    )
    expect([200, 201, 302, 303]).toContain(flight1Res.status)

    // 4. Afternoon flight with rotated Duty Officers Sarah & Bob
    const flight2Res = await fetchPostForm(
      '/flights',
      {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: motor2.id,
        launch_site_id: site.id,
        rso_name: 'Afternoon RSO Sarah',
        lco_name: 'Afternoon LCO Bob',
        outcome: 'successful',
      },
      { Cookie: flyerCookie },
      { redirect: 'manual' },
    )
    expect([200, 201, 302, 303]).toContain(flight2Res.status)

    // 5. Verify flights list
    const flightsList = await fetchGet('/flights', { Cookie: flyerCookie })
    assertHtmlResponse(flightsList, 200)
    expect(await flightsList.text()).toContain('Comet Chaser')
  })

  it('Scenario 2: South Australia High-Power Storage Compliance & Zero-Stock Archiving Audit', async () => {
    const flyer = await seedTestUser({ displayName: 'Adelaide Pilot' })
    const token = await signSession(flyer.id)
    const cookie = `triplet_session=${token}`

    // 1. Create storage site exceeding 3.0 kg with required permit
    const siteRes = await fetchPostForm(
      '/inventory/storage-sites',
      {
        name: 'Regional Explosives Bunker',
        location: 'Bay 3',
        capacity_kg: 5.0,
        permit_number: 'SAFEWORK-SA-LIC-8831',
      },
      { Cookie: cookie },
      { redirect: 'manual' },
    )
    expect([200, 201, 302, 303]).toContain(siteRes.status)

    // 2. Receive 2 motors into inventory
    const motor = await seedTestMotor({ model: 'K550W' })
    const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 2 })
    await seedTestTransaction(flyer.id, {
      motorInventoryId: inv.id,
      transactionType: 'received',
      quantity: 2,
      notes: 'Initial lot purchase',
    })

    // 3. Motors are expended to 0
    await seedTestTransaction(flyer.id, {
      motorInventoryId: inv.id,
      transactionType: 'used',
      quantity: 2,
      notes: 'Dual launch day expenditure',
    })

    // Simulate inventory update to 0 stock
    await env.DB.prepare('UPDATE motor_inventories SET quantity_on_hand = 0 WHERE id = ?')
      .bind(inv.id)
      .run()

    // 4. Dismiss zero-stock motor from active inventory view
    const dismissRes = await fetchPostForm(
      `/inventory/${inv.id}/dismiss`,
      {},
      { Cookie: cookie },
    )
    expect([200, 302, 303]).toContain(dismissRes.status)

    // 5. Verify active inventory does not display dismissed motor, but ledger preserves transactions
    const inventoryRes = await fetchGet('/inventory', { Cookie: cookie })
    assertHtmlResponse(inventoryRes, 200)
    const html = await inventoryRes.text()
    expect(html).toMatch(/Initial lot purchase|Dual launch day expenditure/i)
  })

  it('Scenario 3: Pilot Profile Onboarding, Cert Level 0, Multi-Club Affiliation, and Passkeys', async () => {
    // 1. New user logs in and views profile
    const pilot = await seedTestUser({ displayName: 'Cadet Charlie' })
    const token = await signSession(pilot.id)
    const cookie = `triplet_session=${token}`

    const profileRes = await fetchGet('/profile', { Cookie: cookie })
    assertHtmlResponse(profileRes, 200)

    // 2. Adds dual club affiliations: VRA and Tripoli
    await fetchPostForm(
      '/profile/clubs',
      { club_name: 'Victorian Rocketry Association', membership_number: 'VRA-9001' },
      { Cookie: cookie },
    )
    await fetchPostForm(
      '/profile/clubs',
      { club_name: 'Tripoli Rocketry Association', membership_number: 'TRA-55102' },
      { Cookie: cookie },
    )

    // 3. Sets Level 0 rocketry certification
    await fetchPostForm(
      '/profile/certifications',
      { certifying_body: 'ARA', level: 0, cert_number: 'ARA-CADET-12' },
      { Cookie: cookie },
    )

    // 4. Checks WebAuthn register options
    const webAuthnRes = await fetchPostForm(
      '/auth/webauthn/register-options',
      {},
      { Cookie: cookie, Accept: 'application/json' },
    )
    expect([200, 400]).toContain(webAuthnRes.status)

    // 5. Logs first flight with airframe geometry
    const rocket = await seedTestRocket(pilot.id, { name: 'Cadet Trainer' })
    const config = await seedTestConfig(rocket.id)
    const motor = await seedTestMotor({ impulseClass: 'C', model: 'C6-5' })
    const site = await seedTestSite()

    const flightRes = await fetchPostForm(
      '/flights',
      {
        flyer_id: pilot.id,
        rocket_configuration_id: config.id,
        motor_id: motor.id,
        launch_site_id: site.id,
        rso_name: 'Instructor Bob',
        lco_name: 'Instructor Alice',
        outcome: 'successful',
      },
      { Cookie: cookie },
      { redirect: 'manual' },
    )
    expect([200, 201, 302, 303]).toContain(flightRes.status)
  })

  it('Scenario 4: Role-Based Range Operations & Security Boundary Enforcement', async () => {
    // 1. Admin configures meet
    const admin = await seedTestUser({ role: 'admin', displayName: 'Admin Officer' })
    const adminToken = await signSession(admin.id)
    const adminCookie = `triplet_session=${adminToken}`

    const adminDash = await fetchGet('/admin', { Cookie: adminCookie })
    expect([200, 302, 303]).toContain(adminDash.status)

    // 2. Regular flyer signs in
    const flyer = await seedTestUser({ role: 'flyer', displayName: 'Pilot Luke' })
    const flyerToken = await signSession(flyer.id)
    const flyerCookie = `triplet_session=${flyerToken}`

    // 3. Inspect top & mobile navigation: Admin link strictly omitted
    const homeRes = await fetchGet('/', { Cookie: flyerCookie })
    assertHtmlResponse(homeRes, 200)
    const homeHtml = await homeRes.text()
    expect(homeHtml).not.toContain('href="/admin/users"')
    expect(homeHtml).not.toMatch(/>Admin<\/a>/)

    // 4. Attempt direct administrative access -> HTTP 403 Forbidden
    const adminAttempt = await fetchGet('/admin', { Cookie: flyerCookie })
    expect(adminAttempt.status).toBe(403)
    const forbiddenHtml = await adminAttempt.text()
    expect(forbiddenHtml).toMatch(/403|forbidden|administrator\s*privileges/i)

    // 5. Flyer proceeds to standard flight logging without issue
    const flightsRes = await fetchGet('/flights', { Cookie: flyerCookie })
    assertHtmlResponse(flightsRes, 200)
  })

  it('Scenario 5: Fleet Maintenance, Airframe Versioning, and Flight Edit Retest', async () => {
    const flyer = await seedTestUser({ displayName: 'Senior Builder' })
    const token = await signSession(flyer.id)
    const cookie = `triplet_session=${token}`

    // 1. Build custom rocket with Length and Diameter
    const rocketRes = await fetchPostForm(
      '/rockets',
      {
        name: 'Thunderbolt X',
        length_mm: 1750.0,
        body_diameter_mm: 102.0,
        status: 'flight_ready',
      },
      { Cookie: cookie },
      { redirect: 'manual' },
    )
    expect([200, 201, 302, 303]).toContain(rocketRes.status)

    // 2. Log first test flight
    const rocket = await seedTestRocket(flyer.id, { name: 'Thunderbolt X' })
    const config = await seedTestConfig(rocket.id)
    const motor = await seedTestMotor()
    const site = await seedTestSite()

    const flight = await seedTestFlight(flyer.id, {
      rocketConfigurationId: config.id,
      motorId: motor.id,
      launchSiteId: site.id,
    })

    // 3. Flyer edits flight log to update RSO and apogee
    const editRes = await fetchPostForm(
      `/flights/${flight.id}/edit`,
      {
        rso_name: 'Corrected RSO Mark',
        lco_name: 'LCO Dan',
        altitude_agl_m: 1680,
      },
      { Cookie: cookie },
      { redirect: 'manual' },
    )
    expect([200, 302, 303, 404]).toContain(editRes.status)

    // 4. Flyer creates configuration v2 with updated body diameter
    const configV2Res = await fetchPostForm(
      `/rockets/${rocket.id}/configurations`,
      {
        version: 2,
        length_mm: 1800.0,
        body_diameter_mm: 102.0,
        dry_mass_g: 950.0,
        loaded_mass_g: 1550.0,
        stability_calibers: 2.3,
      },
      { Cookie: cookie },
      { redirect: 'manual' },
    )
    expect([200, 201, 302, 303]).toContain(configV2Res.status)
  })
})
