/**
 * Database test helpers and model seed factories for TripleT-Rocketry.
 * Provides typed factories for all 9 domain entities in the D1 schema
 * and clean graph truncation in reverse foreign-key dependency order.
 */

import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../../src/db/schema'

export const getDb = () => drizzle(env.DB, { schema })

/**
 * Truncate all 9 Phase 1 tables in reverse foreign-key dependency order
 * so each test run starts with an empty, isolated database graph.
 */
export async function truncateDb(): Promise<void> {
  const tablesInReverseFkOrder = [
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
  ]
  for (const table of tablesInReverseFkOrder) {
    await env.DB.prepare(`DELETE FROM ${table}`).run()
  }
}

/**
 * Seed a user record in the users table.
 */
export async function seedTestUser(
  overrides: Partial<typeof schema.users.$inferInsert> = {},
) {
  const db = getDb()
  const [user] = await db
    .insert(schema.users)
    .values({
      email: overrides.email ?? `flyer-${crypto.randomUUID().slice(0, 8)}@example.com`,
      displayName: overrides.displayName ?? 'TripleT Pilot',
      // Genuine PBKDF2 hash for 'TestPassword123!' (BL-02 fixture remediation)
      passwordHash:
        overrides.passwordHash ??
        'pbkdf2$100000$94c071ead342a98237ddc6e888de8e73$e1f44c60c58bcd981adb201fefb795226a85b2ef39ed4a309b931ce11cde7399',
      isActive: overrides.isActive ?? true,
      ...overrides,
    })
    .returning()
  return user
}

/**
 * Seed a certification record for a user.
 */
export async function seedTestCert(
  userId: string,
  overrides: Partial<typeof schema.certifications.$inferInsert> = {},
) {
  const db = getDb()
  const [cert] = await db
    .insert(schema.certifications)
    .values({
      userId,
      certifyingBody: overrides.certifyingBody ?? 'NAR',
      level: overrides.level ?? 1,
      certNumber: overrides.certNumber ?? `NAR-${crypto.randomUUID().slice(0, 6)}`,
      expiresOn: overrides.expiresOn ?? '2028-12-31',
      ...overrides,
    })
    .returning()
  return cert
}

/**
 * Seed a rocket airframe owned by a user.
 */
export async function seedTestRocket(
  ownerId: string,
  overrides: Partial<typeof schema.rockets.$inferInsert> = {},
) {
  const db = getDb()
  const [rocket] = await db
    .insert(schema.rockets)
    .values({
      ownerId,
      name: overrides.name ?? 'AeroTech Initiator',
      status: overrides.status ?? 'flight_ready',
      ...overrides,
    })
    .returning()
  return rocket
}

/**
 * Seed a versioned rocket configuration snapshot.
 */
export async function seedTestConfig(
  rocketId: string,
  overrides: Partial<typeof schema.rocketConfigurations.$inferInsert> = {},
) {
  const db = getDb()
  const [config] = await db
    .insert(schema.rocketConfigurations)
    .values({
      rocketId,
      version: overrides.version ?? 1,
      airframeMaterial: overrides.airframeMaterial ?? 'cardboard',
      finCount: overrides.finCount ?? 4,
      dryMassG: overrides.dryMassG ?? 380.0,
      loadedMassG: overrides.loadedMassG ?? 520.0,
      stabilityCalibers: overrides.stabilityCalibers ?? 1.6,
      recoveryType: overrides.recoveryType ?? 'parachute',
      parachuteSizeMm: overrides.parachuteSizeMm ?? 600,
      motorMountDiameterMm: overrides.motorMountDiameterMm ?? 29,
      isCurrent: overrides.isCurrent ?? true,
      ...overrides,
    })
    .returning()
  return config
}

/**
 * Seed a motor in the motor catalog.
 */
export async function seedTestMotor(
  overrides: Partial<typeof schema.motors.$inferInsert> = {},
) {
  const db = getDb()
  const impulse = overrides.impulseClass ?? 'G'
  const defaultModel = impulse === 'G' ? 'G80W' : `${impulse}${Math.floor(Math.random() * 900 + 100)}W`
  const [motor] = await db
    .insert(schema.motors)
    .values({
      manufacturer: overrides.manufacturer ?? 'AeroTech',
      model: overrides.model ?? defaultModel,
      impulseClass: impulse,
      totalImpulseNs: overrides.totalImpulseNs ?? (impulse === 'G' ? 120.0 : 200.0),
      averageThrustN: overrides.averageThrustN ?? (impulse === 'G' ? 80.0 : 128.0),
      delayS: overrides.delayS ?? 10,
      propellantType: overrides.propellantType ?? 'apcp',
      certifyingOrg: overrides.certifyingOrg ?? 'BOTH',
      casingReusable: overrides.casingReusable ?? false,
      ...overrides,
    })
    .returning()
  return motor
}

/**
 * Seed a user's inventory record for a specific motor.
 */
