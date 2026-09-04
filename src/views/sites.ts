/**
 * HTML Views for Launch Sites.
 *
 * Provides responsive server-rendered HTML views for browsing launch fields,
 * inspecting site details and hosted events, registering new launch sites,
 * and editing existing sites with GPS coordinates and CASA airspace altitude ceilings.
 */

import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { pageLayout } from './layout'
import type { launchSites, launchEvents } from '../db/schema'
import type { ActiveFlyer } from '../db/context'

export type LaunchSite = typeof launchSites.$inferSelect
export type LaunchEvent = typeof launchEvents.$inferSelect

/**
 * Format altitude ceiling display in meters AGL and feet.
 */
function formatCeiling(maxAltitudeAglM: number | null | undefined) {
  if (maxAltitudeAglM == null) {
    return html`<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">No airspace ceiling</span>`
  }
  const feet = Math.round(maxAltitudeAglM * 3.28084).toLocaleString()
  const meters = maxAltitudeAglM.toLocaleString()
  return html`<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-700/60 shadow-sm" title="CASA Airspace Ceiling">
    Ceiling: ${meters} m AGL (${feet} ft)
  </span>`
}

/**
 * Format GPS coordinates string with cardinal directions.
 */
function formatCoordinates(lat: number | null | undefined, lon: number | null | undefined) {
  if (lat == null || lon == null) {
    return html`<span class="text-xs text-slate-500 italic">Coordinates unlisted</span>`
  }
  const latStr = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`
  const lonStr = `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`
  const mapUrl = `https://www.google.com/maps?q=${lat},${lon}`
  return html`<div class="flex items-center gap-1.5 text-xs">
    <span class="text-slate-400">📍</span>
    <span class="font-mono text-slate-200">${latStr}, ${lonStr}</span>
    <a href="${mapUrl}" target="_blank" rel="noopener noreferrer" class="text-brand-400 hover:text-brand-300 text-xs ml-1 underline" title="View in Google Maps">Map</a>
  </div>`
}

/**
 * List of launch fields showing name, GPS coordinates, CASA airspace ceiling badge,
 * notes, and action buttons.
 */
export function sitesListView(sites: LaunchSite[], user?: ActiveFlyer | null): HtmlEscapedString | Promise<HtmlEscapedString> {
  const content = html`
    <div class="space-y-6">
      <!-- Header with Action -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-800">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>📍</span> Launch Sites & Fields
          </h1>
          <p class="text-sm text-slate-400 mt-1">
            Registered launch facilities, GPS coordinates, and CASA airspace approval altitude ceilings.
          </p>
        </div>
        <a
          href="/sites/new"
          class="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-brand-500 hover:bg-brand-400 text-slate-950 font-semibold text-sm rounded-lg transition-colors shadow-sm self-start sm:self-auto"
        >
          <span class="text-base leading-none font-bold">+</span>
          <span>Add Launch Site</span>
        </a>
      </div>

      <!-- Sites Grid / List -->
      ${sites.length === 0
        ? html`
            <div class="bg-slate-850 border border-slate-800 rounded-xl p-12 text-center">
              <div class="text-4xl mb-3">📍</div>
              <h3 class="text-lg font-semibold text-white">No Launch Sites Registered</h3>
              <p class="text-sm text-slate-400 mt-1 max-w-md mx-auto">
                No launch fields have been added yet. Register your club field or launch site to set CASA ceilings and schedule events.
              </p>
              <div class="mt-6">
                <a
                  href="/sites/new"
                  class="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-500 hover:bg-brand-400 text-slate-950 font-semibold text-sm rounded-lg transition-colors shadow-sm"
                >
                  + Add Launch Site
                </a>
              </div>
            </div>
          `
        : html`
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              ${sites.map(
                (site) => html`
                  <div class="bg-slate-850 border border-slate-800 hover:border-slate-700 rounded-xl p-5 flex flex-col justify-between transition-all shadow-sm">
                    <div>
                      <div class="flex items-start justify-between gap-2">
                        <h2 class="text-lg font-bold text-white hover:text-brand-400 transition-colors">
                          <a href="/sites/${site.id}">${site.name}</a>
                        </h2>
                        <a
                          href="/sites/${site.id}/edit"
                          class="text-xs text-slate-400 hover:text-brand-300 px-2 py-1 rounded bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors flex items-center gap-1"
                          title="Edit site details"
                        >
                          <span>✏️</span> Edit
                        </a>
                      </div>

                      <div class="mt-3 space-y-2">
                        <div>${formatCoordinates(site.latitude, site.longitude)}</div>
                        <div>${formatCeiling(site.maxAltitudeAglM)}</div>
                      </div>

                      ${site.notes
                        ? html`
                            <p class="text-xs text-slate-400 mt-3 line-clamp-3 bg-slate-900/50 p-2.5 rounded-lg border border-slate-800/80">
                              ${site.notes}
                            </p>
                          `
                        : ''}
                    </div>

                    <div class="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                      <a
                        href="/events/new?launch_site_id=${site.id}"
                        class="text-slate-400 hover:text-slate-200 transition-colors"
                      >
                        + Schedule Event
                      </a>
                      <a
                        href="/sites/${site.id}"
                        class="text-brand-400 hover:text-brand-300 font-semibold flex items-center gap-1"
                      >
                        View Site &rarr;
                      </a>
                    </div>
                  </div>
                `
              )}
            </div>
          `}
    </div>
  `

  return pageLayout({
    title: 'Launch Sites',
    activeTab: 'sites',
    content,
    user,
  })
}

