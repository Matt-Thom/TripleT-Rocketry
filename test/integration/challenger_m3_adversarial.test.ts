/**
 * Challenger M3 Adversarial Verification Test Suite
 *
 * Requirements tested (Milestone 3 / Requirement R2):
 * 1. CSV Import RFC 4180 Edge Cases:
 *    - Quoted fields with commas, newlines/multiline strings, escaped double quotes ("").
 *    - Mixed combinations of quotes, commas, newlines, CRLF and LF.
 * 2. Schema Validation, Missing Fields, Malformed & Boundary Data:
 *    - Missing required headers (Part_Number, Designation_Product_Name, Manufacturer, Total_Impulse_Ns).
 *    - Row-level missing model/manufacturer (skipped with error, remaining rows succeed).
 *    - Unknown and commercial propellant types normalized to check-constraint safe enums.
 *    - Malformed numbers, negative numbers, extreme values, zero values.
 * 3. Delay Parsing & Semantics:
 *    - Plugged delays ("P", "p", "Plugged", "plugged", "0") parsed as 0.
 *    - Numeric delays (integers and floats) parsed accurately.
 *    - Null / empty delays handled cleanly.
 *    - Same model with different delays created as distinct motor entries.
 * 4. Duplicate Imports & Upsert Resolution:
 *    - Repeated imports update existing records without crashes or duplicate rows.
 *    - In-batch duplicates resolve cleanly.
 *    - Updated specs (impulse, thrust, notes) overwrite previous values.
 *    - Null-delay upserts update existing records.
 * 5. Motor Catalog Search Query Filtering:
 *    - Search by model, manufacturer, and part number.
 *    - Case-insensitive search queries.
 *    - Combination of impulse class filter and search query.
 *    - Search query SQL metacharacter resilience ('%, _', quotes).
 *    - Empty results handling.
 * 6. Regional Compliance & Dynamic Hardware Forms:
 *    - SafeWork SA 3.0 kg threshold vs US 50 lbs threshold.
 *    - User settings toggle persistence.
 *    - Dynamic hardware form show/hide behavior in SSR markup.
 *    - Component edit route persistence.
 */

import { env, SELF } from 'cloudflare:test'
import { describe, expect, it, beforeEach } from 'vitest'
import { getDb, seedTestComponent, seedTestUser, truncateDb } from '../helpers/db'
import { assertContains, assertHtmlResponse } from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'
import * as schema from '../../src/db/schema'
import {
  parseCsvRows,
  parseMotorsCsv,
  calculateImpulseClass,
  normalizePropellantType,
  parseDelay,
  parseBoolean,
  parseCasingReusable,
} from '../../src/services/motor_import'
import { calculateStorageSummary, evaluateTransferCompliance } from '../../src/services/compliance'
import { eq } from 'drizzle-orm'

const CSV_HEADER =
  'Part_Number,Designation_Product_Name,Manufacturer,Diameter_mm,Hardware,Total_Impulse_Ns,Avg_Thrust_N,Peak_Thrust_N,Propellant_Type,Grains,Propellant_Weight_g,Grain_Weight_g,Total_Weight_g,UN_Number,Classification,Length,Thrust_Duration_Sec,Delay_Sec,USPS_Mailable,Notes'

