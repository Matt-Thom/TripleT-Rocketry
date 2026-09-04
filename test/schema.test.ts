/**
 * Schema shape and the full nine-entity relationship graph.
 *
 * Ported from tests/integration/test_db.py: the point is that every foreign
 * key in the Phase 1 graph actually resolves against a migrated database, not
 * that any particular column has a particular type.
 */

import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'

const TABLES = [
  'certifications',
  'components',
  'flights',
  'inventory_transactions',
  'launch_events',
  'launch_sites',
  'motor_inventories',
  'motors',
  'rocket_configurations',
  'rockets',
  'users',
]

const db = () => drizzle(env.DB, { schema })

/** Delete in FK-dependency order so each test starts from an empty graph. */
async function truncate() {
  for (const table of [
    'inventory_transactions',
    'components',
    'flights',
    'launch_events',
    'motor_inventories',
    'rocket_configurations',
    'certifications',
    'rockets',
    'motors',
    'launch_sites',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run()
  }
}

beforeEach(truncate)

describe('migrated schema', () => {
  it('creates all nine Phase 1 tables', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'",
    ).all<{ name: string }>()
    expect(results.map((r) => r.name).sort()).toEqual(TABLES)
  })

  it('enforces the enum CHECK constraints that replaced the Postgres enums', async () => {
    const [user] = await db()
      .insert(schema.users)
      .values({
        email: 'check@example.com',
        displayName: 'Check',
        passwordHash: 'x',
      })
      .returning()

    await expect(
      env.DB.prepare(
        'INSERT INTO rockets (id, owner_id, name, status) VALUES (?, ?, ?, ?)',
      )
        .bind(crypto.randomUUID(), user.id, 'Bad Status', 'not_a_status')
        .run(),
    ).rejects.toThrow()
  })

  it('enforces the rocket configuration version uniqueness constraint', async () => {
    const d = db()
    const [user] = await d
      .insert(schema.users)
      .values({ email: 'uq@example.com', displayName: 'U', passwordHash: 'x' })
      .returning()
    const [rocket] = await d
      .insert(schema.rockets)
      .values({ ownerId: user.id, name: 'Uniquely Versioned' })
      .returning()

    await d.insert(schema.rocketConfigurations).values({ rocketId: rocket.id, version: 1 })
    await expect(
      d.insert(schema.rocketConfigurations).values({ rocketId: rocket.id, version: 1 }),
    ).rejects.toThrow()
  })
})

describe('relationship graph', () => {
  it('links a flight to all nine entities', async () => {
    const d = db()

    const [user] = await d
      .insert(schema.users)
      .values({
        email: 'flyer@example.com',
        displayName: 'Test Flyer',
        passwordHash: 'argon2-placeholder',
      })
      .returning()

    await d.insert(schema.certifications).values({
      userId: user.id,
      certifyingBody: 'TRA',
      level: 2,
      certNumber: 'TRA-1234',
      expiresOn: '2027-01-31',
    })

    const [rocket] = await d
      .insert(schema.rockets)
      .values({ ownerId: user.id, name: 'Der Red Max', status: 'flight_ready' })
      .returning()

    const [config] = await d
      .insert(schema.rocketConfigurations)
      .values({
        rocketId: rocket.id,
        version: 1,
        finCount: 3,
        dryMassG: 480.5,
        stabilityCalibers: 1.8,
        recoveryType: 'dual_deploy',
      })
      .returning()

    const [motor] = await d
      .insert(schema.motors)
      .values({
        manufacturer: 'AeroTech',
        model: 'H128W',
        impulseClass: 'H',
        totalImpulseNs: 190.2,
        delayS: 10,
        propellantType: 'apcp',
        certifyingOrg: 'BOTH',
      })
      .returning()

    const [inventory] = await d
      .insert(schema.motorInventories)
      .values({ userId: user.id, motorId: motor.id, quantityOnHand: 3 })
      .returning()

    const [site] = await d
      .insert(schema.launchSites)
      .values({ name: 'Black Rock', maxAltitudeAglM: 30000 })
      .returning()

    const [event] = await d
      .insert(schema.launchEvents)
      .values({
        launchSiteId: site.id,
        name: 'Spring Launch',
        startsOn: '2026-04-11',
        rsoUserId: user.id,
        padCount: 12,
      })
      .returning()

    const [flight] = await d
      .insert(schema.flights)
      .values({
        flyerId: user.id,
        rocketConfigurationId: config.id,
        motorId: motor.id,
        motorInventoryId: inventory.id,
        launchSiteId: site.id,
        launchEventId: event.id,
        flightNumber: 1,
        flownAt: Date.parse('2026-04-11T16:20:00Z'),
        altitudeAglM: 1204.5,
        outcome: 'successful',
        mediaUrls: ['https://example.com/onboard.mp4'],
        softGateWarnings: [],
      })
      .returning()

    const stored = await d.query.flights.findFirst({
      where: eq(schema.flights.id, flight.id),
    })

    expect(stored).toBeDefined()
    expect(stored!.flyerId).toBe(user.id)
    expect(stored!.rocketConfigurationId).toBe(config.id)
    expect(stored!.motorInventoryId).toBe(inventory.id)
    expect(stored!.launchEventId).toBe(event.id)
    // JSON columns must survive the text round-trip as arrays, not strings.
    expect(stored!.mediaUrls).toEqual(['https://example.com/onboard.mp4'])
    expect(stored!.outcome).toBe('successful')
    expect(stored!.createdAt).toBeTypeOf('number')
  })

  it('rejects a flight whose flyer does not exist', async () => {
    await env.DB.prepare('PRAGMA foreign_keys = ON').run()
    await expect(
      db().insert(schema.flights).values({ flyerId: crypto.randomUUID() }),
    ).rejects.toThrow()
  })
})
