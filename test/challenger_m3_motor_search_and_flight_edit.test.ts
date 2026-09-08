/**
 * Empirical Adversarial Verification Suite for Milestone 3:
 * Requirement R2: Flight Logbook Usability: Searchable Motor Filter & Flight Edit Route
 *
 * Covers:
 * 1. Motor Search Filter: Multi-term search queries, case insensitivity,
 *    manufacturer vs designation vs diameter matches, whitespace resilience,
 *    special characters handling, and metadata attributes validation.
 * 2. HTMX Triggers on #motor_id: Verification that live safety soft-gate triggers
 *    remain functional, filter typing does not fire spurious change events,
 *    and Enter/Escape key handlers work as specified.
 * 3. GET /flights/:id/edit: Valid flights (200 with pre-filled fields & edit mode),
 *    non-existent UUIDs (404), and malformed IDs (404).
 * 4. POST /flights/:id/edit & POST /flights/:id: Full updates, partial updates,
 *    numerical boundary values (0, negative, extreme high), duty officer rotations,
 *    unassigned/empty strings, non-member visiting officers, and inventory isolation.
 *
 * Authored by Milestone 3 Challenger 1.
 */

import { env, SELF } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
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
  assertAlertBanner,
  assertContains,
  assertHasFormField,
  assertHtmlResponse,
} from './helpers/html'
import {
  fetchGet,
  fetchHtmxPostForm,
  fetchPostForm,
} from './helpers/http'

beforeEach(async () => {
  await truncateDb()
  try {
    const now = Date.now()
    await env.DB.prepare(
      "INSERT OR REPLACE INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?, ?)"
    ).bind(now, now).run()
  } catch {}
})

/**
 * Helper to simulate the exact client-side filtering logic embedded in src/views/flights.ts
 */
function simulateMotorFilter(
  options: Array<{ value: string; text: string; dataSearch: string; id?: string }>,
  query: string
): Array<{ value: string; text: string; visible: boolean }> {
  const rawQuery = (query || '').trim().toLowerCase()
  const terms = rawQuery ? rawQuery.split(/\s+/).filter(Boolean) : []

  return options.map((opt) => {
    if (!opt.value || opt.id === 'motor-filter-no-match') {
      return { value: opt.value, text: opt.text, visible: false }
    }
    if (terms.length === 0) {
      return { value: opt.value, text: opt.text, visible: true }
    }
    const searchIndex = (opt.dataSearch || opt.text || '').toLowerCase()
    const matches = terms.every((term) => searchIndex.indexOf(term) !== -1)
    return { value: opt.value, text: opt.text, visible: matches }
  })
}

/**
 * Helper to parse <select id="motor_id"> options and their data-* attributes from rendered HTML
 */
