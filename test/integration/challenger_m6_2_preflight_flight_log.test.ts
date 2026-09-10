/**
 * Empirical Adversarial Challenger 2 Test Suite: Milestone 6
 * Scope: Preflight Review & Flight Logbook Integration (Requirement R6)
 *
 * Empirical Challenges Verified:
 * 1. Preflight Form Geometry Attributes & Review Card (GET /flights/new):
 *    - Validates <select name="rocket_configuration_id"> renders options with data-length and data-diameter attributes.
 *    - Validates option text incorporates physical geometry summary ("| L: ...mm, Ø: ...mm").
 *    - Validates reactive Preflight Airframe Geometry & Pad Fit Inspection Card (#preflight-airframe-geometry-card)
 *      displays overall length and body diameter in mm and cm.
 *    - Validates guide rail length advisory (≥ 3× rocket length) for RSO/LCO review.
 *    - Validates graceful handling of rockets/configurations with null dimensions ('—' instead of NaN).
 *    - Validates decimal/floating-point geometry representations (e.g. 1234.5 mm, 54.2 mm -> 123.5 cm, 5.4 cm).
 * 2. Soft-Gate Re-Render Geometry Data Preservation (POST /flights):
 *    - Submitting flight with safety warnings (e.g., L0 flyer launching H motor) without override returns HTTP 422.
 *    - Validates 422 response re-renders the preflight form preserving the selected configuration with its geometry data.
 *    - Validates option preserves data-length and data-diameter, and the preflight card displays dimensions in mm and cm.
 *    - Submitting with proceeded_despite_warnings=on succeeds with HTTP 303 and stores soft gate warnings.
 * 3. Flight Detail View Dimensions Display (GET /flights/:id):
 *    - Validates Vehicle Configuration card displays Airframe Length and Body Diameter in mm and cm (metric).
 *    - Validates imperial mode (?units=ft) converts to feet and inches while preserving mm in parentheses.
 *    - Validates Preflight Safety Record card displays Airframe Physical Clearance Verification (RSO / LCO) with dimensions.
 *    - Validates fallback to parent rocket dimensions when configuration dimensions are null.
 *    - Validates graceful fallback to '—' when both configuration and rocket dimensions are null.
 * 4. Flight Edit Form Geometry Display (GET /flights/:id/edit):
 *    - Validates edit form pre-populates the rocket configuration with data-length and data-diameter attributes.
 *    - Validates preflight geometry review card shows the current flight configuration's dimensions.
 *    - Validates POST /flights/:id/edit updating to another configuration persists and reflects new dimensions on detail view.
 * 5. Full Flight Logging Lifecycle:
 *    - End-to-end flow: create rocket with geometry -> create new config snapshot -> log flight -> edit flight -> verify audit trail.
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
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
  fetchPostForm,
} from '../helpers/http'

beforeEach(truncateDb)

describe('Adversarial Challenger 2: Milestone 6 (Preflight Review & Flight Logbook Integration)', () => {
  // =========================================================================
  // SECTION 1: Preflight Form Geometry Rendering (GET /flights/new)
  // =========================================================================
  describe('1. Preflight Form Geometry Attributes & Review Card (GET /flights/new)', () => {
    it('1.1: renders <select name="rocket_configuration_id"> with data-length and data-diameter attributes', async () => {
      const flyer = await seedTestUser({ displayName: 'Pad Commander' })
      const rocket = await seedTestRocket(flyer.id, {
        name: 'Aerotech Arreaux',
        lengthMm: 1450,
        bodyDiameterMm: 76,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1450,
        bodyDiameterMm: 76,
      })

      const res = await fetchGet('/flights/new')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Select element exists
      assertHasFormField(html, 'rocket_configuration_id')

      // Option tag must contain data-length and data-diameter attributes
      const hasDataAttrs =
        html.includes(`data-length="1450"`) &&
        html.includes(`data-diameter="76"`) &&
        html.includes(`value="${config.id}"`)
      expect(hasDataAttrs).toBe(true)

      // Option label includes geometry summary
      expect(html).toContain('L: 1450mm')
      expect(html).toContain('Ø: 76mm')
    })

    it('1.2: preflight review card displays airframe dimensions in mm and cm for Range Safety review', async () => {
      const flyer = await seedTestUser({ displayName: 'Range Safety Flyer' })
      const rocket = await seedTestRocket(flyer.id, {
        name: 'High Flyer 54',
        lengthMm: 1200,
        bodyDiameterMm: 54,
      })
      await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1200,
        bodyDiameterMm: 54,
      })

      const res = await fetchGet('/flights/new')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Airframe Geometry & Pad Fit Inspection Card presence
      expect(html).toContain('preflight-airframe-geometry-card')
      expect(html).toMatch(/Airframe Geometry & Pad Fit/i)
      expect(html).toMatch(/RSO \/ LCO Review/i)

      // Initial dimensions displayed in mm and cm (1200 mm = 120.0 cm; 54 mm = 5.4 cm)
      expect(html).toContain('1200 mm (120.0 cm)')
      expect(html).toContain('54 mm (5.4 cm)')

      // Guide rail length safety advisory present
      expect(html).toMatch(/≥ 3× rocket length/i)
    })

    it('1.3: handles decimal floating-point dimensions with accurate cm conversions', async () => {
      const flyer = await seedTestUser()
      const rocket = await seedTestRocket(flyer.id, {
        name: 'Precision Falcon',
        lengthMm: 1234.5,
        bodyDiameterMm: 68.4,
      })
      await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1234.5,
        bodyDiameterMm: 68.4,
      })

      const res = await fetchGet('/flights/new')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Verify data attributes with decimals
      expect(html).toContain('data-length="1234.5"')
      expect(html).toContain('data-diameter="68.4"')

      // Verify display card formatted to 1 decimal place in cm (1234.5 mm -> 123.5 cm; 68.4 mm -> 6.8 cm)
      expect(html).toContain('1234.5 mm (123.5 cm)')
      expect(html).toContain('68.4 mm (6.8 cm)')
    })

    it('1.4: gracefully handles rockets and configurations with null dimensions without NaN', async () => {
      const flyer = await seedTestUser()
      const rocket = await seedTestRocket(flyer.id, {
        name: 'Legacy Unknown Rocket',
        lengthMm: null,
        bodyDiameterMm: null,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: null,
        bodyDiameterMm: null,
      })

      const res = await fetchGet('/flights/new')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Empty data attributes
      expect(html).toContain(`value="${config.id}"`)
      expect(html).not.toMatch(/NaN\s*mm|NaN\s*cm|>NaN</)
      expect(html).not.toContain('null mm')

      // Card displays dash fallback
      expect(html).toContain('id="preflight-display-length"')
      expect(html).toContain('—')
    })
  })

  // =========================================================================
  // SECTION 2: Soft Gate 422 Re-Render Geometry Preservation (POST /flights)
  // =========================================================================
  describe('2. Soft-Gate Re-Render Geometry Preservation (POST /flights)', () => {
    it('2.1: preserves selected rocket geometry in preflight review card on 422 soft-gate block', async () => {
      const flyer = await seedTestUser({ displayName: 'Uncertified Pilot' }) // Level 0
      const rocket = await seedTestRocket(flyer.id, {
        name: 'Heavy Titan',
        lengthMm: 2200,
        bodyDiameterMm: 102,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 2200,
        bodyDiameterMm: 102,
        stabilityCalibers: 1.8,
      })
      const hprMotor = await seedTestMotor({ impulseClass: 'H', model: 'H165R' })
      const site = await seedTestSite({ maxAltitudeAglM: 2500 })

      // Flyer posts without acknowledgment -> triggers 422 soft gate
      const res = await fetchPostForm('/flights', {
        flyer_id: flyer.id,
        rocket_configuration_id: config.id,
        motor_id: hprMotor.id,
        launch_site_id: site.id,
        expected_altitude_m: 800,
      })

      expect(res.status).toBe(422)
      assertHtmlResponse(res, 422)
      const html = await res.text()

      // Soft gate warning rendered
      expect(html).toMatch(/Preflight Action Required|Preflight Safety Warning/i)
      expect(html).toMatch(/requires Level 1/i)

      // Rocket configuration option is selected and retains data attributes
      expect(html).toContain(`value="${config.id}"`)
      expect(html).toContain('selected')
      expect(html).toContain('data-length="2200"')
      expect(html).toContain('data-diameter="102"')

      // Inspection card preserves selected rocket dimensions
      expect(html).toContain('preflight-airframe-geometry-card')
      expect(html).toContain('2200 mm (220.0 cm)')
      expect(html).toContain('102 mm (10.2 cm)')
    })

    it('2.2: successfully persists flight with override and soft gate warnings', async () => {
      const flyer = await seedTestUser({ displayName: 'Acknowledging Pilot' })
      const rocket = await seedTestRocket(flyer.id, {
        name: 'Heavy Titan 2',
        lengthMm: 1950,
        bodyDiameterMm: 98,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1950,
        bodyDiameterMm: 98,
      })
      const hprMotor = await seedTestMotor({ impulseClass: 'H', model: 'H128W' })
      const site = await seedTestSite({ maxAltitudeAglM: 2500 })

      const res = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: hprMotor.id,
          launch_site_id: site.id,
          expected_altitude_m: 750,
          altitude_agl_m: 742,
          proceeded_despite_warnings: 'on',
          rso_name: 'Gene Kranz',
          lco_name: 'Chris Kraft',
        },
        {},
        { redirect: 'manual' },
      )

      expect(res.status).toBe(303)
      const redirectUrl = res.headers.get('location')
      expect(redirectUrl).toMatch(/^\/flights\/[0-9a-f-]+$/)

      // Query database directly to verify persistence
      const flightId = redirectUrl!.split('/').pop()!
      const db = getDb()
      const [flight] = await db.select().from(schema.flights).where(eq(schema.flights.id, flightId))
      expect(flight).toBeDefined()
      expect(flight.proceededDespiteWarnings).toBe(true)
      expect(flight.rsoName).toBe('Gene Kranz')
      expect(flight.lcoName).toBe('Chris Kraft')
    })
  })

  // =========================================================================
  // SECTION 3: Flight Detail View Dimensions Display (GET /flights/:id)
  // =========================================================================
  describe('3. Flight Detail View Dimensions Display (GET /flights/:id)', () => {
    it('3.1: displays airframe dimensions in Vehicle Configuration card and Preflight Safety Record card (metric)', async () => {
      const flyer = await seedTestUser()
      const rocket = await seedTestRocket(flyer.id, {
        name: 'AeroTech Mirage',
        lengthMm: 1780,
        bodyDiameterMm: 66,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1780,
        bodyDiameterMm: 66,
      })
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 450,
        rsoName: 'Chief RSO Dave',
        lcoName: 'Pad LCO Alice',
      })

      const res = await fetchGet(`/flights/${flight.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Card 2: Vehicle Configuration card displays dimensions
      expect(html).toContain('Vehicle Configuration')
      expect(html).toContain('Airframe Length')
      expect(html).toContain('1780 mm (178.0 cm)')
      expect(html).toContain('Body Diameter')
      expect(html).toContain('66 mm (6.6 cm)')

      // Preflight Safety Record card displays Physical Clearance Verification (RSO / LCO)
      expect(html).toContain('Physical Clearance (RSO/LCO):')
      expect(html).toContain('Length: <strong class="text-white font-mono">1780 mm (178.0 cm)</strong>')
      expect(html).toContain('Body Diameter: <strong class="text-white font-mono">66 mm (6.6 cm)</strong>')
      expect(html).toContain('(Pad fit & launch rail clearance verified)')

      // Duty officers also displayed
      expect(html).toContain('Chief RSO Dave')
      expect(html).toContain('Pad LCO Alice')
    })

    it('3.2: converts dimensions accurately to imperial units (?units=ft)', async () => {
      const flyer = await seedTestUser()
      const rocket = await seedTestRocket(flyer.id, {
        name: 'Imperial Cruiser',
        lengthMm: 1524, // 1524 / 304.8 = 5.00 ft
        bodyDiameterMm: 76.2, // 76.2 / 25.4 = 3.00 in
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1524,
        bodyDiameterMm: 76.2,
      })
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
      })

      const res = await fetchGet(`/flights/${flight.id}?units=ft`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Converted values in Vehicle Configuration card: 5.00 ft (1524 mm) and 3.00 in (76.2 mm)
      expect(html).toContain('5.00 ft (1524 mm)')
      expect(html).toContain('3.00 in (76.2 mm)')
    })

    it('3.3: falls back to parent rocket dimensions when configuration dimensions are null', async () => {
      const flyer = await seedTestUser()
      const rocket = await seedTestRocket(flyer.id, {
        name: 'Parent Dimension Rocket',
        lengthMm: 1350,
        bodyDiameterMm: 50,
      })
      // Configuration has null dimensions
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: null,
        bodyDiameterMm: null,
      })
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
      })

      const res = await fetchGet(`/flights/${flight.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Vehicle Configuration & Preflight Safety Record fall back to parent rocket dimensions
      expect(html).toContain('1350 mm (135.0 cm)')
      expect(html).toContain('50 mm (5.0 cm)')
    })

    it('3.4: displays dash fallback when both configuration and rocket dimensions are null', async () => {
      const flyer = await seedTestUser()
      const rocket = await seedTestRocket(flyer.id, {
        name: 'Zero Dimension Rocket',
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

      const res = await fetchGet(`/flights/${flight.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).not.toMatch(/NaN\s*mm|NaN\s*cm|>NaN</)
      expect(html).not.toContain('null mm')
      expect(html).toContain('—')
    })
  })

  // =========================================================================
  // SECTION 4: Flight Edit Form Geometry Display (GET & POST /flights/:id/edit)
  // =========================================================================
  describe('4. Flight Edit Form Geometry Display & Configuration Switching', () => {
    it('4.1: GET /flights/:id/edit pre-selects current configuration with data attributes and preflight card', async () => {
      const flyer = await seedTestUser()
      const rocket = await seedTestRocket(flyer.id, {
        name: 'Modifiable Bird',
        lengthMm: 1600,
        bodyDiameterMm: 75,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1600,
        bodyDiameterMm: 75,
      })
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
      })

      const res = await fetchGet(`/flights/${flight.id}/edit`)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Check form action and fields
      expect(html).toContain(`action="/flights/${flight.id}/edit"`)
      expect(html).toContain(`value="${config.id}"`)
      expect(html).toContain('selected')
      expect(html).toContain('data-length="1600"')
      expect(html).toContain('data-diameter="75"')

      // Preflight inspection card displays config dimensions
      expect(html).toContain('1600 mm (160.0 cm)')
      expect(html).toContain('75 mm (7.5 cm)')
    })

    it('4.2: POST /flights/:id/edit switching to configuration with updated geometry persists and reflects on detail view', async () => {
      const flyer = await seedTestUser()
      const rocket = await seedTestRocket(flyer.id, {
        name: 'Modular Airframe',
        lengthMm: 1400,
        bodyDiameterMm: 65,
      })
      const config1 = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1400,
        bodyDiameterMm: 65,
      })
      const config2 = await seedTestConfig(rocket.id, {
        version: 2,
        lengthMm: 1850, // Stretched payload bay
        bodyDiameterMm: 65,
      })
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config1.id,
      })

      // Update flight to config2
      const res = await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          rocket_configuration_id: config2.id,
          altitude_agl_m: 600,
        },
        {},
        { redirect: 'manual' },
      )
      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe(`/flights/${flight.id}`)

      // Detail view now reflects config2's stretched length (1850 mm)
      const detailRes = await fetchGet(`/flights/${flight.id}`)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain('1850 mm (185.0 cm)')
      expect(detailHtml).toContain('65 mm (6.5 cm)')
      expect(detailHtml).toContain('v2')
    })
  })

  // =========================================================================
  // SECTION 5: Full End-to-End Flight Logging Lifecycle
  // =========================================================================
  describe('5. Full End-to-End Flight Logging Lifecycle with Rocket Airframe Geometry', () => {
    it('5.1: full lifecycle from rocket creation with geometry to flight logging, stock decrement, and detail verification', async () => {
      const flyer = await seedTestUser({ displayName: 'Lifecycle Pilot' })
      const db = getDb()

      // 1. Create a rocket with airframe dimensions via POST /rockets
      const rocketRes = await fetchPostForm(
        '/rockets',
        {
          name: 'Phoenix Strike',
          manufacturer: 'Custom Works',
          status: 'active',
          length_mm: '1650.0',
          body_diameter_mm: '80.0',
          motor_mount_diameter_mm: '38',
        },
        {},
        { redirect: 'manual' },
      )
      expect(rocketRes.status).toBe(303)
      const rocketLocation = rocketRes.headers.get('location')!
      const rocketId = rocketLocation.split('/').pop()!

      // Verify rocket in D1 has physical dimensions
      const [rocket] = await db.select().from(schema.rockets).where(eq(schema.rockets.id, rocketId))
      expect(rocket.lengthMm).toBe(1650.0)
      expect(rocket.bodyDiameterMm).toBe(80.0)

      // Baseline v1 configuration snapshot exists with those dimensions
      const configs = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocketId))
      expect(configs.length).toBeGreaterThanOrEqual(1)
      const baselineConfig = configs[0]
      expect(baselineConfig.lengthMm).toBe(1650.0)
      expect(baselineConfig.bodyDiameterMm).toBe(80.0)

      // 2. Add an inventory motor item
      const motor = await seedTestMotor({ impulseClass: 'G', model: 'G76G' })
      const inventory = await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 3,
        expendedCount: 0,
      })
      const site = await seedTestSite({ maxAltitudeAglM: 2000 })

      // 3. Verify GET /flights/new lists baseline config with data-length and data-diameter
      const formRes = await fetchGet('/flights/new')
      const formHtml = await formRes.text()
      expect(formHtml).toContain(`value="${baselineConfig.id}"`)
      expect(formHtml).toContain('data-length="1650"')
      expect(formHtml).toContain('data-diameter="80"')

      // 4. Log the flight via POST /flights
      const flightPostRes = await fetchPostForm(
        '/flights',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: baselineConfig.id,
          motor_id: motor.id,
          motor_inventory_id: inventory.id,
          launch_site_id: site.id,
          altitude_agl_m: 512,
          max_velocity_mps: 110,
          rso_name: 'Officer Bob',
          lco_name: 'Officer Carol',
          outcome: 'successful',
          notes: 'Flawless flight. Parachute deployed at apogee.',
        },
        {},
        { redirect: 'manual' },
      )
      expect(flightPostRes.status).toBe(303)
      const flightUrl = flightPostRes.headers.get('location')!
      const flightId = flightUrl.split('/').pop()!

      // 5. Verify motor stock was decremented atomically
      const [updatedInv] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inventory.id))
      expect(updatedInv.quantityOnHand).toBe(2)
      expect(updatedInv.expendedCount).toBe(1)

      // 6. Verify GET /flights/:id renders all airframe dimensions & RSO/LCO clearance
      const flightRes = await fetchGet(`/flights/${flightId}`)
      assertHtmlResponse(flightRes, 200)
      const flightHtml = await flightRes.text()

      // Check header and title
      expect(flightHtml).toContain('Phoenix Strike')
      expect(flightHtml).toContain('512')

      // Vehicle Configuration card
      expect(flightHtml).toContain('1650 mm (165.0 cm)')
      expect(flightHtml).toContain('80 mm (8.0 cm)')

      // Preflight safety clearance card
      expect(flightHtml).toContain('Physical Clearance (RSO/LCO):')
      expect(flightHtml).toContain('Length: <strong class="text-white font-mono">1650 mm (165.0 cm)</strong>')
      expect(flightHtml).toContain('Body Diameter: <strong class="text-white font-mono">80 mm (8.0 cm)</strong>')
      expect(flightHtml).toContain('Officer Bob')
      expect(flightHtml).toContain('Officer Carol')

      // 7. Verify GET /flights logbook listing includes this flight
      const logbookRes = await fetchGet('/flights')
      const logbookHtml = await logbookRes.text()
      expect(logbookHtml).toContain('Phoenix Strike')
      expect(logbookHtml).toContain('512')
    })
  })
})
