/**
 * Challenger 2 Adversarial Verification Test Suite
 *
 * Covers:
 * 1. Rocket configuration version auto-increment, boundary conditions, and collision safety
 * 2. Motor inventory boundary clamping, adversarial deltas, and negative stock prevention
 * 3. 404 and 500 content negotiation (HTML vs JSON) across unmapped and domain routes
 * 4. Active flyer resolution, lazy seeding, idempotency, and concurrency race conditions
 */

import { SELF, env } from 'cloudflare:test'
import { describe, expect, it, beforeEach } from 'vitest'
import app from '../../src/index'
import * as schema from '../../src/db/schema'
import { getDb, truncateDb, seedTestUser, seedTestRocket, seedTestMotor, seedTestInventory, seedTestCert } from '../helpers/db'
import { getActiveFlyer } from '../../src/db/context'
import { fetchGet, fetchPostForm, fetchHtmxPostForm, encodeFormData } from '../helpers/http'
import { eq, and } from 'drizzle-orm'

async function postFormManualRedirect(
  path: string,
  data: Record<string, string | number | boolean | null | undefined>,
) {
  const url = `https://example.com${path}`
  const body = encodeFormData(data)
  return await SELF.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    redirect: 'manual',
  })
}

describe('Challenger 2: Adversarial Integrity & Mutation Safety Suite', () => {
  beforeEach(async () => {
    await truncateDb()
  })

  // =========================================================================
  // VECTOR 1: Rocket Configuration Versioning & Collision Safety
  // =========================================================================
  describe('Vector 1: Rocket Configuration Versioning & Collision Safety', () => {
    it('1.1: sequential configurations auto-increment version = max(version) + 1 with isCurrent toggle', async () => {
      const db = getDb()
      const user = await seedTestUser({ email: 'flyer@rocketry.local' })
      const rocket = await seedTestRocket(user.id, { name: 'Falcon Test' })

      // Baseline v1 configuration snapshot
      const [v1] = await db
        .insert(schema.rocketConfigurations)
        .values({
          rocketId: rocket.id,
          version: 1,
          isCurrent: true,
          airframeMaterial: 'cardboard',
        })
        .returning()

      expect(v1.version).toBe(1)
      expect(v1.isCurrent).toBe(true)

      // POST new configuration without specifying version
      const res1 = await postFormManualRedirect(`/rockets/${rocket.id}/configurations`, {
        fin_count: '4',
        dry_mass_g: '450',
      })
      expect(res1.status).toBe(303)
      expect(res1.headers.get('Location')).toBe(`/rockets/${rocket.id}`)

      const configsAfterFirst = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))
        .orderBy(schema.rocketConfigurations.version)

      expect(configsAfterFirst.length).toBe(2)
      expect(configsAfterFirst[0].version).toBe(1)
      expect(configsAfterFirst[0].isCurrent).toBe(false)
      expect(configsAfterFirst[1].version).toBe(2)
      expect(configsAfterFirst[1].isCurrent).toBe(true)

      // POST another configuration without specifying version
      const res2 = await postFormManualRedirect(`/rockets/${rocket.id}/configurations`, {
        fin_count: '3',
        dry_mass_g: '420',
      })
      expect(res2.status).toBe(303)
      expect(res2.headers.get('Location')).toBe(`/rockets/${rocket.id}`)

      const configsAfterSecond = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))
        .orderBy(schema.rocketConfigurations.version)

      expect(configsAfterSecond.length).toBe(3)
      expect(configsAfterSecond.map((c) => c.version)).toEqual([1, 2, 3])
      expect(configsAfterSecond[0].isCurrent).toBe(false)
      expect(configsAfterSecond[1].isCurrent).toBe(false)
      expect(configsAfterSecond[2].isCurrent).toBe(true)
    })

    it('1.2: explicit submission of an existing version (<= maxVersion) auto-bumps to maxVersion + 1 instead of colliding', async () => {
      const db = getDb()
      const user = await seedTestUser({ email: 'flyer@rocketry.local' })
      const rocket = await seedTestRocket(user.id, { name: 'Collision Test' })

      // Seed version 1 and version 2
      await db.insert(schema.rocketConfigurations).values([
        { rocketId: rocket.id, version: 1, isCurrent: false },
        { rocketId: rocket.id, version: 2, isCurrent: true },
      ])

      // Malicious or stale form submission attempting to re-submit version 1
      const res = await postFormManualRedirect(`/rockets/${rocket.id}/configurations`, {
        version: '1',
        dry_mass_g: '500',
      })
      expect(res.status).toBe(303)

      const configs = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))
        .orderBy(schema.rocketConfigurations.version)

      // Must have 3 configurations with versions 1, 2, 3 (not a duplicate version 1)
      expect(configs.length).toBe(3)
      expect(configs.map((c) => c.version)).toEqual([1, 2, 3])
      expect(configs[2].version).toBe(3)
      expect(configs[2].isCurrent).toBe(true)
    })

    it('1.3: database enforces uniqueIndex uq_rocket_configurations_rocket_version', async () => {
      const db = getDb()
      const user = await seedTestUser({ email: 'flyer@rocketry.local' })
      const rocket = await seedTestRocket(user.id, { name: 'DB Constraint Test' })

      // Seed version 1
      await db.insert(schema.rocketConfigurations).values({
        rocketId: rocket.id,
        version: 1,
        isCurrent: true,
      })

      // Attempting direct raw DB insert with duplicate (rocketId, version) must fail
      let errorThrown: any = null
      try {
        await db.insert(schema.rocketConfigurations).values({
          rocketId: rocket.id,
          version: 1,
          isCurrent: false,
        })
      } catch (err) {
        errorThrown = err
      }

      expect(errorThrown).not.toBeNull()
      expect(String(errorThrown)).toContain('Failed query')
    })

    it('1.4: independent rockets maintain distinct version namespaces without collision', async () => {
      const db = getDb()
      const user = await seedTestUser({ email: 'flyer@rocketry.local' })
      const rocketA = await seedTestRocket(user.id, { name: 'Rocket Alpha' })
      const rocketB = await seedTestRocket(user.id, { name: 'Rocket Beta' })

      // Add version 1 to both
      await db.insert(schema.rocketConfigurations).values([
        { rocketId: rocketA.id, version: 1, isCurrent: true },
        { rocketId: rocketB.id, version: 1, isCurrent: true },
      ])

      // Add config to Rocket A
      await postFormManualRedirect(`/rockets/${rocketA.id}/configurations`, { dry_mass_g: '300' })
      // Add config to Rocket B
      await postFormManualRedirect(`/rockets/${rocketB.id}/configurations`, { dry_mass_g: '600' })

      const configsA = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocketA.id))
        .orderBy(schema.rocketConfigurations.version)

      const configsB = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocketB.id))
        .orderBy(schema.rocketConfigurations.version)

      expect(configsA.map((c) => c.version)).toEqual([1, 2])
      expect(configsB.map((c) => c.version)).toEqual([1, 2])
    })

    it('1.5: concurrent configuration creations never create duplicate versions in database', async () => {
      const db = getDb()
      const user = await seedTestUser({ email: 'flyer@rocketry.local' })
      const rocket = await seedTestRocket(user.id, { name: 'Concurrent Versioning Rocket' })

      await db.insert(schema.rocketConfigurations).values({
        rocketId: rocket.id,
        version: 1,
        isCurrent: true,
      })

      // Fire 4 concurrent config additions
      const promises = [1, 2, 3, 4].map((i) =>
        postFormManualRedirect(`/rockets/${rocket.id}/configurations`, {
          dry_mass_g: String(350 + i * 10),
        }),
      )

      await Promise.allSettled(promises)

      const configs = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))
        .orderBy(schema.rocketConfigurations.version)

      // Versions must be unique set
      const versionSet = new Set(configs.map((c) => c.version))
      expect(versionSet.size).toBe(configs.length)
    })
  })

  // =========================================================================
  // VECTOR 2: Inventory Boundary Clamping & Negative Stock Prevention
  // =========================================================================
  describe('Vector 2: Inventory Boundary Clamping & Negative Stock', () => {
    it('2.1: decrement action clamps at 0 and cannot produce negative stock', async () => {
      const db = getDb()
      const user = await seedTestUser({ email: 'flyer@rocketry.local' })
      const motor = await seedTestMotor()
      const inv = await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 2,
        expendedCount: 0,
      })

      // Attempt to decrement by 5 when quantity is 2
      const res = await fetchHtmxPostForm(`/inventory/${inv.id}/adjust`, {
        action: 'decrement',
        delta: '5',
      })
      expect(res.status).toBe(200)

      const [updated] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updated.quantityOnHand).toBe(0)
      expect(updated.quantityOnHand).toBeGreaterThanOrEqual(0)
    })

    it('2.2: decrementing when stock is already 0 remains 0', async () => {
      const db = getDb()
      const user = await seedTestUser({ email: 'flyer@rocketry.local' })
      const motor = await seedTestMotor()
      const inv = await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 0,
        expendedCount: 4,
      })

      const res = await fetchHtmxPostForm(`/inventory/${inv.id}/adjust`, {
        action: 'decrement',
        delta: '1',
      })
      expect(res.status).toBe(200)

      const [updated] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updated.quantityOnHand).toBe(0)
    })

    it('2.3: expend action clamps quantityOnHand at 0 and increments expendedCount', async () => {
      const db = getDb()
      const user = await seedTestUser({ email: 'flyer@rocketry.local' })
      const motor = await seedTestMotor()
      const inv = await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 3,
        expendedCount: 1,
      })

      // Expend 10 (exceeding stock of 3)
      const res = await fetchHtmxPostForm(`/inventory/${inv.id}/adjust`, {
        action: 'expend',
        delta: '10',
      })
      expect(res.status).toBe(200)

      const [updated] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updated.quantityOnHand).toBe(0)
      expect(updated.expendedCount).toBe(11) // 1 + 10
    })

    it('2.4: restore action clamps expendedCount at 0 and increments quantityOnHand', async () => {
      const db = getDb()
      const user = await seedTestUser({ email: 'flyer@rocketry.local' })
      const motor = await seedTestMotor()
      const inv = await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 1,
        expendedCount: 2,
      })

      // Restore 10 (exceeding expended count of 2)
      const res = await fetchHtmxPostForm(`/inventory/${inv.id}/adjust`, {
        action: 'restore',
        delta: '10',
      })
      expect(res.status).toBe(200)

      const [updated] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updated.expendedCount).toBe(0) // Math.max(0, 2 - 10) = 0
      expect(updated.quantityOnHand).toBe(11) // 1 + 10
    })

    it('2.5: adversarial negative delta on increment clamps at 0', async () => {
      const db = getDb()
      const user = await seedTestUser({ email: 'flyer@rocketry.local' })
      const motor = await seedTestMotor()
      const inv = await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 5,
        expendedCount: 0,
      })

      // Adversarial payload: action=increment with delta=-100
      const res = await fetchHtmxPostForm(`/inventory/${inv.id}/adjust`, {
        action: 'increment',
        delta: '-100',
      })
      expect(res.status).toBe(200)

      const [updated] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updated.quantityOnHand).toBe(0)
    })

    it('2.6: field-based adjustment with negative delta clamps at 0', async () => {
      const db = getDb()
      const user = await seedTestUser({ email: 'flyer@rocketry.local' })
      const motor = await seedTestMotor()
      const inv = await seedTestInventory(user.id, motor.id, {
        quantityOnHand: 5,
        expendedCount: 3,
      })

      // field=quantity_on_hand delta=-50
      await fetchHtmxPostForm(`/inventory/${inv.id}/adjust`, {
        field: 'quantity_on_hand',
        delta: '-50',
      })

      // field=expended_count delta=-50
      await fetchHtmxPostForm(`/inventory/${inv.id}/adjust`, {
        field: 'expended_count',
        delta: '-50',
      })

      const [updated] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inv.id))

      expect(updated.quantityOnHand).toBe(0)
      expect(updated.expendedCount).toBe(0)
    })

    it('2.7: new inventory creation rejects/clamps negative quantity_on_hand to at least 1', async () => {
      const db = getDb()
      const user = await seedTestUser({ email: 'flyer@rocketry.local' })
      const motor = await seedTestMotor()

      // POST /inventory with negative quantity
      await fetchPostForm('/inventory', {
        motor_id: motor.id,
        quantity_on_hand: '-5',
      })

      const [created] = await db
        .select()
        .from(schema.motorInventories)
        .where(and(eq(schema.motorInventories.userId, user.id), eq(schema.motorInventories.motorId, motor.id)))

      expect(created).toBeDefined()
      expect(created.quantityOnHand).toBe(1) // Math.max(1, -5) = 1
    })
  })

  // =========================================================================
  // VECTOR 3: Content Negotiation on 404 and 500 Handlers
  // =========================================================================
  describe('Vector 3: Content Negotiation (404 and 500 Handlers)', () => {
    it('3.1: unmapped 404 handler responds with HTML when Accept header includes text/html', async () => {
      const res = await SELF.fetch('https://example.com/unmapped/orbit/path', {
        method: 'GET',
        headers: { Accept: 'text/html' },
      })
      expect(res.status).toBe(404)
      expect(res.headers.get('Content-Type')).toContain('text/html')
      const body = await res.text()
      expect(body).toContain('404 — Page Not Found')
      expect(body).toContain('Return to Dashboard')
    })

    it('3.2: unmapped 404 handler responds with HTML for standard browser Accept header', async () => {
      const res = await SELF.fetch('https://example.com/non-existent-trajectory', {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        },
      })
      expect(res.status).toBe(404)
      expect(res.headers.get('Content-Type')).toContain('text/html')
      const body = await res.text()
      expect(body).toContain('404 — Page Not Found')
    })

    it('3.3: unmapped 404 handler responds with JSON when Accept header is application/json', async () => {
      const res = await SELF.fetch('https://example.com/api/v1/missing-resource', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
      expect(res.status).toBe(404)
      expect(res.headers.get('Content-Type')).toContain('application/json')
      const json = await res.json()
      expect(json).toEqual({ detail: 'Not Found' })
    })

    it('3.4: unmapped 404 handler responds with JSON when Accept header is missing or wildcard */*', async () => {
      // Wildcard */*
      const resWildcard = await SELF.fetch('https://example.com/some/missing/route', {
        method: 'GET',
        headers: { Accept: '*/*' },
      })
      expect(resWildcard.status).toBe(404)
      expect(resWildcard.headers.get('Content-Type')).toContain('application/json')
      expect(await resWildcard.json()).toEqual({ detail: 'Not Found' })

      // Missing Accept header
      const resNoAccept = await SELF.fetch('https://example.com/some/missing/route', {
        method: 'GET',
      })
      expect(resNoAccept.status).toBe(404)
      expect(resNoAccept.headers.get('Content-Type')).toContain('application/json')
      expect(await resNoAccept.json()).toEqual({ detail: 'Not Found' })
    })

    it('3.5: domain-level 404 routes return specialized formats (HTML for /rockets/:id, plain text for /rockets/:id/edit)', async () => {
      // GET /rockets/:id when not found returns HTML regardless of Accept header
      const rocketRes = await SELF.fetch('https://example.com/rockets/00000000-0000-0000-0000-000000000000', {
        headers: { Accept: 'application/json' },
      })
      expect(rocketRes.status).toBe(404)
      expect(rocketRes.headers.get('Content-Type')).toContain('text/html')

      // GET /rockets/:id/edit when not found returns text/plain
      const editRes = await SELF.fetch('https://example.com/rockets/00000000-0000-0000-0000-000000000000/edit', {
        headers: { Accept: 'application/json' },
      })
      expect(editRes.status).toBe(404)
      expect(await editRes.text()).toBe('Rocket not found')
    })

    it('3.6: 500 handler responds with HTML when Accept includes text/html on unhandled exception', async () => {
      // Simulate broken DB to trigger unhandled exception in GET /rockets
      const brokenEnv = {
        ...env,
        DB: {
          prepare() {
            throw new Error('Adversarial D1 connection failure')
          },
        } as unknown as D1Database,
      }

      const res = await app.fetch(
        new Request('https://example.com/rockets', {
          headers: { Accept: 'text/html' },
        }),
        brokenEnv,
      )
      expect(res.status).toBe(500)
      expect(res.headers.get('Content-Type')).toContain('text/html')
      const body = await res.text()
      expect(body).toContain('500 — System Anomaly')
      expect(body).toContain('Return to Dashboard')
    })

    it('3.7: 500 handler responds with JSON when Accept is application/json or missing', async () => {
      const brokenEnv = {
        ...env,
        DB: {
          prepare() {
            throw new Error('Adversarial D1 connection failure')
          },
        } as unknown as D1Database,
      }

      // JSON Accept
      const resJson = await app.fetch(
        new Request('https://example.com/rockets', {
          headers: { Accept: 'application/json' },
        }),
        brokenEnv,
      )
      expect(resJson.status).toBe(500)
      expect(resJson.headers.get('Content-Type')).toContain('application/json')
      expect(await resJson.json()).toEqual({ detail: 'Internal Server Error' })

      // No Accept
      const resNoAccept = await app.fetch(
        new Request('https://example.com/rockets'),
        brokenEnv,
      )
      expect(resNoAccept.status).toBe(500)
      expect(resNoAccept.headers.get('Content-Type')).toContain('application/json')
      expect(await resNoAccept.json()).toEqual({ detail: 'Internal Server Error' })
    })
  })

  // =========================================================================
  // VECTOR 4: Active Flyer Resolution & Seeding Idempotency
  // =========================================================================
  describe('Vector 4: Active Flyer Resolution & Seeding Idempotency', () => {
    it('4.1: getActiveFlyer lazily seeds default pilot on empty DB and resolves maxCertLevel 2', async () => {
      const db = getDb()

      // Ensure DB users table is empty
      const initialUsers = await db.select().from(schema.users)
      expect(initialUsers.length).toBe(0)

      // Call getActiveFlyer
      const flyer = await getActiveFlyer(db)

      expect(flyer.email).toBe('flyer@rocketry.local')
      expect(flyer.displayName).toBe('TripleT Pilot')
      expect(flyer.maxCertLevel).toBe(2)

      // Verify records in DB
      const seededUsers = await db.select().from(schema.users)
      expect(seededUsers.length).toBe(1)
      expect(seededUsers[0].id).toBe(flyer.id)

      const seededCerts = await db.select().from(schema.certifications)
      expect(seededCerts.length).toBe(1)
      expect(seededCerts[0].userId).toBe(flyer.id)
      expect(seededCerts[0].level).toBe(2)
      expect(seededCerts[0].certifyingBody).toBe('TRA')
    })

    it('4.2: sequential calls to getActiveFlyer are strictly idempotent and do not create duplicates', async () => {
      const db = getDb()

      // Call 5 times sequentially
      const flyer1 = await getActiveFlyer(db)
      const flyer2 = await getActiveFlyer(db)
      const flyer3 = await getActiveFlyer(db)
      const flyer4 = await getActiveFlyer(db)
      const flyer5 = await getActiveFlyer(db)

      expect(flyer1.id).toBe(flyer2.id)
      expect(flyer2.id).toBe(flyer3.id)
      expect(flyer3.id).toBe(flyer4.id)
      expect(flyer4.id).toBe(flyer5.id)

      const usersCount = await db.select().from(schema.users)
      expect(usersCount.length).toBe(1)

      const certsCount = await db.select().from(schema.certifications)
      expect(certsCount.length).toBe(1)
    })

    it('4.3: getActiveFlyer correctly determines maxCertLevel when user has multiple certifications', async () => {
      const db = getDb()
      const user = await seedTestUser({ email: 'highpower@example.com' })

      // Seed Level 1 NAR and Level 3 TRA
      await seedTestCert(user.id, { certifyingBody: 'NAR', level: 1 })
      await seedTestCert(user.id, { certifyingBody: 'TRA', level: 3 })

      const flyer = await getActiveFlyer(db)
      expect(flyer.id).toBe(user.id)
      expect(flyer.maxCertLevel).toBe(3)
    })

    it('4.4: concurrent getActiveFlyer invocations on cold/empty DB guarantee single-user DB integrity', async () => {
      const db = getDb()

      // Empty database
      const users = await db.select().from(schema.users)
      expect(users.length).toBe(0)

      // Fire 5 concurrent invocations on empty database
      const results = await Promise.allSettled([
        getActiveFlyer(db),
        getActiveFlyer(db),
        getActiveFlyer(db),
        getActiveFlyer(db),
        getActiveFlyer(db),
      ])

      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      expect(fulfilled.length).toBeGreaterThanOrEqual(1)

      // Verify that database users table has EXACTLY 1 user, never duplicates
      const usersInDb = await db.select().from(schema.users)
      expect(usersInDb.length).toBe(1)

      const certsInDb = await db.select().from(schema.certifications)
      expect(certsInDb.length).toBe(1)
    })
  })
})
