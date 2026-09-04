/**
 * HTML Views for Rocket Airframes & Versioned Configurations (Milestone 2).
 *
 * Implements server-rendered views with hono/html:
 * - rocketsListView: Fleet listing with status badges, configuration summaries, and flight counts.
 * - rocketDetailView: Detailed airframe view with active configuration summary and full version history table.
 * - newRocketFormView: Seamless single form creating airframe + initial v1 snapshot.
 * - newConfigFormView: Add configuration snapshot v(N+1) pre-populated from previous version.
 * - editRocketFormView: Edit airframe metadata (name and operational status).
 */

import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'

export type RocketStatusType = 'flight_ready' | 'in_build' | 'damaged' | 'retired'
export type RecoveryType = 'parachute' | 'streamer' | 'dual_deploy' | 'tumble' | 'other'

export interface RocketConfigSummary {
  id?: string
  version: number
  dryMassG?: number | null
  loadedMassG?: number | null
  ballastG?: number | null
  cgMm?: number | null
  cpMm?: number | null
  stabilityCalibers?: number | null
  recoveryType?: string | null
  parachuteSizeMm?: number | null
  motorMountDiameterMm?: number | null
  airframeMaterial?: string | null
  finCount?: number | null
  isCurrent?: boolean
  createdAt?: number | null
}

export interface RocketListItem {
  id: string
  name: string
  status: RocketStatusType | string
  currentConfig?: RocketConfigSummary | null
  flightCount: number
}

export interface RocketDetailProps {
  rocket: {
    id: string
    name: string
    status: RocketStatusType | string
    ownerId: string
    createdAt?: number | null
    updatedAt?: number | null
  }
  configurations: RocketConfigSummary[]
  flightCount: number
  ownerName?: string
}

export function formatRecoveryType(type?: string | null): string {
  if (!type) return '—'
  switch (type.toLowerCase()) {
    case 'parachute':
      return 'Parachute'
    case 'streamer':
      return 'Streamer'
    case 'dual_deploy':
      return 'Dual Deploy'
    case 'tumble':
      return 'Tumble'
    case 'other':
      return 'Other'
    default:
      return type
  }
}

export function renderStatusBadge(status?: string | null) {
  if (!status) {
    return html`<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-700/50 text-slate-300 border border-slate-600/30">Unknown</span>`
  }

  const s = status.toLowerCase()
  switch (s) {
    case 'flight_ready':
      return html`<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">✓ Flight Ready</span>`
    case 'in_build':
      return html`<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-500/20 text-sky-400 border border-sky-500/30">🔧 In Build</span>`
    case 'damaged':
      return html`<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/30">⚠️ Damaged</span>`
    case 'retired':
      return html`<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-700/40 text-slate-400 border border-slate-600/30">💤 Retired</span>`
    default:
      return html`<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-700/40 text-slate-300 border border-slate-600/30">${status.replace('_', ' ')}</span>`
  }
}

export function renderStabilityBadge(calibers?: number | null) {
  if (calibers == null) {
    return html`<span class="text-slate-400">—</span>`
  }
  const formatted = calibers.toFixed(2)
  if (calibers < 1.0) {
    return html`<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30" title="Stability margin is below the recommended 1.0 caliber">⚠️ ${formatted} cal (Marginal)</span>`
  }
  return html`<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">✓ ${formatted} cal</span>`
}

function formatDate(epochMs?: number | null): string {
  if (!epochMs) return '—'
  try {
    return new Date(epochMs).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return '—'
  }
}

/**
 * 1. Fleet List View: Table/card grid of user rockets with status badges,
 * current configuration summary, flight count, and link to new rocket form.
 */
