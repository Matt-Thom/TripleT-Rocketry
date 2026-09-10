/**
 * Tier 5 Adversarial Verification Suite for Milestone 7 (Requirements R1, R3, R5):
 * Core Security, Role Enforcement, Operational Leadership, Profile & Passkeys.
 *
 * Authored by: m7_challenger_1_gen2 (M7 Adversarial Challenger - Core & Security)
 *
 * Focus:
 * - R1: Admin navigation gating, dashboard widget suppression, route protection (403 Forbidden for non-admins,
 *       verb fuzzing, session spoofing resistance, self-demotion/deactivation safeguards).
 * - R3: Launch event operational roles (Launch Director, Tripoli Prefect), past event creation resilience,
 *       unassigned officers, FK sanitization, XSS mitigation, internationalization.
 * - R5: Dedicated /profile route, self-service WebAuthn passkey registration, multi-passkey management,
 *       cross-tenant isolation, rocketry certifications (TRA, ARA, NAR across levels 0–3),
 *       multi-club memberships and audit-preserving soft deletion.
 */

import { env, SELF } from 'cloudflare:test'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { getActiveFlyer } from '../src/db/context'
import { signSession } from '../src/services/auth'
import {
  getDb,
  seedTestCert,
  seedTestClubMembership,
  seedTestSite,
  seedTestUser,
  truncateDb,
} from './helpers/db'
import { assertHtmlResponse } from './helpers/html'
import { fetchGet, fetchPostForm } from './helpers/http'

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

