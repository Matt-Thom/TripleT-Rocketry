/**
 * Integration test suite for Milestone 2 (Requirement R2):
 * Rocket Configuration Snapshots & Active Config Editing.
 *
 * Test Specifications:
 * - Test 1: GET /rockets/:id/configurations/:configId/edit loads pre-populated form with all 13 configuration parameters.
 * - Test 2: POST /rockets/:id/configurations/:configId/edit updates all 13 parameters including notes, CG, CP, motor mount, chutes in D1.
 * - Test 3: Active configuration editing: updates configuration row in D1 AND updates schema.rockets.lengthMm and bodyDiameterMm.
 * - Test 4: Inactive snapshot editing: updates inactive snapshot in D1 but strictly leaves schema.rockets dimensions unchanged.
 * - Test 5: Snapshot history table rendering on GET /rockets/:id: verifies "✏️ Edit" button for every version row.
 * - Test 6: Active configuration spotlight rendering on GET /rockets/:id: verifies direct "✏️ Edit Active Configuration" button.
 * - Test 7: Metric card visual decoupling on GET /rockets/:id: verifies separate cards for "Motor Mount Diameter" and "Recovery / Chutes", and absence of combined "Motor Mount / Chute" tile.
 */

import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import { signSession } from '../../src/services/auth'
import {
  getDb,
  seedTestConfig,
  seedTestRocket,
  seedTestUser,
  truncateDb,
} from '../helpers/db'
import {
  assertContains,
  assertHasFormField,
  assertHtmlResponse,
  assertNotContains,
} from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'

beforeEach(truncateDb)

