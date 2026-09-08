/**
 * Empirical Adversarial Challenge Test Suite for Milestone 2:
 * Launch Event Creation Resilience & Error Handling (Requirement R3)
 *
 * Authored by: Milestone 2 Challenger 1 (m2_challenger_1)
 * Purpose: Empirical stress-testing of `POST /events` against:
 * 1. Arbitrary non-UUID officer strings (e.g. 'Capt.Kirk', SQL injection, XSS vectors, long strings).
 * 2. Valid UUIDs that do not exist in `schema.users` (nil UUID, random UUIDs, asymmetric existing/non-existing pairs).
 * 3. Extreme past dates (Unix epoch 1970-01-01, year 0001, 1800, inverted dates).
 * 4. Unassigned, empty string, and whitespace-only officer fields (RSO, LCO, Launch Director, Tripoli Prefect).
 * 5. Input validation & error boundaries (missing mandatory fields, invalid launch site ID, non-string JSON values).
 * 6. Post-creation view rendering resilience (ensuring GET /events and GET /events/:id never crash on abnormal records).
 */

import { env, SELF } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { signSession } from '../src/services/auth'
import {
  getDb,
  seedTestSite,
  seedTestUser,
  truncateDb,
} from './helpers/db'
import { fetchGet, fetchPostForm } from './helpers/http'

beforeEach(async () => {
  await truncateDb()
})

async function postJson(
  path: string,
  data: any,
  headers: Record<string, string> = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `https://example.com${path}`
  return await SELF.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...headers,
    },
    body: JSON.stringify(data),
  })
}

