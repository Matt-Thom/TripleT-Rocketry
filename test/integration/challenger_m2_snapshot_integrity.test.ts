/**
 * Empirical Adversarial Test Suite: Milestone 2 Snapshot Integrity
 *
 * Requirements Stress-Tested (ORIGINAL_REQUEST R2 & M2 Scope):
 * 1. Security & Cross-Rocket Isolation:
 *    - GET /rockets/:id/configurations/:otherRocketConfigId/edit must return 404 (not 200 or 500).
 *    - POST /rockets/:id/configurations/:otherRocketConfigId/edit must return 404 and make zero modifications.
 *    - Non-existent rocket ID and non-existent config ID return 404 without crashing.
 * 2. Inactive Snapshot Editing Isolation:
 *    - Rocket X has Active config v2 (1500mm, 75mm) and Inactive config v1 (1000mm, 54mm).
 *    - Edit v1 to 1100mm, 60mm. Verify v1 updates in D1, but parent schema.rockets retains 1500mm, 75mm intact.
 * 3. Boundary Values & Robustness:
 *    - Empty string notes explicitly resetting notes to null.
 *    - Whitespace-only notes explicitly resetting notes to null.
 *    - Very long textual notes (5,000+ chars) with multiline text, special characters, and emojis.
 *    - Partial updates modifying only notes without overwriting other snapshot parameters.
 *    - Partial updates modifying only cg_mm without overwriting other snapshot parameters.
 *    - JSON and form partial updates verifying identical non-destructive behavior.
 */

import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { SELF } from 'cloudflare:test'
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
  assertHtmlResponse,
} from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'

beforeEach(truncateDb)

