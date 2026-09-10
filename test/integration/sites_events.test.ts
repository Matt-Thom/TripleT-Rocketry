/**
 * Integration test suite for Launch Sites & Launch Events Workflows.
 * Tests sites CRUD, airspace waiver ceilings (max_altitude_agl_m),
 * event scheduling, and Range Safety Officer (RSO) / Launch Control Officer (LCO)
 * assignments in D1.
 */

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import {
  getDb,
  seedTestEvent,
  seedTestSite,
  seedTestUser,
  truncateDb,
} from '../helpers/db'
import {
  assertContains,
  assertHasFormField,
  assertHtmlResponse,
} from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'

beforeEach(truncateDb)

describe('Launch Sites & Events Workflows (Tiers 1-4)', () => {
  describe('Tier 1: Sites Listing & New Site Form (GET /sites, GET /sites/new)', () => {
    it('returns HTTP 200 with HTML content for launch fields list', async () => {
      const res = await fetchGet('/sites')
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toMatch(/site/i)
    })

    it('renders site creation form with coordinates and waiver ceiling inputs', async () => {
      const res = await fetchGet('/sites/new')
      assertHtmlResponse(res, 200)
      const html = await res.text()
      assertHasFormField(html, 'name')
      assertHasFormField(html, 'latitude')
      assertHasFormField(html, 'longitude')
      assertHasFormField(html, 'max_altitude_agl_m')
    })
  })

  describe('Tier 2: Site Creation & Airspace Waiver Ceilings (POST /sites)', () => {
    it('persists a new launch site with waiver ceiling in D1', async () => {
      const res = await fetchPostForm('/sites', {
        name: 'Black Rock Desert Playa',
        latitude: 40.86,
        longitude: -119.12,
        max_altitude_agl_m: 30000,
        notes: 'BALLS launch site with unlimited high-altitude waiver',
      })

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [site] = await db
        .select()
        .from(schema.launchSites)
        .where(eq(schema.launchSites.name, 'Black Rock Desert Playa'))

      expect(site).toBeDefined()
      expect(site.maxAltitudeAglM).toBe(30000)
      expect(site.latitude).toBeCloseTo(40.86)
      expect(site.longitude).toBeCloseTo(-119.12)
    })

    it('displays site details including waiver altitude limit', async () => {
      const site = await seedTestSite({
        name: 'Argonia Rocket Pasture',
        maxAltitudeAglM: 15240,
      })

      const res = await fetchGet(`/sites/${site.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()
      assertContains(html, 'Argonia Rocket Pasture', '15,240')
    })
  })

  describe('Tier 3: Launch Events Listing & Creation (GET /events, POST /events)', () => {
    it('renders event creation form with site and safety officer selectors', async () => {
      await seedTestSite({ name: 'Mojave Test Field' })
      const res = await fetchGet('/events/new')
      assertHtmlResponse(res, 200)
      const html = await res.text()
      assertHasFormField(html, 'name')
      assertHasFormField(html, 'launch_site_id')
      assertHasFormField(html, 'starts_on')
      assertHasFormField(html, 'rso_user_id')
      assertHasFormField(html, 'lco_user_id')
      assertHasFormField(html, 'pad_count')
    })

    it('creates an event linking host site, pad count, and RSO/LCO safety officers', async () => {
      const site = await seedTestSite({ name: 'Lucerne Dry Lake' })
      const rso = await seedTestUser({ displayName: 'Chief RSO Tom' })
      const lco = await seedTestUser({ displayName: 'Pad Director Jane' })

      const res = await fetchPostForm('/events', {
        name: 'ROC Annual LDRS',
        launch_site_id: site.id,
        starts_on: '2026-10-15',
        ends_on: '2026-10-18',
        rso_user_id: rso.id,
        lco_user_id: lco.id,
        pad_count: 24,
        weather_notes: 'Clear skies forecast with light surface winds',
      })

      expect([200, 302, 303]).toContain(res.status)
      const db = getDb()
      const [event] = await db
        .select()
        .from(schema.launchEvents)
        .where(eq(schema.launchEvents.name, 'ROC Annual LDRS'))

      expect(event).toBeDefined()
      expect(event.launchSiteId).toBe(site.id)
      expect(event.rsoUserId).toBe(rso.id)
      expect(event.lcoUserId).toBe(lco.id)
      expect(event.padCount).toBe(24)
    })
  })

  describe('Tier 4: Host Site Relationship & Safety Officers Display', () => {
    it('renders launch event details including assigned RSO/LCO and site ceiling', async () => {
      const site = await seedTestSite({
        name: 'Friends of Amateur Rocketry (FAR)',
        maxAltitudeAglM: 18000,
      })
      const rso = await seedTestUser({ displayName: 'Safety Master Dave' })
      const event = await seedTestEvent(site.id, {
        name: 'FAR Open Launch October',
        rsoUserId: rso.id,
        padCount: 10,
      })

      const res = await fetchGet(`/events/${event.id}`)
      assertHtmlResponse(res, 200)
      const html = await res.text()
      assertContains(html, 'FAR Open Launch October', 'Friends of Amateur Rocketry (FAR)')
      expect(html).toMatch(/(Dave|Safety Master Dave)/)
    })
  })
})
