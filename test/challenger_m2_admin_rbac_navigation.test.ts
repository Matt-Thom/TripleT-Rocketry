/**
 * Empirical Adversarial Verification Suite for Milestone 2:
 * Requirement R1: Role-Based Admin Visibility & Navigation Guarding
 * Requirement R3: Launch Event Operational Roles & Resilience
 *
 * Authored by Milestone 2 Challenger 2.
 */

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, seedTestUser, seedTestSite, truncateDb } from './helpers/db'
import { assertHtmlResponse } from './helpers/html'
import { fetchGet, fetchPostForm } from './helpers/http'
import { signSession } from '../src/services/auth'
import * as schema from '../src/db/schema'

beforeEach(async () => {
  await truncateDb()
  try {
    await env.DB.prepare('DELETE FROM sessions').run()
  } catch {}
  try {
    await env.DB.prepare('DELETE FROM site_settings').run()
  } catch {}
  try {
    const now = Date.now()
    await env.DB.prepare(
      "INSERT OR REPLACE INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?, ?)"
    ).bind(now, now).run()
  } catch {}
})

describe('Milestone 2 Adversarial Challenge: Admin RBAC & Navigation Guarding', () => {

  describe('Suite 1: Navigation Gating Across All Layouts & Pages', () => {
    it('1.1: non-admin flyer never sees Admin links across all major application views', async () => {
      const flyer = await seedTestUser({ role: 'flyer', displayName: 'Standard Flyer' })
      const token = await signSession(flyer.id)
      const cookie = { Cookie: `triplet_session=${token}` }

      const routesToTest = [
        '/',
        '/flights',
        '/rockets',
        '/motors',
        '/inventory',
        '/sites',
        '/events',
      ]

      for (const route of routesToTest) {
        const res = await fetchGet(route, cookie)
        assertHtmlResponse(res, 200)
        const html = await res.text()

        // Verify zero occurrences of /admin in any href attribute anywhere on the page
        expect(html, `Route ${route} leaked /admin href`).not.toMatch(/href=["']\/admin(\/[^"']*)?["']/i)

        // Extract desktop navigation specifically
        const desktopNavMatch = /<nav[^>]*aria-label="Main navigation"[^>]*>([\s\S]*?)<\/nav>/i.exec(html)
        expect(desktopNavMatch, `Route ${route} missing desktop nav`).not.toBeNull()
        const desktopNavHtml = desktopNavMatch![1]
        expect(desktopNavHtml, `Route ${route} desktop nav rendered Admin link`).not.toMatch(/Admin/i)
        expect(desktopNavHtml, `Route ${route} desktop nav rendered /admin`).not.toContain('/admin')

        // Extract mobile bottom navigation specifically
        const mobileNavMatch = /<nav[^>]*aria-label="Mobile navigation"[^>]*>([\s\S]*?)<\/nav>/i.exec(html)
        expect(mobileNavMatch, `Route ${route} missing mobile nav`).not.toBeNull()
        const mobileNavHtml = mobileNavMatch![1]
        expect(mobileNavHtml, `Route ${route} mobile nav rendered Admin link`).not.toMatch(/Admin/i)
        expect(mobileNavHtml, `Route ${route} mobile nav rendered /admin`).not.toContain('/admin')
        expect(mobileNavHtml, `Route ${route} mobile nav rendered gear emoji`).not.toContain('⚙️')

        // Verify mobile top bar does not contain Admin
        const mobileTopBarMatch = /<div[^>]*class="[^"]*md:hidden[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html)
        if (mobileTopBarMatch) {
          expect(mobileTopBarMatch[1], `Route ${route} mobile top bar rendered Admin`).not.toMatch(/Admin/i)
        }
      }
    })

    it('1.2: non-admin flyer dashboard contains zero administrative cards or widgets', async () => {
      const flyer = await seedTestUser({ role: 'flyer', displayName: 'Standard Flyer' })
      const token = await signSession(flyer.id)

      const res = await fetchGet('/', { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Ensure no administrative cards, user management cards, or settings cards
      expect(html).not.toMatch(/admin\s*dashboard/i)
      expect(html).not.toMatch(/system\s*administration/i)
      expect(html).not.toMatch(/user\s*management/i)
      expect(html).not.toMatch(/site\s*settings/i)
      expect(html).not.toContain('/admin/users')
      expect(html).not.toContain('/admin/settings')

      // Ensure standard companion dashboard sections are present
      expect(html).toContain('Range Companion Dashboard')
      expect(html).toContain('Total Flights')
      expect(html).toContain('Active Rockets')
      expect(html).toContain('Motor Stock')
    })

    it('1.3: admin user sees Admin navigation links on desktop and mobile across views', async () => {
      const admin = await seedTestUser({ role: 'admin', displayName: 'System Admin' })
      const token = await signSession(admin.id)
      const cookie = { Cookie: `triplet_session=${token}` }

      const routesToTest = ['/', '/flights', '/events']

      for (const route of routesToTest) {
        const res = await fetchGet(route, cookie)
        assertHtmlResponse(res, 200)
        const html = await res.text()

        // Desktop nav check
        const desktopNavMatch = /<nav[^>]*aria-label="Main navigation"[^>]*>([\s\S]*?)<\/nav>/i.exec(html)
        expect(desktopNavMatch).not.toBeNull()
        expect(desktopNavMatch![1], `Route ${route} desktop nav missing Admin`).toMatch(/<a\s+href="\/admin\/users"[^>]*>Admin<\/a>/i)

        // Mobile nav check
        const mobileNavMatch = /<nav[^>]*aria-label="Mobile navigation"[^>]*>([\s\S]*?)<\/nav>/i.exec(html)
        expect(mobileNavMatch).not.toBeNull()
        expect(mobileNavMatch![1], `Route ${route} mobile nav missing Admin`).toMatch(/<a\s+href="\/admin\/users"[^>]*>[\s\S]*?⚙️[\s\S]*?<span>Admin<\/span>[\s\S]*?<\/a>/i)
      }
    })

    it('1.4: unauthenticated visitor on public pages sees no Admin navigation links', async () => {
      const res = await fetchGet('/login')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).not.toMatch(/href=["']\/admin(\/[^"']*)?["']/i)
      expect(html).not.toMatch(/>Admin<\/a>/i)
    })
  })

  describe('Suite 2: Unauthenticated Visitor Guarding on /admin Endpoints', () => {
    it('2.1: unauthenticated GET /admin redirects cleanly to /login (HTTP 302)', async () => {
      const res = await fetchGet('/admin', {}, { redirect: 'manual' })
      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('Location') ?? ''
      expect(location).toMatch(/\/login\?redirect=%2Fadmin/)
    })

    it('2.2: unauthenticated GET /admin/users redirects cleanly to /login (HTTP 302)', async () => {
      const res = await fetchGet('/admin/users', {}, { redirect: 'manual' })
      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('Location') ?? ''
      expect(location).toMatch(/\/login\?redirect=%2Fadmin%2Fusers/)
    })

    it('2.3: unauthenticated GET /admin/settings redirects cleanly to /login (HTTP 302)', async () => {
      const res = await fetchGet('/admin/settings', {}, { redirect: 'manual' })
      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('Location') ?? ''
      expect(location).toMatch(/\/login\?redirect=%2Fadmin%2Fsettings/)
    })

    it('2.4: unauthenticated GET /admin with query parameters preserves query in redirect', async () => {
      const res = await fetchGet('/admin?msg=hello&tab=settings', {}, { redirect: 'manual' })
      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('Location') ?? ''
      expect(location).toContain(encodeURIComponent('/admin?msg=hello&tab=settings'))
    })

    it('2.5: unauthenticated cookieless request in test environment does not fallback to test flyer', async () => {
      // Seed a flyer to ensure getActiveFlyer would return someone if fallback fired
      await seedTestUser({ role: 'flyer', displayName: 'Fallback Flyer' })

      const res = await fetchGet('/admin', {}, { redirect: 'manual' })
      // MUST redirect to login, NOT return 403 (which would happen if fallback flyer was attached)
      expect([302, 303]).toContain(res.status)
      expect(res.headers.get('Location')).toMatch(/\/login/)
    })

    it('2.6: unauthenticated API request to /admin with Accept: application/json returns 401 Unauthorized', async () => {
      const res = await fetchGet('/admin', { Accept: 'application/json' }, { redirect: 'manual' })
      expect(res.status).toBe(401)
      const json = await res.json() as any
      expect(json.error).toBe('Unauthorized')
    })

    it('2.7: unauthenticated POST to /admin/users rejects without executing action', async () => {
      const res = await fetchPostForm('/admin/users', {
        email: 'hacker@example.com',
        displayName: 'Hacker',
        role: 'admin',
      }, {}, { redirect: 'manual' })

      expect([302, 303, 401, 403]).toContain(res.status)

      // Verify no user was created
      const db = getDb()
      const users = await db.select().from(schema.users)
      const hacker = users.find(u => u.email === 'hacker@example.com')
      expect(hacker).toBeUndefined()
    })
  })

  describe('Suite 3: Authenticated Non-Admin Flyer Guarding (HTTP 403 & forbiddenView)', () => {
    it('3.1: non-admin flyer accessing GET /admin receives HTTP 403 with user-friendly forbiddenView', async () => {
      const flyer = await seedTestUser({ role: 'flyer', displayName: 'Regular Flyer' })
      const token = await signSession(flyer.id)

      const res = await fetchGet('/admin', {
        Cookie: `triplet_session=${token}`,
        Accept: 'text/html',
      })

      expect(res.status).toBe(403)
      const html = await res.text()

      // Validate forbiddenView user-friendly content
      expect(html).toContain('403 — Forbidden')
      expect(html).toContain('Administrator privileges are required')
      expect(html).toContain('Return to Dashboard')
      expect(html).toMatch(/href=["']\/["']/)

      // Ensure no admin UI leaked
      expect(html).not.toContain('Provision New User')
      expect(html).not.toContain('Site Settings')
      expect(html).not.toContain('Site Administration & User Management')
    })

    it('3.2: non-admin flyer accessing GET /admin/users receives HTTP 403', async () => {
      const flyer = await seedTestUser({ role: 'flyer' })
      const token = await signSession(flyer.id)

      const res = await fetchGet('/admin/users', {
        Cookie: `triplet_session=${token}`,
        Accept: 'text/html',
      })
      expect(res.status).toBe(403)
      const html = await res.text()
      expect(html).toContain('403 — Forbidden')
    })

    it('3.3: non-admin flyer accessing GET /admin/settings receives HTTP 403', async () => {
      const flyer = await seedTestUser({ role: 'flyer' })
      const token = await signSession(flyer.id)

      const res = await fetchGet('/admin/settings', {
        Cookie: `triplet_session=${token}`,
        Accept: 'text/html',
      })
      expect(res.status).toBe(403)
    })

    it('3.4: non-admin flyer requesting /admin with Accept: application/json receives HTTP 403 JSON', async () => {
      const flyer = await seedTestUser({ role: 'flyer' })
      const token = await signSession(flyer.id)

      const res = await fetchGet('/admin', {
        Cookie: `triplet_session=${token}`,
        Accept: 'application/json',
      })

      expect(res.status).toBe(403)
      const json = await res.json() as any
      expect(json.error).toBe('Forbidden')
      expect(json.message).toBe('Administrator privileges required')
    })

    it('3.5: non-admin flyer cannot mutate administrative state via POST endpoints', async () => {
      const flyer = await seedTestUser({ role: 'flyer', displayName: 'Attacker' })
      const token = await signSession(flyer.id)
      const cookie = { Cookie: `triplet_session=${token}` }

      // Attempt user creation
      const postUserRes = await fetchPostForm('/admin/users', {
        email: 'attacker2@example.com',
        displayName: 'Attacker 2',
        role: 'admin',
      }, cookie)
      expect(postUserRes.status).toBe(403)

      // Attempt user status toggle
      const postStatusRes = await fetchPostForm(`/admin/users/${flyer.id}/status`, {}, cookie)
      expect(postStatusRes.status).toBe(403)

      // Attempt user edit
      const postEditRes = await fetchPostForm(`/admin/users/${flyer.id}/edit`, {
        role: 'admin',
      }, cookie)
      expect(postEditRes.status).toBe(403)

      // Attempt user deletion
      const postDeleteRes = await fetchPostForm(`/admin/users/${flyer.id}/delete`, {}, cookie)
      expect(postDeleteRes.status).toBe(403)

      // Attempt site settings modification
      const postSettingsRes = await fetchPostForm('/admin/settings', {
        site_name: 'Hacked Site',
      }, cookie)
      expect(postSettingsRes.status).toBe(403)
    })
  })

  describe('Suite 4: Role Boundary & Session Security Adversarial Stress Tests', () => {
    it('4.1: arbitrary non-admin role strings (member, guest, rso, prefect, empty) strictly return 403', async () => {
      const candidateRoles = ['member', 'guest', 'rso', 'prefect', 'ADMIN', 'Admin', 'admin ', '']

      for (const testRole of candidateRoles) {
        const user = await seedTestUser({ displayName: `User with role ${testRole}` })
        await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(testRole, user.id).run()

        const token = await signSession(user.id)
        const res = await fetchGet('/admin', {
          Cookie: `triplet_session=${token}`,
          Accept: 'text/html',
        })

        expect(res.status, `Role "${testRole}" was improperly permitted`).toBe(403)

        const navRes = await fetchGet('/', { Cookie: `triplet_session=${token}` })
        const navHtml = await navRes.text()
        expect(navHtml, `Role "${testRole}" was shown Admin nav link`).not.toMatch(/href=["']\/admin(\/users)?["']/i)
      }
    })

    it('4.2: deactivated admin account (isActive: false) cannot access /admin and redirects to /login', async () => {
      const admin = await seedTestUser({ role: 'admin', isActive: false, displayName: 'Deactivated Admin' })
      const token = await signSession(admin.id)

      const res = await fetchGet('/admin', {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      expect([302, 303]).toContain(res.status)
      expect(res.headers.get('Location')).toMatch(/\/login/)
    })

    it('4.3: invalid or forged session cookie on /admin redirects to /login', async () => {
      const res = await fetchGet('/admin', {
        Cookie: 'triplet_session=forged_invalid_jwt_signature_here',
      }, { redirect: 'manual' })

      expect([302, 303]).toContain(res.status)
      expect(res.headers.get('Location')).toMatch(/\/login/)
    })

    it('4.4: revoked session token on /admin redirects to /login', async () => {
      const admin = await seedTestUser({ role: 'admin', displayName: 'Revoked Admin' })
      const token = await signSession(admin.id)

      // Revoke the token
      const now = Date.now()
      await env.DB.prepare(
        "INSERT INTO site_settings (key, value, created_at, updated_at) VALUES (?, 'revoked', ?, ?)"
      ).bind(`revoked_session:${token}`, now, now).run()

      const res = await fetchGet('/admin', {
        Cookie: `triplet_session=${token}`,
      }, { redirect: 'manual' })

      expect([302, 303]).toContain(res.status)
      expect(res.headers.get('Location')).toMatch(/\/login/)
    })
  })

  describe('Suite 5: Admin User Access & Operations', () => {
    it('5.1: genuine admin accesses GET /admin and renders administration dashboard', async () => {
      const admin = await seedTestUser({ role: 'admin', displayName: 'Chief Administrator' })
      const token = await signSession(admin.id)

      const res = await fetchGet('/admin', {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/Site Administration\s*(&amp;|&)\s*User Management/i)
      expect(html).toContain('Chief Administrator')
      expect(html).toContain('Provision New User')
      expect(html).toContain('Range & Site Settings')
    })
  })

  describe('Suite 6: Milestone 2 Launch Event Operational Roles (R3 Verification)', () => {
    it('6.1: event creation accepts Launch Director and Tripoli Prefect with past dates', async () => {
      const flyer = await seedTestUser({ role: 'flyer', displayName: 'Launch Lead' })
      const token = await signSession(flyer.id)
      const site = await seedTestSite({ createdBy: flyer.id })

      const createRes = await fetchPostForm('/events', {
        name: 'Historical Outback Launch 2019',
        launch_site_id: site.id,
        date: '2019-06-15',
        launch_director: 'Commander Shepard',
        tripoli_prefect: 'Garrus Vakarian',
        rso_user_id: '',
        lco_user_id: '',
      }, { Cookie: `triplet_session=${token}` }, { redirect: 'manual' })

      expect([302, 303]).toContain(createRes.status)
      const location = createRes.headers.get('Location') ?? ''
      expect(location).toMatch(/\/events\/.+/)

      // Fetch created event detail view
      const detailRes = await fetchGet(location, { Cookie: `triplet_session=${token}` })
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain('Historical Outback Launch 2019')
      expect(detailHtml).toContain('Commander Shepard')
      expect(detailHtml).toContain('Garrus Vakarian')
    })

    it('6.2: event creation with invalid/non-existent user ID does not crash with 500 error', async () => {
      const flyer = await seedTestUser({ role: 'flyer' })
      const token = await signSession(flyer.id)
      const site = await seedTestSite({ createdBy: flyer.id })

      const res = await fetchPostForm('/events', {
        name: 'Resilient Event',
        launch_site_id: site.id,
        date: '2026-10-01',
        rso_user_id: 'non-existent-user-uuid-99999',
        lco_user_id: 'another-fake-uuid-00000',
        launch_director: 'Liara TSoni',
      }, { Cookie: `triplet_session=${token}` }, { redirect: 'manual' })

      // Must complete redirect or return 400 validation error, but NEVER 500
      expect(res.status).not.toBe(500)
      expect([200, 302, 303, 400]).toContain(res.status)
    })
  })
})
