/**
 * Adversarial Challenger Test Suite for Milestone 3:
 * Reload Motor Casings & Hardware Tracking (R3)
 *
 * Focus areas:
 * 1. Search by casing name with slashes and hyphens (RMS-29/40-120, 29/40-120, Pro38) in catalog query (?q= and ?search=)
 * 2. Case-insensitive search behavior (lowercase, uppercase, mixed case, and client-side data-search)
 * 3. Display rendering when hardware is null, empty string, or whitespace (clean fallback, no "undefined", no broken HTML)
 * 4. XSS injection attempts in hardware strings (<script>alert('casing')</script>, "><img src=x onerror=alert(1)>)
 * 5. Flight detail view Propulsion Metrics display when flight has no motor or motor has no hardware
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  seedTestConfig,
  seedTestFlight,
  seedTestInventory,
  seedTestMotor,
  seedTestRocket,
  seedTestUser,
  truncateDb,
} from '../helpers/db'
import {
  assertContains,
  assertHtmlResponse,
  assertNotContains,
} from '../helpers/html'
import { fetchGet, fetchHtmxPostForm } from '../helpers/http'

beforeEach(truncateDb)

describe('Adversarial Challenger M3: Motor Casing Search & Display', () => {
  // =========================================================================
  // 1. Casing Search with Slashes, Hyphens, and Query Parameters (?q= and ?search=)
  // =========================================================================
  describe('1. Casing Search: Slashes, Hyphens & Query Parameters', () => {
    it('supports searching by casing name with hyphens and slashes using query parameter ?q=', async () => {
      const motorA = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'RMS-29/40-120-E16',
        impulseClass: 'E',
        hardware: 'RMS-29/40-120',
        casingReusable: true,
      })
      const motorB = await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'Pro38-3G-H153',
        impulseClass: 'H',
        hardware: 'Pro38 3G',
        casingReusable: true,
      })
      const motorC = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'RMS-38/720-J350',
        impulseClass: 'J',
        hardware: 'RMS-38/720',
        casingReusable: true,
      })

      // Query ?q=RMS-29/40-120 should match Motor A and exclude Motor B and C
      const res = await fetchGet('/motors?q=RMS-29/40-120')
      expect(res.status).toBe(200)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'RMS-29/40-120-E16', 'RMS-29/40-120')
      assertNotContains(html, 'Pro38-3G-H153')
      assertNotContains(html, 'RMS-38/720-J350')
    })

    it('supports partial casing name with slash and hyphen (e.g. ?q=29/40-120)', async () => {
      await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'RMS-29/40-120-E16',
        impulseClass: 'E',
        hardware: 'RMS-29/40-120',
        casingReusable: true,
      })
      await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'Pro38-3G-H153',
        impulseClass: 'H',
        hardware: 'Pro38 3G',
        casingReusable: true,
      })

      const res = await fetchGet('/motors?q=29/40-120')
      expect(res.status).toBe(200)
      const html = await res.text()

      assertContains(html, 'RMS-29/40-120-E16')
      assertNotContains(html, 'Pro38-3G-H153')
    })

    it('supports searching by brand hardware prefix (e.g. ?q=Pro38)', async () => {
      await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'RMS-29/40-120-E16',
        impulseClass: 'E',
        hardware: 'RMS-29/40-120',
        casingReusable: true,
      })
      await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'Pro38-3G-H153',
        impulseClass: 'H',
        hardware: 'Pro38 3G',
        casingReusable: true,
      })

      const res = await fetchGet('/motors?q=Pro38')
      expect(res.status).toBe(200)
      const html = await res.text()

      assertContains(html, 'Pro38-3G-H153', 'Pro38 3G')
      assertNotContains(html, 'RMS-29/40-120-E16')
    })

    it('handles URL-encoded slash in casing search (?q=RMS-29%2F40-120)', async () => {
      await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'RMS-29/40-120-E16',
        impulseClass: 'E',
        hardware: 'RMS-29/40-120',
        casingReusable: true,
      })
      await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'Pro38-3G-H153',
        impulseClass: 'H',
        hardware: 'Pro38 3G',
        casingReusable: true,
      })

      const res = await fetchGet('/motors?q=RMS-29%2F40-120')
      expect(res.status).toBe(200)
      const html = await res.text()

      assertContains(html, 'RMS-29/40-120-E16')
      assertNotContains(html, 'Pro38-3G-H153')
    })

    it('supports casing search via ?search= parameter as alias', async () => {
      await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'RMS-29/40-120-E16',
        impulseClass: 'E',
        hardware: 'RMS-29/40-120',
        casingReusable: true,
      })
      await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'Pro38-3G-H153',
        impulseClass: 'H',
        hardware: 'Pro38 3G',
        casingReusable: true,
      })

      const res = await fetchGet('/motors?search=RMS-29/40-120')
      expect(res.status).toBe(200)
      const html = await res.text()

      assertContains(html, 'RMS-29/40-120-E16')
      assertNotContains(html, 'Pro38-3G-H153')
    })
  })

  // =========================================================================
  // 2. Case-Insensitive Casing Search Behavior
  // =========================================================================
  describe('2. Case-Insensitive Search Behavior', () => {
    it('matches lowercase query "rms-29/40-120" against uppercase DB hardware', async () => {
      await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'RMS-29/40-120-E16',
        impulseClass: 'E',
        hardware: 'RMS-29/40-120',
        casingReusable: true,
      })
      await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'Pro38-3G-H153',
        impulseClass: 'H',
        hardware: 'Pro38 3G',
        casingReusable: true,
      })

      const res = await fetchGet('/motors?search=rms-29/40-120')
      expect(res.status).toBe(200)
      const html = await res.text()

      assertContains(html, 'RMS-29/40-120-E16')
      assertNotContains(html, 'Pro38-3G-H153')
    })

    it('matches mixed-case query "rMs-29/40-120" against uppercase DB hardware', async () => {
      await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'RMS-29/40-120-E16',
        impulseClass: 'E',
        hardware: 'RMS-29/40-120',
        casingReusable: true,
      })
      await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'Pro38-3G-H153',
        impulseClass: 'H',
        hardware: 'Pro38 3G',
        casingReusable: true,
      })

      const res = await fetchGet('/motors?search=rMs-29/40-120')
      expect(res.status).toBe(200)
      const html = await res.text()

      assertContains(html, 'RMS-29/40-120-E16')
      assertNotContains(html, 'Pro38-3G-H153')
    })

    it('matches lowercase query "pro38" against PascalCase DB hardware', async () => {
      await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'Pro38-3G-H153',
        impulseClass: 'H',
        hardware: 'Pro38 3G',
        casingReusable: true,
      })
      await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'RMS-29/40-120-E16',
        impulseClass: 'E',
        hardware: 'RMS-29/40-120',
        casingReusable: true,
      })

      const res = await fetchGet('/motors?search=pro38')
      expect(res.status).toBe(200)
      const html = await res.text()

      assertContains(html, 'Pro38-3G-H153')
      assertNotContains(html, 'RMS-29/40-120-E16')
    })

    it('populates client-side data-search attribute with lowercased hardware for instant JS filtering', async () => {
      await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'RMS-29/40-120-E16',
        impulseClass: 'E',
        hardware: 'RMS-29/40-120',
        casingReusable: true,
      })

      const res = await fetchGet('/motors')
      expect(res.status).toBe(200)
      const html = await res.text()

      // The table row must have data-search attribute containing the lowercased casing
      expect(html).toContain('data-search=')
      expect(html).toContain('rms-29/40-120')
    })
  })

  // =========================================================================
  // 3. Display Rendering Fallbacks: Null, Empty String, and Whitespace
  // =========================================================================
  describe('3. Display Rendering Fallbacks: Null, Empty String & Whitespace', () => {
    it('renders clean fallback for reloadable motor with hardware: null', async () => {
      const user = await seedTestUser({ displayName: 'Tester Null' })
      const motor = await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'Pro29-UnsetHardware',
        impulseClass: 'G',
        hardware: null,
        casingReusable: true,
      })
      await seedTestInventory(user.id, motor.id, { quantityOnHand: 2 })

      // 1. Catalog listing
      const catRes = await fetchGet('/motors')
      const catHtml = await catRes.text()
      assertContains(catHtml, 'Pro29-UnsetHardware', 'Reloadable')
      expect(catHtml).not.toContain('undefined')
      expect(catHtml).not.toContain('Casing: null')

      // 2. Detail view
      const detailRes = await fetchGet(`/motors/${motor.id}`)
      const detailHtml = await detailRes.text()
      assertContains(detailHtml, 'Reloadable Casing')
      expect(detailHtml).not.toContain('undefined')
      expect(detailHtml).not.toContain('Hardware: null')

      // 3. Inventory view
      const invRes = await fetchGet('/inventory')
      const invHtml = await invRes.text()
      assertContains(invHtml, 'Pro29-UnsetHardware', 'Reloadable')
      expect(invHtml).not.toContain('undefined')
      expect(invHtml).not.toContain('Casing: null')
    })

    it('renders clean fallback for single-use motor with hardware: null', async () => {
      const user = await seedTestUser({ displayName: 'Tester SU' })
      const motor = await seedTestMotor({
        manufacturer: 'Estes',
        model: 'C6-5-SingleUse',
        impulseClass: 'C',
        hardware: null,
        casingReusable: false,
      })
      await seedTestInventory(user.id, motor.id, { quantityOnHand: 5 })

      // 1. Catalog listing
      const catRes = await fetchGet('/motors')
      const catHtml = await catRes.text()
      assertContains(catHtml, 'C6-5-SingleUse', 'Single-Use')
      expect(catHtml).not.toContain('undefined')

      // 2. Detail view
      const detailRes = await fetchGet(`/motors/${motor.id}`)
      const detailHtml = await detailRes.text()
      assertContains(detailHtml, 'Single-Use')
      expect(detailHtml).not.toContain('undefined')

      // 3. Inventory view
      const invRes = await fetchGet('/inventory')
      const invHtml = await invRes.text()
      assertContains(invHtml, 'C6-5-SingleUse', 'Single-Use')
      expect(invHtml).not.toContain('undefined')
    })

    it('renders clean fallback when hardware is empty string ""', async () => {
      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'EmptyCasing-G76',
        impulseClass: 'G',
        hardware: '',
        casingReusable: true,
      })

      const detailRes = await fetchGet(`/motors/${motor.id}`)
      const detailHtml = await detailRes.text()
      assertContains(detailHtml, 'Reloadable Casing')
      expect(detailHtml).not.toContain('undefined')

      const catRes = await fetchGet('/motors')
      const catHtml = await catRes.text()
      assertContains(catHtml, 'EmptyCasing-G76', 'Reloadable')
      expect(catHtml).not.toContain('undefined')
    })

    it('resiliently handles whitespace-only hardware string "   "', async () => {
      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'SpaceCasing-F52',
        impulseClass: 'F',
        hardware: '   ',
        casingReusable: true,
      })

      const detailRes = await fetchGet(`/motors/${motor.id}`)
      expect(detailRes.status).toBe(200)
      const detailHtml = await detailRes.text()
      // Verify no "undefined", no crashes, no broken tags
      expect(detailHtml).not.toContain('undefined')
      expect(detailHtml).not.toContain('NaN')

      const catRes = await fetchGet('/motors')
      expect(catRes.status).toBe(200)
      const catHtml = await catRes.text()
      expect(catHtml).not.toContain('undefined')
    })

    it('handles HTMX partial row fragment when inventory motor has null hardware', async () => {
      const user = await seedTestUser({ displayName: 'HTMX Tester' })
      const motor = await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'Pro54-6G-K',
        impulseClass: 'K',
        hardware: null,
        casingReusable: true,
      })
      const inventory = await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 1,
        expendedCount: 0,
      })

      const res = await fetchHtmxPostForm(`/inventory/${inventory.id}/adjust`, {
        action: 'increment',
        delta: 1,
      })
      expect(res.status).toBe(200)
      const fragment = await res.text()

      assertContains(fragment, 'Casing:', 'Reloadable')
      expect(fragment).not.toContain('undefined')
    })
  })

  // =========================================================================
  // 4. XSS Injection Attempts in Hardware Strings
  // =========================================================================
  describe('4. XSS Injection Resistance in Hardware Specifications', () => {
    it('escapes HTML script tags in motor hardware string across catalog, detail, and inventory', async () => {
      const xssScript = "<script>alert('casing')</script>"
      const user = await seedTestUser({ displayName: 'Security Auditor' })
      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'XSS-Motor-1',
        impulseClass: 'H',
        hardware: xssScript,
        casingReusable: true,
      })
      await seedTestInventory(user.id, motor.id, { quantityOnHand: 1 })

      // 1. Catalog view: table row and data-search attribute
      const catRes = await fetchGet('/motors')
      const catHtml = await catRes.text()
      expect(catHtml).not.toContain('<script>alert(')
      // Must be safely escaped
      expect(catHtml).toContain('&lt;script&gt;alert(')

      // 2. Motor Detail view: header banner and specifications dl
      const detailRes = await fetchGet(`/motors/${motor.id}`)
      const detailHtml = await detailRes.text()
      expect(detailHtml).not.toContain('<script>alert(')
      expect(detailHtml).toContain('&lt;script&gt;alert(')

      // 3. Inventory view: casing span
      const invRes = await fetchGet('/inventory')
      const invHtml = await invRes.text()
      expect(invHtml).not.toContain('<script>alert(')
      expect(invHtml).toContain('&lt;script&gt;alert(')
    })

    it('escapes attribute-breaking quotes and event handlers in hardware string', async () => {
      const xssAttr = '"><img src=x onerror=alert(1)>'
      const user = await seedTestUser({ displayName: 'Pen Tester' })
      const motor = await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'XSS-Attr-Motor',
        impulseClass: 'I',
        hardware: xssAttr,
        casingReusable: true,
      })
      const inventory = await seedTestInventory(user.id, motor.id, { quantityOnHand: 2 })

      // 1. Catalog view
      const catRes = await fetchGet('/motors')
      const catHtml = await catRes.text()
      expect(catHtml).not.toContain('<img src=x onerror=alert(1)>')

      // 2. Detail view
      const detailRes = await fetchGet(`/motors/${motor.id}`)
      const detailHtml = await detailRes.text()
      expect(detailHtml).not.toContain('<img src=x onerror=alert(1)>')

      // 3. HTMX inventory adjustment fragment
      const htmxRes = await fetchHtmxPostForm(`/inventory/${inventory.id}/adjust`, {
        action: 'increment',
        delta: 1,
      })
      const fragment = await htmxRes.text()
      expect(fragment).not.toContain('<img src=x onerror=alert(1)>')
    })

    it('safely handles SQL meta-characters in hardware string without SQL error or injection', async () => {
      const sqlInjection = "RMS-29' OR '1'='1"
      await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'SQL-Inject-Motor',
        impulseClass: 'G',
        hardware: sqlInjection,
        casingReusable: true,
      })

      // Search using the SQL injection payload via ?search=
      const res = await fetchGet(`/motors?search=${encodeURIComponent(sqlInjection)}`)
      expect(res.status).toBe(200)
      const html = await res.text()
      assertContains(html, 'SQL-Inject-Motor')
    })
  })

  // =========================================================================
  // 5. Flight Detail View: Propulsion Metrics Display Edge Cases
  // =========================================================================
  describe('5. Flight Detail View: Propulsion Metrics Display', () => {
    it('renders clean fallback in Propulsion Metrics when flight has NO motor (motorId: null)', async () => {
      const user = await seedTestUser({ displayName: 'Glider Pilot' })
      const rocket = await seedTestRocket(user.id, { name: 'Glider One' })
      const config = await seedTestConfig(rocket.id, { version: 1 })

      // Flight logged without motor (e.g. unpowered drop test / simulator placeholder)
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: null,
        flightNumber: 201,
      })

      const res = await fetchGet(`/flights/${flight.id}`)
      expect(res.status).toBe(200)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Card 3 Propulsion Metrics should be present
      assertContains(html, 'Propulsion Metrics')
      assertContains(html, 'Motor Model')
      assertContains(html, 'Required Casing / Hardware')

      // Motor model and hardware should fall back to '—'
      expect(html).not.toContain('undefined')
      expect(html).not.toContain('null')
      expect(html).not.toContain('NaN')
    })

    it('renders "Single-Use" when flight motor has hardware: null and casingReusable: false', async () => {
      const user = await seedTestUser({ displayName: 'Single Use Flyer' })
      const rocket = await seedTestRocket(user.id, { name: 'Estes Alpha' })
      const config = await seedTestConfig(rocket.id, { version: 1 })
      const motor = await seedTestMotor({
        manufacturer: 'Estes',
        model: 'B6-4',
        impulseClass: 'B',
        hardware: null,
        casingReusable: false,
      })

      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        flightNumber: 202,
      })

      const res = await fetchGet(`/flights/${flight.id}`)
      expect(res.status).toBe(200)
      const html = await res.text()

      assertContains(html, 'Propulsion Metrics')
      assertContains(html, 'Required Casing / Hardware')
      assertContains(html, 'Single-Use')
      expect(html).not.toContain('undefined')
    })

    it('renders "Reloadable Casing" when flight motor has hardware: null and casingReusable: true', async () => {
      const user = await seedTestUser({ displayName: 'Reloadable Flyer' })
      const rocket = await seedTestRocket(user.id, { name: 'High Altitude Pro' })
      const config = await seedTestConfig(rocket.id, { version: 1 })
      const motor = await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'Pro29-Generic-H',
        impulseClass: 'H',
        hardware: null,
        casingReusable: true,
      })

      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        flightNumber: 203,
      })

      const res = await fetchGet(`/flights/${flight.id}`)
      expect(res.status).toBe(200)
      const html = await res.text()

      assertContains(html, 'Propulsion Metrics')
      assertContains(html, 'Required Casing / Hardware')
      assertContains(html, 'Reloadable Casing')
      expect(html).not.toContain('undefined')
    })

    it('renders exact casing name and escapes XSS in flight detail Propulsion Metrics', async () => {
      const xssCasing = '<script>alert("flight-casing")</script>'
      const user = await seedTestUser({ displayName: 'Flight Security Tester' })
      const rocket = await seedTestRocket(user.id, { name: 'Cyber Rocket' })
      const config = await seedTestConfig(rocket.id, { version: 1 })
      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'RMS-38/720-J350',
        impulseClass: 'J',
        hardware: xssCasing,
        casingReusable: true,
      })

      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        flightNumber: 204,
      })

      const res = await fetchGet(`/flights/${flight.id}`)
      expect(res.status).toBe(200)
      const html = await res.text()

      assertContains(html, 'Propulsion Metrics')
      assertContains(html, 'Required Casing / Hardware')
      expect(html).not.toContain('<script>alert("flight-casing")</script>')
      expect(html).toContain('&lt;script&gt;alert(')
    })
  })
})
