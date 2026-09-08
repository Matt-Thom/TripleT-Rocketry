/**
 * Adversarial Challenger 2 Test Suite for Milestone 3 (Requirement R3):
 * Reload Motor Casings & Hardware Tracking — Inventory Projections & CSV Import Integrity.
 *
 * Scopes:
 * 1. 20-Column Motor CSV Import Integrity:
 *    - AeroTech & Cesaroni reloadable hardware ingestion into motors.hardware.
 *    - RFC 4180 quoted strings with commas and spaces.
 *    - Single-use indicators ("Single Use", "SU") setting casingReusable: false.
 *    - Upsert / conflict resolution updating motors.hardware.
 *    - Batch import stress.
 * 2. Motor Inventory Casing Projections:
 *    - GET /inventory renders motor.hardware accurately.
 *    - Fallback handling for unspecified reloadable and single-use motors.
 *    - Coexistence of motor reload hardware requirements with physical component casings.
 *    - Query filtering (?filter=motors, ?filter=casing, ?filter=all).
 * 3. Stock Adjustments & Count Updates:
 *    - Inline HTMX adjustments (increment, decrement, expend, restore) preserving casing in row fragment.
 *    - GET fallback /inventory/:id/adjust preserving casing.
 *    - Multi-cycle sequential adjustments preserving DB link and hardware projection.
 *    - Adding stock via POST /inventory preserving casing projection.
 * 4. Multiple Inventory Items & Multi-Reload Consistency:
 *    - Multiple lots/locations for the same reload motor displaying consistent casing.
 *    - Multi-user isolation for shared reload models.
 *    - Distinct motors sharing the same casing hardware (e.g. RMS-29/40-120).
 *    - Stock mutation isolation between items sharing hardware.
 * 5. End-to-End Pipeline:
 *    - CSV Ingestion -> Inventory Stocking -> Lifecycle Adjustments -> Hub Display.
 */

import { env } from 'cloudflare:test'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import { signSession } from '../../src/services/auth'
import {
  getDb,
  seedTestComponent,
  seedTestInventory,
  seedTestMotor,
  seedTestUser,
  truncateDb,
} from '../helpers/db'
import {
  assertContains,
  assertHtmlResponse,
  assertNotContains,
} from '../helpers/html'
import {
  fetchGet,
  fetchHtmxGet,
  fetchHtmxPostForm,
  fetchPostForm,
} from '../helpers/http'

beforeEach(truncateDb)

const CSV_HEADER =
  'Part_Number,Designation_Product_Name,Manufacturer,Diameter_mm,Hardware,Total_Impulse_Ns,Avg_Thrust_N,Peak_Thrust_N,Propellant_Type,Grains,Propellant_Weight_g,Grain_Weight_g,Total_Weight_g,UN_Number,Classification,Length,Thrust_Duration_Sec,Delay_Sec,USPS_Mailable,Notes'

