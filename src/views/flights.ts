/**
 * Flight logbook and range companion preflight view components for TripleT-Rocketry.
 *
 * Implements Milestone 5 requirements:
 * - flightsListView: Flight logbook table & mobile cards with outcome badges and soft-gate indicators.
 * - flightDetailView: Detailed telemetry, vehicle configuration, motor metrics, launch site, and safety audit.
 * - preflightFormView: Interactive flight logging form with HTMX dynamic preflight safety triggers.
 * - preflightWarningFragment: Amber warning banner with acknowledgment checkbox or green clear confirmation.
 */

import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'

export interface FlightListItem {
  id: string
  flightNumber?: number | null
  flownAt?: number | null
  rocketName?: string | null
  configVersion?: number | null
  motorModel?: string | null
  motorMfr?: string | null
  altitudeAglM?: number | null
  maxVelocityMps?: number | null
  outcome?: string | null
  softGateWarnings?: string[] | null
  proceededDespiteWarnings?: boolean | null
  siteName?: string | null
  eventName?: string | null
}

export interface FlightDetailOptions {
  flight: {
    id: string
    flyerId: string
    rocketConfigurationId?: string | null
    motorId?: string | null
    motorInventoryId?: string | null
    launchSiteId?: string | null
    launchEventId?: string | null
    flightNumber?: number | null
    flownAt?: number | null
    altitudeAglM?: number | null
    altitudeMslM?: number | null
    maxVelocityMps?: number | null
    maxAccelG?: number | null
    windMps?: number | null
    windDirDeg?: number | null
    temperatureC?: number | null
    visibilityM?: number | null
    ceilingM?: number | null
    outcome?: string | null
    notes?: string | null
    softGateWarnings?: string[] | null
    proceededDespiteWarnings?: boolean | null
    createdAt?: number | null
  }
  config?: {
    id: string
    version: number
    airframeMaterial?: string | null
    finCount?: number | null
    dryMassG?: number | null
    loadedMassG?: number | null
    ballastG?: number | null
    cgMm?: number | null
    cpMm?: number | null
    stabilityCalibers?: number | null
    recoveryType?: string | null
    parachuteSizeMm?: number | null
    motorMountDiameterMm?: number | null
  } | null
  rocket?: {
    id: string
    name: string
    status?: string | null
  } | null
  motor?: {
    id: string
    manufacturer: string
    model: string
    impulseClass?: string | null
    totalImpulseNs?: number | null
    averageThrustN?: number | null
    maxThrustN?: number | null
    burnTimeS?: number | null
    delayS?: number | null
    propellantType?: string | null
    diameterMm?: number | null
    lengthMm?: number | null
    certNumber?: string | null
    certifyingOrg?: string | null
  } | null
  site?: {
    id: string
    name: string
    latitude?: number | null
    longitude?: number | null
    maxAltitudeAglM?: number | null
    notes?: string | null
  } | null
  event?: {
    id: string
    name: string
    startsOn?: string | null
    endsOn?: string | null
    weatherNotes?: string | null
  } | null
  flyer?: {
    id: string
    displayName?: string | null
    email?: string | null
  } | null
}

export interface PreflightFormProps {
  rockets: Array<{ id: string; name: string }>
  configurations: Array<{
    id: string
    rocketId: string
    version: number
    stabilityCalibers?: number | null
    dryMassG?: number | null
    loadedMassG?: number | null
  }>
  motors: Array<{
    id: string
    manufacturer: string
    model: string
    impulseClass?: string | null
    delayS?: number | null
  }>
  inventories?: Array<{
    id: string
    motorId: string
    quantityOnHand: number
    expendedCount: number
    motorModel?: string | null
  }>
  launchSites: Array<{
    id: string
    name: string
    maxAltitudeAglM?: number | null
  }>
  launchEvents?: Array<{
    id: string
    name: string
    launchSiteId: string
  }>
  flyerCertLevel?: number
  initialValues?: Record<string, any>
  warnings?: string[]
  error?: string
}

/**
 * Renders a color-coded status badge for a flight outcome.
 */
export function renderOutcomeBadge(outcome?: string | null): HtmlEscapedString | Promise<HtmlEscapedString> {
  if (!outcome) {
    return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-slate-700/50 text-slate-300 border border-slate-600/30">Unknown</span>`
  }

  switch (outcome.toLowerCase()) {
    case 'successful':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">✓ Successful</span>`
    case 'cato':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">💥 CATO</span>`
    case 'recovery_failure':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">⚠️ Recovery Failure</span>`
    case 'separation':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">⚠️ Separation</span>`
    case 'tree':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">🌲 Tree Landing</span>`
    case 'powerline':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">⚡ Powerline</span>`
    case 'lost':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-600/30 text-slate-300 border border-slate-500/40">❓ Lost</span>`
    default:
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-700/40 text-slate-300 border border-slate-600/30">${outcome}</span>`
  }
}

