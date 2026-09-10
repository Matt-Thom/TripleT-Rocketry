/**
 * HTTP request dispatch helpers for Cloudflare Worker integration testing.
 * Uses `SELF.fetch` inside the workerd isolate to test standard HTTP GET/POST,
 * URL-encoded form submissions, and HTMX partial requests.
 */

import { SELF } from 'cloudflare:test'

const BASE_URL = 'https://example.com'

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
  return await SELF.fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...headers,
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
  const body = encodeFormData(data)
  return await SELF.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body,
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
