/**
 * Integration test suite for Requirement R2: OpenRocket (.ork) Airframe Import.
 *
 * Verifies:
 * 1. Uploading valid .ork archives creates new rocket and configuration records in D1.
 * 2. SI (MKS) units in OpenRocket (meters, kg) correctly convert to millimeters and grams.
 * 3. Multi-stage rockets correctly accumulate axial length and document stage provenance.
 * 4. Dual deploy and single parachute recovery device specifications are accurately resolved.
 * 5. Content negotiation: Browser requests redirect 303; JSON requests return 201 Created.
 * 6. Worker isolate safety: Malformed files, non-ZIP files, missing rocket.xml, corrupted XML,
 *    and oversized payloads (>10MB) are gracefully rejected with 400 / 413.
 * 7. Unauthenticated requests to /rockets/import are strictly gated (302 / 401).
 * 8. UI integration: Import button appears in /rockets list and callout appears in /rockets/new.
 */

import { env, SELF } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import * as fflate from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema'
import { getDb, seedTestUser, truncateDb } from '../helpers/db'
import { fetchGet } from '../helpers/http'

beforeEach(async () => {
  await truncateDb()
  await env.DB.prepare(
    "INSERT INTO site_settings (key, value, created_at, updated_at) VALUES ('setup_completed', 'true', ?, ?)",
  )
    .bind(Date.now(), Date.now())
    .run()
})

/**
 * Helper to build an in-memory .ork ZIP archive with the given files.
 */
function createZipArchive(files: Record<string, string | Uint8Array>): Uint8Array {
  const zipData: Record<string, Uint8Array> = {}
  for (const [filename, content] of Object.entries(files)) {
    zipData[filename] =
      typeof content === 'string' ? fflate.strToU8(content) : content
  }
  return fflate.zipSync(zipData)
}

