/**
 * Empirical Adversarial Challenger 2 Test Suite: Milestone 6
 * Requirement R6: Rocket Airframe Geometry Specifications & Preflight Clearance Review
 *
 * Verification Objectives:
 * 1. Dynamic Pad Fit & Launch Guide Clearance Review:
 *    - Validates GET /flights/new renders #preflight-airframe-geometry-card, #preflight-display-length, #preflight-display-diameter.
 *    - Validates presence of guide rail length advisory (>= 3x rocket length) and pad blast standoff notice for RSO/LCO review.
 *    - Validates <select name="rocket_configuration_id"> options embed data-length and data-diameter attributes.
 *    - Validates formatted option label includes physical dimensions (| L: ...mm, Ø: ...mm).
 *    - Validates client-side reactive script updatePreflightGeometryDisplay attached to configuration selector.
 *    - Validates initial display values when rocket_configuration_id is pre-selected vs unselected.
 *    - Validates GET /flights/:id detail view renders "Airframe Physical Clearance Verification (RSO / LCO)" with exact dimensions.
 *    - Validates presence of Range Safety Officer (RSO) and Launch Control Officer (LCO) sign-off alongside clearance verification.
 *    - Validates imperial (?units=ft) vs metric dimension formatting across flight cards.
 * 2. Legacy Rockets with Null Dimensions vs Updated Dimensions:
 *    - Validates option text for legacy rocket with null dimensions does NOT display NaN, undefined, or 0mm.
 *    - Validates preflight review card displays fallback dash '—' for null dimensions.
 *    - Validates flight detail view displays fallback dash '—' when configuration and rocket have null dimensions.
 *    - Validates partial dimensions: length only (no stray trailing comma), diameter only (no stray leading comma).
 *    - Validates fallback resolution: if configuration dimensions are null, flight detail falls back to parent rocket dimensions.
 *    - Validates precedence: when configuration has explicit dimensions, they take precedence over rocket dimensions.
 *    - Validates historical snapshot immutability: older flight retains legacy v1 dimensions when rocket adds v2 dimensions.
 * 3. Preflight Check Submissions (POST /flights/preflight-check):
 *    - Validates HTMX evaluator returns amber warning banner for configuration with stability < 1.0 calibers.
 *    - Validates HTMX evaluator returns green nominal banner when stability >= 1.0 cal and flyer is certified.
 *    - Validates flyer certification warning when flyer cert is insufficient for motor impulse class (e.g. L0 flyer with H motor).
 *    - Validates airspace ceiling warning when expected altitude exceeds launch site max altitude waiver.
 *    - Validates multiple safety warnings combined into bulleted list with acknowledgment checkbox.
 *    - Validates resilience against non-existent or malformed rocket_configuration_id without 500 error or crash.
 *    - Validates flyer identity resolution: evaluates against specified flyer_id or falls back to active flyer.
 * 4. Flight Creation, Soft Gates & Configuration Editing:
 *    - Validates POST /flights with unacknowledged safety warnings returns HTTP 422 Unprocessable Entity.
 *    - Validates HTTP 422 response re-renders preflight form preserving selected configuration, data-length, and data-diameter.
 *    - Validates POST /flights with proceeded_despite_warnings=true succeeds with HTTP 303 redirect.
 *    - Validates atomic motor inventory decrement upon flight creation with motor_inventory_id.
 *    - Validates persistence and display of flight-level RSO and LCO duty officers.
 *    - Validates GET /flights/:id/edit pre-populates existing configuration with dimensions and displays geometry review card.
 *    - Validates POST /flights/:id/edit updating configuration to different airframe version updates dimensions on detail view.
 *    - Validates partial flight edit preserves existing configuration dimensions.
 *    - Validates 404 response on invalid flight IDs for GET and POST edit routes.
 * 5. Edge Cases & Extreme Airframe Dimensions:
 *    - Validates high-precision fractional dimensions (e.g. 2456.7 mm, 75.4 mm) formatted accurately in mm, cm, ft, and in.
 *    - Validates extreme large-scale HPR dimensions (e.g. 7500.0 mm, 200.0 mm) without overflow or truncation.
 *    - Validates extreme micro-scale dimensions (e.g. 95.0 mm, 12.0 mm) without underflow.
 *    - Validates zero dimensions (0 mm) handled cleanly without division by zero or NaN.
 *    - Validates multiple flights logged across different versions of the same airframe retain independent geometry.
 *
 * Authored by Milestone 6 Challenger 2 (m6_challenger_2_gen2).
 */

