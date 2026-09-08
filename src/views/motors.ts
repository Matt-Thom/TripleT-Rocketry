/**
 * Motor Catalog & Inventory Tracking Views.
 *
 * Provides responsive HTML views for browsing motor specifications,
 * impulse class filtering (A-O), detailed motor specifications,
 * user inventory tracking, and inline HTMX stock adjustment components.
 */

import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import * as schema from '../db/schema'

export type Motor = typeof schema.motors.$inferSelect
export type MotorInventory = typeof schema.motorInventories.$inferSelect

export interface InventoryItemWithMotor extends MotorInventory {
  motor?: Partial<Motor> | null
}

export const IMPULSE_CLASSES = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H',
  'I', 'J', 'K', 'L', 'M', 'N', 'O',
] as const

/**
 * Returns color classes for impulse class badges.
 * Color-coded by rocketry power tiers:
 * - Low Power (A-D): Emerald
 * - Mid Power (E-G): Sky
 * - High Power L1 (H-I): Amber
 * - High Power L2 (J-L): Orange
 * - High Power L3 (M-O): Purple
 */
export function getImpulseClassBadgeClasses(impulseClass?: string | null): string {
  if (!impulseClass) return 'bg-slate-800 text-slate-400 border-slate-700'
  const c = impulseClass.toUpperCase()
  if (['A', 'B', 'C', 'D'].includes(c)) {
    return 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60'
  }
  if (['E', 'F', 'G'].includes(c)) {
    return 'bg-sky-950/70 text-sky-300 border-sky-700/60'
  }
  if (['H', 'I'].includes(c)) {
    return 'bg-amber-950/70 text-amber-300 border-amber-700/60'
  }
  if (['J', 'K', 'L'].includes(c)) {
    return 'bg-orange-950/70 text-orange-300 border-orange-700/60'
  }
  if (['M', 'N', 'O'].includes(c)) {
    return 'bg-purple-950/70 text-purple-300 border-purple-700/60'
  }
  return 'bg-slate-800 text-slate-400 border-slate-700'
}

/**
 * Formats propellant type into clean readable badge label.
 */
export function formatPropellantType(propellantType?: string | null): { label: string; badgeClasses: string } {
  switch (propellantType) {
    case 'apcp':
      return { label: 'APCP', badgeClasses: 'bg-indigo-950/60 text-indigo-300 border-indigo-700/50' }
    case 'black_powder':
      return { label: 'Black Powder', badgeClasses: 'bg-stone-900 text-stone-300 border-stone-700/60' }
    case 'hybrid':
      return { label: 'Hybrid', badgeClasses: 'bg-teal-950/60 text-teal-300 border-teal-700/50' }
    default:
      return { label: propellantType || 'Standard', badgeClasses: 'bg-slate-800 text-slate-400 border-slate-700' }
  }
}

/**
 * Helper to extract stock count from userInventoryMap.
 */
function getStockCount(
  motorId: string,
  userInventoryMap?: Record<string, any> | Map<string, any>,
): { onHand: number; expended: number; inventoryId?: string } {
  if (!userInventoryMap) return { onHand: 0, expended: 0 }
  let val: any = null
  if (userInventoryMap instanceof Map) {
    val = userInventoryMap.get(motorId)
  } else if (typeof userInventoryMap === 'object') {
    val = userInventoryMap[motorId]
  }

  if (typeof val === 'number') {
    return { onHand: val, expended: 0 }
  }
  if (val && typeof val === 'object') {
    return {
      onHand: Number(val.quantityOnHand ?? val.onHand ?? 0),
      expended: Number(val.expendedCount ?? val.expended ?? 0),
      inventoryId: val.id,
    }
  }
  return { onHand: 0, expended: 0 }
}

/**
 * 1. Motor Catalog Browser View
 *
 * Displays searchable motor catalog with impulse class filter bar (All, A-O),
 * specifications (mfr, model, impulse class, total impulse, avg thrust, burn time,
 * delay, propellant type, diameter), user inventory stock counts, and quick actions.
 */
