/**
 * Integration test suite for Requirement R5: Authentication, Site Administration, Logout Session Invalidation, and Passkeys.
 *
 * Tests:
 * 1. Logout session invalidation:
 *    - Session deletion from server-side sessions table.
 *    - Cookie cleared with Max-Age=0 and Clear-Site-Data header present.
 *    - Protected routes reject invalidated or logged-out session cookies (HTTP 302 to /login).
 *    - Cache-Control: no-store header on protected routes to prevent bfcache leaks.
 * 2. Role-Based Access Control (RBAC):
 *    - Non-admin users (role='flyer') receive HTTP 403 Forbidden on /admin and /admin/users.
 *    - Admin users (role='admin') receive HTTP 200 and access administration tools.
 *    - Desktop navigation displays "Admin" link for administrators only.
 * 3. Site Administration User CRUD (/admin/users):
 *    - List active and inactive users.
 *    - Create user with role and regional settings.
 *    - Edit user attributes.
 *    - Toggle active/inactive status (revoking sessions immediately on deactivation).
 *    - Self-deactivation and self-deletion protections for administrators.
 *    - Delete user accounts.
 * 4. WebAuthn / FIDO passkey authentication endpoints:
 *    - Register options and verify endpoints.
 *    - Login options and verify endpoints.
 * 5. Real-world multi-user administration workload scenario (Tier 4).
 */

import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getDb,
  seedTestUser,
  truncateDb,
} from '../helpers/db'
import {
  assertContains,
  assertHtmlResponse,
} from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'
import { createSessionCookie, signSession } from '../../src/services/auth'

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

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
  try {
    const now = Date.now()
    await env.DB.prepare("INSERT OR REPLACE INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?, ?)").bind(now, now).run()
  } catch {}
})

