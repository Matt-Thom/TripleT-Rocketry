import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { truncateDb } from '../helpers/db'

const PROTECTED_ROUTES = [
  '/',
  '/flights',
  '/rockets',
  '/motors',
  '/inventory',
  '/sites',
  '/events',
  '/admin',
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

describe('Adversarial Stress Test: Milestone M1 (Challenger 2)', () => {
  describe('Dimension 1A: Cookieless Unauthenticated Rejection on Non-HTML/Non-GET Requests', () => {
    it('MUST reject unauthenticated GET /rockets with Accept: application/json with HTTP 401', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
      expect(res.status).toBe(401)
      const body = (await res.json()) as any
      expect(body.error).toBe('Unauthorized')
    })

    it('MUST reject unauthenticated POST /flights form submission with HTTP 302 redirect to /login', async () => {
      const res = await SELF.fetch('https://example.com/flights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/html',
        },
        body: 'rocketId=123',
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/login?redirect=%2Fflights')
    })

    it('MUST reject unauthenticated GET /rockets with curl default Accept: */* with HTTP 401', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        method: 'GET',
        headers: { Accept: '*/*' },
        redirect: 'manual',
      })
      expect(res.status).toBe(401)
    })

    it('MUST reject unauthenticated HEAD /rockets with Accept: text/html with HTTP 302 redirect to /login', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        method: 'HEAD',
        headers: { Accept: 'text/html' },
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/login?redirect=%2Frockets')
    })

    it('MUST reject unauthenticated POST /auth/switch/:id with HTTP 401 or 302 without session cookie', async () => {
      const adminId = 'admin-' + crypto.randomUUID()
      await env.DB.prepare(
        "INSERT INTO users (id, email, display_name, password_hash, is_active, role, regulatory_region, created_at, updated_at) VALUES (?, 'admin@rocketry.local', 'Admin User', 'hash', 1, 'admin', 'SA', ?, ?)",
      )
        .bind(adminId, Date.now(), Date.now())
        .run()

      const res = await SELF.fetch(`https://example.com/auth/switch/${adminId}`, {
        method: 'POST',
        headers: { Cookie: '' },
        redirect: 'manual',
      })

      expect([302, 401]).toContain(res.status)
      if (res.status === 302) {
        expect(res.headers.get('location')).toBe('/login')
      }
      expect(res.headers.get('set-cookie') || '').not.toContain('triplet_session=')
    })
  })

  describe('Dimension 1B: HTTP Methods with Unauthenticated Enforcement (x-no-auth: true)', () => {
    it('GET /rockets with Accept: text/html and x-no-auth returns 302 to /login', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        method: 'GET',
        headers: {
          Accept: 'text/html',
          'x-no-auth': 'true',
        },
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/login?redirect=%2Frockets')
    })

    it('GET /rockets with Accept: application/json and x-no-auth returns 401', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-no-auth': 'true',
        },
      })
      expect(res.status).toBe(401)
      const data = (await res.json()) as any
      expect(data.error).toBe('Unauthorized')
    })

    it('POST /flights with x-no-auth and Accept: text/html returns 302', async () => {
      const res = await SELF.fetch('https://example.com/flights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/html',
          'x-no-auth': 'true',
        },
        body: 'rocketId=123',
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/login?redirect=%2Fflights')
    })

    it('POST /rockets with x-no-auth and Accept: application/json returns 401', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-no-auth': 'true',
        },
        body: JSON.stringify({ name: 'Hacked Rocket' }),
      })
      expect(res.status).toBe(401)
    })

    it('PUT /rockets/123 with x-no-auth returns 401', async () => {
      const res = await SELF.fetch('https://example.com/rockets/123', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-no-auth': 'true',
        },
        body: JSON.stringify({ name: 'Hacked Rocket' }),
      })
      expect(res.status).toBe(401)
    })

    it('DELETE /rockets/123 with x-no-auth returns 401', async () => {
      const res = await SELF.fetch('https://example.com/rockets/123', {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          'x-no-auth': 'true',
        },
      })
      expect(res.status).toBe(401)
    })

    it('PATCH /rockets/123 with x-no-auth returns 401', async () => {
      const res = await SELF.fetch('https://example.com/rockets/123', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-no-auth': 'true',
        },
        body: JSON.stringify({ name: 'Hacked Rocket' }),
      })
      expect(res.status).toBe(401)
    })

    it('HEAD /rockets with x-no-auth and Accept: text/html returns 302', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        method: 'HEAD',
        headers: {
          Accept: 'text/html',
          'x-no-auth': 'true',
        },
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/login?redirect=%2Frockets')
    })

    it('OPTIONS /rockets with x-no-auth returns 401', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        method: 'OPTIONS',
        headers: {
          Accept: 'application/json',
          'x-no-auth': 'true',
        },
      })
      expect(res.status).toBe(401)
    })
  })

  describe('Dimension 2: HTMX Requests (HX-Request: true)', () => {
    it('HTMX GET /rockets with Accept: text/html returns 302 with HX-Redirect header', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        method: 'GET',
        headers: {
          'HX-Request': 'true',
          Accept: 'text/html',
          'x-no-auth': 'true',
        },
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      expect(res.headers.get('HX-Redirect')).toBe('/login?redirect=%2Frockets')
      expect(res.headers.get('Location')).toBe('/login?redirect=%2Frockets')
    })

    it('HTMX GET /rockets with Accept: text/html and NO test headers redirects to /login', async () => {
      const res = await SELF.fetch('https://example.com/rockets', {
        method: 'GET',
        headers: {
          'HX-Request': 'true',
          Accept: 'text/html',
        },
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      expect(res.headers.get('HX-Redirect')).toBe('/login?redirect=%2Frockets')
      expect(res.headers.get('Location')).toBe('/login?redirect=%2Frockets')
    })

    it('HTMX GET /inventory with Accept: application/json returns 401 with HX-Redirect', async () => {
      const res = await SELF.fetch('https://example.com/inventory', {
        method: 'GET',
        headers: {
          'HX-Request': 'true',
          Accept: 'application/json',
          'x-no-auth': 'true',
        },
      })
      expect(res.status).toBe(401)
      expect(res.headers.get('HX-Redirect')).toBe('/login?redirect=%2Finventory')
    })

    it('redirects unauthenticated HTMX POST /flights with HTTP 302 and HX-Redirect header', async () => {
      const res = await SELF.fetch('https://example.com/flights', {
        method: 'POST',
        headers: {
          'HX-Request': 'true',
          Accept: 'text/html',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'rocketId=123',
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      expect(res.headers.get('HX-Redirect')).toBe('/login?redirect=%2Fflights')
    })
  })

  describe('Dimension 3: Layout Nav Gating (Desktop & Mobile)', () => {
    it('unauthenticated GET /login completely omits Main navigation and Mobile navigation', async () => {
      const res = await SELF.fetch('https://example.com/login', {
        headers: { Accept: 'text/html' },
      })
      expect(res.status).toBe(200)
      const html = await res.text()

      // Nav elements must be absent
      expect(html).not.toContain('aria-label="Main navigation"')
      expect(html).not.toContain('aria-label="Mobile navigation"')

      // Internal links must be absent
      for (const link of INTERNAL_LINKS) {
        expect(html).not.toContain(link)
      }

      // Brand logo must point to /login
      expect(html).toContain('href="/login"')
    })

    it('unauthenticated GET /register completely omits Main navigation and Mobile navigation', async () => {
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

    it('unauthenticated GET /setup completely omits Main navigation and Mobile navigation', async () => {
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

    it('unauthenticated 404 page does NOT render Main navigation or Mobile navigation', async () => {
      const res = await SELF.fetch('https://example.com/nonexistent-route-xyz', {
        headers: { Accept: 'text/html' },
      })
      expect(res.status).toBe(404)
      const html = await res.text()

      expect(html).not.toContain('aria-label="Main navigation"')
      expect(html).not.toContain('aria-label="Mobile navigation"')
    })
  })

  describe('Dimension 4: Authenticated Link Restoration', () => {
    it('authenticated user sees Main navigation, Mobile navigation, and all internal links', async () => {
      const userId = crypto.randomUUID()
      await env.DB.prepare(
        "INSERT INTO users (id, email, display_name, password_hash, is_active, role, regulatory_region, created_at, updated_at) VALUES (?, 'tester@rocketry.local', 'Tester', 'hash', 1, 'admin', 'SA', ?, ?)",
      )
        .bind(userId, Date.now(), Date.now())
        .run()

      const res = await SELF.fetch('https://example.com/', {
        headers: {
          Accept: 'text/html',
          'x-flyer-id': userId,
        },
      })
      expect(res.status).toBe(200)
      const html = await res.text()

      expect(html).toContain('aria-label="Main navigation"')
      expect(html).toContain('aria-label="Mobile navigation"')

      expect(html).toContain('href="/"')
      expect(html).toContain('href="/flights"')
      expect(html).toContain('href="/rockets"')
      expect(html).toContain('href="/motors"')
      expect(html).toContain('href="/inventory"')
      expect(html).toContain('href="/sites"')
      expect(html).toContain('href="/events"')
      expect(html).toContain('href="/admin/users"')

      expect(html).toContain('href="/"')
    })
  })
})
