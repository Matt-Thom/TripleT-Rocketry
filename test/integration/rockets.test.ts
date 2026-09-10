/**
 * Integration test suite for Rocket Airframes & Versioned Configurations.
 * Tests rocket airframe listing, creation, status badge rendering,
 * configuration snapshot versioning, and D1 persistence.
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
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
} from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'

beforeEach(truncateDb)

describe('Rocket & Configuration Workflows (Tiers 1-4)', () => {
  describe('Tier 1: Rocket Listing & Airframe View (GET /rockets)', () => {
    it('returns HTTP 200 with HTML content for rocket airframe list', async () => {
      const res = await fetchGet('/rockets')
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/rocket/i)
    })

    it('renders rocket creation form at GET /rockets/new', async () => {
      const res = await fetchGet('/rockets/new')
      assertHtmlResponse(res, 200)
      const html = await res.text()
      assertHasFormField(html, 'name')
      assertHasFormField(html, 'status')
    })
  })

  describe('Tier 2: Rocket Airframe Creation & Status Badges (POST /rockets)', () => {
    it('persists a new rocket in D1 and handles status badges', async () => {
      const user = await seedTestUser({ displayName: 'Rocket Architect' })

      const res = await fetchPostForm('/rockets', {
        name: 'Aerotech Initiator 29mm',
        status: 'flight_ready',
      })

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.name, 'Aerotech Initiator 29mm'))

      expect(saved).toBeDefined()
      expect(saved.name).toBe('Aerotech Initiator 29mm')
      expect(saved.status).toBe('flight_ready')
    })

    it.each(['flight_ready', 'in_build', 'damaged', 'retired'] as const)(
      'renders proper status badge for status "%s"',
      async (status) => {
        const user = await seedTestUser()
        const rocket = await seedTestRocket(user.id, {
          name: `Airframe ${status}`,
          status,
        })

        const res = await fetchGet('/rockets')
        assertHtmlResponse(res, 200)
        const html = await res.text()
        assertContains(html, `Airframe ${status}`)
        expect(html).toMatch(new RegExp(status.replace('_', ' '), 'i'))
      },
    )
  })

  describe('Tier 3: Configuration Snapshot Management (POST /rockets/:id/configurations)', () => {
    it('adds a new configuration snapshot with stability and mass parameters', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Super Big Bertha' })

      const res = await fetchPostForm(`/rockets/${rocket.id}/configurations`, {
        version: 1,
        fin_count: 4,
        dry_mass_g: 480.0,
        loaded_mass_g: 620.0,
        cg_mm: 520.0,
        cp_mm: 640.0,
        stability_calibers: 1.75,
        recovery_type: 'parachute',
        parachute_size_mm: 600,
        motor_mount_diameter_mm: 29,
      })

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const configs = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))

      expect(configs.length).toBeGreaterThanOrEqual(1)
      const cfg = configs[0]
      expect(cfg.stabilityCalibers).toBeCloseTo(1.75)
      expect(cfg.dryMassG).toBeCloseTo(480.0)
      expect(cfg.recoveryType).toBe('parachute')
    })
  })

  describe('Tier 4: Workload Scenario 6 — Configuration Versioning Lifecycle', () => {
    it('preserves multi-version history (v1 baseline and v2 modification) in D1', async () => {
      const user = await seedTestUser({ displayName: 'Senior Certifier' })
      const rocket = await seedTestRocket(user.id, {
        name: 'PML Horizon 4-inch',
        status: 'flight_ready',
      })

      // Seed v1 configuration snapshot
      const v1 = await seedTestConfig(rocket.id, {
        version: 1,
        dryMassG: 1200.0,
        loadedMassG: 1750.0,
        stabilityCalibers: 1.25,
        recoveryType: 'parachute',
        isCurrent: false,
      })

      // Add v2 configuration snapshot (added ballast and larger fins)
      const v2 = await seedTestConfig(rocket.id, {
        version: 2,
        dryMassG: 1350.0,
        loadedMassG: 1900.0,
        ballastG: 150.0,
        stabilityCalibers: 1.65,
        recoveryType: 'dual_deploy',
        isCurrent: true,
      })

      const db = getDb()
      const allConfigs = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))

      expect(allConfigs).toHaveLength(2)
      const foundV1 = allConfigs.find((c) => c.version === 1)
      const foundV2 = allConfigs.find((c) => c.version === 2)

      expect(foundV1?.stabilityCalibers).toBeCloseTo(1.25)
      expect(foundV2?.stabilityCalibers).toBeCloseTo(1.65)
      expect(foundV2?.recoveryType).toBe('dual_deploy')

      // View rocket detail page
      const res = await fetchGet(`/rockets/${rocket.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()
      assertContains(html, 'PML Horizon 4-inch')
      expect(html).toMatch(/v1|version 1/i)
      expect(html).toMatch(/v2|version 2/i)
    })
  })
})
