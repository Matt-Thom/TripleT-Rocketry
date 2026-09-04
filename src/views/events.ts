/**
 * HTML Views for Launch Events / Meets.
 *
 * Provides responsive server-rendered HTML views for browsing launch meets,
 * displaying host site information, designated RSO/LCO officers, pad counts,
 * weather observations, and logged flight telemetry.
 */

import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { pageLayout } from './layout'
import type { launchEvents, launchSites, flights } from '../db/schema'

export type LaunchEvent = typeof launchEvents.$inferSelect
export type LaunchSite = typeof launchSites.$inferSelect
export type Flight = typeof flights.$inferSelect

export interface EventWithSite extends LaunchEvent {
  site?: LaunchSite | null
  siteName?: string | null
  rsoName?: string | null
  lcoName?: string | null
}

/**
 * Format date range display (starts_on to ends_on).
 */
function formatDateRange(startsOn: string | null | undefined, endsOn: string | null | undefined) {
  if (!startsOn && !endsOn) {
    return html`<span class="text-xs text-slate-500 italic">Date TBD</span>`
  }
  if (startsOn && endsOn && startsOn !== endsOn) {
    return html`<span class="font-medium text-slate-200">${startsOn} &rarr; ${endsOn}</span>`
  }
  return html`<span class="font-medium text-slate-200">${startsOn || endsOn}</span>`
}

/**
 * Format flight outcome badge with color coding.
 */
function formatOutcomeBadge(outcome: string | null | undefined) {
  if (!outcome) {
    return html`<span class="px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-400">Unrecorded</span>`
  }
  switch (outcome) {
    case 'successful':
      return html`<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-700/60">Successful</span>`
    case 'cato':
      return html`<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-950 text-red-300 border border-red-700/60">CATO</span>`
    case 'recovery_failure':
      return html`<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950 text-amber-300 border border-amber-700/60">Recovery Failure</span>`
    case 'separation':
      return html`<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950 text-amber-300 border border-amber-700/60">Early Separation</span>`
    case 'lost':
    case 'tree':
    case 'powerline':
      return html`<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-950 text-rose-300 border border-rose-700/60">${outcome}</span>`
    default:
      return html`<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">${outcome}</span>`
  }
}

/**
 * List of launch meets/events showing event name, host launch site,
 * date range (starts_on to ends_on), designated RSO and LCO, pad count,
 * weather notes, and "+ Add Launch Event" button.
 */
