/**
 * HTML Views for Launch Sites.
 *
 * Provides responsive server-rendered HTML views for browsing launch fields,
 * inspecting site details and hosted events, and registering new launch sites
 * with GPS coordinates and FAA waiver altitude ceilings.
 */

import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { pageLayout } from './layout'
import type { launchSites, launchEvents } from '../db/schema'

export type LaunchSite = typeof launchSites.$inferSelect
export type LaunchEvent = typeof launchEvents.$inferSelect

/**
 * Format altitude ceiling display in meters AGL and feet.
 */
function formatCeiling(maxAltitudeAglM: number | null | undefined) {
  if (maxAltitudeAglM == null) {
    return html`<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">No waiver ceiling</span>`
  }
  const feet = Math.round(maxAltitudeAglM * 3.28084).toLocaleString()
  const meters = maxAltitudeAglM.toLocaleString()
  return html`<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-700/60 shadow-sm" title="FAA Waiver Ceiling">
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
 * List of launch fields showing name, GPS coordinates, waiver altitude ceiling badge,
 * notes, and "+ Add Launch Site" button.
 */
export function sitesListView(sites: LaunchSite[]): HtmlEscapedString | Promise<HtmlEscapedString> {
  const content = html`
    <div class="space-y-6">
      <!-- Header with Action -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-800">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>📍</span> Launch Sites & Fields
          </h1>
          <p class="text-sm text-slate-400 mt-1">
            Registered launch facilities, GPS coordinates, and FAA waiver altitude ceilings.
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
                No launch fields have been added yet. Register your club field or launch site to set waiver ceilings and schedule events.
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
                      </div>

                      <div class="mt-2.5">
                        ${formatCeiling(site.maxAltitudeAglM)}
                      </div>

                      <div class="mt-3">
                        ${formatCoordinates(site.latitude, site.longitude)}
                      </div>

                      ${site.notes
                        ? html`
                            <p class="text-xs text-slate-400 mt-3 line-clamp-3 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
                              ${site.notes}
                            </p>
                          `
                        : ''}
                    </div>

                    <div class="mt-5 pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
                      <span class="text-slate-500">Site ID: <span class="font-mono">${site.id.slice(0, 8)}</span></span>
                      <a
                        href="/sites/${site.id}"
                        class="text-brand-400 hover:text-brand-300 font-medium inline-flex items-center gap-1 transition-colors"
                      >
                        View Details & Events &rarr;
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
  })
}

/**
 * Detail view for launch site showing coordinates, ceiling, notes, and associated launch events.
 */
export function siteDetailView(
  site: LaunchSite,
  events: LaunchEvent[]
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const content = html`
    <div class="space-y-6">
      <!-- Breadcrumb Navigation -->
      <nav class="flex items-center gap-2 text-xs text-slate-400">
        <a href="/sites" class="hover:text-white transition-colors">&larr; Back to Launch Sites</a>
        <span>/</span>
        <span class="text-slate-200 font-medium">${site.name}</span>
      </nav>

      <!-- Site Header Card -->
      <div class="bg-slate-850 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h1 class="text-2xl font-extrabold text-white">${site.name}</h1>
              ${formatCeiling(site.maxAltitudeAglM)}
            </div>
            <div class="mt-3">
              ${formatCoordinates(site.latitude, site.longitude)}
            </div>
          </div>

          <div class="flex items-center gap-2">
            <a
              href="/events/new?launch_site_id=${site.id}"
              class="inline-flex items-center gap-1 px-3.5 py-1.5 bg-brand-500 hover:bg-brand-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors shadow-sm"
            >
              + Schedule Event at Site
            </a>
          </div>
        </div>

        ${site.notes
          ? html`
              <div class="mt-6 pt-5 border-t border-slate-800">
                <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Site Notes & Operations Guidelines
                </h3>
                <div class="bg-slate-900/80 rounded-lg p-4 text-sm text-slate-200 whitespace-pre-line border border-slate-800">
                  ${site.notes}
                </div>
              </div>
            `
          : ''}
      </div>

      <!-- Hosted Launch Events Section -->
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
  })
}

/**
 * Form to create new launch site (name, latitude, longitude, max_altitude_agl_m, notes).
 */
export function newSiteFormView(): HtmlEscapedString | Promise<HtmlEscapedString> {
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
            Specify launch field details, GPS coordinates, and FAA waiver ceiling for safety soft-gate checks.
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
              placeholder="e.g. Black Rock Playa, NV or Argonia Rocket Pasture"
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
                placeholder="e.g. 40.8638"
                class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm font-mono"
              />
              <p class="text-xs text-slate-500 mt-1">Positive for North, negative for South</p>
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
                placeholder="e.g. -119.1245"
                class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm font-mono"
              />
              <p class="text-xs text-slate-500 mt-1">Positive for East, negative for West</p>
            </div>
          </div>

          <!-- Waiver Ceiling -->
          <div>
            <label for="max_altitude_agl_m" class="block text-sm font-semibold text-slate-200 mb-1">
              Waiver Altitude Ceiling (Meters AGL)
            </label>
            <input
              type="number"
              step="any"
              id="max_altitude_agl_m"
              name="max_altitude_agl_m"
              placeholder="e.g. 30000"
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm font-mono"
            />
            <p class="text-xs text-slate-400 mt-1">
              Maximum altitude Above Ground Level (AGL) permitted by the FAA waiver. Used by the preflight Soft-Gates engine.
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
              placeholder="Range safety regulations, landowner access agreements, recovery conditions, emergency contacts, gate combination..."
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
  })
}
