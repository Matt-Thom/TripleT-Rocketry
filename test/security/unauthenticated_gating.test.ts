/**
 * Security test suite: Strict Unauthenticated Access Control & Navigation Gating (Requirement R1).
 *
 * Verifies:
 * 1. Unauthenticated browser requests (HTML) to protected routes return HTTP 302 redirecting to /login.
 * 2. Unauthenticated API requests (JSON) to protected routes return HTTP 401 Unauthorized.
 * 3. Logged-out marker (triplet_logged_out=1) and empty cookies are strictly rejected.
 * 4. Layout navigation menus (<nav aria-label="Main navigation"> and <nav aria-label="Mobile navigation">)
 *    and internal protected links are completely suppressed on public entrypoints (/login, /register, /setup).
 * 5. Dynamic brand logo links point to /login when unauthenticated, and / when authenticated.
 */

import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { truncateDb } from '../helpers/db'
import { fetchGet, fetchJson } from '../helpers/http'

const PROTECTED_ROUTES = [
  '/',
  '/flights',
  '/flights/new',
  '/rockets',
  '/rockets/new',
  '/motors',
  '/motors/import',
  '/inventory',
  '/sites',
  '/sites/new',
  '/events',
  '/events/new',
  '/admin',
  '/admin/users',
  '/profile',
  '/settings',
]

