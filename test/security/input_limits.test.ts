/**
 * Security regression test suite: Input Limits & Malformed Input (Gate G4).
 * Covers SEC-INP-01 through SEC-INP-05.
 * Tests BL-15.
 */

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { truncateDb, seedTestUser } from '../helpers/db'
import { fetchGet, fetchPostForm } from '../helpers/http'
import { signSession } from '../../src/services/auth'
import app from '../../src/index'

beforeEach(async () => {
  await truncateDb()
  await env.DB.prepare("INSERT INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?, ?)").bind(Date.now(), Date.now()).run()
})

describe('Security Regression Suite: Input Limits (Gate G4)', () => {
  it('SEC-INP-05: /motors/import requires authentication in production [BL-15]', async () => {
    // Simulate production environment
    const prodEnv = {
      ...env,
      TEST_MIGRATIONS: undefined,
      ENVIRONMENT: 'production',
      AUTH_SECRET: 'production-secret-min-32-bytes-long-here',
    }

    const req = new Request('https://rocketry.thom.au/motors/import', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'accept': 'text/html',
      },
      body: 'csv_data=test',
    })

    const res = await app.fetch(req, prodEnv as any)
    expect([302, 401]).toContain(res.status)
    if (res.status === 302) {
      expect(res.headers.get('location')).toMatch(/\/login/)
    }
  })

  it('SEC-INP-01: CSV upload exceeding size limit (2MB) is rejected with 413 [BL-15]', async () => {
    const user = await seedTestUser({ displayName: 'Import Pilot' })
    const token = await signSession(user.id, (env as any).AUTH_SECRET)

    // Generate payload larger than 2MB
    const oversizedCsv = 'A'.repeat(2.5 * 1024 * 1024)

    const res = await fetchPostForm(
      '/motors/import',
      { csv_data: oversizedCsv },
      { cookie: `triplet_session=${token}` },
      { redirect: 'manual' },
    )

    expect(res.status).toBe(413)
  })

  it('SEC-INP-02: CSV exceeding maximum row limit returns validation error [BL-15]', async () => {
    const user = await seedTestUser({ displayName: 'Import Pilot' })
    const token = await signSession(user.id, (env as any).AUTH_SECRET)

    const header = 'Part_Number,Designation_Product_Name,Manufacturer,Diameter_mm,Hardware,Total_Impulse_Ns,Avg_Thrust_N,Peak_Thrust_N,Propellant_Type,Grains,Propellant_Weight_g,Grain_Weight_g,Total_Weight_g,UN_Number,Classification,Length,Thrust_Duration_Sec,Delay_Sec,USPS_Mailable,Notes\n'
    const singleRow = 'P1,M1,AeroTech,29,RMS,240,128,175,White Lightning,3,98.5,32.8,195,UN0432,1.4C,180,1.88,14,true,Note\n'
    const payload = header + singleRow.repeat(5005)

    const res = await fetchPostForm(
      '/motors/import',
      { csv_data: payload },
      { cookie: `triplet_session=${token}` },
      { redirect: 'manual' },
    )

    expect([400, 200]).toContain(res.status)
    const text = await res.text()
    expect(text).toMatch(/exceeds maximum allowed limit/i)
  })
})