/**
 * Format timestamp (ms) to human-readable date.
 */
function formatDate(epochMs?: number | null): string {
  if (!epochMs) return 'N/A'
  try {
    return new Date(epochMs).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return 'Invalid Date'
  }
}

/**
 * HTMX Dynamic Preflight Warning Fragment.
 *
 * Returned by POST /flights/preflight-check or embedded when re-rendering with errors.
 */
export function preflightWarningFragment(
  warnings: string[],
  proceeded?: boolean,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  if (warnings && warnings.length > 0) {
    return html`
      <div
        class="rounded-xl p-4 bg-amber-950/60 border border-amber-500 text-amber-200 shadow-sm transition-all"
        role="alert"
        aria-label="Preflight Safety Warnings"
      >
        <div class="flex items-start gap-3">
          <span class="text-2xl leading-none flex-shrink-0">⚠️</span>
          <div class="flex-1 space-y-2">
            <div class="flex items-center justify-between">
              <h4 class="text-sm font-bold text-amber-300 uppercase tracking-wide">
                Preflight Safety Warning${warnings.length > 1 ? 's' : ''} (${warnings.length})
              </h4>
              <span class="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded border border-amber-500/30 font-medium">
                Soft Gate Override Required
              </span>
            </div>
            <ul class="list-disc list-inside text-sm space-y-1 text-amber-200">
              ${warnings.map((w) => html`<li>${w}</li>`)}
            </ul>
            <div class="pt-3 mt-3 border-t border-amber-500/40 flex items-center gap-3">
              <input
                type="checkbox"
                name="proceeded_despite_warnings"
                value="true"
                id="proceed-warning"
                ${proceeded ? 'checked' : ''}
                class="h-4 w-4 rounded border-amber-500 text-amber-500 focus:ring-amber-400 bg-slate-900 cursor-pointer"
              />
              <label for="proceed-warning" class="text-sm font-semibold text-amber-200 cursor-pointer select-none">
                Proceed with launch despite preflight warnings
              </label>
            </div>
          </div>
        </div>
      </div>
    `
  }

  return html`
    <div
      class="rounded-xl p-4 bg-emerald-950/60 border border-emerald-500 text-emerald-200 shadow-sm transition-all"
      role="status"
      aria-label="Preflight Safety Check Passed"
    >
      <div class="flex items-center gap-3">
        <span class="text-2xl text-emerald-400 leading-none">✓</span>
        <div>
          <h4 class="text-sm font-bold text-emerald-300">All checks pass — Safe to fly</h4>
          <p class="text-xs text-emerald-200/90 mt-0.5">
            Preflight safety gates evaluated clear. Launch configuration is nominal.
          </p>
        </div>
      </div>
    </div>
  `
}

/**
 * Flight Logbook List View (GET /flights).
 */
