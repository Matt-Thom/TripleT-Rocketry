/**
 * Security regression test suite: Cross-Site Request Forgery (CSRF) Protection (BL-07).
 * Verifies that unsafe HTTP methods (POST, PUT, DELETE, PATCH) are protected against CSRF via Origin/Referer header checks.
 */

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { truncateDb, seedTestUser } from '../helpers/db'
import { fetchPostJson, fetchPostForm } from '../helpers/http'
import { signSession } from '../../src/services/auth'

beforeEach(async () => {
  await truncateDb()
  await env.DB.prepare(
    "INSERT INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?, ?)",
  )
    .bind(Date.now(), Date.now())
    .run()
})

describe('Security Regression Suite: CSRF Protection (BL-07)', () => {
  it('allows same-origin POST requests with matching Origin header', async () => {
    const user = await seedTestUser({ displayName: 'CSRF Pilot' })
    const token = await signSession(user.id, (env as any).AUTH_SECRET)

    const res = await fetchPostJson(
      '/rockets',
      { name: 'Same Origin Rocket' },
      {
        Cookie: `triplet_session=${token}`,
        Origin: 'https://example.com',
      },
    )

    expect(res.status).not.toBe(403)
  })

  it('allows same-origin POST requests with matching Referer header when Origin is absent', async () => {
    const user = await seedTestUser({ displayName: 'CSRF Pilot' })
    const token = await signSession(user.id, (env as any).AUTH_SECRET)

    const res = await fetchPostJson(
      '/rockets',
      { name: 'Referer Rocket' },
      {
        Cookie: `triplet_session=${token}`,
        Referer: 'https://example.com/rockets/new',
      },
    )

    expect(res.status).not.toBe(403)
  })

  it('rejects cross-site POST requests with mismatched Origin header with HTTP 403 Forbidden', async () => {
    const user = await seedTestUser({ displayName: 'CSRF Target' })
    const token = await signSession(user.id, (env as any).AUTH_SECRET)

    const res = await fetchPostJson(
      '/rockets',
      { name: 'Malicious Cross Site Rocket' },
      {
        Cookie: `triplet_session=${token}`,
        Origin: 'https://attacker.com',
      },
    )

    expect(res.status).toBe(403)
    const body = (await res.json()) as any
    expect(body.error).toBe('Forbidden')
    expect(body.message).toBe('Cross-site request rejected')
  })

  it('rejects cross-site POST form requests accepting HTML with HTTP 403 Forbidden', async () => {
    const user = await seedTestUser({ displayName: 'CSRF Target' })
    const token = await signSession(user.id, (env as any).AUTH_SECRET)

    const res = await fetchPostForm(
      '/flights',
      { rocketId: '123' },
      {
        Accept: 'text/html',
        Cookie: `triplet_session=${token}`,
        Origin: 'https://evil.com',
      },
    )

    expect(res.status).toBe(403)
    const text = await res.text()
    expect(text).toContain('403 Forbidden: Cross-site request rejected')
  })

  it('rejects cross-site POST requests with mismatched Referer header when Origin is absent', async () => {
    const user = await seedTestUser({ displayName: 'CSRF Target' })
    const token = await signSession(user.id, (env as any).AUTH_SECRET)

    const res = await fetchPostJson(
      '/rockets',
      { name: 'Referer Cross Site Rocket' },
      {
        Cookie: `triplet_session=${token}`,
        Referer: 'https://evil.com/phishing-page',
      },
    )

    expect(res.status).toBe(403)
  })

  it('allows POST requests when neither Origin nor Referer header is present (non-browser client / direct API)', async () => {
    const user = await seedTestUser({ displayName: 'API Client' })
    const token = await signSession(user.id, (env as any).AUTH_SECRET)

    const res = await fetchPostJson(
      '/rockets',
      { name: 'API Client Rocket' },
      {
        Cookie: `triplet_session=${token}`,
      },
    )

    expect(res.status).not.toBe(403)
  })
})
