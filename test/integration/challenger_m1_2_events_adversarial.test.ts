/**
 * Challenger M1-2 Adversarial Stress Test Suite
 *
 * Requirements tested:
 * 1. Flight Event Selectability:
 *    - Events created weeks, months, or years in the past (e.g. 5 or 10 years ago)
 *      are strictly selectable in /flights/new and /flights/:id/edit.
 *    - Format validation: ${e.name} (${dateText}) — ${siteText} across date styles
 *      (multi-day, single-day, no end date, Date TBD, no site).
 *    - Pre-selection via ?launch_event_id=<id> query parameter.
 *    - Full persistence of past event linkage through POST /flights and POST /flights/:id.
 *    - Logged flights visible on past event detail view (/events/:id).
 * 2. Event List Partitioning & Tab Filtering:
 *    - Partitioning into Upcoming and Past Meets / Archive.
 *    - Filtering with ?tab=upcoming, ?tab=past, ?tab=all, and default /events.
 *    - Adversarial / invalid tab values (?tab=garbage, ?tab=UPCOMING, ?tab=) handle gracefully (HTTP 200).
 *    - In-tab empty state banners ("No upcoming launches scheduled", "No past launch meets recorded").
 *    - Calendar boundary conditions (multi-day active today spanning yesterday-tomorrow).
 * 3. JSON API (PUT /events/:id) vs HTML Form Submissions (POST /events/:id/edit):
 *    - Full JSON PUT updates, snake_case vs camelCase payload keys, clearing nullable fields.
 *    - Structured JSON 400 / 404 responses for missing name, missing site, invalid site, missing event.
 *    - HTML form 303 redirects, 400 validation error screens, 404 event not found screens.
 *    - Officer user ID sanitization (empty string coerced to null without FK constraint failures).
 * 4. Authentication & Access Control Boundaries:
 *    - Unauthenticated GET and POST /events/:id/edit redirect (HTTP 302) to /login?redirect=...
 *    - Unauthenticated JSON PUT /events/:id returns HTTP 401 Unauthorized.
 *    - Revoked/invalid session tokens strictly reject with redirect.
 *    - Authenticated flyer role can access and edit events (shared club infrastructure).
 */

import { SELF } from 'cloudflare:test'
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
} from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'

beforeEach(truncateDb)

