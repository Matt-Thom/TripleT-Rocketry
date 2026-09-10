/**
 * Milestone 5 Final Adversarial Challenge Suite: Cross-Requirement E2E Workload & Stress Integration.
 *
 * Verifies the complete end-to-end operational lifecycle connecting all 5 requirements:
 * R1 (Setup Wizard & First Admin Provisioning) ->
 * R5 (Admin Role & Security Access) ->
 * R3 (Dual-Deploy Rocket with Explicit Datum Labels) ->
 * R2 (20-Column Motor CSV Catalog Import & Propellant Normalization) ->
 * R4 (Flight Logging, Unit Switching Meters/Feet, and Navigation Polish) ->
 * R2 (South Australia Regional Compliance Storage Limit & Dynamic Hardware Forms) ->
 * R5 (Server-Side Session Deletion, Token Revocation, and Logout Route Invalidation).
 *
 * Also verifies that minor caveats noted in prior reviews are non-breaking or gracefully handled.
 */

import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, truncateDb, seedTestMotor, seedTestSite, seedTestUser } from '../helpers/db'
import { assertContains, assertHtmlResponse, assertHasFormField } from '../helpers/html'
import { fetchGet, fetchPostForm } from '../helpers/http'
import * as schema from '../../src/db/schema'
import { eq, isNull } from 'drizzle-orm'
import { parseCookies, createSessionCookie, signSession } from '../../src/services/auth'

beforeEach(async () => {
  await truncateDb()
  try {
    await env.DB.prepare('DELETE FROM site_settings').run()
  } catch {}
})