async function fetchPostJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `https://example.com${path}`
  return await SELF.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe('Adversarial Challenge: Milestone 2 Snapshot Integrity (Requirement R2)', () => {
  // ==========================================================================
  // Section 1: Security & Cross-Rocket Isolation
  // ==========================================================================
  describe('1. Security & Cross-Rocket Isolation', () => {
    it('returns HTTP 404 when attempting GET /rockets/:id/configurations/:otherRocketConfigId/edit across airframes', async () => {
      const flyer = await seedTestUser({ displayName: 'Isolation Tester' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      // Rocket A with Config A1
      const rocketA = await seedTestRocket(flyer.id, {
        name: 'Rocket Alpha',
        lengthMm: 1000.0,
        bodyDiameterMm: 54.0,
      })
      const configA1 = await seedTestConfig(rocketA.id, {
        version: 1,
        lengthMm: 1000.0,
        bodyDiameterMm: 54.0,
        isCurrent: true,
      })

      // Rocket B with Config B1
      const rocketB = await seedTestRocket(flyer.id, {
        name: 'Rocket Beta',
        lengthMm: 1400.0,
        bodyDiameterMm: 66.0,
      })
      const configB1 = await seedTestConfig(rocketB.id, {
        version: 1,
        lengthMm: 1400.0,
        bodyDiameterMm: 66.0,
        isCurrent: true,
      })

      // Attacker queries Rocket A with Config B1's ID
      const res = await fetchGet(
        `/rockets/${rocketA.id}/configurations/${configB1.id}/edit`,
        { Cookie: cookie },
      )

      expect(res.status).toBe(404)
      const text = await res.text()
      expect(text).toMatch(/Configuration snapshot not found/i)
      // Must not return 200 or 500
      expect(res.status).not.toBe(200)
      expect(res.status).not.toBe(500)
    })

    it('returns HTTP 404 and makes zero modifications when attempting POST /rockets/:id/configurations/:otherRocketConfigId/edit', async () => {
      const flyer = await seedTestUser({ displayName: 'Tamper Prevention Tester' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      // Rocket A with Config A1
      const rocketA = await seedTestRocket(flyer.id, {
        name: 'Target Airframe A',
        lengthMm: 1100.0,
        bodyDiameterMm: 54.0,
      })
      const configA1 = await seedTestConfig(rocketA.id, {
        version: 1,
        dryMassG: 500.0,
        lengthMm: 1100.0,
        bodyDiameterMm: 54.0,
        notes: 'Original Config A1 notes',
        isCurrent: true,
      })

      // Rocket B with Config B1
      const rocketB = await seedTestRocket(flyer.id, {
        name: 'Victim Airframe B',
        lengthMm: 1600.0,
        bodyDiameterMm: 75.0,
      })
      const configB1 = await seedTestConfig(rocketB.id, {
        version: 1,
        dryMassG: 900.0,
        lengthMm: 1600.0,
        bodyDiameterMm: 75.0,
        notes: 'Original Config B1 notes',
        isCurrent: true,
      })

      // Adversary attempts cross-rocket overwrite via form post
      const attackRes = await fetchPostForm(
        `/rockets/${rocketA.id}/configurations/${configB1.id}/edit`,
        {
          dry_mass_g: 9999.0,
          length_mm: 9999.0,
          body_diameter_mm: 999.0,
          notes: 'EXPLOITED_CROSS_ROCKET',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect(attackRes.status).toBe(404)
      const attackText = await attackRes.text()
      expect(attackText).toMatch(/Configuration snapshot not found/i)

      // Verify ZERO modifications occurred in D1 database
      const db = getDb()

      // 1. Config B1 must remain completely untouched
      const [persistedB1] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, configB1.id))

      expect(persistedB1).toBeDefined()
      expect(persistedB1.dryMassG).toBeCloseTo(900.0)
      expect(persistedB1.lengthMm).toBeCloseTo(1600.0)
      expect(persistedB1.bodyDiameterMm).toBeCloseTo(75.0)
      expect(persistedB1.notes).toBe('Original Config B1 notes')

      // 2. Config A1 must remain completely untouched
      const [persistedA1] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, configA1.id))

      expect(persistedA1).toBeDefined()
      expect(persistedA1.dryMassG).toBeCloseTo(500.0)
      expect(persistedA1.lengthMm).toBeCloseTo(1100.0)
      expect(persistedA1.bodyDiameterMm).toBeCloseTo(54.0)
      expect(persistedA1.notes).toBe('Original Config A1 notes')

      // 3. Parent Rockets A and B must retain original airframe dimensions
      const [persistedRocketA] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocketA.id))
      expect(persistedRocketA.lengthMm).toBeCloseTo(1100.0)
      expect(persistedRocketA.bodyDiameterMm).toBeCloseTo(54.0)

      const [persistedRocketB] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocketB.id))
      expect(persistedRocketB.lengthMm).toBeCloseTo(1600.0)
      expect(persistedRocketB.bodyDiameterMm).toBeCloseTo(75.0)
    })

    it('returns HTTP 404 and makes zero modifications for non-existent rocket ID or non-existent config ID', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Sentinel Rocket' })
      const config = await seedTestConfig(rocket.id, { version: 1, notes: 'Sentinel note' })

      const nonExistentUuid = 'ffffffff-ffff-4fff-afff-ffffffffffff'

      // Non-existent config on valid rocket
      const res1 = await fetchGet(
        `/rockets/${rocket.id}/configurations/${nonExistentUuid}/edit`,
        { Cookie: cookie },
      )
      expect(res1.status).toBe(404)

      const res2 = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${nonExistentUuid}/edit`,
        { notes: 'tamper' },
        { Cookie: cookie },
      )
      expect(res2.status).toBe(404)

      // Non-existent rocket on valid config
      const res3 = await fetchGet(
        `/rockets/${nonExistentUuid}/configurations/${config.id}/edit`,
        { Cookie: cookie },
      )
      expect(res3.status).toBe(404)

      const res4 = await fetchPostForm(
        `/rockets/${nonExistentUuid}/configurations/${config.id}/edit`,
        { notes: 'tamper' },
        { Cookie: cookie },
      )
      expect(res4.status).toBe(404)

      // Both non-existent
      const res5 = await fetchGet(
        `/rockets/${nonExistentUuid}/configurations/${nonExistentUuid}/edit`,
        { Cookie: cookie },
      )
      expect(res5.status).toBe(404)

      // Verify config was not touched
      const db = getDb()
      const [persisted] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, config.id))
      expect(persisted.notes).toBe('Sentinel note')
    })
  })

  // ==========================================================================
  // Section 2: Inactive Snapshot Editing Isolation
  // ==========================================================================
  describe('2. Inactive Snapshot Editing Isolation', () => {
    it('updates v1 in D1 when editing inactive v1 (1000mm, 54mm -> 1100mm, 60mm), while parent schema.rockets strictly retains active v2 dimensions (1500mm, 75mm)', async () => {
      const flyer = await seedTestUser({ displayName: 'Snapshot Isolation Specialist' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      // Rocket X established with parent dimensions matching Active Config v2
      const rocketX = await seedTestRocket(flyer.id, {
        name: 'Rocket X',
        lengthMm: 1500.0,
        bodyDiameterMm: 75.0,
      })

      // Inactive config v1 (length 1000mm, diameter 54mm, isCurrent = false)
      const configV1 = await seedTestConfig(rocketX.id, {
        version: 1,
        lengthMm: 1000.0,
        bodyDiameterMm: 54.0,
        dryMassG: 450.0,
        notes: 'Prototype airframe v1',
        isCurrent: false,
      })

      // Active config v2 (length 1500mm, diameter 75mm, isCurrent = true)
      const configV2 = await seedTestConfig(rocketX.id, {
        version: 2,
        lengthMm: 1500.0,
        bodyDiameterMm: 75.0,
        dryMassG: 950.0,
        notes: 'Stretched operational airframe v2',
        isCurrent: true,
      })

      // Edit v1 to length 1100mm, diameter 60mm
      const editRes = await fetchPostForm(
        `/rockets/${rocketX.id}/configurations/${configV1.id}/edit`,
        {
          length_mm: 1100.0,
          body_diameter_mm: 60.0,
          notes: 'Updated prototype v1 airframe specifications',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(editRes.status)

      const db = getDb()

      // 1. Verify v1 configuration snapshot in D1 is updated
      const [updatedV1] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, configV1.id))

      expect(updatedV1).toBeDefined()
      expect(updatedV1.lengthMm).toBeCloseTo(1100.0)
      expect(updatedV1.bodyDiameterMm).toBeCloseTo(60.0)
      expect(updatedV1.notes).toBe('Updated prototype v1 airframe specifications')
      expect(updatedV1.isCurrent).toBe(false)

      // 2. Verify active config v2 snapshot remains completely intact
      const [activeV2] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, configV2.id))

      expect(activeV2).toBeDefined()
      expect(activeV2.lengthMm).toBeCloseTo(1500.0)
      expect(activeV2.bodyDiameterMm).toBeCloseTo(75.0)
      expect(activeV2.isCurrent).toBe(true)

      // 3. Verify parent schema.rockets retains length 1500mm and diameter 75mm intact
      const [parentRocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocketX.id))

      expect(parentRocket).toBeDefined()
      expect(parentRocket.lengthMm).toBeCloseTo(1500.0)
      expect(parentRocket.bodyDiameterMm).toBeCloseTo(75.0)

      // 4. Verify GET /rockets/:id displays active v2 dimensions in spotlight view
      const detailRes = await fetchGet(`/rockets/${rocketX.id}`, { Cookie: cookie })
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()
      assertContains(detailHtml, '1500 mm', '75 mm')
    })
  })

  // ==========================================================================
  // Section 3: Boundary Values & Robustness
  // ==========================================================================
  describe('3. Boundary Values & Partial Updates', () => {
    it('explicitly resets notes to null when submitting an empty string or whitespace', async () => {
      const flyer = await seedTestUser({ displayName: 'Null Reset Tester' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Notes Boundary Airframe' })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        notes: 'Pre-existing configuration note that should be cleared',
        isCurrent: true,
      })

      // 1. Submit empty string notes: ""
      const res1 = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${config.id}/edit`,
        { notes: '' },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(res1.status)

      const db = getDb()
      const [afterEmpty] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, config.id))

      expect(afterEmpty.notes).toBeNull()

      // Re-seed a note
      await db
        .update(schema.rocketConfigurations)
        .set({ notes: 'Another note to clear' })
        .where(eq(schema.rocketConfigurations.id, config.id))

      // 2. Submit whitespace-only notes: "   \t \n  "
      const res2 = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${config.id}/edit`,
        { notes: '   \t  \n  ' },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(res2.status)

      const [afterWhitespace] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, config.id))

      expect(afterWhitespace.notes).toBeNull()
    })

    it('persists very long textual notes (5,000+ chars) with multiline text, special characters, and emojis without data corruption', async () => {
      const flyer = await seedTestUser({ displayName: 'Boundary Stress Tester' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Payload Extreme Airframe' })
      const config = await seedTestConfig(rocket.id, { version: 1, isCurrent: true })

      // Construct 5,000+ character rich adversarial text
      const paragraph = [
        '# Flight Configuration & Telemetry Dossier — Version 1.0.0-RC3',
        'Payload bay integration with dual Raven 4 altimeters and TeleMetrum GPS beacon.',
        'Dangerous character checks: <script>alert("XSS_CHALLENGE")</script> & <div class="test">',
        'Quotes & slashes test: "Double Quotes", \'Single Quotes\', `Backticks`, \\ Backslash, / Slash.',
        'SQL Injection vectors: \'; DROP TABLE rocket_configurations; -- AND \'1\'=\'1\'',
        'Unicode & International: 日本語テキスト, Русский текст, العربية, עברית, Français avec accents éàç.',
        'Symbols & Math: ∑(F_thrust - F_drag) = m * a; √π ≈ 1.7724538509; Δv = I_sp * g_0 * ln(m_0 / m_f).',
        'Emojis & Glyphs: 🚀 🛰️ 🛸 🪐 🌌 🔥 ⚡ 🎯 🏁 💯 ✨ 🛠️ 📐 📊 🛑 ⚠️ 🛡️ 🔍',
      ].join('\n\n')

      let massiveNotes = ''
      while (massiveNotes.length < 5200) {
        massiveNotes += paragraph + '\n\n---\n\n'
      }
      massiveNotes = massiveNotes.slice(0, 5250) + '\n[END OF TELEMETRY RECORD]'

      expect(massiveNotes.length).toBeGreaterThanOrEqual(5000)

      // Post massive notes to configuration edit
      const res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${config.id}/edit`,
        { notes: massiveNotes },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [persisted] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, config.id))

      expect(persisted.notes).toBe(massiveNotes)
      expect(persisted.notes?.length).toBe(massiveNotes.length)

      // Verify GET /rockets/:id displays without 500 error and renders safely
      const getRes = await fetchGet(`/rockets/${rocket.id}`, { Cookie: cookie })
      expect(getRes.status).toBe(200)
    })

    it('performs partial updates modifying only notes without overwriting other snapshot parameters', async () => {
      const flyer = await seedTestUser({ displayName: 'Partial Updater' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Delta Wing Staged',
        lengthMm: 1350.0,
        bodyDiameterMm: 65.0,
      })

      // Establish comprehensive baseline with all fields populated
      const baselineConfig = await seedTestConfig(rocket.id, {
        version: 1,
        airframeMaterial: 'Fiberglass / Carbon Composite',
        finCount: 3,
        dryMassG: 720.5,
        loadedMassG: 1150.0,
        ballastG: 35.0,
        lengthMm: 1350.0,
        bodyDiameterMm: 65.0,
        cgMm: 680.0,
        cpMm: 810.0,
        stabilityCalibers: 2.0,
        recoveryType: 'dual_deploy',
        parachuteSizeMm: 750.0,
        drogueParachuteSizeMm: 300.0,
        motorMountDiameterMm: 38.0,
        notes: 'Initial full parameter baseline',
        isCurrent: true,
      })

      // Submit partial form containing ONLY `notes`
      const res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${baselineConfig.id}/edit`,
        { notes: 'Updated notes only via partial form submission' },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [persisted] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, baselineConfig.id))

      // Notes updated
      expect(persisted.notes).toBe('Updated notes only via partial form submission')

      // All other 13 parameters strictly preserved
      expect(persisted.airframeMaterial).toBe('Fiberglass / Carbon Composite')
      expect(persisted.finCount).toBe(3)
      expect(persisted.dryMassG).toBeCloseTo(720.5)
      expect(persisted.loadedMassG).toBeCloseTo(1150.0)
      expect(persisted.ballastG).toBeCloseTo(35.0)
      expect(persisted.lengthMm).toBeCloseTo(1350.0)
      expect(persisted.bodyDiameterMm).toBeCloseTo(65.0)
      expect(persisted.cgMm).toBeCloseTo(680.0)
      expect(persisted.cpMm).toBeCloseTo(810.0)
      expect(persisted.stabilityCalibers).toBeCloseTo(2.0)
      expect(persisted.recoveryType).toBe('dual_deploy')
      expect(persisted.parachuteSizeMm).toBeCloseTo(750.0)
      expect(persisted.drogueParachuteSizeMm).toBeCloseTo(300.0)
      expect(persisted.motorMountDiameterMm).toBeCloseTo(38.0)
      expect(persisted.isCurrent).toBe(true)
    })

    it('performs partial updates modifying only cg_mm without overwriting notes or other snapshot parameters', async () => {
      const flyer = await seedTestUser({ displayName: 'CG Calibrator' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Aero Probe' })

      const baselineConfig = await seedTestConfig(rocket.id, {
        version: 1,
        airframeMaterial: 'Aluminum',
        finCount: 4,
        dryMassG: 850.0,
        loadedMassG: 1300.0,
        ballastG: 15.0,
        lengthMm: 1600.0,
        bodyDiameterMm: 75.0,
        cgMm: 750.0,
        cpMm: 900.0,
        stabilityCalibers: 2.0,
        recoveryType: 'parachute',
        parachuteSizeMm: 900.0,
        motorMountDiameterMm: 54.0,
        notes: 'Pre-flight measured CG before motor installation',
        isCurrent: true,
      })

      // Submit partial form containing ONLY `cg_mm`
      const res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${baselineConfig.id}/edit`,
        { cg_mm: 768.5 },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [persisted] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, baselineConfig.id))

      // cgMm updated
      expect(persisted.cgMm).toBeCloseTo(768.5)

      // Notes and all other parameters preserved intact
      expect(persisted.notes).toBe('Pre-flight measured CG before motor installation')
      expect(persisted.cpMm).toBeCloseTo(900.0)
      expect(persisted.airframeMaterial).toBe('Aluminum')
      expect(persisted.finCount).toBe(4)
      expect(persisted.dryMassG).toBeCloseTo(850.0)
      expect(persisted.loadedMassG).toBeCloseTo(1300.0)
      expect(persisted.ballastG).toBeCloseTo(15.0)
      expect(persisted.lengthMm).toBeCloseTo(1600.0)
      expect(persisted.bodyDiameterMm).toBeCloseTo(75.0)
      expect(persisted.stabilityCalibers).toBeCloseTo(2.0)
      expect(persisted.recoveryType).toBe('parachute')
      expect(persisted.parachuteSizeMm).toBeCloseTo(900.0)
      expect(persisted.motorMountDiameterMm).toBeCloseTo(54.0)
    })

    it('handles JSON partial updates modifying only notes and returns JSON response { success: true, id: configId }', async () => {
      const flyer = await seedTestUser({ displayName: 'JSON Partial Updater' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'JSON API Airframe' })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        dryMassG: 620.0,
        cgMm: 550.0,
        notes: 'Initial JSON test note',
        isCurrent: true,
      })

      const jsonRes = await fetchPostJson(
        `/rockets/${rocket.id}/configurations/${config.id}/edit`,
        { notes: 'Updated via application/json payload' },
        { Cookie: cookie },
      )

      expect(jsonRes.status).toBe(200)
      const jsonBody = (await jsonRes.json()) as { success: boolean; id: string }
      expect(jsonBody.success).toBe(true)
      expect(jsonBody.id).toBe(config.id)

      const db = getDb()
      const [persisted] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, config.id))

      expect(persisted.notes).toBe('Updated via application/json payload')
      expect(persisted.dryMassG).toBeCloseTo(620.0)
      expect(persisted.cgMm).toBeCloseTo(550.0)
    })
  })
})
