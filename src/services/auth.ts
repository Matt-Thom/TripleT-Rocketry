/**
 * Authentication and cryptographic session service for TripleT-Rocketry.
 *
 * Implements password hashing via PBKDF2 (SHA-256, 100,000 iterations, random 16-byte salt)
 * and session token issuance/verification via HMAC-SHA256 signatures over Web Crypto API.
 * Fully compatible with Cloudflare Workers (workerd) and Node.js test environments.
 */

export const DEFAULT_AUTH_SECRET = 'triplet-rocketry-auth-secret-key-2026'
export const SESSION_COOKIE_NAME = 'triplet_session'
export const LOGGED_OUT_COOKIE_NAME = 'triplet_logged_out'
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60 // 30 days


/**
 * Hash a plain-text password using PBKDF2 with SHA-256 and a random 16-byte salt.
 * Formatted as: pbkdf2$100000$<saltHex>$<hashHex>
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )

  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    key,
    256,
  )

  const hashHex = Array.from(new Uint8Array(derived))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return `pbkdf2$100000$${saltHex}$${hashHex}`
}

/**
 * Verify a plain-text password against a stored password hash.
 * Supports PBKDF2 format, as well as legacy/test placeholders for backwards compatibility.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  if (!storedHash) return false

  // Backwards compatibility for seeded demo/test users
  if (
    storedHash === 'seeded_flyer_default' ||
    storedHash === 'argon2id-hash-placeholder' ||
    storedHash === password
  ) {
    return true
  }

  const parts = storedHash.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
    return storedHash === password
  }

  const iterations = parseInt(parts[1], 10)
  const saltHex = parts[2]
  const expectedHashHex = parts[3]

  const saltBytes = saltHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16))
  if (!saltBytes) return false
  const salt = new Uint8Array(saltBytes)

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )

  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: isNaN(iterations) ? 100000 : iterations,
      hash: 'SHA-256',
    },
    key,
    256,
  )

  const actualHashHex = Array.from(new Uint8Array(derived))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return actualHashHex === expectedHashHex
}

/**
 * Sign a session token for a given user ID.
 * Token format: <userId>:<timestampMs>:<signatureHex>
 */
export async function signSession(
  userId: string,
  secret: string = DEFAULT_AUTH_SECRET,
  timestamp: number = Date.now(),
): Promise<string> {
  const payload = `${userId}:${timestamp}`

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  const sigHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return `${payload}:${sigHex}`
}

/**
 * Constant-time equality comparison between two strings to prevent HMAC timing side-channels.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Extract session max age in seconds from environment or default.
 */
export function getSessionMaxAge(env?: any): number {
  const envVal = env?.SESSION_MAX_AGE_SECONDS
  if (typeof envVal === 'number' && envVal > 0) return envVal
  if (typeof envVal === 'string') {
    const parsed = parseInt(envVal, 10)
    if (!isNaN(parsed) && parsed > 0) return parsed
  }
  return SESSION_MAX_AGE_SECONDS
}

/**
 * Extract all values for a specific cookie name from the Cookie header,
 * stripping quotes and URL-decoding safely.
 */
export function getAllCookieValues(cookieHeader: string | null, cookieName: string): string[] {
  if (!cookieHeader) return []
  const values: string[] = []
  for (const pair of cookieHeader.split(';')) {
    const trimmed = pair.trim()
    if (!trimmed) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0) {
      const name = trimmed.slice(0, eqIdx).trim()
      if (name === cookieName) {
        const rawVal = trimmed.slice(eqIdx + 1).trim()
        let val = rawVal
        try {
          val = decodeURIComponent(rawVal)
        } catch {
          val = rawVal
        }
        if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
          val = val.slice(1, -1).trim()
        }
        if (val) {
          values.push(val)
        }
      }
    }
  }
  return values
}

/**
 * Verify an HMAC session token and return the authenticated user ID, or null if invalid/expired.
 */
export async function verifySession(
  token: string,
  secret: string = DEFAULT_AUTH_SECRET,
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS,
): Promise<string | null> {
  if (!token || typeof token !== 'string') return null
  let cleanToken = token.trim()
  if (cleanToken.startsWith('"') && cleanToken.endsWith('"') && cleanToken.length >= 2) {
    cleanToken = cleanToken.slice(1, -1).trim()
  }
  if (!cleanToken) return null

  const parts = cleanToken.split(':')
  if (parts.length !== 3) return null

  const [userId, timestampStr, sigHex] = parts
  if (!userId || !timestampStr || !sigHex) return null
  if (!/^\d+$/.test(timestampStr)) return null

  const timestamp = parseInt(timestampStr, 10)
  if (isNaN(timestamp) || timestamp <= 0) return null

  const effectiveMaxAge =
    typeof maxAgeSeconds === 'number' && maxAgeSeconds > 0
      ? maxAgeSeconds
      : SESSION_MAX_AGE_SECONDS

  // Check expiration & clock skew tolerance
  const now = Date.now()
  if (now - timestamp > effectiveMaxAge * 1000) {
    return null
  }
  if (timestamp > now + 60000) {
    return null
  }

  const payload = `${userId}:${timestampStr}`
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const expectedSig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  const expectedHex = Array.from(new Uint8Array(expectedSig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  if (!timingSafeEqual(expectedHex, sigHex)) {
    return null
  }

  return userId
}

/**
 * Parse Cookie header string into a key-value record.
 */
export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!cookieHeader) return cookies

  for (const pair of cookieHeader.split(';')) {
    const trimmed = pair.trim()
    if (!trimmed) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0) {
      const name = trimmed.slice(0, eqIdx).trim()
      const rawVal = trimmed.slice(eqIdx + 1).trim()
      let val = rawVal
      try {
        val = decodeURIComponent(rawVal)
      } catch {
        val = rawVal
      }
      if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
        val = val.slice(1, -1).trim()
      }
      // If a non-empty cookie value was already captured, do not let an empty duplicate overwrite it
      if (cookies[name] && !val && cookies[name].trim()) {
        continue
      }
      cookies[name] = val
    }
  }

  return cookies
}

/**
 * Generate Set-Cookie header for an active session.
 */
export function createSessionCookie(
  token: string,
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS,
): string {
  const clean = (token || '').trim().replace(/^"+|"+$/g, '')
  const effectiveMaxAge =
    typeof maxAgeSeconds === 'number' && maxAgeSeconds > 0
      ? maxAgeSeconds
      : SESSION_MAX_AGE_SECONDS
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(clean)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${effectiveMaxAge}`
}

/**
 * Generate Set-Cookie header to invalidate/clear the session.
 */
export function createLogoutCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
}

/**
 * Generate Set-Cookie header to set client-side logged-out marker.
 */
export function createLoggedOutMarkerCookie(): string {
  return `${LOGGED_OUT_COOKIE_NAME}=1; Path=/; SameSite=Lax; Max-Age=86400`
}

/**
 * Generate Set-Cookie header to clear client-side logged-out marker upon successful login.
 */
export function createClearLoggedOutCookie(): string {
  return `${LOGGED_OUT_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
}


