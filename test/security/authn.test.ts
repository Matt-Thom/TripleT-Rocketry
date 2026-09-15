/**
 * Security regression test suite: Authentication (Gate G4).
 * Covers SEC-AUTHN-01 through SEC-AUTHN-07.
 * Tests BL-01, BL-02, BL-03.
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { truncateDb, seedTestUser } from '../helpers/db'
import { hashPassword, verifyPassword, resolveAuthSecret, DEFAULT_AUTH_SECRET } from '../../src/services/auth'
import app from '../../src/index'

beforeEach(async () => {
  await truncateDb()
  await env.DB.prepare("INSERT INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?, ?)").bind(Date.now(), Date.now()).run()
})

describe('Security Regression Suite: Authentication (Gate G4)', () => {
  describe('SEC-AUTHN-01 & SEC-AUTHN-02: Identity headers X-Flyer-Id / X-Flyer-Email in production [BL-01]', () => {
    it('SEC-AUTHN-01: X-Flyer-Id header does not authenticate anonymous requests in production', async () => {
      const user = await seedTestUser({ displayName: 'Target Admin', role: 'admin' } as any)

      // Simulate production environment where TEST_MIGRATIONS is absent
      const prodEnv = {
        ...env,
        TEST_MIGRATIONS: undefined,
        ENVIRONMENT: 'production',
        AUTH_SECRET: 'production-secret-min-32-bytes-long-here',
      }

      const req = new Request('https://rocketry.thom.au/rockets', {
        headers: {
          'x-flyer-id': user.id,
          'accept': 'text/html',
        },
      })

      const ctx = createExecutionContext()
      const res = await app.fetch(req, prodEnv as any, ctx)
      await waitOnExecutionContext(ctx)

      // In production, unauthenticated request must redirect to /login (302) or return 401
      expect([302, 401]).toContain(res.status)
      if (res.status === 302) {
        expect(res.headers.get('location')).toMatch(/\/login/)
      }
    })

    it('SEC-AUTHN-02: X-Flyer-Email header does not authenticate anonymous requests in production', async () => {
      const user = await seedTestUser({ email: 'target@example.com', role: 'admin' } as any)

      const prodEnv = {
        ...env,
        TEST_MIGRATIONS: undefined,
        ENVIRONMENT: 'production',
        AUTH_SECRET: 'production-secret-min-32-bytes-long-here',
      }

      const req = new Request('https://rocketry.thom.au/flights', {
        headers: {
          'x-flyer-email': user.email,
          'accept': 'text/html',
        },
      })

      const ctx = createExecutionContext()
      const res = await app.fetch(req, prodEnv as any, ctx)
      await waitOnExecutionContext(ctx)

      expect([302, 401]).toContain(res.status)
      if (res.status === 302) {
        expect(res.headers.get('location')).toMatch(/\/login/)
      }
    })
  })

  describe('SEC-AUTHN-04 & SEC-AUTHN-05: Password verification and placeholder hashes [BL-02]', () => {
    it('SEC-AUTHN-04: submitting stored hash as password is rejected', async () => {
      const realPassword = 'correct-horse-battery-staple'
      const storedHash = await hashPassword(realPassword)

      // An attacker submitting the hash itself as password must be rejected
      const result = await verifyPassword(storedHash, storedHash)
      expect(result).toBe(false)
    })

    it('SEC-AUTHN-05: placeholder hashes (seeded_flyer_default, argon2id-hash-placeholder) are rejected', async () => {
      expect(await verifyPassword('any-password', 'seeded_flyer_default')).toBe(false)
      expect(await verifyPassword('password123', 'argon2id-hash-placeholder')).toBe(false)
      expect(await verifyPassword('', 'seeded_flyer_default')).toBe(false)
      expect(await verifyPassword('seeded_flyer_default', 'seeded_flyer_default')).toBe(false)
      expect(await verifyPassword('argon2id-hash-placeholder', 'argon2id-hash-placeholder')).toBe(false)
    })

    it('SEC-AUTHN-05b: legitimate PBKDF2 hash verifies correctly and wrong password fails', async () => {
      const storedHash = await hashPassword('legitimate-secret')
      expect(await verifyPassword('legitimate-secret', storedHash)).toBe(true)
      expect(await verifyPassword('wrong-secret', storedHash)).toBe(false)
    })
  })

  describe('SEC-AUTHN-06 & SEC-AUTHN-07: Mandatory AUTH_SECRET in production [BL-03]', () => {
    it('SEC-AUTHN-06: resolveAuthSecret throws in production if secret is unset or default', () => {
      expect(() => {
        resolveAuthSecret({ ENVIRONMENT: 'production' })
      }).toThrow(/AUTH_SECRET binding is unset/)

      expect(() => {
        resolveAuthSecret({ ENVIRONMENT: 'production', AUTH_SECRET: DEFAULT_AUTH_SECRET })
      }).toThrow(/using default secret/)

      expect(() => {
        resolveAuthSecret({ ENVIRONMENT: 'staging' })
      }).toThrow(/AUTH_SECRET binding is unset/)
    })

    it('SEC-AUTHN-07: resolveAuthSecret succeeds when explicit secret is provided', () => {
      const customSecret = 'my-custom-prod-secret-key-32-chars'
      expect(resolveAuthSecret({ ENVIRONMENT: 'production', AUTH_SECRET: customSecret })).toBe(customSecret)
    })
  })
})
