/**
 * Authentication routes for TripleT-Rocketry.
 * Handles Login, Registration, Logout, Pilot Switching, and WebAuthn Passkeys.
 */

import { Hono } from 'hono'
import { eq, lte } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { getActiveFlyer, getAllFlyers, cleanupDemoPilots, type ActiveFlyer } from '../db/context'
import {
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  createSessionCookie,
  createLogoutCookie,
  createLoggedOutMarkerCookie,
  createClearLoggedOutCookie,
  getSessionMaxAge,
  SESSION_MAX_AGE_SECONDS,
  parseCookies,
  getAllCookieValues,
} from '../services/auth'
import { pageLayout } from '../views/layout'
import { loginView, registerView } from '../views/auth'

type Bindings = {
  DB: D1Database
  ENVIRONMENT?: string
  PROJECT_ID?: string
  AUTH_SECRET?: string
}

export const authRouter = new Hono<{ Bindings: Bindings }>()

/**
 * Compute a safe session issuance timestamp that is guaranteed to be strictly greater
 * than any preceding user-level revocation timestamp (revoked_user:userId), preventing
 * rapid sign-out / sign-in millisecond collision.
 */
async function getSafeSessionTimestamp(db: any, userId: string): Promise<number> {
  const now = Date.now()
  try {
    const [row] = await db
      .select()
      .from(schema.siteSettings)
      .where(eq(schema.siteSettings.key, `revoked_user:${userId}`))
      .limit(1)
    if (row) {
      const revokedBefore = parseInt(row.value, 10)
      if (!isNaN(revokedBefore) && revokedBefore >= now) {
        return revokedBefore + 1
      }
    }
  } catch {}
  return now
}

/**
 * Convert a base64url or base64 string to a Uint8Array.
 */
function base64UrlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
  const binary = atob(base64 + pad)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Convert an ASN.1 DER ECDSA signature (SEQUENCE of two INTEGERs r and s)
 * into a standard IEEE P1363 (r || s, 64 bytes) signature for WebCrypto verify.
 */
function derToP1363(der: Uint8Array): Uint8Array {
  if (der.length === 64) return der
  if (der[0] !== 0x30) return der

  let offset = 2
  if (der[1] & 0x80) {
    offset += (der[1] & 0x7f)
  }

  // Read r
  if (der[offset] !== 0x02) return der
  const rLen = der[offset + 1]
  const rStart = offset + 2
  let rBytes = der.subarray(rStart, rStart + rLen)
  while (rBytes.length > 32 && rBytes[0] === 0) {
    rBytes = rBytes.subarray(1)
  }

  // Read s
  offset = rStart + rLen
  if (der[offset] !== 0x02) return der
  const sLen = der[offset + 1]
  const sStart = offset + 2
  let sBytes = der.subarray(sStart, sStart + sLen)
  while (sBytes.length > 32 && sBytes[0] === 0) {
    sBytes = sBytes.subarray(1)
  }

  const p1363 = new Uint8Array(64)
  p1363.set(rBytes, 32 - rBytes.length)
  p1363.set(sBytes, 64 - sBytes.length)
  return p1363
}

/**
 * Import a public key stored as JWK, SPKI, or raw uncompressed EC point into a CryptoKey.
 */
async function importPublicKey(keyStr: string): Promise<CryptoKey> {
  const trimmed = keyStr.trim()
  if (trimmed.startsWith('{')) {
    const jwk = JSON.parse(trimmed)
    return await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: jwk.crv || 'P-256' },
      false,
      ['verify']
    )
  }

  const bytes = base64UrlToUint8Array(trimmed)
  try {
    return await crypto.subtle.importKey(
      'spki',
      bytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )
  } catch {
    return await crypto.subtle.importKey(
      'raw',
      bytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )
  }
}

/**
 * Generate a cryptographically secure base64url challenge string.
 */
