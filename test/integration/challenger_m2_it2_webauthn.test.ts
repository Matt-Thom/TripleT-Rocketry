/**
 * Empirical Adversarial Challenger Test Suite: Milestone 2 Iteration 2
 * WebAuthn Cryptographic Signature Verification, Replay Prevention, and Auth Security (Requirement R5).
 *
 * Vectors Verified Empirically:
 * 1. Forged, Mismatched, and Corrupted WebAuthn Signatures (HTTP 401)
 * 2. Expired, Replayed, and Missing Challenges (HTTP 401)
 * 3. Raw Credential IDs & Missing Signature Payloads (HTTP 401/400)
 * 4. AuthenticatorData & User Present (UP) Flag Validation (HTTP 401)
 * 5. Genuine ECDSA Signatures, Counter Increments, and Session Lifecycles (HTTP 200)
 */

import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { seedTestUser, truncateDb } from '../helpers/db'
import { fetchGet, fetchPostForm } from '../helpers/http'
import { signSession } from '../../src/services/auth'

// ===========================================================================
// WebAuthn Cryptographic Test Utilities
// ===========================================================================

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

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

function p1363ToDer(p1363: Uint8Array): Uint8Array {
  let r = p1363.subarray(0, 32)
  let s = p1363.subarray(32, 64)
  while (r.length > 1 && r[0] === 0) r = r.subarray(1)
  while (s.length > 1 && s[0] === 0) s = s.subarray(1)
  const rBytes = (r[0] & 0x80) ? new Uint8Array([0, ...r]) : r
  const sBytes = (s[0] & 0x80) ? new Uint8Array([0, ...s]) : s
  const seqLen = 2 + rBytes.length + 2 + sBytes.length
  const der = new Uint8Array(2 + seqLen)
  der[0] = 0x30
  der[1] = seqLen
  der[2] = 0x02
  der[3] = rBytes.length
  der.set(rBytes, 4)
  const sOffset = 4 + rBytes.length
  der[sOffset] = 0x02
  der[sOffset + 1] = sBytes.length
  der.set(sBytes, sOffset + 2)
  return der
}

interface WebAuthnAssertionFixture {
  user: any
  credId: string
  keyPair: CryptoKeyPair
  challenge: string
  clientDataJSONB64: string
  authenticatorDataB64: string
  signatureB64: string
}

async function createValidAssertionFixture(options: {
  initialCounter?: number
  publicKeyFormat?: 'spki' | 'jwk' | 'raw'
} = {}): Promise<WebAuthnAssertionFixture> {
  const user = await seedTestUser({ displayName: 'WebAuthn Pilot' })
  const credId = `cred-${crypto.randomUUID()}`
  const initialCounter = options.initialCounter ?? 10
  const format = options.publicKeyFormat ?? 'spki'

  const keyPair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair

  let publicKeyStored: string
  if (format === 'jwk') {
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
    publicKeyStored = JSON.stringify(jwk)
  } else if (format === 'raw') {
    const raw = (await crypto.subtle.exportKey('raw', keyPair.publicKey)) as ArrayBuffer
    publicKeyStored = toBase64Url(new Uint8Array(raw))
  } else {
    const spki = (await crypto.subtle.exportKey('spki', keyPair.publicKey)) as ArrayBuffer
    publicKeyStored = toBase64Url(new Uint8Array(spki))
  }

  // Register in user_credentials table
  await env.DB.prepare(
    'INSERT INTO user_credentials (id, user_id, public_key, counter, device_type, friendly_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(credId, user.id, publicKeyStored, initialCounter, 'platform', 'Security Key', Date.now()).run()

  // Obtain challenge from login-options
  const optRes = await SELF.fetch('https://example.com/auth/webauthn/login-options', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  })
  const { challenge } = await optRes.json<{ challenge: string }>()

  // Construct clientDataJSON
  const clientDataObj = {
    type: 'webauthn.get',
    challenge,
    origin: 'https://example.com',
  }
  const clientDataJSONBytes = new TextEncoder().encode(JSON.stringify(clientDataObj))
  const clientDataJSONB64 = toBase64Url(clientDataJSONBytes)

  // Construct authenticatorData with User Present flag (bit 0 = 0x01)
  const authDataBytes = new Uint8Array(37)
  authDataBytes[32] = 0x01 // UP flag
  const authenticatorDataB64 = toBase64Url(authDataBytes)

  // Verification data: authenticatorData || SHA-256(clientDataJSON)
  const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSONBytes)
  const verificationData = new Uint8Array(authDataBytes.length + clientDataHash.byteLength)
  verificationData.set(authDataBytes, 0)
  verificationData.set(new Uint8Array(clientDataHash), authDataBytes.length)

  // Sign with legitimate private key
  const sigBytes = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    verificationData
  )
  const signatureB64 = toBase64Url(new Uint8Array(sigBytes))

  return {
    user,
    credId,
    keyPair,
    challenge,
    clientDataJSONB64,
    authenticatorDataB64,
    signatureB64,
  }
}