export function motorCatalogView(
  motors: Motor[],
  activeFilter?: string | null,
  userInventoryMap?: Record<string, any> | Map<string, any>,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const currentFilter = (activeFilter || 'ALL').toUpperCase()

  return html`
    <div class="space-y-6">
      <!-- Page Header & Action Bar -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>⚡</span>
            <span>Motor Catalog</span>
          </h1>
          <p class="text-sm text-slate-400 mt-1">
            Browse certified rocket motors, evaluate impulse & thrust specifications, and track stock.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <a
            href="/motors/import"
            class="inline-flex items-center px-3.5 py-2 rounded-lg text-sm font-semibold bg-brand-500 hover:bg-brand-400 text-slate-950 shadow-sm transition-colors"
          >
            <span class="mr-1.5">📥</span> + Import Motors
          </a>
          <a
            href="/inventory"
            class="inline-flex items-center px-3.5 py-2 rounded-lg text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-brand-300 border border-slate-700 hover:border-brand-500/50 shadow-sm transition-colors"
          >
            <span class="mr-1.5">📦</span> My Inventory
          </a>
        </div>
      </div>

      <!-- Impulse Class Filter Bar -->
      <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3 sm:p-4 shadow-sm">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold uppercase tracking-wider text-slate-400">Impulse Class:</span>
          </div>
          <!-- Search Input -->
          <div class="relative w-full md:w-64">
            <input
              type="text"
              id="motor-search"
              placeholder="Search mfr, model, delay..."
              oninput="filterMotorsCatalog()"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            />
          </div>
        </div>

        <!-- Filter Buttons (All, A - O) -->
        <div class="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-slate-800/80">
          <a
            href="/motors"
            class="px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              currentFilter === 'ALL'
                ? 'bg-brand-500 text-slate-950 font-bold shadow-sm'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
            }"
          >
            All
          </a>
          ${IMPULSE_CLASSES.map((cls) => {
            const isActive = currentFilter === cls
            const badgeClasses = getImpulseClassBadgeClasses(cls)
            return html`
              <a
                href="/motors?impulse_class=${cls}"
                class="px-2.5 py-1 rounded-md text-xs font-semibold transition-all border ${
                  isActive
                    ? 'bg-brand-500 text-slate-950 font-bold border-brand-400 shadow-sm ring-1 ring-brand-400'
                    : `bg-slate-900/90 text-slate-300 hover:text-white ${badgeClasses} hover:bg-slate-800`
                }"
              >
                ${cls}
              </a>
            `
          })}
        </div>
      </div>

      <!-- Motors Table & Empty State -->
      ${motors.length === 0
        ? html`
            <div class="text-center py-16 bg-slate-950/40 rounded-xl border border-slate-800 p-8">
              <span class="text-5xl mb-3 block">🔍</span>
              <h3 class="text-lg font-semibold text-white">No Motors Found</h3>
              <p class="text-sm text-slate-400 mt-1 max-w-sm mx-auto">
                ${currentFilter !== 'ALL'
                  ? `No motors found in Impulse Class ${currentFilter}. Try selecting "All" or a different class.`
                  : 'The motor catalog is currently empty. Seed motors or contact range admin.'}
              </p>
              ${currentFilter !== 'ALL'
                ? html`
                    <div class="mt-4">
                      <a
                        href="/motors"
                        class="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium bg-slate-800 hover:bg-slate-700 text-white transition-colors"
                      >
                        Reset Filter
                      </a>
                    </div>
                  `
                : ''}
            </div>
          `
        : html`
            <!-- Desktop / Tablet Table View -->
            <div class="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/50 shadow-md">
              <table class="min-w-full divide-y divide-slate-800 text-left text-sm" id="catalog-table">
                <thead class="bg-slate-900/90 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th scope="col" class="py-3.5 pl-4 pr-3 sm:pl-6">Manufacturer & Model</th>
                    <th scope="col" class="px-3 py-3.5">Class</th>
                    <th scope="col" class="px-3 py-3.5">Impulse</th>
                    <th scope="col" class="px-3 py-3.5">Avg Thrust</th>
                    <th scope="col" class="px-3 py-3.5">Burn Time</th>
                    <th scope="col" class="px-3 py-3.5">Delay</th>
                    <th scope="col" class="px-3 py-3.5">Propellant</th>
                    <th scope="col" class="px-3 py-3.5">Diameter</th>
                    <th scope="col" class="px-3 py-3.5 text-center">My Stock</th>
                    <th scope="col" class="py-3.5 pl-3 pr-4 sm:pr-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-800/60 bg-slate-950/20">
                  ${motors.map((motor) => {
                    const stock = getStockCount(motor.id, userInventoryMap)
                    const classBadge = getImpulseClassBadgeClasses(motor.impulseClass)
                    const prop = formatPropellantType(motor.propellantType)
                    const searchData = `${motor.manufacturer} ${motor.model} ${motor.impulseClass || ''} ${motor.delayS ?? ''} ${prop.label} ${motor.hardware || ''}`.toLowerCase()

                    return html`
                      <tr
                        class="motor-row hover:bg-slate-800/40 transition-colors"
                        data-search="${searchData}"
                      >
                        <td class="whitespace-nowrap py-3.5 pl-4 pr-3 sm:pl-6">
                          <div class="font-semibold text-white">
                            <a href="/motors/${motor.id}" class="hover:text-brand-400 transition-colors">
                              ${motor.manufacturer} <span class="text-brand-300 font-mono">${motor.model}</span>
                            </a>
                          </div>
                          ${motor.hardware
                            ? html`<div class="text-xs text-slate-400">Casing: <span class="text-slate-200 font-mono">${motor.hardware}</span></div>`
                            : (motor.casingReusable
                              ? html`<span class="text-[11px] text-sky-400 font-medium">Reloadable</span>`
                              : html`<span class="text-[11px] text-slate-400 font-medium">Single-Use</span>`)}
                        </td>
                        <td class="whitespace-nowrap px-3 py-3.5">
                          <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${classBadge}">
                            ${motor.impulseClass || '—'}
                          </span>
                        </td>
                        <td class="whitespace-nowrap px-3 py-3.5 font-mono text-slate-300">
                          ${motor.totalImpulseNs != null ? motor.totalImpulseNs.toFixed(1) + ' N·s' : '—'}
                        </td>
                        <td class="whitespace-nowrap px-3 py-3.5 font-mono text-slate-300">
                          ${motor.averageThrustN != null ? motor.averageThrustN.toFixed(0) + ' N' : '—'}
                        </td>
                        <td class="whitespace-nowrap px-3 py-3.5 font-mono text-slate-300">
                          ${motor.burnTimeS != null ? motor.burnTimeS.toFixed(1) + ' s' : '—'}
                        </td>
                        <td class="whitespace-nowrap px-3 py-3.5 font-mono text-slate-300">
                          ${motor.delayS != null ? motor.delayS + ' s' : 'None'}
                        </td>
                        <td class="whitespace-nowrap px-3 py-3.5">
                          <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${prop.badgeClasses}">
                            ${prop.label}
                          </span>
                        </td>
                        <td class="whitespace-nowrap px-3 py-3.5 font-mono text-slate-300">
                          ${motor.diameterMm != null ? motor.diameterMm + ' mm' : '—'}
                        </td>
                        <td class="whitespace-nowrap px-3 py-3.5 text-center">
                          ${stock.onHand > 0
                            ? html`
                                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-800/80">
                                  ${stock.onHand} on hand
                                </span>
                              `
                            : html`
                                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-slate-500 bg-slate-900 border border-slate-800">
                                  0 on hand
                                </span>
                              `}
                        </td>
                        <td class="whitespace-nowrap py-3.5 pl-3 pr-4 sm:pr-6 text-right">
                          <div class="inline-flex items-center gap-2">
                            <!-- Quick Add to Inventory Button -->
                            <form method="POST" action="/inventory" class="inline">
                              <input type="hidden" name="motor_id" value="${motor.id}" />
                              <input type="hidden" name="quantity_on_hand" value="1" />
                              <button
                                type="submit"
                                title="Add 1 to my inventory"
                                class="px-2.5 py-1 text-xs font-medium rounded-md bg-slate-800 hover:bg-brand-600 text-slate-300 hover:text-white border border-slate-700 transition-colors"
                              >
                                + Stock
                              </button>
                            </form>
                            <!-- Specs Detail Button -->
                            <a
                              href="/motors/${motor.id}"
                              class="px-2.5 py-1 text-xs font-medium rounded-md bg-brand-500/10 hover:bg-brand-500/20 text-brand-300 border border-brand-500/30 transition-colors"
                            >
                              Specs →
                            </a>
                          </div>
                        </td>
                      </tr>
                    `
                  })}
                </tbody>
              </table>
            </div>
          `}
    </div>

    <!-- Client-side filter script -->
    <script>
      function filterMotorsCatalog() {
        const query = (document.getElementById('motor-search')?.value || '').toLowerCase().trim();
        const rows = document.querySelectorAll('.motor-row');
        rows.forEach((r) => {
          const text = r.getAttribute('data-search') || '';
          r.style.display = text.includes(query) ? '' : 'none';
        });
      }
    </script>
  `
}

