/**
 * Integration test suite for Milestone 3 (Requirement R3):
 * Launch Events Plain Text Duty Officers & Non-Destructive Site Creation
 *
 * Covers:
 * 1. Event creation with plain text duty officers (rso_name, lco_name) in D1.
 * 2. HTML form inspection (/events/new, /events/:id/edit) asserting placeholders,
 *    field names, and absence of "Optional User UUID".
 * 3. Prominent display on /events/:id detail view (no "None designated" false negative).
 * 4. Prominent display on /events list view (RSO and LCO badges).
 * 5. Event editing (POST /events/:id/edit, PUT /events/:id) updating duty officers in D1.
 * 6. Non-destructive site creation flow (POST /sites 201 JSON, return_to redirect, /events/new query pre-population).
 * 7. Flight log duty officer autofill integration (R1 + R3 synergy).
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import { signSession } from '../../src/services/auth'
import {
  getDb,
  seedTestConfig,
  seedTestEvent,
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
import { SELF } from 'cloudflare:test'

beforeEach(truncateDb)

describe('Milestone 3 (Requirement R3): Launch Events Plain Text Duty Officers & Non-Destructive Site Creation', () => {
  // ==========================================================================
  // Test 1: Event Creation with Plain Text Duty Officers Persisted to D1
  // ==========================================================================
  describe('Test 1: Event Creation with Plain Text Duty Officers', () => {
    it('persists plain text RSO and LCO names to D1 via form POST without foreign key errors', async () => {
      const site = await seedTestSite({ name: 'Woomera Rocket Range' })

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Autumn Southern Skies Gathering',
          launch_site_id: site.id,
          starts_on: '2026-10-15',
          ends_on: '2026-10-17',
          pad_count: 16,
          launch_director: 'Commander Alan',
          tripoli_prefect: 'Dr. Evelyn',
          rso_name: 'Andrew Buttery',
          lco_name: 'Jerome Pong',
          weather_notes: 'Clear skies with light south-westerly winds',
        },
        {},
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') ?? ''
      expect(location).toMatch(/\/events\/[0-9a-f-]+/i)
      const eventId = location.split('/events/')[1]

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, eventId))

      expect(saved).toBeDefined()
      expect(saved.name).toBe('Autumn Southern Skies Gathering')
      expect(saved.launchSiteId).toBe(site.id)
      expect(saved.rsoName).toBe('Andrew Buttery')
      expect(saved.lcoName).toBe('Jerome Pong')
      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBeNull()
      expect(saved.launchDirector).toBe('Commander Alan')
      expect(saved.tripoliPrefect).toBe('Dr. Evelyn')
    })

    it('persists plain text RSO and LCO names to D1 via JSON POST returning 201', async () => {
      const site = await seedTestSite({ name: 'Lake Tyrrell Salt Flats' })

      const res = await SELF.fetch('https://example.com/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'JSON High Altitude Meet',
          launch_site_id: site.id,
          starts_on: '2026-11-01',
          ends_on: '2026-11-02',
          pad_count: 8,
          rso_name: 'Andrew Buttery',
          lco_name: 'Jerome Pong',
          launch_director: 'Director Marcus',
        }),
      })

      expect(res.status).toBe(201)
      const json = (await res.json()) as any
      expect(json.id).toBeDefined()
      expect(json.rsoName).toBe('Andrew Buttery')
      expect(json.lcoName).toBe('Jerome Pong')
      expect(json.rsoUserId).toBeNull()
      expect(json.lcoUserId).toBeNull()

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, json.id))

      expect(saved.rsoName).toBe('Andrew Buttery')
      expect(saved.lcoName).toBe('Jerome Pong')
    })

    it('creates event with null duty officers when fields are omitted or empty', async () => {
      const site = await seedTestSite({ name: 'Far North Range' })

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Solo Regional Launch',
          launch_site_id: site.id,
          rso_name: '',
          lco_name: '',
        },
        {},
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const eventId = (res.headers.get('location') ?? '').split('/events/')[1]

      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, eventId))

      expect(saved.rsoName).toBeNull()
      expect(saved.lcoName).toBeNull()
    })
  })

  // ==========================================================================
  // Test 2: HTML Form Inspection for /events/new and /events/:id/edit
  // ==========================================================================
  describe('Test 2: HTML Form Inspection (/events/new & /events/:id/edit)', () => {
    it('verifies /events/new has text duty officer inputs, correct placeholders, and NO "Optional User UUID"', async () => {
      await seedTestSite({ name: 'Ballarat Rocket Field' })

      const res = await fetchGet('/events/new')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Must NOT contain UUID prompt
      assertNotContains(html, 'Optional User UUID')
      assertNotContains(html, 'RSO User ID')
      assertNotContains(html, 'LCO User ID')

      // Must contain plain text officer inputs with descriptive placeholders
      assertHasFormField(html, 'rso_name')
      assertHasFormField(html, 'lco_name')
      assertContains(html, 'placeholder="e.g. Andrew Buttery"')
      assertContains(html, 'placeholder="e.g. Jerome Pong"')
      assertContains(html, 'Range Safety Officer (RSO)')
      assertContains(html, 'Launch Control Officer (LCO)')

      // Must also preserve hidden rso_user_id and lco_user_id for backwards compatibility
      assertHasFormField(html, 'rso_user_id')
      assertHasFormField(html, 'lco_user_id')
    })

    it('verifies /events/:id/edit pre-populates existing plain text officers and contains correct placeholders', async () => {
      const site = await seedTestSite({ name: 'Geelong Airfield' })
      const event = await seedTestEvent(site.id, {
        name: 'Pre-filled Meet',
        rsoName: 'Andrew Buttery',
        lcoName: 'Jerome Pong',
      })

      const res = await fetchGet(`/events/${event.id}/edit`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertNotContains(html, 'Optional User UUID')
      assertHasFormField(html, 'rso_name')
      assertHasFormField(html, 'lco_name')

      // Value pre-population
      expect(html).toMatch(/name=["']rso_name["'][^>]*value=["']Andrew Buttery["']/i)
      expect(html).toMatch(/name=["']lco_name["'][^>]*value=["']Jerome Pong["']/i)

      // Placeholders
      assertContains(html, 'placeholder="e.g. Andrew Buttery"')
      assertContains(html, 'placeholder="e.g. Jerome Pong"')
    })
  })

  // ==========================================================================
  // Test 3: Prominent Display on /events/:id Detail View
  // ==========================================================================
  describe('Test 3: Prominent Display on /events/:id', () => {
    it('renders plain text officer names prominently and does NOT say "None designated"', async () => {
      const site = await seedTestSite({ name: 'Lucerne Dry Lake' })
      const event = await seedTestEvent(site.id, {
        name: 'High Desert Gathering',
        rsoName: 'Andrew Buttery',
        lcoName: 'Jerome Pong',
        launchDirector: 'Gene Kranz',
        tripoliPrefect: 'Chris Kraft',
      })

      const res = await fetchGet(`/events/${event.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('High Desert Gathering')
      expect(html).toContain('Lucerne Dry Lake')
      expect(html).toContain('Gene Kranz')
      expect(html).toContain('Chris Kraft')
      expect(html).toContain('Andrew Buttery')
      expect(html).toContain('Jerome Pong')

      // Ensure "None designated" is NOT displayed for RSO or LCO
      expect(html).not.toMatch(/RSO:[\s\S]*?None designated/)
      expect(html).not.toMatch(/LCO:[\s\S]*?None designated/)

      // Verify JSON detail representation
      const jsonRes = await fetchGet(`/events/${event.id}`, {
        Accept: 'application/json',
      })
      expect(jsonRes.status).toBe(200)
      const data = (await jsonRes.json()) as any
      expect(data.event.rsoName).toBe('Andrew Buttery')
      expect(data.event.lcoName).toBe('Jerome Pong')
    })

    it('renders "None designated" when duty officers are not set', async () => {
      const site = await seedTestSite({ name: 'Desert Field' })
      const event = await seedTestEvent(site.id, {
        name: 'Unstaffed Practice Day',
        rsoName: null,
        lcoName: null,
        rsoUserId: null,
        lcoUserId: null,
      })

      const res = await fetchGet(`/events/${event.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('None designated')
    })

    it('returns rsoName and lcoName in JSON GET /events/:id endpoint', async () => {
      const site = await seedTestSite({ name: 'JSON Event Range' })
      const event = await seedTestEvent(site.id, {
        name: 'JSON Officers Range Day',
        rsoName: 'Andrew Buttery',
        lcoName: 'Jerome Pong',
      })

      const jsonRes = await fetchGet(`/events/${event.id}`, {
        Accept: 'application/json',
      })
      expect(jsonRes.status).toBe(200)
      const data = (await jsonRes.json()) as any
      expect(data.event.rsoName).toBe('Andrew Buttery')
      expect(data.event.lcoName).toBe('Jerome Pong')
    })
  })

  // ==========================================================================
  // Test 4: Prominent Display on /events List View
  // ==========================================================================
  describe('Test 4: Prominent Display on /events List View', () => {
    it('renders RSO and LCO badges on event cards in the list view', async () => {
      const site = await seedTestSite({ name: 'Flinders Ranges Launch Site' })
      await seedTestEvent(site.id, {
        name: 'Flinders Cup 2026',
        startsOn: '2026-12-01',
        rsoName: 'Andrew Buttery',
        lcoName: 'Jerome Pong',
      })

      const res = await fetchGet('/events')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('Flinders Cup 2026')
      expect(html).toContain('RSO: Andrew Buttery')
      expect(html).toContain('LCO: Jerome Pong')

      // Badge markup check
      expect(html).toMatch(/<span[^>]*>RSO:\s*Andrew Buttery<\/span>/i)
      expect(html).toMatch(/<span[^>]*>LCO:\s*Jerome Pong<\/span>/i)
    })
  })

  // ==========================================================================
  // Test 5: Event Editing (POST /events/:id/edit & PUT /events/:id)
  // ==========================================================================
  describe('Test 5: Event Editing (Form POST & JSON PUT)', () => {
    it('updates duty officers to new plain text names via POST /events/:id/edit', async () => {
      const site = await seedTestSite({ name: 'Site Alpha' })
      const event = await seedTestEvent(site.id, {
        name: 'Initial Officers Meet',
        rsoName: 'Andrew Buttery',
        lcoName: 'Jerome Pong',
      })

      const res = await fetchPostForm(
        `/events/${event.id}/edit`,
        {
          name: 'Updated Officers Meet',
          launch_site_id: site.id,
          rso_name: 'Sarah Connor',
          lco_name: 'John Connor',
        },
        {},
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      expect(res.headers.get('location')).toBe(`/events/${event.id}`)

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, event.id))

      expect(updated.name).toBe('Updated Officers Meet')
      expect(updated.rsoName).toBe('Sarah Connor')
      expect(updated.lcoName).toBe('John Connor')
    })

    it('updates duty officers to new plain text names via PUT /events/:id JSON API', async () => {
      const site = await seedTestSite({ name: 'Site Beta' })
      const event = await seedTestEvent(site.id, {
        name: 'Original Meet',
        rsoName: 'Sarah Connor',
        lcoName: 'John Connor',
      })

      const res = await SELF.fetch(`https://example.com/events/${event.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'Aliens Weyland Launch',
          launch_site_id: site.id,
          rso_name: 'Ellen Ripley',
          lco_name: 'Dwayne Hicks',
        }),
      })

      expect(res.status).toBe(200)
      const json = (await res.json()) as any
      expect(json.rsoName).toBe('Ellen Ripley')
      expect(json.lcoName).toBe('Dwayne Hicks')

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, event.id))

      expect(updated.rsoName).toBe('Ellen Ripley')
      expect(updated.lcoName).toBe('Dwayne Hicks')
    })

    it('clears duty officers in D1 when submitted as empty strings', async () => {
      const site = await seedTestSite({ name: 'Site Gamma' })
      const event = await seedTestEvent(site.id, {
        name: 'Staffed Meet',
        rsoName: 'Andrew Buttery',
        lcoName: 'Jerome Pong',
      })

      const res = await fetchPostForm(
        `/events/${event.id}/edit`,
        {
          name: 'De-staffed Meet',
          launch_site_id: site.id,
          rso_name: '',
          lco_name: '',
        },
        {},
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, event.id))

      expect(updated.rsoName).toBeNull()
      expect(updated.lcoName).toBeNull()
    })
  })

  // ==========================================================================
  // Test 6: Non-Destructive Site Creation Flow
  // ==========================================================================
  describe('Test 6: Non-Destructive Site Creation Flow', () => {
    it('returns HTTP 201 with site JSON when creating site via JSON payload (AJAX Modal path)', async () => {
      const res = await SELF.fetch('https://example.com/sites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'Lake Hart Salt Flats',
          latitude: -31.2,
          longitude: 136.4,
          max_altitude_agl_m: 15000,
          notes: 'High altitude salt lake',
        }),
      })

      expect(res.status).toBe(201)
      const json = (await res.json()) as any
      expect(json.id).toBeDefined()
      expect(json.name).toBe('Lake Hart Salt Flats')
      expect(json.latitude).toBeCloseTo(-31.2)
      expect(json.longitude).toBeCloseTo(136.4)
      expect(json.maxAltitudeAglM).toBe(15000)

      const db = getDb()
      const [site] = await db
        .select()
        .from(schema.launchSites)
        .where(eq(schema.launchSites.id, json.id))
      expect(site).toBeDefined()
    })

    it('redirects back to /events/new with launch_site_id query param when return_to is specified', async () => {
      const res = await fetchPostForm(
        '/sites',
        {
          name: 'Koonibba Test Range',
          latitude: 32.5,
          longitude: 134.1,
          max_altitude_agl_m: 80000,
          return_to: '/events/new',
        },
        {},
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') ?? ''
      expect(location).toMatch(/\/events\/new\?launch_site_id=[0-9a-f-]+/i)

      const siteId = location.split('launch_site_id=')[1].split('&')[0]
      const db = getDb()
      const [site] = await db
        .select()
        .from(schema.launchSites)
        .where(eq(schema.launchSites.id, siteId))
      expect(site.name).toBe('Koonibba Test Range')
    })

    it('pre-populates all form inputs on /events/new from query parameters preserving form state', async () => {
      const site = await seedTestSite({ name: 'Preserved Test Field' })

      const queryParams = new URLSearchParams({
        launch_site_id: site.id,
        name: 'Southern Cross Spectacular',
        rso_name: 'Andrew Buttery',
        lco_name: 'Jerome Pong',
        starts_on: '2026-11-20',
        ends_on: '2026-11-22',
        pad_count: '18',
        launch_director: 'Gene Kranz',
        tripoli_prefect: 'Chris Kraft',
        weather_notes: 'Clear skies and low humidity',
      })

      const res = await fetchGet(`/events/new?${queryParams.toString()}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Selected site
      expect(html).toContain(`value="${site.id}"`)
      expect(html).toMatch(new RegExp(`<option[^>]*value=["']${site.id}["'][^>]*selected`, 'i'))

      // Inputs pre-filled with state
      expect(html).toMatch(/name=["']name["'][^>]*value=["']Southern Cross Spectacular["']/i)
      expect(html).toMatch(/name=["']rso_name["'][^>]*value=["']Andrew Buttery["']/i)
      expect(html).toMatch(/name=["']lco_name["'][^>]*value=["']Jerome Pong["']/i)
      expect(html).toMatch(/name=["']starts_on["'][^>]*value=["']2026-11-20["']/i)
      expect(html).toMatch(/name=["']ends_on["'][^>]*value=["']2026-11-22["']/i)
      expect(html).toMatch(/name=["']pad_count["'][^>]*value=["']18["']/i)
      expect(html).toMatch(/name=["']launch_director["'][^>]*value=["']Gene Kranz["']/i)
      expect(html).toMatch(/name=["']tripoli_prefect["'][^>]*value=["']Chris Kraft["']/i)
      expect(html).toContain('Clear skies and low humidity')
    })

    it('renders inline <dialog id="new-site-modal"> on /events/new for zero-data-loss creation', async () => {
      const res = await fetchGet('/events/new')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('id="new-site-modal"')
      expect(html).toContain('modal_site_name')
      expect(html).toContain('modal_site_lat')
      expect(html).toContain('modal_site_lng')
      expect(html).toContain('modal_site_max_alt')
      expect(html).toContain('modal-submit-site-btn')
    })
  })

  // ==========================================================================
  // Test 7: Flight Log Duty Officer Autofill Integration (R1 + R3 Synergy)
  // ==========================================================================
  describe('Test 7: Flight Log Duty Officer Autofill Integration (R1 + R3 Synergy)', () => {
    it('automatically populates flight form RSO and LCO when launch_event_id is provided', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestSite({ name: 'Launch Site Alpha' })
      const event = await seedTestEvent(site.id, {
        name: 'Synergy Launch Meet',
        rsoName: 'Andrew Buttery',
        lcoName: 'Jerome Pong',
      })

      const res = await fetchGet(`/flights/new?launch_event_id=${event.id}`, {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Inputs exist
      assertHasFormField(html, 'rso_name')
      assertHasFormField(html, 'lco_name')

      // Populated with event's plain text duty officers
      expect(html).toMatch(/name=["']rso_name["'][^>]*value=["']Andrew Buttery["']/i)
      expect(html).toMatch(/name=["']lco_name["'][^>]*value=["']Jerome Pong["']/i)

      // Event select option contains data-rso and data-lco
      expect(html).toContain(`value="${event.id}"`)
      expect(html).toContain('data-rso="Andrew Buttery"')
      expect(html).toContain('data-lco="Jerome Pong"')
    })

    it('allows flyer to manually override duty officers when logging a flight for an event', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()
      const event = await seedTestEvent(site.id, {
        name: 'Two-Shift Meet',
        rsoName: 'Andrew Buttery',
        lcoName: 'Jerome Pong',
      })

      // Flyer logs flight for event but overrides duty officers for mid-day shift rotation
      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          launch_site_id: site.id,
          launch_event_id: event.id,
          motor_id: motor.id,
          log_type: 'actual',
          outcome: 'GOOD',
          rso_name: 'Shift Two RSO Alice',
          lco_name: 'Shift Two LCO Bob',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const flightId = (res.headers.get('location') ?? '').split('/flights/')[1]

      const db = getDb()
      const [flight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flightId))

      expect(flight.rsoName).toBe('Shift Two RSO Alice')
      expect(flight.lcoName).toBe('Shift Two LCO Bob')

      // Verify event record remained unaltered
      const [savedEvent] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, event.id))

      expect(savedEvent.rsoName).toBe('Andrew Buttery')
      expect(savedEvent.lcoName).toBe('Jerome Pong')
    })
  })
})