// ===========================================================================
// Test Lifecycle Hooks
// ===========================================================================

beforeEach(async () => {
  await truncateDb()
  try {
    await env.DB.prepare('DELETE FROM sessions').run()
  } catch {}
  try {
    await env.DB.prepare('DELETE FROM site_settings').run()
  } catch {}
  try {
    await env.DB.prepare('DELETE FROM user_credentials').run()
  } catch {}

  const now = Date.now()
  await env.DB.prepare(
    "INSERT OR REPLACE INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?, ?)",
  )
    .bind(now, now)
    .run()
})

// ===========================================================================
// Test Suites
// ===========================================================================

describe('Challenger M2 It2: Empirical WebAuthn Adversarial Suite', () => {

  // -------------------------------------------------------------------------
  // 1. Forged, Mismatched, and Corrupted WebAuthn Signatures
  // -------------------------------------------------------------------------
  describe('Vector 1: Forged, Mismatched, and Corrupted Signatures', () => {
    it('1.1: strictly rejects forged signature signed with an attacker private key with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()

      // Attacker generates separate key pair
      const attackerKeyPair = (await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      )) as CryptoKeyPair

      // Reconstruct verification data
      const authDataBytes = base64UrlToUint8Array(fixture.authenticatorDataB64)
      const clientDataBytes = base64UrlToUint8Array(fixture.clientDataJSONB64)
      const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataBytes)
      const verificationData = new Uint8Array(authDataBytes.length + clientDataHash.byteLength)
      verificationData.set(authDataBytes, 0)
      verificationData.set(new Uint8Array(clientDataHash), authDataBytes.length)

      // Attacker signs verification data
      const forgedSigBytes = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        attackerKeyPair.privateKey,
        verificationData
      )
      const forgedSigB64 = toBase64Url(new Uint8Array(forgedSigBytes))

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: fixture.authenticatorDataB64,
            signature: forgedSigB64,
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/signature/i)
    })

    it('1.2: strictly rejects corrupted / tampered IEEE P1363 signature bytes with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()
      const rawSigBytes = base64UrlToUint8Array(fixture.signatureB64)
      
      // Mutate/corrupt bytes 10 and 40 (bit flip)
      const tamperedBytes = new Uint8Array(rawSigBytes)
      tamperedBytes[10] ^= 0xff
      tamperedBytes[40] ^= 0xaa
      const tamperedSigB64 = toBase64Url(tamperedBytes)

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: fixture.authenticatorDataB64,
            signature: tamperedSigB64,
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/signature/i)
    })

    it('1.3: strictly rejects tampered ASN.1 DER signature with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()
      const rawSigBytes = base64UrlToUint8Array(fixture.signatureB64)
      const derSig = p1363ToDer(rawSigBytes)

      // Tamper r/s values inside DER
      derSig[derSig.length - 3] ^= 0xff
      const tamperedDerB64 = toBase64Url(derSig)

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: fixture.authenticatorDataB64,
            signature: tamperedDerB64,
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/signature/i)
    })

    it('1.4: strictly rejects truncated signature bytes with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()
      const rawSigBytes = base64UrlToUint8Array(fixture.signatureB64)
      const truncatedB64 = toBase64Url(rawSigBytes.subarray(0, 16))

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: fixture.authenticatorDataB64,
            signature: truncatedB64,
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/signature/i)
    })

    it('1.5: strictly rejects non-base64url garbage signature string with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: fixture.authenticatorDataB64,
            signature: '???%%%$$$^^^&&&***',
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/signature/i)
    })

    it('1.6: strictly rejects signature generated over different clientDataJSON with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()

      // Different clientData
      const altClientData = {
        type: 'webauthn.get',
        challenge: 'different-arbitrary-challenge-string',
        origin: 'https://attacker.com',
      }
      const altClientDataBytes = new TextEncoder().encode(JSON.stringify(altClientData))
      const altClientDataB64 = toBase64Url(altClientDataBytes)

      // Signature was created over fixture's clientData, but submitted with altClientData
      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: altClientDataB64,
            authenticatorData: fixture.authenticatorDataB64,
            signature: fixture.signatureB64,
          },
        }),
      })

      expect(res.status).toBe(401)
    })
  })

  // -------------------------------------------------------------------------
  // 2. Expired, Replayed, and Missing Challenges
  // -------------------------------------------------------------------------
  describe('Vector 2: Expired, Replayed, and Missing Challenges', () => {
    it('2.1: strictly rejects replayed assertion challenge (cannot be used twice)', async () => {
      const fixture = await createValidAssertionFixture()

      const payload = {
        id: fixture.credId,
        type: 'public-key',
        response: {
          clientDataJSON: fixture.clientDataJSONB64,
          authenticatorData: fixture.authenticatorDataB64,
          signature: fixture.signatureB64,
        },
      }

      // First verification: should succeed (HTTP 200)
      const firstRes = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      expect(firstRes.status).toBe(200)

      // Immediate second attempt: replaying the same payload must fail with HTTP 401
      const replayRes = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      expect(replayRes.status).toBe(401)
      const replayErr = await replayRes.json<{ error: string }>()
      expect(replayErr.error).toMatch(/consumed|not found/i)
    })

    it('2.2: strictly rejects newly signed assertion using an already consumed challenge with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()

      // Consume the challenge
      const firstRes = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: fixture.authenticatorDataB64,
            signature: fixture.signatureB64,
          },
        }),
      })
      expect(firstRes.status).toBe(200)

      // Attacker creates a fresh authenticatorData and fresh signature using consumed challenge
      const freshAuthData = new Uint8Array(37)
      freshAuthData[32] = 0x01
      const clientDataBytes = base64UrlToUint8Array(fixture.clientDataJSONB64)
      const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataBytes)
      const freshVerificationData = new Uint8Array(freshAuthData.length + clientDataHash.byteLength)
      freshVerificationData.set(freshAuthData, 0)
      freshVerificationData.set(new Uint8Array(clientDataHash), freshAuthData.length)

      const freshSig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        fixture.keyPair.privateKey,
        freshVerificationData
      )

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: toBase64Url(freshAuthData),
            signature: toBase64Url(new Uint8Array(freshSig)),
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/consumed|not found/i)
    })

    it('2.3: strictly rejects expired challenge with HTTP 401', async () => {
      const user = await seedTestUser({ displayName: 'Expired Challenge Pilot' })
      const credId = `cred-${crypto.randomUUID()}`

      const keyPair = (await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      )) as CryptoKeyPair
      const spki = (await crypto.subtle.exportKey('spki', keyPair.publicKey)) as ArrayBuffer

      await env.DB.prepare(
        'INSERT INTO user_credentials (id, user_id, public_key, counter, device_type, friendly_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(credId, user.id, toBase64Url(new Uint8Array(spki)), 0, 'platform', 'Touch ID', Date.now()).run()

      // Insert an expired challenge in site_settings (expired 10 seconds ago)
      const expiredChallenge = 'expired-challenge-' + crypto.randomUUID()
      const pastTime = Date.now() - 10000
      await env.DB.prepare(
        'INSERT INTO site_settings (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ).bind(
        `webauthn_challenge:${expiredChallenge}`,
        JSON.stringify({ challenge: expiredChallenge, createdAt: pastTime - 120000, expiresAt: pastTime, type: 'login' }),
        pastTime,
        pastTime
      ).run()

      // Sign payload with expired challenge
      const clientDataObj = { type: 'webauthn.get', challenge: expiredChallenge, origin: 'https://example.com' }
      const clientDataBytes = new TextEncoder().encode(JSON.stringify(clientDataObj))
      const authData = new Uint8Array(37)
      authData[32] = 0x01
      const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataBytes)
      const vData = new Uint8Array(authData.length + clientDataHash.byteLength)
      vData.set(authData, 0)
      vData.set(new Uint8Array(clientDataHash), authData.length)

      const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, vData)

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: credId,
          type: 'public-key',
          response: {
            clientDataJSON: toBase64Url(clientDataBytes),
            authenticatorData: toBase64Url(authData),
            signature: toBase64Url(new Uint8Array(sig)),
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/expired/i)
    })

    it('2.4: rejects unissued / arbitrary challenge with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()
      const arbitraryChallenge = 'never-issued-challenge-string'

      const clientDataObj = { type: 'webauthn.get', challenge: arbitraryChallenge, origin: 'https://example.com' }
      const clientDataBytes = new TextEncoder().encode(JSON.stringify(clientDataObj))
      const authData = new Uint8Array(37)
      authData[32] = 0x01
      const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataBytes)
      const vData = new Uint8Array(authData.length + clientDataHash.byteLength)
      vData.set(authData, 0)
      vData.set(new Uint8Array(clientDataHash), authData.length)

      const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, fixture.keyPair.privateKey, vData)

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: toBase64Url(clientDataBytes),
            authenticatorData: toBase64Url(authData),
            signature: toBase64Url(new Uint8Array(sig)),
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/not found|consumed/i)
    })

    it('2.5: rejects clientDataJSON missing challenge property with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()
      const clientDataObj = { type: 'webauthn.get', origin: 'https://example.com' } // no challenge
      const clientDataBytes = new TextEncoder().encode(JSON.stringify(clientDataObj))

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: toBase64Url(clientDataBytes),
            authenticatorData: fixture.authenticatorDataB64,
            signature: fixture.signatureB64,
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/missing challenge/i)
    })

    it('2.6: rejects malformed non-JSON clientDataJSON with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()
      const badClientData = toBase64Url(new TextEncoder().encode('not a valid json object {'))

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: badClientData,
            authenticatorData: fixture.authenticatorDataB64,
            signature: fixture.signatureB64,
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/malformed clientdatajson/i)
    })

    it('2.7: rejects clientDataJSON with invalid assertion type (webauthn.create) with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()
      const clientDataObj = { type: 'webauthn.create', challenge: fixture.challenge, origin: 'https://example.com' }
      const clientDataBytes = new TextEncoder().encode(JSON.stringify(clientDataObj))

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: toBase64Url(clientDataBytes),
            authenticatorData: fixture.authenticatorDataB64,
            signature: fixture.signatureB64,
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/invalid assertion type/i)
    })
  })

  // -------------------------------------------------------------------------
  // 3. Raw Credential IDs & Payload Structural Validation
  // -------------------------------------------------------------------------
  describe('Vector 3: Raw Credential IDs & Structural Validation', () => {
    it('3.1: strictly rejects raw credential ID without response object with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: fixture.credId }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/signature.*client data.*required/i)
    })

    it('3.2: strictly rejects request with empty response object with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: fixture.credId, response: {} }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/signature.*client data.*required/i)
    })

    it('3.3: strictly rejects response missing signature field with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          response: {
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: fixture.authenticatorDataB64,
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/signature.*client data.*required/i)
    })

    it('3.4: strictly rejects response missing clientDataJSON field with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          response: {
            signature: fixture.signatureB64,
            authenticatorData: fixture.authenticatorDataB64,
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/signature.*client data.*required/i)
    })

    it('3.5: strictly rejects response missing authenticatorData field with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          response: {
            signature: fixture.signatureB64,
            clientDataJSON: fixture.clientDataJSONB64,
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/signature.*client data.*required/i)
    })

    it('3.6: strictly rejects whitespace-only string values in payload with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          response: {
            signature: '   ',
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: fixture.authenticatorDataB64,
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/signature.*client data.*required/i)
    })

    it('3.7: returns HTTP 400 for malformed non-string credential IDs (array, object, number)', async () => {
      for (const badId of [['arr'], { obj: 1 }, 12345, true]) {
        const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: badId }),
        })
        expect(res.status).toBe(400)
        const err = await res.json<{ error: string }>()
        expect(err.error).toMatch(/valid credential id is required/i)
      }
    })

    it('3.8: returns HTTP 400 for empty or whitespace credential ID string', async () => {
      for (const emptyId of ['', '   ', '\t\n']) {
        const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: emptyId }),
        })
        expect(res.status).toBe(400)
        const err = await res.json<{ error: string }>()
        expect(err.error).toMatch(/valid credential id is required/i)
      }
    })

    it('3.9: returns HTTP 401 for unregistered / non-existent credential ID', async () => {
      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'non-existent-cred-id-12345',
          response: {
            signature: 'mockSig',
            clientDataJSON: 'mockData',
            authenticatorData: 'mockAuth',
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/not recognized/i)
    })
  })

  // -------------------------------------------------------------------------
  // 4. AuthenticatorData & User Present (UP) Flag Enforcement
  // -------------------------------------------------------------------------
  describe('Vector 4: AuthenticatorData & User Present Flag Enforcement', () => {
    it('4.1: strictly rejects assertion when User Present (UP) flag is 0 with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()

      // Construct authenticatorData with UP flag = 0 (byte 32 = 0x00)
      const authDataNoUP = new Uint8Array(37)
      authDataNoUP[32] = 0x00 // UP flag NOT set
      const authDataNoUPB64 = toBase64Url(authDataNoUP)

      // Sign with private key
      const clientDataBytes = base64UrlToUint8Array(fixture.clientDataJSONB64)
      const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataBytes)
      const verificationData = new Uint8Array(authDataNoUP.length + clientDataHash.byteLength)
      verificationData.set(authDataNoUP, 0)
      verificationData.set(new Uint8Array(clientDataHash), authDataNoUP.length)

      const sigNoUP = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        fixture.keyPair.privateKey,
        verificationData
      )

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: authDataNoUPB64,
            signature: toBase64Url(new Uint8Array(sigNoUP)),
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/user present flag not set/i)
    })

    it('4.2: strictly rejects authenticatorData shorter than 37 bytes with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()
      const shortAuthData = new Uint8Array(20) // Only 20 bytes (< 37)
      const shortAuthDataB64 = toBase64Url(shortAuthData)

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: shortAuthDataB64,
            signature: fixture.signatureB64,
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/authenticator data too short/i)
    })

    it('4.3: strictly rejects malformed non-base64url authenticatorData with HTTP 401', async () => {
      const fixture = await createValidAssertionFixture()

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: '???$$$%%%garbage',
            signature: fixture.signatureB64,
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/authenticator/i)
    })
  })

  // -------------------------------------------------------------------------
  // 5. Genuine ECDSA Signatures, Counter Increments, and Session Lifecycles
  // -------------------------------------------------------------------------
  describe('Vector 5: Genuine ECDSA Verification, Counter & Session Lifecycle', () => {
    it('5.1: genuine WebCrypto ECDSA assertion passes with HTTP 200 and verified: true', async () => {
      const fixture = await createValidAssertionFixture({ initialCounter: 50 })

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: fixture.authenticatorDataB64,
            signature: fixture.signatureB64,
          },
        }),
      })

      expect(res.status).toBe(200)
      const data = await res.json<{ status: string; verified: boolean; user: { id: string; email: string } }>()
      expect(data.status).toBe('ok')
      expect(data.verified).toBe(true)
      expect(data.user.id).toBe(fixture.user.id)
    })

    it('5.2: counter is strictly incremented and lastUsedAt updated in D1 user_credentials', async () => {
      const initialCounter = 77
      const fixture = await createValidAssertionFixture({ initialCounter })

      const beforeTime = Date.now() - 1000
      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: fixture.authenticatorDataB64,
            signature: fixture.signatureB64,
          },
        }),
      })
      expect(res.status).toBe(200)

      // Query D1 user_credentials
      const credRow = await env.DB.prepare('SELECT counter, last_used_at FROM user_credentials WHERE id = ?')
        .bind(fixture.credId)
        .first<{ counter: number; last_used_at: number }>()

      expect(credRow?.counter).toBe(initialCounter + 1)
      expect(credRow?.last_used_at).toBeGreaterThanOrEqual(beforeTime)
    })

    it('5.3: issues valid triplet_session cookie and persists session in D1 granting protected route access', async () => {
      const fixture = await createValidAssertionFixture()

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: fixture.authenticatorDataB64,
            signature: fixture.signatureB64,
          },
        }),
      })

      expect(res.status).toBe(200)

      // Verify Set-Cookie header
      const setCookie = res.headers.get('set-cookie') || ''
      expect(setCookie).toContain('triplet_session=')
      const tokenMatch = setCookie.match(/triplet_session=([^;]+)/)
      expect(tokenMatch).not.toBeNull()
      const rawCookieToken = tokenMatch![1]
      const sessionToken = decodeURIComponent(rawCookieToken)

      // Verify session record in D1 sessions table
      const sessionRow = await env.DB.prepare('SELECT * FROM sessions WHERE token = ?')
        .bind(sessionToken)
        .first<{ id: string; user_id: string; expires_at: number }>()

      expect(sessionRow).not.toBeNull()
      expect(sessionRow?.user_id).toBe(fixture.user.id)
      expect(sessionRow?.expires_at).toBeGreaterThan(Date.now())

      // Verify immediate access to protected route using the issued session cookie
      const protectedRes = await fetchGet('/rockets', {
        Cookie: `triplet_session=${rawCookieToken}`,
      }, { redirect: 'manual' })

      expect(protectedRes.status).toBe(200)
    })

    it('5.4: genuine ASN.1 DER formatted ECDSA signature is accepted and verified with HTTP 200', async () => {
      const fixture = await createValidAssertionFixture()
      const rawSigBytes = base64UrlToUint8Array(fixture.signatureB64)
      const derSig = p1363ToDer(rawSigBytes)
      const derSigB64 = toBase64Url(derSig)

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: fixture.authenticatorDataB64,
            signature: derSigB64,
          },
        }),
      })

      expect(res.status).toBe(200)
      const data = await res.json<{ verified: boolean }>()
      expect(data.verified).toBe(true)
    })

    it('5.5: credential stored in JWK format verifies genuine assertion with HTTP 200', async () => {
      const fixture = await createValidAssertionFixture({ publicKeyFormat: 'jwk' })

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: fixture.authenticatorDataB64,
            signature: fixture.signatureB64,
          },
        }),
      })

      expect(res.status).toBe(200)
      const data = await res.json<{ verified: boolean }>()
      expect(data.verified).toBe(true)
    })

    it('5.6: credential stored as raw uncompressed EC point verifies genuine assertion with HTTP 200', async () => {
      const fixture = await createValidAssertionFixture({ publicKeyFormat: 'raw' })

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: fixture.authenticatorDataB64,
            signature: fixture.signatureB64,
          },
        }),
      })

      expect(res.status).toBe(200)
      const data = await res.json<{ verified: boolean }>()
      expect(data.verified).toBe(true)
    })

    it('5.7: deactivated user cannot authenticate even with cryptographically valid ECDSA signature', async () => {
      const fixture = await createValidAssertionFixture()

      // Deactivate user in D1
      await env.DB.prepare('UPDATE users SET is_active = 0 WHERE id = ?').bind(fixture.user.id).run()

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fixture.credId,
          type: 'public-key',
          response: {
            clientDataJSON: fixture.clientDataJSONB64,
            authenticatorData: fixture.authenticatorDataB64,
            signature: fixture.signatureB64,
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/deactivated/i)

      // Verify no session was created in D1
      const sessions = await env.DB.prepare('SELECT * FROM sessions WHERE user_id = ?').bind(fixture.user.id).all()
      expect(sessions.results).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // 6. Last Administrator Demotion & Open Redirect Sanitization
  // -------------------------------------------------------------------------
  describe('Vector 6: Last Administrator Demotion & Open Redirect Sanitization', () => {
    it('6.1: strictly blocks demoting the sole active administrator account with HTTP 400', async () => {
      const admin = await seedTestUser({ displayName: 'Sole Admin 1' })
      await env.DB.prepare("UPDATE users SET role = 'admin', is_active = 1 WHERE id = ?").bind(admin.id).run()
      const token = await signSession(admin.id)

      const res = await fetchPostForm(`/admin/users/${admin.id}/edit`, {
        role: 'flyer',
      }, {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      expect(res.status).toBe(400)
      const text = await res.text()
      expect(text).toMatch(/cannot demote.*last active administrator/i)

      // Verify admin role remains intact in D1
      const userRow = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(admin.id).first<{ role: string }>()
      expect(userRow?.role).toBe('admin')
    })

    it('6.2: allows demoting an administrator when multiple active administrators exist', async () => {
      const admin1 = await seedTestUser({ displayName: 'Admin One' })
      const admin2 = await seedTestUser({ displayName: 'Admin Two' })
      await env.DB.prepare("UPDATE users SET role = 'admin', is_active = 1 WHERE id IN (?, ?)").bind(admin1.id, admin2.id).run()
      const token1 = await signSession(admin1.id)

      // Admin 1 demotes Admin 2
      const res = await fetchPostForm(`/admin/users/${admin2.id}/edit`, {
        role: 'flyer',
      }, {
        Cookie: `triplet_session=${token1}`,
      }, { redirect: 'manual' })

      expect([200, 302, 303]).toContain(res.status)

      // Verify Admin 2 was demoted to flyer
      const user2Row = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(admin2.id).first<{ role: string }>()
      expect(user2Row?.role).toBe('flyer')
    })

    it('6.3: rejects demoting the only ACTIVE admin when a second DEACTIVATED admin exists', async () => {
      const activeAdmin = await seedTestUser({ displayName: 'Active Admin' })
      const inactiveAdmin = await seedTestUser({ displayName: 'Inactive Admin' })
      await env.DB.prepare("UPDATE users SET role = 'admin', is_active = 1 WHERE id = ?").bind(activeAdmin.id).run()
      await env.DB.prepare("UPDATE users SET role = 'admin', is_active = 0 WHERE id = ?").bind(inactiveAdmin.id).run()
      const token = await signSession(activeAdmin.id)

      const res = await fetchPostForm(`/admin/users/${activeAdmin.id}/edit`, {
        role: 'flyer',
      }, {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      expect(res.status).toBe(400)
      const text = await res.text()
      expect(text).toMatch(/cannot demote.*last active administrator/i)
    })

    it('6.4: sanitizes protocol-relative open redirect URLs (//evil.com) on login', async () => {
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

    it('6.5: sanitizes multi-slash open redirect URLs (///evil.com) on login', async () => {
      const user = await seedTestUser()
      const res = await fetchPostForm('/login', {
        email: user.email,
        password: 'TestPassword123!',
        redirect: '///evil.com/phishing',
      }, {}, { redirect: 'manual' })

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') ?? ''
      expect(location.startsWith('//')).toBe(false)
      expect(location).toBe('/')
    })

    it('6.6: allows safe local redirect paths (e.g. /rockets)', async () => {
      const user = await seedTestUser()
      const res = await fetchPostForm('/login', {
        email: user.email,
        password: 'TestPassword123!',
        redirect: '/rockets',
      }, {}, { redirect: 'manual' })

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('location') ?? ''
      expect(location).toBe('/rockets')
    })
  })
})

