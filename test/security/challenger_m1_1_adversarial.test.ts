/**
 * Adversarial Stress Test Suite: Milestone M1 (Challenger 1)
 *
 * Stress-tests Worker M1's implementation of Requirement R1:
 * 1. Cookieless Fallback Bypass on Real-World Requests (API GET, POST without x-no-auth)
 * 2. Unauthenticated Route Gating on Account Switcher (/auth/switch/:id)
 * 3. Open Redirect Vulnerabilities in /login, /register, and /auth/switch (?redirect=/\evil.com)
 * 4. Edge Case Cookie Parsing (empty, whitespace, semicolons, malformed, quoted empty, etc.)
 * 5. Unauthenticated Protected Sub-paths (/rockets/:id, /inventory/storage-sites/new, /sites/:id/fields, etc.)
 * 6. Content Negotiation Matrix (HTML vs JSON vs text/plain vs wildcard vs HX-Request)
 * 7. Layout Link Absence and Zero Leakage on Public Entrypoints (/login, /register, /setup)
 */

import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { truncateDb } from '../helpers/db'
import { hashPassword, signSession, createSessionCookie } from '../../src/services/auth'

const PROTECTED_SUBPATHS = [
  '/rockets/test-rocket-id-123',
  '/rockets/test-rocket-id-123/edit',
  '/rockets/test-rocket-id-123/configurations/new',
  '/inventory/storage-sites/new',
  '/inventory/components/new',
  '/inventory/transactions/new',
  '/sites/test-site-id-456/fields',
  '/sites/test-site-id-456/edit',
  '/flights/new',
  '/flights/test-flight-id-789/edit',
  '/admin/users',
  '/settings',
  '/profile',
  '/profile/certifications',
]

const INTERNAL_NAV_LINKS = [
  'href="/"',
  'href="/flights"',
  'href="/rockets"',
  'href="/motors"',
  'href="/inventory"',
  'href="/sites"',
  'href="/events"',
  'href="/admin"',
  'href="/profile"',
]

let testAdminId = 'user-admin-m1-test'
let testFlyerId = 'user-flyer-m1-test'

beforeEach(async () => {
  await truncateDb()
  const now = Date.now()

  // Mark setup as completed
  await env.DB.prepare(
    "INSERT INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?, ?)",
  )
    .bind(now, now)
    .run()

  // Seed test users: Admin and Flyer
  const passwordHash = await hashPassword('TestPass123!')
  await env.DB.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, is_active, role, regulatory_region, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, 'SA', ?, ?)`,
  )
    .bind(testAdminId, 'admin@rocketry.local', 'Admin User', passwordHash, 'admin', now, now)
    .run()

  await env.DB.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, is_active, role, regulatory_region, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, 'SA', ?, ?)`,
  )
    .bind(testFlyerId, 'flyer@rocketry.local', 'Flyer User', passwordHash, 'flyer', now, now)
    .run()
})

