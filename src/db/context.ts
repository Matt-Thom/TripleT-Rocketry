/**
 * Active flyer context resolution & lazy auto-seeding helper.
 *
 * Resolves the authenticated active user for operations, or lazily
 * auto-seeds default Australian flyers and launch sites if the database
 * is uninitialized. Ensures foreign key constraints and multi-user
 * data isolation are satisfied across all rocketry workflows.
 */

import { eq, inArray } from 'drizzle-orm'
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
 * Remove legacy Australian demo pilots if present in D1.
 * Demo pilots are no longer auto-seeded.
 */
export async function cleanupDemoPilots(db: DrizzleD1Database<any>): Promise<void> {
  const demoEmails = ['sarah@rocketry.org.au', 'woomera.rso@rocketry.org.au']
  const demoUsers = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(schema.users.email, demoEmails))

  if (demoUsers.length > 0) {
    const ids = demoUsers.map((u) => u.id)
    await db.delete(schema.certifications).where(inArray(schema.certifications.userId, ids))
    await db.delete(schema.users).where(inArray(schema.users.id, ids))
  }
}

/**
 * Backward compatibility alias: no longer seeds demo pilots, cleans them up instead.
 */
export async function ensureDemoPilots(db: DrizzleD1Database<any>): Promise<void> {
  await cleanupDemoPilots(db)
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
  const existingSites = await db.select().from(schema.launchSites)

  if (existingSites.length === 0) {
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
        name: 'SARC Blanchetown, SA',
        latitude: -34.2565,
        longitude: 139.5995,
        maxAltitudeAglM: 2100,
        notes: 'Southern Australian Rocketry Club (SARC) launch site near Blanchetown, South Australia. CASA flight ceiling 2,100 m AGL.',
      },
      {
        name: 'VRA Serpentine, VIC',
        latitude: -36.484,
        longitude: 144.0038,
        maxAltitudeAglM: 3048,
        notes: 'Victorian Rocketry Association (VRA) launch site located at Serpentine, Victoria. CASA flight ceiling 3,048 m AGL (10,000 ft).',
      },
      {
        name: 'Lake Tyrrell, VIC',
        latitude: -35.312,
        longitude: 142.796,
        maxAltitudeAglM: 12000,
        notes: 'Tripoli Victoria high-power dry salt lake launch facility near Sea Lake. CASA ceiling 40,000 ft AGL.',
      },
    ])
    return
  }

  // Ensure SARC Blanchetown is present if database was previously initialized
  const hasBlanchetown = existingSites.some(
    (s) => s.name.toLowerCase().includes('blanchetown') || s.name.toLowerCase().includes('sarc')
  )
  if (!hasBlanchetown) {
    await db.insert(schema.launchSites).values({
      name: 'SARC Blanchetown, SA',
      latitude: -34.2565,
      longitude: 139.5995,
      maxAltitudeAglM: 2100,
      notes: 'Southern Australian Rocketry Club (SARC) launch site near Blanchetown, South Australia. CASA flight ceiling 2,100 m AGL.',
    })
  }

  // Ensure VRA Serpentine site is in Victoria with correct coordinates
  for (const site of existingSites) {
    if (
      site.name.includes('Serpentine') &&
      (site.name.includes('WA') || site.latitude === -32.3615 || !site.name.includes('VRA'))
    ) {
      await db
        .update(schema.launchSites)
        .set({
          name: 'VRA Serpentine, VIC',
          latitude: -36.484,
          longitude: 144.0038,
          notes: 'Victorian Rocketry Association (VRA) launch site located at Serpentine, Victoria. CASA flight ceiling 3,048 m AGL (10,000 ft).',
          updatedAt: Date.now(),
        })
        .where(eq(schema.launchSites.id, site.id))
    }
  }
}
