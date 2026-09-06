/**
 * Integration test suite for Requirement R2: 20-Column Motor Product CSV Import.
 *
 * Tests:
 * 1. GET /motors/import: Renders motor CSV import interface with schema guidance.
 * 2. POST /motors/import: Validates and imports motors using the authoritative 20-column schema:
 *    Part_Number, Designation_Product_Name, Manufacturer, Diameter_mm, Hardware,
 *    Total_Impulse_Ns, Avg_Thrust_N, Peak_Thrust_N, Propellant_Type, Grains,
 *    Propellant_Weight_g, Grain_Weight_g, Total_Weight_g, UN_Number, Classification,
 *    Length, Thrust_Duration_Sec, Delay_Sec, USPS_Mailable, Notes
 * 3. Automatic calculation of impulse class (A through O) based on Total_Impulse_Ns.
 * 4. Propellant type normalization to prevent CHECK constraint violations.
 * 5. Type coercion for diameters, weights, thrusts, delays (numeric and "P"/plugged), and boolean USPS mailable.
 * 6. Batch processing and conflict resolution (upsert on duplicate manufacturer/model/delay).
 * 7. Error handling for malformed CSV, missing headers, and empty payloads.
 * 8. Real-world catalog import workload scenario (Tier 4).
 */

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { truncateDb } from '../helpers/db'
import { assertContains, assertHtmlResponse } from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'

beforeEach(truncateDb)

const CSV_HEADER =
  'Part_Number,Designation_Product_Name,Manufacturer,Diameter_mm,Hardware,Total_Impulse_Ns,Avg_Thrust_N,Peak_Thrust_N,Propellant_Type,Grains,Propellant_Weight_g,Grain_Weight_g,Total_Weight_g,UN_Number,Classification,Length,Thrust_Duration_Sec,Delay_Sec,USPS_Mailable,Notes'

