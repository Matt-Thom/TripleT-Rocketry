/**
 * Dashboard view component for TripleT-Rocketry.
 *
 * Renders quick summary statistics cards, a recent flights logbook table with
 * outcome and soft-gate warning badges, and a range companion quick actions grid.
 */

import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'

export interface RecentFlightItem {
  id: string
  flightNumber?: number | null
  flownAt: number | null
  rocketName?: string | null
  motorName?: string | null
  altitudeAglM?: number | null
  outcome?: string | null
  hasWarnings?: boolean
  warningCount?: number
}

export interface DashboardData {
  totalFlights: number
  activeRockets: number
  motorStockOnHand: number
  successRatePercent: number | null
  recentFlights: RecentFlightItem[]
}

function renderOutcomeBadge(outcome?: string | null) {
  if (!outcome) {
    return html`<span class="px-2 py-0.5 text-xs rounded-full bg-slate-700/50 text-slate-300 border border-slate-600/30">Unknown</span>`
  }

  switch (outcome.toLowerCase()) {
    case 'successful':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">✓ Successful</span>`
    case 'cato':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">💥 CATO</span>`
    case 'recovery_failure':
    case 'separation':
    case 'tree':
    case 'powerline':
    case 'lost':
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">⚠️ ${outcome.replace('_', ' ')}</span>`
    default:
      return html`<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-700/40 text-slate-300 border border-slate-600/30">${outcome}</span>`
  }
}

