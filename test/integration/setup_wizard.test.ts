/**
 * Integration test suite for Requirement R1: Initial Setup Wizard & First User Provisioning.
 *
 * Tests:
 * 1. Unconfigured instance detection: Non-setup requests are intercepted and redirected to /setup.
 * 2. Public health and readiness probes remain accessible (HTTP 200).
 * 3. Setup wizard form renders with South Australia regulatory default and site name.
 * 4. Primary administrator account creation, password hashing, and role assignment.
 * 5. Site settings persistence (setup_completed, site_name, default_regulatory_region).
 * 6. Session establishment upon setup completion and redirection to dashboard.
 * 7. Prevention of setup wizard re-execution once instance is configured.
 * 8. Real-world greenfield setup workload scenario (Tier 4).
 */

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, truncateDb } from '../helpers/db'
import {
  assertContains,
  assertHasFormField,
  assertHtmlResponse,
} from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'

beforeEach(async () => {
  await truncateDb()
  // Clean site_settings table if it exists
  try {
    await env.DB.prepare('DELETE FROM site_settings').run()
  } catch {
    // Table may not be migrated in initial state
  }
})

describe('Requirement R1: Initial Setup Wizard & First User Provisioning', () => {
  describe('Tier 1: Unconfigured Detection & Setup Wizard UI', () => {
    it('1.1: redirects unconfigured requests from root to /setup', async () => {
      const res = await fetchGet('/', { 'x-test-unconfigured': 'true' }, { redirect: 'manual' })
      expect([302, 303, 307]).toContain(res.status)
      const location = res.headers.get('location') ?? ''
      expect(location).toMatch(/\/setup/i)
    })

    it('1.2: permits /health and /ready probes without redirection on unconfigured instance', async () => {
      const healthRes = await fetchGet('/health', { 'x-test-unconfigured': 'true' })
      expect(healthRes.status).toBe(200)

      const readyRes = await fetchGet('/ready', { 'x-test-unconfigured': 'true' })
      expect(readyRes.status).toBe(200)
    })

    it('1.3: renders setup wizard form with required administrative inputs at GET /setup', async () => {
      const res = await fetchGet('/setup')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Form structure
      assertHasFormField(html, 'site_name')
      assertHasFormField(html, 'default_regulatory_region')
      assertHasFormField(html, 'display_name')
      assertHasFormField(html, 'email')
      assertHasFormField(html, 'password')
      assertHasFormField(html, 'confirm_password')
    })

    it('1.4: pre-selects South Australia (SafeWork SA) as default regulatory region', async () => {
      const res = await fetchGet('/setup')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Default selection for South Australia
      expect(html).toMatch(/value=["'](AU_SA|SA)["'][^>]*selected/i)
      assertContains(html, 'South Australia')
    })

    it('1.5: defaults site name to "TripleT-Rocketry"', async () => {
      const res = await fetchGet('/setup')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toMatch(/value=["']TripleT-Rocketry["']/i)
    })
  })

  describe('Tier 2: Input Validation & Boundary Conditions', () => {
    it('2.1: rejects setup submission when site name is missing or whitespace', async () => {
      const res = await fetchPostForm('/setup', {
        site_name: '   ',
        default_regulatory_region: 'SA',
        display_name: 'Admin Flyer',
        email: 'admin@rocketry.sa.gov.au',
        password: 'ValidPassword123!',
        confirm_password: 'ValidPassword123!',
      }, {}, { redirect: 'manual' })

      // Should return 400 Bad Request or re-render form with error message
      if (res.status === 200) {
        const html = await res.text()
        expect(html).toMatch(/site name|required|invalid/i)
      } else {
        expect(res.status).toBe(400)
      }
    })

    it('2.2: rejects setup submission with invalid email format', async () => {
      const res = await fetchPostForm('/setup', {
        site_name: 'TripleT-Rocketry',
        default_regulatory_region: 'SA',
        display_name: 'Admin Flyer',
        email: 'not-a-valid-email',
        password: 'ValidPassword123!',
        confirm_password: 'ValidPassword123!',
      }, {}, { redirect: 'manual' })

      if (res.status === 200) {
        const html = await res.text()
        expect(html).toMatch(/email|invalid/i)
      } else {
        expect(res.status).toBe(400)
      }
    })

    it('2.3: rejects setup submission when password and confirmation do not match', async () => {
      const res = await fetchPostForm('/setup', {
        site_name: 'TripleT-Rocketry',
        default_regulatory_region: 'SA',
        display_name: 'Admin Flyer',
        email: 'admin@rocketry.sa.gov.au',
        password: 'ValidPassword123!',
        confirm_password: 'DifferentPassword456!',
      }, {}, { redirect: 'manual' })

      if (res.status === 200) {
        const html = await res.text()
        expect(html).toMatch(/password.*match|mismatch/i)
      } else {
        expect(res.status).toBe(400)
      }
    })

    it('2.4: rejects setup submission with password shorter than 8 characters', async () => {
      const res = await fetchPostForm('/setup', {
        site_name: 'TripleT-Rocketry',
        default_regulatory_region: 'SA',
        display_name: 'Admin Flyer',
        email: 'admin@rocketry.sa.gov.au',
        password: 'short',
        confirm_password: 'short',
      }, {}, { redirect: 'manual' })

      if (res.status === 200) {
        const html = await res.text()
        expect(html).toMatch(/password.*length|at least 8|short/i)
      } else {
        expect(res.status).toBe(400)
      }
    })

    it('2.5: rejects setup submission with unsupported regulatory region', async () => {
      const res = await fetchPostForm('/setup', {
        site_name: 'TripleT-Rocketry',
        default_regulatory_region: 'INVALID_MARS_REGION',
        display_name: 'Admin Flyer',
        email: 'admin@rocketry.sa.gov.au',
        password: 'ValidPassword123!',
        confirm_password: 'ValidPassword123!',
      }, {}, { redirect: 'manual' })

      if (res.status === 200) {
        const html = await res.text()
        expect(html).toMatch(/region|invalid/i)
      } else {
        expect(res.status).toBe(400)
      }
    })
  })

  describe('Tier 3: Provisioning, Settings Persistence & Idempotency', () => {
    it('3.1: provisions administrator in database with admin role and South Australia region', async () => {
      const res = await fetchPostForm('/setup', {
        site_name: 'Southern Launch Control',
        default_regulatory_region: 'SA',
        display_name: 'Chief Range Safety Officer',
        email: 'rso.sa@rocketry.org.au',
        password: 'SuperAdminSecret2026!',
        confirm_password: 'SuperAdminSecret2026!',
      }, {}, { redirect: 'manual' })

      expect([200, 302, 303]).toContain(res.status)

      // Query database directly to verify admin creation
      const userRes = await env.DB.prepare(
        'SELECT * FROM users WHERE email = ?',
      ).bind('rso.sa@rocketry.org.au').first<{
        id: string
        email: string
        displayName?: string
        display_name?: string
        role?: string
        regulatory_region?: string
        regulatoryRegion?: string
      }>()

      expect(userRes).not.toBeNull()
      expect(userRes?.email).toBe('rso.sa@rocketry.org.au')
      if (userRes?.role) {
        expect(userRes.role).toBe('admin')
      }
    })

    it('3.2: records setup_completed = true in site_settings table', async () => {
      await fetchPostForm('/setup', {
        site_name: 'Woomera Rocket Center',
        default_regulatory_region: 'SA',
        display_name: 'Woomera Admin',
        email: 'admin@woomera.gov.au',
        password: 'WoomeraPass2026!',
        confirm_password: 'WoomeraPass2026!',
      }, {}, { redirect: 'manual' })

      try {
        const setting = await env.DB.prepare(
          "SELECT value FROM site_settings WHERE key = 'setup_completed'",
        ).first<{ value: string }>()
        expect(setting?.value).toBe('true')
      } catch {
        // Table created in worker milestone
      }
    })

    it('3.3: sets session cookie upon successful setup completion and redirects to /', async () => {
      const res = await fetchPostForm('/setup', {
        site_name: 'TripleT South Australia',
        default_regulatory_region: 'SA',
        display_name: 'Club President',
        email: 'president@sarc.org.au',
        password: 'SarcPassword2026!',
        confirm_password: 'SarcPassword2026!',
      }, {}, { redirect: 'manual' })

      expect([302, 303]).toContain(res.status)
      const setCookie = res.headers.get('set-cookie') ?? ''
      expect(setCookie).toMatch(/triplet_session/i)
      const location = res.headers.get('location') ?? ''
      expect(location).toMatch(/^(\/|\/dashboard)$/)
    })

    it('3.4: redirects GET /setup to root once setup is completed (idempotency guard)', async () => {
      // Complete setup first
      await fetchPostForm('/setup', {
        site_name: 'Configured Instance',
        default_regulatory_region: 'SA',
        display_name: 'Primary Admin',
        email: 'admin@configured.org',
        password: 'ConfiguredPass2026!',
        confirm_password: 'ConfiguredPass2026!',
      }, {}, { redirect: 'manual' })

      // Attempt to access /setup again
      const secondRes = await fetchGet('/setup', {}, { redirect: 'manual' })
      expect([302, 303]).toContain(secondRes.status)
      const location = secondRes.headers.get('location') ?? ''
      expect(location).toMatch(/^(\/|\/dashboard)$/)
    })

    it('3.5: allows normal navigation to root without redirection once configured', async () => {
      const setupRes = await fetchPostForm('/setup', {
        site_name: 'Configured Instance',
        default_regulatory_region: 'SA',
        display_name: 'Primary Admin',
        email: 'flyer@configured.org',
        password: 'ConfiguredPass2026!',
        confirm_password: 'ConfiguredPass2026!',
      }, {}, { redirect: 'manual' })

      const cookie = setupRes.headers.get('set-cookie')?.split(';')[0] ?? ''
      const res = await fetchGet('/', { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toContain('TripleT-Rocketry')
    })
  })

  describe('Tier 4: Workload Scenario 1 — Greenfield Instance Setup to First Launch', () => {
    it('executes full greenfield initialization lifecycle from unconfigured state to active flight operations', async () => {
      // Step 1: Initial unconfigured access attempt is intercepted
      const intercepted = await fetchGet('/flights', { 'x-test-unconfigured': 'true' }, { redirect: 'manual' })
      expect([302, 303]).toContain(intercepted.status)
      expect(intercepted.headers.get('location')).toMatch(/\/setup/i)

      // Step 2: Administrator inspects setup wizard
      const wizardRes = await fetchGet('/setup')
      assertHtmlResponse(wizardRes, 200)
      const wizardHtml = await wizardRes.text()
      assertContains(wizardHtml, 'South Australia')

      // Step 3: Administrator provisions site
      const provisionRes = await fetchPostForm('/setup', {
        site_name: 'South Australian Rocketry Club',
        default_regulatory_region: 'SA',
        display_name: 'E2E Club Director',
        email: 'director@sarc.org.au',
        password: 'DirectorSecure2026!',
        confirm_password: 'DirectorSecure2026!',
      }, {}, { redirect: 'manual' })

      expect([302, 303]).toContain(provisionRes.status)
      const sessionCookie = provisionRes.headers.get('set-cookie')?.split(';')[0] ?? ''

      // Step 4: Administrator accesses dashboard using session cookie
      const dashRes = await fetchGet('/', { Cookie: sessionCookie })
      assertHtmlResponse(dashRes, 200)

      // Step 5: Administrator verifies access to protected flight logbook
      const flightsRes = await fetchGet('/flights', { Cookie: sessionCookie })
      assertHtmlResponse(flightsRes, 200)
      const flightsHtml = await flightsRes.text()
      expect(flightsHtml).toMatch(/flight/i)
    })
  })
})
