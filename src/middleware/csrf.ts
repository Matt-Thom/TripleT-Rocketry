/**
 * Cross-Site Request Forgery (CSRF) defense middleware (BL-07).
 * Verifies Origin and Referer headers on unsafe HTTP methods against the target request origin.
 */

import type { Context, Next } from 'hono'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH'])

export async function csrfMiddleware(c: Context, next: Next) {
  if (!UNSAFE_METHODS.has(c.req.method.toUpperCase())) {
    await next()
    return
  }

  const targetUrl = new URL(c.req.url)
  const targetOrigin = targetUrl.origin

  const originHeader = c.req.header('origin')
  const refererHeader = c.req.header('referer') || c.req.header('referrer')

  if (originHeader) {
    try {
      const sourceOrigin = new URL(originHeader).origin
      if (sourceOrigin !== targetOrigin) {
        const acceptsHtml = c.req.header('accept')?.includes('text/html')
        if (acceptsHtml) {
          return c.text('403 Forbidden: Cross-site request rejected (CSRF protection)', 403)
        }
        return c.json({ error: 'Forbidden', message: 'Cross-site request rejected' }, 403)
      }
    } catch {
      return c.json({ error: 'Forbidden', message: 'Invalid Origin header' }, 403)
    }
  } else if (refererHeader) {
    try {
      const sourceOrigin = new URL(refererHeader).origin
      if (sourceOrigin !== targetOrigin) {
        const acceptsHtml = c.req.header('accept')?.includes('text/html')
        if (acceptsHtml) {
          return c.text('403 Forbidden: Cross-site request rejected (CSRF protection)', 403)
        }
        return c.json({ error: 'Forbidden', message: 'Cross-site request rejected' }, 403)
      }
    } catch {
      return c.json({ error: 'Forbidden', message: 'Invalid Referer header' }, 403)
    }
  }

  await next()
}
