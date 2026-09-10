/**
 * Empirical Adversarial Verification Suite for Milestone 6:
 * Requirement R6: Rocket Airframe Geometry Specifications & Configuration Versioning
 *
 * Verification Objectives:
 * 1. Boundary & Precision Tests on Airframe Dimensions:
 *    - Fractional floating-point dimensions (1234.5 mm, 54.2 mm) persisted and rendered accurately.
 *    - Extreme large-scale HPR dimensions (6500.0 mm, 150.0 mm) without overflow.
 *    - Extreme micro-scale dimensions (150.0 mm, 13.0 mm) without underflow.
 *    - Empty optional fields ('', '   ') stored as null in D1, not '0' or 0, without crash.
 *    - Non-numeric garbage strings parsed safely to null without SQLITE_MISMATCH.
 *    - camelCase fallback parameters (lengthMm, bodyDiameterMm) accepted alongside snake_case.
 * 2. Rocket Airframe Creation & Baseline Versioning:
 *    - Creation with dimensions persists to schema.rockets AND baseline configuration v1.
 *    - Creation with no dimensions and no config data skips empty v1 configuration snapshot.
 *    - Airframe dimension update via POST /rockets/:id updates rocket, preserves historical v1.
 *    - Airframe dimension update via alias POST /rockets/:id/edit.
 *    - Partial updates preserve existing airframe dimensions when omitted.
 *    - Explicit clearing via empty strings resets dimensions to null.
 * 3. Configuration Snapshot Creation, History & Immutability:
 *    - Adding new configuration version sets is_current = true, older version is_current = false.
 *    - Previous configuration version strictly retains historical dimensions (immutability).
 *    - Active configuration snapshot editing updates snapshot AND synchronizes to parent rocket.
 *    - Inactive configuration snapshot editing updates snapshot but DOES NOT overwrite parent rocket.
 *    - Editing configuration snapshot via alias POST /rockets/:id/configurations/:configId/edit.
 *    - Switching active configuration via POST /rockets/:id/configurations/:configId/set-current.
 * 4. Form Rendering & Range Safety / Pad Clearance Inspection:
 *    - GET /rockets/new renders inputs with step="any" and regex-matching labels.
 *    - GET /rockets/:id/edit pre-populates existing dimensions.
 *    - GET /rockets/:id/configurations/new pre-populates dimensions from active config.
 *    - GET /rockets/:id detail view renders metrics in overview banner, spotlight, and history table.
 *    - GET /flights/new preflight config options include data-length and data-diameter.
 * 5. Security, Error Handling & 404 Formats:
 *    - GET /rockets/:invalidId returns 404 HTML ("Airframe Not Found").
 *    - GET /rockets/:invalidId/edit returns 404 plain text ("Rocket not found").
 *    - POST /rockets/:invalidId and /edit return 404 plain text ("Rocket not found").
 *    - Configuration routes on invalid rocket ID return 404 plain text.
 *    - POST /rockets/:id/configurations/:invalidConfigId returns 404 plain text.
 *    - Cross-rocket configuration tampering attack blocked with 404 without data mutation.
 *    - Soft-deleted rockets return 404 and are inaccessible.
 *
 * Authored by Milestone 6 Challenger 1.
 */

import { env } from 'cloudflare:test'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { signSession } from '../src/services/auth'
import {
  getDb,
  seedTestConfig,
  seedTestRocket,
  seedTestUser,
  truncateDb,
} from './helpers/db'
import { assertContains, assertHasFormField, assertHtmlResponse } from './helpers/html'
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

