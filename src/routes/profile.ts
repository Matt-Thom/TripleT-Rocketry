/**
 * User Profile, Certifications, Multi-Club Memberships & Passkeys Router (`src/routes/profile.ts`).
 *
 * Implements Milestone 5 (Requirement R5):
 * - `GET /profile`: Dedicated user profile screen with certifications, multi-club affiliations, and passkeys.
 * - `POST /profile`: Updates pilot profile personal info (display name, email, regulatory region).
 * - `POST /profile/certifications`: Adds or updates rocketry certifications (TRA/ARA/NAR levels 0-3).
 * - `POST /profile/clubs`: Adds club membership affiliations.
 * - `POST /profile/clubs/:id/delete` & `DELETE /profile/clubs/:id`: Soft-deletes club affiliation.
 * - `POST /profile/passkeys/:id/delete` & `DELETE /profile/passkeys/:id`: Removes WebAuthn passkey.
 * - `POST /profile/passkeys/:id/rename`: Updates friendly name of WebAuthn passkey.
 */

import { Hono } from 'hono'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { getActiveFlyer, type ActiveFlyer } from '../db/context'
import type { TraceContext } from '../logging'
import { pageLayout } from '../views/layout'
import { profileHubView } from '../views/profile'

type Bindings = {
  DB: D1Database
  ENVIRONMENT: string
  PROJECT_ID: string
  AUTH_SECRET?: string
}

type Variables = {
  trace: TraceContext
  user?: ActiveFlyer & { role?: string; regulatoryRegion?: string }
}

export const profileRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>()

/**
 * Access control middleware: Enforce authentication for all profile routes.
 */
profileRouter.use('*', async (c, next) => {
  const activeFlyer = (c.get as any)('user')
  if (!activeFlyer) {
    const acceptsHtml = c.req.header('accept')?.includes('text/html') ?? true
    if (acceptsHtml) {
      return c.redirect('/login?redirect=/profile', 302)
    }
    return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401)
  }
  await next()
})

/**
 * Render dedicated user profile page (GET /profile and GET /).
 */
export async function getProfileHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const activeFlyer = (c.get as any)('user') || (await getActiveFlyer(db))

  if (!activeFlyer) {
    return c.redirect('/login?redirect=/profile', 302)
  }

  // 1. Fetch fresh user details from database
  const [dbUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, activeFlyer.id))
    .limit(1)

  const user = {
    ...activeFlyer,
    displayName: dbUser?.displayName || activeFlyer.displayName,
    email: dbUser?.email || activeFlyer.email,
    role: dbUser?.role || 'flyer',
    regulatoryRegion: dbUser?.regulatoryRegion || 'SA',
    createdAt: dbUser?.createdAt,
  }

  // 2. Fetch registered WebAuthn passkeys
  const passkeys = await db
    .select()
    .from(schema.userCredentials)
    .where(eq(schema.userCredentials.userId, user.id))
    .orderBy(desc(schema.userCredentials.createdAt))

  // 3. Fetch active rocketry certifications
  const certifications = await db
    .select()
    .from(schema.certifications)
    .where(
      and(
        eq(schema.certifications.userId, user.id),
        isNull(schema.certifications.deletedAt),
      ),
    )
    .orderBy(desc(schema.certifications.level), desc(schema.certifications.createdAt))

  // 4. Fetch active multi-club affiliations
  const clubMemberships = await db
    .select()
    .from(schema.clubMemberships)
    .where(
      and(
        eq(schema.clubMemberships.userId, user.id),
        isNull(schema.clubMemberships.deletedAt),
      ),
    )
    .orderBy(desc(schema.clubMemberships.createdAt))

  // 5. Flash message resolution
  const savedParam = c.req.query('saved')
  let message: string | null = null
  if (savedParam === 'profile') message = 'Pilot profile updated successfully.'
  else if (savedParam === 'passkey_enrolled') message = 'New WebAuthn passkey registered successfully.'
  else if (savedParam === 'passkey_deleted') message = 'Passkey removed from your account.'
  else if (savedParam === 'passkey_renamed') message = 'Passkey label updated.'
  else if (savedParam === 'certification') message = 'Rocketry certification saved successfully.'
  else if (savedParam === 'club') message = 'Club affiliation added successfully.'
  else if (savedParam === 'club_deleted') message = 'Club affiliation removed.'

  const errorMessage = c.req.query('error') || null

  const content = profileHubView({
    user,
    passkeys,
    certifications,
    clubMemberships,
    message,
    errorMessage,
  })

  const fullHtml = pageLayout({
    title: 'Pilot Profile & Settings',
    activeTab: 'profile',
    content,
    user,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
}

/**
 * Update pilot profile personal details (POST /profile and POST /).
 */
export async function postProfileHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const activeFlyer = (c.get as any)('user') || (await getActiveFlyer(db))

  if (!activeFlyer) {
    return c.redirect('/login?redirect=/profile', 302)
  }

  const contentType = c.req.header('content-type') || ''
  const isJson = contentType.includes('application/json')
  let body: any = {}
  if (isJson) {
    body = await c.req.json().catch(() => ({}))
  } else {
    body = await c.req.parseBody().catch(() => ({}))
  }

  const rawDisplayName = body.displayName !== undefined ? body.displayName : body.display_name
  const rawEmail = body.email
  const rawRegion = body.regulatoryRegion !== undefined ? body.regulatoryRegion : body.regulatory_region

  const updates: Partial<typeof schema.users.$inferInsert> = {
    updatedAt: Date.now(),
  }

  if (typeof rawDisplayName === 'string' && rawDisplayName.trim()) {
    updates.displayName = rawDisplayName.trim()
  }

  if (typeof rawEmail === 'string' && rawEmail.trim()) {
    updates.email = rawEmail.trim().toLowerCase()
  }

  if (typeof rawRegion === 'string' && rawRegion.trim()) {
    const reg = rawRegion.trim().toUpperCase()
    if (reg === 'SA' || reg === 'US') {
      updates.regulatoryRegion = reg
    }
  }

  await db
    .update(schema.users)
    .set(updates)
    .where(eq(schema.users.id, activeFlyer.id))

  if (isJson) {
    return c.json({ status: 'ok', message: 'Profile updated' }, 200)
  }

  return c.redirect('/profile?saved=profile', 303)
}