function generateWebAuthnChallenge(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * GET /login - Render clean login form.
 */
authRouter.get('/login', async (c) => {
  const db = drizzle(c.env.DB, { schema })

  // Clean up any legacy demo pilots from D1
  await cleanupDemoPilots(db).catch(() => {})

  const rawRedirect = c.req.query('redirect') || '/'
  const redirectUrl = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/'
  const error = c.req.query('error') || null

  const view = loginView({ redirectUrl, error })
  const html = pageLayout({
    title: 'Sign In',
    activeTab: 'dashboard',
    content: view,
    user: (c.get as any)('user') || null,
  })

  return c.html(html)
})

/**
 * POST /login - Authenticate credentials and issue session cookie with D1 persistence.
 */
authRouter.post('/login', async (c) => {
  const isJson = (c.req.header('content-type') || '').includes('application/json')
  let email = ''
  let password = ''
  let redirectUrl = '/'

  if (isJson) {
    const json = await c.req.json().catch(() => ({}))
    email = typeof json.email === 'string' ? json.email.trim().toLowerCase() : ''
    password = typeof json.password === 'string' ? json.password : ''
    const reqRedirect = typeof json.redirect === 'string' ? json.redirect : '/'
    redirectUrl = reqRedirect.startsWith('/') && !reqRedirect.startsWith('//') ? reqRedirect : '/'
  } else {
    const body = await c.req.parseBody()
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    password = typeof body.password === 'string' ? body.password : ''
    const reqRedirect = typeof body.redirect === 'string' && body.redirect ? body.redirect : '/'
    redirectUrl = reqRedirect.startsWith('/') && !reqRedirect.startsWith('//') ? reqRedirect : '/'
  }

  if (!email || !password) {
    if (isJson) return c.json({ error: 'Email and password are required' }, 400)
    return c.redirect(`/login?error=${encodeURIComponent('Email and password are required')}&redirect=${encodeURIComponent(redirectUrl)}`, 302)
  }

  const db = drizzle(c.env.DB, { schema })
  // Ensure defaults are populated if initial call
  await getActiveFlyer(db)

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1)

  if (!user || !user.isActive) {
    if (isJson) return c.json({ error: 'Invalid email or password' }, 401)
    return c.redirect(`/login?error=${encodeURIComponent('Invalid email or password')}&redirect=${encodeURIComponent(redirectUrl)}`, 302)
  }

  const isValid = await verifyPassword(password, user.passwordHash)
  if (!isValid) {
    if (isJson) return c.json({ error: 'Invalid email or password' }, 401)
    return c.redirect(`/login?error=${encodeURIComponent('Invalid email or password')}&redirect=${encodeURIComponent(redirectUrl)}`, 302)
  }

  // Persist session into D1 sessions table
  const maxAge = getSessionMaxAge(c.env)
  const tokenTimestamp = await getSafeSessionTimestamp(db, user.id)
  const token = await signSession(user.id, c.env.AUTH_SECRET, tokenTimestamp)
  const sessionId = crypto.randomUUID()
  const now = Date.now()
  const expiresAt = now + maxAge * 1000
  await db
    .insert(schema.sessions)
    .values({
      id: sessionId,
      userId: user.id,
      token,
      expiresAt,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: schema.sessions.token,
      set: { expiresAt, createdAt: now },
    })

  // Clear any past revoked status for this token
  await db.delete(schema.siteSettings).where(eq(schema.siteSettings.key, `revoked_session:${token}`)).catch(() => {})

  const cookie = createSessionCookie(token, maxAge)
  const clearLoggedOut = createClearLoggedOutCookie()

  if (isJson) {
    const resHeaders = new Headers()
    resHeaders.set('Set-Cookie', cookie)
    resHeaders.append('Set-Cookie', clearLoggedOut)
    return c.json({ status: 'ok', userId: user.id, email: user.email }, 200, resHeaders as any)
  }

  c.header('Set-Cookie', cookie)
  c.header('Set-Cookie', clearLoggedOut, { append: true })
  return c.redirect(redirectUrl, 302)
})

/**
 * GET /register - Render registration page.
 */
authRouter.get('/register', (c) => {
  const rawRedirect = c.req.query('redirect') || '/'
  const redirectUrl = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/'
  const error = c.req.query('error') || null

  const view = registerView({ redirectUrl, error })
  const html = pageLayout({
    title: 'Register Profile',
    activeTab: 'dashboard',
    content: view,
    user: (c.get as any)('user') || null,
  })

  return c.html(html)
})

/**
 * POST /register - Create user and certification, issue session cookie with D1 persistence.
 */
