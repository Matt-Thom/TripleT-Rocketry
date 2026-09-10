/**
 * HTML Views for Propellant Storage Sites & Explosives Magazines (`src/views/storage_sites.ts`).
 *
 * Implements Milestone 4 Requirement R4:
 * - Dedicated storage sites management listing (GET /inventory/storage-sites).
 * - Create and Edit forms with dynamic client-side SafeWork SA compliance validation (>3.0 kg permit requirement).
 * - Site detail view with capacity utilization and regulatory status badges.
 */

import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import type * as schema from '../db/schema'
import type { ActiveFlyer } from '../db/context'

export type StorageSite = typeof schema.storageSites.$inferSelect

export interface StorageSiteFormOptions {
  site?: Partial<StorageSite> | null
  error?: string | null
  isNew?: boolean
  user?: (ActiveFlyer & { role?: string; regulatoryRegion?: string }) | null
}

export interface StorageSiteDetailData {
  motors: Array<{
    id: string
    quantityOnHand: number
    storageLocation: string | null
    motor?: {
      manufacturer?: string | null
      model?: string | null
      impulseClass?: string | null
      propellantWeightG?: number | null
      weightG?: number | null
    } | null
  }>
  components: Array<{
    id: string
    name: string
    category: string
    quantityOnHand: number
    storageLocation: string | null
    propellantMassG?: number | null
  }>
}

/**
 * Format SafeWork SA compliance badge based on capacity and permit presence.
 */
export function formatSafeWorkBadge(capacityKg: number, permitNumber?: string | null): HtmlEscapedString | Promise<HtmlEscapedString> {
  const cap = capacityKg || 0
  const hasPermit = Boolean(permitNumber && permitNumber.trim().length > 0)

  if (cap > 3.0) {
    if (hasPermit) {
      return html`
        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-700/60 shadow-sm" title="SafeWork SA Propellant License Compliant">
          <span class="mr-1">🛡️</span> SafeWork SA Licensed (${permitNumber})
        </span>
      `
    }
    return html`
      <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-950 text-red-300 border border-red-700/60 shadow-sm" title="Exceeds 3.0 kg limit without permit!">
        <span class="mr-1">⚠️</span> Permit Required (&gt; 3.0 kg)
      </span>
    `
  }

  if (hasPermit) {
    return html`
      <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
        Permit: ${permitNumber}
      </span>
    `
  }

  return html`
    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800/80 text-slate-400 border border-slate-700/60">
      Hobby Exempt (≤ 3.0 kg)
    </span>
  `
}

/**
 * Storage Sites Listing View (GET /inventory/storage-sites).
 */