/**
 * Add or update rocketry certification (POST /profile/certifications and POST /certifications).
 */
export async function postCertificationsHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const activeFlyer = (c.get as any)('user') || (await getActiveFlyer(db))

  if (!activeFlyer) {
    return c.redirect('/login', 302)
  }

  const contentType = c.req.header('content-type') || ''
  const isJson = contentType.includes('application/json')
  let body: any = {}
  if (isJson) {
    body = await c.req.json().catch(() => ({}))
  } else {
    body = await c.req.parseBody().catch(() => ({}))
  }

  const rawBody = String(body.certifying_body || body.certifyingBody || 'TRA').trim().toUpperCase()
  const certifyingBody = (['NAR', 'TRA', 'ARA'].includes(rawBody) ? rawBody : 'TRA') as 'NAR' | 'TRA' | 'ARA'

  const rawLevel = body.level !== undefined && body.level !== '' ? parseInt(String(body.level), 10) : 0
  const level = isNaN(rawLevel) ? 0 : Math.max(0, Math.min(3, rawLevel))

  const certNumber = (body.cert_number !== undefined ? body.cert_number : body.certNumber)
    ? String(body.cert_number !== undefined ? body.cert_number : body.certNumber).trim()
    : null

  const expiresOn = (body.expires_on !== undefined ? body.expires_on : body.expiresOn)
    ? String(body.expires_on !== undefined ? body.expires_on : body.expiresOn).trim()
    : null

  const now = Date.now()

  // Check if an existing active certification exists for this certifying body
  const [existing] = await db
    .select()
    .from(schema.certifications)
    .where(
      and(
        eq(schema.certifications.userId, activeFlyer.id),
        eq(schema.certifications.certifyingBody, certifyingBody),
        isNull(schema.certifications.deletedAt),
      ),
    )
    .limit(1)

  if (existing) {
    await db
      .update(schema.certifications)
      .set({
        level,
        certNumber,
        expiresOn,
        updatedAt: now,
      })
      .where(eq(schema.certifications.id, existing.id))
  } else {
    await db.insert(schema.certifications).values({
      userId: activeFlyer.id,
      certifyingBody,
      level,
      certNumber,
      expiresOn,
      createdAt: now,
      updatedAt: now,
    })
  }

  if (isJson) {
    return c.json({ status: 'ok', certifyingBody, level, certNumber, expiresOn }, 201)
  }

  return c.redirect('/profile?saved=certification', 303)
}

/**
 * Add club affiliation (POST /profile/clubs and POST /clubs).
 */