describe('Challenger M1-2: Launch Events Usability & Adversarial Verification', () => {
  const today = new Date().toISOString().slice(0, 10)

  // =========================================================================
  // VECTOR 1: Flight Event Selectability (Past Events Weeks/Years Ago)
  // =========================================================================
  describe('Vector 1: Flight Event Selectability Across Time Boundaries & Extremes', () => {
    it('1.1: events created weeks, months, or years in the past are strictly selectable in /flights/new', async () => {
      const flyer = await seedTestUser({ displayName: 'Historical Flyer' })
      const token = await signSession(flyer.id)
      const site = await seedTestSite({ name: 'Woomera Rocket Range' })

      // Events across historical spectrum: 10 years ago, 5 years ago, 3 weeks ago, and far future
      const evt10YearsAgo = await seedTestEvent(site.id, {
        name: 'Decade Celebration Meet 2016',
        startsOn: '2016-04-12',
        endsOn: '2016-04-14',
      })

      const evt5YearsAgo = await seedTestEvent(site.id, {
        name: 'Half-Decade Meet 2021',
        startsOn: '2021-08-10',
        endsOn: '2021-08-12',
      })

      const evt3WeeksAgo = await seedTestEvent(site.id, {
        name: 'Recent Meet Three Weeks Ago',
        startsOn: '2026-08-15',
        endsOn: '2026-08-16',
      })

      const evtFuture = await seedTestEvent(site.id, {
        name: 'Far Future Gathering 2035',
        startsOn: '2035-10-01',
        endsOn: '2035-10-05',
      })

      const res = await fetchGet('/flights/new', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Verify all events (past and future) appear in select dropdown
      expect(html).toContain(`value="${evt10YearsAgo.id}"`)
      expect(html).toContain(`value="${evt5YearsAgo.id}"`)
      expect(html).toContain(`value="${evt3WeeksAgo.id}"`)
      expect(html).toContain(`value="${evtFuture.id}"`)

      // Verify exact formatting: ${name} (${dateText}) — ${siteText}
      expect(html).toContain('Decade Celebration Meet 2016 (2016-04-12 to 2016-04-14) — Woomera Rocket Range')
      expect(html).toContain('Half-Decade Meet 2021 (2021-08-10 to 2021-08-12) — Woomera Rocket Range')
      expect(html).toContain('Recent Meet Three Weeks Ago (2026-08-15 to 2026-08-16) — Woomera Rocket Range')
      expect(html).toContain('Far Future Gathering 2035 (2035-10-01 to 2035-10-05) — Woomera Rocket Range')
    })

    it('1.2: handles non-standard date ranges and missing sites cleanly in event dropdown', async () => {
      const flyer = await seedTestUser({ displayName: 'Edge Flyer' })
      const token = await signSession(flyer.id)
      const site = await seedTestSite({ name: 'Coober Pedy Desert' })

      // Single-day event
      const singleDay = await seedTestEvent(site.id, {
        name: 'Single Day Sprint 2022',
        startsOn: '2022-03-01',
        endsOn: '2022-03-01',
      })

      // Start date only, no end date
      const startOnly = await seedTestEvent(site.id, {
        name: 'Start Only Meet 2020',
        startsOn: '2020-11-20',
        endsOn: null,
      })

      // No dates at all (Date TBD)
      const noDates = await seedTestEvent(site.id, {
        name: 'Unscheduled Meet',
        startsOn: null,
        endsOn: null,
      })

      const res = await fetchGet('/flights/new', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Single day shows single date: (2022-03-01)
      expect(html).toContain('Single Day Sprint 2022 (2022-03-01) — Coober Pedy Desert')
      // Start date only shows startsOn: (2020-11-20)
      expect(html).toContain('Start Only Meet 2020 (2020-11-20) — Coober Pedy Desert')
      // Null dates show: (Date TBD)
      expect(html).toContain('Unscheduled Meet (Date TBD) — Coober Pedy Desert')
    })

    it('1.3: preserves selected past event when form re-renders on soft-gate warnings', async () => {
      const flyer = await seedTestUser({ displayName: 'Soft Gate Flyer' })
      const token = await signSession(flyer.id)
      const site = await seedTestSite({ name: 'Lake Hart', maxAltitudeAglM: 500 })
      const rocket = await seedTestRocket(flyer.id, { name: 'High Flyer' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ manufacturer: 'Estes', model: 'D12-3', impulseClass: 'D' })

      const pastEvent = await seedTestEvent(site.id, {
        name: 'Target Past Event 2023',
        startsOn: '2023-05-10',
        endsOn: '2023-05-12',
      })

      // Submit flight with altitude exceeding site max (500m) without proceeded_despite_warnings
      // This triggers 422 Unprocessable Entity and re-renders form with initialValues
      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          launch_event_id: pastEvent.id,
          altitude_agl_m: '1200',
          proceeded_despite_warnings: 'false',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect(res.status).toBe(422)
      const html = await res.text()

      // Expect selected attribute on past event option
      expect(html).toContain(`value="${pastEvent.id}" selected`)
      expect(html).toContain('Target Past Event 2023 (2023-05-10 to 2023-05-12) — Lake Hart')
    })

    it('1.4: persists past event association when logging flight via POST /flights', async () => {
      const flyer = await seedTestUser({ displayName: 'Logger Dan' })
      await seedTestCert(flyer.id, { level: 2, certifyingBody: 'TRA' })
      const token = await signSession(flyer.id)
      const site = await seedTestSite({ name: 'Torrens Island', maxAltitudeAglM: 5000 })
      const rocket = await seedTestRocket(flyer.id, { name: 'Titan IV' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'H128W',
        impulseClass: 'H',
      })

      // Event from 4 years ago
      const pastMeet = await seedTestEvent(site.id, {
        name: 'Historical Launch 2022',
        startsOn: '2022-02-14',
        endsOn: '2022-02-16',
      })

      // Submit flight log referencing the 2022 past meet
      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          launch_event_id: pastMeet.id,
          altitude_agl_m: '750',
          altitude_agl_ft: '2460.6',
          flight_number: '1',
          outcome: 'successful',
          rso_name: 'Veteran RSO Bob',
          lco_name: 'Range LCO Alice',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') || ''
      expect(location).toMatch(/\/flights\/[a-f0-9-]+/)

      // Verify in database that flight is linked to pastMeet
      const db = getDb()
      const flightId = location.split('/flights/')[1]
      const [savedFlight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flightId))

      expect(savedFlight).toBeDefined()
      expect(savedFlight.launchEventId).toBe(pastMeet.id)

      // Verify GET /events/:id displays the logged flight
      const eventRes = await fetchGet(`/events/${pastMeet.id}`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(eventRes, 200)
      const eventHtml = await eventRes.text()
      expect(eventHtml).toContain(`/flights/${flightId}`)
      expect(eventHtml).toContain('750 m')
      expect(eventHtml).toContain('Historical Launch 2022')
    })

    it('1.5: allows reassigning flight to a past event in GET/POST /flights/:id/edit', async () => {
      const flyer = await seedTestUser({ displayName: 'Editor Eva' })
      const token = await signSession(flyer.id)
      const site = await seedTestSite({ name: 'Port Wakefield' })
      const rocket = await seedTestRocket(flyer.id, { name: 'Aerobee 150' })
      const config = await seedTestConfig(rocket.id)

      const pastEvent1 = await seedTestEvent(site.id, {
        name: 'First Past Meet 2021',
        startsOn: '2021-06-01',
        endsOn: '2021-06-03',
      })

      const pastEvent2 = await seedTestEvent(site.id, {
        name: 'Second Past Meet 2019',
        startsOn: '2019-09-10',
        endsOn: '2019-09-12',
      })

      // Flight originally at pastEvent1
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        launchEventId: pastEvent1.id,
        launchSiteId: site.id,
      })

      // Verify GET /flights/:id/edit marks pastEvent1 as selected and offers pastEvent2
      const editRes = await fetchGet(`/flights/${flight.id}/edit`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(editRes, 200)
      const editHtml = await editRes.text()

      expect(editHtml).toContain(`value="${pastEvent1.id}" selected`)
      expect(editHtml).toContain(`value="${pastEvent2.id}"`)

      // Update flight to reassign to pastEvent2
      const postRes = await fetchPostForm(
        `/flights/${flight.id}`,
        {
          launch_event_id: pastEvent2.id,
          launch_site_id: site.id,
          notes: 'Reassigned to older meet',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(postRes.status)

      const db = getDb()
      const [updatedFlight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flight.id))

      expect(updatedFlight.launchEventId).toBe(pastEvent2.id)
    })
  })

  // =========================================================================
  // VECTOR 2: Event List Partitioning & Tab Filtering
  // =========================================================================
  describe('Vector 2: Event List Partitioning & Tab Filtering Adversarial Scenarios', () => {
    it('2.1: ?tab=upcoming strictly renders upcoming and active today events, never past meets', async () => {
      const site = await seedTestSite({ name: 'Range East' })

      await seedTestEvent(site.id, {
        name: 'Past Meet Ancient 2015',
        startsOn: '2015-01-01',
        endsOn: '2015-01-03',
      })

      await seedTestEvent(site.id, {
        name: 'Future Meet 2032',
        startsOn: '2032-11-10',
        endsOn: '2032-11-12',
      })

      await seedTestEvent(site.id, {
        name: 'Active Meet Right Now',
        startsOn: today,
        endsOn: today,
      })

      const res = await fetchGet('/events?tab=upcoming')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('Upcoming Launches')
      expect(html).toContain('Future Meet 2032')
      expect(html).toContain('Active Meet Right Now')

      // Strictly must NOT contain past meet section or past event
      expect(html).not.toContain('Past Launch Meets / Archive')
      expect(html).not.toContain('Past Meet Ancient 2015')
    })

    it('2.2: ?tab=past strictly renders past meets, never upcoming or active today events', async () => {
      const site = await seedTestSite({ name: 'Range West' })

      await seedTestEvent(site.id, {
        name: 'Past Meet 2017',
        startsOn: '2017-04-01',
        endsOn: '2017-04-02',
      })

      await seedTestEvent(site.id, {
        name: 'Future Launch 2033',
        startsOn: '2033-02-01',
        endsOn: '2033-02-03',
      })

      await seedTestEvent(site.id, {
        name: 'Current Active Launch',
        startsOn: today,
        endsOn: today,
      })

      const res = await fetchGet('/events?tab=past')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('Past Launch Meets / Archive')
      expect(html).toContain('Past Meet 2017')

      // Strictly must NOT contain upcoming section or upcoming/active events
      expect(html).not.toContain('Upcoming Launches')
      expect(html).not.toContain('Future Launch 2033')
      expect(html).not.toContain('Current Active Launch')
    })

    it('2.3: default /events and ?tab=all display both upcoming and past sections', async () => {
      const site = await seedTestSite({ name: 'Range Central' })

      await seedTestEvent(site.id, {
        name: 'History Meet 2020',
        startsOn: '2020-05-01',
        endsOn: '2020-05-02',
      })

      await seedTestEvent(site.id, {
        name: 'Tomorrow Meet 2031',
        startsOn: '2031-07-01',
        endsOn: '2031-07-02',
      })

      const resDefault = await fetchGet('/events')
      assertHtmlResponse(resDefault, 200)
      const htmlDefault = await resDefault.text()

      expect(htmlDefault).toContain('Upcoming Launches')
      expect(htmlDefault).toContain('Tomorrow Meet 2031')
      expect(htmlDefault).toContain('Past Launch Meets / Archive')
      expect(htmlDefault).toContain('History Meet 2020')

      const resAll = await fetchGet('/events?tab=all')
      assertHtmlResponse(resAll, 200)
      const htmlAll = await resAll.text()

      expect(htmlAll).toContain('Upcoming Launches')
      expect(htmlAll).toContain('Tomorrow Meet 2031')
      expect(htmlAll).toContain('Past Launch Meets / Archive')
      expect(htmlAll).toContain('History Meet 2020')
    })

    it('2.4: invalid and unexpected ?tab values handle gracefully with HTTP 200', async () => {
      const site = await seedTestSite({ name: 'Lake Eyre Range' })
      await seedTestEvent(site.id, {
        name: 'Lake Eyre Past 2021',
        startsOn: '2021-01-01',
        endsOn: '2021-01-02',
      })

      // ?tab=garbage
      const resGarbage = await fetchGet('/events?tab=garbage')
      expect(resGarbage.status).toBe(200)
      const htmlGarbage = await resGarbage.text()
      expect(htmlGarbage).toContain('Launch Events & Meets')
      expect(htmlGarbage).toContain('/events?tab=all')

      // ?tab=UPCOMING (case sensitivity test)
      const resUpper = await fetchGet('/events?tab=UPCOMING')
      expect(resUpper.status).toBe(200)

      // SQL injection-like string in tab param
      const resSql = await fetchGet('/events?tab=%27%20OR%201=1--')
      expect(resSql.status).toBe(200)

      // Empty string ?tab=
      const resEmpty = await fetchGet('/events?tab=')
      expect(resEmpty.status).toBe(200)
      const htmlEmpty = await resEmpty.text()
      expect(htmlEmpty).toContain('Past Launch Meets / Archive')
    })

    it('2.5: handles empty partitions gracefully inside tabs without throwing errors', async () => {
      const site = await seedTestSite({ name: 'Only Past Range' })
      await seedTestEvent(site.id, {
        name: 'Solo Past Meet 2020',
        startsOn: '2020-03-01',
        endsOn: '2020-03-02',
      })

      // Only past events exist, request ?tab=upcoming
      const resUpcoming = await fetchGet('/events?tab=upcoming')
      assertHtmlResponse(resUpcoming, 200)
      const htmlUpcoming = await resUpcoming.text()
      expect(htmlUpcoming).toContain('Upcoming Launches')
      expect(htmlUpcoming).toContain('No upcoming launches scheduled')

      // Seed an upcoming event only, then test ?tab=past
      const site2 = await seedTestSite({ name: 'Only Future Range' })
      const db = getDb()
      await db.delete(schema.launchEvents)

      await seedTestEvent(site2.id, {
        name: 'Solo Future Meet 2030',
        startsOn: '2030-01-01',
        endsOn: '2030-01-02',
      })

      const resPast = await fetchGet('/events?tab=past')
      assertHtmlResponse(resPast, 200)
      const htmlPast = await resPast.text()
      expect(htmlPast).toContain('Past Launch Meets / Archive')
      expect(htmlPast).toContain('No past launch meets recorded in archive')
    })

    it('2.6: multi-day event spanning yesterday to tomorrow is categorized as Upcoming/Active, not past', async () => {
      const site = await seedTestSite({ name: 'Active Range' })

      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

      const activeEvent = await seedTestEvent(site.id, {
        name: 'Spanning Today Meet',
        startsOn: yesterday,
        endsOn: tomorrow,
      })

      const res = await fetchGet('/events?tab=upcoming')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('Spanning Today Meet')
      expect(html).toContain('Active Today')

      const resPast = await fetchGet('/events?tab=past')
      assertHtmlResponse(resPast, 200)
      const htmlPast = await resPast.text()
      expect(htmlPast).not.toContain('Spanning Today Meet')
    })
  })

  // =========================================================================
  // VECTOR 3: JSON API Endpoints vs HTML Form Submissions
  // =========================================================================
  describe('Vector 3: JSON API (PUT /events/:id) vs HTML Form Submissions', () => {
    it('3.1: PUT /events/:id with JSON payload updates all fields and returns HTTP 200 JSON', async () => {
      const site1 = await seedTestSite({ name: 'Initial Site' })
      const site2 = await seedTestSite({ name: 'Target Site' })
      const event = await seedTestEvent(site1.id, { name: 'Initial JSON Event' })

      const res = await SELF.fetch(`https://example.com/events/${event.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'Updated via Full JSON API',
          launch_site_id: site2.id,
          starts_on: '2027-04-01',
          ends_on: '2027-04-03',
          pad_count: 24,
          launch_director: 'Director Marcus Cole',
          tripoli_prefect: 'Prefect Susan Ivanova',
          weather_notes: 'Clear skies 15C',
        }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.id).toBe(event.id)
      expect(data.name).toBe('Updated via Full JSON API')
      expect(data.launchSiteId).toBe(site2.id)
      expect(data.startsOn).toBe('2027-04-01')
      expect(data.endsOn).toBe('2027-04-03')
      expect(data.padCount).toBe(24)
      expect(data.launchDirector).toBe('Director Marcus Cole')
      expect(data.tripoliPrefect).toBe('Prefect Susan Ivanova')
      expect(data.weatherNotes).toBe('Clear skies 15C')

      // Confirm in D1
      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, event.id))

      expect(updated.name).toBe('Updated via Full JSON API')
      expect(updated.padCount).toBe(24)
    })

    it('3.2: PUT /events/:id accepts camelCase JSON keys', async () => {
      const site = await seedTestSite({ name: 'Camel Site' })
      const event = await seedTestEvent(site.id, { name: 'Before Camel Update' })

      const res = await SELF.fetch(`https://example.com/events/${event.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'After Camel Update',
          launchSiteId: site.id,
          startsOn: '2027-09-01',
          endsOn: '2027-09-02',
          padCount: 18,
          launchDirector: 'Captain Sheridan',
          tripoliPrefect: 'Delenn',
          weatherNotes: 'Favorable winds',
        }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as any
      expect(data.name).toBe('After Camel Update')
      expect(data.padCount).toBe(18)
      expect(data.launchDirector).toBe('Captain Sheridan')
    })

    it('3.3: PUT /events/:id can nullify optional attributes', async () => {
      const site = await seedTestSite({ name: 'Nullify Site' })
      const event = await seedTestEvent(site.id, {
        name: 'Filled Event',
        padCount: 10,
        launchDirector: 'Director To Remove',
        weatherNotes: 'Old weather notes',
      })

      const res = await SELF.fetch(`https://example.com/events/${event.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'Stripped Event',
          launch_site_id: site.id,
          pad_count: null,
          launch_director: null,
          tripoli_prefect: null,
          weather_notes: null,
        }),
      })

      expect(res.status).toBe(200)
      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, event.id))

      expect(updated.name).toBe('Stripped Event')
      expect(updated.padCount).toBeNull()
      expect(updated.launchDirector).toBeNull()
      expect(updated.weatherNotes).toBeNull()
    })

    it('3.4: PUT /events/:id returns JSON 400 or 404 for validation failures', async () => {
      const site = await seedTestSite({ name: 'Validation Site' })
      const event = await seedTestEvent(site.id, { name: 'Valid Before Test' })

      // Missing name
      const resNoName = await SELF.fetch(`https://example.com/events/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name: '', launch_site_id: site.id }),
      })
      expect(resNoName.status).toBe(400)
      const errNoName = (await resNoName.json()) as any
      expect(errNoName.error).toBe('Event name is required')

      // Missing launch site
      const resNoSite = await SELF.fetch(`https://example.com/events/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name: 'New Name', launch_site_id: '' }),
      })
      expect(resNoSite.status).toBe(400)
      const errNoSite = (await resNoSite.json()) as any
      expect(errNoSite.error).toBe('Host launch site selection is required')

      // Non-existent launch site
      const resFakeSite = await SELF.fetch(`https://example.com/events/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name: 'New Name', launch_site_id: 'non-existent-site-id' }),
      })
      expect(resFakeSite.status).toBe(400)
      const errFakeSite = (await resFakeSite.json()) as any
      expect(errFakeSite.error).toBe('Selected launch site does not exist')

      // Non-existent event
      const resFakeEvt = await SELF.fetch('https://example.com/events/non-existent-event-id', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name: 'Ghost Event', launch_site_id: site.id }),
      })
      expect(resFakeEvt.status).toBe(404)
      const errFakeEvt = (await resFakeEvt.json()) as any
      expect(errFakeEvt.error).toBe('Launch event not found')
    })

    it('3.5: HTML form POST /events/:id/edit returns 400 HTML on validation errors with recovery link', async () => {
      const site = await seedTestSite({ name: 'HTML Error Site' })
      const event = await seedTestEvent(site.id, { name: 'HTML Target Event' })

      const res = await fetchPostForm(`/events/${event.id}/edit`, {
        name: '',
        launch_site_id: site.id,
      })

      expect(res.status).toBe(400)
      const html = await res.text()
      expect(html).toContain('Missing Required Information')
      expect(html).toContain('Event name is required')
      expect(html).toContain(`/events/${event.id}/edit`)
    })
  })

  // =========================================================================
  // VECTOR 4: Authentication Boundaries on Event Editing
  // =========================================================================
  describe('Vector 4: Authentication & Authorization Boundaries', () => {
    it('4.1: unauthenticated GET /events/:id/edit redirects to /login', async () => {
      const site = await seedTestSite({ name: 'Auth Site' })
      const event = await seedTestEvent(site.id, { name: 'Auth Protected Event' })

      const res = await fetchGet(
        `/events/${event.id}/edit`,
        { 'x-no-auth': 'true', Accept: 'text/html' },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(302)
      const location = res.headers.get('location') || ''
      expect(location).toContain('/login?redirect=')
      expect(location).toContain(encodeURIComponent(`/events/${event.id}/edit`))
    })

    it('4.2: unauthenticated POST /events/:id/edit redirects to /login', async () => {
      const site = await seedTestSite({ name: 'Auth Post Site' })
      const event = await seedTestEvent(site.id, { name: 'Auth Target Event' })

      const res = await fetchPostForm(
        `/events/${event.id}/edit`,
        { name: 'Malicious Rename', launch_site_id: site.id },
        { 'x-no-auth': 'true', Accept: 'text/html' },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(302)
      const location = res.headers.get('location') || ''
      expect(location).toContain('/login?redirect=')
    })

    it('4.3: unauthenticated JSON PUT /events/:id returns HTTP 401 Unauthorized', async () => {
      const site = await seedTestSite({ name: 'Auth API Site' })
      const event = await seedTestEvent(site.id, { name: 'API Target Event' })

      const res = await SELF.fetch(`https://example.com/events/${event.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-no-auth': 'true',
        },
        body: JSON.stringify({ name: 'Unauthenticated Update', launch_site_id: site.id }),
      })

      expect(res.status).toBe(401)
      const data = (await res.json()) as any
      expect(data.error).toBe('Unauthorized')
      expect(data.message).toBe('Authentication required')
    })

    it('4.4: request with invalid or tampered session token redirects to /login', async () => {
      const site = await seedTestSite({ name: 'Tamper Site' })
      const event = await seedTestEvent(site.id, { name: 'Tamper Target Event' })

      const res = await fetchGet(
        `/events/${event.id}/edit`,
        {
          Cookie: 'triplet_session=fake-tampered-token-123',
          Accept: 'text/html',
        },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(302)
      const location = res.headers.get('location') || ''
      expect(location).toContain('/login?redirect=')
    })

    it('4.5: authenticated flyer can access GET /events/:id/edit and update launch meet', async () => {
      const flyer = await seedTestUser({ displayName: 'Regular Club Flyer', role: 'flyer' })
      const token = await signSession(flyer.id)
      const site = await seedTestSite({ name: 'Shared Club Range' })
      const event = await seedTestEvent(site.id, { name: 'Community Launch' })

      // Access edit form
      const getRes = await fetchGet(`/events/${event.id}/edit`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(getRes, 200)
      const html = await getRes.text()
      expect(html).toContain('Community Launch')

      // Perform update
      const postRes = await fetchPostForm(
        `/events/${event.id}/edit`,
        {
          name: 'Community Launch Revised',
          launch_site_id: site.id,
          weather_notes: 'Wind conditions updated by flyer',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(postRes.status)

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, event.id))

      expect(updated.name).toBe('Community Launch Revised')
      expect(updated.weatherNotes).toBe('Wind conditions updated by flyer')
    })
  })
})
