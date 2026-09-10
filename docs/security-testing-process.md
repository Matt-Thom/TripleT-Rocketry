---
title: Release Security Testing Process
status: adopted
version: 1.0
created: 2026-09-10
applies_to: TripleT-Rocketry Cloudflare Worker (src/), staging and production
owner: project maintainer
---

# Release Security Testing Process

The security testing that must be completed before any TripleT-Rocketry
release reaches `rocketry.thom.au`, and the permanent test suite that carries
it out.

This document is the process. The current state of the application against it
is recorded separately in
[`security-baseline-2026-09.md`](security-baseline-2026-09.md), which is the
seed backlog for the suite described in section 7.

**Contents**

1. [Purpose and principles](#1-purpose-and-principles)
2. [System under test and attack surface](#2-system-under-test-and-attack-surface)
3. [Feasibility and declared limitations](#3-feasibility-and-declared-limitations)
4. [The security suite at a glance](#4-the-security-suite-at-a-glance)
5. [Gate specifications](#5-gate-specifications)
6. [The release runbook](#6-the-release-runbook)
7. [Security regression test catalogue](#7-security-regression-test-catalogue)
8. [Severity, triage and release blocking](#8-severity-triage-and-release-blocking)
9. [Records, evidence and sign-off](#9-records-evidence-and-sign-off)
10. [Adoption plan](#10-adoption-plan)
11. [References](#11-references)

---

## 1. Purpose and principles

TripleT-Rocketry holds personal data about club members, their high-power
rocketry certifications, and an audited chain of custody for explosive
propellant under South Australian regulation. A breach is not only a privacy
incident; falsified certification or custody records are a safety and
regulatory problem. That is the reason the bar here is higher than for a
typical hobby web application.

Five principles shape everything below.

**Every finding becomes a test.** A vulnerability that is fixed but not
covered by a test will come back. The output of every manual review, scan and
penetration test is a permanent, named test case in `test/security/`. The
suite only grows.

**Automate the repeatable, reserve humans for judgement.** Header checks,
dependency CVEs, access-control matrices and injection payloads are machine
work and run on every commit. Threat modelling, business-logic abuse cases and
regulatory-integrity reasoning are human work and run once per release.

**Test the deployed artefact, not only the source.** A Worker that passes
every unit test can still ship with a missing secret, a stale binding, or an
environment variable that enables a development bypass. Gates G5 and G8 run
against the running deployment for that reason.

**Fail closed and fail loudly.** A gate that cannot run is a failed gate, not
a skipped one. A scanner that errors blocks the release exactly as a scanner
that finds a Critical does.

**Write down what was not done.** Section 3 and the closing section of the
baseline document state the limits of coverage explicitly, so that nobody
mistakes a green pipeline for an absence of risk.

### Standards this process is measured against

- **OWASP ASVS 5.0.0** is the requirements catalogue. The application targets
  **Level 2**, which is the level ASVS intends for applications handling
  sensitive personal data. Level 3 is not a goal; it is aimed at systems where
  compromise implies risk to life at a scale this application does not carry.
- **OWASP Top 10:2025** is the risk taxonomy used for reporting and for
  prioritising, because it is what a reviewer outside the project will
  recognise.
- **OWASP Web Security Testing Guide** supplies the test procedures the manual
  gates follow, so that "manual review" means something repeatable.

---

## 2. System under test and attack surface

Understanding the shape of the target is what makes the gate selection below
defensible rather than a generic checklist.

### Architecture

A single Cloudflare Worker, server-rendered, with no separate front end.

| Layer | Technology | Source |
|---|---|---|
| Runtime | Cloudflare Workers (`workerd`), `nodejs_compat` | `wrangler.jsonc` |
| Router | Hono 4 | `src/index.ts` |
| Data | Cloudflare D1 (SQLite) via Drizzle ORM | `src/db/schema.ts`, `migrations/` |
| Views | Server-rendered HTML via Hono's `html` tagged template | `src/views/` |
| Client JS | HTMX 2.0.4 and Tailwind Play CDN, both from public CDNs | `src/views/layout.ts:42,71` |
| Identity | Password (PBKDF2-SHA256), WebAuthn passkeys, Cloudflare Access SSO | `src/services/auth.ts`, `src/routes/auth.ts` |
| Sessions | HMAC-SHA256 signed token in an `HttpOnly` cookie, backed by a `sessions` row | `src/services/auth.ts`, `src/middleware/auth.ts` |
| CI/CD | GitHub Actions; `develop` to staging, `main` to production | `.github/workflows/` |

### What this architecture rules in and out

Several whole classes of testing are **not applicable**, and saying so is part
of being comprehensive:

- **No containers, no OS, no host.** Workers are V8 isolates on Cloudflare's
  edge. There is no image to scan, no base OS to patch, no SSH, no open
  ports. Container and host vulnerability scanning is out of scope entirely.
- **No filesystem and no shell.** The runtime exposes neither, so path
  traversal, local file inclusion and OS command injection have no reachable
  sink. These are still probed by the DAST gate, cheaply, to confirm the
  assumption rather than to assume it.
- **No raw SQL string building.** All database access is Drizzle's
  parameterised query builder. The one `sql.raw` in the tree
  (`src/db/schema.ts:168`) sits in a schema default, not a request path.
  Classic SQL injection is therefore structurally unlikely, which lowers the
  priority of injection fuzzing without removing it — an ORM misuse or a
  future raw query would reintroduce it, so gate G3 lints for it and G6 probes
  for it.

### The surfaces that actually matter here

Testing effort is concentrated on these, in this order:

1. **The authentication middleware** (`src/middleware/auth.ts`). It runs on
   every request and resolves identity from six different sources: session
   cookie, Cloudflare Access header, `Authorization: Bearer`, `X-Flyer-Id`,
   `X-Flyer-Email`, and a local-development fallback. Each source is a trust
   boundary, and the number of them is itself the risk.
2. **Role and ownership enforcement across every route.** Admin gating lives
   in `src/routes/admin.ts:39`. Per-record ownership is enforced ad hoc, route
   by route, with no shared authorisation helper — which is the condition that
   produces insecure direct object references.
3. **Session issuance, storage, revocation and expiry**
   (`src/services/auth.ts`, `src/middleware/auth.ts`).
4. **The WebAuthn registration and assertion paths**
   (`src/routes/auth.ts:461-800`), because hand-written WebAuthn verification
   is difficult to get right and this implementation is hand-written.
5. **Output encoding in the view layer** (`src/views/`), where a single
   unescaped interpolation is a stored XSS against every user of a shared
   club record.
6. **Bulk input handling**, principally the motor CSV import
   (`src/services/motor_import.ts`), which is the only place the application
   ingests an untrusted file.
7. **Deployment configuration** — secrets, bindings, environment variables,
   Cloudflare Access policy and WAF rules — which is where the most severe
   findings in the baseline live.

---

## 3. Feasibility and declared limitations

The brief offered an exemption if comprehensive security testing were not
possible for this project. **It is possible, and no exemption is claimed for
the process as a whole.** Everything in sections 4 to 7 can be built and run
with the tooling this project already uses, on free or already-paid-for
services, by one maintainer.

Five specific limits do apply. They are declared here rather than discovered
later, and each has a stated compensating control. A gate cannot be quietly
dropped on the grounds that "security testing is hard"; it can only be limited
in the ways written down here.

### 3.1 Load and denial-of-service testing cannot be performed

Cloudflare's scans and penetration testing policy prohibits DDoS simulation of
any kind against Cloudflare infrastructure, and the application is served
entirely from Cloudflare's edge. There is no origin server to test
independently.

*Compensating control*: availability is assessed by review rather than by
attack. Gate G7 examines Cloudflare rate limiting and WAF configuration, the
Worker's CPU and memory limits, and the unbounded-input findings such as
BL-15, and confirms that per-request resource caps exist. Resource exhaustion
that is reachable in a single request, such as an oversized CSV, is tested
functionally in G4 with a body-size assertion, not with volume.

### 3.2 Penetration testing requires notifying Cloudflare and configuring the zone first

Cloudflare permits customers to scan and test their own zones, subject to its
policy: testing must be confined to customer-owned assets and registered DNS
entries, some activities require explicit approval, and Cloudflare's own
infrastructure is off limits. The policy also asks that the Managed Ruleset
and OWASP Core Ruleset be deployed on the zone before testing begins.

*Compensating control*: gate G6 runs against **staging**
(`rocketry-dev.thom.au`) only, never production, and the runbook in section 6
makes notifying Cloudflare a prerequisite step rather than an afterthought.
Production is verified with gate G8, which is read-only and indistinguishable
from ordinary traffic.

### 3.3 Automated dynamic scanning cannot reach the whole application unaided

Most of the application is behind authentication, and the login flow is a form
POST that sets a cookie. A default unauthenticated crawl would reach the login
page and little else, and would report a clean result that means nothing.

*Compensating control*: G6 is specified as an **authenticated** scan. The
runbook mints a session against staging and supplies the cookie to the
scanner, with a session-check regex so the scanner detects and reports logout
rather than silently continuing unauthenticated. The scanner is additionally
seeded with the route inventory from `src/routes/` so that coverage does not
depend on the crawler discovering HTMX-driven links.

### 3.4 Third-party and platform components are assessed by configuration review, not by testing

Cloudflare Access, D1, the Workers runtime and the two public CDNs are not
ours to test, and testing them would breach the policies of the parties that
own them.

*Compensating control*: G7 reviews their configuration — Access policies and
their enforcement, D1 binding separation between environments, API token
scope, CDN pinning and integrity. The supply chain risk that this leaves is
recorded as BL-09 and is addressed by removing the CDN dependency, not by
testing it.

### 3.5 This process does not deliver an independent assurance opinion

Testing designed and executed by the same party that builds the software is
verification, not independent assurance. It finds implementation defects; it
is weaker at finding design and assumption defects, because the same blind
spot produces both the code and the test.

*Compensating control*: gate G7 requires a review from someone other than the
change's author before each release, and section 10 schedules an external
penetration test before the first release that carries real member data. That
external test is a **prerequisite for production go-live with real data**, not
an optional extra, and it is the one item in this document that cannot be
satisfied from inside the project.

### 3.6 One thing genuinely deferred

Content-Security-Policy cannot be enforced on the current codebase without
first restructuring the front end. The layout inlines a `tailwind.config`
script block and ten view modules contain inline `<script>` blocks; a policy
strict enough to be worth having would break all of them. This is why G5
checks CSP in report-only mode in Phase 2 and enforces it only in Phase 3
(section 10), and why BL-08 is Medium rather than a quick win. The gap is
real, is written down, and has a date.

---

## 4. The security suite at a glance

Nine gates. Each names when it runs, what it runs, and what makes it fail.

| Gate | Name | Runs | Automated | Blocks release on |
|---|---|---|---|---|
| **G0** | Threat model currency | Per release | No | Model older than the last architectural change |
| **G1** | Secrets and configuration hygiene | Every push, every PR | Yes | Any verified secret in the tree or history; a required secret unset |
| **G2** | Dependency and supply chain | Every push, daily | Yes | Any High or Critical advisory with a fix; unpinned third-party script |
| **G3** | Static analysis | Every push, every PR | Yes | Any High or Critical rule; any error-level security lint rule |
| **G4** | Security regression suite | Every push, every PR | Yes | Any failing `SEC-*` case |
| **G5** | Deployed configuration verification | After every deploy | Yes | Missing required header; secret absent; bypass reachable |
| **G6** | Authenticated dynamic scan (DAST) | Per release candidate, staging | Yes | Any High or Critical alert not triaged as a false positive |
| **G7** | Manual security review | Per release | No | Any unresolved Critical or High finding |
| **G8** | Production post-deploy verification | After every production deploy | Yes | Any check failing; triggers rollback |

Gates G1 to G4 run on every commit and are the everyday cost of the process,
adding roughly two minutes to CI. G5 to G8 run per release. G0 and G7 are the
human gates.

---

## 5. Gate specifications

### G0 — Threat model currency

**When**: at the start of each release cycle, before the release branch is cut.

**What**: confirm `wiki/concepts/security-testing.md` still describes the
system as built. Where the release adds a route, a trust boundary, an
identity source, a data category or an external dependency, extend the model
before writing the code, using STRIDE per element against the attack surface
listed in section 2.

Each new element is walked through six questions: can identity be **spoofed**
here, can data be **tampered** with, can an action be **repudiated**, can
information be **disclosed**, can service be **denied**, can privilege be
**elevated**? Every "yes" produces either a control or an accepted risk with a
name against it, and every control produces a `SEC-*` case in G4.

**Fails when**: the model does not describe the system being released.

**Evidence**: a dated diff to the wiki page.

### G1 — Secrets and configuration hygiene

**When**: every push and pull request; the history scan additionally weekly.

**What**:

- **Secret scanning over the working tree and full git history.** Gitleaks in
  CI, plus GitHub's native push protection and secret scanning enabled on the
  repository.
- **Required-secret assertion.** A pre-deploy step that fails the deploy when
  `AUTH_SECRET` is not set for the target environment. This is the direct
  control for BL-03 and matters more than the scanning does.
- **Configuration review.** `wrangler.jsonc` is checked so that each
  environment binds its own D1 database, `ENVIRONMENT` carries the correct
  value, and no development flag is set on a deployed environment.
- **`.gitignore` assertion** covering `.dev.vars`, `.env` and `.wrangler/`.

**Fails when**: a verified secret is found anywhere in the tree or history, a
required secret is unset for the deploy target, or an environment's bindings
are wrong.

**Evidence**: the CI job log, retained with the release record.

### G2 — Dependency and supply chain

**When**: every push, plus a daily scheduled run so that advisories published
between releases are caught.

**What**:

- `npm audit --audit-level=high` over production dependencies.
- Automated dependency updates via Dependabot or Renovate, security updates
  grouped and raised daily.
- **Lockfile integrity**: `npm ci` only, never `npm install`, in CI and
  deploy, so the resolved tree is the committed one.
- **Third-party script inventory**: an assertion over `src/views/` that every
  `<script src>` pointing off-origin carries both an exact version and an
  `integrity` attribute. This is what turns BL-09 from a one-off finding into
  a standing control.
- **Install-script review**: `package.json` currently allowlists post-install
  scripts for `esbuild` and `workerd`. Any addition to that list is reviewed
  as a change to what executes on a developer's machine.

**Fails when**: a High or Critical advisory has a fix available, the lockfile
is out of sync with `package.json`, or an off-origin script lacks pinning or
integrity.

**Note on the Top 10:2025**: Software Supply Chain Failures entered the list
at A03 in the 2025 edition. This gate is why.

### G3 — Static analysis

**When**: every push and pull request.

**What**:

- **Semgrep** with the `p/owasp-top-ten`, `p/javascript`, `p/typescript` and
  `p/secrets` rulesets, plus a project ruleset under `.semgrep/` for the
  patterns that are specific to this codebase:

  | Rule | Detects | Rationale |
  |---|---|---|
  | `no-raw-sql-interpolation` | `sql.raw` or template literals reaching a query builder | Preserves the parameterisation guarantee in section 2 |
  | `no-unescaped-html` | `html` used with `raw()`, or string concatenation into a response | The view layer's escaping is the only XSS defence today |
  | `no-identity-headers` | Reading `x-flyer-id`, `x-flyer-email` or `x-no-auth` outside `test/` | Prevents BL-01 from reappearing |
  | `no-default-secrets` | A string literal defaulting a secret or key | Prevents BL-03 from reappearing |
  | `route-requires-auth` | A router mutation handler with no user resolution | Catches a route added outside the middleware's assumptions |
  | `no-plaintext-token-storage` | Writing a session token to a table column | Enforces the BL-13 remediation |

- **GitHub CodeQL** on the `javascript-typescript` pack, for taint-tracking
  analysis that pattern rules cannot do.
- **ESLint** with `eslint-plugin-security` and the TypeScript rules. The
  project has no linter at all today; introducing one is a prerequisite, and
  its security rules are set to `error` while style rules stay advisory.
- `tsc --noEmit` is already in CI and is retained as a security control, since
  the codebase's `any` casts around context values are where type confusion
  would hide.

**Fails when**: any High or Critical Semgrep or CodeQL finding, or any
error-level security lint rule, is present. Suppressions require an inline
justification comment and are reviewed at G7.

### G4 — Security regression suite

**When**: every push and pull request. This is the centre of the process.

**What**: a dedicated `test/security/` directory in the existing Vitest and
Miniflare harness, running against the real Worker through `SELF.fetch` with a
real D1 — the same opaque-box approach `TEST_INFRA.md` already establishes,
applied to abuse cases instead of features.

The full catalogue is section 7. The suite is organised in eight files:

| File | Covers |
|---|---|
| `test/security/authn.test.ts` | Identity sources, credential verification, session forgery |
| `test/security/session.test.ts` | Issuance, cookie attributes, expiry, revocation, fixation |
| `test/security/authz.test.ts` | The role matrix, ownership and IDOR, privilege escalation |
| `test/security/injection.test.ts` | SQL, XSS, header, redirect, template payloads at every input |
| `test/security/headers.test.ts` | Response security headers and cache behaviour |
| `test/security/input_limits.test.ts` | Size, type, encoding and malformed-input handling |
| `test/security/webauthn.test.ts` | Registration and assertion verification steps |
| `test/security/disclosure.test.ts` | Error output, enumeration, logging of sensitive values |

Three properties make this suite worth having:

- **Every case has a stable ID** (`SEC-AUTHN-01`) used in the test name, so a
  failure names the requirement directly and traces to ASVS and to a baseline
  finding.
- **The authorisation matrix is generated, not hand-written.** A table of
  every route from `src/routes/` crossed with every actor — anonymous, flyer,
  a second flyer who owns nothing, admin — produces one assertion per cell.
  Adding a route without adding it to the matrix fails the suite, which is the
  only reliable defence against access-control drift.
- **Each fixed finding gets a permanent regression case**, named for its
  baseline ID.

**Fails when**: any `SEC-*` case fails. There is no advisory tier.

### G5 — Deployed configuration verification

**When**: immediately after every deploy, to staging and to production, as a
step in `.github/workflows/deploy.yml` replacing the current smoke test.

**What**: an HTTP probe of the deployed hostname asserting:

- **Security headers present and correct** on an authenticated and an
  unauthenticated response: `Strict-Transport-Security` with a
  production-grade `max-age`, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy` with `frame-ancestors 'none'`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`,
  and `Cache-Control: no-store` on authenticated routes.
- **Cookie attributes** on a real login response: `HttpOnly`, `Secure`,
  `SameSite`, and no session token in the response body or URL.
- **No development bypass is reachable.** An anonymous, cookieless request to
  a protected route returns 302 or 401. A request bearing `X-Flyer-Email` for
  a known user returns 302 or 401. A request with `X-No-Auth: true` is not
  treated as privileged. This is the standing control for BL-01 and BL-12, and
  it is the check that a source-level test cannot give you, because it
  exercises the artefact that was actually uploaded.
- **TLS posture**: TLS 1.2 minimum, valid certificate chain, HTTP redirected
  to HTTPS.
- **No information disclosure**: no stack trace, framework banner, or internal
  hostname in a 404 or a forced 500.

**Fails when**: any assertion fails. On production, a failure triggers the
rollback in section 6.

### G6 — Authenticated dynamic scan

**When**: once per release candidate, against **staging only**.

**What**: OWASP ZAP in automation-framework mode, against
`rocketry-dev.thom.au`, configured as:

- **Authenticated**, using a session cookie minted for a purpose-made scan
  account, with a logged-in regex so the scanner reports session loss instead
  of silently degrading to an anonymous crawl. A second pass runs as a
  low-privilege flyer to surface authorisation gaps the admin pass would miss.
- **Seeded** with the route inventory from `src/routes/`, since HTMX-driven
  navigation is not reliably discoverable by a crawler.
- **Full active scan**, including the injection, path traversal and command
  injection rules that section 2 argues should have no reachable sink. They
  run precisely to test that argument.
- **Preceded by** the Cloudflare notification step and zone configuration in
  section 6, per the limitation in 3.2.

Findings are triaged the same day. False positives are suppressed in a
committed ZAP context file with a written reason, not by lowering the
threshold.

**Fails when**: any High or Critical alert remains after triage.

### G7 — Manual security review

**When**: once per release, after G6, before the release is tagged.

**What**: four activities that cannot be automated, following the OWASP Web
Security Testing Guide.

**Diff review with a security lens.** Every change in the release, read by
someone other than its author, asking: does this add an identity source, an
input, a route, a trust boundary, a dependency? Does it touch authentication,
authorisation, session handling, cryptography or the view layer? Does it store
anything new about a person?

**Business-logic abuse cases.** The domain-specific attacks a generic scanner
will never find, because they need to know what the application means:

- Can a flyer raise their own certification level, or set an expiry in the
  past, to clear a preflight gate they should fail?
- Can a flyer log a flight against another flyer's rocket, or consume another
  flyer's motor inventory?
- Can propellant mass be edited so that a storage site slips under the South
  Australian 3.0 kg unlicensed threshold while the physical stock does not?
- Can the custody ledger be altered or reordered after the fact, and does the
  audit trail survive a soft delete?
- Can a duty officer assign themselves the RSO and LCO roles for their own
  flight?
- Can an event's dates or officers be edited after flights are recorded
  against it, changing the meaning of the record?

Each abuse case that reaches a "yes" becomes a `SEC-LOGIC-*` case in G4.

**Configuration review.** Cloudflare Access policies and whether they are
actually enforced on both hostnames, WAF and rate limiting rules, D1 binding
separation, Cloudflare API token scope, GitHub Actions secret and environment
protection rules, and branch protection on `main`.

**Suppression review.** Every scanner suppression and lint disable added since
the last release, re-justified or removed.

**Fails when**: any Critical or High finding is unresolved and unaccepted.

**Evidence**: a completed sign-off record, section 9.

### G8 — Production post-deploy verification

**When**: within fifteen minutes of every production deploy.

**What**: G5's assertions re-run against `rocketry.thom.au`, plus:

- `/health` and `/ready` return 200 and disclose nothing beyond status.
- A canary login with a monitoring account succeeds and its session is then
  revoked, confirming that both issuance and revocation work in production.
- Cloudflare Workers observability, already enabled in `wrangler.jsonc`, shows
  no unhandled exception spike and no authentication failure spike in the
  first fifteen minutes.

**Fails when**: any check fails. Rollback per section 6.

---

## 6. The release runbook

### 6.1 Continuous — every push and pull request

Gates G1, G2, G3 and G4 run in CI. A pull request cannot merge to `develop`
with any of them red. This is the majority of the process and it needs no
human attention.

### 6.2 Release candidate — before merging `develop` to `main`

| # | Step | Gate | Owner |
|---|---|---|---|
| 1 | Confirm the threat model covers everything in this release | G0 | Maintainer |
| 2 | Confirm all continuous gates are green on the release commit | G1-G4 | CI |
| 3 | Deploy the candidate to staging and verify deployed configuration | G5 | CI |
| 4 | Notify Cloudflare and confirm the zone's WAF configuration for testing | — | Maintainer |
| 5 | Run the authenticated dynamic scan against staging, both privilege levels | G6 | Maintainer |
| 6 | Triage every scan alert; suppress with a written reason or fix | G6 | Maintainer |
| 7 | Complete the manual security review | G7 | Reviewer, not the author |
| 8 | Convert every new finding into a `SEC-*` case and re-run G4 | G4 | Maintainer |
| 9 | Complete and file the sign-off record | — | Maintainer |

Step 4 exists because of limitation 3.2 and is not optional. Step 8 is what
makes the suite grow; skipping it turns this process back into a checklist.

### 6.3 Production release

1. Merge `main`, which deploys via `.github/workflows/deploy.yml`.
2. G8 runs automatically within fifteen minutes.
3. On any G8 failure, roll back immediately with
   `wrangler rollback --env=""` and treat it as an incident.

Note that D1 migrations are applied **before** the Worker is uploaded, so a
Worker rollback does not roll back the schema. Any release containing a
destructive migration needs its own documented rollback path, prepared before
the release, not after.

### 6.4 Between releases

- G2 runs daily on a schedule; a new Critical advisory raises an issue
  immediately rather than waiting for the next release.
- A Critical finding discovered outside a release cycle follows the
  out-of-band path in section 8.

---

## 7. Security regression test catalogue

The `SEC-*` cases that constitute gate G4. Each is an opaque-box HTTP test
through `SELF.fetch`, consistent with the existing harness described in
`TEST_INFRA.md`.

Cases marked **[BL-nn]** are regression tests for a specific baseline finding
and must fail today, before the fix, and pass after. Writing them first is how
each fix is verified.

### 7.1 Authentication — `test/security/authn.test.ts`

| ID | Case | ASVS |
|---|---|---|
| SEC-AUTHN-01 | `X-Flyer-Id` on an anonymous request does not authenticate **[BL-01]** | V2 |
| SEC-AUTHN-02 | `X-Flyer-Email` on an anonymous request does not authenticate **[BL-01]** | V2 |
| SEC-AUTHN-03 | `X-No-Auth` and other test headers confer no privilege **[BL-12]** | V10 |
| SEC-AUTHN-04 | A stored hash submitted as the password is rejected **[BL-02]** | V6 |
| SEC-AUTHN-05 | Placeholder hashes never authenticate **[BL-02]** | V6 |
| SEC-AUTHN-06 | A token signed with the repository's default secret is rejected **[BL-03]** | V7 |
| SEC-AUTHN-07 | The Worker refuses to start, or refuses to authenticate, when `AUTH_SECRET` is unset **[BL-03]** | V10 |
| SEC-AUTHN-08 | `Cf-Access-Authenticated-User-Email` without a valid Access JWT does not authenticate **[BL-04]** | V6 |
| SEC-AUTHN-09 | An Access header for an unknown email does not auto-create a user or a certification **[BL-04]** | V6 |
| SEC-AUTHN-10 | Login failures are rate limited after N attempts per IP **[BL-05]** | V6 |
| SEC-AUTHN-11 | Login failures are rate limited per account regardless of source IP **[BL-05]** | V6 |
| SEC-AUTHN-12 | Login responses do not distinguish unknown user from wrong password | V6 |
| SEC-AUTHN-13 | An inactive user cannot authenticate by any of the six identity sources | V6 |
| SEC-AUTHN-14 | `Authorization: Bearer` with a forged or expired token is rejected | V7 |
| SEC-AUTHN-15 | Registration rejects a password below the policy minimum | V6 |
| SEC-AUTHN-16 | Registration cannot set `role`, `isActive` or a certification by mass assignment | V6 |
| SEC-AUTHN-17 | `/setup` returns 400 once setup is complete, from every identity state | V10 |

### 7.2 Session management — `test/security/session.test.ts`

| ID | Case | ASVS |
|---|---|---|
| SEC-SESS-01 | The session cookie carries `HttpOnly`, `Secure` and `SameSite` **[BL-06]** | V3 |
| SEC-SESS-02 | The session token never appears in a URL, a response body or a log line | V7 |
| SEC-SESS-03 | A new session token is issued on login; a pre-login token is not adopted | V7 |
| SEC-SESS-04 | Logout invalidates the token server-side, not only in the browser | V7 |
| SEC-SESS-05 | A token past `expiresAt` is rejected even when its HMAC is valid | V7 |
| SEC-SESS-06 | A revoked token stays rejected after a subsequent successful login | V7 |
| SEC-SESS-07 | A token whose user was deactivated is rejected on the next request | V7 |
| SEC-SESS-08 | Tampering with any of the three token segments causes rejection | V7 |
| SEC-SESS-09 | Tokens are stored hashed; no plaintext token exists in any table **[BL-13]** | V7 |
| SEC-SESS-10 | Signature comparison is constant-time **[BL-14]** | V11 |
| SEC-SESS-11 | Logout is not reachable by GET **[BL-07]** | V4 |
| SEC-SESS-12 | An unsafe method with a foreign `Origin` header is rejected **[BL-07]** | V4 |
| SEC-SESS-13 | Admin actions revoking a user's sessions take effect immediately | V7 |

### 7.3 Authorisation — `test/security/authz.test.ts`

The generated matrix described in G4, plus:

| ID | Case | ASVS |
|---|---|---|
| SEC-AUTHZ-01 | Every route, crossed with every actor, returns its expected status | V8 |
| SEC-AUTHZ-02 | Adding a route without a matrix entry fails the suite | V8 |
| SEC-AUTHZ-03 | Flyer A cannot read, edit or delete Flyer B's rockets | V8 |
| SEC-AUTHZ-04 | Flyer A cannot read, edit or delete Flyer B's flights | V8 |
| SEC-AUTHZ-05 | Flyer A cannot consume or adjust Flyer B's motor inventory | V8 |
| SEC-AUTHZ-06 | Flyer A cannot alter Flyer B's certifications or club memberships | V8 |
| SEC-AUTHZ-07 | Flyer A cannot rename or delete Flyer B's passkeys | V8 |
| SEC-AUTHZ-08 | `role` submitted to `/profile` does not elevate privilege | V8 |
| SEC-AUTHZ-09 | An admin-only field submitted to a flyer endpoint is ignored, not applied | V8 |
| SEC-AUTHZ-10 | Non-admins receive 403 on every `/admin` route across all HTTP methods | V8 |
| SEC-AUTHZ-11 | The last remaining admin cannot be demoted, deactivated or deleted | V8 |
| SEC-AUTHZ-12 | An admin cannot deactivate their own account | V8 |
| SEC-AUTHZ-13 | Identifiers in URLs are unguessable, or are ownership-checked on every access | V8 |
| SEC-AUTHZ-14 | Enumerating sequential or adjacent identifiers discloses nothing | V8 |

### 7.4 Injection and output encoding — `test/security/injection.test.ts`

| ID | Case | ASVS |
|---|---|---|
| SEC-INJ-01 | XSS payloads in every persisted text field render escaped in every view | V1 |
| SEC-INJ-02 | XSS payloads in query strings render escaped, including in error banners | V1 |
| SEC-INJ-03 | Payloads in a field rendered inside an HTML attribute are attribute-escaped | V1 |
| SEC-INJ-04 | Payloads in a field rendered inside a `<script>` block cannot break out | V1 |
| SEC-INJ-05 | SQL metacharacters in every input are treated as data | V1 |
| SEC-INJ-06 | Boolean and time-based blind SQL injection probes show no differential | V1 |
| SEC-INJ-07 | CRLF in any header-reflected input does not split the response | V1 |
| SEC-INJ-08 | The `redirect` parameter cannot leave the origin, including protocol-relative and encoded forms | V1 |
| SEC-INJ-09 | Path traversal sequences in every path parameter are inert | V1 |
| SEC-INJ-10 | Prototype-pollution keys in JSON bodies do not alter object behaviour | V1 |
| SEC-INJ-11 | Unicode, bidirectional and null-byte payloads round-trip without breaking escaping | V1 |
| SEC-INJ-12 | CSV formula-injection prefixes are neutralised on any export | V5 |

### 7.5 Security headers — `test/security/headers.test.ts`

| ID | Case | ASVS |
|---|---|---|
| SEC-HDR-01 | `X-Content-Type-Options: nosniff` on every response **[BL-08]** | V3 |
| SEC-HDR-02 | `Content-Security-Policy` present with `frame-ancestors 'none'` **[BL-08]** | V3 |
| SEC-HDR-03 | `Strict-Transport-Security` present with a production `max-age` **[BL-08]** | V3 |
| SEC-HDR-04 | `Referrer-Policy: strict-origin-when-cross-origin` **[BL-08]** | V3 |
| SEC-HDR-05 | `Permissions-Policy` denies camera, microphone and geolocation **[BL-08]** | V3 |
| SEC-HDR-06 | `Cache-Control: no-store` on every authenticated response | V3 |
| SEC-HDR-07 | No CORS header permits a foreign origin with credentials | V4 |
| SEC-HDR-08 | Every off-origin `<script src>` is version-pinned and carries `integrity` **[BL-09]** | V3 |
| SEC-HDR-09 | No response discloses server, framework or runtime version | V3 |

### 7.6 Input limits and malformed input — `test/security/input_limits.test.ts`

| ID | Case | ASVS |
|---|---|---|
| SEC-INP-01 | A CSV upload above the configured byte limit is rejected before parsing **[BL-15]** | V5 |
| SEC-INP-02 | A CSV above the configured row limit is rejected | V5 |
| SEC-INP-03 | A non-CSV file submitted to the import endpoint is rejected | V5 |
| SEC-INP-04 | A malformed CSV returns a validation error, never a 500 | V2 |
| SEC-INP-05 | The import endpoint is unreachable without authentication **[BL-15]** | V8 |
| SEC-INP-06 | Numeric fields reject `NaN`, `Infinity`, exponent notation and overflow | V2 |
| SEC-INP-07 | Date fields reject impossible and out-of-range values | V2 |
| SEC-INP-08 | Oversized text in any field is rejected or truncated, never stored unbounded | V2 |
| SEC-INP-09 | Deeply nested JSON does not exhaust the parser | V10 |
| SEC-INP-10 | Unexpected content types are rejected rather than coerced | V2 |

### 7.7 WebAuthn — `test/security/webauthn.test.ts`

| ID | Case | ASVS |
|---|---|---|
| SEC-WA-01 | An assertion whose `clientData.origin` is foreign is rejected **[BL-10]** | V6 |
| SEC-WA-02 | An assertion whose RP ID hash does not match is rejected **[BL-10]** | V6 |
| SEC-WA-03 | A non-increasing authenticator counter is rejected or flagged **[BL-10]** | V6 |
| SEC-WA-04 | A replayed assertion is rejected once the challenge is consumed | V6 |
| SEC-WA-05 | An expired challenge is rejected | V6 |
| SEC-WA-06 | An assertion signed by a different key is rejected | V6 |
| SEC-WA-07 | Registration verifies its challenge before storing a credential **[BL-11]** | V6 |
| SEC-WA-08 | Registration derives the public key from attestation, not from the request body **[BL-11]** | V6 |
| SEC-WA-09 | A credential cannot be registered against another user's account | V6 |
| SEC-WA-10 | Removing the last authenticator does not lock a user out of all factors | V6 |

### 7.8 Information disclosure — `test/security/disclosure.test.ts`

| ID | Case | ASVS |
|---|---|---|
| SEC-DISC-01 | A forced 500 discloses no stack trace, path or query text | V9 |
| SEC-DISC-02 | Login timing does not distinguish a known from an unknown account | V6 |
| SEC-DISC-03 | Registration does not reveal whether an email is already in use | V6 |
| SEC-DISC-04 | Logs never contain passwords, session tokens or full email addresses | V9 |
| SEC-DISC-05 | `/health` and `/ready` disclose nothing beyond a status | V9 |
| SEC-DISC-06 | A 404 for a record that exists but is not owned is indistinguishable from one that does not exist | V8 |
| SEC-DISC-07 | Authentication and authorisation failures are logged with enough context to investigate | V9 |

### 7.9 Business logic — `test/security/logic.test.ts`

Populated from the abuse cases in G7. The initial set is the six questions in
that section, one case each, and the file grows with every release.

---

## 8. Severity, triage and release blocking

### Scale

| Severity | Meaning here | Response |
|---|---|---|
| **Critical** | Unauthenticated compromise of another user's account or data; authentication bypass; falsification of a certification or custody record | Blocks release. Fix within 24 hours of discovery. If already in production, treat as an incident and consider taking the service offline |
| **High** | Authenticated privilege escalation; disclosure of another member's personal data; a control whose failure enables a Critical | Blocks release. Fix within 7 days |
| **Medium** | A missing defence-in-depth layer, or an issue needing an unusual precondition | Does not block. Must have an owner and a target release |
| **Low** | Hardening with limited practical exploitability | Backlog |
| **Informational** | Process or configuration observation | Backlog |

A gate that cannot run scores as **High** until it runs. A scanner that errors
is not a pass.

### Accepting a risk

A Medium or Low may be accepted. A Critical or High may not be accepted, only
fixed or mitigated to a lower severity. An acceptance is written into
`wiki/issues.md` with the finding, why it is accepted, what compensates for
it, and a review date. Acceptances are re-read at every G7 and expire after
two releases.

### Out-of-band findings

A Critical found outside a release cycle does not wait for one. Confirm it,
write the `SEC-*` case that proves it, fix it, run G1 to G5 on the fix, deploy,
and run G8. G6 and G7 follow within the week.

---

## 9. Records, evidence and sign-off

A release is not signed off until the record exists. Records live in
`docs/security/releases/<version>.md` and are committed, because an audit
trail that can be edited without trace is not an audit trail.

Each record carries: the release version and commit; the date; the result and
evidence link for each of G0 to G8; every finding with its ID, severity and
disposition; every suppression or acceptance added, with its justification;
the reviewer's name for G7, who must not be the author of the changes; and the
declared limitations from section 3 that applied to this release.

Retention is three years, matching the horizon over which a regulatory
question about a custody record could reasonably be raised.

CI job logs, ZAP reports and G5 and G8 probe output attach to the release
record as artefacts.

---

## 10. Adoption plan

None of this exists today. The order below is chosen so that the highest-value
controls land first and each phase is independently useful.

### Phase 1 — the pipeline (target: next release)

Gates G1, G2 and G3 into CI, and the `test/security/` scaffold with the
authorisation matrix generator. Fix BL-01, BL-02 and BL-03 first, each with
its regression case written before the fix. Introduce ESLint, which the
project currently lacks.

Rationale: BL-01 and BL-02 are unauthenticated account takeover, BL-03 is
possibly one, and the scanning gates are what stop the next three from being
found by someone else.

### Phase 2 — the suite (target: release + 1)

The full section 7 catalogue. Fix BL-04 through BL-09. Add G5 to the deploy
workflow, replacing the current smoke test. Deploy CSP in report-only mode and
collect violations.

### Phase 3 — dynamic and manual (target: release + 2)

G6 authenticated ZAP scanning against staging. G7 as a standing per-release
activity with a written threat model. G8 on production. Enforce CSP once the
report-only data shows what would break, which requires the inline-script
work described in limitation 3.6. Fix BL-10 through BL-15.

### Phase 4 — independent assurance (before any release carrying real member data)

An external penetration test by a party unconnected to the project, scoped to
the staging environment, with Cloudflare notified per limitation 3.2. Its
findings enter the same backlog and the same `SEC-*` suite. Per limitation
3.5, this is the one control that cannot be satisfied from inside the project,
and it gates production go-live with real data.

### Keeping it honest

Two failure modes end processes like this one, and both are worth naming.

The first is **checklist decay**: gates that are run because the document says
so, with results nobody reads. The defence is that G1 to G5 and G8 are
automated and blocking, so they cannot be quietly skipped, and that the two
human gates produce a written artefact with a named reviewer.

The second is **suite rot**: tests that are weakened until they pass. The
defence is that suppressions and acceptances are re-justified at every G7 and
expire after two releases, and that every finding from every source becomes a
permanent test rather than a fixed line of code.

---

## 11. References

1. OWASP. *OWASP Top 10:2025*. <https://owasp.org/Top10/2025/>
2. OWASP. *OWASP Top Ten Project*. <https://owasp.org/www-project-top-ten/>
3. OWASP. *Application Security Verification Standard (ASVS) 5.0.0*, May 2025. <https://owasp.org/www-project-application-security-verification-standard/> and <https://asvs.dev/>
4. OWASP. *Web Security Testing Guide*. <https://owasp.org/www-project-web-security-testing-guide/>
5. OWASP. *ZAP Automation Framework*. <https://www.zaproxy.org/docs/automate/automation-framework/>
6. OWASP. *Cheat Sheet Series* — Cross-Site Request Forgery Prevention, Cross-Site Scripting Prevention, Password Storage, Session Management. <https://cheatsheetseries.owasp.org/>
7. Cloudflare. *Scans and penetration testing*. <https://developers.cloudflare.com/fundamentals/reference/scans-penetration/>
8. Cloudflare. *Rate limiting — Workers runtime API bindings*, generally available since September 2025. <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/>
9. Cloudflare. *Secrets — Workers configuration*. <https://developers.cloudflare.com/workers/configuration/secrets/>
10. Cloudflare. *Cloudflare Access — validating JSON Web Tokens*. <https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json-web-tokens/>
11. W3C. *Web Authentication: An API for accessing Public Key Credentials, Level 3*. <https://www.w3.org/TR/webauthn-3/>
12. NIST. *SP 800-63B, Digital Identity Guidelines: Authentication and Lifecycle Management*. <https://pages.nist.gov/800-63-3/sp800-63b.html>
13. Semgrep. *Rule registry — OWASP Top Ten ruleset*. <https://semgrep.dev/p/owasp-top-ten>
14. GitHub. *CodeQL for JavaScript and TypeScript*. <https://codeql.github.com/docs/codeql-language-guides/codeql-for-javascript/>
15. Gitleaks. *Secret scanning*. <https://github.com/gitleaks/gitleaks>
16. MDN Web Docs. *HTTP headers — Content-Security-Policy, Strict-Transport-Security, Set-Cookie*. <https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers>

## Related project documents

- [`security-baseline-2026-09.md`](security-baseline-2026-09.md) — current state and finding backlog
- [`../SECURITY.md`](../SECURITY.md) — vulnerability reporting policy
- [`../TEST_INFRA.md`](../TEST_INFRA.md) — the functional test harness this suite extends
- `wiki/concepts/security-testing.md` — threat model and architectural context
