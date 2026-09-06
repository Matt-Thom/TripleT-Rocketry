/**
 * Site Administration routes for TripleT-Rocketry.
 * Provides user management, role enforcement, status toggling, deletion, and site settings.
 */

import { Hono } from 'hono'
import { html } from 'hono/html'
import { eq, desc } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { hashPassword } from '../services/auth'
import { pageLayout } from '../views/layout'
import { adminDashboardView, type AdminUserItem } from '../views/admin'

type Bindings = {
  DB: D1Database
  ENVIRONMENT?: string
  PROJECT_ID?: string
  AUTH_SECRET?: string
}

export const adminRouter = new Hono<{ Bindings: Bindings }>()

/**
 * Access control middleware: Enforce administrator role across all /admin routes.
 */
adminRouter.use('*', async (c, next) => {
  const user = (c.get as any)('user')
  const acceptsHtml = c.req.header('accept')?.includes('text/html')

  if (!user) {
    if (acceptsHtml) {
      const targetUrl = encodeURIComponent(c.req.path + (c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : ''))
      return c.redirect(`/login?redirect=${targetUrl}`, 302)
    }
    return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401)
  }

  if (user.role !== 'admin') {
    if (acceptsHtml) {
      const forbiddenView = html`
        <div class="max-w-xl mx-auto py-16 text-center">
          <span class="text-6xl mb-4 block">🚫</span>
          <h1 class="text-3xl font-extrabold text-white">403 — Forbidden</h1>
          <p class="mt-2 text-slate-400 max-w-md mx-auto">
            Administrator privileges are required to access site administration and user management.
          </p>
          <div class="mt-6">
            <a
              href="/"
              class="inline-flex items-center px-4 py-2 text-sm font-semibold rounded-lg bg-brand-500 hover:bg-brand-400 text-slate-950 transition-colors"
            >
              Return to Dashboard
            </a>
          </div>
        </div>
      `
      const forbiddenHtml = pageLayout({
        title: '403 Forbidden — Admin Privileges Required',
        activeTab: 'dashboard',
        content: forbiddenView,
        user,
      })
      return c.html(forbiddenHtml, 403)
    }
    return c.json({ error: 'Forbidden', message: 'Administrator privileges required' }, 403)
  }

  await next()
})

/**
 * Helper to render the admin dashboard.
 */
async function renderAdminDashboard(c: any) {
  const db = drizzle(c.env.DB, { schema })
  const user = (c.get as any)('user')

  const allUsers = await db
    .select()
    .from(schema.users)
    .orderBy(desc(schema.users.createdAt))

  const allCerts = await db.select().from(schema.certifications)
  const certMap = new Map<string, { maxCertLevel: number; certifyingBody: string | null; certNumber: string | null }>()

  for (const cert of allCerts) {
    const existing = certMap.get(cert.userId) || { maxCertLevel: 0, certifyingBody: null, certNumber: null }
    if (typeof cert.level === 'number' && cert.level > existing.maxCertLevel) {
      certMap.set(cert.userId, {
        maxCertLevel: cert.level,
        certifyingBody: cert.certifyingBody,
        certNumber: cert.certNumber,
      })
    } else if (!existing.certifyingBody && cert.certifyingBody) {
      existing.certifyingBody = cert.certifyingBody
      existing.certNumber = cert.certNumber
      certMap.set(cert.userId, existing)
    }
  }

  const userItems: AdminUserItem[] = allUsers.map((u) => {
    const certInfo = certMap.get(u.id)
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      regulatoryRegion: u.regulatoryRegion,
      isActive: u.isActive,
      createdAt: u.createdAt,
      maxCertLevel: certInfo?.maxCertLevel || 0,
      certifyingBody: certInfo?.certifyingBody || null,
      certNumber: certInfo?.certNumber || null,
    }
  })

  // Retrieve site settings
  const settingsRows = await db.select().from(schema.siteSettings).catch(() => [])
  const settings: Record<string, string> = {}
  for (const row of settingsRows) {
    settings[row.key] = row.value
  }

  const message = c.req.query('msg') || null
  const error = c.req.query('error') || null

  const view = adminDashboardView({
    users: userItems,
    settings,
    currentUser: user,
    message,
    error,
  })

  const htmlContent = pageLayout({
    title: 'Site Administration & User Management',
    activeTab: 'admin',
    content: view,
    user,
  })

  return c.html(htmlContent, 200)
}

/**
 * GET /admin & GET /admin/users - User accounts list and admin dashboard.
 */
adminRouter.get('/', renderAdminDashboard)
adminRouter.get('/users', renderAdminDashboard)

/**
 * POST /admin/users - Provision new user.
 */
