/**
 * Initial Setup Wizard View for TripleT-Rocketry.
 * Guides the initial user through site settings and primary administrator creation.
 */

import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'

export interface SetupWizardViewOptions {
  siteName?: string
  defaultRegulatoryRegion?: string
  displayName?: string
  email?: string
  certifyingBody?: string
  level?: number
  certNumber?: string
  error?: string | null
}

export function setupWizardView(
  options: SetupWizardViewOptions = {},
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const {
    siteName = 'TripleT-Rocketry',
    defaultRegulatoryRegion = 'SA',
    displayName = '',
    email = '',
    certifyingBody = 'TRA',
    level = 2,
    certNumber = '',
    error = null,
  } = options

  const isSA = defaultRegulatoryRegion === 'SA' || defaultRegulatoryRegion === 'AU_SA'

  return html`
    <div class="max-w-2xl mx-auto py-10 px-4 sm:px-6">
      <div class="bg-slate-850 border border-slate-800 rounded-2xl p-8 shadow-2xl shadow-slate-950/60">
        <!-- Header -->
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-950 border border-brand-800/80 mb-4 shadow-inner">
            <span class="text-3xl">🚀</span>
          </div>
          <h1 class="text-3xl font-black text-white tracking-tight">Initial Setup Wizard</h1>
          <p class="text-sm text-slate-400 mt-2 max-w-md mx-auto">
            Welcome to TripleT-Rocketry. Configure your instance and establish the primary administrator account to initialize the range companion.
          </p>
        </div>

        ${
          error
            ? html`
              <div class="mb-6 p-4 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-sm flex items-start gap-3">
                <span class="text-lg leading-none mt-0.5">⚠️</span>
                <div>
                  <div class="font-semibold">Setup Configuration Error</div>
                  <div class="mt-0.5 text-rose-300 text-xs">${error}</div>
                </div>
              </div>
            `
            : ''
        }

        <form method="POST" action="/setup" class="space-y-6">
          <!-- Section 1: Site Configuration -->
          <div class="border-b border-slate-800 pb-6">
            <h2 class="text-base font-bold text-white mb-1 flex items-center gap-2">
              <span class="w-6 h-6 rounded-full bg-brand-900/60 text-brand-400 text-xs flex items-center justify-center font-mono">1</span>
              Site Configuration & Regional Regulations
            </h2>
            <p class="text-xs text-slate-400 mb-4 ml-8">
              Specify your range identifier and regional explosives / rocketry compliance framework.
            </p>

            <div class="space-y-4 ml-8">
              <div>
                <label for="site_name" class="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                  Site Name
                </label>
                <input
                  type="text"
                  id="site_name"
                  name="site_name"
                  required
                  value="${siteName || 'TripleT-Rocketry'}"
                  placeholder="TripleT-Rocketry"
                  class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-medium"
                >
              </div>

              <div>
                <label for="default_regulatory_region" class="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                  Default Regulatory Region
                </label>
                <select
                  id="default_regulatory_region"
                  name="default_regulatory_region"
                  class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="SA" ${isSA ? 'selected' : ''}>
                    South Australia (SafeWork SA Explosives Act & CASA CASR 101) — Recommended
                  </option>
                  <option value="US" ${!isSA ? 'selected' : ''}>
                    United States (NFPA 1122/1127 & FAA Part 101 / ATF)
                  </option>
                </select>
                <p class="text-[11px] text-slate-400 mt-1.5">
                  South Australia defaults enforce 3 kg propellant storage thresholds, metric SI units (meters, kg), and Australian club certifications (TRA Australia, ARA, SARC).
                </p>
              </div>
            </div>
          </div>

          <!-- Section 2: Primary Administrator -->
          <div>
            <h2 class="text-base font-bold text-white mb-1 flex items-center gap-2">
              <span class="w-6 h-6 rounded-full bg-brand-900/60 text-brand-400 text-xs flex items-center justify-center font-mono">2</span>
              Primary Administrator Account
            </h2>
            <p class="text-xs text-slate-400 mb-4 ml-8">
              This account will receive full administrative privileges over users, settings, and range data.
            </p>

            <div class="space-y-4 ml-8">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label for="display_name" class="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                    Display Name
                  </label>
                  <input
                    type="text"
                    id="display_name"
                    name="display_name"
                    required
                    value="${displayName}"
                    placeholder="e.g. Range Officer Matt"
                    class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  >
                </div>

                <div>
                  <label for="email" class="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    required
                    value="${email}"
                    placeholder="admin@rocketry.local"
                    class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  >
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label for="password" class="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    id="password"
                    name="password"
                    required
                    placeholder="Minimum 8 characters"
                    class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  >
                </div>

                <div>
                  <label for="confirm_password" class="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    id="confirm_password"
                    name="confirm_password"
                    required
                    placeholder="Repeat password"
                    class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  >
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <div>
                  <label for="certifyingBody" class="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                    Certifying Body
                  </label>
                  <select
                    id="certifyingBody"
                    name="certifyingBody"
                    class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="TRA" ${certifyingBody === 'TRA' ? 'selected' : ''}>Tripoli (TRA Australia)</option>
                    <option value="NAR" ${certifyingBody === 'NAR' ? 'selected' : ''}>NAR</option>
                  </select>
                </div>

                <div>
                  <label for="level" class="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                    Certification Level
                  </label>
                  <select
                    id="level"
                    name="level"
                    class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="0" ${level === 0 ? 'selected' : ''}>Level 0 (Low / Mid Power)</option>
                    <option value="1" ${level === 1 ? 'selected' : ''}>Level 1 (HPR Class H–I)</option>
                    <option value="2" ${level === 2 ? 'selected' : ''}>Level 2 (HPR Class J–L)</option>
                    <option value="3" ${level === 3 ? 'selected' : ''}>Level 3 (HPR Class M–O)</option>
                  </select>
                </div>

                <div>
                  <label for="certNumber" class="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                    Cert Number (Optional)
                  </label>
                  <input
                    type="text"
                    id="certNumber"
                    name="certNumber"
                    value="${certNumber}"
                    placeholder="e.g. TRA-AU-14820"
                    class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                  >
                </div>
              </div>
            </div>
          </div>

          <!-- Submit Button -->
          <div class="pt-6 border-t border-slate-800">
            <button
              type="submit"
              class="w-full py-3.5 px-6 bg-brand-500 hover:bg-brand-400 text-slate-950 font-black tracking-wide rounded-xl transition-all shadow-lg shadow-brand-500/25 text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Initialize Site & Launch Dashboard</span>
              <span class="text-base">&rarr;</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  `
}
