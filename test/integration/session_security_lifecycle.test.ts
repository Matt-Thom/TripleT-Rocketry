/**
 * Test suite for Session Security Lifecycle, Server-Side Invalidation on Sign-Out,
 * and Session Expiration Enforcement (Requirements R1, R2, R3).
 */

import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, seedTestUser, truncateDb } from '../helpers/db'
import { fetchGet, fetchPostForm } from '../helpers/http'
import {
  hashPassword,
  signSession,
  SESSION_MAX_AGE_SECONDS,
} from '../../src/services/auth'

beforeEach(async () => {
  await truncateDb()
  // Ensure site setup is marked as completed
  const now = Date.now()
  await env.DB.prepare(
    "INSERT OR REPLACE INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?, ?)",
  )
    .bind(now, now)
    .run()
})

describe('Session Security Lifecycle & Invalidation (R1, R2, R3)', () => {
  describe('R1: Server-Side Session Invalidation on Sign-Out', () => {
    it('calling GET /logout revokes the session server-side, deletes it from D1, and clears session cookies', async () => {
      const user = await seedTestUser({ displayName: 'Signout Pilot 1' })
      const token = await signSession(user.id)
      const now = Date.now()

      // Seed session in D1
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, now + 86400000, now).run()

      // Verify session exists in D1
      const before = await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first()
      expect(before).not.toBeNull()

      // Call GET /logout
      const res = await fetchGet('/logout', {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      expect([200, 302, 303]).toContain(res.status)
      const setCookie = res.headers.get('set-cookie') || ''
      expect(setCookie).toMatch(/(Max-Age=0|Expires=Thu, 01 Jan 1970|triplet_session=;)/i)

      // Verify session row was deleted from D1
      const after = await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first()
      expect(after).toBeNull()

      // Verify revocation was recorded in site_settings
      const revoked = await env.DB.prepare('SELECT * FROM site_settings WHERE key = ?')
        .bind(`revoked_session:${token}`)
        .first()
      expect(revoked).not.toBeNull()
    })

    it('calling POST /logout revokes the session server-side and clears session cookies', async () => {
      const user = await seedTestUser({ displayName: 'Signout Pilot 2' })
      const token = await signSession(user.id)
      const now = Date.now()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, now + 86400000, now).run()

      const res = await fetchPostForm('/logout', {}, {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      expect([200, 302, 303]).toContain(res.status)
      const setCookie = res.headers.get('set-cookie') || ''
      expect(setCookie).toMatch(/(Max-Age=0|Expires=Thu, 01 Jan 1970|triplet_session=;)/i)

      const after = await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first()
      expect(after).toBeNull()
    })

    it('calling /signout and /sign-out alias endpoints invalidates the session server-side', async () => {
      const user1 = await seedTestUser({ displayName: 'Signout Pilot 3' })
      const token1 = await signSession(user1.id)
      const now = Date.now()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user1.id, token1, now + 86400000, now).run()

      // GET /signout
      const res1 = await fetchGet('/signout', {
        Cookie: `triplet_session=${token1}`,
      }, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res1.status)
      expect(await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token1).first()).toBeNull()

      const user2 = await seedTestUser({ displayName: 'Signout Pilot 4' })
      const token2 = await signSession(user2.id)
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user2.id, token2, now + 86400000, now).run()

      // POST /sign-out
      const res2 = await fetchPostForm('/sign-out', {}, {
        Cookie: `triplet_session=${token2}`,
      }, { redirect: 'manual' })
      expect([200, 302, 303]).toContain(res2.status)
      expect(await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token2).first()).toBeNull()
    })

    it('calling sign-out with Authorization: Bearer <token> revokes and deletes session server-side', async () => {
      const user = await seedTestUser({ displayName: 'Bearer Signout Pilot' })
      const token = await signSession(user.id)
      const now = Date.now()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, now + 86400000, now).run()

      const res = await fetchGet('/logout', {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      }, { redirect: 'manual' })

      expect(res.status).toBe(200)
      const data = await res.json<{ status: string }>()
      expect(data.status).toBe('ok')

      // D1 session must be deleted
      const after = await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first()
      expect(after).toBeNull()

      // Revocation must be recorded
      const revoked = await env.DB.prepare('SELECT * FROM site_settings WHERE key = ?')
        .bind(`revoked_session:${token}`)
        .first()
      expect(revoked).not.toBeNull()
    })

    it('rejects subsequent requests using signed-out session cookie on protected routes (redirects HTML to /login, 401 for API)', async () => {
      const user = await seedTestUser({ displayName: 'Revoked Cookie Flyer' })
      const token = await signSession(user.id)
      const now = Date.now()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, now + 86400000, now).run()

      // Logout
      await fetchGet('/logout', { Cookie: `triplet_session=${token}` }, { redirect: 'manual' })

      // Subsequent HTML request
      const htmlRes = await fetchGet('/rockets', {
        Cookie: `triplet_session=${token}`,
        Accept: 'text/html',
      }, { redirect: 'manual' })

      expect(htmlRes.status).toBe(302)
      expect(htmlRes.headers.get('location')).toMatch(/\/login\?redirect=%2Frockets/i)
      // Cookie clearing in response
      const setCookie = htmlRes.headers.get('set-cookie') || ''
      expect(setCookie).toMatch(/(Max-Age=0|Expires=Thu, 01 Jan 1970|triplet_session=;)/i)

      // Subsequent JSON request
      const jsonRes = await fetchGet('/rockets', {
        Cookie: `triplet_session=${token}`,
        Accept: 'application/json',
      })

      expect(jsonRes.status).toBe(401)
      const jsonBody = await jsonRes.json<{ error: string }>()
      expect(jsonBody.error).toBe('Unauthorized')
    })

    it('rejects subsequent requests using signed-out Bearer token on protected routes with HTTP 401', async () => {
      const user = await seedTestUser({ displayName: 'Revoked Bearer Flyer' })
      const token = await signSession(user.id)
      const now = Date.now()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, now + 86400000, now).run()

      // Logout
      await fetchGet('/logout', {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      })

      // Subsequent request with Bearer token
      const res = await fetchGet('/rockets', {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      })

      expect(res.status).toBe(401)
      const body = await res.json<{ error: string }>()
      expect(body.error).toBe('Unauthorized')
    })
  })

  describe('R2: Session Expiration & Lifecycle Enforcement', () => {
    it('rejects requests using an expired session in D1 (expiresAt <= now) and purges the expired record', async () => {
      const user = await seedTestUser({ displayName: 'Expired Pilot 1' })
      const token = await signSession(user.id)
      const now = Date.now()
      const pastExpiresAt = now - 5000 // Expired 5 seconds ago

      // Seed expired session in D1
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, pastExpiresAt, now - 10000).run()

      // Request with expired cookie (HTML)
      const htmlRes = await fetchGet('/inventory', {
        Cookie: `triplet_session=${token}`,
        Accept: 'text/html',
      }, { redirect: 'manual' })

      expect(htmlRes.status).toBe(302)
      expect(htmlRes.headers.get('location')).toMatch(/\/login\?redirect=%2Finventory/i)
      const setCookie = htmlRes.headers.get('set-cookie') || ''
      expect(setCookie).toMatch(/(Max-Age=0|Expires=Thu, 01 Jan 1970|triplet_session=;)/i)

      // D1 check: expired session row should be purged
      const inDb = await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first()
      expect(inDb).toBeNull()

      // Revocation should be recorded
      const revoked = await env.DB.prepare('SELECT * FROM site_settings WHERE key = ?')
        .bind(`revoked_session:${token}`)
        .first()
      expect(revoked).not.toBeNull()

      // Request with expired cookie (JSON)
      const jsonRes = await fetchGet('/inventory', {
        Cookie: `triplet_session=${token}`,
        Accept: 'application/json',
      })
      expect(jsonRes.status).toBe(401)
    })

    it('rejects requests using an expired Bearer token in D1 with HTTP 401', async () => {
      const user = await seedTestUser({ displayName: 'Expired Bearer Pilot' })
      const token = await signSession(user.id)
      const now = Date.now()

      // Seed expired session in D1
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, now - 1000, now - 5000).run()

      const res = await fetchGet('/flights', {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      })

      expect(res.status).toBe(401)
      const body = await res.json<{ error: string }>()
      expect(body.error).toBe('Unauthorized')

      // Expired session row should be purged from D1
      const inDb = await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first()
      expect(inDb).toBeNull()
    })

    it('rejects session token with expired cryptographic timestamp (> 30 days old)', async () => {
      const user = await seedTestUser({ displayName: 'Ancient Token Pilot' })
      // Forge/sign token with timestamp 35 days in the past
      const oldTimestamp = Date.now() - (SESSION_MAX_AGE_SECONDS + 5 * 86400) * 1000
      const secret = 'triplet-rocketry-auth-secret-key-2026'

      const enc = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const payload = `${user.id}:${oldTimestamp}`
      const signature = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
      const sigHex = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const expiredToken = `${payload}:${sigHex}`

      // Attempt access with expired token
      const res = await fetchGet('/rockets', {
        Cookie: `triplet_session=${expiredToken}`,
        Accept: 'application/json',
      })

      expect(res.status).toBe(401)
    })
  })

  describe('R3: Legitimate Active Sessions Remain Fully Functional', () => {
    it('allows legitimate active sessions with valid future expiration to access protected endpoints', async () => {
      const user = await seedTestUser({ displayName: 'Active Pilot' })
      const token = await signSession(user.id)
      const now = Date.now()

      // Seed valid active session in D1 (30 days in future)
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, now + 30 * 24 * 60 * 60 * 1000, now).run()

      // Cookie access to /rockets
      const rocketsRes = await fetchGet('/rockets', {
        Cookie: `triplet_session=${token}`,
        Accept: 'text/html',
      })
      expect(rocketsRes.status).toBe(200)
      const rocketsHtml = await rocketsRes.text()
      expect(rocketsHtml).toContain('Rockets')

      // Cookie access to /flights
      const flightsRes = await fetchGet('/flights', {
        Cookie: `triplet_session=${token}`,
        Accept: 'text/html',
      })
      expect(flightsRes.status).toBe(200)

      // Cookie access to /inventory
      const invRes = await fetchGet('/inventory', {
        Cookie: `triplet_session=${token}`,
        Accept: 'text/html',
      })
      expect(invRes.status).toBe(200)

      // Bearer token access to JSON API
      const bearerRes = await fetchGet('/rockets', {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      })
      expect(bearerRes.status).toBe(200)
    })

    it('standard login flow sets valid session cookie with future expiration and allows immediate protected access', async () => {
      const password = 'ValidPassword2026!'
      const passwordHash = await hashPassword(password)
      const user = await seedTestUser({
        email: 'login.pilot@rocketry.org.au',
        displayName: 'Login Verified Aviator',
        passwordHash,
      })

      // POST /login
      const loginRes = await fetchPostForm('/login', {
        email: 'login.pilot@rocketry.org.au',
        password,
      }, {}, { redirect: 'manual' })

      expect(loginRes.status).toBe(302)
      const cookieHeader = loginRes.headers.get('set-cookie') || ''
      expect(cookieHeader).toContain('triplet_session=')
      const match = cookieHeader.match(/triplet_session=([^;]+)/)
      expect(match).not.toBeNull()
      const token = decodeURIComponent(match![1])

      // D1 session check: expiresAt is in future (~30 days)
      const session = await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first<{ expires_at: number }>()
      expect(session).not.toBeNull()
      expect(session!.expires_at).toBeGreaterThan(Date.now() + 25 * 24 * 60 * 60 * 1000)

      // Immediate access to protected route
      const accessRes = await fetchGet('/rockets', {
        Cookie: `triplet_session=${token}`,
      })
      expect(accessRes.status).toBe(200)
      expect(await accessRes.text()).toContain('Rockets')
    })

    it('allows valid Authorization: Bearer token even when client sends triplet_logged_out=1 cookie', async () => {
      const user = await seedTestUser({ displayName: 'Bearer with Logged Out Marker Flyer' })
      const token = await signSession(user.id)
      const now = Date.now()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, now + 86400000, now).run()

      const res = await fetchGet('/rockets', {
        Authorization: `Bearer ${token}`,
        Cookie: 'triplet_logged_out=1',
        Accept: 'application/json',
      })

      expect(res.status).toBe(200)
    })

    it('allows valid Authorization: Bearer token even when client sends stale/invalid triplet_session cookie', async () => {
      const user = await seedTestUser({ displayName: 'Bearer with Stale Cookie Flyer' })
      const token = await signSession(user.id)
      const now = Date.now()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, now + 86400000, now).run()

      const res = await fetchGet('/rockets', {
        Authorization: `Bearer ${token}`,
        Cookie: 'triplet_session=stale_invalid_session_cookie',
        Accept: 'application/json',
      })

      expect(res.status).toBe(200)
    })
  })

  describe('Adversarial & Edge Cases (Sign-Out & Session Lifecycle)', () => {
    it('calling sign-out with BOTH Bearer token and session cookie revokes BOTH sessions server-side', async () => {
      const user1 = await seedTestUser({ displayName: 'Multi-Auth Pilot 1' })
      const tokenCookie = await signSession(user1.id)
      const user2 = await seedTestUser({ displayName: 'Multi-Auth Pilot 2' })
      const tokenBearer = await signSession(user2.id)
      const now = Date.now()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user1.id, tokenCookie, now + 86400000, now).run()
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user2.id, tokenBearer, now + 86400000, now).run()

      // Call logout with both
      const res = await fetchGet('/logout', {
        Cookie: `triplet_session=${tokenCookie}`,
        Authorization: `Bearer ${tokenBearer}`,
        Accept: 'application/json',
      })
      expect(res.status).toBe(200)

      // BOTH must be deleted from D1
      expect(await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(tokenCookie).first()).toBeNull()
      expect(await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(tokenBearer).first()).toBeNull()

      // BOTH must be recorded in site_settings
      expect(await env.DB.prepare('SELECT * FROM site_settings WHERE key = ?').bind(`revoked_session:${tokenCookie}`).first()).not.toBeNull()
      expect(await env.DB.prepare('SELECT * FROM site_settings WHERE key = ?').bind(`revoked_session:${tokenBearer}`).first()).not.toBeNull()
    })

    it('calling sign-out with JSON body, form body, or query parameter revokes session server-side', async () => {
      const user = await seedTestUser({ displayName: 'Body Signout Pilot' })
      const now = Date.now()
      const token1 = await signSession(user.id, undefined, now - 2000)
      const token2 = await signSession(user.id, undefined, now - 1000)
      const token3 = await signSession(user.id, undefined, now)

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token1, now + 86400000, now - 2000).run()
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token2, now + 86400000, now - 1000).run()
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token3, now + 86400000, now).run()

      // Logout via query param
      const resQuery = await fetchGet(`/logout?token=${encodeURIComponent(token1)}`, {
        Accept: 'application/json',
      })
      expect(resQuery.status).toBe(200)
      expect(await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token1).first()).toBeNull()

      // Logout via URL-encoded form body
      const resForm = await fetchPostForm('/logout', { token: token2 }, {
        Accept: 'application/json',
      })
      expect(resForm.status).toBe(200)
      expect(await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token2).first()).toBeNull()

      // Logout via JSON body
      const resJson = await SELF.fetch('https://example.com/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ token: token3 }),
      })
      expect(resJson.status).toBe(200)
      expect(await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token3).first()).toBeNull()
    })

    it('JSON sign-out response includes triplet_logged_out marker and clears webauthn_challenge', async () => {
      const user = await seedTestUser({ displayName: 'JSON Logout Headers Pilot' })
      const token = await signSession(user.id)
      const now = Date.now()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, now + 86400000, now).run()

      const res = await fetchGet('/logout', {
        Cookie: `triplet_session=${token}`,
        Accept: 'application/json',
      })
      expect(res.status).toBe(200)

      const cookies = (res.headers as any).getSetCookie ? (res.headers as any).getSetCookie() : [res.headers.get('set-cookie') || '']
      const joinedCookies = cookies.join('; ')
      expect(joinedCookies).toContain('triplet_session=')
      expect(joinedCookies).toContain('triplet_logged_out=1')
      expect(joinedCookies).toContain('webauthn_challenge=')
    })

    it('rejects session token with timestamp in the future (> 60s clock skew limit)', async () => {
      const user = await seedTestUser({ displayName: 'Future Token Pilot' })
      // Token timestamp 5 minutes into future
      const futureTimestamp = Date.now() + 300000
      const secret = 'triplet-rocketry-auth-secret-key-2026'

      const enc = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const payload = `${user.id}:${futureTimestamp}`
      const signature = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
      const sigHex = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const futureToken = `${payload}:${sigHex}`

      const res = await fetchGet('/rockets', {
        Cookie: `triplet_session=${futureToken}`,
        Accept: 'application/json',
      })
      expect(res.status).toBe(401)
    })

    it('handles malformed percent-encoding in cookies safely without throwing 500 error', async () => {
      const user = await seedTestUser({ displayName: 'Malformed Cookie Pilot' })
      const token = await signSession(user.id)
      const now = Date.now()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, now + 86400000, now).run()

      // Send malformed cookie alongside valid session
      const res = await fetchGet('/rockets', {
        Cookie: `bad_cookie=%ZZ; triplet_session=${token}`,
      })
      expect([200, 302]).toContain(res.status)
    })

    it('admin user deactivation purges and revokes all user sessions in site_settings', async () => {
      const admin = await seedTestUser({ displayName: 'Admin Pilot', role: 'admin' })
      const flyer = await seedTestUser({ displayName: 'Target Pilot', role: 'flyer' })
      const now = Date.now()
      const adminToken = await signSession(admin.id, undefined, now - 1000)
      const flyerToken = await signSession(flyer.id, undefined, now)

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), admin.id, adminToken, now + 86400000, now - 1000).run()
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), flyer.id, flyerToken, now + 86400000, now).run()

      // Admin deactivates flyer
      const deactivateRes = await fetchPostForm(`/admin/users/${flyer.id}/status`, {
        is_active: false,
      }, {
        Cookie: `triplet_session=${adminToken}`,
      }, { redirect: 'manual' })
      expect([200, 302]).toContain(deactivateRes.status)

      // Verify session row was deleted from D1
      expect(await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(flyerToken).first()).toBeNull()

      // Revocation marker must exist in site_settings
      expect(await env.DB.prepare('SELECT * FROM site_settings WHERE key = ?').bind(`revoked_session:${flyerToken}`).first()).not.toBeNull()

      // Subsequent access by flyer token must be rejected
      const flyerRes = await fetchGet('/rockets', {
        Cookie: `triplet_session=${flyerToken}`,
        Accept: 'application/json',
      })
      expect(flyerRes.status).toBe(401)
    })

    it('handles quoted cookie values (triplet_session="<token>") cleanly for authentication and sign-out', async () => {
      const user = await seedTestUser({ displayName: 'Quoted Cookie Pilot' })
      const token = await signSession(user.id)
      const now = Date.now()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, now + 86400000, now).run()

      // Protected route access using quoted cookie
      const res = await fetchGet('/rockets', {
        Cookie: `triplet_session="${token}"`,
        Accept: 'application/json',
      })
      expect(res.status).toBe(200)

      // Sign out using quoted cookie
      const logoutRes = await fetchGet('/logout', {
        Cookie: `triplet_session="${token}"`,
        Accept: 'application/json',
      })
      expect(logoutRes.status).toBe(200)

      // Session must be purged from D1
      expect(await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first()).toBeNull()

      // Revocation marker must exist in site_settings
      expect(await env.DB.prepare('SELECT * FROM site_settings WHERE key = ?').bind(`revoked_session:${token}`).first()).not.toBeNull()

      // Subsequent access must be rejected
      const subRes = await fetchGet('/rockets', {
        Cookie: `triplet_session=${token}`,
        Accept: 'application/json',
      })
      expect(subRes.status).toBe(401)
    })

    it('multi-device global sign-out (/logout?all=true) revokes all user sessions across devices', async () => {
      const user = await seedTestUser({ displayName: 'Global Signout Pilot' })
      const now = Date.now()
      const token1 = await signSession(user.id, undefined, now - 5000)
      const token2 = await signSession(user.id, undefined, now - 2000)

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token1, now + 86400000, now - 5000).run()
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token2, now + 86400000, now - 2000).run()

      // Device 1 calls /logout?all=true
      const logoutRes = await fetchGet('/logout?all=true', {
        Cookie: `triplet_session=${token1}`,
        Accept: 'application/json',
      })
      expect(logoutRes.status).toBe(200)

      // Both tokens must be purged from D1
      expect(await env.DB.prepare('SELECT * FROM sessions WHERE user_id = ?').bind(user.id).all()).toHaveProperty('results', [])

      // User-level revocation must be recorded
      const userRevoked = await env.DB.prepare('SELECT * FROM site_settings WHERE key = ?')
        .bind(`revoked_user:${user.id}`)
        .first()
      expect(userRevoked).not.toBeNull()

      // Device 2's token (token2) must be rejected on protected routes
      const dev2Res = await fetchGet('/rockets', {
        Cookie: `triplet_session=${token2}`,
        Accept: 'application/json',
      })
      expect(dev2Res.status).toBe(401)
    })

    it('purges corrupted or tampered session token from D1 sessions table upon presentation', async () => {
      const user = await seedTestUser({ displayName: 'Tampered Token Pilot' })
      const now = Date.now()
      const validToken = await signSession(user.id)
      // Corrupt signature
      const tamperedToken = validToken.slice(0, -5) + 'ffff0'

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, tamperedToken, now + 86400000, now).run()

      const res = await fetchGet('/rockets', {
        Cookie: `triplet_session=${tamperedToken}`,
        Accept: 'application/json',
      })
      expect(res.status).toBe(401)

      // Tampered token must be deleted from D1
      expect(await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(tamperedToken).first()).toBeNull()
    })

    it('handles rapid consecutive login attempts idempotently without 500 SQLite constraint error', async () => {
      const password = 'RapidPassword123!'
      const passwordHash = await hashPassword(password)
      const user = await seedTestUser({
        email: 'rapid.pilot@rocketry.org.au',
        displayName: 'Rapid Pilot',
        passwordHash,
      })

      // Send two consecutive rapid login requests
      const res1 = await fetchPostForm('/login', {
        email: 'rapid.pilot@rocketry.org.au',
        password,
      }, {}, { redirect: 'manual' })
      expect(res1.status).toBe(302)

      const res2 = await fetchPostForm('/login', {
        email: 'rapid.pilot@rocketry.org.au',
        password,
      }, {}, { redirect: 'manual' })
      expect(res2.status).toBe(302)
    })

    it('logout honors safe redirect query parameter', async () => {
      const user = await seedTestUser({ displayName: 'Redirect Logout Pilot' })
      const token = await signSession(user.id)
      const now = Date.now()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, now + 86400000, now).run()

      const res = await fetchGet('/logout?redirect=/custom-welcome', {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/custom-welcome')
    })

    it('unauthenticated random/corrupted cookie does NOT pollute site_settings table', async () => {
      const garbageToken = 'completely-random-garbage-token-xyz-12345'
      const res = await fetchGet('/rockets', {
        Cookie: `triplet_session=${garbageToken}`,
        Accept: 'application/json',
      })
      expect(res.status).toBe(401)

      // Ensure site_settings was NOT populated with garbage key
      const setting = await env.DB.prepare('SELECT * FROM site_settings WHERE key = ?')
        .bind(`revoked_session:${garbageToken}`)
        .first()
      expect(setting).toBeNull()
    })

    it('supports RFC 6750 case-insensitive lowercase authorization: bearer <token> scheme', async () => {
      const user = await seedTestUser({ displayName: 'Lowercase Bearer Pilot' })
      const token = await signSession(user.id)
      const now = Date.now()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, now + 86400000, now).run()

      // Protected route access using lowercase bearer scheme
      const res = await fetchGet('/rockets', {
        Authorization: `bearer ${token}`,
        Accept: 'application/json',
      })
      expect(res.status).toBe(200)

      // Logout using lowercase bearer scheme
      const logoutRes = await fetchGet('/logout', {
        Authorization: `bearer ${token}`,
        Accept: 'application/json',
      })
      expect(logoutRes.status).toBe(200)

      // Verify token was deleted from D1 and recorded as revoked
      expect(await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first()).toBeNull()
      expect(await env.DB.prepare('SELECT * FROM site_settings WHERE key = ?').bind(`revoked_session:${token}`).first()).not.toBeNull()

      // Subsequent access rejected
      const subRes = await fetchGet('/rockets', {
        Authorization: `bearer ${token}`,
        Accept: 'application/json',
      })
      expect(subRes.status).toBe(401)
    })

    it('multi-cookie sign-out revokes all presented triplet_session cookies from the Cookie header', async () => {
      const user = await seedTestUser({ displayName: 'Multi-Cookie Pilot' })
      const now = Date.now()
      const token1 = await signSession(user.id, undefined, now - 5000)
      const token2 = await signSession(user.id, undefined, now - 2000)

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token1, now + 86400000, now - 5000).run()
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token2, now + 86400000, now - 2000).run()

      // Send both cookies in a single header
      const res = await fetchGet('/logout', {
        Cookie: `triplet_session=${token1}; triplet_session=${token2}`,
        Accept: 'application/json',
      })
      expect(res.status).toBe(200)

      // Both tokens must be purged from D1 and revoked in siteSettings
      expect(await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token1).first()).toBeNull()
      expect(await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token2).first()).toBeNull()
      expect(await env.DB.prepare('SELECT * FROM site_settings WHERE key = ?').bind(`revoked_session:${token1}`).first()).not.toBeNull()
      expect(await env.DB.prepare('SELECT * FROM site_settings WHERE key = ?').bind(`revoked_session:${token2}`).first()).not.toBeNull()
    })

    it('middleware authenticates valid session when client sends duplicate triplet_session cookies (stale + valid)', async () => {
      const user = await seedTestUser({ displayName: 'Duplicate Cookie Pilot' })
      const token = await signSession(user.id)
      const now = Date.now()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, now + 86400000, now).run()

      // Send stale duplicate first, then valid active token
      const res = await fetchGet('/rockets', {
        Cookie: `triplet_session=stale_expired_token_123; triplet_session=${token}`,
        Accept: 'application/json',
      })
      expect(res.status).toBe(200)
    })

    it('public path (GET /login) actively clears cookies when presenting invalid/expired session', async () => {
      const user = await seedTestUser({ displayName: 'Public Login Cookie Pilot' })
      const token = await signSession(user.id)
      const now = Date.now()
      const pastExpiresAt = now - 10000

      // Seed expired session in D1
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, pastExpiresAt, now - 20000).run()

      // Visit public GET /login presenting the expired session cookie
      const res = await fetchGet('/login', {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      expect(res.status).toBe(200)
      const setCookies = (res.headers as any).getSetCookie ? (res.headers as any).getSetCookie() : [res.headers.get('set-cookie') || '']
      const joined = setCookies.join('; ')
      expect(joined).toContain('triplet_session=')
      expect(joined).toContain('triplet_logged_out=1')
    })

    it('logout redirect parameter sanitizes backslash open-redirect attempts', async () => {
      const user = await seedTestUser({ displayName: 'Backslash Redirect Pilot' })
      const token = await signSession(user.id)
      const now = Date.now()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, now + 86400000, now).run()

      // Attempt backslash bypass: /\evil.com
      const res1 = await fetchGet('/logout?redirect=/\\evil.com', {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })
      expect(res1.status).toBe(302)
      expect(res1.headers.get('location')).toBe('/login')

      // Attempt double backslash bypass: /\\evil.com
      const res2 = await fetchGet('/logout?redirect=%2F%5C%5Cevil.com', {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })
      expect(res2.status).toBe(302)
      expect(res2.headers.get('location')).toBe('/login')
    })

    it('HTMX request on protected route with expired session receives HX-Redirect header to /login', async () => {
      const user = await seedTestUser({ displayName: 'HTMX Expired Pilot' })
      const token = await signSession(user.id)
      const now = Date.now()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, now - 5000, now - 10000).run()

      const res = await fetchGet('/rockets', {
        Cookie: `triplet_session=${token}`,
        'HX-Request': 'true',
        Accept: 'text/html',
      }, { redirect: 'manual' })

      expect(res.status).toBe(302)
      expect(res.headers.get('hx-redirect')).toMatch(/\/login\?redirect=%2Frockets/i)
    })

    it('rapid re-login immediately after global sign-out (?all=true) succeeds and is not rejected', async () => {
      const password = 'GlobalReLoginPass2026!'
      const passwordHash = await hashPassword(password)
      const user = await seedTestUser({
        email: 'global.relogin@rocketry.org.au',
        displayName: 'Global Re-Login Aviator',
        passwordHash,
      })
      const initialToken = await signSession(user.id)
      const now = Date.now()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, initialToken, now + 86400000, now).run()

      // 1. Global sign out
      const logoutRes = await fetchGet('/logout?all=true', {
        Cookie: `triplet_session=${initialToken}`,
        Accept: 'application/json',
      })
      expect(logoutRes.status).toBe(200)

      // 2. Immediately re-login
      const loginRes = await fetchPostForm('/login', {
        email: 'global.relogin@rocketry.org.au',
        password,
      }, {}, { redirect: 'manual' })
      expect(loginRes.status).toBe(302)

      const cookieHeader = loginRes.headers.get('set-cookie') || ''
      const match = cookieHeader.match(/triplet_session=([^;]+)/)
      expect(match).not.toBeNull()
      const newToken = decodeURIComponent(match![1])

      // 3. Immediately access protected route with the new token
      const accessRes = await fetchGet('/rockets', {
        Cookie: `triplet_session=${newToken}`,
        Accept: 'application/json',
      })
      expect(accessRes.status).toBe(200)
    })
  })
})

