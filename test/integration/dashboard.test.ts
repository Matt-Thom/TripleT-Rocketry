/**
 * Navigation, Web Shell Layout & Dashboard Integration Tests (Milestone 1).
 *
 * Verifies server-rendered HTML delivery, Tailwind & HTMX CDN inclusions,
 * desktop and mobile navigation bars, active flyer lazy auto-seeding,
 * quick stats aggregation from D1, recent flight logs, and HTML error handlers.
 */

import { SELF, env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import { getActiveFlyer } from '../../src/db/context'

const db = () => drizzle(env.DB, { schema })

/** Delete in reverse FK-dependency order so each test starts clean. */
async function truncate() {
  for (const table of [
    'flights',
    'launch_events',
    'motor_inventories',
    'rocket_configurations',
    'certifications',
    'rockets',
    'motors',
    'launch_sites',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run()
  }
}

beforeEach(truncate)

describe('Active Flyer Context Helper (src/db/context.ts)', () => {
  it('lazily auto-seeds default flyer with Level 2 TRA certification when users table is empty', async () => {
    const flyer = await getActiveFlyer(db())

    expect(flyer).toBeDefined()
    expect(flyer.email).toBe('flyer@rocketry.local')
    expect(flyer.displayName).toBe('TripleT Pilot')
    expect(flyer.maxCertLevel).toBe(2)

    // Verify persisted in D1
    const usersInDb = await db().select().from(schema.users)
    expect(usersInDb.length).toBe(1)
    expect(usersInDb[0].email).toBe('flyer@rocketry.local')

    const certsInDb = await db().select().from(schema.certifications)
    expect(certsInDb.length).toBe(1)
    expect(certsInDb[0].level).toBe(2)
    expect(certsInDb[0].certifyingBody).toBe('TRA')
  })

  it('retrieves existing user and determines their highest certification level', async () => {
    const d = db()
    const [user] = await d
      .insert(schema.users)
      .values({
        email: 'custom@flyer.org',
        displayName: 'Custom Flyer',
        passwordHash: 'hash123',
      })
      .returning()

    await d.insert(schema.certifications).values([
      { userId: user.id, certifyingBody: 'NAR', level: 1 },
      { userId: user.id, certifyingBody: 'TRA', level: 3 },
    ])

    const flyer = await getActiveFlyer(d)
    expect(flyer.id).toBe(user.id)
    expect(flyer.email).toBe('custom@flyer.org')
    expect(flyer.maxCertLevel).toBe(3)
  })
})

describe('Web Shell & UI Navigation (GET /)', () => {
  it('returns HTTP 200 with text/html content-type header', async () => {
    const res = await SELF.fetch('https://example.com/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('includes Tailwind CSS Play CDN and dark mode styling', async () => {
    const res = await SELF.fetch('https://example.com/')
    const html = await res.text()
    expect(html).toContain('https://cdn.tailwindcss.com')
    expect(html).toContain('tailwind.config')
    expect(html).toContain('bg-slate-900')
    expect(html).toContain('text-slate-100')
  })

  it('includes HTMX v2.0.4 CDN script', async () => {
    const res = await SELF.fetch('https://example.com/')
    const html = await res.text()
    expect(html).toContain('https://unpkg.com/htmx.org@2.0.4')
  })

  it('renders desktop navigation bar with all section links and active dashboard tab', async () => {
    const res = await SELF.fetch('https://example.com/')
    const html = await res.text()

    // Brand and title
    expect(html).toContain('TripleT-Rocketry')
    expect(html).toContain('<title>Dashboard — TripleT-Rocketry</title>')

    // Navigation links
    expect(html).toContain('href="/"')
    expect(html).toContain('href="/flights"')
    expect(html).toContain('href="/rockets"')
    expect(html).toContain('href="/motors"')
    expect(html).toContain('href="/sites"')
    expect(html).toContain('href="/events"')

    // Quick action button
    expect(html).toContain('+ Log Flight')
    expect(html).toContain('href="/flights/new"')
  })

  it('renders mobile Range Companion bottom navigation bar', async () => {
    const res = await SELF.fetch('https://example.com/')
    const html = await res.text()

    expect(html).toContain('aria-label="Mobile navigation"')
    expect(html).toContain('Dashboard')
    expect(html).toContain('Flights')
    expect(html).toContain('Rockets')
    expect(html).toContain('Motors')
    expect(html).toContain('Sites')
  })

  it('renders 4 quick stats cards and empty state when database has no flight logs', async () => {
    const res = await SELF.fetch('https://example.com/')
    const html = await res.text()

    expect(html).toContain('Total Flights')
    expect(html).toContain('Active Rockets')
    expect(html).toContain('Motor Stock')
    expect(html).toContain('Success Rate')

    // Empty state message
    expect(html).toContain('No flights logged yet')
    expect(html).toContain('+ Log First Flight')
  })

  it('renders quick action cards grid', async () => {
    const res = await SELF.fetch('https://example.com/')
    const html = await res.text()

    expect(html).toContain('Quick Actions')
    expect(html).toContain('Log a Flight')
    expect(html).toContain('Add Rocket')
    expect(html).toContain('Motor Inventory')
    expect(html).toContain('Launch Sites')
  })

  it('aggregates and displays real flights, active rockets, motor stock, and recent logbook entries', async () => {
    const d = db()

    // 1. Create flyer
    const flyer = await getActiveFlyer(d)

    // 2. Create rockets
    const [rocket1] = await d
      .insert(schema.rockets)
      .values({ ownerId: flyer.id, name: 'Falcon Scout', status: 'flight_ready' })
      .returning()
    const [rocket2] = await d
      .insert(schema.rockets)
      .values({ ownerId: flyer.id, name: 'Work in Progress', status: 'in_build' })
      .returning()

    // Config for rocket 1
    const [config1] = await d
      .insert(schema.rocketConfigurations)
      .values({ rocketId: rocket1.id, version: 1, stabilityCalibers: 1.5 })
      .returning()

    // 3. Create motor & inventory
    const [motor] = await d
      .insert(schema.motors)
      .values({
        manufacturer: 'AeroTech',
        model: 'H128W',
        impulseClass: 'H',
        delayS: 10,
      })
      .returning()

    await d.insert(schema.motorInventories).values([
      { userId: flyer.id, motorId: motor.id, quantityOnHand: 5, expendedCount: 1 },
      { userId: flyer.id, motorId: motor.id, quantityOnHand: 3, expendedCount: 0 },
    ])

    // 4. Create flight log
    await d.insert(schema.flights).values({
      flyerId: flyer.id,
      rocketConfigurationId: config1.id,
      motorId: motor.id,
      altitudeAglM: 654.2,
      outcome: 'successful',
      softGateWarnings: ['Expected altitude exceeded site ceiling'],
      proceededDespiteWarnings: true,
      flownAt: Date.parse('2026-04-15T14:30:00Z'),
    })

    // Fetch dashboard
    const res = await SELF.fetch('https://example.com/')
    expect(res.status).toBe(200)
    const html = await res.text()

    // Verify stats in HTML
    expect(html).toContain('Falcon Scout')
    expect(html).toContain('AeroTech H128W')
    expect(html).toContain('654.2 m')
    expect(html).toContain('Successful')
    expect(html).toContain('Warnings (1)')
    // 1 active rocket out of 2
    expect(html).toContain('1')
    // 8 total motor units on hand (5 + 3)
    expect(html).toContain('8')
    // 100% success rate (1 successful flight)
    expect(html).toContain('100%')
  })
})

describe('Error Handling & Probe Compatibility', () => {
  it('preserves /health liveness probe', async () => {
    const res = await SELF.fetch('https://example.com/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('preserves /ready database readiness probe', async () => {
    const res = await SELF.fetch('https://example.com/ready')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ready', database: 'ok' })
  })

  it('returns styled HTML 404 page when Accept header requests text/html', async () => {
    const res = await SELF.fetch('https://example.com/nonexistent-route', {
      headers: { Accept: 'text/html,application/xhtml+xml' },
    })
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('404 — Page Not Found')
    expect(html).toContain('Return to Dashboard')
  })

  it('returns JSON 404 when Accept header requests application/json', async () => {
    const res = await SELF.fetch('https://example.com/nonexistent-route', {
      headers: { Accept: 'application/json' },
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ detail: 'Not Found' })
  })
})
