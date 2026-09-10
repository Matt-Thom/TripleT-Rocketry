/**
 * Security regression test suite: Response Headers & Cookie Attributes (Gate G4 / Gate G5).
 * Covers SEC-HDR-01 through SEC-HDR-06, and SEC-SESS-01.
 * Tests BL-06 and BL-08.
 */

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { truncateDb, seedTestUser } from '../helpers/db'
import { fetchGet, fetchPostForm } from '../helpers/http'
import { hashPassword, signSession } from '../../src/services/auth'

beforeEach(truncateDb)

describe('Security Regression Suite: Response Headers & Cookies (Gate G4)', () => {
  it('SEC-HDR-01: X-Content-Type-Options: nosniff on every response [BL-08]', async () => {
    const res = await fetchGet('/health')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')

    const resLogin = await fetchGet('/login')
    expect(resLogin.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('SEC-HDR-02: X-Frame-Options: DENY on responses to prevent framing [BL-08]', async () => {
    const res = await fetchGet('/login')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })

  it('SEC-HDR-03: Strict-Transport-Security is present on responses [BL-08]', async () => {
    const res = await fetchGet('/')
    expect(res.headers.get('strict-transport-security')).toContain('max-age=')
  })

  it('SEC-HDR-04: Referrer-Policy: strict-origin-when-cross-origin is present [BL-08]', async () => {
    const res = await fetchGet('/login')
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
  })

  it('SEC-HDR-05: Permissions-Policy denies sensitive device features [BL-08]', async () => {
    const res = await fetchGet('/login')
    const policy = res.headers.get('permissions-policy') || ''
    expect(policy).toContain('camera=()')
    expect(policy).toContain('microphone=()')
    expect(policy).toContain('geolocation=()')
  })

  it('SEC-SESS-01: Session cookie carries HttpOnly, Secure, and SameSite attributes [BL-06]', async () => {
    const pwdHash = await hashPassword('my-secure-password-123')
    await seedTestUser({
      email: 'headers-pilot@example.com',
      passwordHash: pwdHash,
    })

    const res = await fetchPostForm(
      '/login',
      {
        email: 'headers-pilot@example.com',
        password: 'my-secure-password-123',
      },
      {},
      { redirect: 'manual' },
    )

    expect(res.status).toBe(302)
    const setCookie = res.headers.get('set-cookie') || ''
    expect(setCookie).toContain('triplet_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Lax')
  })

  it('SEC-HDR-06: Cache-Control: no-store on authenticated views', async () => {
    const user = await seedTestUser({ displayName: 'Auth Pilot' })
    const token = await signSession(user.id, (env as any).AUTH_SECRET)

    // Authenticated request to /rockets
    const res = await fetchGet('/rockets', {
      cookie: `triplet_session=${token}`,
    })

    const cacheControl = res.headers.get('cache-control') || ''
    expect(cacheControl).toContain('no-store')
  })
})
