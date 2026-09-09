/**
 * Adversarial Challenger Test Suite for Milestone 3 (Requirement R3):
 * Launch Events Plain Text Duty Officers & Range Operations
 *
 * Covers:
 * 1. Rapid duty officer rotations & cache invalidation (Form POST + JSON PUT back-to-back, asymmetric rotations, destaffing).
 * 2. Boundary & exotic string inputs (multiline, international/Unicode/emojis, XSS/HTML injection defense, whitespace-only coercion, 500+ char strings, SQL injection payloads).
 * 3. Flight log integration & mid-day rotation synergy (R1 + R3 synergy, real-time autofill reflection, flight override isolation).
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

describe('Adversarial Challenger: M3 Launch Events Plain Text Duty Officers & Range Operations', () => {
  // ==========================================================================
  // Area 1: Rapid Duty Officer Rotations & D1 Cache Invalidation
  // ==========================================================================
  describe('Area 1: Rapid Duty Officer Rotations & Persistence Integrity', () => {
    it('executes rapid successive rotations alternating Form POST and JSON PUT without stale caching', async () => {
      const site = await seedTestSite({ name: 'Rapid Rotation Launch Range' })
      const db = getDb()

      // Initial Event Creation via Form POST
      const createRes = await fetchPostForm(
        '/events',
        {
          name: 'Multi-Shift Launch Meet',
          launch_site_id: site.id,
          starts_on: '2026-10-20',
          ends_on: '2026-10-21',
          pad_count: 12,
          rso_name: 'Shift 0 RSO Alpha',
          lco_name: 'Shift 0 LCO Bravo',
        },
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(createRes.status)
      const eventId = (createRes.headers.get('location') ?? '').split('/events/')[1]
      expect(eventId).toBeTruthy()

      // Rotation 1: Shift 1 via Form POST (/events/:id/edit)
      const rot1Res = await fetchPostForm(
        `/events/${eventId}/edit`,
        {
          name: 'Multi-Shift Launch Meet (Shift 1)',
          launch_site_id: site.id,
          rso_name: 'Shift 1 RSO Charlie',
          lco_name: 'Shift 1 LCO Delta',
        },
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(rot1Res.status)

      // Verify D1 state immediately
      let [evt] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, eventId))
      expect(evt.rsoName).toBe('Shift 1 RSO Charlie')
      expect(evt.lcoName).toBe('Shift 1 LCO Delta')

      // Rotation 2: Shift 2 via JSON PUT (/events/:id)
      const rot2Res = await SELF.fetch(`https://example.com/events/${eventId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'Multi-Shift Launch Meet (Shift 2)',
          launch_site_id: site.id,
          rso_name: 'Shift 2 RSO Echo',
          lco_name: 'Shift 2 LCO Foxtrot',
        }),
      })
      expect(rot2Res.status).toBe(200)
      const rot2Json = (await rot2Res.json()) as any
      expect(rot2Json.rsoName).toBe('Shift 2 RSO Echo')
      expect(rot2Json.lcoName).toBe('Shift 2 LCO Foxtrot')

      // Verify D1 state immediately
      ;[evt] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, eventId))
      expect(evt.rsoName).toBe('Shift 2 RSO Echo')
      expect(evt.lcoName).toBe('Shift 2 LCO Foxtrot')

      // Rotation 3: Shift 3 via Form POST (/events/:id/edit)
      const rot3Res = await fetchPostForm(
        `/events/${eventId}/edit`,
        {
          name: 'Multi-Shift Launch Meet (Shift 3)',
          launch_site_id: site.id,
          rso_name: 'Shift 3 RSO Golf',
          lco_name: 'Shift 3 LCO Hotel',
        },
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(rot3Res.status)

      ;[evt] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, eventId))
      expect(evt.rsoName).toBe('Shift 3 RSO Golf')
      expect(evt.lcoName).toBe('Shift 3 LCO Hotel')

      // Rotation 4: Temporary De-staffing via JSON PUT (empty strings coerce to null)
      const rot4Res = await SELF.fetch(`https://example.com/events/${eventId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'Multi-Shift Launch Meet (De-staffed)',
          launch_site_id: site.id,
          rso_name: '',
          lco_name: '',
        }),
      })
      expect(rot4Res.status).toBe(200)

      ;[evt] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, eventId))
      expect(evt.rsoName).toBeNull()
      expect(evt.lcoName).toBeNull()

      // Verify detail HTML reflects de-staffed state
      const htmlDeStaffedRes = await fetchGet(`/events/${eventId}`)
      const htmlDeStaffed = await htmlDeStaffedRes.text()
      expect(htmlDeStaffed).toContain('None designated')
      assertNotContains(htmlDeStaffed, 'Shift 3 RSO Golf')
      assertNotContains(htmlDeStaffed, 'Shift 3 LCO Hotel')

      // Rotation 5: Shift 4 via Form POST (/events/:id/edit)
      const rot5Res = await fetchPostForm(
        `/events/${eventId}/edit`,
        {
          name: 'Multi-Shift Launch Meet (Shift 4 Final)',
          launch_site_id: site.id,
          rso_name: 'Shift 4 RSO India',
          lco_name: 'Shift 4 LCO Juliet',
        },
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(rot5Res.status)

      ;[evt] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, eventId))
      expect(evt.rsoName).toBe('Shift 4 RSO India')
      expect(evt.lcoName).toBe('Shift 4 LCO Juliet')

      // Verify detail HTML now renders Shift 4 and NO previous shifts
      const finalHtmlRes = await fetchGet(`/events/${eventId}`)
      assertHtmlResponse(finalHtmlRes, 200)
      const finalHtml = await finalHtmlRes.text()
      expect(finalHtml).toContain('Shift 4 RSO India')
      expect(finalHtml).toContain('Shift 4 LCO Juliet')
      assertNotContains(finalHtml, 'Shift 0 RSO Alpha')
      assertNotContains(finalHtml, 'Shift 1 RSO Charlie')
      assertNotContains(finalHtml, 'Shift 2 RSO Echo')
      assertNotContains(finalHtml, 'Shift 3 RSO Golf')

      // Verify list view badges reflect latest Shift 4
      const listHtmlRes = await fetchGet('/events')
      assertHtmlResponse(listHtmlRes, 200)
      const listHtml = await listHtmlRes.text()
      expect(listHtml).toContain('RSO: Shift 4 RSO India')
      expect(listHtml).toContain('LCO: Shift 4 LCO Juliet')
      assertNotContains(listHtml, 'RSO: Shift 3 RSO Golf')
    })

    it('handles asymmetric single-officer updates without clobbering the other officer', async () => {
      const site = await seedTestSite({ name: 'Asymmetric Test Site' })
      const db = getDb()

      const event = await seedTestEvent(site.id, {
        name: 'Asymmetric Shift Meet',
        rsoName: 'Steady RSO Stan',
        lcoName: 'Rotating LCO Larry 1',
      })

      // Update ONLY LCO via Form POST
      const res1 = await fetchPostForm(
        `/events/${event.id}/edit`,
        {
          name: 'Asymmetric Shift Meet',
          launch_site_id: site.id,
          rso_name: 'Steady RSO Stan',
          lco_name: 'Rotating LCO Larry 2',
        },
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res1.status)

      let [saved] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, event.id))
      expect(saved.rsoName).toBe('Steady RSO Stan')
      expect(saved.lcoName).toBe('Rotating LCO Larry 2')

      // Now clear ONLY LCO via JSON PUT while keeping RSO
      const res2 = await SELF.fetch(`https://example.com/events/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: 'Asymmetric Shift Meet',
          launch_site_id: site.id,
          rso_name: 'Steady RSO Stan',
          lco_name: '',
        }),
      })
      expect(res2.status).toBe(200)

      ;[saved] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, event.id))
      expect(saved.rsoName).toBe('Steady RSO Stan')
      expect(saved.lcoName).toBeNull()

      // Detail view must show RSO Stan and LCO "None designated"
      const detailRes = await fetchGet(`/events/${event.id}`)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain('Steady RSO Stan')
      expect(detailHtml).toMatch(/LCO:[\s\S]*?None designated/)

      // Card view must render RSO badge, but NOT LCO badge
      const listRes = await fetchGet('/events')
      const listHtml = await listRes.text()
      expect(listHtml).toContain('RSO: Steady RSO Stan')
      expect(listHtml).not.toContain('LCO:')
    })
  })

  // ==========================================================================
  // Area 2: Boundary & Exotic String Inputs
  // ==========================================================================
  describe('Area 2: Boundary & Exotic String Inputs', () => {
    it('persists and faithfully renders international, Unicode, and emoji officer names', async () => {
      const site = await seedTestSite({ name: 'International Spaceport' })
      const db = getDb()

      const rsoUnicode = "José-María O'Connor-Smith 🚀"
      const lcoUnicode = '田中 健太郎 🛰️'
      const directorUnicode = 'Александр Иванов 🛸'
      const prefectUnicode = 'محمد السلامة 🌟'

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Global Rocketry Summit 2026',
          launch_site_id: site.id,
          rso_name: rsoUnicode,
          lco_name: lcoUnicode,
          launch_director: directorUnicode,
          tripoli_prefect: prefectUnicode,
        },
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res.status)
      const eventId = (res.headers.get('location') ?? '').split('/events/')[1]

      // 1. Verify D1 SQLite verbatim storage
      const [saved] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, eventId))
      expect(saved.rsoName).toBe(rsoUnicode)
      expect(saved.lcoName).toBe(lcoUnicode)
      expect(saved.launchDirector).toBe(directorUnicode)
      expect(saved.tripoliPrefect).toBe(prefectUnicode)

      // 2. Verify /events/:id HTML detail view (Hono escapes ' to &#39;)
      const detailRes = await fetchGet(`/events/${eventId}`)
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toMatch(/José-María O(&#39;|')Connor-Smith 🚀/)
      expect(detailHtml).toContain(lcoUnicode)
      expect(detailHtml).toContain(directorUnicode)
      expect(detailHtml).toContain(prefectUnicode)

      // 3. Verify /events list view card badges
      const listRes = await fetchGet('/events')
      assertHtmlResponse(listRes, 200)
      const listHtml = await listRes.text()
      expect(listHtml).toMatch(/RSO:\s*José-María O(&#39;|')Connor-Smith 🚀/)
      expect(listHtml).toContain(`LCO: ${lcoUnicode}`)

      // 4. Verify /events/:id/edit pre-population
      const editRes = await fetchGet(`/events/${eventId}/edit`)
      assertHtmlResponse(editRes, 200)
      const editHtml = await editRes.text()
      expect(editHtml).toMatch(/value=["']José-María O(&#39;|')Connor-Smith 🚀["']/)
      expect(editHtml).toContain(lcoUnicode)

      // 5. Verify JSON API round-trip (verbatim JSON)
      const jsonRes = await fetchGet(`/events/${eventId}`, { Accept: 'application/json' })
      expect(jsonRes.status).toBe(200)
      const json = (await jsonRes.json()) as any
      expect(json.event.rsoName).toBe(rsoUnicode)
      expect(json.event.lcoName).toBe(lcoUnicode)
    })

    it('strictly neutralizes XSS and HTML injection attempts across all views', async () => {
      const site = await seedTestSite({ name: 'Cyber Defense Range' })
      const db = getDb()

      const xssRso = '<script>alert("XSS-RSO-INJECTION")</script>'
      const xssLco = '<img src=x onerror="alert(\'XSS-LCO-INJECTION\')">'
      const xssDirector = '"><script>alert("DIR-XSS")</script><input value="'
      const xssPrefect = '<b onmouseover="alert(\'PREFECT\')">Prefect</b>'

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Security Test Meet',
          launch_site_id: site.id,
          rso_name: xssRso,
          lco_name: xssLco,
          launch_director: xssDirector,
          tripoli_prefect: xssPrefect,
        },
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res.status)
      const eventId = (res.headers.get('location') ?? '').split('/events/')[1]

      // Verify D1 records the raw strings intact
      const [saved] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, eventId))
      expect(saved.rsoName).toBe(xssRso)
      expect(saved.lcoName).toBe(xssLco)

      // 1. Check /events/:id detail view: Unescaped scripts and unescaped handlers MUST NOT exist in HTML
      const detailRes = await fetchGet(`/events/${eventId}`)
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()

      assertNotContains(detailHtml, '<script>alert("XSS-RSO-INJECTION")</script>')
      assertNotContains(detailHtml, '<img src=x onerror=')
      assertNotContains(detailHtml, '<b onmouseover=')

      // Must be safely escaped
      expect(detailHtml).toContain('&lt;script&gt;alert(&quot;XSS-RSO-INJECTION&quot;)&lt;/script&gt;')
      expect(detailHtml).toContain('&lt;img src=x onerror=')
      expect(detailHtml).toContain('&lt;b onmouseover=')

      // 2. Check /events list view cards
      const listRes = await fetchGet('/events')
      assertHtmlResponse(listRes, 200)
      const listHtml = await listRes.text()

      assertNotContains(listHtml, '<script>alert("XSS-RSO-INJECTION")</script>')
      assertNotContains(listHtml, '<img src=x onerror=')
      expect(listHtml).toContain('&lt;script&gt;')
      expect(listHtml).toContain('&lt;img src=x')

      // 3. Check /events/:id/edit form: Value attributes must be escaped so attribute breakout fails
      const editRes = await fetchGet(`/events/${eventId}/edit`)
      assertHtmlResponse(editRes, 200)
      const editHtml = await editRes.text()

      assertNotContains(editHtml, '<script>alert("DIR-XSS")</script>')
      // Attribute breakout attempt must be escaped
      expect(editHtml).toMatch(/name=["']rso_name["'][^>]*value=["']&lt;script&gt;alert/i)

      // 4. JSON endpoint preserves raw string safely in valid JSON payload
      const jsonRes = await fetchGet(`/events/${eventId}`, { Accept: 'application/json' })
      expect(jsonRes.status).toBe(200)
      const json = (await jsonRes.json()) as any
      expect(json.event.rsoName).toBe(xssRso)
      expect(json.event.lcoName).toBe(xssLco)
    })

    it('coerces whitespace-only strings to null and trims leading/trailing whitespace', async () => {
      const site = await seedTestSite({ name: 'Whitespace Test Site' })
      const db = getDb()

      // 1. Whitespace-only strings: "   " and "\t\t\n  "
      const res1 = await fetchPostForm(
        '/events',
        {
          name: 'Whitespace Event 1',
          launch_site_id: site.id,
          rso_name: '   ',
          lco_name: '\t\t\n  \r\n',
        },
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res1.status)
      const id1 = (res1.headers.get('location') ?? '').split('/events/')[1]

      const [evt1] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, id1))
      expect(evt1.rsoName).toBeNull()
      expect(evt1.lcoName).toBeNull()

      // Detail view must show "None designated"
      const detail1 = await (await fetchGet(`/events/${id1}`)).text()
      expect(detail1).toMatch(/RSO:[\s\S]*?None designated/)
      expect(detail1).toMatch(/LCO:[\s\S]*?None designated/)

      // List card must NOT render empty badges with blank spaces
      const list1 = await (await fetchGet('/events')).text()
      expect(list1).not.toMatch(/RSO:\s*<\/span>/i)
      expect(list1).not.toMatch(/LCO:\s*<\/span>/i)

      // 2. Leading/trailing whitespace strings: "   Sarah Connor   "
      const res2 = await fetchPostForm(
        '/events',
        {
          name: 'Whitespace Event 2',
          launch_site_id: site.id,
          rso_name: '   Sarah Connor   ',
          lco_name: '  John Connor\t\t',
        },
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res2.status)
      const id2 = (res2.headers.get('location') ?? '').split('/events/')[1]

      const [evt2] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, id2))
      expect(evt2.rsoName).toBe('Sarah Connor')
      expect(evt2.lcoName).toBe('John Connor')
    })

    it('supports 500+ character officer names without database truncation or UI clipping errors', async () => {
      const site = await seedTestSite({ name: 'Long String Range' })
      const db = getDb()

      // 550 characters long name
      const longRsoName = 'Chief Safety Commander ' + 'A'.repeat(500) + ' Von Rocket'
      const longLcoName = 'Chief Firing Officer ' + 'B'.repeat(500) + ' Von Launch'

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Long Officers Launch Meet',
          launch_site_id: site.id,
          rso_name: longRsoName,
          lco_name: longLcoName,
        },
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res.status)
      const eventId = (res.headers.get('location') ?? '').split('/events/')[1]

      // 1. D1 persistence check (unclipped)
      const [saved] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, eventId))
      expect(saved.rsoName).toBe(longRsoName)
      expect(saved.lcoName).toBe(longLcoName)
      expect(saved.rsoName?.length).toBeGreaterThan(520)

      // 2. Detail view rendering check (does not crash or 500)
      const detailRes = await fetchGet(`/events/${eventId}`)
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain(longRsoName)
      expect(detailHtml).toContain(longLcoName)

      // 3. Edit view pre-population
      const editRes = await fetchGet(`/events/${eventId}/edit`)
      assertHtmlResponse(editRes, 200)
      const editHtml = await editRes.text()
      expect(editHtml).toContain(longRsoName)
      expect(editHtml).toContain(longLcoName)

      // 4. List view card rendering
      const listRes = await fetchGet('/events')
      assertHtmlResponse(listRes, 200)
      const listHtml = await listRes.text()
      expect(listHtml).toContain(longRsoName)
      expect(listHtml).toContain(longLcoName)
    })

    it('safely handles SQL injection payloads in officer fields via parameterized Drizzle queries', async () => {
      const site = await seedTestSite({ name: 'SQL Injection Proof Range' })
      const db = getDb()

      const sqliRso = "Robert'); DROP TABLE launch_events; --"
      const sqliLco = "' OR '1'='1' UNION SELECT * FROM users --"

      const res = await fetchPostForm(
        '/events',
        {
          name: 'SQLi Boundary Meet',
          launch_site_id: site.id,
          rso_name: sqliRso,
          lco_name: sqliLco,
        },
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res.status)
      const eventId = (res.headers.get('location') ?? '').split('/events/')[1]

      // Table launch_events MUST still exist and contain the event
      const [saved] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, eventId))
      expect(saved).toBeDefined()
      expect(saved.rsoName).toBe(sqliRso)
      expect(saved.lcoName).toBe(sqliLco)

      // Verify detail view renders the verbatim text safely
      const detailRes = await fetchGet(`/events/${eventId}`)
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain("Robert&#39;); DROP TABLE launch_events; --")
    })

    it('preserves multiline officer names without corrupting layout or HTML tags', async () => {
      const site = await seedTestSite({ name: 'Multiline Range' })
      const db = getDb()

      const multilineRso = 'Commander Shepard\nNormandy SR-2\nAlliance Navy'
      const multilineLco = 'Garrus Vakarian\nC-Sec Tactical\nTurian Hierarchy'

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Citadel Launch 2183',
          launch_site_id: site.id,
          rso_name: multilineRso,
          lco_name: multilineLco,
        },
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res.status)
      const eventId = (res.headers.get('location') ?? '').split('/events/')[1]

      const [saved] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, eventId))
      expect(saved.rsoName).toBe(multilineRso)
      expect(saved.lcoName).toBe(multilineLco)

      const detailRes = await fetchGet(`/events/${eventId}`)
      assertHtmlResponse(detailRes, 200)
    })
  })

  // ==========================================================================
  // Area 3: Flight Log Integration & Mid-Day Rotation Synergy (R1 + R3)
  // ==========================================================================
  describe('Area 3: Flight Log Integration & Mid-Day Rotation Synergy', () => {
    it('immediately reflects mid-day officer rotations in /flights/new?launch_event_id=... without latency', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestSite({ name: 'Synergy Range' })
      const db = getDb()

      // Phase 1: Morning Shift
      const event = await seedTestEvent(site.id, {
        name: 'Continuous Operations Meet',
        rsoName: 'Morning RSO Alice',
        lcoName: 'Morning LCO Bob',
      })

      // Flyer loads /flights/new with event query param during morning
      let formRes = await fetchGet(`/flights/new?launch_event_id=${event.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(formRes, 200)
      let formHtml = await formRes.text()

      // Assert Morning officers pre-filled
      expect(formHtml).toMatch(/name=["']rso_name["'][^>]*value=["']Morning RSO Alice["']/i)
      expect(formHtml).toMatch(/name=["']lco_name["'][^>]*value=["']Morning LCO Bob["']/i)
      expect(formHtml).toContain('data-rso="Morning RSO Alice"')
      expect(formHtml).toContain('data-lco="Morning LCO Bob"')

      // Phase 2: Mid-Day Shift Change (Event updated via POST /events/:id/edit)
      const update1 = await fetchPostForm(
        `/events/${event.id}/edit`,
        {
          name: 'Continuous Operations Meet',
          launch_site_id: site.id,
          rso_name: 'Midday RSO Charlie',
          lco_name: 'Midday LCO Diana',
        },
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(update1.status)

      // Flyer immediately loads /flights/new with event query param during midday
      formRes = await fetchGet(`/flights/new?launch_event_id=${event.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(formRes, 200)
      formHtml = await formRes.text()

      // Assert Midday officers pre-filled immediately, no morning officers
      expect(formHtml).toMatch(/name=["']rso_name["'][^>]*value=["']Midday RSO Charlie["']/i)
      expect(formHtml).toMatch(/name=["']lco_name["'][^>]*value=["']Midday LCO Diana["']/i)
      expect(formHtml).toContain('data-rso="Midday RSO Charlie"')
      expect(formHtml).toContain('data-lco="Midday LCO Diana"')
      assertNotContains(formHtml, 'value="Morning RSO Alice"')
      assertNotContains(formHtml, 'value="Morning LCO Bob"')

      // Phase 3: Evening Shift Change (Event updated via JSON PUT /events/:id)
      const update2 = await SELF.fetch(`https://example.com/events/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: 'Continuous Operations Meet',
          launch_site_id: site.id,
          rso_name: 'Evening RSO Evan',
          lco_name: 'Evening LCO Fiona',
        }),
      })
      expect(update2.status).toBe(200)

      // Flyer immediately loads /flights/new during evening
      formRes = await fetchGet(`/flights/new?launch_event_id=${event.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(formRes, 200)
      formHtml = await formRes.text()

      expect(formHtml).toMatch(/name=["']rso_name["'][^>]*value=["']Evening RSO Evan["']/i)
      expect(formHtml).toMatch(/name=["']lco_name["'][^>]*value=["']Evening LCO Fiona["']/i)
      expect(formHtml).toContain('data-rso="Evening RSO Evan"')
      expect(formHtml).toContain('data-lco="Evening LCO Fiona"')
      assertNotContains(formHtml, 'Midday RSO Charlie')
    })

    it('ensures flight manual duty officer overrides do NOT mutate the launch event record', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()
      const db = getDb()

      const event = await seedTestEvent(site.id, {
        name: 'Strict Event Safety Officers Meet',
        rsoName: 'Permanent Event RSO Peter',
        lcoName: 'Permanent Event LCO Paula',
      })

      // Flyer 1 logs Flight 1 with custom manual override (substitute officer on Pad B)
      const res1 = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          launch_site_id: site.id,
          launch_event_id: event.id,
          motor_id: motor.id,
          log_type: 'actual',
          outcome: 'GOOD',
          rso_name: 'Substitute Pad B RSO Sam',
          lco_name: 'Substitute Pad B LCO Sally',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res1.status)
      const flight1Id = (res1.headers.get('location') ?? '').split('/flights/')[1]

      // Verify Flight 1 has the manual override officers
      const [f1] = await db.select().from(schema.flights).where(eq(schema.flights.id, flight1Id))
      expect(f1.rsoName).toBe('Substitute Pad B RSO Sam')
      expect(f1.lcoName).toBe('Substitute Pad B LCO Sally')

      // Verify Event record remains COMPLETELY UNMUTATED
      let [savedEvent] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, event.id))
      expect(savedEvent.rsoName).toBe('Permanent Event RSO Peter')
      expect(savedEvent.lcoName).toBe('Permanent Event LCO Paula')

      // Flyer 2 logs Flight 2 with cleared/blank duty officers
      const res2 = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          launch_site_id: site.id,
          launch_event_id: event.id,
          motor_id: motor.id,
          log_type: 'actual',
          outcome: 'GOOD',
          rso_name: '',
          lco_name: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res2.status)
      const flight2Id = (res2.headers.get('location') ?? '').split('/flights/')[1]

      const [f2] = await db.select().from(schema.flights).where(eq(schema.flights.id, flight2Id))
      expect(f2.rsoName).toBeNull()
      expect(f2.lcoName).toBeNull()

      // Verify Event record STILL remains COMPLETELY UNMUTATED
      ;[savedEvent] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, event.id))
      expect(savedEvent.rsoName).toBe('Permanent Event RSO Peter')
      expect(savedEvent.lcoName).toBe('Permanent Event LCO Paula')

      // Future flight log form opens with permanent event officers intact
      const nextFormRes = await fetchGet(`/flights/new?launch_event_id=${event.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      const nextFormHtml = await nextFormRes.text()
      expect(nextFormHtml).toMatch(/name=["']rso_name["'][^>]*value=["']Permanent Event RSO Peter["']/i)
      expect(nextFormHtml).toMatch(/name=["']lco_name["'][^>]*value=["']Permanent Event LCO Paula["']/i)
    })

    it('populates exotic and Unicode duty officers seamlessly into the flight log form', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestSite()

      const exoticRso = "José-María O'Connor 🚀"
      const exoticLco = '田中 健太郎 🛰️'

      const event = await seedTestEvent(site.id, {
        name: 'International Flight Meet',
        rsoName: exoticRso,
        lcoName: exoticLco,
      })

      const res = await fetchGet(`/flights/new?launch_event_id=${event.id}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toMatch(/data-rso=["']José-María O(&#39;|')Connor 🚀["']/i)
      expect(html).toContain(`data-lco="${exoticLco}"`)
      expect(html).toMatch(/value=["']José-María O(&#39;|')Connor 🚀["']/i)
      expect(html).toMatch(/value=["']田中 健太郎 🛰️["']/i)
    })
  })
})