describe('Milestone M1 Challenger 1: Adversarial Stress Test Suite', () => {
  // =========================================================================
  // 1. Cookieless Fallback Bypass on Real-World Requests (No x-no-auth header)
  // =========================================================================
  describe('Dimension 1: Cookieless Fallback Vulnerability (Real-World Requests Without x-no-auth)', () => {
    it('MUST reject unauthenticated JSON GET /rockets with HTTP 401 when no cookie or auth header is provided', async () => {
      // Real API clients / attackers do NOT provide 'x-no-auth: true'.
      const res = await SELF.fetch('https://example.com/rockets', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      })

      // If cookieless fallback triggered, this returns 200 instead of 401
      expect(res.status).toBe(401)
      const body = (await res.json()) as any
      expect(body.error).toBe('Unauthorized')
    })

    it('MUST reject unauthenticated POST /flights with HTTP 302 or 401 when no cookie or auth header is provided', async () => {
      const res = await SELF.fetch('https://example.com/flights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/html',
        },
        body: 'rocketId=test-rocket-id-123',
        redirect: 'manual',
      })

      // If cookieless fallback triggered, this creates/redirects to the flight (status 303)
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/login?redirect=%2Fflights')
    })

    it('MUST reject unauthenticated GET /flights with Accept: */* and no cookies', async () => {
      const res = await SELF.fetch('https://example.com/flights', {
        method: 'GET',
        headers: {
          Accept: '*/*',
        },
      })

      expect([302, 401]).toContain(res.status)
    })
  })

  // =========================================================================
  // 2. Unauthenticated Route Gating on /auth/switch/:id (Privilege Escalation)
  // =========================================================================
  describe('Dimension 2: Unauthenticated Access Control on /auth/switch/:id', () => {
    it('MUST reject unauthenticated POST /auth/switch/:id instead of issuing a session token', async () => {
      // An unauthenticated visitor attempts to switch to the admin user
      const res = await SELF.fetch(`https://example.com/auth/switch/${testAdminId}`, {
        method: 'POST',
        headers: {
          'x-no-auth': 'true',
        },
        redirect: 'manual',
      })

      const location = res.headers.get('location') || ''
      const setCookie = res.headers.get('set-cookie') || ''
      console.log('auth/switch status:', res.status, 'location:', location, 'set-cookie:', setCookie)

      // If it redirected to / and set a session cookie, it bypassed authentication!
      expect(location).not.toBe('/')
      expect(setCookie).not.toContain('triplet_session=')
      expect([302, 401]).toContain(res.status)
      if (res.status === 302) {
        expect(location).toContain('/login')
      }
    })

    it('MUST reject unauthenticated POST /auth/webauthn/register-options with 401 when requested with HTML accept header', async () => {
      const res = await SELF.fetch('https://example.com/auth/webauthn/register-options', {
        method: 'POST',
        headers: {
          Accept: 'text/html',
          Cookie: '',
        },
        redirect: 'manual',
      })

      expect([302, 401]).toContain(res.status)
    })
  })

  // =========================================================================
  // 3. Open Redirect Defenses (?redirect=/\evil.com)
  // =========================================================================
  describe('Dimension 3: Open Redirect Defenses', () => {
    it('sanitizes backslash open redirect (redirect=/\\evil.com) on POST /login', async () => {
      const res = await SELF.fetch('https://example.com/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `email=flyer@rocketry.local&password=TestPass123!&redirect=${encodeURIComponent('/\\evil.com')}`,
        redirect: 'manual',
      })

      expect(res.status).toBe(302)
      const location = res.headers.get('location')
      // Must not redirect to /\evil.com or //evil.com (which browsers resolve to https://evil.com/)
      expect(location).toBe('/')
    })

    it('sanitizes protocol-relative open redirect (redirect=//evil.com) on POST /login', async () => {
      const res = await SELF.fetch('https://example.com/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'email=flyer@rocketry.local&password=TestPass123!&redirect=%2F%2Fevil.com',
        redirect: 'manual',
      })

      expect(res.status).toBe(302)
      const location = res.headers.get('location')
      expect(location).toBe('/')
    })

    it('sanitizes absolute external URL (redirect=https://evil.com) on POST /login', async () => {
      const res = await SELF.fetch('https://example.com/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'email=flyer@rocketry.local&password=TestPass123!&redirect=https%3A%2F%2Fevil.com',
        redirect: 'manual',
      })

      expect(res.status).toBe(302)
      const location = res.headers.get('location')
      expect(location).toBe('/')
    })

    it('sanitizes backslash open redirect on POST /register', async () => {
      const res = await SELF.fetch('https://example.com/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `email=newflyer@rocketry.local&displayName=NewFlyer&password=Password123!&confirmPassword=Password123!&regulatoryRegion=SA&redirect=${encodeURIComponent('/\\evil.com')}`,
        redirect: 'manual',
      })

      expect(res.status).toBe(302)
      const location = res.headers.get('location')
      expect(location).toBe('/')
    })
  })

  // =========================================================================
  // 4. Edge Case Cookie Parsing
  // =========================================================================
  describe('Dimension 4: Edge Case Cookie Parsing', () => {
    const edgeCaseCookies = [
      { name: 'empty string ("")', value: '' },
      { name: 'whitespace only ("   ")', value: '   ' },
      { name: 'semicolons only (";;;;")', value: ';;;;' },
      { name: 'semicolons and whitespace (" ; ; ")', value: ' ; ; ' },
      { name: 'malformed cookie without equals ("malformed_token")', value: 'malformed_token' },
      { name: 'missing name ("=anonymous")', value: '=anonymous' },
      { name: 'empty triplet_session ("triplet_session=")', value: 'triplet_session=' },
      { name: 'whitespace triplet_session ("triplet_session=   ")', value: 'triplet_session=   ' },
      { name: 'quoted empty triplet_session (\'triplet_session=""\')', value: 'triplet_session=""' },
      { name: 'triplet_logged_out=1 alone', value: 'triplet_logged_out=1' },
      { name: 'triplet_logged_out=1 with trailing semicolon', value: 'triplet_logged_out=1;' },
      { name: 'triplet_logged_out=1 combined with other cookies', value: 'theme=dark; triplet_logged_out=1; lang=en' },
      { name: 'triplet_logged_out=1 combined with empty triplet_session', value: 'triplet_logged_out=1; triplet_session=' },
      { name: 'forged triplet_session with invalid HMAC signature', value: 'triplet_session=user-flyer-m1-test:9999999999999:deadbeefdeadbeef' },
    ]

    for (const { name, value } of edgeCaseCookies) {
      it(`enforces HTML 302 redirect on GET /rockets for cookie: ${name}`, async () => {
        const res = await SELF.fetch('https://example.com/rockets', {
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            Cookie: value,
          },
          redirect: 'manual',
        })

        expect(res.status).toBe(302)
        expect(res.headers.get('location')).toBe('/login?redirect=%2Frockets')
      })

      it(`enforces JSON 401 Unauthorized on GET /rockets for cookie: ${name}`, async () => {
        const res = await SELF.fetch('https://example.com/rockets', {
          headers: {
            Accept: 'application/json',
            Cookie: value,
          },
        })

        expect(res.status).toBe(401)
        const body = (await res.json()) as any
        expect(body.error).toBe('Unauthorized')
      })
    }
  })

  // =========================================================================
  // 5. Unauthenticated Protected Sub-paths (Tested with logged-out marker)
  // =========================================================================
  describe('Dimension 5: Unauthenticated Protected Sub-paths Coverage', () => {
    for (const subpath of PROTECTED_SUBPATHS) {
      it(`redirects unauthenticated browser GET ${subpath} to /login (HTTP 302)`, async () => {
        const res = await SELF.fetch(`https://example.com${subpath}`, {
          headers: {
            Accept: 'text/html',
            Cookie: 'triplet_logged_out=1',
          },
          redirect: 'manual',
        })

        expect(res.status).toBe(302)
        const location = res.headers.get('location')
        expect(location).toBe(`/login?redirect=${encodeURIComponent(subpath)}`)
      })

      it(`rejects unauthenticated API GET ${subpath} with HTTP 401 Unauthorized`, async () => {
        const res = await SELF.fetch(`https://example.com${subpath}`, {
          headers: {
            Accept: 'application/json',
            Cookie: 'triplet_logged_out=1',
          },
        })

        expect(res.status).toBe(401)
        const body = (await res.json()) as any
        expect(body.error).toBe('Unauthorized')
      })
    }
  })

  // =========================================================================
  // 6. Content Negotiation Matrix
  // =========================================================================
  describe('Dimension 6: Content Negotiation Matrix on Protected Route (/rockets)', () => {
    it('returns 302 redirect for Accept: text/html', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        headers: { Accept: 'text/html', Cookie: 'triplet_logged_out=1' },
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/login?redirect=%2Frockets')
    })

    it('returns 302 redirect for Accept: text/html,application/xhtml+xml', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        headers: { Accept: 'text/html,application/xhtml+xml', Cookie: 'triplet_logged_out=1' },
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/login?redirect=%2Frockets')
    })

    it('returns 401 JSON for Accept: application/json', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        headers: { Accept: 'application/json', Cookie: 'triplet_logged_out=1' },
      })
      expect(res.status).toBe(401)
      expect(res.headers.get('content-type')).toContain('application/json')
      const body = (await res.json()) as any
      expect(body.error).toBe('Unauthorized')
    })

    it('returns 401 JSON for Accept: text/plain', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        headers: { Accept: 'text/plain', Cookie: 'triplet_logged_out=1' },
      })
      expect(res.status).toBe(401)
      expect(res.headers.get('content-type')).toContain('application/json')
    })

    it('returns 401 JSON for unknown Accept: application/xml', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        headers: { Accept: 'application/xml', Cookie: 'triplet_logged_out=1' },
      })
      expect(res.status).toBe(401)
      expect(res.headers.get('content-type')).toContain('application/json')
    })

    it('sets HX-Redirect header on HTMX request with Accept: text/html', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        headers: {
          Accept: 'text/html',
          'HX-Request': 'true',
          Cookie: 'triplet_logged_out=1',
        },
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      expect(res.headers.get('hx-redirect')).toBe('/login?redirect=%2Frockets')
    })

    it('sets HX-Redirect header on HTMX request with Accept: application/json', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        headers: {
          Accept: 'application/json',
          'HX-Request': 'true',
          Cookie: 'triplet_logged_out=1',
        },
      })
      expect(res.status).toBe(401)
      expect(res.headers.get('hx-redirect')).toBe('/login?redirect=%2Frockets')
    })
  })

  // =========================================================================
  // 7. Layout Link Absence and Zero Leakage on Public Entrypoints
  // =========================================================================
  describe('Dimension 7: Layout Link Absence and Zero Leakage', () => {
    it('verifies zero internal link leakage and navigation suppression on GET /login', async () => {
      const res = await SELF.fetch('https://example.com/login', {
        headers: { Accept: 'text/html' },
      })
      expect(res.status).toBe(200)
      const html = await res.text()

      expect(html).not.toContain('aria-label="Main navigation"')
      expect(html).not.toContain('aria-label="Mobile navigation"')

      for (const link of INTERNAL_NAV_LINKS) {
        expect(html).not.toContain(link)
      }

      // Brand logo must point to /login
      expect(html).toContain('href="/login"')
    })

    it('verifies zero internal link leakage and navigation suppression on GET /register', async () => {
      const res = await SELF.fetch('https://example.com/register', {
        headers: { Accept: 'text/html' },
      })
      expect(res.status).toBe(200)
      const html = await res.text()

      expect(html).not.toContain('aria-label="Main navigation"')
      expect(html).not.toContain('aria-label="Mobile navigation"')

      for (const link of INTERNAL_NAV_LINKS) {
        expect(html).not.toContain(link)
      }

      expect(html).toContain('href="/login"')
    })

    it('verifies zero internal link leakage on GET /setup when unconfigured', async () => {
      await env.DB.prepare("DELETE FROM site_settings WHERE key = 'setup_completed'").run()

      const res = await SELF.fetch('https://example.com/setup', {
        headers: { Accept: 'text/html' },
      })
      expect(res.status).toBe(200)
      const html = await res.text()

      expect(html).not.toContain('aria-label="Main navigation"')
      expect(html).not.toContain('aria-label="Mobile navigation"')

      for (const link of INTERNAL_NAV_LINKS) {
        expect(html).not.toContain(link)
      }
    })
  })
})