describe('Challenger M3: Adversarial Verification & Stress Testing', () => {
  beforeEach(async () => {
    await truncateDb()
  })

  // =========================================================================
  // VECTOR 1: CSV Parsing Robustness & RFC 4180 Invariants
  // =========================================================================
  describe('Vector 1: CSV Parsing Robustness & RFC 4180 Invariants', () => {
    it('1.1: parses quoted fields containing commas, newlines, and escaped quotes ("")', () => {
      const complexCsv = [
        'Col1,Col2,Col3',
        '"Simple field","Field, with comma","Field with ""escaped quotes"""',
        '"Multiline\nfield\nwith lines","Another, ""quoted"", field","Standard"',
      ].join('\r\n')

      const parsed = parseCsvRows(complexCsv)
      expect(parsed).toHaveLength(3)

      // Row 1
      expect(parsed[1][0]).toBe('Simple field')
      expect(parsed[1][1]).toBe('Field, with comma')
      expect(parsed[1][2]).toBe('Field with "escaped quotes"')

      // Row 2 (multiline)
      expect(parsed[2][0]).toBe('Multiline\nfield\nwith lines')
      expect(parsed[2][1]).toBe('Another, "quoted", field')
      expect(parsed[2][2]).toBe('Standard')
    })

    it('1.2: imports motor row with multiline notes containing escaped quotes and internal commas', async () => {
      const multilineNotes =
        '"Warning: Contains ""APCP"" propellant,\nCertified for Level 1 flights only.\nKeep away from open flame, store in dry magazine."'

      const csvData = [
        CSV_HEADER,
        `AT-H128W,H128W-14A,AeroTech,29,"RMS-29/180, 29/240",240.0,128.0,175.0,White Lightning,3,98.5,32.8,195.0,UN0432,1.4C,180.0,1.88,14,true,${multilineNotes}`,
      ].join('\n')

      const res = await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res.status)

      const motor = await env.DB.prepare(
        'SELECT * FROM motors WHERE model = ?',
      ).bind('H128W-14A').first<{
        model: string
        hardware: string
        notes: string
      }>()

      expect(motor).not.toBeNull()
      expect(motor?.hardware).toBe('RMS-29/180, 29/240')
      expect(motor?.notes).toContain('Contains "APCP" propellant')
      expect(motor?.notes).toContain('Certified for Level 1 flights only.')
    })

    it('1.3: handles mixed CRLF and LF line endings and trailing empty rows gracefully', async () => {
      const csvData =
        `${CSV_HEADER}\r\n` +
        'P1,G80-7T,AeroTech,29,SU,120,80,130,APCP,2,60,30,125,UN0432,1.4C,124,1.5,7,true,Row 1\n' +
        'P2,G76-7G,AeroTech,29,SU,115,76,125,APCP,2,58,29,120,UN0432,1.4C,124,1.5,7,true,Row 2\r\n' +
        '\r\n' +
        '   \r\n' +
        '\n'

      const res = await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res.status)

      const count = await env.DB.prepare('SELECT count(*) as count FROM motors').first<{ count: number }>()
      expect(count?.count).toBe(2)
    })
  })

  // =========================================================================
  // VECTOR 2: Schema Validation, Missing Fields, Malformed Data & Normalization
  // =========================================================================
  describe('Vector 2: Schema Validation, Missing Fields, Malformed Data & Normalization', () => {
    it('2.1: rejects import when any of the 4 required header columns are missing', async () => {
      // Missing Total_Impulse_Ns
      const missingImpulse =
        'Part_Number,Designation_Product_Name,Manufacturer,Diameter_mm\nP1,H100,AeroTech,29'
      const res1 = await fetchPostForm('/motors/import', { csv_data: missingImpulse }, {}, { redirect: 'manual' })
      expect([400, 422]).toContain(res1.status)

      // Missing Manufacturer
      const missingMfr =
        'Part_Number,Designation_Product_Name,Total_Impulse_Ns,Diameter_mm\nP1,H100,240,29'
      const res2 = await fetchPostForm('/motors/import', { csv_data: missingMfr }, {}, { redirect: 'manual' })
      expect([400, 422]).toContain(res2.status)

      // Missing Part_Number
      const missingPart =
        'Designation_Product_Name,Manufacturer,Total_Impulse_Ns,Diameter_mm\nH100,AeroTech,240,29'
      const res3 = await fetchPostForm('/motors/import', { csv_data: missingPart }, {}, { redirect: 'manual' })
      expect([400, 422]).toContain(res3.status)
    })

    it('2.2: skips rows with missing model or manufacturer while importing valid rows in the same batch', async () => {
      const csvData = [
        CSV_HEADER,
        'P1,,AeroTech,29,RMS,240,128,175,APCP,3,98.5,32.8,195,UN0432,1.4C,180,1.88,14,true,Missing Model',
        'P2,H128W-14A,,29,RMS,240,128,175,APCP,3,98.5,32.8,195,UN0432,1.4C,180,1.88,14,true,Missing Mfr',
        'P3,H128W-14A,AeroTech,29,RMS,240,128,175,APCP,3,98.5,32.8,195,UN0432,1.4C,180,1.88,14,true,Valid Motor',
      ].join('\n')

      const res = await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })
      // Since 1 motor succeeded, response is 200 with result summary
      expect([200, 302, 303]).toContain(res.status)

      const motors = await env.DB.prepare('SELECT * FROM motors').all()
      expect(motors.results).toHaveLength(1)
      expect((motors.results[0] as any).model).toBe('H128W-14A')
    })

    it('2.3: normalizes unknown, composite, and brand propellant formulations to valid check-constraint enums', () => {
      expect(normalizePropellantType('White Lightning')).toBe('apcp')
      expect(normalizePropellantType('Black Jack')).toBe('apcp')
      expect(normalizePropellantType('Redline')).toBe('apcp')
      expect(normalizePropellantType('Blue Streak')).toBe('apcp')
      expect(normalizePropellantType('Mojave Green')).toBe('apcp')
      expect(normalizePropellantType('Skidmark')).toBe('apcp')
      expect(normalizePropellantType('Warp-9')).toBe('apcp')
      expect(normalizePropellantType('C-Star')).toBe('apcp')
      expect(normalizePropellantType('Cesaroni Classic')).toBe('apcp')
      expect(normalizePropellantType('Black Powder')).toBe('black_powder')
      expect(normalizePropellantType('BP')).toBe('black_powder')
      expect(normalizePropellantType('Hybrid')).toBe('hybrid')
      // Exotic or unknown propellants safely fall back to 'other'
      expect(normalizePropellantType('Sugar Propellant (KNSU)')).toBe('other')
      expect(normalizePropellantType('Zinc-Sulfur Micrograin')).toBe('other')
      expect(normalizePropellantType('Liquid Oxygen / Methane')).toBe('other')
      expect(normalizePropellantType('')).toBe('other')
      expect(normalizePropellantType(null)).toBe('other')
    })

    it('2.4: inserts motors with unknown propellant type into D1 without violating ck_motors_propellant_type', async () => {
      const csvData = [
        CSV_HEADER,
        'EXP-1,KNSU-Test,Homebrew,38,Custom,320,100,200,Sugar Propellant,1,200,200,350,UN0432,1.4C,200,3.2,0,false,Experimental sugar motor',
      ].join('\n')

      const res = await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res.status)

      const motor = await env.DB.prepare(
        'SELECT propellant_type, propellantType FROM motors WHERE model = ?',
      ).bind('KNSU-Test').first<{ propellant_type?: string; propellantType?: string }>()

      const prop = motor?.propellant_type ?? motor?.propellantType
      expect(prop).toBe('other')
    })

    it('2.5: handles malformed numeric fields by setting them to null instead of throwing errors', async () => {
      const csvData = [
        CSV_HEADER,
        'BAD-NUM,H999-Test,AeroTech,twenty-nine,RMS,invalid-impulse,bad-thrust,bad-peak,APCP,two,nan,nan,bad-weight,UN0432,1.4C,bad-length,nan,14,true,Bad numbers row',
      ].join('\n')

      const res = await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res.status)

      const motor = await env.DB.prepare(
        'SELECT * FROM motors WHERE model = ?',
      ).bind('H999-Test').first<{
        diameter_mm: number | null
        total_impulse_ns: number | null
        average_thrust_n: number | null
        impulse_class: string | null
      }>()

      expect(motor).not.toBeNull()
      expect(motor?.diameter_mm).toBeNull()
      expect(motor?.total_impulse_ns).toBeNull()
      expect(motor?.average_thrust_n).toBeNull()
      // Impulse class inferred from model prefix "H"
      expect(motor?.impulse_class).toBe('H')
    })

    it('2.6: correctly maps total impulse boundaries across all classes A through O', () => {
      expect(calculateImpulseClass(1.0)).toBe('A')
      expect(calculateImpulseClass(2.5)).toBe('A')
      expect(calculateImpulseClass(2.51)).toBe('B')
      expect(calculateImpulseClass(5.0)).toBe('B')
      expect(calculateImpulseClass(5.01)).toBe('C')
      expect(calculateImpulseClass(10.0)).toBe('C')
      expect(calculateImpulseClass(20.0)).toBe('D')
      expect(calculateImpulseClass(40.0)).toBe('E')
      expect(calculateImpulseClass(80.0)).toBe('F')
      expect(calculateImpulseClass(160.0)).toBe('G')
      expect(calculateImpulseClass(320.0)).toBe('H')
      expect(calculateImpulseClass(640.0)).toBe('I')
      expect(calculateImpulseClass(1280.0)).toBe('J')
      expect(calculateImpulseClass(2560.0)).toBe('K')
      expect(calculateImpulseClass(5120.0)).toBe('L')
      expect(calculateImpulseClass(10240.0)).toBe('M')
      expect(calculateImpulseClass(20480.0)).toBe('N')
      expect(calculateImpulseClass(20480.01)).toBe('O')
      expect(calculateImpulseClass(40960.0)).toBe('O')
    })
  })

  // =========================================================================
  // VECTOR 3: Delay Parsing & Semantics (Plugged vs Numeric vs Null)
  // =========================================================================
  describe('Vector 3: Delay Parsing & Semantics (Plugged vs Numeric vs Null)', () => {
    it('3.1: parses all variations of plugged delays as 0', () => {
      expect(parseDelay('P')).toBe(0)
      expect(parseDelay('p')).toBe(0)
      expect(parseDelay('Plugged')).toBe(0)
      expect(parseDelay('plugged')).toBe(0)
      expect(parseDelay('PLUGGED')).toBe(0)
      expect(parseDelay('0')).toBe(0)
    })

    it('3.2: parses numeric delays and null values accurately', () => {
      expect(parseDelay('6')).toBe(6)
      expect(parseDelay('14')).toBe(14)
      expect(parseDelay('14.5')).toBe(14.5)
      expect(parseDelay('')).toBeNull()
      expect(parseDelay(null)).toBeNull()
      expect(parseDelay(undefined)).toBeNull()
    })

    it('3.3: distinguishes motors of same manufacturer and model with different delays into separate catalog records', async () => {
      const csvData = [
        CSV_HEADER,
        'RMS-H128-10,H128W,AeroTech,29,RMS,240,128,175,APCP,3,98.5,32.8,195,UN0432,1.4C,180,1.88,10,true,10 sec delay',
        'RMS-H128-14,H128W,AeroTech,29,RMS,240,128,175,APCP,3,98.5,32.8,195,UN0432,1.4C,180,1.88,14,true,14 sec delay',
        'RMS-H128-P,H128W,AeroTech,29,RMS,240,128,175,APCP,3,98.5,32.8,195,UN0432,1.4C,180,1.88,P,true,Plugged delay',
      ].join('\n')

      const res = await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res.status)

      const motors = await env.DB.prepare(
        'SELECT model, delay_s, delayS FROM motors WHERE model = ? ORDER BY delay_s ASC',
      ).bind('H128W').all<{ delay_s?: number; delayS?: number }>()

      // 3 distinct motors must exist
      expect(motors.results).toHaveLength(3)
      const delays = motors.results.map((m) => m.delay_s ?? m.delayS)
      expect(delays).toEqual([0, 10, 14])
    })
  })

  // =========================================================================
  // VECTOR 4: Duplicate Imports, Upsert Resolution & Conflict Handling
  // =========================================================================
  describe('Vector 4: Duplicate Imports, Upsert Resolution & Conflict Handling', () => {
    it('4.1: re-importing identical motor updates record in place and modifies notes without duplicating rows', async () => {
      const rowInitial = `${CSV_HEADER}\nAT-I200,I200W-14A,AeroTech,38,RMS,400,200,310,APCP,3,180,60,350,UN0432,1.4C,240,2.0,14,false,Initial calibration`
      const rowUpdated = `${CSV_HEADER}\nAT-I200,I200W-14A,AeroTech,38,RMS,405,205,315,APCP,3,182,60.6,352,UN0432,1.4C,240,2.0,14,false,Updated 2026 test-stand calibration`

      // 1st import
      await fetchPostForm('/motors/import', { csv_data: rowInitial }, {}, { redirect: 'manual' })

      // 2nd import
      const res2 = await fetchPostForm('/motors/import', { csv_data: rowUpdated }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res2.status)

      const records = await env.DB.prepare(
        'SELECT * FROM motors WHERE model = ? AND manufacturer = ?',
      ).bind('I200W-14A', 'AeroTech').all<{
        id: string
        total_impulse_ns?: number
        totalImpulseNs?: number
        notes: string
      }>()

      expect(records.results).toHaveLength(1)
      const motor = records.results[0]
      const impulse = motor.total_impulse_ns ?? motor.totalImpulseNs
      expect(impulse).toBe(405)
      expect(motor.notes).toBe('Updated 2026 test-stand calibration')
    })

    it('4.2: handles in-batch duplicates cleanly without throwing UNIQUE constraint violation', async () => {
      // Both rows in the SAME CSV payload have identical (manufacturer, model, delay)
      const csvData = [
        CSV_HEADER,
        'DUPE-1,J350W-14A,AeroTech,38,RMS,720,350,490,APCP,4,350,87.5,620,UN0432,1.4C,320,2.06,14,false,Batch duplicate row 1',
        'DUPE-2,J350W-14A,AeroTech,38,RMS,725,355,495,APCP,4,352,88,622,UN0432,1.4C,320,2.06,14,false,Batch duplicate row 2 final',
      ].join('\n')

      const res = await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res.status)

      const records = await env.DB.prepare(
        'SELECT * FROM motors WHERE model = ?',
      ).bind('J350W-14A').all<{
        notes: string
        total_impulse_ns?: number
        totalImpulseNs?: number
      }>()

      expect(records.results).toHaveLength(1)
      expect(records.results[0].notes).toBe('Batch duplicate row 2 final')
    })

    it('4.3: handles null-delay upserts properly when delay is unspecified', async () => {
      const row1 = `${CSV_HEADER}\nEST-E9,E9-Custom,Estes,24,SU,30,9,25,BP,1,30,30,55,UN0432,1.4S,95,3,,true,Null delay 1`
      const row2 = `${CSV_HEADER}\nEST-E9,E9-Custom,Estes,24,SU,32,10,26,BP,1,30,30,55,UN0432,1.4S,95,3,,true,Null delay 2 updated`

      await fetchPostForm('/motors/import', { csv_data: row1 }, {}, { redirect: 'manual' })
      await fetchPostForm('/motors/import', { csv_data: row2 }, {}, { redirect: 'manual' })

      const motors = await env.DB.prepare(
        'SELECT * FROM motors WHERE model = ?',
      ).bind('E9-Custom').all<{ notes: string }>()

      expect(motors.results).toHaveLength(1)
      expect(motors.results[0].notes).toBe('Null delay 2 updated')
    })
  })

  // =========================================================================
  // VECTOR 5: Motor Catalog Search Query Filtering (?search=...)
  // =========================================================================
  describe('Vector 5: Motor Catalog Search Query Filtering (?search=...)', () => {
    beforeEach(async () => {
      // Seed 4 motors for search testing
      const seedCsv = [
        CSV_HEADER,
        'RMS-H128,H128W-14A,AeroTech,29,RMS,240,128,175,APCP,3,98.5,32.8,195,UN0432,1.4C,180,1.88,14,true,AeroTech H Motor',
        'RMS-I200,I200W-14A,AeroTech,38,RMS,400,200,310,APCP,3,180,60,350,UN0432,1.4C,240,2.0,14,false,AeroTech I Motor',
        'PRO29-H120,H120-14A,Cesaroni,29,Pro29,240,120,160,APCP,3,90,30,180,UN0432,1.4C,180,2.0,14,true,Cesaroni H Motor',
        'EST-D12,D12-5,Estes,24,SU,20,12,28,BP,1,25,25,45,UN0432,1.4S,70,1.6,5,true,Estes D Motor',
      ].join('\n')

      await fetchPostForm('/motors/import', { csv_data: seedCsv }, {}, { redirect: 'manual' })
    })

    it('5.1: filters catalog by model substring case-insensitively', async () => {
      const res = await fetchGet('/motors?search=h128')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('H128W-14A')
      expect(html).not.toContain('I200W-14A')
      expect(html).not.toContain('D12-5')
    })

    it('5.2: filters catalog by manufacturer name', async () => {
      const res = await fetchGet('/motors?search=Cesaroni')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('H120-14A')
      expect(html).toContain('Cesaroni')
      expect(html).not.toContain('AeroTech')
      expect(html).not.toContain('Estes')
    })

    it('5.3: filters catalog by part number', async () => {
      const res = await fetchGet('/motors?search=PRO29-H120')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('H120-14A')
      expect(html).not.toContain('H128W-14A')
    })

    it('5.4: combines impulse class filter and search query correctly', async () => {
      // Both AeroTech and Cesaroni have H motors; filter by class H and search AeroTech
      const res = await fetchGet('/motors?impulse_class=H&search=AeroTech')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('H128W-14A')
      expect(html).not.toContain('H120-14A') // Cesaroni excluded
      expect(html).not.toContain('I200W-14A') // Class I excluded
    })

    it('5.5: safely handles SQL wildcard and metacharacters without errors', async () => {
      // Wildcard query % matches all
      const res1 = await fetchGet('/motors?search=%25')
      assertHtmlResponse(res1, 200)

      // SQL injection attempt via search query
      const res2 = await fetchGet("/motors?search=' OR '1'='1")
      assertHtmlResponse(res2, 200)

      // Non-existent search returns empty list safely
      const res3 = await fetchGet('/motors?search=NonExistentMotorXYZ999')
      assertHtmlResponse(res3, 200)
      const html = await res3.text()
      expect(html).toMatch(/no motors found|0 motors|no matching/i)
    })
  })

  // =========================================================================
  // VECTOR 6: Regional Compliance, User Settings & Dynamic Hardware Form
  // =========================================================================
  describe('Vector 6: Regional Compliance, User Settings & Dynamic Hardware Form', () => {
    it('6.1: verifies South Australia default storage limit of 3,000g vs US limit of 22,680g', () => {
      const items = [{ quantityOnHand: 5, propellantMassG: 800, impulseClass: 'I' }] // 4,000g total

      // SA evaluation: 4,000g > 3,000g -> triggers SafeWork SA exceedance warning
      const saSummary = calculateStorageSummary(items, 3000, 'SA')
      expect(saSummary.totalPropellantMassKg).toBe(4.0)
      const saWarnings = saSummary.warnings.filter((w) => /SafeWork SA/i.test(w))
      expect(saWarnings.length).toBeGreaterThanOrEqual(1)

      // US evaluation: 4,000g < 22,680g (50 lbs) -> compliant, zero exceedance warnings
      const usSummary = calculateStorageSummary(items, 22680, 'US')
      const usWarnings = usSummary.warnings.filter((w) => /storage limit/i.test(w))
      expect(usWarnings).toHaveLength(0)
    })

    it('6.2: flyer toggles compliance region to US via POST /settings and back to SA', async () => {
      const user = await seedTestUser()

      // Toggle to US
      const res1 = await fetchPostForm('/settings', { regulatory_region: 'US' }, {}, { redirect: 'manual' })
      expect([302, 303]).toContain(res1.status)

      const db = getDb()
      const [userAfterUs] = await db.select().from(schema.users).where(eq(schema.users.id, user.id))
      expect(userAfterUs.regulatoryRegion).toBe('US')

      // Toggle back to SA
      const res2 = await fetchPostForm('/settings', { regulatory_region: 'SA' }, {}, { redirect: 'manual' })
      expect([302, 303]).toContain(res2.status)

      const [userAfterSa] = await db.select().from(schema.users).where(eq(schema.users.id, user.id))
      expect(userAfterSa.regulatoryRegion).toBe('SA')
    })

    it('6.3: dynamic hardware UI contains category toggle handler and hides pyrotechnic section by default', async () => {
      await seedTestUser()
      const res = await fetchGet('/inventory/components/new')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Must have hazardous specs section with hidden class
      expect(html).toContain('id="hazardous-specs-section"')
      expect(html).toMatch(/id="hazardous-specs-section"[^>]*hidden/)

      // Must have toggle script and onchange handler
      expect(html).toContain('toggleHazardousFields()')
      expect(html).toContain('onchange="toggleHazardousFields()"')
    })

    it('6.4: edit component form displays hazardous section for pyrotechnic items and hides it for non-hazardous', async () => {
      const user = await seedTestUser()

      // 1. Pyrotechnic component: section should NOT have 'hidden'
      const pyro = await seedTestComponent(user.id, {
        name: 'Electric Match E-9',
        category: 'pyrotechnic',
        propellantMassG: 2.5,
        hazardClass: '1.4S',
      })
      const resPyro = await fetchGet(`/inventory/components/${pyro.id}`)
      assertHtmlResponse(resPyro, 200)
      const pyroHtml = await resPyro.text()
      // hazardous section should be visible (not hidden)
      const pyroSectionMatch = pyroHtml.match(/id="hazardous-specs-section"[^>]*class="([^"]*)"/)
      expect(pyroSectionMatch?.[1]).not.toContain('hidden')

      // 2. Hardware / Avionics component: section SHOULD have 'hidden'
      const avionics = await seedTestComponent(user.id, {
        name: 'TeleMetrum v3 Altimeter',
        category: 'avionics',
      })
      const resAvionics = await fetchGet(`/inventory/components/${avionics.id}`)
      assertHtmlResponse(resAvionics, 200)
      const avionicsHtml = await resAvionics.text()
      const avionicsSectionMatch = avionicsHtml.match(/id="hazardous-specs-section"[^>]*class="([^"]*)"/)
      expect(avionicsSectionMatch?.[1]).toContain('hidden')
    })

    it('6.5: component edit route POST /inventory/components/:id updates component in D1', async () => {
      const user = await seedTestUser()
      const comp = await seedTestComponent(user.id, {
        name: 'Top Flight 36in Parachute',
        category: 'recovery',
        quantityOnHand: 1,
        condition: 'new',
      })

      const updateRes = await fetchPostForm(
        `/inventory/components/${comp.id}`,
        {
          name: 'Top Flight 36in Parachute (High-Visibility Orange)',
          category: 'recovery',
          quantity_on_hand: 2,
          condition: 'good',
          storage_location: 'Recovery Bin 1',
          notes: 'Added second chute from field box',
        },
        {},
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(updateRes.status)

      const db = getDb()
      const [updated] = await db.select().from(schema.components).where(eq(schema.components.id, comp.id))
      expect(updated.name).toBe('Top Flight 36in Parachute (High-Visibility Orange)')
      expect(updated.quantityOnHand).toBe(2)
      expect(updated.condition).toBe('good')
      expect(updated.storageLocation).toBe('Recovery Bin 1')
    })
  })
})

  // =========================================================================
  // VECTOR 7: Adversarial Payload Stress Testing (Batches, XSS, Negative Values, Formats)
  // =========================================================================
  describe('Vector 7: Adversarial Payload Stress Testing', () => {
    it('7.1: imports 35 motors across 3 batches (chunk size 15) without loss or transaction failure', async () => {
      const rows = [CSV_HEADER]
      for (let i = 1; i <= 35; i++) {
        rows.push(
          `PART-${i},M${i}00-14A,BatchMfr,29,RMS,${i * 10},${i * 5},${i * 8},APCP,2,${i * 2},${i},${i * 5},UN0432,1.4C,180,1.5,14,true,Batch item ${i}`,
        )
      }

      const res = await fetchPostForm('/motors/import', { csv_data: rows.join('\n') }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res.status)

      const count = await env.DB.prepare(
        "SELECT count(*) as count FROM motors WHERE manufacturer = 'BatchMfr'",
      ).first<{ count: number }>()

      expect(count?.count).toBe(35)
    })

    it('7.2: safely handles HTML tags and script injections in CSV values without XSS vulnerability', async () => {
      const rfcXss = '"<script>alert(""pwned"")</script>"'
      const csvData = [
        CSV_HEADER,
        `XSS-1,${rfcXss},AeroTech,29,RMS,240,128,175,APCP,3,98.5,32.8,195,UN0432,1.4C,180,1.88,14,true,${rfcXss}`,
      ].join('\n')

      const res = await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res.status)

      // Query catalog view to ensure string is HTML-escaped and not raw executable script
      const catalogRes = await fetchGet('/motors')
      assertHtmlResponse(catalogRes, 200)
      const catalogHtml = await catalogRes.text()

      // Should NOT contain raw unescaped <script> tag
      expect(catalogHtml).not.toContain('<script>alert("pwned")</script>')
      // Should be escaped as &lt;script&gt;
      expect(catalogHtml).toContain('&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt;')
    })

    it('7.3: safely handles SQL injection strings inside CSV cells', async () => {
      const sqlInjection = "AeroTech'); DROP TABLE motors; --"
      const csvData = [
        CSV_HEADER,
        `SQLI-1,SQL-Inject-Model,"${sqlInjection}",29,RMS,240,128,175,APCP,3,98.5,32.8,195,UN0432,1.4C,180,1.88,14,true,SQLi test`,
      ].join('\n')

      const res = await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res.status)

      // Verify motors table still exists and motor was inserted
      const motor = await env.DB.prepare(
        'SELECT manufacturer FROM motors WHERE model = ?',
      ).bind('SQL-Inject-Model').first<{ manufacturer: string }>()

      expect(motor?.manufacturer).toBe(sqlInjection)
    })

    it('7.4: handles negative numeric values without crashing', async () => {
      const csvData = [
        CSV_HEADER,
        'NEG-1,NEG-MOTOR,AeroTech,-29,RMS,-240,-128,-175,APCP,-3,-98.5,-32.8,-195,UN0432,1.4C,-180,-1.88,14,true,Negative specs',
      ].join('\n')

      const res = await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res.status)

      const motor = await env.DB.prepare(
        'SELECT diameter_mm, total_impulse_ns FROM motors WHERE model = ?',
      ).bind('NEG-MOTOR').first<{ diameter_mm: number; total_impulse_ns: number }>()

      expect(motor?.diameter_mm).toBe(-29)
      expect(motor?.total_impulse_ns).toBe(-240)
    })

    it('7.5: rejects CSV submission containing only header row with zero data rows', async () => {
      const res = await fetchPostForm('/motors/import', { csv_data: CSV_HEADER }, {}, { redirect: 'manual' })
      expect([400, 422]).toContain(res.status)
      const html = await res.text()
      expect(html).toMatch(/at least one data row/i)
    })

    it('7.6: accepts CSV import via application/json payload', async () => {
      const csvRow = `${CSV_HEADER}\nJSON-1,JSON-H100,AeroTech,29,RMS,220,100,150,APCP,3,90,30,180,UN0432,1.4C,180,2.0,14,true,JSON upload`

      const res = await SELF.fetch('https://example.com/motors/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/html' },
        body: JSON.stringify({ csv_data: csvRow }),
      })

      expect([200, 302, 303]).toContain(res.status)
      const motor = await env.DB.prepare(
        'SELECT * FROM motors WHERE model = ?',
      ).bind('JSON-H100').first()
      expect(motor).not.toBeNull()
    })
  })
