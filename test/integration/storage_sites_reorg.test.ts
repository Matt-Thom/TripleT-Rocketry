/**
 * Integration Test Suite: Requirement R3 — Propellant Storage Sites Reorganization.
 *
 * Verifies:
 * 1. Primary storage sites CRUD operates under `/sites/storage-sites/*`:
 *    - GET /sites/storage-sites (list)
 *    - GET /sites/storage-sites/new (create form)
 *    - POST /sites/storage-sites (create handler, 303 redirect to /sites/storage-sites/:id)
 *    - GET /sites/storage-sites/:id (detail view)
 *    - GET /sites/storage-sites/:id/edit (edit form)
 *    - POST /sites/storage-sites/:id/edit (update handler, 303 redirect)
 *    - POST /sites/storage-sites/:id/delete & DELETE (soft-delete, 303 redirect)
 * 2. Layout active tab is 'sites' across all storage sites views.
 * 3. Breadcrumbs follow Sites > Storage Sites > [Detail / New / Edit].
 * 4. Legacy routes (/inventory/storage-sites/* and /storage-sites/*) issue HTTP 301 redirects to /sites/storage-sites/*.
 * 5. Legacy POST/DELETE routes (/inventory/storage-sites/*) execute mutations and redirect 303 to /sites/storage-sites/*.
 * 6. Sites hub view (/sites) and Inventory hub view (/inventory) link to /sites/storage-sites.
 * 7. Unauthenticated requests to /sites/storage-sites/* strictly enforce HTTP 302/401 gating.
 */