describe('Milestone 7 Tier 5 Adversarial Suite: Core & Security (R1, R3, R5)', () => {
  // =========================================================================
  // VECTOR 1: Requirement R1 - Admin RBAC, Route Guarding & Navigation
  // =========================================================================
  describe('Vector 1: R1 Admin RBAC, Navigation Gating & Route Protection', () => {
    it('1.1: non-admin flyer receives HTTP 403 with user-friendly forbiddenView on GET /admin', async () => {
      const flyer = await seedTestUser({ role: 'flyer', displayName: 'Regular Pilot' })
      const token = await signSession(flyer.id)

      const res = await fetchGet('/admin', {
        Cookie: `triplet_session=${token}`,
        Accept: 'text/html',
      })

      expect(res.status).toBe(403)
      const html = await res.text()

      expect(html).toContain('403 — Forbidden')
      expect(html).toContain('Administrator privileges are required')
      expect(html).toContain('Return to Dashboard')
      expect(html).toMatch(/href=["']\/["']/)

      // Ensure no administrative UI components leaked
      expect(html).not.toContain('Provision New User')
      expect(html).not.toContain('Site Settings')
      expect(html).not.toContain('Site Administration & User Management')
    })

    it('1.2: non-admin flyer receives HTTP 403 JSON when requesting /admin with Accept: application/json', async () => {
      const flyer = await seedTestUser({ role: 'flyer' })
      const token = await signSession(flyer.id)

      const res = await fetchGet('/admin', {
        Cookie: `triplet_session=${token}`,
        Accept: 'application/json',
      })

      expect(res.status).toBe(403)
      const json = (await res.json()) as any
      expect(json.error).toBe('Forbidden')
      expect(json.message).toBe('Administrator privileges required')
    })

    it('1.3: HTTP verb fuzzing on /admin: non-admin flyer receives HTTP 403 across PUT, DELETE, PATCH, POST', async () => {
      const flyer = await seedTestUser({ role: 'flyer' })
      const token = await signSession(flyer.id)
      const headers = {
        Cookie: `triplet_session=${token}`,
        Accept: 'application/json',
      }

      const verbs: Array<'POST' | 'PUT' | 'DELETE' | 'PATCH'> = ['POST', 'PUT', 'DELETE', 'PATCH']
      for (const method of verbs) {
        const res = await SELF.fetch('https://example.com/admin', {
          method,
          headers,
          body: JSON.stringify({ malicious_action: true }),
        })
        expect(res.status, `Method ${method} on /admin should return 403 Forbidden`).toBe(403)
      }
    })

    it('1.4: non-admin flyer receives HTTP 403 on all administrative endpoints and mutations are blocked', async () => {
      const flyer = await seedTestUser({ role: 'flyer', displayName: 'Attacker Flyer' })
      const token = await signSession(flyer.id)
      const cookie = { Cookie: `triplet_session=${token}` }

      // 1. GET /admin/users
      const getUsersRes = await fetchGet('/admin/users', cookie)
      expect(getUsersRes.status).toBe(403)

      // 2. GET /admin/settings
      const getSettingsRes = await fetchGet('/admin/settings', cookie)
      expect(getSettingsRes.status).toBe(403)

      // 3. POST /admin/users (provisioning)
      const postUserRes = await fetchPostForm('/admin/users', {
        email: 'injected_admin@example.com',
        displayName: 'Injected Admin',
        role: 'admin',
        password: 'password123!',
      }, cookie)
      expect(postUserRes.status).toBe(403)

      // 4. POST /admin/users/:id/edit
      const postEditRes = await fetchPostForm(`/admin/users/${flyer.id}/edit`, {
        role: 'admin',
      }, cookie)
      expect(postEditRes.status).toBe(403)

      // 5. POST /admin/users/:id/status
      const postStatusRes = await fetchPostForm(`/admin/users/${flyer.id}/status`, {
        is_active: 'false',
      }, cookie)
      expect(postStatusRes.status).toBe(403)

      // 6. POST /admin/users/:id/delete
      const postDeleteRes = await fetchPostForm(`/admin/users/${flyer.id}/delete`, {}, cookie)
      expect(postDeleteRes.status).toBe(403)

      // 7. POST /admin/settings
      const postSettingsRes = await fetchPostForm('/admin/settings', {
        site_name: 'Compromised Rocketry Club',
      }, cookie)
      expect(postSettingsRes.status).toBe(403)

      // Direct D1 verification: injected user does not exist
      const db = getDb()
      const [injected] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, 'injected_admin@example.com'))
      expect(injected).toBeUndefined()
    })

    it('1.5: unauthenticated requests on /admin endpoints redirect to /login (HTML) or return 401 (JSON)', async () => {
      // HTML request redirects to /login with preserved redirect query param
      const htmlRes = await fetchGet('/admin', { Accept: 'text/html' }, { redirect: 'manual' })
      expect([302, 303]).toContain(htmlRes.status)
      const location = htmlRes.headers.get('Location') ?? ''
      expect(location).toMatch(/\/login\?redirect=%2Fadmin/)

      // JSON request returns 401 Unauthorized
      const jsonRes = await fetchGet('/admin', { Accept: 'application/json' }, { redirect: 'manual' })
      expect(jsonRes.status).toBe(401)
      const json = (await jsonRes.json()) as any
      expect(json.error).toBe('Unauthorized')

      // Unauthenticated mutation attempt
      const postRes = await fetchPostForm('/admin/users', {
        email: 'unauth@example.com',
        displayName: 'Unauth User',
      }, {}, { redirect: 'manual' })
      expect([302, 303, 401]).toContain(postRes.status)
    })

    it('1.6: non-admin flyer views strictly hide Admin links and dashboard widgets across all pages', async () => {
      const flyer = await seedTestUser({ role: 'flyer', displayName: 'Standard Member' })
      const token = await signSession(flyer.id)
      const cookie = { Cookie: `triplet_session=${token}` }

      const routes = ['/', '/profile', '/events', '/flights', '/rockets', '/motors', '/inventory', '/sites']
      for (const route of routes) {
        const res = await fetchGet(route, cookie)
        assertHtmlResponse(res, 200)
        const html = await res.text()

        // Verify zero href attributes linking to /admin
        expect(html, `Route ${route} leaked /admin href`).not.toMatch(/href=["']\/admin(\/[^"']*)?["']/i)

        // Verify desktop nav does not render Admin
        const desktopNavMatch = /<nav[^>]*aria-label="Main navigation"[^>]*>([\s\S]*?)<\/nav>/i.exec(html)
        if (desktopNavMatch) {
          expect(desktopNavMatch[1], `Route ${route} desktop nav rendered Admin`).not.toMatch(/Admin/i)
        }

        // Verify mobile nav does not render Admin
        const mobileNavMatch = /<nav[^>]*aria-label="Mobile navigation"[^>]*>([\s\S]*?)<\/nav>/i.exec(html)
        if (mobileNavMatch) {
          expect(mobileNavMatch[1], `Route ${route} mobile nav rendered Admin`).not.toMatch(/Admin/i)
          expect(mobileNavMatch[1], `Route ${route} mobile nav rendered gear emoji`).not.toContain('⚙️')
        }
      }

      // Explicitly check dashboard widgets
      const dashRes = await fetchGet('/', cookie)
      const dashHtml = await dashRes.text()
      expect(dashHtml).not.toMatch(/admin\s*dashboard/i)
      expect(dashHtml).not.toMatch(/site\s*administration/i)
      expect(dashHtml).not.toMatch(/user\s*management/i)
    })

    it('1.7: genuine administrator sees Admin navigation links on desktop and mobile', async () => {
      const admin = await seedTestUser({ role: 'admin', displayName: 'Chief Administrator' })
      const token = await signSession(admin.id)
      const cookie = { Cookie: `triplet_session=${token}` }

      const res = await fetchGet('/', cookie)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Desktop top nav
      expect(html).toMatch(/<nav[^>]*aria-label="Main navigation"[^>]*>[\s\S]*?<a\s+href="\/admin\/users"[^>]*>Admin<\/a>[\s\S]*?<\/nav>/i)

      // Mobile bottom nav
      expect(html).toMatch(/<nav[^>]*aria-label="Mobile navigation"[^>]*>[\s\S]*?<a\s+href="\/admin\/users"[^>]*>[\s\S]*?⚙️[\s\S]*?<span>Admin<\/span>[\s\S]*?<\/a>[\s\S]*?<\/nav>/i)
    })

    it('1.8: privilege escalation prevention: submitting { role: "admin" } via POST /profile fails to elevate role', async () => {
      const flyer = await seedTestUser({ role: 'flyer', displayName: 'Innocent Flyer' })
      const token = await signSession(flyer.id)
      const cookie = { Cookie: `triplet_session=${token}` }

      // Flyer attempts to pass role='admin' in profile update
      const updateRes = await fetchPostForm('/profile', {
        displayName: 'Sneaky Flyer',
        role: 'admin',
      }, cookie, { redirect: 'manual' })

      expect([302, 303]).toContain(updateRes.status)

      // Verify D1 state: role MUST remain 'flyer'
      const db = getDb()
      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, flyer.id))
      expect(user.displayName).toBe('Sneaky Flyer')
      expect(user.role).toBe('flyer')

      // Verify user still cannot access /admin
      const adminRes = await fetchGet('/admin', cookie)
      expect(adminRes.status).toBe(403)
    })

    it('1.9: session spoofing resistance: session cookie takes precedence over forged identity headers', async () => {
      const flyer = await seedTestUser({ role: 'flyer', email: 'flyer@test.local' })
      const admin = await seedTestUser({ role: 'admin', email: 'admin@test.local' })

      const flyerToken = await signSession(flyer.id)

      // Attacker sends regular flyer cookie but attaches spoofed headers pointing to admin
      const res = await fetchGet('/admin', {
        Cookie: `triplet_session=${flyerToken}`,
        'x-flyer-id': admin.id,
        'x-flyer-email': admin.email,
        'cf-access-authenticated-user-email': admin.email,
        Accept: 'text/html',
      })

      // Authenticated session belongs to flyer, so 403 Forbidden must be returned
      expect(res.status).toBe(403)
    })

    it('1.10: admin safeguards: protects last admin from demotion and deletion, and prevents self-deactivation', async () => {
      const admin = await seedTestUser({ role: 'admin', displayName: 'Sole Admin' })
      const token = await signSession(admin.id)
      const cookie = { Cookie: `triplet_session=${token}` }

      // 1. Attempt to demote sole admin to flyer -> HTTP 400
      const demoteRes = await fetchPostForm(`/admin/users/${admin.id}/edit`, {
        role: 'flyer',
      }, cookie)
      expect(demoteRes.status).toBe(400)
      const demoteText = await demoteRes.text()
      expect(demoteText).toContain('Cannot demote the last active administrator')

      // 2. Attempt to delete sole admin -> HTTP 400
      const deleteRes = await fetchPostForm(`/admin/users/${admin.id}/delete`, {}, cookie)
      expect(deleteRes.status).toBe(400)
      const deleteText = await deleteRes.text()
      expect(deleteText).toContain('Cannot delete')

      // 3. Attempt self-deactivation -> HTTP 400
      const deactivateRes = await fetchPostForm(`/admin/users/${admin.id}/status`, {
        is_active: 'false',
      }, cookie)
      expect(deactivateRes.status).toBe(400)
      const deactText = await deactivateRes.text()
      expect(deactText).toContain('Cannot deactivate your own account')

      // 4. Multi-admin demotion test: create second admin, demote second admin, verify second admin loses access
      const admin2 = await seedTestUser({ role: 'admin', displayName: 'Second Admin' })
      const token2 = await signSession(admin2.id)

      // Admin 1 demotes Admin 2 to flyer -> succeeds
      const demote2Res = await fetchPostForm(`/admin/users/${admin2.id}/edit`, {
        role: 'flyer',
      }, cookie, { redirect: 'manual' })
      expect([302, 303]).toContain(demote2Res.status)

      // Admin 2 now requests /admin -> receives 403 Forbidden
      const admin2AccessRes = await fetchGet('/admin', {
        Cookie: `triplet_session=${token2}`,
      })
      expect(admin2AccessRes.status).toBe(403)
    })
  })

  // =========================================================================
  // VECTOR 2: Requirement R3 - Launch Event Operational Roles & Resilience
  // =========================================================================
  describe('Vector 2: R3 Launch Event Operational Roles & Event Creation Resilience', () => {
    it('2.1: event creation persists Launch Director and Tripoli Prefect, displaying both in list and detail views', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestSite({ name: 'Woomera Rocket Range' })
      const cookie = { Cookie: `triplet_session=${token}` }

      const createRes = await fetchPostForm('/events', {
        name: 'Thunder Down Under 2026',
        launch_site_id: site.id,
        starts_on: '2026-11-20',
        ends_on: '2026-11-22',
        padCount: '16',
        launch_director: 'Gene Kranz',
        tripoli_prefect: 'Christopher Kraft',
        weather_notes: 'Clear skies with light south-westerly breeze.',
      }, cookie, { redirect: 'manual' })

      expect([302, 303]).toContain(createRes.status)
      const location = createRes.headers.get('Location') ?? ''
      expect(location).toMatch(/\/events\/.+/)
      const eventId = location.split('/').pop()!

      // Verify direct D1 state
      const db = getDb()
      const [event] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, eventId))
      expect(event).toBeDefined()
      expect(event.launchDirector).toBe('Gene Kranz')
      expect(event.tripoliPrefect).toBe('Christopher Kraft')
      expect(event.padCount).toBe(16)

      // Verify GET /events/:id (detail view)
      const detailRes = await fetchGet(location, cookie)
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain('Thunder Down Under 2026')
      expect(detailHtml).toContain('Gene Kranz')
      expect(detailHtml).toContain('Christopher Kraft')
      expect(detailHtml).toContain('16 Launch Pads')

      // Verify GET /events (list view)
      const listRes = await fetchGet('/events', cookie)
      assertHtmlResponse(listRes, 200)
      const listHtml = await listRes.text()
      expect(listHtml).toContain('Thunder Down Under 2026')
      expect(listHtml).toContain('Director: Gene Kranz')
      expect(listHtml).toContain('Prefect: Christopher Kraft')
    })

    it('2.2: past event creation resilience: accepts extreme past dates without 500 error and renders cleanly', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestSite({ name: 'Historical Launch Pad' })
      const cookie = { Cookie: `triplet_session=${token}` }

      const pastDates = [
        { starts: '1969-07-20', ends: '1969-07-24', name: 'Apollo 11 Historical Meet' },
        { starts: '1903-12-17', ends: '1903-12-17', name: 'Kitty Hawk Memorial' },
        { starts: '1800-01-01', ends: '1800-01-02', name: 'Congreve Rocket Test Meet' },
      ]

      for (const testItem of pastDates) {
        const createRes = await fetchPostForm('/events', {
          name: testItem.name,
          launch_site_id: site.id,
          starts_on: testItem.starts,
          ends_on: testItem.ends,
          launch_director: 'Historical Director',
          tripoli_prefect: 'Historical Prefect',
        }, cookie, { redirect: 'manual' })

        expect([302, 303]).toContain(createRes.status)
        const location = createRes.headers.get('Location') ?? ''

        // Detail view verification
        const detailRes = await fetchGet(location, cookie)
        expect(detailRes.status).toBe(200)
        const html = await detailRes.text()
        expect(html).toContain(testItem.name)
        expect(html).toContain(testItem.starts)
      }
    })

    it('2.3: inverted date window (starts_on > ends_on) completes with redirect and renders without 500 error', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestSite()
      const cookie = { Cookie: `triplet_session=${token}` }

      const res = await fetchPostForm('/events', {
        name: 'Inverted Meet Timeline',
        launch_site_id: site.id,
        starts_on: '2026-12-31',
        ends_on: '2026-01-01',
      }, cookie, { redirect: 'manual' })

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('Location') ?? ''

      const detailRes = await fetchGet(location, cookie)
      expect(detailRes.status).toBe(200)
    })

    it('2.4: unassigned officer fields: omitting or passing empty/whitespace strings cleanly persists null in D1', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestSite()
      const cookie = { Cookie: `triplet_session=${token}` }

      const res = await fetchPostForm('/events', {
        name: 'Solo Unassigned Meet',
        launch_site_id: site.id,
        rso_user_id: '   ',
        lco_user_id: '',
        launch_director: '  \t  ',
        tripoli_prefect: '',
      }, cookie, { redirect: 'manual' })

      expect([302, 303]).toContain(res.status)
      const eventId = (res.headers.get('Location') ?? '').split('/').pop()!

      const db = getDb()
      const [event] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, eventId))
      expect(event.rsoUserId).toBeNull()
      expect(event.lcoUserId).toBeNull()
      expect(event.launchDirector).toBeNull()
      expect(event.tripoliPrefect).toBeNull()

      // Verify rendering on detail page: shows "None designated"
      const detailRes = await fetchGet(`/events/${eventId}`, cookie)
      const html = await detailRes.text()
      expect(html).toContain('None designated')
    })

    it('2.5: foreign key resilience: arbitrary strings, non-existent UUIDs, and SQL injection strings coerce to null without 500 error', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestSite()
      const cookie = { Cookie: `triplet_session=${token}` }

      const maliciousOfficers = [
        { rso: 'Capt.James.T.Kirk', lco: 'Cmdr.Spock' },
        { rso: crypto.randomUUID(), lco: '00000000-0000-0000-0000-000000000000' },
        { rso: "'; DROP TABLE launch_events; --", lco: "' OR 1=1; --" },
      ]

      for (const item of maliciousOfficers) {
        const res = await fetchPostForm('/events', {
          name: `Resilient Officer Meet ${item.rso.slice(0, 10)}`,
          launch_site_id: site.id,
          rso_user_id: item.rso,
          lco_user_id: item.lco,
        }, cookie, { redirect: 'manual' })

        // MUST succeed with redirect, never 500
        expect(res.status).not.toBe(500)
        expect([302, 303]).toContain(res.status)
        const eventId = (res.headers.get('Location') ?? '').split('/').pop()!

        // Foreign keys must be safely coerced to null in D1
        const db = getDb()
        const [event] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, eventId))
        expect(event.rsoUserId).toBeNull()
        expect(event.lcoUserId).toBeNull()
      }
    })

    it('2.6: dual-role officer assignment: same valid user assigned as both RSO and LCO persists and renders properly', async () => {
      const flyer = await seedTestUser({ displayName: 'Lead Safety Officer' })
      const token = await signSession(flyer.id)
      const site = await seedTestSite()
      const cookie = { Cookie: `triplet_session=${token}` }

      const res = await fetchPostForm('/events', {
        name: 'Dual Role Range Meet',
        launch_site_id: site.id,
        rso_user_id: flyer.id,
        lco_user_id: flyer.id,
      }, cookie, { redirect: 'manual' })

      expect([302, 303]).toContain(res.status)
      const eventId = (res.headers.get('Location') ?? '').split('/').pop()!

      const db = getDb()
      const [event] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, eventId))
      expect(event.rsoUserId).toBe(flyer.id)
      expect(event.lcoUserId).toBe(flyer.id)

      // Detail view renders flyer display name for both
      const detailRes = await fetchGet(`/events/${eventId}`, cookie)
      const html = await detailRes.text()
      expect(html).toContain('Lead Safety Officer')
    })

    it('2.7: XSS script injection mitigation: script tags in operational roles are stored verbatim but safely HTML escaped', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestSite()
      const cookie = { Cookie: `triplet_session=${token}` }

      const xssDirector = '<script>alert("xss-director")</script>'
      const xssPrefect = '<b onmouseover="alert(\'xss-prefect\')">HoverPrefect</b>'

      const res = await fetchPostForm('/events', {
        name: 'XSS Escape Meet',
        launch_site_id: site.id,
        launch_director: xssDirector,
        tripoli_prefect: xssPrefect,
      }, cookie, { redirect: 'manual' })

      expect([302, 303]).toContain(res.status)
      const eventId = (res.headers.get('Location') ?? '').split('/').pop()!

      // Direct D1 persistence retains raw string
      const db = getDb()
      const [event] = await db.select().from(schema.launchEvents).where(eq(schema.launchEvents.id, eventId))
      expect(event.launchDirector).toBe(xssDirector)
      expect(event.tripoliPrefect).toBe(xssPrefect)

      // Detail view renders escaped HTML, not executable script
      const detailRes = await fetchGet(`/events/${eventId}`, cookie)
      const html = await detailRes.text()
      expect(html).not.toContain('<script>alert("xss-director")</script>')
      expect(html).toContain('&lt;script&gt;alert(&quot;xss-director&quot;)&lt;/script&gt;')
    })

    it('2.8: unicode and international characters in operational roles persist and render cleanly', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestSite()
      const cookie = { Cookie: `triplet_session=${token}` }

      const unicodeDirector = '👨‍🚀 Director Jörg von Braun'
      const unicodePrefect = '🚀 Prefect 佐藤 航'

      const res = await fetchPostForm('/events', {
        name: 'Global Rocketry Summit',
        launch_site_id: site.id,
        launch_director: unicodeDirector,
        tripoli_prefect: unicodePrefect,
      }, cookie, { redirect: 'manual' })

      expect([302, 303]).toContain(res.status)
      const eventId = (res.headers.get('Location') ?? '').split('/').pop()!

      const detailRes = await fetchGet(`/events/${eventId}`, cookie)
      const html = await detailRes.text()
      expect(html).toContain('👨‍🚀 Director Jörg von Braun')
      expect(html).toContain('🚀 Prefect 佐藤 航')
    })

    it('2.9: host site validation: missing or invalid launch_site_id returns HTTP 400 validation error', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = { Cookie: `triplet_session=${token}` }

      // Missing site ID
      const missingRes = await fetchPostForm('/events', {
        name: 'Siteless Event',
        launch_site_id: '',
      }, cookie)
      expect(missingRes.status).toBe(400)

      // Non-existent site ID
      const fakeSiteRes = await fetchPostForm('/events', {
        name: 'Fake Site Event',
        launch_site_id: crypto.randomUUID(),
      }, cookie)
      expect(fakeSiteRes.status).toBe(400)
    })
  })

  // =========================================================================
  // VECTOR 3: Requirement R5 - User Profile, Passkeys, Certifications & Clubs
  // =========================================================================
  describe('Vector 3: R5 User Profile, Passkeys, Certifications & Multi-Club Tracking', () => {
    it('3.1: dedicated /profile route renders all 4 cards for flyer and hides admin features', async () => {
      const flyer = await seedTestUser({
        role: 'flyer',
        displayName: 'Aero Pilot',
        email: 'pilot@rocketry.local',
        regulatoryRegion: 'SA',
      })
      const token = await signSession(flyer.id)
      const cookie = { Cookie: `triplet_session=${token}` }

      const res = await fetchGet('/profile', cookie)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Header & badge
      expect(html).toContain('Pilot Profile &amp; Settings')
      expect(html).toContain('Certified Flyer')
      expect(html).not.toContain('Administrator')
      expect(html).not.toContain('/admin/users')

      // 4 cards present
      expect(html).toContain('Pilot Profile Information')
      expect(html).toContain('WebAuthn Passkey Credentials')
      expect(html).toContain('Rocketry Certifications')
      expect(html).toContain('Club Memberships')
    })

    it('3.2: unauthenticated GET and POST on /profile enforce access control', async () => {
      // GET HTML -> 302 redirect
      const getHtmlRes = await fetchGet('/profile', { 'x-no-auth': 'true', Accept: 'text/html' }, { redirect: 'manual' })
      expect(getHtmlRes.status).toBe(302)
      expect(getHtmlRes.headers.get('Location')).toMatch(/\/login\?redirect=%2Fprofile/)

      // GET JSON -> 401 Unauthorized
      const getJsonRes = await fetchGet('/profile', { 'x-no-auth': 'true', Accept: 'application/json' })
      expect(getJsonRes.status).toBe(401)

      // POST HTML form with Accept: text/html -> 302 redirect
      const postHtmlRes = await fetchPostForm(
        '/profile',
        { displayName: 'Hacker' },
        { 'x-no-auth': 'true', Accept: 'text/html' },
        { redirect: 'manual' },
      )
      expect(postHtmlRes.status).toBe(302)
      expect(postHtmlRes.headers.get('Location')).toMatch(/\/login\?redirect=%2Fprofile/)

      // POST JSON without auth -> 401 Unauthorized
      const postJsonRes = await SELF.fetch('https://example.com/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-no-auth': 'true',
        },
        body: JSON.stringify({ displayName: 'Hacker' }),
      })
      expect(postJsonRes.status).toBe(401)
    })

    it('3.3: self-service WebAuthn passkey registration: fetches options, verifies credential, and displays in profile', async () => {
      const flyer = await seedTestUser({ displayName: 'FIDO Flyer', email: 'fido@rocketry.local' })
      const token = await signSession(flyer.id)
      const cookie = { Cookie: `triplet_session=${token}` }

      // 1. Request registration options challenge
      const optRes = await SELF.fetch('https://example.com/auth/webauthn/register-options', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          ...cookie,
        },
      })
      expect(optRes.status).toBe(200)
      const optData = (await optRes.json()) as any
      expect(optData.challenge).toBeDefined()
      expect(optData.rp.name).toBe('TripleT Rocketry')
      expect(optData.user.id).toBe(flyer.id)
      expect(optData.user.name).toBe('fido@rocketry.local')

      // 2. Complete passkey registration
      const credId = 'cred-fido2-device-001'
      const verifyRes = await SELF.fetch('https://example.com/auth/webauthn/register-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...cookie,
        },
        body: JSON.stringify({
          id: credId,
          friendlyName: 'MacBook Platform Authenticator',
          publicKey: 'mock-p256-public-key-bytes',
        }),
      })

      expect(verifyRes.status).toBe(200)
      const verifyJson = (await verifyRes.json()) as any
      expect(verifyJson.status).toBe('ok')
      expect(verifyJson.verified).toBe(true)

      // 3. Verify D1 persistence
      const db = getDb()
      const [cred] = await db.select().from(schema.userCredentials).where(eq(schema.userCredentials.id, credId))
      expect(cred).toBeDefined()
      expect(cred.userId).toBe(flyer.id)
      expect(cred.friendlyName).toBe('MacBook Platform Authenticator')

      // 4. Verify rendering on /profile
      const profileRes = await fetchGet('/profile', cookie)
      const html = await profileRes.text()
      expect(html).toContain('MacBook Platform Authenticator')
      expect(html).toContain(`/profile/passkeys/${credId}/delete`)
    })

    it('3.4: multiple passkey enrollment and passkey management (rename, delete, cross-tenant isolation)', async () => {
      const flyerA = await seedTestUser({ email: 'flyera@test.local' })
      const flyerB = await seedTestUser({ email: 'flyerb@test.local' })

      const tokenA = await signSession(flyerA.id)
      const tokenB = await signSession(flyerB.id)

      const cookieA = { Cookie: `triplet_session=${tokenA}` }
      const cookieB = { Cookie: `triplet_session=${tokenB}` }

      const db = getDb()

      // Seed 2 passkeys for Flyer A
      const credA1 = crypto.randomUUID()
      const credA2 = crypto.randomUUID()
      await db.insert(schema.userCredentials).values([
        { id: credA1, userId: flyerA.id, publicKey: 'key-a1', friendlyName: 'Touch ID Key', createdAt: Date.now() },
        { id: credA2, userId: flyerA.id, publicKey: 'key-a2', friendlyName: 'YubiKey 5C NFC', createdAt: Date.now() },
      ])

      // Seed 1 passkey for Flyer B
      const credB1 = crypto.randomUUID()
      await db.insert(schema.userCredentials).values({
        id: credB1,
        userId: flyerB.id,
        publicKey: 'key-b1',
        friendlyName: 'Flyer B Hardware Token',
        createdAt: Date.now(),
      })

      // Flyer A profile displays both passkeys
      const profileRes = await fetchGet('/profile', cookieA)
      const html = await profileRes.text()
      expect(html).toContain('Touch ID Key')
      expect(html).toContain('YubiKey 5C NFC')
      expect(html).not.toContain('Flyer B Hardware Token')

      // Flyer A renames Touch ID Key
      const renameRes = await fetchPostForm(`/profile/passkeys/${credA1}/rename`, {
        friendly_name: 'Primary MacBook Biometrics',
      }, cookieA, { redirect: 'manual' })
      expect([302, 303]).toContain(renameRes.status)

      const [renamed] = await db.select().from(schema.userCredentials).where(eq(schema.userCredentials.id, credA1))
      expect(renamed.friendlyName).toBe('Primary MacBook Biometrics')

      // CROSS-TENANT ATTACK: Flyer A attempts to delete Flyer B's passkey
      const attackDelRes = await fetchPostForm(`/profile/passkeys/${credB1}/delete`, {}, cookieA, { redirect: 'manual' })
      expect([302, 303]).toContain(attackDelRes.status)

      // Flyer B's passkey MUST STILL EXIST!
      const [intactB] = await db.select().from(schema.userCredentials).where(eq(schema.userCredentials.id, credB1))
      expect(intactB).toBeDefined()
      expect(intactB.userId).toBe(flyerB.id)

      // Flyer A deletes their own key A2
      const delA2Res = await fetchPostForm(`/profile/passkeys/${credA2}/delete`, {}, cookieA, { redirect: 'manual' })
      expect([302, 303]).toContain(delA2Res.status)

      const deletedRows = await db.select().from(schema.userCredentials).where(eq(schema.userCredentials.id, credA2))
      expect(deletedRows).toHaveLength(0)
    })

    it('3.5: rocketry certifications: saves Level 0 Junior and Level 3 HPR across ARA, NAR, TRA with context calculation', async () => {
      const flyer = await seedTestUser({ displayName: 'Cert Pilot' })
      const token = await signSession(flyer.id)
      const cookie = { Cookie: `triplet_session=${token}` }

      // 1. Level 0 Junior certification for TRA
      const resL0 = await fetchPostForm('/profile/certifications', {
        certifying_body: 'TRA',
        level: '0',
        cert_number: 'TRA-JR-42',
        expires_on: '2029-12-31',
      }, cookie, { redirect: 'manual' })
      expect([302, 303]).toContain(resL0.status)

      const db = getDb()
      const [certL0] = await db.select().from(schema.certifications).where(
        and(eq(schema.certifications.userId, flyer.id), eq(schema.certifications.certifyingBody, 'TRA'))
      )
      expect(certL0).toBeDefined()
      expect(certL0.level).toBe(0)
      expect(certL0.certNumber).toBe('TRA-JR-42')

      // ActiveFlyer context correctly reflects Level 0
      let activeFlyer = await getActiveFlyer(db, flyer.id)
      expect(activeFlyer.maxCertLevel).toBe(0)
      expect(activeFlyer.certNumber).toBe('TRA-JR-42')

      // 2. Add ARA Level 3 certification (Maximum HPR)
      const resL3 = await fetchPostForm('/profile/certifications', {
        certifying_body: 'ARA',
        level: '3',
        cert_number: 'ARA-L3-7788',
        expires_on: '2030-06-30',
      }, cookie, { redirect: 'manual' })
      expect([302, 303]).toContain(resL3.status)

      const [certL3] = await db.select().from(schema.certifications).where(
        and(eq(schema.certifications.userId, flyer.id), eq(schema.certifications.certifyingBody, 'ARA'))
      )
      expect(certL3).toBeDefined()
      expect(certL3.level).toBe(3)
      expect(certL3.certNumber).toBe('ARA-L3-7788')

      // ActiveFlyer context resolves highest level (3) and body ARA
      activeFlyer = await getActiveFlyer(db, flyer.id)
      expect(activeFlyer.maxCertLevel).toBe(3)
      expect(activeFlyer.certifyingBody).toBe('ARA')
      expect(activeFlyer.certNumber).toBe('ARA-L3-7788')

      // 3. Boundary clamping: out of range levels clamp properly
      await fetchPostForm('/profile/certifications', {
        certifying_body: 'NAR',
        level: '99', // should clamp to 3
        cert_number: 'NAR-CLAMPED',
      }, cookie, { redirect: 'manual' })

      const [certNAR] = await db.select().from(schema.certifications).where(
        and(eq(schema.certifications.userId, flyer.id), eq(schema.certifications.certifyingBody, 'NAR'))
      )
      expect(certNAR.level).toBe(3)
    })

    it('3.6: certification in-place upsert prevents duplicate active rows for the same certifying body', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = { Cookie: `triplet_session=${token}` }

      // Step 1: Initial TRA Level 1
      await fetchPostForm('/profile/certifications', {
        certifying_body: 'TRA',
        level: '1',
        cert_number: 'TRA-100',
      }, cookie, { redirect: 'manual' })

      // Step 2: Upgrade TRA to Level 2
      await fetchPostForm('/profile/certifications', {
        certifying_body: 'TRA',
        level: '2',
        cert_number: 'TRA-100-L2',
      }, cookie, { redirect: 'manual' })

      const db = getDb()
      const activeCerts = await db.select().from(schema.certifications).where(
        and(
          eq(schema.certifications.userId, flyer.id),
          eq(schema.certifications.certifyingBody, 'TRA'),
          isNull(schema.certifications.deletedAt),
        )
      )

      expect(activeCerts).toHaveLength(1)
      expect(activeCerts[0].level).toBe(2)
      expect(activeCerts[0].certNumber).toBe('TRA-100-L2')
    })

    it('3.7: multi-club memberships tracking and soft deletion audit preservation', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const cookie = { Cookie: `triplet_session=${token}` }

      // Add Club 1: Victorian Rocketry Association
      await fetchPostForm('/profile/clubs', {
        club_name: 'Victorian Rocketry Association',
        membership_number: 'VRA-2026-001',
        expires_on: '2027-12-31',
      }, cookie, { redirect: 'manual' })

      // Add Club 2: Southern Area Rocketry Club
      await fetchPostForm('/profile/clubs', {
        club_name: 'Southern Area Rocketry Club',
        membership_number: 'SARC-404',
        expires_on: '2028-06-30',
      }, cookie, { redirect: 'manual' })

      // Add Club 3: Tripoli South Australia
      await fetchPostForm('/profile/clubs', {
        club_name: 'Tripoli South Australia',
        membership_number: 'TRA-SA-88',
      }, cookie, { redirect: 'manual' })

      const db = getDb()
      const activeClubs = await db.select().from(schema.clubMemberships).where(
        and(eq(schema.clubMemberships.userId, flyer.id), isNull(schema.clubMemberships.deletedAt))
      )
      expect(activeClubs).toHaveLength(3)

      // Profile view displays all 3 clubs
      const profileRes = await fetchGet('/profile', cookie)
      const html = await profileRes.text()
      expect(html).toContain('Victorian Rocketry Association')
      expect(html).toContain('VRA-2026-001')
      expect(html).toContain('Southern Area Rocketry Club')
      expect(html).toContain('SARC-404')
      expect(html).toContain('Tripoli South Australia')
      expect(html).toContain('TRA-SA-88')

      // Empty club name rejection
      const emptyRes = await fetchPostForm('/profile/clubs', {
        club_name: '   ',
      }, cookie, { redirect: 'manual' })
      expect([302, 303, 400]).toContain(emptyRes.status)

      // Soft delete Club 1
      const clubToDelete = activeClubs.find((c) => c.clubName === 'Victorian Rocketry Association')!
      const delRes = await fetchPostForm(`/profile/clubs/${clubToDelete.id}/delete`, {}, cookie, { redirect: 'manual' })
      expect([302, 303]).toContain(delRes.status)

      // Verify soft deletion in D1: record still exists but deletedAt is populated
      const [softDeletedClub] = await db.select().from(schema.clubMemberships).where(eq(schema.clubMemberships.id, clubToDelete.id))
      expect(softDeletedClub).toBeDefined()
      expect(softDeletedClub.deletedAt).not.toBeNull()
      expect(softDeletedClub.deletedAt).toBeGreaterThan(0)

      // Updated profile view hides the soft-deleted club
      const updatedProfileRes = await fetchGet('/profile', cookie)
      const updatedHtml = await updatedProfileRes.text()
      expect(updatedHtml).not.toContain('VRA-2026-001')
      expect(updatedHtml).toContain('SARC-404')
    })

    it('3.8: cross-tenant club deletion attack: Flyer A cannot soft-delete Flyer B club membership', async () => {
      const flyerA = await seedTestUser({ email: 'attacker@club.local' })
      const flyerB = await seedTestUser({ email: 'victim@club.local' })

      const tokenA = await signSession(flyerA.id)
      const cookieA = { Cookie: `triplet_session=${tokenA}` }

      const victimClub = await seedTestClubMembership(flyerB.id, {
        clubName: 'Victim High Power Rocketry Club',
        membershipNumber: 'SECURE-999',
      })

      // Flyer A attempts to delete Flyer B's club
      const attackRes = await fetchPostForm(`/profile/clubs/${victimClub.id}/delete`, {}, cookieA, { redirect: 'manual' })
      expect([302, 303, 404]).toContain(attackRes.status)

      // Verify D1 state: victimClub.deletedAt MUST REMAIN NULL
      const db = getDb()
      const [intactClub] = await db.select().from(schema.clubMemberships).where(eq(schema.clubMemberships.id, victimClub.id))
      expect(intactClub).toBeDefined()
      expect(intactClub.deletedAt).toBeNull()
    })
  })
})