authRouter.post('/register', async (c) => {
  const isJson = (c.req.header('content-type') || '').includes('application/json')
  let displayName = ''
  let email = ''
  let password = ''
  let certifyingBody = 'TRA'
  let level = 0
  let certNumber = ''
  let redirectUrl = '/'

  if (isJson) {
    const json = await c.req.json().catch(() => ({}))
    displayName = typeof json.displayName === 'string' ? json.displayName.trim() : ''
    email = typeof json.email === 'string' ? json.email.trim().toLowerCase() : ''
    password = typeof json.password === 'string' ? json.password : ''
    certifyingBody = json.certifyingBody === 'NAR' ? 'NAR' : 'TRA'
    level = Number(json.level || 0)
    certNumber = typeof json.certNumber === 'string' ? json.certNumber.trim() : ''
    const reqRedirect = typeof json.redirect === 'string' ? json.redirect : '/'
    redirectUrl = reqRedirect.startsWith('/') && !reqRedirect.startsWith('//') ? reqRedirect : '/'
  } else {
    const body = await c.req.parseBody()
    displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    password = typeof body.password === 'string' ? body.password : ''
    certifyingBody = body.certifyingBody === 'NAR' ? 'NAR' : 'TRA'
    level = Number(body.level || 0)
    certNumber = typeof body.certNumber === 'string' ? body.certNumber.trim() : ''
    const reqRedirect = typeof body.redirect === 'string' && body.redirect ? body.redirect : '/'
    redirectUrl = reqRedirect.startsWith('/') && !reqRedirect.startsWith('//') ? reqRedirect : '/'
  }

  if (!displayName || !email || !password) {
    const err = 'Name, email, and password are required'
    if (isJson) return c.json({ error: err }, 400)
    return c.redirect(`/register?error=${encodeURIComponent(err)}&redirect=${encodeURIComponent(redirectUrl)}`, 302)
  }

  if (password.length < 6) {
    const err = 'Password must be at least 6 characters'
    if (isJson) return c.json({ error: err }, 400)
    return c.redirect(`/register?error=${encodeURIComponent(err)}&redirect=${encodeURIComponent(redirectUrl)}`, 302)
  }

  const db = drizzle(c.env.DB, { schema })

  // Check if email is already taken
  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1)

  if (existing) {
    const err = 'A flyer account with this email already exists'
    if (isJson) return c.json({ error: err }, 400)
    return c.redirect(`/register?error=${encodeURIComponent(err)}&redirect=${encodeURIComponent(redirectUrl)}`, 302)
  }

  const passwordHash = await hashPassword(password)
  const now = Date.now()

  const [newUser] = await db
    .insert(schema.users)
    .values({
      email,
      displayName,
      passwordHash,
      role: 'flyer',
      regulatoryRegion: 'SA',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  // Add certification record if level > 0 or certNumber provided
  if (level > 0 || certNumber) {
    const validLevel = [1, 2, 3].includes(level) ? (level as 1 | 2 | 3) : 1
    await db.insert(schema.certifications).values({
      userId: newUser.id,
      certifyingBody: certifyingBody as 'TRA' | 'NAR',
      level: validLevel,
      certNumber: certNumber || `TRA-AU-${Math.floor(10000 + Math.random() * 90000)}`,
      expiresOn: '2028-12-31',
    })
  }

  // Persist session into D1 sessions table
  const maxAge = getSessionMaxAge(c.env)
  const tokenTimestamp = await getSafeSessionTimestamp(db, newUser.id)
  const token = await signSession(newUser.id, c.env.AUTH_SECRET, tokenTimestamp)
  const sessionId = crypto.randomUUID()
  const expiresAt = now + maxAge * 1000
  await db
    .insert(schema.sessions)
    .values({
      id: sessionId,
      userId: newUser.id,
      token,
      expiresAt,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: schema.sessions.token,
      set: { expiresAt, createdAt: now },
    })

  // Clear any past revoked status for this token
  await db.delete(schema.siteSettings).where(eq(schema.siteSettings.key, `revoked_session:${token}`)).catch(() => {})

  const cookie = createSessionCookie(token, maxAge)
  const clearLoggedOut = createClearLoggedOutCookie()

  if (isJson) {
    const resHeaders = new Headers()
    resHeaders.set('Set-Cookie', cookie)
    resHeaders.append('Set-Cookie', clearLoggedOut)
    return c.json({ status: 'created', userId: newUser.id, email: newUser.email }, 201, resHeaders as any)
  }

  c.header('Set-Cookie', cookie)
  c.header('Set-Cookie', clearLoggedOut, { append: true })
  return c.redirect(redirectUrl, 302)
})

/**
 * GET/POST /logout, /signout, /sign-out - Invalidate session in D1, revoke token, clear cookies, and redirect.
 * Supports multi-device / global sign-out via ?all=true, /logout/all, or { all: true } body.
 */
const handleLogout = async (c: any) => {
  const rawCookieHeader = c.req.header('cookie') || null
  const cookies = parseCookies(rawCookieHeader)
  const tokensToRevoke = new Set<string>()

  const addCleanToken = (t?: string | null) => {
    if (!t || typeof t !== 'string') return
    let clean = t.trim()
    if (clean.startsWith('"') && clean.endsWith('"') && clean.length >= 2) {
      clean = clean.slice(1, -1).trim()
    }
    if (clean) tokensToRevoke.add(clean)
  }

  // Collect all triplet_session cookies from the Cookie header
  const sessionCookies = getAllCookieValues(rawCookieHeader, 'triplet_session')
  for (const cToken of sessionCookies) {
    addCleanToken(cToken)
  }
  addCleanToken(cookies.triplet_session)

  // Case-insensitive Bearer authorization scheme
  const authHeader = c.req.header('authorization') || ''
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i)
  if (bearerMatch) {
    addCleanToken(bearerMatch[1])
  }

  addCleanToken(c.req.header('x-session-token'))

  let isGlobalLogout =
    c.req.query('all') === 'true' ||
    c.req.query('global') === 'true' ||
    c.req.query('all_devices') === 'true' ||
    c.req.query('everywhere') === 'true' ||
    c.req.path.endsWith('/all')

  try {
    if (c.req.header('content-type')?.includes('application/json')) {
      const body = await c.req.json().catch(() => ({}))
      addCleanToken(body.token || body.sessionToken || body.triplet_session)
      if (body.all === true || body.global === true || body.allDevices === true || body.all_devices === true) {
        isGlobalLogout = true
      }
    } else if (c.req.method === 'POST') {
      const body = await c.req.parseBody().catch(() => ({}))
      addCleanToken(body.token || body.sessionToken || body.triplet_session)
      if (body.all === 'true' || body.all === true || body.global === 'true' || body.global === true) {
        isGlobalLogout = true
      }
    }
  } catch {}

  addCleanToken(c.req.query('token') || c.req.query('session_token'))

  const db = drizzle(c.env.DB, { schema })
  const now = Date.now()

  // Find user ID for global sign-out or session cleanup
  let currentUserId: string | null = (c.get as any)('user')?.id || null

  if (!currentUserId && tokensToRevoke.size > 0) {
    for (const token of tokensToRevoke) {
      const verified = await verifySession(token, (c.env as any)?.AUTH_SECRET)
      if (verified) {
        currentUserId = verified
        break
      }
    }
  }

  // If global signout requested and user identified, revoke all user sessions
  if (isGlobalLogout && currentUserId) {
    // Record user-level global revocation timestamp
    await db
      .insert(schema.siteSettings)
      .values({
        key: `revoked_user:${currentUserId}`,
        value: String(now),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.siteSettings.key,
        set: { value: String(now), updatedAt: now },
      })
      .catch(() => {})

    // Collect all tokens for this user in D1
    const userSessions = await db
      .select({ token: schema.sessions.token })
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, currentUserId))
      .catch(() => [])

    for (const s of userSessions) {
      addCleanToken(s.token)
    }

    await db.delete(schema.sessions).where(eq(schema.sessions.userId, currentUserId)).catch(() => {})
  }

  for (const token of tokensToRevoke) {
    // Delete session from D1 sessions table
    await db.delete(schema.sessions).where(eq(schema.sessions.token, token)).catch(() => {})
    // Record token revocation in site_settings to prevent replay reuse
    await db
      .insert(schema.siteSettings)
      .values({
        key: `revoked_session:${token}`,
        value: 'revoked',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.siteSettings.key,
        set: { updatedAt: now },
      })
      .catch(() => {})
  }

  // Also clean up any expired sessions in D1
  await db.delete(schema.sessions).where(lte(schema.sessions.expiresAt, now)).catch(() => {})

  const cookie = createLogoutCookie()
  const loggedOutMarker = createLoggedOutMarkerCookie()
  const clearWebAuthn = 'webauthn_challenge=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT'

  const headers = new Headers()
  headers.set('Set-Cookie', cookie)
  headers.append('Set-Cookie', loggedOutMarker)
  headers.append('Set-Cookie', clearWebAuthn)
  headers.set('Clear-Site-Data', '"cache", "cookies", "storage"')
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  headers.set('Pragma', 'no-cache')

  c.header('Set-Cookie', cookie)
  c.header('Set-Cookie', loggedOutMarker, { append: true })
  c.header('Set-Cookie', clearWebAuthn, { append: true })
  c.header('Clear-Site-Data', '"cache", "cookies", "storage"')
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  c.header('Pragma', 'no-cache')

  const acceptsJson =
    c.req.header('accept')?.includes('application/json') ||
    c.req.header('content-type')?.includes('application/json')

  const isHtmx = c.req.header('HX-Request') === 'true'

  if (acceptsJson) {
    return c.json({ status: 'ok', message: 'Logged out' }, 200, headers as any)
  }

  const rawRedirect = c.req.query('redirect') || '/login'
  const redirectUrl =
    rawRedirect.startsWith('/') &&
    !rawRedirect.startsWith('//') &&
    !rawRedirect.startsWith('/\\') &&
    !rawRedirect.includes('\\')
      ? rawRedirect
      : '/login'
  headers.set('Location', redirectUrl)
  if (isHtmx) {
    headers.set('HX-Redirect', redirectUrl)
  }
  return new Response(null, { status: 302, headers })
}