/**
 * 2. Motor Detailed Specifications View
 *
 * Displays full engineering and certification specs for a single motor,
 * including max thrust, average thrust, total impulse, burn time, delay,
 * diameter, length, total mass, casing reusability, certification body/number,
 * and user's current inventory stock status with quick adjustment actions.
 */
export function motorDetailView(
  motor: Motor,
  inventoryItem?: MotorInventory | null,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const classBadge = getImpulseClassBadgeClasses(motor.impulseClass)
  const prop = formatPropellantType(motor.propellantType)

  return html`
    <div class="space-y-6 max-w-4xl mx-auto">
      <!-- Breadcrumb Navigation -->
      <nav class="flex text-sm text-slate-400" aria-label="Breadcrumb">
        <ol class="inline-flex items-center space-x-2">
          <li>
            <a href="/motors" class="hover:text-white transition-colors">Motors</a>
          </li>
          <li><span>/</span></li>
          <li class="text-white font-medium">
            ${motor.manufacturer} ${motor.model}
          </li>
        </ol>
      </nav>

      <!-- Motor Header Banner -->
      <div class="bg-slate-950 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-lg">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div class="flex flex-wrap items-center gap-2 mb-2">
              <span class="inline-flex items-center px-3 py-1 rounded-md text-sm font-bold border ${classBadge}">
                Class ${motor.impulseClass || '—'}
              </span>
              <span class="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border ${prop.badgeClasses}">
                ${prop.label}
              </span>
              ${motor.hardware
                ? html`<span class="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-sky-950/80 text-sky-300 border border-sky-700/80 shadow-sm">Required Casing / Hardware: ${motor.hardware}</span>`
                : (motor.casingReusable
                  ? html`<span class="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-sky-950/80 text-sky-300 border border-sky-800/60">Reloadable Casing</span>`
                  : html`<span class="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">Single-Use</span>`)}
            </div>
            <h1 class="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              ${motor.manufacturer} <span class="text-brand-400">${motor.model}</span>
            </h1>
            <p class="text-sm text-slate-400 mt-1">
              ${motor.diameterMm ? `${motor.diameterMm}mm diameter` : ''}
              ${motor.delayS != null ? ` • ${motor.delayS}s delay` : ''}
              ${motor.totalImpulseNs ? ` • ${motor.totalImpulseNs.toFixed(1)} N·s total impulse` : ''}
            </p>
          </div>

          <div class="flex items-center gap-3">
            <a
              href="/motors"
              class="px-4 py-2 rounded-lg text-sm font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 transition-colors"
            >
              ← Back to Catalog
            </a>
          </div>
        </div>
      </div>

      <!-- Specification Cards Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Performance Specifications -->
        <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-6 shadow-sm">
          <h2 class="text-base font-semibold text-white flex items-center gap-2 pb-3 border-b border-slate-800">
            <span>🚀</span> Performance Specifications
          </h2>
          <dl class="divide-y divide-slate-800/70 text-sm mt-2">
            <div class="py-2.5 flex justify-between">
              <dt class="text-slate-400">Total Impulse</dt>
              <dd class="font-mono font-semibold text-white">
                ${motor.totalImpulseNs != null ? motor.totalImpulseNs.toFixed(2) + ' N·s' : '—'}
              </dd>
            </div>
            <div class="py-2.5 flex justify-between">
              <dt class="text-slate-400">Average Thrust</dt>
              <dd class="font-mono font-semibold text-white">
                ${motor.averageThrustN != null ? motor.averageThrustN.toFixed(1) + ' N' : '—'}
              </dd>
            </div>
            <div class="py-2.5 flex justify-between">
              <dt class="text-slate-400">Peak / Max Thrust</dt>
              <dd class="font-mono font-semibold text-white">
                ${motor.maxThrustN != null ? motor.maxThrustN.toFixed(1) + ' N' : '—'}
              </dd>
            </div>
            <div class="py-2.5 flex justify-between">
              <dt class="text-slate-400">Burn Time</dt>
              <dd class="font-mono font-semibold text-white">
                ${motor.burnTimeS != null ? motor.burnTimeS.toFixed(2) + ' s' : '—'}
              </dd>
            </div>
            <div class="py-2.5 flex justify-between">
              <dt class="text-slate-400">Ejection Delay</dt>
              <dd class="font-mono font-semibold text-white">
                ${motor.delayS != null ? motor.delayS + ' s' : 'None / Plugged'}
              </dd>
            </div>
            <div class="py-2.5 flex justify-between">
              <dt class="text-slate-400">Propellant Type</dt>
              <dd class="font-medium text-slate-200">
                ${prop.label}
              </dd>
            </div>
          </dl>
        </div>

        <!-- Physical & Certification Specifications -->
        <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-6 shadow-sm">
          <h2 class="text-base font-semibold text-white flex items-center gap-2 pb-3 border-b border-slate-800">
            <span>📐</span> Physical & Certification
          </h2>
          <dl class="divide-y divide-slate-800/70 text-sm mt-2">
            <div class="py-2.5 flex justify-between">
              <dt class="text-slate-400">Diameter</dt>
              <dd class="font-mono font-semibold text-white">
                ${motor.diameterMm != null ? motor.diameterMm + ' mm' : '—'}
              </dd>
            </div>
            <div class="py-2.5 flex justify-between">
              <dt class="text-slate-400">Length</dt>
              <dd class="font-mono font-semibold text-white">
                ${motor.lengthMm != null ? motor.lengthMm + ' mm' : '—'}
              </dd>
            </div>
            <div class="py-2.5 flex justify-between">
              <dt class="text-slate-400">Total Mass / Weight</dt>
              <dd class="font-mono font-semibold text-white">
                ${motor.weightG != null ? motor.weightG.toFixed(1) + ' g' : '—'}
              </dd>
            </div>
            <div class="py-2.5 flex justify-between">
              <dt class="text-slate-400">Required Casing / Hardware</dt>
              <dd class="font-mono font-bold text-white">
                ${motor.hardware || (motor.casingReusable ? 'Reloadable Casing' : 'Single-Use')}
              </dd>
            </div>
            <div class="py-2.5 flex justify-between">
              <dt class="text-slate-400">Casing Type</dt>
              <dd class="font-medium text-slate-200">
                ${motor.casingReusable ? 'Reloadable / Reusable' : 'Single-Use'}
              </dd>
            </div>
            <div class="py-2.5 flex justify-between">
              <dt class="text-slate-400">Certifying Body</dt>
              <dd class="font-semibold text-white">
                ${motor.certifyingOrg || 'Uncertified / Experimental'}
              </dd>
            </div>
            <div class="py-2.5 flex justify-between">
              <dt class="text-slate-400">Certification Number</dt>
              <dd class="font-mono text-slate-300">
                ${motor.certNumber || '—'}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <!-- User Inventory Status Card -->
      <div class="bg-slate-950 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-md">
        <h2 class="text-lg font-bold text-white flex items-center gap-2 mb-4">
          <span>📦</span> User Inventory Status
        </h2>

        ${inventoryItem
          ? html`
              <div class="space-y-4">
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                  <div>
                    <span class="text-xs text-slate-400 uppercase font-semibold">Quantity on Hand</span>
                    <p class="text-2xl font-bold text-emerald-400 font-mono mt-1" id="detail-on-hand">
                      ${inventoryItem.quantityOnHand}
                    </p>
                  </div>
                  <div>
                    <span class="text-xs text-slate-400 uppercase font-semibold">Expended Count</span>
                    <p class="text-2xl font-bold text-amber-400 font-mono mt-1" id="detail-expended">
                      ${inventoryItem.expendedCount}
                    </p>
                  </div>
                  <div>
                    <span class="text-xs text-slate-400 uppercase font-semibold">Acquired On</span>
                    <p class="text-sm font-medium text-slate-200 mt-1">
                      ${inventoryItem.acquiredOn || '—'}
                    </p>
                  </div>
                  <div>
                    <span class="text-xs text-slate-400 uppercase font-semibold">Notes</span>
                    <p class="text-sm text-slate-300 mt-1 truncate">
                      ${inventoryItem.notes || '—'}
                    </p>
                  </div>
                </div>

                <!-- HTMX Quick Stock Adjustment -->
                <div class="flex flex-wrap items-center gap-3 pt-2">
                  <span class="text-sm text-slate-400 font-medium">Quick Adjust Stock:</span>
                  <form method="POST" action="/inventory/${inventoryItem.id}/adjust" class="inline">
                    <input type="hidden" name="field" value="quantity_on_hand" />
                    <input type="hidden" name="delta" value="-1" />
                    <button
                      type="submit"
                      class="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold border border-slate-700 transition-colors"
                    >
                      -1 Hand
                    </button>
                  </form>
                  <form method="POST" action="/inventory/${inventoryItem.id}/adjust" class="inline">
                    <input type="hidden" name="field" value="quantity_on_hand" />
                    <input type="hidden" name="delta" value="1" />
                    <button
                      type="submit"
                      class="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold border border-slate-700 transition-colors"
                    >
                      +1 Hand
                    </button>
                  </form>
                  <form method="POST" action="/inventory/${inventoryItem.id}/adjust" class="inline">
                    <input type="hidden" name="action" value="expend" />
                    <input type="hidden" name="delta" value="1" />
                    <button
                      type="submit"
                      class="px-3 py-1.5 rounded bg-amber-950 hover:bg-amber-900 text-amber-300 font-semibold border border-amber-800 transition-colors"
                    >
                      🔥 Log Expend
                    </button>
                  </form>
                  <a
                    href="/inventory"
                    class="ml-auto text-sm text-brand-400 hover:underline font-medium"
                  >
                    View in Full Inventory Tracker →
                  </a>
                </div>
              </div>
            `
          : html`
              <div class="rounded-xl bg-slate-900/40 border border-slate-800/80 p-6 text-center sm:text-left flex flex-col sm:flex-row items-center justify-between gap-6">
                <div>
                  <h3 class="text-base font-semibold text-white">Not Currently in Inventory</h3>
                  <p class="text-sm text-slate-400 mt-1 max-w-md">
                    Add this motor to your tracking inventory to monitor quantity on hand and expended flight counts.
                  </p>
                </div>
                <form method="POST" action="/inventory" class="flex items-center gap-3 w-full sm:w-auto">
                  <input type="hidden" name="motor_id" value="${motor.id}" />
                  <div class="flex items-center gap-2">
                    <label for="initial-qty" class="text-xs text-slate-400 whitespace-nowrap">Initial Qty:</label>
                    <input
                      type="number"
                      id="initial-qty"
                      name="quantity_on_hand"
                      value="1"
                      min="1"
                      class="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-center text-white text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    class="px-4 py-2 rounded-lg text-sm font-semibold bg-brand-500 hover:bg-brand-400 text-slate-950 transition-colors shadow-sm whitespace-nowrap"
                  >
                    + Add to Inventory
                  </button>
                </form>
              </div>
            `}
      </div>
    </div>
  `
}