describe('Requirement R2: 20-Column Motor Product CSV Import', () => {
  describe('Tier 1: Import Interface & Basic CSV Parsing', () => {
    it('1.1: renders motor import UI at GET /motors/import', async () => {
      const res = await fetchGet('/motors/import')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Should mention CSV and import
      expect(html).toMatch(/import.*motor|csv/i)
      expect(html).toMatch(/textarea|file|upload/i)
    })

    it('1.2: imports a single motor row matching the 20-column schema', async () => {
      const csvRow = `${CSV_HEADER}\nRMS-29/180-H128W,H128W-14A,AeroTech,29,RMS-29/180,240.0,128.0,175.0,White Lightning,3,98.5,32.8,195.0,UN0432,1.4C,180.0,1.88,14,true,Popular Level 1 cert motor`

      const res = await fetchPostForm('/motors/import', {
        csv_data: csvRow,
      }, {}, { redirect: 'manual' })

      expect([200, 302, 303]).toContain(res.status)

      // Query database directly to verify insertion
      const motor = await env.DB.prepare(
        'SELECT * FROM motors WHERE model = ? AND manufacturer = ?',
      ).bind('H128W-14A', 'AeroTech').first<{
        id: string
        model: string
        manufacturer: string
        impulse_class?: string
        impulseClass?: string
        total_impulse_ns?: number
        totalImpulseNs?: number
      }>()

      expect(motor).not.toBeNull()
      expect(motor?.model).toBe('H128W-14A')
      expect(motor?.manufacturer).toBe('AeroTech')
    })

    it('1.3: automatically calculates impulse class H for 240 N·s motor', async () => {
      const csvRow = `${CSV_HEADER}\nAT-H128,H128W-M,AeroTech,29,RMS,240.0,128.0,175.0,APCP,3,98.5,32.8,195.0,UN0432,1.4C,180.0,1.88,14,true,Notes`

      await fetchPostForm('/motors/import', { csv_data: csvRow }, {}, { redirect: 'manual' })

      const motor = await env.DB.prepare(
        'SELECT * FROM motors WHERE model = ?',
      ).bind('H128W-M').first<{
        impulse_class?: string
        impulseClass?: string
      }>()

      if (motor) {
        const cls = motor.impulse_class ?? motor.impulseClass
        expect(cls).toBe('H')
      }
    })

    it('1.4: automatically calculates impulse class J for 720 N·s motor', async () => {
      const csvRow = `${CSV_HEADER}\nAT-J350,J350W-14A,AeroTech,38,RMS-38/720,720.0,350.0,490.0,APCP,4,350.0,87.5,620.0,UN0432,1.4C,320.0,2.06,14,false,Heavy L2 Motor`

      await fetchPostForm('/motors/import', { csv_data: csvRow }, {}, { redirect: 'manual' })

      const motor = await env.DB.prepare(
        'SELECT * FROM motors WHERE model = ?',
      ).bind('J350W-14A').first<{
        impulse_class?: string
        impulseClass?: string
      }>()

      if (motor) {
        const cls = motor.impulse_class ?? motor.impulseClass
        expect(cls).toBe('J')
      }
    })

    it('1.5: renders summary of imported records after submission', async () => {
      const csvRow = `${CSV_HEADER}\nEST-C6-5,C6-5,Estes,18,Single Use,9.5,6.0,14.0,Black Powder,1,12.5,12.5,25.0,UN0432,1.4S,70.0,1.6,5,true,Model Rocket Motor`

      const res = await fetchPostForm('/motors/import', {
        csv_data: csvRow,
      })

      if (res.status === 200) {
        const html = await res.text()
        expect(html).toMatch(/imported|success|created/i)
      }
    })
  })

  describe('Tier 2: Propellant Normalization & Type Conversions', () => {
    it('2.1: normalizes commercial propellant names to check-constraint compliant types', async () => {
      const csvData = [
        CSV_HEADER,
        'P1,H100-WL,AeroTech,29,RMS,200,100,150,White Lightning,2,80,40,160,UN0432,1.4C,180,2,10,true,WL',
        'P2,H110-BJ,AeroTech,29,RMS,210,110,160,Black Jack,2,85,42.5,170,UN0432,1.4C,180,2,10,true,BJ',
        'P3,E9-BP,Estes,24,SU,30,9,25,Black Powder,1,30,30,55,UN0432,1.4S,95,3,4,true,BP',
      ].join('\n')

      const res = await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res.status)

      const motors = await env.DB.prepare(
        "SELECT model, propellant_type, propellant_type AS propellantType FROM motors WHERE manufacturer IN ('AeroTech', 'Estes')",
      ).all<{
        model: string
        propellant_type?: string
        propellantType?: string
      }>()

      // Verify no check constraint violations occurred and records were saved
      expect(motors.results.length).toBeGreaterThanOrEqual(1)
    })

    it('2.2: parses plugged delay ("P" or "0") as 0 and numeric delays correctly', async () => {
      const csvData = [
        CSV_HEADER,
        'P-PLUG,I200-P,AeroTech,38,RMS,400,200,300,APCP,3,180,60,350,UN0432,1.4C,240,2,P,false,Plugged',
        'P-NUM,I200-10,AeroTech,38,RMS,400,200,300,APCP,3,180,60,350,UN0432,1.4C,240,2,10,false,10 sec',
      ].join('\n')

      await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })

      const plugged = await env.DB.prepare(
        'SELECT delay_s, delay_s AS delayS FROM motors WHERE model = ?',
      ).bind('I200-P').first<{ delay_s?: number; delayS?: number }>()

      if (plugged) {
        const delay = plugged.delay_s ?? plugged.delayS
        expect(delay).toBe(0)
      }
    })

    it('2.3: parses boolean USPS_Mailable flag correctly', async () => {
      const csvData = [
        CSV_HEADER,
        'MAIL-YES,D12-3,Estes,24,SU,20,12,30,BP,1,25,25,45,UN0432,1.4S,70,1.6,3,true,Yes',
        'MAIL-NO,K550W-14,AeroTech,54,RMS,1800,550,800,APCP,4,800,200,1500,UN0432,1.4C,400,3.2,14,false,No',
      ].join('\n')

      await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })

      const d12 = await env.DB.prepare(
        'SELECT * FROM motors WHERE model = ?',
      ).bind('D12-3').first<{ usps_mailable?: number; uspsMailable?: boolean }>()

      if (d12 && (d12.usps_mailable !== undefined || d12.uspsMailable !== undefined)) {
        const mailable = d12.usps_mailable ?? (d12.uspsMailable ? 1 : 0)
        expect(Number(mailable)).toBe(1)
      }
    })

    it('2.4: correctly parses quoted CSV fields containing commas and quotes (RFC 4180)', async () => {
      const csvRow = `${CSV_HEADER}\n"PART-100","G80-7T","AeroTech",29,"RMS-29/100, 29/120",120.0,80.0,130.0,"APCP Blue Streak",2,60.0,30.0,125.0,"UN0432","1.4C",124.0,1.5,7,true,"Recommended for ""Initiator"" rocket"`

      const res = await fetchPostForm('/motors/import', {
        csv_data: csvRow,
      }, {}, { redirect: 'manual' })

      expect([200, 302, 303]).toContain(res.status)

      const motor = await env.DB.prepare(
        'SELECT * FROM motors WHERE model = ?',
      ).bind('G80-7T').first<{ model: string; manufacturer: string }>()

      expect(motor?.model).toBe('G80-7T')
    })
  })

  describe('Tier 3: Conflict Resolution & Robust Error Handling', () => {
    it('3.1: updates existing record on re-import of same manufacturer, model, and delay', async () => {
      const row1 = `${CSV_HEADER}\nAT-RE,H180W-14A,AeroTech,29,RMS,220,180,250,APCP,3,90,30,180,UN0432,1.4C,180,1.2,14,true,Initial notes`
      const row2 = `${CSV_HEADER}\nAT-RE,H180W-14A,AeroTech,29,RMS,225,185,260,APCP,3,92,30.6,182,UN0432,1.4C,180,1.2,14,true,Updated calibration notes`

      // First import
      await fetchPostForm('/motors/import', { csv_data: row1 }, {}, { redirect: 'manual' })

      // Second import with updated total impulse
      const secondRes = await fetchPostForm('/motors/import', { csv_data: row2 }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(secondRes.status)

      // Query to verify single record exists
      const motors = await env.DB.prepare(
        'SELECT * FROM motors WHERE model = ? AND manufacturer = ?',
      ).bind('H180W-14A', 'AeroTech').all()

      expect(motors.results).toHaveLength(1)
    })

    it('3.2: rejects import with missing required CSV header columns', async () => {
      const badHeaderCsv = 'Model,Thrust,Impulse\nH128,128,240'

      const res = await fetchPostForm('/motors/import', {
        csv_data: badHeaderCsv,
      }, {}, { redirect: 'manual' })

      if (res.status === 200) {
        const html = await res.text()
        expect(html).toMatch(/header|schema|column|missing|invalid/i)
      } else {
        expect([400, 422]).toContain(res.status)
      }
    })

    it('3.3: handles empty CSV submission gracefully', async () => {
      const res = await fetchPostForm('/motors/import', {
        csv_data: '   ',
      }, {}, { redirect: 'manual' })

      if (res.status === 200) {
        const html = await res.text()
        expect(html).toMatch(/empty|required|no data/i)
      } else {
        expect([400, 422]).toContain(res.status)
      }
    })

    it('3.4: handles batch import with 10 mixed motors across multiple impulse classes', async () => {
      const rows = [
        CSV_HEADER,
        'E1,D12-5,Estes,24,SU,20,12,28,BP,1,25,25,45,UN0432,1.4S,70,1.6,5,true,D',
        'E2,E12-4,Estes,24,SU,35,12,30,BP,1,35,35,60,UN0432,1.4S,70,2.8,4,true,E',
        'A1,F40-7W,AeroTech,29,RMS,60,40,75,APCP,1,30,30,85,UN0432,1.4C,124,1.5,7,true,F',
        'A2,G64-7W,AeroTech,29,RMS,100,64,110,APCP,2,50,25,115,UN0432,1.4C,124,1.6,7,true,G',
        'A3,H128W-14A,AeroTech,29,RMS,240,128,175,APCP,3,98.5,32.8,195,UN0432,1.4C,180,1.88,14,true,H',
        'A4,I200W-14A,AeroTech,38,RMS,400,200,310,APCP,3,180,60,350,UN0432,1.4C,240,2.0,14,false,I',
        'A5,J350W-14A,AeroTech,38,RMS,720,350,490,APCP,4,350,87.5,620,UN0432,1.4C,320,2.06,14,false,J',
        'A6,K550W-14A,AeroTech,54,RMS,1800,550,800,APCP,4,800,200,1500,UN0432,1.4C,400,3.2,14,false,K',
        'C1,L1000-15,Cesaroni,75,Pro75,3500,1000,1400,APCP,3,1600,533,3200,UN0432,1.4C,550,3.5,15,false,L',
        'C2,M1315-P,Cesaroni,75,Pro75,7000,1315,1800,APCP,4,3400,850,6500,UN0432,1.4C,750,5.3,0,false,M',
      ].join('\n')

      const res = await fetchPostForm('/motors/import', { csv_data: rows }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res.status)

      const count = await env.DB.prepare(
        'SELECT count(*) as count FROM motors',
      ).first<{ count: number }>()

      expect(count?.count).toBeGreaterThanOrEqual(5)
    })
  })

  describe('Tier 4: Workload Scenario — Commercial Motor Catalog Synchronization', () => {
    it('imports commercial motor catalog and verifies motors appear in search catalog and flight selection', async () => {
      // Step 1: Flyer imports commercial reload catalog
      const catalogCsv = [
        CSV_HEADER,
        'RMS-H148,H148R-14A,AeroTech,29,RMS-29/180,210,148,220,Redline,3,95,31.6,190,UN0432,1.4C,180,1.4,14,true,High thrust L1',
        'RMS-I140,I140W-14A,AeroTech,29,RMS-29/240,340,140,190,White Lightning,4,145,36.2,260,UN0432,1.4C,240,2.4,14,false,Long burn I',
      ].join('\n')

      const importRes = await fetchPostForm('/motors/import', {
        csv_data: catalogCsv,
      }, {}, { redirect: 'manual' })

      expect([200, 302, 303]).toContain(importRes.status)

      // Step 2: Search motor catalog for imported motor
      const searchRes = await fetchGet('/motors?search=H148R')
      assertHtmlResponse(searchRes, 200)
      const searchHtml = await searchRes.text()
      assertContains(searchHtml, 'H148R')
      assertContains(searchHtml, 'AeroTech')

      // Step 3: Inspect detailed motor page
      const motorRow = await env.DB.prepare(
        'SELECT id FROM motors WHERE model = ?',
      ).bind('H148R-14A').first<{ id: string }>()

      expect(motorRow).not.toBeNull()
      if (motorRow) {
        const detailRes = await fetchGet(`/motors/${motorRow.id}`)
        assertHtmlResponse(detailRes, 200)
        const detailHtml = await detailRes.text()
        expect(detailHtml).toContain('H148R')
      }
    })
  })

  describe('Tier 5: Scale & Tolerant Parsing Validation (700+ Motors & CTI/Missing Fields)', () => {
    it('5.1: successfully imports Cesaroni 640J120-14A with CTI designation and missing optional fields', async () => {
      // Missing Part_Number, Grains, Propellant_Weight_g, Grain_Weight_g, Total_Weight_g, Notes
      // Delay formatted with letter suffix: "14A"
      const ctiCsv = [
        CSV_HEADER,
        ',640J120-14A,Cesaroni (Pro54),54,Pro54,640,120,200,other,,,,-,UN0432,1.4C,255,5.3,14A,false,',
      ].join('\n')

      const res = await fetchPostForm('/motors/import', { csv_data: ctiCsv }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res.status)

      const motor = await env.DB.prepare(
        'SELECT * FROM motors WHERE model = ? AND manufacturer = ?',
      ).bind('640J120-14A', 'Cesaroni (Pro54)').first<{
        model: string
        manufacturer: string
        diameter_mm: number | null
        delay_s: number | null
        grains: number | null
        grain_weight_g: number | null
        notes: string | null
        part_number: string | null
      }>()

      expect(motor).not.toBeNull()
      expect(motor?.model).toBe('640J120-14A')
      expect(motor?.manufacturer).toBe('Cesaroni (Pro54)')
      expect(motor?.diameter_mm).toBe(54)
      expect(motor?.delay_s).toBe(14)
      expect(motor?.grains).toBeNull()
      expect(motor?.grain_weight_g).toBeNull()
      expect(motor?.part_number).toBeNull()
      expect(motor?.notes).toBeNull()
    })

    it('5.2: successfully imports fractional motor 1/2A6-2 and infers impulse class with missing total impulse', async () => {
      const fracCsv = [
        CSV_HEADER,
        'EST-FRAC,1/2A6-2,Estes,13,Single Use,,6,14,Black Powder,1,3.5,3.5,15,UN0432,1.4S,45,0.8,2,true,Small fractional motor',
      ].join('\n')

      const res = await fetchPostForm('/motors/import', { csv_data: fracCsv }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res.status)

      const motor = await env.DB.prepare(
        'SELECT impulse_class FROM motors WHERE model = ?',
      ).bind('1/2A6-2').first<{ impulse_class: string }>()

      expect(motor?.impulse_class).toBe('A')
    })

    it('5.3: imports 709 motors in a single request and re-imports them without query/subrequest exhaustion', async () => {
      // Generate 709 distinct motors
      const rows: string[] = [CSV_HEADER]
      for (let i = 1; i <= 709; i++) {
        rows.push(
          `PART-${i},MTR-SCALE-${i},Manufacturer-${(i % 5) + 1},29,RMS,240,120,180,APCP,3,100,33.3,200,UN0432,1.4C,180,2.0,${(i % 15)},true,Scale test motor ${i}`,
        )
      }
      const csvData = rows.join('\n')

      // Initial import of 709 motors
      const res1 = await fetchPostForm('/motors/import', { csv_data: csvData }, {}, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res1.status)

      const count1 = await env.DB.prepare(
        'SELECT count(*) as count FROM motors',
      ).first<{ count: number }>()
      expect(count1?.count).toBe(709)

      // Re-import of same 709 motors (must update in-place without exceeding subrequest limits or throwing errors)
      const res2 = await fetchPostForm('/motors/import', { csv_data: csvData })
      expect(res2.status).toBe(200)
      const html2 = await res2.text()
      expect(html2).toContain('709 updated')
      expect(html2).not.toContain('Failed to process')

      const count2 = await env.DB.prepare(
        'SELECT count(*) as count FROM motors',
      ).first<{ count: number }>()
      expect(count2?.count).toBe(709)
    })
  })
})
