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
import { formatRecoveryType } from './rockets'

export interface FlightListItem {
  id: string
  flightNumber?: number | null
  flownAt?: number | null
  logType?: string | null
  isFirstFlight?: boolean | null
  certAttempt?: string | null
  padNumber?: string | null
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
    logType?: string | null
    isFirstFlight?: boolean | null
    certAttempt?: string | null
    buildType?: string | null
    stabilityCheckMethod?: string | null
    stabilityMargin?: number | null
    motorType?: string | null
    totalWeightG?: number | null
    recoverySystem?: string | null
    recoverySize?: string | null
    deploymentMethod?: string | null
    mainDeployAltitude?: string | null
    padNumber?: string | null
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
    rsoUserId?: string | null
    lcoUserId?: string | null
    rsoName?: string | null
    lcoName?: string | null
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
    drogueParachuteSizeMm?: number | null
    motorMountDiameterMm?: number | null
    lengthMm?: number | null
    bodyDiameterMm?: number | null
  } | null
  rocket?: {
    id: string
    name: string
    status?: string | null
    lengthMm?: number | null
    bodyDiameterMm?: number | null
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
    hardware?: string | null
    casingReusable?: boolean | null
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
  rsoUser?: { id: string; displayName?: string | null; email?: string | null } | null
  lcoUser?: { id: string; displayName?: string | null; email?: string | null } | null
  units?: string | null
  unitSystem?: 'metric' | 'imperial' | string | null
}

export interface PreflightFormProps {
  rockets: Array<{
    id: string
    name: string
    lengthMm?: number | null
    bodyDiameterMm?: number | null
  }>
  configurations: Array<{
    id: string
    rocketId: string
    version: number
    stabilityCalibers?: number | null
    dryMassG?: number | null
    loadedMassG?: number | null
    lengthMm?: number | null
    bodyDiameterMm?: number | null
  }>
  motors: Array<{
    id: string
    manufacturer: string
    model: string
    impulseClass?: string | null
    delayS?: number | null
    diameterMm?: number | null
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
    startsOn?: string | null
    endsOn?: string | null
    siteName?: string | null
    rsoName?: string | null
    lcoName?: string | null
  }>
  users?: Array<{
    id: string
    displayName: string
  }>
  flyerCertLevel?: number
  initialValues?: Record<string, any>
  warnings?: string[]
  error?: string
  isEdit?: boolean
  flightId?: string
}

/**
 * Renders a color-coded status badge for all Tripoli/SARC club flight outcomes
 * and legacy system outcomes.
 */
export function renderOutcomeBadge(outcome?: string | null): HtmlEscapedString | Promise<HtmlEscapedString> {
  if (!outcome) {
    return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-slate-700/50 text-slate-300 border border-slate-600/30">Unknown</span>`
  }

  const lower = outcome.toLowerCase()
  switch (lower) {
    case 'good':
    case 'successful':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">✓ ${outcome === 'good' ? 'GOOD' : (outcome === 'successful' ? 'Successful' : outcome)}</span>`
    case 'cato':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">💥 CATO</span>`
    case 'shred':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">💥 Shred</span>`
    case 'no chute':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">🪂 No chute</span>`
    case 'lawn dart':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">🎯 Lawn Dart</span>`
    case 'unstable':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">⚠️ Unstable</span>`
    case 'zipper':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">⚠️ Zipper</span>`
    case 'separation':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">⚠️ Separation</span>`
    case 'tangled':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">🪢 Tangled</span>`
    case 'retention fail':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">⚠️ Retention fail</span>`
    case 'recovery_failure':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">⚠️ Recovery Failure</span>`
    case 'tree':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">🌲 Tree Landing</span>`
    case 'powerline':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">⚡ Powerline</span>`
    case 'no ignition':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-600/30 text-slate-300 border border-slate-500/40">🚫 No ignition</span>`
    case 'lost':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-600/30 text-slate-300 border border-slate-500/40">❓ Lost</span>`
    default:
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-700/40 text-slate-300 border border-slate-600/30">${outcome}</span>`
  }
}

/**
 * Format build type to human-readable label.
 */
export function formatBuildType(buildType?: string | null): string {
  if (!buildType) return '—'
  switch (buildType.toLowerCase()) {
    case 'rtf':
      return 'Ready-to-Fly (RTF)'
    case 'kit':
      return 'Commercial Kit'
    case 'modified':
      return 'Modified Kit'
    case 'scratch_built':
      return 'Scratch Built'
    default:
      return buildType
  }
}

/**
 * Renders a visual badge distinguishing Preflight Simulation / Planned vs Actual Flight.
 */