export function rocketsListView(rockets: RocketListItem[]): HtmlEscapedString | Promise<HtmlEscapedString> {
  return html`
    <div class="space-y-6">
      <!-- Top Navigation & Action Header -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 class="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">🚀 Rocket Fleet & Airframes</h1>
          <p class="mt-1 text-sm text-slate-400">
            Manage your fleet of airframes and maintain versioned aerodynamic and mass configuration snapshots.
          </p>
        </div>
        <div class="flex items-center space-x-3">
          <a
            href="/rockets/new"
            class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-semibold rounded-lg shadow-sm text-slate-950 bg-brand-400 hover:bg-brand-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 focus:ring-offset-slate-900 transition-colors"
          >
            <span class="mr-1.5 text-base">+</span> New Rocket
          </a>
        </div>
      </div>

      ${rockets.length === 0
        ? html`
            <div class="bg-slate-950/60 border border-slate-800 rounded-xl p-12 text-center max-w-xl mx-auto my-8">
              <span class="text-4xl mb-3 block">🛰️</span>
              <h2 class="text-xl font-bold text-white mb-2">No Rockets in Fleet</h2>
              <p class="text-slate-400 text-sm mb-6">
                Your hangar is currently empty. Register your first rocket airframe to establish baseline mass and aerodynamic parameters, then begin logging flights.
              </p>
              <a
                href="/rockets/new"
                class="inline-flex items-center px-4 py-2 text-sm font-semibold rounded-lg text-slate-950 bg-brand-400 hover:bg-brand-300 transition-colors"
              >
                + Register First Rocket
              </a>
            </div>
          `
        : html`
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              ${rockets.map((rocket) => {
                const cfg = rocket.currentConfig
                return html`
                  <div class="bg-slate-950/80 border border-slate-800 hover:border-slate-700 rounded-xl p-5 flex flex-col justify-between transition-all duration-200 shadow-sm hover:shadow-md">
                    <div>
                      <!-- Card Header: Name, Status & Flight Count -->
                      <div class="flex items-start justify-between gap-2 mb-3">
                        <div>
                          <a
                            href="/rockets/${rocket.id}"
                            class="text-lg font-bold text-white hover:text-brand-400 transition-colors line-clamp-1"
                            title="${rocket.name}"
                          >
                            ${rocket.name}
                          </a>
                          <div class="mt-1">
                            ${renderStatusBadge(rocket.status)}
                          </div>
                        </div>
                        <span class="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700/60 whitespace-nowrap">
                          ${rocket.flightCount} ${rocket.flightCount === 1 ? 'flight' : 'flights'}
                        </span>
                      </div>

                      <!-- Current Configuration Snapshot Details -->
                      <div class="mt-4 pt-3 border-t border-slate-800/80">
                        ${cfg
                          ? html`
                              <div class="flex items-center justify-between mb-2">
                                <span class="text-xs font-semibold uppercase tracking-wider text-slate-400">
                                  Current Config
                                </span>
                                <span class="text-xs font-bold text-brand-400 bg-brand-950/80 px-2 py-0.5 rounded border border-brand-800/50">
                                  v${cfg.version}
                                </span>
                              </div>

                              <dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                                <div>
                                  <dt class="text-slate-500">Dry / Loaded Mass</dt>
                                  <dd class="font-medium text-slate-200">
                                    ${cfg.dryMassG != null ? `${cfg.dryMassG}g` : '—'} /
                                    ${cfg.loadedMassG != null ? `${cfg.loadedMassG}g` : '—'}
                                  </dd>
                                </div>
                                <div>
                                  <dt class="text-slate-500">Stability</dt>
                                  <dd class="font-medium">
                                    ${cfg.stabilityCalibers != null
                                      ? cfg.stabilityCalibers < 1.0
                                        ? html`<span class="text-amber-400 font-bold">⚠️ ${cfg.stabilityCalibers.toFixed(2)} cal</span>`
                                        : html`<span class="text-emerald-400 font-semibold">${cfg.stabilityCalibers.toFixed(2)} cal</span>`
                                      : html`<span class="text-slate-400">—</span>`}
                                  </dd>
                                </div>
                                <div>
                                  <dt class="text-slate-500">CG / CP</dt>
                                  <dd class="font-medium text-slate-200">
                                    ${cfg.cgMm != null ? `${cfg.cgMm}mm` : '—'} /
                                    ${cfg.cpMm != null ? `${cfg.cpMm}mm` : '—'}
                                  </dd>
                                </div>
                                <div>
                                  <dt class="text-slate-500">Motor Mount</dt>
                                  <dd class="font-medium text-slate-200">
                                    ${cfg.motorMountDiameterMm != null ? `${cfg.motorMountDiameterMm}mm` : '—'}
                                  </dd>
                                </div>
                                <div class="col-span-2">
                                  <dt class="text-slate-500">Recovery</dt>
                                  <dd class="font-medium text-slate-200">
                                    ${formatRecoveryType(cfg.recoveryType)}
                                    ${cfg.parachuteSizeMm != null ? ` (${cfg.parachuteSizeMm}mm chute)` : ''}
                                  </dd>
                                </div>
                              </dl>
                            `
                          : html`
                              <p class="text-xs text-slate-500 italic py-2">
                                No configuration snapshots created yet.
                              </p>
                            `}
                      </div>
                    </div>

                    <!-- Card Actions -->
                    <div class="mt-5 pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
                      <a
                        href="/rockets/${rocket.id}"
                        class="text-xs font-semibold text-brand-400 hover:text-brand-300 transition-colors"
                      >
                        View Airframe & Configs →
                      </a>
                      <a
                        href="/rockets/${rocket.id}/configurations/new"
                        class="text-xs font-medium text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 px-2.5 py-1 rounded border border-slate-800 transition-colors"
                      >
                        + New Snapshot
                      </a>
                    </div>
                  </div>
                `
              })}
            </div>
          `}
    </div>
  `
}

/**
 * 2. Rocket Detail View: Detailed airframe view with status, owner, edit link,
 * active configuration spotlight, and complete version history table of all
 * rocket_configurations snapshots (v1, v2, etc.).
 */