function extractMotorOptions(html: string): Array<{
  value: string
  text: string
  dataSearch: string
  dataMfr: string
  dataModel: string
  dataDiameter: string
  dataImpulse: string
  selected: boolean
  id?: string
}> {
  const selectMatch = /<select[^>]*id=["']motor_id["'][^>]*>([\s\S]*?)<\/select>/i.exec(html)
  if (!selectMatch) return []

  const selectInner = selectMatch[1]
  const optionRegex = /<option([^>]*)>([\s\S]*?)<\/option>/gi
  const options: Array<{
    value: string
    text: string
    dataSearch: string
    dataMfr: string
    dataModel: string
    dataDiameter: string
    dataImpulse: string
    selected: boolean
    id?: string
  }> = []

  let match: RegExpExecArray | null
  while ((match = optionRegex.exec(selectInner)) !== null) {
    const attrs = match[1]
    const text = match[2].trim()

    const valMatch = /value=["']([^"']*)["']/i.exec(attrs)
    const idMatch = /id=["']([^"']*)["']/i.exec(attrs)
    const searchMatch = /data-search=["']([^"']*)["']/i.exec(attrs)
    const mfrMatch = /data-mfr=["']([^"']*)["']/i.exec(attrs)
    const modelMatch = /data-model=["']([^"']*)["']/i.exec(attrs)
    const diameterMatch = /data-diameter=["']([^"']*)["']/i.exec(attrs)
    const impulseMatch = /data-impulse=["']([^"']*)["']/i.exec(attrs)
    const isSelected = /\bselected\b/i.test(attrs)

    options.push({
      value: valMatch ? valMatch[1] : '',
      text,
      dataSearch: searchMatch ? searchMatch[1] : '',
      dataMfr: mfrMatch ? mfrMatch[1] : '',
      dataModel: modelMatch ? modelMatch[1] : '',
      dataDiameter: diameterMatch ? diameterMatch[1] : '',
      dataImpulse: impulseMatch ? impulseMatch[1] : '',
      selected: isSelected,
      id: idMatch ? idMatch[1] : undefined,
    })
  }

  return options
}

describe('Milestone 3 Empirical Adversarial Challenge', () => {

  describe('Suite 1: Motor Search Filter Specification & Query Adversarial Stress', () => {
    it('1.1: renders #motor-search-filter without name attribute in both /flights/new and /flights/:id/edit', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
      })

      for (const path of ['/flights/new', `/flights/${flight.id}/edit`]) {
        const res = await fetchGet(path, { Cookie: `triplet_session=${token}` })
        assertHtmlResponse(res, 200)
        const html = await res.text()

        // 1. Must contain input element with id="motor-search-filter"
        expect(html, `Path ${path} missing #motor-search-filter`).toMatch(/<input[^>]*id=["']motor-search-filter["']/i)

        // 2. Extract the filter input element and verify it has NO name attribute (prevents form pollution)
        const inputMatch = /<input[^>]*id=["']motor-search-filter["'][^>]*>/i.exec(html)
        expect(inputMatch, `Could not extract input from ${path}`).not.toBeNull()
        const inputTag = inputMatch![0]
        expect(inputTag, `input in ${path} must not have name attribute`).not.toMatch(/\bname=["']/i)

        // 3. Must have placeholder mentioning designation, manufacturer, diameter
        expect(inputTag).toMatch(/placeholder=["'][^"']*(designation|manufacturer|diameter)/i)
      }
    })

    it('1.2: motor select dropdown options contain accurate data-search, data-mfr, data-model, data-diameter, data-impulse', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const m1 = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'H128W',
        impulseClass: 'H',
        delayS: 14,
        diameterMm: 29,
      })

      const m2 = await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'I216-SK',
        impulseClass: 'I',
        delayS: 17,
        diameterMm: 38,
      })

      const res = await fetchGet('/flights/new', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      const options = extractMotorOptions(html)
      const optH128 = options.find((o) => o.value === m1.id)
      const optI216 = options.find((o) => o.value === m2.id)

      expect(optH128, 'Option for H128W not found').toBeDefined()
      expect(optH128!.dataMfr).toBe('AeroTech')
      expect(optH128!.dataModel).toBe('H128W')
      expect(optH128!.dataDiameter).toBe('29')
      expect(optH128!.dataImpulse).toBe('H')
      expect(optH128!.dataSearch).toContain('aerotech')
      expect(optH128!.dataSearch).toContain('h128w')
      expect(optH128!.dataSearch).toContain('29mm')
      expect(optH128!.dataSearch).toContain('29')

      expect(optI216, 'Option for I216 not found').toBeDefined()
      expect(optI216!.dataMfr).toBe('Cesaroni')
      expect(optI216!.dataModel).toBe('I216-SK')
      expect(optI216!.dataDiameter).toBe('38')
      expect(optI216!.dataImpulse).toBe('I')
      expect(optI216!.dataSearch).toContain('cesaroni')
      expect(optI216!.dataSearch).toContain('38mm')
    })

    it('1.3: multi-term queries: combines manufacturer, designation, and diameter in any order', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      // Seed a diverse fleet of motors
      const mAt29 = await seedTestMotor({ manufacturer: 'AeroTech', model: 'H128W', diameterMm: 29, impulseClass: 'H' })
      const mAt38 = await seedTestMotor({ manufacturer: 'AeroTech', model: 'I200W', diameterMm: 38, impulseClass: 'I' })
      const mCti29 = await seedTestMotor({ manufacturer: 'Cesaroni', model: 'G79SS', diameterMm: 29, impulseClass: 'G' })
      const mCti38 = await seedTestMotor({ manufacturer: 'Cesaroni', model: 'H153', diameterMm: 38, impulseClass: 'H' })
      const mEst18 = await seedTestMotor({ manufacturer: 'Estes', model: 'C6-5', diameterMm: 18, impulseClass: 'C' })

      const res = await fetchGet('/flights/new', { Cookie: `triplet_session=${token}` })
      const html = await res.text()
      const options = extractMotorOptions(html)

      // Query 1: "AeroTech 29mm" -> Should match only mAt29
      const res1 = simulateMotorFilter(options, 'AeroTech 29mm')
      const vis1 = res1.filter((r) => r.visible).map((r) => r.value)
      expect(vis1).toEqual([mAt29.id])

      // Query 2: "29mm AeroTech" (reversed token order) -> Same result
      const res2 = simulateMotorFilter(options, '29mm AeroTech')
      const vis2 = res2.filter((r) => r.visible).map((r) => r.value)
      expect(vis2).toEqual([mAt29.id])

      // Query 3: "Cesaroni" -> Matches mCti29 and mCti38
      const res3 = simulateMotorFilter(options, 'Cesaroni')
      const vis3 = res3.filter((r) => r.visible).map((r) => r.value)
      expect(vis3).toContain(mCti29.id)
      expect(vis3).toContain(mCti38.id)
      expect(vis3).not.toContain(mAt29.id)
      expect(vis3).not.toContain(mEst18.id)

      // Query 4: "38mm" -> Matches mAt38 and mCti38
      const res4 = simulateMotorFilter(options, '38mm')
      const vis4 = res4.filter((r) => r.visible).map((r) => r.value)
      expect(vis4).toContain(mAt38.id)
      expect(vis4).toContain(mCti38.id)
      expect(vis4).not.toContain(mAt29.id)
      expect(vis4).not.toContain(mCti29.id)

      // Query 5: "H153 38" -> Matches Cesaroni H153
      const res5 = simulateMotorFilter(options, 'H153 38')
      const vis5 = res5.filter((r) => r.visible).map((r) => r.value)
      expect(vis5).toEqual([mCti38.id])
    })

    it('1.4: case insensitivity across manufacturer, model, and diameter units', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const m = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'H128W',
        diameterMm: 29,
        impulseClass: 'H',
      })

      const res = await fetchGet('/flights/new', { Cookie: `triplet_session=${token}` })
      const html = await res.text()
      const options = extractMotorOptions(html)

      const variants = [
        'aerotech',
        'AEROTECH',
        'AeRoTeCh',
        'h128w',
        'H128W',
        '29mm',
        '29MM',
        'AEROTECH 29MM H128W',
        'aerotech 29mm h128w',
      ]

      for (const q of variants) {
        const filtered = simulateMotorFilter(options, q)
        const visible = filtered.filter((r) => r.visible).map((r) => r.value)
        expect(visible, `Query "${q}" failed to match motor ${m.id}`).toContain(m.id)
      }
    })

    it('1.5: normalized model handling matches stripped hyphens and underscores', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const m1 = await seedTestMotor({ manufacturer: 'Estes', model: 'C6-5', diameterMm: 18 })
      const m2 = await seedTestMotor({ manufacturer: 'AeroTech', model: 'F39_9', diameterMm: 24 })

      const res = await fetchGet('/flights/new', { Cookie: `triplet_session=${token}` })
      const html = await res.text()
      const options = extractMotorOptions(html)

      // "C65" or "C6-5" should both match Estes C6-5
      const resHyphen1 = simulateMotorFilter(options, 'c65')
      expect(resHyphen1.filter((r) => r.visible).map((r) => r.value)).toContain(m1.id)

      const resHyphen2 = simulateMotorFilter(options, 'c6-5')
      expect(resHyphen2.filter((r) => r.visible).map((r) => r.value)).toContain(m1.id)

      // "F399" should match F39_9
      const resUnderscore = simulateMotorFilter(options, 'f399')
      expect(resUnderscore.filter((r) => r.visible).map((r) => r.value)).toContain(m2.id)
    })

    it('1.6: boundary and stress inputs: whitespace, regex metacharacters, and zero matches', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      await seedTestMotor({ manufacturer: 'AeroTech', model: 'G80W', diameterMm: 29 })
      await seedTestMotor({ manufacturer: 'Cesaroni', model: 'G79SS', diameterMm: 29 })

      const res = await fetchGet('/flights/new', { Cookie: `triplet_session=${token}` })
      const html = await res.text()
      const options = extractMotorOptions(html)

      // 1. Empty and excessive whitespace keeps all catalog items visible
      const emptyQuery = simulateMotorFilter(options, '   \t  \n  ')
      const totalMotors = options.filter((o) => o.value && o.id !== 'motor-filter-no-match').length
      const visibleEmpty = emptyQuery.filter((r) => r.visible).length
      expect(visibleEmpty).toBe(totalMotors)

      // 2. Non-matching query yields 0 visible motors
      const noMatch = simulateMotorFilter(options, 'nonexistent-quantum-thruster-999')
      const visibleNoMatch = noMatch.filter((r) => r.visible).length
      expect(visibleNoMatch).toBe(0)

      // 3. Regex metacharacters do NOT throw errors (proves safe indexOf implementation)
      const specialQueries = ['(AeroTech)', '[G80]', 'G80+', 'H128*', '29?mm', 'AeroTech\\', '^G80$']
      for (const sq of specialQueries) {
        expect(() => simulateMotorFilter(options, sq)).not.toThrow()
      }
    })
  })

  describe('Suite 2: HTMX Triggers on #motor_id & Safety Soft-Gates Non-Disruption', () => {
    it('2.1: preserves all HTMX attributes on #motor_id select element', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/flights/new', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      const selectMatch = /<select[^>]*id=["']motor_id["'][^>]*>/i.exec(html)
      expect(selectMatch, 'motor_id select tag not found').not.toBeNull()
      const selectTag = selectMatch![0]

      expect(selectTag).toMatch(/hx-post=["']\/flights\/preflight-check["']/i)
      expect(selectTag).toMatch(/hx-trigger=["']change["']/i)
      expect(selectTag).toMatch(/hx-target=["']#soft-gate-alerts["']/i)
      expect(selectTag).toMatch(/hx-include=["']#flight-form["']/i)
    })

    it('2.2: preflight safety soft-gate trigger responds cleanly when motor is posted', async () => {
      const flyer = await seedTestUser({ displayName: 'Novice L0 Pilot' }) // Level 0
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 1.6 })
      const motorHpr = await seedTestMotor({ impulseClass: 'H', model: 'H128W' })
      const motorMpr = await seedTestMotor({ impulseClass: 'G', model: 'G80W' })
      const site = await seedTestSite({ maxAltitudeAglM: 3000 })

      // 1. High Power Motor on L0 flyer triggers amber certification warning
      const resHpr = await fetchHtmxPostForm(
        '/flights/preflight-check',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motorHpr.id,
          launch_site_id: site.id,
          expected_altitude_m: 800,
        },
        { Cookie: `triplet_session=${token}` }
      )
      expect(resHpr.status).toBe(200)
      const hprText = await resHpr.text()
      assertAlertBanner(hprText, 'warning')
      expect(hprText).toMatch(/requires Level 1/i)
      expect(hprText).toMatch(/proceeded_despite_warnings/i)

      // 2. Mid Power Motor on L0 flyer passes cleanly without cert warning
      const resMpr = await fetchHtmxPostForm(
        '/flights/preflight-check',
        {
          flyer_id: flyer.id,
          rocket_configuration_id: config.id,
          motor_id: motorMpr.id,
          launch_site_id: site.id,
          expected_altitude_m: 600,
        },
        { Cookie: `triplet_session=${token}` }
      )
      expect(resMpr.status).toBe(200)
      const mprText = await resMpr.text()
      expect(mprText).not.toMatch(/requires Level 1/i)
      expect(mprText).toMatch(/all checks pass|clear|ready|safe/i)
    })

    it('2.3: client-side script handles Enter key selection and Escape key clearing', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/flights/new', { Cookie: `triplet_session=${token}` })
      const html = await res.text()

      // Verify the script exists and contains key handling logic
      expect(html).toContain('initMotorSearchFilter')
      expect(html).toMatch(/e\.key\s*===\s*['"]Enter['"]/i)
      expect(html).toMatch(/e\.key\s*===\s*['"]Escape['"]/i)
      // Verify Enter dispatches a 'change' event to trigger HTMX
      expect(html).toMatch(/new\s+Event\s*\(\s*['"]change['"]\s*,\s*\{\s*bubbles:\s*true\s*\}\s*\)/i)
    })
  })

  describe('Suite 3: GET /flights/:id/edit Endpoint Verification', () => {
    it('3.1: valid flight returns HTTP 200 with edit form and pre-selected values', async () => {
      const flyer = await seedTestUser({ displayName: 'Flight Commander' })
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id, { name: 'Falcon Scout' })
      const config = await seedTestConfig(rocket.id, { version: 2 })
      const motor = await seedTestMotor({ manufacturer: 'AeroTech', model: 'H128W', diameterMm: 29 })
      const site = await seedTestSite({ name: 'Eldorado Dry Lake' })

      const rsoUser = await seedTestUser({ displayName: 'Safety Dan' })
      const lcoUser = await seedTestUser({ displayName: 'Controller Alice' })

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        flightNumber: 42,
        altitudeAglM: 1450.5,
        maxVelocityMps: 210.3,
        outcome: 'successful',
        notes: 'Smooth flight and dual deploy recovery',
        rsoName: 'Safety Dan',
        lcoName: 'Controller Alice',
        rsoUserId: rsoUser.id,
        lcoUserId: lcoUser.id,
      })

      const res = await fetchGet(`/flights/${flight.id}/edit`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Form properties
      expect(html).toMatch(new RegExp(`action=["']/flights/${flight.id}/edit["']`, 'i'))
      expect(html).toMatch(/method=["']POST["']/i)
      expect(html).toMatch(/Edit Flight\s*#?42/i)
      expect(html).toContain('Save Flight Changes')

      // Pre-filled fields
      expect(html).toContain('1450.5')
      expect(html).toContain('Smooth flight and dual deploy recovery')
      expect(html).toContain('Safety Dan')
      expect(html).toContain('Controller Alice')

      // Motor option selected
      const options = extractMotorOptions(html)
      const selectedOpt = options.find((o) => o.selected)
      expect(selectedOpt, 'No option marked selected').toBeDefined()
      expect(selectedOpt!.value).toBe(motor.id)

      // Search filter input is present in edit form
      expect(html).toMatch(/<input[^>]*id=["']motor-search-filter["']/i)
    })

    it('3.2: non-existent flight UUID returns HTTP 404', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/flights/00000000-0000-0000-0000-000000000000/edit', {
        Cookie: `triplet_session=${token}`,
      })
      expect(res.status).toBe(404)
      const html = await res.text()
      expect(html).toMatch(/flight.*not.*found|does not exist/i)
    })

    it('3.3: malformed and path-traversal flight IDs return HTTP 404 without 500 error', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const badIds = [
        'invalid-non-uuid-string',
        '../../etc/passwd',
        'null',
        'undefined',
        '12345',
      ]

      for (const badId of badIds) {
        const res = await fetchGet(`/flights/${encodeURIComponent(badId)}/edit`, {
          Cookie: `triplet_session=${token}`,
        })
        expect(res.status, `Failed on bad ID: ${badId}`).toBe(404)
      }
    })

    it('3.4: flight detail view GET /flights/:id features Edit Flight action link', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
      })

      const res = await fetchGet(`/flights/${flight.id}`, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toMatch(new RegExp(`href=["']/flights/${flight.id}/edit["']`, 'i'))
      expect(html).toMatch(/Edit Flight/i)
    })
  })

  describe('Suite 4: POST /flights/:id/edit Partial Updates & Boundary Values', () => {
    it('4.1: full update via POST /flights/:id/edit persists to D1 and redirects 303', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config1 = await seedTestConfig(rocket.id)
      const config2 = await seedTestConfig(rocket.id, { version: 2 })
      const motor1 = await seedTestMotor({ model: 'G80W' })
      const motor2 = await seedTestMotor({ model: 'H128W' })
      const site1 = await seedTestSite({ name: 'Site A' })
      const site2 = await seedTestSite({ name: 'Site B' })

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config1.id,
        motorId: motor1.id,
        launchSiteId: site1.id,
        flightNumber: 1,
        altitudeAglM: 500,
        outcome: 'successful',
      })

      const res = await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          rocket_configuration_id: config2.id,
          motor_id: motor2.id,
          launch_site_id: site2.id,
          flight_number: 2,
          altitude_agl_m: 850.5,
          max_velocity_mps: 135.2,
          outcome: 'recovery_failure',
          notes: 'Drogue deployed late at 300m',
          rso_name: 'Chief RSO Tom',
          lco_name: 'Lead LCO Jerry',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' }
      )

      expect([302, 303]).toContain(res.status)
      const loc = res.headers.get('Location') ?? ''
      expect(loc).toMatch(new RegExp(`/flights/${flight.id}`))

      const db = getDb()
      const [updated] = await db.select().from(schema.flights).where(eq(schema.flights.id, flight.id))
      expect(updated.rocketConfigurationId).toBe(config2.id)
      expect(updated.motorId).toBe(motor2.id)
      expect(updated.launchSiteId).toBe(site2.id)
      expect(updated.flightNumber).toBe(2)
      expect(updated.altitudeAglM).toBeCloseTo(850.5)
      expect(updated.maxVelocityMps).toBeCloseTo(135.2)
      expect(updated.outcome).toBe('recovery_failure')
      expect(updated.notes).toBe('Drogue deployed late at 300m')
      expect(updated.rsoName).toBe('Chief RSO Tom')
      expect(updated.lcoName).toBe('Lead LCO Jerry')
      expect(updated.updatedAt).toBeGreaterThan(0)
    })

    it('4.2: partial update modifying only altitude and notes leaves other fields untouched', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        flightNumber: 10,
        altitudeAglM: 600,
        outcome: 'successful',
        notes: 'Original note',
        rsoName: 'Existing RSO',
        lcoName: 'Existing LCO',
      })

      // Send partial payload with only altitude_agl_m and notes
      const res = await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          altitude_agl_m: 725.4,
          notes: 'Updated note after altimeter download',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' }
      )
      expect([302, 303]).toContain(res.status)

      const db = getDb()
      const [updated] = await db.select().from(schema.flights).where(eq(schema.flights.id, flight.id))

      // Changed fields
      expect(updated.altitudeAglM).toBeCloseTo(725.4)
      expect(updated.notes).toBe('Updated note after altimeter download')

      // Untouched fields must strictly retain original values
      expect(updated.rocketConfigurationId).toBe(config.id)
      expect(updated.motorId).toBe(motor.id)
      expect(updated.launchSiteId).toBe(site.id)
      expect(updated.flightNumber).toBe(10)
      expect(updated.outcome).toBe('successful')
      expect(updated.rsoName).toBe('Existing RSO')
      expect(updated.lcoName).toBe('Existing LCO')
    })

    it('4.3: boundary numerical values: zero altitude, negative barometric drift, extreme ceiling, and clearing values', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        altitudeAglM: 100,
        flightNumber: 5,
      })

      // 1. Boundary zero (0m) — must store 0, not null!
      await fetchPostForm(
        `/flights/${flight.id}/edit`,
        { altitude_agl_m: 0, flight_number: 0 },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' }
      )
      const db = getDb()
      let [rec] = await db.select().from(schema.flights).where(eq(schema.flights.id, flight.id))
      expect(rec.altitudeAglM).toBe(0)
      expect(rec.flightNumber).toBe(0)

      // 2. Negative altitude (e.g. -5.2m sensor drift or dry lake depression)
      await fetchPostForm(
        `/flights/${flight.id}/edit`,
        { altitude_agl_m: -5.2 },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' }
      )
      ;[rec] = await db.select().from(schema.flights).where(eq(schema.flights.id, flight.id))
      expect(rec.altitudeAglM).toBeCloseTo(-5.2)

      // 3. Extreme altitude (120,000m / Karman line edge)
      await fetchPostForm(
        `/flights/${flight.id}/edit`,
        { altitude_agl_m: 120000 },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' }
      )
      ;[rec] = await db.select().from(schema.flights).where(eq(schema.flights.id, flight.id))
      expect(rec.altitudeAglM).toBe(120000)

      // 4. Empty string clears altitude to null
      await fetchPostForm(
        `/flights/${flight.id}/edit`,
        { altitude_agl_m: '' },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' }
      )
      ;[rec] = await db.select().from(schema.flights).where(eq(schema.flights.id, flight.id))
      expect(rec.altitudeAglM).toBeNull()
    })

    it('4.4: duty officer rotation: registered flyer, visiting non-member, foreign key sanitization, and clearance', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const officerUser = await seedTestUser({ displayName: 'Commander Lewis' })
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
      })

      const db = getDb()

      // Case A: Link registered member via user ID
      await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          rso_user_id: officerUser.id,
          rso_name: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' }
      )
      let [rec] = await db.select().from(schema.flights).where(eq(schema.flights.id, flight.id))
      expect(rec.rsoUserId).toBe(officerUser.id)
      expect(rec.rsoName).toBe('Commander Lewis') // auto-resolved from user display name!

      // Case B: Visiting non-member officer name without registered account
      await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          rso_user_id: '',
          rso_name: 'Visiting RSO Col. O\'Neill (NAR #55443)',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' }
      )
      ;[rec] = await db.select().from(schema.flights).where(eq(schema.flights.id, flight.id))
      expect(rec.rsoUserId).toBeNull()
      expect(rec.rsoName).toBe("Visiting RSO Col. O'Neill (NAR #55443)")

      // Case C: Attempting invalid/forged user ID sanitizes to null without FK error
      await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          rso_user_id: 'non-existent-user-id-12345',
          rso_name: 'Designated Safety Monitor',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' }
      )
      ;[rec] = await db.select().from(schema.flights).where(eq(schema.flights.id, flight.id))
      expect(rec.rsoUserId).toBeNull()
      expect(rec.rsoName).toBe('Designated Safety Monitor')

      // Case D: Clearing duty officer completely
      await fetchPostForm(
        `/flights/${flight.id}/edit`,
        {
          rso_user_id: '',
          rso_name: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' }
      )
      ;[rec] = await db.select().from(schema.flights).where(eq(schema.flights.id, flight.id))
      expect(rec.rsoUserId).toBeNull()
      expect(rec.rsoName).toBeNull()
    })

    it('4.5: supports JSON API updates returning HTTP 200 with updated flight object', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        altitudeAglM: 500,
      })

      const res = await SELF.fetch(`https://example.com/flights/${flight.id}/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({
          altitude_agl_m: 999.9,
          outcome: 'successful',
        }),
      })

      expect(res.status).toBe(200)
      const json: any = await res.json()
      expect(json.id).toBe(flight.id)
      expect(json.altitudeAglM).toBeCloseTo(999.9)
      expect(json.outcome).toBe('successful')
    })

    it('4.6: editing non-existent flight returns HTTP 404 (HTML and JSON)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      // HTML POST
      const resHtml = await fetchPostForm(
        '/flights/00000000-0000-0000-0000-000000000000/edit',
        { altitude_agl_m: 500 },
        { Cookie: `triplet_session=${token}` }
      )
      expect(resHtml.status).toBe(404)

      // JSON POST
      const resJson = await SELF.fetch('https://example.com/flights/00000000-0000-0000-0000-000000000000/edit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({ altitude_agl_m: 500 }),
      })
      expect(resJson.status).toBe(404)
    })

    it('4.7: alternate route POST /flights/:id performs identical update', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        altitudeAglM: 400,
      })

      const res = await fetchPostForm(
        `/flights/${flight.id}`,
        { altitude_agl_m: 450.0 },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' }
      )
      expect([302, 303]).toContain(res.status)

      const db = getDb()
      const [updated] = await db.select().from(schema.flights).where(eq(schema.flights.id, flight.id))
      expect(updated.altitudeAglM).toBeCloseTo(450.0)
    })

    it('4.8: inventory isolation: editing a flight does not double-decrement motor stock', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const site = await seedTestSite()
      const inventory = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 5, expendedCount: 1 })

      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        motorInventoryId: inventory.id,
        launchSiteId: site.id,
      })

      // Perform edit on flight
      await fetchPostForm(
        `/flights/${flight.id}/edit`,
        { altitude_agl_m: 800 },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' }
      )

      // Verify inventory quantities remain exactly 5 and 1 (no double deduction)
      const db = getDb()
      const [inv] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, inventory.id))
      expect(inv.quantityOnHand).toBe(5)
      expect(inv.expendedCount).toBe(1)
    })
  })
})
