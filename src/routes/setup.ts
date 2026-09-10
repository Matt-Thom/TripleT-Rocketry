/**
 * Setup Wizard Route Handler for TripleT-Rocketry.
 * Handles initial setup wizard GET and POST for instance initialization.
 */

import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { ensureAustralianLaunchSites } from '../db/context'
import {
  hashPassword,
  signSession,
  createSessionCookie,
} from '../services/auth'
import { pageLayout } from '../views/layout'
import { setupWizardView, type SetupWizardViewOptions } from '../views/setup'

type Bindings = {
  DB: D1Database
  ENVIRONMENT?: string
  PROJECT_ID?: string
  AUTH_SECRET?: string
}

export const setupRouter = new Hono<{ Bindings: Bindings }>()

/**
 * Check if the instance setup has already been completed.
 */
export async function isSetupCompleted(db: DrizzleD1Database<any>): Promise<boolean> {
  try {
    const [setting] = await db
      .select()
      .from(schema.siteSettings)
      .where(eq(schema.siteSettings.key, 'setup_completed'))
      .limit(1)
    return setting?.value === 'true'
  } catch {
    return false
  }
}

/**
 * GET /setup - Render setup wizard if unconfigured, or redirect to / if already configured.
 */
setupRouter.get('/setup', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const configured = await isSetupCompleted(db)

  if (configured) {
    return c.redirect('/', 302)
  }

  const error = c.req.query('error') || null
  const view = setupWizardView({ error })
  const html = pageLayout({
    title: 'Initial Setup Wizard',
    activeTab: 'dashboard',
    content: view,
    user: null,
  })

  return c.html(html)
})

/**
 * POST /setup - Process setup wizard submission, provision admin user, insert settings, and create session.
 */