export function rocketDetailView(props: RocketDetailProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { rocket, configurations, flightCount, ownerName } = props
  const activeConfig = configurations.find((c) => c.isCurrent) || configurations[0]

  return html`
    <div class="space-y-8">
      <!-- Breadcrumb & Back Link -->
      <nav class="flex items-center space-x-2 text-sm text-slate-400" aria-label="Breadcrumb">
        <a href="/rockets" class="hover:text-white transition-colors">Rockets</a>
        <span>/</span>
        <span class="text-white font-medium truncate">${rocket.name}</span>
      </nav>

      <!-- Airframe Overview Banner -->
      <div class="bg-slate-950 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div class="flex flex-wrap items-center gap-3">
              <h1 class="text-3xl font-extrabold text-white tracking-tight">${rocket.name}</h1>
              ${renderStatusBadge(rocket.status)}
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-400">
              <span>Owner: <strong class="text-slate-200">${ownerName || 'TripleT Pilot'}</strong></span>
              <span>•</span>
              <span>Total Flights: <strong class="text-slate-200">${flightCount}</strong></span>
              ${rocket.createdAt
                ? html`
                    <span>•</span>
                    <span>Added: <strong class="text-slate-200">${formatDate(rocket.createdAt)}</strong></span>
                  `
                : ''}
            </div>
          </div>

          <!-- Airframe Header Actions -->
          <div class="flex flex-wrap items-center gap-2.5">
            <a
              href="/rockets/${rocket.id}/configurations/new"
              class="inline-flex items-center px-3.5 py-2 border border-transparent text-sm font-semibold rounded-lg shadow-sm text-slate-950 bg-brand-400 hover:bg-brand-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 focus:ring-offset-slate-900 transition-colors"
            >
              <span class="mr-1.5 text-base">+</span> Add New Configuration Snapshot
            </a>
            <a
              href="/rockets/${rocket.id}/edit"
              class="inline-flex items-center px-3 py-2 border border-slate-700 text-sm font-medium rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              Edit Airframe
            </a>
            <a
              href="/flights/new?rocket_id=${rocket.id}"
              class="inline-flex items-center px-3 py-2 border border-slate-700 text-sm font-medium rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              Log Flight
            </a>
          </div>
        </div>

        <!-- Current Active Configuration Spotlight -->
        ${activeConfig
          ? html`
              <div class="mt-5">
                <div class="flex items-center justify-between mb-3">
                  <h2 class="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    <span>Active Configuration Spotlight</span>
                    <span class="text-brand-400 font-extrabold bg-brand-950/80 px-2.5 py-0.5 rounded text-xs border border-brand-800/50">
                      v${activeConfig.version} (Version ${activeConfig.version})
                    </span>
                  </h2>
                  <span class="text-xs text-slate-400">
                    Snapshot baseline for preflight validation & flight logging
                  </span>
                </div>

                <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div class="bg-slate-900/90 border border-slate-800 rounded-lg p-3">
                    <div class="text-xs text-slate-400">Stability Margin</div>
                    <div class="mt-1">
                      ${renderStabilityBadge(activeConfig.stabilityCalibers)}
                    </div>
                  </div>
                  <div class="bg-slate-900/90 border border-slate-800 rounded-lg p-3">
                    <div class="text-xs text-slate-400">Dry Mass</div>
                    <div class="mt-1 text-base font-bold text-white">
                      ${activeConfig.dryMassG != null ? `${activeConfig.dryMassG} g` : '—'}
                    </div>
                  </div>
                  <div class="bg-slate-900/90 border border-slate-800 rounded-lg p-3">
                    <div class="text-xs text-slate-400">Loaded Mass</div>
                    <div class="mt-1 text-base font-bold text-white">
                      ${activeConfig.loadedMassG != null ? `${activeConfig.loadedMassG} g` : '—'}
                    </div>
                  </div>
                  <div class="bg-slate-900/90 border border-slate-800 rounded-lg p-3">
                    <div class="text-xs text-slate-400">Center of Gravity (CG)</div>
                    <div class="mt-1 text-base font-bold text-white">
                      ${activeConfig.cgMm != null ? `${activeConfig.cgMm} mm` : '—'}
                    </div>
                  </div>
                  <div class="bg-slate-900/90 border border-slate-800 rounded-lg p-3">
                    <div class="text-xs text-slate-400">Center of Pressure (CP)</div>
                    <div class="mt-1 text-base font-bold text-white">
                      ${activeConfig.cpMm != null ? `${activeConfig.cpMm} mm` : '—'}
                    </div>
                  </div>
                  <div class="bg-slate-900/90 border border-slate-800 rounded-lg p-3">
                    <div class="text-xs text-slate-400">Motor Mount / Chute</div>
                    <div class="mt-1 text-sm font-semibold text-white">
                      ${activeConfig.motorMountDiameterMm != null ? `${activeConfig.motorMountDiameterMm}mm` : '—'} /
                      ${activeConfig.parachuteSizeMm != null ? `${activeConfig.parachuteSizeMm}mm` : '—'}
                    </div>
                  </div>
                </div>
              </div>
            `
          : ''}
      </div>

      <!-- Configuration Snapshots Version History -->
      <div class="space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 class="text-xl font-bold text-white">Configuration Snapshot History</h2>
            <p class="text-xs text-slate-400">
              Full versioned audit trail of aerodynamic modifications, mass adjustments, and recovery changes.
            </p>
          </div>
          <a
            href="/rockets/${rocket.id}/configurations/new"
            class="text-xs font-semibold text-brand-400 hover:text-brand-300 transition-colors"
          >
            + Add New Configuration Snapshot
          </a>
        </div>

        ${configurations.length === 0
          ? html`
              <div class="bg-slate-950/60 border border-slate-800 rounded-xl p-8 text-center">
                <p class="text-slate-400 text-sm mb-4">
                  No configuration snapshots have been recorded for this rocket yet.
                </p>
                <a
                  href="/rockets/${rocket.id}/configurations/new"
                  class="inline-flex items-center px-4 py-2 text-xs font-semibold rounded-lg text-slate-950 bg-brand-400 hover:bg-brand-300 transition-colors"
                >
                  + Add Version 1 Snapshot
                </a>
              </div>
            `
          : html`
              <div class="overflow-x-auto bg-slate-950 border border-slate-800 rounded-xl shadow-sm">
                <table class="w-full text-left text-xs text-slate-200">
                  <thead class="bg-slate-900/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                    <tr>
                      <th scope="col" class="px-4 py-3">Version</th>
                      <th scope="col" class="px-4 py-3">Active Status</th>
                      <th scope="col" class="px-4 py-3">Dry Mass (g)</th>
                      <th scope="col" class="px-4 py-3">Loaded Mass (g)</th>
                      <th scope="col" class="px-4 py-3">CG (mm)</th>
                      <th scope="col" class="px-4 py-3">CP (mm)</th>
                      <th scope="col" class="px-4 py-3">Stability</th>
                      <th scope="col" class="px-4 py-3">Recovery</th>
                      <th scope="col" class="px-4 py-3">Parachute (mm)</th>
                      <th scope="col" class="px-4 py-3">Motor Mount (mm)</th>
                      <th scope="col" class="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-800">
                    ${configurations.map((cfg) => {
                      return html`
                        <tr class="hover:bg-slate-900/50 transition-colors ${cfg.isCurrent ? 'bg-brand-950/20' : ''}">
                          <!-- Version -->
                          <td class="px-4 py-3.5 whitespace-nowrap font-medium text-white">
                            <span class="inline-flex items-center gap-1">
                              <strong class="text-brand-400 text-sm">v${cfg.version}</strong>
                              <span class="text-slate-400 text-xs font-normal">(Version ${cfg.version})</span>
                            </span>
                          </td>

                          <!-- Active Status Indicator -->
                          <td class="px-4 py-3.5 whitespace-nowrap">
                            ${cfg.isCurrent
                              ? html`<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">✓ Active</span>`
                              : html`
                                  <form action="/rockets/${rocket.id}/configurations/${cfg.id}/set-current" method="POST" class="inline">
                                    <button
                                      type="submit"
                                      class="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
                                      title="Switch active snapshot to v${cfg.version}"
                                    >
                                      Make Active
                                    </button>
                                  </form>
                                `}
                          </td>

                          <!-- Dry Mass (g) -->
                          <td class="px-4 py-3.5 whitespace-nowrap">
                            ${cfg.dryMassG != null ? `${cfg.dryMassG} g` : '—'}
                          </td>

                          <!-- Loaded Mass (g) -->
                          <td class="px-4 py-3.5 whitespace-nowrap">
                            ${cfg.loadedMassG != null ? `${cfg.loadedMassG} g` : '—'}
                          </td>

                          <!-- CG (mm) -->
                          <td class="px-4 py-3.5 whitespace-nowrap">
                            ${cfg.cgMm != null ? `${cfg.cgMm} mm` : '—'}
                          </td>

                          <!-- CP (mm) -->
                          <td class="px-4 py-3.5 whitespace-nowrap">
                            ${cfg.cpMm != null ? `${cfg.cpMm} mm` : '—'}
                          </td>

                          <!-- Stability Calibers -->
                          <td class="px-4 py-3.5 whitespace-nowrap">
                            ${renderStabilityBadge(cfg.stabilityCalibers)}
                          </td>

                          <!-- Recovery Type -->
                          <td class="px-4 py-3.5 whitespace-nowrap">
                            ${formatRecoveryType(cfg.recoveryType)}
                          </td>

                          <!-- Parachute Size (mm) -->
                          <td class="px-4 py-3.5 whitespace-nowrap">
                            ${cfg.parachuteSizeMm != null ? `${cfg.parachuteSizeMm} mm` : '—'}
                          </td>

                          <!-- Motor Mount Diameter (mm) -->
                          <td class="px-4 py-3.5 whitespace-nowrap">
                            ${cfg.motorMountDiameterMm != null ? `${cfg.motorMountDiameterMm} mm` : '—'}
                          </td>

                          <!-- Actions -->
                          <td class="px-4 py-3.5 whitespace-nowrap text-right">
                            <a
                              href="/rockets/${rocket.id}/configurations/new"
                              class="text-xs text-brand-400 hover:text-brand-300 font-medium"
                              title="Branch new snapshot from this airframe"
                            >
                              + New Snapshot
                            </a>
                          </td>
                        </tr>
                      `
                    })}
                  </tbody>
                </table>
              </div>
            `}
      </div>
    </div>
  `
}

/**
 * 3. New Rocket Form View: Seamless form allowing creation of rocket airframe
 * AND initial version 1 configuration snapshot in one single form submission.
 */
export function newRocketFormView(errorMessage?: string): HtmlEscapedString | Promise<HtmlEscapedString> {
  return html`
    <div class="max-w-3xl mx-auto space-y-6">
      <!-- Breadcrumbs -->
      <nav class="flex items-center space-x-2 text-sm text-slate-400">
        <a href="/rockets" class="hover:text-white transition-colors">Rockets</a>
        <span>/</span>
        <span class="text-white font-medium">New Rocket Airframe</span>
      </nav>

      <div>
        <h1 class="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Create Rocket Airframe</h1>
        <p class="mt-1 text-sm text-slate-400">
          Register a new rocket airframe and establish its initial Version 1 configuration snapshot with baseline mass and aerodynamic properties.
        </p>
      </div>

      ${errorMessage
        ? html`
            <div class="p-4 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 text-sm">
              <strong>Error:</strong> ${errorMessage}
            </div>
          `
        : ''}

      <form action="/rockets" method="POST" class="space-y-8 bg-slate-950 border border-slate-800 rounded-xl p-6 sm:p-8 shadow-sm">
        <!-- Section 1: Airframe Identity -->
        <div>
          <h2 class="text-base font-bold text-white border-b border-slate-800 pb-2 mb-4 flex items-center gap-2">
            <span>1. Airframe Identity</span>
          </h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="sm:col-span-2">
              <label for="name" class="block text-xs font-semibold text-slate-300 mb-1">
                Rocket Name <span class="text-rose-400">*</span>
              </label>
              <input
                type="text"
                id="name"
                name="name"
                required
                placeholder="e.g. Aerotech Initiator 29mm, Super Big Bertha"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
              />
            </div>

            <div>
              <label for="status" class="block text-xs font-semibold text-slate-300 mb-1">
                Operational Status <span class="text-rose-400">*</span>
              </label>
              <select
                id="status"
                name="status"
                required
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
              >
                <option value="flight_ready" selected>Flight Ready</option>
                <option value="in_build">In Build</option>
                <option value="damaged">Damaged</option>
                <option value="retired">Retired</option>
              </select>
            </div>

            <div>
              <label for="airframe_material" class="block text-xs font-semibold text-slate-300 mb-1">
                Airframe Material
              </label>
              <input
                type="text"
                id="airframe_material"
                name="airframe_material"
                placeholder="e.g. Kraft phenolic, fiberglass, carbon"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
              />
            </div>
          </div>
        </div>

        <!-- Section 2: Baseline Version 1 Configuration Snapshot -->
        <div>
          <div class="flex items-center justify-between border-b border-slate-800 pb-2 mb-4">
            <h2 class="text-base font-bold text-white flex items-center gap-2">
              <span>2. Baseline Configuration Snapshot (Version 1)</span>
            </h2>
            <span class="text-xs text-brand-400 font-semibold bg-brand-950/80 px-2 py-0.5 rounded border border-brand-800/40">
              v1 Snapshot
            </span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <!-- Fin Count -->
            <div>
              <label for="fin_count" class="block text-xs font-semibold text-slate-300 mb-1">
                Fin Count
              </label>
              <input
                type="number"
                id="fin_count"
                name="fin_count"
                min="0"
                step="1"
                placeholder="e.g. 3 or 4"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
              />
            </div>

            <!-- Motor Mount Diameter -->
            <div>
              <label for="motor_mount_diameter_mm" class="block text-xs font-semibold text-slate-300 mb-1">
                Motor Mount Diameter (mm)
              </label>
              <input
                type="number"
                id="motor_mount_diameter_mm"
                name="motor_mount_diameter_mm"
                min="0"
                step="any"
                placeholder="e.g. 29, 38, 54"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
              />
            </div>

            <!-- Recovery Type -->
            <div>
              <label for="recovery_type" class="block text-xs font-semibold text-slate-300 mb-1">
                Recovery Type
              </label>
              <select
                id="recovery_type"
                name="recovery_type"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
              >
                <option value="parachute" selected>Parachute</option>
                <option value="streamer">Streamer</option>
                <option value="dual_deploy">Dual Deploy</option>
                <option value="tumble">Tumble</option>
                <option value="other">Other</option>
              </select>
            </div>

            <!-- Parachute Size -->
            <div>
              <label for="parachute_size_mm" class="block text-xs font-semibold text-slate-300 mb-1">
                Parachute Size (mm)
              </label>
              <input
                type="number"
                id="parachute_size_mm"
                name="parachute_size_mm"
                min="0"
                step="any"
                placeholder="e.g. 600"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
              />
            </div>

            <!-- Dry Mass -->
            <div>
              <label for="dry_mass_g" class="block text-xs font-semibold text-slate-300 mb-1">
                Dry Mass (g)
              </label>
              <input
                type="number"
                id="dry_mass_g"
                name="dry_mass_g"
                min="0"
                step="any"
                placeholder="e.g. 480.0"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
              />
            </div>

            <!-- Loaded Mass -->
            <div>
              <label for="loaded_mass_g" class="block text-xs font-semibold text-slate-300 mb-1">
                Loaded Mass (g)
              </label>
              <input
                type="number"
                id="loaded_mass_g"
                name="loaded_mass_g"
                min="0"
                step="any"
                placeholder="e.g. 620.0"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
              />
            </div>

            <!-- Ballast Mass -->
            <div>
              <label for="ballast_g" class="block text-xs font-semibold text-slate-300 mb-1">
                Nose / Ballast Mass (g)
              </label>
              <input
                type="number"
                id="ballast_g"
                name="ballast_g"
                min="0"
                step="any"
                placeholder="e.g. 0.0"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
              />
            </div>

            <!-- Center of Gravity (CG) -->
            <div>
              <label for="cg_mm" class="block text-xs font-semibold text-slate-300 mb-1">
                Center of Gravity — CG (mm)
              </label>
              <input
                type="number"
                id="cg_mm"
                name="cg_mm"
                min="0"
                step="any"
                placeholder="e.g. 520.0"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
              />
            </div>

            <!-- Center of Pressure (CP) -->
            <div>
              <label for="cp_mm" class="block text-xs font-semibold text-slate-300 mb-1">
                Center of Pressure — CP (mm)
              </label>
              <input
                type="number"
                id="cp_mm"
                name="cp_mm"
                min="0"
                step="any"
                placeholder="e.g. 640.0"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
              />
            </div>

            <!-- Stability Calibers -->
            <div class="sm:col-span-3">
              <label for="stability_calibers" class="block text-xs font-semibold text-slate-300 mb-1">
                Aerodynamic Stability (Calibers)
              </label>
              <input
                type="number"
                id="stability_calibers"
                name="stability_calibers"
                step="any"
                placeholder="e.g. 1.75 (Recommended ≥ 1.0 caliber)"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
              />
              <p class="mt-1 text-xs text-slate-400">
                Calibers of stability = (CP - CG) / Body Diameter. Values below 1.0 caliber trigger preflight soft-gate warnings.
              </p>
            </div>
          </div>
        </div>

        <!-- Form Submission Actions -->
        <div class="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
          <a
            href="/rockets"
            class="px-4 py-2 border border-slate-700 text-sm font-medium rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
          >
            Cancel
          </a>
          <button
            type="submit"
            class="px-5 py-2 border border-transparent text-sm font-semibold rounded-lg shadow-sm text-slate-950 bg-brand-400 hover:bg-brand-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 focus:ring-offset-slate-900 transition-colors"
          >
            Create Rocket & Baseline v1 Snapshot
          </button>
        </div>
      </form>
    </div>
  `
}

/**
 * 4. New Configuration Snapshot Form View: Pre-populated with previous
 * version values allowing quick creation of snapshot v(N+1).
 */
export function newConfigFormView(
  rocket: { id: string; name: string },
  previousConfig?: RocketConfigSummary | null,
  errorMessage?: string,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const nextVersion = (previousConfig?.version ?? 0) + 1

  return html`
    <div class="max-w-3xl mx-auto space-y-6">
      <!-- Breadcrumbs -->
      <nav class="flex items-center space-x-2 text-sm text-slate-400">
        <a href="/rockets" class="hover:text-white transition-colors">Rockets</a>
        <span>/</span>
        <a href="/rockets/${rocket.id}" class="hover:text-white transition-colors truncate">${rocket.name}</a>
        <span>/</span>
        <span class="text-white font-medium">New Configuration Snapshot</span>
      </nav>

      <div>
        <div class="flex items-center gap-3">
          <h1 class="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Add Configuration Snapshot
          </h1>
          <span class="text-xs font-bold text-brand-400 bg-brand-950/80 px-2.5 py-1 rounded border border-brand-800/50">
            Version ${nextVersion}
          </span>
        </div>
        <p class="mt-1 text-sm text-slate-400">
          Airframe: <strong class="text-white">${rocket.name}</strong>. Values below have been pre-populated from Version ${previousConfig?.version ?? 'initial'} snapshot.
        </p>
      </div>

      ${errorMessage
        ? html`
            <div class="p-4 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 text-sm">
              <strong>Error:</strong> ${errorMessage}
            </div>
          `
        : ''}

      <form action="/rockets/${rocket.id}/configurations" method="POST" class="space-y-6 bg-slate-950 border border-slate-800 rounded-xl p-6 sm:p-8 shadow-sm">
        <!-- Hidden explicit version field -->
        <input type="hidden" name="version" value="${nextVersion}" />

        <div class="bg-slate-900/60 border border-slate-800 rounded-lg p-3.5 text-xs text-slate-300 flex items-center justify-between">
          <span>Target Version: <strong class="text-brand-400 font-bold">Version ${nextVersion}</strong></span>
          <span class="text-slate-400">Will automatically become active configuration</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <!-- Airframe Material -->
          <div class="sm:col-span-2">
            <label for="airframe_material" class="block text-xs font-semibold text-slate-300 mb-1">
              Airframe Material
            </label>
            <input
              type="text"
              id="airframe_material"
              name="airframe_material"
              value="${previousConfig?.airframeMaterial ?? ''}"
              placeholder="e.g. Kraft phenolic, fiberglass, carbon"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
            />
          </div>

          <!-- Fin Count -->
          <div>
            <label for="fin_count" class="block text-xs font-semibold text-slate-300 mb-1">
              Fin Count
            </label>
            <input
              type="number"
              id="fin_count"
              name="fin_count"
              min="0"
              step="1"
              value="${previousConfig?.finCount != null ? String(previousConfig.finCount) : ''}"
              placeholder="e.g. 3 or 4"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
            />
          </div>

          <!-- Motor Mount Diameter -->
          <div>
            <label for="motor_mount_diameter_mm" class="block text-xs font-semibold text-slate-300 mb-1">
              Motor Mount Diameter (mm)
            </label>
            <input
              type="number"
              id="motor_mount_diameter_mm"
              name="motor_mount_diameter_mm"
              min="0"
              step="any"
              value="${previousConfig?.motorMountDiameterMm != null ? String(previousConfig.motorMountDiameterMm) : ''}"
              placeholder="e.g. 29, 38, 54"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
            />
          </div>

          <!-- Recovery Type -->
          <div>
            <label for="recovery_type" class="block text-xs font-semibold text-slate-300 mb-1">
              Recovery Type
            </label>
            <select
              id="recovery_type"
              name="recovery_type"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
            >
              <option value="parachute" ${previousConfig?.recoveryType === 'parachute' ? 'selected' : ''}>Parachute</option>
              <option value="streamer" ${previousConfig?.recoveryType === 'streamer' ? 'selected' : ''}>Streamer</option>
              <option value="dual_deploy" ${previousConfig?.recoveryType === 'dual_deploy' ? 'selected' : ''}>Dual Deploy</option>
              <option value="tumble" ${previousConfig?.recoveryType === 'tumble' ? 'selected' : ''}>Tumble</option>
              <option value="other" ${previousConfig?.recoveryType === 'other' ? 'selected' : ''}>Other</option>
            </select>
          </div>

          <!-- Parachute Size -->
          <div>
            <label for="parachute_size_mm" class="block text-xs font-semibold text-slate-300 mb-1">
              Parachute Size (mm)
            </label>
            <input
              type="number"
              id="parachute_size_mm"
              name="parachute_size_mm"
              min="0"
              step="any"
              value="${previousConfig?.parachuteSizeMm != null ? String(previousConfig.parachuteSizeMm) : ''}"
              placeholder="e.g. 600"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
            />
          </div>

          <!-- Dry Mass -->
          <div>
            <label for="dry_mass_g" class="block text-xs font-semibold text-slate-300 mb-1">
              Dry Mass (g)
            </label>
            <input
              type="number"
              id="dry_mass_g"
              name="dry_mass_g"
              min="0"
              step="any"
              value="${previousConfig?.dryMassG != null ? String(previousConfig.dryMassG) : ''}"
              placeholder="e.g. 480.0"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
            />
          </div>

          <!-- Loaded Mass -->
          <div>
            <label for="loaded_mass_g" class="block text-xs font-semibold text-slate-300 mb-1">
              Loaded Mass (g)
            </label>
            <input
              type="number"
              id="loaded_mass_g"
              name="loaded_mass_g"
              min="0"
              step="any"
              value="${previousConfig?.loadedMassG != null ? String(previousConfig.loadedMassG) : ''}"
              placeholder="e.g. 620.0"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
            />
          </div>

          <!-- Ballast Mass -->
          <div>
            <label for="ballast_g" class="block text-xs font-semibold text-slate-300 mb-1">
              Nose / Ballast Mass (g)
            </label>
            <input
              type="number"
              id="ballast_g"
              name="ballast_g"
              min="0"
              step="any"
              value="${previousConfig?.ballastG != null ? String(previousConfig.ballastG) : ''}"
              placeholder="e.g. 0.0"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
            />
          </div>

          <!-- Center of Gravity (CG) -->
          <div>
            <label for="cg_mm" class="block text-xs font-semibold text-slate-300 mb-1">
              Center of Gravity — CG (mm)
            </label>
            <input
              type="number"
              id="cg_mm"
              name="cg_mm"
              min="0"
              step="any"
              value="${previousConfig?.cgMm != null ? String(previousConfig.cgMm) : ''}"
              placeholder="e.g. 520.0"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
            />
          </div>

          <!-- Center of Pressure (CP) -->
          <div>
            <label for="cp_mm" class="block text-xs font-semibold text-slate-300 mb-1">
              Center of Pressure — CP (mm)
            </label>
            <input
              type="number"
              id="cp_mm"
              name="cp_mm"
              min="0"
              step="any"
              value="${previousConfig?.cpMm != null ? String(previousConfig.cpMm) : ''}"
              placeholder="e.g. 640.0"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
            />
          </div>

          <!-- Stability Calibers -->
          <div>
            <label for="stability_calibers" class="block text-xs font-semibold text-slate-300 mb-1">
              Aerodynamic Stability (Calibers)
            </label>
            <input
              type="number"
              id="stability_calibers"
              name="stability_calibers"
              step="any"
              value="${previousConfig?.stabilityCalibers != null ? String(previousConfig.stabilityCalibers) : ''}"
              placeholder="e.g. 1.75"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
            />
          </div>
        </div>

        <!-- Form Submission Actions -->
        <div class="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
          <a
            href="/rockets/${rocket.id}"
            class="px-4 py-2 border border-slate-700 text-sm font-medium rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
          >
            Cancel
          </a>
          <button
            type="submit"
            class="px-5 py-2 border border-transparent text-sm font-semibold rounded-lg shadow-sm text-slate-950 bg-brand-400 hover:bg-brand-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 focus:ring-offset-slate-900 transition-colors"
          >
            Save Configuration Snapshot v${nextVersion}
          </button>
        </div>
      </form>
    </div>
  `
}

/**
 * 5. Edit Rocket Airframe Form View: Modify airframe name and status.
 */
export function editRocketFormView(
  rocket: { id: string; name: string; status: string },
  errorMessage?: string,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  return html`
    <div class="max-w-xl mx-auto space-y-6">
      <nav class="flex items-center space-x-2 text-sm text-slate-400">
        <a href="/rockets" class="hover:text-white transition-colors">Rockets</a>
        <span>/</span>
        <a href="/rockets/${rocket.id}" class="hover:text-white transition-colors truncate">${rocket.name}</a>
        <span>/</span>
        <span class="text-white font-medium">Edit Airframe</span>
      </nav>

      <div>
        <h1 class="text-2xl font-extrabold text-white tracking-tight">Edit Rocket Airframe</h1>
        <p class="mt-1 text-sm text-slate-400">Update airframe identity and operational readiness status.</p>
      </div>

      ${errorMessage
        ? html`
            <div class="p-4 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 text-sm">
              <strong>Error:</strong> ${errorMessage}
            </div>
          `
        : ''}

      <form action="/rockets/${rocket.id}" method="POST" class="space-y-6 bg-slate-950 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div>
          <label for="name" class="block text-xs font-semibold text-slate-300 mb-1">
            Rocket Name <span class="text-rose-400">*</span>
          </label>
          <input
            type="text"
            id="name"
            name="name"
            required
            value="${rocket.name}"
            class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
          />
        </div>

        <div>
          <label for="status" class="block text-xs font-semibold text-slate-300 mb-1">
            Operational Status <span class="text-rose-400">*</span>
          </label>
          <select
            id="status"
            name="status"
            required
            class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
          >
            <option value="flight_ready" ${rocket.status === 'flight_ready' ? 'selected' : ''}>Flight Ready</option>
            <option value="in_build" ${rocket.status === 'in_build' ? 'selected' : ''}>In Build</option>
            <option value="damaged" ${rocket.status === 'damaged' ? 'selected' : ''}>Damaged</option>
            <option value="retired" ${rocket.status === 'retired' ? 'selected' : ''}>Retired</option>
          </select>
        </div>

        <div class="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
          <a
            href="/rockets/${rocket.id}"
            class="px-4 py-2 border border-slate-700 text-sm font-medium rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
          >
            Cancel
          </a>
          <button
            type="submit"
            class="px-5 py-2 border border-transparent text-sm font-semibold rounded-lg shadow-sm text-slate-950 bg-brand-400 hover:bg-brand-300 transition-colors"
          >
            Save Changes
          </button>
        </div>
      </form>
    </div>
  `
}
