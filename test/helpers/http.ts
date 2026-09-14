/**
 * HTTP request dispatch helpers for Cloudflare Worker integration testing.
 * Uses `SELF.fetch` inside the workerd isolate to test standard HTTP GET/POST,
 * URL-encoded form submissions, and HTMX partial requests.
 */

import { SELF, env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../../src/db/schema'
import { getActiveFlyer } from '../../src/db/context'

const BASE_URL = 'https://example.com'

const PUBLIC_OR_ADMIN_PREFIXES = [
  '/login',
  '/register',
  '/setup',
  '/health',
  '/ready',
  '/logout',
  '/signout',
  '/sign-out',
  '/auth/webauthn/login',
  '/admin', // Keep /admin unauthenticated by default so unauthenticated admin checks pass
]

function isPublicOrAdminPath(path: string): boolean {
  for (const prefix of PUBLIC_OR_ADMIN_PREFIXES) {
    if (path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?')) {
      return true
    }
  }
  return false
}

/**
 * Check if the caller provided any explicit auth-related headers or unauthenticated flags.
 */
function hasAuthHeaders(headers: Record<string, string>): boolean {
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase()
    if (
      lower === 'cookie' ||
      lower === 'authorization' ||
      lower.startsWith('x-flyer-') ||
      lower === 'x-no-auth'
    ) {
      return true
    }
  }
  return false
}

/**
 * Resolve default test authentication headers so existing domain integration tests
 * run authenticated without relying on application-level cookieless fallbacks.
 */
async function resolveTestAuthHeaders(
  path: string,
  headers: Record<string, string>,
): Promise<Record<string, string>> {
  if (hasAuthHeaders(headers) || isPublicOrAdminPath(path)) {
    return headers
  }

  if (env?.DB) {
    try {
      const db = drizzle(env.DB, { schema })
      const flyer = await getActiveFlyer(db).catch(() => null)
      if (flyer) {
        return {
          'x-flyer-id': flyer.id,
          'x-flyer-email': flyer.email,
          ...headers,
        }
      }
    } catch {
      // Fall through to default email
    }
  }

  return {
    'x-flyer-email': 'flyer@rocketry.local',
    ...headers,
  }
}

/**
 * Encode an object into an application/x-www-form-urlencoded query string.
 */
export function encodeFormData(
  data: Record<string, string | number | boolean | null | undefined>,
): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && value !== undefined) {
      params.append(key, String(value))
    }
  }
  return params.toString()
}

/**
 * Dispatch a standard HTTP GET request via SELF.fetch.
 */
export async function fetchGet(
  path: string,
  headers: Record<string, string> = {},
  options: { redirect?: 'follow' | 'error' | 'manual' } = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`
  const authHeaders = await resolveTestAuthHeaders(path, headers)
  return await SELF.fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...authHeaders,
    },
    ...options,
  })
}

/**
 * Dispatch an HTTP POST form request with URL-encoded body.
 */
export async function fetchPostForm(
  path: string,
  data: Record<string, string | number | boolean | null | undefined>,
  headers: Record<string, string> = {},
  options: { redirect?: 'follow' | 'error' | 'manual' } = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`
  const authHeaders = await resolveTestAuthHeaders(path, headers)
  const body = encodeFormData(data)
  return await SELF.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...authHeaders,
    },
    body,
    ...options,
  })
}

/**
 * Dispatch a JSON GET request via SELF.fetch.
 */
export async function fetchJson(
  path: string,
  headers: Record<string, string> = {},
  options: { redirect?: 'follow' | 'error' | 'manual' } = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`
  const authHeaders = await resolveTestAuthHeaders(path, headers)
  return await SELF.fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...authHeaders,
    },
    ...options,
  })
}

/**
 * Dispatch an HTTP POST request with JSON body.
 */
export async function fetchPostJson(
  path: string,
  data: unknown,
  headers: Record<string, string> = {},
  options: { redirect?: 'follow' | 'error' | 'manual' } = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`
  const authHeaders = await resolveTestAuthHeaders(path, headers)
  return await SELF.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify(data),
    ...options,
  })
}

/**
 * Dispatch an HTTP PUT request with JSON body.
 */
export async function fetchPutJson(
  path: string,
  data: unknown,
  headers: Record<string, string> = {},
  options: { redirect?: 'follow' | 'error' | 'manual' } = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`
  const authHeaders = await resolveTestAuthHeaders(path, headers)
  return await SELF.fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify(data),
    ...options,
  })
}

/**
 * Dispatch an HTMX GET request (sets `HX-Request: true`).
 */
export async function fetchHtmxGet(
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return await fetchGet(path, {
    'HX-Request': 'true',
    ...headers,
  })
}

/**
 * Dispatch an HTMX POST request with form payload (sets `HX-Request: true`).
 */
export async function fetchHtmxPostForm(
  path: string,
  data: Record<string, string | number | boolean | null | undefined>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return await fetchPostForm(path, data, {
    'HX-Request': 'true',
    ...headers,
  })
}
