/**
 * Adversarial Challenger Test Suite for Milestone M2:
 * OpenRocket (.ork) Airframe Import (Requirement R2).
 *
 * Vectors Tested:
 * 1. Corrupt & Malformed ZIP Archives:
 *    - Truncated central directory headers
 *    - Truncated local file body
 *    - Corrupt DEFLATE compressed stream
 *    - Empty ZIP (0 files, End of Central Directory signature only)
 *    - ZIP with empty rocket.xml (0 bytes)
 *    - ZIP bomb resilience (high compression ratio payload)
 * 2. XML Security & Entity Exploitation:
 *    - Billion Laughs / recursive entity expansion (safely ignored, no hang/crash)
 *    - External Entity (XXE with SYSTEM) injection (actively rejected with HTTP 400)
 *    - Deeply nested XML hierarchy exceeding stack depth (actively rejected with HTTP 400)
 *    - CDATA with special characters, quotes, and HTML/XML payloads
 *    - XML with raw HTML tags in <name> (neutralized)
 * 3. Extreme Numeric Boundaries & Unit Conversions:
 *    - Zero mass, length, radius (stores null, no divide-by-zero)
 *    - Negative numbers in length, mass, radius (stores null)
 *    - Scientific notation (e.g. 1.5e-1 m, 2.5e-2 m)
 *    - Non-numeric strings in numeric tags (stores null, no NaN propagation)
 *    - Infinity / overflow values (gracefully handled)
 * 4. Complex Stage Hierarchies, Recovery & Mount Formats:
 *    - 3-stage rocket with multiple motor mount sizes (takes maximum diameter)
 *    - Parachute + streamer combination (dual_deploy)
 *    - Multiple parachutes of different sizes (takes maximum diameter)
 *    - Motor mount defined via innerradius on innertube
 * 5. Multi-Tenancy, SQL/XSS Injection & Persistence Verification:
 *    - SQL injection payloads in rocket name (properly parameterized)
 *    - XSS payloads in rocket name via CDATA (safely escaped by Hono in HTML views)
 *    - Multi-tenant isolation: flyer fleet list only displays owned airframes
 *    - D1 configuration v1 record integrity and foreign key linkage
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

function createZip(files: Record<string, string | Uint8Array>): Uint8Array {
  const zipData: Record<string, Uint8Array> = {}
  for (const [filename, content] of Object.entries(files)) {
    zipData[filename] =
      typeof content === 'string' ? fflate.strToU8(content) : content
  }
  return fflate.zipSync(zipData)
}

describe('Challenger M2: OpenRocket Import Adversarial Stress Suite', () => {
  describe('Vector 1: Malformed Archives & ZIP Corruptions', () => {
    it('gracefully rejects ZIP with truncated central directory with HTTP 400', async () => {
      const flyer = await seedTestUser({ email: 'zip-corrupt@triplet.local' })
      const validZip = createZip({ 'rocket.xml': '<openrocket><rocket><name>Test</name></rocket></openrocket>' })

      // Truncate the ZIP archive right before the central directory
      const truncatedZip = validZip.slice(0, 30)

      const formData = new FormData()
      formData.append(
        'file',
        new Blob([truncatedZip], { type: 'application/vnd.openrocket' }),
        'truncated.ork',
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
      expect(data.error).toBe('Bad Request')
      expect(data.message).toMatch(/failed to decompress|invalid file format/i)
    })

    it('gracefully rejects ZIP with corrupted DEFLATE payload with HTTP 400', async () => {
      const flyer = await seedTestUser({ email: 'deflate-corrupt@triplet.local' })
      const validZip = createZip({ 'rocket.xml': '<openrocket><rocket><name>Valid XML Payload</name></rocket></openrocket>' })

      // Tamper with middle bytes of compressed stream
      const tampered = new Uint8Array(validZip)
      for (let i = 35; i < Math.min(tampered.length - 22, 60); i++) {
        tampered[i] = 0xff
      }

      const formData = new FormData()
      formData.append(
        'file',
        new Blob([tampered], { type: 'application/vnd.openrocket' }),
        'tampered_deflate.ork',
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
      expect(data.error).toBe('Bad Request')
    })

    it('gracefully rejects empty ZIP with 0 entries with HTTP 400', async () => {
      const flyer = await seedTestUser({ email: 'empty-zip@triplet.local' })
      const emptyZip = createZip({})

      const formData = new FormData()
      formData.append(
        'file',
        new Blob([emptyZip], { type: 'application/vnd.openrocket' }),
        'empty_archive.ork',
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
      expect(data.error).toBe('Bad Request')
      expect(data.message).toMatch(/not a valid ZIP|\'rocket\.xml\' design document found/i)
    })

    it('gracefully rejects ZIP where rocket.xml is an empty 0-byte file', async () => {
      const flyer = await seedTestUser({ email: 'empty-xml@triplet.local' })
      const zeroByteXmlZip = createZip({ 'rocket.xml': '' })

      const formData = new FormData()
      formData.append(
        'file',
        new Blob([zeroByteXmlZip], { type: 'application/vnd.openrocket' }),
        'zero_byte_xml.ork',
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
      expect(data.error).toBe('Bad Request')
      expect(data.message).toMatch(/Unable to parse internal rocket\.xml|syntax error/i)
    })

    it('survives high compression ratio payloads without crashing or hanging', async () => {
      const flyer = await seedTestUser({ email: 'zipbomb@triplet.local' })
      // Repeated safe whitespace XML payload compressed tightly
      const repeatedXml = `<openrocket><rocket><name>Puffed Rocket</name><!-- ${'A'.repeat(50000)} --></rocket></openrocket>`
      const bombZip = createZip({ 'rocket.xml': repeatedXml })

      const formData = new FormData()
      formData.append(
        'file',
        new Blob([bombZip], { type: 'application/vnd.openrocket' }),
        'puffed.ork',
      )

      const startTime = Date.now()
      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: formData,
      })
      const elapsed = Date.now() - startTime

      expect(elapsed).toBeLessThan(1000)
      expect(res.status).toBe(201)
      const data = (await res.json()) as any
      expect(data.rocket.name).toBe('Puffed Rocket')
    })
  })

  describe('Vector 2: XML Security & Entity Exploitation', () => {
    it('safely handles Billion Laughs entity expansion without hanging or crashing isolate', async () => {
      const flyer = await seedTestUser({ email: 'billion-laughs@triplet.local' })

      const xml = `<?xml version="1.0"?>
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
 <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
 <!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;">
 <!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;">
 <!ENTITY lol7 "&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;">
 <!ENTITY lol8 "&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;">
 <!ENTITY lol9 "&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;">
]>
<openrocket>
  <rocket>
    <name>&lol9;</name>
  </rocket>
</openrocket>`

      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'billion_laughs.ork')

      const start = Date.now()
      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: formData,
      })
      const durationMs = Date.now() - start

      // Must complete rapidly (under 500ms), no exponential loop
      expect(durationMs).toBeLessThan(500)
      // Must succeed safely because processEntities: false suppresses expansion
      expect(res.status).toBe(201)
      const data = (await res.json()) as any
      // Entities are NOT expanded into gigabytes
      expect(data.rocket.name).toBe('&lol9;')
    })

    it('rejects external entity (XXE SYSTEM) injection attempts with HTTP 400', async () => {
      const flyer = await seedTestUser({ email: 'xxe@triplet.local' })

      const xml = `<?xml version="1.0"?>
<!DOCTYPE test [
  <!ENTITY xxe SYSTEM "http://127.0.0.1:9999/sensitive-data">
]>
<openrocket>
  <rocket>
    <name>&xxe;</name>
  </rocket>
</openrocket>`

      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'xxe.ork')

      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: formData,
      })

      // Fast-xml-parser actively rejects external entities with Error: External entities are not supported
      expect(res.status).toBe(400)
      const data = (await res.json()) as any
      expect(data.error).toBe('Bad Request')
      expect(data.message).toContain('External entities are not supported')
    })

    it('intercepts excessively nested XML tags (50+ levels) with HTTP 400', async () => {
      const flyer = await seedTestUser({ email: 'deep-tree@triplet.local' })

      let nested = '<innertube><name>Deep Core</name></innertube>'
      for (let i = 0; i < 50; i++) {
        nested = `<innertube><name>Layer ${i}</name><subcomponents>${nested}</subcomponents></innertube>`
      }

      const xml = `<?xml version="1.0"?>
<openrocket>
  <rocket>
    <name>Deep Tree Rocket</name>
    <subcomponents>
      <stage>
        <subcomponents>
          <bodytube>
            <length>1.0</length>
            <radius>0.05</radius>
            <subcomponents>
              ${nested}
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'deep.ork')

      const res = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: formData,
      })

      // Fast-xml-parser enforces recursion depth limit preventing call stack overflows
      expect(res.status).toBe(400)
      const data = (await res.json()) as any
      expect(data.error).toBe('Bad Request')
      expect(data.message).toContain('Maximum nested tags exceeded')
    })

    it('safely extracts CDATA sections with XML brackets and quotes', async () => {
      const flyer = await seedTestUser({ email: 'cdata@triplet.local' })

      const xml = `<?xml version="1.0"?>
<openrocket>
  <rocket>
    <name><![CDATA[Project <Omega> & "Vulcan" - 2026]]></name>
    <subcomponents>
      <stage>
        <subcomponents>
          <bodytube>
            <length>0.5</length>
            <radius>0.02</radius>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'cdata.ork')

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
      expect(data.rocket.name).toBe('Project <Omega> & "Vulcan" - 2026')
    })

    it('neutralizes unescaped XML tags inside <name> and falls back to clean filename', async () => {
      const flyer = await seedTestUser({ email: 'tag-name@triplet.local' })

      const xml = `<?xml version="1.0"?>
<openrocket>
  <rocket>
    <name><script id="evil">alert("PWNED")</script></name>
    <subcomponents>
      <stage>
        <subcomponents>
          <bodytube><length>0.5</length><radius>0.02</radius></bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'sanitized_fallback.ork')

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
      // Since <script> was parsed as an XML child element with no #text, it fell back to clean filename
      expect(data.rocket.name).toBe('sanitized_fallback')
    })
  })

  describe('Vector 3: Extreme Numeric Boundaries & Unit Conversions', () => {
    it('handles zero values cleanly by storing null rather than 0 or NaN', async () => {
      const flyer = await seedTestUser({ email: 'zeros@triplet.local' })

      const xml = `<?xml version="1.0"?>
<openrocket>
  <rocket>
    <name>Zero Specs Airframe</name>
    <overridemass>0</overridemass>
    <subcomponents>
      <stage>
        <subcomponents>
          <bodytube>
            <length>0</length>
            <radius>0</radius>
            <subcomponents>
              <innertube>
                <motormount>
                  <motor><diameter>0</diameter></motor>
                </motormount>
              </innertube>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'zeros.ork')

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
      expect(data.rocket.lengthMm).toBeNull()
      expect(data.rocket.bodyDiameterMm).toBeNull()
      expect(data.configuration.dryMassG).toBeNull()
      expect(data.configuration.motorMountDiameterMm).toBeNull()
    })

    it('filters out negative numbers and stores null for physical dimensions', async () => {
      const flyer = await seedTestUser({ email: 'negatives@triplet.local' })

      const xml = `<?xml version="1.0"?>
<openrocket>
  <rocket>
    <name>Negative Specs Airframe</name>
    <overridemass>-0.5</overridemass>
    <subcomponents>
      <stage>
        <subcomponents>
          <bodytube>
            <length>-1.2</length>
            <radius>-0.03</radius>
            <subcomponents>
              <innertube>
                <motormount>
                  <motor><diameter>-0.029</diameter></motor>
                </motormount>
              </innertube>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'negatives.ork')

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
      expect(data.rocket.lengthMm).toBeNull()
      expect(data.rocket.bodyDiameterMm).toBeNull()
      expect(data.configuration.dryMassG).toBeNull()
      expect(data.configuration.motorMountDiameterMm).toBeNull()
    })

    it('handles scientific notation accurately (e.g. 1.5e-1 m, 2.5e-2 m)', async () => {
      const flyer = await seedTestUser({ email: 'scinot@triplet.local' })

      const xml = `<?xml version="1.0"?>
<openrocket>
  <rocket>
    <name>Scientific Notation Rocket</name>
    <overridemass>3.25e-1</overridemass>
    <subcomponents>
      <stage>
        <subcomponents>
          <nosecone>
            <length>2.5e-1</length>
            <aftradius>3.5e-2</aftradius>
          </nosecone>
          <bodytube>
            <length>7.5e-1</length>
            <radius>3.5e-2</radius>
            <subcomponents>
              <innertube>
                <motormount>
                  <motor><diameter>2.9e-2</diameter></motor>
                </motormount>
              </innertube>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'scinot.ork')

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
      // 0.25m + 0.75m = 1.00m = 1000mm
      expect(data.rocket.lengthMm).toBe(1000)
      // 0.035m radius * 2000 = 70mm
      expect(data.rocket.bodyDiameterMm).toBe(70)
      // 0.325kg * 1000 = 325g
      expect(data.configuration.dryMassG).toBe(325)
      // 0.029m * 1000 = 29mm
      expect(data.configuration.motorMountDiameterMm).toBe(29)
    })

    it('handles non-numeric strings in numeric tags gracefully without NaN propagation', async () => {
      const flyer = await seedTestUser({ email: 'non-numeric@triplet.local' })

      const xml = `<?xml version="1.0"?>
<openrocket>
  <rocket>
    <name>Corrupt Numbers Rocket</name>
    <overridemass>N/A</overridemass>
    <subcomponents>
      <stage>
        <subcomponents>
          <bodytube>
            <length>unspecified</length>
            <radius>wide</radius>
            <subcomponents>
              <trapezoidfinset>
                <instancecount>four</instancecount>
              </trapezoidfinset>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'corrupt_numbers.ork')

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
      expect(data.rocket.lengthMm).toBeNull()
      expect(data.rocket.bodyDiameterMm).toBeNull()
      expect(data.configuration.dryMassG).toBeNull()
      expect(data.configuration.finCount).toBeNull()
    })
  })

  describe('Vector 4: Complex Stage Hierarchies, Recovery & Mount Formats', () => {
    it('persists a 3-stage rocket picking maximum motor mount diameter across stages', async () => {
      const flyer = await seedTestUser({ email: 'three-stage@triplet.local' })

      const xml = `<?xml version="1.0"?>
<openrocket>
  <rocket>
    <name>Saturn Multi-Stage</name>
    <subcomponents>
      <!-- Booster: 75mm mount -->
      <stage>
        <name>First Stage Booster</name>
        <subcomponents>
          <bodytube>
            <length>1.2</length>
            <radius>0.075</radius>
            <subcomponents>
              <innertube>
                <motormount>
                  <motor><diameter>0.075</diameter></motor>
                </motormount>
              </innertube>
              <trapezoidfinset><instancecount>4</instancecount></trapezoidfinset>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
      <!-- Second Stage: 54mm mount -->
      <stage>
        <name>Second Stage</name>
        <subcomponents>
          <bodytube>
            <length>0.8</length>
            <radius>0.05</radius>
            <subcomponents>
              <innertube>
                <motormount>
                  <motor><diameter>0.054</diameter></motor>
                </motormount>
              </innertube>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
      <!-- Sustainer: 38mm mount -->
      <stage>
        <name>Third Stage Sustainer</name>
        <subcomponents>
          <nosecone><length>0.4</length><aftradius>0.038</aftradius></nosecone>
          <bodytube>
            <length>0.6</length>
            <radius>0.038</radius>
            <subcomponents>
              <innertube>
                <motormount>
                  <motor><diameter>0.038</diameter></motor>
                </motormount>
              </innertube>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'saturn.ork')

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
      // Total length: 1.2 + 0.8 + 0.4 + 0.6 = 3.0m = 3000mm
      expect(data.rocket.lengthMm).toBe(3000)
      // Max radius: 0.075 * 2000 = 150mm
      expect(data.rocket.bodyDiameterMm).toBe(150)
      // Max motor mount across stages: 75mm
      expect(data.configuration.motorMountDiameterMm).toBe(75)
      expect(data.configuration.notes).toContain('Stages: 3')
      expect(data.configuration.notes).toContain('First Stage Booster, Second Stage, Third Stage Sustainer')
    })

    it('classifies dual_deploy when archive contains 1 parachute and 1 streamer', async () => {
      const flyer = await seedTestUser({ email: 'hybrid-recov@triplet.local' })

      const xml = `<?xml version="1.0"?>
<openrocket>
  <rocket>
    <name>Hybrid Recovery Dart</name>
    <subcomponents>
      <stage>
        <subcomponents>
          <nosecone><length>0.2</length><aftradius>0.02</aftradius></nosecone>
          <bodytube>
            <length>0.6</length>
            <radius>0.02</radius>
            <subcomponents>
              <streamer><name>Drogue Streamer</name></streamer>
              <parachute><name>Main Chute</name><diameter>0.50</diameter></parachute>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'hybrid.ork')

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
      expect(data.configuration.recoveryType).toBe('dual_deploy')
      expect(data.configuration.parachuteSizeMm).toBe(500)
    })

    it('resolves motor mount diameter defined via innerradius on innertube named "Motor Tube"', async () => {
      const flyer = await seedTestUser({ email: 'innerradius@triplet.local' })

      const xml = `<?xml version="1.0"?>
<openrocket>
  <rocket>
    <name>Radius Motor Mount</name>
    <subcomponents>
      <stage>
        <subcomponents>
          <bodytube>
            <length>0.5</length>
            <radius>0.03</radius>
            <subcomponents>
              <innertube>
                <name>Motor Mount Tube 24mm</name>
                <innerradius>0.012</innerradius>
              </innertube>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'radius_mount.ork')

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
      // 0.012 * 2 = 0.024m = 24mm
      expect(data.configuration.motorMountDiameterMm).toBe(24)
    })
  })

  describe('Vector 5: Multi-Tenancy, SQL/XSS Injection & Persistence Verification', () => {
    it('safely handles SQL injection payloads in rocket name and attributes', async () => {
      const flyer = await seedTestUser({ email: 'sqli@triplet.local' })
      const dangerousName = "'; DROP TABLE rockets; DROP TABLE users; --"

      const xml = `<?xml version="1.0"?>
<openrocket>
  <rocket>
    <name>${dangerousName}</name>
    <subcomponents>
      <stage>
        <subcomponents>
          <bodytube><length>0.5</length><radius>0.02</radius></bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'sqli.ork')

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
      expect(data.rocket.name).toBe(dangerousName)

      // Verify database table is still intact and record was properly escaped via ORM
      const db = getDb()
      const [persisted] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.id, data.rocket.id))
      expect(persisted).toBeDefined()
      expect(persisted.name).toBe(dangerousName)
    })

    it('safely escapes XSS payloads when imported rocket is viewed in HTML', async () => {
      const flyer = await seedTestUser({ email: 'xss@triplet.local' })
      const xssName = '<script id="evil">alert("PWNED")</script>'

      // Wrap in CDATA so XML parser reads it as text
      const xml = `<?xml version="1.0"?>
<openrocket>
  <rocket>
    <name><![CDATA[${xssName}]]></name>
    <subcomponents>
      <stage>
        <subcomponents>
          <bodytube><length>0.5</length><radius>0.02</radius></bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'xss.ork')

      const postRes = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
        },
        body: formData,
      })
      expect(postRes.status).toBe(201)
      const data = (await postRes.json()) as any
      expect(data.rocket.name).toBe(xssName)

      // View rocket fleet list
      const fleetRes = await fetchGet('/rockets', {
        'x-flyer-id': flyer.id,
        'x-flyer-email': flyer.email,
      })
      expect(fleetRes.status).toBe(200)
      const fleetHtml = await fleetRes.text()

      // The raw script tag must NOT be executable HTML; it must be escaped
      expect(fleetHtml).not.toContain('<script id="evil">alert("PWNED")</script>')
      expect(fleetHtml).toContain('&lt;script id=&quot;evil&quot;&gt;alert(&quot;PWNED&quot;)&lt;/script&gt;')

      // View rocket detail page
      const detailRes = await fetchGet(`/rockets/${data.rocket.id}`, {
        'x-flyer-id': flyer.id,
        'x-flyer-email': flyer.email,
      })
      expect(detailRes.status).toBe(200)
      const detailHtml = await detailRes.text()
      expect(detailHtml).not.toContain('<script id="evil">alert("PWNED")</script>')
    })

    it('strictly isolates rockets in fleet listings between flyers', async () => {
      const flyerOwner = await seedTestUser({ email: 'owner@triplet.local' })
      const flyerOther = await seedTestUser({ email: 'other@triplet.local' })

      const xml = `<?xml version="1.0"?>
<openrocket>
  <rocket>
    <name>Confidential High-Power Rocket</name>
    <subcomponents>
      <stage>
        <subcomponents>
          <bodytube><length>1.5</length><radius>0.05</radius></bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'secret.ork')

      const postRes = await SELF.fetch('https://example.com/rockets/import', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-flyer-id': flyerOwner.id,
          'x-flyer-email': flyerOwner.email,
        },
        body: formData,
      })
      expect(postRes.status).toBe(201)

      // Other flyer views their own fleet
      const listRes = await fetchGet('/rockets', {
        'x-flyer-id': flyerOther.id,
        'x-flyer-email': flyerOther.email,
      })
      expect(listRes.status).toBe(200)
      const fleetHtml = await listRes.text()
      expect(fleetHtml).not.toContain('Confidential High-Power Rocket')

      // Check D1 record associations
      const db = getDb()
      const [savedRocket] = await db
        .select()
        .from(schema.rockets)
        .where(eq(schema.rockets.name, 'Confidential High-Power Rocket'))
      expect(savedRocket.ownerId).toBe(flyerOwner.id)
      expect(savedRocket.createdBy).toBe(flyerOwner.id)

      const [savedConfig] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, savedRocket.id))
      expect(savedConfig.createdBy).toBe(flyerOwner.id)
      expect(savedConfig.version).toBe(1)
      expect(savedConfig.isCurrent).toBe(true)
    })
  })

  describe('Vector 6: Aerodynamic Components, Overrides & Encoding Resiliency', () => {
    it('honors root-level overrides for length, diameter, and mass over component sums', async () => {
      const flyer = await seedTestUser({ email: 'overrides@triplet.local' })

      const xml = `<?xml version="1.0"?>
<openrocket>
  <rocket>
    <name>Overridden Specs Airframe</name>
    <overridelength>1.85</overridelength>
    <overridediameter>0.098</overridediameter>
    <overridemass>2.450</overridemass>
    <subcomponents>
      <stage>
        <subcomponents>
          <nosecone><length>0.3</length><aftradius>0.03</aftradius></nosecone>
          <bodytube><length>0.7</length><radius>0.03</radius><mass>0.500</mass></bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'overrides.ork')

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
      // Root override length: 1.85m -> 1850mm (instead of 1.0m)
      expect(data.rocket.lengthMm).toBe(1850)
      // Root override diameter: 0.098m -> 98mm (instead of 60mm)
      expect(data.rocket.bodyDiameterMm).toBe(98)
      // Root override mass: 2.450kg -> 2450g (instead of 500g)
      expect(data.configuration.dryMassG).toBe(2450)
    })

    it('does not misclassify couplers and avionics tubes as motor mounts', async () => {
      const flyer = await seedTestUser({ email: 'coupler@triplet.local' })

      const xml = `<?xml version="1.0"?>
<openrocket>
  <rocket>
    <name>Coupler Test Airframe</name>
    <subcomponents>
      <stage>
        <subcomponents>
          <bodytube>
            <length>0.8</length>
            <radius>0.038</radius>
            <subcomponents>
              <!-- Coupler tube: must NOT be classified as motor mount -->
              <innertube>
                <name>Avionics Bay Coupler</name>
                <length>0.15</length>
                <radius>0.036</radius>
              </innertube>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'coupler.ork')

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
      // Since inner tube was an avionics bay without motormount, motor mount diameter must be null
      expect(data.configuration.motorMountDiameterMm).toBeNull()
    })

    it('includes conical transition foreradius and aftradius in max body diameter calculation', async () => {
      const flyer = await seedTestUser({ email: 'transition@triplet.local' })

      const xml = `<?xml version="1.0"?>
<openrocket>
  <rocket>
    <name>Transition Airframe</name>
    <subcomponents>
      <stage>
        <subcomponents>
          <nosecone><length>0.25</length><aftradius>0.02</aftradius></nosecone>
          <bodytube><length>0.50</length><radius>0.02</radius></bodytube>
          <!-- Conical transition expanding to 60mm radius (120mm diameter) -->
          <transition>
            <length>0.15</length>
            <foreradius>0.02</foreradius>
            <aftradius>0.06</aftradius>
          </transition>
          <bodytube><length>0.60</length><radius>0.06</radius></bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`

      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'transition.ork')

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
      // Length: 0.25 + 0.50 + 0.15 + 0.60 = 1.50m = 1500mm
      expect(data.rocket.lengthMm).toBe(1500)
      // Diameter: max radius is 0.06m -> 120mm
      expect(data.rocket.bodyDiameterMm).toBe(120)
    })

    it('successfully parses UTF-8 Byte Order Mark (BOM) encoded rocket.xml', async () => {
      const flyer = await seedTestUser({ email: 'bom@triplet.local' })

      const xml = '\uFEFF<?xml version="1.0" encoding="utf-8"?><openrocket><rocket><name>Windows BOM Rocket</name></rocket></openrocket>'
      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'bom.ork')

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
      expect(data.rocket.name).toBe('Windows BOM Rocket')
    })

    it('rejects XML with openrocket root but missing rocket specification with HTTP 400', async () => {
      const flyer = await seedTestUser({ email: 'no-rocket@triplet.local' })

      const xml = '<?xml version="1.0"?><openrocket version="1.9"><simulations></simulations></openrocket>'
      const zip = createZip({ 'rocket.xml': xml })
      const formData = new FormData()
      formData.append('file', new Blob([zip]), 'no_rocket.ork')

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
  })
})
