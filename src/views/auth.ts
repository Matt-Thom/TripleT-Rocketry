/**
 * Authentication views for TripleT-Rocketry (Login, Register, Pilot Switcher).
 */

import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import type { ActiveFlyer } from '../db/context'

interface LoginViewOptions {
  redirectUrl?: string
  error?: string | null
  pilots?: ActiveFlyer[]
}

interface RegisterViewOptions {
  redirectUrl?: string
  error?: string | null
}

export function loginView(options: LoginViewOptions = {}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { redirectUrl = '/', error = null, pilots = [] } = options

  return html`
    <div class="max-w-lg mx-auto py-8">
      <div class="bg-slate-850 border border-slate-800 rounded-2xl p-8 shadow-xl shadow-slate-950/50">
        <div class="text-center mb-6">
          <span class="text-4xl block mb-2">🚀</span>
          <h1 class="text-2xl font-black text-white tracking-tight">TripleT-Rocketry</h1>
          <p class="text-sm text-slate-400 mt-1">Range Companion & Flight Logbook</p>
        </div>

        ${
          error
            ? html`
              <div class="mb-6 p-4 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-sm flex items-center gap-3">
                <span class="text-lg">⚠️</span>
                <div>${error}</div>
              </div>
            `
            : ''
        }

        <!-- Email / Password Login Form -->
        <form method="POST" action="/login" class="space-y-4">
          <input type="hidden" name="redirect" value="${redirectUrl}">

          <div>
            <label for="email" class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Email Address
            </label>
            <input
              type="email"
              id="email"
              name="email"
              required
              autofocus
              placeholder="pilot@rocketry.local"
              class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
            >
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label for="password" class="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                Password
              </label>
            </div>
            <input
              type="password"
              id="password"
              name="password"
              required
              placeholder="••••••••"
              class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
            >
          </div>

          <button
            type="submit"
            class="w-full mt-2 py-3 px-4 bg-brand-500 hover:bg-brand-400 text-slate-950 font-bold rounded-lg transition-colors shadow-lg shadow-brand-500/20 text-sm flex items-center justify-center gap-2"
          >
            <span>Sign In</span> &rarr;
          </button>
        </form>

        <!-- Quick Switch / Demo Pilots Section -->
        ${
          pilots.length > 0
            ? html`
              <div class="mt-8 pt-6 border-t border-slate-800">
                <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 text-center">
                  🇦🇺 Quick Sign-In (Australian Pilots)
                </h3>
                <div class="space-y-2">
                  ${pilots.map(
                    (p) => html`
                      <form method="POST" action="/login">
                        <input type="hidden" name="redirect" value="${redirectUrl}">
                        <input type="hidden" name="email" value="${p.email}">
                        <input type="hidden" name="password" value="rocketry123!">
                        <button
                          type="submit"
                          class="w-full text-left p-3 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-brand-500/50 transition-all flex items-center justify-between group"
                        >
                          <div class="flex items-center gap-3">
                            <span class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-sm font-bold text-brand-400 border border-slate-700">
                              ${p.displayName.charAt(0)}
                            </span>
                            <div>
                              <div class="text-sm font-semibold text-slate-200 group-hover:text-white flex items-center gap-2">
                                <span>${p.displayName}</span>
                                <span class="text-xs px-1.5 py-0.5 rounded bg-brand-950 text-brand-300 border border-brand-800/80 font-mono">
                                  L${p.maxCertLevel} ${p.certifyingBody || 'TRA'}
                                </span>
                              </div>
                              <div class="text-xs text-slate-400 font-mono">${p.email}</div>
                            </div>
                          </div>
                          <span class="text-xs text-brand-400 group-hover:translate-x-0.5 transition-transform font-bold">
                            Select &rarr;
                          </span>
                        </button>
                      </form>
                    `,
                  )}
                </div>
              </div>
            `
            : ''
        }

        <div class="mt-6 pt-4 border-t border-slate-800 text-center">
          <p class="text-xs text-slate-400">
            Need a new rocketry profile?
            <a href="/register?redirect=${encodeURIComponent(redirectUrl)}" class="text-brand-400 hover:text-brand-300 font-semibold ml-1">
              Create Account
            </a>
          </p>
        </div>
      </div>
    </div>
  `
}

export function registerView(options: RegisterViewOptions = {}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { redirectUrl = '/', error = null } = options

  return html`
    <div class="max-w-lg mx-auto py-8">
      <div class="bg-slate-850 border border-slate-800 rounded-2xl p-8 shadow-xl shadow-slate-950/50">
        <div class="text-center mb-6">
          <span class="text-4xl block mb-2">🧑‍🚀</span>
          <h1 class="text-2xl font-black text-white tracking-tight">Register Flyer Profile</h1>
          <p class="text-sm text-slate-400 mt-1">Join the TripleT rocketry logbook & safety tracking system</p>
        </div>

        ${
          error
            ? html`
              <div class="mb-6 p-4 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-sm flex items-center gap-3">
                <span class="text-lg">⚠️</span>
                <div>${error}</div>
              </div>
            `
            : ''
        }

        <form method="POST" action="/register" class="space-y-4">
          <input type="hidden" name="redirect" value="${redirectUrl}">

          <div>
            <label for="displayName" class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Flyer Full Name
            </label>
            <input
              type="text"
              id="displayName"
              name="displayName"
              required
              autofocus
              placeholder="e.g. Matilda Green"
              class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
            >
          </div>

          <div>
            <label for="email" class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Email Address
            </label>
            <input
              type="email"
              id="email"
              name="email"
              required
              placeholder="e.g. matilda@rocketry.org.au"
              class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
            >
          </div>

          <div>
            <label for="password" class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Password
            </label>
            <input
              type="password"
              id="password"
              name="password"
              required
              placeholder="Minimum 6 characters"
              class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
            >
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div>
              <label for="certifyingBody" class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Certifying Body
              </label>
              <select
                id="certifyingBody"
                name="certifyingBody"
                class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="TRA" selected>Tripoli Australia (TRA)</option>
                <option value="NAR">NAR</option>
              </select>
            </div>

            <div>
              <label for="level" class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Certification Level
              </label>
              <select
                id="level"
                name="level"
                class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="0">Level 0 (Low / Mid Power)</option>
                <option value="1">Level 1 (HPR Class H–I)</option>
                <option value="2" selected>Level 2 (HPR Class J–L)</option>
                <option value="3">Level 3 (HPR Class M–O)</option>
              </select>
            </div>
          </div>

          <div>
            <label for="certNumber" class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Certification Number (Optional)
            </label>
            <input
              type="text"
              id="certNumber"
              name="certNumber"
              placeholder="e.g. TRA-AU-14820 or ARA-2026-081"
              class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
            >
          </div>

          <button
            type="submit"
            class="w-full mt-4 py-3 px-4 bg-brand-500 hover:bg-brand-400 text-slate-950 font-bold rounded-lg transition-colors shadow-lg shadow-brand-500/20 text-sm"
          >
            Create Profile & Log In &rarr;
          </button>
        </form>

        <div class="mt-6 pt-4 border-t border-slate-800 text-center">
          <p class="text-xs text-slate-400">
            Already have an account?
            <a href="/login?redirect=${encodeURIComponent(redirectUrl)}" class="text-brand-400 hover:text-brand-300 font-semibold ml-1">
              Sign In
            </a>
          </p>
        </div>
      </div>
    </div>
  `
}