describe('Milestone 2 Adversarial Challenge: POST /events Resilience', () => {
  // =========================================================================
  // VECTOR 1: Arbitrary Non-UUID Officer Strings
  // =========================================================================
  describe('Vector 1: Arbitrary Non-UUID Officer Strings', () => {
    it('1.1: accepts arbitrary non-UUID officer strings via form data without 500, coercing to null', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Starfleet Invitational',
          launch_site_id: site.id,
          starts_on: '2026-10-01',
          rso_user_id: 'Capt.Kirk',
          lco_user_id: 'Cmdr.Spock',
          launch_director: 'Admiral McCoy',
          tripoli_prefect: 'Scotty',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      // Must complete cleanly without 500
      expect(res.status).not.toBe(500)
      expect([302, 303]).toContain(res.status)
      const location = res.headers.get('Location') ?? ''
      expect(location).toMatch(/\/events\/[0-9a-f-]+/i)

      // Verify D1 persistence: non-UUID officer user IDs coerced to null
      const eventId = location.split('/events/')[1]
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, eventId))

      expect(saved).toBeDefined()
      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBeNull()
      expect(saved.launchDirector).toBe('Admiral McCoy')
      expect(saved.tripoliPrefect).toBe('Scotty')
    })

    it('1.2: accepts arbitrary non-UUID strings via JSON payload, returning 201 without 500', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const res = await postJson(
        '/events',
        {
          name: 'JSON Starfleet Meet',
          launch_site_id: site.id,
          rso_user_id: 'Bones.McCoy',
          lco_user_id: 'Hikaru.Sulu',
          launch_director: 'Jean-Luc Picard',
          tripoli_prefect: 'William Riker',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect(res.status).toBe(201)
      const json = (await res.json()) as any
      expect(json.id).toBeDefined()
      expect(json.rsoUserId).toBeNull()
      expect(json.lcoUserId).toBeNull()
      expect(json.launchDirector).toBe('Jean-Luc Picard')
      expect(json.tripoliPrefect).toBe('William Riker')
    })

    it('1.3: survives SQL injection strings in officer fields without SQL syntax errors or data corruption', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const sqlInjectionRso = "'; DROP TABLE launch_events; --"
      const sqlInjectionLco = "' OR 1=1; --"

      const res = await fetchPostForm(
        '/events',
        {
          name: 'SQL Injection Stress Meet',
          launch_site_id: site.id,
          rso_user_id: sqlInjectionRso,
          lco_user_id: sqlInjectionLco,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).not.toBe(500)
      expect([302, 303]).toContain(res.status)

      // Verify launch_events table was NOT dropped and event was created
      const location = res.headers.get('Location') ?? ''
      const eventId = location.split('/events/')[1]
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, eventId))

      expect(saved).toBeDefined()
      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBeNull()
    })

    it('1.4: survives emoji, unicode, and special character officer strings without crashing', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Unicode Special Meet',
          launch_site_id: site.id,
          rso_user_id: '🚀👨‍🚀💥!@#$%^&*()_+~`|}{[]:;?><,./',
          lco_user_id: '👽🛸🛰️<script>alert("test")</script>',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).not.toBe(500)
      expect([302, 303]).toContain(res.status)
    })

    it('1.5: survives excessively long non-UUID officer string without crashing', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Long Officer String Meet',
          launch_site_id: site.id,
          rso_user_id: 'Officer_' + 'X'.repeat(4000),
          lco_user_id: 'Officer_' + 'Y'.repeat(4000),
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).not.toBe(500)
      expect([302, 303]).toContain(res.status)
    })
  })

  // =========================================================================
  // VECTOR 2: Valid UUIDs That Do Not Exist in `users` Table
  // =========================================================================
  describe('Vector 2: Valid UUIDs That Do Not Exist in users', () => {
    it('2.1: non-existent random UUIDs in rso_user_id and lco_user_id do not trigger foreign key violation', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const nonExistentRso = crypto.randomUUID()
      const nonExistentLco = crypto.randomUUID()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Phantom Officers Meet',
          launch_site_id: site.id,
          rso_user_id: nonExistentRso,
          lco_user_id: nonExistentLco,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).not.toBe(500)
      expect([302, 303]).toContain(res.status)

      const location = res.headers.get('Location') ?? ''
      const eventId = location.split('/events/')[1]
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, eventId))

      expect(saved).toBeDefined()
      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBeNull()
    })

    it('2.2: nil UUID (00000000-0000-0000-0000-000000000000) does not violate FK constraint', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const nilUuid = '00000000-0000-0000-0000-000000000000'

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Nil UUID Officers Meet',
          launch_site_id: site.id,
          rso_user_id: nilUuid,
          lco_user_id: nilUuid,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).not.toBe(500)
      expect([302, 303]).toContain(res.status)
    })

    it('2.3: asymmetric officer pair: valid RSO user is preserved, invalid LCO is coerced to null', async () => {
      const creator = await seedTestUser()
      const token = await signSession(creator.id)
      const genuineRso = await seedTestUser({ displayName: 'Certified RSO Master' })
      const site = await seedTestSite()

      const fakeLco = crypto.randomUUID()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Asymmetric Officer Meet 1',
          launch_site_id: site.id,
          rso_user_id: genuineRso.id,
          lco_user_id: fakeLco,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).not.toBe(500)
      expect([302, 303]).toContain(res.status)

      const location = res.headers.get('Location') ?? ''
      const eventId = location.split('/events/')[1]
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, eventId))

      expect(saved.rsoUserId).toBe(genuineRso.id)
      expect(saved.lcoUserId).toBeNull()
    })

    it('2.4: asymmetric officer pair: invalid RSO coerced to null, valid LCO is preserved', async () => {
      const creator = await seedTestUser()
      const token = await signSession(creator.id)
      const genuineLco = await seedTestUser({ displayName: 'Certified LCO Master' })
      const site = await seedTestSite()

      const fakeRso = 'not-a-real-user'

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Asymmetric Officer Meet 2',
          launch_site_id: site.id,
          rso_user_id: fakeRso,
          lco_user_id: genuineLco.id,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).not.toBe(500)
      expect([302, 303]).toContain(res.status)

      const location = res.headers.get('Location') ?? ''
      const eventId = location.split('/events/')[1]
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, eventId))

      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBe(genuineLco.id)
    })
  })

  // =========================================================================
  // VECTOR 3: Extreme Past Dates and Unusual Date Formats
  // =========================================================================
  describe('Vector 3: Extreme Past Dates & Unusual Formats', () => {
    it('3.1: accepts Unix Epoch date (1970-01-01) without 500 error and redirects cleanly', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Unix Epoch Memorial Launch',
          launch_site_id: site.id,
          starts_on: '1970-01-01',
          ends_on: '1970-01-02',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).not.toBe(500)
      expect([302, 303]).toContain(res.status)

      const location = res.headers.get('Location') ?? ''
      const eventId = location.split('/events/')[1]
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, eventId))

      expect(saved.startsOn).toBe('1970-01-01')
      expect(saved.endsOn).toBe('1970-01-02')
    })

    it('3.2: accepts ancient historical date (e.g. 1800-07-04 or 0001-01-01) without crashing', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Early Rocketry Congreve Meet',
          launch_site_id: site.id,
          starts_on: '1800-07-04',
          ends_on: '1800-07-05',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).not.toBe(500)
      expect([302, 303]).toContain(res.status)

      const location = res.headers.get('Location') ?? ''
      const eventId = location.split('/events/')[1]
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, eventId))

      expect(saved.startsOn).toBe('1800-07-04')
    })

    it('3.3: accepts full ISO timestamp strings in date fields', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'ISO Timestamp Meet',
          launch_site_id: site.id,
          starts_on: '1970-01-01T08:00:00.000Z',
          ends_on: '1970-01-01T17:00:00.000Z',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).not.toBe(500)
      expect([302, 303]).toContain(res.status)
    })

    it('3.4: accepts inverted dates (startsOn after endsOn) without throwing unhandled server error', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Inverted Dates Meet',
          launch_site_id: site.id,
          starts_on: '2026-12-31',
          ends_on: '1970-01-01',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).not.toBe(500)
      expect([302, 303]).toContain(res.status)
    })
  })

  // =========================================================================
  // VECTOR 4: Unassigned and Empty Officer Fields
  // =========================================================================
  describe('Vector 4: Unassigned and Empty Officer Fields', () => {
    it('4.1: empty string officer fields are sanitized to null without foreign key constraint crash', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Empty Officer Fields Meet',
          launch_site_id: site.id,
          rso_user_id: '',
          lco_user_id: '',
          launch_director: '',
          tripoli_prefect: '',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).not.toBe(500)
      expect([302, 303]).toContain(res.status)

      const location = res.headers.get('Location') ?? ''
      const eventId = location.split('/events/')[1]
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, eventId))

      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBeNull()
      expect(saved.launchDirector).toBeNull()
      expect(saved.tripoliPrefect).toBeNull()
    })

    it('4.2: whitespace-only officer fields are sanitized to null', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Whitespace Officer Fields Meet',
          launch_site_id: site.id,
          rso_user_id: '   ',
          lco_user_id: '\t \n ',
          launch_director: '   ',
          tripoli_prefect: '   \r\n ',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).not.toBe(500)
      expect([302, 303]).toContain(res.status)

      const location = res.headers.get('Location') ?? ''
      const eventId = location.split('/events/')[1]
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, eventId))

      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBeNull()
      expect(saved.launchDirector).toBeNull()
      expect(saved.tripoliPrefect).toBeNull()
    })

    it('4.3: completely omitting officer fields succeeds with clean null values', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Minimal Omitted Officers Meet',
          launch_site_id: site.id,
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect(res.status).not.toBe(500)
      expect([302, 303]).toContain(res.status)

      const location = res.headers.get('Location') ?? ''
      const eventId = location.split('/events/')[1]
      const db = getDb()
      const [saved] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.id, eventId))

      expect(saved.rsoUserId).toBeNull()
      expect(saved.lcoUserId).toBeNull()
      expect(saved.launchDirector).toBeNull()
      expect(saved.tripoliPrefect).toBeNull()
    })
  })

  // =========================================================================
  // VECTOR 5: Malformed Payloads & Boundary Input Validation
  // =========================================================================
  describe('Vector 5: Validation & Error Handling (HTTP 400, never 500)', () => {
    it('5.1: missing name returns clean HTTP 400 in form and JSON, never 500', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      // Form request
      const formRes = await fetchPostForm(
        '/events',
        {
          name: '',
          launch_site_id: site.id,
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect(formRes.status).toBe(400)
      const formHtml = await formRes.text()
      expect(formHtml).toMatch(/required|missing/i)

      // JSON request
      const jsonRes = await postJson(
        '/events',
        {
          name: '   ',
          launch_site_id: site.id,
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect(jsonRes.status).toBe(400)
      const jsonData = (await jsonRes.json()) as any
      expect(jsonData.error).toMatch(/required|missing/i)
    })

    it('5.2: missing launch_site_id returns clean HTTP 400, never 500', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Siteless Meet',
          launch_site_id: '',
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect(res.status).toBe(400)
      const html = await res.text()
      expect(html).toMatch(/site/i)
    })

    it('5.3: non-existent launch_site_id returns clean HTTP 400, never 500', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)

      const res = await fetchPostForm(
        '/events',
        {
          name: 'Bogus Site Meet',
          launch_site_id: 'non-existent-launch-site-id',
        },
        { Cookie: `triplet_session=${token}` },
      )
      expect(res.status).toBe(400)
      const html = await res.text()
      expect(html).toMatch(/invalid|site/i)
    })

    it('5.4: non-string officer types in JSON (arrays, objects, numbers) do not cause 500 error', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      const res = await postJson(
        '/events',
        {
          name: 'Type Juggling JSON Meet',
          launch_site_id: site.id,
          rso_user_id: [1, 2, 3],
          lco_user_id: { role: 'admin' },
          launch_director: 12345,
          tripoli_prefect: true,
          pad_count: 'not-a-number',
        },
        { Cookie: `triplet_session=${token}` },
      )

      expect(res.status).not.toBe(500)
      expect([201, 400]).toContain(res.status)
      if (res.status === 201) {
        const json = (await res.json()) as any
        expect(json.rsoUserId).toBeNull()
        expect(json.lcoUserId).toBeNull()
      }
    })

    it('5.5: malformed raw JSON body returns clean HTTP 400 without 500 crash', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)

      const res = await SELF.fetch('https://example.com/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `triplet_session=${token}`,
        },
        body: '{"name": "Broken JSON Meet", launch_site_id: broken',
      })

      expect(res.status).toBe(400)
    })
  })

  // =========================================================================
  // VECTOR 6: Post-Creation View Rendering Resilience
  // =========================================================================
  describe('Vector 6: Post-Creation View Rendering Resilience', () => {
    it('6.1: newly created event with 1970 date and non-UUID officers renders cleanly in GET /events/:id', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite({ name: 'Woomera Rocket Range' })

      // Create event via form
      const postRes = await fetchPostForm(
        '/events',
        {
          name: 'Historic Woomera Blastoff',
          launch_site_id: site.id,
          starts_on: '1970-01-01',
          ends_on: '1970-01-02',
          rso_user_id: 'Capt.Kirk',
          lco_user_id: 'Cmdr.Spock',
          launch_director: 'Sir Arthur Conan Doyle',
          tripoli_prefect: 'Prefect Zaphod',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      expect([302, 303]).toContain(postRes.status)
      const location = postRes.headers.get('Location') ?? ''
      const eventId = location.split('/events/')[1]

      // Fetch detail page
      const getRes = await fetchGet(`/events/${eventId}`, {
        Cookie: `triplet_session=${token}`,
      })
      expect(getRes.status).toBe(200)
      const html = await getRes.text()

      expect(html).toContain('Historic Woomera Blastoff')
      expect(html).toContain('Woomera Rocket Range')
      expect(html).toContain('Sir Arthur Conan Doyle')
      expect(html).toContain('Prefect Zaphod')

      // Detail page JSON endpoint
      const jsonRes = await fetchGet(`/events/${eventId}`, {
        Cookie: `triplet_session=${token}`,
        Accept: 'application/json',
      })
      expect(jsonRes.status).toBe(200)
      const data = (await jsonRes.json()) as any
      expect(data.event.name).toBe('Historic Woomera Blastoff')
      expect(data.event.startsOn).toBe('1970-01-01')
      expect(data.event.launchDirector).toBe('Sir Arthur Conan Doyle')
    })

    it('6.2: GET /events list view displays event with past date and operational leadership', async () => {
      const user = await seedTestUser()
      const token = await signSession(user.id)
      const site = await seedTestSite()

      await fetchPostForm(
        '/events',
        {
          name: 'Adversarial Listed Meet',
          launch_site_id: site.id,
          starts_on: '1970-01-01',
          launch_director: 'Director Listed',
          tripoli_prefect: 'Prefect Listed',
        },
        { Cookie: `triplet_session=${token}` },
        { redirect: 'manual' },
      )

      const listRes = await fetchGet('/events', {
        Cookie: `triplet_session=${token}`,
      })
      expect(listRes.status).toBe(200)
      const listHtml = await listRes.text()
      expect(listHtml).toContain('Adversarial Listed Meet')
      expect(listHtml).toContain('Director Listed')
      expect(listHtml).toContain('Prefect Listed')
    })
  })
})
