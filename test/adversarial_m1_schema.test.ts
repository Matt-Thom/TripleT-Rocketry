/**
 * Milestone 1 Empirical Adversarial Challenge Test Suite
 *
 * Authored by: Milestone 1 Challenger 1 (m1_challenger_1)
 * Purpose: Empirical stress-testing of database schema boundaries, CHECK constraints,
 * foreign key integrity, and truncateDb behavior under high dependency load.
 */

import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import {
  getDb,
  seedTestCert,
  seedTestClubMembership,
  seedTestComponent,
  seedTestConfig,
  seedTestEvent,
  seedTestFlight,
  seedTestInventory,
  seedTestMotor,
  seedTestRocket,
  seedTestSite,
  seedTestStorageSite,
  seedTestTransaction,
  seedTestUser,
  truncateDb,
} from './helpers/db'

const db = () => drizzle(env.DB, { schema })

beforeEach(async () => {
  await truncateDb()
})

describe('Milestone 1 Adversarial Challenge: Certifications CHECK Constraints', () => {
  it('accepts all 12 valid combinations of CERTIFYING_BODY and CERT_LEVEL', async () => {
    const user = await seedTestUser({ email: 'combo-user@example.com' })
    const bodies = ['NAR', 'TRA', 'ARA'] as const
    const levels = [0, 1, 2, 3] as const

    for (const body of bodies) {
      for (const level of levels) {
        const cert = await seedTestCert(user.id, {
          certifyingBody: body,
          level,
          certNumber: `${body}-LVL${level}`,
        })
        expect(cert.id).toBeDefined()
        expect(cert.certifyingBody).toBe(body)
        expect(cert.level).toBe(level)
      }
    }

    // Verify all 12 records exist in database
    const certs = await db()
      .select()
      .from(schema.certifications)
      .where(eq(schema.certifications.userId, user.id))
    expect(certs.length).toBe(12)
  })

  it('strictly rejects invalid certifyingBody values via SQLite CHECK constraint', async () => {
    const user = await seedTestUser({ email: 'invalid-body@example.com' })
    const invalidBodies = [
      'INVALID',
      'CAR',
      'UKRA',
      'NASA',
      'ara', // lower case
      'nar',
      'tra',
      'ARA ', // trailing space
      ' TRA', // leading space
      '', // empty string
      "' OR 1=1 --", // SQL injection payload
    ]

    for (const badBody of invalidBodies) {
      await expect(
        env.DB.prepare(
          'INSERT INTO certifications (id, user_id, certifying_body, level) VALUES (?, ?, ?, ?)',
        )
          .bind(crypto.randomUUID(), user.id, badBody, 1)
          .run(),
      ).rejects.toThrow(/CHECK constraint failed/i)
    }
  })

  it('strictly rejects invalid level values via SQLite CHECK constraint', async () => {
    const user = await seedTestUser({ email: 'invalid-level@example.com' })
    const invalidLevels = [-1, -999, 4, 5, 10, 100]

    for (const badLevel of invalidLevels) {
      await expect(
        env.DB.prepare(
          'INSERT INTO certifications (id, user_id, certifying_body, level) VALUES (?, ?, ?, ?)',
        )
          .bind(crypto.randomUUID(), user.id, 'ARA', badLevel)
          .run(),
      ).rejects.toThrow(/CHECK constraint failed/i)
    }
  })

  it('strictly enforces NOT NULL constraints on certifications certifyingBody and level', async () => {
    const user = await seedTestUser({ email: 'notnull-cert@example.com' })

    // NULL certifying_body
    await expect(
      env.DB.prepare(
        'INSERT INTO certifications (id, user_id, certifying_body, level) VALUES (?, ?, NULL, 1)',
      )
        .bind(crypto.randomUUID(), user.id)
        .run(),
    ).rejects.toThrow(/NOT NULL constraint failed/i)

    // NULL level
    await expect(
      env.DB.prepare(
        'INSERT INTO certifications (id, user_id, certifying_body, level) VALUES (?, ?, "ARA", NULL)',
      )
        .bind(crypto.randomUUID(), user.id)
        .run(),
    ).rejects.toThrow(/NOT NULL constraint failed/i)
  })
})

