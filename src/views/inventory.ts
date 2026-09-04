/**
 * Comprehensive Inventory & Regulatory Chain-of-Custody Views (`src/views/inventory.ts`).
 *
 * Provides responsive HTML views for:
 * 1. Unified component and motor inventory tracking.
 * 2. Regulatory compliance overview (Net Explosive Weight, HPR motor holdings, magazine limits).
 * 3. Regulatory chain-of-custody audit ledger (purchases, receipts, flight use, sales/transfers, disposals, losses).
 * 4. Interactive modals/forms for recording lifecycle transactions and adding components.
 */

import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import * as schema from '../db/schema'
import {
  getTransactionTypeBadge,
  type StorageSummary,
  getRequiredCertLevelForImpulse,
} from '../services/compliance'
import { getImpulseClassBadgeClasses } from './motors'

export type Component = typeof schema.components.$inferSelect
export type MotorInventory = typeof schema.motorInventories.$inferSelect
export type InventoryTransaction = typeof schema.inventoryTransactions.$inferSelect
export type Motor = typeof schema.motors.$inferSelect

export interface MotorInventoryWithMotor extends MotorInventory {
  motor?: Partial<Motor> | null
}

export interface InventoryPageData {
  motors: MotorInventoryWithMotor[]
  components: Component[]
  transactions: (InventoryTransaction & {
    motor?: Partial<Motor> | null
    component?: Partial<Component> | null
  })[]
  storageSummary: StorageSummary
  activeFilter?: string
  catalogMotors?: Partial<Motor>[]
}

/**
 * Returns badge styling for component categories.
 */