adminRouter.post('/users', async (c) => {
  const isJson = (c.req.header('content-type') || '').includes('application/json')
  let displayName = ''
  let email = ''
  let password = ''
  let role = 'flyer'
  let regulatoryRegion = 'SA'

  if (isJson) {
    const json = await c.req.json().catch(() => ({}))
    displayName = typeof json.display_name === 'string' ? json.display_name.trim() : (typeof json.displayName === 'string' ? json.displayName.trim() : '')
    email = typeof json.email === 'string' ? json.email.trim().toLowerCase() : ''
    password = typeof json.password === 'string' ? json.password : ''
    role = json.role === 'admin' ? 'admin' : 'flyer'
    regulatoryRegion = json.regulatory_region === 'US' || json.regulatoryRegion === 'US' ? 'US' : 'SA'
  } else {
    const body = await c.req.parseBody()
    displayName = typeof body.display_name === 'string' ? body.display_name.trim() : (typeof body.displayName === 'string' ? body.displayName.trim() : '')
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    password = typeof body.password === 'string' ? body.password : ''
    role = body.role === 'admin' ? 'admin' : 'flyer'
    regulatoryRegion = body.regulatory_region === 'US' || body.regulatoryRegion === 'US' ? 'US' : 'SA'
  }

  if (!displayName || !email || !password) {
    const err = 'Name, email, and password are required'
    if (isJson) return c.json({ error: err }, 400)
    return c.redirect(`/admin/users?error=${encodeURIComponent(err)}`, 302)
  }

  const db = drizzle(c.env.DB, { schema })

  // Check for duplicate email
  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1)

  if (existing) {
    const err = 'A user with this email address already exists'
    if (isJson) return c.json({ error: err }, 400)
    return c.redirect(`/admin/users?error=${encodeURIComponent(err)}`, 302)
  }

  const passwordHash = await hashPassword(password)
  const now = Date.now()

  const [newUser] = await db
    .insert(schema.users)
    .values({
      email,
      displayName,
      passwordHash,
      role: role as 'admin' | 'flyer',
      regulatoryRegion,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  // Add default certification
  await db.insert(schema.certifications).values({
    userId: newUser.id,
    certifyingBody: 'TRA',
    level: 1,
    certNumber: `TRA-AU-${Math.floor(10000 + Math.random() * 90000)}`,
    expiresOn: '2028-12-31',
  })

  if (isJson) {
    return c.json({ status: 'created', user: newUser }, 201)
  }

  return c.redirect(`/admin/users?msg=${encodeURIComponent(`User ${newUser.displayName} created successfully`)}`, 302)
})

/**
 * POST /admin/users/:id/edit - Update user fields.
 */
adminRouter.post('/users/:id/edit', async (c) => {
  const id = c.req.param('id')
  const isJson = (c.req.header('content-type') || '').includes('application/json')
  let displayName: string | undefined
  let email: string | undefined
  let role: string | undefined
  let regulatoryRegion: string | undefined

  if (isJson) {
    const json = await c.req.json().catch(() => ({}))
    displayName = typeof json.display_name === 'string' ? json.display_name.trim() : (typeof json.displayName === 'string' ? json.displayName.trim() : undefined)
    email = typeof json.email === 'string' ? json.email.trim().toLowerCase() : undefined
    role = json.role === 'admin' || json.role === 'flyer' ? json.role : undefined
    regulatoryRegion = json.regulatory_region === 'US' || json.regulatory_region === 'SA' ? json.regulatory_region : undefined
  } else {
    const body = await c.req.parseBody()
    displayName = typeof body.display_name === 'string' ? body.display_name.trim() : (typeof body.displayName === 'string' ? body.displayName.trim() : undefined)
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined
    role = body.role === 'admin' || body.role === 'flyer' ? body.role : undefined
    regulatoryRegion = body.regulatory_region === 'US' || body.regulatory_region === 'SA' ? body.regulatory_region : undefined
  }

  const db = drizzle(c.env.DB, { schema })

  // Guard against demoting the last active administrator account
  if (role === 'flyer') {
    const [targetUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1)

    if (targetUser && targetUser.role === 'admin') {
      const adminRows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.role, 'admin'))

      const activeAdminCount = adminRows.filter((u) => u.isActive).length
      if (activeAdminCount <= 1) {
        const errMsg = 'Cannot demote the last active administrator account'
        if (isJson) return c.json({ error: errMsg }, 400)
        return c.text(errMsg, 400)
      }
    }
  }

  const updateData: any = { updatedAt: Date.now() }

  if (displayName) updateData.displayName = displayName
  if (email) updateData.email = email
  if (role) updateData.role = role
  if (regulatoryRegion) updateData.regulatoryRegion = regulatoryRegion

  await db.update(schema.users).set(updateData).where(eq(schema.users.id, id))

  if (isJson) {
    return c.json({ status: 'ok', message: 'User updated successfully' }, 200)
  }

  return c.redirect('/admin/users?msg=' + encodeURIComponent('User updated successfully'), 302)
})

/**
 * POST /admin/users/:id/status - Toggle active/inactive status.
 */
