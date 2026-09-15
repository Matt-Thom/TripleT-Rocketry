/**
 * User Settings Routes (`src/routes/settings.ts`).
 *
 * Implements:
 * - `GET /settings`: Displays user settings view with regulatory region preferences.
 * - `POST /settings`: Updates user's regulatory region preference ('SA' | 'US') in D1.
 */

import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import type { ActiveFlyer } from '../db/context'
import type { TraceContext } from '../logging'
import { pageLayout } from '../views/layout'
import { userSettingsView } from '../views/settings'

type Bindings = {
  DB: D1Database
  ENVIRONMENT: string
  PROJECT_ID: string
}

type Variables = {
  trace: TraceContext
}

export const settingsRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>()

/**
 * Render user settings page (GET /settings).
 */
export async function getSettingsHandler(c: any) {
  const flyer = (c.get as any)('user')
  if (!flyer) {
    const acceptsHtml = c.req.header('accept')?.includes('text/html')
    if (acceptsHtml) {
      return c.redirect('/login?redirect=/settings', 302)
    }
    return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401)
  }

  const db = drizzle(c.env.DB, { schema })

  const [dbUser] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.users.role,
      regulatoryRegion: schema.users.regulatoryRegion,
    })
    .from(schema.users)
    .where(eq(schema.users.id, flyer.id))
    .limit(1)

  const user: ActiveFlyer & { regulatoryRegion?: string; role?: string } = {
    ...flyer,
    ...(dbUser || {}),
  }
  const success = c.req.query('saved') === '1'

  const content = userSettingsView({
    user,
    successMessage: success ? 'Regulatory region preference updated successfully.' : null,
  })

  const fullHtml = pageLayout({
    title: 'User Settings',
    activeTab: 'dashboard',
    content,
    user,
  })

  return c.html(fullHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
  })
}

/**
 * Handle user settings update (POST /settings).
 */
export async function postSettingsHandler(c: any) {
  const flyer = (c.get as any)('user')
  if (!flyer) {
    const acceptsHtml = c.req.header('accept')?.includes('text/html')
    if (acceptsHtml) {
      return c.redirect('/login?redirect=/settings', 302)
    }
    return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401)
  }

  const db = drizzle(c.env.DB, { schema })

  let body: any = {}
  const contentType = c.req.header('content-type') || ''
  if (contentType.includes('application/json')) {
    body = await c.req.json().catch(() => ({}))
  } else {
    body = await c.req.parseBody().catch(() => ({}))
  }

  const rawRegion = String(body.regulatory_region || body.regulatoryRegion || 'SA').trim().toUpperCase()
  const regulatoryRegion = rawRegion === 'US' ? 'US' : 'SA'

  await db
    .update(schema.users)
    .set({
      regulatoryRegion,
      updatedAt: Date.now(),
    })
    .where(eq(schema.users.id, flyer.id))

  return c.redirect('/settings?saved=1', 303)
}

settingsRouter.get('/', getSettingsHandler)
settingsRouter.get('/settings', getSettingsHandler)
settingsRouter.post('/', postSettingsHandler)
settingsRouter.post('/settings', postSettingsHandler)

export default settingsRouter