import { and, eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { SELF } from 'cloudflare:test'
import * as schema from '../../src/db/schema'
import { getDb, seedTestStorageSite, seedTestUser, truncateDb } from '../helpers/db'
import { assertContains, assertHtmlResponse, assertNotContains } from '../helpers/html'
import { fetchGet, fetchHtmxPostForm, fetchPostForm } from '../helpers/http'
import { signSession } from '../../src/services/auth'

beforeEach(truncateDb)

describe('Requirement R3: Propellant Storage Sites Reorganization', () => {
  // =========================================================================
  // 1. Primary CRUD Routes under /sites/storage-sites/*
  // =========================================================================
  describe('1. Primary Routes under /sites/storage-sites/*', () => {
    it('1.1: GET /sites/storage-sites lists storage sites and shows Sites active navigation', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      await seedTestStorageSite(flyer.id, {
        name: 'Monarto Range Magazine Alpha',
        location: 'Range Bunker 1',
        capacityKg: 2.5,
      })

      const res = await fetchGet('/sites/storage-sites', {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Header and content
      assertContains(html, 'Storage Sites')
      assertContains(html, 'Monarto Range Magazine Alpha')
      assertContains(html, 'Range Bunker 1')
      assertContains(html, '2.50')
      assertContains(html, 'Exempt (≤ 3.0 kg)')

      // Back-link points to Sites Hub
      assertContains(html, 'href="/sites"')
      assertContains(html, 'Back to Sites Hub')

      // Add button points to /sites/storage-sites/new
      assertContains(html, 'href="/sites/storage-sites/new"')
    })

    it('1.2: GET /sites/storage-sites renders empty state when flyer has no storage sites', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/sites/storage-sites', {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()
      assertContains(html, 'No Storage Sites Configured')
      assertContains(html, 'href="/sites/storage-sites/new"')
      assertContains(html, 'Register First Storage Site')
    })

    it('1.3: GET /sites/storage-sites with Accept: application/json returns JSON array', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      await seedTestStorageSite(flyer.id, {
        name: 'JSON Storage Depot',
        capacityKg: 1.8,
      })

      const res = await SELF.fetch('https://example.com/sites/storage-sites', {
        headers: {
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
      })

      expect(res.status).toBe(200)
      const json = (await res.json()) as any[]
      expect(Array.isArray(json)).toBe(true)
      expect(json.length).toBe(1)
      expect(json[0].name).toBe('JSON Storage Depot')
      expect(json[0].capacityKg).toBeCloseTo(1.8)
    })

    it('1.4: GET /sites/storage-sites/new renders create form with Sites breadcrumbs', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/sites/storage-sites/new', {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Form action and elements
      assertContains(html, 'action="/sites/storage-sites"')
      assertContains(html, 'name="name"')
      assertContains(html, 'name="capacity_kg"')
      assertContains(html, 'name="permit_number"')
      assertContains(html, 'href="/sites/storage-sites"') // Cancel link

      // Breadcrumb check: Sites > Storage Sites > New Site
      expect(html).toContain('href="/sites"')
      expect(html).toContain('href="/sites/storage-sites"')
      expect(html).toContain('New Site')
    })

    it('1.5: POST /sites/storage-sites creates site and redirects with 303 to /sites/storage-sites/:id', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/sites/storage-sites',
        {
          name: 'Port Wakefield Explosives Bunker',
          location: 'Sector 4 Pad Area',
          capacity_kg: 2.8,
          notes: 'SafeWork SA compliant field storage',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(303)
      const location = res.headers.get('location') || ''
      expect(location).toMatch(/^\/sites\/storage-sites\/[a-zA-Z0-9-]+$/)

      const db = getDb()
      const [created] = await db
        .select()
        .from(schema.storageSites)
        .where(
          and(
            eq(schema.storageSites.userId, flyer.id),
            eq(schema.storageSites.name, 'Port Wakefield Explosives Bunker'),
          ),
        )

      expect(created).toBeDefined()
      expect(created.capacityKg).toBeCloseTo(2.8)
      expect(created.location).toBe('Sector 4 Pad Area')
      expect(location).toBe(`/sites/storage-sites/${created.id}`)
    })

    it('1.6: POST /sites/storage-sites with JSON payload returns 201 Created', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await SELF.fetch('https://example.com/sites/storage-sites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({
          name: 'API JSON Magazine',
          location: 'Lab Safe',
          capacityKg: 2.0,
        }),
      })

      expect(res.status).toBe(201)
      const site = (await res.json()) as any
      expect(site.id).toBeDefined()
      expect(site.name).toBe('API JSON Magazine')
    })

    it('1.7: POST /sites/storage-sites validates name and allows capacity > 3.0 kg without hard limiting', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      // Missing name
      const resNoName = await fetchPostForm(
        '/sites/storage-sites',
        { name: '', capacity_kg: 2.0 },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect(resNoName.status).toBe(400)
      const htmlNoName = await resNoName.text()
      assertContains(htmlNoName, 'Storage site name is required')

      // Capacity > 3.0 without permit succeeds without hard limiting
      const resOverLimit = await fetchPostForm(
        '/sites/storage-sites',
        { name: 'Over Limit Magazine', capacity_kg: 3.5, permit_number: '' },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect(resOverLimit.status).toBe(303)
    })

    it('1.8: GET /sites/storage-sites/:id displays detail view with Sites breadcrumbs', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const site = await seedTestStorageSite(flyer.id, {
        name: 'Aldinga Field Storage Box',
        location: 'Field Pad Area 3',
        capacityKg: 1.5,
        notes: 'AS 2187 earth grounding verified',
      })

      const res = await fetchGet(`/sites/storage-sites/${site.id}`, {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, 'Aldinga Field Storage Box')
      assertContains(html, 'Field Pad Area 3')
      assertContains(html, '1.50')
      assertContains(html, 'Licensed Storage Capacity')
      assertContains(html, 'AS 2187 earth grounding verified')

      // Action links
      assertContains(html, `href="/sites/storage-sites/${site.id}/edit"`)
      assertContains(html, `action="/sites/storage-sites/${site.id}/delete"`)

      // Breadcrumb check: Sites > Storage Sites > Aldinga Field Storage Box
      expect(html).toContain('href="/sites"')
      expect(html).toContain('href="/sites/storage-sites"')
      expect(html).toContain('Aldinga Field Storage Box')
    })

    it('1.9: GET /sites/storage-sites/:id returns 404 for non-existent site', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/sites/storage-sites/non-existent-uuid-99999', {
        Cookie: `triplet_session=${token}`,
      })

      expect(res.status).toBe(404)
      const html = await res.text()
      assertContains(html, 'Storage Site Not Found')
      assertContains(html, 'href="/sites/storage-sites"')
    })

    it('1.10: GET /sites/storage-sites/:id/edit renders edit form with prefilled data', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const site = await seedTestStorageSite(flyer.id, {
        name: 'Strathalbyn Storage Bay 1',
        location: 'Workshop Shed',
        capacityKg: 2.2,
      })

      const res = await fetchGet(`/sites/storage-sites/${site.id}/edit`, {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertContains(html, `action="/sites/storage-sites/${site.id}/edit"`)
      assertContains(html, 'value="Strathalbyn Storage Bay 1"')
      assertContains(html, 'value="Workshop Shed"')
      assertContains(html, 'value="2.2"')
      assertContains(html, 'href="/sites/storage-sites"') // Cancel link

      // Breadcrumbs
      expect(html).toContain('href="/sites"')
      expect(html).toContain('href="/sites/storage-sites"')
      expect(html).toContain('Edit Site')
    })

    it('1.11: POST /sites/storage-sites/:id/edit updates record in D1 and redirects 303', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const site = await seedTestStorageSite(flyer.id, {
        name: 'Original Site Name',
        capacityKg: 2.0,
      })

      const res = await fetchPostForm(
        `/sites/storage-sites/${site.id}/edit`,
        {
          name: 'Updated Site Name',
          location: 'Updated Bay 7',
          capacity_kg: 2.9,
          notes: 'Updated compliance notes',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe(`/sites/storage-sites/${site.id}`)

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.storageSites)
        .where(eq(schema.storageSites.id, site.id))

      expect(updated.name).toBe('Updated Site Name')
      expect(updated.location).toBe('Updated Bay 7')
      expect(updated.capacityKg).toBeCloseTo(2.9)
      expect(updated.notes).toBe('Updated compliance notes')
    })

    it('1.12: POST /sites/storage-sites/:id/delete soft-deletes site and hides from active listings', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const site = await seedTestStorageSite(flyer.id, {
        name: 'Site To Delete',
        capacityKg: 1.0,
      })

      const res = await fetchPostForm(
        `/sites/storage-sites/${site.id}/delete`,
        {},
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe('/sites/storage-sites')

      const db = getDb()
      const [deleted] = await db
        .select()
        .from(schema.storageSites)
        .where(eq(schema.storageSites.id, site.id))

      expect(deleted.deletedAt).toBeTypeOf('number')
      expect(deleted.deletedAt!).toBeGreaterThan(0)

      // Confirm hidden from active listing
      const listRes = await fetchGet('/sites/storage-sites', {
        Cookie: `triplet_session=${token}`,
      })
      const listHtml = await listRes.text()
      assertNotContains(listHtml, 'Site To Delete')
    })

    it('1.13: DELETE /sites/storage-sites/:id with HTMX returns HX-Redirect to /sites/storage-sites', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const site = await seedTestStorageSite(flyer.id, {
        name: 'HTMX Delete Site',
        capacityKg: 1.0,
      })

      const res = await SELF.fetch(`https://example.com/sites/storage-sites/${site.id}`, {
        method: 'DELETE',
        headers: {
          'HX-Request': 'true',
          Cookie: `triplet_session=${token}`,
        },
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('HX-Redirect')).toBe('/sites/storage-sites')
    })
  })

  // =========================================================================
  // 2. Legacy Route 301 Redirects from /inventory/storage-sites/*
  // =========================================================================
  describe('2. Legacy Route 301 Redirects (Requirement R3.2)', () => {
    it('2.1: GET /inventory/storage-sites returns HTTP 301 redirect to /sites/storage-sites', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet(
        '/inventory/storage-sites',
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      expect(res.headers.get('location')).toBe('/sites/storage-sites')
    })

    it('2.2: GET /storage-sites returns HTTP 301 redirect to /sites/storage-sites', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet(
        '/storage-sites',
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      expect(res.headers.get('location')).toMatch(/^\/sites\/storage-sites\/?$/)
    })

    it('2.3: GET /inventory/storage-sites/new returns HTTP 301 redirect to /sites/storage-sites/new', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet(
        '/inventory/storage-sites/new',
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      expect(res.headers.get('location')).toBe('/sites/storage-sites/new')
    })

    it('2.4: GET /inventory/storage-sites with redirect follow returns 200 with storage sites view', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/inventory/storage-sites', {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()
      assertContains(html, 'Storage Sites')
    })

    it('2.5: GET /inventory/storage-sites/:id returns HTTP 301 redirect to /sites/storage-sites/:id', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestStorageSite(flyer.id, { name: 'Redirect Test Site', capacityKg: 1.0 })

      const res = await fetchGet(
        `/inventory/storage-sites/${site.id}`,
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      expect(res.headers.get('location')).toBe(`/sites/storage-sites/${site.id}`)
    })

    it('2.6: GET /inventory/storage-sites/:id/edit returns HTTP 301 redirect to /sites/storage-sites/:id/edit', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestStorageSite(flyer.id, { name: 'Redirect Edit Test', capacityKg: 1.0 })

      const res = await fetchGet(
        `/inventory/storage-sites/${site.id}/edit`,
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      expect(res.headers.get('location')).toBe(`/sites/storage-sites/${site.id}/edit`)
    })

    it('2.7: GET /inventory/storage-sites preserves query parameters across 301 redirect', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet(
        '/inventory/storage-sites?sort=capacity&order=desc',
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      expect(res.headers.get('location')).toBe('/sites/storage-sites?sort=capacity&order=desc')
    })
  })

  // =========================================================================
  // 3. Legacy Mutation Compatibility on /inventory/storage-sites/*
  // =========================================================================
  describe('3. Legacy Mutation Compatibility', () => {
    it('3.1: POST /inventory/storage-sites creates record and returns HTTP 303 to /sites/storage-sites/:id', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Legacy Created Site',
          location: 'Old Route Test',
          capacity_kg: 2.1,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(303)
      const location = res.headers.get('location') || ''
      expect(location).toMatch(/^\/sites\/storage-sites\/[a-zA-Z0-9-]+$/)

      const db = getDb()
      const [site] = await db
        .select()
        .from(schema.storageSites)
        .where(
          and(
            eq(schema.storageSites.userId, flyer.id),
            eq(schema.storageSites.name, 'Legacy Created Site'),
          ),
        )

      expect(site).toBeDefined()
      expect(site.capacityKg).toBeCloseTo(2.1)
    })

    it('3.2: POST /inventory/storage-sites/:id/edit updates record and returns HTTP 303', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestStorageSite(flyer.id, { name: 'Before Update', capacityKg: 1.5 })

      const res = await fetchPostForm(
        `/inventory/storage-sites/${site.id}/edit`,
        {
          name: 'After Legacy Update',
          capacity_kg: 2.7,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe(`/sites/storage-sites/${site.id}`)

      const db = getDb()
      const [updated] = await db
        .select()
        .from(schema.storageSites)
        .where(eq(schema.storageSites.id, site.id))

      expect(updated.name).toBe('After Legacy Update')
      expect(updated.capacityKg).toBeCloseTo(2.7)
    })

    it('3.3: POST /inventory/storage-sites/:id/delete soft-deletes and returns HTTP 303 to /sites/storage-sites', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestStorageSite(flyer.id, { name: 'Legacy Delete Target', capacityKg: 1.0 })

      const res = await fetchPostForm(
        `/inventory/storage-sites/${site.id}/delete`,
        {},
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe('/sites/storage-sites')

      const db = getDb()
      const [deleted] = await db
        .select()
        .from(schema.storageSites)
        .where(eq(schema.storageSites.id, site.id))

      expect(deleted.deletedAt).toBeTypeOf('number')
      expect(deleted.deletedAt!).toBeGreaterThan(0)
    })
  })

  // =========================================================================
  // 4. Navigation & Cross-Module Entrypoints
  // =========================================================================
  describe('4. Navigation & Cross-Module Entrypoints', () => {
    it('4.1: Sites hub GET /sites includes prominent link to /sites/storage-sites', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/sites', {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('href="/sites/storage-sites"')
      assertContains(html, 'Storage Sites')
    })

    it('4.2: Inventory hub GET /inventory does NOT link to storage sites (removed per design)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/inventory', {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()

      assertNotContains(html, 'href="/sites/storage-sites"')
      assertNotContains(html, 'href="/inventory/storage-sites"')
    })
  })

  // =========================================================================
  // 5. Unauthenticated Access Control (Requirement R1 Integration)
  // =========================================================================
  describe('5. Unauthenticated Access Control (R1 Integration)', () => {
    it('5.1: unauthenticated browser GET /sites/storage-sites redirects to /login (HTTP 302)', async () => {
      const res = await SELF.fetch('https://example.com/sites/storage-sites', {
        headers: {
          Accept: 'text/html',
          Cookie: 'triplet_logged_out=1',
        },
        redirect: 'manual',
      })

      expect(res.status).toBe(302)
      const location = res.headers.get('location') || ''
      expect(location).toContain('/login')
    })

    it('5.2: unauthenticated API GET /sites/storage-sites returns HTTP 401 Unauthorized', async () => {
      const res = await SELF.fetch('https://example.com/sites/storage-sites', {
        headers: {
          Accept: 'application/json',
          Cookie: 'triplet_logged_out=1',
        },
        redirect: 'manual',
      })

      expect(res.status).toBe(401)
      const json = (await res.json()) as any
      expect(json.error).toBe('Unauthorized')
    })

    it('5.3: unauthenticated POST /sites/storage-sites is rejected (HTTP 302 or 401)', async () => {
      const res = await SELF.fetch('https://example.com/sites/storage-sites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: 'triplet_logged_out=1',
        },
        body: JSON.stringify({ name: 'Unauth Site', capacityKg: 1.0 }),
        redirect: 'manual',
      })

      expect([302, 401]).toContain(res.status)
    })
  })
})