export function renderFlightLogTypeBadge(logType?: string | null): HtmlEscapedString | Promise<HtmlEscapedString> {
  if (logType === 'preflight') {
    return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">📋 Planned / Sim</span>`
  }
  return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">🚀 Actual Flight</span>`
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
export function flightsListView(
  flights: FlightListItem[],
  units?: string | { units?: string; unitSystem?: 'metric' | 'imperial' } | null,
  unitSystemArg?: 'metric' | 'imperial' | null,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const isImperial =
    (typeof units === 'object' && units !== null
      ? units.unitSystem === 'imperial' || units.units === 'ft' || units.units === 'feet'
      : units === 'ft' || units === 'feet' || unitSystemArg === 'imperial') || false

  return html`
    <div class="space-y-6">
      <!-- Header with Action and Unit Toggle -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-800 gap-4">
        <div>
          <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>🚀 Flight Logbook</span>
          </h1>
          <p class="mt-1 text-sm text-slate-400">
            Recorded flight telemetry, performance logs, and preflight safety records.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <!-- Unit Toggle (Meters / Feet) -->
          <div class="inline-flex items-center rounded-lg bg-slate-900 p-1 border border-slate-700" role="group" aria-label="Units toggle">
            <span class="text-xs text-slate-400 px-2 font-medium">Units:</span>
            <a
              href="/flights?units=m"
              id="units-m"
              class="px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${!isImperial ? 'bg-brand-400 text-slate-950 shadow' : 'text-slate-400 hover:text-white'}"
            >
              Meters (m)
            </a>
            <a
              href="/flights?units=ft"
              id="units-ft"
              class="px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${isImperial ? 'bg-brand-400 text-slate-950 shadow' : 'text-slate-400 hover:text-white'}"
            >
              Feet (ft)
            </a>
          </div>

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
                    <th scope="col" class="px-6 py-3.5">Stage</th>
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
                          ${renderFlightLogTypeBadge(f.logType)}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                          <div class="font-semibold text-white flex items-center gap-1.5 flex-wrap">
                            <span>${f.rocketName || 'Unnamed Rocket'}</span>
                            ${f.isFirstFlight
                              ? html`<span class="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded bg-purple-500/20 text-purple-300 border border-purple-500/40">✨ Maiden</span>`
                              : ''}
                            ${f.certAttempt && f.certAttempt !== 'none'
                              ? html`<span class="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">🎓 ${f.certAttempt.toUpperCase()}</span>`
                              : ''}
                          </div>
                          ${f.configVersion != null || f.padNumber
                            ? html`<div class="text-xs text-slate-400">${f.configVersion != null ? `Config v${f.configVersion}` : ''}${f.configVersion != null && f.padNumber ? ' • ' : ''}${f.padNumber ? (f.padNumber.toLowerCase().startsWith('pad') ? f.padNumber : `Pad ${f.padNumber}`) : ''}</div>`
                            : ''}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-slate-300">
                          <span class="font-mono bg-slate-900/80 px-2 py-0.5 rounded border border-slate-700 text-xs">
                            ${motorName}
                          </span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-slate-300 font-mono" data-m="${f.altitudeAglM ?? ''}" data-altitude="${f.altitudeAglM ?? ''}">
                          ${f.altitudeAglM != null
                            ? (isImperial
                                ? html`<span class="font-bold text-white">${Math.round(f.altitudeAglM * 3.28084).toLocaleString()}</span> ft`
                                : html`<span class="font-bold text-white">${f.altitudeAglM.toLocaleString()}</span> m`)
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
  const { flight, config, rocket, motor, site, event, flyer, rsoUser, lcoUser, units, unitSystem } = options
  const isImperial = unitSystem === 'imperial' || units === 'ft' || units === 'feet'
  const warnings = flight.softGateWarnings || []
  const hasWarnings = warnings.length > 0 || Boolean(flight.proceededDespiteWarnings)
  const flightTitle = rocket?.name
    ? `${rocket.name} — Flight #${flight.flightNumber || 1}`
    : `Flight #${flight.flightNumber || 1}`

  const rsoDisplay = flight.rsoName || rsoUser?.displayName || null
  const lcoDisplay = flight.lcoName || lcoUser?.displayName || null

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
            ${renderFlightLogTypeBadge(flight.logType)}
            ${renderOutcomeBadge(flight.outcome)}
          </h1>
          <p class="mt-1 text-sm text-slate-400">
            Flown on <strong class="text-slate-200">${formatDate(flight.flownAt)}</strong>
            ${flyer?.displayName ? html` by <strong class="text-slate-200">${flyer.displayName}</strong>` : ''}
            ${site?.name ? html` at <strong class="text-slate-200">${site.name}</strong>` : ''}
          </p>
          <div class="flex flex-wrap items-center gap-2 mt-2">
            ${flight.isFirstFlight
              ? html`<span class="inline-flex items-center px-2.5 py-0.5 text-xs font-bold rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm">✨ Maiden Voyage</span>`
              : ''}
            ${flight.certAttempt && flight.certAttempt !== 'none'
              ? html`<span class="inline-flex items-center px-2.5 py-0.5 text-xs font-bold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm">🎓 ${flight.certAttempt.toUpperCase()} Cert Attempt</span>`
              : ''}
          </div>
        </div>
        <div class="flex items-center gap-3">
          <!-- Unit Toggle (Meters / Feet) -->
          <div class="inline-flex items-center rounded-lg bg-slate-900 p-1 border border-slate-700" role="group" aria-label="Units toggle">
            <span class="text-xs text-slate-400 px-2 font-medium">Units:</span>
            <a
              href="/flights/${flight.id}?units=m"
              id="units-detail-m"
              class="px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${!isImperial ? 'bg-brand-400 text-slate-950 shadow' : 'text-slate-400 hover:text-white'}"
            >
              Meters (m)
            </a>
            <a
              href="/flights/${flight.id}?units=ft"
              id="units-detail-ft"
              class="px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${isImperial ? 'bg-brand-400 text-slate-950 shadow' : 'text-slate-400 hover:text-white'}"
            >
              Feet (ft)
            </a>
          </div>

          <a
            href="/flights/${flight.id}/edit"
            id="edit-flight-btn"
            class="inline-flex items-center px-3.5 py-2 text-sm font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 shadow-sm transition-colors"
          >
            ✏️ Edit Flight
          </a>
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

        <!-- Duty Officers Sign-off Bar -->
        <div class="mt-4 pt-3 border-t border-slate-700/60 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div class="flex items-center gap-4 flex-wrap">
            <span class="text-slate-400 font-semibold uppercase tracking-wider text-[11px]">Range Duty Officers:</span>
            <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700/80">
              <span class="text-slate-400 font-medium">RSO:</span>
              <span class="font-semibold ${rsoDisplay ? 'text-blue-300' : 'text-slate-500'}">
                ${rsoDisplay ? `🛡️ ${rsoDisplay}` : 'Unassigned'}
              </span>
            </div>
            <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700/80">
              <span class="text-slate-400 font-medium">LCO:</span>
              <span class="font-semibold ${lcoDisplay ? 'text-purple-300' : 'text-slate-500'}">
                ${lcoDisplay ? `🚀 ${lcoDisplay}` : 'Unassigned'}
              </span>
            </div>
          </div>
          ${flight.proceededDespiteWarnings
            ? html`<span class="text-amber-400 text-[11px] font-mono">⚠️ Safety Override Authorized</span>`
            : html`<span class="text-emerald-400 text-[11px] font-mono">✓ Clear Range Sign-off</span>`}
        </div>

        <!-- Airframe Physical Clearance Verification (RSO / LCO) -->
        <div class="mt-3 pt-3 border-t border-slate-700/60 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div class="flex items-center gap-4 flex-wrap">
            <span class="text-slate-400 font-semibold uppercase tracking-wider text-[11px]">Physical Clearance (RSO/LCO):</span>
            <span class="text-slate-300">
              Length: <strong class="text-white font-mono">${(config?.lengthMm ?? rocket?.lengthMm) != null ? `${(config?.lengthMm ?? rocket?.lengthMm)} mm (${(((config?.lengthMm ?? rocket?.lengthMm)!) / 10).toFixed(1)} cm)` : '—'}</strong>
            </span>
            <span class="text-slate-300">
              Body Diameter: <strong class="text-white font-mono">${(config?.bodyDiameterMm ?? rocket?.bodyDiameterMm) != null ? `${(config?.bodyDiameterMm ?? rocket?.bodyDiameterMm)} mm (${(((config?.bodyDiameterMm ?? rocket?.bodyDiameterMm)!) / 10).toFixed(1)} cm)` : '—'}</strong>
            </span>
          </div>
          <span class="text-slate-400 text-[11px]">(Pad fit & launch rail clearance verified)</span>
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
            <div data-m="${flight.altitudeAglM ?? ''}" data-altitude="${flight.altitudeAglM ?? ''}">
              <dt class="text-xs text-slate-400">Peak Altitude (AGL)</dt>
              <dd class="mt-1 font-mono text-lg font-bold text-white">
                ${flight.altitudeAglM != null
                  ? (isImperial
                      ? `${Math.round(flight.altitudeAglM * 3.28084).toLocaleString()} ft (${flight.altitudeAglM.toLocaleString()} m)`
                      : `${flight.altitudeAglM.toLocaleString()} m (${Math.round(flight.altitudeAglM * 3.28084).toLocaleString()} ft)`)
                  : '—'}
              </dd>
            </div>
            <div data-m="${flight.altitudeMslM ?? ''}" data-altitude="${flight.altitudeMslM ?? ''}">
              <dt class="text-xs text-slate-400">Peak Altitude (MSL)</dt>
              <dd class="mt-1 font-mono text-lg font-bold text-white">
                ${flight.altitudeMslM != null
                  ? (isImperial
                      ? `${Math.round(flight.altitudeMslM * 3.28084).toLocaleString()} ft (${flight.altitudeMslM.toLocaleString()} m)`
                      : `${flight.altitudeMslM.toLocaleString()} m (${Math.round(flight.altitudeMslM * 3.28084).toLocaleString()} ft)`)
                  : '—'}
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
              <dt class="text-xs text-slate-400">Flight Stage</dt>
              <dd class="mt-1">
                ${renderFlightLogTypeBadge(flight.logType)}
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
            <div>
              <dt class="text-xs text-slate-400">Launch Pad</dt>
              <dd class="mt-1 font-mono text-white font-semibold">
                ${flight.padNumber || '—'}
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
              <dt class="text-xs text-slate-400">Airframe Length</dt>
              <dd class="mt-1 font-mono text-slate-200">
                ${(config?.lengthMm ?? rocket?.lengthMm) != null
                  ? (isImperial
                      ? `${(((config?.lengthMm ?? rocket?.lengthMm)!) / 304.8).toFixed(2)} ft (${(config?.lengthMm ?? rocket?.lengthMm)} mm)`
                      : `${(config?.lengthMm ?? rocket?.lengthMm)} mm (${(((config?.lengthMm ?? rocket?.lengthMm)!) / 10).toFixed(1)} cm)`)
                  : '—'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Body Diameter</dt>
              <dd class="mt-1 font-mono text-slate-200">
                ${(config?.bodyDiameterMm ?? rocket?.bodyDiameterMm) != null
                  ? (isImperial
                      ? `${(((config?.bodyDiameterMm ?? rocket?.bodyDiameterMm)!) / 25.4).toFixed(2)} in (${(config?.bodyDiameterMm ?? rocket?.bodyDiameterMm)} mm)`
                      : `${(config?.bodyDiameterMm ?? rocket?.bodyDiameterMm)} mm (${(((config?.bodyDiameterMm ?? rocket?.bodyDiameterMm)!) / 10).toFixed(1)} cm)`)
                  : '—'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Build Type</dt>
              <dd class="mt-1 text-slate-200">
                ${formatBuildType(flight.buildType)}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Total Loaded Mass</dt>
              <dd class="mt-1 font-mono text-slate-200">
                ${flight.totalWeightG != null ? `${flight.totalWeightG}g` : (config?.loadedMassG != null ? `${config.loadedMassG}g` : (config?.dryMassG != null ? `${config.dryMassG}g` : '—'))}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Stability Margin</dt>
              <dd class="mt-1 font-mono font-bold ${flight.stabilityMargin != null ? (flight.stabilityMargin < 1.0 ? 'text-amber-400' : 'text-emerald-400') : (config?.stabilityCalibers && config.stabilityCalibers < 1.0 ? 'text-amber-400' : 'text-emerald-400')}">
                ${flight.stabilityMargin != null ? `${flight.stabilityMargin.toFixed(2)} cal` : (config?.stabilityCalibers != null ? `${config.stabilityCalibers.toFixed(2)} cal` : '—')}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Stability Verification</dt>
              <dd class="mt-1 text-slate-200">
                ${flight.stabilityCheckMethod || '—'}
              </dd>
            </div>
            <div data-cg="${config?.cgMm ?? ''}" data-cp="${config?.cpMm ?? ''}">
              <dt class="text-xs text-slate-400">CG / CP Position</dt>
              <dd class="mt-1 font-mono text-slate-200">
                ${isImperial
                  ? (config?.cgMm != null && config?.cpMm != null
                      ? `${(config.cgMm / 304.8).toFixed(1)} ft / ${(config.cpMm / 304.8).toFixed(1)} ft`
                      : (config?.cgMm != null ? `${(config.cgMm / 304.8).toFixed(1)} ft` : '—'))
                  : (config?.cgMm != null && config?.cpMm != null
                      ? `${config.cgMm}mm / ${config.cpMm}mm`
                      : (config?.cgMm != null ? `${config.cgMm}mm` : '—'))}
              </dd>
              <p class="text-[10px] text-slate-400 mt-0.5">Reference datum: Distance from Nose Cone Tip</p>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Recovery System</dt>
              <dd class="mt-1 text-slate-200">
                ${flight.recoverySystem || formatRecoveryType(config?.recoveryType)}
                ${flight.recoverySize ? ` (${flight.recoverySize})` : (config?.recoveryType === 'dual_deploy'
                  ? (isImperial
                      ? html` (Main: ${config?.parachuteSizeMm != null ? `${(config.parachuteSizeMm / 304.8).toFixed(1)} ft` : '—'}${config?.drogueParachuteSizeMm != null ? `, Drogue: ${(config.drogueParachuteSizeMm / 304.8).toFixed(1)} ft` : ''})`
                      : html` (Main: ${config?.parachuteSizeMm != null ? `${config.parachuteSizeMm}mm` : '—'}${config?.drogueParachuteSizeMm != null ? `, Drogue: ${config.drogueParachuteSizeMm}mm` : ''})`)
                  : (config?.parachuteSizeMm != null
                      ? (isImperial
                          ? ` (${(config.parachuteSizeMm / 304.8).toFixed(1)} ft)`
                          : ` (${config.parachuteSizeMm}mm)`)
                      : ''))}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Deployment Method</dt>
              <dd class="mt-1 text-slate-200">
                ${flight.deploymentMethod || '—'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Main Chute Deploy Alt</dt>
              <dd class="mt-1 text-slate-200">
                ${flight.mainDeployAltitude || '—'}
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
            <div>
              <dt class="text-xs text-slate-400">Motor Composition / Type</dt>
              <dd class="mt-1 text-slate-200 uppercase font-mono text-xs">
                ${flight.motorType || motor?.propellantType || '—'}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Required Casing / Hardware</dt>
              <dd class="mt-1 font-mono font-semibold text-slate-200">
                ${motor ? (motor.hardware || (motor.casingReusable ? 'Reloadable Casing' : 'Single-Use')) : '—'}
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
            <div data-m="${site?.maxAltitudeAglM ?? ''}" data-altitude="${site?.maxAltitudeAglM ?? ''}">
              <dt class="text-xs text-slate-400">Waiver Altitude Ceiling</dt>
              <dd class="mt-1 font-mono font-bold text-white">
                ${site?.maxAltitudeAglM != null
                  ? (isImperial
                      ? `${Math.round(site.maxAltitudeAglM * 3.28084).toLocaleString()} ft`
                      : `${site.maxAltitudeAglM.toLocaleString()} m AGL`)
                  : 'Unlimited'}
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
                ${flight.ceilingM != null
                  ? (isImperial
                      ? `${Math.round(flight.ceilingM * 3.28084).toLocaleString()} ft ceiling`
                      : `${flight.ceilingM}m ceiling`)
                  : 'Clear skies'}
              </dd>
            </div>
          </dl>
        </div>

        <!-- Card 5: Range Safety & Launch Duty Officers (R2) -->
        <div class="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5 shadow-sm space-y-4 md:col-span-2">
          <h2 class="text-base font-semibold text-white flex items-center gap-2 border-b border-slate-700/60 pb-3">
            <span>🛡️ Range Safety & Launch Duty Officers</span>
          </h2>
          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt class="text-xs text-slate-400">Range Safety Officer (RSO)</dt>
              <dd class="mt-1 font-semibold text-white flex items-center gap-2">
                <span>🛡️</span>
                <span class="${rsoDisplay ? 'text-blue-300' : 'text-slate-400'}">${rsoDisplay || 'Unassigned / Open Range'}</span>
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Launch Control Officer (LCO)</dt>
              <dd class="mt-1 font-semibold text-white flex items-center gap-2">
                <span>⚡</span>
                <span class="${lcoDisplay ? 'text-purple-300' : 'text-slate-400'}">${lcoDisplay || 'Unassigned / Self-Launch'}</span>
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Launch Pad Designation</dt>
              <dd class="mt-1 font-mono font-semibold text-white">
                ${flight.padNumber ? (flight.padNumber.toLowerCase().startsWith('pad') ? flight.padNumber : `Pad ${flight.padNumber}`) : '—'}
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
    users = [],
    flyerCertLevel = 0,
    initialValues = {},
    warnings = [],
    error,
    isEdit = false,
    flightId = '',
  } = props

  return html`
    <div class="max-w-4xl mx-auto space-y-6">
      <!-- Header -->
      <div class="pb-4 border-b border-slate-800">
        <div class="flex items-center gap-2 text-xs text-slate-400 mb-1">
          <a href="/flights" class="hover:text-brand-400 transition-colors">← Flight Logbook</a>
          <span>/</span>
          ${isEdit
            ? html`
              <a href="/flights/${flightId}" class="hover:text-brand-400 transition-colors">Flight Details</a>
              <span>/</span>
              <span class="text-slate-300">Edit Flight</span>
            `
            : html`<span class="text-slate-300">New Flight</span>`}
        </div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2">
          <span>${isEdit ? '✏️ Edit Flight Log' : '🚀 Log Flight & Range Preflight Check'}</span>
        </h1>
        <p class="mt-1 text-sm text-slate-400">
          ${isEdit
            ? 'Update flight telemetry, motor selection, launch site, or rotating duty officers.'
            : 'Configure rocket, motor, and launch parameters. Live safety soft gates check certification, stability, and airspace ceiling.'}
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
        action="${isEdit ? `/flights/${flightId}/edit` : '/flights'}"
        class="space-y-8 bg-slate-800/40 border border-slate-700/60 rounded-xl p-6 shadow-sm"
      >
        <!-- Section 1: Flight Identity & Rocket Configuration -->
        <div class="space-y-4">
          <h2 class="text-base font-semibold text-white border-b border-slate-700/60 pb-2 flex items-center gap-2">
            <span>1. Vehicle & Propulsion Configuration</span>
            <span class="text-xs font-normal text-slate-400">Active flyer cert: Level ${flyerCertLevel}</span>
          </h2>

          <!-- Flight Stage / Log Type (R2) -->
          <div>
            <label for="log_type" class="block text-sm font-medium text-slate-200 mb-1">
              Flight Stage / Log Type <span class="text-rose-400">*</span>
            </label>
            <select
              name="log_type"
              id="log_type"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-medium"
            >
              <option value="actual" ${(initialValues['log_type'] ?? initialValues['logType'] ?? 'actual') === 'actual' ? 'selected' : ''}>
                🚀 Post-Flight Actuals
              </option>
              <option value="preflight" ${(initialValues['log_type'] ?? initialValues['logType']) === 'preflight' ? 'selected' : ''}>
                📋 Preflight Simulation / Planned
              </option>
            </select>
            <p class="text-[11px] text-slate-400 mt-1">
              Distinguish between planned simulation parameters and actual flown telemetry. Preflight simulation records do not decrement motor inventory.
            </p>
          </div>

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
                  const lengthVal = c.lengthMm ?? rocket?.lengthMm
                  const diamVal = c.bodyDiameterMm ?? rocket?.bodyDiameterMm
                  const geomLabel =
                    lengthVal != null || diamVal != null
                      ? ` | ${lengthVal != null ? `L: ${lengthVal}mm` : ''}${lengthVal != null && diamVal != null ? ', ' : ''}${diamVal != null ? `Ø: ${diamVal}mm` : ''}`
                      : ''
                  return html`
                    <option
                      value="${c.id}"
                      ${selected}
                      data-length="${lengthVal ?? ''}"
                      data-diameter="${diamVal ?? ''}"
                    >
                      ${name} — Config v${c.version} (${calText}${geomLabel})
                    </option>
                  `
                })}
              </select>

              <!-- Airframe Physical Geometry & Pad Fit Inspection Card (RSO / LCO) -->
              <div id="preflight-airframe-geometry-card" class="mt-3 p-3.5 bg-slate-950/70 border border-slate-700/60 rounded-lg text-xs space-y-2">
                <div class="flex items-center justify-between text-slate-300 font-semibold border-b border-slate-800/80 pb-1.5">
                  <span class="flex items-center gap-1.5 text-white">
                    <span>📐</span> Airframe Geometry & Pad Fit (RSO / LCO Review)
                  </span>
                  <span class="text-[10px] text-slate-400 font-normal">Physical Dimensions</span>
                </div>
                <div class="grid grid-cols-2 gap-3 text-slate-200">
                  <div class="bg-slate-900/80 p-2.5 rounded border border-slate-800">
                    <div class="text-[11px] text-slate-400 font-medium">Overall Length</div>
                    <div id="preflight-display-length" class="text-sm font-bold font-mono text-white mt-0.5">
                      ${(() => {
                        const selectedConfigId = initialValues['rocket_configuration_id']
                        const selConfig = selectedConfigId ? configurations.find((c) => c.id === selectedConfigId) : configurations[0]
                        const selRocket = selConfig ? rockets.find((r) => r.id === selConfig.rocketId) : rockets[0]
                        const l = selConfig?.lengthMm ?? selRocket?.lengthMm
                        return l != null ? `${l} mm (${(l / 10).toFixed(1)} cm)` : '—'
                      })()}
                    </div>
                  </div>
                  <div class="bg-slate-900/80 p-2.5 rounded border border-slate-800">
                    <div class="text-[11px] text-slate-400 font-medium">Body Diameter</div>
                    <div id="preflight-display-diameter" class="text-sm font-bold font-mono text-white mt-0.5">
                      ${(() => {
                        const selectedConfigId = initialValues['rocket_configuration_id']
                        const selConfig = selectedConfigId ? configurations.find((c) => c.id === selectedConfigId) : configurations[0]
                        const selRocket = selConfig ? rockets.find((r) => r.id === selConfig.rocketId) : rockets[0]
                        const d = selConfig?.bodyDiameterMm ?? selRocket?.bodyDiameterMm
                        return d != null ? `${d} mm (${(d / 10).toFixed(1)} cm)` : '—'
                      })()}
                    </div>
                  </div>
                </div>
                <p class="text-[10px] text-slate-400">
                  Range Safety Officers (RSO) and Launch Control Officers (LCO) review: Ensure launch rail/rod length provides safe guide velocity (≥ 3× rocket length recommended) and pad blast standoff is adequate.
                </p>
              </div>
            </div>

            <!-- Motor Selector with Responsive Search Filter & Unified Inventory Linkage (R2) -->
            <div class="space-y-1.5">
              <div class="flex items-center justify-between">
                <label for="motor_id" class="block text-sm font-medium text-slate-200">
                  Motor Model <span class="text-rose-400">*</span>
                </label>
                <span id="motor-filter-count" class="text-xs text-slate-400 font-mono hidden"></span>
              </div>
              <!-- Fast Searchable Motor Filter Input -->
              <div>
                <input
                  type="text"
                  id="motor-search-filter"
                  placeholder="Filter motors by designation, manufacturer, diameter (e.g. H128, AeroTech, 29mm)..."
                  autocomplete="off"
                  class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 font-sans"
                />
              </div>
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
                <option id="motor-filter-no-match" value="" disabled class="text-slate-500 italic hidden">
                  No matching motors found
                </option>
                ${motors.map((m) => {
                  const selected = initialValues['motor_id'] === m.id ? 'selected' : ''
                  const impulseLabel = m.impulseClass ? `[${m.impulseClass}]` : ''
                  const delayLabel = m.delayS != null ? `-${m.delayS}` : ''
                  const diameterLabel = m.diameterMm != null ? ` (${m.diameterMm}mm)` : ''
                  const diameterSearch = m.diameterMm != null ? `${m.diameterMm}mm ${m.diameterMm}` : ''
                  const normalizedModel = m.model.replace(/[-_]/g, '')
                  const searchTerms = `${m.manufacturer} ${m.model} ${normalizedModel} ${m.impulseClass || ''} ${delayLabel} ${diameterSearch}`.toLowerCase()

                  const matchingInv = inventories.find((inv) => inv.motorId === m.id && inv.quantityOnHand > 0)
                  const stockCount = matchingInv ? matchingInv.quantityOnHand : 0
                  const stockBadge = stockCount > 0 ? ` — [In Stock: ${stockCount}]` : ''
                  const invId = matchingInv ? matchingInv.id : ''

                  return html`
                    <option
                      value="${m.id}"
                      ${selected}
                      data-search="${searchTerms}"
                      data-mfr="${m.manufacturer}"
                      data-model="${m.model}"
                      data-diameter="${m.diameterMm ?? ''}"
                      data-impulse="${m.impulseClass ?? ''}"
                      data-stock="${stockCount}"
                      data-inventory-id="${invId}"
                    >
                      ${m.manufacturer} ${m.model}${delayLabel} ${impulseLabel}${diameterLabel}${stockBadge}
                    </option>
                  `
                })}
              </select>

              <!-- Hidden motor_inventory_id linked to selected motor's inventory -->
              <input type="hidden" name="motor_inventory_id" id="motor_inventory_id" value="${initialValues['motor_inventory_id'] ?? ''}" />

              <!-- Dynamic live on-hand stock status badge / card -->
              <div id="motor-stock-status" class="mt-1.5 text-xs"></div>
            </div>

            <!-- Expected / Target Altitude — Dual Units (Meters & Feet) (R2) -->
            <div>
              <label class="block text-sm font-medium text-slate-200 mb-1">
                Peak / Expected Altitude (AGL) <span class="text-rose-400">*</span>
                <span class="text-xs text-slate-400 font-normal ml-1">(Dual units: auto-calculates between meters and feet)</span>
              </label>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <div class="relative rounded-lg shadow-sm">
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
                      class="w-full bg-slate-900 border border-slate-700 rounded-lg pl-3 pr-8 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono"
                    />
                    <div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-xs text-slate-400 font-semibold">
                      m
                    </div>
                  </div>
                  <span class="text-[11px] text-slate-400 mt-0.5 block">Meters (canonical)</span>
                </div>
                <div>
                  <div class="relative rounded-lg shadow-sm">
                    <input
                      type="number"
                      step="any"
                      name="altitude_agl_ft"
                      id="altitude_agl_ft"
                      placeholder="e.g. 2788"
                      value="${(() => {
                        const mVal = initialValues['altitude_agl_m'] ?? initialValues['expected_altitude_m']
                        if (mVal !== undefined && mVal !== null && mVal !== '' && !isNaN(Number(mVal))) {
                          return (Number(mVal) * 3.28084).toFixed(1)
                        }
                        return initialValues['altitude_agl_ft'] ?? ''
                      })()}"
                      class="w-full bg-slate-900 border border-slate-700 rounded-lg pl-3 pr-8 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono"
                    />
                    <div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-xs text-slate-400 font-semibold">
                      ft
                    </div>
                  </div>
                  <span class="text-[11px] text-slate-400 mt-0.5 block">Feet</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Section 1b: Airframe & Build Specifications -->
          <div class="space-y-4 pt-4 border-t border-slate-700/60">
            <h3 class="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <span>🛠️</span> Airframe & Build Specifications
            </h3>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <!-- Maiden Voyage Toggle -->
              <div class="sm:col-span-1 flex items-center">
                <div class="flex items-center gap-3 p-3 bg-slate-900/80 border border-slate-700/80 rounded-lg w-full">
                  <input
                    type="checkbox"
                    name="is_first_flight"
                    id="is_first_flight"
                    value="true"
                    ${(initialValues['is_first_flight'] || initialValues['isFirstFlight']) ? 'checked' : ''}
                    class="h-4 w-4 rounded border-slate-700 text-brand-500 focus:ring-brand-400 bg-slate-950 cursor-pointer"
                  />
                  <label for="is_first_flight" class="text-sm font-medium text-slate-200 cursor-pointer select-none">
                    ✨ Maiden Voyage (First Flight)
                  </label>
                </div>
              </div>

              <!-- Certification Attempt -->
              <div>
                <label for="cert_attempt" class="block text-sm font-medium text-slate-200 mb-1">
                  Certification Attempt
                </label>
                <select
                  name="cert_attempt"
                  id="cert_attempt"
                  class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                >
                  <option value="none" ${(initialValues['cert_attempt'] ?? initialValues['certAttempt'] ?? 'none') === 'none' ? 'selected' : ''}>
                    None (Standard Sport Flight)
                  </option>
                  <option value="mpr" ${(initialValues['cert_attempt'] ?? initialValues['certAttempt']) === 'mpr' ? 'selected' : ''}>
                    Junior / Mid-Power (MPR)
                  </option>
                  <option value="l1" ${(initialValues['cert_attempt'] ?? initialValues['certAttempt']) === 'l1' ? 'selected' : ''}>
                    Level 1 (H, I Impulse)
                  </option>
                  <option value="l2" ${(initialValues['cert_attempt'] ?? initialValues['certAttempt']) === 'l2' ? 'selected' : ''}>
                    Level 2 (J, K, L Impulse)
                  </option>
                  <option value="l3" ${(initialValues['cert_attempt'] ?? initialValues['certAttempt']) === 'l3' ? 'selected' : ''}>
                    Level 3 (M, N, O Impulse)
                  </option>
                </select>
              </div>

              <!-- Build Type -->
              <div>
                <label for="build_type" class="block text-sm font-medium text-slate-200 mb-1">
                  Build Type
                </label>
                <select
                  name="build_type"
                  id="build_type"
                  class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                >
                  <option value="">Select build type...</option>
                  <option value="rtf" ${(initialValues['build_type'] ?? initialValues['buildType']) === 'rtf' ? 'selected' : ''}>
                    RTF (Ready-to-Fly / Commercial)
                  </option>
                  <option value="kit" ${(initialValues['build_type'] ?? initialValues['buildType']) === 'kit' ? 'selected' : ''}>
                    Commercial Kit
                  </option>
                  <option value="modified" ${(initialValues['build_type'] ?? initialValues['buildType']) === 'modified' ? 'selected' : ''}>
                    Modified Kit
                  </option>
                  <option value="scratch_built" ${(initialValues['build_type'] ?? initialValues['buildType']) === 'scratch_built' ? 'selected' : ''}>
                    Scratch Built / Custom
                  </option>
                </select>
              </div>
            </div>
          </div>

          <!-- Section 1c: Stability & Preflight -->
          <div class="space-y-4 pt-4 border-t border-slate-700/60">
            <h3 class="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <span>📐</span> Stability & Preflight Check
            </h3>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <!-- Stability Check Method -->
              <div>
                <label for="stability_check_method" class="block text-sm font-medium text-slate-200 mb-1">
                  Stability Verification Method
                </label>
                <input
                  list="stability-methods"
                  name="stability_check_method"
                  id="stability_check_method"
                  placeholder="e.g. OpenRocket, Rocksim, AltiCal, RasAero..."
                  value="${initialValues['stability_check_method'] ?? initialValues['stabilityCheckMethod'] ?? ''}"
                  class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                />
                <datalist id="stability-methods">
                  <option value="OpenRocket" />
                  <option value="Rocksim" />
                  <option value="AltiCal" />
                  <option value="RasAero" />
                  <option value="Barrowman Equation" />
                  <option value="Swing Test / Cutout" />
                </datalist>
                <p class="text-[11px] text-slate-400 mt-1">
                  Simulation or calculation method used to verify aerodynamic stability.
                </p>
              </div>

              <!-- Stability Margin -->
              <div>
                <label for="stability_margin" class="block text-sm font-medium text-slate-200 mb-1">
                  Stability Margin (Calibers)
                </label>
                <input
                  type="number"
                  step="0.01"
                  name="stability_margin"
                  id="stability_margin"
                  placeholder="e.g. 1.80"
                  value="${initialValues['stability_margin'] ?? initialValues['stabilityMargin'] ?? ''}"
                  class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono"
                />
                <p class="text-[11px] text-slate-400 mt-1">
                  Calibers of stability recorded for this specific flight configuration.
                </p>
              </div>
            </div>
          </div>

          <!-- Section 1d: Propulsion & Range Specification -->
          <div class="space-y-4 pt-4 border-t border-slate-700/60">
            <h3 class="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <span>⚡</span> Propulsion & Range Parameters
            </h3>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <!-- Motor Type -->
              <div>
                <label for="motor_type" class="block text-sm font-medium text-slate-200 mb-1">
                  Motor Type / Composition
                </label>
                <select
                  name="motor_type"
                  id="motor_type"
                  class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                >
                  <option value="">Select motor composition...</option>
                  <option value="Composite" ${(initialValues['motor_type'] ?? initialValues['motorType']) === 'Composite' ? 'selected' : ''}>Composite</option>
                  <option value="Black Powder" ${(initialValues['motor_type'] ?? initialValues['motorType']) === 'Black Powder' ? 'selected' : ''}>Black Powder</option>
                  <option value="Hybrid" ${(initialValues['motor_type'] ?? initialValues['motorType']) === 'Hybrid' ? 'selected' : ''}>Hybrid</option>
                  <option value="Cluster" ${(initialValues['motor_type'] ?? initialValues['motorType']) === 'Cluster' ? 'selected' : ''}>Cluster</option>
                  <option value="Staged" ${(initialValues['motor_type'] ?? initialValues['motorType']) === 'Staged' ? 'selected' : ''}>Staged</option>
                  <option value="Sparky" ${(initialValues['motor_type'] ?? initialValues['motorType']) === 'Sparky' ? 'selected' : ''}>Sparky</option>
                </select>
              </div>

              <!-- Total Weight (Loaded Mass) -->
              <div>
                <label for="total_weight_g" class="block text-sm font-medium text-slate-200 mb-1">
                  Total Pad Weight (Loaded, g)
                </label>
                <input
                  type="number"
                  step="any"
                  name="total_weight_g"
                  id="total_weight_g"
                  placeholder="e.g. 1250"
                  value="${initialValues['total_weight_g'] ?? initialValues['totalWeightG'] ?? ''}"
                  class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono"
                />
                <p class="text-[11px] text-slate-400 mt-1">Pre-launch all-up mass in grams.</p>
              </div>

              <!-- Pad Number -->
              <div>
                <label for="pad_number" class="block text-sm font-medium text-slate-200 mb-1">
                  Launch Pad Designation
                </label>
                <input
                  type="text"
                  name="pad_number"
                  id="pad_number"
                  placeholder="e.g. A1, A2, B3, Own"
                  value="${initialValues['pad_number'] ?? initialValues['padNumber'] ?? ''}"
                  class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono"
                />
                <p class="text-[11px] text-slate-400 mt-1">Designated launch pad or rack position.</p>
              </div>
            </div>
          </div>

          <!-- Section 1e: Recovery Configuration -->
          <div class="space-y-4 pt-4 border-t border-slate-700/60">
            <h3 class="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <span>🪂</span> Recovery Configuration
            </h3>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <!-- Recovery System -->
              <div>
                <label for="recovery_system" class="block text-sm font-medium text-slate-200 mb-1">
                  Recovery System
                </label>
                <select
                  name="recovery_system"
                  id="recovery_system"
                  class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                >
                  <option value="">Select recovery system...</option>
                  <option value="Chute(s)" ${(initialValues['recovery_system'] ?? initialValues['recoverySystem']) === 'Chute(s)' ? 'selected' : ''}>Chute(s)</option>
                  <option value="Streamer" ${(initialValues['recovery_system'] ?? initialValues['recoverySystem']) === 'Streamer' ? 'selected' : ''}>Streamer</option>
                  <option value="Tumble" ${(initialValues['recovery_system'] ?? initialValues['recoverySystem']) === 'Tumble' ? 'selected' : ''}>Tumble</option>
                  <option value="Other" ${(initialValues['recovery_system'] ?? initialValues['recoverySystem']) === 'Other' ? 'selected' : ''}>Other</option>
                </select>
              </div>

              <!-- Recovery Device Size -->
              <div>
                <label for="recovery_size" class="block text-sm font-medium text-slate-200 mb-1">
                  Recovery Device Size
                </label>
                <input
                  type="text"
                  name="recovery_size"
                  id="recovery_size"
                  placeholder='e.g. 24", 36", 50cm'
                  value="${initialValues['recovery_size'] ?? initialValues['recoverySize'] ?? ''}"
                  class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                />
              </div>

              <!-- Deployment Method -->
              <div>
                <label for="deployment_method" class="block text-sm font-medium text-slate-200 mb-1">
                  Deployment Method
                </label>
                <select
                  name="deployment_method"
                  id="deployment_method"
                  class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                >
                  <option value="">Select deployment method...</option>
                  <option value="Motor eject" ${(initialValues['deployment_method'] ?? initialValues['deploymentMethod']) === 'Motor eject' ? 'selected' : ''}>Motor eject</option>
                  <option value="Chute Release" ${(initialValues['deployment_method'] ?? initialValues['deploymentMethod']) === 'Chute Release' ? 'selected' : ''}>Chute Release</option>
                  <option value="Electronic deploy" ${(initialValues['deployment_method'] ?? initialValues['deploymentMethod']) === 'Electronic deploy' ? 'selected' : ''}>Electronic deploy</option>
                </select>
              </div>

              <!-- Main Chute Deploy Altitude -->
              <div>
                <label for="main_deploy_altitude" class="block text-sm font-medium text-slate-200 mb-1">
                  Main Chute Deploy Alt
                </label>
                <input
                  type="text"
                  name="main_deploy_altitude"
                  id="main_deploy_altitude"
                  placeholder="e.g. 500 ft, 150m, Apogee"
                  value="${initialValues['main_deploy_altitude'] ?? initialValues['mainDeployAltitude'] ?? ''}"
                  class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                />
              </div>
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
                  const dateText = e.startsOn
                    ? e.endsOn && e.endsOn !== e.startsOn
                      ? `${e.startsOn} to ${e.endsOn}`
                      : e.startsOn
                    : 'Date TBD'
                  const siteText = e.siteName || 'No site'
                  return html`
                    <option value="${e.id}" ${selected} data-rso="${e.rsoName || ''}" data-lco="${e.lcoName || ''}" data-site="${e.launchSiteId || ''}">
                      ${e.name} (${dateText}) — ${siteText}
                    </option>
                  `
                })}
              </select>
            </div>
          </div>
        </div>

        <!-- Section 2b: Range Safety & Duty Officers -->
        <div class="space-y-4">
          <h2 class="text-base font-semibold text-white border-b border-slate-700/60 pb-2 flex items-center justify-between">
            <span class="flex items-center gap-2">
              <span>🛡️</span> Range Safety & Duty Officers
            </span>
            <span class="text-xs font-normal text-slate-400">Duty officers rotate throughout meet</span>
          </h2>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <!-- Range Safety Officer (RSO) -->
            <div>
              <label for="rso_name" class="block text-sm font-medium text-slate-200 mb-1">
                Range Safety Officer (RSO)
              </label>
              <input
                type="text"
                name="rso_name"
                id="rso_name"
                placeholder="e.g. Jane Doe"
                value="${initialValues['rso_name'] ?? initialValues['rsoName'] ?? ''}"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
              />
              <p class="text-[11px] text-slate-400 mt-1">
                Active Range Safety Officer name or callsign for this flight.
              </p>
            </div>

            <!-- Launch Control Officer (LCO) -->
            <div>
              <label for="lco_name" class="block text-sm font-medium text-slate-200 mb-1">
                Launch Control Officer (LCO)
              </label>
              <input
                type="text"
                name="lco_name"
                id="lco_name"
                placeholder="e.g. John Smith"
                value="${initialValues['lco_name'] ?? initialValues['lcoName'] ?? ''}"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
              />
              <p class="text-[11px] text-slate-400 mt-1">
                Active Launch Control Officer name or callsign for this flight.
              </p>
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
                <option value="GOOD" ${(initialValues['outcome'] === 'GOOD' || initialValues['outcome'] === 'successful' || !initialValues['outcome']) ? 'selected' : ''}>
                  ✓ GOOD (Nominal Flight & Recovery)
                </option>
                <option value="CATO" ${initialValues['outcome'] === 'CATO' ? 'selected' : ''}>
                  💥 CATO (Motor Catastrophic Failure)
                </option>
                <option value="Shred" ${initialValues['outcome'] === 'Shred' ? 'selected' : ''}>
                  💥 Shred (In-Flight Structural Failure)
                </option>
                <option value="Unstable" ${initialValues['outcome'] === 'Unstable' ? 'selected' : ''}>
                  ⚠️ Unstable (Tumble / Erratic Flight)
                </option>
                <option value="Zipper" ${initialValues['outcome'] === 'Zipper' ? 'selected' : ''}>
                  ⚠️ Zipper (Body Tube Tear)
                </option>
                <option value="Separation" ${initialValues['outcome'] === 'Separation' ? 'selected' : ''}>
                  ⚠️ Separation (Premature Separation)
                </option>
                <option value="No chute" ${initialValues['outcome'] === 'No chute' ? 'selected' : ''}>
                  🪂 No chute (Deployment Failure)
                </option>
                <option value="Tangled" ${initialValues['outcome'] === 'Tangled' ? 'selected' : ''}>
                  🪢 Tangled (Fouled Lines / Shroud Knot)
                </option>
                <option value="Lawn Dart" ${initialValues['outcome'] === 'Lawn Dart' ? 'selected' : ''}>
                  🎯 Lawn Dart (Ballistic Impact)
                </option>
                <option value="Retention fail" ${initialValues['outcome'] === 'Retention fail' ? 'selected' : ''}>
                  ⚠️ Retention fail (Motor Retainer Released)
                </option>
                <option value="No ignition" ${initialValues['outcome'] === 'No ignition' ? 'selected' : ''}>
                  🚫 No ignition (Pad Misfire)
                </option>
                <!-- Legacy compatibility values -->
                <option value="successful" ${initialValues['outcome'] === 'successful' ? 'selected' : ''}>
                  ✓ Successful (Legacy)
                </option>
                <option value="recovery_failure" ${initialValues['outcome'] === 'recovery_failure' ? 'selected' : ''}>
                  ⚠️ Recovery Failure (Legacy)
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
            href="${isEdit ? `/flights/${flightId}` : '/flights'}"
            class="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </a>
          <button
            type="submit"
            class="inline-flex items-center px-6 py-2.5 text-sm font-bold rounded-lg bg-brand-400 hover:bg-brand-300 text-slate-950 shadow-md transition-colors"
          >
            <span class="mr-1.5 font-extrabold">${isEdit ? '💾' : '+'}</span>
            ${isEdit ? 'Save Flight Changes' : 'Submit Flight Log'}
          </button>
        </div>
      </form>

      <!-- Client-side Motor Search Filter Script (R2) -->
      <script>
        // Bi-directional Dual Altitude Sync (m <-> ft) (R2)
        function initDualAltitudeSync() {
          var mInput = document.getElementById('altitude_agl_m');
          var ftInput = document.getElementById('altitude_agl_ft');
          if (!mInput || !ftInput) return;

          var isSyncing = false;

          mInput.addEventListener('input', function() {
            if (isSyncing) return;
            isSyncing = true;
            var val = mInput.value.trim();
            if (val !== '' && !isNaN(Number(val))) {
              var mVal = parseFloat(val);
              ftInput.value = (mVal * 3.28084).toFixed(1);
            } else {
              ftInput.value = '';
            }
            isSyncing = false;
          });

          ftInput.addEventListener('input', function() {
            if (isSyncing) return;
            isSyncing = true;
            var val = ftInput.value.trim();
            if (val !== '' && !isNaN(Number(val))) {
              var ftVal = parseFloat(val);
              mInput.value = (ftVal * 0.3048).toFixed(1);
              // Dispatch native change event so HTMX soft-gate check triggers
              mInput.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              mInput.value = '';
              mInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
            isSyncing = false;
          });
        }

        // Unified Motor Stock Badge & Hidden Inventory ID Sync (R2)
        function updateMotorStockStatus() {
          var motorSel = document.getElementById('motor_id');
          var invHidden = document.getElementById('motor_inventory_id');
          var statusEl = document.getElementById('motor-stock-status');
          if (!motorSel || !statusEl) return;

          var opt = motorSel.options[motorSel.selectedIndex];
          if (!opt || !opt.value) {
            statusEl.innerHTML = '';
            if (invHidden) invHidden.value = '';
            return;
          }

          var stock = parseInt(opt.getAttribute('data-stock') || '0', 10);
          var invId = opt.getAttribute('data-inventory-id') || '';

          if (invHidden) invHidden.value = invId;

          if (stock > 0) {
            statusEl.innerHTML =
              '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/60 text-emerald-300 border border-emerald-600/40 font-medium">' +
              '<span>📦</span> In Stock: <strong>' + stock + ' units</strong> on hand (will decrement from inventory upon flight logging)' +
              '</span>';
          } else {
            statusEl.innerHTML =
              '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 text-slate-400 border border-slate-700/60">' +
              '<span>ℹ️</span> Catalog specification only (no inventory units on hand; logged as untracked motor)' +
              '</span>';
          }
        }

        (function() {
          function initMotorSearchFilter() {
            var filterInput = document.getElementById('motor-search-filter');
            var motorSelect = document.getElementById('motor_id');
            var countBadge = document.getElementById('motor-filter-count');
            var noMatchOpt = document.getElementById('motor-filter-no-match');
            if (!filterInput || !motorSelect) return;

            motorSelect.addEventListener('change', updateMotorStockStatus);
            updateMotorStockStatus();

            function filterMotors() {
              var rawQuery = (filterInput.value || '').trim().toLowerCase();
              var terms = rawQuery ? rawQuery.split(/\s+/).filter(Boolean) : [];
              var options = motorSelect.querySelectorAll('option');
              var matchCount = 0;
              var totalCount = 0;

              options.forEach(function(opt) {
                // Skip placeholder and no-match dummy options
                if (!opt.value || opt.id === 'motor-filter-no-match') return;
                totalCount++;

                if (terms.length === 0) {
                  opt.hidden = false;
                  opt.style.display = '';
                  matchCount++;
                  return;
                }

                var searchIndex = (opt.getAttribute('data-search') || opt.textContent || '').toLowerCase();
                var matches = terms.every(function(term) {
                  return searchIndex.indexOf(term) !== -1;
                });

                if (matches) {
                  opt.hidden = false;
                  opt.style.display = '';
                  matchCount++;
                } else {
                  opt.hidden = true;
                  opt.style.display = 'none';
                }
              });

              if (noMatchOpt) {
                var showNoMatch = terms.length > 0 && matchCount === 0;
                noMatchOpt.hidden = !showNoMatch;
                noMatchOpt.style.display = showNoMatch ? '' : 'none';
              }

              if (countBadge) {
                if (terms.length > 0) {
                  countBadge.textContent = matchCount + ' of ' + totalCount + ' motors';
                  countBadge.classList.remove('hidden');
                } else {
                  countBadge.textContent = '';
                  countBadge.classList.add('hidden');
                }
              }
            }

            filterInput.addEventListener('input', filterMotors);

            filterInput.addEventListener('keydown', function(e) {
              if (e.key === 'Enter') {
                e.preventDefault();
                var visibleOpts = Array.from(motorSelect.querySelectorAll('option')).filter(function(opt) {
                  return opt.value && !opt.hidden && opt.style.display !== 'none' && opt.id !== 'motor-filter-no-match';
                });
                if (visibleOpts.length === 1) {
                  motorSelect.value = visibleOpts[0].value;
                  motorSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
              } else if (e.key === 'Escape') {
                filterInput.value = '';
                filterMotors();
              }
            });
          }

          function initEventDutyOfficerAutofill() {
            var eventSel = document.getElementById('launch_event_id');
            var rsoInput = document.getElementById('rso_name');
            var lcoInput = document.getElementById('lco_name');
            var siteSel = document.getElementById('launch_site_id');
            if (!eventSel) return;

            eventSel.addEventListener('change', function() {
              var opt = eventSel.options[eventSel.selectedIndex];
              if (!opt || !opt.value) return;

              var rso = opt.getAttribute('data-rso') || '';
              var lco = opt.getAttribute('data-lco') || '';
              var siteId = opt.getAttribute('data-site') || '';

              if (rsoInput && rso) {
                rsoInput.value = rso;
              }
              if (lcoInput && lco) {
                lcoInput.value = lco;
              }
              if (siteSel && siteId && !siteSel.value) {
                siteSel.value = siteId;
                siteSel.dispatchEvent(new Event('change', { bubbles: true }));
              }
            });
          }

          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
              initMotorSearchFilter();
              initDualAltitudeSync();
              initEventDutyOfficerAutofill();
            });
          } else {
            initMotorSearchFilter();
            initDualAltitudeSync();
            initEventDutyOfficerAutofill();
          }
        })();

        function updatePreflightGeometryDisplay() {
          var sel = document.getElementById('rocket_configuration_id');
          var lenEl = document.getElementById('preflight-display-length');
          var diamEl = document.getElementById('preflight-display-diameter');
          if (!sel || !lenEl || !diamEl) return;
          var opt = sel.options[sel.selectedIndex];
          if (opt && opt.dataset && (opt.dataset.length || opt.dataset.diameter)) {
            var l = opt.dataset.length ? parseFloat(opt.dataset.length) : null;
            var d = opt.dataset.diameter ? parseFloat(opt.dataset.diameter) : null;
            lenEl.textContent = l != null && !isNaN(l) ? l + ' mm (' + (l / 10).toFixed(1) + ' cm)' : '—';
            diamEl.textContent = d != null && !isNaN(d) ? d + ' mm (' + (d / 10).toFixed(1) + ' cm)' : '—';
          } else {
            lenEl.textContent = '—';
            diamEl.textContent = '—';
          }
        }
        (function() {
          var sel = document.getElementById('rocket_configuration_id');
          if (sel) {
            sel.addEventListener('change', updatePreflightGeometryDisplay);
            updatePreflightGeometryDisplay();
          }
        })();
      </script>
    </div>
  `
}
