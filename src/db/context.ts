/**
 * Active flyer context resolution & lazy auto-seeding helper.
 *
 * Resolves the primary active user for single-user/local operations, or lazily
 * auto-seeds a default flyer ("TripleT Pilot", Level 2 TRA certification) if
 * the users table is empty. This ensures foreign key constraints are satisfied
 * across all workflows (rockets, flights, inventory).
 */

import { eq } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import * as schema from './schema'

export interface ActiveFlyer {
  id: string
  email: string
  displayName: string
  maxCertLevel: number // 0, 1, 2, or 3
}

/**
 * Retrieve the active flyer, or lazily auto-seed a default flyer if none exists.
 */
export async function getActiveFlyer(db: DrizzleD1Database<any>): Promise<ActiveFlyer> {
  const existingUsers = await db.select().from(schema.users).limit(1)
  const user = existingUsers[0]

  if (!user) {
    // Lazily seed default flyer
    const [newUser] = await db
      .insert(schema.users)
      .values({
        email: 'flyer@rocketry.local',
        displayName: 'TripleT Pilot',
        passwordHash: 'seeded_flyer_default',
        isActive: true,
      })
      .returning()

    // Seed default Level 2 TRA certification
    await db.insert(schema.certifications).values({
      userId: newUser.id,
      certifyingBody: 'TRA',
      level: 2,
      certNumber: 'TRA-L2-DEMO',
      expiresOn: '2028-12-31',
    })

    return {
      id: newUser.id,
      email: newUser.email,
      displayName: newUser.displayName,
      maxCertLevel: 2,
    }
  }

  // Calculate highest certification level
  const userCerts = await db
    .select()
    .from(schema.certifications)
    .where(eq(schema.certifications.userId, user.id))

  let maxCertLevel = 0
  for (const cert of userCerts) {
    if (typeof cert.level === 'number' && cert.level > maxCertLevel) {
      maxCertLevel = cert.level
    }
  }

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    maxCertLevel,
  }
}
