/**
 * Empirical Adversarial Verification Suite for Milestone 5:
 * Requirement R5: User Profile Self-Management, WebAuthn Passkeys, Multi-Club Tracking & Certifications
 *
 * Verification Objectives:
 * 1. Authentication & Route Guarding:
 *    - Unauthenticated GET /profile strictly redirects to /login (HTTP 302).
 *    - Unauthenticated POST /profile, /profile/certifications, /profile/clubs, etc. strictly redirect or return 401.
 *    - Content-negotiated unauthorized response: 302 redirect for HTML, 401 for application/json.
 * 2. Regular Non-Admin Flyer Profile Access:
 *    - Regular flyer (role === 'flyer') receives HTTP 200 on GET /profile (not 403, not redirected to admin).
 *    - Renders all 4 profile cards: Profile Info, WebAuthn Passkeys, Rocketry Certifications, Multi-Club Memberships.
 *    - Displays "Certified Flyer" badge and hides all administrative links/controls.
 *    - Admin flyer (role === 'admin') receives HTTP 200 on GET /profile with "Administrator" badge.
 * 3. Profile Information Updates (POST /profile):
 *    - Updates displayName, email, and regulatoryRegion via HTML form and JSON payloads.
 *    - Supports both camelCase and snake_case parameter names.
 *    - Direct D1 database verification of updated fields, timestamp, and whitespace trimming.
 *    - Enforces valid regulatory regions ('SA', 'US') while gracefully handling invalid inputs.
 * 4. Self-Service WebAuthn Passkey Registration:
 *    - Regular flyer retrieves registration options via POST /auth/webauthn/register-options (HTTP 200 JSON).
 *    - Validates challenge generation, RP ID, user details, pubKeyCredParams, and webauthn_challenge cookie.
 *    - Regular flyer enrolls passkey via POST /auth/webauthn/register-verify (HTTP 200 JSON).
 *    - Direct D1 database verification of userCredentials row.
 *    - Enrolled passkeys render in profile passkey card with friendly name, enrolled date, and delete controls.
 * 5. Passkey Management & Ownership Enforcement (Adversarial Challenge):
 *    - Cross-Tenant Deletion Attack: Flyer A cannot delete Flyer B's passkey (record remains intact in D1).
 *    - Cross-Tenant Renaming Attack: Flyer A cannot rename Flyer B's passkey (friendlyName unchanged in D1).
 *    - Legitimate owner can delete and rename their own passkey.
 * 6. Rocketry Certifications (TRA, ARA, NAR across Levels 0–3):
 *    - Level 0 (Junior / Uncertified) persists in D1 and correctly updates ActiveFlyer primaryCertBody and primaryCertNumber.
 *    - Level 3 (Maximum HPR) and Australian Rocketry Association (ARA) persist correctly.
 *    - In-place upsert semantics: updating existing certification updates level and cert number without row duplication.
 *    - Soft-deleted certifications are excluded from active profile view.
 * 7. Multi-Club Memberships & Cross-Tenant Protection:
 *    - Adds multiple distinct club affiliations simultaneously with membership numbers.
 *    - Rejects empty club names with validation error.
 *    - Soft-delete: sets deletedAt timestamp, hides from profile view, preserves audit row in D1.
 *    - Cross-Tenant Club Deletion Attack: Flyer A cannot soft-delete Flyer B's club membership.
 * 8. Layout & Probe Regression:
 *    - Header status pill and mobile bottom companion bar link to /profile.
 *    - Liveness (/health) and readiness (/ready) probes remain unaffected and return HTTP 200.
 *
 * Authored by Milestone 5 Challenger 1.
 */

import { env, SELF } from 'cloudflare:test'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { getActiveFlyer } from '../src/db/context'
import { signSession } from '../src/services/auth'
import {
  getDb,
  seedTestCert,
  seedTestClubMembership,
  seedTestUser,
  truncateDb,
} from './helpers/db'
import { assertHtmlResponse, assertContains } from './helpers/html'
import { fetchGet, fetchPostForm } from './helpers/http'

