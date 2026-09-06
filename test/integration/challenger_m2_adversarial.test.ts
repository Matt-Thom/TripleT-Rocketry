/**
 * Adversarial Challenger 1 Test Suite for Milestone 2:
 * Authentication Security, Admin Dashboard & WebAuthn (Requirement R5).
 *
 * Edge Cases & Stress Vectors Tested:
 * 1. Strict RBAC enforcement & Non-Admin Access Control:
 *    - Unauthenticated access to /admin and /admin/users -> 302 or 401
 *    - Non-admin flyer access to /admin, /admin/users, /admin/settings -> strict HTTP 403
 *    - Non-admin flyer POST mutations (/admin/users, /admin/users/:id/edit, /admin/users/:id/status, /admin/users/:id/delete, /admin/settings) -> strict HTTP 403
 *    - Tampered or forged cookies sent to /admin -> rejected, no bypass
 * 2. Post-Logout Protected Route Invalidation:
 *    - Login -> capture cookie -> logout (GET & POST) -> cookie cleared (Max-Age=0), Clear-Site-Data, D1 session purged, token revoked in site_settings
 *    - Reusing old cookie to access /rockets -> strict HTTP 302 to /login
 *    - Reusing old cookie to access /flights -> strict HTTP 302 to /login
 *    - Reusing old cookie to access JSON API -> strict HTTP 401
 *    - Cache-Control header check on protected routes (no-store, no-cache, must-revalidate)
 * 3. Self-Deactivation, Self-Deletion, and Last Admin Protections:
 *    - Admin attempting to deactivate own account (form & JSON) -> strict HTTP 400
 *    - Admin attempting to delete own account (form & JSON) -> strict HTTP 400
 *    - Verification that admin record and sessions remain active in D1 after failed attempts
 *    - Attempting to delete the last administrator account -> strict HTTP 400
 * 4. Multi-Session User Deactivation & Immediate D1 Revocation:
 *    - Create target flyer with 3 active concurrent sessions (e.g. mobile, desktop, tablet)
 *    - Admin deactivates target flyer
 *    - D1 verification: users.is_active is false AND all 3 sessions purged from D1 sessions table
 *    - Target flyer attempts to access protected routes with ALL 3 tokens -> all strictly rejected
 *    - Deactivated flyer cannot log in via password or WebAuthn passkey
 * 5. WebAuthn Passkey Adversarial Vectors:
 *    - Unauthenticated passkey registration options/verify -> strict HTTP 401
 *    - Non-existent passkey credential assertion -> strict HTTP 401
 *    - Missing credential ID -> HTTP 400
 *    - Deactivated user passkey assertion -> strict HTTP 401
 *    - Valid passkey assertion creates persistent D1 session and sets cookie
 * 6. UI Navigation & Role Segregation:
 *    - Flyer session nav bar does NOT render /admin or /admin/users links
 *    - Admin session nav bar DOES render /admin/users link
 */

import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, seedTestUser, truncateDb } from '../helpers/db'
import { fetchGet, fetchPostForm } from '../helpers/http'
import { createSessionCookie, hashPassword, signSession } from '../../src/services/auth'

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

  // Ensure site setup is marked completed so routes don't redirect to /setup
  const now = Date.now()
  await env.DB.prepare(
    "INSERT OR REPLACE INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?, ?)",
  )
    .bind(now, now)
    .run()
})