describe('Milestone 2: Rocket Configuration Snapshots & Active Config Editing (R2)', () => {
  // ==========================================================================
  // Test 1: GET /rockets/:id/configurations/:configId/edit loads pre-populated form
  // ==========================================================================
  describe('Test 1: GET /rockets/:id/configurations/:configId/edit Pre-populated Edit Form', () => {
    it('loads pre-populated edit form containing all 13 configuration parameters for an existing snapshot', async () => {
      const flyer = await seedTestUser({ displayName: 'Snapshot Specialist' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Aerotech Arreaux L1',
        status: 'flight_ready',
        lengthMm: 1450.0,
        bodyDiameterMm: 66.0,
      })

      const config = await seedTestConfig(rocket.id, {
        version: 1,
        airframeMaterial: 'Fiberglass',
        finCount: 4,
        dryMassG: 820.0,
        loadedMassG: 1250.0,
        ballastG: 45.0,
        lengthMm: 1450.0,
        bodyDiameterMm: 66.0,
        cgMm: 780.0,
        cpMm: 920.0,
        stabilityCalibers: 2.12,
        recoveryType: 'dual_deploy',
        parachuteSizeMm: 900.0,
        drogueParachuteSizeMm: 350.0,
        motorMountDiameterMm: 38.0,
        notes: 'Initial dual deployment test build with 38mm motor adapter',
        isCurrent: true,
      })

      const res = await fetchGet(
        `/rockets/${rocket.id}/configurations/${config.id}/edit`,
        { Cookie: cookie },
      )

      assertHtmlResponse(res, 200)
      const html = await res.text()

      // 1. Form tag and target action verification
      expect(html).toMatch(
        new RegExp(`action=["']/rockets/${rocket.id}/configurations/${config.id}/edit["']`, 'i'),
      )
      expect(html).toMatch(/method=["']POST["']/i)

      // 2. Heading, breadcrumbs and version context
      expect(html).toMatch(/Edit Configuration Snapshot|Editing Configuration Snapshot/i)
      assertContains(html, 'v1', rocket.name)

      // 3. Pre-populated values for all 13 configuration parameters
      // Parameter 1: Dry Mass
      assertHasFormField(html, 'dry_mass_g')
      expect(html).toMatch(/name=["']dry_mass_g["'][^>]*value=["']820(\.0)?["']/i)

      // Parameter 2: Loaded Mass
      assertHasFormField(html, 'loaded_mass_g')
      expect(html).toMatch(/name=["']loaded_mass_g["'][^>]*value=["']1250(\.0)?["']/i)

      // Parameter 3: Ballast Mass
      assertHasFormField(html, 'ballast_g')
      expect(html).toMatch(/name=["']ballast_g["'][^>]*value=["']45(\.0)?["']/i)

      // Parameter 4: Length
      assertHasFormField(html, 'length_mm')
      expect(html).toMatch(/name=["']length_mm["'][^>]*value=["']1450(\.0)?["']/i)

      // Parameter 5: Body Diameter
      assertHasFormField(html, 'body_diameter_mm')
      expect(html).toMatch(/name=["']body_diameter_mm["'][^>]*value=["']66(\.0)?["']/i)

      // Parameter 6: Center of Gravity (CG) + Reference datum
      assertHasFormField(html, 'cg_mm')
      expect(html).toMatch(/name=["']cg_mm["'][^>]*value=["']780(\.0)?["']/i)
      assertContains(html, 'Distance from Nose Cone Tip')

      // Parameter 7: Center of Pressure (CP) + Reference datum
      assertHasFormField(html, 'cp_mm')
      expect(html).toMatch(/name=["']cp_mm["'][^>]*value=["']920(\.0)?["']/i)

      // Parameter 8: Stability Calibers
      assertHasFormField(html, 'stability_calibers')
      expect(html).toMatch(/name=["']stability_calibers["'][^>]*value=["']2.12["']/i)

      // Parameter 9: Recovery Type (Dropdown with dual_deploy selected)
      assertHasFormField(html, 'recovery_type')
      expect(html).toMatch(/<option[^>]*value=["']dual_deploy["'][^>]*selected/i)

      // Parameter 10: Parachute Size
      assertHasFormField(html, 'parachute_size_mm')
      expect(html).toMatch(/name=["']parachute_size_mm["'][^>]*value=["']900(\.0)?["']/i)

      // Parameter 11: Drogue Parachute Size
      assertHasFormField(html, 'drogue_parachute_size_mm')
      expect(html).toMatch(/name=["']drogue_parachute_size_mm["'][^>]*value=["']350(\.0)?["']/i)

      // Parameter 12: Motor Mount Diameter
      assertHasFormField(html, 'motor_mount_diameter_mm')
      expect(html).toMatch(/name=["']motor_mount_diameter_mm["'][^>]*value=["']38(\.0)?["']/i)

      // Parameter 13: Configuration Notes
      assertHasFormField(html, 'notes')
      assertContains(html, 'Initial dual deployment test build with 38mm motor adapter')

      // 4. Auxiliary configuration fields
      assertHasFormField(html, 'airframe_material')
      expect(html).toMatch(/name=["']airframe_material["'][^>]*value=["']Fiberglass["']/i)
      assertHasFormField(html, 'fin_count')
      expect(html).toMatch(/name=["']fin_count["'][^>]*value=["']4["']/i)

      // 5. Navigation safety
      expect(html).toMatch(new RegExp(`href=["']/rockets/${rocket.id}["']`, 'i'))
    })

    it('returns HTTP 404 when requested rocket or configuration snapshot does not exist', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`
      const rocket = await seedTestRocket(flyer.id, { name: 'Valid Airframe' })

      // Invalid config ID
      const missingConfigRes = await fetchGet(
        `/rockets/${rocket.id}/configurations/00000000-0000-0000-0000-000000000000/edit`,
        { Cookie: cookie },
      )
      expect(missingConfigRes.status).toBe(404)
      const configText = await missingConfigRes.text()
      expect(configText).toMatch(/Configuration snapshot not found/i)

      // Invalid rocket ID
      const missingRocketRes = await fetchGet(
        `/rockets/00000000-0000-0000-0000-000000000000/configurations/11111111-1111-1111-1111-111111111111/edit`,
        { Cookie: cookie },
      )
      expect(missingRocketRes.status).toBe(404)
      const rocketText = await missingRocketRes.text()
      expect(rocketText).toMatch(/Rocket not found/i)
    })
  })

  // ==========================================================================
  // Test 2: POST /rockets/:id/configurations/:configId/edit updates all 13 parameters
  // ==========================================================================
  describe('Test 2: POST /rockets/:id/configurations/:configId/edit Parameter Update & D1 Persistence', () => {
    it('updates all 13 parameters including notes, CG, CP, motor mount, chute sizes, and persists to D1', async () => {
      const flyer = await seedTestUser({ displayName: 'Flight Dynamics Engineer' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Mach Buster IV',
        lengthMm: 1200.0,
        bodyDiameterMm: 54.0,
      })

      const config = await seedTestConfig(rocket.id, {
        version: 1,
        airframeMaterial: 'Kraft Phenolic',
        finCount: 3,
        dryMassG: 600.0,
        loadedMassG: 950.0,
        ballastG: 20.0,
        lengthMm: 1200.0,
        bodyDiameterMm: 54.0,
        cgMm: 650.0,
        cpMm: 780.0,
        stabilityCalibers: 2.4,
        recoveryType: 'parachute',
        parachuteSizeMm: 600.0,
        motorMountDiameterMm: 29.0,
        notes: 'Baseline configuration',
        isCurrent: true,
      })

      const updatedPayload = {
        airframe_material: 'Carbon Fiber',
        fin_count: 4,
        dry_mass_g: 680.5,
        loaded_mass_g: 1100.0,
        ballast_g: 50.0,
        length_mm: 1350.0,
        body_diameter_mm: 58.0,
        cg_mm: 710.0,
        cp_mm: 840.0,
        stability_calibers: 2.24,
        recovery_type: 'dual_deploy',
        parachute_size_mm: 800.0,
        drogue_parachute_size_mm: 300.0,
        motor_mount_diameter_mm: 54.0,
        notes: 'Upgraded to dual deploy with 54mm motor tube and tip-to-tip carbon fins',
      }

      const res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${config.id}/edit`,
        updatedPayload,
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      // Direct verification of D1 SQLite database persistence
      const db = getDb()
      const [persisted] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, config.id))

      expect(persisted).toBeDefined()
      expect(persisted.airframeMaterial).toBe('Carbon Fiber')
      expect(persisted.finCount).toBe(4)
      expect(persisted.dryMassG).toBeCloseTo(680.5)
      expect(persisted.loadedMassG).toBeCloseTo(1100.0)
      expect(persisted.ballastG).toBeCloseTo(50.0)
      expect(persisted.lengthMm).toBeCloseTo(1350.0)
      expect(persisted.bodyDiameterMm).toBeCloseTo(58.0)
      expect(persisted.cgMm).toBeCloseTo(710.0)
      expect(persisted.cpMm).toBeCloseTo(840.0)
      expect(persisted.stabilityCalibers).toBeCloseTo(2.24)
      expect(persisted.recoveryType).toBe('dual_deploy')
      expect(persisted.parachuteSizeMm).toBeCloseTo(800.0)
      expect(persisted.drogueParachuteSizeMm).toBeCloseTo(300.0)
      expect(persisted.motorMountDiameterMm).toBeCloseTo(54.0)
      expect(persisted.notes).toBe(
        'Upgraded to dual deploy with 54mm motor tube and tip-to-tip carbon fins',
      )
    })
  })

  // ==========================================================================
  // Test 3: Active configuration editing synchronizes schema.rockets
  // ==========================================================================
  describe('Test 3: Active Configuration Editing Synchronizes Parent Airframe Dimensions', () => {
    it('updates configuration row in D1 AND synchronizes schema.rockets.lengthMm and bodyDiameterMm', async () => {
      const flyer = await seedTestUser({ displayName: 'Airframe Architect' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Pegasus Heavy',
        lengthMm: 1600.0,
        bodyDiameterMm: 75.0,
      })

      const activeConfig = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1600.0,
        bodyDiameterMm: 75.0,
        dryMassG: 1200.0,
        isCurrent: true,
      })

      const res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${activeConfig.id}/edit`,
        {
          length_mm: 1750.0,
          body_diameter_mm: 80.0,
          dry_mass_g: 1350.0,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()

      // 1. Verify Configuration record in D1
      const [updatedConfig] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, activeConfig.id))

      expect(updatedConfig.lengthMm).toBeCloseTo(1750.0)
      expect(updatedConfig.bodyDiameterMm).toBeCloseTo(80.0)
      expect(updatedConfig.dryMassG).toBeCloseTo(1350.0)

      // 2. Verify Parent Rocket record in D1 is synchronized
      const [parentRocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocket.id))

      expect(parentRocket.lengthMm).toBeCloseTo(1750.0)
      expect(parentRocket.bodyDiameterMm).toBeCloseTo(80.0)

      // 3. Verify GET /rockets/:id displays updated dimensions in spotlight
      const detailRes = await fetchGet(`/rockets/${rocket.id}`, { Cookie: cookie })
      assertHtmlResponse(detailRes, 200)
      const html = await detailRes.text()
      assertContains(html, '1750 mm', '80 mm')
    })
  })

  // ==========================================================================
  // Test 4: Inactive snapshot editing leaves schema.rockets unchanged
  // ==========================================================================
  describe('Test 4: Inactive Snapshot Editing Strictly Leaves Parent Airframe Dimensions Unchanged', () => {
    it('updates inactive snapshot in D1 but strictly leaves schema.rockets.lengthMm and bodyDiameterMm unchanged', async () => {
      const flyer = await seedTestUser({ displayName: 'Archival Inspector' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Chronos Modular',
        lengthMm: 2100.0,
        bodyDiameterMm: 102.0,
      })

      // Seed historical Version 1 (inactive)
      const configV1 = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1800.0,
        bodyDiameterMm: 98.0,
        notes: 'Early prototype with shorter airframe',
        isCurrent: false,
      })

      // Seed current Version 2 (active)
      const configV2 = await seedTestConfig(rocket.id, {
        version: 2,
        lengthMm: 2100.0,
        bodyDiameterMm: 102.0,
        notes: 'Stretched booster airframe',
        isCurrent: true,
      })

      // Edit historical inactive snapshot v1
      const res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${configV1.id}/edit`,
        {
          length_mm: 1820.0,
          body_diameter_mm: 98.0,
          notes: 'Corrected measurement for prototype v1',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()

      // 1. Inactive snapshot v1 updated in D1
      const [updatedV1] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, configV1.id))

      expect(updatedV1.lengthMm).toBeCloseTo(1820.0)
      expect(updatedV1.notes).toBe('Corrected measurement for prototype v1')
      expect(updatedV1.isCurrent).toBe(false)

      // 2. Active snapshot v2 remains untouched in D1
      const [untouchedV2] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, configV2.id))

      expect(untouchedV2.lengthMm).toBeCloseTo(2100.0)
      expect(untouchedV2.bodyDiameterMm).toBeCloseTo(102.0)
      expect(untouchedV2.isCurrent).toBe(true)

      // 3. Parent rocket airframe MUST strictly retain active v2 dimensions
      const [parentRocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocket.id))

      expect(parentRocket.lengthMm).toBeCloseTo(2100.0)
      expect(parentRocket.bodyDiameterMm).toBeCloseTo(102.0)
    })
  })

  // ==========================================================================
  // Test 5: Snapshot history table rendering on GET /rockets/:id
  // ==========================================================================
  describe('Test 5: Snapshot History Table Action Buttons Rendering on GET /rockets/:id', () => {
    it('verifies presence of "✏️ Edit" action button for every configuration version in the history table', async () => {
      const flyer = await seedTestUser({ displayName: 'Fleet Commander' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Evolutionary Titan' })

      const v1 = await seedTestConfig(rocket.id, {
        version: 1,
        dryMassG: 500.0,
        isCurrent: false,
      })
      const v2 = await seedTestConfig(rocket.id, {
        version: 2,
        dryMassG: 560.0,
        isCurrent: false,
      })
      const v3 = await seedTestConfig(rocket.id, {
        version: 3,
        dryMassG: 610.0,
        isCurrent: true,
      })

      const res = await fetchGet(`/rockets/${rocket.id}`, { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Verify table action button exists for Version 1
      const v1EditPattern = new RegExp(
        `href=["']/rockets/${rocket.id}/configurations/${v1.id}/edit["'][^>]*>\\s*(✏️\\s*)?Edit`,
        'i',
      )
      expect(html).toMatch(v1EditPattern)

      // Verify table action button exists for Version 2
      const v2EditPattern = new RegExp(
        `href=["']/rockets/${rocket.id}/configurations/${v2.id}/edit["'][^>]*>\\s*(✏️\\s*)?Edit`,
        'i',
      )
      expect(html).toMatch(v2EditPattern)

      // Verify table action button exists for Version 3
      const v3EditPattern = new RegExp(
        `href=["']/rockets/${rocket.id}/configurations/${v3.id}/edit["'][^>]*>\\s*(✏️\\s*)?Edit`,
        'i',
      )
      expect(html).toMatch(v3EditPattern)

      // Ensure "+ New Snapshot" branch button is also preserved in actions column
      assertContains(html, '+ New Snapshot')
    })
  })

  // ==========================================================================
  // Test 6: Active configuration spotlight rendering on GET /rockets/:id
  // ==========================================================================
  describe('Test 6: Active Configuration Spotlight Direct Edit Button on GET /rockets/:id', () => {
    it('verifies presence of direct "✏️ Edit Active Configuration" button in active spotlight', async () => {
      const flyer = await seedTestUser({ displayName: 'Range Operations Lead' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Vanguard High-Power' })
      const activeConfig = await seedTestConfig(rocket.id, {
        version: 2,
        lengthMm: 1500.0,
        bodyDiameterMm: 75.0,
        isCurrent: true,
      })

      const res = await fetchGet(`/rockets/${rocket.id}`, { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Verify active configuration spotlight heading exists
      assertContains(html, 'Active Configuration Spotlight')

      // Verify direct "✏️ Edit Active Configuration" button links to active config edit form
      const spotlightEditPattern = new RegExp(
        `href=["']/rockets/${rocket.id}/configurations/${activeConfig.id}/edit["'][^>]*>\\s*(✏️\\s*)?Edit Active Configuration`,
        'i',
      )
      expect(html).toMatch(spotlightEditPattern)
    })
  })

  // ==========================================================================
  // Test 7: Metric card visual decoupling on GET /rockets/:id
  // ==========================================================================
  describe('Test 7: Metric Card Visual Decoupling on GET /rockets/:id', () => {
    it('verifies separate cards for "Motor Mount Diameter" and "Recovery / Chutes", and absence of combined "Motor Mount / Chute" tile', async () => {
      const flyer = await seedTestUser({ displayName: 'UI Precision Specialist' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'AeroTech Mirage Decoupled' })
      await seedTestConfig(rocket.id, {
        version: 1,
        motorMountDiameterMm: 54.0,
        recoveryType: 'dual_deploy',
        parachuteSizeMm: 1200.0,
        drogueParachuteSizeMm: 400.0,
        isCurrent: true,
      })

      const res = await fetchGet(`/rockets/${rocket.id}`, { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // 1. Verify separate "Motor Mount Diameter" card exists
      assertContains(html, 'Motor Mount Diameter')
      expect(html).toMatch(/54(\.0)?\s*mm/i)

      // 2. Verify separate "Recovery / Chutes" card exists
      expect(html).toMatch(/Recovery\s*\/\s*Chutes|Recovery/i)
      expect(html).toMatch(/Dual[ _-]?Deploy/i)
      expect(html).toMatch(/Main:\s*1200(\.0)?\s*mm/i)
      expect(html).toMatch(/Drogue:\s*400(\.0)?\s*mm/i)

      // 3. Verify ABSENCE of the old fused "Motor Mount / Chute" tile header
      assertNotContains(html, 'Motor Mount / Chute')
    })
  })
})
