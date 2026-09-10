/**
 * End-to-End Integration & Acceptance Test Suite:
 * Usability and Domain Refinements (R1 - R4)
 *
 * Explicitly tests every Acceptance Criterion defined in
 * ORIGINAL_REQUEST.md (2026-09-08T07:54:37Z) & PROJECT.md:
 *
 * 1. Launch Events (R1):
 *    - Past launch events are clearly visible and organized on /events (sections, tabs, date badges).
 *    - Users can edit any event via /events/:id/edit (POST & PUT) and updates are saved to D1.
 *    - All past and upcoming events appear in flight logging event dropdown with:
 *      `${e.name} (${dateText}) — ${siteText}`.
 *
 * 2. Flight Logbook (R2):
 *    - Peak Altitude displays side-by-side meters and feet inputs, each half size.
 *    - Typing into feet updates meters, and typing into meters updates feet automatically
 *      (client script & server-side canonical calculation).
 *    - RSO and LCO are simple text input fields without requiring user account linking.
 *    - Flight logging form includes selectable toggle between Preflight Simulation / Planned
 *      ('preflight') and Post-Flight Actuals ('actual') with visual badges.
 *    - Flight form provides a single unified motor input instead of two separate motor fields,
 *      with automatic inventory stock decrement on actual flights and preservation on simulation.
 *
 * 3. Motor Casings & Hardware (R3):
 *    - Motor catalog detail, inventory views, and flight summary display required motor casing / hardware.
 *    - CSV import and motor creation reliably store and display the hardware casing specification.
 */

import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { SELF } from 'cloudflare:test'
import * as schema from '../../src/db/schema'
import { signSession } from '../../src/services/auth'
import {
  getDb,
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
  assertAlertBanner,
  assertContains,
  assertHasFormField,
  assertHtmlResponse,
  assertNotContains,
} from '../helpers/html'
import { fetchGet, fetchHtmxPostForm, fetchPostForm } from '../helpers/http'

beforeEach(truncateDb)

const CSV_HEADER =
  'Part_Number,Designation_Product_Name,Manufacturer,Diameter_mm,Hardware,Total_Impulse_Ns,Avg_Thrust_N,Peak_Thrust_N,Propellant_Type,Grains,Propellant_Weight_g,Grain_Weight_g,Total_Weight_g,UN_Number,Classification,Length,Thrust_Duration_Sec,Delay_Sec,USPS_Mailable,Notes'

