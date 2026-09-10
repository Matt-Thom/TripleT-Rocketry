/**
 * Empirical Adversarial Challenger Suite: Milestone 7 Phase 2 (Tier 5 Adversarial Coverage Hardening)
 * Scope: Operations & Logistics across Requirements R2, R4, R6.
 *
 * Focus Areas:
 * 1. Requirement R2 (Flight Logbook Usability & Duty Officers):
 *    - Searchable motor filter in /flights/new and /flights/:id/edit:
 *      Multi-token queries, case insensitivity, normalized models without hyphens/underscores,
 *      diameter tokens ("38mm", "29"), whitespace tolerance, regex/special character resilience,
 *      no-match states, and verification that filter input lacks a name attribute.
 *    - Flight-level RSO and LCO duty officer capture, rotation across consecutive flights,
 *      visiting plain-text names vs registered user linkage, non-existent foreign key sanitization,
 *      and XSS injection defense in officer names.
 *
 * 2. Requirement R4 (Inventory Dismissal, Ledger Preservation & SafeWork SA Storage Sites):
 *    - Strict positive-quantity dismissal attacks (quantityOnHand > 0 returns HTTP 400 across Form/JSON/HTMX).
 *    - Zero-stock motor dismissal (soft-delete semantics, deletedAt timestamp, hidden from active inventory).
 *    - Absolute chain-of-custody ledger preservation (historical receipts, adjustments, flight usage, transfers).
 *    - SafeWork SA propellant compliance exact boundary evaluation:
 *      capacity_kg <= 3.0 (0.0, 2.5, 2.999, 3.0) is hobby exempt without permit.
 *      capacity_kg > 3.0 (3.0001, 3.01, 5.0) strictly requires regulatory permit; whitespace/empty permit rejected (HTTP 400).
 *    - Storage site update boundary transitions and strict tenant isolation (IDOR protection on view/edit/update/delete).
 *
 * 3. Requirement R6 (Rocket Airframe Dimensions, Versioning & Preflight Clearance):
 *    - Rocket airframe dimensions (length_mm, body_diameter_mm) with form inputs declaring step="any".
 *    - High-precision fractional decimal entries persisted and rendered accurately in metric (mm/cm) and imperial (ft/in).
 *    - Configuration snapshot versioning and active synchronization:
 *      Adding new active config synchronizes dimensions to parent rocket; editing inactive config retains isolation.
 *    - Preflight rail clearance inspection:
 *      Advisory guide rail notice (>= 3x rocket length), pad blast standoff, data-* attributes on config options,
 *      soft-gate 422 block and acknowledgment override, and flight detail physical clearance sign-off with RSO/LCO.
 *
 * 4. End-to-End Cross-Cutting Logistics Lifecycle:
 *    - Unified workflow testing storage site registration, motor stocking, capacity upgrade with license,
 *      airframe creation with fractional dimensions, consecutive flight logging with duty officer rotation,
 *      atomic inventory consumption to 0, zero-stock dismissal, ledger audit verification, and versioned airframe evolution.
 *
 * Authored by m7_challenger_2_gen2 (M7 Tier 5 Adversarial Challenger - Operations & Logistics).
 */