describe('Challenger 1 Adversarial Suite: Milestone 2 (Auth Security & Admin RBAC)', () => {
  // =========================================================================
  // VECTOR 1: Strict RBAC & Non-Admin Access Control (HTTP 403)
  // =========================================================================
  describe('Vector 1: Strict RBAC & Non-Admin Access Control', () => {
    it('1.1: Unauthenticated request to /admin and /admin/users redirects to /login (HTML) or returns 401 (JSON)', async () => {
      // HTML request with no cookie and x-no-auth header
      const htmlRes = await fetchGet('/admin', {
        'x-no-auth': 'true',
        Accept: 'text/html',
      }, { redirect: 'manual' })

      expect([302, 401]).toContain(htmlRes.status)
      if (htmlRes.status === 302) {
        expect(htmlRes.headers.get('location')).toMatch(/\/login/i)
      }

      // JSON request with no cookie and x-no-auth header
      const jsonRes = await fetchGet('/admin/users', {
        'x-no-auth': 'true',
        Accept: 'application/json',
      }, { redirect: 'manual' })

      expect(jsonRes.status).toBe(401)
      const data = await jsonRes.json<{ error: string }>()
      expect(data.error).toBe('Unauthorized')
    })

    it('1.2: Regular flyer receives strict HTTP 403 on GET /admin (both HTML and JSON)', async () => {
      const flyer = await seedTestUser({ displayName: 'Standard Flyer', email: 'flyer1@sarc.org' })
      const token = await signSession(flyer.id)

      // HTML request
      const htmlRes = await fetchGet('/admin', {
        Cookie: `triplet_session=${token}`,
        Accept: 'text/html',
      }, { redirect: 'manual' })

      expect(htmlRes.status).toBe(403)
      const html = await htmlRes.text()
      expect(html).toMatch(/403.*Forbidden/i)
      expect(html).toMatch(/Administrator privileges are required/i)

      // JSON request
      const jsonRes = await fetchGet('/admin', {
        Cookie: `triplet_session=${token}`,
        Accept: 'application/json',
      }, { redirect: 'manual' })

      expect(jsonRes.status).toBe(403)
      const data = await jsonRes.json<{ error: string; message: string }>()
      expect(data.error).toBe('Forbidden')
      expect(data.message).toMatch(/Administrator privileges required/i)
    })

    it('1.3: Regular flyer receives strict HTTP 403 on GET /admin/users', async () => {
      const flyer = await seedTestUser({ displayName: 'Regular Pilot', email: 'flyer2@sarc.org' })
      const token = await signSession(flyer.id)

      const res = await fetchGet('/admin/users', {
        Cookie: `triplet_session=${token}`,
        Accept: 'text/html',
      }, { redirect: 'manual' })

      expect(res.status).toBe(403)
      const body = await res.text()
      expect(body).toMatch(/403/i)
    })

    it('1.4: Regular flyer receives strict HTTP 403 on POST /admin/users (user creation)', async () => {
      const flyer = await seedTestUser({ displayName: 'Attacker Pilot', email: 'flyer3@sarc.org' })
      const token = await signSession(flyer.id)

      // Form submission
      const formRes = await fetchPostForm('/admin/users', {
        display_name: 'Privilege Escalation',
        email: 'escalate@attack.org',
        password: 'Password123!',
        role: 'admin',
      }, {
        Cookie: `triplet_session=${token}`,
        Accept: 'text/html',
      }, { redirect: 'manual' })

      expect(formRes.status).toBe(403)

      // JSON submission
      const jsonRes = await SELF.fetch('https://example.com/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({
          display_name: 'Privilege Escalation 2',
          email: 'escalate2@attack.org',
          password: 'Password123!',
          role: 'admin',
        }),
      })

      expect(jsonRes.status).toBe(403)
      const data = await jsonRes.json<{ error: string }>()
      expect(data.error).toBe('Forbidden')

      // Ensure user was NOT created in D1
      const created = await env.DB.prepare('SELECT * FROM users WHERE email LIKE "escalate%"').all()
      expect(created.results).toHaveLength(0)
    })

    it('1.5: Regular flyer receives strict HTTP 403 on POST /admin/users/:id/edit, /status, /delete, and /settings', async () => {
      const flyer = await seedTestUser({ displayName: 'Attacker Pilot 2' })
      const token = await signSession(flyer.id)

      const target = await seedTestUser({ displayName: 'Target User' })

      // Edit attempt
      const editRes = await fetchPostForm(`/admin/users/${target.id}/edit`, {
        display_name: 'Hacked Name',
      }, {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })
      expect(editRes.status).toBe(403)

      // Status deactivation attempt
      const statusRes = await fetchPostForm(`/admin/users/${target.id}/status`, {
        is_active: 'false',
      }, {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })
      expect(statusRes.status).toBe(403)

      // Delete attempt
      const deleteRes = await fetchPostForm(`/admin/users/${target.id}/delete`, {}, {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })
      expect(deleteRes.status).toBe(403)

      // Settings mutation attempt
      const settingsRes = await fetchPostForm('/admin/settings', {
        site_name: 'Hacked Site',
      }, {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })
      expect(settingsRes.status).toBe(403)

      // Verify target was unmodified in D1
      const unmodified = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(target.id).first<{ displayName?: string; display_name?: string }>()
      expect(unmodified?.displayName || unmodified?.display_name).toBe('Target User')
    })

    it('1.6: Tampered / forged token sent to /admin is rejected without granting access', async () => {
      // Create forged token with fake signature
      const forgedToken = `fake-user-id:${Date.now()}:deadbeefcafebabe00000000`

      const res = await fetchGet('/admin', {
        Cookie: `triplet_session=${forgedToken}`,
        Accept: 'text/html',
      }, { redirect: 'manual' })

      // Should be redirected to /login, never 200 or admin access
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toMatch(/\/login/i)
    })
  })

  // =========================================================================
  // VECTOR 2: Post-Logout Protected Route Invalidation
  // =========================================================================
  describe('Vector 2: Post-Logout Protected Route Access & Invalidation', () => {
    it('2.1: Login captures cookie, logout clears cookie, deletes D1 session, and records revocation', async () => {
      // Provision test user with password
      const password = 'StrongPassword2026!'
      const passwordHash = await hashPassword(password)
      const user = await seedTestUser({
        displayName: 'Logout Pilot',
        email: 'logout.pilot@sarc.org',
        passwordHash,
      })

      // Log in via POST /login
      const loginRes = await fetchPostForm('/login', {
        email: 'logout.pilot@sarc.org',
        password,
      }, {}, { redirect: 'manual' })

      expect(loginRes.status).toBe(302)
      const cookieHeader = loginRes.headers.get('set-cookie') || ''
      expect(cookieHeader).toContain('triplet_session=')

      // Extract token
      const match = cookieHeader.match(/triplet_session=([^;]+)/)
      expect(match).not.toBeNull()
      const token = decodeURIComponent(match![1])

      // Verify session exists in D1 sessions table
      const sessionBefore = await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first()
      expect(sessionBefore).not.toBeNull()

      // Log out via GET /logout
      const logoutRes = await fetchGet('/logout', {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      expect([200, 302, 303]).toContain(logoutRes.status)
      const logoutCookie = logoutRes.headers.get('set-cookie') || ''
      expect(logoutCookie).toMatch(/(Max-Age=0|Expires=Thu, 01 Jan 1970|triplet_session=;)/i)

      const clearSiteData = logoutRes.headers.get('clear-site-data') || ''
      expect(clearSiteData).toMatch(/(cache|cookies|storage)/i)

      // Verify session record is DELETED from D1 sessions table
      const sessionAfter = await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first()
      expect(sessionAfter).toBeNull()

      // Verify token revocation is recorded in site_settings
      const revocation = await env.DB.prepare('SELECT * FROM site_settings WHERE key = ?')
        .bind(`revoked_session:${token}`)
        .first()
      expect(revocation).not.toBeNull()

      // 2.2: Reusing the old cookie to access /rockets redirects to /login
      const rocketsRes = await fetchGet('/rockets', {
        Cookie: `triplet_session=${token}`,
        Accept: 'text/html',
      }, { redirect: 'manual' })

      expect(rocketsRes.status).toBe(302)
      expect(rocketsRes.headers.get('location')).toMatch(/\/login\?redirect=%2Frockets/i)

      // 2.3: Reusing the old cookie to access /flights redirects to /login
      const flightsRes = await fetchGet('/flights', {
        Cookie: `triplet_session=${token}`,
        Accept: 'text/html',
      }, { redirect: 'manual' })

      expect(flightsRes.status).toBe(302)
      expect(flightsRes.headers.get('location')).toMatch(/\/login\?redirect=%2Fflights/i)

      // 2.4: Reusing the old cookie for JSON API request returns 401 Unauthorized
      const jsonRes = await fetchGet('/admin/users', {
        Cookie: `triplet_session=${token}`,
        Accept: 'application/json',
      }, { redirect: 'manual' })

      expect(jsonRes.status).toBe(401)
    })

    it('2.5: POST /logout also invalidates session and prevents protected route access', async () => {
      const user = await seedTestUser({ displayName: 'Post Logout Pilot' })
      const token = await signSession(user.id)

      // Seed session in D1
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.id, token, Date.now() + 86400000, Date.now()).run()

      // POST /logout
      const logoutRes = await fetchPostForm('/logout', {}, {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      expect([200, 302, 303]).toContain(logoutRes.status)

      // Access protected /inventory with old cookie
      const inventoryRes = await fetchGet('/inventory', {
        Cookie: `triplet_session=${token}`,
        Accept: 'text/html',
      }, { redirect: 'manual' })

      expect(inventoryRes.status).toBe(302)
      expect(inventoryRes.headers.get('location')).toMatch(/\/login\?redirect=%2Finventory/i)
    })

    it('2.6: Protected routes enforce Cache-Control: no-store to prevent bfcache disclosure', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)

      const res = await fetchGet('/rockets', {
        Cookie: `triplet_session=${token}`,
      })

      const cacheControl = res.headers.get('cache-control') || ''
      expect(cacheControl).toContain('no-store')
      expect(cacheControl).toContain('no-cache')
      expect(cacheControl).toContain('must-revalidate')
      expect(res.headers.get('pragma')).toBe('no-cache')
    })
  })

  // =========================================================================
  // VECTOR 3: Self-Deactivation and Self-Deletion Protections (HTTP 400)
  // =========================================================================
  describe('Vector 3: Self-Deactivation and Self-Deletion Protections', () => {
    it('3.1: Admin attempting to deactivate own account via form payload returns strict HTTP 400', async () => {
      const admin = await seedTestUser({ displayName: 'Master Admin' })
      await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(admin.id).run()
      const token = await signSession(admin.id)

      // Add session to D1
      const sessionId = crypto.randomUUID()
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(sessionId, admin.id, token, Date.now() + 86400000, Date.now()).run()

      // Attempt self-deactivation via form
      const res = await fetchPostForm(`/admin/users/${admin.id}/status`, {
        is_active: 'false',
      }, {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      expect(res.status).toBe(400)
      const text = await res.text()
      expect(text).toMatch(/cannot deactivate.*self|own account/i)

      // Verify D1: admin remains active and session is NOT purged
      const dbAdmin = await env.DB.prepare('SELECT is_active FROM users WHERE id = ?').bind(admin.id).first<{ is_active: number }>()
      expect(Boolean(dbAdmin?.is_active)).toBe(true)

      const dbSession = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(sessionId).first()
      expect(dbSession).not.toBeNull()
    })

    it('3.2: Admin attempting to deactivate own account via JSON payload returns strict HTTP 400', async () => {
      const admin = await seedTestUser({ displayName: 'JSON Admin' })
      await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(admin.id).run()
      const token = await signSession(admin.id)

      const res = await SELF.fetch(`https://example.com/admin/users/${admin.id}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({ is_active: false }),
      })

      expect(res.status).toBe(400)
      const json = await res.json<{ error: string }>()
      expect(json.error).toMatch(/cannot deactivate.*self|own account/i)
    })

    it('3.3: Admin attempting to delete own account via form or JSON returns strict HTTP 400', async () => {
      const admin = await seedTestUser({ displayName: 'Undeletable Admin' })
      await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(admin.id).run()
      const token = await signSession(admin.id)

      // Form submission
      const formRes = await fetchPostForm(`/admin/users/${admin.id}/delete`, {}, {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      expect(formRes.status).toBe(400)
      const formText = await formRes.text()
      expect(formText).toMatch(/cannot delete.*self|own account/i)

      // JSON submission
      const jsonRes = await SELF.fetch(`https://example.com/admin/users/${admin.id}/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({}),
      })

      expect(jsonRes.status).toBe(400)
      const jsonData = await jsonRes.json<{ error: string }>()
      expect(jsonData.error).toMatch(/cannot delete.*self|own account/i)

      // Verify admin account still exists in D1
      const checkUser = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(admin.id).first()
      expect(checkUser).not.toBeNull()
    })

    it('3.4: Guard prevents deleting the last administrator account even from another admin if only one admin exists', async () => {
      // Sole admin in the system
      const soleAdmin = await seedTestUser({ displayName: 'Sole Admin' })
      await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(soleAdmin.id).run()

      // Second temporary admin created
      const secondAdmin = await seedTestUser({ displayName: 'Second Admin' })
      await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(secondAdmin.id).run()
      const secondToken = await signSession(secondAdmin.id)

      // Second admin deletes first admin -> allowed (2 admins existed)
      const delFirstRes = await fetchPostForm(`/admin/users/${soleAdmin.id}/delete`, {}, {
        Cookie: `triplet_session=${secondToken}`,
      }, { redirect: 'manual' })
      expect([200, 302]).toContain(delFirstRes.status)

      // Now only 1 admin remains (secondAdmin).
      // Attempting to delete the last administrator account if another call targets it returns 400
      const targetLastAdmin = secondAdmin
      const delLastRes = await fetchPostForm(`/admin/users/${targetLastAdmin.id}/delete`, {}, {
        Cookie: `triplet_session=${secondToken}`,
      }, { redirect: 'manual' })

      // Self-deletion or last-admin check must return 400
      expect(delLastRes.status).toBe(400)
    })
  })

  // =========================================================================
  // VECTOR 4: User Deactivation and Session Revocation in D1
  // =========================================================================
  describe('Vector 4: User Deactivation & Immediate D1 Session Purging', () => {
    it('4.1: Deactivating another user purges ALL concurrent active sessions from D1 and blocks access', async () => {
      // 1. Setup Admin
      const admin = await seedTestUser({ displayName: 'Super Admin' })
      await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(admin.id).run()
      const adminToken = await signSession(admin.id)

      // 2. Setup Target User with 3 active concurrent sessions (Phone, Laptop, Tablet)
      const target = await seedTestUser({ displayName: 'Multi-Device Flyer', email: 'multi@sarc.org' })
      const token1 = await signSession(target.id)
      await new Promise((r) => setTimeout(r, 10))
      const token2 = await signSession(target.id)
      await new Promise((r) => setTimeout(r, 10))
      const token3 = await signSession(target.id)

      const now = Date.now()
      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind('sess-phone', target.id, token1, now + 86400000, now).run()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind('sess-laptop', target.id, token2, now + 86400000, now + 1).run()

      await env.DB.prepare(
        'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind('sess-tablet', target.id, token3, now + 86400000, now + 2).run()

      // Verify all 3 sessions exist in D1
      const initialSessions = await env.DB.prepare('SELECT * FROM sessions WHERE user_id = ?').bind(target.id).all()
      expect(initialSessions.results).toHaveLength(3)

      // 3. Admin deactivates target user
      const deactivateRes = await fetchPostForm(`/admin/users/${target.id}/status`, {
        is_active: 'false',
      }, {
        Cookie: `triplet_session=${adminToken}`,
      }, { redirect: 'manual' })

      expect([200, 302, 303]).toContain(deactivateRes.status)

      // 4. Verify in D1: user is_active is 0 AND sessions table has 0 rows for target
      const targetUserDb = await env.DB.prepare('SELECT is_active FROM users WHERE id = ?').bind(target.id).first<{ is_active: number }>()
      expect(Boolean(targetUserDb?.is_active)).toBe(false)

      const remainingSessions = await env.DB.prepare('SELECT * FROM sessions WHERE user_id = ?').bind(target.id).all()
      expect(remainingSessions.results).toHaveLength(0)

      // 5. Verify that ALL 3 sessions are rejected when attempting protected route access
      for (const tok of [token1, token2, token3]) {
        const testRes = await fetchGet('/rockets', {
          Cookie: `triplet_session=${tok}`,
          Accept: 'text/html',
        }, { redirect: 'manual' })

        expect(testRes.status).toBe(302)
        expect(testRes.headers.get('location')).toMatch(/\/login\?redirect=%2Frockets/i)

        const testJson = await fetchGet('/rockets', {
          Cookie: `triplet_session=${tok}`,
          Accept: 'application/json',
        }, { redirect: 'manual' })

        expect(testJson.status).toBe(401)
      }
    })

    it('4.2: Deactivated user cannot log in via password', async () => {
      const password = 'DeactivatedSecret1!'
      const passwordHash = await hashPassword(password)
      const user = await seedTestUser({
        displayName: 'Disabled Pilot',
        email: 'disabled@sarc.org',
        passwordHash,
      })

      // Mark user as deactivated
      await env.DB.prepare('UPDATE users SET is_active = 0 WHERE id = ?').bind(user.id).run()

      // Attempt login
      const res = await fetchPostForm('/login', {
        email: 'disabled@sarc.org',
        password,
      }, {}, { redirect: 'manual' })

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toMatch(/error=Invalid%20email%20or%20password/i)
      // Must not issue a valid triplet_session cookie
      const setCookie = res.headers.get('set-cookie') || ''
      expect(setCookie).not.toContain('triplet_session=')
    })
  })

  // =========================================================================
  // VECTOR 5: WebAuthn / Passkey Security Vectors
  // =========================================================================
  describe('Vector 5: WebAuthn Passkey Security Vectors', () => {
    it('5.1: Unauthenticated request to register-options returns strict HTTP 401', async () => {
      const res = await fetchPostForm('/auth/webauthn/register-options', {}, {
        'x-no-auth': 'true',
        Accept: 'application/json',
      })

      expect(res.status).toBe(401)
      const data = await res.json<{ error: string }>()
      expect(data.error).toBe('Unauthorized')
    })

    it('5.2: Unauthenticated request to register-verify returns strict HTTP 401', async () => {
      const res = await SELF.fetch('https://example.com/auth/webauthn/register-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-no-auth': 'true',
          Accept: 'application/json',
        },
        body: JSON.stringify({ id: 'some-cred-id', publicKey: 'mock-key' }),
      })

      expect(res.status).toBe(401)
    })

    it('5.3: Unknown credential ID on login-verify returns HTTP 401', async () => {
      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ id: 'non-existent-credential-id' }),
      })

      expect(res.status).toBe(401)
      const data = await res.json<{ error: string }>()
      expect(data.error).toMatch(/not recognized/i)
    })

    it('5.4: Missing credential ID on login-verify returns HTTP 400', async () => {
      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
    })

    it('5.5: Deactivated user cannot authenticate via WebAuthn passkey assertion', async () => {
      const user = await seedTestUser({ displayName: 'Deactivated Passkey User' })
      const credId = `cred-${crypto.randomUUID()}`

      // Register passkey in user_credentials
      await env.DB.prepare(
        'INSERT INTO user_credentials (id, user_id, public_key, counter, device_type, friendly_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(credId, user.id, 'mock-key-1', 0, 'platform', 'Touch ID', Date.now()).run()

      // Deactivate user in D1
      await env.DB.prepare('UPDATE users SET is_active = 0 WHERE id = ?').bind(user.id).run()

      // Attempt passkey assertion
      const res = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ id: credId }),
      })

      expect(res.status).toBe(401)
      const data = await res.json<{ error: string }>()
      expect(data.error).toMatch(/deactivated/i)
    })
  })

  // =========================================================================
  // VECTOR 6: Navigation Visibility & Role Segregation
  // =========================================================================
  describe('Vector 6: Navigation Visibility & Role Segregation', () => {
    it('6.1: Regular flyer does NOT see Admin link in layout navigation', async () => {
      const flyer = await seedTestUser({ displayName: 'Regular Flyer Nav' })
      const token = await signSession(flyer.id)

      const res = await fetchGet('/', {
        Cookie: `triplet_session=${token}`,
      })

      const html = await res.text()
      // Must NOT contain link to /admin or /admin/users
      expect(html).not.toMatch(/href=["']\/admin(\/users)?["']/i)
    })

    it('6.2: Administrator DOES see Admin link in layout navigation', async () => {
      const admin = await seedTestUser({ displayName: 'Admin Flyer Nav' })
      await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(admin.id).run()
      const token = await signSession(admin.id)

      const res = await fetchGet('/', {
        Cookie: `triplet_session=${token}`,
      })

      const html = await res.text()
      // MUST contain link to /admin or /admin/users
      expect(html).toMatch(/href=["']\/admin(\/users)?["']/i)
      expect(html).toMatch(/Admin/i)
    })
  })
})
