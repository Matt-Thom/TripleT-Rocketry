/**
 * Authentication routes for TripleT-Rocketry.
 * Handles Login, Registration, Logout, and Pilot Switching.
 */

import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { getActiveFlyer, getAllFlyers, ensureDemoPilots } from '../db/context'
import {
  hashPassword,
  verifyPassword,
  signSession,
  createSessionCookie,
  createLogoutCookie,
} from '../services/auth'
import { pageLayout } from '../views/layout'
import { loginView, registerView } from '../views/auth'

type Bindings = {
  DB: D1Database
  ENVIRONMENT?: string
  PROJECT_ID?: string
  AUTH_SECRET?: string
}

export const authRouter = new Hono<{ Bindings: Bindings }>()

/**
 * GET /login - Render login form with Australian demo pilot quick-switchers.
 */
authRouter.get('/login', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  // Ensure default flyers & Australian demo pilots exist
  await ensureDemoPilots(db)
  const pilots = await getAllFlyers(db)
  const redirectUrl = c.req.query('redirect') || '/'
  const error = c.req.query('error') || null

  const view = loginView({ redirectUrl, error, pilots })
  const html = pageLayout({
    title: 'Sign In',
    activeTab: 'dashboard',
    content: view,
    user: (c.get as any)('user') || null,
  })

  return c.html(html)
})

/**
 * POST /login - Authenticate credentials and issue session cookie.
 */
authRouter.post('/login', async (c) => {
  const isJson = (c.req.header('content-type') || '').includes('application/json')
  let email = ''
  let password = ''
  let redirectUrl = '/'

  if (isJson) {
    const json = await c.req.json().catch(() => ({}))
    email = typeof json.email === 'string' ? json.email.trim().toLowerCase() : ''
    password = typeof json.password === 'string' ? json.password : ''
    redirectUrl = typeof json.redirect === 'string' ? json.redirect : '/'
  } else {
    const body = await c.req.parseBody()
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    password = typeof body.password === 'string' ? body.password : ''
    redirectUrl = typeof body.redirect === 'string' && body.redirect ? body.redirect : '/'
  }

  if (!email || !password) {
    if (isJson) return c.json({ error: 'Email and password are required' }, 400)
    return c.redirect(`/login?error=${encodeURIComponent('Email and password are required')}&redirect=${encodeURIComponent(redirectUrl)}`, 302)
  }

  const db = drizzle(c.env.DB, { schema })
  // Ensure defaults are populated if initial call
  await getActiveFlyer(db)

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1)

  if (!user) {
    if (isJson) return c.json({ error: 'Invalid email or password' }, 401)
    return c.redirect(`/login?error=${encodeURIComponent('Invalid email or password')}&redirect=${encodeURIComponent(redirectUrl)}`, 302)
  }

  const isValid = await verifyPassword(password, user.passwordHash)
  if (!isValid) {
    if (isJson) return c.json({ error: 'Invalid email or password' }, 401)
    return c.redirect(`/login?error=${encodeURIComponent('Invalid email or password')}&redirect=${encodeURIComponent(redirectUrl)}`, 302)
  }

  const token = await signSession(user.id, c.env.AUTH_SECRET)
  const cookie = createSessionCookie(token)

  if (isJson) {
    return c.json({ status: 'ok', userId: user.id, email: user.email }, 200, {
      'Set-Cookie': cookie,
    })
  }

  c.header('Set-Cookie', cookie)
  return c.redirect(redirectUrl.startsWith('/') ? redirectUrl : '/', 302)
})

/**
 * GET /register - Render registration page.
 */
authRouter.get('/register', (c) => {
  const redirectUrl = c.req.query('redirect') || '/'
  const error = c.req.query('error') || null

  const view = registerView({ redirectUrl, error })
  const html = pageLayout({
    title: 'Register Profile',
    activeTab: 'dashboard',
    content: view,
    user: (c.get as any)('user') || null,
  })

  return c.html(html)
})

/**
 * POST /register - Create user and certification, issue session cookie.
 */