describe('End-to-End Acceptance Suite: Usability & Domain Refinements (R1 - R4)', () => {
  const today = new Date().toISOString().slice(0, 10)

  // =========================================================================
  // REQUIREMENT 1: LAUNCH EVENTS (R1)
  // =========================================================================
  describe('Acceptance Criteria: Launch Events (R1)', () => {
    describe('AC 1.1: Past launch events are clearly visible and organized on /events', () => {
      it('partitions launch events into Upcoming and Past sections with distinct badges and tab navigation', async () => {
        const site = await seedTestSite({ name: 'Woomera Rocket Range' })

        const pastEvent = await seedTestEvent(site.id, {
          name: 'Woomera Autumn Meet 2021',
          startsOn: '2021-04-10',
          endsOn: '2021-04-12',
          padCount: 12,
        })

        const activeEvent = await seedTestEvent(site.id, {
          name: 'Active Equinox Launch Today',
          startsOn: today,
          endsOn: today,
          padCount: 8,
        })

        const upcomingEvent = await seedTestEvent(site.id, {
          name: 'Southern Hemisphere Solstice 2029',
          startsOn: '2029-12-21',
          endsOn: '2029-12-23',
          padCount: 20,
        })

        const res = await fetchGet('/events')
        assertHtmlResponse(res, 200)
        const html = await res.text()

        // 1. Both section headers are present
        expect(html).toContain('Upcoming Launches')
        expect(html).toContain('Past Launch Meets / Archive')

        // 2. All events are visible on the page
        expect(html).toContain('Woomera Autumn Meet 2021')
        expect(html).toContain('Active Equinox Launch Today')
        expect(html).toContain('Southern Hemisphere Solstice 2029')

        // 3. Status badges correspond to event timing
        expect(html).toContain('Past Meet')
        expect(html).toContain('Active Today')
        expect(html).toContain('Upcoming')

        // 4. Tab filters are provided
        expect(html).toContain('/events?tab=all')
        expect(html).toContain('/events?tab=upcoming')
        expect(html).toContain('/events?tab=past')

        // 5. Action links: "✏️ Edit Event" and "+ Log Flight" present on event cards
        expect(html).toContain(`/events/${pastEvent.id}/edit`)
        expect(html).toContain(`/events/${upcomingEvent.id}/edit`)
        expect(html).toContain(`/events/${activeEvent.id}/edit`)
        expect(html).toContain(`/flights/new?launch_event_id=${pastEvent.id}`)
      })

      it('filters sections cleanly when using ?tab=past and ?tab=upcoming query parameters', async () => {
        const site = await seedTestSite({ name: 'Lake Hart Range' })

        await seedTestEvent(site.id, {
          name: 'Historical Launch 2019',
          startsOn: '2019-05-01',
          endsOn: '2019-05-02',
        })

        await seedTestEvent(site.id, {
          name: 'Future Launch 2031',
          startsOn: '2031-08-10',
          endsOn: '2031-08-12',
        })

        // Tab: past
        const resPast = await fetchGet('/events?tab=past')
        assertHtmlResponse(resPast, 200)
        const htmlPast = await resPast.text()
        expect(htmlPast).toContain('Past Launch Meets / Archive')
        expect(htmlPast).toContain('Historical Launch 2019')
        expect(htmlPast).not.toContain('Upcoming Launches')
        expect(htmlPast).not.toContain('Future Launch 2031')

        // Tab: upcoming
        const resUpcoming = await fetchGet('/events?tab=upcoming')
        assertHtmlResponse(resUpcoming, 200)
        const htmlUpcoming = await resUpcoming.text()
        expect(htmlUpcoming).toContain('Upcoming Launches')
        expect(htmlUpcoming).toContain('Future Launch 2031')
        expect(htmlUpcoming).not.toContain('Past Launch Meets / Archive')
        expect(htmlUpcoming).not.toContain('Historical Launch 2019')
      })

      it('orders upcoming events chronologically ascending and past events descending', async () => {
        const site = await seedTestSite({ name: 'Cobram Launch Field' })

        await seedTestEvent(site.id, {
          name: 'Upcoming Later 2029-11',
          startsOn: '2029-11-01',
          endsOn: '2029-11-03',
        })
        await seedTestEvent(site.id, {
          name: 'Upcoming Sooner 2029-03',
          startsOn: '2029-03-01',
          endsOn: '2029-03-03',
        })

        await seedTestEvent(site.id, {
          name: 'Past Older 2018',
          startsOn: '2018-02-01',
          endsOn: '2018-02-03',
        })
        await seedTestEvent(site.id, {
          name: 'Past Recent 2023',
          startsOn: '2023-09-01',
          endsOn: '2023-09-03',
        })

        const res = await fetchGet('/events')
        const html = await res.text()

        // Upcoming: sooner before later
        expect(html.indexOf('Upcoming Sooner 2029-03')).toBeLessThan(html.indexOf('Upcoming Later 2029-11'))

        // Past: recent before older
        expect(html.indexOf('Past Recent 2023')).toBeLessThan(html.indexOf('Past Older 2018'))
      })
    })

    describe('AC 1.2: Users can edit any event via /events/:id/edit (POST & PUT) and updates are saved to D1', () => {
      it('renders GET /events/:id/edit with pre-populated form fields and header edit button on detail view', async () => {
        const site = await seedTestSite({ name: 'Lucerne Dry Lake' })
        const event = await seedTestEvent(site.id, {
          name: 'Spring Regional Rocket Rally',
          startsOn: '2027-04-15',
          endsOn: '2027-04-18',
          padCount: 24,
          launchDirector: 'Sarah Connor',
          tripoliPrefect: 'John Matrix',
          weatherNotes: 'Gusty morning crosswinds clearing by noon',
        })

        // 1. Check edit form
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

        expect(html).toContain('Spring Regional Rocket Rally')
        expect(html).toContain('2027-04-15')
        expect(html).toContain('2027-04-18')
        expect(html).toContain('Sarah Connor')
        expect(html).toContain('John Matrix')
        expect(html).toContain('Gusty morning crosswinds clearing by noon')
        expect(html).toContain(`action="/events/${event.id}/edit"`)

        // 2. Check detail view header has "✏️ Edit Event" button
        const detailRes = await fetchGet(`/events/${event.id}`)
        assertHtmlResponse(detailRes, 200)
        const detailHtml = await detailRes.text()
        expect(detailHtml).toContain(`/events/${event.id}/edit`)
        expect(detailHtml).toMatch(/Edit Event/i)
      })

      it('updates event attributes via POST /events/:id/edit, saves to D1, and redirects to detail view', async () => {
        const site1 = await seedTestSite({ name: 'Site One' })
        const site2 = await seedTestSite({ name: 'Site Two' })
        const event = await seedTestEvent(site1.id, {
          name: 'Original Event Name',
          startsOn: '2026-07-01',
          endsOn: '2026-07-02',
          padCount: 10,
        })

        const res = await fetchPostForm(
          `/events/${event.id}/edit`,
          {
            name: 'Updated Championship Meet',
            launch_site_id: site2.id,
            starts_on: '2026-07-10',
            ends_on: '2026-07-12',
            pad_count: 30,
            launch_director: 'Captain Miller',
            tripoli_prefect: 'Commander Stone',
            weather_notes: 'Clear skies and zero wind forecast',
          },
          {},
          { redirect: 'manual' },
        )

        expect([302, 303]).toContain(res.status)
        expect(res.headers.get('location')).toBe(`/events/${event.id}`)

        // Verify changes in D1
        const db = getDb()
        const [updated] = await db
          .select()
          .from(schema.launchEvents)
          .where(eq(schema.launchEvents.id, event.id))

        expect(updated).toBeDefined()
        expect(updated.name).toBe('Updated Championship Meet')
        expect(updated.launchSiteId).toBe(site2.id)
        expect(updated.startsOn).toBe('2026-07-10')
        expect(updated.endsOn).toBe('2026-07-12')
        expect(updated.padCount).toBe(30)
        expect(updated.launchDirector).toBe('Captain Miller')
        expect(updated.tripoliPrefect).toBe('Commander Stone')
        expect(updated.weatherNotes).toBe('Clear skies and zero wind forecast')
      })

      it('updates event via PUT /events/:id with JSON payload and updates D1', async () => {
        const site = await seedTestSite({ name: 'Serpentine Range' })
        const event = await seedTestEvent(site.id, {
          name: 'Initial Event for JSON PUT',
          padCount: 6,
        })

        const res = await SELF.fetch(`https://example.com/events/${event.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            name: 'Renamed via JSON PUT API',
            launch_site_id: site.id,
            pad_count: 18,
            launch_director: 'Dr. Katherine Pulaski',
          }),
        })

        expect(res.status).toBe(200)
        const json = await res.json()
        expect(json).toHaveProperty('name', 'Renamed via JSON PUT API')
        expect(json).toHaveProperty('padCount', 18)

        // Verify in D1
        const db = getDb()
        const [saved] = await db
          .select()
          .from(schema.launchEvents)
          .where(eq(schema.launchEvents.id, event.id))

        expect(saved.name).toBe('Renamed via JSON PUT API')
        expect(saved.padCount).toBe(18)
        expect(saved.launchDirector).toBe('Dr. Katherine Pulaski')
      })

      it('sanitizes empty string officer IDs to null without FK violations', async () => {
        const site = await seedTestSite({ name: 'Flinders Test Field' })
        const user = await seedTestUser({ displayName: 'Assigned Officer' })
        const event = await seedTestEvent(site.id, {
          name: 'Event with Officers',
          rsoUserId: user.id,
        })

        const res = await fetchPostForm(
          `/events/${event.id}/edit`,
          {
            name: 'Event with Cleared Officers',
            launch_site_id: site.id,
            rso_user_id: '',
            lco_user_id: '',
          },
          {},
          { redirect: 'manual' },
        )

        expect([302, 303]).toContain(res.status)
        const db = getDb()
        const [saved] = await db
          .select()
          .from(schema.launchEvents)
          .where(eq(schema.launchEvents.id, event.id))

        expect(saved.rsoUserId).toBeNull()
        expect(saved.lcoUserId).toBeNull()
      })
    })

    describe('AC 1.3: All past and upcoming events appear in the flight logging event dropdown', () => {
      it('formats options as `${e.name} (${dateText}) — ${siteText}` for past and upcoming events', async () => {
        const flyer = await seedTestUser({ displayName: 'Flight Pilot' })
        const token = await signSession(flyer.id)
        const site = await seedTestSite({ name: 'Woomera Launch Site' })

        // 1. Past multi-day event
        await seedTestEvent(site.id, {
          name: 'Historical Launch 2021',
          startsOn: '2021-03-10',
          endsOn: '2021-03-12',
        })

        // 2. Upcoming multi-day event
        await seedTestEvent(site.id, {
          name: 'Future Gathering 2029',
          startsOn: '2029-10-05',
          endsOn: '2029-10-07',
        })

        // 3. Single-day event
        await seedTestEvent(site.id, {
          name: 'One Day Fly-In 2028',
          startsOn: '2028-06-15',
          endsOn: '2028-06-15',
        })

        const res = await fetchGet('/flights/new', { Cookie: `triplet_session=${token}` })
        assertHtmlResponse(res, 200)
        const html = await res.text()

        expect(html).toContain('Historical Launch 2021 (2021-03-10 to 2021-03-12) — Woomera Launch Site')
        expect(html).toContain('Future Gathering 2029 (2029-10-05 to 2029-10-07) — Woomera Launch Site')
        expect(html).toContain('One Day Fly-In 2028 (2028-06-15) — Woomera Launch Site')
      })

      it('pre-selects formatted event option in GET /flights/:id/edit form', async () => {
        const flyer = await seedTestUser({ displayName: 'Flight Edit Pilot' })
        const token = await signSession(flyer.id)
        const site = await seedTestSite({ name: 'Lake Tyrrell Range' })
        const rocket = await seedTestRocket(flyer.id, { name: 'Aero Probe' })

        const event = await seedTestEvent(site.id, {
          name: 'Tyrrell Spring Launch 2026',
          startsOn: '2026-11-20',
          endsOn: '2026-11-22',
        })

        const flight = await seedTestFlight(flyer.id, {
          launchEventId: event.id,
          launchSiteId: site.id,
        })

        const res = await fetchGet(`/flights/${flight.id}/edit`, { Cookie: `triplet_session=${token}` })
        assertHtmlResponse(res, 200)
        const html = await res.text()

        expect(html).toContain('Tyrrell Spring Launch 2026 (2026-11-20 to 2026-11-22) — Lake Tyrrell Range')
      })
    })
  })

  // =========================================================================
  // REQUIREMENT 2: FLIGHT LOGBOOK USABILITY (R2)
  // =========================================================================
  describe('Acceptance Criteria: Flight Logbook (R2)', () => {
    describe('AC 2.1: Peak Altitude displays side-by-side meters and feet inputs, each half size', () => {
      it('renders #altitude_agl_m and #altitude_agl_ft side-by-side in a 2-column grid layout', async () => {
        const res = await fetchGet('/flights/new')
        assertHtmlResponse(res, 200)
        const html = await res.text()

        // Verify both inputs exist
        assertHasFormField(html, 'altitude_agl_m')
        assertHasFormField(html, 'altitude_agl_ft')
        expect(html).toContain('id="altitude_agl_m"')
        expect(html).toContain('id="altitude_agl_ft"')

        // Verify side-by-side half-width 2-column grid
        expect(html).toContain('grid grid-cols-2')
        expect(html).toContain('Meters (canonical)')
        expect(html).toContain('Feet')
      })
    })

    describe('AC 2.2: Typing into feet updates meters, and typing into meters updates feet automatically', () => {
      it('contains client-side bi-directional sync script with 0.3048 / 3.28084 conversion factors and HTMX dispatch', async () => {
        const res = await fetchGet('/flights/new')
        const html = await res.text()

        expect(html).toContain('initDualAltitudeSync')
        expect(html).toContain('3.28084')
        expect(html).toContain('0.3048')
        expect(html).toContain("mInput.dispatchEvent(new Event('change'")
      })

      it('computes and persists canonical meters in D1 when flyer submits altitude in feet only', async () => {
        const flyer = await seedTestUser({ displayName: 'Imperial Pilot' })
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const motor = await seedTestMotor({ impulseClass: 'G' })
        const site = await seedTestSite({ maxAltitudeAglM: 3000 })

        // 5280 feet = exactly 1609.344 meters
        const res = await fetchPostForm(
          '/flights',
          {
            rocket_configuration_id: config.id,
            motor_id: motor.id,
            launch_site_id: site.id,
            altitude_agl_ft: 5280,
            log_type: 'actual',
          },
          { Cookie: `triplet_session=${token}` },
        )

        expect([200, 302, 303]).toContain(res.status)

        const db = getDb()
        const [saved] = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.rocketConfigurationId, config.id))

        expect(saved).toBeDefined()
        expect(saved.altitudeAglM).toBeCloseTo(1609.34, 1)
      })

      it('triggers preflight waiver ceiling soft-gate when altitude is submitted in feet', async () => {
        const flyer = await seedTestUser()
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.5 })
        const motor = await seedTestMotor({ impulseClass: 'G' })
        const site = await seedTestSite({ maxAltitudeAglM: 1000 }) // 1,000m ceiling

        // 4921 ft = ~1,500m, which exceeds the 1,000m waiver ceiling
        const res = await fetchHtmxPostForm('/flights/preflight-check', {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_ft: 4921,
        })

        expect(res.status).toBe(200)
        const fragment = await res.text()
        assertAlertBanner(fragment, 'warning')
        expect(fragment).toMatch(/exceeds the site waiver ceiling/i)
      })

      it('renders dual units (meters and feet) together on flight detail view', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const motor = await seedTestMotor()
        const flight = await seedTestFlight(flyer.id, {
          rocketConfigurationId: config.id,
          motorId: motor.id,
          altitudeAglM: 850.0,
        })

        const res = await fetchGet(`/flights/${flight.id}`, { Cookie: `triplet_session=${token}` })
        assertHtmlResponse(res, 200)
        const html = await res.text()

        // Displays: 850 m (2,789 ft)
        expect(html).toMatch(/850\s*m\s*\(\s*2,?789\s*ft\s*\)/i)
      })
    })

    describe('AC 2.3: RSO and LCO are simple text input fields without requiring user account linking', () => {
      it('renders simple text input fields for rso_name and lco_name without registered user dropdowns', async () => {
        const res = await fetchGet('/flights/new')
        assertHtmlResponse(res, 200)
        const html = await res.text()

        assertHasFormField(html, 'rso_name')
        assertHasFormField(html, 'lco_name')
        expect(html).toContain('id="rso_name"')
        expect(html).toContain('id="lco_name"')
        expect(html).not.toContain('<select name="rso_user_id"')
        expect(html).not.toContain('<select name="lco_user_id"')
      })

      it('records visiting text duty officers directly in D1 and displays them on flight detail view', async () => {
        const flyer = await seedTestUser({ displayName: 'Launch Attendee' })
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const motor = await seedTestMotor({ impulseClass: 'G' })
        const site = await seedTestSite()

        const res = await fetchPostForm(
          '/flights',
          {
            rocket_configuration_id: config.id,
            motor_id: motor.id,
            launch_site_id: site.id,
            rso_name: 'Visiting RSO Jack Carter',
            lco_name: 'Visiting LCO Zoe Alleyne',
            altitude_agl_m: 620,
          },
          { Cookie: `triplet_session=${token}` },
        )

        expect([200, 302, 303]).toContain(res.status)

        const db = getDb()
        const [flight] = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.rocketConfigurationId, config.id))

        expect(flight).toBeDefined()
        expect(flight.rsoName).toBe('Visiting RSO Jack Carter')
        expect(flight.lcoName).toBe('Visiting LCO Zoe Alleyne')

        // Verify detail view displays duty officer text
        const detailRes = await fetchGet(`/flights/${flight.id}`, { Cookie: `triplet_session=${token}` })
        const detailHtml = await detailRes.text()
        expect(detailHtml).toContain('Visiting RSO Jack Carter')
        expect(detailHtml).toContain('Visiting LCO Zoe Alleyne')
      })
    })

    describe('AC 2.4: Flight logging form includes a selectable toggle between Preflight Simulation / Planned and Post-Flight Actuals', () => {
      it('provides selectable log_type toggle on new flight form with preflight and actual options', async () => {
        const res = await fetchGet('/flights/new')
        assertHtmlResponse(res, 200)
        const html = await res.text()

        assertHasFormField(html, 'log_type')
        expect(html).toContain('value="actual"')
        expect(html).toContain('value="preflight"')
        expect(html).toContain('Post-Flight Actuals')
        expect(html).toContain('Preflight Simulation / Planned')
      })

      it('stores log_type preflight and actual in D1 and renders distinct visual badges on lists and detail views', async () => {
        const flyer = await seedTestUser({ displayName: 'Dual Stage Pilot' })
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const motor = await seedTestMotor()
        const site = await seedTestSite()

        // 1. Log preflight record
        await fetchPostForm(
          '/flights',
          {
            rocket_configuration_id: config.id,
            motor_id: motor.id,
            launch_site_id: site.id,
            log_type: 'preflight',
            altitude_agl_m: 400,
          },
          { Cookie: `triplet_session=${token}` },
        )

        // 2. Log actual flight record
        await fetchPostForm(
          '/flights',
          {
            rocket_configuration_id: config.id,
            motor_id: motor.id,
            launch_site_id: site.id,
            log_type: 'actual',
            altitude_agl_m: 450,
          },
          { Cookie: `triplet_session=${token}` },
        )

        const db = getDb()
        const flights = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.rocketConfigurationId, config.id))

        expect(flights).toHaveLength(2)
        const preflightFlight = flights.find((f) => f.logType === 'preflight')
        const actualFlight = flights.find((f) => f.logType === 'actual')
        expect(preflightFlight).toBeDefined()
        expect(actualFlight).toBeDefined()

        // Verify list view badges
        const listRes = await fetchGet('/flights', { Cookie: `triplet_session=${token}` })
        const listHtml = await listRes.text()
        expect(listHtml).toContain('📋 Planned / Sim')
        expect(listHtml).toContain('🚀 Actual Flight')

        // Verify detail view badges
        const preflightDetailRes = await fetchGet(`/flights/${preflightFlight!.id}`, { Cookie: `triplet_session=${token}` })
        const preflightDetailHtml = await preflightDetailRes.text()
        expect(preflightDetailHtml).toContain('📋 Planned / Sim')

        const actualDetailRes = await fetchGet(`/flights/${actualFlight!.id}`, { Cookie: `triplet_session=${token}` })
        const actualDetailHtml = await actualDetailRes.text()
        expect(actualDetailHtml).toContain('🚀 Actual Flight')
      })
    })

    describe('AC 2.5: Flight form provides a single unified motor input with auto stock decrement and preservation on simulation', () => {
      it('renders single motor selector with stock badges and no duplicate visible motor_inventory_id dropdown', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const motorInStock = await seedTestMotor({ manufacturer: 'AeroTech', model: 'H128W' })
        const motorOutOfStock = await seedTestMotor({ manufacturer: 'Cesaroni', model: 'H153' })
        await seedTestInventory(flyer.id, motorInStock.id, { quantityOnHand: 5 })

        const res = await fetchGet('/flights/new', { Cookie: `triplet_session=${token}` })
        assertHtmlResponse(res, 200)
        const html = await res.text()

        // Single unified motor selector
        assertHasFormField(html, 'motor_id')
        expect(html).toContain('— [In Stock: 5]')
        expect(html).toContain('data-stock="5"')
        expect(html).toContain('data-stock="0"')
        expect(html).toContain('id="motor-stock-status"')

        // Hidden input present, but duplicate visible dropdown is absent
        expect(html).toContain('<input type="hidden" name="motor_inventory_id"')
        expect(html).not.toContain('<select name="motor_inventory_id"')
      })

      it('atomically decrements inventory stock on actual flights when user has on-hand stock', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const motor = await seedTestMotor({ impulseClass: 'G' })
        const site = await seedTestSite()
        const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 3, expendedCount: 0 })

        const res = await fetchPostForm(
          '/flights',
          {
            rocket_configuration_id: config.id,
            motor_id: motor.id,
            launch_site_id: site.id,
            log_type: 'actual',
            altitude_agl_m: 800,
          },
          { Cookie: `triplet_session=${token}` },
        )

        expect([200, 302, 303]).toContain(res.status)

        const db = getDb()
        const [updatedInv] = await db
          .select()
          .from(schema.motorInventories)
          .where(eq(schema.motorInventories.id, inv.id))

        expect(updatedInv.quantityOnHand).toBe(2)
        expect(updatedInv.expendedCount).toBe(1)
      })

      it('preserves inventory stock without decrementing on preflight simulation flights', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const motor = await seedTestMotor({ impulseClass: 'G' })
        const site = await seedTestSite()
        const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 4, expendedCount: 0 })

        const res = await fetchPostForm(
          '/flights',
          {
            rocket_configuration_id: config.id,
            motor_id: motor.id,
            launch_site_id: site.id,
            log_type: 'preflight',
            altitude_agl_m: 800,
          },
          { Cookie: `triplet_session=${token}` },
        )

        expect([200, 302, 303]).toContain(res.status)

        const db = getDb()
        const [savedInv] = await db
          .select()
          .from(schema.motorInventories)
          .where(eq(schema.motorInventories.id, inv.id))

        expect(savedInv.quantityOnHand).toBe(4)
        expect(savedInv.expendedCount).toBe(0)
      })

      it('falls back cleanly to catalog motor model when user has no inventory stock without errors', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const motor = await seedTestMotor({ impulseClass: 'G' })
        const site = await seedTestSite()

        // Flyer has zero inventory records for this motor
        const res = await fetchPostForm(
          '/flights',
          {
            rocket_configuration_id: config.id,
            motor_id: motor.id,
            launch_site_id: site.id,
            log_type: 'actual',
            altitude_agl_m: 350,
          },
          { Cookie: `triplet_session=${token}` },
        )

        expect([200, 302, 303]).toContain(res.status)

        const db = getDb()
        const [saved] = await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.rocketConfigurationId, config.id))

        expect(saved).toBeDefined()
        expect(saved.motorId).toBe(motor.id)
        expect(saved.motorInventoryId).toBeNull()
      })
    })
  })

  // =========================================================================
  // REQUIREMENT 3: MOTOR CASINGS & HARDWARE TRACKING (R3)
  // =========================================================================
  describe('Acceptance Criteria: Motor Casings & Hardware (R3)', () => {
    describe('AC 3.1: Motor catalog detail and inventory views display the required motor casing / hardware', () => {
      it('displays required casing hardware in motor detail header banner and physical specifications card', async () => {
        const motor = await seedTestMotor({
          manufacturer: 'AeroTech',
          model: 'RMS-29/40-120-G64W',
          impulseClass: 'G',
          hardware: 'RMS-29/40-120',
          casingReusable: true,
        })

        const res = await fetchGet(`/motors/${motor.id}`)
        assertHtmlResponse(res, 200)
        const html = await res.text()

        // Header banner
        assertContains(html, 'Required Casing / Hardware:', 'RMS-29/40-120')
        // Physical specs card
        assertContains(html, 'Required Casing / Hardware', 'RMS-29/40-120')
      })

      it('displays required casing on motor inventory cards in /inventory', async () => {
        const flyer = await seedTestUser({ displayName: 'Hardware Tracker' })
        const token = await signSession(flyer.id)
        const motor = await seedTestMotor({
          manufacturer: 'Cesaroni',
          model: 'Pro38-3G-H153',
          impulseClass: 'H',
          hardware: 'Pro38 3G',
          casingReusable: true,
        })
        await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 2 })

        const res = await fetchGet('/inventory', { Cookie: `triplet_session=${token}` })
        assertHtmlResponse(res, 200)
        const html = await res.text()

        assertContains(html, 'Casing:', 'Pro38 3G')
      })

      it('displays required casing in Propulsion Metrics summary on flight detail view', async () => {
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        const rocket = await seedTestRocket(flyer.id)
        const config = await seedTestConfig(rocket.id)
        const motor = await seedTestMotor({
          manufacturer: 'AeroTech',
          model: 'RMS-38/720-J350',
          impulseClass: 'J',
          hardware: 'RMS-38/720',
          casingReusable: true,
        })

        const flight = await seedTestFlight(flyer.id, {
          rocketConfigurationId: config.id,
          motorId: motor.id,
        })

        const res = await fetchGet(`/flights/${flight.id}`, { Cookie: `triplet_session=${token}` })
        assertHtmlResponse(res, 200)
        const html = await res.text()

        assertContains(html, 'Propulsion Metrics')
        assertContains(html, 'Required Casing / Hardware', 'RMS-38/720')
      })

      it('supports searching motor catalog by casing hardware name in backend query and data-search attribute', async () => {
        await seedTestMotor({
          manufacturer: 'AeroTech',
          model: 'E16W-4',
          impulseClass: 'E',
          hardware: 'RMS-29/40-120',
          casingReusable: true,
        })
        await seedTestMotor({
          manufacturer: 'Cesaroni',
          model: 'H120',
          impulseClass: 'H',
          hardware: 'Pro38 3G',
          casingReusable: true,
        })

        const res = await fetchGet('/motors?search=RMS-29/40-120')
        assertHtmlResponse(res, 200)
        const html = await res.text()

        assertContains(html, 'E16W-4', 'RMS-29/40-120')
        assertNotContains(html, 'H120')
        expect(html.toLowerCase()).toContain('rms-29/40-120')
      })
    })

    describe('AC 3.2: CSV import and motor creation reliably store and display the hardware casing specification', () => {
      it('reliably stores hardware casing on direct motor creation and displays it', async () => {
        const motor = await seedTestMotor({
          manufacturer: 'AeroTech',
          model: 'RMS-54/1706-K550W',
          impulseClass: 'K',
          hardware: 'RMS-54/1706',
          casingReusable: true,
        })

        const db = getDb()
        const [saved] = await db
          .select()
          .from(schema.motors)
          .where(eq(schema.motors.id, motor.id))

        expect(saved.hardware).toBe('RMS-54/1706')

        const res = await fetchGet(`/motors/${motor.id}`)
        const html = await res.text()
        expect(html).toContain('RMS-54/1706')
      })

      it('imports AeroTech and Cesaroni reloadable hardware from 20-column CSV into motors.hardware', async () => {
        const csvData = [
          CSV_HEADER,
          'AT-E16,E16W-4,AeroTech,29,RMS-29/40-120,38.0,16.0,32.0,White Lightning,1,18.0,18.0,65.0,UN0432,1.4C,85,2.4,4,true,AeroTech reload',
          'CTI-H153,H153-14A,Cesaroni,38,Pro38 3G,245.0,153.0,210.0,Classic,3,115.0,38.3,270.0,UN0432,1.4C,180,1.6,14,true,Cesaroni reload',
          'EST-C6,C6-5,Estes,18,Single Use,9.5,6.0,14.0,Black Powder,1,12.0,12.0,24.0,UN0432,1.4C,70,1.6,5,true,Single use model motor',
        ].join('\n')

        const res = await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })
        expect([200, 302, 303]).toContain(res.status)

        const db = getDb()

        // 1. Verify AeroTech reloadable motor
        const [atMotor] = await db
          .select()
          .from(schema.motors)
          .where(and(eq(schema.motors.model, 'E16W-4'), eq(schema.motors.manufacturer, 'AeroTech')))

        expect(atMotor).toBeDefined()
        expect(atMotor.hardware).toBe('RMS-29/40-120')
        expect(atMotor.casingReusable).toBe(true)

        // 2. Verify Cesaroni reloadable motor
        const [ctiMotor] = await db
          .select()
          .from(schema.motors)
          .where(and(eq(schema.motors.model, 'H153-14A'), eq(schema.motors.manufacturer, 'Cesaroni')))

        expect(ctiMotor).toBeDefined()
        expect(ctiMotor.hardware).toBe('Pro38 3G')
        expect(ctiMotor.casingReusable).toBe(true)

        // 3. Verify Single Use motor
        const [suMotor] = await db
          .select()
          .from(schema.motors)
          .where(and(eq(schema.motors.model, 'C6-5'), eq(schema.motors.manufacturer, 'Estes')))

        expect(suMotor).toBeDefined()
        expect(suMotor.casingReusable).toBe(false)

        // 4. Verify detail view for imported motor displays the hardware casing
        const detailRes = await fetchGet(`/motors/${atMotor.id}`)
        const detailHtml = await detailRes.text()
        expect(detailHtml).toContain('Required Casing / Hardware: RMS-29/40-120')

        // 5. Stock imported Cesaroni motor in flyer inventory and verify /inventory displays hardware
        const flyer = await seedTestUser()
        const token = await signSession(flyer.id)
        await seedTestInventory(flyer.id, ctiMotor.id, { quantityOnHand: 2 })

        const invRes = await fetchGet('/inventory', { Cookie: `triplet_session=${token}` })
        const invHtml = await invRes.text()
        expect(invHtml).toContain('Casing:')
        expect(invHtml).toContain('Pro38 3G')
      })
    })
  })
})
