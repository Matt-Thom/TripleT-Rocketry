/**
 * Active flyer context resolution & lazy auto-seeding helper.
 *
 * Resolves the authenticated active user for operations, or lazily
 * auto-seeds default Australian flyers and launch sites if the database
 * is uninitialized. Ensures foreign key constraints and multi-user
 * data isolation are satisfied across all rocketry workflows.
 */

import { eq } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import * as schema from './schema'
import { hashPassword } from '../services/auth'

export interface ActiveFlyer {
  id: string
  email: string
  displayName: string
  maxCertLevel: number // 0, 1, 2, or 3
  certNumber?: string | null
  certifyingBody?: string | null
}

/**
 * Retrieve the active flyer by userId, or resolve the default flyer,
 * auto-seeding default Australian flyer and sites if the database is uninitialized.
 */
export async function getActiveFlyer(
  db: DrizzleD1Database<any>,
  userId?: string,
): Promise<ActiveFlyer> {
  // If specific userId requested, try finding that user
  if (userId) {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)

    if (user) {
      return buildFlyerContext(db, user)
    }
  }

  // Otherwise check if any users exist
  const existingUsers = await db.select().from(schema.users).limit(1)
  const firstUser = existingUsers[0]

  if (!firstUser) {
    // Lazily seed primary Australian flyer
    const defaultPasswordHash = await hashPassword('rocketry123!')

    // 1. TripleT Pilot (TRA Level 2 - Victoria, Australia)
    const [pilot1] = await db
      .insert(schema.users)
      .values({
        email: 'flyer@rocketry.local',
        displayName: 'TripleT Pilot',
        passwordHash: defaultPasswordHash,
        isActive: true,
      })
      .returning()

    await db.insert(schema.certifications).values({
      userId: pilot1.id,
      certifyingBody: 'TRA',
      level: 2,
      certNumber: 'TRA-AU-14820',
      expiresOn: '2028-12-31',
    })

    // Auto-seed Australian launch facilities if table is empty
    await ensureAustralianLaunchSites(db)

    return {
      id: pilot1.id,
      email: pilot1.email,
      displayName: pilot1.displayName,
      maxCertLevel: 2,
      certNumber: 'TRA-AU-14820',
      certifyingBody: 'TRA',
    }
  }

  return buildFlyerContext(db, firstUser)
}

/**
 * Ensure Australian demo pilots are available for multi-user switching.
 */
export async function ensureDemoPilots(db: DrizzleD1Database<any>): Promise<void> {
  // First ensure primary flyer exists
  await getActiveFlyer(db)

  const defaultPasswordHash = await hashPassword('rocketry123!')

  // Sarah Connor (TRA/ARA Level 1 - NSW)
  const [sarah] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, 'sarah@rocketry.org.au'))
  if (!sarah) {
    const [pilot2] = await db
      .insert(schema.users)
      .values({
        email: 'sarah@rocketry.org.au',
        displayName: 'Sarah Connor',
        passwordHash: defaultPasswordHash,
        isActive: true,
      })
      .returning()

    await db.insert(schema.certifications).values({
      userId: pilot2.id,
      certifyingBody: 'TRA',
      level: 1,
      certNumber: 'ARA-NSW-512',
      expiresOn: '2027-06-30',
    })
  }

  // Bruce Harrison (TRA Level 3 RSO - Woomera SA)
  const [bruce] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, 'woomera.rso@rocketry.org.au'))
  if (!bruce) {
    const [pilot3] = await db
      .insert(schema.users)
      .values({
        email: 'woomera.rso@rocketry.org.au',
        displayName: 'Bruce Harrison (RSO)',
        passwordHash: defaultPasswordHash,
        isActive: true,
      })
      .returning()

    await db.insert(schema.certifications).values({
      userId: pilot3.id,
      certifyingBody: 'TRA',
      level: 3,
      certNumber: 'TRA-AU-9081',
      expiresOn: '2029-12-31',
    })
  }
}

/**
 * List all registered flyers with their highest certification details.
 */
export async function getAllFlyers(db: DrizzleD1Database<any>): Promise<ActiveFlyer[]> {
  const users = await db.select().from(schema.users).where(eq(schema.users.isActive, true))
  const flyers: ActiveFlyer[] = []
  for (const u of users) {
    flyers.push(await buildFlyerContext(db, u))
  }
  return flyers
}

/**
 * Helper to build ActiveFlyer with certification level.
 */
async function buildFlyerContext(
  db: DrizzleD1Database<any>,
  user: typeof schema.users.$inferSelect,
): Promise<ActiveFlyer> {
  const userCerts = await db
    .select()
    .from(schema.certifications)
    .where(eq(schema.certifications.userId, user.id))

  let maxCertLevel = 0
  let primaryCertNumber: string | null = null
  let primaryCertBody: string | null = null

  for (const cert of userCerts) {
    if (typeof cert.level === 'number' && cert.level > maxCertLevel) {
      maxCertLevel = cert.level
      primaryCertNumber = cert.certNumber
      primaryCertBody = cert.certifyingBody
    }
  }

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    maxCertLevel,
    certNumber: primaryCertNumber,
    certifyingBody: primaryCertBody,
  }
}

/**
 * Auto-seed realistic Australian launch sites if none exist in D1.
 */
export async function ensureAustralianLaunchSites(db: DrizzleD1Database<any>): Promise<void> {
  const existingSites = await db.select().from(schema.launchSites).limit(1)
  if (existingSites.length > 0) return

  await db.insert(schema.launchSites).values([
    {
      name: 'Lake Hart / Woomera Launch Range, SA',
      latitude: -31.154,
      longitude: 136.528,
      maxAltitudeAglM: 30000,
      notes: 'Historic Woomera Prohibited Area range. Hosts national high-power rocketry gatherings with high-altitude CASA airspace instrument.',
    },
    {
      name: 'Whalan Reserve, NSW',
      latitude: -33.766,
      longitude: 150.803,
      maxAltitudeAglM: 450,
      notes: 'NSW Rocketry Association (NSWRA) sport launch field in Western Sydney. Low and mid-power sport launches.',
    },
    {
      name: 'Serpentine Launch Field, WA',
      latitude: -32.3615,
      longitude: 115.978,
      maxAltitudeAglM: 3048,
      notes: 'Tripoli Western Australia (TRA WA) monthly club launch field south of Perth.',
    },
    {
      name: 'Lake Tyrrell, VIC',
      latitude: -35.312,
      longitude: 142.796,
      maxAltitudeAglM: 12000,
      notes: 'Tripoli Victoria high-power dry salt lake launch facility near Sea Lake. CASA ceiling 40,000 ft AGL.',
    },
  ])
}