function formatDate(epochMs: number | null): string {
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

export function dashboardView(data: DashboardData): HtmlEscapedString | Promise<HtmlEscapedString> {
  return html`
    <div class="space-y-8">
      <!-- Welcome Header -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-2 border-b border-slate-800">
        <div>
          <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>Range Companion Dashboard</span>
          </h1>
          <p class="mt-1 text-sm text-slate-400">
            Welcome to TripleT-Rocketry — flight logs, motor inventory & preflight safety.
          </p>
        </div>
        <div class="mt-4 sm:mt-0 flex gap-2">
          <a href="/flights/new" class="inline-flex items-center px-4 py-2 text-sm font-semibold rounded-lg bg-brand-500 hover:bg-brand-400 text-slate-950 shadow-md transition-colors">
            <span class="mr-1 font-bold">+</span> Log New Flight
          </a>
        </div>
      </div>

      <!-- Quick Stats Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <!-- Stat 1: Total Flights -->
        <div class="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm hover:border-slate-600 transition-colors">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Flights</span>
            <span class="text-xl">🚀</span>
          </div>
          <div class="mt-2 flex items-baseline">
            <span class="text-3xl font-extrabold text-white">${data.totalFlights}</span>
            <span class="ml-2 text-xs text-slate-400">logged</span>
          </div>
          <p class="mt-2 text-xs text-slate-400">Mission history to date</p>
        </div>

        <!-- Stat 2: Active Rockets -->
        <div class="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm hover:border-slate-600 transition-colors">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Rockets</span>
            <span class="text-xl">🛰️</span>
          </div>
          <div class="mt-2 flex items-baseline">
            <span class="text-3xl font-extrabold text-emerald-400">${data.activeRockets}</span>
            <span class="ml-2 text-xs text-slate-400">flight ready</span>
          </div>
          <p class="mt-2 text-xs text-slate-400">Airframes in inventory</p>
        </div>

        <!-- Stat 3: Motor Stock -->
        <div class="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm hover:border-slate-600 transition-colors">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Motor Stock</span>
            <span class="text-xl">⚡</span>
          </div>
          <div class="mt-2 flex items-baseline">
            <span class="text-3xl font-extrabold text-white">${data.motorStockOnHand}</span>
            <span class="ml-2 text-xs text-slate-400">units on hand</span>
          </div>
          <p class="mt-2 text-xs text-slate-400">Across all impulse classes</p>
        </div>

        <!-- Stat 4: Mission Success Rate -->
        <div class="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm hover:border-slate-600 transition-colors">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Success Rate</span>
            <span class="text-xl">🎯</span>
          </div>
          <div class="mt-2 flex items-baseline">
            <span class="text-3xl font-extrabold text-emerald-400">
              ${data.successRatePercent !== null ? `${data.successRatePercent}%` : 'N/A'}
            </span>
            <span class="ml-2 text-xs text-slate-400">safe recovery</span>
          </div>
          <p class="mt-2 text-xs text-slate-400">Nominal flight outcomes</p>
        </div>
      </div>

      <!-- Quick Actions Grid -->
      <div class="space-y-3">
        <h2 class="text-lg font-semibold text-white">Quick Actions</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <a href="/flights/new" class="group block p-4 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-brand-500/50 rounded-xl transition-all">
            <div class="flex items-center space-x-3">
              <span class="text-2xl p-2 bg-slate-900 rounded-lg group-hover:scale-110 transition-transform">🚀</span>
              <div>
                <h3 class="font-semibold text-white group-hover:text-brand-400 transition-colors">Log a Flight</h3>
                <p class="text-xs text-slate-400">Preflight check & telemetry log</p>
              </div>
            </div>
          </a>

          <a href="/rockets/new" class="group block p-4 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-brand-500/50 rounded-xl transition-all">
            <div class="flex items-center space-x-3">
              <span class="text-2xl p-2 bg-slate-900 rounded-lg group-hover:scale-110 transition-transform">🛰️</span>
              <div>
                <h3 class="font-semibold text-white group-hover:text-brand-400 transition-colors">Add Rocket</h3>
                <p class="text-xs text-slate-400">New airframe & versioned config</p>
              </div>
            </div>
          </a>

          <a href="/motors" class="group block p-4 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-brand-500/50 rounded-xl transition-all">
            <div class="flex items-center space-x-3">
              <span class="text-2xl p-2 bg-slate-900 rounded-lg group-hover:scale-110 transition-transform">⚡</span>
              <div>
                <h3 class="font-semibold text-white group-hover:text-brand-400 transition-colors">Motor Inventory</h3>
                <p class="text-xs text-slate-400">Browse catalog & adjust counts</p>
              </div>
            </div>
          </a>

          <a href="/sites" class="group block p-4 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-brand-500/50 rounded-xl transition-all">
            <div class="flex items-center space-x-3">
              <span class="text-2xl p-2 bg-slate-900 rounded-lg group-hover:scale-110 transition-transform">📍</span>
              <div>
                <h3 class="font-semibold text-white group-hover:text-brand-400 transition-colors">Launch Sites</h3>
                <p class="text-xs text-slate-400">Airspace waivers & coordinates</p>
              </div>
            </div>
          </a>
        </div>
      </div>

      <!-- Recent Flights Section -->
      <div class="bg-slate-800/60 border border-slate-700/60 rounded-xl overflow-hidden shadow-sm">
        <div class="px-6 py-4 border-b border-slate-700/60 flex items-center justify-between">
          <div>
            <h2 class="text-lg font-semibold text-white">Recent Flight Logs</h2>
            <p class="text-xs text-slate-400">Latest recorded launches and outcomes</p>
          </div>
          <a href="/flights" class="text-sm font-medium text-brand-400 hover:text-brand-300 transition-colors">
            View All Flights →
          </a>
        </div>

        ${data.recentFlights.length === 0
          ? html`
            <div class="p-12 text-center">
              <span class="text-4xl mb-3 block">🚀</span>
              <h3 class="text-base font-semibold text-white">No flights logged yet</h3>
              <p class="mt-1 text-sm text-slate-400 max-w-sm mx-auto">
                Ready for liftoff? Log your first flight with preflight soft-gate checks and telemetry tracking.
              </p>
              <div class="mt-6">
                <a href="/flights/new" class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-semibold rounded-md shadow-sm text-slate-950 bg-brand-400 hover:bg-brand-300 transition-colors">
                  + Log First Flight
                </a>
              </div>
            </div>
          `
          : html`
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-slate-700/60 text-left text-sm">
                <thead class="bg-slate-900/60 text-xs text-slate-400 uppercase tracking-wider font-semibold">
                  <tr>
                    <th scope="col" class="px-6 py-3.5">Date</th>
                    <th scope="col" class="px-6 py-3.5">Rocket</th>
                    <th scope="col" class="px-6 py-3.5">Motor</th>
                    <th scope="col" class="px-6 py-3.5">Altitude AGL</th>
                    <th scope="col" class="px-6 py-3.5">Outcome</th>
                    <th scope="col" class="px-6 py-3.5">Soft-Gate Safety</th>
                    <th scope="col" class="px-6 py-3.5 text-right">Details</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-700/40">
                  ${data.recentFlights.map(
                    (flight) => html`
                      <tr class="hover:bg-slate-700/20 transition-colors">
                        <td class="px-6 py-4 whitespace-nowrap text-slate-300 font-medium">
                          ${formatDate(flight.flownAt)}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-white font-semibold">
                          ${flight.rocketName || 'Unnamed Rocket'}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-slate-300">
                          <span class="font-mono bg-slate-900/80 px-2 py-0.5 rounded border border-slate-700 text-xs">
                            ${flight.motorName || 'N/A'}
                          </span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-slate-300 font-mono">
                          ${flight.altitudeAglM != null ? `${flight.altitudeAglM.toLocaleString()} m` : '—'}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                          ${renderOutcomeBadge(flight.outcome)}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap">
                          ${flight.hasWarnings
                            ? html`<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-950/60 text-amber-300 border border-amber-600/50">
                                ⚠️ Warnings (${flight.warningCount || 1})
                              </span>`
                            : html`<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-950/40 text-emerald-300 border border-emerald-600/30">
                                ✓ Clean
                              </span>`}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <a href="/flights/${flight.id}" class="text-brand-400 hover:text-brand-300 font-medium transition-colors">
                            View →
                          </a>
                        </td>
                      </tr>
                    `
                  )}
                </tbody>
              </table>
            </div>
          `}
      </div>
    </div>
  `
}