/**
 * 4. Inline HTMX Inventory Row Component (Fragment)
 *
 * Partial HTML `<tr>` returned upon stock adjustments.
 * Contains inline HTMX buttons to decrement, increment, or expend stock.
 */
export function inventoryRowFragment(item: InventoryItemWithMotor): HtmlEscapedString | Promise<HtmlEscapedString> {
  const motor = item.motor || {}
  const classBadge = getImpulseClassBadgeClasses(motor.impulseClass)

  return html`
    <tr
      id="inventory-row-${item.id}"
      class="hover:bg-slate-800/40 transition-colors border-b border-slate-800/70"
    >
      <!-- Motor Manufacturer & Model -->
      <td class="whitespace-nowrap py-3.5 pl-4 pr-3 sm:pl-6">
        <div class="font-semibold text-white">
          <a href="/motors/${item.motorId}" class="hover:text-brand-400 transition-colors">
            ${motor.manufacturer || 'Unknown'} <span class="text-brand-300 font-mono">${motor.model || item.motorId}</span>
          </a>
        </div>
        <div class="text-xs text-slate-400">
          Casing: <span class="text-slate-200">${motor.hardware || (motor.casingReusable ? 'Reloadable' : 'Single-Use')}</span>
        </div>
        <div class="text-xs text-slate-400">
          ${motor.diameterMm ? `${motor.diameterMm}mm` : ''}
          ${motor.delayS != null ? ` • Delay: ${motor.delayS}s` : ''}
          ${motor.totalImpulseNs ? ` • ${motor.totalImpulseNs.toFixed(1)} N·s` : ''}
        </div>
      </td>

      <!-- Impulse Class -->
      <td class="whitespace-nowrap px-3 py-3.5">
        <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${classBadge}">
          ${motor.impulseClass || '—'}
        </span>
      </td>

      <!-- Quantity On Hand (Inline HTMX Controls) -->
      <td class="whitespace-nowrap px-3 py-3.5">
        <div class="flex items-center space-x-2">
          <button
            type="button"
            hx-post="/inventory/${item.id}/adjust"
            hx-vals='{"field": "quantity_on_hand", "delta": -1, "action": "decrement"}'
            hx-target="#inventory-row-${item.id}"
            hx-swap="outerHTML"
            class="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold flex items-center justify-center border border-slate-700 transition-colors disabled:opacity-40"
            title="Decrease on-hand count"
            ${item.quantityOnHand <= 0 ? 'disabled' : ''}
          >
            -
          </button>
          <span class="font-mono font-bold text-base text-white w-8 text-center" id="stock-${item.id}">
            ${item.quantityOnHand}
          </span>
          <button
            type="button"
            hx-post="/inventory/${item.id}/adjust"
            hx-vals='{"field": "quantity_on_hand", "delta": 1, "action": "increment"}'
            hx-target="#inventory-row-${item.id}"
            hx-swap="outerHTML"
            class="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold flex items-center justify-center border border-slate-700 transition-colors"
            title="Increase on-hand count"
          >
            +
          </button>
        </div>
      </td>

      <!-- Expended Count & Action -->
      <td class="whitespace-nowrap px-3 py-3.5">
        <div class="flex items-center space-x-3">
          <span class="font-mono text-slate-300 font-semibold text-sm w-6 text-center">
            ${item.expendedCount}
          </span>
          <button
            type="button"
            hx-post="/inventory/${item.id}/adjust"
            hx-vals='{"action": "expend", "delta": 1}'
            hx-target="#inventory-row-${item.id}"
            hx-swap="outerHTML"
            class="px-2 py-1 text-xs rounded font-medium bg-amber-950/70 hover:bg-amber-900 text-amber-300 border border-amber-800/60 transition-colors disabled:opacity-40"
            title="Expend motor (decrement on-hand, increment expended)"
            ${item.quantityOnHand <= 0 ? 'disabled' : ''}
          >
            🔥 Expend
          </button>
        </div>
      </td>

      <!-- Acquired Date -->
      <td class="whitespace-nowrap px-3 py-3.5 text-xs text-slate-400 font-mono">
        ${item.acquiredOn || '—'}
      </td>

      <!-- Notes -->
      <td class="px-3 py-3.5 text-xs text-slate-400 max-w-xs truncate">
        ${item.notes || '—'}
      </td>

      <!-- Actions -->
      <td class="whitespace-nowrap py-3.5 pl-3 pr-4 sm:pr-6 text-right">
        ${item.quantityOnHand <= 0
          ? html`
              <form
                action="/inventory/${item.id}/dismiss"
                method="POST"
                class="inline-block mr-2"
                hx-post="/inventory/${item.id}/dismiss"
                hx-target="#inventory-row-${item.id}"
                hx-swap="outerHTML"
              >
                <button
                  type="submit"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold text-red-400 hover:text-red-300 bg-red-950/40 hover:bg-red-950/70 border border-red-800/50 transition-colors cursor-pointer"
                  title="Dismiss zero-quantity motor from active inventory view"
                >
                  <span>🗑️</span>
                  <span>Dismiss</span>
                </button>
              </form>
            `
          : ''}
        <a
          href="/motors/${item.motorId}"
          class="text-xs font-semibold text-brand-400 hover:text-brand-300 hover:underline"
        >
          View Specs →
        </a>
      </td>
    </tr>
  `
}