describe('Requirement R2: OpenRocket (.ork) Airframe Import', () => {
  describe('Valid .ork File Upload & Airframe Persistence', () => {
    it('persists a single-stage rocket and v1 configuration with accurate SI unit conversions', async () => {
      const flyer = await seedTestUser({
        email: 'aerospace@triplet.local',
        displayName: 'Aero Specialist',
      })

      const xml = `<?xml version="1.0" encoding="utf-8"?>
<openrocket version="1.9" creator="OpenRocket 23.09">
  <rocket>
    <name>Aerotech Initiator 29mm</name>
    <overridemass>0.485</overridemass>
    <subcomponents>
      <stage>
        <name>Sustainer</name>
        <subcomponents>
          <nosecone>
            <name>Ogive Nosecone</name>
            <length>0.32</length>
            <aftradius>0.033</aftradius>
          </nosecone>
          <bodytube>
            <name>Main Body Tube</name>
            <length>0.85</length>
            <radius>0.033</radius>
            <material type="bulk" density="680.0">Cardboard</material>
            <subcomponents>
              <innertube>
                <name>Motor Mount Tube</name>
                <length>0.20</length>
                <radius>0.0145</radius>
                <motormount>
                  <motor configid="default">
                    <diameter>0.029</diameter>
                    <length>0.124</length>
                  </motor>
                </motormount>
              </innertube>
              <trapezoidfinset>
                <name>Aft Fins</name>
                <instancecount>4</instancecount>
              </trapezoidfinset>
              <parachute>
                <name>Nylon Main Chute</name>
                <diameter>0.45</diameter>
              </parachute>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const orkBuffer = createZipArchive({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append(
        'file',
        new Blob([orkBuffer], { type: 'application/vnd.openrocket' }),
        'initiator.ork',
      )

      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: formData,
        redirect: 'manual',
      })

      // Browser submission returns 303 Redirect to /rockets/:id
      expect(res.status).toBe(303)
      const location = res.headers.get('location')
      expect(location).toMatch(/^\/rockets\/[a-f0-9-]+$/)

      // Query database for persisted records
      const db = getDb()
      const [savedRocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.ownerId, flyer.id))

      expect(savedRocket).toBeDefined()
      expect(savedRocket.name).toBe('Aerotech Initiator 29mm')
      expect(savedRocket.status).toBe('flight_ready')
      // 0.32m + 0.85m = 1.17m -> 1170 mm
      expect(savedRocket.lengthMm).toBe(1170)
      // 0.033m radius * 2000 = 66 mm
      expect(savedRocket.bodyDiameterMm).toBe(66)

      // Verify v1 configuration snapshot
      const [savedConfig] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, savedRocket.id))

      expect(savedConfig).toBeDefined()
      expect(savedConfig.version).toBe(1)
      expect(savedConfig.isCurrent).toBe(true)
      expect(savedConfig.lengthMm).toBe(1170)
      expect(savedConfig.bodyDiameterMm).toBe(66)
      // 0.485 kg * 1000 = 485 g
      expect(savedConfig.dryMassG).toBe(485)
      // 0.029 m * 1000 = 29 mm
      expect(savedConfig.motorMountDiameterMm).toBe(29)
      expect(savedConfig.finCount).toBe(4)
      expect(savedConfig.recoveryType).toBe('parachute')
      // 0.45 m * 1000 = 450 mm
      expect(savedConfig.parachuteSizeMm).toBe(450)
      expect(savedConfig.airframeMaterial).toBe('Cardboard')
      expect(savedConfig.notes).toContain('Stages: 1 (Sustainer)')
      expect(savedConfig.notes).toContain('initiator.ork')
    })

    it('persists a multi-stage rocket with dual-deploy recovery and stage notes', async () => {
      const flyer = await seedTestUser({ email: 'multistage@triplet.local' })

      const xml = `<?xml version="1.0" encoding="utf-8"?>
<openrocket version="1.9">
  <rocket>
    <name>Titan Two-Stage Stacker</name>
    <subcomponents>
      <stage>
        <name>Booster</name>
        <overridemass>0.550</overridemass>
        <subcomponents>
          <bodytube>
            <length>0.60</length>
            <radius>0.040</radius>
            <material>Fiberglass</material>
            <subcomponents>
              <innertube>
                <motormount>
                  <motor>
                    <diameter>0.054</diameter>
                  </motor>
                </motormount>
              </innertube>
              <trapezoidfinset>
                <instancecount>3</instancecount>
              </trapezoidfinset>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
      <stage>
        <name>Sustainer</name>
        <overridemass>0.750</overridemass>
        <subcomponents>
          <nosecone>
            <length>0.40</length>
            <aftradius>0.040</aftradius>
          </nosecone>
          <bodytube>
            <length>0.90</length>
            <radius>0.040</radius>
            <material>Fiberglass</material>
            <subcomponents>
              <innertube>
                <motormount>
                  <motor>
                    <diameter>0.038</diameter>
                  </motor>
                </motormount>
              </innertube>
              <trapezoidfinset>
                <instancecount>3</instancecount>
              </trapezoidfinset>
              <parachute>
                <name>Drogue</name>
                <diameter>0.30</diameter>
              </parachute>
              <parachute>
                <name>Main</name>
                <diameter>0.90</diameter>
              </parachute>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const orkBuffer = createZipArchive({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append(
        'file',
        new Blob([orkBuffer], { type: 'application/vnd.openrocket' }),
        'titan.ork',
      )

      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: formData,
        redirect: 'manual',
      })

      expect(res.status).toBe(303)

      const db = getDb()
      const [savedRocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.name, 'Titan Two-Stage Stacker'))

      expect(savedRocket).toBeDefined()
      // Total axial length: Booster body (0.6) + Sustainer nose (0.4) + Sustainer body (0.9) = 1.9m = 1900 mm
      expect(savedRocket.lengthMm).toBe(1900)
      // Diameter: 0.040 radius * 2000 = 80 mm
      expect(savedRocket.bodyDiameterMm).toBe(80)

      const [savedConfig] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, savedRocket.id))

      // Dry mass from sum of stage masses: 0.550 + 0.750 = 1.300 kg = 1300 g
      expect(savedConfig.dryMassG).toBe(1300)
      // Motor mount diameter takes max across stages (54mm)
      expect(savedConfig.motorMountDiameterMm).toBe(54)
      // Two parachutes present -> dual_deploy
      expect(savedConfig.recoveryType).toBe('dual_deploy')
      // Max parachute size: 0.90m = 900 mm
      expect(savedConfig.parachuteSizeMm).toBe(900)
      expect(savedConfig.airframeMaterial).toBe('Fiberglass')
      expect(savedConfig.notes).toContain('Stages: 2 (Booster, Sustainer)')
    })

    it('supports JSON API content negotiation returning 201 Created with JSON response', async () => {
      const flyer = await seedTestUser({ email: 'api-flyer@triplet.local' })

      const xml = `<?xml version="1.0" encoding="utf-8"?>
<openrocket version="1.9">
  <rocket>
    <name>API Express Falcon</name>
    <subcomponents>
      <stage>
        <subcomponents>
          <nosecone><length>0.25</length><aftradius>0.025</aftradius></nosecone>
          <bodytube><length>0.75</length><radius>0.025</radius></bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const orkBuffer = createZipArchive({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append(
        'file',
        new Blob([orkBuffer], { type: 'application/vnd.openrocket' }),
        'falcon.ork',
      )

      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: formData,
      })

      expect(res.status).toBe(201)
      const data = (await res.json()) as any
      expect(data.success).toBe(true)
      expect(data.rocket.name).toBe('API Express Falcon')
      expect(data.rocket.lengthMm).toBe(1000)
      expect(data.rocket.bodyDiameterMm).toBe(50)
      expect(data.configuration.version).toBe(1)
    })
  })

  describe('Error Handling & Worker Isolate Safety (Malformed / Invalid Inputs)', () => {
    it('rejects non-ZIP files with HTTP 400 Bad Request and friendly message', async () => {
      const flyer = await seedTestUser()

      const formData = new FormData()
      formData.append(
        'file',
        new Blob(['This is not a zip file at all! Plain text payload.'], { type: 'text/plain' }),
        'not_a_zip.ork',
      )

      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: formData,
      })

      expect(res.status).toBe(400)
      const data = (await res.json()) as any
      expect(data.message).toContain('not a valid ZIP/.ork archive')
    })

    it('rejects ZIP archives that do not contain rocket.xml with HTTP 400 Bad Request', async () => {
      const flyer = await seedTestUser()

      const emptyZip = createZipArchive({ 'readme.txt': 'Nothing to see here.' })
      const formData = new FormData()
      formData.append(
        'file',
        new Blob([emptyZip], { type: 'application/zip' }),
        'missing_xml.ork',
      )

      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: formData,
      })

      expect(res.status).toBe(400)
      const data = (await res.json()) as any
      expect(data.message).toContain("No 'rocket.xml' design document found")
    })

    it('rejects archives containing corrupted or unparseable XML with HTTP 400 Bad Request', async () => {
      const flyer = await seedTestUser()

      const corruptXmlZip = createZipArchive({
        'rocket.xml': '<openrocket><rocket><broken unclosed tag>',
      })
      const formData = new FormData()
      formData.append(
        'file',
        new Blob([corruptXmlZip], { type: 'application/zip' }),
        'corrupt.ork',
      )

      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: formData,
      })

      expect(res.status).toBe(400)
      const data = (await res.json()) as any
      expect(data.message).toContain('Unable to parse internal rocket.xml')
    })

    it('rejects XML documents that do not describe an OpenRocket design', async () => {
      const flyer = await seedTestUser()

      const otherXmlZip = createZipArchive({
        'rocket.xml': '<?xml version="1.0"?><catalog><book id="1"><title>Unrelated</title></book></catalog>',
      })
      const formData = new FormData()
      formData.append(
        'file',
        new Blob([otherXmlZip], { type: 'application/zip' }),
        'book.ork',
      )

      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: formData,
      })

      expect(res.status).toBe(400)
      const data = (await res.json()) as any
      expect(data.message).toContain('does not contain an OpenRocket <rocket> specification')
    })

    it('rejects empty file uploads with HTTP 400 Bad Request', async () => {
      const flyer = await seedTestUser()

      const formData = new FormData()
      formData.append('file', new Blob([], { type: 'application/zip' }), 'empty.ork')

      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: formData,
      })

      expect(res.status).toBe(400)
      const data = (await res.json()) as any
      expect(data.message).toContain('Please select an OpenRocket (.ork) file to upload')
    })

    it('rejects oversized payloads exceeding 10MB limit with HTTP 413 Payload Too Large', async () => {
      const flyer = await seedTestUser()

      // Header-based oversized check
      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Length': String(15 * 1024 * 1024),
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: new Uint8Array([1, 2, 3]),
      })

      expect(res.status).toBe(413)
      const data = (await res.json()) as any
      expect(data.error).toBe('Payload Too Large')
      expect(data.message).toContain('File exceeds maximum allowed size of 10 MB')
    })
  })

  describe('Unauthenticated Route & Navigation Gating', () => {
    it('redirects unauthenticated browser GET /rockets/import to /login with 302', async () => {
      const res = await SELF.fetch('https://example.com/rockets/import', {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
        },
        redirect: 'manual',
      })

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/login?redirect=%2Frockets%2Fimport')
    })

    it('rejects unauthenticated JSON POST /rockets/import with HTTP 401 Unauthorized', async () => {
      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
        body: new FormData(),
      })

      expect(res.status).toBe(401)
    })
  })

  describe('UI Views & Navigation Integration', () => {
    it('renders the import form at GET /rockets/import for authenticated flyers', async () => {
      const flyer = await seedTestUser()

      const res = await fetchGet('/rockets/import')
      expect(res.status).toBe(200)
      const html = await res.text()

      expect(html).toContain('Import OpenRocket Airframe')
      expect(html).toContain('action="/rockets/import"')
      expect(html).toContain('enctype="multipart/form-data"')
      expect(html).toContain('accept=".ork,application/zip"')
    })

    it('renders the Import OpenRocket button in /rockets fleet list view', async () => {
      await seedTestUser()

      const res = await fetchGet('/rockets')
      expect(res.status).toBe(200)
      const html = await res.text()

      expect(html).toContain('href="/rockets/import"')
      expect(html).toContain('Import OpenRocket (.ork)')
    })

    it('renders the OpenRocket import banner in /rockets/new airframe form view', async () => {
      await seedTestUser()

      const res = await fetchGet('/rockets/new')
      expect(res.status).toBe(200)
      const html = await res.text()

      expect(html).toContain('href="/rockets/import"')
      expect(html).toContain('Have an OpenRocket design file?')
    })
  })

  describe('HTML Browser Error Handling & Content Negotiation', () => {
    it('returns HTML 400 with error alert box when invalid file is submitted via browser form', async () => {
      const flyer = await seedTestUser()

      const formData = new FormData()
      formData.append(
        'file',
        new Blob(['Not a zip archive!'], { type: 'application/octet-stream' }),
        'broken.ork',
      )

      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: formData,
      })

      expect(res.status).toBe(400)
      const html = await res.text()
      expect(html).toContain('Import Error:')
      expect(html).toContain('not a valid ZIP/.ork archive')
    })

    it('returns HTML 413 with error alert box when oversized file is submitted via browser form', async () => {
      const flyer = await seedTestUser()

      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Content-Length': String(12 * 1024 * 1024),
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: new Uint8Array([1, 2, 3]),
      })

      expect(res.status).toBe(413)
      const html = await res.text()
      expect(html).toContain('Import Error:')
      expect(html).toContain('File exceeds maximum allowed size of 10 MB')
    })
  })

  describe('Archive Format Flexibility & Edge Cases', () => {
    it('successfully extracts design when document is named rocket.ork instead of rocket.xml', async () => {
      const flyer = await seedTestUser()

      const xml = `<?xml version="1.0"?>
<openrocket version="1.9">
  <rocket>
    <name>Legacy Format Rocket</name>
    <subcomponents>
      <stage>
        <subcomponents>
          <nosecone><length>0.30</length><aftradius>0.03</aftradius></nosecone>
          <bodytube><length>0.70</length><radius>0.03</radius></bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const orkBuffer = createZipArchive({ 'rocket.ork': xml })
      const formData = new FormData()
      formData.append(
        'file',
        new Blob([orkBuffer], { type: 'application/vnd.openrocket' }),
        'legacy.ork',
      )

      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: formData,
      })

      expect(res.status).toBe(201)
      const data = (await res.json()) as any
      expect(data.rocket.name).toBe('Legacy Format Rocket')
      expect(data.rocket.lengthMm).toBe(1000)
    })

    it('successfully extracts design located in a subfolder inside the archive', async () => {
      const flyer = await seedTestUser()

      const xml = `<?xml version="1.0"?>
<openrocket version="1.9">
  <rocket>
    <name>Subfolder Rocket</name>
    <subcomponents>
      <stage>
        <subcomponents>
          <nosecone><length>0.20</length><aftradius>0.02</aftradius></nosecone>
          <bodytube><length>0.60</length><radius>0.02</radius></bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const orkBuffer = createZipArchive({ 'designs/rocket.xml': xml })
      const formData = new FormData()
      formData.append(
        'file',
        new Blob([orkBuffer], { type: 'application/vnd.openrocket' }),
        'subfolder.ork',
      )

      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: formData,
      })

      expect(res.status).toBe(201)
      const data = (await res.json()) as any
      expect(data.rocket.name).toBe('Subfolder Rocket')
      expect(data.rocket.lengthMm).toBe(800)
    })

    it('correctly classifies streamer-only recovery', async () => {
      const flyer = await seedTestUser()

      const xml = `<?xml version="1.0"?>
<openrocket version="1.9">
  <rocket>
    <name>Streamer Dart</name>
    <subcomponents>
      <stage>
        <subcomponents>
          <nosecone><length>0.15</length><aftradius>0.015</aftradius></nosecone>
          <bodytube>
            <length>0.45</length>
            <radius>0.015</radius>
            <subcomponents>
              <streamer><name>Mylar Streamer</name></streamer>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const orkBuffer = createZipArchive({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([orkBuffer]), 'streamer.ork')

      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: formData,
      })

      expect(res.status).toBe(201)
      const data = (await res.json()) as any
      expect(data.configuration.recoveryType).toBe('streamer')
      expect(data.configuration.parachuteSizeMm).toBeNull()
    })

    it('handles minimal XML without stages or components using sensible defaults', async () => {
      const flyer = await seedTestUser()

      const xml = `<?xml version="1.0"?><openrocket><rocket></rocket></openrocket>`
      const orkBuffer = createZipArchive({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([orkBuffer]), 'barebones.ork')

      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: formData,
      })

      expect(res.status).toBe(201)
      const data = (await res.json()) as any
      // Fallback name from filename
      expect(data.rocket.name).toBe('barebones')
      expect(data.rocket.status).toBe('flight_ready')
      expect(data.rocket.lengthMm).toBeNull()
      expect(data.rocket.bodyDiameterMm).toBeNull()
      expect(data.configuration.version).toBe(1)
      expect(data.configuration.dryMassG).toBeNull()
    })

    it('enforces multi-user isolation so other flyers cannot see imported rockets', async () => {
      const flyer1 = await seedTestUser({ email: 'flyer1@triplet.local' })
      const flyer2 = await seedTestUser({ email: 'flyer2@triplet.local' })

      const xml = `<?xml version="1.0"?><openrocket><rocket><name>Flyer 1 Secret Rocket</name></rocket></openrocket>`
      const orkBuffer = createZipArchive({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([orkBuffer]), 'secret.ork')

      // Flyer 1 imports
      const postRes = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-flyer-id': flyer1.id,
          'x-flyer-email': flyer1.email,
        },
        body: formData,
      })
      expect(postRes.status).toBe(201)

      // Flyer 2 views their own fleet
      const listRes = await fetchGet('/rockets', {
        'x-flyer-id': flyer2.id,
        'x-flyer-email': flyer2.email,
      })
      expect(listRes.status).toBe(200)
      const html = await listRes.text()
      expect(html).not.toContain('Flyer 1 Secret Rocket')
    })
  })
})
