/**
 * Integration test suite for Authenticated Access, Multi-User Support,
 * Launch Site Editing, and Australian Rocketry Domain Data.
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import {
  getDb,
  seedTestSite,
  seedTestUser,
  seedTestRocket,
  truncateDb,
} from '../helpers/db'
import {
  assertContains,
  assertHasFormField,
  assertHtmlResponse,
} from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'
import { hashPassword, signSession } from '../../src/services/auth'

beforeEach(truncateDb)

describe('Requirement 1: Authenticated Access & Multi-User Support', () => {
  describe('Access Control & Unauthenticated Protection', () => {
    it('redirects unauthenticated HTML requests on protected endpoints to /login', async () => {
      const res = await fetchGet('/flights', { 'x-no-auth': 'true' }, { redirect: 'manual' })
      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toContain('/login')
      expect(res.headers.get('Location')).toContain('redirect=%2Fflights')
    })

    it('returns HTTP 401 Unauthorized for unauthenticated JSON API requests', async () => {
      const res = await fetchGet('/rockets', {
        Accept: 'application/json',
        'x-no-auth': 'true',
      })
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data).toEqual({
        error: 'Unauthorized',
        message: 'Authentication required',
      })
    })

    it('allows public access to /health, /ready, /login, and /register without authentication', async () => {
      const resHealth = await fetchGet('/health', { 'x-no-auth': 'true' })
      expect(resHealth.status).toBe(200)

      const resReady = await fetchGet('/ready', { 'x-no-auth': 'true' })
      expect(resReady.status).toBe(200)

      const resLogin = await fetchGet('/login', { 'x-no-auth': 'true' })
      assertHtmlResponse(resLogin, 200)
      const loginHtml = await resLogin.text()
      expect(loginHtml).toContain('TripleT-Rocketry')
      expect(loginHtml).toContain('Sign In')

      const resRegister = await fetchGet('/register', { 'x-no-auth': 'true' })
      assertHtmlResponse(resRegister, 200)
      const regHtml = await resRegister.text()
      expect(regHtml).toContain('Register Flyer Profile')
    })
  })

  describe('User Login & Session Management', () => {
    it('authenticates with valid credentials and sets triplet_session cookie', async () => {
      const db = getDb()
      const pwdHash = await hashPassword('correct-horse-battery')
      const user = await seedTestUser({
        email: 'pilot@rocketry.org.au',
        displayName: 'Test Aviator',
        passwordHash: pwdHash,
      })

      const res = await fetchPostForm(
        '/login',
        {
          email: 'pilot@rocketry.org.au',
          password: 'correct-horse-battery',
        },
        {},
        { redirect: 'manual' },
      )

      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toBe('/')
      const setCookie = res.headers.get('Set-Cookie') || ''
      expect(setCookie).toContain('triplet_session=')
      expect(setCookie).toContain('Path=/')
      expect(setCookie).toContain('HttpOnly')
    })

    it('rejects invalid credentials with 302 redirect back to /login?error', async () => {
      const pwdHash = await hashPassword('real-secret-key')
      await seedTestUser({
        email: 'pilot@rocketry.org.au',
        passwordHash: pwdHash,
      })

      const res = await fetchPostForm(
        '/login',
        {
          email: 'pilot@rocketry.org.au',
          password: 'wrong-password',
        },
        {},
        { redirect: 'manual' },
      )

      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toContain('/login?error=')
    })

    it('clears session cookie on logout', async () => {
      const res = await fetchGet('/logout', {}, { redirect: 'manual' })
      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toBe('/login')
      const cookie = res.headers.get('Set-Cookie') || ''
      expect(cookie).toContain('Max-Age=0')
    })
  })

  describe('User Registration & Profile Creation', () => {
    it('creates new flyer and certification in D1 and issues session', async () => {
      const res = await fetchPostForm(
        '/register',
        {
          displayName: 'Matilda Green',
          email: 'matilda@rocketry.org.au',
          password: 'securePassword123!',
          certifyingBody: 'TRA',
          level: '2',
          certNumber: 'TRA-AU-77123',
        },
        {},
        { redirect: 'manual' },
      )

      expect(res.status).toBe(302)
      expect(res.headers.get('Set-Cookie')).toContain('triplet_session=')

      const db = getDb()
      const [createdUser] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, 'matilda@rocketry.org.au'))

      expect(createdUser).toBeDefined()
      expect(createdUser.displayName).toBe('Matilda Green')

      const [cert] = await db
        .select()
        .from(schema.certifications)
        .where(eq(schema.certifications.userId, createdUser.id))

      expect(cert).toBeDefined()
      expect(cert.level).toBe(2)
      expect(cert.certifyingBody).toBe('TRA')
      expect(cert.certNumber).toBe('TRA-AU-77123')
    })
  })

  describe('Cloudflare Access Single Sign-On Integration', () => {
    it('authenticates seamlessly when Cf-Access-Authenticated-User-Email header is present', async () => {
      const res = await fetchGet('/rockets', {
        'cf-access-authenticated-user-email': 'john.doe@thom.au',
      })

      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toContain('Rockets')
      expect(html).toContain('john.doe')

      // Verify auto-provisioned user in D1
      const db = getDb()
      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, 'john.doe@thom.au'))

      expect(user).toBeDefined()
      expect(user.displayName).toBe('john.doe')
    })
  })

  describe('Multi-User Data Isolation', () => {
    it('restricts rockets list to the authenticated owner', async () => {
      const userA = await seedTestUser({
        email: 'userA@rocketry.local',
        displayName: 'Flyer Alpha',
      })
      const userB = await seedTestUser({
        email: 'userB@rocketry.local',
        displayName: 'Flyer Beta',
      })

      // User A owns Falcon 9
      await seedTestRocket(userA.id, { name: 'Alpha Falcon' })
      // User B owns Saturn V
      await seedTestRocket(userB.id, { name: 'Beta Saturn' })

      const tokenA = await signSession(userA.id)
      const resA = await fetchGet('/rockets', {
        Cookie: `triplet_session=${tokenA}`,
      })
      assertHtmlResponse(resA, 200)
      const htmlA = await resA.text()
      expect(htmlA).toContain('Alpha Falcon')
      expect(htmlA).not.toContain('Beta Saturn')

      const tokenB = await signSession(userB.id)
      const resB = await fetchGet('/rockets', {
        Cookie: `triplet_session=${tokenB}`,
      })
      assertHtmlResponse(resB, 200)
      const htmlB = await resB.text()
      expect(htmlB).toContain('Beta Saturn')
      expect(htmlB).not.toContain('Alpha Falcon')
    })
  })
})

describe('Requirement 2: Launch Sites Editable Workflows', () => {
  it('renders edit site form with current fields pre-populated (GET /sites/:id/edit)', async () => {
    const site = await seedTestSite({
      name: 'Lake Hart / Woomera Launch Range',
      latitude: -31.154,
      longitude: 136.528,
      maxAltitudeAglM: 30000,
      notes: 'Historic Australian launch field in South Australia',
    })

    const res = await fetchGet(`/sites/${site.id}/edit`)
    assertHtmlResponse(res, 200)
    const html = await res.text()

    assertContains(html, 'Edit Launch Site', 'Lake Hart / Woomera Launch Range')
    assertHasFormField(html, 'name')
    assertHasFormField(html, 'latitude')
    assertHasFormField(html, 'longitude')
    assertHasFormField(html, 'max_altitude_agl_m')
    assertHasFormField(html, 'notes')
    expect(html).toContain('value="Lake Hart / Woomera Launch Range"')
    expect(html).toContain('value="-31.154"')
    expect(html).toContain('value="136.528"')
    expect(html).toContain('value="30000"')
  })

  it('updates site details in D1 and redirects to site view (POST /sites/:id/edit)', async () => {
    const site = await seedTestSite({
      name: 'Old Field Name',
      latitude: -33.5,
      longitude: 150.5,
      maxAltitudeAglM: 1000,
    })

    const res = await fetchPostForm(
      `/sites/${site.id}/edit`,
      {
        name: 'Updated Whalan Reserve NSW',
        latitude: -33.766,
        longitude: 150.803,
        max_altitude_agl_m: 450,
        notes: 'Updated CASA Area Approval ceiling 450m AGL (1,500 ft)',
      },
      {},
      { redirect: 'manual' },
    )

    expect([200, 302, 303]).toContain(res.status)
    expect(res.headers.get('Location')).toBe(`/sites/${site.id}`)

    const db = getDb()
    const [updatedSite] = await db
      .select()
      .from(schema.launchSites)
      .where(eq(schema.launchSites.id, site.id))

    expect(updatedSite).toBeDefined()
    expect(updatedSite.name).toBe('Updated Whalan Reserve NSW')
    expect(updatedSite.latitude).toBeCloseTo(-33.766)
    expect(updatedSite.longitude).toBeCloseTo(150.803)
    expect(updatedSite.maxAltitudeAglM).toBe(450)
    expect(updatedSite.notes).toContain('Updated CASA Area Approval ceiling')
  })

  it('site detail view includes "Edit Site" link', async () => {
    const site = await seedTestSite({ name: 'Serpentine Field WA' })
    const res = await fetchGet(`/sites/${site.id}`)
    assertHtmlResponse(res, 200)
    const html = await res.text()
    expect(html).toContain(`href="/sites/${site.id}/edit"`)
    expect(html).toContain('Edit Site')
  })

  it('rejects empty site name on update with 400 Bad Request', async () => {
    const site = await seedTestSite({ name: 'Valid Name' })
    const res = await fetchPostForm(`/sites/${site.id}/edit`, {
      name: '   ',
    })
    expect(res.status).toBe(400)
  })
})

describe('Requirement 3: Australian Example Data & Terminology', () => {
  it('displays CASA Airspace Ceiling terminology rather than FAA on site pages', async () => {
    const site = await seedTestSite({
      name: 'Lake Tyrrell VIC',
      maxAltitudeAglM: 12000,
    })

    const res = await fetchGet(`/sites/${site.id}`)
    assertHtmlResponse(res, 200)
    const html = await res.text()
    expect(html).toContain('CASA Airspace Ceiling')
    expect(html).not.toContain('FAA Waiver Ceiling')
  })

  it('renders login page with Australian demo pilots available for quick switch', async () => {
    const res = await fetchGet('/login')
    assertHtmlResponse(res, 200)
    const html = await res.text()
    expect(html).toContain('Quick Sign-In (Australian Pilots)')
    expect(html).toContain('TripleT Pilot')
    expect(html).toContain('Sarah Connor')
    expect(html).toContain('Bruce Harrison (RSO)')
  })
})
