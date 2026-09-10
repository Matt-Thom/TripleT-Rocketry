/**
 * Authentication views for TripleT-Rocketry (Login, Register, Pilot Switcher).
 */

import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'

interface LoginViewOptions {
  redirectUrl?: string
  error?: string | null
}


export function loginView(options: LoginViewOptions = {}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { redirectUrl = '/', error = null } = options
  const safeRedirect = redirectUrl.startsWith('/') && !redirectUrl.startsWith('//') ? redirectUrl : '/'

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
          <input type="hidden" name="redirect" value="${safeRedirect}">

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
              placeholder="pilot@rocketry.org.au"
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

        <!-- Passkey / WebAuthn Sign-In -->
        <div class="mt-4 pt-4 border-t border-slate-800">
          <button
            type="button"
            id="passkey-signin-btn"
            class="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-slate-600 text-slate-200 hover:text-white font-semibold rounded-lg transition-colors text-sm flex items-center justify-center gap-2 shadow-sm"
          >
            <span class="text-base">🔑</span>
            <span>Sign in with Passkey</span>
          </button>
          <div id="passkey-error" class="hidden mt-2 p-2.5 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-xs text-center"></div>
        </div>

        <script>
          document.getElementById('passkey-signin-btn')?.addEventListener('click', async () => {
            const errEl = document.getElementById('passkey-error');
            if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
            try {
              if (!window.PublicKeyCredential) {
                throw new Error('WebAuthn Passkeys are not supported on this browser/device');
              }
              const optRes = await fetch('/auth/webauthn/login-options', {
                headers: { 'Accept': 'application/json' }
              });
              if (!optRes.ok) throw new Error('Failed to retrieve passkey challenge options');
              const options = await optRes.json();

              function base64UrlToBuffer(b64url) {
                const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
                const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
                const binary = atob(b64 + pad);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                return bytes.buffer;
              }

              function bufferToBase64Url(buffer) {
                if (!buffer) return null;
                const bytes = new Uint8Array(buffer);
                let binary = '';
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
              }

              const challengeBuffer = base64UrlToBuffer(options.challenge);

              const credential = await navigator.credentials.get({
                publicKey: {
                  challenge: challengeBuffer,
                  timeout: options.timeout || 60000,
                  userVerification: options.userVerification || 'preferred',
                  rpId: options.rpId || window.location.hostname
                }
              });

              if (!credential) throw new Error('Passkey credential assertion cancelled');

              const responsePayload = {
                clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
                authenticatorData: bufferToBase64Url(credential.response.authenticatorData),
                signature: bufferToBase64Url(credential.response.signature),
                userHandle: credential.response.userHandle ? bufferToBase64Url(credential.response.userHandle) : null
              };

              const rawIdB64 = bufferToBase64Url(credential.rawId);

              const verifyRes = await fetch('/auth/webauthn/login-verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                  id: credential.id,
                  rawId: rawIdB64,
                  type: credential.type,
                  response: responsePayload
                })
              });

              if (!verifyRes.ok) {
                const errData = await verifyRes.json().catch(() => ({}));
                throw new Error(errData.error || 'Passkey verification failed');
              }

              window.location.href = '${safeRedirect}';
            } catch (err) {
              if (errEl) {
                errEl.textContent = err.message || 'Passkey login failed';
                errEl.classList.remove('hidden');
              }
            }
          });
        </script>

        <div class="mt-6 pt-4 border-t border-slate-800 text-center">
          <p class="text-xs text-slate-400">
            Need a new rocketry profile?
            <a href="/register?redirect=${encodeURIComponent(safeRedirect)}" class="text-brand-400 hover:text-brand-300 font-semibold ml-1">
              Create Account
            </a>
          </p>
        </div>
      </div>
    </div>
  `
}

export interface RegisterViewOptions {
  redirectUrl?: string
  error?: string | null
}

export function registerView(options: RegisterViewOptions = {}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { redirectUrl = '/', error = null } = options
  const safeRedirect = redirectUrl.startsWith('/') && !redirectUrl.startsWith('//') ? redirectUrl : '/'

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
          <input type="hidden" name="redirect" value="${safeRedirect}">

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
            <a href="/login?redirect=${encodeURIComponent(safeRedirect)}" class="text-brand-400 hover:text-brand-300 font-semibold ml-1">
              Sign In
            </a>
          </p>
        </div>
      </div>
    </div>
  `
}
