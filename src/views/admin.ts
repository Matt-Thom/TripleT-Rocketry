/**
 * Admin views for TripleT-Rocketry.
 * Provides user management dashboard, user provisioning, role editing, and site settings.
 */

import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import type { ActiveFlyer } from '../db/context'

export interface AdminUserItem {
  id: string
  email: string
  displayName: string
  role: string
  regulatoryRegion: string
  isActive: boolean
  createdAt: number
  maxCertLevel?: number
  certifyingBody?: string | null
  certNumber?: string | null
}

export interface AdminDashboardViewOptions {
  users: AdminUserItem[]
  settings: Record<string, string>
  currentUser: ActiveFlyer & { role?: string }
  message?: string | null
  error?: string | null
}

export function adminDashboardView(options: AdminDashboardViewOptions): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { users, settings, currentUser, message, error } = options

  const siteName = settings.site_name || 'TripleT-Rocketry'
  const defaultRegion = settings.default_regulatory_region || 'SA'
  const quickSignInEnabled = settings.quick_sign_in_enabled !== 'false'

  const activeCount = users.filter((u) => u.isActive).length
  const adminCount = users.filter((u) => u.role === 'admin').length

  return html`
    <div class="space-y-8">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div class="flex items-center gap-3">
            <span class="text-3xl">⚙️</span>
            <h1 class="text-2xl font-black text-white tracking-tight">Site Administration</h1>
          </div>
          <p class="text-sm text-slate-400 mt-1">
            User management, role-based access control, and range system settings
          </p>
        </div>
        <div class="flex items-center gap-3">
          <button
            type="button"
            id="register-passkey-btn"
            class="inline-flex items-center px-4 py-2 border border-slate-700 hover:border-slate-600 text-sm font-semibold rounded-lg shadow-sm text-white bg-slate-800 hover:bg-slate-700 transition-colors gap-2"
          >
            <span class="text-base">🔑</span> + Register Passkey
          </button>
          <a
            href="#new-user"
            class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-semibold rounded-lg shadow-sm text-slate-950 bg-brand-400 hover:bg-brand-300 transition-colors gap-2"
          >
            <span>+</span> Provision New User
          </a>
        </div>
      </div>

      <div id="passkey-reg-status" class="hidden p-4 rounded-xl text-sm flex items-center gap-3"></div>

      ${
        message
          ? html`
            <div class="p-4 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-sm flex items-center gap-3">
              <span class="text-lg">✅</span>
              <div>${message}</div>
            </div>
          `
          : ''
      }

      ${
        error
          ? html`
            <div class="p-4 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-sm flex items-center gap-3">
              <span class="text-lg">⚠️</span>
              <div>${error}</div>
            </div>
          `
          : ''
      }

      <!-- System Summary Stats -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="bg-slate-850 border border-slate-800 rounded-xl p-4">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Accounts</div>
          <div class="text-2xl font-extrabold text-white mt-1">${users.length}</div>
          <div class="text-xs text-slate-500 mt-1">Registered flyers & admins</div>
        </div>
        <div class="bg-slate-850 border border-slate-800 rounded-xl p-4">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-400">Active Accounts</div>
          <div class="text-2xl font-extrabold text-brand-400 mt-1">${activeCount}</div>
          <div class="text-xs text-slate-500 mt-1">Eligible to sign in & log flights</div>
        </div>
        <div class="bg-slate-850 border border-slate-800 rounded-xl p-4">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-400">Administrators</div>
          <div class="text-2xl font-extrabold text-purple-400 mt-1">${adminCount}</div>
          <div class="text-xs text-slate-500 mt-1">Full privileged access</div>
        </div>
        <div class="bg-slate-850 border border-slate-800 rounded-xl p-4">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-400">Default Region</div>
          <div class="text-2xl font-extrabold text-amber-400 mt-1">${defaultRegion}</div>
          <div class="text-xs text-slate-500 mt-1">${defaultRegion === 'SA' ? 'SafeWork South Australia' : 'US Federal / FAA'}</div>
        </div>
      </div>

      <!-- Users Management Table -->
      <div class="bg-slate-850 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 class="text-lg font-bold text-white">User Accounts</h2>
            <p class="text-xs text-slate-400">Inspect credentials, change roles, deactivate or purge flyer profiles</p>
          </div>
          <span class="text-xs text-slate-500 font-mono">${users.length} registered</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm text-slate-300">
            <thead class="bg-slate-900/80 text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th scope="col" class="px-6 py-3.5">User</th>
                <th scope="col" class="px-4 py-3.5">Role</th>
                <th scope="col" class="px-4 py-3.5">Region</th>
                <th scope="col" class="px-4 py-3.5">Cert Level</th>
                <th scope="col" class="px-4 py-3.5">Status</th>
                <th scope="col" class="px-4 py-3.5">Created</th>
                <th scope="col" class="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800/80">
              ${users.map((u) => {
                const isSelf = u.id === currentUser.id
                const createdDate = new Date(u.createdAt).toISOString().split('T')[0]

                return html`
                  <tr class="hover:bg-slate-800/40 transition-colors">
                    <td class="px-6 py-4">
                      <div class="flex items-center gap-3">
                        <span class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-brand-400 border border-slate-700">
                          ${u.displayName.charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <div class="font-semibold text-white flex items-center gap-2">
                            <span>${u.displayName}</span>
                            ${isSelf ? html`<span class="text-[10px] px-1.5 py-0.2 rounded bg-brand-950 text-brand-300 border border-brand-800/80 font-mono">You</span>` : ''}
                          </div>
                          <div class="text-xs text-slate-400 font-mono">${u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td class="px-4 py-4 whitespace-nowrap">
                      ${u.role === 'admin'
                        ? html`<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-950 text-purple-300 border border-purple-800/80">Admin</span>`
                        : html`<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">Flyer</span>`}
                    </td>
                    <td class="px-4 py-4 whitespace-nowrap font-mono text-xs">
                      <span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-bold">
                        ${u.regulatoryRegion || 'SA'}
                      </span>
                    </td>
                    <td class="px-4 py-4 whitespace-nowrap">
                      <span class="text-xs px-2 py-0.5 rounded bg-brand-950 text-brand-300 border border-brand-800/60 font-mono font-semibold">
                        L${u.maxCertLevel || 0} ${u.certifyingBody || 'TRA'}
                      </span>
                    </td>
                    <td class="px-4 py-4 whitespace-nowrap">
                      ${u.isActive
                        ? html`<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800/80"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Active</span>`
                        : html`<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-950 text-rose-300 border border-rose-800/80"><span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span> Inactive</span>`}
                    </td>
                    <td class="px-4 py-4 whitespace-nowrap text-xs text-slate-400 font-mono">
                      ${createdDate}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-right space-x-2">
                      <!-- Edit User Trigger -->
                      <button
                        type="button"
                        onclick="document.getElementById('edit-modal-${u.id}').classList.remove('hidden')"
                        class="text-xs font-semibold text-slate-300 hover:text-white px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 transition-colors border border-slate-700"
                      >
                        Edit
                      </button>

                      <!-- Toggle Status Form -->
                      ${!isSelf
                        ? html`
                          <form method="POST" action="/admin/users/${u.id}/status" class="inline">
                            <input type="hidden" name="is_active" value="${u.isActive ? 'false' : 'true'}">
                            <button
                              type="submit"
                              class="text-xs font-semibold px-2 py-1 rounded transition-colors border ${
                                u.isActive
                                  ? 'text-amber-300 hover:text-amber-200 bg-amber-950/60 hover:bg-amber-900 border-amber-800/80'
                                  : 'text-emerald-300 hover:text-emerald-200 bg-emerald-950/60 hover:bg-emerald-900 border-emerald-800/80'
                              }"
                              onclick="return confirm('Are you sure you want to ${u.isActive ? 'deactivate' : 'activate'} ${u.displayName}?');"
                            >
                              ${u.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                          </form>
                        `
                        : ''}

                      <!-- Delete User Form -->
                      ${!isSelf
                        ? html`
                          <form method="POST" action="/admin/users/${u.id}/delete" class="inline">
                            <button
                              type="submit"
                              class="text-xs font-semibold px-2 py-1 rounded transition-colors text-rose-400 hover:text-rose-300 bg-rose-950/60 hover:bg-rose-900 border border-rose-800/80"
                              onclick="return confirm('Permanently delete ${u.displayName} and all associated sessions/credentials?');"
                            >
                              Delete
                            </button>
                          </form>
                        `
                        : ''}
                    </td>
                  </tr>

                  <!-- Inline Edit Modal for User -->
                  <div id="edit-modal-${u.id}" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
                    <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
                      <div class="flex items-center justify-between pb-3 border-b border-slate-800">
                        <h3 class="text-base font-bold text-white">Edit User: ${u.displayName}</h3>
                        <button
                          type="button"
                          onclick="document.getElementById('edit-modal-${u.id}').classList.add('hidden')"
                          class="text-slate-400 hover:text-white text-lg"
                        >&times;</button>
                      </div>

                      <form method="POST" action="/admin/users/${u.id}/edit" class="space-y-4">
                        <div>
                          <label class="block text-xs font-semibold text-slate-400 uppercase mb-1">Full Name</label>
                          <input
                            type="text"
                            name="display_name"
                            value="${u.displayName}"
                            required
                            class="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                          >
                        </div>
                        <div>
                          <label class="block text-xs font-semibold text-slate-400 uppercase mb-1">Email Address</label>
                          <input
                            type="email"
                            name="email"
                            value="${u.email}"
                            required
                            class="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                          >
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                          <div>
                            <label class="block text-xs font-semibold text-slate-400 uppercase mb-1">Role</label>
                            <select
                              name="role"
                              class="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                            >
                              <option value="flyer" ${u.role === 'flyer' ? 'selected' : ''}>Flyer</option>
                              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrator</option>
                            </select>
                          </div>
                          <div>
                            <label class="block text-xs font-semibold text-slate-400 uppercase mb-1">Regulatory Region</label>
                            <select
                              name="regulatory_region"
                              class="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                            >
                              <option value="SA" ${u.regulatoryRegion === 'SA' ? 'selected' : ''}>South Australia (SA)</option>
                              <option value="US" ${u.regulatoryRegion === 'US' ? 'selected' : ''}>United States (US)</option>
                            </select>
                          </div>
                        </div>

                        <div class="flex justify-end gap-3 pt-3 border-t border-slate-800">
                          <button
                            type="button"
                            onclick="document.getElementById('edit-modal-${u.id}').classList.add('hidden')"
                            class="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            class="px-4 py-2 text-xs font-semibold text-slate-950 bg-brand-400 hover:bg-brand-300 rounded-lg transition-colors font-bold"
                          >
                            Save Changes
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                `
              })}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Two-Column Section: Provision User & Site Settings -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <!-- Provision New User Form -->
        <div id="new-user" class="bg-slate-850 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
          <div class="border-b border-slate-800 pb-3">
            <h2 class="text-lg font-bold text-white flex items-center gap-2">
              <span>🧑‍🚀</span> Provision New User
            </h2>
            <p class="text-xs text-slate-400">Directly create a new flyer or administrator profile</p>
          </div>

          <form method="POST" action="/admin/users" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-slate-400 uppercase mb-1">Full Display Name</label>
              <input
                type="text"
                name="display_name"
                placeholder="e.g. Dr. Alan Grant"
                required
                class="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-400 uppercase mb-1">Email Address</label>
              <input
                type="email"
                name="email"
                placeholder="pilot@rocketry.org"
                required
                class="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-400 uppercase mb-1">Temporary / Initial Password</label>
              <input
                type="password"
                name="password"
                placeholder="••••••••"
                required
                class="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold text-slate-400 uppercase mb-1">System Role</label>
                <select
                  name="role"
                  class="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="flyer">Flyer (Standard)</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-400 uppercase mb-1">Regulatory Region</label>
                <select
                  name="regulatory_region"
                  class="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="SA">South Australia (SA)</option>
                  <option value="US">United States (US)</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              class="w-full py-2.5 px-4 bg-brand-500 hover:bg-brand-400 text-slate-950 font-bold rounded-lg transition-colors text-sm shadow-md shadow-brand-500/10"
            >
              Provision Account &rarr;
            </button>
          </form>
        </div>

        <!-- Site Settings Form -->
        <div id="site-settings" class="bg-slate-850 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
          <div class="border-b border-slate-800 pb-3">
            <h2 class="text-lg font-bold text-white flex items-center gap-2">
              <span>⚙️</span> Range & Site Settings
            </h2>
            <p class="text-xs text-slate-400">Configure global defaults, instance identity, and authentication preferences</p>
          </div>

          <form method="POST" action="/admin/settings" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-slate-400 uppercase mb-1">Site / Range Name</label>
              <input
                type="text"
                name="site_name"
                value="${siteName}"
                required
                class="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-400 uppercase mb-1">Default Regulatory Region</label>
              <select
                name="default_regulatory_region"
                class="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="SA" ${defaultRegion === 'SA' ? 'selected' : ''}>South Australia (SA - 3kg propellant threshold)</option>
                <option value="US" ${defaultRegion === 'US' ? 'selected' : ''}>United States (US - 50lbs propellant threshold)</option>
              </select>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-400 uppercase mb-1">Quick Sign-In (Australian Pilots)</label>
              <select
                name="quick_sign_in_enabled"
                class="w-full px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="true" ${quickSignInEnabled ? 'selected' : ''}>Enabled (show quick pilot selection on login screen)</option>
                <option value="false" ${!quickSignInEnabled ? 'selected' : ''}>Disabled (standard email & password / passkey only)</option>
              </select>
              <p class="text-xs text-slate-500 mt-1">
                Disabling removes the demo / quick switcher cards from the public login interface in production.
              </p>
            </div>

            <button
              type="submit"
              class="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg transition-colors text-sm border border-slate-700"
            >
              Save Site Settings
            </button>
          </form>
        </div>
      </div>

      <!-- Passkey Registration Script -->
      <script>
        document.getElementById('register-passkey-btn')?.addEventListener('click', async () => {
          const statusEl = document.getElementById('passkey-reg-status');
          function showStatus(msg, isError) {
            if (!statusEl) return;
            statusEl.textContent = msg;
            statusEl.className = isError
              ? 'p-4 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-sm flex items-center gap-3'
              : 'p-4 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-sm flex items-center gap-3';
            statusEl.classList.remove('hidden');
          }

          try {
            if (!window.PublicKeyCredential) {
              throw new Error('WebAuthn Passkeys are not supported on this browser or platform');
            }

            // 1. Request registration challenge options
            const optRes = await fetch('/auth/webauthn/register-options', {
              method: 'POST',
              headers: { 'Accept': 'application/json' }
            });
            if (!optRes.ok) {
              const errData = await optRes.json().catch(() => ({}));
              throw new Error(errData.error || 'Failed to retrieve passkey registration options');
            }
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
            const userIdBuffer = new TextEncoder().encode(options.user.id);

            // 2. Invoke WebAuthn credential enrollment
            const credential = await navigator.credentials.create({
              publicKey: {
                challenge: challengeBuffer,
                rp: options.rp,
                user: {
                  id: userIdBuffer,
                  name: options.user.name,
                  displayName: options.user.displayName
                },
                pubKeyCredParams: options.pubKeyCredParams || [
                  { type: 'public-key', alg: -7 },
                  { type: 'public-key', alg: -257 }
                ],
                timeout: options.timeout || 60000,
                attestation: options.attestation || 'none'
              }
            });

            if (!credential) throw new Error('Passkey registration was cancelled');

            let publicKeyB64 = null;
            if (credential.response.getPublicKey) {
              const pkBuffer = credential.response.getPublicKey();
              if (pkBuffer) publicKeyB64 = bufferToBase64Url(pkBuffer);
            }

            const payload = {
              id: credential.id,
              rawId: bufferToBase64Url(credential.rawId),
              type: credential.type,
              publicKey: publicKeyB64,
              friendlyName: 'Admin Passkey (' + (navigator.userAgentData?.platform || navigator.platform || 'Device') + ')',
              response: {
                clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
                attestationObject: bufferToBase64Url(credential.response.attestationObject),
                publicKey: publicKeyB64
              }
            };

            // 3. Verify and persist passkey
            const verifyRes = await fetch('/auth/webauthn/register-verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify(payload)
            });

            if (!verifyRes.ok) {
              const errData = await verifyRes.json().catch(() => ({}));
              throw new Error(errData.error || 'Passkey registration verification failed');
            }

            showStatus('✅ Passkey enrolled successfully! You can now use it to sign in from the login screen.', false);
          } catch (err) {
            showStatus('⚠️ ' + (err.message || 'Failed to register passkey'), true);
          }
        });
      </script>
    </div>
  `
}
