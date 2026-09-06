/**
 * User Settings Views (`src/views/settings.ts`).
 *
 * Provides interface for user preferences, including regulatory region
 * (South Australia vs United States) compliance rules.
 */

import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import type { ActiveFlyer } from '../db/context'

export interface SettingsViewProps {
  user: ActiveFlyer & { regulatoryRegion?: string }
  successMessage?: string | null
  errorMessage?: string | null
}

export function userSettingsView(props: SettingsViewProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { user, successMessage, errorMessage } = props
  const region = user.regulatoryRegion || 'SA'

  return html`
    <div class="max-w-3xl mx-auto space-y-6">
      <div class="border-b border-slate-800 pb-4">
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2.5">
          <span>⚙️</span>
          <span>User Settings</span>
        </h1>
        <p class="text-sm text-slate-400 mt-1">
          Configure your personal preferences, display units, and regional regulatory compliance rules.
        </p>
      </div>

      ${successMessage
        ? html`
            <div class="p-4 rounded-xl bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-sm flex items-center gap-2">
              <span>✅</span>
              <span>${successMessage}</span>
            </div>
          `
        : ''}

      ${errorMessage
        ? html`
            <div class="p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-sm flex items-center gap-2">
              <span>⚠️</span>
              <span>${errorMessage}</span>
            </div>
          `
        : ''}

      <form method="POST" action="/settings" class="space-y-6 bg-slate-900/60 p-6 rounded-2xl border border-slate-800">
        <div>
          <h2 class="text-base font-semibold text-white flex items-center gap-2">
            <span>🛡️</span>
            <span>Regulatory Region & Compliance Guidelines</span>
          </h2>
          <p class="text-xs text-slate-400 mt-1">
            Select the government regulatory framework for net propellant storage limits, magazine auditing, and transfer notifications.
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label class="relative flex flex-col p-4 rounded-xl border cursor-pointer transition-all ${
            region === 'SA'
              ? 'bg-brand-950/40 border-brand-500 shadow-sm'
              : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
          }">
            <div class="flex items-center gap-3">
              <input
                type="radio"
                name="regulatory_region"
                value="SA"
                ${region === 'SA' ? 'checked' : ''}
                class="text-brand-500 focus:ring-brand-400 h-4 w-4"
              />
              <div class="font-semibold text-white text-sm">
                🇦🇺 South Australia (SA)
              </div>
            </div>
            <div class="mt-2 text-xs text-slate-400 space-y-1 pl-7">
              <div>• Unlicensed storage threshold: <span class="text-white font-medium">3.0 kg</span> (3,000g)</div>
              <div>• Regulatory authority: <span class="text-white font-medium">SafeWork SA & CASA Part 101</span></div>
              <div>• HPR oversight: <span class="text-white font-medium">TRA Australia / ARA / SARC</span></div>
              <div>• Primary display: <span class="text-white font-medium">Metric SI (kg, g)</span></div>
            </div>
          </label>

          <label class="relative flex flex-col p-4 rounded-xl border cursor-pointer transition-all ${
            region === 'US'
              ? 'bg-brand-950/40 border-brand-500 shadow-sm'
              : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
          }">
            <div class="flex items-center gap-3">
              <input
                type="radio"
                name="regulatory_region"
                value="US"
                ${region === 'US' ? 'checked' : ''}
                class="text-brand-500 focus:ring-brand-400 h-4 w-4"
              />
              <div class="font-semibold text-white text-sm">
                🇺🇸 United States (US)
              </div>
            </div>
            <div class="mt-2 text-xs text-slate-400 space-y-1 pl-7">
              <div>• Standard storage limit: <span class="text-white font-medium">50 lbs</span> (~22,680g)</div>
              <div>• Regulatory authority: <span class="text-white font-medium">NFPA 1122 / 1127 & ATF</span></div>
              <div>• HPR oversight: <span class="text-white font-medium">NAR / Tripoli (TRA)</span></div>
              <div>• Storage compliance: <span class="text-white font-medium">Type 4 Magazine / LEUP</span></div>
            </div>
          </label>
        </div>

        <div class="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
          <button
            type="submit"
            class="px-5 py-2 rounded-lg text-sm font-semibold bg-brand-500 hover:bg-brand-400 text-slate-950 transition-colors shadow-sm"
          >
            Save Regulatory Settings
          </button>
        </div>
      </form>
    </div>
  `
}