/**
 * 3. User Inventory Tracker Page View
 *
 * Full dashboard page showing all motor inventories owned by active flyer,
 * summary counts (total in stock, total expended, unique motors),
 * and responsive table with inline HTMX increment/decrement buttons.
 */
export function inventoryListView(inventoryItems: InventoryItemWithMotor[]): HtmlEscapedString | Promise<HtmlEscapedString> {
  const totalOnHand = inventoryItems.reduce((sum, item) => sum + (item.quantityOnHand || 0), 0)
  const totalExpended = inventoryItems.reduce((sum, item) => sum + (item.expendedCount || 0), 0)
  const uniqueCount = inventoryItems.length

  return html`
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>📦</span>
            <span>Motor Inventory</span>
          </h1>
          <p class="text-sm text-slate-400 mt-1">
            Track your rocket motor supply, record fired/expended motors, and manage stock on hand.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <a
            href="/motors"
            class="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold bg-brand-500 hover:bg-brand-400 text-slate-950 transition-colors shadow-sm"
          >
            + Browse Motor Catalog
          </a>
        </div>
      </div>

      <!-- Inventory Summary Metrics -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-5 shadow-sm">
          <span class="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Motors on Hand</span>
          <div class="mt-2 flex items-baseline justify-between">
            <span class="text-3xl font-extrabold text-emerald-400 font-mono">${totalOnHand}</span>
            <span class="text-xs text-slate-400">ready to fly</span>
          </div>
        </div>
        <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-5 shadow-sm">
          <span class="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Expended</span>
          <div class="mt-2 flex items-baseline justify-between">
            <span class="text-3xl font-extrabold text-amber-400 font-mono">${totalExpended}</span>
            <span class="text-xs text-slate-400">fired in logs</span>
          </div>
        </div>
        <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-5 shadow-sm">
          <span class="text-xs font-semibold uppercase tracking-wider text-slate-400">Distinct Motor Types</span>
          <div class="mt-2 flex items-baseline justify-between">
            <span class="text-3xl font-extrabold text-white font-mono">${uniqueCount}</span>
            <span class="text-xs text-slate-400">models owned</span>
          </div>
        </div>
      </div>

      <!-- Inventory Table / Empty State -->
      ${inventoryItems.length === 0
        ? html`
            <div class="text-center py-16 bg-slate-950/40 rounded-xl border border-slate-800 p-8">
              <span class="text-5xl mb-3 block">📦</span>
              <h3 class="text-lg font-semibold text-white">No Motors in Inventory</h3>
              <p class="text-sm text-slate-400 mt-1 max-w-sm mx-auto">
                You have not added any rocket motors to your inventory yet. Browse the catalog to stock up.
              </p>
              <div class="mt-6">
                <a
                  href="/motors"
                  class="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold bg-brand-500 hover:bg-brand-400 text-slate-950 transition-colors shadow-sm"
                >
                  Browse Catalog
                </a>
              </div>
            </div>
          `
        : html`
            <div class="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/50 shadow-md">
              <table class="min-w-full divide-y divide-slate-800 text-left text-sm">
                <thead class="bg-slate-900/90 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th scope="col" class="py-3.5 pl-4 pr-3 sm:pl-6">Motor (Mfr & Model)</th>
                    <th scope="col" class="px-3 py-3.5">Class</th>
                    <th scope="col" class="px-3 py-3.5">On Hand</th>
                    <th scope="col" class="px-3 py-3.5">Expended</th>
                    <th scope="col" class="px-3 py-3.5">Acquired</th>
                    <th scope="col" class="px-3 py-3.5">Notes</th>
                    <th scope="col" class="py-3.5 pl-3 pr-4 sm:pr-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-800/60 bg-slate-950/20">
                  ${inventoryItems.map((item) => inventoryRowFragment(item))}
                </tbody>
              </table>
            </div>
          `}
    </div>
  `
}