describe('Challenger 2 M3: Motor Inventory Casing Projections & CSV Import Integrity', () => {
  // =========================================================================
  // TIER 1: 20-Column Motor CSV Import Integrity (AeroTech & Cesaroni)
  // =========================================================================
  describe('Tier 1: Motor Product CSV Import Integrity', () => {
    it('1.1: imports AeroTech reloadable motor and populates motors.hardware and casingReusable', async () => {
      const csvData = [
        CSV_HEADER,
        'AT-E16,E16W-4,AeroTech,29,RMS-29/40-120,38.0,16.0,32.0,White Lightning,1,18.0,18.0,65.0,UN0432,1.4C,85,2.4,4,true,Popular 29mm hobby reload',
      ].join('\n')

      const res = await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [motor] = await db
        .select()
        .from(schema.motors)
        .where(and(eq(schema.motors.model, 'E16W-4'), eq(schema.motors.manufacturer, 'AeroTech')))

      expect(motor).toBeDefined()
      expect(motor.hardware).toBe('RMS-29/40-120')
      expect(motor.casingReusable).toBe(true)
      expect(motor.impulseClass).toBe('E')
    })

    it('1.2: imports Cesaroni ProX reloadable motor and populates motors.hardware reliably', async () => {
      const csvData = [
        CSV_HEADER,
        'CTI-153H153,H153-14A,Cesaroni,38,Pro38 3G,245.0,153.0,210.0,Classic,3,115.0,38.3,270.0,UN0432,1.4C,180,1.6,14,true,Standard 38mm 3-grain reload',
      ].join('\n')

      const res = await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [motor] = await db
        .select()
        .from(schema.motors)
        .where(and(eq(schema.motors.model, 'H153-14A'), eq(schema.motors.manufacturer, 'Cesaroni')))

      expect(motor).toBeDefined()
      expect(motor.hardware).toBe('Pro38 3G')
      expect(motor.casingReusable).toBe(true)
      expect(motor.impulseClass).toBe('H')
    })

    it('1.3: preserves quoted hardware strings with embedded commas (RFC 4180)', async () => {
      const csvData = [
        CSV_HEADER,
        '"AT-G64","G64W-4","AeroTech",29,"RMS-29/40-120, 29/100",100.0,64.0,110.0,"APCP White Lightning",2,50.0,25.0,115.0,"UN0432","1.4C",124,1.6,4,true,"Compatible with multiple 29mm casings"',
      ].join('\n')

      const res = await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [motor] = await db
        .select()
        .from(schema.motors)
        .where(and(eq(schema.motors.model, 'G64W-4'), eq(schema.motors.manufacturer, 'AeroTech')))

      expect(motor).toBeDefined()
      expect(motor.hardware).toBe('RMS-29/40-120, 29/100')
      expect(motor.casingReusable).toBe(true)
      expect(motor.propellantType).toBe('apcp')
    })

    it('1.4: recognizes single-use designations and sets casingReusable to false', async () => {
      const csvData = [
        CSV_HEADER,
        'EST-D12,D12-5,Estes,24,Single Use,20.0,12.0,28.0,Black Powder,1,25.0,25.0,45.0,UN0432,1.4S,70,1.6,5,true,Model Rocket Single Use',
        'AT-G80,G80-7T,AeroTech,29,SU,120.0,80.0,130.0,Blue Streak,2,60.0,30.0,125.0,UN0432,1.4C,124,1.5,7,true,Single Use Composite',
      ].join('\n')

      await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })

      const db = getDb()
      const [d12] = await db.select().from(schema.motors).where(eq(schema.motors.model, 'D12-5'))
      const [g80] = await db.select().from(schema.motors).where(eq(schema.motors.model, 'G80-7T'))

      expect(d12).toBeDefined()
      expect(d12.hardware).toBe('Single Use')
      expect(d12.casingReusable).toBe(false)

      expect(g80).toBeDefined()
      expect(g80.hardware).toBe('SU')
      expect(g80.casingReusable).toBe(false)
    })

    it('1.5: handles empty or null hardware column gracefully with casingReusable: false', async () => {
      const csvData = [
        CSV_HEADER,
        'EST-B6,B6-4,Estes,18,,5.0,6.0,12.0,Black Powder,1,6.0,6.0,18.0,UN0432,1.4S,70,0.8,4,true,No hardware specified',
      ].join('\n')

      await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })

      const db = getDb()
      const [b6] = await db.select().from(schema.motors).where(eq(schema.motors.model, 'B6-4'))

      expect(b6).toBeDefined()
      expect(b6.hardware).toBeNull()
      expect(b6.casingReusable).toBe(false)
    })

    it('1.6: updates existing motor hardware on re-import conflict resolution', async () => {
      // First import with generic casing
      const row1 = `${CSV_HEADER}\nAT-J350,J350W-14A,AeroTech,38,RMS-38/600,720.0,350.0,490.0,APCP,4,350.0,87.5,620.0,UN0432,1.4C,320,2.06,14,false,Initial casing spec`
      await fetchPostForm('/motors/import', { csv_data: row1 }, {}, { redirect: 'manual' })

      const db = getDb()
      const [initial] = await db.select().from(schema.motors).where(eq(schema.motors.model, 'J350W-14A'))
      expect(initial.hardware).toBe('RMS-38/600')

      // Second import correcting hardware to RMS-38/720
      const row2 = `${CSV_HEADER}\nAT-J350,J350W-14A,AeroTech,38,RMS-38/720,720.0,350.0,490.0,APCP,4,350.0,87.5,620.0,UN0432,1.4C,320,2.06,14,false,Corrected casing spec`
      const res2 = await fetchPostForm('/motors/import', { csv_data: row2 }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res2.status)

      const motors = await db.select().from(schema.motors).where(eq(schema.motors.model, 'J350W-14A'))
      expect(motors).toHaveLength(1)
      expect(motors[0].hardware).toBe('RMS-38/720')
    })

    it('1.7: imports mixed batch of AeroTech and Cesaroni motors preserving hardware across all records', async () => {
      const rows = [
        CSV_HEADER,
        'AT-1,H128W-14A,AeroTech,29,RMS-29/180,240,128,175,APCP,3,98.5,32.8,195,UN0432,1.4C,180,1.88,14,true,AT L1',
        'AT-2,I200W-14A,AeroTech,38,RMS-38/360,400,200,310,APCP,3,180,60,350,UN0432,1.4C,240,2.0,14,false,AT I',
        'CTI-1,H120-14A,Cesaroni,29,Pro29 3G,205,120,165,APCP,3,92,30.6,180,UN0432,1.4C,155,1.7,14,true,CTI H',
        'CTI-2,I212SS-15A,Cesaroni,38,Pro38 4G,420,212,290,APCP,4,195,48.7,390,UN0432,1.4C,220,1.98,15,false,CTI I',
        'CTI-3,K740-17A,Cesaroni,54,Pro54 6G,1850,740,1050,APCP,6,820,136.6,1650,UN0432,1.4C,430,2.5,17,false,CTI K',
        'CTI-4,L1000-18A,Cesaroni,75,Pro75 4G,3800,1000,1450,APCP,4,1750,437.5,3400,UN0432,1.4C,560,3.8,18,false,CTI L',
      ].join('\n')

      const res = await fetchPostForm('/motors/import', { csv_data: rows }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const all = await db.select().from(schema.motors)
      expect(all.length).toBeGreaterThanOrEqual(6)

      const hardwareMap = new Map(all.map((m) => [m.model, m.hardware]))
      expect(hardwareMap.get('H128W-14A')).toBe('RMS-29/180')
      expect(hardwareMap.get('I200W-14A')).toBe('RMS-38/360')
      expect(hardwareMap.get('H120-14A')).toBe('Pro29 3G')
      expect(hardwareMap.get('I212SS-15A')).toBe('Pro38 4G')
      expect(hardwareMap.get('K740-17A')).toBe('Pro54 6G')
      expect(hardwareMap.get('L1000-18A')).toBe('Pro75 4G')
    })
  })

  // =========================================================================
  // TIER 2: Motor Inventory Casing Projections (GET /inventory & View Components)
  // =========================================================================
  describe('Tier 2: Motor Inventory Casing Projections', () => {
    it('2.1: projects and renders motor.hardware accurately on GET /inventory for AeroTech and Cesaroni', async () => {
      const user = await seedTestUser({ displayName: 'Hardware Pilot' })

      const motorAT = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'G64W-4',
        impulseClass: 'G',
        hardware: 'RMS-29/40-120',
        casingReusable: true,
      })
      const motorCTI = await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'H153-14A',
        impulseClass: 'H',
        hardware: 'Pro38 3G',
        casingReusable: true,
      })

      await seedTestInventory(user.id, motorAT.id, { quantityOnHand: 4 })
      await seedTestInventory(user.id, motorCTI.id, { quantityOnHand: 2 })

      const res = await fetchGet('/inventory')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // AeroTech assertions
      assertContains(html, 'AeroTech', 'G64W-4', 'RMS-29/40-120')
      // Cesaroni assertions
      assertContains(html, 'Cesaroni', 'H153-14A', 'Pro38 3G')
      // Casing labels present
      assertContains(html, 'Casing:')
    })

    it('2.2: falls back to Reloadable when motor is reloadable but hardware is null', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'F20W-4',
        impulseClass: 'F',
        hardware: null,
        casingReusable: true,
      })
      await seedTestInventory(user.id, motor.id, { quantityOnHand: 3 })

      const res = await fetchGet('/inventory')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'F20W-4', 'Casing:', 'Reloadable')
    })

    it('2.3: displays Single-Use when motor casingReusable is false', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({
        manufacturer: 'Estes',
        model: 'E12-4',
        impulseClass: 'E',
        hardware: null,
        casingReusable: false,
      })
      await seedTestInventory(user.id, motor.id, { quantityOnHand: 6 })

      const res = await fetchGet('/inventory')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'E12-4', 'Casing:', 'Single-Use')
    })

    it('2.4: coexists cleanly with physical casing components in the unified inventory hub', async () => {
      const user = await seedTestUser()

      // 1. Seed reloadable motor reload requiring RMS-29/40-120
      const reload = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'E16W-4',
        impulseClass: 'E',
        hardware: 'RMS-29/40-120',
        casingReusable: true,
      })
      await seedTestInventory(user.id, reload.id, { quantityOnHand: 3 })

      // 2. Seed physical casing hardware component in schema.components
      await seedTestComponent(user.id, {
        name: 'AeroTech RMS-29/40-120 Casing Set',
        category: 'casing',
        manufacturer: 'AeroTech',
        partNumber: '91291',
        quantityOnHand: 1,
        condition: 'good',
        storageLocation: 'Range Range Box Casing Tube',
      })

      const res = await fetchGet('/inventory')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Both sections render cleanly
      assertContains(html, 'Rocket Motors & Propellant')
      assertContains(html, 'Rocket Components & Hardware')

      // Motor section specifies required casing
      assertContains(html, 'E16W-4', 'Casing:', 'RMS-29/40-120')

      // Component section lists physical hardware asset
      assertContains(html, 'AeroTech RMS-29/40-120 Casing Set', '91291')
    })

    it('2.5: filters inventory appropriately by category query parameter', async () => {
      const user = await seedTestUser()

      const motor = await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'Pro38-H153',
        hardware: 'Pro38 3G',
        casingReusable: true,
      })
      await seedTestInventory(user.id, motor.id, { quantityOnHand: 2 })

      await seedTestComponent(user.id, {
        name: 'Cesaroni Pro38 3-Grain Casing',
        category: 'casing',
      })
      await seedTestComponent(user.id, {
        name: 'Dual Deploy Chute 48in',
        category: 'recovery',
      })

      // GET /inventory?filter=motors shows only motor inventory
      const resMotors = await fetchGet('/inventory?filter=motors')
      const htmlMotors = await resMotors.text()
      assertContains(htmlMotors, 'Pro38-H153', 'Pro38 3G')
      assertNotContains(htmlMotors, 'Dual Deploy Chute 48in')

      // GET /inventory?filter=casing shows casing components
      const resCasing = await fetchGet('/inventory?filter=casing')
      const htmlCasing = await resCasing.text()
      assertContains(htmlCasing, 'Cesaroni Pro38 3-Grain Casing')
      assertNotContains(htmlCasing, 'Dual Deploy Chute 48in')
    })

    it('2.6: verifies GET /inventory/components/:id route for casing components', async () => {
      const user = await seedTestUser()
      const comp = await seedTestComponent(user.id, {
        name: 'Dr. Rocket 38/480 Motor Casing',
        category: 'casing',
        manufacturer: 'Dr. Rocket',
        partNumber: 'DR-38-480',
        quantityOnHand: 1,
      })

      // Valid component ID returns edit form
      const res = await fetchGet(`/inventory/components/${comp.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()
      assertContains(html, 'Dr. Rocket 38/480 Motor Casing', 'DR-38-480')

      // Invalid / non-existent component ID returns 404
      const nonExistent = await fetchGet('/inventory/components/non-existent-id-999')
      expect(nonExistent.status).toBe(404)
    })
  })

  // =========================================================================
  // TIER 3: Stock Adjustments & Count Updates Preserve Casing Projections
  // =========================================================================
  describe('Tier 3: Stock Adjustments & Count Updates', () => {
    it('3.1: HTMX inline increment preserves motor hardware in returned row fragment', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'H128W-14A',
        impulseClass: 'H',
        hardware: 'RMS-29/180',
        casingReusable: true,
      })
      const inv = await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 2,
      })

      const res = await fetchHtmxPostForm(`/inventory/${inv.id}/adjust`, {
        action: 'increment',
        field: 'quantity_on_hand',
        delta: 1,
      })

      expect(res.status).toBe(200)
      const fragment = await res.text()

      // Must be a <tr> fragment with the row id
      expect(fragment).toContain(`id="inventory-row-${inv.id}"`)
      // Must display updated quantity
      expect(fragment).toContain('3')
      // Must display casing specification
      assertContains(fragment, 'Casing:', 'RMS-29/180')
      assertContains(fragment, 'AeroTech', 'H128W-14A')
    })

    it('3.2: HTMX inline decrement preserves motor hardware in returned row fragment', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'Pro54-K740',
        impulseClass: 'K',
        hardware: 'Pro54 6G',
        casingReusable: true,
      })
      const inv = await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 5,
      })

      const res = await fetchHtmxPostForm(`/inventory/${inv.id}/adjust`, {
        action: 'decrement',
        field: 'quantity_on_hand',
        delta: -1,
      })

      expect(res.status).toBe(200)
      const fragment = await res.text()

      expect(fragment).toContain('4')
      assertContains(fragment, 'Casing:', 'Pro54 6G')
      assertContains(fragment, 'Cesaroni', 'Pro54-K740')
    })

    it('3.3: HTMX inline expend transfers count and preserves motor hardware', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'J350W-14A',
        impulseClass: 'J',
        hardware: 'RMS-38/720',
        casingReusable: true,
      })
      const inv = await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 3,
        expendedCount: 1,
      })

      const res = await fetchHtmxPostForm(`/inventory/${inv.id}/adjust`, {
        action: 'expend',
        delta: 1,
      })

      expect(res.status).toBe(200)
      const fragment = await res.text()

      // Stock should now be 2 on hand
      expect(fragment).toContain('2')
      assertContains(fragment, 'Casing:', 'RMS-38/720')

      // Verify D1 state
      const db = getDb()
      const [updated] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, inv.id))
      expect(updated.quantityOnHand).toBe(2)
      expect(updated.expendedCount).toBe(2)
    })

    it('3.4: HTMX inline restore increments on-hand and preserves casing projection', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'H120',
        impulseClass: 'H',
        hardware: 'Pro29 3G',
        casingReusable: true,
      })
      const inv = await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 1,
        expendedCount: 2,
      })

      const res = await fetchHtmxPostForm(`/inventory/${inv.id}/adjust`, {
        action: 'restore',
        delta: 1,
      })

      expect(res.status).toBe(200)
      const fragment = await res.text()

      assertContains(fragment, 'Casing:', 'Pro29 3G')
    })

    it('3.5: GET /inventory/:id/adjust fallback endpoint preserves casing display', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'I200W',
        hardware: 'RMS-38/360',
        casingReusable: true,
      })
      const inv = await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 2,
      })

      const res = await fetchHtmxGet(`/inventory/${inv.id}/adjust?action=increment&delta=1`)
      expect(res.status).toBe(200)
      const fragment = await res.text()

      assertContains(fragment, 'Casing:', 'RMS-38/360')
    })

    it('3.6: sequential multi-cycle stock adjustments maintain DB link and casing projection', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'RMS-38/720-J350',
        hardware: 'RMS-38/720',
        casingReusable: true,
      })
      const inv = await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 5,
        expendedCount: 0,
      })

      // Cycle 1: Expend 2
      await fetchHtmxPostForm(`/inventory/${inv.id}/adjust`, { action: 'expend', delta: 2 })
      // Cycle 2: Increment 3
      await fetchHtmxPostForm(`/inventory/${inv.id}/adjust`, { action: 'increment', delta: 3 })
      // Cycle 3: Decrement 1
      await fetchHtmxPostForm(`/inventory/${inv.id}/adjust`, { action: 'decrement', delta: 1 })
      // Cycle 4: Restore 1
      const res = await fetchHtmxPostForm(`/inventory/${inv.id}/adjust`, { action: 'restore', delta: 1 })

      expect(res.status).toBe(200)
      const finalFragment = await res.text()
      assertContains(finalFragment, 'Casing:', 'RMS-38/720')

      // Check full inventory hub
      const hubRes = await fetchGet('/inventory')
      const hubHtml = await hubRes.text()
      assertContains(hubHtml, 'RMS-38/720-J350', 'RMS-38/720')

      // Verify DB foreign key link never drifted
      const db = getDb()
      const [finalInv] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, inv.id))
      expect(finalInv.motorId).toBe(motor.id)
      expect(finalInv.quantityOnHand).toBe(6) // 5 - 2 + 3 - 1 + 1 = 6
      expect(finalInv.expendedCount).toBe(1) // 2 - 1 = 1
    })

    it('3.7: adding more stock via POST /inventory consolidates count and preserves hardware projection', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'Pro54-6G-K570',
        hardware: 'Pro54 6G',
        casingReusable: true,
      })
      await seedTestInventory(user.id, motor.id, { quantityOnHand: 2 })

      // Flyer adds 3 more of the same motor via POST /inventory
      const postRes = await fetchPostForm('/inventory', {
        motor_id: motor.id,
        quantity_on_hand: 3,
        storage_location: 'Main Magazine',
      }, {}, { redirect: 'manual' })

      expect([200, 302, 303]).toContain(postRes.status)

      // Query GET /inventory
      const hubRes = await fetchGet('/inventory')
      assertHtmlResponse(hubRes, 200)
      const html = await hubRes.text()

      // Quantity should now be 5
      expect(html).toContain('5')
      assertContains(html, 'Pro54-6G-K570', 'Casing:', 'Pro54 6G')
    })
  })

  // =========================================================================
  // TIER 4: Multiple Inventory Items & Multi-Reload Consistency
  // =========================================================================
  describe('Tier 4: Multiple Inventory Items & Multi-Reload Consistency', () => {
    it('4.1: multiple inventory items for the same reload motor consistently project identical casing', async () => {
      const user = await seedTestUser()
      const motor = await seedTestMotor({
        manufacturer: 'Cesaroni',
        model: 'H153-14A',
        hardware: 'Pro38 3G',
        casingReusable: true,
      })

      // Two separate inventory lots for the same motor
      const inv1 = await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 2,
        batchLotNumber: 'LOT-ALPHA-2026',
        storageLocation: 'Field Box 1',
      })
      const inv2 = await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 4,
        batchLotNumber: 'LOT-BETA-2026',
        storageLocation: 'Home Safe',
      })

      const res = await fetchGet('/inventory')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Both inventory rows must be present
      expect(html).toContain(`id="inventory-row-${inv1.id}"`)
      expect(html).toContain(`id="inventory-row-${inv2.id}"`)

      // Both rows must prominently display Pro38 3G
      const occurrences = (html.match(/Pro38 3G/g) || []).length
      expect(occurrences).toBeGreaterThanOrEqual(2)
    })

    it('4.2: multi-user isolation: independent flyers view the same casing spec for the same reload model', async () => {
      const flyerA = await seedTestUser({ email: 'flyerA@example.com', displayName: 'Flyer Alpha' })
      const flyerB = await seedTestUser({ email: 'flyerB@example.com', displayName: 'Flyer Beta' })

      const tokenA = await signSession(flyerA.id)
      const tokenB = await signSession(flyerB.id)

      const motor = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'RMS-29/180-H128W',
        hardware: 'RMS-29/180',
        casingReusable: true,
      })

      await seedTestInventory(flyerA.id, motor.id, { quantityOnHand: 5 })
      await seedTestInventory(flyerB.id, motor.id, { quantityOnHand: 1 })

      // Flyer A inventory check
      const resA = await fetchGet('/inventory', { Cookie: `triplet_session=${tokenA}` })
      const htmlA = await resA.text()
      assertContains(htmlA, 'RMS-29/180-H128W', 'RMS-29/180')
      expect(htmlA).toContain('5')

      // Flyer B inventory check
      const resB = await fetchGet('/inventory', { Cookie: `triplet_session=${tokenB}` })
      const htmlB = await resB.text()
      assertContains(htmlB, 'RMS-29/180-H128W', 'RMS-29/180')
      expect(htmlB).toContain('1')
    })

    it('4.3: different motor reloads sharing the same hardware display consistent casing specification', async () => {
      const user = await seedTestUser()

      // AeroTech 29/40-120 hobby case supports E16W, E28T, F22J, G64W
      const e16 = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'E16W-4',
        hardware: 'RMS-29/40-120',
        casingReusable: true,
      })
      const g64 = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'G64W-4',
        hardware: 'RMS-29/40-120',
        casingReusable: true,
      })

      await seedTestInventory(user.id, e16.id, { quantityOnHand: 3 })
      await seedTestInventory(user.id, g64.id, { quantityOnHand: 2 })

      const res = await fetchGet('/inventory')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'E16W-4', 'RMS-29/40-120')
      assertContains(html, 'G64W-4', 'RMS-29/40-120')
    })

    it('4.4: adjusting one motor does not affect the casing display or count of another item sharing hardware', async () => {
      const user = await seedTestUser()

      const e16 = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'E16W-4',
        hardware: 'RMS-29/40-120',
        casingReusable: true,
      })
      const g64 = await seedTestMotor({
        manufacturer: 'AeroTech',
        model: 'G64W-4',
        hardware: 'RMS-29/40-120',
        casingReusable: true,
      })

      const invE16 = await seedTestInventory(user.id, e16.id, { quantityOnHand: 3 })
      const invG64 = await seedTestInventory(user.id, g64.id, { quantityOnHand: 2 })

      // Adjust E16 only
      const resE16 = await fetchHtmxPostForm(`/inventory/${invE16.id}/adjust`, {
        action: 'decrement',
        delta: -1,
      })
      expect(resE16.status).toBe(200)
      const fragE16 = await resE16.text()
      assertContains(fragE16, 'E16W-4', 'RMS-29/40-120')
      expect(fragE16).toContain('2')

      // Check full inventory hub: G64 must remain untouched at 2, with casing RMS-29/40-120
      const resHub = await fetchGet('/inventory')
      const hubHtml = await resHub.text()
      assertContains(hubHtml, 'G64W-4', 'RMS-29/40-120')

      const db = getDb()
      const [dbG64] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.id, invG64.id))
      expect(dbG64.quantityOnHand).toBe(2)
    })
  })

  // =========================================================================
  // TIER 5: End-to-End Workflow: CSV Import -> Inventory Stocking -> Lifecycle Adjustments
  // =========================================================================
  describe('Tier 5: End-to-End Ingestion, Stocking, and Lifecycle Stress Workflow', () => {
    it('5.1: executes complete pipeline from CSV ingestion to inventory adjustment and display', async () => {
      const user = await seedTestUser({ displayName: 'Pipeline Master' })

      // Step 1: Ingest 20-column CSV with AeroTech and Cesaroni reloads
      const catalogCsv = [
        CSV_HEADER,
        'RMS-I140,I140W-14A,AeroTech,29,RMS-29/240,340,140,190,White Lightning,4,145,36.2,260,UN0432,1.4C,240,2.4,14,false,Long burn I',
        'CTI-K570,K570-17A,Cesaroni,54,Pro54 6G,1650,570,820,Classic,5,760,152,1500,UN0432,1.4C,410,2.9,17,false,Level 2 Cert motor',
      ].join('\n')

      const importRes = await fetchPostForm('/motors/import', { csv_data: catalogCsv }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(importRes.status)

      // Step 2: Fetch created motor IDs from D1
      const db = getDb()
      const [motorAT] = await db.select().from(schema.motors).where(eq(schema.motors.model, 'I140W-14A'))
      const [motorCTI] = await db.select().from(schema.motors).where(eq(schema.motors.model, 'K570-17A'))

      expect(motorAT).toBeDefined()
      expect(motorAT.hardware).toBe('RMS-29/240')

      expect(motorCTI).toBeDefined()
      expect(motorCTI.hardware).toBe('Pro54 6G')

      // Step 3: Stock both motors into flyer inventory via POST /inventory
      const stockResAT = await fetchPostForm('/inventory', {
        motor_id: motorAT.id,
        quantity_on_hand: 5,
        storage_location: 'Magazine 1',
      }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(stockResAT.status)

      const stockResCTI = await fetchPostForm('/inventory', {
        motor_id: motorCTI.id,
        quantity_on_hand: 2,
        storage_location: 'Magazine 2',
      }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(stockResCTI.status)

      // Step 4: Verify GET /inventory initial rendering
      const initialHubRes = await fetchGet('/inventory')
      assertHtmlResponse(initialHubRes, 200)
      const initialHubHtml = await initialHubRes.text()

      assertContains(initialHubHtml, 'I140W-14A', 'RMS-29/240')
      assertContains(initialHubHtml, 'K570-17A', 'Pro54 6G')

      // Step 5: Lookup inventory record IDs
      const [invAT] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.motorId, motorAT.id))
      const [invCTI] = await db.select().from(schema.motorInventories).where(eq(schema.motorInventories.motorId, motorCTI.id))

      // Step 6: Perform HTMX inline adjustment on AeroTech motor (expend 2)
      const adjustResAT = await fetchHtmxPostForm(`/inventory/${invAT.id}/adjust`, {
        action: 'expend',
        delta: 2,
      })
      expect(adjustResAT.status).toBe(200)
      const fragAT = await adjustResAT.text()
      assertContains(fragAT, 'I140W-14A', 'RMS-29/240')
      expect(fragAT).toContain('3') // 5 - 2 = 3 on hand

      // Step 7: Perform HTMX inline adjustment on Cesaroni motor (increment 3)
      const adjustResCTI = await fetchHtmxPostForm(`/inventory/${invCTI.id}/adjust`, {
        action: 'increment',
        delta: 3,
      })
      expect(adjustResCTI.status).toBe(200)
      const fragCTI = await adjustResCTI.text()
      assertContains(fragCTI, 'K570-17A', 'Pro54 6G')
      expect(fragCTI).toContain('5') // 2 + 3 = 5 on hand

      // Step 8: Final verification on GET /inventory
      const finalHubRes = await fetchGet('/inventory')
      assertHtmlResponse(finalHubRes, 200)
      const finalHubHtml = await finalHubRes.text()

      assertContains(finalHubHtml, 'I140W-14A', 'RMS-29/240')
      assertContains(finalHubHtml, 'K570-17A', 'Pro54 6G')
      expect(finalHubHtml).toContain('3') // AT on hand
      expect(finalHubHtml).toContain('5') // CTI on hand
    })
  })
})