export function storageSitesListView(sites: StorageSite[], user?: ActiveFlyer | null): HtmlEscapedString | Promise<HtmlEscapedString> {
  return html`
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-800">
        <div>
          <div class="flex items-center gap-2">
            <a href="/inventory" class="text-xs text-brand-400 hover:underline flex items-center gap-1 mb-1">
              &larr; Back to Inventory Hub
            </a>
          </div>
          <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <span>🏰</span>
            <span>Propellant Storage Sites & Magazines</span>
          </h1>
          <p class="text-sm text-slate-400 mt-1">
            Physical explosive storage facilities, field boxes, and South Australia SafeWork SA statutory compliance tracking.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <a
            href="/inventory/storage-sites/new"
            class="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold bg-brand-500 hover:bg-brand-400 text-slate-950 transition-colors shadow-sm gap-1.5"
          >
            <span>+</span>
            <span>New Storage Site</span>
          </a>
        </div>
      </div>

      <!-- SafeWork SA Regulatory Callout -->
      <div class="rounded-xl bg-slate-850/80 border border-slate-800 p-4">
        <div class="flex items-start gap-3">
          <span class="text-xl flex-shrink-0">⚖️</span>
          <div class="text-xs text-slate-300 space-y-1">
            <p class="font-semibold text-slate-200">South Australia Explosives Regulation (SafeWork SA & AS 2187 Compliance):</p>
            <p class="text-slate-400">
              Storage capacity up to <strong>3.0 kg</strong> net propellant mass is permitted without a statutory license for authorized rocketry hobbyists.
              Any physical storage site or magazine configured to exceed <strong>3.0 kg</strong> strictly requires a registered <strong>SafeWork SA Propellant Storage License / Permit Number</strong>.
            </p>
          </div>
        </div>
      </div>

      <!-- Storage Sites Table / Cards -->
      ${sites.length === 0
        ? html`
          <div class="text-center py-12 px-4 rounded-2xl bg-slate-850/50 border border-dashed border-slate-800">
            <div class="text-4xl mb-3">📦</div>
            <h3 class="text-lg font-semibold text-white">No Storage Sites Configured</h3>
            <p class="text-sm text-slate-400 max-w-md mx-auto mt-1 mb-6">
              Register your physical explosives magazines, workshop storage cabinets, or range transport boxes to manage propellant limits.
            </p>
            <a
              href="/inventory/storage-sites/new"
              class="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold bg-brand-500 hover:bg-brand-400 text-slate-950 transition-colors shadow-sm gap-1.5"
            >
              <span>+</span>
              <span>Register First Storage Site</span>
            </a>
          </div>
        `
        : html`
          <div class="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 shadow-md">
            <table class="min-w-full divide-y divide-slate-800 text-left text-sm">
              <thead class="bg-slate-950/80 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <tr>
                  <th scope="col" class="py-3.5 pl-4 pr-3 sm:pl-6">Site Name & Location</th>
                  <th scope="col" class="px-3 py-3.5">Capacity (kg)</th>
                  <th scope="col" class="px-3 py-3.5">SafeWork SA Compliance</th>
                  <th scope="col" class="px-3 py-3.5 hidden md:table-cell">Notes</th>
                  <th scope="col" class="py-3.5 pl-3 pr-4 sm:pr-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60">
                ${sites.map(
                  (site) => html`
                    <tr class="hover:bg-slate-800/40 transition-colors">
                      <td class="py-4 pl-4 pr-3 sm:pl-6">
                        <a href="/inventory/storage-sites/${site.id}" class="font-semibold text-white hover:text-brand-400 transition-colors">
                          ${site.name}
                        </a>
                        ${site.location
                          ? html`<div class="text-xs text-slate-400 mt-0.5 flex items-center gap-1"><span>📍</span><span>${site.location}</span></div>`
                          : html`<div class="text-xs text-slate-500 italic mt-0.5">Location unlisted</div>`}
                      </td>
                      <td class="px-3 py-4 whitespace-nowrap">
                        <span class="font-mono font-bold text-white text-base">${site.capacityKg.toFixed(2)}</span>
                        <span class="text-xs text-slate-400 ml-1">kg</span>
                      </td>
                      <td class="px-3 py-4 whitespace-nowrap">
                        ${formatSafeWorkBadge(site.capacityKg, site.permitNumber)}
                      </td>
                      <td class="px-3 py-4 text-xs text-slate-400 max-w-xs truncate hidden md:table-cell">
                        ${site.notes || '—'}
                      </td>
                      <td class="py-4 pl-3 pr-4 sm:pr-6 text-right whitespace-nowrap text-xs font-semibold">
                        <a href="/inventory/storage-sites/${site.id}" class="text-brand-400 hover:text-brand-300 mr-3">View</a>
                        <a href="/inventory/storage-sites/${site.id}/edit" class="text-slate-300 hover:text-white mr-3">Edit</a>
                        <form method="POST" action="/inventory/storage-sites/${site.id}/delete" class="inline" onsubmit="return confirm('Are you sure you want to delete this storage site?');">
                          <button type="submit" class="text-rose-400 hover:text-rose-300 transition-colors cursor-pointer">Delete</button>
                        </form>
                      </td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          </div>
        `}
    </div>
  `
}

/**
 * Storage Site Create / Edit Form View.
 */
export function storageSiteFormView(options: StorageSiteFormOptions): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { site = null, error = null, isNew = false, user = null } = options
  const isEditing = !isNew && Boolean(site?.id)
  const capacityValue = site?.capacityKg !== undefined && site?.capacityKg !== null ? String(site.capacityKg) : ''
  const currentCapacity = parseFloat(capacityValue) || 0
  const exceedsSAThreshold = currentCapacity > 3.0

  return html`
    <div class="max-w-3xl mx-auto space-y-6">
      <!-- Breadcrumb -->
      <div class="flex items-center gap-2 text-xs text-slate-400">
        <a href="/inventory" class="hover:text-brand-400">Inventory</a>
        <span>&rsaquo;</span>
        <a href="/inventory/storage-sites" class="hover:text-brand-400">Storage Sites</a>
        <span>&rsaquo;</span>
        <span class="text-slate-200">${isEditing ? 'Edit Site' : 'New Site'}</span>
      </div>

      <!-- Header -->
      <div class="pb-4 border-b border-slate-800">
        <h1 class="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
          <span>🏰</span>
          <span>${isEditing ? `Edit Storage Site: ${site?.name}` : 'Register New Storage Site / Magazine'}</span>
        </h1>
        <p class="text-sm text-slate-400 mt-1">
          Configure physical storage dimensions and statutory explosives licensing conditions.
        </p>
      </div>

      <!-- Error Alert -->
      ${error
        ? html`
          <div class="rounded-xl bg-red-950/80 border border-red-700/80 p-4 text-red-200 text-sm flex items-start gap-3 shadow-md" role="alert">
            <span class="text-lg flex-shrink-0">⚠️</span>
            <div>
              <h4 class="font-bold text-red-300">Validation Error</h4>
              <p class="mt-0.5">${error}</p>
            </div>
          </div>
        `
        : ''}

      <!-- Form -->
      <form
        method="POST"
        action="${isEditing ? `/inventory/storage-sites/${site!.id}/edit` : '/inventory/storage-sites'}"
        class="space-y-6 bg-slate-850/60 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl"
      >
        <div class="space-y-5">
          <!-- Site Name -->
          <div>
            <label for="name" class="block text-sm font-medium text-slate-200 mb-1">
              Storage Site / Magazine Name <span class="text-rose-400">*</span>
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              value="${site?.name ?? ''}"
              placeholder="e.g. Adelaide Hills Explosives Magazine A, Workshop Safe Bay 2"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            />
            <p class="text-xs text-slate-400 mt-1">Descriptive label for this physical magazine or storage location.</p>
          </div>

          <!-- Physical Location -->
          <div>
            <label for="location" class="block text-sm font-medium text-slate-200 mb-1">
              Physical Location / Facility
            </label>
            <input
              type="text"
              id="location"
              name="location"
              value="${site?.location ?? ''}"
              placeholder="e.g. Safe Bunker Bay 4, Outbuilding Shed 2, Vehicle Transport Case"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            />
          </div>

          <!-- Capacity (kg) -->
          <div>
            <label for="capacity_kg" class="block text-sm font-medium text-slate-200 mb-1">
              Propellant Storage Capacity (kg) <span class="text-rose-400">*</span>
            </label>
            <div class="relative">
              <input
                type="number"
                step="0.01"
                min="0"
                id="capacity_kg"
                name="capacity_kg"
                required
                value="${capacityValue}"
                placeholder="2.5"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors font-mono"
              />
              <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-slate-400 text-sm font-mono">
                kg
              </div>
            </div>
            <p class="text-xs text-slate-400 mt-1">
              Maximum allowable solid propellant mass (Net Explosive Weight) for this storage location.
            </p>
          </div>

          <!-- Dynamic SafeWork SA Compliance Callout -->
          <div
            id="safework-compliance-callout"
            class="${exceedsSAThreshold ? '' : 'hidden'} rounded-xl bg-amber-950/40 border border-amber-500/60 p-4 transition-all"
          >
            <div class="flex items-start gap-3">
              <span class="text-2xl flex-shrink-0">⚠️</span>
              <div class="space-y-1">
                <h4 class="text-sm font-bold text-amber-300 flex items-center gap-2">
                  SafeWork SA Statutory Propellant Storage Requirement
                  <span class="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-amber-900/80 text-amber-200 border border-amber-600/60">Regulated &gt; 3.0 kg</span>
                </h4>
                <p class="text-xs text-amber-200/90 leading-relaxed">
                  Under South Australian explosives regulations and AS 2187, propellant storage capacity exceeding <strong>3.0 kg</strong> requires a valid <strong>SafeWork SA Licence to Store Explosives on Premises</strong> or an approved statutory permit. You must enter your regulatory permit number below to register this storage location.
                </p>
              </div>
            </div>
          </div>

          <!-- Permit Number -->
          <div>
            <label for="permit_number" class="block text-sm font-medium text-slate-200 mb-1">
              SafeWork SA Permit / Storage License Number
              <span id="permit-required-asterisk" class="${exceedsSAThreshold ? '' : 'hidden'} text-amber-400 font-bold ml-1">* (Required &gt; 3.0 kg)</span>
            </label>
            <input
              type="text"
              id="permit_number"
              name="permit_number"
              value="${site?.permitNumber ?? ''}"
              placeholder="e.g. SAFEWORK-SA-EXP-2026-88"
              class="w-full bg-slate-900 border ${exceedsSAThreshold ? 'border-amber-500 focus:ring-amber-500 focus:border-amber-500' : 'border-slate-700 focus:ring-brand-500 focus:border-brand-500'} rounded-lg px-3.5 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 transition-colors font-mono"
              ${exceedsSAThreshold ? 'required' : ''}
            />
            <p id="permit-help-text" class="text-xs ${exceedsSAThreshold ? 'text-amber-400 font-semibold' : 'text-slate-400'} mt-1">
              ${exceedsSAThreshold
                ? 'SafeWork SA regulations require a propellant storage license/permit for storage capacity exceeding 3.0 kg.'
                : 'Optional for storage capacity 3.0 kg or under (South Australia hobby exemption).'}
            </p>
          </div>

          <!-- Notes -->
          <div>
            <label for="notes" class="block text-sm font-medium text-slate-200 mb-1">
              Compliance & Safety Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              rows="3"
              placeholder="e.g. Compliant with AS 2187 storage requirements. Earth grounding and lightning protection verified."
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
            >${site?.notes ?? ''}</textarea>
          </div>
        </div>

        <!-- Form Actions -->
        <div class="flex items-center justify-between pt-5 border-t border-slate-800">
          <a
            href="/inventory/storage-sites"
            class="px-4 py-2.5 rounded-lg text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            Cancel
          </a>
          <button
            type="submit"
            class="px-5 py-2.5 rounded-lg text-sm font-semibold bg-brand-500 hover:bg-brand-400 text-slate-950 transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer"
          >
            <span>💾</span>
            <span>${isEditing ? 'Update Storage Site' : 'Save Storage Site'}</span>
          </button>
        </div>
      </form>
    </div>

    <!-- Client-side Dynamic SafeWork SA Compliance Validation Script -->
    <script>
      (function() {
        function checkSafeWorkCompliance() {
          var capacityInput = document.getElementById('capacity_kg');
          var permitInput = document.getElementById('permit_number');
          var callout = document.getElementById('safework-compliance-callout');
          var asterisk = document.getElementById('permit-required-asterisk');
          var helpText = document.getElementById('permit-help-text');
          if (!capacityInput || !permitInput) return;

          var val = parseFloat(capacityInput.value);
          var exceedsLimit = !isNaN(val) && val > 3.0;

          if (exceedsLimit) {
            if (callout) callout.classList.remove('hidden');
            if (asterisk) asterisk.classList.remove('hidden');
            permitInput.setAttribute('required', 'required');
            permitInput.setAttribute('aria-required', 'true');
            permitInput.classList.add('border-amber-500', 'focus:ring-amber-500', 'focus:border-amber-500');
            permitInput.classList.remove('border-slate-700', 'focus:ring-brand-500', 'focus:border-brand-500');
            if (helpText) {
              helpText.textContent = 'SafeWork SA regulations require a propellant storage license/permit for storage capacity exceeding 3.0 kg.';
              helpText.className = 'text-xs text-amber-400 font-semibold mt-1';
            }
          } else {
            if (callout) callout.classList.add('hidden');
            if (asterisk) asterisk.classList.add('hidden');
            permitInput.removeAttribute('required');
            permitInput.removeAttribute('aria-required');
            permitInput.classList.remove('border-amber-500', 'focus:ring-amber-500', 'focus:border-amber-500');
            permitInput.classList.add('border-slate-700', 'focus:ring-brand-500', 'focus:border-brand-500');
            if (helpText) {
              helpText.textContent = 'Optional for storage capacity 3.0 kg or under (South Australia hobby exemption).';
              helpText.className = 'text-xs text-slate-400 mt-1';
            }
          }
        }

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', checkSafeWorkCompliance);
        } else {
          checkSafeWorkCompliance();
        }

        var capacityEl = document.getElementById('capacity_kg');
        if (capacityEl) {
          capacityEl.addEventListener('input', checkSafeWorkCompliance);
          capacityEl.addEventListener('change', checkSafeWorkCompliance);
          capacityEl.addEventListener('keyup', checkSafeWorkCompliance);
        }
      })();
    </script>
  `
}

/**
 * Storage Site Detail View (GET /inventory/storage-sites/:id).
 */
export function storageSiteDetailView(
  site: StorageSite,
  data: StorageSiteDetailData,
  user?: ActiveFlyer | null,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { motors = [], components = [] } = data
  const totalPropellantG =
    motors.reduce((sum, m) => sum + (m.quantityOnHand * (m.motor?.propellantWeightG ?? m.motor?.weightG ?? 0)), 0) +
    components.reduce((sum, c) => sum + (c.quantityOnHand * (c.propellantMassG ?? 0)), 0)
  const totalPropellantKg = totalPropellantG / 1000
  const capacityKg = site.capacityKg || 0
  const percentUtilized = capacityKg > 0 ? Math.min(100, Math.round((totalPropellantKg / capacityKg) * 100)) : 0
  const isOverCapacity = capacityKg > 0 && totalPropellantKg > capacityKg

  return html`
    <div class="space-y-6">
      <!-- Breadcrumb -->
      <div class="flex items-center gap-2 text-xs text-slate-400">
        <a href="/inventory" class="hover:text-brand-400">Inventory</a>
        <span>&rsaquo;</span>
        <a href="/inventory/storage-sites" class="hover:text-brand-400">Storage Sites</a>
        <span>&rsaquo;</span>
        <span class="text-slate-200">${site.name}</span>
      </div>

      <!-- Header with Actions -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-800">
        <div>
          <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <span>🏰</span>
            <span>${site.name}</span>
          </h1>
          <p class="text-sm text-slate-400 mt-1">
            ${site.location ? `Located at: ${site.location}` : 'Physical location unlisted'}
          </p>
        </div>
        <div class="flex items-center gap-2.5">
          <a
            href="/inventory/storage-sites/${site.id}/edit"
            class="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition-colors shadow-sm gap-1.5"
          >
            <span>✏️</span>
            <span>Edit Site</span>
          </a>
          <form
            method="POST"
            action="/inventory/storage-sites/${site.id}/delete"
            onsubmit="return confirm('Delete this storage site?');"
            class="inline"
          >
            <button
              type="submit"
              class="inline-flex items-center px-3.5 py-2 rounded-lg text-sm font-semibold bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/80 transition-colors shadow-sm cursor-pointer"
            >
              Delete
            </button>
          </form>
        </div>
      </div>

      <!-- Overview Cards Grid -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <!-- Capacity Card -->
        <div class="rounded-xl bg-slate-850 border border-slate-800 p-5">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-400">Licensed Storage Capacity</div>
          <div class="text-2xl font-bold font-mono text-white mt-1">
            ${capacityKg.toFixed(2)} <span class="text-sm font-normal text-slate-400">kg</span>
          </div>
          <div class="mt-3">
            <div class="flex justify-between text-xs text-slate-400 mb-1">
              <span>Current Stock Mass</span>
              <span class="font-mono font-semibold ${isOverCapacity ? 'text-rose-400' : 'text-slate-200'}">
                ${totalPropellantKg.toFixed(2)} kg (${percentUtilized}%)
              </span>
            </div>
            <div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div
                class="h-full rounded-full ${isOverCapacity ? 'bg-rose-500' : percentUtilized > 80 ? 'bg-amber-500' : 'bg-brand-500'}"
                style="width: ${percentUtilized}%"
              ></div>
            </div>
          </div>
        </div>

        <!-- SafeWork SA Card -->
        <div class="rounded-xl bg-slate-850 border border-slate-800 p-5">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-400">SafeWork SA Status</div>
          <div class="mt-2">
            ${formatSafeWorkBadge(site.capacityKg, site.permitNumber)}
          </div>
          <div class="text-xs text-slate-400 mt-2">
            ${capacityKg > 3.0
              ? 'Regulated facility requiring statutory permit and AS 2187 explosive magazine standards.'
              : 'Within South Australian hobbyist exemption limit (≤ 3.0 kg).'}
          </div>
        </div>

        <!-- Registered Details Card -->
        <div class="rounded-xl bg-slate-850 border border-slate-800 p-5">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-400">Site Metadata</div>
          <div class="text-xs text-slate-300 mt-2 space-y-1">
            <div><strong class="text-slate-400">Registered:</strong> ${new Date(site.createdAt).toLocaleDateString()}</div>
            <div><strong class="text-slate-400">Last Updated:</strong> ${new Date(site.updatedAt).toLocaleDateString()}</div>
            ${site.notes ? html`<div class="mt-1 text-slate-400 italic">${site.notes}</div>` : ''}
          </div>
        </div>
      </div>

      <!-- Items currently assigned to this storage location -->
      <div class="space-y-3">
        <h3 class="text-lg font-bold text-white">Stored Inventory At This Location</h3>
        ${motors.length === 0 && components.length === 0
          ? html`
            <div class="text-center py-8 rounded-xl bg-slate-850/40 border border-slate-800 text-sm text-slate-400">
              No motors or components currently specify "${site.name}" as their storage location.
            </div>
          `
          : html`
            <div class="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
              <table class="min-w-full divide-y divide-slate-800 text-left text-sm">
                <thead class="bg-slate-950/80 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  <tr>
                    <th scope="col" class="py-3 pl-4 pr-3">Item</th>
                    <th scope="col" class="px-3 py-3">Category</th>
                    <th scope="col" class="px-3 py-3">Qty</th>
                    <th scope="col" class="py-3 pl-3 pr-4 text-right">Propellant Mass</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-800/60">
                  ${motors.map(
                    (m) => html`
                      <tr>
                        <td class="py-3 pl-4 pr-3 font-semibold text-white">
                          ${m.motor?.manufacturer} ${m.motor?.model}
                        </td>
                        <td class="px-3 py-3 text-xs text-slate-400">Rocket Motor</td>
                        <td class="px-3 py-3 font-mono text-white">${m.quantityOnHand}</td>
                        <td class="py-3 pl-3 pr-4 text-right font-mono text-slate-300 text-xs">
                          ${((m.quantityOnHand * (m.motor?.propellantWeightG ?? 0)) / 1000).toFixed(2)} kg
                        </td>
                      </tr>
                    `,
                  )}
                  ${components.map(
                    (c) => html`
                      <tr>
                        <td class="py-3 pl-4 pr-3 font-semibold text-white">${c.name}</td>
                        <td class="px-3 py-3 text-xs text-slate-400 capitalize">${c.category}</td>
                        <td class="px-3 py-3 font-mono text-white">${c.quantityOnHand}</td>
                        <td class="py-3 pl-3 pr-4 text-right font-mono text-slate-300 text-xs">
                          ${(((c.quantityOnHand * (c.propellantMassG ?? 0))) / 1000).toFixed(2)} kg
                        </td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            </div>
          `}
      </div>
    </div>
  `
}