describe('Milestone 1 Adversarial Challenge: Foreign Key Integrity', () => {
  it('enforces foreign key rejection when storage_sites references non-existent userId', async () => {
    await env.DB.prepare('PRAGMA foreign_keys = ON').run()
    const nonExistentUserId = crypto.randomUUID()

    await expect(
      env.DB.prepare(
        'INSERT INTO storage_sites (id, user_id, name, capacity_kg) VALUES (?, ?, ?, ?)',
      )
        .bind(crypto.randomUUID(), nonExistentUserId, 'Ghost Bunker', 5.0)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/i)
  })

  it('enforces foreign key rejection when club_memberships references non-existent userId', async () => {
    await env.DB.prepare('PRAGMA foreign_keys = ON').run()
    const nonExistentUserId = crypto.randomUUID()

    await expect(
      env.DB.prepare(
        'INSERT INTO club_memberships (id, user_id, club_name, membership_number) VALUES (?, ?, ?, ?)',
      )
        .bind(crypto.randomUUID(), nonExistentUserId, 'Ghost Club', 'GHOST-01')
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/i)
  })

  it('prevents deletion of parent user when child storage_sites or club_memberships exist under FK ON', async () => {
    await env.DB.prepare('PRAGMA foreign_keys = ON').run()
    const user = await seedTestUser({ email: 'parent-nodelete@example.com' })
    await seedTestStorageSite(user.id, { name: 'Protected Bunker' })
    await seedTestClubMembership(user.id, { clubName: 'Protected Club' })

    // Deleting parent user must fail because neither table specifies CASCADE delete
    await expect(
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/i)

    // Deleting child tables first allows user deletion
    await env.DB.prepare('DELETE FROM storage_sites WHERE user_id = ?').bind(user.id).run()
    await env.DB.prepare('DELETE FROM club_memberships WHERE user_id = ?').bind(user.id).run()
    const res = await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run()
    expect(res.success).toBe(true)
  })

  it('enforces foreign key integrity on flight duty officers rsoUserId and lcoUserId', async () => {
    await env.DB.prepare('PRAGMA foreign_keys = ON').run()
    const flyer = await seedTestUser({ email: 'flyer-duty@example.com' })
    const site = await seedTestSite({ name: 'Duty Officer Launch Site' })
    const ghostUserId = crypto.randomUUID()

    // Invalid rso_user_id rejected
    await expect(
      env.DB.prepare(
        'INSERT INTO flights (id, flyer_id, launch_site_id, rso_user_id) VALUES (?, ?, ?, ?)',
      )
        .bind(crypto.randomUUID(), flyer.id, site.id, ghostUserId)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/i)

    // Invalid lco_user_id rejected
    await expect(
      env.DB.prepare(
        'INSERT INTO flights (id, flyer_id, launch_site_id, lco_user_id) VALUES (?, ?, ?, ?)',
      )
        .bind(crypto.randomUUID(), flyer.id, site.id, ghostUserId)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/i)

    // Valid flight with NULL duty officer user IDs but string names succeeds
    const [flight1] = await db()
      .insert(schema.flights)
      .values({
        flyerId: flyer.id,
        launchSiteId: site.id,
        rsoName: 'Visiting Officer',
        lcoName: 'Club Volunteer',
      })
      .returning()
    expect(flight1.rsoUserId).toBeNull()
    expect(flight1.lcoUserId).toBeNull()
    expect(flight1.rsoName).toBe('Visiting Officer')
    expect(flight1.lcoName).toBe('Club Volunteer')

    // Valid flight with valid duty officer user IDs succeeds
    const dutyOfficer = await seedTestUser({ email: 'officer@example.com' })
    const [flight2] = await db()
      .insert(schema.flights)
      .values({
        flyerId: flyer.id,
        launchSiteId: site.id,
        rsoUserId: dutyOfficer.id,
        lcoUserId: dutyOfficer.id,
        rsoName: 'Certified RSO',
        lcoName: 'Certified LCO',
      })
      .returning()
    expect(flight2.rsoUserId).toBe(dutyOfficer.id)
    expect(flight2.lcoUserId).toBe(dutyOfficer.id)
  })
})

