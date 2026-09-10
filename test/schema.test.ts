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
import { seedTestClubMembership, seedTestStorageSite } from './helpers/db'

const TABLES = [
  'certifications',
  'club_memberships',
  'components',
  'flights',
  'inventory_transactions',
  'launch_events',
  'launch_sites',
  'motor_inventories',
  'motors',
  'rocket_configurations',
  'rockets',
  'sessions',
  'site_settings',
  'storage_sites',
  'user_credentials',
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
    'club_memberships',
    'storage_sites',
    'rockets',
    'motors',
    'launch_sites',
    'sessions',
    'user_credentials',
    'site_settings',
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

describe('Milestone 1 schema extensions', () => {
  it('enforces expanded certifications enum checks (ARA and Level 0 valid; invalid rejected)', async () => {
    const d = db()
    const [user] = await d
      .insert(schema.users)
      .values({
        email: 'cert-m1@example.com',
        displayName: 'M1 Cert Flyer',
        passwordHash: 'placeholder',
      })
      .returning()

    // Valid: ARA certifying body with level 0
    const [cert0] = await d
      .insert(schema.certifications)
      .values({
        userId: user.id,
        certifyingBody: 'ARA',
        level: 0,
        certNumber: 'ARA-001',
        expiresOn: '2028-12-31',
      })
      .returning()
    expect(cert0.certifyingBody).toBe('ARA')
    expect(cert0.level).toBe(0)

    // Valid: TRA certifying body with level 3
    const [cert3] = await d
      .insert(schema.certifications)
      .values({
        userId: user.id,
        certifyingBody: 'TRA',
        level: 3,
        certNumber: 'TRA-333',
        expiresOn: '2028-12-31',
      })
      .returning()
    expect(cert3.certifyingBody).toBe('TRA')
    expect(cert3.level).toBe(3)

    // Invalid certifyingBody rejected by CHECK constraint
    await expect(
      env.DB.prepare(
        'INSERT INTO certifications (id, user_id, certifying_body, level) VALUES (?, ?, ?, ?)',
      )
        .bind(crypto.randomUUID(), user.id, 'INVALID_BODY', 1)
        .run(),
    ).rejects.toThrow()

    // Invalid level rejected by CHECK constraint
    await expect(
      env.DB.prepare(
        'INSERT INTO certifications (id, user_id, certifying_body, level) VALUES (?, ?, ?, ?)',
      )
        .bind(crypto.randomUUID(), user.id, 'ARA', 4)
        .run(),
    ).rejects.toThrow()
  })

  it('persists storage_sites and club_memberships with user relationship', async () => {
    const d = db()
    const [user] = await d
      .insert(schema.users)
      .values({
        email: 'storage-club@example.com',
        displayName: 'Storage Club Pilot',
        passwordHash: 'placeholder',
      })
      .returning()

    const [site] = await d
      .insert(schema.storageSites)
      .values({
        userId: user.id,
        name: 'South Australia Magazine B',
        location: 'Monarto Bunker 2',
        capacityKg: 5.5,
        permitNumber: 'SA-EXP-2026-99',
        notes: 'Licensed high-power magazine',
      })
      .returning()

    expect(site.id).toBeDefined()
    expect(site.name).toBe('South Australia Magazine B')
    expect(site.capacityKg).toBe(5.5)
    expect(site.permitNumber).toBe('SA-EXP-2026-99')

    const [membership] = await d
      .insert(schema.clubMemberships)
      .values({
        userId: user.id,
        clubName: 'Victorian Rocketry Association',
        membershipNumber: 'VRA-409',
        expiresOn: '2027-06-30',
      })
      .returning()

    expect(membership.id).toBeDefined()
    expect(membership.clubName).toBe('Victorian Rocketry Association')
    expect(membership.membershipNumber).toBe('VRA-409')

    // Foreign key enforcement
    await env.DB.prepare('PRAGMA foreign_keys = ON').run()
    await expect(
      d.insert(schema.storageSites).values({
        userId: crypto.randomUUID(),
        name: 'Orphan Site',
        capacityKg: 1.0,
      }),
    ).rejects.toThrow()

    await expect(
      d.insert(schema.clubMemberships).values({
        userId: crypto.randomUUID(),
        clubName: 'Orphan Club',
      }),
    ).rejects.toThrow()
  })

  it('persists duty officers on flights and operational roles on launch_events', async () => {
    const d = db()
    const [rsoUser] = await d
      .insert(schema.users)
      .values({ email: 'rso@example.com', displayName: 'Range Safety Officer', passwordHash: 'x' })
      .returning()
    const [flyer] = await d
      .insert(schema.users)
      .values({ email: 'm1flyer@example.com', displayName: 'M1 Flyer', passwordHash: 'x' })
      .returning()
    const [site] = await d
      .insert(schema.launchSites)
      .values({ name: 'Regional Launch Field' })
      .returning()

    const [event] = await d
      .insert(schema.launchEvents)
      .values({
        launchSiteId: site.id,
        name: 'Thunder Down Under 2026',
        launchDirector: 'Gene Kranz',
        tripoliPrefect: 'Chris Hadfield',
      })
      .returning()

    expect(event.launchDirector).toBe('Gene Kranz')
    expect(event.tripoliPrefect).toBe('Chris Hadfield')

    const [flight] = await d
      .insert(schema.flights)
      .values({
        flyerId: flyer.id,
        launchSiteId: site.id,
        launchEventId: event.id,
        rsoUserId: rsoUser.id,
        rsoName: 'Range Safety Officer',
        lcoName: 'Visiting LCO Guest',
      })
      .returning()

    expect(flight.rsoUserId).toBe(rsoUser.id)
    expect(flight.lcoUserId).toBeNull()
    expect(flight.rsoName).toBe('Range Safety Officer')
    expect(flight.lcoName).toBe('Visiting LCO Guest')
  })

  it('persists length and body diameter on rockets and rocket configurations', async () => {
    const d = db()
    const [user] = await d
      .insert(schema.users)
      .values({ email: 'rocketdims@example.com', displayName: 'Airframe Engineer', passwordHash: 'x' })
      .returning()

    const [rocket] = await d
      .insert(schema.rockets)
      .values({
        ownerId: user.id,
        name: 'Hyperion IV',
        lengthMm: 1850.5,
        bodyDiameterMm: 102.0,
      })
      .returning()

    expect(rocket.lengthMm).toBe(1850.5)
    expect(rocket.bodyDiameterMm).toBe(102.0)

    const [config] = await d
      .insert(schema.rocketConfigurations)
      .values({
        rocketId: rocket.id,
        version: 1,
        lengthMm: 1920.0,
        bodyDiameterMm: 102.0,
      })
      .returning()

    expect(config.lengthMm).toBe(1920.0)
    expect(config.bodyDiameterMm).toBe(102.0)
  })

  it('verifies seedTestStorageSite and seedTestClubMembership test helpers', async () => {
    const [user] = await db()
      .insert(schema.users)
      .values({ email: 'helpers@example.com', displayName: 'Helper Test', passwordHash: 'x' })
      .returning()

    const site = await seedTestStorageSite(user.id, {
      name: 'Custom Storage Locker',
      capacityKg: 4.2,
      permitNumber: 'PERMIT-TEST',
    })
    expect(site.id).toBeDefined()
    expect(site.name).toBe('Custom Storage Locker')
    expect(site.capacityKg).toBe(4.2)
    expect(site.permitNumber).toBe('PERMIT-TEST')

    const membership = await seedTestClubMembership(user.id, {
      clubName: 'Canberra Rocketry Group',
      membershipNumber: 'CRG-77',
    })
    expect(membership.id).toBeDefined()
    expect(membership.clubName).toBe('Canberra Rocketry Group')
    expect(membership.membershipNumber).toBe('CRG-77')
  })
})