const INTERNAL_LINKS = [
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

beforeEach(async () => {
  await truncateDb()
  await env.DB.prepare(
    "INSERT INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?, ?)",
  )
    .bind(Date.now(), Date.now())
    .run()
})

describe('Requirement R1: Strict Unauthenticated Route Gating', () => {
  describe('Unauthenticated Browser Requests (HTML 302 Redirect)', () => {
    for (const route of PROTECTED_ROUTES) {
      it(`redirects unauthenticated GET ${route} to /login with encoded redirect parameter`, async () => {
        const res = await SELF.fetch(`https://example.com${route}`, {
          headers: {
            Accept: 'text/html,application/xhtml+xml',
          },
          redirect: 'manual',
        })

        expect(res.status).toBe(302)
        const location = res.headers.get('location')
        expect(location).toBeDefined()
        const expectedRedirect = encodeURIComponent(route)
        expect(location).toBe(`/login?redirect=${expectedRedirect}`)
        expect(res.headers.get('cache-control')).toContain('no-store')
      })
    }

    it('redirects unauthenticated POST request with HTML accept header to /login', async () => {
      const res = await SELF.fetch('https://example.com/flights', {
        method: 'POST',
        headers: {
          Accept: 'text/html',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'rocketId=123',
        redirect: 'manual',
      })

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/login?redirect=%2Fflights')
    })
  })

  describe('Unauthenticated API Requests (JSON 401 Unauthorized)', () => {
    for (const route of ['/', '/flights', '/rockets', '/motors', '/inventory', '/sites', '/events', '/admin', '/profile']) {
      it(`rejects unauthenticated JSON GET ${route} with HTTP 401 Unauthorized`, async () => {
        const res = await SELF.fetch(`https://example.com${route}`, {
          headers: {
            Accept: 'application/json',
          },
        })

        expect(res.status).toBe(401)
        expect(res.headers.get('cache-control')).toContain('no-store')
        const body = (await res.json()) as any
        expect(body.error).toBe('Unauthorized')
        expect(body.message).toBe('Authentication required')
      })
    }

    it('rejects unauthenticated JSON POST request with HTTP 401 Unauthorized', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ name: 'Stealth Rocket' }),
      })

      expect(res.status).toBe(401)
      const body = (await res.json()) as any
      expect(body.error).toBe('Unauthorized')
    })

    it('rejects unauthenticated requests sending no auth headers or cookies', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        headers: { Accept: 'application/json' },
      })
      expect(res.status).toBe(401)
      const body = (await res.json()) as any
      expect(body.error).toBe('Unauthorized')
    })
  })

  describe('Logged-Out Marker & Empty Cookie Defense', () => {
    it('rejects requests with triplet_logged_out=1 marker cookie on protected routes', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        headers: {
          Accept: 'text/html',
          Cookie: 'triplet_logged_out=1',
        },
        redirect: 'manual',
      })

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/login?redirect=%2Frockets')
    })

    it('rejects requests with empty Cookie header ("")', async () => {
      const res = await SELF.fetch('https://example.com/inventory', {
        headers: {
          Accept: 'text/html',
          Cookie: '',
        },
        redirect: 'manual',
      })

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/login?redirect=%2Finventory')
    })

    it('rejects requests with empty session cookie value ("triplet_session=")', async () => {
      const res = await SELF.fetch('https://example.com/sites', {
        headers: {
          Accept: 'text/html',
          Cookie: 'triplet_session=',
        },
        redirect: 'manual',
      })

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/login?redirect=%2Fsites')
    })

    it('rejects requests with invalid or forged session cookie', async () => {
      const res = await SELF.fetch('https://example.com/events', {
        headers: {
          Accept: 'text/html',
          Cookie: 'triplet_session=forged-user-id:9999999999999:badsignature',
        },
        redirect: 'manual',
      })

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/login?redirect=%2Fevents')
    })

    it('strictly ignores Cloudflare Access headers and enforces email/password or passkey authentication', async () => {
      const userId = crypto.randomUUID()
      await env.DB.prepare(
        "INSERT INTO users (id, email, display_name, password_hash, is_active, role, regulatory_region, created_at, updated_at) VALUES (?, 'cf-pilot@rocketry.local', 'CF Pilot', 'hash', 1, 'flyer', 'SA', ?, ?)",
      )
        .bind(userId, Date.now(), Date.now())
        .run()

      for (const path of ['/flights', '/rockets', '/inventory', '/sites', '/events', '/dashboard', '/']) {
        const res = await SELF.fetch(`https://example.com${path}`, {
          headers: {
            Accept: 'text/html',
            'cf-access-authenticated-user-email': 'cf-pilot@rocketry.local',
          },
          redirect: 'manual',
        })

        // Must NOT return 200 or user data - must redirect to /login
        expect(res.status).toBe(302)
        expect(res.headers.get('location')).toBe(`/login?redirect=${encodeURIComponent(path)}`)
      }
    })

    it('does NOT render Cloudflare Access option on /login page', async () => {
      const res = await SELF.fetch('https://example.com/login', {
        headers: {
          Accept: 'text/html',
          'cf-access-authenticated-user-email': 'cf-pilot@rocketry.local',
        },
      })

      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).not.toContain('Sign in with Cloudflare Access')
      expect(html).not.toContain('/auth/cf-access-login')
      expect(html).toContain('Sign in with Passkey')
      expect(html).toContain('Email Address')
      expect(html).toContain('Password')
    })

    it('returns 404 for removed endpoint POST /auth/cf-access-login', async () => {
      const res = await SELF.fetch('https://example.com/auth/cf-access-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'cf-access-authenticated-user-email': 'cf-pilot@rocketry.local',
        },
        body: 'redirect=%2Fflights',
      })

      expect(res.status).toBe(404)
    })
  })

  describe('Navigation Menu Gating on Public Pages', () => {
    it('suppresses all internal links and navigation bars on GET /login', async () => {
      const res = await SELF.fetch('https://example.com/login', {
        headers: { Accept: 'text/html' },
      })
      expect(res.status).toBe(200)
      const html = await res.text()

      // Main and mobile navigation containers must NOT be rendered
      expect(html).not.toContain('aria-label="Main navigation"')
      expect(html).not.toContain('aria-label="Mobile navigation"')

      // Internal protected links must NOT be present anywhere in the layout
      for (const link of INTERNAL_LINKS) {
        expect(html).not.toContain(link)
      }

      // Brand logo must link to /login instead of /
      expect(html).toContain('href="/login"')
    })

    it('suppresses all internal links and navigation bars on GET /register', async () => {
      const res = await SELF.fetch('https://example.com/register', {
        headers: { Accept: 'text/html' },
      })
      expect(res.status).toBe(200)
      const html = await res.text()

      expect(html).not.toContain('aria-label="Main navigation"')
      expect(html).not.toContain('aria-label="Mobile navigation"')

      for (const link of INTERNAL_LINKS) {
        expect(html).not.toContain(link)
      }

      expect(html).toContain('href="/login"')
    })

    it('suppresses all internal links and navigation bars on GET /setup', async () => {
      // Clear setup_completed to render /setup view
      await env.DB.prepare("DELETE FROM site_settings WHERE key = 'setup_completed'").run()

      const res = await SELF.fetch('https://example.com/setup', {
        headers: { Accept: 'text/html' },
      })
      expect(res.status).toBe(200)
      const html = await res.text()

      expect(html).not.toContain('aria-label="Main navigation"')
      expect(html).not.toContain('aria-label="Mobile navigation"')

      for (const link of INTERNAL_LINKS) {
        expect(html).not.toContain(link)
      }
    })
  })

  describe('Authenticated Navigation Restoration', () => {
    it('renders full navigation bars and internal links when user is authenticated', async () => {
      const res = await fetchGet('/')
      expect(res.status).toBe(200)
      const html = await res.text()

      // Navigation containers must be present
      expect(html).toContain('aria-label="Main navigation"')
      expect(html).toContain('aria-label="Mobile navigation"')

      // Internal application links must be present
      expect(html).toContain('href="/"')
      expect(html).toContain('href="/flights"')
      expect(html).toContain('href="/rockets"')
      expect(html).toContain('href="/motors"')
      expect(html).toContain('href="/sites"')
      expect(html).toContain('href="/events"')
    })
  })
})