describe('Milestone 1 Adversarial Challenge: truncateDb with Dense Graph & PRAGMA foreign_keys = ON', () => {
  it('cleans up every table without foreign key violations when all 16 tables are populated', async () => {
    // 1. Seed user
    const flyer = await seedTestUser({ email: 'dense-flyer@example.com' })
    const rso = await seedTestUser({ email: 'dense-rso@example.com' })
    const lco = await seedTestUser({ email: 'dense-lco@example.com' })

    // 2. Seed certifications
    await seedTestCert(flyer.id, { certifyingBody: 'ARA', level: 0 })
    await seedTestCert(flyer.id, { certifyingBody: 'TRA', level: 2 })

    // 3. Seed club memberships
    await seedTestClubMembership(flyer.id, { clubName: 'VRA', membershipNumber: 'VRA-100' })
    await seedTestClubMembership(flyer.id, { clubName: 'SARC', membershipNumber: 'SARC-200' })
    await seedTestClubMembership(flyer.id, { clubName: 'Tripoli', membershipNumber: 'TRA-300' })
    await seedTestClubMembership(flyer.id, { clubName: 'ARA', membershipNumber: 'ARA-400' })

    // 4. Seed storage sites
    await seedTestStorageSite(flyer.id, {
      name: 'Adelaide Hills Magazine',
      capacityKg: 4.5,
      permitNumber: 'EXP-SA-2026',
    })
    await seedTestStorageSite(flyer.id, {
      name: 'Monarto Field Locker',
      capacityKg: 1.5,
    })

    // 5. Seed rocket and configurations with airframe dimensions
    const rocket = await seedTestRocket(flyer.id, {
      name: 'Big Bertha HD',
      lengthMm: 1200.5,
      bodyDiameterMm: 66.0,
    })
    const config = await seedTestConfig(rocket.id, {
      version: 1,
      lengthMm: 1200.5,
      bodyDiameterMm: 66.0,
    })

    // 6. Seed motor and motor inventory
    const motor = await seedTestMotor({
      manufacturer: 'Cesaroni',
      model: 'I205',
      impulseClass: 'I',
    })
    const inventory = await seedTestInventory(flyer.id, motor.id, {
      quantityOnHand: 4,
    })

    // 7. Seed component
    const component = await seedTestComponent(flyer.id, {
      category: 'avionics',
      name: 'Altus Metrum TeleMetrum',
    })

    // 8. Seed launch site & launch event with operational roles
    const site = await seedTestSite({ name: 'Lake Frome' })
    const event = await seedTestEvent(site.id, {
      name: 'Southern Cross Launch 2026',
      startsOn: '1999-12-31', // Past date resilience
      endsOn: '2000-01-02',
      launchDirector: 'Marcus Director',
      tripoliPrefect: 'Prefect Sarah',
      rsoUserId: rso.id,
      lcoUserId: lco.id,
    })

    // 9. Seed flight linking everything
    const flight = await seedTestFlight(flyer.id, {
      rocketConfigurationId: config.id,
      motorId: motor.id,
      motorInventoryId: inventory.id,
      launchSiteId: site.id,
      launchEventId: event.id,
      rsoUserId: rso.id,
      lcoUserId: lco.id,
      rsoName: 'Marcus Director',
      lcoName: 'Prefect Sarah',
    })

    // 10. Seed inventory transaction
    await seedTestTransaction(flyer.id, {
      motorInventoryId: inventory.id,
      componentId: component.id,
      transactionType: 'used',
      quantity: 1,
    })

    // Turn ON foreign keys explicitly
    await env.DB.prepare('PRAGMA foreign_keys = ON').run()

    // Execute truncateDb under strict foreign keys
    await expect(truncateDb()).resolves.not.toThrow()

    // Verify all 16 tables are completely emptied
    const tables = [
      'users',
      'certifications',
      'club_memberships',
      'storage_sites',
      'rockets',
      'rocket_configurations',
      'motors',
      'motor_inventories',
      'components',
      'launch_sites',
      'launch_events',
      'flights',
      'inventory_transactions',
      'sessions',
      'user_credentials',
      'site_settings',
    ]

    for (const table of tables) {
      const { results } = await env.DB.prepare(`SELECT count(*) as cnt FROM ${table}`).all<{
        cnt: number
      }>()
      expect(results[0].cnt).toBe(0)
    }
  })
})