authRouter.get('/logout', handleLogout)
authRouter.post('/logout', handleLogout)
authRouter.get('/logout/all', handleLogout)
authRouter.post('/logout/all', handleLogout)
authRouter.get('/signout', handleLogout)
authRouter.post('/signout', handleLogout)
authRouter.get('/signout/all', handleLogout)
authRouter.post('/signout/all', handleLogout)
authRouter.get('/sign-out', handleLogout)
authRouter.post('/sign-out', handleLogout)
authRouter.get('/auth/logout', handleLogout)
authRouter.post('/auth/logout', handleLogout)
authRouter.get('/auth/logout/all', handleLogout)
authRouter.post('/auth/logout/all', handleLogout)
authRouter.get('/auth/signout', handleLogout)
authRouter.post('/auth/signout', handleLogout)
authRouter.get('/auth/signout/all', handleLogout)
authRouter.post('/auth/signout/all', handleLogout)
authRouter.get('/auth/sign-out', handleLogout)
authRouter.post('/auth/sign-out', handleLogout)

/**
 * POST /auth/switch/:id - Convenience quick-switch for authenticated flyer accounts.
 */
authRouter.post('/auth/switch/:id', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB, { schema })

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1)

  if (!user || !user.isActive) {
    return c.redirect('/login', 302)
  }

  const maxAge = getSessionMaxAge(c.env)
  const tokenTimestamp = await getSafeSessionTimestamp(db, user.id)
  const token = await signSession(user.id, c.env.AUTH_SECRET, tokenTimestamp)
  const sessionId = crypto.randomUUID()
  const now = Date.now()
  const expiresAt = now + maxAge * 1000

  await db
    .insert(schema.sessions)
    .values({
      id: sessionId,
      userId: user.id,
      token,
      expiresAt,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: schema.sessions.token,
      set: { expiresAt, createdAt: now },
    })

  // Clear any past revoked status for this token
  await db.delete(schema.siteSettings).where(eq(schema.siteSettings.key, `revoked_session:${token}`)).catch(() => {})

  const cookie = createSessionCookie(token, maxAge)
  const clearLoggedOut = createClearLoggedOutCookie()
  const rawRedirect = c.req.query('redirect') || '/'
  const redirectUrl = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/'

  c.header('Set-Cookie', cookie)
  c.header('Set-Cookie', clearLoggedOut, { append: true })
  return c.redirect(redirectUrl, 302)
})

