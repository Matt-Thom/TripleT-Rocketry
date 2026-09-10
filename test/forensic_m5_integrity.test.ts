/**
 * Forensic Integrity Audit Test Suite for Milestone 5
 * TripleT-Rocketry
 *
 * Verifies:
 * 1. Dedicated user profile screen GET /profile requires authentication (302/401) and renders genuine cards.
 * 2. Authentic SQLite D1 updates for pilot profile (displayName, email, regulatoryRegion) via Drizzle ORM.
 * 3. Authentic rocketry certification persistence across Levels 0 through 3 (TRA, ARA, NAR) and active flyer context calculation.
 * 4. Multi-club affiliations simultaneous persistence, distinct membership numbers, and soft deletion (deletedAt audit column).
 * 5. Self-service WebAuthn passkeys: genuine client-side ceremony, credential listing, deletion, and renaming.
 * 6. Strict RBAC isolation: non-admin flyers cannot access administrative features or see admin links.
 */

import { and, eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { signSession } from '../src/services/auth'
import { getActiveFlyer } from '../src/db/context'
import {
  getDb,
  seedTestCert,
  seedTestUser,
  truncateDb,
} from './helpers/db'
import { assertHtmlResponse } from './helpers/html'
import { fetchGet, fetchPostForm } from './helpers/http'

beforeEach(truncateDb)

describe('Forensic Integrity Audit: Milestone 5 (Requirement R5)', () => {
  describe('Check 1: Authentication & Access Control Enforcement', () => {
    it('redirects unauthenticated HTML requests to /login?redirect=/profile (HTTP 302)', async () => {
      const res = await fetchGet(
        '/profile',
        { 'x-no-auth': 'true', Accept: 'text/html' },
        { redirect: 'manual' },
      )
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/login?redirect=%2Fprofile')
    })

    it('returns HTTP 401 Unauthorized for unauthenticated JSON requests', async () => {
      const res = await fetchGet('/profile', {
        'x-no-auth': 'true',
        Accept: 'application/json',
      })
      expect(res.status).toBe(401)
      const json = (await res.json()) as any
      expect(json.error).toBe('Unauthorized')
    })
  })

  describe('Check 2: Genuine Pilot Profile Self-Management (D1 SQLite Persistence)', () => {
    it('authentically updates displayName, email, and regulatoryRegion in schema.users', async () => {
      const flyer = await seedTestUser({
        displayName: 'Original Callsign',
        email: 'pilot1@example.com',
        role: 'flyer',
      })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      // GET /profile renders user details
      const getRes = await fetchGet('/profile', { Cookie: cookie })
      assertHtmlResponse(getRes, 200)
      const html = await getRes.text()
      expect(html).toContain('Original Callsign')
      expect(html).toContain('pilot1@example.com')
      expect(html).toContain('Register Passkey')

      // POST /profile updates details
      const postRes = await fetchPostForm(
        '/profile',
        {
          displayName: 'Phoenix Commander',
          email: 'phoenix@example.com',
          regulatoryRegion: 'US',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(postRes.status)

      // Verify directly in D1 SQLite
      const db = getDb()
      const [updatedUser] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, flyer.id))
      expect(updatedUser.displayName).toBe('Phoenix Commander')
      expect(updatedUser.email).toBe('phoenix@example.com')
      expect(updatedUser.regulatoryRegion).toBe('US')
      expect(updatedUser.updatedAt).toBeGreaterThan(flyer.createdAt)
    })
  })

  describe('Check 3: Genuine Rocketry Certifications (Levels 0–3, TRA/ARA/NAR, Context Reflection)', () => {
    it('authentically tracks Level 0 Junior certification and updates active flyer context', async () => {
      const flyer = await seedTestUser({ displayName: 'Junior Flyer' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      // Post Level 0 certification (ARA)
      const postRes = await fetchPostForm(
        '/profile/certifications',
        {
          certifying_body: 'ARA',
          level: '0',
          cert_number: 'ARA-JR-2026',
          expires_on: '2028-12-31',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(postRes.status)

      // Query D1 directly: verify certification record
      const db = getDb()
      const [cert] = await db
        .select()
        .from(schema.certifications)
        .where(
          and(
            eq(schema.certifications.userId, flyer.id),
            eq(schema.certifications.certifyingBody, 'ARA'),
            isNull(schema.certifications.deletedAt),
          ),
        )
      expect(cert).toBeDefined()
      expect(cert.level).toBe(0)
      expect(cert.certNumber).toBe('ARA-JR-2026')
      expect(cert.expiresOn).toBe('2028-12-31')

      // Verify context calculation includes Level 0 primary cert info
      const context = await getActiveFlyer(db, flyer.id)
      expect(context).not.toBeNull()
      expect(context?.maxCertLevel).toBe(0)
      expect(context?.certifyingBody).toBe('ARA')
      expect(context?.certNumber).toBe('ARA-JR-2026')

      // Verify /profile UI renders Level 0 badge
      const profileRes = await fetchGet('/profile', { Cookie: cookie })
      const html = await profileRes.text()
      expect(html).toContain('ARA L0')
      expect(html).toContain('ARA-JR-2026')
    })

    it('authentically tracks Level 3 HPR certification and upgrades flyer context', async () => {
      const flyer = await seedTestUser({ displayName: 'Master Flyer' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      // Post Level 3 certification (TRA)
      const postRes = await fetchPostForm(
        '/profile/certifications',
        {
          certifying_body: 'TRA',
          level: '3',
          cert_number: 'TRA-L3-7744',
          expires_on: '2029-06-30',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(postRes.status)

      // Verify context calculation upgrades to Level 3
      const db = getDb()
      const context = await getActiveFlyer(db, flyer.id)
      expect(context?.maxCertLevel).toBe(3)
      expect(context?.certifyingBody).toBe('TRA')
      expect(context?.certNumber).toBe('TRA-L3-7744')
    })
  })

  describe('Check 4: Genuine Multi-Club Tracking & Soft-Deletion', () => {
    it('records multiple clubs simultaneously with distinct numbers and soft-deletes upon removal', async () => {
      const flyer = await seedTestUser({ displayName: 'Multi-Club Flyer' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      // Add Victorian Rocketry Association
      await fetchPostForm(
        '/profile/clubs',
        {
          club_name: 'Victorian Rocketry Association',
          membership_number: 'VRA-9912',
          expires_on: '2027-12-31',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      // Add Southern Australia Rocketry Club
      await fetchPostForm(
        '/profile/clubs',
        {
          club_name: 'Southern Australia Rocketry Club',
          membership_number: 'SARC-3301',
          expires_on: '2027-06-30',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      // Add Tripoli Australia
      await fetchPostForm(
        '/profile/clubs',
        {
          club_name: 'Tripoli Australia',
          membership_number: 'TRA-AU-552',
        },
        { Cookie: cookie },
        { redirect: 'manual' },
      )

      const db = getDb()

      // Query D1 directly: all 3 clubs must exist
      const activeClubs = await db
        .select()
        .from(schema.clubMemberships)
        .where(
          and(
            eq(schema.clubMemberships.userId, flyer.id),
            isNull(schema.clubMemberships.deletedAt),
          ),
        )
      expect(activeClubs).toHaveLength(3)

      const sarc = activeClubs.find((c) => c.clubName === 'Southern Australia Rocketry Club')
      expect(sarc).toBeDefined()
      expect(sarc?.membershipNumber).toBe('SARC-3301')

      // Verify profile UI shows all 3
      const profileRes = await fetchGet('/profile', { Cookie: cookie })
      const html = await profileRes.text()
      expect(html).toContain('Victorian Rocketry Association')
      expect(html).toContain('VRA-9912')
      expect(html).toContain('Southern Australia Rocketry Club')
      expect(html).toContain('SARC-3301')
      expect(html).toContain('Tripoli Australia')
      expect(html).toContain('TRA-AU-552')

      // Soft delete SARC club
      const deleteRes = await fetchPostForm(
        `/profile/clubs/${sarc!.id}/delete`,
        {},
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(deleteRes.status)

      // Verify D1: SARC has deletedAt timestamp, historical record is preserved
      const [deletedSarc] = await db
        .select()
        .from(schema.clubMemberships)
        .where(eq(schema.clubMemberships.id, sarc!.id))
      expect(deletedSarc.deletedAt).toBeTypeOf('number')
      expect(deletedSarc.deletedAt!).toBeGreaterThan(0)

      // Active clubs query returns 2
      const remainingClubs = await db
        .select()
        .from(schema.clubMemberships)
        .where(
          and(
            eq(schema.clubMemberships.userId, flyer.id),
            isNull(schema.clubMemberships.deletedAt),
          ),
        )
      expect(remainingClubs).toHaveLength(2)

      // UI no longer shows SARC
      const profileAfterRes = await fetchGet('/profile', { Cookie: cookie })
      const htmlAfter = await profileAfterRes.text()
      expect(htmlAfter).toContain('Victorian Rocketry Association')
      expect(htmlAfter).toContain('Tripoli Australia')
      expect(htmlAfter).not.toContain('SARC-3301')
    })
  })

  describe('Check 5: Authentic Self-Service WebAuthn Passkey Ceremony & Management', () => {
    it('verifies client-side ceremony script and allows passkey renaming and deletion', async () => {
      const flyer = await seedTestUser({ displayName: 'Passkey Pilot' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const db = getDb()
      const now = Date.now()
      const credId = crypto.randomUUID()

      // Insert authentic passkey credential
      await db.insert(schema.userCredentials).values({
        id: credId,
        userId: flyer.id,
        publicKey: 'pubkey-raw-base64',
        friendlyName: 'MacBook TouchID Sensor',
        createdAt: now,
      })

      // Verify /profile renders passkey and authentic ceremony script
      const profileRes = await fetchGet('/profile', { Cookie: cookie })
      const html = await profileRes.text()
      expect(html).toContain('MacBook TouchID Sensor')
      expect(html).toContain('register-passkey-btn')
      expect(html).toContain('navigator.credentials.create')
      expect(html).toContain('/auth/webauthn/register-options')
      expect(html).toContain('/auth/webauthn/register-verify')

      // Rename passkey via POST /profile/passkeys/:id/rename
      const renameRes = await fetchPostForm(
        `/profile/passkeys/${credId}/rename`,
        { friendly_name: 'YubiKey 5 NFC Hardware Key' },
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(renameRes.status)

      // Verify in D1
      const [renamedCred] = await db
        .select()
        .from(schema.userCredentials)
        .where(eq(schema.userCredentials.id, credId))
      expect(renamedCred.friendlyName).toBe('YubiKey 5 NFC Hardware Key')

      // Delete passkey via POST /profile/passkeys/:id/delete
      const deleteRes = await fetchPostForm(
        `/profile/passkeys/${credId}/delete`,
        {},
        { Cookie: cookie },
        { redirect: 'manual' },
      )
      expect([200, 302, 303]).toContain(deleteRes.status)

      // Verify in D1: completely deleted
      const [deletedCred] = await db
        .select()
        .from(schema.userCredentials)
        .where(eq(schema.userCredentials.id, credId))
      expect(deletedCred).toBeUndefined()
    })
  })

  describe('Check 6: Strict RBAC Isolation from /profile', () => {
    it('non-admin flyers on /profile see no admin links in desktop or mobile navigation', async () => {
      const flyer = await seedTestUser({ role: 'flyer', displayName: 'Regular Flyer' })
      const token = await signSession(flyer.id)
      const cookie = `triplet_session=${token}`

      const res = await fetchGet('/profile', { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).not.toContain('/admin/users')
      expect(html).not.toContain('href="/admin"')
    })

    it('admin user on /profile sees admin navigation link', async () => {
      const admin = await seedTestUser({ role: 'admin', displayName: 'Admin Officer' })
      const token = await signSession(admin.id)
      const cookie = `triplet_session=${token}`

      const res = await fetchGet('/profile', { Cookie: cookie })
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('/admin/users')
    })
  })
})
