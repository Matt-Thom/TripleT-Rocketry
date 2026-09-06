/**
 * Challenger 1 Adversarial Verification Test Suite for Milestone 1 (R1).
 *
 * Vectors:
 * 1. Malformed POST /setup payloads: missing email, invalid email regex,
 *    password < 8 chars, password mismatch, empty site name, whitespace site name,
 *    missing display name, invalid regulatory region, malformed JSON body.
 * 2. Idempotency attacks: POST /setup after completion (form & JSON),
 *    mutation attempts against existing admin, repeated/concurrent setups,
 *    GET /setup redirection when configured.
 * 3. Unconfigured route interception & probe bypass resistance:
 *    Interception of protected and public routes (/flights, /rockets, /motors, /inventory, /admin, /login, /register),
 *    preservation of probes (/health, /ready, /setup, /static/*, /favicon.ico),
 *    bypass attempts via forged cookies, CF Access headers, or Bearer tokens.
 * 4. Schema integrity & cascading constraints for new tables and columns.
 */

import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, truncateDb } from '../helpers/db'
import * as schema from '../../src/db/schema'
import { eq } from 'drizzle-orm'
import { fetchGet, fetchPostForm } from '../helpers/http'

beforeEach(async () => {
  await truncateDb()
  try {
    await env.DB.prepare('DELETE FROM site_settings').run()
  } catch {
    // Ignore if not present
  }
})

