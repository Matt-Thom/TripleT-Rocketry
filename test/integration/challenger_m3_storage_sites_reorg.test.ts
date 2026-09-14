/**
 * Adversarial Challenger M3 Test Suite: Propellant Storage Sites Reorganization (Requirement R3).
 *
 * Vectors tested:
 * Vector 1: Route Disambiguation (/sites/storage-sites vs /sites/:id)
 * Vector 2: Query Parameter Preservation on Legacy 301 Redirects
 * Vector 3: Legacy POST Mutations and D1 Database Row Persistence
 * Vector 4: Views, Breadcrumbs, Active Navigation Tab, and Cross-Module Entrypoints
 * Vector 5: Authorization, IDOR Security, and Regulatory Boundary Enforcement
 */

import { and, eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { SELF } from 'cloudflare:test'
import * as schema from '../../src/db/schema'
import { getDb, seedTestStorageSite, seedTestUser, truncateDb } from '../helpers/db'
import { assertContains, assertHtmlResponse, assertNotContains } from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'
import { signSession } from '../../src/services/auth'

beforeEach(truncateDb)

describe('Challenger M3: Adversarial Storage Sites Verification', () => {
  // =========================================================================
  // VECTOR 1: Route Disambiguation (/sites/storage-sites vs /sites/:id)
  // =========================================================================
  describe('Vector 1: Route Disambiguation (/sites/storage-sites vs /sites/:id)', () => {
    it('1.1: GET /sites/storage-sites is NOT captured as launch site ID "storage-sites"', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const db = getDb()

      // Seed a launch site and a storage site
      const [launchSite] = await db
        .insert(schema.launchSites)
        .values({
          name: 'Monarto Launch Complex',
          latitude: -35.1,
          longitude: 139.1,
          maxAltitudeAglM: 3000,
        })
        .returning()

      const storageSite = await seedTestStorageSite(flyer.id, {
        name: 'Monarto Propellant Depot',
        capacityKg: 2.5,
      })

      // Request /sites/storage-sites
      const res = await fetchGet('/sites/storage-sites', {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Must render storage site listing, NOT launch site detail
      assertContains(html, 'Propellant Storage Sites & Magazines')
      assertContains(html, 'Monarto Propellant Depot')
      assertNotContains(html, 'Monarto Launch Complex')
      assertNotContains(html, 'CASA Airspace Ceiling')
      assertNotContains(html, 'Launch Site Not Found')
    })

    it('1.2: GET /sites/:id correctly retrieves launch site when ID is an arbitrary alphanumeric string', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const db = getDb()

      const [launchSite] = await db
        .insert(schema.launchSites)
        .values({
          name: 'Whalers Way Orbital Launch Complex',
          latitude: -34.9,
          longitude: 135.7,
          maxAltitudeAglM: 15000,
        })
        .returning()

      const res = await fetchGet(`/sites/${launchSite.id}`, {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Must render launch site detail
      assertContains(html, 'Whalers Way Orbital Launch Complex')
      assertContains(html, '15,000 m AGL')
      // Must NOT render storage site detail
      assertNotContains(html, 'Licensed Storage Capacity')
    })

    it('1.3: GET /sites/new renders launch site creation form, NOT storage site form', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/sites/new', {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Launch site fields
      assertContains(html, 'Register Launch Site')
      assertContains(html, 'max_altitude_agl_m')
      assertContains(html, 'latitude')
      assertContains(html, 'longitude')
      // Must NOT contain storage site fields
      assertNotContains(html, 'capacity_kg')
      assertNotContains(html, 'permit_number')
    })

    it('1.4: GET /sites/storage-sites/new renders storage site form, NOT launch site form', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/sites/storage-sites/new', {
        Cookie: `triplet_session=${token}`,
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Storage site fields
      assertContains(html, 'Register New Storage Site / Magazine')
      assertContains(html, 'capacity_kg')
      assertContains(html, 'permit_number')
      // Must NOT contain launch site fields
      assertNotContains(html, 'max_altitude_agl_m')
      assertNotContains(html, 'CASA airspace approval')
    })

    it('1.5: POST /sites creates launch site, while POST /sites/storage-sites creates storage site', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const db = getDb()

      // POST to /sites -> launch site
      const resLaunch = await fetchPostForm(
        '/sites',
        {
          name: 'Disambiguation Launch Field',
          latitude: -34.5,
          longitude: 138.5,
          max_altitude_agl_m: 2500,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect(resLaunch.status).toBe(303)
      const launchLoc = resLaunch.headers.get('location') || ''
      expect(launchLoc).toMatch(/^\/sites\/[a-zA-Z0-9-]+$/)
      expect(launchLoc).not.toContain('/sites/storage-sites')

      // POST to /sites/storage-sites -> storage site
      const resStorage = await fetchPostForm(
        '/sites/storage-sites',
        {
          name: 'Disambiguation Storage Bunker',
          capacity_kg: 2.0,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect(resStorage.status).toBe(303)
      const storageLoc = resStorage.headers.get('location') || ''
      expect(storageLoc).toMatch(/^\/sites\/storage-sites\/[a-zA-Z0-9-]+$/)

      // Verify in DB tables
      const [dbLaunch] = await db
        .select()
        .from(schema.launchSites)
        .where(eq(schema.launchSites.name, 'Disambiguation Launch Field'))
      expect(dbLaunch).toBeDefined()

      const [dbStorage] = await db
        .select()
        .from(schema.storageSites)
        .where(eq(schema.storageSites.name, 'Disambiguation Storage Bunker'))
      expect(dbStorage).toBeDefined()
    })

    it('1.6: 404 isolation: requesting non-existent launch site returns launch site 404, not storage site 404', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/sites/random-nonexistent-launch-uuid', {
        Cookie: `triplet_session=${token}`,
      })

      expect(res.status).toBe(404)
      const html = await res.text()
      assertContains(html, 'The requested launch site could not be located in D1')
      assertContains(html, 'Back to all launch sites')
    })

    it('1.7: 404 isolation: requesting non-existent storage site returns storage site 404, not launch site 404', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/sites/storage-sites/random-nonexistent-storage-uuid', {
        Cookie: `triplet_session=${token}`,
      })

      expect(res.status).toBe(404)
      const html = await res.text()
      assertContains(html, 'Storage Site Not Found')
      assertContains(html, 'The requested storage site does not exist or has been removed')
      assertContains(html, 'href="/sites/storage-sites"')
    })
  })

  // =========================================================================
  // VECTOR 2: Query Parameter Preservation on Legacy 301 Redirects
  // =========================================================================
  describe('Vector 2: Query Parameter Preservation on Legacy 301 Redirects', () => {
    it('2.1: GET /inventory/storage-sites preserves single query parameter (?sort=capacity)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet(
        '/inventory/storage-sites?sort=capacity',
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toBe('/sites/storage-sites?sort=capacity')
    })

    it('2.2: GET /inventory/storage-sites preserves multiple query parameters (?sort=name&order=asc&q=bunker)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet(
        '/inventory/storage-sites?sort=name&order=asc&q=bunker',
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toContain('/sites/storage-sites?')
      expect(location).toContain('sort=name')
      expect(location).toContain('order=asc')
      expect(location).toContain('q=bunker')
    })

    it('2.3: GET /inventory/storage-sites/new preserves return_to query parameter', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet(
        '/inventory/storage-sites/new?return_to=%2Fflights%2Fnew',
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toContain('/sites/storage-sites/new')
      expect(location).toContain('return_to=%2Fflights%2Fnew')
    })

    it('2.4: GET /inventory/storage-sites/:id preserves query parameters', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestStorageSite(flyer.id, { name: 'Query Test Site', capacityKg: 1.0 })

      const res = await fetchGet(
        `/inventory/storage-sites/${site.id}?view=compliance&tab=magazines`,
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toContain(`/sites/storage-sites/${site.id}`)
      expect(location).toContain('view=compliance')
      expect(location).toContain('tab=magazines')
    })

    it('2.5: GET /inventory/storage-sites/:id/edit preserves query parameters', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestStorageSite(flyer.id, { name: 'Query Edit Site', capacityKg: 1.0 })

      const res = await fetchGet(
        `/inventory/storage-sites/${site.id}/edit?return_to=%2Fsites%2Fstorage-sites`,
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toContain(`/sites/storage-sites/${site.id}/edit`)
      expect(location).toContain('return_to=%2Fsites%2Fstorage-sites')
    })

    it('2.6: GET /storage-sites preserves query parameters', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet(
        '/storage-sites?filter=active',
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toContain('/sites/storage-sites')
      expect(location).toContain('filter=active')
    })

    it('2.7: GET /storage-sites (root level without /inventory prefix) returns 301 redirect', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet(
        '/storage-sites',
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toBe('/sites/storage-sites')
    })
  })

  // =========================================================================
  // VECTOR 3: Legacy POST Mutations & D1 Database Row Persistence
  // =========================================================================
  describe('Vector 3: Legacy POST Mutations & D1 Persistence', () => {
    it('3.1: POST /inventory/storage-sites creates record with all fields in D1 and redirects 303', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Legacy Field Magazine',
          location: 'Outback Sector B',
          capacity_kg: 2.75,
          permit_number: 'OPTIONAL-PERMIT-123',
          notes: 'Adversarially tested legacy insertion',
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
            eq(schema.storageSites.name, 'Legacy Field Magazine'),
          ),
        )

      expect(site).toBeDefined()
      expect(site.location).toBe('Outback Sector B')
      expect(site.capacityKg).toBeCloseTo(2.75)
      expect(site.permitNumber).toBe('OPTIONAL-PERMIT-123')
      expect(site.notes).toBe('Adversarially tested legacy insertion')
      expect(site.deletedAt).toBeNull()
      expect(location).toBe(`/sites/storage-sites/${site.id}`)
    })

    it('3.2: POST /inventory/storage-sites enforces SafeWork SA regulations (>3.0 kg requires permit)', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchPostForm(
        '/inventory/storage-sites',
        {
          name: 'Illegal Over-Limit Bunker',
          capacity_kg: 4.5,
          permit_number: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(400)
      const html = await res.text()
      assertContains(html, 'SafeWork SA regulations require a propellant storage license/permit')

      // Ensure NOT created in D1
      const db = getDb()
      const [site] = await db
        .select()
        .from(schema.storageSites)
        .where(eq(schema.storageSites.name, 'Illegal Over-Limit Bunker'))
      expect(site).toBeUndefined()
    })

    it('3.3: POST /inventory/storage-sites/:id/edit updates record in D1', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestStorageSite(flyer.id, {
        name: 'Pre-Edit Bunker',
        location: 'Old Pad',
        capacityKg: 1.5,
      })

      const res = await fetchPostForm(
        `/inventory/storage-sites/${site.id}/edit`,
        {
          name: 'Post-Edit Bunker',
          location: 'New Pad',
          capacity_kg: 2.8,
          notes: 'Updated via legacy route',
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

      expect(updated.name).toBe('Post-Edit Bunker')
      expect(updated.location).toBe('New Pad')
      expect(updated.capacityKg).toBeCloseTo(2.8)
      expect(updated.notes).toBe('Updated via legacy route')
    })

    it('3.4: POST /inventory/storage-sites/:id/delete soft-deletes and removes from active query', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestStorageSite(flyer.id, {
        name: 'Delete Target Bunker',
        capacityKg: 1.0,
      })

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
  // VECTOR 4: Views, Breadcrumbs, Active Navigation Tab, & Cross-Module Entrypoints
  // =========================================================================
  describe('Vector 4: Views, Breadcrumbs & Cross-Module Entrypoints', () => {
    it('4.1: Storage Sites views set activeTab to "sites" in pageLayout', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestStorageSite(flyer.id, { name: 'Active Tab Site', capacityKg: 1.0 })

      // List view
      const listRes = await fetchGet('/sites/storage-sites', { Cookie: `triplet_session=${token}` })
      const listHtml = await listRes.text()
      // In layout.ts, activeTab: 'sites' adds active classes to the Sites link
      // Verify Sites nav link is highlighted
      assertContains(listHtml, 'href="/sites"')

      // Detail view
      const detailRes = await fetchGet(`/sites/storage-sites/${site.id}`, { Cookie: `triplet_session=${token}` })
      const detailHtml = await detailRes.text()
      assertContains(detailHtml, 'href="/sites"')

      // New form view
      const newRes = await fetchGet('/sites/storage-sites/new', { Cookie: `triplet_session=${token}` })
      const newHtml = await newRes.text()
      assertContains(newHtml, 'href="/sites"')
    })

    it('4.2: Sites hub (/sites) has link to /sites/storage-sites and NOT /inventory/storage-sites', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/sites', { Cookie: `triplet_session=${token}` })
      const html = await res.text()

      assertContains(html, 'href="/sites/storage-sites"')
      assertNotContains(html, 'href="/inventory/storage-sites"')
    })

    it('4.3: Inventory hub (/inventory) links to /sites/storage-sites and NOT /inventory/storage-sites', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet('/inventory', { Cookie: `triplet_session=${token}` })
      const html = await res.text()

      assertContains(html, 'href="/sites/storage-sites"')
      assertNotContains(html, 'href="/inventory/storage-sites"')
    })

    it('4.4: Breadcrumbs on /sites/storage-sites/new and /sites/storage-sites/:id start with Sites', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestStorageSite(flyer.id, { name: 'Breadcrumb Site', capacityKg: 1.5 })

      // Detail breadcrumbs: Sites > Storage Sites > Breadcrumb Site
      const detailRes = await fetchGet(`/sites/storage-sites/${site.id}`, { Cookie: `triplet_session=${token}` })
      const detailHtml = await detailRes.text()
      assertContains(detailHtml, 'href="/sites"')
      assertContains(detailHtml, 'href="/sites/storage-sites"')
      assertContains(detailHtml, 'Breadcrumb Site')

      // Edit breadcrumbs: Sites > Storage Sites > Edit Site
      const editRes = await fetchGet(`/sites/storage-sites/${site.id}/edit`, { Cookie: `triplet_session=${token}` })
      const editHtml = await editRes.text()
      assertContains(editHtml, 'href="/sites"')
      assertContains(editHtml, 'href="/sites/storage-sites"')
      assertContains(editHtml, 'Edit Site')
    })
  })

  // =========================================================================
  // VECTOR 5: Authorization, IDOR Security & Cross-User Isolation
  // =========================================================================
  describe('Vector 5: Authorization, IDOR Security & Cross-User Isolation', () => {
    it('5.1: Flyer B cannot view Flyer A storage site under /sites/storage-sites/:id', async () => {
      const flyerA = await seedTestUser()
      const flyerB = await seedTestUser()
      const tokenB = await signSession(flyerB.id)

      const siteA = await seedTestStorageSite(flyerA.id, { name: 'Flyer A Bunker', capacityKg: 2.0 })

      const res = await fetchGet(`/sites/storage-sites/${siteA.id}`, {
        Cookie: `triplet_session=${tokenB}`,
      })

      expect(res.status).toBe(404)
    })

    it('5.2: Flyer B cannot update Flyer A storage site via POST /sites/storage-sites/:id/edit', async () => {
      const flyerA = await seedTestUser()
      const flyerB = await seedTestUser()
      const tokenB = await signSession(flyerB.id)

      const siteA = await seedTestStorageSite(flyerA.id, { name: 'Original Name A', capacityKg: 2.0 })

      const res = await fetchPostForm(
        `/sites/storage-sites/${siteA.id}/edit`,
        { name: 'Hacked by B', capacity_kg: 2.0 },
        { Cookie: `triplet_session=${tokenB}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(404)

      const db = getDb()
      const [check] = await db.select().from(schema.storageSites).where(eq(schema.storageSites.id, siteA.id))
      expect(check.name).toBe('Original Name A')
    })

    it('5.3: Flyer B cannot delete Flyer A storage site via POST /sites/storage-sites/:id/delete', async () => {
      const flyerA = await seedTestUser()
      const flyerB = await seedTestUser()
      const tokenB = await signSession(flyerB.id)

      const siteA = await seedTestStorageSite(flyerA.id, { name: 'Target A', capacityKg: 2.0 })

      const res = await fetchPostForm(
        `/sites/storage-sites/${siteA.id}/delete`,
        {},
        { Cookie: `triplet_session=${tokenB}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(404)

      const db = getDb()
      const [check] = await db.select().from(schema.storageSites).where(eq(schema.storageSites.id, siteA.id))
      expect(check.deletedAt).toBeNull()
    })
  })
})
