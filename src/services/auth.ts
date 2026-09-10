/**
 * Authentication and cryptographic session service for TripleT-Rocketry.
 *
 * Implements password hashing via PBKDF2 (SHA-256, 100,000 iterations, random 16-byte salt)
 * and session token issuance/verification via HMAC-SHA256 signatures over Web Crypto API.
 * Fully compatible with Cloudflare Workers (workerd) and Node.js test environments.
 */

const DEFAULT_AUTH_SECRET = 'triplet-rocketry-auth-secret-key-2026'
const SESSION_COOKIE_NAME = 'triplet_session'
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60 // 30 days

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
): Promise<string> {
  const timestamp = Date.now()
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
 * Verify an HMAC session token and return the authenticated user ID, or null if invalid/expired.
 */
export async function verifySession(
  token: string,
  secret: string = DEFAULT_AUTH_SECRET,
): Promise<string | null> {
  if (!token || typeof token !== 'string') return null

  const parts = token.split(':')
  if (parts.length !== 3) return null

  const [userId, timestampStr, sigHex] = parts
  const timestamp = parseInt(timestampStr, 10)
  if (isNaN(timestamp)) return null

  // Check 30-day expiration
  if (Date.now() - timestamp > SESSION_MAX_AGE_SECONDS * 1000) {
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

  if (expectedHex !== sigHex) {
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
      const val = trimmed.slice(eqIdx + 1).trim()
      cookies[name] = decodeURIComponent(val)
    }
  }

  return cookies
}

/**
 * Generate Set-Cookie header for an active session.
 */
export function createSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`
}

/**
 * Generate Set-Cookie header to invalidate/clear the session.
 */
export function createLogoutCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
}

export { SESSION_COOKIE_NAME }