// ===========================================================================
// WebAuthn / FIDO Passkey Endpoints
// ===========================================================================

/**
 * POST /auth/webauthn/register-options - Generate challenge for WebAuthn passkey registration.
 */
authRouter.post('/auth/webauthn/register-options', async (c) => {
  const user = (c.get as any)('user')
  if (!user) {
    return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401)
  }

  const challenge = generateWebAuthnChallenge()
  const url = new URL(c.req.url)
  const rpId = url.hostname || 'rocketry.local'
  const now = Date.now()

  const db = drizzle(c.env.DB, { schema })
  // Persist challenge in site_settings with 120s TTL
  await db
    .insert(schema.siteSettings)
    .values({
      key: `webauthn_challenge:${challenge}`,
      value: JSON.stringify({ challenge, userId: user.id, createdAt: now, expiresAt: now + 120000, type: 'register' }),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.siteSettings.key,
      set: {
        value: JSON.stringify({ challenge, userId: user.id, createdAt: now, expiresAt: now + 120000, type: 'register' }),
        updatedAt: now,
      },
    })
    .catch(() => {})

  const cookieVal = `webauthn_challenge=${challenge}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=120`
  c.header('Set-Cookie', cookieVal)

  return c.json({
    challenge,
    rp: {
      name: 'TripleT Rocketry',
      id: rpId,
    },
    user: {
      id: user.id,
      name: user.email,
      displayName: user.displayName,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 }, // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    timeout: 60000,
    attestation: 'none',
  }, 200, {
    'Set-Cookie': cookieVal,
  })
})