describe('Milestone 6 Empirical Adversarial Suite: Rocket Airframe Dimensions & Versioning (R6)', () => {
  // ============================================================================
  // 1. Boundary & Precision Tests on Airframe Dimensions
  // ============================================================================
  describe('1. Boundary & Precision Tests on Airframe Dimensions', () => {
    it('1.1: fractional floating-point dimensions (1234.5 mm, 54.2 mm) persist accurately in D1 and render formatted', async () => {
      const flyer = await seedTestUser({ displayName: 'Precision Pilot' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const res = await fetchPostForm(
        '/rockets',
        {
          name: 'Precision Falcon',
          length_mm: 1234.5,
          body_diameter_mm: 54.2,
          status: 'flight_ready',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 201, 302, 303]).toContain(res.status)

      // Direct D1 verification on rockets table
      const db = getDb()
      const [rocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.name, 'Precision Falcon'))

      expect(rocket).toBeDefined()
      expect(rocket.lengthMm).toBe(1234.5)
      expect(rocket.bodyDiameterMm).toBe(54.2)

      // Baseline v1 configuration must also store fractional dimensions
      const [config] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))

      expect(config).toBeDefined()
      expect(config.version).toBe(1)
      expect(config.lengthMm).toBe(1234.5)
      expect(config.bodyDiameterMm).toBe(54.2)

      // Verify HTML detail view renders both mm and cm
      const detailRes = await fetchGet(`/rockets/${rocket.id}`, { Cookie: cookie })
      assertHtmlResponse(detailRes, 200)
      const html = await detailRes.text()
      expect(html).toContain('1234.5 mm')
      expect(html).toContain('123.5 cm')
      expect(html).toContain('54.2 mm')
      expect(html).toContain('5.4 cm')
    })

    it('1.2: extreme large-scale HPR dimensions (6500.0 mm, 150.0 mm) persist and render without overflow', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const res = await fetchPostForm(
        '/rockets',
        {
          name: 'Leviathan Heavy',
          length_mm: 6500.0,
          body_diameter_mm: 150.0,
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
        .where(eq(schema.rockets.name, 'Leviathan Heavy'))

      expect(rocket.lengthMm).toBe(6500.0)
      expect(rocket.bodyDiameterMm).toBe(150.0)

      const detailRes = await fetchGet(`/rockets/${rocket.id}`, { Cookie: cookie })
      const html = await detailRes.text()
      expect(html).toContain('6500 mm')
      expect(html).toContain('650.0 cm')
      expect(html).toContain('150 mm')
      expect(html).toContain('15.0 cm')
    })

    it('1.3: extreme micro-scale dimensions (150.0 mm, 13.0 mm) persist and render without underflow', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const res = await fetchPostForm(
        '/rockets',
        {
          name: 'Micro Dart',
          length_mm: 150.0,
          body_diameter_mm: 13.0,
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
        .where(eq(schema.rockets.name, 'Micro Dart'))

      expect(rocket.lengthMm).toBe(150.0)
      expect(rocket.bodyDiameterMm).toBe(13.0)

      const detailRes = await fetchGet(`/rockets/${rocket.id}`, { Cookie: cookie })
      const html = await detailRes.text()
      expect(html).toContain('150 mm')
      expect(html).toContain('15.0 cm')
      expect(html).toContain('13 mm')
      expect(html).toContain('1.3 cm')
    })

    it('1.4: empty optional fields ("", "   ") store as null in D1 and do not coerce to 0 or crash', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const res = await fetchPostForm(
        '/rockets',
        {
          name: 'Null Dimensions Airframe',
          length_mm: '',
          body_diameter_mm: '   ',
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
        .where(eq(schema.rockets.name, 'Null Dimensions Airframe'))

      expect(rocket).toBeDefined()
      // STRICT ASSERTION: must be null, NEVER 0 or NaN
      expect(rocket.lengthMm).toBeNull()
      expect(rocket.bodyDiameterMm).toBeNull()

      // Verify HTML renders fallback dash '—' and does NOT render '0 mm' or 'NaN'
      const detailRes = await fetchGet(`/rockets/${rocket.id}`, { Cookie: cookie })
      const html = await detailRes.text()
      expect(html).not.toMatch(/NaN/)
      expect(html).not.toMatch(/\b0\s*mm\b/)
      expect(html).toContain('—')
    })

    it('1.5: garbage non-numeric strings ("invalid_val") parse safely to null without database crash', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const res = await fetchPostForm(
        '/rockets',
        {
          name: 'Garbage Input Rocket',
          length_mm: 'not_a_number',
          body_diameter_mm: 'xyz-corrupt',
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
        .where(eq(schema.rockets.name, 'Garbage Input Rocket'))

      expect(rocket.lengthMm).toBeNull()
      expect(rocket.bodyDiameterMm).toBeNull()
    })

    it('1.6: camelCase parameters (lengthMm, bodyDiameterMm) are supported as fallback', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const res = await fetchPostForm(
        '/rockets',
        {
          name: 'CamelCase Geometry Rocket',
          lengthMm: 1100.0,
          bodyDiameterMm: 68.0,
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
        .where(eq(schema.rockets.name, 'CamelCase Geometry Rocket'))

      expect(rocket.lengthMm).toBe(1100.0)
      expect(rocket.bodyDiameterMm).toBe(68.0)
    })
  })

  // ============================================================================
  // 2. Rocket Airframe Creation & Baseline Versioning
  // ============================================================================
  describe('2. Rocket Airframe Creation & Baseline Versioning', () => {
    it('2.1: creating rocket with dimensions triggers baseline configuration v1 creation', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      // Create with dimensions only (no mass, fin count, or recovery)
      const res = await fetchPostForm(
        '/rockets',
        {
          name: 'Dimension Only Rocket',
          length_mm: 1450.0,
          body_diameter_mm: 76.0,
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
        .where(eq(schema.rockets.name, 'Dimension Only Rocket'))

      expect(rocket).toBeDefined()

      // Configuration snapshot v1 must have been created because hasConfigData detects dimensions
      const configs = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))

      expect(configs.length).toBe(1)
      expect(configs[0].version).toBe(1)
      expect(configs[0].isCurrent).toBe(true)
      expect(configs[0].lengthMm).toBe(1450.0)
      expect(configs[0].bodyDiameterMm).toBe(76.0)
    })

    it('2.2: creating rocket with NO dimensions and NO config data skips empty v1 configuration snapshot', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const res = await fetchPostForm(
        '/rockets',
        {
          name: 'Bare Airframe Rocket',
          status: 'in_build',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [rocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.name, 'Bare Airframe Rocket'))

      expect(rocket).toBeDefined()
      expect(rocket.lengthMm).toBeNull()
      expect(rocket.bodyDiameterMm).toBeNull()

      // Should have 0 configurations
      const configs = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))

      expect(configs.length).toBe(0)
    })

    it('2.3: airframe dimension update via POST /rockets/:id updates rocket and leaves historical v1 intact', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Starlance 1',
        lengthMm: 1000.0,
        bodyDiameterMm: 50.0,
      })
      const configV1 = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1000.0,
        bodyDiameterMm: 50.0,
        isCurrent: true,
      })

      // Update rocket airframe dimensions
      const res = await fetchPostForm(
        `/rockets/${rocket.id}`,
        {
          name: 'Starlance 1 Stretched',
          status: 'flight_ready',
          length_mm: 1250.0,
          body_diameter_mm: 50.0,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [updatedRocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocket.id))

      expect(updatedRocket.name).toBe('Starlance 1 Stretched')
      expect(updatedRocket.lengthMm).toBe(1250.0)

      // Historical config v1 must NOT have mutated
      const [unchangedConfig] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, configV1.id))

      expect(unchangedConfig.lengthMm).toBe(1000.0)
    })

    it('2.4: airframe dimension update via alias POST /rockets/:id/edit updates schema.rockets', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Edit Route Rocket',
        lengthMm: 900.0,
        bodyDiameterMm: 45.0,
      })

      const res = await fetchPostForm(
        `/rockets/${rocket.id}/edit`,
        {
          name: 'Edit Route Rocket Updated',
          status: 'flight_ready',
          length_mm: 980.0,
          body_diameter_mm: 48.0,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocket.id))

      expect(updated.name).toBe('Edit Route Rocket Updated')
      expect(updated.lengthMm).toBe(980.0)
      expect(updated.bodyDiameterMm).toBe(48.0)
    })

    it('2.5: partial update via POST /rockets/:id omitting dimensions preserves existing values', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Original Rocket',
        lengthMm: 1500.0,
        bodyDiameterMm: 75.0,
      })

      // Send update with name and status only (omitting length_mm and body_diameter_mm)
      const res = await fetchPostForm(
        `/rockets/${rocket.id}`,
        {
          name: 'Renamed Rocket',
          status: 'in_build',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocket.id))

      expect(updated.name).toBe('Renamed Rocket')
      // Existing dimensions preserved
      expect(updated.lengthMm).toBe(1500.0)
      expect(updated.bodyDiameterMm).toBe(75.0)
    })

    it('2.6: explicit clearing via POST /rockets/:id with empty strings resets dimensions to null', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Rocket With Dims',
        lengthMm: 1500.0,
        bodyDiameterMm: 75.0,
      })

      // Explicitly send empty strings to clear dimensions
      const res = await fetchPostForm(
        `/rockets/${rocket.id}`,
        {
          name: 'Rocket With Dims',
          status: 'flight_ready',
          length_mm: '',
          body_diameter_mm: '',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocket.id))

      expect(updated.lengthMm).toBeNull()
      expect(updated.bodyDiameterMm).toBeNull()
    })
  })

  // ============================================================================
  // 3. Configuration Snapshot Creation, History & Immutability
  // ============================================================================
  describe('3. Configuration Snapshot Creation, History & Immutability', () => {
    it('3.1: POST /rockets/:id/configurations creates v2, sets is_current=true, deactivates v1, and syncs parent rocket', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Modular Phoenix',
        lengthMm: 1200.0,
        bodyDiameterMm: 65.0,
      })
      const configV1 = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1200.0,
        bodyDiameterMm: 65.0,
        isCurrent: true,
      })

      // Create v2 with stretched airframe and wider payload bay
      const res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations`,
        {
          version: 2,
          length_mm: 1550.0,
          body_diameter_mm: 78.0,
          fin_count: 3,
          dry_mass_g: 650.0,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()

      // Verify config v1 is no longer current
      const [v1] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, configV1.id))

      expect(v1.isCurrent).toBe(false)
      expect(v1.lengthMm).toBe(1200.0)
      expect(v1.bodyDiameterMm).toBe(65.0)

      // Verify config v2 is current with new dimensions
      const [v2] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(
          and(
            eq(schema.rocketConfigurations.rocketId, rocket.id),
            eq(schema.rocketConfigurations.version, 2),
          ),
        )

      expect(v2).toBeDefined()
      expect(v2.isCurrent).toBe(true)
      expect(v2.lengthMm).toBe(1550.0)
      expect(v2.bodyDiameterMm).toBe(78.0)

      // Verify parent rocket airframe dimensions are synchronized to active snapshot
      const [parentRocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocket.id))

      expect(parentRocket.lengthMm).toBe(1550.0)
      expect(parentRocket.bodyDiameterMm).toBe(78.0)
    })

    it('3.2: historical configuration snapshot retains immutability across subsequent version additions', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Evolution Test',
        lengthMm: 1000.0,
        bodyDiameterMm: 50.0,
      })

      // Add Version 1
      await fetchPostForm(
        `/rockets/${rocket.id}/configurations`,
        { version: 1, length_mm: 1000.0, body_diameter_mm: 50.0 },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      // Add Version 2
      await fetchPostForm(
        `/rockets/${rocket.id}/configurations`,
        { version: 2, length_mm: 1200.0, body_diameter_mm: 60.0 },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      // Add Version 3
      await fetchPostForm(
        `/rockets/${rocket.id}/configurations`,
        { version: 3, length_mm: 1400.0, body_diameter_mm: 70.0 },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      const db = getDb()
      const configs = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))
        .orderBy(schema.rocketConfigurations.version)

      expect(configs.length).toBe(3)
      expect(configs[0].version).toBe(1)
      expect(configs[0].lengthMm).toBe(1000.0)
      expect(configs[0].bodyDiameterMm).toBe(50.0)
      expect(configs[0].isCurrent).toBe(false)

      expect(configs[1].version).toBe(2)
      expect(configs[1].lengthMm).toBe(1200.0)
      expect(configs[1].bodyDiameterMm).toBe(60.0)
      expect(configs[1].isCurrent).toBe(false)

      expect(configs[2].version).toBe(3)
      expect(configs[2].lengthMm).toBe(1400.0)
      expect(configs[2].bodyDiameterMm).toBe(70.0)
      expect(configs[2].isCurrent).toBe(true)
    })

    it('3.3: editing active configuration snapshot via POST /rockets/:id/configurations/:configId updates snapshot and parent rocket', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Apex Sounding',
        lengthMm: 1600.0,
        bodyDiameterMm: 76.0,
      })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1600.0,
        bodyDiameterMm: 76.0,
        isCurrent: true,
      })

      // Edit active config
      const res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${config.id}`,
        {
          length_mm: 1650.0,
          body_diameter_mm: 76.0,
          fin_count: 4,
          dry_mass_g: 820.0,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [updatedConfig] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, config.id))

      expect(updatedConfig.lengthMm).toBe(1650.0)
      expect(updatedConfig.dryMassG).toBe(820.0)

      // Parent rocket must be synchronized because this was the active config
      const [parent] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocket.id))

      expect(parent.lengthMm).toBe(1650.0)
    })

    it('3.4: editing inactive configuration snapshot updates that snapshot but DOES NOT overwrite parent rocket', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Titan Fleet',
        lengthMm: 2000.0,
        bodyDiameterMm: 100.0,
      })
      const configV1 = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1500.0,
        bodyDiameterMm: 80.0,
        isCurrent: false, // Inactive historical version
      })
      const configV2 = await seedTestConfig(rocket.id, {
        version: 2,
        lengthMm: 2000.0,
        bodyDiameterMm: 100.0,
        isCurrent: true, // Active current version
      })

      // Edit inactive config v1
      const res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${configV1.id}`,
        {
          length_mm: 1520.0,
          body_diameter_mm: 82.0,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [v1] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, configV1.id))

      expect(v1.lengthMm).toBe(1520.0)
      expect(v1.bodyDiameterMm).toBe(82.0)

      // Parent rocket must still match active config v2
      const [parent] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, rocket.id))

      expect(parent.lengthMm).toBe(2000.0)
      expect(parent.bodyDiameterMm).toBe(100.0)
    })

    it('3.5: editing configuration snapshot via alias POST /rockets/:id/configurations/:configId/edit succeeds', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Alias Config Rocket' })
      const config = await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1100.0,
        bodyDiameterMm: 54.0,
        isCurrent: true,
      })

      const res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${config.id}/edit`,
        {
          length_mm: 1150.0,
          body_diameter_mm: 56.0,
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, config.id))

      expect(updated.lengthMm).toBe(1150.0)
      expect(updated.bodyDiameterMm).toBe(56.0)
    })

    it('3.6: switching active configuration via POST /rockets/:id/configurations/:configId/set-current updates isCurrent flags', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Switch Config Rocket' })
      const configV1 = await seedTestConfig(rocket.id, {
        version: 1,
        isCurrent: false,
      })
      const configV2 = await seedTestConfig(rocket.id, {
        version: 2,
        isCurrent: true,
      })

      // Switch back to v1
      const res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/${configV1.id}/set-current`,
        {},
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      expect([200, 302, 303]).toContain(res.status)

      const db = getDb()
      const [v1] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, configV1.id))
      const [v2] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, configV2.id))

      expect(v1.isCurrent).toBe(true)
      expect(v2.isCurrent).toBe(false)
    })
  })

  // ============================================================================
  // 4. Form Rendering & Range Safety / Pad Clearance Inspection
  // ============================================================================
  describe('4. Form Rendering & Range Safety / Pad Clearance Inspection', () => {
    it('4.1: GET /rockets/new renders length and diameter inputs with step="any" and regex-matching labels', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const res = await fetchGet('/rockets/new', { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Check fields and labels
      assertHasFormField(html, 'length_mm')
      assertHasFormField(html, 'body_diameter_mm')
      expect(html).toMatch(/length.*mm|overall\s*length/i)
      expect(html).toMatch(/body.*diameter|diameter.*mm/i)

      // step="any" to permit floating-point fractional numbers
      expect(html).toMatch(/name="length_mm"[^>]*step="any"/)
      expect(html).toMatch(/name="body_diameter_mm"[^>]*step="any"/)
    })

    it('4.2: GET /rockets/:id/edit pre-populates existing airframe dimensions in input fields', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Prepopulate Edit Rocket',
        lengthMm: 1350.5,
        bodyDiameterMm: 68.2,
      })

      const res = await fetchGet(`/rockets/${rocket.id}/edit`, { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('value="1350.5"')
      expect(html).toContain('value="68.2"')
    })

    it('4.3: GET /rockets/:id/configurations/new pre-populates dimensions from active configuration', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, { name: 'Config Form Rocket' })
      await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1420.0,
        bodyDiameterMm: 72.0,
        isCurrent: true,
      })

      const res = await fetchGet(`/rockets/${rocket.id}/configurations/new`, { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toMatch(/length.*mm|overall\s*length/i)
      expect(html).toMatch(/body.*diameter|diameter.*mm/i)
      expect(html).toContain('value="1420"')
      expect(html).toContain('value="72"')
    })

    it('4.4: GET /rockets/:id detail view renders dimensions in overview banner, spotlight, and history table', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Display Metrics Rocket',
        lengthMm: 1750.0,
        bodyDiameterMm: 85.0,
      })
      await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1750.0,
        bodyDiameterMm: 85.0,
        isCurrent: true,
      })

      const res = await fetchGet(`/rockets/${rocket.id}`, { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Overview banner card
      expect(html).toContain('Airframe Physical Specifications')
      expect(html).toContain('1750 mm')
      expect(html).toContain('175.0 cm')
      expect(html).toContain('85 mm')
      expect(html).toContain('8.5 cm')

      // Configuration snapshot history table columns
      expect(html).toContain('Length (mm)')
      expect(html).toContain('Body Diam (mm)')
    })

    it('4.5: GET /flights/new preflight config options include data-length, data-diameter and inspection review card', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Safety Inspection Rocket',
        lengthMm: 1800.0,
        bodyDiameterMm: 98.0,
      })
      await seedTestConfig(rocket.id, {
        version: 1,
        lengthMm: 1800.0,
        bodyDiameterMm: 98.0,
        isCurrent: true,
      })

      const res = await fetchGet('/flights/new', { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('Safety Inspection Rocket')
      // Data attributes on configuration option
      expect(html).toContain('data-length="1800"')
      expect(html).toContain('data-diameter="98"')
      // Pad fit inspection card for RSO / LCO review
      expect(html).toMatch(/Pad Fit Inspection Card|RSO \/ LCO Review/i)
      expect(html).toMatch(/launch rail\/rod length|safe guide velocity|3× rocket length/i)
    })
  })

  // ============================================================================
  // 5. Security, Error Handling & 404 Formats
  // ============================================================================
  describe('5. Security, Error Handling & 404 Formats', () => {
    it('5.1: GET /rockets/:invalidId returns HTTP 404 with HTML error page ("Airframe Not Found")', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const res = await fetchGet('/rockets/non-existent-rocket-id-12345', { Cookie: cookie })
      expect(res.status).toBe(404)
      const contentType = res.headers.get('content-type') || ''
      expect(contentType).toContain('text/html')
      const html = await res.text()
      expect(html).toMatch(/Airframe Not Found/i)
      expect(html).toMatch(/Return to Fleet/i)
    })

    it('5.2: GET /rockets/:invalidId/edit returns HTTP 404 with plain text "Rocket not found"', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const res = await fetchGet('/rockets/non-existent-rocket-id-12345/edit', { Cookie: cookie })
      expect(res.status).toBe(404)
      const text = await res.text()
      expect(text).toBe('Rocket not found')
    })

    it('5.3: POST /rockets/:invalidId returns HTTP 404 with plain text "Rocket not found"', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const res = await fetchPostForm(
        '/rockets/non-existent-rocket-id-12345',
        { name: 'Ghost Rocket' },
        { Cookie: cookie },
      )
      expect(res.status).toBe(404)
      const text = await res.text()
      expect(text).toBe('Rocket not found')
    })

    it('5.4: POST /rockets/:invalidId/edit returns HTTP 404 with plain text "Rocket not found"', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const res = await fetchPostForm(
        '/rockets/non-existent-rocket-id-12345/edit',
        { name: 'Ghost Rocket' },
        { Cookie: cookie },
      )
      expect(res.status).toBe(404)
      const text = await res.text()
      expect(text).toBe('Rocket not found')
    })

    it('5.5: GET and POST /rockets/:invalidId/configurations/new return HTTP 404 with "Rocket not found"', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const getRes = await fetchGet('/rockets/non-existent-rocket-id-12345/configurations/new', {
        Cookie: cookie,
      })
      expect(getRes.status).toBe(404)
      expect(await getRes.text()).toBe('Rocket not found')

      const postRes = await fetchPostForm(
        '/rockets/non-existent-rocket-id-12345/configurations',
        { version: 1 },
        { Cookie: cookie },
      )
      expect(postRes.status).toBe(404)
      expect(await postRes.text()).toBe('Rocket not found')
    })

    it('5.6: POST /rockets/:id/configurations/:invalidConfigId returns HTTP 404 with "Configuration snapshot not found"', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id)

      const res = await fetchPostForm(
        `/rockets/${rocket.id}/configurations/non-existent-config-id-999`,
        { length_mm: 1200 },
        { Cookie: cookie },
      )
      expect(res.status).toBe(404)
      expect(await res.text()).toBe('Configuration snapshot not found')
    })

    it('5.7: cross-rocket configuration tampering attack: updating Rocket A config using Rocket B URL returns 404 and does not mutate config', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocketA = await seedTestRocket(flyer.id, { name: 'Target Rocket A' })
      const configA = await seedTestConfig(rocketA.id, {
        version: 1,
        lengthMm: 1000.0,
        bodyDiameterMm: 50.0,
      })

      const rocketB = await seedTestRocket(flyer.id, { name: 'Attacker Rocket B' })

      // Attempt to mutate Rocket A's config by referencing Rocket B in the route URL
      const attackRes = await fetchPostForm(
        `/rockets/${rocketB.id}/configurations/${configA.id}`,
        {
          length_mm: 9999.0,
          body_diameter_mm: 999.0,
        },
        { Cookie: cookie },
      )

      expect(attackRes.status).toBe(404)
      expect(await attackRes.text()).toBe('Configuration snapshot not found')

      // Direct D1 verification: config A must remain completely unmodified
      const db = getDb()
      const [intactConfig] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.id, configA.id))

      expect(intactConfig.lengthMm).toBe(1000.0)
      expect(intactConfig.bodyDiameterMm).toBe(50.0)
    })

    it('5.8: soft-deleted rocket returns HTTP 404 on GET /rockets/:id', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const rocket = await seedTestRocket(flyer.id, {
        name: 'Deleted Rocket',
        deletedAt: Date.now(),
      })

      const res = await fetchGet(`/rockets/${rocket.id}`, { Cookie: cookie })
      expect(res.status).toBe(404)
      const html = await res.text()
      expect(html).toMatch(/Airframe Not Found/i)
    })
  })
})