describe('Milestone 1 Adversarial Challenge: Schema Boundary Edge Cases', () => {
  it('supports multiple club memberships per flyer with null optional fields', async () => {
    const user = await seedTestUser({ email: 'multi-club@example.com' })

    // Insert multiple memberships with optional null values
    const m1 = await seedTestClubMembership(user.id, {
      clubName: 'Canberra Rocketry',
      membershipNumber: null,
      expiresOn: null,
    })
    const m2 = await seedTestClubMembership(user.id, {
      clubName: 'Victorian Rocketry Association',
      membershipNumber: 'VRA-999',
      expiresOn: '2030-01-01',
    })

    expect(m1.membershipNumber).toBeNull()
    expect(m1.expiresOn).toBeNull()
    expect(m2.membershipNumber).toBe('VRA-999')

    const memberships = await db()
      .select()
      .from(schema.clubMemberships)
      .where(eq(schema.clubMemberships.userId, user.id))
    expect(memberships.length).toBe(2)
  })

  it('handles storage site capacity edge cases: zero, decimal, large numbers', async () => {
    const user = await seedTestUser({ email: 'capacity-test@example.com' })

    const s0 = await seedTestStorageSite(user.id, { capacityKg: 0 })
    const sSmall = await seedTestStorageSite(user.id, { capacityKg: 0.0001 })
    const sExact = await seedTestStorageSite(user.id, { capacityKg: 3.0 })
    const sAbove = await seedTestStorageSite(user.id, { capacityKg: 3.0001, permitNumber: 'SA-123' })
    const sLarge = await seedTestStorageSite(user.id, { capacityKg: 9999.99, permitNumber: 'SA-999' })

    expect(s0.capacityKg).toBe(0)
    expect(sSmall.capacityKg).toBe(0.0001)
    expect(sExact.capacityKg).toBe(3.0)
    expect(sAbove.capacityKg).toBe(3.0001)
    expect(sLarge.capacityKg).toBe(9999.99)
  })

  it('handles rocket airframe dimensions: decimal millimeter precision and nullability', async () => {
    const user = await seedTestUser({ email: 'rocket-precision@example.com' })

    // Null dimensions
    const rNull = await seedTestRocket(user.id, {
      name: 'Unmeasured Rocket',
      lengthMm: null,
      bodyDiameterMm: null,
    })
    expect(rNull.lengthMm).toBeNull()
    expect(rNull.bodyDiameterMm).toBeNull()

    // High precision decimal dimensions
    const rPrecise = await seedTestRocket(user.id, {
      name: 'Precision Rocket',
      lengthMm: 2450.75,
      bodyDiameterMm: 152.4,
    })
    expect(rPrecise.lengthMm).toBe(2450.75)
    expect(rPrecise.bodyDiameterMm).toBe(152.4)
  })

  it('handles launch event operational roles with past event dates and unicode strings', async () => {
    const site = await seedTestSite({ name: 'Historic Range' })

    const event = await seedTestEvent(site.id, {
      name: 'Historic Launch 1985 🚀',
      startsOn: '1985-07-20T08:00:00Z',
      endsOn: '1985-07-21T18:00:00Z',
      launchDirector: 'Dr. Wernher von Braun',
      tripoliPrefect: 'Hermann Oberth',
    })

    expect(event.startsOn).toBe('1985-07-20T08:00:00Z')
    expect(event.launchDirector).toBe('Dr. Wernher von Braun')
    expect(event.tripoliPrefect).toBe('Hermann Oberth')
  })
})