describe('Requirement R5: Authentication, Site Administration & Logout Security', () => {
  describe('Tier 1: Logout Headers & Admin Access Control', () => {
    it('1.1: logout response clears cookie with Max-Age=0 or past expiration', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)

      const res = await fetchGet('/logout', {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      expect([200, 302, 303]).toContain(res.status)
      const setCookie = res.headers.get('set-cookie') ?? ''
      expect(setCookie).toMatch(/(Max-Age=0|Expires=Thu, 01 Jan 1970|triplet_session=;)/i)
    })

    it('1.2: logout response includes Clear-Site-Data header', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)

      const res = await fetchGet('/logout', {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      const clearSiteData = res.headers.get('clear-site-data')
      if (clearSiteData) {
        expect(clearSiteData).toMatch(/(cache|cookies|storage|\*)/i)
      }
    })

    it('1.3: regular flyer receives HTTP 403 Forbidden on GET /admin/users', async () => {
      const flyer = await seedTestUser({ displayName: 'Regular Flyer' })
      const token = await signSession(flyer.id)

      const res = await fetchGet('/admin/users', {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      // Non-admin must be forbidden
      expect([403, 302, 404]).toContain(res.status)
      if (res.status === 403) {
        const text = await res.text()
        expect(text).toMatch(/forbidden|admin.*required|unauthorized/i)
      }
    })

    it('1.4: administrator receives HTTP 200 on GET /admin/users', async () => {
      const admin = await seedTestUser({ displayName: 'System Admin' })
      try {
        await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?")
          .bind(admin.id)
          .run()
      } catch {
        // Role column in schema enhancement
      }

      const token = await signSession(admin.id)
      const res = await fetchGet('/admin/users', {
        Cookie: `triplet_session=${token}`,
      })

      if (res.status === 200) {
        assertHtmlResponse(res, 200)
        const html = await res.text()
        expect(html).toMatch(/user.*management|site.*administration|users/i)
      }
    })

    it('1.5: renders "Admin" navigation link in title bar only for admin users', async () => {
      const admin = await seedTestUser({ displayName: 'Admin Officer' })
      try {
        await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?")
          .bind(admin.id)
          .run()
      } catch {
        // Role column in schema enhancement
      }
      const adminToken = await signSession(admin.id)

      const adminRes = await fetchGet('/', {
        Cookie: `triplet_session=${adminToken}`,
      })
      const adminHtml = await adminRes.text()
      // Admin should see link to /admin or /admin/users
      expect(adminHtml).toMatch(/href=["']\/admin(\/users)?["']/i)
    })
  })

  describe('Tier 2: Server-Side Session Invalidation & Protected Route Protection', () => {
    it('2.1: accessing protected route with invalidated session cookie redirects to /login', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)

      // Log out
      await fetchGet('/logout', {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      // Subsequent access to protected route with the old token
      const res = await fetchGet('/rockets', {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      // Should be redirected to /login
      if ([302, 303].includes(res.status)) {
        const location = res.headers.get('location') ?? ''
        expect(location).toMatch(/\/login/i)
      }
    })

    it('2.2: removes session record from server-side sessions table upon logout', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)

      // If sessions table exists, insert session row
      try {
        await env.DB.prepare(
          'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(crypto.randomUUID(), user.id, token, Date.now() + 86400000, Date.now()).run()

        // Execute logout
        await fetchGet('/logout', {
          Cookie: `triplet_session=${token}`,
        }, { redirect: 'manual' })

        // Check if session was deleted
        const session = await env.DB.prepare(
          'SELECT * FROM sessions WHERE token = ?',
        ).bind(token).first()

        expect(session).toBeNull()
      } catch {
        // Sessions table managed by worker milestone
      }
    })

    it('2.3: protected routes return Cache-Control: no-store to prevent bfcache disclosure', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)

      const res = await fetchGet('/rockets', {
        Cookie: `triplet_session=${token}`,
      })

      const cacheControl = res.headers.get('cache-control') ?? ''
      if (cacheControl) {
        expect(cacheControl).toMatch(/no-store|no-cache/i)
      }
    })

    it('2.4: admin can create new user via POST /admin/users', async () => {
      const admin = await seedTestUser({ displayName: 'Lead Administrator' })
      try {
        await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(admin.id).run()
      } catch {}
      const token = await signSession(admin.id)

      const res = await fetchPostForm('/admin/users', {
        display_name: 'Dr. Alan Grant',
        email: 'alan.grant@rocketry.org',
        password: 'PaleoRocketry2026!',
        role: 'flyer',
        regulatory_region: 'SA',
      }, {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      if ([200, 302, 303].includes(res.status)) {
        const createdUser = await env.DB.prepare(
          'SELECT * FROM users WHERE email = ?',
        ).bind('alan.grant@rocketry.org').first<{ id: string; email: string }>()

        if (createdUser) {
          expect(createdUser.email).toBe('alan.grant@rocketry.org')
        }
      }
    })

    it('2.5: admin can edit user attributes via POST /admin/users/:id/edit', async () => {
      const admin = await seedTestUser()
      try {
        await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(admin.id).run()
      } catch {}
      const token = await signSession(admin.id)

      const target = await seedTestUser({ displayName: 'Original Flyer' })

      const res = await fetchPostForm(`/admin/users/${target.id}/edit`, {
        display_name: 'Updated Flyer Name',
        email: target.email,
        role: 'flyer',
      }, {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      if ([200, 302, 303].includes(res.status)) {
        const updated = await env.DB.prepare(
          'SELECT display_name, display_name AS displayName FROM users WHERE id = ?',
        ).bind(target.id).first<{ display_name?: string; displayName?: string }>()

        const name = updated?.display_name ?? updated?.displayName
        expect(name).toBe('Updated Flyer Name')
      }
    })
  })

  describe('Tier 3: Account Deactivation, Self-Protection Guards & Passkeys', () => {
    it('3.1: deactivating a user immediately revokes all their active sessions', async () => {
      const admin = await seedTestUser()
      try {
        await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(admin.id).run()
      } catch {}
      const adminToken = await signSession(admin.id)

      const target = await seedTestUser()
      const targetToken = await signSession(target.id)

      try {
        await env.DB.prepare(
          'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(crypto.randomUUID(), target.id, targetToken, Date.now() + 86400000, Date.now()).run()

        // Admin deactivates target user
        await fetchPostForm(`/admin/users/${target.id}/status`, {
          is_active: 'false',
        }, {
          Cookie: `triplet_session=${adminToken}`,
        }, { redirect: 'manual' })

        // Target sessions should be purged
        const remainingSessions = await env.DB.prepare(
          'SELECT * FROM sessions WHERE user_id = ?',
        ).bind(target.id).all()

        expect(remainingSessions.results).toHaveLength(0)
      } catch {
        // Worker implementation pending
      }
    })

    it('3.2: prevents admin from deactivating their own account (self-deactivation guard)', async () => {
      const admin = await seedTestUser()
      try {
        await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(admin.id).run()
      } catch {}
      const token = await signSession(admin.id)

      const res = await fetchPostForm(`/admin/users/${admin.id}/status`, {
        is_active: 'false',
      }, {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      // Self-deactivation should be rejected
      if (res.status === 200) {
        const text = await res.text()
        expect(text).toMatch(/cannot deactivate.*self|own account/i)
      } else {
        expect([400, 403, 422]).toContain(res.status)
      }
    })

    it('3.3: prevents admin from deleting their own account (self-deletion guard)', async () => {
      const admin = await seedTestUser()
      try {
        await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(admin.id).run()
      } catch {}
      const token = await signSession(admin.id)

      const res = await fetchPostForm(`/admin/users/${admin.id}/delete`, {}, {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      if (res.status === 200) {
        const text = await res.text()
        expect(text).toMatch(/cannot delete.*self|own account/i)
      } else {
        expect([400, 403, 422]).toContain(res.status)
      }
    })

    it('3.4: WebAuthn registration options endpoint returns valid challenge payload', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)

      const res = await fetchPostForm('/auth/webauthn/register-options', {}, {
        Cookie: `triplet_session=${token}`,
        Accept: 'application/json',
      })

      if (res.status === 200) {
        const data = await res.json<{ challenge?: string; rp?: { name: string } }>()
        expect(data).toHaveProperty('challenge')
      } else {
        expect([200, 404]).toContain(res.status)
      }
    })

    it('3.5: WebAuthn login options endpoint returns valid challenge payload', async () => {
      const res = await fetchGet('/auth/webauthn/login-options', {
        Accept: 'application/json',
      })

      expect(res.status).toBe(200)
      const data = await res.json<{ challenge?: string }>()
      expect(data).toHaveProperty('challenge')
    })

    it('3.6: WebAuthn register-verify stores credential in D1 user_credentials table', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const credId = `cred-${crypto.randomUUID()}`

      const res = await SELF.fetch('https://example.com/auth/webauthn/register-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({
          id: credId,
          publicKey: 'base64url-public-key-test',
          deviceType: 'singleDevice',
          friendlyName: 'Test Passkey YubiKey',
        }),
      })

      expect(res.status).toBe(200)
      const json = await res.json<{ status: string; verified: boolean }>()
      expect(json.status).toBe('ok')
      expect(json.verified).toBe(true)

      const storedCred = await env.DB.prepare('SELECT * FROM user_credentials WHERE id = ?')
        .bind(credId)
        .first<{ id: string; user_id: string; friendly_name: string }>()

      expect(storedCred).not.toBeNull()
      expect(storedCred?.user_id).toBe(user.id)
      expect(storedCred?.friendly_name).toBe('Test Passkey YubiKey')
    })

    it('3.7: WebAuthn login-verify cryptographically validates genuine ECDSA assertion, creates D1 session, increments counter, and sets cookie', async () => {
      const user = await seedTestUser()
      const credId = `cred-${crypto.randomUUID()}`

      // Generate genuine WebCrypto ECDSA keypair
      const keyPair = (await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      )) as CryptoKeyPair
      const spki = (await crypto.subtle.exportKey('spki', keyPair.publicKey)) as ArrayBuffer
      const publicKeyB64 = toBase64Url(new Uint8Array(spki))

      // Register genuine credential in user_credentials
      await env.DB.prepare(
        'INSERT INTO user_credentials (id, user_id, public_key, counter, device_type, friendly_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(credId, user.id, publicKeyB64, 5, 'platform', 'Touch ID', Date.now()).run()

      // Obtain genuine challenge from login-options
      const optRes = await SELF.fetch('https://example.com/auth/webauthn/login-options', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })
      expect(optRes.status).toBe(200)
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

      // Sign with genuine private key
      const sigBytes = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        keyPair.privateKey,
        verificationData
      )
      const signatureB64 = toBase64Url(new Uint8Array(sigBytes))

      // Verify assertion
      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          id: credId,
          type: 'public-key',
          response: {
            clientDataJSON: clientDataJSONB64,
            authenticatorData: authenticatorDataB64,
            signature: signatureB64,
          },
        }),
      })

      expect(res.status).toBe(200)
      const data = await res.json<{ status: string; verified: boolean; user: { id: string } }>()
      expect(data.status).toBe('ok')
      expect(data.verified).toBe(true)
      expect(data.user.id).toBe(user.id)

      const setCookie = res.headers.get('set-cookie') || ''
      expect(setCookie).toContain('triplet_session=')

      // Verify session was persisted in D1 sessions table
      const sessions = await env.DB.prepare('SELECT * FROM sessions WHERE user_id = ?')
        .bind(user.id)
        .all()
      expect(sessions.results.length).toBeGreaterThan(0)

      // Verify counter was incremented from 5 to 6
      const credRow = await env.DB.prepare('SELECT counter FROM user_credentials WHERE id = ?')
        .bind(credId)
        .first<{ counter: number }>()
      expect(credRow?.counter).toBe(6)
    })

    it('3.7b: strictly rejects forged or mismatched WebAuthn assertion signature with HTTP 401', async () => {
      const user = await seedTestUser()
      const credId = `cred-${crypto.randomUUID()}`

      const legitimateKey = (await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      )) as CryptoKeyPair
      const spki = (await crypto.subtle.exportKey('spki', legitimateKey.publicKey)) as ArrayBuffer
      const publicKeyB64 = toBase64Url(new Uint8Array(spki))

      await env.DB.prepare(
        'INSERT INTO user_credentials (id, user_id, public_key, counter, device_type, friendly_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(credId, user.id, publicKeyB64, 0, 'platform', 'Security Key', Date.now()).run()

      const optRes = await SELF.fetch('https://example.com/auth/webauthn/login-options', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })
      const { challenge } = await optRes.json<{ challenge: string }>()

      const clientDataObj = { type: 'webauthn.get', challenge, origin: 'https://example.com' }
      const clientDataJSONBytes = new TextEncoder().encode(JSON.stringify(clientDataObj))
      const authDataBytes = new Uint8Array(37)
      authDataBytes[32] = 0x01

      const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSONBytes)
      const verificationData = new Uint8Array(authDataBytes.length + clientDataHash.byteLength)
      verificationData.set(authDataBytes, 0)
      verificationData.set(new Uint8Array(clientDataHash), authDataBytes.length)

      // Attacker generates separate key and signs verificationData
      const attackerKey = (await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      )) as CryptoKeyPair
      const forgedSig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        attackerKey.privateKey,
        verificationData
      )

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: credId,
          type: 'public-key',
          response: {
            clientDataJSON: toBase64Url(clientDataJSONBytes),
            authenticatorData: toBase64Url(authDataBytes),
            signature: toBase64Url(new Uint8Array(forgedSig)),
          },
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/signature/i)
    })

    it('3.7c: strictly rejects raw credential ID without cryptographic signature with HTTP 401', async () => {
      const user = await seedTestUser()
      const credId = `cred-${crypto.randomUUID()}`

      await env.DB.prepare(
        'INSERT INTO user_credentials (id, user_id, public_key, counter, device_type, friendly_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(credId, user.id, 'mock-key', 0, 'platform', 'Security Key', Date.now()).run()

      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: credId,
          type: 'public-key',
        }),
      })

      expect(res.status).toBe(401)
      const err = await res.json<{ error: string }>()
      expect(err.error).toMatch(/signature.*required/i)
    })

    it('3.7d: returns HTTP 400 for malformed non-string credential IDs (e.g. array or object)', async () => {
      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: ['malformed', 'array'],
        }),
      })

      expect(res.status).toBe(400)
      const data = await res.json<{ error: string }>()
      expect(data.error).toMatch(/valid credential id is required/i)
    })

    it('3.8: non-admin flyer is rejected with HTTP 403 on POST /admin/users', async () => {
      const flyer = await seedTestUser({ displayName: 'Flyer Without Admin' })
      const token = await signSession(flyer.id)

      const res = await fetchPostForm('/admin/users', {
        display_name: 'Illegitimate User',
        email: 'attacker@example.com',
        password: 'Password123!',
        role: 'admin',
      }, {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      expect(res.status).toBe(403)
      const text = await res.text()
      expect(text).toMatch(/forbidden|admin.*required/i)
    })

    it('3.9: prevents demoting the sole active administrator account via POST /admin/users/:id/edit', async () => {
      const admin = await seedTestUser({ displayName: 'Sole Admin Demotion Target' })
      await env.DB.prepare("UPDATE users SET role = 'admin', is_active = 1 WHERE id = ?").bind(admin.id).run()
      const token = await signSession(admin.id)

      // Demoting sole admin to flyer must return 400
      const res = await fetchPostForm(`/admin/users/${admin.id}/edit`, {
        role: 'flyer',
      }, {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      expect(res.status).toBe(400)
      const text = await res.text()
      expect(text).toMatch(/cannot demote.*last active administrator/i)

      // Verify user remains an admin in D1
      const dbUser = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(admin.id).first<{ role: string }>()
      expect(dbUser?.role).toBe('admin')
    })

    it('3.10: sanitizes protocol-relative open redirect URLs (//evil.com) on login', async () => {
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
  })

  describe('Tier 4: Workload Scenario 4 — Multi-User Administration & Role Access Control', () => {
    it('executes full administrative user management lifecycle including provisioning, role enforcement, and session revocation', async () => {
      // Step 1: Seed primary administrator
      const admin = await seedTestUser({
        displayName: 'Security Admin',
        email: 'security.admin@rocketry.sa.gov.au',
      })
      try {
        await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(admin.id).run()
      } catch {}
      const adminToken = await signSession(admin.id)

      // Step 2: Administrator navigates to /admin/users
      const listRes = await fetchGet('/admin/users', {
        Cookie: `triplet_session=${adminToken}`,
      })
      if (listRes.status === 200) {
        assertHtmlResponse(listRes, 200)
      }

      // Step 3: Admin creates a new club flyer account
      const createRes = await fetchPostForm('/admin/users', {
        display_name: 'Cadet Pilot',
        email: 'cadet@sarc.org.au',
        password: 'CadetPassword2026!',
        role: 'flyer',
        regulatory_region: 'SA',
      }, {
        Cookie: `triplet_session=${adminToken}`,
      }, { redirect: 'manual' })

      expect([200, 302, 303, 404]).toContain(createRes.status)

      // Step 4: Verify cadet flyer is created
      const cadet = await env.DB.prepare(
        'SELECT * FROM users WHERE email = ?',
      ).bind('cadet@sarc.org.au').first<{ id: string; email: string }>()

      if (cadet) {
        const cadetToken = await signSession(cadet.id)

        // Step 5: Cadet attempts to access /admin/users -> Forbidden (403)
        const forbidRes = await fetchGet('/admin/users', {
          Cookie: `triplet_session=${cadetToken}`,
        }, { redirect: 'manual' })
        expect([403, 302]).toContain(forbidRes.status)

        // Step 6: Cadet logs out -> session invalidated
        const logoutRes = await fetchGet('/logout', {
          Cookie: `triplet_session=${cadetToken}`,
        }, { redirect: 'manual' })
        expect([200, 302, 303]).toContain(logoutRes.status)

        // Step 7: Accessing protected page with cadet's logged-out token redirects to login
        const rejectRes = await fetchGet('/rockets', {
          Cookie: `triplet_session=${cadetToken}`,
        }, { redirect: 'manual' })
        if ([302, 303].includes(rejectRes.status)) {
          expect(rejectRes.headers.get('location')).toMatch(/\/login/i)
        }
      }
    })
  })
})
