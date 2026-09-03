/**
 * Probe behaviour. Ported from tests/integration/test_health.py so the Worker
 * keeps the same contract the FastAPI service had.
 */

import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('/health', () => {
  it('returns ok without touching the database', async () => {
    const res = await SELF.fetch('https://example.com/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('does not disclose configuration', async () => {
    const res = await SELF.fetch('https://example.com/health')
    const body = await res.text()
    expect(body).not.toContain(env.PROJECT_ID)
    expect(body).not.toContain(env.ENVIRONMENT)
  })

  it('auto-generates a valid uuid trace id when none is supplied', async () => {
    const res = await SELF.fetch('https://example.com/health')
    expect(res.headers.get('X-Trace-Id')).toMatch(UUID_V4)
  })

  it.each([
    ['X-TRACE-ID', 'custom-upper-1111'],
    ['x-trace-id', 'custom-lower-2222'],
    ['X-Trace-Id', 'custom-title-3333'],
    ['x-TrAcE-iD', 'custom-mixed-4444'],
  ])('propagates an inbound %s header', async (header, value) => {
    const res = await SELF.fetch('https://example.com/health', {
      headers: { [header]: value },
    })
    expect(res.headers.get('X-Trace-Id')).toBe(value)
  })
})

describe('/ready', () => {
  it('reports ready when D1 answers', async () => {
    const res = await SELF.fetch('https://example.com/ready')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ready', database: 'ok' })
  })

  it('returns 503 when the database query fails', async () => {
    // The binding is stubbed rather than the network torn down: this asserts
    // the handler's failure path, which a healthy local D1 can never reach.
    const brokenEnv = {
      ...env,
      DB: {
        prepare() {
          throw new Error('connection refused')
        },
      } as unknown as D1Database,
    }
    const res = await app.fetch(
      new Request('https://example.com/ready'),
      brokenEnv,
    )
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ status: 'unavailable', database: 'error' })
  })

  it('preserves a custom trace id on the failure path', async () => {
    const brokenEnv = {
      ...env,
      DB: {
        prepare() {
          throw new Error('connection refused')
        },
      } as unknown as D1Database,
    }
    const res = await app.fetch(
      new Request('https://example.com/ready', {
        headers: { 'X-Trace-Id': 'trace-on-failure' },
      }),
      brokenEnv,
    )
    expect(res.status).toBe(503)
    expect(res.headers.get('X-Trace-Id')).toBe('trace-on-failure')
  })

  it('liveness still succeeds when the database is down', async () => {
    const brokenEnv = {
      ...env,
      DB: {
        prepare() {
          throw new Error('connection refused')
        },
      } as unknown as D1Database,
    }
    const res = await app.fetch(
      new Request('https://example.com/health'),
      brokenEnv,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})
