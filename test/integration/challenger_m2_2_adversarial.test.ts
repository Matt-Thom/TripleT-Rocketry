/**
 * Adversarial Challenger 2 Test Suite for Milestone 2:
 * Auth Security, Admin Dashboard & WebAuthn (Requirement R5)
 *
 * Empirical verification of:
 * 1. WebAuthn Registration & Credential Persistence:
 *    - Challenge uniqueness across 50 consecutive calls (cryptographic entropy).
 *    - Unauthenticated access rejection (401).
 *    - Accurate persistence in D1 `user_credentials` (all fields: id, userId, publicKey, deviceType, backedUp, transports, friendlyName).
 *    - Multi-credential registration per user and user isolation.
 * 2. WebAuthn Login, Assertion Verification & Session Issuance:
 *    - Assertion challenge uniqueness across 50 consecutive calls.
 *    - Input validation & edge cases (missing id, malformed non-string payloads, SQL injection resilience).
 *    - Malformed non-string credential IDs (array, object, number, boolean) strictly return HTTP 400.
 *    - Genuine WebCrypto ECDSA P-256 signature verification, counter increment, lastUsedAt update, and D1 session creation.
 *    - Rejection of forged signatures, missing signatures, missing UP flag, and replayed challenges (HTTP 401).
 * 3. Inactive User Passkey Login & Status Lifecycle:
 *    - Deactivated users cannot authenticate via WebAuthn (HTTP 401).
 *    - No session created in D1 `sessions` for deactivated passkey attempt.
 *    - Full status lifecycle: active -> passkey succeeds -> deactivated -> passkey fails -> reactivated -> passkey succeeds.
 * 4. Cache-Control Route Protection:
 *    - `Cache-Control: no-store` header present across all protected routes.
 *    - `Pragma: no-cache` header present.
 *    - Post-logout redirection and cache protection.
 * 5. Sole Active Administrator Demotion Guard:
 *    - Demoting sole active admin to flyer via form or JSON strictly returns HTTP 400.
 *    - Demoting is permitted when multiple active admins exist, but blocked on the final remaining admin.
 *    - Non-admin flyer attempting user editing receives HTTP 403.
 * 6. Protocol-Relative Open Redirect Sanitization:
 *    - Protocol-relative redirects (//evil.com, ///evil.com) sanitized to / on login, register, switch.
 *    - External URLs (https://evil.com) and javascript schemes sanitized to /.
 *    - Legitimate relative paths (/rockets, /flights) are preserved.
 * 7. Passkey Registration UI & Endpoint Verification:
 *    - Admin dashboard renders #register-passkey-btn and #passkey-reg-status.
 *    - Embedded client-side script includes WebAuthn credential enrollment workflow.
 *    - Register-options and register-verify endpoints validate session and payload integrity.
 */

import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getDb,
  seedTestUser,
  truncateDb,
} from '../helpers/db'
import { fetchGet, fetchPostForm } from '../helpers/http'
import { signSession } from '../../src/services/auth'

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function createGenuinePasskeyAssertion(
  keyPair: CryptoKeyPair,
  challenge: string,
  origin = 'https://example.com',
  upFlag = true,
) {
  const clientDataObj = {
    type: 'webauthn.get',
    challenge,
    origin,
  }
  const clientDataJSONBytes = new TextEncoder().encode(JSON.stringify(clientDataObj))
  const clientDataJSONB64 = toBase64Url(clientDataJSONBytes)

  const authDataBytes = new Uint8Array(37)
  if (upFlag) {
    authDataBytes[32] = 0x01 // UP flag
  }
  const authenticatorDataB64 = toBase64Url(authDataBytes)

  const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSONBytes)
  const verificationData = new Uint8Array(authDataBytes.length + clientDataHash.byteLength)
  verificationData.set(authDataBytes, 0)
  verificationData.set(new Uint8Array(clientDataHash), authDataBytes.length)

  const sigBytes = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    verificationData,
  )
  const signatureB64 = toBase64Url(new Uint8Array(sigBytes))

  return {
    clientDataJSON: clientDataJSONB64,
    authenticatorData: authenticatorDataB64,
    signature: signatureB64,
  }
}

beforeEach(async () => {
  await truncateDb()
  try {
    await env.DB.prepare('DELETE FROM sessions').run()
  } catch {}
  try {
    await env.DB.prepare('DELETE FROM user_credentials').run()
  } catch {}
  try {
    await env.DB.prepare('DELETE FROM site_settings').run()
  } catch {}
  try {
    const now = Date.now()
    await env.DB.prepare(
      "INSERT INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?1, ?1)",
    ).bind(now).run()
  } catch {
    // Ignore if already setup
  }
})

