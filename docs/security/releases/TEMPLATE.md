---
release: <version>
commit: <sha>
date: <YYYY-MM-DD>
signed_off_by: <name>
reviewer_g7: <name — must not be the author of the changes>
---

# Security Sign-Off — <version>

Completed per [`../../security-testing-process.md`](../../security-testing-process.md).
A release is not signed off until this record is committed.

## Gate results

| Gate | Name | Result | Evidence |
|---|---|---|---|
| G0 | Threat model currency | Pass / Fail | link to wiki diff |
| G1 | Secrets and configuration hygiene | Pass / Fail | CI job link |
| G2 | Dependency and supply chain | Pass / Fail | CI job link |
| G3 | Static analysis | Pass / Fail | CI job link |
| G4 | Security regression suite | Pass / Fail | CI job link |
| G5 | Deployed configuration verification (staging) | Pass / Fail | job link |
| G6 | Authenticated dynamic scan | Pass / Fail | ZAP report artefact |
| G7 | Manual security review | Pass / Fail | notes below |
| G8 | Production post-deploy verification | Pass / Fail | job link |

A gate that could not be run is a **Fail**, not a skip. Record why below.

## Findings this release

| ID | Severity | Summary | Disposition |
|---|---|---|---|
| | | | Fixed in `<sha>` / Accepted until `<date>` / Deferred to `<release>` |

No Critical or High may be left unresolved. Mediums and Lows need an owner and
a target release.

## Suppressions and acceptances added

| Item | Type | Justification | Expires |
|---|---|---|---|
| | Scanner suppression / lint disable / risk acceptance | | after 2 releases |

## G7 manual review notes

**Diff reviewed**: `<base>..<head>`, by `<reviewer>`.

**New trust boundaries, identity sources, inputs, routes or dependencies**:

**Business-logic abuse cases tested** (see process section 5, gate G7):

**Configuration reviewed**: Cloudflare Access policies and their enforcement
on both hostnames, WAF and rate limiting rules, D1 binding separation, API
token scope, GitHub Actions secrets and environment protection, branch
protection on `main`.

## New `SEC-*` cases added

Every finding from any gate this release becomes a permanent test. List them:

## Declared limitations that applied

Which of the limitations in process section 3 were in force for this release,
and what compensated for each.

## Migration rollback path

D1 migrations apply **before** the Worker is uploaded, so `wrangler rollback`
does not revert the schema. If this release contains a destructive migration,
document its rollback path here, prepared in advance.