export function flightsListView(flights: FlightListItem[]): HtmlEscapedString | Promise<HtmlEscapedString> {
  return html`
    <div class="space-y-6">
      <!-- Header with Action -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-800 gap-4">
        <div>
          <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>🚀 Flight Logbook</span>
          </h1>
          <p class="mt-1 text-sm text-slate-400">
            Recorded flight telemetry, performance logs, and preflight safety records.
          </p>
        </div>
        <div>
          <a
            href="/flights/new"
            class="inline-flex items-center px-4 py-2 text-sm font-semibold rounded-lg bg-brand-500 hover:bg-brand-400 text-slate-950 shadow-md transition-colors"
          >
            <span class="mr-1 font-bold">+</span> Log Flight
          </a>
        </div>
      </div>

      <!-- Flight Log Table / Card View -->
      ${flights.length === 0
        ? html`
          <div class="bg-slate-800/60 border border-slate-700/60 rounded-xl p-12 text-center shadow-sm">
            <span class="text-4xl mb-3 block">🚀</span>
            <h3 class="text-base font-semibold text-white">No flights logged yet</h3>
            <p class="mt-1 text-sm text-slate-400 max-w-sm mx-auto">
              Track your first rocket launch with live safety soft-gate checks, altitude records, and motor inventory tracking.
            </p>
            <div class="mt-6">
              <a
                href="/flights/new"
                class="inline-flex items-center px-4 py-2 text-sm font-semibold rounded-md shadow-sm text-slate-950 bg-brand-400 hover:bg-brand-300 transition-colors"
              >
                + Log Flight
              </a>
            </div>
          </div>
        `
        : html`
          <div class="bg-slate-800/60 border border-slate-700/60 rounded-xl overflow-hidden shadow-sm">
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-slate-700/60 text-left text-sm">
                <thead class="bg-slate-900/60 text-xs text-slate-400 uppercase tracking-wider font-semibold">
                  <tr>
                    <th scope="col" class="px-6 py-3.5">Date</th>
                    <th scope="col" class="px-6 py-3.5">Rocket</th>
                    <th scope="col" class="px-6 py-3.5">Motor</th>
                    <th scope="col" class="px-6 py-3.5">Peak Altitude (AGL)</th>
                    <th scope="col" class="px-6 py-3.5">Max Velocity</th>
                    <th scope="col" class="px-6 py-3.5">Outcome</th>
                    <th scope="col" class="px-6 py-3.5">Soft-Gate Safety</th>
                    <th scope="col" class="px-6 py-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-700/40">
                  ${flights.map((f) => {
                    const hasOverride =
                      Boolean(f.proceededDespiteWarnings) ||
                      (f.softGateWarnings && f.softGateWarnings.length > 0)
                    const motorName =
                      f.motorMfr && f.motorModel
                        ? `${f.motorMfr} ${f.motorModel}`
                        : f.motorModel || '—'

                    return html`
                      <tr class="hover:bg-slate-700/20 transition-colors">
                        <td class="px-6 py-4 whitespace-nowrap text-slate-300 font-medium">
                          ${formatDate(f.flownAt)}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                          <div class="font-semibold text-white">
                            ${f.rocketName || 'Unnamed Rocket'}
                          </div>
                          ${f.configVersion != null
                            ? html`<div class="text-xs text-slate-400">Config v${f.configVersion}</div>`
                            : ''}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-slate-300">
                          <span class="font-mono bg-slate-900/80 px-2 py-0.5 rounded border border-slate-700 text-xs">
                            ${motorName}
                          </span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-slate-300 font-mono">
                          ${f.altitudeAglM != null
                            ? html`<span class="font-bold text-white">${f.altitudeAglM.toLocaleString()}</span> m`
                            : '—'}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-slate-300 font-mono">
                          ${f.maxVelocityMps != null
                            ? html`<span class="font-bold text-white">${f.maxVelocityMps.toLocaleString()}</span> m/s`
                            : '—'}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                          ${renderOutcomeBadge(f.outcome)}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                          ${hasOverride
                            ? html`
                              <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-950/60 text-amber-300 border border-amber-600/50">
                                ⚠️ Warnings (${f.softGateWarnings?.length || 1})
                              </span>
                            `
                            : html`
                              <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-950/40 text-emerald-300 border border-emerald-600/30">
                                ✓ Clean
                              </span>
                            `}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <a
                            href="/flights/${f.id}"
                            class="text-brand-400 hover:text-brand-300 font-medium transition-colors"
                          >
                            View →
                          </a>
                        </td>
                      </tr>
                    `
                  })}
                </tbody>
              </table>
            </div>
          </div>
        `}
    </div>
  `
}

/**
 * Detailed Flight Log View (GET /flights/:id).
 */
