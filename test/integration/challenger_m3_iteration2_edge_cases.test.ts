/**
 * Adversarial Challenger M3 Iteration 2 Test Suite: Query Parameter & Route Edge Cases.
 *
 * Requirements tested:
 * - Requirement R3.2: 301/302 redirects from legacy storage-sites paths to /sites/storage-sites
 * - Preservation of query parameters across all forms and variations:
 *   - Root /storage-sites?sort=capacity&order=desc
 *   - /inventory/storage-sites/new?return_to=%2Fflights%2Fnew
 *   - Trailing slashes (/storage-sites/ and /inventory/storage-sites/)
 *   - Complex nested queries, encoding (%20, %2B, quotes, special chars)
 *   - End-to-end follow redirects to verify HTTP 200 final delivery
 *   - Unauthenticated access behavior
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SELF } from 'cloudflare:test'
import * as schema from '../../src/db/schema'
import { getDb, seedTestStorageSite, seedTestUser, truncateDb } from '../helpers/db'
import { assertContains, assertHtmlResponse, assertNotContains } from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'
import { signSession } from '../../src/services/auth'

beforeEach(truncateDb)

describe('Challenger M3 Iteration 2: Query Edge Cases & Route Preservation', () => {
  // =========================================================================
  // 1. Root-Level (/storage-sites) Query Parameter Preservation & Trailing Slashes
  // =========================================================================
  describe('1. Root-Level (/storage-sites) Query Preservation', () => {
    it('1.1: GET /storage-sites?sort=capacity&order=desc redirects 301 preserving exact query', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet(
        '/storage-sites?sort=capacity&order=desc',
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toBe('/sites/storage-sites?sort=capacity&order=desc')
    })

    it('1.2: GET /storage-sites/ (trailing slash) redirects 301 to /sites/storage-sites without double slash', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet(
        '/storage-sites/',
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toBe('/sites/storage-sites')
      expect(location).not.toContain('/sites/storage-sites/')
    })

    it('1.3: GET /storage-sites/?sort=capacity&order=desc (trailing slash + query) redirects cleanly', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet(
        '/storage-sites/?sort=capacity&order=desc',
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toBe('/sites/storage-sites?sort=capacity&order=desc')
    })

    it('1.4: GET /storage-sites/new?return_to=%2Fflights%2Fnew redirects 301 to /sites/storage-sites/new with return_to', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet(
        '/storage-sites/new?return_to=%2Fflights%2Fnew',
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toBe('/sites/storage-sites/new?return_to=%2Fflights%2Fnew')
    })

    it('1.5: GET /storage-sites/:id?view=compliance&tab=magazines redirects 301 with ID and query', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestStorageSite(flyer.id, { name: 'Root ID Site', capacityKg: 2.0 })

      const res = await fetchGet(
        `/storage-sites/${site.id}?view=compliance&tab=magazines`,
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toBe(`/sites/storage-sites/${site.id}?view=compliance&tab=magazines`)
    })

    it('1.6: GET /storage-sites/:id/edit?return_to=%2Fsites%2Fstorage-sites redirects 301 with edit subpath and query', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestStorageSite(flyer.id, { name: 'Root Edit Site', capacityKg: 2.0 })

      const res = await fetchGet(
        `/storage-sites/${site.id}/edit?return_to=%2Fsites%2Fstorage-sites`,
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toBe(`/sites/storage-sites/${site.id}/edit?return_to=%2Fsites%2Fstorage-sites`)
    })
  })

  // =========================================================================
  // 2. Legacy /inventory/storage-sites Query Parameter Preservation & Trailing Slashes
  // =========================================================================
  describe('2. Legacy /inventory/storage-sites Query Preservation', () => {
    it('2.1: GET /inventory/storage-sites?sort=capacity&order=desc redirects 301 preserving query', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet(
        '/inventory/storage-sites?sort=capacity&order=desc',
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toBe('/sites/storage-sites?sort=capacity&order=desc')
    })

    it('2.2: GET /inventory/storage-sites/ (trailing slash) redirects 301 to /sites/storage-sites', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet(
        '/inventory/storage-sites/',
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toBe('/sites/storage-sites')
      expect(location).not.toContain('/sites/storage-sites/')
    })

    it('2.3: GET /inventory/storage-sites/?sort=capacity&order=desc (trailing slash + query) redirects cleanly', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet(
        '/inventory/storage-sites/?sort=capacity&order=desc',
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toBe('/sites/storage-sites?sort=capacity&order=desc')
    })

    it('2.4: GET /inventory/storage-sites/new?return_to=%2Fflights%2Fnew preserves URL-encoded parameter', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet(
        '/inventory/storage-sites/new?return_to=%2Fflights%2Fnew',
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toBe('/sites/storage-sites/new?return_to=%2Fflights%2Fnew')
    })
  })

  // =========================================================================
  // 3. Complex Queries, Special Characters & Encoding
  // =========================================================================
  describe('3. Complex Queries & URL Encoding Preservation', () => {
    it('3.1: preserves complex nested, space-encoded and special characters in query string', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      // Query with spaces, equals, ampersands encoded, unicode
      const search = '?q=Bunker%20Alpha%2B1&filter%5Btype%5D=magazine&limit=50&offset=0&empty=&tag=SafeWork%20SA'

      const res = await fetchGet(
        `/inventory/storage-sites${search}`,
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toBe(`/sites/storage-sites${search}`)
    })

    it('3.2: preserves complex query parameters on root /storage-sites', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const search = '?q=Bunker%20Alpha%2B1&filter%5Btype%5D=magazine&limit=50&offset=0&empty=&tag=SafeWork%20SA'

      const res = await fetchGet(
        `/storage-sites${search}`,
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(301)
      const location = res.headers.get('location') || ''
      expect(location).toBe(`/sites/storage-sites${search}`)
    })
  })

  // =========================================================================
  // 4. End-to-End Follow Redirect Delivery (Status 200 & Content)
  // =========================================================================
  describe('4. End-to-End Redirect Following', () => {
    it('4.1: following /storage-sites?sort=capacity returns 200 with storage sites view', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      await seedTestStorageSite(flyer.id, { name: 'E2E Storage Site', capacityKg: 1.5 })

      const res = await fetchGet(
        '/storage-sites?sort=capacity',
        { Cookie: `triplet_session=${token}` },
      )

      assertHtmlResponse(res, 200)
      const html = await res.text()
      assertContains(html, 'Propellant Storage Sites & Magazines')
      assertContains(html, 'E2E Storage Site')
    })

    it('4.2: following /inventory/storage-sites/new?return_to=%2Fflights%2Fnew returns 200 with new form', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      const res = await fetchGet(
        '/inventory/storage-sites/new?return_to=%2Fflights%2Fnew',
        { Cookie: `triplet_session=${token}` },
      )

      assertHtmlResponse(res, 200)
      const html = await res.text()
      assertContains(html, 'Register New Storage Site / Magazine')
      assertContains(html, 'capacity_kg')
    })

    it('4.3: following /storage-sites/:id?view=overview returns 200 with detail view', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const site = await seedTestStorageSite(flyer.id, { name: 'E2E Follow Detail', capacityKg: 2.2 })

      const res = await fetchGet(
        `/storage-sites/${site.id}?view=overview`,
        { Cookie: `triplet_session=${token}` },
      )

      assertHtmlResponse(res, 200)
      const html = await res.text()
      assertContains(html, 'E2E Follow Detail')
      assertContains(html, 'Licensed Storage Capacity')
    })
  })

  // =========================================================================
  // 5. Unauthenticated Gating across Legacy Routes
  // =========================================================================
  describe('5. Unauthenticated Gating on Legacy Paths', () => {
    it('5.1: unauthenticated GET /storage-sites redirects 301 to /sites/storage-sites', async () => {
      const res = await SELF.fetch('https://example.com/storage-sites', {
        headers: {
          Accept: 'text/html',
          Cookie: 'triplet_logged_out=1',
        },
        redirect: 'manual',
      })
      expect(res.status).toBe(301)
      expect(res.headers.get('location')).toBe('/sites/storage-sites')
    })

    it('5.2: unauthenticated GET /inventory/storage-sites redirects directly to /login (302) due to /inventory gating', async () => {
      const res = await SELF.fetch('https://example.com/inventory/storage-sites', {
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

    it('5.3: following unauthenticated GET /storage-sites redirects to /sites/storage-sites then /login', async () => {
      const res = await SELF.fetch('https://example.com/storage-sites', {
        headers: {
          Accept: 'text/html',
          Cookie: 'triplet_logged_out=1',
        },
        redirect: 'follow',
      })

      // Following chain: /storage-sites (301) -> /sites/storage-sites (302) -> /login (200)
      assertHtmlResponse(res, 200)
      const html = await res.text()
      assertContains(html, 'TripleT-Rocketry')
      assertContains(html, 'value="/sites/storage-sites"')
      assertContains(html, 'Sign In')
    })

    it('5.4: unauthenticated API GET /sites/storage-sites returns 401 Unauthorized', async () => {
      const res = await SELF.fetch('https://example.com/sites/storage-sites', {
        headers: {
          Accept: 'application/json',
          Cookie: 'triplet_logged_out=1',
        },
      })

      expect(res.status).toBe(401)
      const body = await res.json() as any
      expect(body.error).toBe('Unauthorized')
    })
  })
})