export async function postClubsHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const activeFlyer = (c.get as any)('user') || (await getActiveFlyer(db))

  if (!activeFlyer) {
    return c.redirect('/login', 302)
  }

  const contentType = c.req.header('content-type') || ''
  const isJson = contentType.includes('application/json')
  let body: any = {}
  if (isJson) {
    body = await c.req.json().catch(() => ({}))
  } else {
    body = await c.req.parseBody().catch(() => ({}))
  }

  const clubName = String(body.club_name !== undefined ? body.club_name : body.clubName || '').trim()
  if (!clubName) {
    if (isJson) return c.json({ error: 'Club name is required' }, 400)
    return c.redirect('/profile?error=Club+name+is+required', 303)
  }

  const membershipNumber = (body.membership_number !== undefined ? body.membership_number : body.membershipNumber)
    ? String(body.membership_number !== undefined ? body.membership_number : body.membershipNumber).trim()
    : null

  const expiresOn = (body.expires_on !== undefined ? body.expires_on : body.expiresOn)
    ? String(body.expires_on !== undefined ? body.expires_on : body.expiresOn).trim()
    : null

  const now = Date.now()

  const [club] = await db
    .insert(schema.clubMemberships)
    .values({
      userId: activeFlyer.id,
      clubName,
      membershipNumber,
      expiresOn,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  if (isJson) {
    return c.json({ status: 'ok', club }, 201)
  }

  return c.redirect('/profile?saved=club', 303)
}

/**
 * Delete club affiliation (POST /profile/clubs/:id/delete, POST /clubs/:id/delete, DELETE /profile/clubs/:id, DELETE /clubs/:id).
 */
export async function deleteClubHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const activeFlyer = (c.get as any)('user') || (await getActiveFlyer(db))

  if (!activeFlyer) {
    return c.redirect('/login', 302)
  }

  const clubId = c.req.param('id')
  const [deleted] = await db
    .update(schema.clubMemberships)
    .set({
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(schema.clubMemberships.id, clubId),
        eq(schema.clubMemberships.userId, activeFlyer.id),
      ),
    )
    .returning()

  const contentType = c.req.header('content-type') || ''
  const isJson = contentType.includes('application/json')
  if (!deleted) {
    if (isJson) return c.json({ error: 'Club affiliation not found' }, 404)
    return c.redirect('/profile?saved=club_deleted', 303)
  }

  if (isJson) {
    return c.json({ status: 'ok', deleted: clubId }, 200)
  }

  return c.redirect('/profile?saved=club_deleted', 303)
}

/**
 * Delete enrolled passkey (POST /profile/passkeys/:id/delete, POST /passkeys/:id/delete, DELETE /profile/passkeys/:id, DELETE /passkeys/:id).
 */
export async function deletePasskeyHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const activeFlyer = (c.get as any)('user') || (await getActiveFlyer(db))

  if (!activeFlyer) {
    return c.redirect('/login', 302)
  }

  const credId = c.req.param('id')
  await db
    .delete(schema.userCredentials)
    .where(
      and(
        eq(schema.userCredentials.id, credId),
        eq(schema.userCredentials.userId, activeFlyer.id),
      ),
    )

  const contentType = c.req.header('content-type') || ''
  const isJson = contentType.includes('application/json')
  if (isJson) {
    return c.json({ status: 'ok', deleted: credId }, 200)
  }

  return c.redirect('/profile?saved=passkey_deleted', 303)
}

/**
 * Rename enrolled passkey label (POST /profile/passkeys/:id/rename and POST /passkeys/:id/rename).
 */
export async function renamePasskeyHandler(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const activeFlyer = (c.get as any)('user') || (await getActiveFlyer(db))

  if (!activeFlyer) {
    return c.redirect('/login', 302)
  }

  const credId = c.req.param('id')
  let body: any = {}
  const contentType = c.req.header('content-type') || ''
  if (contentType.includes('application/json')) {
    body = await c.req.json().catch(() => ({}))
  } else {
    body = await c.req.parseBody().catch(() => ({}))
  }

  const newName = (
    typeof body.friendly_name === 'string'
      ? body.friendly_name
      : typeof body.friendlyName === 'string'
      ? body.friendlyName
      : ''
  ).trim()

  if (newName) {
    await db
      .update(schema.userCredentials)
      .set({ friendlyName: newName })
      .where(
        and(
          eq(schema.userCredentials.id, credId),
          eq(schema.userCredentials.userId, activeFlyer.id),
        ),
      )
  }

  if (contentType.includes('application/json')) {
    return c.json({ status: 'ok', renamed: credId, friendlyName: newName }, 200)
  }

  return c.redirect('/profile?saved=passkey_renamed', 303)
}

// Route mappings: support with and without /profile prefix
profileRouter.get('/', getProfileHandler)
profileRouter.get('/profile', getProfileHandler)
profileRouter.post('/', postProfileHandler)
profileRouter.post('/profile', postProfileHandler)
profileRouter.post('/certifications', postCertificationsHandler)
profileRouter.post('/profile/certifications', postCertificationsHandler)
profileRouter.post('/clubs', postClubsHandler)
profileRouter.post('/profile/clubs', postClubsHandler)
profileRouter.post('/clubs/:id/delete', deleteClubHandler)
profileRouter.post('/profile/clubs/:id/delete', deleteClubHandler)
profileRouter.delete('/clubs/:id', deleteClubHandler)
profileRouter.delete('/profile/clubs/:id', deleteClubHandler)
profileRouter.post('/passkeys/:id/delete', deletePasskeyHandler)
profileRouter.post('/profile/passkeys/:id/delete', deletePasskeyHandler)
profileRouter.delete('/passkeys/:id', deletePasskeyHandler)
profileRouter.delete('/profile/passkeys/:id', deletePasskeyHandler)
profileRouter.post('/passkeys/:id/rename', renamePasskeyHandler)
profileRouter.post('/profile/passkeys/:id/rename', renamePasskeyHandler)

export default profileRouter
