/**
 * User Profile, Certifications, Multi-Club Affiliations & WebAuthn Passkeys View.
 *
 * Implements Milestone 5 (Requirement R5):
 * - Pilot personal details & regulatory region preferences.
 * - Self-service WebAuthn passkey registration & credential management.
 * - High-Power Rocketry certifications (TRA, ARA, NAR levels 0-3).
 * - Multi-club affiliations (VRA, SARC, etc.) tracking and soft-deletion.
 */

import { html } from 'hono/html'
import type { ActiveFlyer } from '../db/context'
import type * as schema from '../db/schema'

export interface ProfileViewProps {
  user: ActiveFlyer & { role?: string; regulatoryRegion?: string; createdAt?: number }
  passkeys: Array<typeof schema.userCredentials.$inferSelect>
  certifications: Array<typeof schema.certifications.$inferSelect>
  clubMemberships: Array<typeof schema.clubMemberships.$inferSelect>
  message?: string | null
  errorMessage?: string | null
}

export function profileHubView({
  user,
  passkeys,
  certifications,
  clubMemberships,
  message,
  errorMessage,
}: ProfileViewProps) {
  return html`
    <div class="space-y-8 max-w-6xl mx-auto">
      <!-- Header Banner -->
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div class="flex items-center gap-3">
            <h1 class="text-2xl sm:text-3xl font-black text-white tracking-tight">Pilot Profile &amp; Settings</h1>
            <span class="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold ${
              user.role === 'admin'
                ? 'bg-amber-950/80 text-amber-300 border border-amber-800'
                : 'bg-brand-950 text-brand-300 border border-brand-800'
            }">
              ${user.role === 'admin' ? 'Administrator' : 'Certified Flyer'}
            </span>
          </div>
          <p class="text-sm text-slate-400 mt-1">
            Manage your rocketry certifications, multi-club affiliations, and WebAuthn security keys.
          </p>
        </div>
      </div>

      <!-- Flash Notifications -->
      ${
        message
          ? html`
            <div class="p-4 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-200 text-sm flex items-center gap-3">
              <span class="text-lg">✅</span>
              <span>${message}</span>
            </div>
          `
          : ''
      }

      ${
        errorMessage
          ? html`
            <div class="p-4 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-sm flex items-center gap-3">
              <span class="text-lg">⚠️</span>
              <span>${errorMessage}</span>
            </div>
          `
          : ''
      }

      <!-- Grid Layout for Settings Cards -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        <!-- CARD 1: Pilot Personal Details & Personal Settings -->
        <div class="bg-slate-950 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between shadow-sm">
          <div>
            <div class="flex items-center justify-between pb-4 border-b border-slate-800/80 mb-6">
              <div class="flex items-center gap-3">
                <span class="text-2xl">👨‍✈️</span>
                <div>
                  <h2 class="text-lg font-bold text-white">Pilot Profile Information</h2>
                  <p class="text-xs text-slate-400">Personal callsign, display name, and regulatory region</p>
                </div>
              </div>
            </div>

            <form method="POST" action="/profile" class="space-y-4">
              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5" for="displayName">
                  Display Name / Callsign
                </label>
                <input
                  type="text"
                  id="displayName"
                  name="displayName"
                  value="${user.displayName}"
                  required
                  class="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 text-sm"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5" for="email">
                  Email Address
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value="${user.email}"
                  required
                  class="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 text-sm"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5" for="regulatoryRegion">
                  Regulatory Jurisdiction Preference
                </label>
                <select
                  id="regulatoryRegion"
                  name="regulatoryRegion"
                  class="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 text-sm"
                >
                  <option value="SA" ${user.regulatoryRegion === 'SA' ? 'selected' : ''}>South Australia (SafeWork SA 3kg threshold, metric SI units)</option>
                  <option value="US" ${user.regulatoryRegion === 'US' ? 'selected' : ''}>United States (FAA / NFPA 1127, imperial units)</option>
                </select>
              </div>

              <div class="pt-2">
                <button
                  type="submit"
                  class="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-slate-950 font-bold text-sm transition-colors shadow-sm"
                >
                  Save Profile Details
                </button>
              </div>
            </form>
          </div>
        </div>

        <!-- CARD 2: Self-Service WebAuthn Passkeys -->
        <div class="bg-slate-950 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between shadow-sm">
          <div>
            <div class="flex items-center justify-between pb-4 border-b border-slate-800/80 mb-6">
              <div class="flex items-center gap-3">
                <span class="text-2xl">🔑</span>
                <div>
                  <h2 class="text-lg font-bold text-white">WebAuthn Passkey Credentials</h2>
                  <p class="text-xs text-slate-400">Self-service biometric and FIDO2 hardware security keys</p>
                </div>
              </div>
              <button
                type="button"
                id="register-passkey-btn"
                class="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <span>➕</span> Register Passkey
              </button>
            </div>

            <!-- Passkey Registration Status Banner -->
            <div id="passkey-reg-status" class="hidden mb-4 p-3 rounded-xl text-xs font-medium"></div>

            <div class="space-y-3">
              ${
                passkeys.length === 0
                  ? html`
                    <div class="p-6 rounded-xl bg-slate-900/50 border border-slate-800/80 text-center">
                      <p class="text-sm text-slate-400">No WebAuthn passkeys or security keys registered yet.</p>
                      <p class="text-xs text-slate-500 mt-1">Enroll your device biometric passkey or YubiKey security key for passwordless sign-in.</p>
                    </div>
                  `
                  : passkeys.map(
                      (pk) => html`
                        <div class="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3">
                          <div class="flex items-center gap-3">
                            <span class="text-xl">🔐</span>
                            <div>
                              <div class="text-sm font-semibold text-white">${pk.friendlyName || 'Passkey Device'}</div>
                              <div class="text-xs text-slate-400 font-mono">
                                Enrolled: ${new Date(pk.createdAt).toLocaleDateString()}
                                ${pk.lastUsedAt ? ` · Last used: ${new Date(pk.lastUsedAt).toLocaleDateString()}` : ''}
                              </div>
                            </div>
                          </div>
                          <div class="flex items-center gap-2">
                            <form method="POST" action="/profile/passkeys/${pk.id}/delete" onsubmit="return confirm('Remove this passkey?');">
                              <button
                                type="submit"
                                class="px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 border border-rose-800/80 text-rose-300 text-xs font-medium transition-colors"
                              >
                                Delete
                              </button>
                            </form>
                          </div>
                        </div>
                      `,
                    )
              }
            </div>
          </div>
        </div>

        <!-- CARD 3: Rocketry Certifications (TRA / ARA / NAR Levels 0-3) -->
        <div class="bg-slate-950 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between shadow-sm">
          <div>
            <div class="flex items-center justify-between pb-4 border-b border-slate-800/80 mb-6">
              <div class="flex items-center gap-3">
                <span class="text-2xl">🏆</span>
                <div>
                  <h2 class="text-lg font-bold text-white">Rocketry Certifications</h2>
                  <p class="text-xs text-slate-400">High-Power Rocketry levels 0 through 3 (TRA, ARA, NAR)</p>
                </div>
              </div>
            </div>

            <!-- Existing Certifications List -->
            <div class="space-y-3 mb-6">
              ${
                certifications.length === 0
                  ? html`
                    <div class="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80 text-center">
                      <p class="text-sm text-slate-400">No active rocketry certifications recorded.</p>
                      <p class="text-xs text-slate-500 mt-1">Submit your certification level below (e.g. Level 0 Junior or Level 1-3 HPR).</p>
                    </div>
                  `
                  : certifications.map(
                      (cert) => html`
                        <div class="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3">
                          <div class="flex items-center gap-3">
                            <span class="px-2 py-1 rounded bg-brand-950 text-brand-300 border border-brand-800 font-mono font-bold text-xs">
                              ${cert.certifyingBody} L${cert.level}
                            </span>
                            <div>
                              <div class="text-sm font-semibold text-white">
                                Level ${cert.level} (${cert.certifyingBody})
                              </div>
                              <div class="text-xs text-slate-400 font-mono">
                                ${cert.certNumber ? `Cert #: ${cert.certNumber}` : 'Unnumbered certification'}
                                ${cert.expiresOn ? ` · Expires: ${cert.expiresOn}` : ''}
                              </div>
                            </div>
                          </div>
                          <span class="text-xs px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800 font-mono">
                            Verified
                          </span>
                        </div>
                      `,
                    )
              }
            </div>

            <!-- Form: Add or Update Certification -->
            <form method="POST" action="/profile/certifications" class="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
              <h3 class="text-xs font-bold uppercase tracking-wider text-slate-300">Add or Update Certification</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs text-slate-400 mb-1" for="certifying_body">Certifying Body</label>
                  <select
                    id="certifying_body"
                    name="certifying_body"
                    class="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-brand-500"
                  >
                    <option value="TRA">Tripoli Rocketry Association (TRA)</option>
                    <option value="ARA">Australian Rocketry Association (ARA)</option>
                    <option value="NAR">National Association of Rocketry (NAR)</option>
                  </select>
                </div>
                <div>
                  <label class="block text-xs text-slate-400 mb-1" for="level">Certification Level</label>
                  <select
                    id="level"
                    name="level"
                    class="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-brand-500"
                  >
                    <option value="0">Level 0 (Junior / Uncertified / Model Rocketry)</option>
                    <option value="1">Level 1 (HPR H-I Impulse)</option>
                    <option value="2">Level 2 (HPR J-L Impulse)</option>
                    <option value="3">Level 3 (HPR M-O Impulse)</option>
                  </select>
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs text-slate-400 mb-1" for="cert_number">Certificate Number</label>
                  <input
                    type="text"
                    id="cert_number"
                    name="cert_number"
                    placeholder="e.g. TRA-88992 or ARA-1234"
                    class="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div>
                  <label class="block text-xs text-slate-400 mb-1" for="expires_on">Expiry Date</label>
                  <input
                    type="date"
                    id="expires_on"
                    name="expires_on"
                    class="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>

              <div class="pt-1">
                <button
                  type="submit"
                  class="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-xs transition-colors"
                >
                  Save Certification
                </button>
              </div>
            </form>
          </div>
        </div>

        <!-- CARD 4: Multi-Club Affiliations -->
        <div class="bg-slate-950 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between shadow-sm">
          <div>
            <div class="flex items-center justify-between pb-4 border-b border-slate-800/80 mb-6">
              <div class="flex items-center gap-3">
                <span class="text-2xl">🏛️</span>
                <div>
                  <h2 class="text-lg font-bold text-white">Club Memberships</h2>
                  <p class="text-xs text-slate-400">Track multiple club affiliations simultaneously (VRA, SARC, etc.)</p>
                </div>
              </div>
            </div>

            <!-- Existing Clubs List -->
            <div class="space-y-3 mb-6">
              ${
                clubMemberships.length === 0
                  ? html`
                    <div class="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80 text-center">
                      <p class="text-sm text-slate-400">No active club memberships recorded.</p>
                      <p class="text-xs text-slate-500 mt-1">Add your club memberships below to track range privileges.</p>
                    </div>
                  `
                  : clubMemberships.map(
                      (club) => html`
                        <div class="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3">
                          <div>
                            <div class="text-sm font-semibold text-white">${club.clubName}</div>
                            <div class="text-xs text-slate-400 font-mono">
                              ${club.membershipNumber ? `Member #: ${club.membershipNumber}` : 'No membership number entered'}
                              ${club.expiresOn ? ` · Expires: ${club.expiresOn}` : ''}
                            </div>
                          </div>
                          <form method="POST" action="/profile/clubs/${club.id}/delete">
                            <button
                              type="submit"
                              class="px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 border border-rose-800/80 text-rose-300 text-xs font-medium transition-colors"
                            >
                              Delete
                            </button>
                          </form>
                        </div>
                      `,
                    )
              }
            </div>

            <!-- Form: Add Club Membership -->
            <form method="POST" action="/profile/clubs" class="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
              <h3 class="text-xs font-bold uppercase tracking-wider text-slate-300">Add Club Affiliation</h3>
              <div>
                <label class="block text-xs text-slate-400 mb-1" for="club_name">Club Name</label>
                <input
                  type="text"
                  id="club_name"
                  name="club_name"
                  placeholder="e.g. Victorian Rocketry Association, SARC, Tripoli Australia"
                  required
                  class="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-brand-500"
                />
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs text-slate-400 mb-1" for="membership_number">Membership Number</label>
                  <input
                    type="text"
                    id="membership_number"
                    name="membership_number"
                    placeholder="e.g. VRA-2026-99"
                    class="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div>
                  <label class="block text-xs text-slate-400 mb-1" for="expires_on">Expiry Date</label>
                  <input
                    type="date"
                    id="expires_on"
                    name="expires_on"
                    class="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>

              <div class="pt-1">
                <button
                  type="submit"
                  class="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-xs transition-colors"
                >
                  Add Club Affiliation
                </button>
              </div>
            </form>
          </div>
        </div>

      </div>

      <!-- Passkey Registration Client Ceremony Script -->
      <script>
        document.getElementById('register-passkey-btn')?.addEventListener('click', async () => {
          const statusEl = document.getElementById('passkey-reg-status');
          function showStatus(msg, isError) {
            if (!statusEl) return;
            statusEl.textContent = msg;
            statusEl.className = isError
              ? 'p-4 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center gap-3 mb-4'
              : 'p-4 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-3 mb-4';
            statusEl.classList.remove('hidden');
          }

          try {
            if (!window.PublicKeyCredential) {
              throw new Error('WebAuthn Passkeys are not supported on this browser or platform');
            }

            // 1. Request registration options challenge
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
              return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            }

            const challengeBuffer = base64UrlToBuffer(options.challenge);
            const userIdBuffer = new TextEncoder().encode(options.user.id);

            // 2. Invoke browser WebAuthn credential enrollment
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
            if (credential.response && credential.response.getPublicKey) {
              const pkBuffer = credential.response.getPublicKey();
              if (pkBuffer) publicKeyB64 = bufferToBase64Url(pkBuffer);
            }

            const payload = {
              id: credential.id,
              rawId: bufferToBase64Url(credential.rawId),
              type: credential.type,
              publicKey: publicKeyB64,
              friendlyName: 'Passkey (' + (navigator.userAgentData?.platform || navigator.platform || 'Device') + ')',
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
              throw new Error(errData.error || 'Passkey verification failed');
            }

            showStatus('✅ Passkey enrolled successfully! Reloading...', false);
            setTimeout(() => {
              window.location.href = '/profile?saved=passkey_enrolled';
            }, 1000);
          } catch (err) {
            showStatus('⚠️ ' + (err.message || 'Failed to register passkey'), true);
          }
        });
      </script>
    </div>
  `
}

export const profileView = profileHubView