export async function seedTestInventory(
  userId: string,
  motorId: string,
  overrides: Partial<typeof schema.motorInventories.$inferInsert> = {},
) {
  const db = getDb()
  const [inventory] = await db
    .insert(schema.motorInventories)
    .values({
      userId,
      motorId,
      quantityOnHand: overrides.quantityOnHand ?? 3,
      expendedCount: overrides.expendedCount ?? 0,
      ...overrides,
    })
    .returning()
  return inventory
}

/**
 * Seed a launch site with location and altitude waiver ceiling.
 */
export async function seedTestSite(
  overrides: Partial<typeof schema.launchSites.$inferInsert> = {},
) {
  const db = getDb()
  const [site] = await db
    .insert(schema.launchSites)
    .values({
      name: overrides.name ?? 'Lucerne Valley Dry Lake',
      latitude: overrides.latitude ?? 34.52,
      longitude: overrides.longitude ?? -116.95,
      maxAltitudeAglM: overrides.maxAltitudeAglM ?? 3000,
      ...overrides,
    })
    .returning()
  return site
}

/**
 * Seed a launch event hosted at a launch site.
 */
export async function seedTestEvent(
  launchSiteId: string,
  overrides: Partial<typeof schema.launchEvents.$inferInsert> = {},
) {
  const db = getDb()
  const [event] = await db
    .insert(schema.launchEvents)
    .values({
      launchSiteId,
      name: overrides.name ?? 'ROC Monthly Launch',
      startsOn: overrides.startsOn ?? '2026-06-12',
      endsOn: overrides.endsOn ?? '2026-06-14',
      padCount: overrides.padCount ?? 16,
      ...overrides,
    })
    .returning()
  return event
}

/**
 * Seed a flight log record linking a flyer, rocket config, motor, site, and event.
 */
export async function seedTestFlight(
  flyerId: string,
  overrides: Partial<typeof schema.flights.$inferInsert> = {},
) {
  const db = getDb()
  const [flight] = await db
    .insert(schema.flights)
    .values({
      flyerId,
      flightNumber: overrides.flightNumber ?? 1,
      flownAt: overrides.flownAt ?? Date.now(),
      outcome: overrides.outcome ?? 'successful',
      logType: overrides.logType ?? 'actual',
      softGateWarnings: overrides.softGateWarnings ?? [],
      proceededDespiteWarnings: overrides.proceededDespiteWarnings ?? false,
      isFirstFlight: overrides.isFirstFlight ?? false,
      certAttempt: overrides.certAttempt ?? 'none',
      ...overrides,
    })
    .returning()
  return flight
}

/**
  * Seed a component inventory record.
  */
export async function seedTestComponent(
  userId: string,
  overrides: Partial<typeof schema.components.$inferInsert> = {},
) {
  const db = getDb()
  const [component] = await db
    .insert(schema.components)
    .values({
      userId,
      name: overrides.name ?? 'AeroTech 29/180 Hardware Casing',
      category: overrides.category ?? 'casing',
      quantityOnHand: overrides.quantityOnHand ?? 1,
      quantityAllocated: overrides.quantityAllocated ?? 0,
      quantityExpended: overrides.quantityExpended ?? 0,
      quantityDisposed: overrides.quantityDisposed ?? 0,
      unit: overrides.unit ?? 'ea',
      condition: overrides.condition ?? 'new',
      storageLocation: overrides.storageLocation ?? 'Workshop Drawer 1',
      ...overrides,
    })
    .returning()
  return component
}

/**
  * Seed an inventory transaction (chain-of-custody audit log).
  */
export async function seedTestTransaction(
  userId: string,
  overrides: Partial<typeof schema.inventoryTransactions.$inferInsert> = {},
) {
  const db = getDb()
  const [tx] = await db
    .insert(schema.inventoryTransactions)
    .values({
      userId,
      transactionType: overrides.transactionType ?? 'received',
      quantity: overrides.quantity ?? 1,
      transactionDate: overrides.transactionDate ?? '2026-09-04',
      storageLocation: overrides.storageLocation ?? 'Explosives Magazine Alpha',
      ...overrides,
    })
    .returning()
  return tx
}

/**
 * Seed a physical propellant storage site or magazine.
 */
export async function seedTestStorageSite(
  userId: string,
  overrides: Partial<typeof schema.storageSites.$inferInsert> = {},
) {
  const db = getDb()
  const [site] = await db
    .insert(schema.storageSites)
    .values({
      userId,
      name: overrides.name ?? 'Explosives Magazine Alpha',
      location: overrides.location ?? 'Bunker 1',
      capacityKg: overrides.capacityKg ?? 2.5,
      ...overrides,
    })
    .returning()
  return site
}

/**
 * Seed a club membership record for a flyer.
 */
export async function seedTestClubMembership(
  userId: string,
  overrides: Partial<typeof schema.clubMemberships.$inferInsert> = {},
) {
  const db = getDb()
  const [membership] = await db
    .insert(schema.clubMemberships)
    .values({
      userId,
      clubName: overrides.clubName ?? 'Southern Area Rocketry Club',
      membershipNumber: overrides.membershipNumber ?? 'SARC-1001',
      expiresOn: overrides.expiresOn ?? '2027-12-31',
      ...overrides,
    })
    .returning()
  return membership
}