export function eventsListView(
  events: (EventWithSite | any)[]
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const content = html`
    <div class="space-y-6">
      <!-- Header with Action -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-800">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>📅</span> Launch Events & Meets
          </h1>
          <p class="text-sm text-slate-400 mt-1">
            Organized club launches, range operations, safety officers, and flight records.
          </p>
        </div>
        <a
          href="/events/new"
          class="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-brand-500 hover:bg-brand-400 text-slate-950 font-semibold text-sm rounded-lg transition-colors shadow-sm self-start sm:self-auto"
        >
          <span class="text-base leading-none font-bold">+</span>
          <span>Add Launch Event</span>
        </a>
      </div>

      <!-- Events List / Cards -->
      ${events.length === 0
        ? html`
            <div class="bg-slate-850 border border-slate-800 rounded-xl p-12 text-center">
              <div class="text-4xl mb-3">📅</div>
              <h3 class="text-lg font-semibold text-white">No Launch Events Scheduled</h3>
              <p class="text-sm text-slate-400 mt-1 max-w-md mx-auto">
                No launch meets or events have been created yet. Schedule your next launch window to assign officers and record flights.
              </p>
              <div class="mt-6">
                <a
                  href="/events/new"
                  class="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-500 hover:bg-brand-400 text-slate-950 font-semibold text-sm rounded-lg transition-colors shadow-sm"
                >
                  + Add Launch Event
                </a>
              </div>
            </div>
          `
        : html`
            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
              ${events.map((item) => {
                // Support both flat join and nested event object
                const evt: LaunchEvent = item.event ?? item
                const siteName =
                  item.site?.name ??
                  item.launchSite?.name ??
                  item.siteName ??
                  (item.site && typeof item.site === 'object' ? item.site.name : null) ??
                  'Launch Site'
                const siteId = item.site?.id ?? item.launchSiteId ?? evt.launchSiteId
                const rso = item.rsoName ?? evt.rsoUserId
                const lco = item.lcoName ?? evt.lcoUserId

                return html`
                  <div class="bg-slate-850 border border-slate-800 hover:border-slate-700 rounded-xl p-5 flex flex-col justify-between transition-all shadow-sm">
                    <div>
                      <!-- Title & Pad Count -->
                      <div class="flex items-start justify-between gap-3">
                        <h2 class="text-lg font-bold text-white hover:text-brand-400 transition-colors">
                          <a href="/events/${evt.id}">${evt.name}</a>
                        </h2>
                        ${evt.padCount != null
                          ? html`<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-800 text-brand-300 border border-slate-700 whitespace-nowrap">
                              ${evt.padCount} Pads
                            </span>`
                          : ''}
                      </div>

                      <!-- Host Launch Site -->
                      <div class="mt-2.5 flex items-center gap-1.5 text-xs">
                        <span class="text-slate-400">📍 Host Field:</span>
                        ${siteId
                          ? html`<a href="/sites/${siteId}" class="font-medium text-brand-400 hover:text-brand-300 underline">${siteName}</a>`
                          : html`<span class="text-slate-300">${siteName}</span>`}
                      </div>

                      <!-- Dates -->
                      <div class="mt-2 flex items-center gap-1.5 text-xs text-slate-300">
                        <span class="text-slate-400">🗓️ Date Range:</span>
                        ${formatDateRange(evt.startsOn, evt.endsOn)}
                      </div>

                      <!-- Safety Officers -->
                      <div class="mt-3 pt-2.5 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span class="text-slate-500 block text-[11px] uppercase tracking-wider font-semibold">RSO</span>
                          <span class="text-slate-300 font-medium">${rso || 'None designated'}</span>
                        </div>
                        <div>
                          <span class="text-slate-500 block text-[11px] uppercase tracking-wider font-semibold">LCO</span>
                          <span class="text-slate-300 font-medium">${lco || 'None designated'}</span>
                        </div>
                      </div>

                      <!-- Weather Notes -->
                      ${evt.weatherNotes
                        ? html`
                            <div class="mt-3 text-xs text-slate-400 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
                              <span class="text-slate-300 font-medium">⛅ Weather Notes:</span>
                              <p class="mt-0.5 line-clamp-2">${evt.weatherNotes}</p>
                            </div>
                          `
                        : ''}
                    </div>

                    <!-- Footer Link -->
                    <div class="mt-5 pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
                      <span class="text-slate-500">ID: <span class="font-mono">${evt.id.slice(0, 8)}</span></span>
                      <a
                        href="/events/${evt.id}"
                        class="text-brand-400 hover:text-brand-300 font-medium inline-flex items-center gap-1 transition-colors"
                      >
                        View Event Log &rarr;
                      </a>
                    </div>
                  </div>
                `
              })}
            </div>
          `}
    </div>
  `

  return pageLayout({
    title: 'Launch Events',
    activeTab: 'events',
    content,
  })
}

/**
 * Detail view showing event officers, site info, weather notes, and flights logged during event.
 */