export interface MotorImportViewProps {
  summary?: {
    success: boolean
    total: number
    imported: number
    updated: number
    errors: string[]
  } | null
  error?: string | null
}

export function motorImportView(props: MotorImportViewProps = {}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { summary, error } = props

  return html`
    <div class="max-w-4xl mx-auto space-y-6">
      <div class="border-b border-slate-800 pb-4">
        <a href="/motors" class="text-xs text-brand-400 hover:underline">← Back to Motor Catalog</a>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2.5 mt-2">
          <span>📥</span>
          <span>Import Motor Catalog (CSV)</span>
        </h1>
        <p class="text-sm text-slate-400 mt-1">
          Batch import commercial rocket motor specifications using the authoritative 20-column CSV format.
        </p>
      </div>

      ${error
        ? html`
            <div class="p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-sm flex items-center gap-2">
              <span>⚠️</span>
              <span>${error}</span>
            </div>
          `
        : ''}

      ${summary
        ? html`
            <div class="p-5 rounded-2xl ${
              summary.success ? 'bg-emerald-950/40 border border-emerald-800' : 'bg-amber-950/40 border border-amber-800'
            } space-y-3">
              <div class="flex items-center gap-2 text-base font-semibold ${
                summary.success ? 'text-emerald-300' : 'text-amber-300'
              }">
                <span>${summary.success ? '✅' : '⚠️'}</span>
                <span>Import Summary: ${summary.imported} imported, ${summary.updated} updated (${summary.total} total processed)</span>
              </div>
              <p class="text-xs text-slate-300">
                ${summary.imported} new motor records created, ${summary.updated} existing motor records updated.
              </p>
              ${summary.errors && summary.errors.length > 0
                ? html`
                    <div class="mt-2 text-xs text-rose-300 space-y-1">
                      <div class="font-bold">Errors encountered:</div>
                      ${summary.errors.map((e) => html`<div>• ${e}</div>`)}
                    </div>
                  `
                : ''}
              <div class="pt-2 flex items-center gap-3">
                <a
                  href="/motors"
                  class="inline-flex items-center px-4 py-2 rounded-lg text-xs font-semibold bg-brand-500 hover:bg-brand-400 text-slate-950 transition-colors"
                >
                  View in Motor Catalog →
                </a>
              </div>
            </div>
          `
        : ''}

      <!-- 20-Column Schema Reference Card -->
      <div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <span>📋</span>
            <span>Authoritative 20-Column CSV Schema</span>
          </h2>
          <span class="text-xs text-brand-400 font-mono">RFC 4180 Compliant</span>
        </div>
        <p class="text-xs text-slate-400 leading-relaxed">
          The CSV parser supports standard quotation marks, commas inside quoted strings, multiline entries, and Windows (CRLF) or Unix (LF) line breaks.
        </p>
        <div class="bg-slate-950 border border-slate-800 rounded-xl p-3 overflow-x-auto text-xs font-mono text-slate-300">
          Part_Number, Designation_Product_Name, Manufacturer, Diameter_mm, Hardware, Total_Impulse_Ns, Avg_Thrust_N, Peak_Thrust_N, Propellant_Type, Grains, Propellant_Weight_g, Grain_Weight_g, Total_Weight_g, UN_Number, Classification, Length, Thrust_Duration_Sec, Delay_Sec, USPS_Mailable, Notes
        </div>
      </div>

      <!-- Import Form -->
      <form method="POST" action="/motors/import" enctype="multipart/form-data" class="space-y-6 bg-slate-900/60 p-6 rounded-2xl border border-slate-800">
        <div>
          <label class="block text-xs font-semibold uppercase text-slate-300 mb-1.5">
            Option 1: Paste CSV Data
          </label>
          <textarea
            name="csv_data"
            rows="8"
            placeholder="Paste your 20-column CSV data here including header row..."
            class="w-full bg-slate-950 border border-slate-700 rounded-xl p-3.5 text-white font-mono text-xs focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
          ></textarea>
        </div>

        <div class="relative flex items-center justify-center">
          <div class="border-t border-slate-800 w-full"></div>
          <div class="bg-slate-900 px-3 text-xs text-slate-500 uppercase font-bold">Or</div>
          <div class="border-t border-slate-800 w-full"></div>
        </div>

        <div>
          <label class="block text-xs font-semibold uppercase text-slate-300 mb-1.5">
            Option 2: Upload CSV File
          </label>
          <input
            type="file"
            name="csv_file"
            accept=".csv,text/csv"
            class="w-full text-sm text-slate-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-brand-300 hover:file:bg-slate-700 cursor-pointer bg-slate-950 border border-slate-700 rounded-xl"
          />
        </div>

        <div class="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
          <a
            href="/motors"
            class="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </a>
          <button
            type="submit"
            class="px-5 py-2 rounded-lg text-sm font-semibold bg-brand-500 hover:bg-brand-400 text-slate-950 transition-colors shadow-sm"
          >
            Process & Import Motors
          </button>
        </div>
      </form>
    </div>
  `
}