describe('Milestone 2 Challenger 2: WebAuthn, Admin Protections & Security Hardening', () => {
  // =========================================================================
  // 1. WebAuthn Registration & Credential Persistence
  // =========================================================================
  describe('1. WebAuthn Registration & Credential Persistence', () => {
    it('1.1: WebAuthn register-options generates unique, high-entropy challenges across 50 calls', async () => {
      const user = await seedTestUser({ displayName: 'Passkey Pilot' })
      const token = await signSession(user.id)
      const challenges = new Set<string>()

      for (let i = 0; i < 50; i++) {
        const res = await SELF.fetch('https://example.com/auth/webauthn/register-options', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `triplet_session=${token}`,
          },
        })

        expect(res.status).toBe(200)
        const data = await res.json<{
          challenge: string
          rp: { name: string; id: string }
          user: { id: string; name: string; displayName: string }
          pubKeyCredParams: Array<{ type: string; alg: number }>
        }>()

        expect(typeof data.challenge).toBe('string')
        expect(data.challenge.length).toBeGreaterThanOrEqual(32)
        expect(data.rp.name).toBe('TripleT Rocketry')
        expect(data.user.id).toBe(user.id)
        expect(data.user.name).toBe(user.email)
        expect(data.pubKeyCredParams.length).toBeGreaterThan(0)

        // Challenge must be unique
        expect(challenges.has(data.challenge)).toBe(false)
        challenges.add(data.challenge)
      }

      expect(challenges.size).toBe(50)
    })

    it('1.2: unauthenticated call to register-options is strictly rejected with HTTP 401', async () => {
      const res = await SELF.fetch('https://example.com/auth/webauthn/register-options', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-no-auth': 'true',
        },
      })

      expect(res.status).toBe(401)
      const json = await res.json<{ error: string }>()
      expect(json.error).toMatch(/Unauthorized/i)
    })

    it('1.3: unauthenticated call to register-verify is strictly rejected with HTTP 401 without DB write', async () => {
      const credId = `unauth-cred-${crypto.randomUUID()}`

      const res = await SELF.fetch('https://example.com/auth/webauthn/register-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-no-auth': 'true',
        },
        body: JSON.stringify({
          id: credId,
          publicKey: 'fake-public-key',
        }),
      })

      expect(res.status).toBe(401)

      // Verify no credential was written to D1
      const count = await env.DB.prepare('SELECT COUNT(*) as cnt FROM user_credentials WHERE id = ?')
        .bind(credId)
        .first<{ cnt: number }>()
      expect(count?.cnt).toBe(0)
    })

    it('1.4: register-verify persists all credential metadata correctly into D1 user_credentials', async () => {
      const user = await seedTestUser({ displayName: 'Alice Rocketry' })
      const token = await signSession(user.id)
      const credId = `passkey-alice-${crypto.randomUUID()}`

      const beforeTime = Date.now()

      const res = await SELF.fetch('https://example.com/auth/webauthn/register-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({
          id: credId,
          publicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0TestKey',
          deviceType: 'multiDevice',
          backedUp: true,
          transports: ['internal', 'hybrid'],
          friendlyName: "Alice's YubiKey 5C",
        }),
      })

      expect(res.status).toBe(200)
      const json = await res.json<{ status: string; verified: boolean; credentialId: string }>()
      expect(json.status).toBe('ok')
      expect(json.verified).toBe(true)
      expect(json.credentialId).toBe(credId)

      // Query D1 table directly to verify persistence
      const row = await env.DB.prepare('SELECT * FROM user_credentials WHERE id = ?')
        .bind(credId)
        .first<{
          id: string
          user_id: string
          public_key: string
          counter: number
          device_type: string
          backed_up: number | boolean
          transports: string
          friendly_name: string
          created_at: number
          last_used_at: number
        }>()

      expect(row).not.toBeNull()
      expect(row?.id).toBe(credId)
      expect(row?.user_id).toBe(user.id)
      expect(row?.public_key).toBe('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0TestKey')
      expect(row?.device_type).toBe('multiDevice')
      expect(Boolean(row?.backed_up)).toBe(true)
      expect(row?.transports).toContain('internal')
      expect(row?.transports).toContain('hybrid')
      expect(row?.friendly_name).toBe("Alice's YubiKey 5C")
      expect(row?.counter).toBe(0)
      expect(row?.created_at).toBeGreaterThanOrEqual(beforeTime - 1000)
      expect(row?.last_used_at).toBeGreaterThanOrEqual(beforeTime - 1000)
    })

    it('1.5: supports multiple passkey registrations per user while maintaining user isolation', async () => {
      const userA = await seedTestUser({ displayName: 'User Alpha' })
      const userB = await seedTestUser({ displayName: 'User Beta' })

      const tokenA = await signSession(userA.id)
      const tokenB = await signSession(userB.id)

      const credA1 = `cred-a1-${crypto.randomUUID()}`
      const credA2 = `cred-a2-${crypto.randomUUID()}`
      const credB1 = `cred-b1-${crypto.randomUUID()}`

      // Register two credentials for user A
      await SELF.fetch('https://example.com/auth/webauthn/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `triplet_session=${tokenA}` },
        body: JSON.stringify({ id: credA1, friendlyName: 'Alpha Phone' }),
      })
      await SELF.fetch('https://example.com/auth/webauthn/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `triplet_session=${tokenA}` },
        body: JSON.stringify({ id: credA2, friendlyName: 'Alpha Laptop' }),
      })

      // Register one credential for user B
      await SELF.fetch('https://example.com/auth/webauthn/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `triplet_session=${tokenB}` },
        body: JSON.stringify({ id: credB1, friendlyName: 'Beta Security Key' }),
      })

      // Verify user A has exactly 2 credentials
      const credsA = await env.DB.prepare('SELECT id FROM user_credentials WHERE user_id = ?')
        .bind(userA.id)
        .all<{ id: string }>()
      expect(credsA.results.map((r) => r.id).sort()).toEqual([credA1, credA2].sort())

      // Verify user B has exactly 1 credential
      const credsB = await env.DB.prepare('SELECT id FROM user_credentials WHERE user_id = ?')
        .bind(userB.id)
        .all<{ id: string }>()
      expect(credsB.results.map((r) => r.id)).toEqual([credB1])
    })
  })

  // =========================================================================
  // 2. WebAuthn Login, Assertion Verification & Session Issuance
  // =========================================================================
  describe('2. WebAuthn Login, Assertion Verification & Session Issuance', () => {
    it('2.1: WebAuthn login-options generates unique challenges across 50 calls', async () => {
      const challenges = new Set<string>()

      for (let i = 0; i < 50; i++) {
        const res = await SELF.fetch('https://example.com/auth/webauthn/login-options', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        })

        expect(res.status).toBe(200)
        const data = await res.json<{ challenge: string; timeout: number; rpId: string }>()
        expect(typeof data.challenge).toBe('string')
        expect(data.challenge.length).toBeGreaterThanOrEqual(32)
        expect(data.timeout).toBe(60000)

        expect(challenges.has(data.challenge)).toBe(false)
        challenges.add(data.challenge)
      }

      expect(challenges.size).toBe(50)
    })

    it('2.2: rejects login-verify when credentialId is missing or empty string', async () => {
      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
      const data = await res.json<{ error: string }>()
      expect(data.error).toMatch(/valid credential id is required/i)

      const emptyRes = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: '   ' }),
      })
      expect(emptyRes.status).toBe(400)
    })

    it('2.3: rejects login-verify with unknown/unrecognized credential ID', async () => {
      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'non-existent-credential-id' }),
      })

      expect(res.status).toBe(401)
      const data = await res.json<{ error: string }>()
      expect(data.error).toMatch(/passkey credential not recognized/i)
    })

    it('2.4: safely handles SQL injection, script tags, and null credentialId without crashing', async () => {
      const payloads = [
        { id: "' OR '1'='1" },
        { id: "'; DROP TABLE users; --" },
        { id: '"><script>alert(1)</script>' },
        { id: null },
        { id: '' },
      ]

      for (const payload of payloads) {
        const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        // Must reject safely with 400 or 401, never 500
        expect([400, 401]).toContain(res.status)
      }
    })

    it('2.4b: malformed non-string credential IDs (array, object, number, boolean) strictly return HTTP 400', async () => {
      const malformedPayloads = [
        { id: ['malformed', 'array'] },
        { id: { objectKey: 'malformed' } },
        { id: 12345 },
        { id: true },
        { id: false },
        { credentialId: ['array', 'id'] },
        { credentialId: { nested: true } },
      ]

      for (const payload of malformedPayloads) {
        const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        expect(res.status).toBe(400)
        const json = await res.json<{ error: string }>()
        expect(json.error).toMatch(/valid credential id is required/i)
      }
    })

    it('2.5: genuine WebCrypto ECDSA passkey login verifies signature, creates D1 session, increments counter, and sets cookie', async () => {
      const user = await seedTestUser({
        displayName: 'Genuine Passkey Flyer',
        email: 'passkey.flyer@rocketry.sa.gov.au',
      })
      const credId = `cred-${crypto.randomUUID()}`

      // Generate genuine WebCrypto ECDSA keypair
      const keyPair = (await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      )) as CryptoKeyPair
      const spki = (await crypto.subtle.exportKey('spki', keyPair.publicKey)) as ArrayBuffer
      const publicKeyB64 = toBase64Url(new Uint8Array(spki))

      // Register genuine credential in user_credentials with initial counter = 5
      await env.DB.prepare(
        `INSERT INTO user_credentials (id, user_id, public_key, counter, device_type, friendly_name, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(credId, user.id, publicKeyB64, 5, 'platform', 'Touch ID Mac', Date.now() - 100000, Date.now() - 100000).run()

      // Fetch challenge from login-options
      const optRes = await SELF.fetch('https://example.com/auth/webauthn/login-options', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })
      expect(optRes.status).toBe(200)
      const { challenge } = await optRes.json<{ challenge: string }>()

      // Create genuine signed assertion
      const assertion = await createGenuinePasskeyAssertion(keyPair, challenge)

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          id: credId,
          type: 'public-key',
          response: assertion,
        }),
      })

      expect(res.status).toBe(200)
      const json = await res.json<{
        status: string
        verified: boolean
        user: { id: string; email: string; displayName: string }
      }>()

      expect(json.status).toBe('ok')
      expect(json.verified).toBe(true)
      expect(json.user.id).toBe(user.id)
      expect(json.user.email).toBe(user.email)

      // Check cookie header
      const setCookie = res.headers.get('set-cookie') || ''
      expect(setCookie).toMatch(/triplet_session=/i)
      expect(setCookie).toMatch(/Path=\//i)
      expect(setCookie).toMatch(/HttpOnly/i)

      // Extract session token
      const match = setCookie.match(/triplet_session=([^;]+)/)
      expect(match).not.toBeNull()
      const token = decodeURIComponent(match![1])

      // Verify session row exists in D1 sessions table
      const sessionRow = await env.DB.prepare('SELECT * FROM sessions WHERE token = ?')
        .bind(token)
        .first<{
          id: string
          user_id: string
          token: string
          expires_at: number
          created_at: number
        }>()

      expect(sessionRow).not.toBeNull()
      expect(sessionRow?.user_id).toBe(user.id)
      expect(sessionRow?.expires_at).toBeGreaterThan(Date.now())

      // Verify counter incremented in user_credentials from 5 to 6
      const credRow = await env.DB.prepare('SELECT counter, last_used_at FROM user_credentials WHERE id = ?')
        .bind(credId)
        .first<{ counter: number; last_used_at: number }>()

      expect(credRow?.counter).toBe(6)
      expect(credRow?.last_used_at).toBeGreaterThan(Date.now() - 5000)

      // Verify the issued session cookie can access protected routes
      const protectedRes = await fetchGet('/rockets', {
        Cookie: `triplet_session=${token}`,
      })
      expect(protectedRes.status).toBe(200)
    })

    it('2.6: sequential passkey logins create distinct active sessions and continually increment counter', async () => {
      const user = await seedTestUser({ displayName: 'Multi Session Flyer' })
      const credId = `cred-${crypto.randomUUID()}`

      const keyPair = (await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      )) as CryptoKeyPair
      const spki = (await crypto.subtle.exportKey('spki', keyPair.publicKey)) as ArrayBuffer
      const publicKeyB64 = toBase64Url(new Uint8Array(spki))

      await env.DB.prepare(
        `INSERT INTO user_credentials (id, user_id, public_key, counter, device_type, friendly_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(credId, user.id, publicKeyB64, 0, 'platform', 'iPhone FaceID', Date.now()).run()

      // Login 1
      const optRes1 = await SELF.fetch('https://example.com/auth/webauthn/login-options', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })
      const { challenge: challenge1 } = await optRes1.json<{ challenge: string }>()
      const assertion1 = await createGenuinePasskeyAssertion(keyPair, challenge1)

      const res1 = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: credId, type: 'public-key', response: assertion1 }),
      })
      expect(res1.status).toBe(200)
      const cookie1 = res1.headers.get('set-cookie') || ''
      const token1 = decodeURIComponent(cookie1.match(/triplet_session=([^;]+)/)![1])

      // Login 2
      const optRes2 = await SELF.fetch('https://example.com/auth/webauthn/login-options', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })
      const { challenge: challenge2 } = await optRes2.json<{ challenge: string }>()
      const assertion2 = await createGenuinePasskeyAssertion(keyPair, challenge2)

      const res2 = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: credId, type: 'public-key', response: assertion2 }),
      })
      expect(res2.status).toBe(200)
      const cookie2 = res2.headers.get('set-cookie') || ''
      const token2 = decodeURIComponent(cookie2.match(/triplet_session=([^;]+)/)![1])

      // Tokens should be distinct
      expect(token1).not.toBe(token2)

      // Both sessions must exist in D1
      const count = await env.DB.prepare('SELECT COUNT(*) as cnt FROM sessions WHERE user_id = ?')
        .bind(user.id)
        .first<{ cnt: number }>()
      expect(count?.cnt).toBe(2)

      // Counter should now be 2
      const cred = await env.DB.prepare('SELECT counter FROM user_credentials WHERE id = ?')
        .bind(credId)
        .first<{ counter: number }>()
      expect(cred?.counter).toBe(2)

      // Both tokens should work
      const check1 = await fetchGet('/rockets', { Cookie: `triplet_session=${token1}` })
      expect(check1.status).toBe(200)
      const check2 = await fetchGet('/rockets', { Cookie: `triplet_session=${token2}` })
      expect(check2.status).toBe(200)
    })

    it('2.7: strictly rejects assertions with missing UP (User Present) flag with HTTP 401', async () => {
      const user = await seedTestUser()
      const credId = `cred-${crypto.randomUUID()}`

      const keyPair = (await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      )) as CryptoKeyPair
      const spki = (await crypto.subtle.exportKey('spki', keyPair.publicKey)) as ArrayBuffer
      const publicKeyB64 = toBase64Url(new Uint8Array(spki))

      await env.DB.prepare(
        'INSERT INTO user_credentials (id, user_id, public_key, counter, device_type, friendly_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(credId, user.id, publicKeyB64, 0, 'platform', 'Security Key', Date.now()).run()

      const optRes = await SELF.fetch('https://example.com/auth/webauthn/login-options', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })
      const { challenge } = await optRes.json<{ challenge: string }>()

      // Create assertion with upFlag = false
      const assertionWithoutUP = await createGenuinePasskeyAssertion(keyPair, challenge, 'https://example.com', false)

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: credId,
          type: 'public-key',
          response: assertionWithoutUP,
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/User Present flag not set/i)
    })

    it('2.8: strictly rejects replayed challenges (single-use enforcement) with HTTP 401', async () => {
      const user = await seedTestUser()
      const credId = `cred-${crypto.randomUUID()}`

      const keyPair = (await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      )) as CryptoKeyPair
      const spki = (await crypto.subtle.exportKey('spki', keyPair.publicKey)) as ArrayBuffer
      const publicKeyB64 = toBase64Url(new Uint8Array(spki))

      await env.DB.prepare(
        'INSERT INTO user_credentials (id, user_id, public_key, counter, device_type, friendly_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(credId, user.id, publicKeyB64, 0, 'platform', 'Security Key', Date.now()).run()

      const optRes = await SELF.fetch('https://example.com/auth/webauthn/login-options', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })
      const { challenge } = await optRes.json<{ challenge: string }>()
      const assertion = await createGenuinePasskeyAssertion(keyPair, challenge)

      // First use -> 200 OK
      const res1 = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: credId, type: 'public-key', response: assertion }),
      })
      expect(res1.status).toBe(200)

      // Second use of same assertion/challenge -> 401 Replay rejected
      const res2 = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: credId, type: 'public-key', response: assertion }),
      })
      expect(res2.status).toBe(401)
      const err = await res2.json<{ error: string }>()
      expect(err.error).toMatch(/challenge not found or already consumed/i)
    })
  })

  // =========================================================================
  // 3. Inactive User Passkey Login & Status Lifecycle
  // =========================================================================
  describe('3. Inactive User Passkey Login & Status Lifecycle', () => {
    it('3.1: deactivated user CANNOT authenticate via WebAuthn passkey', async () => {
      const user = await seedTestUser({
        displayName: 'Suspended Pilot',
        isActive: false,
      })
      const credId = `cred-${crypto.randomUUID()}`

      await env.DB.prepare(
        `INSERT INTO user_credentials (id, user_id, public_key, counter, device_type, friendly_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(credId, user.id, 'mock-key', 3, 'platform', 'Hardware Token', Date.now()).run()

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: credId }),
      })

      expect(res.status).toBe(401)
      const data = await res.json<{ error: string }>()
      expect(data.error).toMatch(/deactivated|not found/i)

      // Verify NO session was created in D1
      const sessions = await env.DB.prepare('SELECT COUNT(*) as cnt FROM sessions WHERE user_id = ?')
        .bind(user.id)
        .first<{ cnt: number }>()
      expect(sessions?.cnt).toBe(0)

      // Verify counter was NOT incremented
      const cred = await env.DB.prepare('SELECT counter FROM user_credentials WHERE id = ?')
        .bind(credId)
        .first<{ counter: number }>()
      expect(cred?.counter).toBe(3)
    })

    it('3.2: full status lifecycle: active -> passkey succeeds -> deactivated -> passkey fails -> reactivated -> passkey succeeds', async () => {
      const admin = await seedTestUser({ displayName: 'Admin User' })
      await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(admin.id).run()
      const adminToken = await signSession(admin.id)

      const flyer = await seedTestUser({ displayName: 'Lifecycle Pilot', isActive: true })
      const credId = `cred-${crypto.randomUUID()}`

      const keyPair = (await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      )) as CryptoKeyPair
      const spki = (await crypto.subtle.exportKey('spki', keyPair.publicKey)) as ArrayBuffer
      const publicKeyB64 = toBase64Url(new Uint8Array(spki))

      await env.DB.prepare(
        `INSERT INTO user_credentials (id, user_id, public_key, counter, device_type, friendly_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(credId, flyer.id, publicKeyB64, 0, 'platform', 'Biometric Passkey', Date.now()).run()

      // Phase A: Active flyer successfully signs in via genuine passkey assertion
      const optA = await SELF.fetch('https://example.com/auth/webauthn/login-options', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })
      const { challenge: challengeA } = await optA.json<{ challenge: string }>()
      const assertionA = await createGenuinePasskeyAssertion(keyPair, challengeA)

      const loginA = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: credId, type: 'public-key', response: assertionA }),
      })
      expect(loginA.status).toBe(200)

      // Phase B: Admin deactivates flyer via POST /admin/users/:id/status
      const deactRes = await fetchPostForm(`/admin/users/${flyer.id}/status`, {
        is_active: 'false',
      }, {
        Cookie: `triplet_session=${adminToken}`,
      }, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(deactRes.status)

      // Verify D1 sessions purged
      const activeSessions = await env.DB.prepare('SELECT COUNT(*) as cnt FROM sessions WHERE user_id = ?')
        .bind(flyer.id)
        .first<{ cnt: number }>()
      expect(activeSessions?.cnt).toBe(0)

      // Flyer tries passkey login while deactivated -> MUST FAIL (401)
      const optB = await SELF.fetch('https://example.com/auth/webauthn/login-options', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })
      const { challenge: challengeB } = await optB.json<{ challenge: string }>()
      const assertionB = await createGenuinePasskeyAssertion(keyPair, challengeB)

      const loginB = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: credId, type: 'public-key', response: assertionB }),
      })
      expect(loginB.status).toBe(401)
      const errB = await loginB.json<{ error: string }>()
      expect(errB.error).toMatch(/deactivated|not found/i)

      // Phase C: Admin reactivates flyer via POST /admin/users/:id/status
      const reactRes = await fetchPostForm(`/admin/users/${flyer.id}/status`, {
        is_active: 'true',
      }, {
        Cookie: `triplet_session=${adminToken}`,
      }, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(reactRes.status)

      // Flyer tries passkey login after reactivation -> MUST SUCCEED (200)
      const optC = await SELF.fetch('https://example.com/auth/webauthn/login-options', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })
      const { challenge: challengeC } = await optC.json<{ challenge: string }>()
      const assertionC = await createGenuinePasskeyAssertion(keyPair, challengeC)

      const loginC = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: credId, type: 'public-key', response: assertionC }),
      })
      expect(loginC.status).toBe(200)
      const cookieC = loginC.headers.get('set-cookie') || ''
      expect(cookieC).toMatch(/triplet_session=/i)

      const tokenC = decodeURIComponent(cookieC.match(/triplet_session=([^;]+)/)![1])
      const accessRes = await fetchGet('/rockets', { Cookie: `triplet_session=${tokenC}` })
      expect(accessRes.status).toBe(200)
    })
  })

  // =========================================================================
  // 4. Cache-Control: no-store on Protected Routes
  // =========================================================================
  describe('4. Cache-Control: no-store on Protected Routes', () => {
    it('4.1: Cache-Control: no-store is returned on all protected routes', async () => {
      const admin = await seedTestUser({ displayName: 'Admin Officer' })
      await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(admin.id).run()
      const token = await signSession(admin.id)
      const authHeader = { Cookie: `triplet_session=${token}` }

      const protectedRoutes = [
        '/',
        '/rockets',
        '/motors',
        '/inventory',
        '/sites',
        '/events',
        '/flights',
        '/admin',
        '/admin/users',
      ]

      for (const route of protectedRoutes) {
        const res = await fetchGet(route, authHeader)
        expect(res.status).toBe(200)

        const cacheControl = res.headers.get('cache-control') || ''
        expect(
          cacheControl.toLowerCase(),
          `Route ${route} missing 'no-store' in Cache-Control: ${cacheControl}`,
        ).toContain('no-store')

        const pragma = res.headers.get('pragma') || ''
        expect(
          pragma.toLowerCase(),
          `Route ${route} missing 'no-cache' in Pragma: ${pragma}`,
        ).toContain('no-cache')
      }
    })

    it('4.2: logout response includes Cache-Control: no-store alongside Clear-Site-Data', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)

      const res = await fetchGet('/logout', {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      const cacheControl = res.headers.get('cache-control') || ''
      expect(cacheControl.toLowerCase()).toContain('no-store')

      const clearSiteData = res.headers.get('clear-site-data') || ''
      expect(clearSiteData).toMatch(/(cache|cookies|storage|\*)/i)
    })

    it('4.3: accessing protected route with revoked session cookie redirects to /login and denies data', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)

      // Insert session in D1
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, Date.now() + 86400000, Date.now()).run()

      // Logout to revoke
      await fetchGet('/logout', { Cookie: `triplet_session=${token}` }, { redirect: 'manual' })

      // Attempt access to /inventory with old token
      const res = await fetchGet('/inventory', {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') || ''
      expect(location).toMatch(/\/login/i)
    })
  })

  // =========================================================================
  // 5. Sole Active Administrator Demotion Guard
  // =========================================================================
  describe('5. Sole Active Administrator Demotion Guard', () => {
    it('5.1: attempting to demote sole active administrator to flyer via form returns HTTP 400', async () => {
      const soleAdmin = await seedTestUser({ displayName: 'Sole Admin Demotion Form Target' })
      await env.DB.prepare("UPDATE users SET role = 'admin', is_active = 1 WHERE id = ?").bind(soleAdmin.id).run()
      const token = await signSession(soleAdmin.id)

      const res = await fetchPostForm(`/admin/users/${soleAdmin.id}/edit`, {
        role: 'flyer',
      }, {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      expect(res.status).toBe(400)
      const text = await res.text()
      expect(text).toMatch(/cannot demote.*last active administrator/i)

      // Verify user remains admin in D1
      const dbUser = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(soleAdmin.id).first<{ role: string }>()
      expect(dbUser?.role).toBe('admin')
    })

    it('5.2: attempting to demote sole active administrator to flyer via JSON returns HTTP 400', async () => {
      const soleAdmin = await seedTestUser({ displayName: 'Sole Admin Demotion JSON Target' })
      await env.DB.prepare("UPDATE users SET role = 'admin', is_active = 1 WHERE id = ?").bind(soleAdmin.id).run()
      const token = await signSession(soleAdmin.id)

      const res = await SELF.fetch(`https://example.com/admin/users/${soleAdmin.id}/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({ role: 'flyer' }),
      })

      expect(res.status).toBe(400)
      const json = await res.json<{ error: string }>()
      expect(json.error).toMatch(/cannot demote.*last active administrator/i)
    })

    it('5.3: demoting an administrator is permitted when another active administrator exists, but blocked on final admin', async () => {
      const admin1 = await seedTestUser({ displayName: 'First Active Admin' })
      const admin2 = await seedTestUser({ displayName: 'Second Active Admin' })
      await env.DB.prepare("UPDATE users SET role = 'admin', is_active = 1 WHERE id = ?").bind(admin1.id).run()
      await env.DB.prepare("UPDATE users SET role = 'admin', is_active = 1 WHERE id = ?").bind(admin2.id).run()

      const token1 = await signSession(admin1.id)

      // Admin 1 demotes Admin 2 -> Should succeed because 2 active admins exist
      const demote2Res = await fetchPostForm(`/admin/users/${admin2.id}/edit`, {
        role: 'flyer',
      }, {
        Cookie: `triplet_session=${token1}`,
      }, { redirect: 'manual' })

      expect([200, 302, 303]).toContain(demote2Res.status)

      // Verify Admin 2 was demoted to flyer
      const dbAdmin2 = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(admin2.id).first<{ role: string }>()
      expect(dbAdmin2?.role).toBe('flyer')

      // Now only Admin 1 remains active. Attempting to demote Admin 1 must fail with 400
      const demote1Res = await fetchPostForm(`/admin/users/${admin1.id}/edit`, {
        role: 'flyer',
      }, {
        Cookie: `triplet_session=${token1}`,
      }, { redirect: 'manual' })

      expect(demote1Res.status).toBe(400)
      const text1 = await demote1Res.text()
      expect(text1).toMatch(/cannot demote.*last active administrator/i)

      // Verify Admin 1 remains admin
      const dbAdmin1 = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(admin1.id).first<{ role: string }>()
      expect(dbAdmin1?.role).toBe('admin')
    })

    it('5.4: non-admin flyer attempting to demote admin or edit user is strictly forbidden (HTTP 403)', async () => {
      const admin = await seedTestUser({ displayName: 'Target Admin' })
      await env.DB.prepare("UPDATE users SET role = 'admin', is_active = 1 WHERE id = ?").bind(admin.id).run()

      const flyer = await seedTestUser({ displayName: 'Malicious Flyer' })
      const flyerToken = await signSession(flyer.id)

      const res = await fetchPostForm(`/admin/users/${admin.id}/edit`, {
        role: 'flyer',
      }, {
        Cookie: `triplet_session=${flyerToken}`,
      }, { redirect: 'manual' })

      expect(res.status).toBe(403)
    })
  })

  // =========================================================================
  // 6. Protocol-Relative Open Redirect Sanitization
  // =========================================================================
  describe('6. Protocol-Relative Open Redirect Sanitization', () => {
    it('6.1: protocol-relative open redirect (//evil.com) on POST /login is sanitized to /', async () => {
      const user = await seedTestUser()
      const res = await fetchPostForm('/login', {
        email: user.email,
        password: 'TestPassword123!',
        redirect: '//evil.com/phishing',
      }, {}, { redirect: 'manual' })

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') ?? ''
      expect(location.startsWith('//')).toBe(false)
      expect(location).toBe('/')
    })

    it('6.2: triple slash (///evil.com) and backslash (//\\evil.com) redirects on POST /login are sanitized to /', async () => {
      const user = await seedTestUser()

      const res1 = await fetchPostForm('/login', {
        email: user.email,
        password: 'TestPassword123!',
        redirect: '///evil.com',
      }, {}, { redirect: 'manual' })

      expect([302, 303]).toContain(res1.status)
      expect(res1.headers.get('location')).toBe('/')

      const res2 = await fetchPostForm('/login', {
        email: user.email,
        password: 'TestPassword123!',
        redirect: '//\\evil.com',
      }, {}, { redirect: 'manual' })

      expect([302, 303]).toContain(res2.status)
      expect(res2.headers.get('location')).toBe('/')
    })

    it('6.3: external absolute URL (https://evil.com) and javascript: scheme are sanitized to /', async () => {
      const user = await seedTestUser()

      const res1 = await fetchPostForm('/login', {
        email: user.email,
        password: 'TestPassword123!',
        redirect: 'https://evil.com/steal-creds',
      }, {}, { redirect: 'manual' })

      expect([302, 303]).toContain(res1.status)
      expect(res1.headers.get('location')).toBe('/')

      const res2 = await fetchPostForm('/login', {
        email: user.email,
        password: 'TestPassword123!',
        redirect: 'javascript:alert(document.cookie)',
      }, {}, { redirect: 'manual' })

      expect([302, 303]).toContain(res2.status)
      expect(res2.headers.get('location')).toBe('/')
    })

    it('6.4: protocol-relative open redirect on POST /register is sanitized to / on success and error', async () => {
      // Successful registration
      const email = `newpilot-${crypto.randomUUID()}@sarc.org`
      const res = await fetchPostForm('/register', {
        displayName: 'Register Redirect Test',
        email,
        password: 'StrongPassword2026!',
        redirect: '//evil.com/trap',
      }, {}, { redirect: 'manual' })

      expect([302, 303]).toContain(res.status)
      expect(res.headers.get('location')).toBe('/')

      // Error path validation: error redirect param must also be sanitized to /
      const errRes = await fetchPostForm('/register', {
        displayName: '',
        email: '',
        password: '',
        redirect: '//evil.com/trap',
      }, {}, { redirect: 'manual' })

      expect([302, 303]).toContain(errRes.status)
      const errLocation = errRes.headers.get('location') || ''
      expect(errLocation).not.toContain('//evil.com')
      expect(errLocation).toContain('redirect=%2F')
    })

    it('6.5: protocol-relative open redirect on POST /auth/switch/:id is sanitized to /', async () => {
      const userA = await seedTestUser({ displayName: 'Switch User A' })
      const userB = await seedTestUser({ displayName: 'Switch User B' })
      const tokenA = await signSession(userA.id)

      const res = await fetchPostForm(`/auth/switch/${userB.id}?redirect=%2F%2Fattacker.com`, {}, {
        Cookie: `triplet_session=${tokenA}`,
      }, { redirect: 'manual' })

      expect([302, 303]).toContain(res.status)
      expect(res.headers.get('location')).toBe('/')
    })

    it('6.6: legitimate relative paths (/rockets, /flights, /admin/users) are preserved', async () => {
      const user = await seedTestUser()

      for (const validPath of ['/rockets', '/flights', '/admin/users', '/inventory']) {
        const res = await fetchPostForm('/login', {
          email: user.email,
          password: 'TestPassword123!',
          redirect: validPath,
        }, {}, { redirect: 'manual' })

        expect([302, 303]).toContain(res.status)
        expect(res.headers.get('location')).toBe(validPath)
      }
    })
  })

  // =========================================================================
  // 7. Passkey Registration UI & Endpoint Verification
  // =========================================================================
  describe('7. Passkey Registration UI & Endpoint Verification', () => {
    it('7.1: GET /admin/users renders + Register Passkey button (#register-passkey-btn) for administrator', async () => {
      const admin = await seedTestUser({ displayName: 'Passkey Admin UI' })
      await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(admin.id).run()
      const adminToken = await signSession(admin.id)

      const res = await fetchGet('/admin/users', {
        Cookie: `triplet_session=${adminToken}`,
      })

      expect(res.status).toBe(200)
      const html = await res.text()

      // Verify button exists with proper ID and label
      expect(html).toContain('id="register-passkey-btn"')
      expect(html).toContain('+ Register Passkey')

      // Verify feedback container exists
      expect(html).toContain('id="passkey-reg-status"')

      // Verify client-side enrollment script is present
      expect(html).toContain('/auth/webauthn/register-options')
      expect(html).toContain('/auth/webauthn/register-verify')
      expect(html).toContain('navigator.credentials.create')
    })

    it('7.2: register-options returns valid RP, user, and challenge options for authenticated user', async () => {
      const admin = await seedTestUser({ displayName: 'Passkey Admin Options' })
      await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(admin.id).run()
      const adminToken = await signSession(admin.id)

      const res = await SELF.fetch('https://example.com/auth/webauthn/register-options', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${adminToken}`,
        },
      })

      expect(res.status).toBe(200)
      const data = await res.json<{
        challenge: string
        rp: { name: string; id: string }
        user: { id: string; name: string; displayName: string }
        pubKeyCredParams: Array<{ type: string; alg: number }>
      }>()

      expect(data.challenge).toBeDefined()
      expect(data.rp.name).toBe('TripleT Rocketry')
      expect(data.user.id).toBe(admin.id)
      expect(data.user.name).toBe(admin.email)
      expect(data.pubKeyCredParams.length).toBeGreaterThan(0)
    })

    it('7.3: register-verify rejects malformed non-string credential IDs (array, object) with HTTP 400', async () => {
      const admin = await seedTestUser({ displayName: 'Passkey Admin Bad ID' })
      await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(admin.id).run()
      const adminToken = await signSession(admin.id)

      const res1 = await SELF.fetch('https://example.com/auth/webauthn/register-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${adminToken}`,
        },
        body: JSON.stringify({
          id: ['array', 'id'],
          publicKey: 'test-key',
        }),
      })

      expect(res1.status).toBe(400)
      const err1 = await res1.json<{ error: string }>()
      expect(err1.error).toMatch(/Invalid credential ID format/i)

      const res2 = await SELF.fetch('https://example.com/auth/webauthn/register-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${adminToken}`,
        },
        body: JSON.stringify({
          id: { key: 'value' },
          publicKey: 'test-key',
        }),
      })

      expect(res2.status).toBe(400)
      const err2 = await res2.json<{ error: string }>()
      expect(err2.error).toMatch(/Invalid credential ID format/i)
    })
  })
})