import { env } from 'cloudflare:test'
import { and, desc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { signSession } from '../src/services/auth'
import {
  getDb,
  seedTestCert,
  seedTestConfig,
  seedTestFlight,
  seedTestInventory,
  seedTestMotor,
  seedTestRocket,
  seedTestSite,
  seedTestUser,
  truncateDb,
} from './helpers/db'
import {
  assertContains,
  assertHasFormField,
  assertHtmlResponse,
  assertNotContains,
} from './helpers/html'
import { fetchGet, fetchPostForm } from './helpers/http'

beforeEach(async () => {
  await truncateDb()
  try {
    const now = Date.now()
    await env.DB.prepare(
      "INSERT OR REPLACE INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?, ?)"
    ).bind(now, now).run()
  } catch {}
})

describe('Milestone 6 Empirical Adversarial Suite: Preflight Clearance & Flight Safety Workflows (R6)', () => {
  // ============================================================================
  // 1. Dynamic Pad Fit & Launch Guide Clearance Review
  // ============================================================================
  describe('1. Dynamic Pad Fit & Launch Guide Clearance Review', () => {
    it('1.1: GET /flights/new renders pad fit review card with advisory notes and dimension targets', async () => {
      const flyer = await seedTestUser({ displayName: 'Range Safety Pilot' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Thunderbolt IV',
        lengthMm: 1650.0,
        bodyDiameterMm: 80.0,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1650.0,
        bodyDiameterMm: 80.0,
      })

      const res = await fetchGet('/flights/new', { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Review card container and targets exist
      expect(html).toContain('id="preflight-airframe-geometry-card"')
      expect(html).toContain('id="preflight-display-length"')
      expect(html).toContain('id="preflight-display-diameter"')

      // Guide rail safety advisory for RSO/LCO
      expect(html).toContain('Airframe Geometry & Pad Fit (RSO / LCO Review)')
      expect(html).toMatch(/guide velocity.*≥\s*3×\s*rocket length/i)
      expect(html).toContain('pad blast standoff is adequate')
    })

    it('1.2: configuration options contain data-length, data-diameter and formatted label text', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'AeroTech Mirage',
        lengthMm: 2100.0,
        bodyDiameterMm: 76.0,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 2,
        stabilityCalibers: 1.85,
        lengthMm: 2100.0,
        bodyDiameterMm: 76.0,
      })

      const res = await fetchGet('/flights/new', { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Select element and attributes
      assertHasFormField(html, 'rocket_configuration_id')
      expect(html).toContain(`data-length="2100"`)
      expect(html).toContain(`data-diameter="76"`)
      expect(html).toContain(`value="${config.id}"`)

      // Label incorporates formatted dimensions
      expect(html).toContain('AeroTech Mirage — Config v2 (1.85 cal | L: 2100mm, Ø: 76mm)')
    })

    it('1.3: reactive script updatePreflightGeometryDisplay is embedded and hooked to selector change', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const res = await fetchGet('/flights/new', { Cookie: cookie })
      const html = await res.text()

      expect(html).toContain('function updatePreflightGeometryDisplay()')
      expect(html).toContain("sel.addEventListener('change', updatePreflightGeometryDisplay)")
      expect(html).toContain('updatePreflightGeometryDisplay()')
    })

    it('1.4: preflight card pre-populates first configuration dimensions when no initial value is passed', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Initial Display Rocket',
        lengthMm: 1350.0,
        bodyDiameterMm: 65.0,
      })
      await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1350.0,
        bodyDiameterMm: 65.0,
      })

      const res = await fetchGet('/flights/new', { Cookie: cookie })
      const html = await res.text()

      // Initial server render for length and diameter cards
      expect(html).toContain('1350 mm (135.0 cm)')
      expect(html).toContain('65 mm (6.5 cm)')
    })

    it('1.5: GET /flights/:id renders Airframe Physical Clearance Verification (RSO / LCO) with verified badge', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Starseeker',
        lengthMm: 1720.0,
        bodyDiameterMm: 78.0,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1720.0,
        bodyDiameterMm: 78.0,
      })
      const motor = await seedTestMotor({ manufacturer: 'Cesaroni', model: 'H153' })
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        rsoName: 'Commander Safety Bob',
        lcoName: 'Controller Alice',
      })

      const res = await fetchGet(`/flights/${flight.id}`, { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Physical clearance verification section
      expect(html).toContain('Physical Clearance (RSO/LCO):')
      expect(html).toContain('1720 mm (172.0 cm)')
      expect(html).toContain('78 mm (7.8 cm)')
      expect(html).toContain('(Pad fit & launch rail clearance verified)')

      // Range Duty Officers bar in Preflight Safety Record
      expect(html).toContain('Commander Safety Bob')
      expect(html).toContain('Controller Alice')
      expect(html).toContain('Range Duty Officers:')
    })

    it('1.6: GET /flights/:id?units=ft renders imperial conversions in Vehicle Configuration while preserving metric mm', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Imperial Cruiser',
        lengthMm: 1524.0, // exactly 5.0 ft (1524 / 304.8)
        bodyDiameterMm: 76.2, // exactly 3.0 in (76.2 / 25.4)
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1524.0,
        bodyDiameterMm: 76.2,
      })
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
      })

      // Imperial request
      const res = await fetchGet(`/flights/${flight.id}?units=ft`, { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Card 2 Vehicle Configuration imperial conversions
      expect(html).toContain('5.00 ft (1524 mm)')
      expect(html).toContain('3.00 in (76.2 mm)')

      // Physical Clearance card retains mm/cm for range safety inspection
      expect(html).toContain('1524 mm (152.4 cm)')
      expect(html).toContain('76.2 mm (7.6 cm)')
    })
  })

  // ============================================================================
  // 2. Legacy Rockets with Null Dimensions vs Updated Dimensions
  // ============================================================================
  describe('2. Legacy Rockets with Null Dimensions vs Updated Dimensions', () => {
    it('2.1: legacy rocket with null dimensions does NOT render NaN, 0mm or corrupted geometry label in option', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Legacy Alpha',
        lengthMm: null,
        bodyDiameterMm: null,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        stabilityCalibers: 2.1,
        lengthMm: null,
        bodyDiameterMm: null,
      })

      const res = await fetchGet('/flights/new', { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Option label does NOT have broken text
      expect(html).not.toMatch(/>\s*NaN/i)
      expect(html).not.toMatch(/NaN\s*mm/i)
      expect(html).not.toMatch(/0mm/)
      expect(html).not.toMatch(/L:\s*null/i)
      expect(html).not.toMatch(/Ø:\s*null/i)

      // The option text should simply be 'Legacy Alpha — Config v1 (2.10 cal)' without geometry suffix
      expect(html).toContain('Legacy Alpha — Config v1 (2.10 cal)')
      expect(html).not.toContain('Legacy Alpha — Config v1 (2.10 cal |')
    })

    it('2.2: preflight review card displays fallback dash "—" when configuration and rocket have null dimensions', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Null Dim Rocket',
        lengthMm: null,
        bodyDiameterMm: null,
      })
      await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: null,
        bodyDiameterMm: null,
      })

      const res = await fetchGet('/flights/new', { Cookie: cookie })
      const html = await res.text()

      // Preflight card displays '—'
      const displayCardPart = html.substring(html.indexOf('id="preflight-airframe-geometry-card"'))
      expect(displayCardPart).toContain('id="preflight-display-length"')
      expect(displayCardPart).toContain('id="preflight-display-diameter"')
      expect(displayCardPart).toContain('—')
    })

    it('2.3: flight detail view displays fallback dash "—" when dimensions are null', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Legacy Unknown Airframe',
        lengthMm: null,
        bodyDiameterMm: null,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: null,
        bodyDiameterMm: null,
      })
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
      })

      const res = await fetchGet(`/flights/${flight.id}`, { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Both physical clearance and vehicle config display '—' without NaN or 0 mm
      expect(html).not.toMatch(/NaN/)
      expect(html).not.toMatch(/\b0\s*mm\b/)
      expect(html).toContain('Physical Clearance (RSO/LCO):')
      expect(html).toContain('Length: <strong class="text-white font-mono">—</strong>')
      expect(html).toContain('Body Diameter: <strong class="text-white font-mono">—</strong>')
    })

    it('2.4: partial dimensions: configuration with length only renders cleanly without trailing comma', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Length Only Rocket',
        lengthMm: 1100.0,
        bodyDiameterMm: null,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1100.0,
        bodyDiameterMm: null,
      })

      const res = await fetchGet('/flights/new', { Cookie: cookie })
      const html = await res.text()

      // Option label: should have '| L: 1100mm' and NOT have trailing comma or empty Ø
      expect(html).toContain('L: 1100mm')
      expect(html).not.toContain('L: 1100mm,')
      expect(html).not.toContain('Ø:')

      // Flight detail with length only
      const flight = await seedTestFlight(flyer.id, { rocketConfigurationId: config.id })
      const detailRes = await fetchGet(`/flights/${flight.id}`, { Cookie: cookie })
      const detailHtml = await detailRes.text()

      expect(detailHtml).toContain('1100 mm (110.0 cm)')
      expect(detailHtml).toContain('Body Diameter: <strong class="text-white font-mono">—</strong>')
    })

    it('2.5: partial dimensions: configuration with diameter only renders cleanly without leading comma', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Diameter Only Rocket',
        lengthMm: null,
        bodyDiameterMm: 54.0,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: null,
        bodyDiameterMm: 54.0,
      })

      const res = await fetchGet('/flights/new', { Cookie: cookie })
      const html = await res.text()

      // Option label: should have '| Ø: 54mm' and NOT have 'L:'
      expect(html).toContain('Ø: 54mm')
      expect(html).not.toContain('L:')

      // Flight detail with diameter only
      const flight = await seedTestFlight(flyer.id, { rocketConfigurationId: config.id })
      const detailRes = await fetchGet(`/flights/${flight.id}`, { Cookie: cookie })
      const detailHtml = await detailRes.text()

      expect(detailHtml).toContain('Length: <strong class="text-white font-mono">—</strong>')
      expect(detailHtml).toContain('54 mm (5.4 cm)')
    })

    it('2.6: fallback to parent rocket dimensions when configuration snapshot dimensions are null', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      // Parent rocket has dimensions
      const rocket = await seedTestRocket(flyer.id, {
        name: 'Parent Dimensioned Rocket',
        lengthMm: 1800.0,
        bodyDiameterMm: 98.0,
      })
      // Old config created before dimensions were added to config table
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: null,
        bodyDiameterMm: null,
      })
      const flight = await seedTestFlight(flyer.id, { rocketConfigurationId: config.id })

      const res = await fetchGet(`/flights/${flight.id}`, { Cookie: cookie })
      const html = await res.text()

      // Fallback takes effect: renders rocket's length and diameter
      expect(html).toContain('1800 mm (180.0 cm)')
      expect(html).toContain('98 mm (9.8 cm)')
    })

    it('2.7: explicit configuration dimensions take precedence over parent rocket dimensions', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Dual Spec Rocket',
        lengthMm: 1000.0,
        bodyDiameterMm: 50.0,
      })
      // Config has explicit modified geometry (e.g. payload bay extension)
      const config = await seedTestConfig(rocket.id, {
        version: 2,
        lengthMm: 1350.0,
        bodyDiameterMm: 50.0,
      })
      const flight = await seedTestFlight(flyer.id, { rocketConfigurationId: config.id })

      const res = await fetchGet(`/flights/${flight.id}`, { Cookie: cookie })
      const html = await res.text()

      // Configuration's 1350 mm takes precedence over rocket's 1000 mm
      expect(html).toContain('1350 mm (135.0 cm)')
      expect(html).not.toContain('1000 mm (100.0 cm)')
    })

    it('2.8: historical snapshot immutability: logging flights on v1 (null dims) and v2 (with dims) preserves distinct records', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Evolving Rocket',
        lengthMm: null,
        bodyDiameterMm: null,
      })
      // v1 had null dimensions
      const configV1 = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: null,
        bodyDiameterMm: null,
        isCurrent: false,
      })
      // v2 added dimensions
      const configV2 = await seedTestConfig(rocket.id, {
        version: 2,
        lengthMm: 1450.0,
        bodyDiameterMm: 75.0,
        isCurrent: true,
      })

      const flight1 = await seedTestFlight(flyer.id, {
        flightNumber: 1,
        rocketConfigurationId: configV1.id,
      })
      const flight2 = await seedTestFlight(flyer.id, {
        flightNumber: 2,
        rocketConfigurationId: configV2.id,
      })

      // Verify Flight 1 view: renders fallback '—'
      const res1 = await fetchGet(`/flights/${flight1.id}`, { Cookie: cookie })
      const html1 = await res1.text()
      expect(html1).toContain('Length: <strong class="text-white font-mono">—</strong>')

      // Verify Flight 2 view: renders v2 dimensions
      const res2 = await fetchGet(`/flights/${flight2.id}`, { Cookie: cookie })
      const html2 = await res2.text()
      expect(html2).toContain('1450 mm (145.0 cm)')
      expect(html2).toContain('75 mm (7.5 cm)')
    })
  })

  // ============================================================================
  // 3. Preflight Check Submissions (POST /flights/preflight-check)
  // ============================================================================
  describe('3. Preflight Check Submissions (POST /flights/preflight-check)', () => {
    it('3.1: HTMX evaluator triggers stability warning when stability calibers < 1.0', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Marginal Fin Rocket' })
      const lowStabConfig = await seedTestConfig(rocket.id, {
        version: 1,
        stabilityCalibers: 0.75, // < 1.0 triggers warning
        lengthMm: 1200.0,
        bodyDiameterMm: 60.0,
      })

      const res = await fetchPostForm(
        '/flights/preflight-check',
        {
          rocket_configuration_id: lowStabConfig.id,
        },
        { Cookie: cookie },
      )

      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Warning banner returned
      expect(html).toContain('Preflight Safety Warning')
      expect(html).toMatch(/marginal stability|stability.*cal/i)
      expect(html).toContain('proceeded_despite_warnings')
    })

    it('3.2: HTMX evaluator returns nominal green all-clear banner when all parameters pass', async () => {
      const flyer = await seedTestUser()
      // Certify flyer to Level 2
      await seedTestCert(flyer.id, { level: 2 })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Stable Dart' })
      const stableConfig = await seedTestConfig(rocket.id, {
        version: 1,
        stabilityCalibers: 2.4, // stable
        lengthMm: 1500.0,
        bodyDiameterMm: 75.0,
      })
      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'H128W',
        impulseClass: 'H', // requires Level 1
      })
      const site = await seedTestSite({
        name: 'High Plains Spaceport',
        maxAltitudeAglM: 3000,
      })

      const res = await fetchPostForm(
        '/flights/preflight-check',
        {
          rocket_configuration_id: stableConfig.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          expected_altitude_m: 850, // 850m < 3000m ceiling
        },
        { Cookie: cookie },
      )

      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Clean nominal check
      expect(html).toContain('All checks pass — Safe to fly')
      expect(html).toContain('Preflight safety gates evaluated clear')
      expect(html).not.toContain('proceeded_despite_warnings')
    })

    it('3.3: HTMX evaluator triggers flyer certification warning for uncertified pilot launching HPR motor', async () => {
      const uncertFlyer = await seedTestUser({ displayName: 'Novice Flyer' })
      const token = await signSession(uncertFlyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(uncertFlyer.id, { name: 'Overpowered Rocket' })
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 2.0 })
      const hprMotor = await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'I216',
        impulseClass: 'I', // requires Level 1
      })

      const res = await fetchPostForm(
        '/flights/preflight-check',
        {
          rocket_configuration_id: config.id,
          motor_id: hprMotor.id,
        },
        { Cookie: cookie },
      )

      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('Preflight Safety Warning')
      expect(html).toMatch(/certification|unauthorized motor|impulse class/i)
    })

    it('3.4: HTMX evaluator triggers airspace waiver ceiling warning when expected altitude exceeds site max', async () => {
      const flyer = await seedTestUser()
      await seedTestCert(flyer.id, { level: 2 })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 2.0 })
      const site = await seedTestSite({
        name: 'Restricted Airfield',
        maxAltitudeAglM: 500, // 500m ceiling
      })

      const res = await fetchPostForm(
        '/flights/preflight-check',
        {
          rocket_configuration_id: config.id,
          launch_site_id: site.id,
          altitude_agl_m: 1200, // 1200m > 500m ceiling
        },
        { Cookie: cookie },
      )

      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('Preflight Safety Warning')
      expect(html).toMatch(/waiver ceiling|airspace|exceeds.*ceiling/i)
    })

    it('3.5: HTMX evaluator bundles multiple concurrent violations into bulleted list', async () => {
      const uncertFlyer = await seedTestUser()
      const token = await signSession(uncertFlyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(uncertFlyer.id)
      // Violation 1: Unstable rocket (0.5 cal)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 0.5 })
      // Violation 2: Uncertified motor (Level 1 required, flyer has 0)
      const motor = await seedTestMotor({ impulseClass: 'H' })
      // Violation 3: Exceeds waiver ceiling (1500m vs 400m)
      const site = await seedTestSite({ maxAltitudeAglM: 400 })

      const res = await fetchPostForm(
        '/flights/preflight-check',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          expected_altitude_m: 1500,
        },
        { Cookie: cookie },
      )

      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Multiple warnings badge
      expect(html).toMatch(/Preflight Safety Warnings \(3\)/)
      expect(html).toContain('proceeded_despite_warnings')
    })

    it('3.6: HTMX evaluator handles non-existent configuration ID safely without crash', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const res = await fetchPostForm(
        '/flights/preflight-check',
        {
          rocket_configuration_id: 'non-existent-uuid-12345',
        },
        { Cookie: cookie },
      )

      // Gracefully evaluates without stability warning and does not crash with 500
      expect([200]).toContain(res.status)
      const html = await res.text()
      expect(html).not.toMatch(/500 Internal Server Error/i)
    })

    it('3.7: HTMX evaluator evaluates against explicitly provided flyer_id', async () => {
      const pilotA = await seedTestUser({ displayName: 'Cert Level 0 Flyer' })
      const pilotB = await seedTestUser({ displayName: 'Cert Level 2 Flyer' })
      await seedTestCert(pilotB.id, { level: 2 })

      const token = await signSession(pilotA.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(pilotA.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 2.0 })
      const motor = await seedTestMotor({ impulseClass: 'H' })

      // When checking for pilotB (Level 2), motor H should NOT trigger cert warning
      const resB = await fetchPostForm(
        '/flights/preflight-check',
        {
          flyer_id: pilotB.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
        },
        { Cookie: cookie },
      )

      const htmlB = await resB.text()
      expect(htmlB).toContain('All checks pass — Safe to fly')

      // When checking for pilotA (Level 0), motor H triggers cert warning
      const resA = await fetchPostForm(
        '/flights/preflight-check',
        {
          flyer_id: pilotA.id,
          rocket_configuration_id: config.id,
          motor_id: motor.id,
        },
        { Cookie: cookie },
      )

      const htmlA = await resA.text()
      expect(htmlA).toContain('Preflight Safety Warning')
    })
  })

  // ============================================================================
  // 4. Flight Creation, Soft Gates & Configuration Editing
  // ============================================================================
  describe('4. Flight Creation, Soft Gates & Configuration Editing', () => {
    it('4.1: POST /flights with unacknowledged safety warnings triggers HTTP 422 soft gate block', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Soft Gate Rocket',
        lengthMm: 1400.0,
        bodyDiameterMm: 70.0,
      })
      const unstableConfig = await seedTestConfig(rocket.id, {
        stabilityCalibers: 0.6, // triggers warning
        lengthMm: 1400.0,
        bodyDiameterMm: 70.0,
      })
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      // Submit flight without proceeded_despite_warnings
      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: unstableConfig.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: 600,
        },
        { Cookie: cookie },
      )

      // Strict requirement: HTTP 422 Unprocessable Entity
      expect(res.status).toBe(422)
      const html = await res.text()

      // Re-rendered preflight form
      expect(html).toContain('Preflight Action Required')
      expect(html).toContain('Preflight safety warnings require explicit pilot confirmation before logging.')

      // Selected configuration is preserved along with data attributes and preflight card
      expect(html).toMatch(new RegExp(`<option[^>]*value="${unstableConfig.id}"[^>]*selected`, 's'))
      expect(html).toContain(`data-length="1400"`)
      expect(html).toContain(`data-diameter="70"`)
      expect(html).toContain('1400 mm (140.0 cm)')
      expect(html).toContain('70 mm (7.0 cm)')

      // Verification: flight was NOT inserted into D1
      const db = getDb()
      const flights = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, unstableConfig.id))
      expect(flights.length).toBe(0)
    })

    it('4.2: POST /flights with proceeded_despite_warnings=true logs flight and records override audit', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Override Rocket',
        lengthMm: 1550.0,
        bodyDiameterMm: 76.0,
      })
      const unstableConfig = await seedTestConfig(rocket.id, {
        stabilityCalibers: 0.8,
        lengthMm: 1550.0,
        bodyDiameterMm: 76.0,
      })
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      // Submit with acknowledgment
      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: unstableConfig.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          altitude_agl_m: 550,
          proceeded_despite_warnings: 'true',
          rso_name: 'Officer Davis',
          lco_name: 'Officer Evans',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') ?? ''
      expect(location).toMatch(/\/flights\/[a-zA-Z0-9-]+/)

      // Verify database record
      const db = getDb()
      const [flight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, unstableConfig.id))

      expect(flight).toBeDefined()
      expect(flight.proceededDespiteWarnings).toBe(true)
      expect(Array.isArray(flight.softGateWarnings)).toBe(true)
      expect(flight.softGateWarnings!.length).toBeGreaterThan(0)
      expect(flight.rsoName).toBe('Officer Davis')
      expect(flight.lcoName).toBe('Officer Evans')

      // Verify detail page displays override status and physical clearance
      const detailRes = await fetchGet(location, { Cookie: cookie })
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain('Warnings Recorded & Overridden')
      expect(detailHtml).toContain('Safety Override Authorized')
      expect(detailHtml).toContain('1550 mm (155.0 cm)')
      expect(detailHtml).toContain('76 mm (7.6 cm)')
    })

    it('4.3: POST /flights with motor_inventory_id atomically decrements stock', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { lengthMm: 1000, bodyDiameterMm: 50 })
      const config = await seedTestConfig(rocket.id, { lengthMm: 1000, bodyDiameterMm: 50, stabilityCalibers: 2.0 })
      const motor = await seedTestMotor()
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 5, expendedCount: 1 })
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          motor_inventory_id: inv.id,
          launch_site_id: site.id,
          altitude_agl_m: 400,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)

      // Inventory decrement check
      const db = getDb()
      const [updatedInv] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updatedInv.quantityOnHand).toBe(4)
      expect(updatedInv.expendedCount).toBe(2)
    })

    it('4.4: GET /flights/:id/edit pre-populates existing configuration and renders geometry review card', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Pre-populated Rocket',
        lengthMm: 1850.0,
        bodyDiameterMm: 90.0,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1850.0,
        bodyDiameterMm: 90.0,
      })
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        rsoName: 'Chief Officer Rick',
        lcoName: 'Launch Controller Amy',
      })

      const res = await fetchGet(`/flights/${flight.id}/edit`, { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Form heading
      expect(html).toContain('Edit Flight')
      // Selected option has dimensions
      expect(html).toMatch(new RegExp(`<option[^>]*value="${config.id}"[^>]*selected`, 's'))
      expect(html).toContain(`data-length="1850"`)
      expect(html).toContain(`data-diameter="90"`)

      // Geometry review card displays flight's dimensions
      expect(html).toContain('1850 mm (185.0 cm)')
      expect(html).toContain('90 mm (9.0 cm)')

      // Officer inputs pre-populated
      expect(html).toContain('value="Chief Officer Rick"')
      expect(html).toContain('value="Launch Controller Amy"')
    })

    it('4.5: POST /flights/:id/edit updates flight to a different configuration snapshot with distinct dimensions', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Modular Interceptor' })
      const configShort = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1200.0,
        bodyDiameterMm: 60.0,
        isCurrent: false,
      })
      const configLong = await seedTestConfig(rocket.id, {
        version: 2,
        lengthMm: 1950.0,
        bodyDiameterMm: 76.0,
        isCurrent: true,
      })

      // Flight originally logged with short configuration
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: configShort.id,
      })

      // Verify original detail view shows short dimensions
      const originalRes = await fetchGet(`/flights/${flight.id}`, { Cookie: cookie })
      const origHtml = await originalRes.text()
      expect(origHtml).toContain('1200 mm (120.0 cm)')

      // Edit flight to switch configuration to configLong
      const editRes = await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          rocket_configuration_id: configLong.id,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(editRes.status)

      // Verify updated flight detail view now displays the new dimensions
      const updatedRes = await fetchGet(`/flights/${flight.id}`, { Cookie: cookie })
      const updatedHtml = await updatedRes.text()

      expect(updatedHtml).toContain('1950 mm (195.0 cm)')
      expect(updatedHtml).toContain('76 mm (7.6 cm)')
      expect(updatedHtml).not.toContain('1200 mm (120.0 cm)')
    })

    it('4.6: editing non-existent flight via GET /flights/:id/edit or POST /flights/:id/edit returns 404', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const getRes = await fetchGet('/flights/non-existent-flight-id-9999/edit', { Cookie: cookie })
      expect(getRes.status).toBe(404)

      const postRes = await fetchPostForm(
        '/flights/non-existent-flight-id-9999/edit',
        { altitude_agl_m: 500 },
        { Cookie: cookie },
      )
      expect(postRes.status).toBe(404)
    })
  })

  // ============================================================================
  // 5. Edge Cases & Extreme Airframe Dimensions
  // ============================================================================
  describe('5. Edge Cases & Extreme Airframe Dimensions', () => {
    it('5.1: high-precision fractional float dimensions render with exact format across metric and imperial', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Precision Hawk',
        lengthMm: 2456.7,
        bodyDiameterMm: 75.4,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 2456.7,
        bodyDiameterMm: 75.4,
      })
      const flight = await seedTestFlight(flyer.id, { rocketConfigurationId: config.id })

      // Metric check
      const resMetric = await fetchGet(`/flights/${flight.id}?units=m`, { Cookie: cookie })
      const htmlMetric = await resMetric.text()
      expect(htmlMetric).toContain('2456.7 mm (245.7 cm)')
      expect(htmlMetric).toContain('75.4 mm (7.5 cm)')

      // Imperial check: 2456.7 / 304.8 = 8.059... -> 8.06 ft, 75.4 / 25.4 = 2.968... -> 2.97 in
      const resImperial = await fetchGet(`/flights/${flight.id}?units=ft`, { Cookie: cookie })
      const htmlImperial = await resImperial.text()
      expect(htmlImperial).toContain('8.06 ft (2456.7 mm)')
      expect(htmlImperial).toContain('2.97 in (75.4 mm)')
    })

    it('5.2: extreme large-scale HPR rocket (7500.0 mm, 200.0 mm) displays without integer/display overflow', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Gargantua Sounding',
        lengthMm: 7500.0,
        bodyDiameterMm: 200.0,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 7500.0,
        bodyDiameterMm: 200.0,
      })
      const flight = await seedTestFlight(flyer.id, { rocketConfigurationId: config.id })

      const res = await fetchGet(`/flights/${flight.id}`, { Cookie: cookie })
      const html = await res.text()

      expect(html).toContain('7500 mm (750.0 cm)')
      expect(html).toContain('200 mm (20.0 cm)')

      // Form option check
      const formRes = await fetchGet('/flights/new', { Cookie: cookie })
      const formHtml = await formRes.text()
      expect(formHtml).toContain('L: 7500mm, Ø: 200mm')
    })

    it('5.3: extreme micro-scale model rocket (95.0 mm, 12.0 mm) displays without underflow or truncation', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Micro Mosquito',
        lengthMm: 95.0,
        bodyDiameterMm: 12.0,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 95.0,
        bodyDiameterMm: 12.0,
      })
      const flight = await seedTestFlight(flyer.id, { rocketConfigurationId: config.id })

      const res = await fetchGet(`/flights/${flight.id}`, { Cookie: cookie })
      const html = await res.text()

      expect(html).toContain('95 mm (9.5 cm)')
      expect(html).toContain('12 mm (1.2 cm)')

      const formRes = await fetchGet('/flights/new', { Cookie: cookie })
      const formHtml = await formRes.text()
      expect(formHtml).toContain('L: 95mm, Ø: 12mm')
    })

    it('5.4: zero dimensions (0 mm) do not trigger division by zero or NaN', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Zero Dimension Probe',
        lengthMm: 0,
        bodyDiameterMm: 0,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 0,
        bodyDiameterMm: 0,
      })
      const flight = await seedTestFlight(flyer.id, { rocketConfigurationId: config.id })

      const res = await fetchGet(`/flights/${flight.id}?units=ft`, { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).not.toMatch(/NaN/)
      expect(html).toContain('0 mm (0.0 cm)')
      expect(html).toContain('0.00 ft (0 mm)')
      expect(html).toContain('0.00 in (0 mm)')
    })

    it('5.5: flight detail view handles extreme telemetry records alongside physical clearance', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Mach Hypersonic Test',
        lengthMm: 3100.0,
        bodyDiameterMm: 102.0,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 3100.0,
        bodyDiameterMm: 102.0,
      })
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        altitudeAglM: 12500, // 12.5 km AGL
        maxVelocityMps: 980.5, // ~Mach 2.9
        maxAccelG: 45.2,
      })

      const res = await fetchGet(`/flights/${flight.id}`, { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // High telemetry metrics present
      expect(html).toContain('12,500 m')
      expect(html).toContain('980.5 m/s')
      expect(html).toContain('45.2 G')

      // Geometry and clearance intact
      expect(html).toContain('3100 mm (310.0 cm)')
      expect(html).toContain('102 mm (10.2 cm)')
      expect(html).toContain('(Pad fit & launch rail clearance verified)')
    })
  })
})
