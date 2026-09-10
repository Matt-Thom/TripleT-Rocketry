/**
 * Milestone 1 Challenger 2 Empirical Adversarial Test Suite
 *
 * Authored by: Milestone 1 Challenger 2 (m1_challenger_2)
 * Scope: Migration alignment, regression defense, and extreme boundary value analysis
 * for newly introduced numeric fields:
 * - capacity_kg on storage_sites
 * - length_mm on rockets and rocket_configurations
 * - body_diameter_mm on rockets and rocket_configurations
 */

import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { asc, desc, eq, gt, gte, lt, lte, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import {
  getDb,
  seedTestConfig,
  seedTestRocket,
  seedTestStorageSite,
  seedTestUser,
  truncateDb,
} from './helpers/db'

const db = () => drizzle(env.DB, { schema })

beforeEach(async () => {
  await truncateDb()
})

describe('Milestone 1 Challenger 2: Extreme & Boundary Values for capacity_kg', () => {
  it('defaults capacity_kg to 0 when omitted from insert', async () => {
    const user = await seedTestUser({ email: 'cap-default@example.com' })
    const [site] = await db()
      .insert(schema.storageSites)
      .values({
        userId: user.id,
        name: 'Default Capacity Locker',
      })
      .returning()

    expect(site.capacityKg).toBe(0)

    const queried = await db().query.storageSites.findFirst({
      where: eq(schema.storageSites.id, site.id),
    })
    expect(queried?.capacityKg).toBe(0)
  })

  it('accepts zero (0 and 0.0) capacity_kg explicitly', async () => {
    const user = await seedTestUser({ email: 'cap-zero@example.com' })

    const s1 = await seedTestStorageSite(user.id, {
      name: 'Zero Cap 1',
      capacityKg: 0,
    })
    const s2 = await seedTestStorageSite(user.id, {
      name: 'Zero Cap 2',
      capacityKg: 0.0,
    })

    expect(s1.capacityKg).toBe(0)
    expect(s2.capacityKg).toBe(0)
  })

  it('evaluates exact threshold and sub-microgram delta at SafeWork SA 3.0 kg boundary', async () => {
    const user = await seedTestUser({ email: 'cap-threshold@example.com' })

    // Exactly 3.0 kg (at threshold)
    const exact = await seedTestStorageSite(user.id, {
      name: 'Exact 3kg Magazine',
      capacityKg: 3.0,
    })
    expect(exact.capacityKg).toBe(3.0)

    // Just below 3.0 kg: 2.999999 kg
    const below = await seedTestStorageSite(user.id, {
      name: 'Sub-threshold Magazine',
      capacityKg: 2.999999,
    })
    expect(below.capacityKg).toBeCloseTo(2.999999, 6)

    // Just above 3.0 kg: 3.000001 kg
    const above = await seedTestStorageSite(user.id, {
      name: 'Super-threshold Magazine',
      capacityKg: 3.000001,
      permitNumber: 'SA-EX-3000001',
    })
    expect(above.capacityKg).toBeCloseTo(3.000001, 6)
    expect(above.permitNumber).toBe('SA-EX-3000001')

    // SQL query filtering at boundary
    const overThreshold = await db()
      .select()
      .from(schema.storageSites)
      .where(gt(schema.storageSites.capacityKg, 3.0))

    expect(overThreshold.length).toBe(1)
    expect(overThreshold[0].name).toBe('Super-threshold Magazine')

    const atOrUnderThreshold = await db()
      .select()
      .from(schema.storageSites)
      .where(lte(schema.storageSites.capacityKg, 3.0))

    expect(atOrUnderThreshold.length).toBe(2)
  })

  it('handles microscopic/epsilon positive floats (1e-6, 1e-12)', async () => {
    const user = await seedTestUser({ email: 'cap-micro@example.com' })

    const micro = await seedTestStorageSite(user.id, {
      name: 'Micro Sample Storage',
      capacityKg: 1e-6,
    })
    expect(micro.capacityKg).toBe(1e-6)

    const pico = await seedTestStorageSite(user.id, {
      name: 'Pico Sample Storage',
      capacityKg: 1e-12,
    })
    expect(pico.capacityKg).toBe(1e-12)
  })

  it('handles extremely large capacities up to Number.MAX_SAFE_INTEGER and massive floats', async () => {
    const user = await seedTestUser({ email: 'cap-massive@example.com' })

    // 50,000 kg (industrial storage)
    const industrial = await seedTestStorageSite(user.id, {
      name: 'Industrial Depot',
      capacityKg: 50000.0,
      permitNumber: 'IND-50T',
    })
    expect(industrial.capacityKg).toBe(50000.0)

    // Number.MAX_SAFE_INTEGER: 9,007,199,254,740,991
    const maxSafe = await seedTestStorageSite(user.id, {
      name: 'Theoretical Max Safe',
      capacityKg: Number.MAX_SAFE_INTEGER,
    })
    expect(maxSafe.capacityKg).toBe(Number.MAX_SAFE_INTEGER)

    // 1e15 (petagram scale)
    const petagram = await seedTestStorageSite(user.id, {
      name: 'Planetary Depot',
      capacityKg: 1e15,
    })
    expect(petagram.capacityKg).toBe(1e15)
  })

  it('preserves high precision decimal floating point round-trip', async () => {
    const user = await seedTestUser({ email: 'cap-precision@example.com' })
    const highPrecision = 12.345678901234

    const site = await seedTestStorageSite(user.id, {
      name: 'High Precision Scale',
      capacityKg: highPrecision,
    })

    const retrieved = await db().query.storageSites.findFirst({
      where: eq(schema.storageSites.id, site.id),
    })

    expect(retrieved?.capacityKg).toBeCloseTo(highPrecision, 10)
  })

  it('strictly enforces SQLite NOT NULL constraint on capacity_kg when null is attempted via raw SQL', async () => {
    const user = await seedTestUser({ email: 'cap-null@example.com' })

    await expect(
      env.DB.prepare(
        'INSERT INTO storage_sites (id, user_id, name, capacity_kg) VALUES (?, ?, ?, NULL)',
      )
        .bind(crypto.randomUUID(), user.id, 'Illegal Null Capacity')
        .run(),
    ).rejects.toThrow(/NOT NULL constraint failed/i)
  })

  it('supports updating capacity_kg from zero to positive and vice versa', async () => {
    const user = await seedTestUser({ email: 'cap-update@example.com' })
    const site = await seedTestStorageSite(user.id, {
      name: 'Dynamic Bunker',
      capacityKg: 0,
    })

    // Upgrade to 15.5 kg with permit
    await db()
      .update(schema.storageSites)
      .set({ capacityKg: 15.5, permitNumber: 'SA-UPGRADE-1' })
      .where(eq(schema.storageSites.id, site.id))

    const updated1 = await db().query.storageSites.findFirst({
      where: eq(schema.storageSites.id, site.id),
    })
    expect(updated1?.capacityKg).toBe(15.5)
    expect(updated1?.permitNumber).toBe('SA-UPGRADE-1')

    // Downgrade back to 0
    await db()
      .update(schema.storageSites)
      .set({ capacityKg: 0 })
      .where(eq(schema.storageSites.id, site.id))

    const updated2 = await db().query.storageSites.findFirst({
      where: eq(schema.storageSites.id, site.id),
    })
    expect(updated2?.capacityKg).toBe(0)
  })

  it('performs accurate SQL aggregation (SUM, AVG, MIN, MAX) over capacity_kg', async () => {
    const user = await seedTestUser({ email: 'cap-agg@example.com' })
    await seedTestStorageSite(user.id, { name: 'Site 1', capacityKg: 1.5 })
    await seedTestStorageSite(user.id, { name: 'Site 2', capacityKg: 3.5 })
    await seedTestStorageSite(user.id, { name: 'Site 3', capacityKg: 5.0 })

    const { results } = await env.DB.prepare(
      'SELECT SUM(capacity_kg) as total, AVG(capacity_kg) as mean, MIN(capacity_kg) as min_val, MAX(capacity_kg) as max_val FROM storage_sites WHERE user_id = ?',
    )
      .bind(user.id)
      .all<{ total: number; mean: number; min_val: number; max_val: number }>()

    expect(results[0].total).toBeCloseTo(10.0, 5)
    expect(results[0].mean).toBeCloseTo(10.0 / 3, 5)
    expect(results[0].min_val).toBe(1.5)
    expect(results[0].max_val).toBe(5.0)
  })
})

describe('Milestone 1 Challenger 2: Extreme & Boundary Values for length_mm and body_diameter_mm', () => {
  it('allows NULL and undefined on rockets lengthMm and bodyDiameterMm', async () => {
    const user = await seedTestUser({ email: 'dim-null@example.com' })

    // Explicit undefined (omitted)
    const [r1] = await db()
      .insert(schema.rockets)
      .values({
        ownerId: user.id,
        name: 'Omitted Dimensions Rocket',
      })
      .returning()

    expect(r1.lengthMm).toBeNull()
    expect(r1.bodyDiameterMm).toBeNull()

    // Explicit null
    const [r2] = await db()
      .insert(schema.rockets)
      .values({
        ownerId: user.id,
        name: 'Null Dimensions Rocket',
        lengthMm: null,
        bodyDiameterMm: null,
      })
      .returning()

    expect(r2.lengthMm).toBeNull()
    expect(r2.bodyDiameterMm).toBeNull()
  })

  it('allows NULL and undefined on rocketConfigurations lengthMm and bodyDiameterMm', async () => {
    const user = await seedTestUser({ email: 'config-null@example.com' })
    const rocket = await seedTestRocket(user.id, { name: 'Config Test Rocket' })

    const [c1] = await db()
      .insert(schema.rocketConfigurations)
      .values({
        rocketId: rocket.id,
        version: 1,
      })
      .returning()

    expect(c1.lengthMm).toBeNull()
    expect(c1.bodyDiameterMm).toBeNull()

    const [c2] = await db()
      .insert(schema.rocketConfigurations)
      .values({
        rocketId: rocket.id,
        version: 2,
        lengthMm: null,
        bodyDiameterMm: null,
      })
      .returning()

    expect(c2.lengthMm).toBeNull()
    expect(c2.bodyDiameterMm).toBeNull()
  })

  it('handles zero values (0.0 mm) for lengthMm and bodyDiameterMm', async () => {
    const user = await seedTestUser({ email: 'dim-zero@example.com' })

    const [rocket] = await db()
      .insert(schema.rockets)
      .values({
        ownerId: user.id,
        name: 'Zero Dimension Rocket',
        lengthMm: 0,
        bodyDiameterMm: 0.0,
      })
      .returning()

    expect(rocket.lengthMm).toBe(0)
    expect(rocket.bodyDiameterMm).toBe(0)

    const [config] = await db()
      .insert(schema.rocketConfigurations)
      .values({
        rocketId: rocket.id,
        version: 1,
        lengthMm: 0.0,
        bodyDiameterMm: 0,
      })
      .returning()

    expect(config.lengthMm).toBe(0)
    expect(config.bodyDiameterMm).toBe(0)
  })

  it('handles sub-millimeter precision airframes (e.g. 0.05 mm, 0.001 mm)', async () => {
    const user = await seedTestUser({ email: 'dim-submm@example.com' })

    const [rocket] = await db()
      .insert(schema.rockets)
      .values({
        ownerId: user.id,
        name: 'Micro Scale Prototype',
        lengthMm: 25.455,
        bodyDiameterMm: 1.275,
      })
      .returning()

    expect(rocket.lengthMm).toBe(25.455)
    expect(rocket.bodyDiameterMm).toBe(1.275)

    const [config] = await db()
      .insert(schema.rocketConfigurations)
      .values({
        rocketId: rocket.id,
        version: 1,
        lengthMm: 25.455,
        bodyDiameterMm: 1.275,
      })
      .returning()

    expect(config.lengthMm).toBe(25.455)
    expect(config.bodyDiameterMm).toBe(1.275)
  })

  it('handles standard model and high-power rocketry body tube diameters accurately', async () => {
    const user = await seedTestUser({ email: 'dim-standard@example.com' })

    // Common body tube diameters (mm): BT-5: 13.8, BT-20: 18.7, BT-50: 24.8, BT-60: 41.6, BT-80: 66.0, 3-inch: 75.0, 4-inch: 98.0, 6-inch: 152.4
    const standardDiameters = [13.8, 18.7, 24.8, 41.6, 66.0, 75.0, 98.0, 152.4]

    for (let i = 0; i < standardDiameters.length; i++) {
      const diameter = standardDiameters[i]
      const length = 200.0 * (i + 1)

      const [rocket] = await db()
        .insert(schema.rockets)
        .values({
          ownerId: user.id,
          name: `Standard Caliber ${diameter}mm`,
          lengthMm: length,
          bodyDiameterMm: diameter,
        })
        .returning()

      expect(rocket.lengthMm).toBe(length)
      expect(rocket.bodyDiameterMm).toBe(diameter)
    }

    const allRockets = await db()
      .select()
      .from(schema.rockets)
      .where(eq(schema.rockets.ownerId, user.id))

    expect(allRockets.length).toBe(standardDiameters.length)
  })

  it('handles massive full-scale launch vehicle airframe dimensions', async () => {
    const user = await seedTestUser({ email: 'dim-massive@example.com' })

    // SpaceX Starship: Length 121,000 mm (121 m), Diameter 9,000 mm (9 m)
    const [starship] = await db()
      .insert(schema.rockets)
      .values({
        ownerId: user.id,
        name: 'Full Scale Starship',
        lengthMm: 121000.0,
        bodyDiameterMm: 9000.0,
      })
      .returning()

    expect(starship.lengthMm).toBe(121000.0)
    expect(starship.bodyDiameterMm).toBe(9000.0)

    // Saturn V: Length 110,600 mm (110.6 m), Diameter 10,100 mm (10.1 m)
    const [saturnV] = await db()
      .insert(schema.rockets)
      .values({
        ownerId: user.id,
        name: 'Saturn V Apollo',
        lengthMm: 110600.0,
        bodyDiameterMm: 10100.0,
      })
      .returning()

    expect(saturnV.lengthMm).toBe(110600.0)
    expect(saturnV.bodyDiameterMm).toBe(10100.0)

    // Extreme scale: 1,000,000,000 mm (1,000 km sounding projectile)
    const [extreme] = await db()
      .insert(schema.rockets)
      .values({
        ownerId: user.id,
        name: 'Orbital Tether Probe',
        lengthMm: 1e9,
        bodyDiameterMm: 50000.0,
      })
      .returning()

    expect(extreme.lengthMm).toBe(1e9)
    expect(extreme.bodyDiameterMm).toBe(50000.0)
  })

  it('supports updating dimensions independently on rockets and configurations', async () => {
    const user = await seedTestUser({ email: 'dim-update@example.com' })
    const [rocket] = await db()
      .insert(schema.rockets)
      .values({
        ownerId: user.id,
        name: 'Evolving Airframe',
        lengthMm: 1000.0,
        bodyDiameterMm: 54.0,
      })
      .returning()

    const [config] = await db()
      .insert(schema.rocketConfigurations)
      .values({
        rocketId: rocket.id,
        version: 1,
        lengthMm: 1000.0,
        bodyDiameterMm: 54.0,
      })
      .returning()

    // Add payload bay extender: length becomes 1350.0 mm
    await db()
      .update(schema.rockets)
      .set({ lengthMm: 1350.0 })
      .where(eq(schema.rockets.id, rocket.id))

    // New configuration with version 2
    const [config2] = await db()
      .insert(schema.rocketConfigurations)
      .values({
        rocketId: rocket.id,
        version: 2,
        lengthMm: 1350.0,
        bodyDiameterMm: 54.0,
      })
      .returning()

    const updatedRocket = await db().query.rockets.findFirst({
      where: eq(schema.rockets.id, rocket.id),
    })
    expect(updatedRocket?.lengthMm).toBe(1350.0)
    expect(updatedRocket?.bodyDiameterMm).toBe(54.0)

    expect(config.lengthMm).toBe(1000.0)
    expect(config2.lengthMm).toBe(1350.0)
  })

  it('supports relational filtering and sorting by lengthMm and bodyDiameterMm', async () => {
    const user = await seedTestUser({ email: 'dim-filter@example.com' })

    await db().insert(schema.rockets).values([
      { ownerId: user.id, name: 'Mini', lengthMm: 300, bodyDiameterMm: 24 },
      { ownerId: user.id, name: 'Medium', lengthMm: 1200, bodyDiameterMm: 54 },
      { ownerId: user.id, name: 'Large', lengthMm: 2500, bodyDiameterMm: 98 },
      { ownerId: user.id, name: 'Heavy', lengthMm: 3800, bodyDiameterMm: 152 },
    ])

    // Query sorted by length ascending
    const sortedAsc = await db()
      .select()
      .from(schema.rockets)
      .where(eq(schema.rockets.ownerId, user.id))
      .orderBy(asc(schema.rockets.lengthMm))

    expect(sortedAsc.map((r) => r.name)).toEqual(['Mini', 'Medium', 'Large', 'Heavy'])

    // Query sorted by bodyDiameter descending
    const sortedDesc = await db()
      .select()
      .from(schema.rockets)
      .where(eq(schema.rockets.ownerId, user.id))
      .orderBy(desc(schema.rockets.bodyDiameterMm))

    expect(sortedDesc.map((r) => r.name)).toEqual(['Heavy', 'Large', 'Medium', 'Mini'])

    // Filter between 50mm and 100mm diameter
    const filtered = await db()
      .select()
      .from(schema.rockets)
      .where(
        sql`${schema.rockets.ownerId} = ${user.id} AND ${schema.rockets.bodyDiameterMm} >= 50 AND ${schema.rockets.bodyDiameterMm} <= 100`,
      )

    expect(filtered.map((r) => r.name).sort()).toEqual(['Large', 'Medium'])
  })

  it('verifies coexistence of dimensions with existing physics columns on rocketConfigurations', async () => {
    const user = await seedTestUser({ email: 'dim-coexist@example.com' })
    const rocket = await seedTestRocket(user.id, {
      name: 'Full Physics Rocket',
      lengthMm: 1850.5,
      bodyDiameterMm: 102.0,
    })

    const config = await seedTestConfig(rocket.id, {
      version: 1,
      lengthMm: 1850.5,
      bodyDiameterMm: 102.0,
      dryMassG: 1250.0,
      loadedMassG: 2100.0,
      stabilityCalibers: 2.35,
      finCount: 4,
      parachuteSizeMm: 900,
      motorMountDiameterMm: 54,
    })

    expect(config.lengthMm).toBe(1850.5)
    expect(config.bodyDiameterMm).toBe(102.0)
    expect(config.dryMassG).toBe(1250.0)
    expect(config.loadedMassG).toBe(2100.0)
    expect(config.stabilityCalibers).toBe(2.35)
    expect(config.finCount).toBe(4)
    expect(config.parachuteSizeMm).toBe(900)
    expect(config.motorMountDiameterMm).toBe(54)
  })
})