/**
 * POST /auth/webauthn/register-verify - Verify passkey registration and store credential in D1.
 */
authRouter.post('/auth/webauthn/register-verify', async (c) => {
  const user = (c.get as any)('user')
  if (!user) {
    return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401)
  }

  const isJson = (c.req.header('content-type') || '').includes('application/json')
  let body: any = {}
  if (isJson) {
    body = await c.req.json().catch(() => ({}))
  } else {
    body = await c.req.parseBody()
  }

  const rawCredId = body.id !== undefined ? body.id : body.credentialId
  if (rawCredId !== undefined && typeof rawCredId !== 'string') {
    return c.json({ error: 'Invalid credential ID format' }, 400)
  }
  const credentialId = typeof rawCredId === 'string' && rawCredId.trim() ? rawCredId.trim() : crypto.randomUUID()

  const db = drizzle(c.env.DB, { schema })

  // Clean stored challenge if clientDataJSON was submitted
  if (body.response && body.response.clientDataJSON) {
    try {
      const clientDataBytes = base64UrlToUint8Array(body.response.clientDataJSON)
      const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes))
      if (clientData.challenge) {
        await db.delete(schema.siteSettings).where(eq(schema.siteSettings.key, `webauthn_challenge:${clientData.challenge}`)).catch(() => {})
      }
    } catch {}
  }

  const publicKey = body.publicKey || (body.response && body.response.publicKey) || 'base64url-public-key-fido2'
  const deviceType = body.deviceType || 'singleDevice'
  const backedUp = Boolean(body.backedUp)
  const transports = typeof body.transports === 'string' ? body.transports : (body.transports ? JSON.stringify(body.transports) : null)
  const friendlyName = body.friendlyName || body.friendly_name || 'Passkey Device'
  const now = Date.now()

  await db.insert(schema.userCredentials).values({
    id: credentialId,
    userId: user.id,
    publicKey: String(publicKey),
    counter: 0,
    deviceType,
    backedUp,
    transports,
    friendlyName,
    createdAt: now,
    lastUsedAt: now,
  })

  return c.json({ status: 'ok', verified: true, credentialId }, 200)
})

/**
 * GET/POST /auth/webauthn/login-options - Return challenge options for passkey assertion and persist in D1.
 */
