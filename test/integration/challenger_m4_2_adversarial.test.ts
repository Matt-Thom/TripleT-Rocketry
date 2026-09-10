import { beforeEach, describe, expect, it } from 'vitest'
import {
  seedTestConfig,
  seedTestFlight,
  seedTestMotor,
  seedTestRocket,
  seedTestSite,
  seedTestUser,
  truncateDb,
} from '../helpers/db'
import {
  assertContains,
  assertHtmlResponse,
} from '../helpers/html'
import { fetchGet } from '../helpers/http'

beforeEach(truncateDb)

describe('Adversarial M4-2: Flight Units Toggle & Navigation Polish', () => {
  describe('Query parameter edge cases on GET /flights and GET /flights/:id', () => {
    it('handles ?units=ft (lowercase imperial)', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Probe-1' })
      const config = await seedTestConfig(rocket.id, { cgMm: 609.6, cpMm: 914.4 })
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 1000,
      })

      const listRes = await fetchGet('/flights?units=ft')
      assertHtmlResponse(listRes, 200)
      const listHtml = await listRes.text()
      expect(listHtml).toMatch(/3,?281\s*(ft|<\/span>\s*ft)/i)

      const detailRes = await fetchGet(`/flights/${flight.id}?units=ft`)
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toMatch(/3,?281\s*ft/i)
    })

    it('handles ?units=FT (uppercase)', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Probe-FT' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 1000,
      })

      const listRes = await fetchGet('/flights?units=FT')
      assertHtmlResponse(listRes, 200)
      const listHtml = await listRes.text()

      const detailRes = await fetchGet(`/flights/${flight.id}?units=FT`)
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()

      // Let's inspect whether ?units=FT is treated as imperial or falls back to metric
      console.log('listHtml units=FT contains 3,281 ft?', /3,?281\s*(ft|<\/span>\s*ft)/i.test(listHtml))
      console.log('listHtml units=FT contains 1,000 m?', /1,?000\s*(m|<\/span>\s*m)/i.test(listHtml))
    })

    it('handles ?units=m (explicit metric)', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Probe-M' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 1000,
      })

      const listRes = await fetchGet('/flights?units=m')
      assertHtmlResponse(listRes, 200)
      const listHtml = await listRes.text()
      expect(listHtml).toMatch(/1,?000\s*(m|<\/span>\s*m)/i)

      const detailRes = await fetchGet(`/flights/${flight.id}?units=m`)
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toMatch(/1,?000\s*m/i)
    })

    it('handles ?units=M (uppercase metric)', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Probe-UpperM' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 1000,
      })

      const listRes = await fetchGet('/flights?units=M')
      assertHtmlResponse(listRes, 200)
      const listHtml = await listRes.text()
      expect(listHtml).toMatch(/1,?000\s*(m|<\/span>\s*m)/i)

      const detailRes = await fetchGet(`/flights/${flight.id}?units=M`)
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toMatch(/1,?000\s*m/i)
    })

    it('handles ?units=feet', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Probe-Feet' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 1000,
      })

      const listRes = await fetchGet('/flights?units=feet')
      assertHtmlResponse(listRes, 200)
      const listHtml = await listRes.text()
      expect(listHtml).toMatch(/3,?281\s*(ft|<\/span>\s*ft)/i)

      const detailRes = await fetchGet(`/flights/${flight.id}?units=feet`)
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toMatch(/3,?281\s*ft/i)
    })

    it('handles ?units=meters', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Probe-Meters' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 1000,
      })

      const listRes = await fetchGet('/flights?units=meters')
      assertHtmlResponse(listRes, 200)
      const listHtml = await listRes.text()
      expect(listHtml).toMatch(/1,?000\s*(m|<\/span>\s*m)/i)

      const detailRes = await fetchGet(`/flights/${flight.id}?units=meters`)
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toMatch(/1,?000\s*m/i)
    })

    it('handles ?units=invalid (unrecognized unit falls back to metric)', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Probe-Invalid' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 1000,
      })

      const listRes = await fetchGet('/flights?units=invalid_unit_name')
      assertHtmlResponse(listRes, 200)
      const listHtml = await listRes.text()
      expect(listHtml).toMatch(/1,?000\s*(m|<\/span>\s*m)/i)

      const detailRes = await fetchGet(`/flights/${flight.id}?units=invalid_unit_name`)
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toMatch(/1,?000\s*m/i)
    })

    it('handles ?units= (empty string falls back to metric)', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Probe-Empty' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 1000,
      })

      const listRes = await fetchGet('/flights?units=')
      assertHtmlResponse(listRes, 200)
      const listHtml = await listRes.text()
      expect(listHtml).toMatch(/1,?000\s*(m|<\/span>\s*m)/i)

      const detailRes = await fetchGet(`/flights/${flight.id}?units=`)
      assertHtmlResponse(detailRes, 200)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toMatch(/1,?000\s*m/i)
    })
  })

  describe('Altitude conversions: boundary values and floating point rounding', () => {
    it('converts 0m to 0 ft cleanly', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Zero-Alt' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 0,
        altitudeMslM: 0,
      })

      const listRes = await fetchGet('/flights?units=ft')
      const listHtml = await listRes.text()
      expect(listHtml).toMatch(/data-m=["']0["']/i)
      expect(listHtml).toMatch(/data-altitude=["']0["']/i)
      expect(listHtml).toMatch(/0\s*(ft|<\/span>\s*ft)/i)

      const detailRes = await fetchGet(`/flights/${flight.id}?units=ft`)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toMatch(/0\s*ft/i)
    })

    it('converts extreme high altitudes (50,000m space shot) to 164,042 ft', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'SpaceShot-50k' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 50000, // 50,000 * 3.28084 = 164,042 ft
      })

      const listRes = await fetchGet('/flights?units=ft')
      const listHtml = await listRes.text()
      expect(listHtml).toMatch(/164,?042\s*(ft|<\/span>\s*ft)/i)
      expect(listHtml).toMatch(/data-m=["']50000["']/i)

      const detailRes = await fetchGet(`/flights/${flight.id}?units=ft`)
      const detailHtml = await detailRes.text()
      expect(detailHtml).toMatch(/164,?042\s*ft/i)
      expect(detailHtml).toMatch(/data-m=["']50000["']/i)
    })

    it('handles floating point altitudes with correct rounding', async () => {
      const user = await seedTestUser()
      const rocket = await seedTestRocket(user.id, { name: 'Fractional-Alt' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()

      // 123.456m * 3.28084 = 405.03942384 -> 405 ft
      const f1 = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 123.456,
      })

      // 0.6m * 3.28084 = 1.968504 -> 2 ft
      const f2 = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        altitudeAglM: 0.6,
      })

      const listRes = await fetchGet('/flights?units=ft')
      const listHtml = await listRes.text()
      expect(listHtml).toMatch(/405\s*(ft|<\/span>\s*ft)/i)
      expect(listHtml).toMatch(/2\s*(ft|<\/span>\s*ft)/i)
      expect(listHtml).toMatch(/data-m=["']123\.456["']/i)
      expect(listHtml).toMatch(/data-m=["']0\.6["']/i)
    })
  })

  describe('DOM data attributes: data-m and data-altitude', () => {
    it('verifies data-m and data-altitude contain numeric meters in metric and imperial modes', async () => {
      const user = await seedTestUser()
      const site = await seedTestSite({ maxAltitudeAglM: 3048 }) // 3048m = 10,000 ft
      const rocket = await seedTestRocket(user.id, { name: 'DOM-Test-Rocket' })
      const config = await seedTestConfig(rocket.id)
      const motor = await seedTestMotor()
      const flight = await seedTestFlight(user.id, {
        rocketConfigurationId: config.id,
        motorId: motor.id,
        launchSiteId: site.id,
        altitudeAglM: 750,
        altitudeMslM: 820,
      })

      // Metric mode
      const metricListRes = await fetchGet('/flights')
      const metricListHtml = await metricListRes.text()
      expect(metricListHtml).toContain('data-m="750"')
      expect(metricListHtml).toContain('data-altitude="750"')

      const metricDetailRes = await fetchGet(`/flights/${flight.id}`)
      const metricDetailHtml = await metricDetailRes.text()
      expect(metricDetailHtml).toContain('data-m="750"')
      expect(metricDetailHtml).toContain('data-altitude="750"')
      expect(metricDetailHtml).toContain('data-m="820"')
      expect(metricDetailHtml).toContain('data-altitude="820"')
      expect(metricDetailHtml).toContain('data-m="3048"')
      expect(metricDetailHtml).toContain('data-altitude="3048"')

      // Imperial mode
      const imperialListRes = await fetchGet('/flights?units=ft')
      const imperialListHtml = await imperialListRes.text()
      // Even in imperial mode, data-m and data-altitude should still be 750 (numeric meters)
      expect(imperialListHtml).toContain('data-m="750"')
      expect(imperialListHtml).toContain('data-altitude="750"')

      const imperialDetailRes = await fetchGet(`/flights/${flight.id}?units=ft`)
      const imperialDetailHtml = await imperialDetailRes.text()
      expect(imperialDetailHtml).toContain('data-m="750"')
      expect(imperialDetailHtml).toContain('data-altitude="750"')
      expect(imperialDetailHtml).toContain('data-m="820"')
      expect(imperialDetailHtml).toContain('data-altitude="820"')
      expect(imperialDetailHtml).toContain('data-m="3048"')
      expect(imperialDetailHtml).toContain('data-altitude="3048"')
    })
  })

  describe('Header bar navigation polish vs dashboard and /flights', () => {
    it('layout header bar does NOT contain + Log Flight', async () => {
      await seedTestUser()

      // Test across multiple pages that share pageLayout
      const pages = ['/', '/flights', '/rockets', '/motors', '/inventory', '/sites']
      for (const page of pages) {
        const res = await fetchGet(page)
        const html = await res.text()

        // Match header element specifically
        const headerMatch = html.match(/<header[\s\S]*?<\/header>/i)
        expect(headerMatch).not.toBeNull()
        const headerHtml = headerMatch![0]
        expect(headerHtml).not.toMatch(/log.*flight/i)

        // Also check mobile top bar
        const mobileTopBarMatch = html.match(/<div class=["']md:hidden bg-slate-950\/80[\s\S]*?<\/div>/i)
        if (mobileTopBarMatch) {
          expect(mobileTopBarMatch[0]).not.toMatch(/log.*flight/i)
        }
      }
    })

    it('dashboard (GET /) retains functional flight logging button', async () => {
      await seedTestUser()
      const res = await fetchGet('/')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      // Should have link to /flights/new
      expect(html).toContain('href="/flights/new"')
      // Should have Log New Flight button in header area and Log a Flight in quick actions
      expect(html).toMatch(/Log New Flight/i)
      expect(html).toMatch(/Log a Flight/i)
    })

    it('/flights retains functional flight logging button', async () => {
      await seedTestUser()
      const res = await fetchGet('/flights')
      assertHtmlResponse(res, 200)
      const html = await res.text()

      expect(html).toContain('href="/flights/new"')
      expect(html).toMatch(/\+\s*Log Flight/i)
    })
  })
})

describe('Adversarial M4-2: Dual Deploy & Reference Datum Edge Cases', () => {
  it('verifies unit conversions for dual-deploy parachutes and stability datum on flight detail', async () => {
    const user = await seedTestUser()
    const rocket = await seedTestRocket(user.id, { name: 'Dual Deploy Metric Rocket' })
    const config = await seedTestConfig(rocket.id, {
      recoveryType: 'dual_deploy',
      parachuteSizeMm: 1219.2, // 1219.2 mm = 4.0 ft
      drogueParachuteSizeMm: 304.8, // 304.8 mm = 1.0 ft
      cgMm: 914.4, // 3.0 ft
      cpMm: 1219.2, // 4.0 ft
    })
    const motor = await seedTestMotor()
    const flight = await seedTestFlight(user.id, {
      rocketConfigurationId: config.id,
      motorId: motor.id,
      altitudeAglM: 500,
    })

    // Metric detail
    const metricRes = await fetchGet(`/flights/${flight.id}?units=m`)
    const metricHtml = await metricRes.text()
    expect(metricHtml).toContain('Reference datum: Distance from Nose Cone Tip')
    expect(metricHtml).toMatch(/Main:\s*1219\.2mm|Main:\s*1,?219mm/i)
    expect(metricHtml).toMatch(/Drogue:\s*304\.8mm|Drogue:\s*305mm/i)
    expect(metricHtml).toContain('914.4mm / 1219.2mm')

    // Imperial detail
    const imperialRes = await fetchGet(`/flights/${flight.id}?units=ft`)
    const imperialHtml = await imperialRes.text()
    expect(imperialHtml).toContain('Reference datum: Distance from Nose Cone Tip')
    expect(imperialHtml).toMatch(/Main:\s*4\.0\s*ft/i)
    expect(imperialHtml).toMatch(/Drogue:\s*1\.0\s*ft/i)
    expect(imperialHtml).toMatch(/3\.0\s*ft\s*\/\s*4\.0\s*ft/i)
  })

  it('handles null and undefined altitudes on flights list and detail', async () => {
    const user = await seedTestUser()
    const rocket = await seedTestRocket(user.id, { name: 'No-Alt Rocket' })
    const config = await seedTestConfig(rocket.id)
    const motor = await seedTestMotor()
    const flight = await seedTestFlight(user.id, {
      rocketConfigurationId: config.id,
      motorId: motor.id,
      altitudeAglM: null,
      altitudeMslM: null,
    })

    const listRes = await fetchGet('/flights?units=ft')
    const listHtml = await listRes.text()
    expect(listHtml).toMatch(/data-m=["']["']/i)
    expect(listHtml).toMatch(/data-altitude=["']["']/i)
    expect(listHtml).toContain('—')

    const detailRes = await fetchGet(`/flights/${flight.id}?units=ft`)
    const detailHtml = await detailRes.text()
    expect(detailHtml).toMatch(/data-m=["']["']/i)
    expect(detailHtml).toMatch(/data-altitude=["']["']/i)
    expect(detailHtml).toContain('—')
  })
})
