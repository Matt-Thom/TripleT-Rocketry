/**
 * Forensic Integrity Audit Test Suite for Milestone 2
 * TripleT-Rocketry
 *
 * Verifies:
 * 1. Authentic SQLite D1 persistence of launchDirector and tripoliPrefect (with dynamic random UUIDs).
 * 2. Referential integrity sanitization of officer user IDs against schema.users.
 * 3. Exact HTML rendering in event detail and event listing views.
 * 4. Strict Admin RBAC enforcement (unauthenticated -> 302/401, non-admin flyer -> 403, admin -> 200).
 * 5. Navigation gating across desktop and mobile nav bars.
 */

import { SELF } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { signSession } from '../src/services/auth'
import {
  getDb,
  seedTestSite,
  seedTestUser,
  truncateDb,
} from './helpers/db'
import { assertHtmlResponse } from './helpers/html'
import { fetchGet, fetchPostForm } from './helpers/http'

beforeEach(truncateDb)

describe('Forensic Integrity Audit: Milestone 2', () => {
  describe('Check 1: Authentic SQLite Persistence of Launch Director & Tripoli Prefect', () => {
    it('persists dynamic UUID strings for launchDirector and tripoliPrefect into SQLite via form submission', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const dynamicDirector = `Director-${crypto.randomUUID()}`
      const dynamicPrefect = `Prefect-${crypto.randomUUID()}`
      const eventName = `Meet-${crypto.randomUUID().slice(0, 8)}`

      const res = await fetchPostForm(
        '/events',
        {
          name: eventName,
          launch_site_id: site.id,
          starts_on: '1975-04-12', // Past date
          ends_on: '1975-04-14',
          launch_director: dynamicDirector,
          tripoli_prefect: dynamicPrefect,
          pad_count: 128,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('Location') ?? ''
      expect(location).toMatch(/\/events\//)
      const eventId = location.split('/').pop()!

      // Verify directly against SQLite database via Drizzle ORM
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, eventId))

      expect(saved).toBeDefined()
      expect(saved.name).toBe(eventName)
      expect(saved.launchDirector).toBe(dynamicDirector)
      expect(saved.tripoliPrefect).toBe(dynamicPrefect)
      expect(saved.startsOn).toBe('1975-04-12')
      expect(saved.padCount).toBe(128)

      // Verify rendering in GET /events/:id
      const detailRes = await fetchGet(`/events/${eventId}`, {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toContain(dynamicDirector)
      expect(detailHtml).toContain(dynamicPrefect)

      // Verify rendering in GET /events (list)
      const listRes = await fetchGet('/events', {
        Cookie: `triplet_session=${token}`,
      })
      assertHtmlResponse(listRes, 200)
      const listHtml = await listRes.text()
      expect(listHtml).toContain(dynamicDirector)
      expect(listHtml).toContain(dynamicPrefect)
    })

    it('persists dynamic strings via JSON POST /events', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const dynamicDirector = `JSON-Dir-${crypto.randomUUID()}`
      const dynamicPrefect = `JSON-Pref-${crypto.randomUUID()}`

      const res = await SELF.fetch('https://example.com/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({
          name: 'JSON Created Launch Meet',
          launchSiteId: site.id,
          startsOn: '2027-01-01',
          launchDirector: dynamicDirector,
          tripoliPrefect: dynamicPrefect,
        }),
      })

      expect(res.status).toBe(201)
      const data = (await res.json()) as any
      expect(data.launchDirector).toBe(dynamicDirector)
      expect(data.tripoliPrefect).toBe(dynamicPrefect)

      // Verify directly from SQLite
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, data.id))

      expect(saved.launchDirector).toBe(dynamicDirector)
      expect(saved.tripoliPrefect).toBe(dynamicPrefect)
    })
  })

  describe('Check 2: Genuine Referential Integrity & Officer ID Sanitization', () => {
    it('sanitizes non-existent officer IDs to null and retains valid officer IDs', async () => {
      const db = getDb()
      const creator = await seedTestUser()
      const validRso = await seedTestUser({ displayName: 'Verified RSO' })
      const token = await signSession(creator.id)
      const site = await seedTestSite()

      const nonExistentLcoId = `non-existent-${crypto.randomUUID()}`

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Referential Integrity Test Meet',
          launch_site_id: site.id,
          starts_on: '2026-05-01',
          rso_user_id: validRso.id,
          lco_user_id: nonExistentLcoId,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const eventId = res.headers.get('Location')!.split('/').pop()!

      const [event] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, eventId))

      expect(event).toBeDefined()
      // Valid RSO is preserved
      expect(event.rsoUserId).toBe(validRso.id)
      // Invalid LCO is sanitized to null, avoiding FK violation
      expect(event.lcoUserId).toBeNull()
    })

    it('coerces empty string officer IDs to null', async () => {
      const db = getDb()
      const creator = await seedTestUser()
      const token = await signSession(creator.id)
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Empty Officer Test Meet',
          launch_site_id: site.id,
          starts_on: '2026-05-01',
          rso_user_id: '   ',
          lco_user_id: '',
          launch_director: '   ',
          tripoli_prefect: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)
      const eventId = res.headers.get('Location')!.split('/').pop()!

      const [event] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, eventId))

      expect(event.rsoUserId).toBeNull()
      expect(event.lcoUserId).toBeNull()
      expect(event.launchDirector).toBeNull()
      expect(event.tripoliPrefect).toBeNull()
    })

    it('rejects non-existent launch site with HTTP 400 rather than crashing SQLite', async () => {
      const creator = await seedTestUser()
      const token = await signSession(creator.id)

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Bad Site Meet',
          launch_site_id: 'non-existent-site-id',
          starts_on: '2026-05-01',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect(res.status).toBe(400)
      const html = await res.text()
      expect(html).toMatch(/Invalid Launch Site|was not found/i)
    })
  })

  describe('Check 3: Authentic Admin RBAC & Route Guarding', () => {
    it('unauthenticated cookieless request to /admin redirects to /login (HTTP 302)', async () => {
      const res = await fetchGet('/admin', {}, { redirect: 'manual' })
      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('Location') ?? ''
      expect(location).toContain('/login')
      expect(location).toContain('redirect=')
    })

    it('unauthenticated cookieless request to /admin with JSON returns HTTP 401', async () => {
      const res = await fetchGet('/admin/users', {
        Accept: 'application/json',
      })
      expect(res.status).toBe(401)
      const data = (await res.json()) as any
      expect(data.error).toBe('Unauthorized')
    })

    it('authenticated non-admin flyer accessing /admin returns HTTP 403 Forbidden with friendly error page', async () => {
      const regularFlyer = await seedTestUser({ role: 'flyer' })
      const token = await signSession(regularFlyer.id)

      const res = await fetchGet('/admin', {
        Cookie: `triplet_session=${token}`,
        Accept: 'text/html',
      })

      expect(res.status).toBe(403)
      const html = await res.text()
      expect(html).toContain('403')
      expect(html).toContain('Forbidden')
      expect(html).toContain('Administrator privileges are required')
    })

    it('authenticated non-admin flyer requesting /admin/users with JSON returns HTTP 403 JSON', async () => {
      const regularFlyer = await seedTestUser({ role: 'flyer' })
      const token = await signSession(regularFlyer.id)

      const res = await fetchGet('/admin/users', {
        Cookie: `triplet_session=${token}`,
        Accept: 'application/json',
      })

      expect(res.status).toBe(403)
      const data = (await res.json()) as any
      expect(data.error).toBe('Forbidden')
    })

    it('authenticated administrator accessing /admin receives access', async () => {
      const adminUser = await seedTestUser({ role: 'admin' })
      const token = await signSession(adminUser.id)

      const res = await fetchGet('/admin/users', {
        Cookie: `triplet_session=${token}`,
      })

      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('Site Administration')
    })

    it('non-admin flyer dashboard does not render Admin link', async () => {
      const regularFlyer = await seedTestUser({ role: 'flyer' })
      const token = await signSession(regularFlyer.id)

      const res = await fetchGet('/', {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).not.toMatch(/href="\/admin/i)
      expect(html).not.toMatch(/>\s*Admin\s*</i)
    })

    it('admin user dashboard DOES render Admin link in navigation', async () => {
      const adminUser = await seedTestUser({ role: 'admin' })
      const token = await signSession(adminUser.id)

      const res = await fetchGet('/', {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/href="\/admin\/users"/i)
    })
  })
})