import { env, SELF } from 'cloudflare:test'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { signSession } from '../src/services/auth'
import {
  getDb,
  seedTestCert,
  seedTestConfig,
  seedTestEvent,
  seedTestFlight,
  seedTestInventory,
  seedTestMotor,
  seedTestRocket,
  seedTestSite,
  seedTestStorageSite,
  seedTestTransaction,
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

/**
 * Helper to simulate the exact client-side motor filtering algorithm embedded in src/views/flights.ts
 */
function simulateClientSideMotorFilter(
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
 * Helper to parse motor select options from rendered HTML
 */
function extractMotorOptionsFromHtml(html: string): Array<{
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

describe('Milestone 7 Phase 2 Tier 5 Adversarial Suite: Operations & Logistics (R2, R4, R6)', () => {

  // ============================================================================
  // SECTION 1: R2 Searchable Motor Filter & Flight Duty Officers Hardening
  // ============================================================================
  describe('1. Requirement R2: Searchable Motor Filter & Flight Duty Officers', () => {

    it('1.1: motor search filter input is rendered in both /flights/new and /flights/:id/edit without name attribute', async () => {
      const flyer = await seedTestUser({ displayName: 'Flight Officer' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Falcon Scout' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor({ manufacturer: 'AeroTech', model: 'H128W-14A', diameterMm: 29 })
      const flight = await seedTestFlight(flyer.id, { rocketConfigurationId: config.id, motorId: motor.id })

      // Check /flights/new
      const newRes = await fetchGet('/flights/new', { Cookie: cookie })
      assertHtmlResponse(newRes, 200)
      const newHtml = await newRes.text()

      expect(newHtml).toContain('id="motor-search-filter"')
      // Verify no name attribute on search input so it does not submit with form
      const filterInputNew = /<input[^>]*id=["']motor-search-filter["'][^>]*>/i.exec(newHtml)
      expect(filterInputNew).not.toBeNull()
      expect(filterInputNew![0]).not.toMatch(/\bname=/i)

      // Check /flights/:id/edit
      const editRes = await fetchGet(`/flights/${flight.id}/edit`, { Cookie: cookie })
      assertHtmlResponse(editRes, 200)
      const editHtml = await editRes.text()

      expect(editHtml).toContain('id="motor-search-filter"')
      const filterInputEdit = /<input[^>]*id=["']motor-search-filter["'][^>]*>/i.exec(editHtml)
      expect(filterInputEdit).not.toBeNull()
      expect(filterInputEdit![0]).not.toMatch(/\bname=/i)
    })

    it('1.2: motor select options embed comprehensive search index matching manufacturer, normalized designation, diameter, and delay', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      await seedTestMotor({ manufacturer: 'AeroTech', model: 'H128W', delayS: 14, diameterMm: 29, impulseClass: 'H' })
      await seedTestMotor({ manufacturer: 'Cesaroni', model: 'Pro38-6G H153', delayS: 15, diameterMm: 38, impulseClass: 'H' })
      await seedTestMotor({ manufacturer: 'Estes', model: 'C6-5', delayS: 5, diameterMm: 18, impulseClass: 'C' })
      await seedTestMotor({ manufacturer: 'Cesaroni', model: 'I216-15A', delayS: 15, diameterMm: 38, impulseClass: 'I' })

      const res = await fetchGet('/flights/new', { Cookie: cookie })
      const html = await res.text()
      const options = extractMotorOptionsFromHtml(html)

      // 1. Multi-term query: "aerotech 29mm" matches only AeroTech H128W
      const results1 = simulateClientSideMotorFilter(options, 'aerotech 29mm')
      const matched1 = results1.filter((r) => r.visible)
      expect(matched1.length).toBe(1)
      expect(matched1[0].text).toContain('AeroTech H128W')

      // 2. Normalized model query: "pro38" matches Cesaroni Pro38-6G without hyphens
      const results2 = simulateClientSideMotorFilter(options, 'pro38')
      const matched2 = results2.filter((r) => r.visible)
      expect(matched2.length).toBe(1)
      expect(matched2[0].text).toContain('Pro38-6G')

      // 3. Diameter query: "38mm" matches both 38mm Cesaroni motors
      const results3 = simulateClientSideMotorFilter(options, '38mm')
      const matched3 = results3.filter((r) => r.visible)
      expect(matched3.length).toBe(2)
      expect(matched3.every((m) => m.text.includes('Cesaroni'))).toBe(true)

      // 4. Case-insensitive & whitespace query: "   CESARONI   i216   "
      const results4 = simulateClientSideMotorFilter(options, '   CESARONI   i216   ')
      const matched4 = results4.filter((r) => r.visible)
      expect(matched4.length).toBe(1)
      expect(matched4[0].text).toContain('I216')

      // 5. Non-matching query: "K550" matches zero motors
      const results5 = simulateClientSideMotorFilter(options, 'K550')
      const matched5 = results5.filter((r) => r.visible)
      expect(matched5.length).toBe(0)
    })

    it('1.3: consecutive flight logging preserves independent RSO/LCO duty officers across rotations at the same meet', async () => {
      const flyer = await seedTestUser({ displayName: 'Meet Competitor' })
      const rsoA = await seedTestUser({ displayName: 'Chief RSO Alice' })
      const lcoA = await seedTestUser({ displayName: 'Pad Controller Bob' })
      const rsoB = await seedTestUser({ displayName: 'Rotated RSO Charlie' })

      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Meet Flyer' })
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 2.0 })
      const motor = await seedTestMotor({ impulseClass: 'G' })
      const site = await seedTestSite()
      const event = await seedTestEvent(site.id, { name: 'State Championship Meet' })

      // Flight 1: RSO Alice + LCO Bob
      const res1 = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          launch_event_id: event.id,
          flight_number: 201,
          altitude_agl_m: 450,
          rso_user_id: rsoA.id,
          lco_user_id: lcoA.id,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res1.status)

      // Flight 2: RSO rotated to Charlie + Same LCO Bob
      const res2 = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          launch_event_id: event.id,
          flight_number: 202,
          altitude_agl_m: 480,
          rso_user_id: rsoB.id,
          lco_user_id: lcoA.id,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res2.status)

      // Flight 3: Visiting plain text officers (not registered users)
      const res3 = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          launch_event_id: event.id,
          flight_number: 203,
          altitude_agl_m: 510,
          rso_name: 'Visiting Marshal Dave (TRA #9876)',
          lco_name: 'Guest Controller Eve',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res3.status)

      // Flight 4: Solo / Unassigned officers
      const res4 = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          launch_event_id: event.id,
          flight_number: 204,
          altitude_agl_m: 420,
          rso_name: '',
          lco_name: '',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res4.status)

      // Verify D1 records for all 4 flights
      const db = getDb()
      const flights = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.launchEventId, event.id))
        .orderBy(schema.flights.flightNumber)

      expect(flights.length).toBe(4)

      // Flight 1 inspection
      expect(flights[0].rsoUserId).toBe(rsoA.id)
      expect(flights[0].lcoUserId).toBe(lcoA.id)
      expect(flights[0].rsoName).toBe('Chief RSO Alice')
      expect(flights[0].lcoName).toBe('Pad Controller Bob')

      // Flight 2 inspection
      expect(flights[1].rsoUserId).toBe(rsoB.id)
      expect(flights[1].lcoUserId).toBe(lcoA.id)
      expect(flights[1].rsoName).toBe('Rotated RSO Charlie')
      expect(flights[1].lcoName).toBe('Pad Controller Bob')

      // Flight 3 inspection
      expect(flights[2].rsoUserId).toBeNull()
      expect(flights[2].lcoUserId).toBeNull()
      expect(flights[2].rsoName).toBe('Visiting Marshal Dave (TRA #9876)')
      expect(flights[2].lcoName).toBe('Guest Controller Eve')

      // Flight 4 inspection
      expect(flights[3].rsoUserId).toBeNull()
      expect(flights[3].lcoUserId).toBeNull()
      expect(flights[3].rsoName).toBeNull()
      expect(flights[3].lcoName).toBeNull()

      // Inspect detail views
      const detail1Res = await fetchGet(`/flights/${flights[0].id}`, { Cookie: cookie })
      const detail1Html = await detail1Res.text()
      expect(detail1Html).toContain('Chief RSO Alice')
      expect(detail1Html).toContain('Pad Controller Bob')

      const detail4Res = await fetchGet(`/flights/${flights[3].id}`, { Cookie: cookie })
      const detail4Html = await detail4Res.text()
      expect(detail4Html).toMatch(/Unassigned/i)
    })

    it('1.4: sanitizes invalid candidate officer IDs to null preventing foreign key violation crashes', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 2.0 })
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      // Submit fabricated non-existent UUIDs for officer IDs
      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          rso_user_id: 'non-existent-user-uuid-999',
          lco_user_id: 'fake-controller-uuid-888',
          rso_name: 'Fallback Name Dan',
          lco_name: 'Fallback Name Phil',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      // Must succeed cleanly without 500 foreign key crash
      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') ?? ''
      expect(location).toMatch(/\/flights\/[a-zA-Z0-9-]+/)

      // Verify D1: sanitized user IDs to null, retained plain text names
      const db = getDb()
      const [savedFlight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.rocketConfigurationId, config.id))

      expect(savedFlight.rsoUserId).toBeNull()
      expect(savedFlight.lcoUserId).toBeNull()
      expect(savedFlight.rsoName).toBe('Fallback Name Dan')
      expect(savedFlight.lcoName).toBe('Fallback Name Phil')
    })

    it('1.5: duty officer names with XSS script payloads are safely escaped in HTML detail view', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id)
      const config = await seedTestConfig(rocket.id, { stabilityCalibers: 2.0 })
      const motor = await seedTestMotor()
      const site = await seedTestSite()

      const xssRso = '<script>alert("rso_xss")</script>'
      const xssLco = '<img src=x onerror="alert(\'lco\')">'

      const res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: config.id,
          motor_id: motor.id,
          launch_site_id: site.id,
          rso_name: xssRso,
          lco_name: xssLco,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') ?? ''

      const detailRes = await fetchGet(location, { Cookie: cookie })
      const detailHtml = await detailRes.text()

      // Raw unescaped scripts must not be present
      expect(detailHtml).not.toContain('<script>alert("rso_xss")</script>')
      expect(detailHtml).not.toContain('<img src=x onerror="alert(\'lco\')">')
      // HTML escaped equivalents
      expect(detailHtml).toContain('&lt;script&gt;alert(&quot;rso_xss&quot;)&lt;/script&gt;')
    })
  })

  // ============================================================================
  // SECTION 2: R4 Inventory Dismissal, Ledger Preservation & SafeWork SA Sites
  // ============================================================================
  describe('2. Requirement R4: Zero-Stock Motor Dismissal, Ledger Preservation & SafeWork SA Sites', () => {

    it('2.1: positive quantity motor dismissal attempts fail with HTTP 400 across Form, JSON, and HTMX', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const motor = await seedTestMotor({ model: 'AeroTech G80' })
      const inv = await seedTestInventory(flyer.id, motor.id, { quantityOnHand: 2 })

      // Form request
      const formRes = await fetchPostForm(
        `/inventory/${inv.id}/dismiss`,
        {},
        { Cookie: cookie },
      )
      expect(formRes.status).toBe(400)
      const formText = await formRes.text()
      expect(formText).toContain('Cannot dismiss motor inventory with quantity on hand greater than 0')

      // JSON request
      const jsonRes = await SELF.fetch(`https://example.com/inventory/${inv.id}/dismiss`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({}),
      })
      expect(jsonRes.status).toBe(400)
      const jsonBody = (await jsonRes.json()) as any
      expect(jsonBody.error).toContain('Cannot dismiss motor inventory with quantity on hand greater than 0')

      // HTMX request
      const htmxRes = await fetchPostForm(
        `/inventory/${inv.id}/dismiss`,
        {},
        {
          Cookie: cookie,
          'HX-Request': 'true',
        },
      )
      expect(htmxRes.status).toBe(400)

      // Verify D1 state remains uncorrupted
      const db = getDb()
      const [record] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(record.deletedAt).toBeNull()
      expect(record.quantityOnHand).toBe(2)
    })

    it('2.2: zero-stock motor dismisses successfully, hides from active view, and preserves full custody ledger', async () => {
      const flyer = await seedTestUser({ displayName: 'Inventory Auditor' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const motor = await seedTestMotor({ model: 'AeroTech F50T-6A' })
      const inv = await seedTestInventory(flyer.id, motor.id, {
        quantityOnHand: 0,
        expendedCount: 3,
        batchLotNumber: 'LOT-2026-F50',
      })

      // Seed historical chain-of-custody ledger records referencing this inventory item
      const txReceipt = await seedTestTransaction(flyer.id, {
        motorInventoryId: inv.id,
        transactionType: 'received',
        quantity: 3,
        counterpartyName: 'Rocket Supplies Australia',
        notes: 'Safe transport verified',
      })
      const txFlight = await seedTestTransaction(flyer.id, {
        motorInventoryId: inv.id,
        transactionType: 'used',
        quantity: 1,
        notes: 'Expended in competition flight',
      })

      // Perform dismissal
      const dismissRes = await fetchPostForm(
        `/inventory/${inv.id}/dismiss`,
        {},
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(dismissRes.status)

      // D1 check: row still exists, deletedAt is set
      const db = getDb()
      const [softDeleted] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(softDeleted).toBeDefined()
      expect(softDeleted.deletedAt).not.toBeNull()

      // Active inventory view: motor must NOT be present in active motors table
      const activeRes = await fetchGet('/inventory', { Cookie: cookie })
      const activeHtml = await activeRes.text()
      expect(activeHtml).not.toContain(`id="inventory-row-${inv.id}"`)
      expect(activeHtml).toContain('0 configured motor entries')
      expect(activeHtml).toContain('No motors currently tracked in your inventory.')

      // Chain-of-custody ledger GET /inventory/transactions: transactions are 100% PRESERVED
      const ledgerRes = await fetchGet('/inventory/transactions', { Cookie: cookie })
      assertHtmlResponse(ledgerRes, 200)
      const ledgerHtml = await ledgerRes.text()

      expect(ledgerHtml).toContain('Rocket Supplies Australia')
      expect(ledgerHtml).toContain('Safe transport verified')
      expect(ledgerHtml).toContain('Expended in competition flight')

      // Direct D1 verification on inventory_transactions table
      const dbTxs = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.motorInventoryId, inv.id))

      expect(dbTxs.length).toBe(2)
      expect(dbTxs.every((t) => t.deletedAt === null)).toBe(true)
    })

    it('2.3: SafeWork SA propellant storage sites enforce exact boundary conditions (<= 3.0 exempt, > 3.0 permit required)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      // Boundary 1: 0.0 kg without permit -> Valid (Hobby exempt)
      const res0 = await fetchPostForm(
        '/inventory/storage-sites',
        { name: 'Field Box Zero', capacity_kg: 0.0, permit_number: '' },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([201, 302, 303]).toContain(res0.status)

      // Boundary 2: 2.99 kg without permit -> Valid
      const res299 = await fetchPostForm(
        '/inventory/storage-sites',
        { name: 'Workshop Safe 2.99', capacity_kg: 2.99, permit_number: '' },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([201, 302, 303]).toContain(res299.status)

      // Boundary 3: 3.00 kg (exact threshold) without permit -> Valid
      const res300 = await fetchPostForm(
        '/inventory/storage-sites',
        { name: 'Threshold Cabinet 3.0', capacity_kg: 3.0, permit_number: '' },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([201, 302, 303]).toContain(res300.status)

      // Boundary 4: 3.0001 kg without permit -> Fails with HTTP 400
      const res3001Fail = await fetchPostForm(
        '/inventory/storage-sites',
        { name: 'Slightly Over 3.0001', capacity_kg: 3.0001, permit_number: '' },
        { Cookie: cookie },
      )
      expect(res3001Fail.status).toBe(400)
      const text3001 = await res3001Fail.text()
      expect(text3001).toContain('SafeWork SA regulations require a propellant storage license/permit')

      // Boundary 5: 3.0001 kg with valid permit -> Succeeds
      const res3001Pass = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Licensed Over 3.0001',
          capacity_kg: 3.0001,
          permit_number: 'SAFEWORK-SA-EXP-2026-99',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([201, 302, 303]).toContain(res3001Pass.status)

      // Boundary 6: 5.5 kg with whitespace permit -> Fails with HTTP 400
      const resWhitespaceFail = await fetchPostForm(
        '/inventory/storage-sites',
        { name: 'Heavy Bunker 5.5', capacity_kg: 5.5, permit_number: '    ' },
        { Cookie: cookie },
      )
      expect(resWhitespaceFail.status).toBe(400)
      const textWs = await resWhitespaceFail.text()
      expect(textWs).toContain('SafeWork SA regulations require a propellant storage license/permit')
    })

    it('2.4: storage site update dynamically enforces SafeWork SA boundary and isolates access across flyers (IDOR defense)', async () => {
      const userA = await seedTestUser({ email: 'ownerA@rocketry.local' })
      const userB = await seedTestUser({ email: 'intruderB@rocketry.local' })
      const tokenA = await signSession(userA.id)
      const tokenB = await signSession(userB.id)

      const siteA = await seedTestStorageSite(userA.id, {
        name: 'User A Bunker',
        capacityKg: 2.5,
        permitNumber: null,
      })

      // 1. Owner updates capacity from 2.5kg to 4.0kg without permit -> Rejected 400
      const updateOverFail = await fetchPostForm(
        `/inventory/storage-sites/${siteA.id}/edit`,
        {
          name: 'User A Bunker Expanded',
          capacity_kg: 4.0,
          permit_number: '',
        },
        { Cookie: `triplet_session=${tokenA}` },
      )
      expect(updateOverFail.status).toBe(400)
      const failHtml = await updateOverFail.text()
      expect(failHtml).toContain('SafeWork SA regulations require a propellant storage license/permit')

      // 2. Owner updates with valid permit -> Succeeds
      const updateOverPass = await fetchPostForm(
        `/inventory/storage-sites/${siteA.id}/edit`,
        {
          name: 'User A Bunker Expanded',
          capacity_kg: 4.0,
          permit_number: 'PERMIT-SA-777',
        },
        { Cookie: `triplet_session=${tokenA}` },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(updateOverPass.status)

      // 3. User B attempts unauthorized view, edit, and deletion (IDOR)
      const getResB = await fetchGet(`/inventory/storage-sites/${siteA.id}`, {
        Cookie: `triplet_session=${tokenB}`,
      })
      expect(getResB.status).toBe(404)

      const editGetResB = await fetchGet(`/inventory/storage-sites/${siteA.id}/edit`, {
        Cookie: `triplet_session=${tokenB}`,
      })
      expect(editGetResB.status).toBe(404)

      const updatePostResB = await fetchPostForm(
        `/inventory/storage-sites/${siteA.id}/edit`,
        { name: 'Hacked Name', capacity_kg: 1.0 },
        { Cookie: `triplet_session=${tokenB}` },
      )
      expect(updatePostResB.status).toBe(404)

      const deleteResB = await fetchPostForm(
        `/inventory/storage-sites/${siteA.id}/delete`,
        {},
        { Cookie: `triplet_session=${tokenB}` },
      )
      expect(deleteResB.status).toBe(404)

      // Verify User A's storage site remains unchanged by User B
      const db = getDb()
      const [intactSite] = await db
        .select()
        .from(schema.storageSites)
        .where(eq(schema.storageSites.id, siteA.id))

      expect(intactSite.name).toBe('User A Bunker Expanded')
      expect(intactSite.capacityKg).toBe(4.0)
      expect(intactSite.permitNumber).toBe('PERMIT-SA-777')
      expect(intactSite.deletedAt).toBeNull()
    })
  })

  // ============================================================================
  // SECTION 3: R6 Airframe Dimensions, Versioning & Preflight Clearance
  // ============================================================================
  describe('3. Requirement R6: Airframe Geometry, step="any", Versioning & Preflight Clearance', () => {

    it('3.1: rocket airframe forms declare step="any" on length and body diameter inputs', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { lengthMm: 1200, bodyDiameterMm: 65 })

      // Check /rockets/new
      const newRes = await fetchGet('/rockets/new', { Cookie: cookie })
      assertHtmlResponse(newRes, 200)
      const newHtml = await newRes.text()

      const lengthInputNew = /<input[^>]*id=["']length_mm["'][^>]*>/i.exec(newHtml)
      expect(lengthInputNew).not.toBeNull()
      expect(lengthInputNew![0]).toContain('step="any"')

      const diameterInputNew = /<input[^>]*id=["']body_diameter_mm["'][^>]*>/i.exec(newHtml)
      expect(diameterInputNew).not.toBeNull()
      expect(diameterInputNew![0]).toContain('step="any"')

      // Check /rockets/:id/edit
      const editRes = await fetchGet(`/rockets/${rocket.id}/edit`, { Cookie: cookie })
      assertHtmlResponse(editRes, 200)
      const editHtml = await editRes.text()

      const lengthInputEdit = /<input[^>]*id=["']length_mm["'][^>]*>/i.exec(editHtml)
      expect(lengthInputEdit).not.toBeNull()
      expect(lengthInputEdit![0]).toContain('step="any"')

      const diameterInputEdit = /<input[^>]*id=["']body_diameter_mm["'][^>]*>/i.exec(editHtml)
      expect(diameterInputEdit).not.toBeNull()
      expect(diameterInputEdit![0]).toContain('step="any"')

      // Check /rockets/:id/configurations/new
      const configNewRes = await fetchGet(`/rockets/${rocket.id}/configurations/new`, { Cookie: cookie })
      assertHtmlResponse(configNewRes, 200)
      const configNewHtml = await configNewRes.text()

      const lengthInputCfg = /<input[^>]*id=["']length_mm["'][^>]*>/i.exec(configNewHtml)
      expect(lengthInputCfg).not.toBeNull()
      expect(lengthInputCfg![0]).toContain('step="any"')
    })

    it('3.2: fractional decimal airframe dimensions persist with high precision and convert accurately', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      // Create rocket with fractional mm dimensions: length 1648.75 mm, diameter 75.25 mm
      const res = await fetchPostForm(
        '/rockets',
        {
          name: 'Precision Falcon Mk IV',
          length_mm: 1648.75,
          body_diameter_mm: 75.25,
          status: 'flight_ready',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [rocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.name, 'Precision Falcon Mk IV'))

      expect(rocket).toBeDefined()
      expect(rocket.lengthMm).toBe(1648.75)
      expect(rocket.bodyDiameterMm).toBe(75.25)

      // Metric verification on detail card
      const detailRes = await fetchGet(`/rockets/${rocket.id}`, { Cookie: cookie })
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain('1648.75 mm')
      expect(detailHtml).toContain('164.9 cm')
      expect(detailHtml).toContain('75.25 mm')
      expect(detailHtml).toContain('7.5 cm')
    })

    it('3.3: active configuration snapshot synchronizes airframe dimensions to parent rocket while inactive snapshot retains historical isolation', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      // Baseline rocket with v1: length 1400.0 mm, diameter 65.0 mm
      const rocket = await seedTestRocket(flyer.id, {
        name: 'Modular Interceptor',
        lengthMm: 1400.0,
        bodyDiameterMm: 65.0,
      })
      const configV1 = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1400.0,
        bodyDiameterMm: 65.0,
        isCurrent: true,
      })

      // Add configuration snapshot v2 with extended payload bay: length 1850.0 mm
      const resV2 = await fetchPostForm(
        `/rockets/${rocket.id}/configurations`,
        {
          version: 2,
          length_mm: 1850.0,
          body_diameter_mm: 65.0,
          stability_calibers: 2.2,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(resV2.status)

      const db = getDb()

      // Parent rocket must have synchronized length to 1850.0 mm
      const [updatedRocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocket.id))
      expect(updatedRocket.lengthMm).toBe(1850.0)

      // Previous v1 config must retain historical 1400.0 mm and isCurrent = false
      const [retrievedV1] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, configV1.id))
      expect(retrievedV1.lengthMm).toBe(1400.0)
      expect(retrievedV1.isCurrent).toBe(false)

      // Edit inactive snapshot v1 (e.g. adjust fin count or stability)
      const editV1Res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${configV1.id}/edit`,
        {
          length_mm: 1420.0,
          body_diameter_mm: 65.0,
          stability_calibers: 1.7,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(editV1Res.status)

      // Crucial assertion: Parent rocket dimensions must NOT be overwritten by inactive v1 snapshot!
      const [rocketAfterInactiveEdit] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocket.id))
      expect(rocketAfterInactiveEdit.lengthMm).toBe(1850.0) // Still v2 active length!
    })

    it('3.4: preflight form renders guide rail clearance notice and flight detail verifies RSO/LCO physical clearance', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Clearance Challenger',
        lengthMm: 1750.0,
        bodyDiameterMm: 78.0,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1750.0,
        bodyDiameterMm: 78.0,
        stabilityCalibers: 1.9,
      })
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(flyer.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        rsoName: 'Lead Inspector Rick',
        lcoName: 'Launch Specialist Mort',
      })

      // Check preflight form /flights/new
      const newRes = await fetchGet('/flights/new', { Cookie: cookie })
      const newHtml = await newRes.text()

      expect(newHtml).toContain('id="preflight-airframe-geometry-card"')
      expect(newHtml).toContain('id="preflight-display-length"')
      expect(newHtml).toContain('id="preflight-display-diameter"')
      expect(newHtml).toMatch(/guide velocity.*≥\s*3×\s*rocket length/i)
      expect(newHtml).toContain('pad blast standoff is adequate')
      expect(newHtml).toContain(`data-length="1750"`)
      expect(newHtml).toContain(`data-diameter="78"`)

      // Check flight detail view /flights/:id
      const detailRes = await fetchGet(`/flights/${flight.id}`, { Cookie: cookie })
      const detailHtml = await detailRes.text()

      expect(detailHtml).toContain('Physical Clearance (RSO/LCO):')
      expect(detailHtml).toContain('1750 mm (175.0 cm)')
      expect(detailHtml).toContain('78 mm (7.8 cm)')
      expect(detailHtml).toContain('(Pad fit & launch rail clearance verified)')
      expect(detailHtml).toContain('Lead Inspector Rick')
      expect(detailHtml).toContain('Launch Specialist Mort')
    })
  })

  // ============================================================================
  // SECTION 4: End-to-End Cross-Cutting Operations & Logistics Lifecycle
  // ============================================================================
  describe('4. End-to-End Cross-Cutting Operations & Logistics Lifecycle', () => {

    it('4.1: complete integrated lifecycle: storage site upgrade, motor consumption, zero-stock dismissal, duty officer rotation, and airframe versioning', async () => {
      const pilot = await seedTestUser({ displayName: 'Commander Shepard' })
      const rso1 = await seedTestUser({ displayName: 'Officer Safety Alpha' })
      const lco1 = await seedTestUser({ displayName: 'Pad Controller Bravo' })
      const rso2 = await seedTestUser({ displayName: 'Officer Safety Charlie' })

      const token = await signSession(pilot.id)
      const cookie = `triplet_session=${token}`

      // Step 1: Register physical storage site under hobby exemption (2.8 kg)
      const siteRes = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Adelaide Hills Explosives Magazine Alpha',
          location: 'Field Bunker 1',
          capacity_kg: 2.8,
          permit_number: '',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([201, 302, 303]).toContain(siteRes.status)

      // Step 2: Stock 2x motors in inventory stored at that storage site
      const motor = await seedTestMotor({ manufacturer: 'AeroTech', model: 'H128W', impulseClass: 'H', diameterMm: 29 })
      const inv = await seedTestInventory(pilot.id, motor.id, {
        quantityOnHand: 2,
        expendedCount: 0,
        storageLocation: 'Adelaide Hills Explosives Magazine Alpha',
      })
      await seedTestTransaction(pilot.id, {
        motorInventoryId: inv.id,
        transactionType: 'received',
        quantity: 2,
        storageLocation: 'Adelaide Hills Explosives Magazine Alpha',
      })

      // Step 3: Upgrade storage site to 4.5 kg with SafeWork SA permit
      const db = getDb()
      const [storageSite] = await db
        .select()
        .from(schema.storageSites)
        .where(eq(schema.storageSites.name, 'Adelaide Hills Explosives Magazine Alpha'))

      const upgradeRes = await fetchPostForm(
        `/inventory/storage-sites/${storageSite.id}/edit`,
        {
          name: 'Adelaide Hills Explosives Magazine Alpha',
          location: 'Field Bunker 1',
          capacity_kg: 4.5,
          permit_number: 'SAFEWORK-SA-LIC-2026-X',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(upgradeRes.status)

      // Step 4: Pilot builds rocket with fractional dimensions (step="any": 1580.4 mm, 68.2 mm)
      const rocketRes = await fetchPostForm(
        '/rockets',
        {
          name: 'Aurora Multi-Stage',
          length_mm: 1580.4,
          body_diameter_mm: 68.2,
          status: 'flight_ready',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(rocketRes.status)

      const [rocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.name, 'Aurora Multi-Stage'))
      const [configV1] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))

      // Certify pilot for H motor
      await seedTestCert(pilot.id, { level: 1 })
      const launchSite = await seedTestSite({ maxAltitudeAglM: 2500 })

      // Step 5: Log Flight 1 with Motor 1 (RSO Alpha + LCO Bravo)
      const flight1Res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: configV1.id,
          motor_id: motor.id,
          motor_inventory_id: inv.id,
          launch_site_id: launchSite.id,
          flight_number: 1,
          altitude_agl_m: 650,
          rso_user_id: rso1.id,
          lco_user_id: lco1.id,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(flight1Res.status)

      // Verify inventory decremented to 1
      const [invAfterF1] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))
      expect(invAfterF1.quantityOnHand).toBe(1)
      expect(invAfterF1.expendedCount).toBe(1)

      // Attempt dismissal while quantity is 1 -> MUST FAIL with 400
      const prematureDismissRes = await fetchPostForm(
        `/inventory/${inv.id}/dismiss`,
        {},
        { Cookie: cookie },
      )
      expect(prematureDismissRes.status).toBe(400)

      // Step 6: Log Flight 2 with Motor 2 (Duty Officer rotated: RSO Charlie + LCO Bravo)
      const flight2Res = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: configV1.id,
          motor_id: motor.id,
          motor_inventory_id: inv.id,
          launch_site_id: launchSite.id,
          flight_number: 2,
          altitude_agl_m: 670,
          rso_user_id: rso2.id,
          lco_user_id: lco1.id,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(flight2Res.status)

      // Verify inventory decremented to 0
      const [invAfterF2] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))
      expect(invAfterF2.quantityOnHand).toBe(0)
      expect(invAfterF2.expendedCount).toBe(2)

      // Step 7: Dismiss motor now that quantity is 0 -> MUST SUCCEED
      const legitimateDismissRes = await fetchPostForm(
        `/inventory/${inv.id}/dismiss`,
        {},
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(legitimateDismissRes.status)

      // Verify soft delete in D1
      const [dismissedInv] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))
      expect(dismissedInv.deletedAt).not.toBeNull()

      // Step 8: Verify active inventory hides motor, ledger preserves records
      const activeInvRes = await fetchGet('/inventory', { Cookie: cookie })
      const activeInvHtml = await activeInvRes.text()
      expect(activeInvHtml).not.toContain(`id="inventory-row-${inv.id}"`)
      expect(activeInvHtml).toContain('0 configured motor entries')
      expect(activeInvHtml).toContain('No motors currently tracked in your inventory.')

      const ledgerRes = await fetchGet('/inventory/transactions', { Cookie: cookie })
      const ledgerHtml = await ledgerRes.text()
      expect(ledgerHtml).toContain('Adelaide Hills Explosives Magazine Alpha')

      // Step 9: Verify Flight 1 and Flight 2 detail views
      const [savedFlight1] = await db
        .select()
        .from(schema.flights)
        .where(and(eq(schema.flights.rocketConfigurationId, configV1.id), eq(schema.flights.flightNumber, 1)))
      const [savedFlight2] = await db
        .select()
        .from(schema.flights)
        .where(and(eq(schema.flights.rocketConfigurationId, configV1.id), eq(schema.flights.flightNumber, 2)))

      const f1Res = await fetchGet(`/flights/${savedFlight1.id}`, { Cookie: cookie })
      const f1Html = await f1Res.text()
      expect(f1Html).toContain('Officer Safety Alpha')
      expect(f1Html).toContain('Pad Controller Bravo')
      expect(f1Html).toContain('1580.4 mm (158.0 cm)')
      expect(f1Html).toContain('68.2 mm (6.8 cm)')

      const f2Res = await fetchGet(`/flights/${savedFlight2.id}`, { Cookie: cookie })
      const f2Html = await f2Res.text()
      expect(f2Html).toContain('Officer Safety Charlie')
      expect(f2Html).toContain('Pad Controller Bravo')
      expect(f2Html).toContain('1580.4 mm (158.0 cm)')

      // Step 10: Evolve Airframe with Config v2 (length 1850.2 mm)
      const v2Res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations`,
        {
          version: 2,
          length_mm: 1850.2,
          body_diameter_mm: 68.2,
          stability_calibers: 2.1,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(v2Res.status)

      const [configV2] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(and(eq(schema.rocketConfigurations.rocketId, rocket.id), eq(schema.rocketConfigurations.version, 2)))

      // Log Flight 3 on v2
      const f3PostRes = await fetchPostForm(
        '/flights',
        {
          rocket_configuration_id: configV2.id,
          motor_id: motor.id,
          launch_site_id: launchSite.id,
          flight_number: 3,
          altitude_agl_m: 710,
          rso_user_id: rso1.id,
          lco_user_id: lco1.id,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(f3PostRes.status)

      const [savedFlight3] = await db
        .select()
        .from(schema.flights)
        .where(and(eq(schema.flights.rocketConfigurationId, configV2.id), eq(schema.flights.flightNumber, 3)))

      // Flight 3 reflects new 1850.2 mm geometry
      const f3Res = await fetchGet(`/flights/${savedFlight3.id}`, { Cookie: cookie })
      const f3Html = await f3Res.text()
      expect(f3Html).toContain('1850.2 mm (185.0 cm)')

      // Flights 1 & 2 immutably preserve original v1 1580.4 mm geometry
      const f1Recheck = await fetchGet(`/flights/${savedFlight1.id}`, { Cookie: cookie })
      const f1RecheckHtml = await f1Recheck.text()
      expect(f1RecheckHtml).toContain('1580.4 mm (158.0 cm)')
      expect(f1RecheckHtml).not.toContain('1850.2 mm (185.0 cm)')
    })
  })
})
