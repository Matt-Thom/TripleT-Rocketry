/**
 * HTML response assertions and DOM content inspection helpers.
 * Validates HTTP status, Content-Type headers, page titles, navigation bars,
 * form inputs, and safety alert banners.
 */

import { expect } from 'vitest'

/**
 * Assert that a response returned the expected status code (default 200)
 * and has a Content-Type indicating text/html.
 */
export function assertHtmlResponse(res: Response, expectedStatus = 200): void {
  expect(res.status).toBe(expectedStatus)
  const contentType = res.headers.get('content-type') ?? ''
  expect(contentType).toMatch(/text\/html/i)
}

/**
 * Extract the inner text of the <title> tag from an HTML document.
 */
export function extractHtmlTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html)
  return match ? match[1].trim() : null
}

/**
 * Assert that the HTML document title contains the expected text.
 */
export function assertHtmlTitle(html: string, expectedSubtitle: string): void {
  const title = extractHtmlTitle(html)
  expect(title).not.toBeNull()
  expect(title).toContain(expectedSubtitle)
}

/**
 * Assert that the HTML contains all of the provided strings.
 */
export function assertContains(html: string, ...expectedSubstrings: string[]): void {
  for (const snippet of expectedSubstrings) {
    expect(html).toContain(snippet)
  }
}

/**
 * Assert that the HTML does NOT contain any of the provided strings.
 */
export function assertNotContains(html: string, ...forbiddenSubstrings: string[]): void {
  for (const snippet of forbiddenSubstrings) {
    expect(html).not.toContain(snippet)
  }
}

/**
 * Assert that the HTML shell contains standard navigation links
 * (Flights, Rockets, Motors, Sites, Events).
 */
export function assertNavLinksPresent(html: string): void {
  expect(html).toMatch(/href=["']\/flights["']/i)
  expect(html).toMatch(/href=["']\/rockets["']/i)
  expect(html).toMatch(/href=["']\/motors["']/i)
  expect(html).toMatch(/href=["']\/sites["']/i)
  expect(html).toMatch(/href=["']\/events["']/i)
}

/**
 * Assert that an HTML form input, select, or textarea exists with the given name.
 */
export function assertHasFormField(html: string, fieldName: string): void {
  const pattern = new RegExp(`name=["']${fieldName}["']`, 'i')
  expect(html).toMatch(pattern)
}

/**
 * Assert that an alert banner or warning banner exists in the HTML/HTMX fragment.
 */
export function assertAlertBanner(html: string, variant: 'warning' | 'error' | 'success' = 'warning'): void {
  const alertPattern = new RegExp(`(alert|banner|warning|callout|border-amber|border-yellow|bg-yellow|bg-amber)`, 'i')
  expect(html).toMatch(alertPattern)
}