export function flightDetailView(options: FlightDetailOptions): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { flight, config, rocket, motor, site, event, flyer } = options
  const warnings = flight.softGateWarnings || []
  const hasWarnings = warnings.length > 0 || Boolean(flight.proceededDespiteWarnings)
  const flightTitle = rocket?.name
    ? `${rocket.name} — Flight #${flight.flightNumber || 1}`
    : `Flight #${flight.flightNumber || 1}`

  return html`
    <div class="space-y-8">
      <!-- Breadcrumb & Top Bar -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-800 gap-4">
        <div>
          <div class="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <a href="/flights" class="hover:text-brand-400 transition-colors">← Flights</a>
            <span>/</span>
            <span class="text-slate-300">${flightTitle}</span>
          </div>
          <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            <span>${flightTitle}</span>
            ${renderOutcomeBadge(flight.outcome)}
          </h1>
          <p class="mt-1 text-sm text-slate-400">
            Flown on <strong class="text-slate-200">${formatDate(flight.flownAt)}</strong>
            ${flyer?.displayName ? html` by <strong class="text-slate-200">${flyer.displayName}</strong>` : ''}
            ${site?.name ? html` at <strong class="text-slate-200">${site.name}</strong>` : ''}
          </p>
        </div>
        <div class="flex items-center gap-3">
          <a
            href="/flights/new"
            class="inline-flex items-center px-4 py-2 text-sm font-semibold rounded-lg bg-brand-500 hover:bg-brand-400 text-slate-950 shadow-md transition-colors"
          >
            <span class="mr-1 font-bold">+</span> Log Another Flight
          </a>
        </div>
      </div>

      <!-- Preflight Safety Record -->
      <div class="bg-slate-800/60 border ${hasWarnings ? 'border-amber-600/50' : 'border-slate-700/60'} rounded-xl p-5 shadow-sm">
        <div class="flex items-center justify-between pb-3 border-b border-slate-700/60">
          <h2 class="text-base font-semibold text-white flex items-center gap-2">
            <span>🛡️ Preflight Safety Record</span>
          </h2>
          ${hasWarnings
            ? html`
              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950/80 text-amber-300 border border-amber-500/40">
                ⚠️ Warnings Recorded & Overridden
              </span>
            `
            : html`
              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-500/40">
                ✓ All Preflight Gates Passed
              </span>
            `}
        </div>
        <div class="mt-4">
          ${warnings.length > 0
            ? html`
              <div class="space-y-3">
                <p class="text-xs text-amber-200 uppercase tracking-wider font-semibold">
                  Preflight Safety Rules Triggered:
                </p>
                <ul class="list-disc list-inside space-y-1.5 text-sm text-amber-200/90 bg-amber-950/40 p-4 rounded-lg border border-amber-500/30">
                  ${warnings.map((w) => html`<li>${w}</li>`)}
                </ul>
                <p class="text-xs text-slate-400">
                  Status: Flyer acknowledged warnings and opted to proceed with launch
                  (<code class="text-amber-300 font-mono">proceeded_despite_warnings = ${String(flight.proceededDespiteWarnings)}</code>).
                </p>
              </div>
            `
            : html`
              <p class="text-sm text-slate-300">
                No preflight warnings were generated. Rocket stability, motor impulse vs flyer certification, and airspace waiver ceiling were all verified safe before launch.
              </p>
            `}
        </div>
      </div>

      <!-- 4-Card Performance & Hardware Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Card 1: Performance & Flight Telemetry -->
        <div class="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 shadow-sm space-y-4">
          <h2 class="text-base font-semibold text-white flex items-center gap-2 border-b border-slate-700/60 pb-3">
            <span>📊 Telemetry & Performance</span>
          </h2>
          <dl class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt class="text-xs text-slate-400">Peak Altitude (AGL)</dt>
              <dd class="mt-1 font-mono text-lg font-bold text-white">
                ${flight.altitudeAglM != null ? `${flight.altitudeAglM.toLocaleString()} m` : '—'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Peak Altitude (MSL)</dt>
              <dd class="mt-1 font-mono text-lg font-bold text-white">
                ${flight.altitudeMslM != null ? `${flight.altitudeMslM.toLocaleString()} m` : '—'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Max Velocity</dt>
              <dd class="mt-1 font-mono text-lg font-bold text-white">
                ${flight.maxVelocityMps != null ? `${flight.maxVelocityMps.toLocaleString()} m/s` : '—'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Peak Acceleration</dt>
              <dd class="mt-1 font-mono text-lg font-bold text-white">
                ${flight.maxAccelG != null ? `${flight.maxAccelG.toLocaleString()} G` : '—'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Flight Outcome</dt>
              <dd class="mt-1">
                ${renderOutcomeBadge(flight.outcome)}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Flight Number</dt>
              <dd class="mt-1 font-mono text-white font-semibold">
                #${flight.flightNumber || 1}
              </dd>
            </div>
          </dl>
        </div>

        <!-- Card 2: Vehicle Configuration -->
        <div class="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 shadow-sm space-y-4">
          <h2 class="text-base font-semibold text-white flex items-center gap-2 border-b border-slate-700/60 pb-3">
            <span>🛰️ Vehicle Configuration</span>
          </h2>
          <dl class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt class="text-xs text-slate-400">Airframe</dt>
              <dd class="mt-1 font-semibold text-white">
                ${rocket?.name || 'Unnamed Rocket'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Configuration Version</dt>
              <dd class="mt-1 font-mono text-white">
                ${config?.version != null ? `v${config.version}` : 'Default'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Dry / Loaded Mass</dt>
              <dd class="mt-1 font-mono text-slate-200">
                ${config?.dryMassG != null ? `${config.dryMassG}g` : '—'} /
                ${config?.loadedMassG != null ? `${config.loadedMassG}g` : '—'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Stability Margin</dt>
              <dd class="mt-1 font-mono font-bold ${config?.stabilityCalibers && config.stabilityCalibers < 1.0 ? 'text-amber-400' : 'text-emerald-400'}">
                ${config?.stabilityCalibers != null ? `${config.stabilityCalibers.toFixed(2)} cal` : '—'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">CG / CP Position</dt>
              <dd class="mt-1 font-mono text-slate-200">
                ${config?.cgMm != null ? `${config.cgMm}mm` : '—'} /
                ${config?.cpMm != null ? `${config.cpMm}mm` : '—'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Recovery System</dt>
              <dd class="mt-1 text-slate-200">
                ${config?.recoveryType || 'Parachute'}
                ${config?.parachuteSizeMm ? ` (${config.parachuteSizeMm}mm)` : ''}
              </dd>
            </div>
          </dl>
        </div>

        <!-- Card 3: Motor Propulsion Metrics -->
        <div class="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 shadow-sm space-y-4">
          <h2 class="text-base font-semibold text-white flex items-center gap-2 border-b border-slate-700/60 pb-3">
            <span>⚡ Propulsion Metrics</span>
          </h2>
          <dl class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt class="text-xs text-slate-400">Motor Model</dt>
              <dd class="mt-1 font-mono font-bold text-brand-400">
                ${motor ? `${motor.manufacturer} ${motor.model}` : '—'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Impulse Class</dt>
              <dd class="mt-1 font-mono text-white">
                ${motor?.impulseClass ? `Class ${motor.impulseClass}` : '—'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Total Impulse</dt>
              <dd class="mt-1 font-mono text-slate-200">
                ${motor?.totalImpulseNs != null ? `${motor.totalImpulseNs} N·s` : '—'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Average / Max Thrust</dt>
              <dd class="mt-1 font-mono text-slate-200">
                ${motor?.averageThrustN != null ? `${motor.averageThrustN}N` : '—'} /
                ${motor?.maxThrustN != null ? `${motor.maxThrustN}N` : '—'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Ejection Delay</dt>
              <dd class="mt-1 font-mono text-slate-200">
                ${motor?.delayS != null ? `${motor.delayS}s` : '—'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Propellant Type</dt>
              <dd class="mt-1 text-slate-200 uppercase font-mono text-xs">
                ${motor?.propellantType || 'APCP'}
              </dd>
            </div>
          </dl>
        </div>

        <!-- Card 4: Launch Site & Environmental Observations -->
        <div class="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 shadow-sm space-y-4">
          <h2 class="text-base font-semibold text-white flex items-center gap-2 border-b border-slate-700/60 pb-3">
            <span>📍 Launch Site & Environment</span>
          </h2>
          <dl class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt class="text-xs text-slate-400">Launch Site</dt>
              <dd class="mt-1 font-semibold text-white">
                ${site?.name || 'Local Field'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Waiver Altitude Ceiling</dt>
              <dd class="mt-1 font-mono font-bold text-white">
                ${site?.maxAltitudeAglM != null ? `${site.maxAltitudeAglM.toLocaleString()} m AGL` : 'Unlimited'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">GPS Coordinates</dt>
              <dd class="mt-1 font-mono text-xs text-slate-300">
                ${site?.latitude != null && site?.longitude != null
                  ? `${site.latitude.toFixed(4)}°, ${site.longitude.toFixed(4)}°`
                  : 'N/A'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Launch Event</dt>
              <dd class="mt-1 text-slate-200">
                ${event?.name || 'Informal / Open Range'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Wind & Weather</dt>
              <dd class="mt-1 text-slate-200">
                ${flight.windMps != null ? `${flight.windMps} m/s` : ''}
                ${flight.windDirDeg != null ? ` @ ${flight.windDirDeg}°` : ''}
                ${flight.temperatureC != null ? ` (${flight.temperatureC}°C)` : ''}
                ${!flight.windMps && !flight.temperatureC ? 'Calm / Standard' : ''}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Visibility / Cloud Ceiling</dt>
              <dd class="mt-1 font-mono text-slate-200">
                ${flight.ceilingM != null ? `${flight.ceilingM}m ceiling` : 'Clear skies'}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <!-- Flight Notes -->
      ${flight.notes
        ? html`
          <div class="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 shadow-sm space-y-2">
            <h3 class="text-sm font-semibold text-white uppercase tracking-wider">Flight Observations & Notes</h3>
            <p class="text-slate-300 text-sm whitespace-pre-wrap leading-relaxed">${flight.notes}</p>
          </div>
        `
        : ''}
    </div>
  `
}