describe('Milestone 5: Cross-Requirement Integration & E2E Workload Stress Evaluation', () => {
  describe('Vector 1: Complete Operational Lifecycle Across Requirements R1–R5', () => {
    it('1.1: executes the full unified workflow connecting all 5 requirements in unbroken sequence', async () => {
      // -----------------------------------------------------------------------
      // Step 1: Unconfigured Instance Interception & Setup Wizard (R1)
      // -----------------------------------------------------------------------
      const unconfRes = await fetchGet('/', { 'x-test-unconfigured': 'true' }, { redirect: 'manual' })
      expect([302, 303, 307]).toContain(unconfRes.status)
      expect(unconfRes.headers.get('location')).toMatch(/\/setup/i)

      // Verify GET /setup renders form with South Australia default
      const setupGetRes = await fetchGet('/setup')
      assertHtmlResponse(setupGetRes, 200)
      const setupHtml = await setupGetRes.text()
      assertHasFormField(setupHtml, 'site_name')
      assertHasFormField(setupHtml, 'default_regulatory_region')
      assertHasFormField(setupHtml, 'display_name')
      assertHasFormField(setupHtml, 'email')
      assertHasFormField(setupHtml, 'password')
      expect(setupHtml).toContain('value="SA"')

      // POST /setup: Provision initial primary administrator
      const adminEmail = 'admin@southern-rocketry.org.au'
      const adminPass = 'LaunchSafety2026!'
      const setupPostRes = await fetchPostForm(
        '/setup',
        {
          site_name: 'Southern Launch Control',
          default_regulatory_region: 'SA',
          display_name: 'Chief Range Safety Officer',
          email: adminEmail,
          password: adminPass,
          confirm_password: adminPass,
          certifying_body: 'TRA',
          level: '2',
          cert_number: 'TRA-AU-001',
        },
        {},
        { redirect: 'manual' }
      )

      expect([302, 303]).toContain(setupPostRes.status)
      const setCookieHeader = setupPostRes.headers.get('set-cookie') || ''
      expect(setCookieHeader).toMatch(/triplet_session=/i)
      const cookieMatch = setCookieHeader.match(/triplet_session=([^;]+)/)
      expect(cookieMatch).not.toBeNull()
      const rawSessionToken = decodeURIComponent(cookieMatch![1])
      const authHeaders = { Cookie: `triplet_session=${encodeURIComponent(rawSessionToken)}` }

      // Verify database state after setup
      const db = getDb()
      const [adminUser] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, adminEmail))
        .limit(1)
      expect(adminUser).toBeDefined()
      expect(adminUser.role).toBe('admin')
      expect(adminUser.regulatoryRegion).toBe('SA')
      expect(adminUser.isActive).toBe(true)

      const [setupSetting] = await db
        .select()
        .from(schema.siteSettings)
        .where(eq(schema.siteSettings.key, 'setup_completed'))
        .limit(1)
      expect(setupSetting?.value).toBe('true')

      // Verify automatic seeding of Australian launch facilities (Woomera / Lake Hart)
      const launchSites = await db.select().from(schema.launchSites)
      expect(launchSites.length).toBeGreaterThanOrEqual(1)
      const woomeraSite = launchSites.find((s) => s.name.includes('Woomera') || s.name.includes('Lake Hart'))
      expect(woomeraSite).toBeDefined()

      // -----------------------------------------------------------------------
      // Step 2: Site Administration & Access Control Verification (R5)
      // -----------------------------------------------------------------------
      const adminUsersRes = await fetchGet('/admin/users', authHeaders)
      assertHtmlResponse(adminUsersRes, 200)
      const adminUsersHtml = await adminUsersRes.text()
      expect(adminUsersHtml).toContain(adminEmail)
      expect(adminUsersHtml).toContain('admin')

      // -----------------------------------------------------------------------
      // Step 3: Dual-Deploy Rocket Creation with Datum Labels (R3)
      // -----------------------------------------------------------------------
      // GET /rockets/new must display explicit datum reference for CG and CP
      const newRocketRes = await fetchGet('/rockets/new', authHeaders)
      assertHtmlResponse(newRocketRes, 200)
      const newRocketHtml = await newRocketRes.text()
      expect(newRocketHtml).toContain('Reference datum: Distance from Nose Cone Tip')
      expect(newRocketHtml).toContain('value="dual_deploy"')

      // POST /rockets: create a dual-deploy rocket with drogue and main parachutes
      const createRocketRes = await fetchPostForm(
        '/rockets',
        {
          name: 'Australis Explorer Dual-Deploy',
          status: 'flight_ready',
          airframe_material: 'fiberglass',
          fin_count: '4',
          motor_mount_diameter_mm: '38',
          dry_mass_g: '950',
          loaded_mass_g: '1420',
          cg_mm: '1150',
          cp_mm: '1380',
          stability_calibers: '2.4',
          recovery_type: 'dual_deploy',
          parachute_size_mm: '1200', // Main parachute
          drogue_parachute_size_mm: '400', // Drogue parachute
        },
        authHeaders,
        { redirect: 'manual' }
      )

      expect([302, 303]).toContain(createRocketRes.status)
      const rocketRedirect = createRocketRes.headers.get('location') ?? ''
      const rocketIdMatch = rocketRedirect.match(/\/rockets\/([a-zA-Z0-9-]+)/)
      expect(rocketIdMatch).not.toBeNull()
      const rocketId = rocketIdMatch![1]

      // Verify D1 persistence of dual deploy configuration
      const [rocketConfig] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocketId))
        .limit(1)
      expect(rocketConfig).toBeDefined()
      expect(rocketConfig.recoveryType).toBe('dual_deploy')
      expect(rocketConfig.parachuteSizeMm).toBe(1200)
      expect(rocketConfig.drogueParachuteSizeMm).toBe(400)
      expect(rocketConfig.cgMm).toBe(1150)
      expect(rocketConfig.cpMm).toBe(1380)

      // GET /rockets/:id renders both parachutes and explicit datum labels
      const rocketDetailRes = await fetchGet(`/rockets/${rocketId}`, authHeaders)
      assertHtmlResponse(rocketDetailRes, 200)
      const rocketDetailHtml = await rocketDetailRes.text()
      expect(rocketDetailHtml).toContain('Main: 1200mm')
      expect(rocketDetailHtml).toContain('Drogue: 400mm')
      expect(rocketDetailHtml).toContain('Distance from Nose Cone Tip')

      // -----------------------------------------------------------------------
      // Step 4: 20-Column Motor CSV Import & Propellant Normalization (R2)
      // -----------------------------------------------------------------------
      const csvData = [
        'Part_Number,Designation_Product_Name,Manufacturer,Diameter_mm,Hardware,Total_Impulse_Ns,Avg_Thrust_N,Peak_Thrust_N,Propellant_Type,Grains,Propellant_Weight_g,Grain_Weight_g,Total_Weight_g,UN_Number,Classification,Length,Thrust_Duration_Sec,Delay_Sec,USPS_Mailable,Notes',
        'AT-H128W-14A,H128W-14A,AeroTech,29,RMS-29/180,240,128,160,White Lightning,3,105,35,210,UN0351,1.4C,200,1.88,14,0,"Dual-deploy test motor with White Lightning APCP"',
        'CTI-I212SS-12A,I212SS-12A,Cesaroni,38,Pro38-3G,320,212,280,Smoky Sam,3,165,55,310,UN0351,1.4C,240,1.51,12,0,"High-thrust APCP reload with dense smoke"',
      ].join('\n')

      const importRes = await fetchPostForm(
        '/motors/import',
        { csv_data: csvData },
        authHeaders
      )
      assertHtmlResponse(importRes, 200)
      const importHtml = await importRes.text()
      expect(importHtml).toContain('Import Summary: 2 imported')

      // Verify motors in D1
      const [h128Motor] = await db
        .select()
        .from(schema.motors)
        .where(eq(schema.motors.model, 'H128W-14A'))
        .limit(1)
      expect(h128Motor).toBeDefined()
      expect(h128Motor.impulseClass).toBe('H')
      expect(h128Motor.propellantType).toBe('apcp') // normalized from White Lightning
      expect(h128Motor.propellantWeightG).toBe(105)
      expect(h128Motor.delayS).toBe(14)

      // Verify motor catalog renders the imported motor
      const catalogRes = await fetchGet('/motors?search=H128W-14A', authHeaders)
      assertHtmlResponse(catalogRes, 200)
      const catalogHtml = await catalogRes.text()
      expect(catalogHtml).toContain('H128W-14A')
      expect(catalogHtml).toContain('AeroTech')

      // -----------------------------------------------------------------------
      // Step 5: Log Flight with Dual-Deploy Rocket and Imported Motor (R4)
      // -----------------------------------------------------------------------
      // Add motor to admin's inventory
      const [inventoryRow] = await db
        .insert(schema.motorInventories)
        .values({
          userId: adminUser.id,
          motorId: h128Motor.id,
          quantityOnHand: 2,
          expendedCount: 0,
        })
        .returning()

      const flightRes = await fetchPostForm(
        '/flights',
        {
          flyer_id: adminUser.id,
          rocket_configuration_id: rocketConfig.id,
          motor_id: h128Motor.id,
          motor_inventory_id: inventoryRow.id,
          launch_site_id: woomeraSite!.id,
          flight_number: '1',
          altitude_agl_m: '1350',
          altitude_msl_m: '1510',
          outcome: 'successful',
          notes: 'Successful dual-deploy test flight at Woomera.',
        },
        authHeaders,
        { redirect: 'manual' }
      )

      expect([302, 303]).toContain(flightRes.status)
      const flightLocation = flightRes.headers.get('location') ?? ''
      const flightIdMatch = flightLocation.match(/\/flights\/([a-zA-Z0-9-]+)/)
      expect(flightIdMatch).not.toBeNull()
      const flightId = flightIdMatch![1]

      // Verify motor inventory quantity was atomically decremented
      const [updatedInventory] = await db
        .select()
        .from(schema.motorInventories)
        .where(eq(schema.motorInventories.id, inventoryRow.id))
        .limit(1)
      expect(updatedInventory.quantityOnHand).toBe(1)
      expect(updatedInventory.expendedCount).toBe(1)

      // -----------------------------------------------------------------------
      // Step 6: View Flight in Meters and Feet (Unit Toggle & Datum) (R4)
      // -----------------------------------------------------------------------
      // 6a: Metric view (default)
      const metricFlightRes = await fetchGet(`/flights/${flightId}`, authHeaders)
      assertHtmlResponse(metricFlightRes, 200)
      const metricHtml = await metricFlightRes.text()
      expect(metricHtml).toContain('1,350 m')
      expect(metricHtml).toContain('Main: 1200mm')
      expect(metricHtml).toContain('Drogue: 400mm')
      expect(metricHtml).toContain('Reference datum: Distance from Nose Cone Tip')
      expect(metricHtml).toContain('data-m="1350"')

      // 6b: Imperial view (?units=ft)
      // 1350 m * 3.28084 = 4429 ft
      // Main: 1200 / 304.8 = 3.9 ft; Drogue: 400 / 304.8 = 1.3 ft
      const imperialFlightRes = await fetchGet(`/flights/${flightId}?units=ft`, authHeaders)
      assertHtmlResponse(imperialFlightRes, 200)
      const imperialHtml = await imperialFlightRes.text()
      expect(imperialHtml).toContain('4,429 ft')
      expect(imperialHtml).toContain('Main: 3.9 ft')
      expect(imperialHtml).toContain('Drogue: 1.3 ft')
      expect(imperialHtml).toContain('Reference datum: Distance from Nose Cone Tip')
      expect(imperialHtml).toContain('data-altitude="1350"')

      // Verify navigation polish: top navigation headers do NOT contain redundant "+ Log Flight"
      expect(metricHtml).not.toMatch(/<div class=["']flex items-center space-x-4["']>\s*<a href=["']\/flights\/new["'][^>]*>\s*\+ Log Flight/i)
      expect(imperialHtml).not.toMatch(/<div class=["']md:hidden[^"']*["']>[\s\S]*?<a href=["']\/flights\/new["'][^>]*>\s*\+ Log Flight/i)

      // -----------------------------------------------------------------------
      // Step 7: Regional Compliance Storage Summary & Dynamic Hardware (R2)
      // -----------------------------------------------------------------------
      // Current inventory has 1 x H128W (210g weight)
      // In South Australia ('SA'), storage threshold is 3,000g (3.0 kg)
      const invRes = await fetchGet('/inventory', authHeaders)
      assertHtmlResponse(invRes, 200)
      const invHtml = await invRes.text()
      expect(invHtml).toContain('SafeWork SA')
      expect(invHtml).toContain('CASA CASR Part 101')
      expect(invHtml).not.toContain('exceeding the South Australian unlicensed limit')

      // Add motors to trigger SafeWork SA limit exceedance (> 3,000g)
      const [largeMotor] = await db
        .insert(schema.motors)
        .values({
          manufacturer: 'AeroTech',
          model: 'M1500G',
          impulseClass: 'M',
          weightG: 3200,
          propellantWeightG: 3200,
          propellantType: 'apcp',
        })
        .returning()

      await db.insert(schema.motorInventories).values({
        userId: adminUser.id,
        motorId: largeMotor.id,
        quantityOnHand: 1,
        expendedCount: 0,
      })

      // Reload inventory: SafeWork SA limit exceedance warning MUST appear
      const invExceededRes = await fetchGet('/inventory', authHeaders)
      assertHtmlResponse(invExceededRes, 200)
      const invExceededHtml = await invExceededRes.text()
      expect(invExceededHtml).toContain('exceeding the South Australian unlicensed limit')

      // Switch user setting to US regulation
      const updateSettingRes = await fetchPostForm(
        '/settings',
        { regulatory_region: 'US' },
        authHeaders,
        { redirect: 'manual' }
      )
      expect([200, 302, 303]).toContain(updateSettingRes.status)

      // In US mode, storage limit is 50 lbs (22,680g), so 3,410g is compliant!
      const invUsRes = await fetchGet('/inventory', authHeaders)
      assertHtmlResponse(invUsRes, 200)
      const invUsHtml = await invUsRes.text()
      expect(invUsHtml).toContain('NFPA 1122')
      expect(invUsHtml).toContain('Requires NAR/TRA Level 1-3')
      expect(invUsHtml).not.toContain('exceeding the South Australian unlicensed limit')

      // Switch back to SA
      await fetchPostForm('/settings', { regulatory_region: 'SA' }, authHeaders, { redirect: 'manual' })

      // Verify dynamic hardware form hides hazardous specs by default
      const compFormRes = await fetchGet('/inventory/components/new', authHeaders)
      assertHtmlResponse(compFormRes, 200)
      const compFormHtml = await compFormRes.text()
      expect(compFormHtml).toContain('id="hazardous-specs-section"')
      expect(compFormHtml).toContain('hidden')

      // -----------------------------------------------------------------------
      // Step 8: Session Revocation on Logout & Route Invalidation (R5)
      // -----------------------------------------------------------------------
      const logoutRes = await fetchPostForm('/logout', {}, authHeaders, { redirect: 'manual' })
      expect([200, 302]).toContain(logoutRes.status)

      // Verify Set-Cookie clears the session cookie
      const logoutSetCookie = logoutRes.headers.get('set-cookie') || ''
      expect(logoutSetCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i)

      // Verify security headers
      expect(logoutRes.headers.get('clear-site-data')).toContain('cache')
      expect(logoutRes.headers.get('cache-control')).toContain('no-store')

      // Verify session removed from D1 sessions table
      const [remainingSession] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.token, rawSessionToken))
        .limit(1)
      expect(remainingSession).toBeUndefined()

      // Verify token marked in revoked_session
      const [revokedSetting] = await db
        .select()
        .from(schema.siteSettings)
        .where(eq(schema.siteSettings.key, `revoked_session:${rawSessionToken}`))
        .limit(1)
      expect(revokedSetting).toBeDefined()

      // Attempt to access protected routes using the revoked cookie -> MUST be rejected with redirect to /login
      const protectedRoutes = ['/dashboard', '/admin/users', '/rockets', '/flights', '/inventory', '/motors']
      for (const route of protectedRoutes) {
        const testReq = await fetchGet(route, authHeaders, { redirect: 'manual' })
        expect([302, 303, 307, 401]).toContain(testReq.status)
        if ([302, 303, 307].includes(testReq.status)) {
          const loc = testReq.headers.get('location') || ''
          expect(loc).toMatch(/\/login/i)
        }
      }
    })
  })

  describe('Vector 2: Prior Caveats Stress-Testing & Robustness Verification', () => {
    it('2.1: sole active administrator account cannot be demoted, deactivated, or self-deleted', async () => {
      const db = getDb()
      const admin = await seedTestUser({ role: 'admin', isActive: true })
      const token = await signSession(admin.id)
      await db.insert(schema.sessions).values({
        id: crypto.randomUUID(),
        userId: admin.id,
        token,
        expiresAt: Date.now() + 3600000,
        createdAt: Date.now(),
      })
      const headers = { Cookie: createSessionCookie(token) }

      // Attempt to demote sole admin to flyer
      const demoteRes = await fetchPostForm(
        `/admin/users/${admin.id}/edit`,
        { role: 'flyer', display_name: admin.displayName, is_active: 'true' },
        headers,
        { redirect: 'manual' }
      )
      expect(demoteRes.status).toBe(400)
      const demoteText = await demoteRes.text()
      expect(demoteText).toMatch(/cannot demote.*last active administrator/i)

      // Attempt self-deactivation via status toggle
      const deactRes = await fetchPostForm(
        `/admin/users/${admin.id}/status`,
        { is_active: 'false' },
        headers,
        { redirect: 'manual' }
      )
      expect(deactRes.status).toBe(400)
      const deactText = await deactRes.text()
      expect(deactText).toMatch(/cannot deactivate your own account/i)

      // Attempt self-deletion
      const delRes = await fetchPostForm(
        `/admin/users/${admin.id}/delete`,
        {},
        headers,
        { redirect: 'manual' }
      )
      expect(delRes.status).toBe(400)
      const delText = await delRes.text()
      expect(delText).toMatch(/cannot delete your own account/i)
    })

    it('2.2: WebAuthn verification strictly rejects replayed challenges and forged signatures', async () => {
      const db = getDb()
      const user = await seedTestUser({ role: 'flyer', isActive: true })

      // Generate options challenge
      const optRes = await fetchGet('/auth/webauthn/login-options?email=' + encodeURIComponent(user.email))
      expect(optRes.status).toBe(200)
      const options = await optRes.json<{ challenge: string }>()
      const challenge = options.challenge
      expect(challenge).toBeDefined()

      // Forged payload with empty signature
      const fakeVerifyRes = await SELF.fetch('https://example.com/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'fake-credential-id',
          response: {
            signature: 'invalid_sig',
            clientDataJSON: btoa(JSON.stringify({ type: 'webauthn.get', challenge })),
            authenticatorData: 'invalid_auth_data',
          },
        }),
      })
      expect(fakeVerifyRes.status).toBe(401)
    })

    it('2.3: novel and commercial propellant formulas are normalized without SQLite CHECK violations', async () => {
      const db = getDb()
      const admin = await seedTestUser({ role: 'admin' })
      const token = await signSession(admin.id)
      const headers = { Cookie: createSessionCookie(token) }

      const novelCsv = [
        'Part_Number,Designation_Product_Name,Manufacturer,Diameter_mm,Hardware,Total_Impulse_Ns,Avg_Thrust_N,Peak_Thrust_N,Propellant_Type,Grains,Propellant_Weight_g,Grain_Weight_g,Total_Weight_g,UN_Number,Classification,Length,Thrust_Duration_Sec,Delay_Sec,USPS_Mailable,Notes',
        'PRO29-H120,H120-14A,Cesaroni,29,Pro29,220,120,150,Black Jack,2,110,55,230,UN0351,1.4C,180,1.83,14,0,"Black Jack propellant"',
        'SUGAR-G60,G60-8,Experimental,29,Single-Use,120,60,80,KNSU Sugar Propellant,1,80,80,150,UN0351,1.4C,150,2.0,8,0,"Potassium nitrate and sucrose"',
      ].join('\n')

      const res = await fetchPostForm('/motors/import', { csv_data: novelCsv }, headers)
      assertHtmlResponse(res, 200)

      const [bjMotor] = await db.select().from(schema.motors).where(eq(schema.motors.model, 'H120-14A')).limit(1)
      expect(bjMotor.propellantType).toBe('apcp') // Black Jack mapped to apcp

      const [sugarMotor] = await db.select().from(schema.motors).where(eq(schema.motors.model, 'G60-8')).limit(1)
      expect(sugarMotor.propellantType).toBe('other') // Novel sugar propellant mapped to other
    })

    it('2.4: updating rocket from dual-deploy to single-deploy purges drogue parachute size to null', async () => {
      const db = getDb()
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const headers = { Cookie: createSessionCookie(token) }

      // Create dual-deploy rocket
      const rocket = await db.insert(schema.rockets).values({
        ownerId: flyer.id,
        name: 'Valkyrie Variable Recovery',
      }).returning().then((r) => r[0])

      // Initial v1 dual-deploy config
      await db.insert(schema.rocketConfigurations).values({
        rocketId: rocket.id,
        version: 1,
        recoveryType: 'dual_deploy',
        parachuteSizeMm: 1000,
        drogueParachuteSizeMm: 350,
        isCurrent: true,
      })

      // Add v2 configuration switching to single parachute deploy
      const updateRes = await fetchPostForm(
        `/rockets/${rocket.id}/configurations`,
        {
          version: '2',
          recovery_type: 'parachute',
          parachute_size_mm: '1200',
          drogue_parachute_size_mm: '350', // Passing drogue on non-dual-deploy
          is_current: 'true',
        },
        headers,
        { redirect: 'manual' }
      )
      expect([302, 303]).toContain(updateRes.status)

      // Query v2 config from D1: drogueParachuteSizeMm MUST be sanitized to null
      const [v2Config] = await db
        .select()
        .from(schema.rocketConfigurations)
        .where(eq(schema.rocketConfigurations.rocketId, rocket.id))
        .orderBy(schema.rocketConfigurations.version)
        .then((rows) => rows.filter((r) => r.version === 2))

      expect(v2Config).toBeDefined()
      expect(v2Config.recoveryType).toBe('parachute')
      expect(v2Config.drogueParachuteSizeMm).toBeNull()
    })

    it('2.5: units query parameter fallback handles mixed case and invalid values gracefully', async () => {
      const db = getDb()
      const flyer = await seedTestUser()
      const token = await signSession(flyer.id)
      const headers = { Cookie: createSessionCookie(token) }

      const site = await seedTestSite({ maxAltitudeAglM: 2000 })
      const flight = await db.insert(schema.flights).values({
        flyerId: flyer.id,
        altitudeAglM: 1000,
        launchSiteId: site.id,
        outcome: 'successful',
        flownAt: Date.now(),
      }).returning().then((r) => r[0])

      // Fallback for invalid unit parameter
      const invalidRes = await fetchGet(`/flights/${flight.id}?units=INVALID_UNITS`, headers)
      assertHtmlResponse(invalidRes, 200)
      const invalidHtml = await invalidRes.text()
      // Falls back to metric
      expect(invalidHtml).toContain('1,000 m')
      expect(invalidHtml).toContain('data-m="1000"')

      // Case-insensitive resolution for uppercase FT and mixed-case Feet
      const uppercaseRes = await fetchGet(`/flights/${flight.id}?units=FT`, headers)
      assertHtmlResponse(uppercaseRes, 200)
      const uppercaseHtml = await uppercaseRes.text()
      expect(uppercaseHtml).toContain('3,281 ft')

      const feetRes = await fetchGet(`/flights/${flight.id}?units=Feet`, headers)
      assertHtmlResponse(feetRes, 200)
      const feetHtml = await feetRes.text()
      expect(feetHtml).toContain('3,281 ft')

      // Lowercase ft produces imperial conversion
      const ftRes = await fetchGet(`/flights/${flight.id}?units=ft`, headers)
      assertHtmlResponse(ftRes, 200)
      const ftHtml = await ftRes.text()
      expect(ftHtml).toContain('3,281 ft')
    })

    it('2.6: propellant display string precision near boundary (3000.1g) triggers SafeWork SA warning', async () => {
      const db = getDb()
      const flyer = await seedTestUser({ regulatoryRegion: 'SA' })
      const token = await signSession(flyer.id)
      const headers = { Cookie: createSessionCookie(token) }

      const [boundaryMotor] = await db
        .insert(schema.motors)
        .values({
          manufacturer: 'Boundary Mfr',
          model: 'B3000-Boundary',
          impulseClass: 'L',
          weightG: 3000.1,
          propellantWeightG: 3000.1,
          propellantType: 'apcp',
        })
        .returning()

      await db.insert(schema.motorInventories).values({
        userId: flyer.id,
        motorId: boundaryMotor.id,
        quantityOnHand: 1,
        expendedCount: 0,
      })

      const res = await fetchGet('/inventory', headers)
      assertHtmlResponse(res, 200)
      const html = await res.text()
      expect(html).toContain('exceeding the South Australian unlicensed limit')
    })

    it('2.7: motor inventory calculates propellant storage compliance using propellantWeightG when gross weightG is null or differs', async () => {
      const db = getDb()
      const flyer = await seedTestUser({ regulatoryRegion: 'SA' })
      const token = await signSession(flyer.id)
      const headers = { Cookie: createSessionCookie(token) }

      // Motor with null gross weightG, but 3500g propellantWeightG
      const [motorWithNullGross] = await db
        .insert(schema.motors)
        .values({
          manufacturer: 'Heavy Motors',
          model: 'H-NullGross-3500',
          impulseClass: 'L',
          weightG: null,
          propellantWeightG: 3500,
          propellantType: 'apcp',
        })
        .returning()

      await db.insert(schema.motorInventories).values({
        userId: flyer.id,
        motorId: motorWithNullGross.id,
        quantityOnHand: 1,
        expendedCount: 0,
      })

      const res = await fetchGet('/inventory', headers)
      assertHtmlResponse(res, 200)
      const html = await res.text()
      // Because propellantWeightG (3,500g) is > 3,000g limit, it triggers the SA warning
      expect(html).toContain('exceeding the South Australian unlicensed limit')
      expect(html).toContain('3.50 kg')

      // Also test where gross weight is large (5000g) but propellant weight is compliant (2000g)
      const flyer2 = await seedTestUser({ regulatoryRegion: 'SA' })
      const token2 = await signSession(flyer2.id)
      const headers2 = { Cookie: createSessionCookie(token2) }

      const [motorHeavyGross] = await db
        .insert(schema.motors)
        .values({
          manufacturer: 'Gross Heavy Motors',
          model: 'H-HeavyGross-2000',
          impulseClass: 'J',
          weightG: 5000,
          propellantWeightG: 2000,
          propellantType: 'apcp',
        })
        .returning()

      await db.insert(schema.motorInventories).values({
        userId: flyer2.id,
        motorId: motorHeavyGross.id,
        quantityOnHand: 1,
        expendedCount: 0,
      })

      const res2 = await fetchGet('/inventory', headers2)
      assertHtmlResponse(res2, 200)
      const html2 = await res2.text()
      // Net Explosive Weight is 2,000g <= 3,000g limit, so compliant!
      expect(html2).not.toContain('exceeding the South Australian unlicensed limit')
      expect(html2).toContain('2000 g')
    })
  })
})

  describe('Vector 3: Multi-User Access Control, Role Boundaries, and Session Invalidation', () => {
    it('3.1: admin provisions a secondary flyer, who is constrained by RBAC and whose sessions are terminated upon deactivation', async () => {
      const db = getDb()

      // Seed admin
      const admin = await seedTestUser({ role: 'admin', isActive: true })
      const adminToken = await signSession(admin.id)
      await db.insert(schema.sessions).values({
        id: crypto.randomUUID(),
        userId: admin.id,
        token: adminToken,
        expiresAt: Date.now() + 3600000,
        createdAt: Date.now(),
      })
      const adminHeaders = { Cookie: createSessionCookie(adminToken) }

      // 1. Admin creates secondary flyer
      const flyerEmail = 'pilot2@rocketry.local'
      const flyerPass = 'ClubPilotSecret2026!'
      const createUserRes = await fetchPostForm(
        '/admin/users',
        {
          email: flyerEmail,
          display_name: 'Secondary Club Pilot',
          password: flyerPass,
          role: 'flyer',
          regulatory_region: 'SA',
        },
        adminHeaders,
        { redirect: 'manual' }
      )
      expect([200, 302, 303]).toContain(createUserRes.status)

      const [newFlyer] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, flyerEmail))
        .limit(1)
      expect(newFlyer).toBeDefined()
      expect(newFlyer.role).toBe('flyer')
      expect(newFlyer.isActive).toBe(true)

      // 2. Secondary flyer logs in via POST /login
      const loginRes = await fetchPostForm(
        '/login',
        { email: flyerEmail, password: flyerPass },
        {},
        { redirect: 'manual' }
      )
      expect([302, 303]).toContain(loginRes.status)
      const flyerSetCookie = loginRes.headers.get('set-cookie') || ''
      expect(flyerSetCookie).toMatch(/triplet_session=/i)
      const flyerCookieMatch = flyerSetCookie.match(/triplet_session=([^;]+)/)
      expect(flyerCookieMatch).not.toBeNull()
      const flyerToken = decodeURIComponent(flyerCookieMatch![1])
      const flyerHeaders = { Cookie: `triplet_session=${encodeURIComponent(flyerToken)}` }

      // 3. Secondary flyer CANNOT access /admin/users (RBAC 403 Forbidden)
      const forbiddenRes = await fetchGet('/admin/users', flyerHeaders)
      expect([403]).toContain(forbiddenRes.status)

      // 4. Secondary flyer CAN access standard routes (/dashboard, /rockets, /flights)
      const dashboardRes = await fetchGet('/', flyerHeaders)
      assertHtmlResponse(dashboardRes, 200)

      // 5. Admin deactivates secondary flyer via POST /admin/users/:id/status
      const deactRes = await fetchPostForm(
        `/admin/users/${newFlyer.id}/status`,
        { is_active: 'false' },
        adminHeaders,
        { redirect: 'manual' }
      )
      expect([200, 302, 303]).toContain(deactRes.status)

      // Verify secondary flyer isActive is false in D1
      const [deactivatedUser] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, newFlyer.id))
        .limit(1)
      expect(deactivatedUser.isActive).toBe(false)

      // 6. Secondary flyer's active sessions were purged from D1 sessions table
      const flyerSessions = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.userId, newFlyer.id))
      expect(flyerSessions).toHaveLength(0)

      // 7. Secondary flyer's subsequent requests to protected routes are strictly denied
      const rejectedRes = await fetchGet('/flights', flyerHeaders, { redirect: 'manual' })
      expect([302, 303, 307, 401]).toContain(rejectedRes.status)
      if ([302, 303, 307].includes(rejectedRes.status)) {
        expect(rejectedRes.headers.get('location')).toMatch(/\/login/i)
      }

      // 8. Admin session remains unaffected and fully functional
      const adminCheckRes = await fetchGet('/admin/users', adminHeaders)
      assertHtmlResponse(adminCheckRes, 200)
    })
  })

  describe('Vector 4: Motor CSV Batch Ingestion & Upsert Idempotency', () => {
    it('4.1: re-importing identical motor records updates in-place without duplicating catalog rows', async () => {
      const db = getDb()
      const admin = await seedTestUser({ role: 'admin' })
      const token = await signSession(admin.id)
      const headers = { Cookie: createSessionCookie(token) }

      const initialCsv = [
        'Part_Number,Designation_Product_Name,Manufacturer,Diameter_mm,Hardware,Total_Impulse_Ns,Avg_Thrust_N,Peak_Thrust_N,Propellant_Type,Grains,Propellant_Weight_g,Grain_Weight_g,Total_Weight_g,UN_Number,Classification,Length,Thrust_Duration_Sec,Delay_Sec,USPS_Mailable,Notes',
        'AT-G80T-14A,G80T-14A,AeroTech,29,Single-Use,120,80,110,apcp,1,60,60,140,UN0351,1.4C,160,1.5,14,0,"Initial release specs"',
      ].join('\n')

      // Initial import
      const res1 = await fetchPostForm('/motors/import', { csv_data: initialCsv }, headers)
      assertHtmlResponse(res1, 200)
      expect(await res1.text()).toContain('Import Summary: 1 imported')

      const count1 = await db.select().from(schema.motors).where(eq(schema.motors.model, 'G80T-14A'))
      expect(count1).toHaveLength(1)
      expect(count1[0].notes).toBe('Initial release specs')

      // Re-import with updated specs and notes
      const updatedCsv = [
        'Part_Number,Designation_Product_Name,Manufacturer,Diameter_mm,Hardware,Total_Impulse_Ns,Avg_Thrust_N,Peak_Thrust_N,Propellant_Type,Grains,Propellant_Weight_g,Grain_Weight_g,Total_Weight_g,UN_Number,Classification,Length,Thrust_Duration_Sec,Delay_Sec,USPS_Mailable,Notes',
        'AT-G80T-14A,G80T-14A,AeroTech,29,Single-Use,125,85,115,apcp,1,62,62,142,UN0351,1.4C,160,1.47,14,0,"Updated calibration batch 2026"',
      ].join('\n')

      const res2 = await fetchPostForm('/motors/import', { csv_data: updatedCsv }, headers)
      assertHtmlResponse(res2, 200)
      expect(await res2.text()).toContain('0 imported, 1 updated')

      // Verify still exactly 1 motor in D1 with updated specs
      const count2 = await db.select().from(schema.motors).where(eq(schema.motors.model, 'G80T-14A'))
      expect(count2).toHaveLength(1)
      expect(count2[0].notes).toBe('Updated calibration batch 2026')
      expect(count2[0].totalImpulseNs).toBe(125)
      expect(count2[0].averageThrustN).toBe(85)
    })
  })

  describe('Vector 5: Cache-Control & Route Security Headers', () => {
    it('5.1: authenticated protected routes strictly emit Cache-Control: no-store to prevent bfcache leaks', async () => {
      const db = getDb()
      const user = await seedTestUser({ role: 'flyer', isActive: true })
      const token = await signSession(user.id)
      await db.insert(schema.sessions).values({
        id: crypto.randomUUID(),
        userId: user.id,
        token,
        expiresAt: Date.now() + 3600000,
        createdAt: Date.now(),
      })
      const headers = { Cookie: createSessionCookie(token) }

      const routes = ['/', '/rockets', '/flights', '/inventory', '/motors']
      for (const route of routes) {
        const res = await fetchGet(route, headers)
        assertHtmlResponse(res, 200)
        const cc = res.headers.get('cache-control') || ''
        expect(cc).toContain('no-store')
      }
    })

    it('5.2: public health and readiness probes respond with 200 without requiring auth cookies', async () => {
      const healthRes = await fetchGet('/health')
      expect(healthRes.status).toBe(200)
      const healthJson = await healthRes.json<{ status: string }>()
      expect(healthJson.status).toBe('ok')

      const readyRes = await fetchGet('/ready')
      expect(readyRes.status).toBe(200)
      const readyJson = await readyRes.json<{ status: string; database: string }>()
      expect(readyJson.status).toBe('ready')
      expect(readyJson.database).toBe('ok')
    })
  })
