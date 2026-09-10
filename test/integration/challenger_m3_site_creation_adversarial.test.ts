/**
 * Adversarial Challenger Integration Test Suite:
 * Milestone 3 (Requirement R3) Non-Destructive Site Creation & Form Preservation
 *
 * Scenarios Tested:
 * 1. Security stress-testing for `return_to` parameter in `POST /sites`:
 *    - Open redirect attack vectors: `//evil.com`, `https://attacker.com`, `javascript:alert(1)`,
 *      `http://attacker.com`, `ftp://evil.com`, `data:text/html,...`.
 *    - Strict internal path enforcement: relative `/events/new`, `/events/new?tab=all`,
 *      and state-preserving paths `/events/new?name=...`.
 *    - Server defaults to `/sites/:id` on any suspicious external destination.
 *    - Query parameter vs form body precedence and JSON modal API non-redirection.
 *
 * 2. Form state preservation stress-testing on `/events/new`:
 *    - Full pre-population across all event fields (`launch_site_id`, `name`, `starts_on`,
 *      `ends_on`, `pad_count`, `launch_director`, `tripoli_prefect`, `rso_name`, `lco_name`, `weather_notes`).
 *    - Adversarial payload stress-testing: special characters (`&`, `"`, `'`, `<`, `>`, `/`, `%20`, `+`, emojis 🚀),
 *      multi-byte text, and XSS attack strings.
 *    - Verifies proper HTML escaping in attribute quotes (`value="..."`) and `<textarea>` content
 *      without truncation, attribute injection, or syntax breakage.
 *    - Boundary validation on numeric fields and dates.
 *    - End-to-end persistence verification: submitting preserved data to `POST /events` persists
 *      exact unescaped values in D1.
 *
 * 3. Rapid concurrent site creation via AJAX JSON endpoint (`POST /sites`):
 *    - Rapid parallel dispatch (`Promise.all`) of 12 boundary sites.
 *    - Boundary coordinate values (North/South poles ±90°, Date Line ±180°, Null Island 0°/0°).
 *    - Boundary altitude ceilings (`0`, `null`, omitted, `500000m`).
 *    - High-precision decimals, Unicode names, and camelCase vs snake_case keys.
 *    - Concurrent rejection of invalid payloads with 0 DB side-effects.
 *
 * 4. End-to-end non-destructive workflow simulation (AJAX modal site creation -> event persistence).
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import {
  getDb,
  seedTestSite,
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

describe('Adversarial Challenger: Milestone 3 Site Creation & Form Preservation (Requirement R3)', () => {
  // ==========================================================================
  // Section 1: Security Stress-Testing for `return_to` in `POST /sites`
  // ==========================================================================
  describe('1. Security Stress-Testing for `return_to` Parameter', () => {
    it('rejects protocol-relative open redirect `//evil.com` and defaults to `/sites/:id`', async () => {
      const res = await fetchPostForm(
        '/sites',
        {
          name: 'Vuln Test Site Alpha',
          return_to: '//evil.com',
        },
        {},
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') ?? ''
      expect(location).not.toContain('evil.com')
      expect(location).toMatch(/^\/sites\/[0-9a-f-]{36}$/i)

      const siteId = location.replace('/sites/', '')
      const db = getDb()
      const [site] = await db
        .select()
        .from(schema.launchSites)
        .where(eq(schema.launchSites.id, siteId))
      expect(site).toBeDefined()
      expect(site.name).toBe('Vuln Test Site Alpha')
    })

    it('rejects absolute URL open redirect `https://attacker.com` and defaults to `/sites/:id`', async () => {
      const res = await fetchPostForm(
        '/sites',
        {
          name: 'Vuln Test Site Beta',
          return_to: 'https://attacker.com/malicious/target',
        },
        {},
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') ?? ''
      expect(location).not.toContain('attacker.com')
      expect(location).toMatch(/^\/sites\/[0-9a-f-]{36}$/i)
    })

    it('rejects script scheme `javascript:alert(1)` and defaults to `/sites/:id`', async () => {
      const res = await fetchPostForm(
        '/sites',
        {
          name: 'Vuln Test Site Gamma',
          return_to: 'javascript:alert(1)',
        },
        {},
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') ?? ''
      expect(location).not.toContain('javascript:')
      expect(location).toMatch(/^\/sites\/[0-9a-f-]{36}$/i)
    })

    it('rejects other external/malicious protocols (`http:`, `ftp:`, `data:`, `///`)', async () => {
      const attackVectors = [
        'http://evil.com/phishing',
        'ftp://evil.com/warez',
        'data:text/html,<script>alert(1)</script>',
        '///attacker.com/bypass',
      ]

      for (const vector of attackVectors) {
        const res = await fetchPostForm(
          '/sites',
          {
            name: `Vector Test Site ${vector.slice(0, 8)}`,
            return_to: vector,
          },
          {},
          { redirect: 'manual' },
        )

        expect([302, 303]).toContain(res.status)
        const location = res.headers.get('location') ?? ''
        expect(location).not.toContain('attacker.com')
        expect(location).not.toContain('evil.com')
        expect(location).not.toContain('alert')
        expect(location).toMatch(/^\/sites\/[0-9a-f-]{36}$/i)
      }
    })

    it('rejects open redirect in URL query string `POST /sites?return_to=//evil.com`', async () => {
      const res = await fetchPostForm(
        '/sites?return_to=//evil.com',
        {
          name: 'Query Param Open Redirect Test',
        },
        {},
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') ?? ''
      expect(location).not.toContain('evil.com')
      expect(location).toMatch(/^\/sites\/[0-9a-f-]{36}$/i)
    })

    it('strictly permits valid relative internal path `return_to=/events/new` appending `launch_site_id`', async () => {
      const res = await fetchPostForm(
        '/sites',
        {
          name: 'Permitted Internal Relative Site',
          return_to: '/events/new',
        },
        {},
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') ?? ''
      expect(location).toMatch(/^\/events\/new\?launch_site_id=[0-9a-f-]{36}$/i)

      const siteId = location.split('launch_site_id=')[1]
      const db = getDb()
      const [site] = await db
        .select()
        .from(schema.launchSites)
        .where(eq(schema.launchSites.id, siteId))
      expect(site).toBeDefined()
      expect(site.name).toBe('Permitted Internal Relative Site')
    })

    it('strictly permits valid relative path with existing query parameters `return_to=/events/new?tab=all`', async () => {
      const res = await fetchPostForm(
        '/sites',
        {
          name: 'Internal Relative With Query Site',
          return_to: '/events/new?tab=all',
        },
        {},
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') ?? ''
      expect(location).toMatch(/^\/events\/new\?tab=all&launch_site_id=[0-9a-f-]{36}$/i)
    })

    it('preserves existing complex form query parameters in `return_to`', async () => {
      const complexReturnTo = '/events/new?name=Autumn%20Spectacular&pad_count=18&launch_director=Alan'
      const res = await fetchPostForm(
        '/sites',
        {
          name: 'Preserved Complex Query Site',
          return_to: complexReturnTo,
        },
        {},
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') ?? ''
      expect(location).toContain('name=Autumn%20Spectacular')
      expect(location).toContain('pad_count=18')
      expect(location).toContain('launch_director=Alan')
      expect(location).toMatch(/&launch_site_id=[0-9a-f-]{36}$/i)
    })

    it('ignores `return_to` on AJAX JSON `POST /sites` and always returns HTTP 201 JSON', async () => {
      const res = await SELF.fetch('https://example.com/sites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'JSON Site Non-Redirect Test',
          return_to: '//evil.com',
        }),
      })

      expect(res.status).toBe(201)
      const data = (await res.json()) as any
      expect(data.id).toMatch(/^[0-9a-f-]{36}$/i)
      expect(data.name).toBe('JSON Site Non-Redirect Test')
      expect(res.headers.get('location')).toBeNull()
    })
  })

  // ==========================================================================
  // Section 2: Form State Preservation Stress-Testing on `/events/new`
  // ==========================================================================
  describe('2. Form State Preservation Stress-Testing on `/events/new`', () => {
    it('pre-populates EVERY single event field via query parameters without errors', async () => {
      const site = await seedTestSite({ name: 'Mount Eba Range' })

      const queryParams = new URLSearchParams({
        launch_site_id: site.id,
        name: 'Southern Skies 2026 Invitational',
        starts_on: '2026-10-20',
        ends_on: '2026-10-24',
        pad_count: '24',
        launch_director: 'Gene Kranz',
        tripoli_prefect: 'Chris Kraft',
        rso_name: 'Andrew Buttery',
        lco_name: 'Jerome Pong',
        weather_notes: 'Temperature 24C, calm winds under 8 knots, visibility 15km',
      })

      const res = await fetchGet(`/events/new?${queryParams.toString()}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // 1. Host launch site selected in dropdown
      expect(html).toMatch(new RegExp(`<option[^>]*value=["']${site.id}["'][^>]*selected`, 'i'))
      expect(html).toContain('Mount Eba Range')

      // 2. Event name input
      expect(html).toMatch(/name=["']name["'][^>]*value=["']Southern Skies 2026 Invitational["']/i)

      // 3. Starts on date input
      expect(html).toMatch(/name=["']starts_on["'][^>]*value=["']2026-10-20["']/i)

      // 4. Ends on date input
      expect(html).toMatch(/name=["']ends_on["'][^>]*value=["']2026-10-24["']/i)

      // 5. Pad count number input
      expect(html).toMatch(/name=["']pad_count["'][^>]*value=["']24["']/i)

      // 6. Launch Director text input
      expect(html).toMatch(/name=["']launch_director["'][^>]*value=["']Gene Kranz["']/i)

      // 7. Tripoli Prefect text input
      expect(html).toMatch(/name=["']tripoli_prefect["'][^>]*value=["']Chris Kraft["']/i)

      // 8. Range Safety Officer text input
      expect(html).toMatch(/name=["']rso_name["'][^>]*value=["']Andrew Buttery["']/i)

      // 9. Launch Control Officer text input
      expect(html).toMatch(/name=["']lco_name["'][^>]*value=["']Jerome Pong["']/i)

      // 10. Weather notes textarea
      expect(html).toMatch(
        /<textarea[^>]*name=["']weather_notes["'][^>]*>[\s\S]*?Temperature 24C, calm winds under 8 knots, visibility 15km[\s\S]*?<\/textarea>/i,
      )

      // 11. Modal dialog and non-destructive buttons present
      expect(html).toContain('id="new-site-modal"')
      expect(html).toContain('id="open-create-site-modal"')
      expect(html).toContain('/sites/new?return_to=/events/new')
    })

    it('safely escapes special characters (`&`, `"`, `\'`, `<tag>`, emojis) without breaking HTML attribute quotes', async () => {
      const site = await seedTestSite({ name: 'Escaping Benchmark Field' })

      const rawAdversarialName = 'Apollo & "Gemini" <X-15> \'Rocketry\' Test 🚀'
      const rawAdversarialDirector = 'Dr. O\'Connor & "Skip" <Lead>'
      const rawAdversarialPrefect = 'Col. "Rocket" O\'Neill & <Prefect>'
      const rawAdversarialRSO = 'Safety "Hawk" & D\'Angelo <RSO>'
      const rawAdversarialLCO = 'Firing "Chief" & O\'Leary <LCO>'
      const rawAdversarialWeather =
        'Wind: > 15 kts & 38°C. Notes: "Go for launch" & \'All clear\'. <script>alert("XSS")</script>'

      const queryParams = new URLSearchParams({
        launch_site_id: site.id,
        name: rawAdversarialName,
        launch_director: rawAdversarialDirector,
        tripoli_prefect: rawAdversarialPrefect,
        rso_name: rawAdversarialRSO,
        lco_name: rawAdversarialLCO,
        weather_notes: rawAdversarialWeather,
      })

      const res = await fetchGet(`/events/new?${queryParams.toString()}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Verify unescaped dangerous raw HTML script tag is NOT present
      assertNotContains(html, '<script>alert("XSS")</script>')

      // Verify HTML quotes are properly entity-encoded inside inputs so attributes do not close prematurely
      // The double quotes must be &quot;, single quotes &#39; or intact, angle brackets &lt; and &gt;, ampersand &amp;
      assertContains(html, '&quot;Gemini&quot;')
      assertContains(html, '&lt;X-15&gt;')
      assertContains(html, '&amp;')

      // Verify each input retains its complete, uncorrupted value when rendered
      expect(html).toMatch(/id="name"[^>]*value="[^"]*&quot;Gemini&quot;[^"]*"/i)
      expect(html).toMatch(/id="launch_director"[^>]*value="[^"]*&quot;Skip&quot;[^"]*"/i)
      expect(html).toMatch(/id="tripoli_prefect"[^>]*value="[^"]*&quot;Rocket&quot;[^"]*"/i)
      expect(html).toMatch(/id="rso_name"[^>]*value="[^"]*&quot;Hawk&quot;[^"]*"/i)
      expect(html).toMatch(/id="lco_name"[^>]*value="[^"]*&quot;Chief&quot;[^"]*"/i)

      // Verify textarea contains escaped weather notes
      expect(html).toContain('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;')
      expect(html).toContain('38°C')
    })

    it('handles extreme dates, leap days, and pad count boundary values', async () => {
      const site = await seedTestSite({ name: 'Boundary Range' })

      // Case A: Minimum pad count (1) and historical leap day
      const queryA = new URLSearchParams({
        launch_site_id: site.id,
        name: 'Historical Leap Day Meet',
        starts_on: '2024-02-29',
        ends_on: '2024-02-29',
        pad_count: '1',
      })
      const resA = await fetchGet(`/events/new?${queryA.toString()}`)
      assertHtmlResponse(resA, 200)
      const htmlA = await resA.text()
      expect(htmlA).toMatch(/name=["']pad_count["'][^>]*value=["']1["']/i)
      expect(htmlA).toMatch(/name=["']starts_on["'][^>]*value=["']2024-02-29["']/i)

      // Case B: Maximum pad count (100) and future date
      const queryB = new URLSearchParams({
        launch_site_id: site.id,
        name: 'Mega Range Century Meet',
        starts_on: '2030-01-01',
        ends_on: '2030-01-05',
        pad_count: '100',
      })
      const resB = await fetchGet(`/events/new?${queryB.toString()}`)
      assertHtmlResponse(resB, 200)
      const htmlB = await resB.text()
      expect(htmlB).toMatch(/name=["']pad_count["'][^>]*value=["']100["']/i)
      expect(htmlB).toMatch(/name=["']starts_on["'][^>]*value=["']2030-01-01["']/i)
    })

    it('completes end-to-end preservation round-trip: pre-population -> HTML form -> D1 persistence', async () => {
      const site = await seedTestSite({ name: 'Roundtrip Verification Range' })

      const testValues = {
        name: 'Preserved Roundtrip Meet 2026 & "Elite"',
        launch_site_id: site.id,
        starts_on: '2026-12-10',
        ends_on: '2026-12-12',
        pad_count: '14',
        launch_director: 'Cmdr. O\'Neill',
        tripoli_prefect: 'Dr. "Hypersonic" Vance',
        rso_name: 'Andrew Buttery',
        lco_name: 'Jerome Pong',
        weather_notes: 'Clear skies, 22°C, wind < 5 knots, perfect flight conditions.',
      }

      // Step 1: Pre-populate form via query params
      const queryParams = new URLSearchParams(testValues)
      const formRes = await fetchGet(`/events/new?${queryParams.toString()}`)
      assertHtmlResponse(formRes, 200)
      const formHtml = await formRes.text()
      expect(formHtml).toContain('Roundtrip Verification Range')

      // Step 2: Submit POST /events with these exact values (as if flyer clicked submit)
      const postRes = await fetchPostForm(
        '/events',
        testValues,
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(postRes.status)
      const location = postRes.headers.get('location') ?? ''
      expect(location).toMatch(/\/events\/[0-9a-f-]{36}$/i)
      const eventId = location.split('/events/')[1]

      // Step 3: Verify authentic persistence in D1 database
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, eventId))

      expect(saved).toBeDefined()
      expect(saved.name).toBe(testValues.name)
      expect(saved.launchSiteId).toBe(site.id)
      expect(saved.startsOn).toBe(testValues.starts_on)
      expect(saved.endsOn).toBe(testValues.ends_on)
      expect(saved.padCount).toBe(14)
      expect(saved.launchDirector).toBe(testValues.launch_director)
      expect(saved.tripoliPrefect).toBe(testValues.tripoli_prefect)
      expect(saved.rsoName).toBe(testValues.rso_name)
      expect(saved.lcoName).toBe(testValues.lco_name)
      expect(saved.weatherNotes).toBe(testValues.weather_notes)

      // Step 4: Verify event detail view renders without corrupting escaped characters
      const detailRes = await fetchGet(`/events/${eventId}`)
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain('Andrew Buttery')
      expect(detailHtml).toContain('Jerome Pong')
      expect(detailHtml).toContain('Cmdr. O&#39;Neill')
      assertNotContains(detailHtml, 'None designated')
    })
  })

  // ==========================================================================
  // Section 3: Rapid Concurrent Site Creation via AJAX JSON Endpoint (`POST /sites`)
  // ==========================================================================
  describe('3. Rapid Concurrent Site Creation via AJAX JSON Endpoint', () => {
    it('creates 12 boundary sites rapidly in parallel with HTTP 201 and valid unique UUIDs', async () => {
      const boundarySiteConfigs = [
        {
          name: 'Concurrent Boundary: North Pole Extreme',
          latitude: 90,
          longitude: 0,
          max_altitude_agl_m: 50000,
          notes: 'Extreme North Boundary',
        },
        {
          name: 'Concurrent Boundary: South Pole Extreme',
          latitude: -90,
          longitude: 0,
          max_altitude_agl_m: 0,
          notes: 'Extreme South Boundary & Zero Ceiling',
        },
        {
          name: 'Concurrent Boundary: Date Line East',
          latitude: 0,
          longitude: 180,
          max_altitude_agl_m: 100000,
          notes: 'Extreme East Longitude',
        },
        {
          name: 'Concurrent Boundary: Date Line West',
          latitude: 0,
          longitude: -180,
          max_altitude_agl_m: null,
          notes: 'Extreme West Longitude & Null Ceiling',
        },
        {
          name: 'Concurrent Boundary: Null Island Equatorial',
          latitude: 0,
          longitude: 0,
          max_altitude_agl_m: 15000,
          notes: 'Exact Equator / Prime Meridian',
        },
        {
          name: 'Concurrent Boundary: Explicit Zero Ceiling Only',
          latitude: -34.55,
          longitude: 138.65,
          max_altitude_agl_m: 0,
          notes: 'Ground-level ceiling only',
        },
        {
          name: 'Concurrent Boundary: Explicit Null Ceiling Only',
          latitude: -31.15,
          longitude: 136.8,
          max_altitude_agl_m: null,
          notes: 'Uncapped airspace',
        },
        {
          name: 'Concurrent Boundary: Suborbital Space Ceiling',
          latitude: -30.0,
          longitude: 135.0,
          max_altitude_agl_m: 500000,
          notes: 'Suborbital space boundary 500km',
        },
        {
          name: 'Concurrent Boundary: Unicode & Special Chars 🚀 "Alpha" & <Beta>',
          latitude: -32.1,
          longitude: 137.2,
          max_altitude_agl_m: 25000,
          notes: 'Special chars in site name and notes: & " \' < >',
        },
        {
          name: 'Concurrent Boundary: Minimal Omitted Optionals',
          latitude: -28.0,
          longitude: 134.0,
        },
        {
          name: 'Concurrent Boundary: High-Precision Floating Coordinates',
          latitude: -31.12345678,
          longitude: 136.98765432,
          max_altitude_agl_m: 12345.67,
          notes: 'Precision geodetic coordinates',
        },
        {
          name: 'Concurrent Boundary: CamelCase Parameter Aliases',
          latitude: -25.5,
          longitude: 131.5,
          maxAltitudeAglM: 35000,
          notes: 'CamelCase ceiling parameter',
        },
      ]

      // Dispatch all 12 requests concurrently
      const responses = await Promise.all(
        boundarySiteConfigs.map((payload) =>
          SELF.fetch('https://example.com/sites', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(payload),
          }),
        ),
      )

      // Verify every response succeeded with HTTP 201
      for (const res of responses) {
        expect(res.status).toBe(201)
        expect(res.headers.get('content-type')).toMatch(/application\/json/i)
      }

      // Parse JSON bodies
      const siteResults = await Promise.all(responses.map((res) => res.json() as Promise<any>))

      // Verify valid UUIDs and ensure no collisions
      const createdIds = siteResults.map((s) => s.id)
      for (const id of createdIds) {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      }
      expect(new Set(createdIds).size).toBe(12)

      // Query D1 database and verify each boundary condition persisted accurately
      const db = getDb()
      for (let i = 0; i < boundarySiteConfigs.length; i++) {
        const expected = boundarySiteConfigs[i]
        const created = siteResults[i]

        const [savedSite] = await db
          .select()
          .from(schema.launchSites)
          .where(eq(schema.launchSites.id, created.id))

        expect(savedSite).toBeDefined()
        expect(savedSite.name).toBe(expected.name)

        if (expected.latitude !== undefined) {
          expect(savedSite.latitude).toBeCloseTo(expected.latitude, 4)
        }
        if (expected.longitude !== undefined) {
          expect(savedSite.longitude).toBeCloseTo(expected.longitude, 4)
        }

        // Boundary assertion for ceiling: 0 must remain 0 (not null or NaN)
        const expectedCeiling =
          expected.max_altitude_agl_m !== undefined
            ? expected.max_altitude_agl_m
            : (expected as any).maxAltitudeAglM !== undefined
            ? (expected as any).maxAltitudeAglM
            : null

        if (expectedCeiling === 0) {
          expect(savedSite.maxAltitudeAglM).toBe(0)
        } else if (expectedCeiling === null) {
          expect(savedSite.maxAltitudeAglM).toBeNull()
        } else if (expectedCeiling !== undefined) {
          expect(savedSite.maxAltitudeAglM).toBeCloseTo(expectedCeiling, 2)
        }
      }
    })

    it('rejects invalid site creations under concurrent stress without creating ghost records', async () => {
      const invalidPayloads = [
        {},
        { name: '' },
        { name: '   ' },
        { latitude: -35.0, longitude: 138.0 },
        { name: null },
      ]

      const responses = await Promise.all(
        invalidPayloads.map((payload) =>
          SELF.fetch('https://example.com/sites', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(payload),
          }),
        ),
      )

      for (const res of responses) {
        expect(res.status).toBe(400)
        const json = (await res.json()) as any
        expect(json.error).toBe('Site name is required')
      }

      // Ensure no blank or invalid sites exist in D1
      const db = getDb()
      const allSites = await db.select().from(schema.launchSites)
      const blankSites = allSites.filter((s) => !s.name || s.name.trim() === '')
      expect(blankSites.length).toBe(0)
    })
  })

  // ==========================================================================
  // Section 4: Workflow Simulation: Non-Destructive Site Creation + Event Creation
  // ==========================================================================
  describe('4. Complete Non-Destructive Workflow Integration', () => {
    it('simulates flyer creating new site mid-form via AJAX modal and seamlessly finalizing event', async () => {
      // Step 1: User navigates to /events/new with draft form data
      const initialFormRes = await fetchGet(
        '/events/new?name=Outback+Thunder+2026&pad_count=12&launch_director=Alan+Shepard',
      )
      assertHtmlResponse(initialFormRes, 200)

      // Step 2: User realizes the site does not exist, clicks "+ Add new launch site" modal
      // User submits modal via AJAX JSON
      const siteRes = await SELF.fetch('https://example.com/sites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: 'Coober Pedy Desert Field',
          latitude: -29.01,
          longitude: 134.75,
          max_altitude_agl_m: 45000,
          notes: 'Remote outback opal mining desert field',
        }),
      })

      expect(siteRes.status).toBe(201)
      const newSite = (await siteRes.json()) as any
      expect(newSite.id).toBeDefined()
      expect(newSite.name).toBe('Coober Pedy Desert Field')

      // Step 3: With the newly created site ID in hand, user finalizes event submission
      const eventRes = await fetchPostForm(
        '/events',
        {
          name: 'Outback Thunder 2026',
          launch_site_id: newSite.id,
          starts_on: '2026-11-15',
          ends_on: '2026-11-18',
          pad_count: 12,
          launch_director: 'Alan Shepard',
          tripoli_prefect: 'Gus Grissom',
          rso_name: 'Andrew Buttery',
          lco_name: 'Jerome Pong',
          weather_notes: 'Desert heat 32C, zero precipitation, 10 knot wind.',
        },
        {},
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(eventRes.status)
      const eventLocation = eventRes.headers.get('location') ?? ''
      const eventId = eventLocation.split('/events/')[1]

      // Step 4: Verify event is correctly attached to the newly created site
      const db = getDb()
      const [savedEvent] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, eventId))

      expect(savedEvent).toBeDefined()
      expect(savedEvent.launchSiteId).toBe(newSite.id)
      expect(savedEvent.name).toBe('Outback Thunder 2026')
      expect(savedEvent.rsoName).toBe('Andrew Buttery')
      expect(savedEvent.lcoName).toBe('Jerome Pong')

      // Step 5: Verify event detail displays both the new site name and duty officers
      const detailRes = await fetchGet(`/events/${eventId}`)
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain('Coober Pedy Desert Field')
      expect(detailHtml).toContain('Andrew Buttery')
      expect(detailHtml).toContain('Jerome Pong')
      expect(detailHtml).toContain('Alan Shepard')
      expect(detailHtml).toContain('Gus Grissom')
    })
  })
})