authRouter.post('/register', async (c) => {
  const isJson = (c.req.header('content-type') || '').includes('application/json')
  let displayName = ''
  let email = ''
  let password = ''
  let certifyingBody = 'TRA'
  let level = 0
  let certNumber = ''
  let redirectUrl = '/'

  if (isJson) {
    const json = await c.req.json().catch(() => ({}))
    displayName = typeof json.displayName === 'string' ? json.displayName.trim() : ''
    email = typeof json.email === 'string' ? json.email.trim().toLowerCase() : ''
    password = typeof json.password === 'string' ? json.password : ''
    certifyingBody = json.certifyingBody === 'NAR' ? 'NAR' : 'TRA'
    level = Number(json.level || 0)
    certNumber = typeof json.certNumber === 'string' ? json.certNumber.trim() : ''
    redirectUrl = typeof json.redirect === 'string' ? json.redirect : '/'
  } else {
    const body = await c.req.parseBody()
    displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    password = typeof body.password === 'string' ? body.password : ''
    certifyingBody = body.certifyingBody === 'NAR' ? 'NAR' : 'TRA'
    level = Number(body.level || 0)
    certNumber = typeof body.certNumber === 'string' ? body.certNumber.trim() : ''
    redirectUrl = typeof body.redirect === 'string' && body.redirect ? body.redirect : '/'
  }

  if (!displayName || !email || !password) {
    const err = 'Name, email, and password are required'
    if (isJson) return c.json({ error: err }, 400)
    return c.redirect(`/register?error=${encodeURIComponent(err)}&redirect=${encodeURIComponent(redirectUrl)}`, 302)
  }

  if (password.length < 6) {
    const err = 'Password must be at least 6 characters'
    if (isJson) return c.json({ error: err }, 400)
    return c.redirect(`/register?error=${encodeURIComponent(err)}&redirect=${encodeURIComponent(redirectUrl)}`, 302)
  }

  const db = drizzle(c.env.DB, { schema })

  // Check if email is already taken
  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1)

  if (existing) {
    const err = 'A flyer account with this email already exists'
    if (isJson) return c.json({ error: err }, 400)
    return c.redirect(`/register?error=${encodeURIComponent(err)}&redirect=${encodeURIComponent(redirectUrl)}`, 302)
  }

  const passwordHash = await hashPassword(password)

  const [newUser] = await db
    .insert(schema.users)
    .values({
      email,
      displayName,
      passwordHash,
      isActive: true,
    })
    .returning()

  // Add certification record if level > 0 or certNumber provided
  if (level > 0 || certNumber) {
    const validLevel = [1, 2, 3].includes(level) ? (level as 1 | 2 | 3) : 1
    await db.insert(schema.certifications).values({
      userId: newUser.id,
      certifyingBody: certifyingBody as 'TRA' | 'NAR',
      level: validLevel,
      certNumber: certNumber || `TRA-AU-${Math.floor(10000 + Math.random() * 90000)}`,
      expiresOn: '2028-12-31',
    })
  }

  const token = await signSession(newUser.id, c.env.AUTH_SECRET)
  const cookie = createSessionCookie(token)

  if (isJson) {
    return c.json({ status: 'created', userId: newUser.id, email: newUser.email }, 201, {
      'Set-Cookie': cookie,
    })
  }

  c.header('Set-Cookie', cookie)
  return c.redirect(redirectUrl.startsWith('/') ? redirectUrl : '/', 302)
})

/**
 * GET/POST /logout - Clear session and redirect to /login.
 */
const handleLogout = (c: any) => {
  const cookie = createLogoutCookie()
  if (c.req.header('accept')?.includes('application/json')) {
    return c.json({ status: 'ok', message: 'Logged out' }, 200, {
      'Set-Cookie': cookie,
    })
  }
  c.header('Set-Cookie', cookie)
  return c.redirect('/login', 302)
}

authRouter.get('/logout', handleLogout)
authRouter.post('/logout', handleLogout)

/**
 * POST /auth/switch/:id - Convenience quick-switch for authenticated flyer accounts.
 */
authRouter.post('/auth/switch/:id', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB, { schema })

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1)

  if (!user) {
    return c.redirect('/login', 302)
  }

  const token = await signSession(user.id, c.env.AUTH_SECRET)
  const cookie = createSessionCookie(token)
  const redirectUrl = c.req.query('redirect') || '/'

  c.header('Set-Cookie', cookie)
  return c.redirect(redirectUrl.startsWith('/') ? redirectUrl : '/', 302)
})
