---
title: Security Baseline Assessment — 2026-09
status: current
branch: develop
commit: dab3152
assessed: 2026-09-10
method: manual source review (static, read-only) of src/, .github/workflows/, wrangler.jsonc
---

# Security Baseline Assessment — `develop` @ `dab3152`

This is the **starting state** the release security process in
[`security-testing-process.md`](security-testing-process.md) is designed to
close out. Every finding below was derived by reading the source on this
branch. No live system was scanned, and no finding here has been confirmed by
exploitation against a running deployment.

Findings are the seed backlog for the security regression suite: each one
becomes a permanent test case (the `SEC-*` IDs in section 7 of the process
document), so that once fixed it can never silently regress.

## How to read this document

- **Severity** follows the scale in section 8 of the process document
  (Critical / High / Medium / Low / Informational).
- **Status** is `Open` for everything, because no remediation has been done yet.
- **ASVS** cites the chapter of OWASP Application Security Verification
  Standard 5.0.0 the requirement comes from.
- **Top 10** cites the OWASP Top 10:2025 category.
- Source citations use `path/file.ts:line`, per `wiki/schema.md`.

## Summary

| ID | Severity | Title | Status |
|---|---|---|---|
| [BL-01](#bl-01) | Critical | Identity headers `X-Flyer-Id` / `X-Flyer-Email` are honoured in every environment | Remediated (Gated to test/local; SEC-AUTHN-01/02) |
| [BL-02](#bl-02) | Critical | Password verification accepts placeholder hashes and hash-as-plaintext | Remediated (Removed bypasses, strict PBKDF2; SEC-AUTHN-04/05) |
| [BL-03](#bl-03) | High | Session signing key falls back to a secret committed to the repository | Remediated (Mandatory in prod/staging; SEC-AUTHN-06/07) |
| [BL-04](#bl-04) | High | Cloudflare Access email header is trusted without verifying the Access JWT | Open |
| [BL-05](#bl-05) | High | No authentication rate limiting, throttling or lockout | Open |
| [BL-06](#bl-06) | Medium | Session cookie is issued without the `Secure` attribute | Remediated (Added Secure attribute; SEC-SESS-01) |
| [BL-07](#bl-07) | Medium | No CSRF defence beyond the cookie's `SameSite=Lax`; logout is reachable by GET | Open |
| [BL-08](#bl-08) | Medium | No security response headers (CSP, HSTS, frame-ancestors, nosniff, Referrer-Policy) | Remediated (Headers middleware added; SEC-HDR-01..05) |
| [BL-09](#bl-09) | Medium | Front-end scripts load from public CDNs with no Subresource Integrity, one unpinned | Open |
| [BL-10](#bl-10) | Medium | WebAuthn assertion does not verify origin or RP ID hash, and ignores the authenticator counter | Open |
| [BL-11](#bl-11) | Medium | Passkey registration trusts a client-supplied public key with no attestation or challenge check | Open |
| [BL-12](#bl-12) | Medium | Test-only authentication bypass is selected by a runtime value, not by build | Open |
| [BL-13](#bl-13) | Medium | Session tokens are stored verbatim in the database, and revocation records leak them further | Open |
| [BL-14](#bl-14) | Low | Secret comparisons are not constant-time | Remediated (timingSafeEqual applied across auth) |
| [BL-15](#bl-15) | Low | CSV import reads an unbounded request body into memory | Remediated (2MB cap, 5000 row max, auth check; SEC-INP-01/02/05) |
| [BL-16](#bl-16) | Informational | CI runs no dependency, secret, or static analysis scanning, and the repo has no linter | In Progress (Gate G2 added to CI) |
| [BL-17](#bl-17) | Informational | Self-registration is open to the public internet | Open |

---

## Findings

### BL-01

**Identity headers `X-Flyer-Id` / `X-Flyer-Email` are honoured in every environment**

- **Severity**: Critical
- **ASVS**: V2 (Validation), V7 (Session Management) — trust boundary on request headers
- **Top 10**: A01:2025 Broken Access Control
- **Source**: `src/middleware/auth.ts:264-279`

The "direct developer / test flyer header" branch of the authentication
middleware resolves a user from the `X-Flyer-Id` or `X-Flyer-Email` request
header. Unlike the local-development fallback immediately below it
(`src/middleware/auth.ts:283-289`, which is guarded by `isTestOrLocal`), this
branch has **no environment guard**. Its only precondition is that no valid
session cookie was already resolved and no cookie was marked invalid, which is
exactly the state of an anonymous request.

An unauthenticated request carrying `X-Flyer-Email: <any registered address>`
is therefore resolved to that user's context, including their role, on the
deployed Worker.

The existing test `1.9: session spoofing resistance` in
`test/challenger_m7_security_and_roles.test.ts:262` asserts only that a real
session cookie takes precedence over a forged header. It does not cover the
cookieless case, which is the exploitable one.

**Mitigating factor**: if Cloudflare Access is enforced on `rocketry.thom.au`,
an attacker must first pass Access. This is a defence-in-depth question, not a
fix — the deploy smoke test in `.github/workflows/deploy.yml` accepts HTTP 200
from `/health`, which suggests Access is not currently blocking anonymous
requests to the hostname.

**Remediation**: delete the header branch, or gate it behind a compile-time
constant that is stripped from production builds. Tests should authenticate by
minting a real signed session, which `test/helpers/db.ts` already supports via
`signSession`.

---

### BL-02

**Password verification accepts placeholder hashes and hash-as-plaintext**

- **Severity**: Critical
- **ASVS**: V6 (Authentication) — credential storage and verification
- **Top 10**: A07:2025 Authentication Failures
- **Source**: `src/services/auth.ts:60-72`

`verifyPassword` short-circuits to `true` before any PBKDF2 work in three cases:

1. the stored hash is the literal `seeded_flyer_default`;
2. the stored hash is the literal `argon2id-hash-placeholder`;
3. the stored hash is byte-equal to the submitted password.

Cases 1 and 2 mean any account whose `password_hash` column holds one of those
two strings can be signed into with **any** password. Both literals are public
in this repository. Case 3, repeated at `src/services/auth.ts:71` for any hash
that does not parse as PBKDF2, turns a database read into a login: an attacker
who can read `users.password_hash` by any means can authenticate by submitting
the hash itself as the password.

**Remediation**: remove all three branches. A hash that does not parse as a
supported format must fail closed. If seeded fixtures need a known password,
seed a real PBKDF2 hash of it.

---

### BL-03

**Session signing key falls back to a secret committed to the repository**

- **Severity**: High
- **ASVS**: V7 (Session Management), V11 (Cryptography) — key management
- **Top 10**: A02:2025 Security Misconfiguration
- **Source**: `src/services/auth.ts:9`, `src/middleware/auth.ts:112`, `wrangler.jsonc`, `.dev.vars.example`

Session tokens are HMAC-SHA256 signed with `c.env.AUTH_SECRET`, defaulting to
`DEFAULT_AUTH_SECRET`, a string literal in the source. `AUTH_SECRET` is
declared as optional in the `Bindings` type at `src/index.ts:31`, is not
declared in `wrangler.jsonc`, and is not mentioned in `.dev.vars.example`.
There is nothing in the repository or the deploy workflow that sets it or
fails the deploy if it is missing.

If the secret is unset in production, anyone with this repository can forge a
token for an arbitrary user id and sign in as any user, including an
administrator. Token format is `userId:timestampMs:signatureHex`
(`src/services/auth.ts:113-137`), so the only unknown is the user id.

**Remediation**: make `AUTH_SECRET` mandatory. Remove the default and throw at
startup when the binding is absent. Set it per environment with
`wrangler secret put AUTH_SECRET`, document the rotation procedure, and add a
pre-deploy gate that fails when the secret is not present. Confirm whether the
default is currently in use in production and staging; if it is, treat all
existing sessions as compromised and rotate.

---

### BL-04

**Cloudflare Access email header is trusted without verifying the Access JWT**

- **Severity**: High
- **ASVS**: V6 (Authentication) — federated identity
- **Top 10**: A01:2025 Broken Access Control
- **Source**: `src/middleware/auth.ts:214-256`

The middleware reads `Cf-Access-Authenticated-User-Email` and treats it as
proof of identity. Where no matching user exists it **creates** one, marks it
active, and inserts a TRA level 2 certification with cert number `TRA-AU-CF`
and an expiry of 2028-12-31 (`src/middleware/auth.ts:236-248`).

Cloudflare Access also sends `Cf-Access-Jwt-Assertion`, a signed JWT that can
be validated against the team's public keys. That token is never read. A
request that reaches the Worker without traversing Access — for example via
the `*.workers.dev` route, a direct origin request, or any Access
misconfiguration — can assert an arbitrary email and, on first use,
self-provision an account with a level 2 high-power certification attached.

**Remediation**: verify the `Cf-Access-Jwt-Assertion` signature, issuer,
audience and expiry before trusting the email. Do not auto-provision
certifications; a certification is a regulatory claim and must be entered and
reviewable, not conjured by a header.

---

### BL-05

**No authentication rate limiting, throttling or lockout**

- **Severity**: High
- **ASVS**: V6 (Authentication) — brute-force resistance
- **Top 10**: A07:2025 Authentication Failures
- **Source**: `src/routes/auth.ts:159` (`POST /login`), `src/routes/auth.ts:622` (`POST /auth/webauthn/login-verify`); no matches for rate limiting anywhere under `src/`

There is no per-IP or per-account throttle, no exponential backoff, no
lockout, and no CAPTCHA on any authentication endpoint. `POST /login` performs
one PBKDF2 verification per attempt with no cap on attempt rate, which makes
both credential stuffing and per-account password guessing viable, and also
makes the endpoint a cheap CPU amplification target against the Worker's
per-request limits.

**Remediation**: apply the Cloudflare Workers rate limiting binding, which
reached general availability in September 2025, keyed on client IP and on
normalised email, in front of `POST /login`, `POST /register`, and the
WebAuthn verify endpoints. Add Cloudflare WAF rate limiting rules at the zone
as a second layer. Log and alert on authentication failure bursts.

---

### BL-06

**Session cookie is issued without the `Secure` attribute**

- **Severity**: Medium
- **ASVS**: V3 (Web Frontend Security) — cookie attributes
- **Top 10**: A02:2025 Security Misconfiguration
- **Source**: `src/services/auth.ts:205`, `src/services/auth.ts:212`

`createSessionCookie` sets `HttpOnly` and `SameSite=Lax` but not `Secure`, so
the browser will attach the session token to a plaintext HTTP request to the
same host. Cloudflare fronts both hostnames over HTTPS, which limits the
practical exposure, but the attribute is a hard requirement in ASVS and costs
nothing. The `webauthn_challenge` cookie at `src/routes/auth.ts:606` has the
same omission.

**Remediation**: append `; Secure` to both cookies. Consider the
`__Host-` name prefix, which additionally forces `Path=/` and forbids
`Domain`, once the cookie name can be changed safely.

---

### BL-07

**No CSRF defence beyond the cookie's `SameSite=Lax`; logout is reachable by GET**

- **Severity**: Medium
- **ASVS**: V4 (API and Web Service), V3 (Web Frontend Security)
- **Top 10**: A01:2025 Broken Access Control
- **Source**: no matches for `csrf` or an `Origin` header check anywhere under `src/`; `src/routes/auth.ts:413` (`GET /logout`)

Every state-changing route accepts an ordinary HTML form POST authenticated
solely by the session cookie. There is no synchroniser token, no double-submit
cookie, and no `Origin` or `Referer` validation.

`SameSite=Lax` does block cross-site POST requests from carrying the cookie in
current browsers, which is why this is Medium and not High. It is not a
complete defence: `Lax` still sends the cookie on top-level cross-site GET
navigations, so `GET /logout` is cross-site triggerable today; and `Lax`
offers no protection against a same-site attacker on another subdomain of
`thom.au`.

**Remediation**: validate the `Origin` header against an allowlist on every
unsafe method, which is a small piece of middleware and covers the whole
router at once. Restrict logout to POST. Add a synchroniser token if the
application ever needs to accept cross-origin requests.

---

### BL-08

**No security response headers**

- **Severity**: Medium
- **ASVS**: V3 (Web Frontend Security) — browser security headers
- **Top 10**: A02:2025 Security Misconfiguration
- **Source**: no matches for `content-security-policy`, `strict-transport-security`, `x-content-type-options`, `x-frame-options` or `referrer-policy` anywhere under `src/`

Responses carry no Content-Security-Policy, no HSTS, no
`X-Content-Type-Options: nosniff`, no framing control, no `Referrer-Policy`
and no `Permissions-Policy`. The only header hardening present is
`Cache-Control: no-store` on authenticated responses
(`src/middleware/auth.ts:322-330`).

Absent a CSP, any single output-encoding mistake in the view layer becomes a
directly exploitable stored or reflected XSS with no second line of defence.
The views do currently rely on Hono's `html` tagged template, which escapes
interpolated values by default, so this is a missing mitigation rather than a
live XSS.

**Note**: a strict CSP is not currently deployable as-is. The layout loads
Tailwind's Play CDN and inlines a `tailwind.config` script block
(`src/views/layout.ts:42-43`), and ten view modules contain inline `<script>`
blocks. Adopting CSP requires either nonces on every inline block or moving
that JavaScript to served static assets. This is scheduled as Phase 2 work in
the process document rather than treated as a quick win.

**Remediation**: add a response-header middleware in `src/index.ts` for the
headers that carry no compatibility cost (nosniff, `frame-ancestors 'none'`,
`Referrer-Policy: strict-origin-when-cross-origin`, HSTS,
`Permissions-Policy`), then take CSP through report-only before enforcing.

---

### BL-09

**Front-end scripts load from public CDNs with no Subresource Integrity, one unpinned**

- **Severity**: Medium
- **ASVS**: V3 (Web Frontend Security), V10 (Configuration) — third-party content
- **Top 10**: A03:2025 Software Supply Chain Failures
- **Source**: `src/views/layout.ts:42`, `src/views/layout.ts:71`

Every page loads `https://cdn.tailwindcss.com` with no version pin and no
`integrity` attribute, and `https://unpkg.com/htmx.org@2.0.4` with a version
pin but no `integrity` attribute. Both scripts execute with full access to the
authenticated session's DOM. A compromise of either CDN, or of the `htmx.org`
package on npm, is a direct compromise of every authenticated session.

The Tailwind Play CDN is additionally a development tool that compiles
stylesheets in the browser and is not intended for production use.

**Remediation**: vendor both dependencies, serve them from the Worker as
static assets, and pin them in `package.json` so they are covered by the same
dependency scanning as the server-side tree. If they must stay on a CDN, pin
exact versions and add `integrity` and `crossorigin` attributes.

---

### BL-10

**WebAuthn assertion does not verify origin or RP ID hash, and ignores the authenticator counter**

- **Severity**: Medium
- **ASVS**: V6 (Authentication) — cryptographic authenticators
- **Top 10**: A07:2025 Authentication Failures
- **Source**: `src/routes/auth.ts:622-800`

The assertion path does a genuine ECDSA P-256 signature verification against
the registered public key (`src/routes/auth.ts:764-786`), checks
`clientData.type === 'webauthn.get'`, and consumes a single-use challenge with
a 120-second TTL. Three required checks from the W3C Web Authentication
verification procedure are missing:

- `clientData.origin` is never compared to the expected origin. There is no
  occurrence of `origin` in the file at all.
- The RP ID hash, the first 32 bytes of `authenticatorData`, is never compared
  to SHA-256 of the expected RP ID. Only the flags byte at offset 32 is read
  (`src/routes/auth.ts:785-789`).
- The authenticator's reported signature counter is never read. The stored
  counter is incremented locally instead
  (`src/routes/auth.ts:796`), so cloned-authenticator detection is impossible
  by construction.

Without the origin and RP ID checks the assertion is not bound to this site,
which weakens the phishing resistance that is the main reason to deploy
passkeys.

**Remediation**: compare `clientData.origin` against the expected origin for
the environment, compare the RP ID hash, and read the big-endian counter from
`authenticatorData` bytes 33 to 36, rejecting or flagging a non-increasing
value from an authenticator that reports a non-zero counter.

---

### BL-11

**Passkey registration trusts a client-supplied public key with no attestation or challenge check**

- **Severity**: Medium
- **ASVS**: V6 (Authentication) — authenticator registration
- **Top 10**: A07:2025 Authentication Failures
- **Source**: `src/routes/auth.ts:519-572`

`POST /auth/webauthn/register-verify` takes `publicKey` straight from the
request body, falling back to the literal string
`base64url-public-key-fido2` when absent (`src/routes/auth.ts:551`). It never
parses the attestation object, never verifies an attestation statement, and
never validates the registration challenge — the stored challenge row is
deleted without being checked (`src/routes/auth.ts:542-551`). `counter` is
hard-coded to 0 and `credentialId` defaults to a server-generated UUID when
the client omits it.

The endpoint requires an authenticated session, so this is credential
self-management rather than an authentication bypass. The consequence is that
the "passkey" bound to an account need not correspond to any real
authenticator, which undermines any assurance the passkey is meant to carry
and makes the placeholder rows indistinguishable from genuine ones.

**Remediation**: parse the attestation object, extract the credential public
key from the authenticator data, verify the registration challenge and origin
on the same terms as the assertion path, and persist the authenticator's
initial counter.

---

### BL-12

**Test-only authentication bypass is selected by a runtime value, not by build**

- **Severity**: Medium
- **ASVS**: V10 (Configuration) — build and deploy separation
- **Top 10**: A02:2025 Security Misconfiguration
- **Source**: `src/middleware/auth.ts:86-89`, `src/middleware/auth.ts:283-289`

`isTestOrLocal` is true when the `TEST_MIGRATIONS` binding exists or when
`ENVIRONMENT === 'test'`. When it is true, any cookieless request to a
non-`/admin` path is authenticated as the default flyer returned by
`getActiveFlyer(db)`. The same flag also allows an unrecognised but validly
signed token to mint a fresh session row (`src/middleware/auth.ts:133-160`),
and it suppresses the unconfigured-instance redirect
(`src/middleware/auth.ts:104-108`).

Production sets `ENVIRONMENT: "production"` in `wrangler.jsonc`, so this is
not currently active in production. It is a single configuration value away
from anonymous access to the entire application, and no test or deploy gate
asserts that the value is correct on the deployed Worker.

**Remediation**: move the bypass behind a build-time constant so it is not
present in the production bundle at all. In the interim, add a post-deploy
assertion that an anonymous, cookieless request to a protected route returns
302 or 401 on both hostnames — gate G8 in the process document.

---

### BL-13

**Session tokens are stored verbatim, and revocation records leak them further**

- **Severity**: Medium
- **ASVS**: V7 (Session Management) — token storage
- **Top 10**: A04:2025 Cryptographic Failures
- **Source**: `src/db/schema.ts:528-541`, `src/middleware/auth.ts:66-77`, `src/routes/auth.ts:207`

The `sessions` table stores the bearer token in plaintext in
`sessions.token`. Revocation is implemented by writing a row into the general
`site_settings` table with the key `revoked_session:<token>`, which copies the
token into a second, less obviously sensitive table that is also used for
site configuration and WebAuthn challenges. Any read access to either table,
whether through a future SQL injection, a backup, a support export, or an
over-broad admin screen, yields live session tokens.

The revocation rows are also never garbage collected, so the settings table
grows without bound and every request pays a lookup against it
(`src/middleware/auth.ts:68-77`).

**Remediation**: store a SHA-256 hash of the token and look up by hash. Move
revocation into the `sessions` table as a `revoked_at` column, and delete
expired rows on a schedule.

---

### BL-14

**Secret comparisons are not constant-time**

- **Severity**: Low
- **ASVS**: V11 (Cryptography) — side channels
- **Top 10**: A04:2025 Cryptographic Failures
- **Source**: `src/services/auth.ts:106`, `src/services/auth.ts:173`

The derived password hash is compared with `===` and the HMAC session
signature with `!==`, both over hex strings, so both comparisons short-circuit
at the first differing character. Remote exploitation across the internet, and
across the Cloudflare edge, is difficult, which is why this is Low.

**Remediation**: compare fixed-length byte arrays with an accumulate-XOR loop
that always reads every byte.

---

### BL-15

**CSV import reads an unbounded request body into memory**

- **Severity**: Low
- **ASVS**: V5 (File Handling), V2 (Validation)
- **Top 10**: A10:2025 Mishandling of Exceptional Conditions
- **Source**: `src/routes/motors.ts:204-243`, `src/services/motor_import.ts:55-95`

`postMotorImportHandler` reads the whole uploaded file with `file.text()` and
hands it to a character-by-character parser with no cap on input length, row
count, or field count. A single large upload can exhaust the Worker's memory
limit or its CPU budget. The handler also resolves its actor as
`c.get('user') || await getActiveFlyer(db)`, so the fallback path attributes
the import to an arbitrary default flyer rather than failing.

**Remediation**: reject bodies over an explicit byte limit before parsing,
cap the row count, and remove the `getActiveFlyer` fallback so an
unauthenticated call cannot reach the parser.

---

### BL-16

**CI runs no dependency, secret, or static analysis scanning, and the repo has no linter**

- **Severity**: Informational
- **ASVS**: V10 (Configuration) — secure build pipeline
- **Top 10**: A03:2025 Software Supply Chain Failures
- **Source**: `.github/workflows/ci.yml`, `package.json`

The CI workflow runs `npm ci`, `npm run typecheck`, a schema-drift check, and
`npm test`. There is no `npm audit`, no software composition analysis, no
static analysis, no secret scanning, and no Dependabot or Renovate
configuration in `.github/`. `package.json` declares no linter at all, so
there is no place for security lint rules to live.

This is the single largest gap, because it is what would have caught several
of the findings above automatically and continuously. Closing it is Phase 1 of
the adoption plan.

---

### BL-17

**Self-registration is open to the public internet**

- **Severity**: Informational
- **ASVS**: V6 (Authentication)
- **Source**: `src/routes/auth.ts:236-411`, `src/middleware/auth.ts:26-35`

`/register` is on the public path allowlist and creates an active user with
`role: 'flyer'` and a self-declared certification. Anyone who can reach the
hostname can create an account and reach every non-admin route, including the
flight logbook, inventory and launch site data.

This may be the intended design for a club application. It is recorded here so
that the decision is explicit rather than incidental, because it sets the
meaning of "authenticated" for every other control in this document. If it is
intended, the anti-automation controls in BL-05 become more important, not
less. If it is not, registration should require an invitation or admin
approval.

**Action**: confirm the intent with the project owner and record the decision
in `wiki/concepts/security-testing.md`.

---

## What this assessment did not cover

Stated plainly so the coverage of this baseline is not overestimated:

- **No dynamic testing.** Nothing was executed against a running instance, in
  any environment. Every finding is a source-level judgement and each needs a
  reproduction case before it is treated as confirmed.
- **No dependency vulnerability data.** No `npm audit` or SCA run was
  performed, so known CVEs in the dependency tree are unassessed.
- **No review of the legacy Python service.** `app/`, `alembic/` and `tests/`
  hold the superseded FastAPI implementation described in
  `docs/legacy-fastapi.md`. It is not deployed by
  `.github/workflows/deploy.yml` and was excluded.
- **No infrastructure review.** Cloudflare Access policies, WAF rules, DNS,
  API token scopes and GitHub Actions secret configuration are outside the
  repository and were not inspected.
- **No business logic review of the regulatory rules.** Whether the SafeWork
  South Australia propellant thresholds and certification gates are correctly
  implemented is a safety and compliance question, covered by the existing
  compliance tests, not a security question.

## References

1. OWASP. *OWASP Top 10:2025*. <https://owasp.org/Top10/2025/>
2. OWASP. *Application Security Verification Standard 5.0.0*, May 2025. <https://github.com/OWASP/ASVS>
3. W3C. *Web Authentication: An API for accessing Public Key Credentials, Level 3* — Verifying an Authentication Assertion. <https://www.w3.org/TR/webauthn-3/>
4. Cloudflare. *Rate limiting — Workers runtime API bindings*. <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/>
5. MDN. *Set-Cookie — HTTP*. <https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie>
6. OWASP. *Cross-Site Request Forgery Prevention Cheat Sheet*. <https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html>