/**
 * Detailed view for an individual launch site, showing hosted launch events.
 */
export function siteDetailView(
  site: LaunchSite,
  events: LaunchEvent[],
  user?: ActiveFlyer | null,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const content = html`
    <div class="space-y-6">
      <!-- Breadcrumb & Actions Bar -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2">
        <nav class="flex items-center gap-2 text-xs text-slate-400">
          <a href="/sites" class="hover:text-white transition-colors">&larr; Back to Launch Sites</a>
          <span>/</span>
          <span class="text-slate-200 font-medium">${site.name}</span>
        </nav>
        <div class="flex items-center gap-2.5">
          <a
            href="/sites/${site.id}/edit"
            class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors shadow-sm"
          >
            <span>✏️</span>
            <span>Edit Site</span>
          </a>
          <a
            href="/events/new?launch_site_id=${site.id}"
            class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-brand-500 hover:bg-brand-400 text-slate-950 transition-colors shadow-sm"
          >
            <span>+</span>
            <span>Log Launch Event</span>
          </a>
        </div>
      </div>

      <!-- Site Overview Card -->
      <div class="bg-slate-850 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h1 class="text-2xl font-bold text-white flex items-center gap-2">
              <span>📍</span> ${site.name}
            </h1>
            <div class="mt-2 flex flex-wrap items-center gap-4 text-sm text-slate-300">
              <div>${formatCoordinates(site.latitude, site.longitude)}</div>
              <div>${formatCeiling(site.maxAltitudeAglM)}</div>
            </div>
          </div>
        </div>

        ${site.notes
          ? html`
              <div class="mt-4">
                <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Site Information & Recovery Terrain
                </h3>
                <p class="text-sm text-slate-200 whitespace-pre-line bg-slate-900/60 p-3.5 rounded-lg border border-slate-800 leading-relaxed">
                  ${site.notes}
                </p>
              </div>
            `
          : ''}
      </div>

      <!-- Hosted Launch Events -->
      <div class="space-y-4">
        <div class="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <h2 class="text-lg font-bold text-white flex items-center gap-2">
              <span>📅</span> Hosted Launch Events
            </h2>
            <p class="text-xs text-slate-400 mt-0.5">
              ${events.length} launch meet(s) scheduled or held at ${site.name}
            </p>
          </div>
          <a
            href="/events/new?launch_site_id=${site.id}"
            class="text-xs text-brand-400 hover:text-brand-300 font-medium inline-flex items-center gap-1"
          >
            + New Event &rarr;
          </a>
        </div>

        ${events.length === 0
          ? html`
              <div class="bg-slate-850/60 border border-slate-800 rounded-xl p-8 text-center">
                <p class="text-sm text-slate-400">
                  No launch events have been hosted at this site yet.
                </p>
                <div class="mt-4">
                  <a
                    href="/events/new?launch_site_id=${site.id}"
                    class="inline-flex items-center gap-1 px-3.5 py-1.5 bg-brand-500 hover:bg-brand-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors shadow-sm"
                  >
                    Schedule First Event
                  </a>
                </div>
              </div>
            `
          : html`
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                ${events.map(
                  (evt) => html`
                    <div class="bg-slate-850 border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition-all shadow-sm">
                      <div class="flex items-start justify-between gap-2">
                        <h3 class="text-base font-bold text-white hover:text-brand-400 transition-colors">
                          <a href="/events/${evt.id}">${evt.name}</a>
                        </h3>
                        ${evt.padCount != null
                          ? html`<span class="px-2 py-0.5 bg-slate-800 text-slate-300 text-xs rounded font-medium border border-slate-700">${evt.padCount} Pads</span>`
                          : ''}
                      </div>

                      <div class="mt-2 text-xs text-slate-300 flex items-center gap-1.5">
                        <span class="text-slate-500">Dates:</span>
                        <span class="font-medium">
                          ${evt.startsOn || 'TBD'}
                          ${evt.endsOn && evt.endsOn !== evt.startsOn ? ` to ${evt.endsOn}` : ''}
                        </span>
                      </div>

                      ${evt.weatherNotes
                        ? html`
                            <p class="text-xs text-slate-400 mt-2 line-clamp-2 bg-slate-900/50 p-2 rounded border border-slate-800/80">
                              ⛅ ${evt.weatherNotes}
                            </p>
                          `
                        : ''}

                      <div class="mt-3 pt-2.5 border-t border-slate-800/80 flex justify-end">
                        <a
                          href="/events/${evt.id}"
                          class="text-brand-400 hover:text-brand-300 text-xs font-medium inline-flex items-center gap-1"
                        >
                          View Event Log &rarr;
                        </a>
                      </div>
                    </div>
                  `
                )}
              </div>
            `}
      </div>
    </div>
  `

  return pageLayout({
    title: `${site.name} — Launch Site`,
    activeTab: 'sites',
    content,
    user,
  })
}

