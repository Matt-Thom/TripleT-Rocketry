/**
 * Challenger M1-2 Adversarial Verification Test Suite
 *
 * Requirements tested:
 * 1. Database schema constraint integrity in migrations/0002_schema_enhancements.sql and src/db/schema.ts:
 *    - Foreign key cascades from users(id) to sessions and user_credentials.
 *    - Unique constraint on sessions.token.
 *    - Clean D1 migrations execution in workerd environment.
 * 2. Session validity: newly issued session token matches session record in database.
 * 3. Token signature tampering, boundary conditions, and PBKDF2 password hashing integrity.
 */

import { env } from 'cloudflare:test'
import { describe, expect, it, beforeEach } from 'vitest'
import { getDb, truncateDb } from '../helpers/db'
import { fetchGet, fetchPostForm } from '../helpers/http'
import * as schema from '../../src/db/schema'
import { parseCookies, verifySession, signSession, verifyPassword } from '../../src/services/auth'
import { eq } from 'drizzle-orm'

describe('Challenger M1-2: Schema Constraints, Migrations, and Session Integrity', () => {
  beforeEach(async () => {
    await truncateDb()
    try {
      await env.DB.prepare('DELETE FROM site_settings').run()
    } catch {
      // Ignored if table absent
    }
  })

  // =========================================================================
  // VECTOR 1: D1 Migrations & Schema Structure in workerd
  // =========================================================================
  describe('Vector 1: D1 Migrations & Schema Structure in workerd', () => {
    it('1.1: migrations apply cleanly and create all expected M1 tables', async () => {
      const { results } = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('site_settings', 'sessions', 'user_credentials')",
      ).all<{ name: string }>()

      const tableNames = results.map((r) => r.name).sort()
      expect(tableNames).toEqual(['sessions', 'site_settings', 'user_credentials'])
    })

    it('1.2: users table has role and regulatory_region columns with default values', async () => {
      const db = getDb()
      const [user] = await db
        .insert(schema.users)
        .values({
          email: 'default-columns@rocketry.sa.gov.au',
          displayName: 'Default Columns Pilot',
          passwordHash: 'dummy-hash',
        })
        .returning()

      expect(user.role).toBe('flyer')
      expect(user.regulatoryRegion).toBe('SA')
    })

    it('1.3: documents that users.role is defined in schema with USER_ROLE enum and enforced in D1 DDL', async () => {
      // In src/db/schema.ts, USER_ROLE is restricted to ['admin', 'flyer']
      expect(schema.USER_ROLE).toEqual(['admin', 'flyer'])

      // In D1 SQLite, users table DDL enforces ck_users_role CHECK constraint
      const tableSql = await env.DB.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'",
      ).first<{ sql: string }>()

      expect(tableSql?.sql).toContain('ck_users_role')
    })

    it('1.4: motors table includes all 9 required M1/M3 expansion columns', async () => {
      const db = getDb()
      const [motor] = await db
        .insert(schema.motors)
        .values({
          manufacturer: 'Cesaroni Technology Inc',
          model: 'Pro29-3G',
          impulseClass: 'H',
          delayS: 14,
          partNumber: '243H120-14A',
          hardware: 'Pro29 3-Grain Casing',
          grains: 3,
          propellantWeightG: 68.5,
          grainWeightG: 22.8,
          unNumber: 'UN0384',
          hazardClassification: '1.4C',
          uspsMailable: false,
          notes: 'Tested in Challenger M1-2 harness',
        })
        .returning()

      expect(motor.partNumber).toBe('243H120-14A')
      expect(motor.hardware).toBe('Pro29 3-Grain Casing')
      expect(motor.grains).toBe(3)
      expect(motor.propellantWeightG).toBe(68.5)
      expect(motor.grainWeightG).toBe(22.8)
      expect(motor.unNumber).toBe('UN0384')
      expect(motor.hazardClassification).toBe('1.4C')
      expect(motor.uspsMailable).toBe(false)
      expect(motor.notes).toBe('Tested in Challenger M1-2 harness')
    })

    it('1.5: rocket_configurations table includes drogue_parachute_size_mm column', async () => {
      const db = getDb()
      const [user] = await db
        .insert(schema.users)
        .values({
          email: 'drogue-test@example.com',
          displayName: 'Drogue Tester',
          passwordHash: 'dummy',
        })
        .returning()

      const [rocket] = await db
        .insert(schema.rockets)
        .values({
          ownerId: user.id,
          name: 'Dual Deploy Test Vehicle',
        })
        .returning()

      const [config] = await db
        .insert(schema.rocketConfigurations)
        .values({
          rocketId: rocket.id,
          version: 1,
          recoveryType: 'dual_deploy',
          parachuteSizeMm: 1200,
          drogueParachuteSizeMm: 300,
        })
        .returning()

      expect(config.drogueParachuteSizeMm).toBe(300)
    })
  })

  // =========================================================================
  // VECTOR 2: Schema Constraints: Unique Index & Foreign Key Cascades
  // =========================================================================
  describe('Vector 2: Schema Constraints: Unique Index & Foreign Key Cascades', () => {
    it('2.1: enforces unique constraint on sessions.token (uq_sessions_token)', async () => {
      const db = getDb()
      const [user] = await db
        .insert(schema.users)
        .values({
          email: 'session-unique@example.com',
          displayName: 'Session Unique Tester',
          passwordHash: 'dummy',
        })
        .returning()

      const sharedToken = 'shared-token-value-xyz-12345'
      const now = Date.now()

      // First insert must succeed
      await db.insert(schema.sessions).values({
        id: crypto.randomUUID(),
        userId: user.id,
        token: sharedToken,
        expiresAt: now + 86400000,
        createdAt: now,
      })

      // Second insert with duplicate token MUST fail with UNIQUE constraint violation
      await expect(
        db.insert(schema.sessions).values({
          id: crypto.randomUUID(),
          userId: user.id,
          token: sharedToken,
          expiresAt: now + 86400000,
          createdAt: now,
        }),
      ).rejects.toThrow()
    })

    it('2.2: unique index uq_sessions_token is present in sqlite_master', async () => {
      const indexRow = await env.DB.prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'uq_sessions_token'",
      ).first<{ name: string; sql: string }>()

      expect(indexRow).not.toBeNull()
      expect(indexRow?.name).toBe('uq_sessions_token')
      expect(indexRow?.sql).toContain('UNIQUE')
    })

    it('2.3: foreign key cascade deletes sessions when parent user is deleted', async () => {
      await env.DB.prepare('PRAGMA foreign_keys = ON').run()
      const db = getDb()

      const [user] = await db
        .insert(schema.users)
        .values({
          email: 'cascade-user@example.com',
          displayName: 'Cascade Test User',
          passwordHash: 'dummy',
        })
        .returning()

      const token1 = 'token-cascade-1'
      const token2 = 'token-cascade-2'
      const now = Date.now()

      await db.insert(schema.sessions).values([
        {
          id: crypto.randomUUID(),
          userId: user.id,
          token: token1,
          expiresAt: now + 86400000,
          createdAt: now,
        },
        {
          id: crypto.randomUUID(),
          userId: user.id,
          token: token2,
          expiresAt: now + 86400000,
          createdAt: now,
        },
      ])

      // Verify sessions exist
      const sessionsBefore = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.userId, user.id))
      expect(sessionsBefore.length).toBe(2)

      // Delete the parent user
      await db.delete(schema.users).where(eq(schema.users.id, user.id))

      // Foreign key cascade must have deleted all sessions
      const sessionsAfter = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.userId, user.id))
      expect(sessionsAfter.length).toBe(0)
    })

    it('2.4: foreign key cascade deletes user_credentials when parent user is deleted', async () => {
      await env.DB.prepare('PRAGMA foreign_keys = ON').run()
      const db = getDb()

      const [user] = await db
        .insert(schema.users)
        .values({
          email: 'webauthn-cascade@example.com',
          displayName: 'WebAuthn Cascade User',
          passwordHash: 'dummy',
        })
        .returning()

      const credId = 'cred-id-abc-123'
      await db.insert(schema.userCredentials).values({
        id: credId,
        userId: user.id,
        publicKey: 'base64url-public-key-mock',
        counter: 0,
        deviceType: 'singleDevice',
        friendlyName: 'YubiKey 5C NFC',
      })

      // Verify credential exists
      const credsBefore = await db
        .select()
        .from(schema.userCredentials)
        .where(eq(schema.userCredentials.userId, user.id))
      expect(credsBefore.length).toBe(1)

      // Delete parent user
      await db.delete(schema.users).where(eq(schema.users.id, user.id))

      // Verify credentials were cascaded and deleted
      const credsAfter = await db
        .select()
        .from(schema.userCredentials)
        .where(eq(schema.userCredentials.userId, user.id))
      expect(credsAfter.length).toBe(0)
    })

    it('2.5: rejects session insertion referencing non-existent user under PRAGMA foreign_keys = ON', async () => {
      await env.DB.prepare('PRAGMA foreign_keys = ON').run()
      const db = getDb()

      const nonExistentUserId = crypto.randomUUID()
      await expect(
        db.insert(schema.sessions).values({
          id: crypto.randomUUID(),
          userId: nonExistentUserId,
          token: 'token-for-nobody',
          expiresAt: Date.now() + 86400000,
        }),
      ).rejects.toThrow()
    })

    it('2.6: rejects user_credentials insertion referencing non-existent user under PRAGMA foreign_keys = ON', async () => {
      await env.DB.prepare('PRAGMA foreign_keys = ON').run()
      const db = getDb()

      const nonExistentUserId = crypto.randomUUID()
      await expect(
        db.insert(schema.userCredentials).values({
          id: 'credential-for-nobody',
          userId: nonExistentUserId,
          publicKey: 'mock-key',
          counter: 0,
        }),
      ).rejects.toThrow()
    })
  })

  // =========================================================================
  // VECTOR 3: Session Validity & Token Verification
  // =========================================================================
  describe('Vector 3: Session Validity & Token Verification', () => {
    it('3.1: setup wizard issues a session cookie whose token strictly matches the database session record', async () => {
      const db = getDb()

      const setupRes = await fetchPostForm(
        '/setup',
        {
          site_name: 'Adversarial Test Spaceport',
          default_regulatory_region: 'SA',
          display_name: 'Range Controller',
          email: 'controller@spaceport.sa.gov.au',
          password: 'ControlPass2026!',
          confirm_password: 'ControlPass2026!',
        },
        {},
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(setupRes.status)

      // 1. Extract Set-Cookie header
      const setCookieHeader = setupRes.headers.get('set-cookie')
      expect(setCookieHeader).not.toBeNull()
      expect(setCookieHeader).toContain('triplet_session=')

      // 2. Parse cookie
      const cookies = parseCookies(setCookieHeader)
      const sessionToken = cookies.triplet_session
      expect(sessionToken).toBeDefined()
      expect(typeof sessionToken).toBe('string')
      expect(sessionToken.length).toBeGreaterThan(20)

      // 3. Query the database sessions table for this token
      const [sessionRecord] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.token, sessionToken))

      expect(sessionRecord).toBeDefined()
      expect(sessionRecord.token).toBe(sessionToken)

      // 4. Query the created admin user
      const [adminUser] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, 'controller@spaceport.sa.gov.au'))

      expect(adminUser).toBeDefined()
      expect(adminUser.role).toBe('admin')
      expect(adminUser.regulatoryRegion).toBe('SA')

      // 5. Verify the session record binds to the admin user
      expect(sessionRecord.userId).toBe(adminUser.id)

      // 6. Verify expiration is in the future (~30 days)
      const now = Date.now()
      expect(sessionRecord.expiresAt).toBeGreaterThan(now + 25 * 24 * 60 * 60 * 1000)
      expect(sessionRecord.expiresAt).toBeLessThanOrEqual(now + 31 * 24 * 60 * 60 * 1000)

      // 7. Verify the cryptographic signature on the token
      const verifiedUserId = await verifySession(sessionToken)
      expect(verifiedUserId).toBe(adminUser.id)
    })

    it('3.2: rejects tampered user ID in session token', async () => {
      const validToken = await signSession('original-user-id-1234')
      const [userId, timestamp, sig] = validToken.split(':')

      // Adversary replaces user ID with 'admin' or another user ID
      const tamperedToken = `tampered-admin-id:${timestamp}:${sig}`
      const verified = await verifySession(tamperedToken)
      expect(verified).toBeNull()
    })

    it('3.3: rejects tampered timestamp in session token', async () => {
      const validToken = await signSession('user-1234')
      const [userId, timestamp, sig] = validToken.split(':')

      // Adversary modifies timestamp
      const tamperedTimestamp = String(parseInt(timestamp, 10) + 100000)
      const tamperedToken = `${userId}:${tamperedTimestamp}:${sig}`
      const verified = await verifySession(tamperedToken)
      expect(verified).toBeNull()
    })

    it('3.4: rejects tampered HMAC signature in session token', async () => {
      const validToken = await signSession('user-1234')
      const [userId, timestamp, sig] = validToken.split(':')

      // Adversary flips a hex char in signature
      const corruptedSig = sig.slice(0, -1) + (sig.slice(-1) === 'a' ? 'b' : 'a')
      const tamperedToken = `${userId}:${timestamp}:${corruptedSig}`
      const verified = await verifySession(tamperedToken)
      expect(verified).toBeNull()
    })

    it('3.5: rejects expired session token (> 30 days old)', async () => {
      const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000
      const userId = 'expired-user-id'
      const payload = `${userId}:${thirtyOneDaysAgo}`

      const enc = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        enc.encode('triplet-rocketry-auth-secret-key-2026'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const signature = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
      const sigHex = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const expiredToken = `${payload}:${sigHex}`

      // Expired token should be rejected
      const verified = await verifySession(expiredToken)
      expect(verified).toBeNull()
    })

    it('3.6: password is securely hashed with PBKDF2 and verifiable', async () => {
      const db = getDb()
      const rawPassword = 'SuperComplexPassword2026!'

      await fetchPostForm(
        '/setup',
        {
          site_name: 'Security Test Site',
          default_regulatory_region: 'SA',
          display_name: 'Security Auditor',
          email: 'auditor@rocketry.sa.gov.au',
          password: rawPassword,
          confirm_password: rawPassword,
        },
        {},
        { redirect: 'manual' },
      )

      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, 'auditor@rocketry.sa.gov.au'))

      expect(user).toBeDefined()
      // Plain text password must NEVER appear in the hash column
      expect(user.passwordHash).not.toBe(rawPassword)
      // Must use the PBKDF2 scheme with 100,000 iterations
      expect(user.passwordHash).toMatch(/^pbkdf2\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/)

      // Verify with verifyPassword
      const isValid = await verifyPassword(rawPassword, user.passwordHash)
      expect(isValid).toBe(true)

      const isWrong = await verifyPassword('WrongPassword', user.passwordHash)
      expect(isWrong).toBe(false)
    })
  })

  // =========================================================================
  // VECTOR 4: Setup Wizard Adversarial State Protection
  // =========================================================================
  describe('Vector 4: Setup Wizard Adversarial State Protection', () => {
    it('4.1: rejects secondary setup submission once site_settings.setup_completed is true', async () => {
      const db = getDb()

      // Initial setup
      const res1 = await fetchPostForm(
        '/setup',
        {
          site_name: 'First Provisioning',
          default_regulatory_region: 'SA',
          display_name: 'First Admin',
          email: 'admin1@rocketry.sa.gov.au',
          password: 'Password1!',
          confirm_password: 'Password1!',
        },
        {},
        { redirect: 'manual' },
      )
      expect([302, 303]).toContain(res1.status)

      // Malicious re-provisioning attempt to overwrite admin via form
      const res2 = await fetchPostForm(
        '/setup',
        {
          site_name: 'Hacked Provisioning',
          default_regulatory_region: 'US',
          display_name: 'Attacker Admin',
          email: 'attacker@evil.com',
          password: 'EvilPassword1!',
          confirm_password: 'EvilPassword1!',
        },
        {},
        { redirect: 'manual' },
      )
      // Form submission should redirect away without creating user
      expect([302, 303]).toContain(res2.status)
      expect(res2.headers.get('location')).toBe('/')

      // Malicious re-provisioning attempt via JSON API
      const resJson = await fetchPostForm(
        '/setup',
        {
          site_name: 'Hacked Provisioning',
          email: 'attacker@evil.com',
        },
        { Accept: 'application/json', 'Content-Type': 'application/json' },
      )
      expect(resJson.status).toBe(400)

      // Verify attacker user was NOT created
      const attacker = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, 'attacker@evil.com'))
      expect(attacker.length).toBe(0)

      // Verify site settings were NOT overwritten
      const [siteName] = await db
        .select()
        .from(schema.siteSettings)
        .where(eq(schema.siteSettings.key, 'site_name'))
      expect(siteName.value).toBe('First Provisioning')
    })

    it('4.2: handles XSS/HTML special characters safely in site name and display name', async () => {
      const db = getDb()
      const xssPayload = '<script>alert("xss")</script> & "quotes"'

      const res = await fetchPostForm(
        '/setup',
        {
          site_name: xssPayload,
          default_regulatory_region: 'SA',
          display_name: xssPayload,
          email: 'xss-tester@rocketry.sa.gov.au',
          password: 'XssPassword123!',
          confirm_password: 'XssPassword123!',
        },
        {},
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(res.status)

      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, 'xss-tester@rocketry.sa.gov.au'))
      expect(user.displayName).toBe(xssPayload)

      const [setting] = await db
        .select()
        .from(schema.siteSettings)
        .where(eq(schema.siteSettings.key, 'site_name'))
      expect(setting.value).toBe(xssPayload)
    })
  })
})