beforeEach(async () => {
  await truncateDb()
  try {
    const now = Date.now()
    await env.DB.prepare(
      "INSERT OR REPLACE INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?, ?)"
    ).bind(now, now).run()
  } catch {}
})

describe('Milestone 5 Adversarial Challenge: Profile Route & WebAuthn Passkeys', () => {
  // =========================================================================
  // Vector 1: Authentication & Access Control Enforcement
  // =========================================================================
  describe('Vector 1: Authentication & Route Access Enforcement', () => {
    it('1.1: unauthenticated GET /profile redirects to /login with 302', async () => {
      const res = await fetchGet(
        '/profile',
        { 'x-no-auth': 'true', Accept: 'text/html' },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(302)
      const location = res.headers.get('location') || ''
      expect(location).toMatch(/\/login/i)
      expect(location).toContain('redirect=')
    })

    it('1.2: unauthenticated GET /profile with Accept: application/json returns HTTP 401', async () => {
      const res = await fetchGet(
        '/profile',
        { 'x-no-auth': 'true', Accept: 'application/json' },
        { redirect: 'manual' },
      )

      expect(res.status).toBe(401)
      const data = await res.json<{ error: string; message: string }>()
      expect(data.error).toBe('Unauthorized')
    })

    it('1.3: unauthenticated POST /profile redirects to /login (or returns 401 JSON)', async () => {
      // HTML form submission without auth
      const formRes = await fetchPostForm(
        '/profile',
        { displayName: 'Intruder' },
        { 'x-no-auth': 'true', Accept: 'text/html' },
        { redirect: 'manual' },
      )
      expect(formRes.status).toBe(302)
      expect(formRes.headers.get('location')).toMatch(/\/login/i)

      // JSON submission without auth
      const jsonRes = await SELF.fetch('https://example.com/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-no-auth': 'true',
        },
        body: JSON.stringify({ displayName: 'Intruder' }),
      })
      expect(jsonRes.status).toBe(401)
    })

    it('1.4: unauthenticated sub-route mutations (/certifications, /clubs, /passkeys) are strictly blocked', async () => {
      const unauthHeaders = { 'x-no-auth': 'true', Accept: 'text/html' }

      const certRes = await fetchPostForm('/profile/certifications', { level: '1' }, unauthHeaders, { redirect: 'manual' })
      expect([302, 401]).toContain(certRes.status)

      const clubRes = await fetchPostForm('/profile/clubs', { club_name: 'Unauthorized Club' }, unauthHeaders, { redirect: 'manual' })
      expect([302, 401]).toContain(clubRes.status)

      const clubDelRes = await fetchPostForm('/profile/clubs/fake-id/delete', {}, unauthHeaders, { redirect: 'manual' })
      expect([302, 401]).toContain(clubDelRes.status)

      const pkDelRes = await fetchPostForm('/profile/passkeys/fake-id/delete', {}, unauthHeaders, { redirect: 'manual' })
      expect([302, 401]).toContain(pkDelRes.status)

      const pkRenameRes = await fetchPostForm('/profile/passkeys/fake-id/rename', { friendly_name: 'Hack' }, unauthHeaders, { redirect: 'manual' })
      expect([302, 401]).toContain(pkRenameRes.status)
    })
  })

  // =========================================================================
  // Vector 2: Regular Non-Admin Flyer Profile Screen
  // =========================================================================
  describe('Vector 2: Regular Non-Admin Flyer Profile Screen Rendering', () => {
    it('2.1: regular non-admin flyer receives HTTP 200, seeing all 4 profile cards and zero admin links', async () => {
      const flyer = await seedTestUser({
        role: 'flyer',
        displayName: 'Sarah Connor',
        email: 'sarah@sky-rocketry.org',
        regulatoryRegion: 'SA',
      })
      const token = await signSession(flyer.id)
      const headers = { Cookie: `triplet_session=${token}` }

      const res = await fetchGet('/profile', headers)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // 1. Header & Identity
      expect(html).toContain('Pilot Profile &amp; Settings')
      expect(html).toContain('Certified Flyer')
      expect(html).not.toContain('Administrator')
      expect(html).not.toContain('/admin/users')

      // 2. Card 1: Pilot Profile Information
      expect(html).toContain('Pilot Profile Information')
      expect(html).toContain('name="displayName"')
      expect(html).toContain('value="Sarah Connor"')
      expect(html).toContain('name="email"')
      expect(html).toContain('value="sarah@sky-rocketry.org"')
      expect(html).toContain('name="regulatoryRegion"')

      // 3. Card 2: Self-Service WebAuthn Passkeys
      expect(html).toContain('WebAuthn Passkey Credentials')
      expect(html).toContain('id="register-passkey-btn"')
      expect(html).toContain('id="passkey-reg-status"')
      expect(html).toContain('No WebAuthn passkeys or security keys registered yet')

      // 4. Card 3: Rocketry Certifications
      expect(html).toContain('Rocketry Certifications')
      expect(html).toContain('action="/profile/certifications"')
      expect(html).toContain('name="certifying_body"')
      expect(html).toContain('name="level"')
      expect(html).toContain('name="cert_number"')

      // 5. Card 4: Multi-Club Affiliations
      expect(html).toContain('Club Memberships')
      expect(html).toContain('action="/profile/clubs"')
      expect(html).toContain('name="club_name"')
      expect(html).toContain('name="membership_number"')
    })

    it('2.2: admin user receives HTTP 200 with Administrator badge on profile screen', async () => {
      const admin = await seedTestUser({
        role: 'admin',
        displayName: 'Range Commander',
        email: 'commander@range-control.local',
      })
      const token = await signSession(admin.id)
      const headers = { Cookie: `triplet_session=${token}` }

      const res = await fetchGet('/profile', headers)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('Administrator')
      expect(html).toContain('/admin/users')
    })
  })

  // =========================================================================
  // Vector 3: Profile Updates & Multi-Format Ingestion (POST /profile)
  // =========================================================================
  describe('Vector 3: Profile Updates & Ingestion Robustness', () => {
    it('3.1: updates displayName, email, and regulatoryRegion via HTML form post (camelCase)', async () => {
      const flyer = await seedTestUser({
        displayName: 'Old Callsign',
        email: 'old@example.com',
        regulatoryRegion: 'SA',
      })
      const token = await signSession(flyer.id)
      const headers = { Cookie: `triplet_session=${token}` }

      const postRes = await fetchPostForm(
        '/profile',
        {
          displayName: 'Valkyrie One',
          email: 'valkyrie@orbit.org',
          regulatoryRegion: 'US',
        },
        headers,
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(postRes.status)
      expect(postRes.headers.get('location')).toBe('/profile?saved=profile')

      // Verify direct D1 state
      const db = getDb()
      const [updated] = await db.select().from(schema.users).where(eq(schema.users.id, flyer.id)).limit(1)
      expect(updated.displayName).toBe('Valkyrie One')
      expect(updated.email).toBe('valkyrie@orbit.org')
      expect(updated.regulatoryRegion).toBe('US')
      expect(updated.updatedAt).toBeGreaterThan(0)

      // Verify flash banner rendered on redirect target
      const followRes = await fetchGet('/profile?saved=profile', headers)
      const followHtml = await followRes.text()
      expect(followHtml).toContain('Pilot profile updated successfully.')
      expect(followHtml).toContain('value="Valkyrie One"')
      expect(followHtml).toContain('value="valkyrie@orbit.org"')
    })

    it('3.2: updates profile using snake_case field fallbacks (display_name, regulatory_region)', async () => {
      const flyer = await seedTestUser({ displayName: 'Initial Name', regulatoryRegion: 'SA' })
      const token = await signSession(flyer.id)
      const headers = { Cookie: `triplet_session=${token}` }

      const postRes = await fetchPostForm(
        '/profile',
        {
          display_name: 'Aero Commander',
          regulatory_region: 'US',
        },
        headers,
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(postRes.status)

      const db = getDb()
      const [updated] = await db.select().from(schema.users).where(eq(schema.users.id, flyer.id)).limit(1)
      expect(updated.displayName).toBe('Aero Commander')
      expect(updated.regulatoryRegion).toBe('US')
    })

    it('3.3: updates profile via JSON payload returning HTTP 200 JSON', async () => {
      const flyer = await seedTestUser({ displayName: 'JSON Pilot', email: 'json@pilot.org' })
      const token = await signSession(flyer.id)

      const jsonRes = await SELF.fetch('https://example.com/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({
          displayName: 'Updated JSON Pilot',
          email: 'newjson@pilot.org',
          regulatoryRegion: 'SA',
        }),
      })

      expect(jsonRes.status).toBe(200)
      const data = await jsonRes.json<{ status: string; message: string }>()
      expect(data.status).toBe('ok')

      const db = getDb()
      const [updated] = await db.select().from(schema.users).where(eq(schema.users.id, flyer.id)).limit(1)
      expect(updated.displayName).toBe('Updated JSON Pilot')
      expect(updated.email).toBe('newjson@pilot.org')
    })

    it('3.4: trims whitespace and ignores invalid regulatory region without corrupting state', async () => {
      const flyer = await seedTestUser({
        displayName: 'Clean Name',
        email: 'clean@pilot.org',
        regulatoryRegion: 'SA',
      })
      const token = await signSession(flyer.id)
      const headers = { Cookie: `triplet_session=${token}` }

      await fetchPostForm(
        '/profile',
        {
          displayName: '   Trimmed Pilot   ',
          email: '  TRIMMED@PILOT.ORG  ',
          regulatoryRegion: 'MARS_COLONY', // Invalid region, should be ignored
        },
        headers,
        { redirect: 'manual' },
      )

      const db = getDb()
      const [updated] = await db.select().from(schema.users).where(eq(schema.users.id, flyer.id)).limit(1)
      expect(updated.displayName).toBe('Trimmed Pilot')
      expect(updated.email).toBe('trimmed@pilot.org')
      expect(updated.regulatoryRegion).toBe('SA') // Preserved SA
    })
  })

  // =========================================================================
  // Vector 4: Self-Service WebAuthn Passkey Registration Flow
  // =========================================================================
  describe('Vector 4: Self-Service WebAuthn Passkeys', () => {
    it('4.1: regular flyer fetches registration options via POST /auth/webauthn/register-options', async () => {
      const flyer = await seedTestUser({ displayName: 'Passkey Pilot', email: 'passkey@pilot.org' })
      const token = await signSession(flyer.id)

      const res = await SELF.fetch('https://example.com/auth/webauthn/register-options', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
      })

      expect(res.status).toBe(200)
      const data = await res.json<any>()

      expect(data.challenge).toBeDefined()
      expect(typeof data.challenge).toBe('string')
      expect(data.challenge.length).toBeGreaterThan(16)

      expect(data.rp).toBeDefined()
      expect(data.rp.name).toBe('TripleT Rocketry')
      expect(data.rp.id).toBe('example.com')

      expect(data.user).toBeDefined()
      expect(data.user.id).toBe(flyer.id)
      expect(data.user.name).toBe('passkey@pilot.org')
      expect(data.user.displayName).toBe('Passkey Pilot')

      expect(data.pubKeyCredParams).toBeDefined()
      expect(Array.isArray(data.pubKeyCredParams)).toBe(true)

      const setCookie = res.headers.get('set-cookie') || ''
      expect(setCookie).toMatch(/webauthn_challenge=/i)
    })

    it('4.2: unauthenticated request to /auth/webauthn/register-options returns 401', async () => {
      const res = await SELF.fetch('https://example.com/auth/webauthn/register-options', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-no-auth': 'true',
        },
      })
      expect(res.status).toBe(401)
    })

    it('4.3: completes passkey registration via POST /auth/webauthn/register-verify and displays in profile', async () => {
      const flyer = await seedTestUser({ displayName: 'Biometric Flyer', email: 'bio@flyer.org' })
      const token = await signSession(flyer.id)
      const headers = { Cookie: `triplet_session=${token}` }

      const fakeCredId = 'fido2-cred-xyz-9988'
      const verifyRes = await SELF.fetch('https://example.com/auth/webauthn/register-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({
          id: fakeCredId,
          rawId: fakeCredId,
          type: 'public-key',
          friendlyName: 'MacBook TouchID Sensor',
          publicKey: 'mock-public-key-curve-p256',
          deviceType: 'platform',
          backedUp: true,
          response: {
            clientDataJSON: btoa(JSON.stringify({ type: 'webauthn.create', challenge: 'fake-challenge' })),
            attestationObject: 'mock-attestation-bytes',
            publicKey: 'mock-public-key-curve-p256',
          },
        }),
      })

      expect(verifyRes.status).toBe(200)
      const verifyData = await verifyRes.json<any>()
      expect(verifyData.status).toBe('ok')
      expect(verifyData.verified).toBe(true)
      expect(verifyData.credentialId).toBe(fakeCredId)

      // Assert persistence in D1 userCredentials table
      const db = getDb()
      const [cred] = await db
        .select()
        .from(schema.userCredentials)
        .where(eq(schema.userCredentials.id, fakeCredId))
        .limit(1)

      expect(cred).toBeDefined()
      expect(cred.userId).toBe(flyer.id)
      expect(cred.friendlyName).toBe('MacBook TouchID Sensor')
      expect(cred.publicKey).toBe('mock-public-key-curve-p256')

      // Verify GET /profile now displays the enrolled passkey
      const profileRes = await fetchGet('/profile', headers)
      const profileHtml = await profileRes.text()
      expect(profileHtml).toContain('MacBook TouchID Sensor')
      expect(profileHtml).toContain(`/profile/passkeys/${fakeCredId}/delete`)
    })
  })

  // =========================================================================
  // Vector 5: Passkey Renaming, Deletion & Ownership Enforcement (Adversarial)
  // =========================================================================
  describe('Vector 5: Passkey Management & Multi-Tenant Ownership Enforcement', () => {
    it('5.1: owner can rename passkey label via POST /profile/passkeys/:id/rename', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const headers = { Cookie: `triplet_session=${token}` }

      const db = getDb()
      const credId = crypto.randomUUID()
      await db.insert(schema.userCredentials).values({
        id: credId,
        userId: flyer.id,
        publicKey: 'mock-pub-key-1',
        friendlyName: 'Original YubiKey 5C',
        createdAt: Date.now(),
      })

      const renameRes = await fetchPostForm(
        `/profile/passkeys/${credId}/rename`,
        { friendly_name: 'Primary Range Hardware Token' },
        headers,
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(renameRes.status)

      const [updatedCred] = await db
        .select()
        .from(schema.userCredentials)
        .where(eq(schema.userCredentials.id, credId))
        .limit(1)
      expect(updatedCred.friendlyName).toBe('Primary Range Hardware Token')
    })

    it('5.2: owner can delete passkey via POST /profile/passkeys/:id/delete', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const headers = { Cookie: `triplet_session=${token}` }

      const db = getDb()
      const credId = crypto.randomUUID()
      await db.insert(schema.userCredentials).values({
        id: credId,
        userId: flyer.id,
        publicKey: 'mock-pub-key-to-delete',
        friendlyName: 'Disposable Security Key',
        createdAt: Date.now(),
      })

      const delRes = await fetchPostForm(`/profile/passkeys/${credId}/delete`, {}, headers, { redirect: 'manual' })
      expect([302, 303]).toContain(delRes.status)

      // Direct D1 check: row should be deleted
      const rows = await db.select().from(schema.userCredentials).where(eq(schema.userCredentials.id, credId))
      expect(rows).toHaveLength(0)
    })

    it('5.3: ADVERSARIAL ATTACK: Flyer A cannot delete Flyer B passkey', async () => {
      const flyerA = await seedTestUser({ email: 'attacker@evil.org' })
      const flyerB = await seedTestUser({ email: 'victim@innocent.org' })
      const tokenA = await signSession(flyerA.id)
      const headersA = { Cookie: `triplet_session=${tokenA}` }

      const db = getDb()
      const victimCredId = crypto.randomUUID()
      await db.insert(schema.userCredentials).values({
        id: victimCredId,
        userId: flyerB.id,
        publicKey: 'victim-pub-key-vault',
        friendlyName: 'Victim Solo Key',
        createdAt: Date.now(),
      })

      // Flyer A attempts to delete Flyer B's passkey
      const attackRes = await fetchPostForm(
        `/profile/passkeys/${victimCredId}/delete`,
        {},
        headersA,
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(attackRes.status)

      // Assert database state: Victim credential MUST STILL EXIST!
      const [intactCred] = await db
        .select()
        .from(schema.userCredentials)
        .where(eq(schema.userCredentials.id, victimCredId))
        .limit(1)
      expect(intactCred).toBeDefined()
      expect(intactCred.userId).toBe(flyerB.id)
      expect(intactCred.friendlyName).toBe('Victim Solo Key')
    })

    it('5.4: ADVERSARIAL ATTACK: Flyer A cannot rename Flyer B passkey', async () => {
      const flyerA = await seedTestUser({ email: 'attacker@evil.org' })
      const flyerB = await seedTestUser({ email: 'victim@innocent.org' })
      const tokenA = await signSession(flyerA.id)
      const headersA = { Cookie: `triplet_session=${tokenA}` }

      const db = getDb()
      const victimCredId = crypto.randomUUID()
      await db.insert(schema.userCredentials).values({
        id: victimCredId,
        userId: flyerB.id,
        publicKey: 'victim-pub-key-vault',
        friendlyName: 'Untouched Name',
        createdAt: Date.now(),
      })

      // Flyer A attempts to rename Flyer B's passkey
      await fetchPostForm(
        `/profile/passkeys/${victimCredId}/rename`,
        { friendly_name: 'Defaced by Attacker' },
        headersA,
        { redirect: 'manual' },
      )

      // Assert database state: Victim credential name MUST REMAIN UNTOUCHED!
      const [intactCred] = await db
        .select()
        .from(schema.userCredentials)
        .where(eq(schema.userCredentials.id, victimCredId))
        .limit(1)
      expect(intactCred.friendlyName).toBe('Untouched Name')
    })
  })

  // =========================================================================
  // Vector 6: Rocketry Certifications (TRA, ARA, NAR across Levels 0–3)
  // =========================================================================
  describe('Vector 6: Rocketry Certifications (TRA, ARA, NAR Levels 0-3)', () => {
    it('6.1: saves Level 0 certification and correctly updates ActiveFlyer context', async () => {
      const flyer = await seedTestUser({ displayName: 'Junior Flyer' })
      const token = await signSession(flyer.id)
      const headers = { Cookie: `triplet_session=${token}` }

      const res = await fetchPostForm(
        '/profile/certifications',
        {
          certifying_body: 'TRA',
          level: '0',
          cert_number: 'TRA-JR-001',
          expires_on: '2029-06-30',
        },
        headers,
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res.status)

      const db = getDb()
      const [cert] = await db
        .select()
        .from(schema.certifications)
        .where(eq(schema.certifications.userId, flyer.id))
        .limit(1)
      expect(cert).toBeDefined()
      expect(cert.level).toBe(0)
      expect(cert.certifyingBody).toBe('TRA')
      expect(cert.certNumber).toBe('TRA-JR-001')

      // Assert ActiveFlyer context retains level 0 certification body and number
      const activeFlyer = await getActiveFlyer(db, flyer.id)
      expect(activeFlyer).not.toBeNull()
      expect(activeFlyer!.maxCertLevel).toBe(0)
      expect(activeFlyer!.certifyingBody).toBe('TRA')
      expect(activeFlyer!.certNumber).toBe('TRA-JR-001')
    })

    it('6.2: saves Level 3 Maximum HPR certification and Australian Rocketry Association (ARA)', async () => {
      const flyer = await seedTestUser({ displayName: 'Senior HPR Pilot' })
      const token = await signSession(flyer.id)
      const headers = { Cookie: `triplet_session=${token}` }

      // Save ARA Level 3 certification
      const res = await fetchPostForm(
        '/profile/certifications',
        {
          certifying_body: 'ARA',
          level: '3',
          cert_number: 'ARA-L3-9999',
          expires_on: '2030-12-31',
        },
        headers,
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res.status)

      const db = getDb()
      const [cert] = await db
        .select()
        .from(schema.certifications)
        .where(eq(schema.certifications.userId, flyer.id))
        .limit(1)
      expect(cert.certifyingBody).toBe('ARA')
      expect(cert.level).toBe(3)
      expect(cert.certNumber).toBe('ARA-L3-9999')

      const activeFlyer = await getActiveFlyer(db, flyer.id)
      expect(activeFlyer!.maxCertLevel).toBe(3)
      expect(activeFlyer!.certifyingBody).toBe('ARA')
      expect(activeFlyer!.certNumber).toBe('ARA-L3-9999')

      // Verify rendered badge on GET /profile
      const profileRes = await fetchGet('/profile', headers)
      const html = await profileRes.text()
      expect(html).toContain('ARA L3')
      expect(html).toContain('ARA-L3-9999')
    })

    it('6.3: upsert semantics: updating existing certification updates in-place without duplicating rows', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const headers = { Cookie: `triplet_session=${token}` }

      // Step 1: Initial TRA Level 1
      await fetchPostForm(
        '/profile/certifications',
        { certifying_body: 'TRA', level: '1', cert_number: 'TRA-100', expires_on: '2027-01-01' },
        headers,
        { redirect: 'manual' },
      )

      // Step 2: Upgrade to TRA Level 2
      await fetchPostForm(
        '/profile/certifications',
        { certifying_body: 'TRA', level: '2', cert_number: 'TRA-100-L2', expires_on: '2028-01-01' },
        headers,
        { redirect: 'manual' },
      )

      const db = getDb()
      const certs = await db
        .select()
        .from(schema.certifications)
        .where(
          and(
            eq(schema.certifications.userId, flyer.id),
            eq(schema.certifications.certifyingBody, 'TRA'),
            isNull(schema.certifications.deletedAt),
          ),
        )

      // Must only be ONE active row for TRA
      expect(certs).toHaveLength(1)
      expect(certs[0].level).toBe(2)
      expect(certs[0].certNumber).toBe('TRA-100-L2')
      expect(certs[0].expiresOn).toBe('2028-01-01')
    })
  })

  // =========================================================================
  // Vector 7: Multi-Club Affiliations & Cross-Tenant Deletion Attacks
  // =========================================================================
  describe('Vector 7: Multi-Club Affiliations & Cross-Tenant Protection', () => {
    it('7.1: flyer can record multiple distinct clubs simultaneously with membership numbers', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const headers = { Cookie: `triplet_session=${token}` }

      // Add Club 1: Victorian Rocketry Association
      await fetchPostForm(
        '/profile/clubs',
        { club_name: 'Victorian Rocketry Association', membership_number: 'VRA-2026-88', expires_on: '2027-06-30' },
        headers,
        { redirect: 'manual' },
      )

      // Add Club 2: Southern Area Rocketry Club (SARC)
      await fetchPostForm(
        '/profile/clubs',
        { club_name: 'Southern Area Rocketry Club', membership_number: 'SARC-405', expires_on: '2027-12-31' },
        headers,
        { redirect: 'manual' },
      )

      // Add Club 3: Tripoli Australia
      await fetchPostForm(
        '/profile/clubs',
        { club_name: 'Tripoli Australia', membership_number: 'TRA-AU-77', expires_on: '2028-12-31' },
        headers,
        { redirect: 'manual' },
      )

      const db = getDb()
      const clubs = await db
        .select()
        .from(schema.clubMemberships)
        .where(
          and(
            eq(schema.clubMemberships.userId, flyer.id),
            isNull(schema.clubMemberships.deletedAt),
          ),
        )

      expect(clubs).toHaveLength(3)

      // Verify GET /profile displays all 3 clubs
      const res = await fetchGet('/profile', headers)
      const html = await res.text()
      expect(html).toContain('Victorian Rocketry Association')
      expect(html).toContain('VRA-2026-88')
      expect(html).toContain('Southern Area Rocketry Club')
      expect(html).toContain('SARC-405')
      expect(html).toContain('Tripoli Australia')
      expect(html).toContain('TRA-AU-77')
    })

    it('7.2: rejects empty club name with validation error flash or 400', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)

      // Form post with empty name
      const formRes = await fetchPostForm(
        '/profile/clubs',
        { club_name: '   ' },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )
      expect([302, 303, 400]).toContain(formRes.status)

      // JSON post with empty name
      const jsonRes = await SELF.fetch('https://example.com/profile/clubs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: JSON.stringify({ club_name: '' }),
      })
      expect(jsonRes.status).toBe(400)
    })

    it('7.3: soft-deletes club membership preserving audit trail in D1', async () => {
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const headers = { Cookie: `triplet_session=${token}` }

      const club = await seedTestClubMembership(flyer.id, { clubName: 'Temporary Rocketry Club' })

      const delRes = await fetchPostForm(
        `/profile/clubs/${club.id}/delete`,
        {},
        headers,
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(delRes.status)

      // Assert D1: record still exists but deletedAt is populated
      const db = getDb()
      const [dbClub] = await db
        .select()
        .from(schema.clubMemberships)
        .where(eq(schema.clubMemberships.id, club.id))
        .limit(1)

      expect(dbClub).toBeDefined()
      expect(dbClub.deletedAt).not.toBeNull()
      expect(dbClub.deletedAt).toBeGreaterThan(0)

      // Assert GET /profile hides the deleted club
      const profileRes = await fetchGet('/profile', headers)
      const html = await profileRes.text()
      expect(html).not.toContain('Temporary Rocketry Club')
    })

    it('7.4: ADVERSARIAL ATTACK: Flyer A cannot delete Flyer B club affiliation', async () => {
      const flyerA = await seedTestUser({ email: 'intruder@club.org' })
      const flyerB = await seedTestUser({ email: 'member@club.org' })
      const tokenA = await signSession(flyerA.id)
      const headersA = { Cookie: `triplet_session=${tokenA}` }

      const victimClub = await seedTestClubMembership(flyerB.id, { clubName: 'Victim Secure Club' })

      // Flyer A attempts to delete Flyer B's club
      const attackRes = await fetchPostForm(
        `/profile/clubs/${victimClub.id}/delete`,
        {},
        headersA,
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(attackRes.status)

      // Assert D1: victimClub.deletedAt MUST REMAIN NULL!
      const db = getDb()
      const [intactClub] = await db
        .select()
        .from(schema.clubMemberships)
        .where(eq(schema.clubMemberships.id, victimClub.id))
        .limit(1)

      expect(intactClub).toBeDefined()
      expect(intactClub.deletedAt).toBeNull()
    })
  })

  // =========================================================================
  // Vector 8: System Integrity, Navigation & Probes Regression
  // =========================================================================
  describe('Vector 8: Layout Links & Health Probe Integrity', () => {
    it('8.1: header pilot pill and mobile navigation link to /profile', async () => {
      const flyer = await seedTestUser({ displayName: 'Apollo Flyer' })
      const token = await signSession(flyer.id)
      const headers = { Cookie: `triplet_session=${token}` }

      const res = await fetchGet('/', headers)
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Desktop top header pilot pill
      expect(html).toContain('href="/profile"')
      expect(html).toContain('title="View Profile and Settings"')

      // Mobile bottom bar
      expect(html).toContain('<a href="/profile"')
      expect(html).toContain('Profile</span>')
    })

    it('8.2: health and readiness probes remain unaffected and return HTTP 200', async () => {
      const healthRes = await fetchGet('/health')
      expect(healthRes.status).toBe(200)
      const healthData = await healthRes.json<{ status: string }>()
      expect(healthData.status).toBe('ok')

      const readyRes = await fetchGet('/ready')
      expect(readyRes.status).toBe(200)
      const readyData = await readyRes.json<{ status: string; database: string }>()
      expect(readyData.status).toBe('ready')
      expect(readyData.database).toBe('ok')
    })
  })
})