setupRouter.post('/setup', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const configured = await isSetupCompleted(db)

  const isJson = (c.req.header('content-type') || '').includes('application/json') ||
                 (c.req.header('accept') || '').includes('application/json')

  if (configured) {
    if (isJson) {
      return c.json({ error: 'Setup has already been completed' }, 400)
    }
    return c.redirect('/', 302)
  }

  let rawSiteName: string | undefined
  let rawRegion: string | undefined
  let displayName = ''
  let email = ''
  let password = ''
  let confirmPassword = ''
  let certifyingBody = 'TRA'
  let level = 2
  let certNumber = ''

  if (isJson) {
    const json = await c.req.json().catch(() => ({}))
    rawSiteName = json.site_name !== undefined ? json.site_name : json.siteName
    rawRegion = json.default_regulatory_region !== undefined ? json.default_regulatory_region : json.defaultRegulatoryRegion
    displayName = typeof json.display_name === 'string' ? json.display_name.trim() : (typeof json.displayName === 'string' ? json.displayName.trim() : (typeof json.name === 'string' ? json.name.trim() : ''))
    email = typeof json.email === 'string' ? json.email.trim().toLowerCase() : ''
    password = typeof json.password === 'string' ? json.password : ''
    confirmPassword = typeof json.confirm_password === 'string' ? json.confirm_password : (typeof json.confirmPassword === 'string' ? json.confirmPassword : '')
    certifyingBody = typeof json.certifyingBody === 'string' ? json.certifyingBody.trim() : 'TRA'
    level = typeof json.level === 'number' ? json.level : parseInt(String(json.level || '2'), 10)
    certNumber = typeof json.certNumber === 'string' ? json.certNumber.trim() : ''
  } else {
    const body = await c.req.parseBody()
    rawSiteName = body.site_name !== undefined ? (typeof body.site_name === 'string' ? body.site_name : '') : (typeof body.siteName === 'string' ? body.siteName : undefined)
    rawRegion = body.default_regulatory_region !== undefined ? (typeof body.default_regulatory_region === 'string' ? body.default_regulatory_region : '') : (typeof body.defaultRegulatoryRegion === 'string' ? body.defaultRegulatoryRegion : undefined)
    displayName = typeof body.display_name === 'string' ? body.display_name.trim() : (typeof body.displayName === 'string' ? body.displayName.trim() : (typeof body.name === 'string' ? body.name.trim() : ''))
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    password = typeof body.password === 'string' ? body.password : ''
    confirmPassword = typeof body.confirm_password === 'string' ? body.confirm_password : (typeof body.confirmPassword === 'string' ? body.confirmPassword : '')
    certifyingBody = typeof body.certifyingBody === 'string' ? body.certifyingBody.trim() : 'TRA'
    level = parseInt(String(body.level || '2'), 10)
    certNumber = typeof body.certNumber === 'string' ? body.certNumber.trim() : ''
  }

  const siteName = rawSiteName !== undefined ? String(rawSiteName).trim() : 'TripleT-Rocketry'
  const regionStr = rawRegion !== undefined ? String(rawRegion).trim() : 'SA'

  // Input validation
  const renderError = (errMsg: string) => {
    if (isJson) {
      return c.json({ error: errMsg }, 400)
    }
    const viewOptions: SetupWizardViewOptions = {
      siteName,
      defaultRegulatoryRegion: regionStr,
      displayName,
      email,
      certifyingBody,
      level,
      certNumber,
      error: errMsg,
    }
    const view = setupWizardView(viewOptions)
    const html = pageLayout({
      title: 'Initial Setup Wizard',
      activeTab: 'dashboard',
      content: view,
      user: null,
    })
    return c.html(html, 400)
  }

  // 1. Site Name validation
  if (!siteName) {
    return renderError('Site name is required and cannot be empty.')
  }

  // 2. Regulatory Region validation
  const validRegions = ['SA', 'AU_SA', 'US']
  if (!validRegions.includes(regionStr)) {
    return renderError(`Regulatory region '${regionStr}' is invalid or unsupported. Must be South Australia (SA) or United States (US).`)
  }
  const defaultRegulatoryRegion = regionStr === 'US' ? 'US' : 'SA'

  // 3. Administrator Profile validation
  if (!displayName) {
    return renderError('Administrator display name is required.')
  }

  // 4. Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!email || !emailRegex.test(email)) {
    return renderError('A valid administrator email address is required.')
  }

  // 5. Password matching & length validation
  if (password !== confirmPassword) {
    return renderError('Password and confirm password do not match (password mismatch).')
  }

  if (password.length < 8) {
    return renderError('Password length must be at least 8 characters.')
  }

  // 1. Hash password
  const passwordHash = await hashPassword(password)

  // 2. Insert primary admin user
  const [adminUser] = await db
    .insert(schema.users)
    .values({
      email,
      displayName,
      passwordHash,
      isActive: true,
      role: 'admin',
      regulatoryRegion: defaultRegulatoryRegion,
    })
    .returning()

  // 3. Insert certification record
  const certBody = (['TRA', 'NAR'].includes(certifyingBody) ? certifyingBody : 'TRA') as any
  const certLvl = isNaN(level) || level < 0 || level > 3 ? 2 : level
  await db.insert(schema.certifications).values({
    userId: adminUser.id,
    certifyingBody: certBody,
    level: certLvl,
    certNumber: certNumber || 'TRA-AU-ADMIN',
    expiresOn: '2028-12-31',
  })

  // 4. Auto-seed Australian launch facilities
  await ensureAustralianLaunchSites(db).catch(() => {})

  // 5. Insert site_settings
  const now = Date.now()
  await db.insert(schema.siteSettings).values([
    { key: 'site_name', value: siteName, createdAt: now, updatedAt: now },
    { key: 'default_regulatory_region', value: defaultRegulatoryRegion, createdAt: now, updatedAt: now },
    { key: 'setup_completed', value: 'true', createdAt: now, updatedAt: now },
  ])

  // 6. Create session in sessions table
  const token = await signSession(adminUser.id, c.env.AUTH_SECRET)
  const sessionId = crypto.randomUUID()
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000 // 30 days
  await db.insert(schema.sessions).values({
    id: sessionId,
    userId: adminUser.id,
    token,
    expiresAt,
    createdAt: now,
  })

  // 7. Set session cookie and redirect to /
  const cookie = createSessionCookie(token)
  if (isJson) {
    return c.json(
      {
        status: 'ok',
        message: 'Setup completed successfully',
        redirect: '/',
        user: {
          id: adminUser.id,
          email: adminUser.email,
          displayName: adminUser.displayName,
          role: adminUser.role,
          regulatoryRegion: adminUser.regulatoryRegion,
        },
      },
      200,
      { 'Set-Cookie': cookie },
    )
  }

  c.header('Set-Cookie', cookie)
  return c.redirect('/', 302)
})