/**
 * Preflight Flight Logging Form View (GET /flights/new).
 */
export function preflightFormView(props: PreflightFormProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const {
    rockets,
    configurations,
    motors,
    inventories = [],
    launchSites,
    launchEvents = [],
    flyerCertLevel = 0,
    initialValues = {},
    warnings = [],
    error,
  } = props

  return html`
    <div class="max-w-4xl mx-auto space-y-6">
      <!-- Header -->
      <div class="pb-4 border-b border-slate-800">
        <div class="flex items-center gap-2 text-xs text-slate-400 mb-1">
          <a href="/flights" class="hover:text-brand-400 transition-colors">← Flight Logbook</a>
          <span>/</span>
          <span class="text-slate-300">New Flight</span>
        </div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2">
          <span>🚀 Log Flight & Range Preflight Check</span>
        </h1>
        <p class="mt-1 text-sm text-slate-400">
          Configure rocket, motor, and launch parameters. Live safety soft gates check certification, stability, and airspace ceiling.
        </p>
      </div>

      <!-- Top-level Error Banner if re-rendered on 422 -->
      ${error
        ? html`
          <div class="rounded-xl p-4 bg-rose-950/80 border border-rose-500 text-rose-200 shadow-sm flex items-start gap-3">
            <span class="text-xl leading-none">⚠️</span>
            <div>
              <h4 class="text-sm font-bold text-rose-300">Preflight Action Required</h4>
              <p class="text-sm mt-0.5">${error}</p>
            </div>
          </div>
        `
        : ''}

      <!-- Flight Logging Form -->
      <form
        id="flight-form"
        method="POST"
        action="/flights"
        class="space-y-8 bg-slate-800/40 border border-slate-700/60 rounded-xl p-6 shadow-sm"
      >
        <!-- Section 1: Flight Identity & Rocket Configuration -->
        <div class="space-y-4">
          <h2 class="text-base font-semibold text-white border-b border-slate-700/60 pb-2 flex items-center gap-2">
            <span>1. Vehicle & Propulsion Configuration</span>
            <span class="text-xs font-normal text-slate-400">Active flyer cert: Level ${flyerCertLevel}</span>
          </h2>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <!-- Rocket Configuration Selector -->
            <div>
              <label for="rocket_configuration_id" class="block text-sm font-medium text-slate-200 mb-1">
                Rocket Configuration <span class="text-rose-400">*</span>
              </label>
              <select
                name="rocket_configuration_id"
                id="rocket_configuration_id"
                required
                hx-post="/flights/preflight-check"
                hx-trigger="change"
                hx-target="#soft-gate-alerts"
                hx-include="#flight-form"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
              >
                <option value="">Select rocket configuration...</option>
                ${configurations.map((c) => {
                  const rocket = rockets.find((r) => r.id === c.rocketId)
                  const name = rocket ? rocket.name : 'Airframe'
                  const calText = c.stabilityCalibers != null ? `${c.stabilityCalibers.toFixed(2)} cal` : 'calibers N/A'
                  const selected = initialValues['rocket_configuration_id'] === c.id ? 'selected' : ''
                  return html`
                    <option value="${c.id}" ${selected}>
                      ${name} — Config v${c.version} (${calText})
                    </option>
                  `
                })}
              </select>
            </div>

            <!-- Motor Selector -->
            <div>
              <label for="motor_id" class="block text-sm font-medium text-slate-200 mb-1">
                Motor Model <span class="text-rose-400">*</span>
              </label>
              <select
                name="motor_id"
                id="motor_id"
                required
                hx-post="/flights/preflight-check"
                hx-trigger="change"
                hx-target="#soft-gate-alerts"
                hx-include="#flight-form"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono"
              >
                <option value="">Select propulsion motor...</option>
                ${motors.map((m) => {
                  const selected = initialValues['motor_id'] === m.id ? 'selected' : ''
                  const impulseLabel = m.impulseClass ? `[${m.impulseClass}]` : ''
                  const delayLabel = m.delayS != null ? `-${m.delayS}` : ''
                  return html`
                    <option value="${m.id}" ${selected}>
                      ${m.manufacturer} ${m.model}${delayLabel} ${impulseLabel}
                    </option>
                  `
                })}
              </select>
            </div>

            <!-- Optional Motor Inventory Stock Selector -->
            <div>
              <label for="motor_inventory_id" class="block text-sm font-medium text-slate-200 mb-1">
                Motor Stock Item <span class="text-xs text-slate-400 font-normal">(optional — decrements stock)</span>
              </label>
              <select
                name="motor_inventory_id"
                id="motor_inventory_id"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
              >
                <option value="">None / Untracked Motor Item</option>
                ${inventories.map((inv) => {
                  const selected = initialValues['motor_inventory_id'] === inv.id ? 'selected' : ''
                  return html`
                    <option value="${inv.id}" ${selected}>
                      ${inv.motorModel || 'Motor'} — ${inv.quantityOnHand} units in stock
                    </option>
                  `
                })}
              </select>
            </div>

            <!-- Expected / Target Altitude -->
            <div>
              <label for="altitude_agl_m" class="block text-sm font-medium text-slate-200 mb-1">
                Peak / Expected Altitude (m AGL) <span class="text-rose-400">*</span>
              </label>
              <input
                type="number"
                step="any"
                name="altitude_agl_m"
                id="altitude_agl_m"
                placeholder="e.g. 850"
                value="${initialValues['altitude_agl_m'] ?? initialValues['expected_altitude_m'] ?? ''}"
                required
                hx-post="/flights/preflight-check"
                hx-trigger="change, keyup delay:300ms"
                hx-target="#soft-gate-alerts"
                hx-include="#flight-form"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono"
              />
            </div>
          </div>
        </div>

        <!-- Section 2: Launch Field & Event -->
        <div class="space-y-4">
          <h2 class="text-base font-semibold text-white border-b border-slate-700/60 pb-2 flex items-center gap-2">
            <span>2. Launch Site & Range Context</span>
          </h2>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <!-- Launch Site Selector -->
            <div>
              <label for="launch_site_id" class="block text-sm font-medium text-slate-200 mb-1">
                Launch Site <span class="text-rose-400">*</span>
              </label>
              <select
                name="launch_site_id"
                id="launch_site_id"
                required
                hx-post="/flights/preflight-check"
                hx-trigger="change"
                hx-target="#soft-gate-alerts"
                hx-include="#flight-form"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
              >
                <option value="">Select launch site...</option>
                ${launchSites.map((s) => {
                  const selected = initialValues['launch_site_id'] === s.id ? 'selected' : ''
                  const waiverText = s.maxAltitudeAglM != null ? `(Ceiling: ${s.maxAltitudeAglM}m)` : '(Ceiling: Unlimited)'
                  return html`
                    <option value="${s.id}" ${selected}>
                      ${s.name} ${waiverText}
                    </option>
                  `
                })}
              </select>
            </div>

            <!-- Launch Event Selector -->
            <div>
              <label for="launch_event_id" class="block text-sm font-medium text-slate-200 mb-1">
                Launch Event <span class="text-xs text-slate-400 font-normal">(optional)</span>
              </label>
              <select
                name="launch_event_id"
                id="launch_event_id"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
              >
                <option value="">Informal Launch / Open Range</option>
                ${launchEvents.map((e) => {
                  const selected = initialValues['launch_event_id'] === e.id ? 'selected' : ''
                  return html`
                    <option value="${e.id}" ${selected}>
                      ${e.name}
                    </option>
                  `
                })}
              </select>
            </div>
          </div>
        </div>

        <!-- Section 3: Live Preflight Safety Soft Gates (Dynamic HTMX target) -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold text-white flex items-center gap-2">
              <span>3. Dynamic Safety Soft Gates</span>
            </h2>
            <span class="text-xs text-slate-400 font-mono">Live HTMX Evaluator</span>
          </div>

          <!-- Dynamic HTMX fragment container -->
          <div id="soft-gate-alerts">
            ${warnings.length > 0
              ? preflightWarningFragment(warnings, initialValues['proceeded_despite_warnings'])
              : html`
                <div class="rounded-xl p-4 bg-slate-900/80 border border-slate-700/80 text-slate-300 text-sm flex items-center gap-3">
                  <span class="text-xl">⚡</span>
                  <div>
                    <span class="font-medium text-white">Live Range Companion Checker</span>
                    <p class="text-xs text-slate-400 mt-0.5">
                      Select rocket configuration, motor, site, and altitude above to evaluate certification limits, aerodynamic stability, and airspace waiver ceilings.
                    </p>
                  </div>
                </div>
              `}
          </div>
        </div>

        <!-- Section 4: Flight Telemetry & Environmental Log -->
        <div class="space-y-4">
          <h2 class="text-base font-semibold text-white border-b border-slate-700/60 pb-2 flex items-center gap-2">
            <span>4. Flight Outcome & Telemetry Log</span>
          </h2>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <!-- Outcome -->
            <div>
              <label for="outcome" class="block text-sm font-medium text-slate-200 mb-1">
                Flight Outcome <span class="text-rose-400">*</span>
              </label>
              <select
                name="outcome"
                id="outcome"
                required
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-medium"
              >
                <option value="successful" ${initialValues['outcome'] === 'successful' || !initialValues['outcome'] ? 'selected' : ''}>
                  ✓ Successful
                </option>
                <option value="cato" ${initialValues['outcome'] === 'cato' ? 'selected' : ''}>
                  💥 CATO (Motor Failure)
                </option>
                <option value="separation" ${initialValues['outcome'] === 'separation' ? 'selected' : ''}>
                  ⚠️ Early / High-Speed Separation
                </option>
                <option value="recovery_failure" ${initialValues['outcome'] === 'recovery_failure' ? 'selected' : ''}>
                  ⚠️ Recovery Failure
                </option>
                <option value="tree" ${initialValues['outcome'] === 'tree' ? 'selected' : ''}>
                  🌲 Tree Landing
                </option>
                <option value="powerline" ${initialValues['outcome'] === 'powerline' ? 'selected' : ''}>
                  ⚡ Powerline Encounter
                </option>
                <option value="lost" ${initialValues['outcome'] === 'lost' ? 'selected' : ''}>
                  ❓ Lost Airframe
                </option>
                <option value="other" ${initialValues['outcome'] === 'other' ? 'selected' : ''}>
                  Other
                </option>
              </select>
            </div>

            <!-- Max Velocity -->
            <div>
              <label for="max_velocity_mps" class="block text-sm font-medium text-slate-200 mb-1">
                Max Velocity (m/s)
              </label>
              <input
                type="number"
                step="any"
                name="max_velocity_mps"
                id="max_velocity_mps"
                placeholder="e.g. 145.2"
                value="${initialValues['max_velocity_mps'] ?? ''}"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono"
              />
            </div>

            <!-- Peak Acceleration -->
            <div>
              <label for="max_accel_g" class="block text-sm font-medium text-slate-200 mb-1">
                Peak Accel (G)
              </label>
              <input
                type="number"
                step="any"
                name="max_accel_g"
                id="max_accel_g"
                placeholder="e.g. 12.4"
                value="${initialValues['max_accel_g'] ?? ''}"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono"
              />
            </div>

            <!-- Flight Number -->
            <div>
              <label for="flight_number" class="block text-sm font-medium text-slate-200 mb-1">
                Flight Number
              </label>
              <input
                type="number"
                name="flight_number"
                id="flight_number"
                placeholder="e.g. 1"
                value="${initialValues['flight_number'] ?? ''}"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono"
              />
            </div>

            <!-- Wind Speed -->
            <div>
              <label for="wind_mps" class="block text-sm font-medium text-slate-200 mb-1">
                Wind Speed (m/s)
              </label>
              <input
                type="number"
                step="any"
                name="wind_mps"
                id="wind_mps"
                placeholder="e.g. 3.5"
                value="${initialValues['wind_mps'] ?? ''}"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono"
              />
            </div>

            <!-- Temperature -->
            <div>
              <label for="temperature_c" class="block text-sm font-medium text-slate-200 mb-1">
                Temperature (°C)
              </label>
              <input
                type="number"
                step="any"
                name="temperature_c"
                id="temperature_c"
                placeholder="e.g. 24"
                value="${initialValues['temperature_c'] ?? ''}"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono"
              />
            </div>
          </div>

          <!-- Notes -->
          <div>
            <label for="notes" class="block text-sm font-medium text-slate-200 mb-1">
              Flight Observations & Field Notes
            </label>
            <textarea
              name="notes"
              id="notes"
              rows="3"
              placeholder="Ejection timing, apogee drift, recovery landing condition, etc."
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
            >${initialValues['notes'] ?? ''}</textarea>
          </div>
        </div>

        <!-- Form Actions -->
        <div class="pt-4 border-t border-slate-700/60 flex items-center justify-between">
          <a
            href="/flights"
            class="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </a>
          <button
            type="submit"
            class="inline-flex items-center px-6 py-2.5 text-sm font-bold rounded-lg bg-brand-400 hover:bg-brand-300 text-slate-950 shadow-md transition-colors"
          >
            <span class="mr-1.5 font-extrabold">+</span> Submit Flight Log
          </button>
        </div>
      </form>
    </div>
  `
}