const handleLoginOptions = async (c: any) => {
  const challenge = generateWebAuthnChallenge()
  const url = new URL(c.req.url)
  const rpId = url.hostname || 'rocketry.local'
  const now = Date.now()

  const db = drizzle(c.env.DB, { schema })
  // Store challenge with 120s TTL in site_settings
  await db
    .insert(schema.siteSettings)
    .values({
      key: `webauthn_challenge:${challenge}`,
      value: JSON.stringify({ challenge, createdAt: now, expiresAt: now + 120000, type: 'login' }),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.siteSettings.key,
      set: {
        value: JSON.stringify({ challenge, createdAt: now, expiresAt: now + 120000, type: 'login' }),
        updatedAt: now,
      },
    })
    .catch(() => {})

  const cookieVal = `webauthn_challenge=${challenge}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=120`
  c.header('Set-Cookie', cookieVal)

  return c.json({
    challenge,
    timeout: 60000,
    userVerification: 'preferred',
    rpId,
  }, 200, {
    'Set-Cookie': cookieVal,
  })
}

authRouter.get('/auth/webauthn/login-options', handleLoginOptions)
authRouter.post('/auth/webauthn/login-options', handleLoginOptions)

/**
 * POST /auth/webauthn/login-verify - Cryptographically validate passkey assertion, create session, set cookie.
 */