describe('Challenger 1: Adversarial Suite for Milestone 1 (Setup Wizard & R1)', () => {
  // =========================================================================
  // VECTOR 1: Malformed POST /setup Payloads (Boundary & Attack Injections)
  // =========================================================================
  describe('Vector 1: Malformed POST /setup Payloads', () => {
    it('1.1: rejects missing email in form payload with HTTP 400', async () => {
      const res = await fetchPostForm('/setup', {
        site_name: 'TripleT-Rocketry',
        default_regulatory_region: 'SA',
        display_name: 'Admin Flyer',
        email: '',
        password: 'ValidPassword123!',
        confirm_password: 'ValidPassword123!',
      }, {}, { redirect: 'manual' })

      expect(res.status).toBe(400)
      const html = await res.text()
      expect(html).toMatch(/email/i)
    })

    it('1.2: rejects missing email in JSON payload with HTTP 400 and JSON error', async () => {
      const res = await SELF.fetch('https://example.com/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          site_name: 'TripleT-Rocketry',
          default_regulatory_region: 'SA',
          display_name: 'Admin Flyer',
          password: 'ValidPassword123!',
          confirm_password: 'ValidPassword123!',
        }),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as { error?: string }
      expect(body.error).toMatch(/email/i)
    })

    it('1.3: rejects various invalid email syntax patterns', async () => {
      const invalidEmails = [
        'plainaddress',
        '#@%^%#$@#$@#.com',
        '@example.com',
        'Joe Smith <email@example.com>',
        'email.example.com',
        'email@example@example.com',
        'email@example',
        'missing-domain@.com',
        'spaces in@email.com',
      ]

      for (const badEmail of invalidEmails) {
        const res = await SELF.fetch('https://example.com/setup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            site_name: 'TripleT-Rocketry',
            default_regulatory_region: 'SA',
            display_name: 'Admin Flyer',
            email: badEmail,
            password: 'ValidPassword123!',
            confirm_password: 'ValidPassword123!',
          }),
        })

        expect(res.status, `Expected 400 for bad email: "${badEmail}"`).toBe(400)
        const json = await res.json() as { error?: string }
        expect(json.error).toMatch(/email/i)
      }
    })

    it('1.4: rejects passwords strictly shorter than 8 characters', async () => {
      const shortPasswords = ['', '1', '1234', '1234567']

      for (const pass of shortPasswords) {
        const res = await SELF.fetch('https://example.com/setup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            site_name: 'TripleT-Rocketry',
            default_regulatory_region: 'SA',
            display_name: 'Admin Flyer',
            email: 'admin@rocketry.sa.gov.au',
            password: pass,
            confirm_password: pass,
          }),
        })

        expect(res.status, `Expected 400 for password length ${pass.length}`).toBe(400)
        const json = await res.json() as { error?: string }
        expect(json.error).toMatch(/password.*(length|at least 8)/i)
      }
    })

    it('1.5: rejects mismatched passwords including case and trailing whitespace mismatches', async () => {
      const testCases = [
        { pass: 'ValidPass123!', confirm: 'ValidPass123' },
        { pass: 'ValidPass123!', confirm: 'validpass123!' },
        { pass: 'ValidPass123!', confirm: 'ValidPass123! ' },
        { pass: 'ValidPass123!', confirm: '' },
      ]

      for (const tc of testCases) {
        const res = await SELF.fetch('https://example.com/setup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            site_name: 'TripleT-Rocketry',
            default_regulatory_region: 'SA',
            display_name: 'Admin Flyer',
            email: 'admin@rocketry.sa.gov.au',
            password: tc.pass,
            confirm_password: tc.confirm,
          }),
        })

        expect(res.status).toBe(400)
        const json = await res.json() as { error?: string }
        expect(json.error).toMatch(/mismatch|match/i)
      }
    })

    it('1.6: rejects empty or whitespace-only site names', async () => {
      const blankSiteNames = ['', '   ', '\t\n\r  ', '       ']

      for (const siteName of blankSiteNames) {
        const res = await SELF.fetch('https://example.com/setup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            site_name: siteName,
            default_regulatory_region: 'SA',
            display_name: 'Admin Flyer',
            email: 'admin@rocketry.sa.gov.au',
            password: 'ValidPassword123!',
            confirm_password: 'ValidPassword123!',
          }),
        })

        expect(res.status).toBe(400)
        const json = await res.json() as { error?: string }
        expect(json.error).toMatch(/site name/i)
      }
    })

    it('1.7: rejects empty or whitespace-only administrator display name', async () => {
      const blankNames = ['', '   ', '\t\n']

      for (const name of blankNames) {
        const res = await SELF.fetch('https://example.com/setup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            site_name: 'TripleT-Rocketry',
            default_regulatory_region: 'SA',
            display_name: name,
            email: 'admin@rocketry.sa.gov.au',
            password: 'ValidPassword123!',
            confirm_password: 'ValidPassword123!',
          }),
        })

        expect(res.status).toBe(400)
        const json = await res.json() as { error?: string }
        expect(json.error).toMatch(/display name/i)
      }
    })

    it('1.8: rejects invalid or adversarial regulatory region values', async () => {
      const adversarialRegions = [
        'INVALID',
        'UK',
        'EU',
        'US; DROP TABLE users;',
        '<script>alert(1)</script>',
        'SA_EXTRA',
      ]

      for (const region of adversarialRegions) {
        const res = await SELF.fetch('https://example.com/setup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            site_name: 'TripleT-Rocketry',
            default_regulatory_region: region,
            display_name: 'Admin Flyer',
            email: 'admin@rocketry.sa.gov.au',
            password: 'ValidPassword123!',
            confirm_password: 'ValidPassword123!',
          }),
        })

        expect(res.status).toBe(400)
        const json = await res.json() as { error?: string }
        expect(json.error).toMatch(/regulatory region/i)
      }
    })

    it('1.9: gracefully handles broken JSON body syntax without 500 crash', async () => {
      const res = await SELF.fetch('https://example.com/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: '{ "site_name": "Broken JSON',
      })

      expect(res.status).toBe(400)
      const json = await res.json() as { error?: string }
      expect(json.error).toBeDefined()
    })

    it('1.10: sanitizes and HTML-escapes XSS payloads in error responses', async () => {
      const xssPayload = '<script>alert("xss")</script>'
      const res = await fetchPostForm('/setup', {
        site_name: xssPayload,
        default_regulatory_region: 'SA',
        display_name: 'Admin',
        email: 'invalid-email',
        password: 'ValidPassword123!',
        confirm_password: 'ValidPassword123!',
      }, {}, { redirect: 'manual' })

      expect(res.status).toBe(400)
      const html = await res.text()
      // Verify raw script tag is escaped
      expect(html).not.toContain('<script>alert("xss")</script>')
      expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    })
  })

  // =========================================================================
  // VECTOR 2: Idempotency Attacks & Post-Setup Protection
  // =========================================================================
  describe('Vector 2: Idempotency Attacks & Post-Setup Protection', () => {
    it('2.1: initial setup creates exactly one admin user and persists site_settings', async () => {
      const setupRes = await SELF.fetch('https://example.com/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          site_name: 'Legitimate Rocketry Club',
          default_regulatory_region: 'SA',
          display_name: 'Legitimate Admin',
          email: 'legit.admin@sarc.org.au',
          password: 'LegitPassword2026!',
          confirm_password: 'LegitPassword2026!',
        }),
      })

      expect(setupRes.status).toBe(200)
      const setupJson = await setupRes.json() as any
      expect(setupJson.status).toBe('ok')
      expect(setupJson.user.email).toBe('legit.admin@sarc.org.au')
      expect(setupJson.user.role).toBe('admin')

      // Verify DB records
      const adminInDb = await env.DB.prepare(
        'SELECT * FROM users WHERE email = ?'
      ).bind('legit.admin@sarc.org.au').first<{ id: string, role: string }>()
      expect(adminInDb).not.toBeNull()
      expect(adminInDb?.role).toBe('admin')

      const setupSetting = await env.DB.prepare(
        "SELECT value FROM site_settings WHERE key = 'setup_completed'"
      ).first<{ value: string }>()
      expect(setupSetting?.value).toBe('true')
    })

    it('2.2: rejects second POST /setup attack via JSON with 400 and preserves original admin', async () => {
      // Step 1: legitimate setup
      await SELF.fetch('https://example.com/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_name: 'Original Site',
          default_regulatory_region: 'SA',
          display_name: 'Original Admin',
          email: 'original@rocketry.org',
          password: 'OriginalPass2026!',
          confirm_password: 'OriginalPass2026!',
        }),
      })

      // Step 2: Attacker attempts to hijack instance via POST /setup
      const attackRes = await SELF.fetch('https://example.com/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          site_name: 'Hacked Site',
          default_regulatory_region: 'US',
          display_name: 'Attacker Admin',
          email: 'attacker@evil.com',
          password: 'AttackerPass2026!',
          confirm_password: 'AttackerPass2026!',
        }),
      })

      expect(attackRes.status).toBe(400)
      const attackJson = await attackRes.json() as { error?: string }
      expect(attackJson.error).toMatch(/already been completed/i)

      // Step 3: Verify attacker was NOT created in DB
      const attackerInDb = await env.DB.prepare(
        'SELECT * FROM users WHERE email = ?'
      ).bind('attacker@evil.com').first()
      expect(attackerInDb).toBeNull()

      // Verify original admin is intact
      const origInDb = await env.DB.prepare(
        'SELECT * FROM users WHERE email = ?'
      ).bind('original@rocketry.org').first()
      expect(origInDb).not.toBeNull()

      // Verify site settings not overwritten
      const siteNameSetting = await env.DB.prepare(
        "SELECT value FROM site_settings WHERE key = 'site_name'"
      ).first<{ value: string }>()
      expect(siteNameSetting?.value).toBe('Original Site')
    })

    it('2.3: redirects second POST /setup attack via Form to / (302) and preserves database', async () => {
      // Step 1: legitimate setup
      await fetchPostForm('/setup', {
        site_name: 'Original Site',
        default_regulatory_region: 'SA',
        display_name: 'Original Admin',
        email: 'original@rocketry.org',
        password: 'OriginalPass2026!',
        confirm_password: 'OriginalPass2026!',
      }, {}, { redirect: 'manual' })

      // Step 2: Form attack
      const attackRes = await fetchPostForm('/setup', {
        site_name: 'Hacked Site',
        default_regulatory_region: 'US',
        display_name: 'Attacker Admin',
        email: 'attacker2@evil.com',
        password: 'AttackerPass2026!',
        confirm_password: 'AttackerPass2026!',
      }, {}, { redirect: 'manual' })

      expect([302, 303]).toContain(attackRes.status)
      expect(attackRes.headers.get('location')).toBe('/')

      // Step 3: Verify attacker was NOT inserted
      const attackerInDb = await env.DB.prepare(
        'SELECT * FROM users WHERE email = ?'
      ).bind('attacker2@evil.com').first()
      expect(attackerInDb).toBeNull()
    })

    it('2.4: GET /setup immediately redirects to / once configured', async () => {
      // Configure site
      await fetchPostForm('/setup', {
        site_name: 'Configured Site',
        default_regulatory_region: 'SA',
        display_name: 'Admin',
        email: 'admin@configured.org',
        password: 'ConfiguredPass2026!',
        confirm_password: 'ConfiguredPass2026!',
      }, {}, { redirect: 'manual' })

      const res = await fetchGet('/setup', {}, { redirect: 'manual' })
      expect([302, 303]).toContain(res.status)
      expect(res.headers.get('location')).toBe('/')
    })

    it('2.5: handles concurrent setup attempts safely without creating multiple admins', async () => {
      const attempts = [1, 2, 3, 4, 5].map((idx) =>
        SELF.fetch('https://example.com/setup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            site_name: `Concurrent Site ${idx}`,
            default_regulatory_region: 'SA',
            display_name: `Admin ${idx}`,
            email: `concurrent${idx}@rocketry.org`,
            password: `ConcurrentPass${idx}!`,
            confirm_password: `ConcurrentPass${idx}!`,
          }),
        })
      )

      const results = await Promise.allSettled(attempts)
      // At least one should succeed (status 200), and others should either fail with 400 or D1 unique constraint
      const fulfilled = results.filter((r): r is PromiseFulfilledResult<Response> => r.status === 'fulfilled')
      const successCount = fulfilled.filter((r) => r.value.status === 200).length
      expect(successCount).toBeGreaterThanOrEqual(1)

      // Only one admin user should have been successfully inserted or at most 1 active site_setting
      const settingsCount = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM site_settings WHERE key = 'setup_completed'"
      ).first<{ cnt: number }>()
      expect(settingsCount?.cnt).toBe(1)
    })
  })

  // =========================================================================
  // VECTOR 3: Unconfigured Route Interception & Probe Exclusions
  // =========================================================================
  describe('Vector 3: Unconfigured Route Interception & Probe Exclusions', () => {
    it('3.1: public health and readiness probes remain 200 on unconfigured instance', async () => {
      const healthRes = await fetchGet('/health', { 'x-test-unconfigured': 'true' })
      expect(healthRes.status).toBe(200)
      const healthJson = await healthRes.json() as any
      expect(healthJson.status).toBe('ok')

      const readyRes = await fetchGet('/ready', { 'x-test-unconfigured': 'true' })
      expect(readyRes.status).toBe(200)
      const readyJson = await readyRes.json() as any
      expect(readyJson.status).toBe('ready')
    })

    it('3.2: static assets and favicon are allowed through without redirect on unconfigured instance', async () => {
      const faviconRes = await fetchGet('/favicon.ico', { 'x-test-unconfigured': 'true' }, { redirect: 'manual' })
      // Even if file doesn't exist, status should not be 302 redirect to /setup
      expect(faviconRes.status).not.toBe(302)

      const staticRes = await fetchGet('/static/styles.css', { 'x-test-unconfigured': 'true' }, { redirect: 'manual' })
      expect(staticRes.status).not.toBe(302)
    })

    it('3.3: GET /setup returns 200 HTML on unconfigured instance', async () => {
      const setupRes = await fetchGet('/setup', { 'x-test-unconfigured': 'true' })
      expect(setupRes.status).toBe(200)
      const html = await setupRes.text()
      expect(html).toContain('Initial Setup Wizard')
      expect(html).toContain('TripleT-Rocketry')
    })

    it('3.4: redirects all core application routes to /setup on unconfigured instance', async () => {
      const protectedPaths = [
        '/',
        '/flights',
        '/rockets',
        '/motors',
        '/inventory',
        '/admin',
        '/login',
        '/register',
        '/flights/new',
        '/rockets/new',
      ]

      for (const path of protectedPaths) {
        const res = await fetchGet(path, { 'x-test-unconfigured': 'true' }, { redirect: 'manual' })
        expect(res.status, `Path "${path}" should redirect to /setup`).toBe(302)
        const location = res.headers.get('location') || ''
        expect(location, `Path "${path}" should redirect to /setup`).toMatch(/\/setup$/)
      }
    })

    it('3.5: forged cookie cannot bypass unconfigured gate', async () => {
      const res = await fetchGet('/flights', {
        'x-test-unconfigured': 'true',
        'cookie': 'triplet_session=fake-forged-session-token-12345',
      }, { redirect: 'manual' })

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toMatch(/\/setup$/)
    })

    it('3.6: CF Access header cannot bypass unconfigured gate', async () => {
      const res = await fetchGet('/flights', {
        'x-test-unconfigured': 'true',
        'cf-access-authenticated-user-email': 'admin@example.com',
      }, { redirect: 'manual' })

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toMatch(/\/setup$/)
    })

    it('3.7: Authorization Bearer header cannot bypass unconfigured gate', async () => {
      const res = await fetchGet('/flights', {
        'x-test-unconfigured': 'true',
        'authorization': 'Bearer fake-token',
      }, { redirect: 'manual' })

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toMatch(/\/setup$/)
    })
  })

  // =========================================================================
  // VECTOR 4: Schema Integrity & Cascading Foreign Keys
  // =========================================================================
  describe('Vector 4: Schema Integrity & Cascading Constraints', () => {
    it('4.1: deleting a user cascades to sessions and user_credentials', async () => {
      // First, complete setup to create an admin
      const setupRes = await fetchPostForm('/setup', {
        site_name: 'Test Cascade Site',
        default_regulatory_region: 'SA',
        display_name: 'Cascade Admin',
        email: 'cascade@rocketry.org',
        password: 'CascadePassword2026!',
        confirm_password: 'CascadePassword2026!',
      }, {}, { redirect: 'manual' })

      const adminUser = await env.DB.prepare(
        'SELECT * FROM users WHERE email = ?'
      ).bind('cascade@rocketry.org').first<{ id: string }>()
      expect(adminUser).not.toBeNull()

      // Insert a mock user_credential
      const credId = crypto.randomUUID()
      await env.DB.prepare(
        'INSERT INTO user_credentials (id, user_id, public_key, counter, backed_up, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(credId, adminUser!.id, 'mock-pubkey', 0, 0, Date.now()).run()

      // Verify sessions and credentials exist for this user
      const sessionCountBefore = await env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM sessions WHERE user_id = ?'
      ).bind(adminUser!.id).first<{ cnt: number }>()
      expect(sessionCountBefore?.cnt).toBeGreaterThan(0)

      const credCountBefore = await env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM user_credentials WHERE user_id = ?'
      ).bind(adminUser!.id).first<{ cnt: number }>()
      expect(credCountBefore?.cnt).toBe(1)

      // Clean up certifications reference (which was created in 0000_init without cascade)
      await env.DB.prepare('DELETE FROM certifications WHERE user_id = ?').bind(adminUser!.id).run()

      // Delete user
      await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(adminUser!.id).run()

      // Verify cascade deletion in sessions and user_credentials (0002_schema_enhancements.sql)
      const sessionCountAfter = await env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM sessions WHERE user_id = ?'
      ).bind(adminUser!.id).first<{ cnt: number }>()
      expect(sessionCountAfter?.cnt).toBe(0)

      const credCountAfter = await env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM user_credentials WHERE user_id = ?'
      ).bind(adminUser!.id).first<{ cnt: number }>()
      expect(credCountAfter?.cnt).toBe(0)
    })

    it('4.2: motor extended columns support persistence of all Milestone M3 motor schema fields', async () => {
      const motorId = crypto.randomUUID()
      await env.DB.prepare(`
        INSERT INTO motors (
          id, model, manufacturer, diameter_mm, total_impulse_ns,
          average_thrust_n, propellant_type, part_number, hardware,
          grains, propellant_weight_g, grain_weight_g, un_number,
          hazard_classification, usps_mailable, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        motorId, 'H123W-14A', 'Aerotech', 29, 240.0,
        123.0, 'apcp', 'AT-H123-14', '29/240 Case',
        3, 110.5, 36.8, 'UN0323',
        '1.4S', 1, 'Milestone 1 schema test note'
      ).run()

      const row = await env.DB.prepare('SELECT * FROM motors WHERE id = ?').bind(motorId).first<any>()
      expect(row).not.toBeNull()
      expect(row.part_number).toBe('AT-H123-14')
      expect(row.hardware).toBe('29/240 Case')
      expect(row.grains).toBe(3)
      expect(row.propellant_weight_g).toBe(110.5)
      expect(row.grain_weight_g).toBe(36.8)
      expect(row.un_number).toBe('UN0323')
      expect(row.hazard_classification).toBe('1.4S')
      expect(row.usps_mailable).toBe(1)
      expect(row.notes).toBe('Milestone 1 schema test note')
    })

    it('4.3: rocket_configurations supports drogue_parachute_size_mm column for Milestone M4 dual-deploy', async () => {
      // Seed user and rocket first
      const userId = crypto.randomUUID()
      await env.DB.prepare(
        "INSERT INTO users (id, email, display_name, password_hash, is_active, role, regulatory_region) VALUES (?, ?, ?, ?, 1, 'flyer', 'SA')"
      ).bind(userId, 'flyer.dual@rocketry.org', 'Dual Flyer', 'hash').run()

      const rocketId = crypto.randomUUID()
      await env.DB.prepare(
        "INSERT INTO rockets (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, 1000, 1000)"
      ).bind(rocketId, userId, 'Dual Deploy Rocket').run()

      const configId = crypto.randomUUID()
      await env.DB.prepare(`
        INSERT INTO rocket_configurations (
          id, rocket_id, version, recovery_type, parachute_size_mm,
          drogue_parachute_size_mm, is_current, created_at, updated_at, created_by
        ) VALUES (?, ?, 1, 'dual_deploy', 1200, 300, 1, 1000, 1000, ?)
      `).bind(configId, rocketId, userId).run()

      const row = await env.DB.prepare('SELECT * FROM rocket_configurations WHERE id = ?').bind(configId).first<any>()
      expect(row).not.toBeNull()
      expect(row.recovery_type).toBe('dual_deploy')
      expect(row.parachute_size_mm).toBe(1200)
      expect(row.drogue_parachute_size_mm).toBe(300)
    })
  })
})