/**
 * Form to create new launch site (name, latitude, longitude, max_altitude_agl_m, notes).
 */
export function newSiteFormView(user?: ActiveFlyer | null): HtmlEscapedString | Promise<HtmlEscapedString> {
  const content = html`
    <div class="max-w-2xl mx-auto space-y-6">
      <!-- Breadcrumb -->
      <nav class="flex items-center gap-2 text-xs text-slate-400">
        <a href="/sites" class="hover:text-white transition-colors">&larr; Back to Launch Sites</a>
        <span>/</span>
        <span class="text-slate-200 font-medium">New Site</span>
      </nav>

      <!-- Form Container Card -->
      <div class="bg-slate-850 border border-slate-800 rounded-xl p-6 sm:p-8 shadow-sm">
        <div class="mb-6 pb-4 border-b border-slate-800">
          <h1 class="text-xl font-bold text-white flex items-center gap-2">
            <span>📍</span> Register Launch Site
          </h1>
          <p class="text-sm text-slate-400 mt-1">
            Specify launch field details, GPS coordinates, and CASA airspace ceiling for safety soft-gate checks.
          </p>
        </div>

        <form action="/sites" method="POST" class="space-y-5">
          <!-- Site Name -->
          <div>
            <label for="name" class="block text-sm font-semibold text-slate-200 mb-1">
              Site / Field Name <span class="text-brand-400">*</span>
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              placeholder="e.g. Lake Hart, Woomera SA or Serpentine Field, WA"
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
            />
          </div>

          <!-- GPS Coordinates Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label for="latitude" class="block text-sm font-semibold text-slate-200 mb-1">
                Latitude (decimal degrees)
              </label>
              <input
                type="number"
                step="any"
                id="latitude"
                name="latitude"
                placeholder="e.g. -31.1540"
                class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm font-mono"
              />
              <p class="text-xs text-slate-500 mt-1">Positive for North, negative for South (Australia is negative)</p>
            </div>

            <div>
              <label for="longitude" class="block text-sm font-semibold text-slate-200 mb-1">
                Longitude (decimal degrees)
              </label>
              <input
                type="number"
                step="any"
                id="longitude"
                name="longitude"
                placeholder="e.g. 136.5280"
                class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm font-mono"
              />
              <p class="text-xs text-slate-500 mt-1">Positive for East, negative for West (Australia is positive)</p>
            </div>
          </div>

          <!-- Waiver Ceiling -->
          <div>
            <label for="max_altitude_agl_m" class="block text-sm font-semibold text-slate-200 mb-1">
              CASA Airspace Ceiling (Meters AGL)
            </label>
            <input
              type="number"
              step="any"
              id="max_altitude_agl_m"
              name="max_altitude_agl_m"
              placeholder="e.g. 15000"
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm font-mono"
            />
            <p class="text-xs text-slate-400 mt-1">
              Maximum altitude Above Ground Level (AGL) permitted by CASA airspace instrument / NOTAM. Used by the preflight Soft-Gates engine.
            </p>
          </div>

          <!-- Site Notes -->
          <div>
            <label for="notes" class="block text-sm font-semibold text-slate-200 mb-1">
              Site Notes & Recovery Terrain
            </label>
            <textarea
              id="notes"
              name="notes"
              rows="4"
              placeholder="Range safety procedures, landowner access agreements, recovery terrain conditions, emergency contacts..."
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
            ></textarea>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            <a
              href="/sites"
              class="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700"
            >
              Cancel
            </a>
            <button
              type="submit"
              class="px-5 py-2 text-sm font-semibold text-slate-950 bg-brand-500 hover:bg-brand-400 rounded-lg transition-colors shadow-sm cursor-pointer"
            >
              Create Launch Site
            </button>
          </div>
        </form>
      </div>
    </div>
  `

  return pageLayout({
    title: 'Add Launch Site',
    activeTab: 'sites',
    content,
    user,
  })
}