export function getCategoryBadgeClasses(category: string): { label: string; badgeClasses: string; icon: string } {
  switch (category) {
    case 'motor':
      return { label: 'Motor / Reload', badgeClasses: 'bg-indigo-950/70 text-indigo-300 border-indigo-700/60', icon: '⚡' }
    case 'casing':
      return { label: 'Casing / Hardware', badgeClasses: 'bg-zinc-800 text-zinc-300 border-zinc-700', icon: '🔩' }
    case 'recovery':
      return { label: 'Recovery Gear', badgeClasses: 'bg-sky-950/70 text-sky-300 border-sky-700/60', icon: '🪂' }
    case 'avionics':
      return { label: 'Avionics / Electronics', badgeClasses: 'bg-cyan-950/70 text-cyan-300 border-cyan-700/60', icon: '📟' }
    case 'pyrotechnic':
      return { label: 'Pyrotechnic / E-Match', badgeClasses: 'bg-amber-950/70 text-amber-300 border-amber-700/60', icon: '💥' }
    case 'airframe':
      return { label: 'Airframe / Structural', badgeClasses: 'bg-blue-950/70 text-blue-300 border-blue-700/60', icon: '🚀' }
    case 'hardware':
      return { label: 'Hardware / Rigging', badgeClasses: 'bg-slate-800 text-slate-300 border-slate-700', icon: '🔧' }
    case 'payload':
      return { label: 'Payload / Sensors', badgeClasses: 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60', icon: '📷' }
    default:
      return { label: category || 'Other', badgeClasses: 'bg-slate-800 text-slate-400 border-slate-700', icon: '📦' }
  }
}

/**
 * Returns condition badge styling.
 */
export function getConditionBadgeClasses(condition: string): { label: string; badgeClasses: string } {
  switch (condition) {
    case 'new':
      return { label: 'New', badgeClasses: 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60' }
    case 'good':
      return { label: 'Good', badgeClasses: 'bg-teal-950/70 text-teal-300 border-teal-700/60' }
    case 'fair':
      return { label: 'Fair', badgeClasses: 'bg-slate-800 text-slate-300 border-slate-700' }
    case 'damaged':
      return { label: 'Damaged', badgeClasses: 'bg-red-950/70 text-red-300 border-red-700/60' }
    case 'quarantined':
      return { label: 'Quarantined', badgeClasses: 'bg-rose-950/90 text-rose-300 border-rose-600 font-bold' }
    case 'retired':
      return { label: 'Retired', badgeClasses: 'bg-zinc-900 text-zinc-400 border-zinc-700' }
    default:
      return { label: condition, badgeClasses: 'bg-slate-800 text-slate-400 border-slate-700' }
  }
}

/**
 * Main Inventory & Compliance Hub View.
 */
export function inventoryHubView(data: InventoryPageData): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { motors, components, transactions, storageSummary, activeFilter = 'all', catalogMotors = [] } = data

  const filterTabClass = (f: string) =>
    activeFilter === f
      ? 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-500 text-slate-950 transition-colors'
      : 'px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors'

  return html`
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>📦</span>
            <span>Flight & Component Inventory</span>
          </h1>
          <p class="text-sm text-slate-400 mt-1">
            Comprehensive rocketry hardware tracking, motor lifecycle management, and regulatory chain-of-custody.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2.5">
          <a
            href="/inventory/transactions/new"
            class="inline-flex items-center px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold bg-purple-600 hover:bg-purple-500 text-white transition-colors shadow-sm gap-1.5"
          >
            <span>⚖️</span>
            <span>Record Movement / Sale</span>
          </a>
          <a
            href="/inventory/components/new"
            class="inline-flex items-center px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold bg-brand-500 hover:bg-brand-400 text-slate-950 transition-colors shadow-sm gap-1.5"
          >
            <span>+</span>
            <span>Add Component</span>
          </a>
          <a
            href="/motors"
            class="inline-flex items-center px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors gap-1.5"
          >
            <span>⚡</span>
            <span>Motor Catalog</span>
          </a>
        </div>
      </div>

      <!-- Regulatory & Storage Compliance Dashboard Card -->
      <div class="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-slate-800 p-5 shadow-lg">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
          <div class="flex items-center gap-2">
            <span class="text-lg">🛡️</span>
            <h2 class="text-sm font-bold uppercase tracking-wider text-slate-300">
              Government Regulatory & Magazine Storage Compliance
            </h2>
          </div>
          <div class="text-xs text-slate-400">
            Guideline: NFPA 1122 / 1127 & State Explosives Regulations
          </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4">
          <div class="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <span class="text-xs font-semibold uppercase text-slate-400">Net Propellant Mass (NEW)</span>
            <p class="text-2xl font-bold font-mono text-emerald-400 mt-1">
              ${storageSummary.totalPropellantMassG.toFixed(1)} <span class="text-xs text-slate-400 font-sans font-normal">g</span>
            </p>
            <span class="text-xs text-slate-500">
              ${storageSummary.totalPropellantMassLbs.toFixed(2)} lbs (${storageSummary.totalPropellantMassKg.toFixed(2)} kg)
            </span>
          </div>

          <div class="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <span class="text-xs font-semibold uppercase text-slate-400">High-Power Motors (H–O)</span>
            <p class="text-2xl font-bold font-mono text-amber-400 mt-1">
              ${storageSummary.highPowerMotorCount} <span class="text-xs text-slate-400 font-sans font-normal">units</span>
            </p>
            <span class="text-xs text-slate-500">Requires NAR/TRA Level 1-3 & LEUP</span>
          </div>

          <div class="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <span class="text-xs font-semibold uppercase text-slate-400">Total Items in Stock</span>
            <p class="text-2xl font-bold font-mono text-cyan-400 mt-1">
              ${storageSummary.totalUnitsOnHand} <span class="text-xs text-slate-400 font-sans font-normal">items</span>
            </p>
            <span class="text-xs text-slate-500">${motors.length} motor types, ${components.length} components</span>
          </div>

          <div class="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <span class="text-xs font-semibold uppercase text-slate-400">Quarantine / Expired</span>
            <p class="text-2xl font-bold font-mono ${storageSummary.quarantinedCount > 0 || storageSummary.expiredCount > 0 ? 'text-rose-400' : 'text-slate-400'} mt-1">
              ${storageSummary.quarantinedCount + storageSummary.expiredCount}
            </p>
            <span class="text-xs text-slate-500">
              ${storageSummary.quarantinedCount} quarantined, ${storageSummary.expiredCount} expired
            </span>
          </div>
        </div>

        <!-- Compliance Warnings Banner if Any -->
        ${storageSummary.warnings.length > 0
          ? html`
              <div class="mt-4 p-3 rounded-xl bg-amber-950/40 border border-amber-800/70 text-amber-200 text-xs space-y-1">
                <div class="font-bold flex items-center gap-1.5 text-amber-300">
                  <span>⚠️</span>
                  <span>Compliance Attention Required:</span>
                </div>
                ${storageSummary.warnings.map((w) => html`<p class="pl-5 list-disc">• ${w}</p>`)}
              </div>
            `
          : ''}
      </div>

      <!-- Navigation Filter Tabs -->
      <div class="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <a href="/inventory" class="${filterTabClass('all')}">All Items (${motors.length + components.length})</a>
          <a href="/inventory?filter=motors" class="${filterTabClass('motors')}">⚡ Motors (${motors.length})</a>
          <a href="/inventory?filter=casing" class="${filterTabClass('casing')}">🔩 Casings</a>
          <a href="/inventory?filter=pyrotechnic" class="${filterTabClass('pyrotechnic')}">💥 Pyros / Igniters</a>
          <a href="/inventory?filter=recovery" class="${filterTabClass('recovery')}">🪂 Recovery</a>
          <a href="/inventory?filter=avionics" class="${filterTabClass('avionics')}">📟 Avionics</a>
          <a href="/inventory?filter=airframe" class="${filterTabClass('airframe')}">🚀 Airframe</a>
        </div>

        <div>
          <a
            href="/inventory/transactions"
            class="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-brand-300 border border-slate-700 transition-colors gap-1.5"
          >
            <span>📜</span>
            <span>View Full Custody Ledger (${transactions.length} entries) →</span>
          </a>
        </div>
      </div>

      <!-- Inventory Tables Section -->
      <div class="space-y-6">
        <!-- 1. Motor Inventory Section -->
        ${['all', 'motors'].includes(activeFilter)
          ? html`
              <div class="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden shadow">
                <div class="px-4 py-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="text-base">⚡</span>
                    <h2 class="text-sm font-bold text-white uppercase tracking-wider">Rocket Motors & Propellant</h2>
                  </div>
                  <span class="text-xs text-slate-400">${motors.length} configured motor entries</span>
                </div>

                <div class="overflow-x-auto">
                  <table class="min-w-full divide-y divide-slate-800 text-left text-sm">
                    <thead class="bg-slate-950/40 text-xs uppercase font-semibold text-slate-400">
                      <tr>
                        <th class="py-3 pl-4 pr-3 sm:pl-6">Motor Model</th>
                        <th class="px-3 py-3">Impulse</th>
                        <th class="px-3 py-3">Stock on Hand</th>
                        <th class="px-3 py-3">Used / Fired</th>
                        <th class="px-3 py-3">Sold / Disposed</th>
                        <th class="px-3 py-3">Lot & Location</th>
                        <th class="py-3 pl-3 pr-4 sm:pr-6 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-800/60">
                      ${motors.length === 0
                        ? html`
                            <tr>
                              <td colspan="7" class="py-6 text-center text-slate-500 italic">
                                No motors currently tracked in your inventory.
                                <a href="/motors" class="text-brand-400 hover:underline ml-1">Browse catalog to add motors →</a>
                              </td>
                            </tr>
                          `
                        : motors.map((item) => {
                            const motor = item.motor || {}
                            const classBadge = getImpulseClassBadgeClasses(motor.impulseClass)
                            return html`
                              <tr id="inventory-row-${item.id}" class="hover:bg-slate-800/40 transition-colors">
                                <td class="py-3.5 pl-4 pr-3 sm:pl-6">
                                  <div class="font-semibold text-white">
                                    <a href="/motors/${item.motorId}" class="hover:text-brand-400 transition-colors">
                                      ${motor.manufacturer || 'Unknown'} <span class="font-mono text-brand-300">${motor.model || item.motorId}</span>
                                    </a>
                                  </div>
                                  <div class="text-xs text-slate-400">
                                    ${motor.diameterMm ? `${motor.diameterMm}mm` : ''}
                                    ${motor.propellantType ? ` • ${motor.propellantType.toUpperCase()}` : ''}
                                    ${motor.weightG ? ` • Propellant: ${motor.weightG}g` : ''}
                                  </div>
                                </td>
                                <td class="px-3 py-3.5">
                                  <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${classBadge}">
                                    ${motor.impulseClass || '—'}
                                  </span>
                                </td>
                                <td class="px-3 py-3.5">
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
                                    <span class="font-mono font-bold text-base text-white w-8 text-center">
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
                                <td class="px-3 py-3.5">
                                  <div class="flex items-center space-x-2">
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
                                      title="Log motor fired/expended"
                                      ${item.quantityOnHand <= 0 ? 'disabled' : ''}
                                    >
                                      🔥 Expend
                                    </button>
                                  </div>
                                </td>
                                <td class="px-3 py-3.5 text-xs text-slate-400 font-mono">
                                  ${item.soldCount || 0} sold / ${item.disposedCount || 0} disp
                                </td>
                                <td class="px-3 py-3.5 text-xs text-slate-400">
                                  <div>${item.storageLocation || 'Default Magazine'}</div>
                                  <div class="font-mono text-slate-500">${item.batchLotNumber ? `Lot: ${item.batchLotNumber}` : ''}</div>
                                </td>
                                <td class="py-3.5 pl-3 pr-4 sm:pr-6 text-right whitespace-nowrap">
                                  <a
                                    href="/inventory/transactions/new?motor_inventory_id=${item.id}"
                                    class="text-xs font-semibold text-purple-400 hover:text-purple-300 hover:underline mr-3"
                                  >
                                    Transfer / Sell →
                                  </a>
                                  <a
                                    href="/motors/${item.motorId}"
                                    class="text-xs font-semibold text-brand-400 hover:text-brand-300 hover:underline"
                                  >
                                    Specs
                                  </a>
                                </td>
                              </tr>
                            `
                          })}
                    </tbody>
                  </table>
                </div>
              </div>
            `
          : ''}

        <!-- 2. Other Components & Hardware Section -->
        ${activeFilter !== 'motors'
          ? html`
              <div class="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden shadow">
                <div class="px-4 py-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="text-base">🛠️</span>
                    <h2 class="text-sm font-bold text-white uppercase tracking-wider">
                      Rocket Components & Hardware
                    </h2>
                  </div>
                  <a
                    href="/inventory/components/new"
                    class="text-xs font-semibold text-brand-400 hover:text-brand-300 hover:underline"
                  >
                    + Add New Component
                  </a>
                </div>

                <div class="overflow-x-auto">
                  <table class="min-w-full divide-y divide-slate-800 text-left text-sm">
                    <thead class="bg-slate-950/40 text-xs uppercase font-semibold text-slate-400">
                      <tr>
                        <th class="py-3 pl-4 pr-3 sm:pl-6">Component / Part</th>
                        <th class="px-3 py-3">Category</th>
                        <th class="px-3 py-3">Condition</th>
                        <th class="px-3 py-3">Stock on Hand</th>
                        <th class="px-3 py-3">Location & Hazard</th>
                        <th class="py-3 pl-3 pr-4 sm:pr-6 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-800/60">
                      ${components.length === 0
                        ? html`
                            <tr>
                              <td colspan="6" class="py-6 text-center text-slate-500 italic">
                                No non-motor components tracked yet.
                                <a href="/inventory/components/new" class="text-brand-400 hover:underline ml-1">
                                  Add your first casing, parachute, or electronics component →
                                </a>
                              </td>
                            </tr>
                          `
                        : components
                            .filter((c) => activeFilter === 'all' || c.category === activeFilter)
                            .map((comp) => {
                              const cat = getCategoryBadgeClasses(comp.category)
                              const cond = getConditionBadgeClasses(comp.condition)
                              return html`
                                <tr id="component-row-${comp.id}" class="hover:bg-slate-800/40 transition-colors">
                                  <td class="py-3.5 pl-4 pr-3 sm:pl-6">
                                    <div class="font-semibold text-white">
                                      <a href="/inventory/components/${comp.id}" class="hover:text-brand-400 transition-colors">
                                        ${comp.name}
                                      </a>
                                    </div>
                                    <div class="text-xs text-slate-400">
                                      ${comp.manufacturer ? comp.manufacturer : ''}
                                      ${comp.partNumber ? ` • PN: ${comp.partNumber}` : ''}
                                      ${comp.serialNumber ? ` • SN: ${comp.serialNumber}` : ''}
                                      ${comp.lotNumber ? ` • Lot: ${comp.lotNumber}` : ''}
                                    </div>
                                  </td>
                                  <td class="px-3 py-3.5">
                                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${cat.badgeClasses}">
                                      ${cat.icon} ${cat.label}
                                    </span>
                                  </td>
                                  <td class="px-3 py-3.5">
                                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cond.badgeClasses}">
                                      ${cond.label}
                                    </span>
                                  </td>
                                  <td class="px-3 py-3.5">
                                    <div class="flex items-center space-x-2">
                                      <button
                                        type="button"
                                        hx-post="/inventory/components/${comp.id}/adjust"
                                        hx-vals='{"action": "decrement", "delta": 1}'
                                        hx-target="#component-row-${comp.id}"
                                        hx-swap="outerHTML"
                                        class="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold flex items-center justify-center border border-slate-700 transition-colors disabled:opacity-40"
                                        ${comp.quantityOnHand <= 0 ? 'disabled' : ''}
                                      >
                                        -
                                      </button>
                                      <span class="font-mono font-bold text-base text-white w-8 text-center">
                                        ${comp.quantityOnHand}
                                      </span>
                                      <button
                                        type="button"
                                        hx-post="/inventory/components/${comp.id}/adjust"
                                        hx-vals='{"action": "increment", "delta": 1}'
                                        hx-target="#component-row-${comp.id}"
                                        hx-swap="outerHTML"
                                        class="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold flex items-center justify-center border border-slate-700 transition-colors"
                                      >
                                        +
                                      </button>
                                    </div>
                                  </td>
                                  <td class="px-3 py-3.5 text-xs text-slate-400">
                                    <div>${comp.storageLocation || 'Workshop'}</div>
                                    <div class="text-slate-500">${comp.hazardClass ? `Hazard: ${comp.hazardClass}` : ''}</div>
                                  </td>
                                  <td class="py-3.5 pl-3 pr-4 sm:pr-6 text-right whitespace-nowrap">
                                    <a
                                      href="/inventory/transactions/new?component_id=${comp.id}"
                                      class="text-xs font-semibold text-purple-400 hover:text-purple-300 hover:underline mr-3"
                                    >
                                      Transfer →
                                    </a>
                                    <a
                                      href="/inventory/components/${comp.id}"
                                      class="text-xs font-semibold text-brand-400 hover:text-brand-300 hover:underline"
                                    >
                                      Edit / View
                                    </a>
                                  </td>
                                </tr>
                              `
                            })}
                    </tbody>
                  </table>
                </div>
              </div>
            `
          : ''}

        <!-- 3. Recent Regulatory Chain-of-Custody Snippet -->
        <div class="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden shadow">
          <div class="px-4 py-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-base">📜</span>
              <h2 class="text-sm font-bold text-white uppercase tracking-wider">
                Recent Chain-of-Custody & Movement Records
              </h2>
            </div>
            <a
              href="/inventory/transactions"
              class="text-xs font-semibold text-brand-400 hover:text-brand-300 hover:underline"
            >
              View Full Audit Ledger (${transactions.length}) →
            </a>
          </div>

          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-800 text-left text-sm">
              <thead class="bg-slate-950/40 text-xs uppercase font-semibold text-slate-400">
                <tr>
                  <th class="py-3 pl-4 pr-3 sm:pl-6">Date</th>
                  <th class="px-3 py-3">Action / Lifecycle</th>
                  <th class="px-3 py-3">Item</th>
                  <th class="px-3 py-3">Qty</th>
                  <th class="px-3 py-3">Counterparty / Recipient</th>
                  <th class="py-3 pl-3 pr-4 sm:pr-6">Notes / Ref</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60">
                ${transactions.length === 0
                  ? html`
                      <tr>
                        <td colspan="6" class="py-6 text-center text-slate-500 italic">
                          No custody transactions logged yet. Use "Record Movement / Sale" to track acquisitions, transfers, or disposals.
                        </td>
                      </tr>
                    `
                  : transactions.slice(0, 5).map((tx) => {
                      const badge = getTransactionTypeBadge(tx.transactionType)
                      const itemName = tx.motor
                        ? `${tx.motor.manufacturer} ${tx.motor.model}`
                        : tx.component
                          ? tx.component.name
                          : 'Inventory Item'
                      return html`
                        <tr class="hover:bg-slate-800/40 transition-colors text-xs">
                          <td class="py-3 pl-4 pr-3 sm:pl-6 font-mono text-slate-300 whitespace-nowrap">
                            ${tx.transactionDate}
                          </td>
                          <td class="px-3 py-3 whitespace-nowrap">
                            <span class="inline-flex items-center px-2 py-0.5 rounded border font-semibold ${badge.badgeClasses}">
                              <span class="mr-1">${badge.icon}</span> ${badge.label}
                            </span>
                          </td>
                          <td class="px-3 py-3 font-semibold text-white whitespace-nowrap">
                            ${itemName}
                          </td>
                          <td class="px-3 py-3 font-mono font-bold text-slate-200">
                            ${tx.quantity}
                          </td>
                          <td class="px-3 py-3 text-slate-300">
                            <div>${tx.counterpartyName || '—'}</div>
                            <div class="font-mono text-slate-500">
                              ${tx.counterpartyCertNumber ? `Cert: ${tx.counterpartyCertNumber}` : ''}
                              ${tx.counterpartyLicense ? ` • Lic: ${tx.counterpartyLicense}` : ''}
                            </div>
                          </td>
                          <td class="py-3 pl-3 pr-4 sm:pr-6 text-slate-400">
                            ${tx.notes || tx.referenceId || '—'}
                          </td>
                        </tr>
                      `
                    })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `
}

/**
 * Record New Transaction Form (Chain-of-Custody / Movement Logging).
 */
export function recordTransactionFormView(options: {
  motors: MotorInventoryWithMotor[]
  components: Component[]
  preselectedMotorInvId?: string
  preselectedComponentId?: string
  warnings?: string[]
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { motors, components, preselectedMotorInvId, preselectedComponentId, warnings = [] } = options

  return html`
    <div class="max-w-2xl mx-auto space-y-6">
      <div class="border-b border-slate-800 pb-3">
        <a href="/inventory" class="text-xs text-brand-400 hover:underline">← Back to Inventory</a>
        <h1 class="text-2xl font-bold text-white mt-2 flex items-center gap-2">
          <span>⚖️</span>
          <span>Record Inventory Movement / Custody Event</span>
        </h1>
        <p class="text-sm text-slate-400 mt-1">
          Log purchases, receipts, flight expenditure, sales/transfers to another person, disposals, or loss reports.
        </p>
      </div>

      ${warnings.length > 0
        ? html`
            <div class="p-4 rounded-xl bg-amber-950/50 border border-amber-700 text-amber-200 text-sm space-y-1">
              <span class="font-bold">⚠️ Compliance Alerts:</span>
              ${warnings.map((w) => html`<p>• ${w}</p>`)}
            </div>
          `
        : ''}

      <form method="POST" action="/inventory/transactions" class="space-y-5 bg-slate-900/60 p-6 rounded-2xl border border-slate-800">
        <!-- Item Selection -->
        <div>
          <label class="block text-xs font-semibold uppercase text-slate-300 mb-1.5">Select Inventory Item *</label>
          <select
            name="item_ref"
            required
            class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            <optgroup label="Motors & Propellant">
              ${motors.map((m) => {
                const isSelected = m.id === preselectedMotorInvId
                return html`
                  <option value="motor:${m.id}" ${isSelected ? 'selected' : ''}>
                    [Motor] ${m.motor?.manufacturer} ${m.motor?.model} (Impulse: ${m.motor?.impulseClass}, On Hand: ${m.quantityOnHand})
                  </option>
                `
              })}
            </optgroup>
            <optgroup label="Other Components">
              ${components.map((c) => {
                const isSelected = c.id === preselectedComponentId
                return html`
                  <option value="component:${c.id}" ${isSelected ? 'selected' : ''}>
                    [${c.category.toUpperCase()}] ${c.name} (On Hand: ${c.quantityOnHand})
                  </option>
                `
              })}
            </optgroup>
          </select>
        </div>

        <!-- Transaction Type -->
        <div>
          <label class="block text-xs font-semibold uppercase text-slate-300 mb-1.5">Transaction / Lifecycle Event *</label>
          <select
            name="transaction_type"
            required
            id="transaction_type"
            class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            <option value="purchased">🛒 Purchased / Ordered (from vendor/supplier)</option>
            <option value="received" selected>📦 Received into Stock (physically delivered/stocked)</option>
            <option value="used">🔥 Used / Fired (flight consumption)</option>
            <option value="sold">🤝 Sold to Someone Else (transferred to another person)</option>
            <option value="transferred_in">📥 Transferred In (acquired from peer/club member)</option>
            <option value="disposed">🗑️ Disposed / Neutralized (misfire, damaged grain, expired)</option>
            <option value="destroyed">💥 Destroyed (casing failure / CATO disposal)</option>
            <option value="lost">🚨 Reported Lost / Stolen</option>
            <option value="quarantined">🔒 Quarantined (suspect condition / recall)</option>
            <option value="loaned_out">📤 Loaned Out (temporary range loan)</option>
            <option value="borrowed">📥 Borrowed (temporary custody)</option>
            <option value="audit_adjustment">📋 Physical Inventory Audit Reconciliation</option>
          </select>
        </div>

        <!-- Quantity & Date Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-semibold uppercase text-slate-300 mb-1.5">Quantity *</label>
            <input
              type="number"
              name="quantity"
              value="1"
              min="1"
              required
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
          <div>
            <label class="block text-xs font-semibold uppercase text-slate-300 mb-1.5">Transaction Date *</label>
            <input
              type="date"
              name="transaction_date"
              value="${new Date().toISOString().slice(0, 10)}"
              required
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
        </div>

        <!-- Recipient / Buyer / Counterparty Details -->
        <div class="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-4">
          <div class="text-xs font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
            <span>🤝</span>
            <span>Counterparty & Regulatory Verification (For Sales, Transfers, or Vendor Orders)</span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Counterparty Full Name (Buyer / Seller / Vendor)</label>
              <input
                type="text"
                name="counterparty_name"
                placeholder="e.g. John Doe / Apogee Rockets"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
              />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">NAR / TRA Certification # (If Selling HPR Motor)</label>
              <input
                type="text"
                name="counterparty_cert_number"
                placeholder="e.g. NAR 98765 / TRA 12345"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
              />
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Explosives Permit / LEUP / License #</label>
              <input
                type="text"
                name="counterparty_license"
                placeholder="e.g. ATF LEUP / State License"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
              />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Contact Details (Phone / Email)</label>
              <input
                type="text"
                name="counterparty_contact"
                placeholder="johndoe@example.com"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
              />
            </div>
          </div>
        </div>

        <!-- Tracking, Batch, Location & Disposal Verification -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label class="block text-xs text-slate-400 mb-1">Lot / Batch Number</label>
            <input
              type="text"
              name="batch_lot_number"
              placeholder="e.g. LOT-2026-B"
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Storage Location / Magazine</label>
            <input
              type="text"
              name="storage_location"
              placeholder="e.g. Magazine 1 / Bin B"
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Witness / RSO Name (If Disposing)</label>
            <input
              type="text"
              name="witness_name"
              placeholder="e.g. Range Safety Officer"
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
        </div>

        <!-- Notes / Compliance Justification -->
        <div>
          <label class="block text-xs font-semibold uppercase text-slate-300 mb-1.5">Compliance Notes / Reason</label>
          <textarea
            name="notes"
            rows="2"
            placeholder="Details of the sale, receipt confirmation, disposal method, or incident report #..."
            class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          ></textarea>
        </div>

        <div class="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
          <a
            href="/inventory"
            class="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </a>
          <button
            type="submit"
            class="px-5 py-2 rounded-lg text-sm font-semibold bg-brand-500 hover:bg-brand-400 text-slate-950 transition-colors shadow-sm"
          >
            Save Custody Transaction
          </button>
        </div>
      </form>
    </div>
  `
}

/**
 * Add New Component View.
 */
export function addComponentFormView(): HtmlEscapedString | Promise<HtmlEscapedString> {
  return html`
    <div class="max-w-2xl mx-auto space-y-6">
      <div class="border-b border-slate-800 pb-3">
        <a href="/inventory" class="text-xs text-brand-400 hover:underline">← Back to Inventory</a>
        <h1 class="text-2xl font-bold text-white mt-2 flex items-center gap-2">
          <span>🛠️</span>
          <span>Add New Hardware / Rocketry Component</span>
        </h1>
        <p class="text-sm text-slate-400 mt-1">
          Catalog reusable casings, parachutes, dual-deploy altimeters, pyrotechnic igniters, and airframe parts.
        </p>
      </div>

      <form method="POST" action="/inventory/components" class="space-y-5 bg-slate-900/60 p-6 rounded-2xl border border-slate-800">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-semibold uppercase text-slate-300 mb-1.5">Component Name *</label>
            <input
              type="text"
              name="name"
              required
              placeholder="e.g. AeroTech 29/180 Hardware Casing"
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
          <div>
            <label class="block text-xs font-semibold uppercase text-slate-300 mb-1.5">Category *</label>
            <select
              name="category"
              required
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
            >
              <option value="casing" selected>🔩 Motor Casing / Hardware</option>
              <option value="recovery">🪂 Recovery (Parachute / Streamer / Cord)</option>
              <option value="avionics">📟 Avionics (Altimeter / Computer / GPS)</option>
              <option value="pyrotechnic">💥 Pyrotechnic / Igniter / Ejection Charge</option>
              <option value="airframe">🚀 Airframe / Tube / Nose Cone / Fin</option>
              <option value="hardware">🔧 Rigging / Hardware / Lugs</option>
              <option value="payload">📷 Payload / Sensor Package</option>
              <option value="other">📦 Other Component</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label class="block text-xs text-slate-400 mb-1">Manufacturer</label>
            <input
              type="text"
              name="manufacturer"
              placeholder="e.g. AeroTech / Top Flight"
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Part / Model #</label>
            <input
              type="text"
              name="part_number"
              placeholder="e.g. RMS-29/180"
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Serial Number</label>
            <input
              type="text"
              name="serial_number"
              placeholder="e.g. SN-4912"
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label class="block text-xs font-semibold uppercase text-slate-300 mb-1.5">Initial Quantity *</label>
            <input
              type="number"
              name="quantity_on_hand"
              value="1"
              min="0"
              required
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1.5">Condition</label>
            <select
              name="condition"
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
            >
              <option value="new" selected>New</option>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="damaged">Damaged</option>
              <option value="quarantined">Quarantined</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1.5">Storage Location</label>
            <input
              type="text"
              name="storage_location"
              placeholder="e.g. Workshop Bin 3 / Magazine"
              class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>
        </div>

        <!-- Pyrotechnic & Explosives Regulatory Fields -->
        <div class="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-4">
          <div class="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
            <span>⚠️</span>
            <span>Pyrotechnic & Hazardous Material Specs (If Applicable)</span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Propellant / NEW Mass (g)</label>
              <input
                type="number"
                step="0.1"
                name="propellant_mass_g"
                placeholder="e.g. 12.5"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
              />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Hazard Class</label>
              <input
                type="text"
                name="hazard_class"
                placeholder="e.g. 1.4S / 1.4C"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
              />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Expiration Date</label>
              <input
                type="date"
                name="expiration_date"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
              />
            </div>
          </div>
        </div>

        <!-- Notes -->
        <div>
          <label class="block text-xs text-slate-400 mb-1">Notes / Acquisition Info</label>
          <textarea
            name="notes"
            rows="2"
            placeholder="Vendor, purchase price, specifications, maintenance notes..."
            class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          ></textarea>
        </div>

        <div class="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
          <a
            href="/inventory"
            class="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </a>
          <button
            type="submit"
            class="px-5 py-2 rounded-lg text-sm font-semibold bg-brand-500 hover:bg-brand-400 text-slate-950 transition-colors shadow-sm"
          >
            Add Component
          </button>
        </div>
      </form>
    </div>
  `
}

/**
 * Full Regulatory Chain-of-Custody Ledger View (`GET /inventory/transactions`).
 */
export function custodyLedgerView(transactions: (InventoryTransaction & {
  motor?: Partial<Motor> | null
  component?: Partial<Component> | null
})[]): HtmlEscapedString | Promise<HtmlEscapedString> {
  return html`
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <a href="/inventory" class="text-xs text-brand-400 hover:underline">← Back to Inventory Hub</a>
          <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2 mt-1">
            <span>📜</span>
            <span>Regulatory Chain-of-Custody Ledger</span>
          </h1>
          <p class="text-sm text-slate-400 mt-1">
            Immutable audit record of all motor and component acquisitions, transfers, sales, flight expenditures, and disposals.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <a
            href="/inventory/transactions/new"
            class="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold bg-purple-600 hover:bg-purple-500 text-white transition-colors shadow-sm gap-1.5"
          >
            <span>+</span>
            <span>Record Movement Event</span>
          </a>
        </div>
      </div>

      <div class="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden shadow">
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-slate-800 text-left text-sm">
            <thead class="bg-slate-950/80 text-xs uppercase font-semibold text-slate-400">
              <tr>
                <th class="py-3.5 pl-4 pr-3 sm:pl-6">Date</th>
                <th class="px-3 py-3.5">Lifecycle Action</th>
                <th class="px-3 py-3.5">Item & Batch/SN</th>
                <th class="px-3 py-3.5">Qty</th>
                <th class="px-3 py-3.5">Counterparty & Permit/Cert #</th>
                <th class="px-3 py-3.5">Location</th>
                <th class="py-3.5 pl-3 pr-4 sm:pr-6">Witness / Notes</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800/60">
              ${transactions.length === 0
                ? html`
                    <tr>
                      <td colspan="7" class="py-8 text-center text-slate-500 italic">
                        No transactions recorded in the chain-of-custody ledger.
                      </td>
                    </tr>
                  `
                : transactions.map((tx) => {
                    const badge = getTransactionTypeBadge(tx.transactionType)
                    const itemName = tx.motor
                      ? `${tx.motor.manufacturer} ${tx.motor.model}`
                      : tx.component
                        ? tx.component.name
                        : 'Inventory Item'
                    return html`
                      <tr class="hover:bg-slate-800/40 transition-colors">
                        <td class="py-3.5 pl-4 pr-3 sm:pl-6 font-mono text-xs text-slate-300 whitespace-nowrap">
                          ${tx.transactionDate}
                        </td>
                        <td class="px-3 py-3.5 whitespace-nowrap">
                          <span class="inline-flex items-center px-2 py-0.5 rounded text-xs border font-semibold ${badge.badgeClasses}">
                            <span class="mr-1">${badge.icon}</span> ${badge.label}
                          </span>
                        </td>
                        <td class="px-3 py-3.5">
                          <div class="font-semibold text-white">${itemName}</div>
                          <div class="text-xs text-slate-400 font-mono">
                            ${tx.batchLotNumber ? `Lot: ${tx.batchLotNumber}` : ''}
                            ${tx.serialNumbers ? ` • SN: ${tx.serialNumbers}` : ''}
                          </div>
                        </td>
                        <td class="px-3 py-3.5 font-mono font-bold text-white">
                          ${tx.quantity}
                        </td>
                        <td class="px-3 py-3.5 text-xs text-slate-300">
                          <div class="font-medium">${tx.counterpartyName || '—'}</div>
                          <div class="font-mono text-slate-500">
                            ${tx.counterpartyCertNumber ? `Cert: ${tx.counterpartyCertNumber}` : ''}
                            ${tx.counterpartyLicense ? ` • Permit: ${tx.counterpartyLicense}` : ''}
                          </div>
                        </td>
                        <td class="px-3 py-3.5 text-xs text-slate-400">
                          ${tx.storageLocation || '—'}
                        </td>
                        <td class="py-3.5 pl-3 pr-4 sm:pr-6 text-xs text-slate-400">
                          ${tx.witnessName ? html`<span class="text-amber-300">Witness: ${tx.witnessName} • </span>` : ''}
                          ${tx.notes || '—'}
                        </td>
                      </tr>
                    `
                  })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
}
