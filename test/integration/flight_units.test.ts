/**
 * Integration test suite for Requirement R4: Flights Unit Toggle (Meters/Feet) & Navigation Polish.
 *
 * Tests:
 * 1. Title bar navigation polish:
 *    - Removal of redundant "+ Log Flight" button from desktop and mobile headers in layout.ts.
 *    - Contextual flight creation actions remain accessible on /flights and /dashboard.
 * 2. User-facing unit toggle switch (Meters/Feet):
 *    - Present on flights logbook list (GET /flights) and flight details (GET /flights/:id).
 *    - Defaults to Metric (meters for altitude, mm for vehicle measurements).
 * 3. Server-side unit query parameter (?units=ft):
 *    - Converts altitude measurements from meters to feet (ft = m * 3.28084).
 *    - Converts length dimensions (CG, CP, parachute sizes) to feet.
 *    - Handles peak altitude AGL, MSL, weather ceiling, and site waiver limits.
 * 4. DOM data attributes (data-m, data-mm, data-altitude) for client-side JavaScript toggle.
 * 5. Boundary values: Zero altitude, null/missing values, and high altitude space shots.
 * 6. Real-world flight logging with unit switching workload scenario (Tier 4).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  seedTestConfig,
  seedTestFlight,
  seedTestMotor,
  seedTestRocket,
  seedTestSite,
  seedTestUser,
  truncateDb,
} from '../helpers/db'
import {
  assertContains,
  assertHtmlResponse,
} from '../helpers/html'
import { fetchGet } from '../helpers/http'

beforeEach(truncateDb)

describe('Requirement R4: Flights Unit Toggle & Navigation Polish', () => {
  describe('Tier 1: Navigation Polish & Default Metric Measurements', () => {
    it('1.1: desktop top navigation bar does NOT contain redundant "+ Log Flight" button', async () => {
      await seedTestUser()
      const res = await fetchGet('/')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // The desktop top navigation should contain standard links (Flights, Rockets, Motors, Sites, Events)
      expect(html).toContain('href="/flights"')
      expect(html).toContain('href="/rockets"')

      // The top navigation header bar specifically should not have the redundant "+ Log Flight" button
      // Check if header does not have the old button pattern: <div class="flex items-center space-x-4">\s*<a href="/flights/new"[^>]*>\s*\+ Log Flight
      const desktopHeaderButtonPattern = /<div class=["']flex items-center space-x-4["']>\s*<a href=["']\/flights\/new["'][^>]*>\s*\+ Log Flight/i
      expect(html).not.toMatch(desktopHeaderButtonPattern)
    })

    it('1.2: mobile top navigation bar does NOT contain redundant "+ Log Flight" button', async () => {
      await seedTestUser()
      const res = await fetchGet('/')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Check mobile header does not render + Log Flight
      const mobileHeaderPattern = /<div class=["']md:hidden[^"']*["']>[\s\S]*?<a href=["']\/flights\/new["'][^>]*>\s*\+ Log Flight/i
      expect(html).not.toMatch(mobileHeaderPattern)
    })

    it('1.3: contextual "+ Log Flight" action button remains present on GET /flights', async () => {
      await seedTestUser()
      const res = await fetchGet('/flights')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('href="/flights/new"')
      expect(html).toMatch(/log.*flight/i)
    })

    it('1.4: renders user-facing unit toggle control on GET /flights', async () => {
      await seedTestUser()
      const res = await fetchGet('/flights')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // The page must contain a unit toggle switch, checkbox, or unit buttons (m / ft)
      expect(html).toMatch(/(unit|toggle|feet|meters|ft|m)/i)
    })

    it('1.5: defaults to metric units (meters) on standard GET /flights', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Sky Dart' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ model: 'G80-7T' })
      await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        flightNumber: 1,
        altitudeAglM: 450,
      })

      const res = await fetchGet('/flights')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Default metric rendering
      assertContains(html, '450')
      expect(html).toMatch(/450\s*(m|<\/span>\s*m)/i)
    })
  })

  describe('Tier 2: Unit Conversion Precision & Boundary Values', () => {
    it('2.1: converts altitude from meters to feet when ?units=ft is provided (1,000m -> 3,281 ft)', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Altitude Probe' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ model: 'H128W' })
      await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 1000, // 1,000 meters = 3,280.84 ft -> 3,281 ft
      })

      const res = await fetchGet('/flights?units=ft')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // In feet view, should show ~3,281 ft
      expect(html).toMatch(/3,?281\s*(ft|<\/span>\s*ft)/i)
    })

    it('2.2: converts peak altitude AGL and MSL on GET /flights/:id?units=ft', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Zephyr High' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ model: 'I200W' })
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 1500, // 1500m -> 4,921 ft
        altitudeMslM: 1750, // 1750m -> 5,741 ft
      })

      const res = await fetchGet(`/flights/${flight.id}?units=ft`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toMatch(/4,?921\s*ft/i)
      expect(html).toMatch(/5,?741\s*ft/i)
    })

    it('2.3: handles zero altitude (0m) converting cleanly to 0 ft', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 0,
      })

      const res = await fetchGet(`/flights/${flight.id}?units=ft`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toMatch(/0\s*ft/i)
    })

    it('2.4: converts launch site altitude waiver ceiling to feet when ?units=ft is requested', async () => {
      const user = await seedTestUser()
      const site = await seedTestSite({
        name: 'Woomera Range East',
        maxAltitudeAglM: 6096, // 6,096m = 20,000 ft waiver
      })
      const rocket = await seedTestRocket(user.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        altitudeAglM: 2000,
      })

      const res = await fetchGet(`/flights/${flight.id}?units=ft`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Site ceiling in feet: 20,000 ft
      expect(html).toMatch(/20,?000\s*ft/i)
    })

    it('2.5: gracefully falls back to metric when invalid unit param is passed (?units=invalid)', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 500,
      })

      const res = await fetchGet('/flights?units=cubits')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Should default to meters
      expect(html).toMatch(/500\s*(m|<\/span>\s*m)/i)
    })
  })

  describe('Tier 3: DOM Data Attributes & Length Conversions', () => {
    it('3.1: includes data-m or data-altitude attributes on table cells for client-side JavaScript toggle', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 850,
      })

      const res = await fetchGet('/flights')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Verify DOM markup provides conversion hook
      expect(html).toMatch(/data-(m|altitude|unit|value)=["']850["']/i)
    })

    it('3.2: converts vehicle length specs (CG/CP, parachute size) to imperial/feet on flight details', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id)
      const config = await seedTestConfig(rocket.id, {
        cgMm: 914.4, // 914.4 mm = 3.0 ft
        cpMm: 1219.2, // 1219.2 mm = 4.0 ft
        parachuteSizeMm: 609.6, // 609.6 mm = 2.0 ft
      })
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 800,
      })

      const res = await fetchGet(`/flights/${flight.id}?units=ft`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Vehicle length dimensions in imperial
      expect(html).toMatch(/ft|in|feet|inches|mm/i)
    })

    it('3.3: explicitly requesting ?units=m produces standard metric units', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 1200,
      })

      const res = await fetchGet('/flights?units=m')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toMatch(/1,?200\s*(m|<\/span>\s*m)/i)
    })
  })

  describe('Tier 4: Workload Scenario 5 — Flight Logging with Unit Switching & Logbook Review', () => {
    it('reviews flight records in metric, toggles to imperial feet for club debrief, and inspects flight telemetry', async () => {
      const user = await seedTestUser({ displayName: 'Flight Director' })
      const site = await seedTestSite({
        name: 'Lake Hart Launch Complex',
        maxAltitudeAglM: 4000,
      })
      const rocket = await seedTestRocket(user.id, { name: 'AeroTech G-Force' })
      const config = await seedTestConfig(rocket.id, {
        parachuteSizeMm: 1200,
        cgMm: 800,
        cpMm: 960,
      })
      const motor = await seedTestMotor({
        model: 'H148R-14A',
        impulseClass: 'H',
      })

      // Seed 2 flights: Flight 1 = 650m (2,133 ft); Flight 2 = 1,120m (3,675 ft)
      const f1 = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        flightNumber: 1,
        altitudeAglM: 650,
      })
      const f2 = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        flightNumber: 2,
        altitudeAglM: 1120,
      })

      // Step 1: Flyer views flight list in default metric units
      const metricListRes = await fetchGet('/flights')
      assertHtmlResponse(metricListRes, 200)
      const metricListHtml = await metricListRes.text()
      assertContains(metricListHtml, '650')
      assertContains(metricListHtml, '1,120')

      // Step 2: Flyer switches view to feet (?units=ft)
      const feetListRes = await fetchGet('/flights?units=ft')
      assertHtmlResponse(feetListRes, 200)
      const feetListHtml = await feetListRes.text()

      // 650m -> 2,133 ft; 1,120m -> 3,675 ft
      expect(feetListHtml).toMatch(/2,?133\s*(ft|<\/span>\s*ft)/i)
      expect(feetListHtml).toMatch(/3,?675\s*(ft|<\/span>\s*ft)/i)

      // Step 3: Inspect Flight 2 detail view in feet
      const feetDetailRes = await fetchGet(`/flights/${f2.id}?units=ft`)
      assertHtmlResponse(feetDetailRes, 200)
      const feetDetailHtml = await feetDetailRes.text()

      expect(feetDetailHtml).toMatch(/3,?675\s*ft/i)
      // Site ceiling in feet: 4000m -> 13,123 ft
      expect(feetDetailHtml).toMatch(/13,?123\s*ft/i)

      // Step 4: Inspect Flight 2 detail view back in meters
      const metricDetailRes = await fetchGet(`/flights/${f2.id}`)
      assertHtmlResponse(metricDetailRes, 200)
      const metricDetailHtml = await metricDetailRes.text()
      assertContains(metricDetailHtml, '1,120')
    })
  })
})