/**
 * Form to edit an existing launch site.
 */
export function editSiteFormView(site: LaunchSite, user?: ActiveFlyer | null): HtmlEscapedString | Promise<HtmlEscapedString> {
  const content = html`
    <div class="max-w-2xl mx-auto space-y-6">
      <!-- Breadcrumb -->
      <nav class="flex items-center gap-2 text-xs text-slate-400">
        <a href="/sites" class="hover:text-white transition-colors">&larr; Back to Launch Sites</a>
        <span>/</span>
        <a href="/sites/${site.id}" class="hover:text-white transition-colors">${site.name}</a>
        <span>/</span>
        <span class="text-slate-200 font-medium">Edit</span>
      </nav>

      <!-- Form Container Card -->
      <div class="bg-slate-850 border border-slate-800 rounded-xl p-6 sm:p-8 shadow-sm">
        <div class="mb-6 pb-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h1 class="text-xl font-bold text-white flex items-center gap-2">
              <span>✏️</span> Edit Launch Site
            </h1>
            <p class="text-sm text-slate-400 mt-1">
              Update site information, GPS coordinates, or CASA airspace ceiling limits.
            </p>
          </div>
        </div>

        <form action="/sites/${site.id}/edit" method="POST" class="space-y-5">
          <!-- Site Name -->
          <div>
            <label for="name" class="block text-sm font-semibold text-slate-200 mb-1">
              Site / Field Name <span class="text-brand-400">*</span>
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              value="${site.name}"
              placeholder="e.g. Lake Hart, Woomera SA or Serpentine Field, WA"
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
            />
          </div>

          <!-- GPS Coordinates Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label for="latitude" class="block text-sm font-semibold text-slate-200 mb-1">
                Latitude (decimal degrees)
              </label>
              <input
                type="number"
                step="any"
                id="latitude"
                name="latitude"
                value="${site.latitude != null ? String(site.latitude) : ''}"
                placeholder="e.g. -31.1540"
                class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm font-mono"
              />
              <p class="text-xs text-slate-500 mt-1">Positive for North, negative for South (Australia is negative)</p>
            </div>

            <div>
              <label for="longitude" class="block text-sm font-semibold text-slate-200 mb-1">
                Longitude (decimal degrees)
              </label>
              <input
                type="number"
                step="any"
                id="longitude"
                name="longitude"
                value="${site.longitude != null ? String(site.longitude) : ''}"
                placeholder="e.g. 136.5280"
                class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm font-mono"
              />
              <p class="text-xs text-slate-500 mt-1">Positive for East, negative for West (Australia is positive)</p>
            </div>
          </div>

          <!-- Airspace Ceiling -->
          <div>
            <label for="max_altitude_agl_m" class="block text-sm font-semibold text-slate-200 mb-1">
              CASA Airspace Ceiling (Meters AGL)
            </label>
            <input
              type="number"
              step="any"
              id="max_altitude_agl_m"
              name="max_altitude_agl_m"
              value="${site.maxAltitudeAglM != null ? String(site.maxAltitudeAglM) : ''}"
              placeholder="e.g. 15000"
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm font-mono"
            />
            <p class="text-xs text-slate-400 mt-1">
              Maximum altitude Above Ground Level (AGL) permitted by CASA airspace instrument / NOTAM. Used by the preflight Soft-Gates engine.
            </p>
          </div>

          <!-- Site Notes -->
          <div>
            <label for="notes" class="block text-sm font-semibold text-slate-200 mb-1">
              Site Notes & Recovery Terrain
            </label>
            <textarea
              id="notes"
              name="notes"
              rows="4"
              placeholder="Range safety procedures, landowner access agreements, recovery conditions, emergency contacts..."
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
            >${site.notes || ''}</textarea>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            <a
              href="/sites/${site.id}"
              class="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700"
            >
              Cancel
            </a>
            <button
              type="submit"
              class="px-5 py-2 text-sm font-semibold text-slate-950 bg-brand-500 hover:bg-brand-400 rounded-lg transition-colors shadow-sm cursor-pointer"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  `

  return pageLayout({
    title: `Edit ${site.name} — Launch Site`,
    activeTab: 'sites',
    content,
    user,
  })
}
