/**
 * Adversarial Challenger Test Suite for Milestone 1:
 * Launch Events Usability & Full Editing (R1)
 *
 * Adversarially stress tests:
 * 1. Nonexistent event ID & 404 resilience (HTML & JSON, path oddities)
 * 2. Clearing & sanitizing officers (FK constraint resilience, null safety, non-existent user IDs)
 * 3. Event date transitions & boundary partitions (today, yesterday, tomorrow, multi-day, TBD)
 * 4. Flight form & event views resilience when launch site is null/orphaned
 * 5. Form validation, long strings, special characters, and XSS escaping
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { env, SELF } from 'cloudflare:test'
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
import { preflightFormView } from '../../src/views/flights'

beforeEach(truncateDb)

describe('Adversarial Challenger M1: Launch Events Usability & Editing', () => {
  // Generate ISO date strings relative to today (YYYY-MM-DD)
  const now = new Date()
  const toIsoDate = (d: Date) => d.toISOString().slice(0, 10)

  const todayStr = toIsoDate(now)

  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const yesterdayStr = toIsoDate(yesterdayDate)

  const twoDaysAgoDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
  const twoDaysAgoStr = toIsoDate(twoDaysAgoDate)

  const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const tomorrowStr = toIsoDate(tomorrowDate)

  const dayAfterTomorrowDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)
  const dayAfterTomorrowStr = toIsoDate(dayAfterTomorrowDate)

  // =========================================================================
  // 1. Nonexistent Event ID & 404 Resilience
  // =========================================================================
  describe('1. Nonexistent Event ID & 404 Resilience', () => {
    it('returns 404 HTML error page when requesting GET /events/:id/edit for missing event', async () => {
      const res = await fetchGet('/events/00000000-0000-0000-0000-000000000000/edit')
      expect(res.status).toBe(404)
      const html = await res.text()
      expect(html).toContain('Event Not Found')
      expect(html).toContain('Back to all launch events')
    })

    it('returns 404 JSON when requesting GET /events/:id/edit with Accept: application/json', async () => {
      const res = await fetchGet('/events/00000000-0000-0000-0000-000000000000/edit', {
        Accept: 'application/json',
      })
      expect(res.status).toBe(404)
      const data = (await res.json()) as any
      expect(data).toHaveProperty('error', 'Launch event not found')
    })

    it('returns 404 when attempting POST /events/:id/edit on nonexistent event with valid form payload', async () => {
      const site = await seedTestSite({ name: 'Valid Site' })
      const res = await fetchPostForm(
        '/events/00000000-0000-0000-0000-000000000000/edit',
        {
          name: 'Update Ghost Event',
          launch_site_id: site.id,
        },
      )
      expect(res.status).toBe(404)
      const html = await res.text()
      expect(html).toContain('Event Not Found')
    })

    it('returns 404 JSON when attempting PUT /events/:id on nonexistent event with valid JSON', async () => {
      const site = await seedTestSite({ name: 'Valid Site' })
      const res = await SELF.fetch('https://example.com/events/00000000-0000-0000-0000-000000000000', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'Update Ghost Event',
          launch_site_id: site.id,
        }),
      })
      expect(res.status).toBe(404)
      const data = (await res.json()) as any
      expect(data).toHaveProperty('error', 'Launch event not found')
    })

    it('returns 400 when attempting update on nonexistent event with invalid/missing name before DB lookup', async () => {
      const site = await seedTestSite({ name: 'Valid Site' })
      const res = await fetchPostForm(
        '/events/00000000-0000-0000-0000-000000000000/edit',
        {
          name: '',
          launch_site_id: site.id,
        },
      )
      expect(res.status).toBe(400)
    })

    it('handles bizarre and malformed event IDs without 500 crashes', async () => {
      const maliciousIds = [
        'not-a-valid-uuid',
        '../../etc/passwd',
        '<script>alert(1)</script>',
        '--DROP TABLE launch_events;',
        'id-with-spaces and special %20 characters',
      ]

      for (const badId of maliciousIds) {
        const resGet = await fetchGet(`/events/${encodeURIComponent(badId)}/edit`)
        expect([400, 404]).toContain(resGet.status)

        const resPut = await SELF.fetch(`https://example.com/events/${encodeURIComponent(badId)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            name: 'Attempted Exploitation',
            launch_site_id: 'some-site',
          }),
        })
        expect([400, 404]).toContain(resPut.status)
      }
    })
  })

  // =========================================================================
  // 2. Clearing & Sanitizing Officers (FK Constraint Resilience)
  // =========================================================================
  describe('2. Clearing & Sanitizing Officers (FK Constraint Resilience)', () => {
    it('clears all officer fields when submitted as empty strings via form POST', async () => {
      const site = await seedTestSite({ name: 'Officer Test Range' })
      const rso = await seedTestUser({ displayName: 'Officer Alice' })
      const lco = await seedTestUser({ displayName: 'Officer Bob' })

      const event = await seedTestEvent(site.id, {
        name: 'Fully Staffed Event',
        rsoUserId: rso.id,
        lcoUserId: lco.id,
        launchDirector: 'Director Dave',
        tripoliPrefect: 'Prefect Patricia',
      })

      // Update and clear all officer fields
      const res = await fetchPostForm(
        `/events/${event.id}/edit`,
        {
          name: 'Fully Staffed Event',
          launch_site_id: site.id,
          rso_user_id: '',
          lco_user_id: '',
          launch_director: '',
          tripoli_prefect: '',
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

      expect(updated.rsoUserId).toBeNull()
      expect(updated.lcoUserId).toBeNull()
      expect(updated.launchDirector).toBeNull()
      expect(updated.tripoliPrefect).toBeNull()
    })

    it('clears officer fields when submitted with whitespace-only strings', async () => {
      const site = await seedTestSite({ name: 'Whitespace Test Range' })
      const rso = await seedTestUser({ displayName: 'Officer Charlie' })

      const event = await seedTestEvent(site.id, {
        name: 'Meet With RSO',
        rsoUserId: rso.id,
        launchDirector: 'Director Dan',
      })

      const res = await fetchPostForm(
        `/events/${event.id}/edit`,
        {
          name: 'Meet With RSO',
          launch_site_id: site.id,
          rso_user_id: '    ',
          lco_user_id: '\t\n ',
          launch_director: '   ',
          tripoli_prefect: ' \t ',
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
      expect(updated.launchDirector).toBeNull()
      expect(updated.tripoliPrefect).toBeNull()
    })

    it('clears officer fields when passed explicit nulls in PUT JSON update', async () => {
      const site = await seedTestSite({ name: 'JSON Officer Range' })
      const rso = await seedTestUser({ displayName: 'RSO User' })

      const event = await seedTestEvent(site.id, {
        name: 'JSON Staffed Event',
        rsoUserId: rso.id,
        launchDirector: 'Director Alpha',
        tripoliPrefect: 'Prefect Omega',
      })

      const res = await SELF.fetch(`https://example.com/events/${event.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'JSON Cleared Staff',
          launch_site_id: site.id,
          rso_user_id: null,
          lco_user_id: null,
          launch_director: null,
          tripoli_prefect: null,
        }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.rsoUserId).toBeNull()
      expect(data.lcoUserId).toBeNull()
      expect(data.launchDirector).toBeNull()
      expect(data.tripoliPrefect).toBeNull()

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, event.id))

      expect(updated.rsoUserId).toBeNull()
      expect(updated.lcoUserId).toBeNull()
      expect(updated.launchDirector).toBeNull()
      expect(updated.tripoliPrefect).toBeNull()
    })

    it('sanitizes non-existent officer user UUIDs to null without triggering FK constraint violation', async () => {
      const site = await seedTestSite({ name: 'FK Safety Range' })
      const event = await seedTestEvent(site.id, {
        name: 'FK Injection Target',
      })

      const nonExistentRsoId = crypto.randomUUID()
      const nonExistentLcoId = crypto.randomUUID()

      // Attempt POST update with unknown user UUIDs
      const res = await fetchPostForm(
        `/events/${event.id}/edit`,
        {
          name: 'FK Injection Handled',
          launch_site_id: site.id,
          rso_user_id: nonExistentRsoId,
          lco_user_id: nonExistentLcoId,
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

      // Foreign keys must have been sanitized to null rather than failing with 500 SQLite FK constraint
      expect(updated.rsoUserId).toBeNull()
      expect(updated.lcoUserId).toBeNull()
    })
  })

  // =========================================================================
  // 3. Event Date Transitions & Boundary Partitions
  // =========================================================================
  describe('3. Event Date Transitions & Boundary Partitions', () => {
    it('correctly partitions events ending yesterday vs today vs tomorrow', async () => {
      const site = await seedTestSite({ name: 'Temporal Range' })

      // 1. Ended yesterday (multi-day: 2 days ago to yesterday)
      const endedYesterday = await seedTestEvent(site.id, {
        name: 'Ended Yesterday Multi',
        startsOn: twoDaysAgoStr,
        endsOn: yesterdayStr,
      })

      // 2. Single-day yesterday
      const singleDayYesterday = await seedTestEvent(site.id, {
        name: 'Ended Yesterday Single',
        startsOn: yesterdayStr,
        endsOn: yesterdayStr,
      })

      // 3. Single-day yesterday with null endsOn
      const yesterdayNullEnd = await seedTestEvent(site.id, {
        name: 'Ended Yesterday Null End',
        startsOn: yesterdayStr,
        endsOn: null,
      })

      // 4. Active today (started yesterday, ends today)
      const endingToday = await seedTestEvent(site.id, {
        name: 'Ending Today Meet',
        startsOn: yesterdayStr,
        endsOn: todayStr,
      })

      // 5. Active today (single day today)
      const singleDayToday = await seedTestEvent(site.id, {
        name: 'Single Day Today Meet',
        startsOn: todayStr,
        endsOn: todayStr,
      })

      // 6. Active today (started today, ends tomorrow)
      const startingToday = await seedTestEvent(site.id, {
        name: 'Starting Today Meet',
        startsOn: todayStr,
        endsOn: tomorrowStr,
      })

      // 7. Active today (spans today: starts yesterday, ends tomorrow)
      const spanningToday = await seedTestEvent(site.id, {
        name: 'Spanning Today Meet',
        startsOn: yesterdayStr,
        endsOn: tomorrowStr,
      })

      // 8. Future event starting tomorrow
      const startingTomorrow = await seedTestEvent(site.id, {
        name: 'Starting Tomorrow Meet',
        startsOn: tomorrowStr,
        endsOn: dayAfterTomorrowStr,
      })

      // 9. Undated meet (TBD)
      const undatedEvent = await seedTestEvent(site.id, {
        name: 'Date TBD Meet',
        startsOn: null,
        endsOn: null,
      })

      // Test default view: /events?tab=all
      const resAll = await fetchGet('/events')
      assertHtmlResponse(resAll, 200)
      const htmlAll = await resAll.text()

      // All 9 events must be present
      expect(htmlAll).toContain('Ended Yesterday Multi')
      expect(htmlAll).toContain('Ended Yesterday Single')
      expect(htmlAll).toContain('Ended Yesterday Null End')
      expect(htmlAll).toContain('Ending Today Meet')
      expect(htmlAll).toContain('Single Day Today Meet')
      expect(htmlAll).toContain('Starting Today Meet')
      expect(htmlAll).toContain('Spanning Today Meet')
      expect(htmlAll).toContain('Starting Tomorrow Meet')
      expect(htmlAll).toContain('Date TBD Meet')

      // Test ?tab=upcoming
      const resUpcoming = await fetchGet('/events?tab=upcoming')
      assertHtmlResponse(resUpcoming, 200)
      const htmlUpcoming = await resUpcoming.text()

      // Past events MUST NOT be in upcoming
      expect(htmlUpcoming).not.toContain('Ended Yesterday Multi')
      expect(htmlUpcoming).not.toContain('Ended Yesterday Single')
      expect(htmlUpcoming).not.toContain('Ended Yesterday Null End')

      // Today's events and future events MUST be in upcoming
      expect(htmlUpcoming).toContain('Ending Today Meet')
      expect(htmlUpcoming).toContain('Single Day Today Meet')
      expect(htmlUpcoming).toContain('Starting Today Meet')
      expect(htmlUpcoming).toContain('Spanning Today Meet')
      expect(htmlUpcoming).toContain('Starting Tomorrow Meet')
      expect(htmlUpcoming).toContain('Date TBD Meet')

      // Test ?tab=past
      const resPast = await fetchGet('/events?tab=past')
      assertHtmlResponse(resPast, 200)
      const htmlPast = await resPast.text()

      // Past events MUST be in past
      expect(htmlPast).toContain('Ended Yesterday Multi')
      expect(htmlPast).toContain('Ended Yesterday Single')
      expect(htmlPast).toContain('Ended Yesterday Null End')

      // Today's events and future events MUST NOT be in past
      expect(htmlPast).not.toContain('Ending Today Meet')
      expect(htmlPast).not.toContain('Single Day Today Meet')
      expect(htmlPast).not.toContain('Starting Today Meet')
      expect(htmlPast).not.toContain('Spanning Today Meet')
      expect(htmlPast).not.toContain('Starting Tomorrow Meet')
      expect(htmlPast).not.toContain('Date TBD Meet')
    })

    it('renders correct status badges (Past Meet, Active Today, Upcoming)', async () => {
      const site = await seedTestSite({ name: 'Badge Site' })

      const pastEvt = await seedTestEvent(site.id, {
        name: 'Past Meet Event',
        startsOn: twoDaysAgoStr,
        endsOn: yesterdayStr,
      })
      const activeEvt = await seedTestEvent(site.id, {
        name: 'Active Today Event',
        startsOn: todayStr,
        endsOn: todayStr,
      })
      const futureEvt = await seedTestEvent(site.id, {
        name: 'Future Launch Event',
        startsOn: tomorrowStr,
        endsOn: dayAfterTomorrowStr,
      })

      // Check detail view badges
      const resPastDetail = await fetchGet(`/events/${pastEvt.id}`)
      const htmlPastDetail = await resPastDetail.text()
      expect(htmlPastDetail).toContain('Past Meet')

      const resActiveDetail = await fetchGet(`/events/${activeEvt.id}`)
      const htmlActiveDetail = await resActiveDetail.text()
      expect(htmlActiveDetail).toContain('Active Today')

      const resFutureDetail = await fetchGet(`/events/${futureEvt.id}`)
      const htmlFutureDetail = await resFutureDetail.text()
      expect(htmlFutureDetail).toContain('Upcoming')
    })

    it('handles inverted date ranges (startsOn > endsOn) gracefully', async () => {
      const site = await seedTestSite({ name: 'Inverted Site' })

      // An event with endsOn in the past and startsOn in future
      const event = await seedTestEvent(site.id, {
        name: 'Inverted Date Meet',
        startsOn: tomorrowStr,
        endsOn: yesterdayStr,
      })

      const res = await fetchGet(`/events/${event.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toContain('Inverted Date Meet')

      const resList = await fetchGet('/events')
      assertHtmlResponse(resList, 200)
      const htmlList = await resList.text()
      expect(htmlList).toContain('Inverted Date Meet')
    })
  })

  // =========================================================================
  // 4. Flight Form & Views Resilience with Null / Orphaned Launch Site
  // =========================================================================
  describe('4. Flight Form & Views Resilience with Null / Orphaned Launch Site', () => {
    it('renders flight form with fallback "— No site" via HTTP pipeline when host site name is unassigned or empty', async () => {
      const flyer = await seedTestUser({ displayName: 'Fallback Flight Pilot' })
      const token = await signSession(flyer.id)
      const emptyNameSite = await seedTestSite({ name: '' })

      const eventWithoutNamedSite = await seedTestEvent(emptyNameSite.id, {
        name: 'Unassigned Site Meet 2026',
        startsOn: '2026-07-04',
        endsOn: '2026-07-05',
      })

      // 1. GET /flights/new must not throw 500 and format with fallback "— No site"
      const resNew = await fetchGet('/flights/new', {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(resNew, 200)
      const htmlNew = await resNew.text()
      expect(htmlNew).toContain('Unassigned Site Meet 2026 (2026-07-04 to 2026-07-05) — No site')

      // 2. GET /flights/:id/edit must not throw 500 and format with fallback "— No site"
      const flight = await seedTestFlight(flyer.id, {
        launchEventId: eventWithoutNamedSite.id,
      })

      const resEdit = await fetchGet(`/flights/${flight.id}/edit`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(resEdit, 200)
      const htmlEdit = await resEdit.text()
      expect(htmlEdit).toContain('Unassigned Site Meet 2026 (2026-07-04 to 2026-07-05) — No site')

      // 3. GET /events must render without crashing
      const resEvents = await fetchGet('/events')
      assertHtmlResponse(resEvents, 200)
      const htmlEvents = await resEvents.text()
      expect(htmlEvents).toContain('Unassigned Site Meet 2026')

      // 4. GET /events/:id detail view must render without crashing
      const resDetail = await fetchGet(`/events/${eventWithoutNamedSite.id}`)
      assertHtmlResponse(resDetail, 200)
      const htmlDetail = await resDetail.text()
      expect(htmlDetail).toContain('Unassigned Site Meet 2026')
    })

    it('preflightFormView handles launchEvents array item where launchSiteId or siteName is null', () => {
      // Direct component-level unit stress test on preflightFormView
      const formHtml = preflightFormView({
        rockets: [],
        configurations: [],
        motors: [],
        launchSites: [],
        launchEvents: [
          {
            id: 'mock-evt-1',
            name: 'Null Site ID Event',
            launchSiteId: null as any,
            startsOn: '2026-09-01',
            endsOn: null,
            siteName: null,
          },
          {
            id: 'mock-evt-2',
            name: 'Null Date Event',
            launchSiteId: 'site-2',
            startsOn: null,
            endsOn: null,
            siteName: 'Some Site',
          },
        ],
        users: [],
        initialValues: {},
      }).toString()

      expect(formHtml).toContain('Null Site ID Event (2026-09-01) — No site')
      expect(formHtml).toContain('Null Date Event (Date TBD) — Some Site')
    })
  })

  // =========================================================================
  // 5. Form Validation, Long Strings, Special Characters & XSS Escaping
  // =========================================================================
  describe('5. Form Validation, Long Strings, Special Characters & XSS Escaping', () => {
    it('escapes XSS vectors in event name across all views', async () => {
      const site = await seedTestSite({ name: 'XSS Defense Range' })
      const flyer = await seedTestUser({ displayName: 'Security Tester' })
      const token = await signSession(flyer.id)

      const xssName = '<script>alert("XSS_PWNED")</script>'
      const event = await seedTestEvent(site.id, {
        name: 'Pre-XSS Event',
      })

      // Update event with XSS script in name
      const res = await fetchPostForm(
        `/events/${event.id}/edit`,
        {
          name: xssName,
          launch_site_id: site.id,
        },
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res.status)

      // 1. Events list /events
      const resList = await fetchGet('/events')
      const htmlList = await resList.text()
      expect(htmlList).not.toContain('<script>alert("XSS_PWNED")</script>')
      expect(htmlList).toContain('&lt;script&gt;alert(&quot;XSS_PWNED&quot;)&lt;/script&gt;')

      // 2. Event detail /events/:id
      const resDetail = await fetchGet(`/events/${event.id}`)
      const htmlDetail = await resDetail.text()
      expect(htmlDetail).not.toContain('<script>alert("XSS_PWNED")</script>')
      expect(htmlDetail).toContain('&lt;script&gt;alert(&quot;XSS_PWNED&quot;)&lt;/script&gt;')

      // 3. Edit form /events/:id/edit
      const resEdit = await fetchGet(`/events/${event.id}/edit`)
      const htmlEdit = await resEdit.text()
      expect(htmlEdit).not.toContain('<script>alert("XSS_PWNED")</script>')

      // 4. Flight logging dropdown /flights/new
      const resFlight = await fetchGet('/flights/new', {
        Cookie: `triplet_session=${token}`,
      })
      const htmlFlight = await resFlight.text()
      expect(htmlFlight).not.toContain('<script>alert("XSS_PWNED")</script>')
      expect(htmlFlight).toContain('&lt;script&gt;alert(&quot;XSS_PWNED&quot;)&lt;/script&gt;')
    })

    it('escapes XSS vectors in weather notes, launch director, and tripoli prefect', async () => {
      const site = await seedTestSite({ name: 'Field X' })
      const event = await seedTestEvent(site.id, {
        name: 'Field X Meet',
      })

      const xssDirector = '"><img src=x onerror=alert("DIR_XSS")>'
      const xssPrefect = '<svg onload="alert(\'PREFECT_XSS\')">'
      const xssWeather = '</textarea><script>alert("WEATHER_XSS")</script>'

      const res = await fetchPostForm(
        `/events/${event.id}/edit`,
        {
          name: 'Field X Meet',
          launch_site_id: site.id,
          launch_director: xssDirector,
          tripoli_prefect: xssPrefect,
          weather_notes: xssWeather,
        },
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res.status)

      // Verify detail view
      const resDetail = await fetchGet(`/events/${event.id}`)
      const htmlDetail = await resDetail.text()
      expect(htmlDetail).not.toContain('<img src=x onerror=alert("DIR_XSS")>')
      expect(htmlDetail).not.toContain('<svg onload="alert(\'PREFECT_XSS\')">')
      expect(htmlDetail).not.toContain('<script>alert("WEATHER_XSS")</script>')

      // Verify edit view
      const resEdit = await fetchGet(`/events/${event.id}/edit`)
      const htmlEdit = await resEdit.text()
      expect(htmlEdit).not.toContain('<img src=x onerror=alert("DIR_XSS")>')
      expect(htmlEdit).not.toContain('<svg onload="alert(\'PREFECT_XSS\')">')
      expect(htmlEdit).not.toContain('<script>alert("WEATHER_XSS")</script>')
    })

    it('faithfully preserves special characters, emojis, and quotes in database', async () => {
      const site = await seedTestSite({ name: 'Unicode Testing Range' })
      const event = await seedTestEvent(site.id, { name: 'Initial' })

      const complexName = `O'Connor's & "Smith's" Launch Meet #42 — 🚀✨ [2026] <Sanctioned>`
      const complexDirector = `Dr. René "Speedy" François & Co.`
      const complexPrefect = `Mária O'Neil (TRA #999)`
      const complexNotes = `Wind: 10 m/s @ 180° -> Gusts & turbulence; Temp: 25°C. "Caution advised!"`

      const res = await fetchPostForm(
        `/events/${event.id}/edit`,
        {
          name: complexName,
          launch_site_id: site.id,
          launch_director: complexDirector,
          tripoli_prefect: complexPrefect,
          weather_notes: complexNotes,
        },
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res.status)

      const db = getDb()
      const [stored] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, event.id))

      expect(stored.name).toBe(complexName)
      expect(stored.launchDirector).toBe(complexDirector)
      expect(stored.tripoliPrefect).toBe(complexPrefect)
      expect(stored.weatherNotes).toBe(complexNotes)
    })

    it('survives extremely long strings without DB failure or HTML crash', async () => {
      const site = await seedTestSite({ name: 'Stress Range' })
      const event = await seedTestEvent(site.id, { name: 'Initial Stress' })

      const hugeName = 'Alpha-'.repeat(80) // 480 chars
      const hugeDirector = 'Director-'.repeat(40) // 360 chars
      const hugePrefect = 'Prefect-'.repeat(40) // 320 chars
      const hugeWeather = 'Clear skies with gusty winds and thermal updrafts. '.repeat(150) // ~7500 chars

      const res = await fetchPostForm(
        `/events/${event.id}/edit`,
        {
          name: hugeName,
          launch_site_id: site.id,
          launch_director: hugeDirector,
          tripoli_prefect: hugePrefect,
          weather_notes: hugeWeather,
        },
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res.status)

      const resDetail = await fetchGet(`/events/${event.id}`)
      assertHtmlResponse(resDetail, 200)

      const resEdit = await fetchGet(`/events/${event.id}/edit`)
      assertHtmlResponse(resEdit, 200)
    })

    it('handles boundary and non-numeric pad counts gracefully', async () => {
      const site = await seedTestSite({ name: 'Pad Count Site' })
      const event = await seedTestEvent(site.id, { name: 'Pad Event' })

      // Zero pad count
      await fetchPostForm(`/events/${event.id}/edit`, {
        name: 'Pad Event',
        launch_site_id: site.id,
        pad_count: '0',
      })
      let [stored] = await getDb()
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, event.id))
      expect(stored.padCount).toBe(0)

      // Large pad count
      await fetchPostForm(`/events/${event.id}/edit`, {
        name: 'Pad Event',
        launch_site_id: site.id,
        pad_count: '100',
      })
      ;[stored] = await getDb()
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, event.id))
      expect(stored.padCount).toBe(100)

      // Non-numeric string becomes null
      await fetchPostForm(`/events/${event.id}/edit`, {
        name: 'Pad Event',
        launch_site_id: site.id,
        pad_count: 'not-a-number',
      })
      ;[stored] = await getDb()
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, event.id))
      expect(stored.padCount).toBeNull()
    })

    it('rejects update with 400 when host launch site does not exist', async () => {
      const site = await seedTestSite({ name: 'Real Site' })
      const event = await seedTestEvent(site.id, { name: 'Real Event' })

      // Non-existent launch site ID via POST form
      const resForm = await fetchPostForm(
        `/events/${event.id}/edit`,
        {
          name: 'Real Event',
          launch_site_id: 'fake-site-id-99999',
        },
      )
      expect(resForm.status).toBe(400)
      const html = await resForm.text()
      expect(html).toContain('Invalid Launch Site')

      // Non-existent launch site ID via PUT JSON
      const resJson = await SELF.fetch(`https://example.com/events/${event.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'Real Event',
          launch_site_id: 'fake-site-id-99999',
        }),
      })
      expect(resJson.status).toBe(400)
      const json = await resJson.json()
      expect(json).toHaveProperty('error', 'Selected launch site does not exist')
    })
  })
})