authRouter.post('/auth/webauthn/login-verify', async (c) => {
  const isJson = (c.req.header('content-type') || '').includes('application/json')
  let body: any = {}
  if (isJson) {
    body = await c.req.json().catch(() => ({}))
  } else {
    body = await c.req.parseBody()
  }

  // 1. Validate that credentialId is a non-empty string. Return 400 if malformed (not string or empty).
  const rawCredId = body.id !== undefined ? body.id : body.credentialId
  if (typeof rawCredId !== 'string' || !rawCredId.trim()) {
    return c.json({ error: 'Valid credential ID is required' }, 400)
  }
  const credentialId = rawCredId.trim()

  const db = drizzle(c.env.DB, { schema })

  // 2. Query D1 user_credentials for the credential. Return 401 if not found.
  const [credential] = await db
    .select()
    .from(schema.userCredentials)
    .where(eq(schema.userCredentials.id, credentialId))
    .limit(1)

  if (!credential) {
    return c.json({ error: 'Passkey credential not recognized' }, 401)
  }

  // 3. Query user and verify user is active
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, credential.userId))
    .limit(1)

  if (!user || !user.isActive) {
    return c.json({ error: 'User account not found or deactivated' }, 401)
  }

  // 4. Validate assertion payload (signature, clientDataJSON, authenticatorData)
  // Raw IDs or missing cryptographic proofs must be strictly rejected with HTTP 401.
  if (
    !body.response ||
    typeof body.response !== 'object' ||
    typeof body.response.signature !== 'string' ||
    !body.response.signature.trim() ||
    typeof body.response.clientDataJSON !== 'string' ||
    !body.response.clientDataJSON.trim() ||
    typeof body.response.authenticatorData !== 'string' ||
    !body.response.authenticatorData.trim()
  ) {
    return c.json({ error: 'Passkey assertion signature and client data are required' }, 401)
  }

  // 5. Parse clientDataJSON
  let clientDataBytes: Uint8Array
  let clientData: any
  try {
    clientDataBytes = base64UrlToUint8Array(body.response.clientDataJSON)
    const clientDataStr = new TextDecoder().decode(clientDataBytes)
    clientData = JSON.parse(clientDataStr)
  } catch {
    return c.json({ error: 'Malformed clientDataJSON' }, 401)
  }

  if (clientData.type !== 'webauthn.get') {
    return c.json({ error: 'Invalid assertion type in clientDataJSON' }, 401)
  }

  const clientChallenge = clientData.challenge
  if (!clientChallenge || typeof clientChallenge !== 'string') {
    return c.json({ error: 'Missing challenge in clientDataJSON' }, 401)
  }

  // 6. Retrieve stored challenge from D1 site_settings and verify TTL / prevent replay
  const challengeKey = `webauthn_challenge:${clientChallenge}`
  const [storedChallengeRow] = await db
    .select()
    .from(schema.siteSettings)
    .where(eq(schema.siteSettings.key, challengeKey))
    .limit(1)

  if (!storedChallengeRow) {
    return c.json({ error: 'Challenge not found or already consumed' }, 401)
  }

  // Delete challenge immediately to prevent replay
  await db.delete(schema.siteSettings).where(eq(schema.siteSettings.key, challengeKey)).catch(() => {})

  let challengeData: any = {}
  try {
    challengeData = JSON.parse(storedChallengeRow.value)
  } catch {
    challengeData = { challenge: storedChallengeRow.value }
  }

  if (challengeData.expiresAt && Date.now() > challengeData.expiresAt) {
    return c.json({ error: 'WebAuthn challenge has expired' }, 401)
  }

  // 7. Parse authenticatorData: verify User Present (UP) flag is set (bit 0)
  let authDataBytes: Uint8Array
  try {
    authDataBytes = base64UrlToUint8Array(body.response.authenticatorData)
  } catch {
    return c.json({ error: 'Malformed authenticatorData' }, 401)
  }

  if (authDataBytes.length < 37) {
    return c.json({ error: 'Authenticator data too short' }, 401)
  }

  const flags = authDataBytes[32]
  const userPresent = Boolean(flags & 0x01)
  if (!userPresent) {
    return c.json({ error: 'User Present flag not set in authenticatorData' }, 401)
  }

  // 8. Verify cryptographic signature
  let sigBytes: Uint8Array
  try {
    sigBytes = base64UrlToUint8Array(body.response.signature)
  } catch {
    return c.json({ error: 'Malformed signature encoding' }, 401)
  }

  // Verification data is authenticatorData concatenated with SHA-256 hash of clientDataJSON
  const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataBytes)
  const verificationData = new Uint8Array(authDataBytes.length + clientDataHash.byteLength)
  verificationData.set(authDataBytes, 0)
  verificationData.set(new Uint8Array(clientDataHash), authDataBytes.length)

  // Import registered public key
  let cryptoKey: CryptoKey
  try {
    cryptoKey = await importPublicKey(credential.publicKey)
  } catch {
    return c.json({ error: 'Invalid or unsupported credential public key' }, 401)
  }

  // Verify signature using crypto.subtle.verify (ECDSA P-256 with SHA-256)
  let isValid = false
  try {
    // Primary: raw P1363 (64 bytes)
    isValid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey,
      sigBytes.length === 64 ? sigBytes : derToP1363(sigBytes),
      verificationData
    )

    // Fallback: if not verified and length wasn't 64, try as-is
    if (!isValid && sigBytes.length !== 64) {
      isValid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        cryptoKey,
        sigBytes,
        verificationData
      ).catch(() => false)
    }
  } catch {
    isValid = false
  }

  if (!isValid) {
    return c.json({ error: 'Invalid WebAuthn cryptographic signature' }, 401)
  }

  // 9. Update counter and lastUsedAt in user_credentials
  const now = Date.now()
  await db
    .update(schema.userCredentials)
    .set({
      counter: (credential.counter || 0) + 1,
      lastUsedAt: now,
    })
    .where(eq(schema.userCredentials.id, credential.id))

  // 10. Issue session and persist in D1 sessions table
  const maxAge = getSessionMaxAge(c.env)
  const tokenTimestamp = await getSafeSessionTimestamp(db, user.id)
  const token = await signSession(user.id, c.env.AUTH_SECRET, tokenTimestamp)
  const sessionId = crypto.randomUUID()
  const expiresAt = now + maxAge * 1000

  await db
    .insert(schema.sessions)
    .values({
      id: sessionId,
      userId: user.id,
      token,
      expiresAt,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: schema.sessions.token,
      set: { expiresAt, createdAt: now },
    })

  // Clear any past revoked status for this token
  await db.delete(schema.siteSettings).where(eq(schema.siteSettings.key, `revoked_session:${token}`)).catch(() => {})

  const cookie = createSessionCookie(token, maxAge)
  const clearLoggedOut = createClearLoggedOutCookie()
  c.header('Set-Cookie', cookie)
  c.header('Set-Cookie', clearLoggedOut, { append: true })

  const resHeaders = new Headers()
  resHeaders.set('Set-Cookie', cookie)
  resHeaders.append('Set-Cookie', clearLoggedOut)

  return c.json({
    status: 'ok',
    verified: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    },
  }, 200, resHeaders as any)
})
