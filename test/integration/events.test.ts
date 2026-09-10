/**
 * Integration test suite for Milestone 1:
 * Requirement R1: Launch Events Usability & Full Editing
 *
 * Covers:
 * 1. Past Event Visibility & Categorization:
 *    - Partition list into Upcoming and Past sections
 *    - Date status badges: "Upcoming", "Active Today", "Past Meet"
 *    - Filter tabs: ?tab=all, ?tab=upcoming, ?tab=past
 *    - Chronological sorting (upcoming asc, past desc)
 *    - "✏️ Edit Event" action links on cards
 * 2. Event Editing Workflow:
 *    - GET /events/:id/edit: renders pre-filled form with current attributes
 *    - POST /events/:id/edit: updates D1 database, sanitizes officers, redirects 303
 *    - PUT /events/:id: updates D1 database, returns 200 JSON
 *    - Validation errors (missing name, invalid site, 404 on missing event)
 *    - "✏️ Edit Event" button in GET /events/:id detail view
 * 3. Flight Event Selectability:
 *    - GET /flights/new & GET /flights/:id/edit dropdown options
 *    - Options formatted as: ${name} (${dateText}) — ${siteName}
 *    - Both past and upcoming events selectable
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import { signSession } from '../../src/services/auth'
import {
  getDb,
  seedTestEvent,
  seedTestFlight,
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
import { SELF } from 'cloudflare:test'

beforeEach(truncateDb)

describe('Milestone 1 (R1): Launch Events Usability & Full Editing', () => {
  const today = new Date().toISOString().slice(0, 10)

  describe('1. Past Event Visibility & Filtering (/events)', () => {
    it('renders empty state when no events exist', async () => {
      const res = await fetchGet('/events')
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toContain('No Launch Events Scheduled')
      expect(html).toContain('Schedule Event')
    })

    it('partitions events into Upcoming and Past sections with status badges and edit links', async () => {
      const site = await seedTestSite({ name: 'Woomera Test Range' })

      const pastEvent = await seedTestEvent(site.id, {
        name: 'Woomera Past Gathering 2020',
        startsOn: '2020-04-10',
        endsOn: '2020-04-12',
        padCount: 8,
      })

      const upcomingEvent = await seedTestEvent(site.id, {
        name: 'Woomera Future Meet 2028',
        startsOn: '2028-10-01',
        endsOn: '2028-10-03',
        padCount: 16,
      })

      const activeEvent = await seedTestEvent(site.id, {
        name: 'Active Meet Today',
        startsOn: today,
        endsOn: today,
        padCount: 12,
      })

      const res = await fetchGet('/events')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Section headings
      expect(html).toContain('Upcoming Launches')
      expect(html).toContain('Past Launch Meets / Archive')

      // Events present
      expect(html).toContain('Woomera Past Gathering 2020')
      expect(html).toContain('Woomera Future Meet 2028')
      expect(html).toContain('Active Meet Today')

      // Status badges
      expect(html).toContain('Past Meet')
      expect(html).toContain('Upcoming')
      expect(html).toContain('Active Today')

      // Tab navigation
      expect(html).toContain('/events?tab=all')
      expect(html).toContain('/events?tab=upcoming')
      expect(html).toContain('/events?tab=past')

      // Edit links on cards
      expect(html).toContain(`/events/${pastEvent.id}/edit`)
      expect(html).toContain(`/events/${upcomingEvent.id}/edit`)
      expect(html).toContain(`/events/${activeEvent.id}/edit`)
    })

    it('respects ?tab=upcoming query param by rendering only upcoming section', async () => {
      const site = await seedTestSite({ name: 'Lake Tyrrell' })
      await seedTestEvent(site.id, {
        name: 'Past Meet 2019',
        startsOn: '2019-01-01',
        endsOn: '2019-01-02',
      })
      await seedTestEvent(site.id, {
        name: 'Future Meet 2029',
        startsOn: '2029-05-15',
        endsOn: '2029-05-17',
      })

      const res = await fetchGet('/events?tab=upcoming')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('Upcoming Launches')
      expect(html).toContain('Future Meet 2029')
      expect(html).not.toContain('Past Launch Meets / Archive')
      expect(html).not.toContain('Past Meet 2019')
    })

    it('respects ?tab=past query param by rendering only past section', async () => {
      const site = await seedTestSite({ name: 'Lake Tyrrell' })
      await seedTestEvent(site.id, {
        name: 'Historical Launch 2018',
        startsOn: '2018-06-01',
        endsOn: '2018-06-02',
      })
      await seedTestEvent(site.id, {
        name: 'Upcoming Gathering 2030',
        startsOn: '2030-08-01',
        endsOn: '2030-08-03',
      })

      const res = await fetchGet('/events?tab=past')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('Past Launch Meets / Archive')
      expect(html).toContain('Historical Launch 2018')
      expect(html).not.toContain('Upcoming Launches')
      expect(html).not.toContain('Upcoming Gathering 2030')
    })

    it('sorts upcoming events ascending and past events descending by date', async () => {
      const site = await seedTestSite({ name: 'Ascot Range' })
      await seedTestEvent(site.id, {
        name: 'Future Later 2028-12',
        startsOn: '2028-12-01',
        endsOn: '2028-12-02',
      })
      await seedTestEvent(site.id, {
        name: 'Future Sooner 2028-06',
        startsOn: '2028-06-01',
        endsOn: '2028-06-02',
      })
      await seedTestEvent(site.id, {
        name: 'Past Older 2019',
        startsOn: '2019-01-01',
        endsOn: '2019-01-02',
      })
      await seedTestEvent(site.id, {
        name: 'Past Recent 2024',
        startsOn: '2024-01-01',
        endsOn: '2024-01-02',
      })

      const res = await fetchGet('/events')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      const posSooner = html.indexOf('Future Sooner 2028-06')
      const posLater = html.indexOf('Future Later 2028-12')
      expect(posSooner).toBeLessThan(posLater)

      const posRecent = html.indexOf('Past Recent 2024')
      const posOlder = html.indexOf('Past Older 2019')
      expect(posRecent).toBeLessThan(posOlder)
    })
  })

  describe('2. Event Editing Workflow (GET/POST /events/:id/edit, PUT /events/:id)', () => {
    it('renders GET /events/:id/edit with pre-filled event fields', async () => {
      const site = await seedTestSite({ name: 'Lucerne Dry Lake' })
      const event = await seedTestEvent(site.id, {
        name: 'Spring Launch Fiesta',
        startsOn: '2026-05-10',
        endsOn: '2026-05-12',
        padCount: 20,
        launchDirector: 'Sarah Connor',
        tripoliPrefect: 'John Matrix',
        weatherNotes: 'Clear skies with light southwesterly breeze',
      })

      const res = await fetchGet(`/events/${event.id}/edit`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertHasFormField(html, 'name')
      assertHasFormField(html, 'launch_site_id')
      assertHasFormField(html, 'starts_on')
      assertHasFormField(html, 'ends_on')
      assertHasFormField(html, 'pad_count')
      assertHasFormField(html, 'launch_director')
      assertHasFormField(html, 'tripoli_prefect')
      assertHasFormField(html, 'weather_notes')

      expect(html).toContain('Spring Launch Fiesta')
      expect(html).toContain('2026-05-10')
      expect(html).toContain('2026-05-12')
      expect(html).toContain('Sarah Connor')
      expect(html).toContain('John Matrix')
      expect(html).toContain('Clear skies with light southwesterly breeze')
      expect(html).toContain(`action="/events/${event.id}/edit"`)
    })

    it('returns 404 when requesting edit form for non-existent event', async () => {
      const res = await fetchGet('/events/non-existent-uuid/edit')
      expect(res.status).toBe(404)
    })

    it('updates event via POST /events/:id/edit and redirects 303 to /events/:id', async () => {
      const site1 = await seedTestSite({ name: 'Initial Field' })
      const site2 = await seedTestSite({ name: 'Updated Field' })
      const rso = await seedTestUser({ displayName: 'Officer Tom' })

      const event = await seedTestEvent(site1.id, {
        name: 'Original Meet Name',
        startsOn: '2026-06-01',
        endsOn: '2026-06-02',
        padCount: 5,
      })

      const res = await fetchPostForm(
        `/events/${event.id}/edit`,
        {
          name: 'Renamed Championship Launch',
          launch_site_id: site2.id,
          starts_on: '2026-06-05',
          ends_on: '2026-06-07',
          padCount: 15,
          launch_director: 'Commander Shepard',
          tripoli_prefect: 'Liara TSoni',
          rso_user_id: rso.id,
          weather_notes: 'Gusty morning clearing by midday',
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

      expect(updated.name).toBe('Renamed Championship Launch')
      expect(updated.launchSiteId).toBe(site2.id)
      expect(updated.startsOn).toBe('2026-06-05')
      expect(updated.endsOn).toBe('2026-06-07')
      expect(updated.padCount).toBe(15)
      expect(updated.launchDirector).toBe('Commander Shepard')
      expect(updated.tripoliPrefect).toBe('Liara TSoni')
      expect(updated.rsoUserId).toBe(rso.id)
      expect(updated.weatherNotes).toBe('Gusty morning clearing by midday')
    })

    it('sanitizes empty string officer IDs to null without FK violation', async () => {
      const site = await seedTestSite({ name: 'Lucerne Valley' })
      const user = await seedTestUser({ displayName: 'Initial RSO' })
      const event = await seedTestEvent(site.id, {
        name: 'Meet with RSO',
        rsoUserId: user.id,
      })

      const res = await fetchPostForm(
        `/events/${event.id}/edit`,
        {
          name: 'Meet without RSO',
          launch_site_id: site.id,
          rso_user_id: '',
          lco_user_id: '',
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

      expect(updated.rsoUserId).toBeNull()
      expect(updated.lcoUserId).toBeNull()
    })

    it('updates event via PUT /events/:id with JSON payload', async () => {
      const site = await seedTestSite({ name: 'Site Alpha' })
      const event = await seedTestEvent(site.id, {
        name: 'JSON Target Event',
      })

      const res = await SELF.fetch(`https://example.com/events/${event.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'Updated via JSON API',
          launch_site_id: site.id,
          pad_count: 32,
          launch_director: 'Director Marcus',
        }),
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveProperty('name', 'Updated via JSON API')
      expect(data).toHaveProperty('padCount', 32)
      expect(data).toHaveProperty('launchDirector', 'Director Marcus')
    })

    it('rejects update with 400 when event name is empty', async () => {
      const site = await seedTestSite({ name: 'Site Beta' })
      const event = await seedTestEvent(site.id, { name: 'Valid Event' })

      const res = await fetchPostForm(
        `/events/${event.id}/edit`,
        {
          name: '',
          launch_site_id: site.id,
        },
      )
      expect(res.status).toBe(400)
    })

    it('renders "✏️ Edit Event" button in GET /events/:id detail header', async () => {
      const site = await seedTestSite({ name: 'FAR Test Range' })
      const event = await seedTestEvent(site.id, { name: 'FAR Annual Launch' })

      const res = await fetchGet(`/events/${event.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain(`/events/${event.id}/edit`)
      expect(html).toMatch(/Edit Event/i)
      expect(html).toContain('+ Log Flight at Event')
    })
  })

  describe('3. Flight Event Selectability (/flights/new, /flights/:id/edit)', () => {
    it('renders event dropdown option formatted as ${name} (${dateText}) — ${siteName}', async () => {
      const flyer = await seedTestUser({ displayName: 'Flyer Alice' })
      const token = await signSession(flyer.id)
      const site = await seedTestSite({ name: 'Serpentine Airfield' })

      const pastEvt = await seedTestEvent(site.id, {
        name: 'Spring Opener 2021',
        startsOn: '2021-09-01',
        endsOn: '2021-09-03',
      })

      const singleDayEvt = await seedTestEvent(site.id, {
        name: 'One-Day Blitz 2028',
        startsOn: '2028-05-20',
        endsOn: '2028-05-20',
      })

      const res = await fetchGet('/flights/new', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('Spring Opener 2021 (2021-09-01 to 2021-09-03) — Serpentine Airfield')
      expect(html).toContain('One-Day Blitz 2028 (2028-05-20) — Serpentine Airfield')
    })

    it('renders formatted event options in GET /flights/:id/edit form', async () => {
      const flyer = await seedTestUser({ displayName: 'Flyer Bob' })
      const token = await signSession(flyer.id)
      const site = await seedTestSite({ name: 'Lake Tyrrell South' })
      const rocket = await seedTestRocket(flyer.id, { name: 'Falcon Scout' })

      const event = await seedTestEvent(site.id, {
        name: 'National Rocketry Gathering',
        startsOn: '2026-11-10',
        endsOn: '2026-11-12',
      })

      const flight = await seedTestFlight(flyer.id, {
        launchEventId: event.id,
        launchSiteId: site.id,
      })

      const res = await fetchGet(`/flights/${flight.id}/edit`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('National Rocketry Gathering (2026-11-10 to 2026-11-12) — Lake Tyrrell South')
    })
  })
})