adminRouter.post('/users/:id/status', async (c) => {
  const id = c.req.param('id')
  const currentUser = (c.get as any)('user')
  const isJson = (c.req.header('content-type') || '').includes('application/json')

  // Guard against self-deactivation
  if (currentUser && currentUser.id === id) {
    const errMsg = 'Cannot deactivate your own account'
    if (isJson) return c.json({ error: errMsg }, 400)
    return c.text(errMsg, 400)
  }

  let isActive = false
  if (isJson) {
    const json = await c.req.json().catch(() => ({}))
    isActive = json.is_active === true || json.is_active === 'true' || json.isActive === true || json.isActive === 'true'
  } else {
    const body = await c.req.parseBody()
    const val = body.is_active !== undefined ? body.is_active : body.isActive
    isActive = String(val) === 'true' || String(val) === '1'
  }

  const db = drizzle(c.env.DB, { schema })

  // Update active status
  await db
    .update(schema.users)
    .set({ isActive, updatedAt: Date.now() })
    .where(eq(schema.users.id, id))

  // When deactivating, purge all server-side active sessions for this user
  if (!isActive) {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, id)).catch(() => {})
  }

  if (isJson) {
    return c.json({ status: 'ok', id, isActive }, 200)
  }

  const statusMsg = isActive ? 'User activated' : 'User deactivated and active sessions revoked'
  return c.redirect(`/admin/users?msg=${encodeURIComponent(statusMsg)}`, 302)
})

/**
 * POST /admin/users/:id/delete - Delete user account and cascade delete sessions and credentials.
 */
adminRouter.post('/users/:id/delete', async (c) => {
  const id = c.req.param('id')
  const currentUser = (c.get as any)('user')
  const isJson = (c.req.header('content-type') || '').includes('application/json')

  // Guard against self-deletion
  if (currentUser && currentUser.id === id) {
    const errMsg = 'Cannot delete your own account'
    if (isJson) return c.json({ error: errMsg }, 400)
    return c.text(errMsg, 400)
  }

  const db = drizzle(c.env.DB, { schema })

  // Check if target is last admin
  const [targetUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1)

  if (targetUser?.role === 'admin') {
    const adminRows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.role, 'admin'))

    if (adminRows.length <= 1) {
      const errMsg = 'Cannot delete the last administrator account'
      if (isJson) return c.json({ error: errMsg }, 400)
      return c.text(errMsg, 400)
    }
  }

  // Delete sessions, credentials, certifications, then user
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, id)).catch(() => {})
  await db.delete(schema.userCredentials).where(eq(schema.userCredentials.userId, id)).catch(() => {})
  await db.delete(schema.certifications).where(eq(schema.certifications.userId, id)).catch(() => {})
  await db.delete(schema.users).where(eq(schema.users.id, id))

  if (isJson) {
    return c.json({ status: 'ok', message: 'User deleted successfully' }, 200)
  }

  return c.redirect('/admin/users?msg=' + encodeURIComponent('User account deleted successfully'), 302)
})

/**
 * GET/POST /admin/settings - Manage instance settings.
 */
adminRouter.get('/settings', (c) => c.redirect('/admin/users#site-settings', 302))

adminRouter.post('/settings', async (c) => {
  const isJson = (c.req.header('content-type') || '').includes('application/json')
  let siteName = ''
  let defaultRegulatoryRegion = 'SA'
  let quickSignInEnabled: string | undefined

  if (isJson) {
    const json = await c.req.json().catch(() => ({}))
    siteName = typeof json.site_name === 'string' ? json.site_name.trim() : (typeof json.siteName === 'string' ? json.siteName.trim() : '')
    defaultRegulatoryRegion = json.default_regulatory_region === 'US' || json.defaultRegulatoryRegion === 'US' ? 'US' : 'SA'
    quickSignInEnabled = json.quick_sign_in_enabled !== undefined ? String(json.quick_sign_in_enabled) : undefined
  } else {
    const body = await c.req.parseBody()
    siteName = typeof body.site_name === 'string' ? body.site_name.trim() : (typeof body.siteName === 'string' ? body.siteName.trim() : '')
    defaultRegulatoryRegion = body.default_regulatory_region === 'US' || body.defaultRegulatoryRegion === 'US' ? 'US' : 'SA'
    quickSignInEnabled = body.quick_sign_in_enabled !== undefined ? String(body.quick_sign_in_enabled) : undefined
  }

  const db = drizzle(c.env.DB, { schema })
  const now = Date.now()

  if (siteName) {
    await db
      .insert(schema.siteSettings)
      .values({ key: 'site_name', value: siteName, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.siteSettings.key,
        set: { value: siteName, updatedAt: now },
      })
  }

  if (defaultRegulatoryRegion) {
    await db
      .insert(schema.siteSettings)
      .values({ key: 'default_regulatory_region', value: defaultRegulatoryRegion, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.siteSettings.key,
        set: { value: defaultRegulatoryRegion, updatedAt: now },
      })
  }

  if (quickSignInEnabled !== undefined) {
    const val = quickSignInEnabled === 'false' ? 'false' : 'true'
    await db
      .insert(schema.siteSettings)
      .values({ key: 'quick_sign_in_enabled', value: val, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.siteSettings.key,
        set: { value: val, updatedAt: now },
      })
  }

  if (isJson) {
    return c.json({ status: 'ok', message: 'Settings saved successfully' }, 200)
  }

  return c.redirect('/admin/users?msg=' + encodeURIComponent('Site settings updated successfully'), 302)
})