export function eventDetailView(
  event: EventWithSite,
  site: LaunchSite | null,
  flightsList: Flight[]
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const rso = event.rsoName ?? event.rsoUserId
  const lco = event.lcoName ?? event.lcoUserId

  const content = html`
    <div class="space-y-6">
      <!-- Breadcrumb Navigation -->
      <nav class="flex items-center gap-2 text-xs text-slate-400">
        <a href="/events" class="hover:text-white transition-colors">&larr; Back to Launch Events</a>
        <span>/</span>
        <span class="text-slate-200 font-medium">${event.name}</span>
      </nav>

      <!-- Event Header Card -->
      <div class="bg-slate-850 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <div class="flex items-center gap-2.5 flex-wrap">
              <h1 class="text-2xl font-extrabold text-white">${event.name}</h1>
              ${event.padCount != null
                ? html`<span class="px-2.5 py-0.5 bg-slate-800 text-brand-300 text-xs rounded-full font-semibold border border-slate-700">
                    ${event.padCount} Launch Pads
                  </span>`
                : ''}
            </div>

            <div class="mt-2.5 flex items-center gap-2 text-xs text-slate-300 flex-wrap">
              <span class="text-slate-400">🗓️ Window:</span>
              ${formatDateRange(event.startsOn, event.endsOn)}
            </div>
          </div>

          <div class="flex items-center gap-2">
            <a
              href="/flights/new?launch_event_id=${event.id}${site ? `&launch_site_id=${site.id}` : ''}"
              class="inline-flex items-center gap-1 px-4 py-2 bg-brand-500 hover:bg-brand-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors shadow-sm"
            >
              + Log Flight at Event
            </a>
          </div>
        </div>

        <!-- Operations & Site Grid -->
        <div class="mt-6 pt-5 border-t border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- Host Site Info -->
          <div class="bg-slate-900/70 p-3.5 rounded-lg border border-slate-800">
            <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Host Launch Site</h3>
            ${site
              ? html`
                  <div class="text-sm font-bold text-white">
                    <a href="/sites/${site.id}" class="text-brand-400 hover:text-brand-300 underline">${site.name}</a>
                  </div>
                  ${site.maxAltitudeAglM != null
                    ? html`<div class="text-xs text-emerald-400 mt-1 font-medium">Ceiling: ${site.maxAltitudeAglM.toLocaleString()} m AGL</div>`
                    : html`<div class="text-xs text-slate-400 mt-1">No waiver ceiling recorded</div>`}
                  ${site.latitude != null && site.longitude != null
                    ? html`<div class="text-xs text-slate-400 mt-1 font-mono">${site.latitude.toFixed(4)}°, ${site.longitude.toFixed(4)}°</div>`
                    : ''}
                `
              : html`<div class="text-sm text-slate-400">Site details unlinked</div>`}
          </div>

          <!-- Range Officers -->
          <div class="bg-slate-900/70 p-3.5 rounded-lg border border-slate-800">
            <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Range Safety Officers</h3>
            <div class="space-y-1.5 text-xs">
              <div class="flex justify-between">
                <span class="text-slate-400">RSO:</span>
                <span class="text-slate-200 font-medium">${rso || 'None designated'}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-400">LCO:</span>
                <span class="text-slate-200 font-medium">${lco || 'None designated'}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-400">Range Pads:</span>
                <span class="text-slate-200 font-medium">${event.padCount ?? 'Not specified'}</span>
              </div>
            </div>
          </div>

          <!-- Weather Observations -->
          <div class="bg-slate-900/70 p-3.5 rounded-lg border border-slate-800">
            <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Weather Observations</h3>
            ${event.weatherNotes
              ? html`<p class="text-xs text-slate-200 whitespace-pre-line">${event.weatherNotes}</p>`
              : html`<p class="text-xs text-slate-500 italic">No weather conditions recorded for this event.</p>`}
          </div>
        </div>
      </div>

      <!-- Flights Logged Section -->
      <div class="space-y-4">
        <div class="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <h2 class="text-lg font-bold text-white flex items-center gap-2">
              <span>🚀</span> Event Flight Log
            </h2>
            <p class="text-xs text-slate-400 mt-0.5">
              ${flightsList.length} flight(s) logged during this meet
            </p>
          </div>
          <a
            href="/flights/new?launch_event_id=${event.id}${site ? `&launch_site_id=${site.id}` : ''}"
            class="text-xs text-brand-400 hover:text-brand-300 font-medium inline-flex items-center gap-1"
          >
            + Log Flight &rarr;
          </a>
        </div>

        ${flightsList.length === 0
          ? html`
              <div class="bg-slate-850/60 border border-slate-800 rounded-xl p-8 text-center">
                <div class="text-3xl mb-2">🚀</div>
                <p class="text-sm text-slate-400">
                  No flights have been recorded for this launch event yet.
                </p>
                <div class="mt-4">
                  <a
                    href="/flights/new?launch_event_id=${event.id}${site ? `&launch_site_id=${site.id}` : ''}"
                    class="inline-flex items-center gap-1 px-4 py-2 bg-brand-500 hover:bg-brand-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors shadow-sm"
                  >
                    Log First Flight
                  </a>
                </div>
              </div>
            `
          : html`
              <div class="bg-slate-850 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
                <div class="overflow-x-auto">
                  <table class="min-w-full divide-y divide-slate-800 text-left text-xs">
                    <thead class="bg-slate-900 text-slate-400 uppercase tracking-wider font-semibold">
                      <tr>
                        <th scope="col" class="py-3 px-4">Flight #</th>
                        <th scope="col" class="py-3 px-4">Date / Time</th>
                        <th scope="col" class="py-3 px-4">Altitude AGL</th>
                        <th scope="col" class="py-3 px-4">Max Velocity</th>
                        <th scope="col" class="py-3 px-4">Outcome</th>
                        <th scope="col" class="py-3 px-4">Safety Status</th>
                        <th scope="col" class="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-800 text-slate-200">
                      ${flightsList.map(
                        (f) => html`
                          <tr class="hover:bg-slate-800/50 transition-colors">
                            <td class="py-3 px-4 font-mono font-bold text-white">
                              #${f.flightNumber ?? f.id.slice(0, 8)}
                            </td>
                            <td class="py-3 px-4 text-slate-300">
                              ${f.flownAt ? new Date(f.flownAt).toLocaleDateString() : '—'}
                            </td>
                            <td class="py-3 px-4 font-mono text-emerald-400 font-semibold">
                              ${f.altitudeAglM != null ? `${f.altitudeAglM.toLocaleString()} m` : '—'}
                            </td>
                            <td class="py-3 px-4 font-mono text-slate-300">
                              ${f.maxVelocityMps != null ? `${f.maxVelocityMps.toFixed(1)} m/s` : '—'}
                            </td>
                            <td class="py-3 px-4">
                              ${formatOutcomeBadge(f.outcome)}
                            </td>
                            <td class="py-3 px-4">
                              ${f.proceededDespiteWarnings || (f.softGateWarnings && f.softGateWarnings.length > 0)
                                ? html`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950 text-amber-300 border border-amber-700/60" title="${(f.softGateWarnings || []).join('; ')}">
                                    ⚠️ Soft-Gate Override
                                  </span>`
                                : html`<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium text-emerald-400 bg-emerald-950/40">Clean</span>`}
                            </td>
                            <td class="py-3 px-4 text-right">
                              <a
                                href="/flights/${f.id}"
                                class="text-brand-400 hover:text-brand-300 font-medium"
                              >
                                Details &rarr;
                              </a>
                            </td>
                          </tr>
                        `
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            `}
      </div>
    </div>
  `

  return pageLayout({
    title: `${event.name} — Launch Event`,
    activeTab: 'events',
    content,
  })
}

/**
 * Form to create new launch event, selecting host launch site from dropdown, dates, pad count, weather notes.
 */
export function newEventFormView(
  sites: LaunchSite[],
  selectedSiteId?: string | null
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const content = html`
    <div class="max-w-2xl mx-auto space-y-6">
      <!-- Breadcrumb -->
      <nav class="flex items-center gap-2 text-xs text-slate-400">
        <a href="/events" class="hover:text-white transition-colors">&larr; Back to Launch Events</a>
        <span>/</span>
        <span class="text-slate-200 font-medium">New Event</span>
      </nav>

      <!-- Form Container Card -->
      <div class="bg-slate-850 border border-slate-800 rounded-xl p-6 sm:p-8 shadow-sm">
        <div class="mb-6 pb-4 border-b border-slate-800">
          <h1 class="text-xl font-bold text-white flex items-center gap-2">
            <span>📅</span> Schedule Launch Event
          </h1>
          <p class="text-sm text-slate-400 mt-1">
            Organize a launch meet, select an approved launch field, and assign range officers.
          </p>
        </div>

        <form action="/events" method="POST" class="space-y-5">
          <!-- Event Name -->
          <div>
            <label for="name" class="block text-sm font-semibold text-slate-200 mb-1">
              Event / Meet Name <span class="text-brand-400">*</span>
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              placeholder="e.g. Spring High-Power Launch Meet 2026"
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
            />
          </div>

          <!-- Host Launch Site Selection -->
          <div>
            <label for="launch_site_id" class="block text-sm font-semibold text-slate-200 mb-1">
              Host Launch Site <span class="text-brand-400">*</span>
            </label>
            ${sites.length === 0
              ? html`
                  <div class="bg-amber-950/40 border border-amber-700/60 rounded-lg p-3 text-xs text-amber-200">
                    No launch sites exist yet. You must
                    <a href="/sites/new" class="font-bold underline text-brand-400">register a launch site</a>
                    before scheduling an event.
                  </div>
                `
              : html`
                  <select
                    id="launch_site_id"
                    name="launch_site_id"
                    required
                    class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
                  >
                    <option value="">-- Select Host Launch Site --</option>
                    ${sites.map(
                      (s) => html`
                        <option value="${s.id}" ${selectedSiteId === s.id ? 'selected' : ''}>
                          ${s.name} ${s.maxAltitudeAglM ? `(Ceiling: ${s.maxAltitudeAglM}m AGL)` : ''}
                        </option>
                      `
                    )}
                  </select>
                `}
            <p class="text-xs text-slate-500 mt-1">
              Need a different field? <a href="/sites/new" class="text-brand-400 hover:text-brand-300 underline">+ Add new launch site</a>
            </p>
          </div>

          <!-- Date Range Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label for="starts_on" class="block text-sm font-semibold text-slate-200 mb-1">
                Starts On (YYYY-MM-DD)
              </label>
              <input
                type="date"
                id="starts_on"
                name="starts_on"
                class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
              />
            </div>

            <div>
              <label for="ends_on" class="block text-sm font-semibold text-slate-200 mb-1">
                Ends On (YYYY-MM-DD)
              </label>
              <input
                type="date"
                id="ends_on"
                name="ends_on"
                class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
              />
            </div>
          </div>

          <!-- Pad Count -->
          <div>
            <label for="pad_count" class="block text-sm font-semibold text-slate-200 mb-1">
              Number of Launch Pads
            </label>
            <input
              type="number"
              id="pad_count"
              name="pad_count"
              min="1"
              max="100"
              placeholder="e.g. 12"
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm font-mono"
            />
            <p class="text-xs text-slate-500 mt-1">Number of active high-power or low-power pads deployed on the range.</p>
          </div>

          <!-- Safety Officers Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label for="rso_user_id" class="block text-sm font-semibold text-slate-200 mb-1">
                Range Safety Officer (RSO User ID)
              </label>
              <input
                type="text"
                id="rso_user_id"
                name="rso_user_id"
                placeholder="Optional User UUID"
                class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm font-mono"
              />
            </div>

            <div>
              <label for="lco_user_id" class="block text-sm font-semibold text-slate-200 mb-1">
                Launch Control Officer (LCO User ID)
              </label>
              <input
                type="text"
                id="lco_user_id"
                name="lco_user_id"
                placeholder="Optional User UUID"
                class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm font-mono"
              />
            </div>
          </div>

          <!-- Weather Notes -->
          <div>
            <label for="weather_notes" class="block text-sm font-semibold text-slate-200 mb-1">
              Weather Notes & Range Forecast
            </label>
            <textarea
              id="weather_notes"
              name="weather_notes"
              rows="3"
              placeholder="Forecasted wind velocity, cloud ceiling, temperature, ground conditions..."
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
            ></textarea>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            <a
              href="/events"
              class="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700"
            >
              Cancel
            </a>
            <button
              type="submit"
              class="px-5 py-2 text-sm font-semibold text-slate-950 bg-brand-500 hover:bg-brand-400 rounded-lg transition-colors shadow-sm cursor-pointer"
            >
              Create Launch Event
            </button>
          </div>
        </form>
      </div>
    </div>
  `

  return pageLayout({
    title: 'Schedule Launch Event',
    activeTab: 'events',
    content,
  })
}
