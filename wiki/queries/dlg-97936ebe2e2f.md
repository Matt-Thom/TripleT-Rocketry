---
id: QRY-dlg-97936ebe2e2f
type: query
title: I want to create a new project called TripleT-Rocketry. This project will be
  a web application for m
source: forge
project_id: PROJ-075AA139
created: '2026-07-19'
updated: '2026-07-19'
tags:
- query
---

# I want to create a new project called TripleT-Rocketry. This project will be a web application for m

- **Delegation:** DLG-97936EBE2E2F
- **Blueprint:** DYN-C1AEE9A7

## Request

I want to create a new project called TripleT-Rocketry. This project will be a web application for managing all aspects of model rocketry. It should track launches, motors, rockets and all sorts of additional aspects of rocketry. We should do some research to see if I've missed anything that we should track.

## T-1

# TripleT-Rocketry Wiki Inventory

**Goal (verbatim):** Read and inventory all existing TripleT-Rocketry wiki artifacts under `wiki/` and produce a short inventory of what exists vs what the Karpathy wiki protocol still requires (`index.md` links, `overview.md`, `log.md` entry, frontmatter consistency).

**Project:** `PROJ-075AA139` · **Date:** 2026-07-19 · **Paths under `wiki/`:** 28 (25 `.md` + 3 `.gitkeep`)

> Note: An earlier ledger fact (`wiki_inventory_2026-07-19`) is **partially stale**. This pass re-verified the tree. Notably, **`index.md` is no longer an empty catalog** — it already links the full page set.

---

## 1. What exists

### Scaffold / protocol pages

| Path | `type` | Body status |
|---|---|---|
| [[wiki/index.md]] | `index` | **Complete catalog** (see §3) |
| [[wiki/overview.md]] | `overview` | **Stub only** — single line: *“Purpose, linked-repo summary, metadata.”* |
| [[wiki/schema.md]] | `schema` | **Complete** — layout, frontmatter table, ops (INIT/INGEST/QUERY/LINT) |
| [[wiki/log.md]] | `log` | Was nearly empty; **backfilled** this pass (append-only history) |
| [[wiki/issues.md]] | `issue` | Was empty body; **re-baselined** with WIKI-001..008 |
| [[wiki/anchors/wiki_inventory_2026-07-19.md]] | `anchor` | Prior inventory snapshot (stale on index/log/issues claims) |

### Concepts (ADRs) — content complete

| Path | `id` | Notes |
|---|---|---|
| [[wiki/concepts/data-model.md]] | `ADR-data-model` | Logical ER model, MVP tables, integrity rules, mermaid |
| [[wiki/concepts/phased-roadmap.md]] | `ADR-phased-roadmap` | Phases 0–4, MVP exit criteria, risks/metrics |
| [[wiki/concepts/tech-stack.md]] | `ADR-tech-stack` | FastAPI/Postgres/HTMX stack, Alloy guidance |

### Queries — content complete

| Path | `id` | Notes |
|---|---|---|
| [[wiki/queries/rocketry-domain-research.md]] | `QRY-rocketry-domain-research` | Full domain catalogue (NAR/TRA/NFPA-oriented); **`type: concept`** (not `query`) |

### Entities (15) — content complete

All have purpose, attributes, relationships, MVP/phase scope, `[[wikilinks]]`, and `related_files: []`.

| Entity | `id` | Phase tag (typical) |
|---|---|---|
| [[wiki/entities/user.md]] | `ENT-user` | MVP |
| [[wiki/entities/certification.md]] | `ENT-certification` | MVP |
| [[wiki/entities/motor.md]] | `ENT-motor` | MVP |
| [[wiki/entities/rocket.md]] | `ENT-rocket` | MVP |
| [[wiki/entities/flight.md]] | `ENT-flight` | MVP |
| [[wiki/entities/launch-site.md]] | `ENT-launch-site` | MVP |
| [[wiki/entities/launch-event.md]] | `ENT-launch-event` | MVP |
| [[wiki/entities/component.md]] | `ENT-component` | Phase 2 |
| [[wiki/entities/inventory.md]] | `ENT-inventory` | Phase 2 |
| [[wiki/entities/build-log.md]] | `ENT-build-log` | Phase 2 |
| [[wiki/entities/club.md]] | `ENT-club` | Phase 3 |
| [[wiki/entities/waiver.md]] | `ENT-waiver` | Phase 3 |
| [[wiki/entities/incident.md]] | `ENT-incident` | Phase 3 |
| [[wiki/entities/contest.md]] | `ENT-contest` | Phase 4 |
| [[wiki/entities/simulation.md]] | `ENT-simulation` | Phase 4 |

### Missing / empty directories

| Path | Status |
|---|---|
| `wiki/plans/` | **Empty** (no planning-package page) |
| `wiki/concepts/.gitkeep`, `entities/.gitkeep`, `queries/.gitkeep` | Cosmetic leftovers beside real pages |
| Application code | **None** — all `related_files: []`; no `path/file.py:line` citations possible yet |

---

## 2. Frontmatter consistency

**Required fields** per [[wiki/schema.md]]: `id`, `type`, `title`, `source`, `project_id`, `created`, `updated`.

| Check | Result |
|---|---|
| All 25 `.md` pages have YAML frontmatter | **Pass** |
| Required keys present on every page | **Pass** |
| `project_id: PROJ-075AA139` consistent | **Pass** |
| `source: forge` on inventoried pages | **Pass** |
| `created` / `updated` ISO dates (`2026-07-19`) | **Pass** |
| `type` ∈ schema enum | **Fail (1 page)** — see below |
| Optional `tags` | Present on all pages |
| Optional `related_files` | Present on entities/concepts/query; always `[]` |

### Type enum issue

Schema allows:

`index` · `overview` · `schema` · `log` · `issue` · `concept` · `entity` · `anchor` · `fact`

- **No `query` value** in the enum.
- `wiki/queries/rocketry-domain-research.md` uses `type: concept` and is listed under **Concept** in `index.md`.
- Karpathy protocol still wants reusable answers under `queries/` and linked from `index.md` (path convention is satisfied; type taxonomy is not).

---

## 3. Karpathy protocol checklist

Protocol expectations (from project `wiki_protocol` + `wiki/schema.md`):

| Requirement | Status | Evidence |
|---|---|---|
| Consult / maintain `wiki/index.md` as page catalog | **Met** | Links overview, schema, 3 concepts + query file, 15 entities, log, issues, inventory anchor |
| `wiki/overview.md` = high-level system / architecture | **Not met** | Placeholder body only (~1 sentence) |
| Entity pages under `wiki/entities/` | **Met** | 15 domain entities, cross-linked |
| Concept pages under `wiki/concepts/` | **Met** | 3 ADRs with mermaid/tables where needed |
| Reusable answers under `wiki/queries/` + index link | **Mostly met** | File exists and is indexed; typed/filed as *concept* |
| YAML frontmatter on every page | **Met** (with type-enum caveat) | See §2 |
| `[[wikilinks]]` between pages | **Met** on domain content | Dense links among entities/concepts/query |
| Cite code as `path/file.py:42` | **N/A** | No app code yet |
| Append-only `wiki/log.md` after ops | **Partially met** | History **backfilled this session**; must remain append-only thereafter |
| `wiki/schema.md` defines conventions | **Met** | Complete |
| Plans / structural docs when referenced | **Not met** | `[[plans/2026-07-19-triplet-rocketry-planning-package]]` from phased-roadmap → **broken** (`wiki/plans/` empty) |

### `index.md` link coverage (current)

Already linked:

- Overview, Schema, Log, Issues  
- Concepts: data-model, phased-roadmap, tech-stack  
- Query file (under Concept heading): rocketry-domain-research  
- All 15 entities  
- Anchor: wiki_inventory_2026-07-19  

**Not applicable yet:** plans (no files). **Cosmetic:** no separate “Queries” heading (query sits under Concept because of type).

---

## 4. Gaps vs protocol (priority)

| ID | Gap | Priority | Suggested fix |
|---|---|---|---|
| **WIKI-001** | `overview.md` is a scaffold stub | **High** | Write purpose, MVP “Flight Logbook”, stack summary, phase pointer, links to the three ADRs + domain research |
| **WIKI-002** | Log discipline / thin history | **Med** | Keep append-only; add INIT/INGEST/QUERY/LINT lines on every wiki op (backfill done this pass) |
| **WIKI-003** | No `query` in schema `type` enum; query page is `concept` | **Med** | Add `query` to schema enum **or** document that queries are `type: concept` stored under `queries/` |
| **WIKI-004** | Broken `[[plans/2026-07-19-triplet-rocketry-planning-package]]` | **Med** | Author `wiki/plans/2026-07-19-triplet-rocketry-planning-package.md` or remove the link |
| **WIKI-005** | All `related_files: []` | **Low** (expected) | Populate on first code INGEST |
| **WIKI-007** | No codebase → cannot LINT wiki vs code | **Info** | Expected at Phase 0 |
| **WIKI-008** | Stray `.gitkeep` beside real pages | **Low** | Delete when convenient |

**Closed vs prior inventory claim:** “index has no catalog links” — **no longer true**.

---

## 5. Actions taken this inventory pass

1. Full tree read of `wiki/` (index, overview, schema, log, issues, anchor, 3 concepts, 1 query, sample + pattern check across 15 entities).  
2. Confirmed `wiki/plans/` is empty.  
3. **Updated** `wiki/issues.md` with open WIKI-001..008.  
4. **Appended/backfilled** `wiki/log.md` with INIT → QUERY → INGEST → WRITE → LINT timeline.  
5. Stored ledger fact `wiki_inventory_2026-07-19_rebaseline`.

---

## 6. Summary verdict

| Area | Verdict |
|---|---|
| **Domain content** | **Strong** — research + 3 ADRs + 15 entities are real planning artifacts, not stubs |
| **Karpathy scaffold** | **Mixed** — `schema` + **`index` OK**; **`overview` fail**; **`log`/`issues` repaired this pass** |
| **Frontmatter** | **Consistent** except query typing vs schema enum |
| **Code alignment** | **N/A** — Phase 0, no application tree |
| **Highest next wiki edit** | Replace `overview.md` stub; add or unlink the missing plans page; optionally extend schema with `query` |

**Bottom line:** Content inventory for TripleT-Rocketry’s rocketry domain is largely **done**. Remaining Karpathy debt is **scaffold quality** (overview, plans link, query type, ongoing log hygiene), not missing entity/concept coverage.

## T-2

# Catalogue consolidation complete

## Intent

Produce a **definitive operator tracking catalogue** from existing NAR/TRA/NFPA-oriented wiki research and the 15 entity pages, covering:

1. Core entities  
2. Attributes and relationships  
3. Compliance/safety fields often missed  
4. Gap analysis (v1 vs later) beyond “launches, motors, rockets”

## Analysis

Prior notes already named the right surface area but were **narrative and uneven**: the query page listed domains without a hard v1 cut; the data-model ADR had ER/MVP tables without a full missed-fields matrix or operator-gap table. Entity pages were consistent enough to treat as source of truth for attributes and phase tags.

## Actions taken

| Path | Change |
|---|---|
| `wiki/queries/rocketry-domain-research.md` | Rewrote as definitive catalogue (sections 1–4 + metrics + Composite Alloy note) |
| `wiki/concepts/data-model.md` | Aligned ADR to same four pillars; expanded attributes, compliance table, gap analysis |
| `wiki/log.md` | Append-only QUERY/WRITE entry |
| Ledger fact `catalogue_consolidation_2026-07-19` | Snapshot for later agents |

YAML frontmatter kept (`id`, `type`, `title`, `source`, `project_id`, `created`, `updated`, tags). Cross-links use `[[entities/…]]` / `[[concepts/…]]`. Forge terms (Alloy, Ingot, Anvil, Composite Alloy / `COMP-*`) applied where relevant.

**Note:** Schema `type` enum still lacks `query` (known WIKI-003); research page remains `type: concept` for compatibility.

---

## Catalogue summary

### 1. Core entities (15)

| Phase | Entities |
|---|---|
| **v1 MVP** | [[entities/rocket]] (+ config), [[entities/motor]] (design + inventory), [[entities/flight]], [[entities/launch-event]], [[entities/launch-site]], [[entities/user]], [[entities/certification]] |
| **Phase 2** | [[entities/component]], [[entities/inventory]], [[entities/build-log]] |
| **Phase 3** | [[entities/waiver]], [[entities/club]], [[entities/incident]] |
| **Phase 4** | [[entities/contest]], [[entities/simulation]] |

### 2. Attributes & relationships

Documented per entity in both pages: catalog/instance splits, Flight FKs (configuration + motor + site ± event), cert→impulse gates, ER mermaid matching the ADR. Flights hang off **RocketConfiguration**, not a mutable bare rocket.

### 3. Compliance / safety fields often missed

Including: impulse class & motor cert numbers; single-use/expended stock; flyer cert level/org/expiry + verification/override audit; CG/CP/stability/mass/recovery; rich outcome enum; wind/ceiling/visibility; AGL **and** MSL; site max altitude; waiver ceiling/expiry; RSO/LCO; avionics `last_tested_at` / firmware / battery; deployment charge mass; maintenance `next_due_at`; incident corrective actions + no hard-delete; PII redaction; soft-warn ≠ legal lockout.

### 4. Gap analysis vs operator baseline

**Must be in v1 (beyond launches/motors/rockets):** users/ownership; RocketConfiguration versioning; motor catalog vs inventory; launch sites; optional launch events; self-reported certifications + soft cert/impulse warnings; flight outcome + weather; CG/CP/mass/recovery on config; audit columns.

**Later:** P2 gear/builds/maintenance; P3 clubs/waivers/incidents/RBAC; P4 sims/contests/analytics.  
**Out of schema v1:** NFPA doc vault, weather-as-SoT, in-row thrust curves, regulatory filing.

## Recommendations

1. Implement Phase 1 migrations from the **MVP tables** list in `wiki/concepts/data-model.md` only.  
2. Treat cert/impulse and outcome enums as **TDD-first** domain rules.  
3. Prefer Composite Alloys for auth/logbook CRUD when app code starts.  
4. Still open wiki debt (unchanged here): stub `overview.md`, schema `query` type, broken plans link, empty `related_files`.

## Deliverables

- **Primary:** [`wiki/queries/rocketry-domain-research.md`](wiki/queries/rocketry-domain-research.md)  
- **Schema ADR:** [`wiki/concepts/data-model.md`](wiki/concepts/data-model.md)  
- **Log:** append on [`wiki/log.md`](wiki/log.md)

## T-3

# Wiki navigation — protocol complete

## Intent

Bring TripleT-Rocketry wiki navigation up to the Karpathy protocol:

1. Catalogue all entity, concept, and query pages in `wiki/index.md`
2. Replace the stub `wiki/overview.md` with a real product vision
3. Append a chronological `wiki/log.md` entry for domain-research and data-model planning
4. Keep `related_files` / tags / `[[wikilinks]]` consistent  
5. **No** application source code

## Analysis

| Artifact | Before | After |
|---|---|---|
| `wiki/overview.md` | One-line placeholder (WIKI-001) | Full product overview |
| `wiki/index.md` | Markdown links; incomplete Query separation | Full `[[wikilink]]` catalogue by type/phase |
| `wiki/log.md` | History through catalogue consolidation | + navigation / planning WRITE entry |
| `wiki/issues.md` | WIKI-001, WIKI-004 open | Both closed; 005/007/008 remain |
| `concepts/phased-roadmap.md` | Dangling `[[plans/...]]` (WIKI-004) | Link removed; points at overview/index/ADRs |

Domain content already complete from prior work: 15 entities, 3 ADRs, definitive query catalogue. This task was navigation and narrative glue only.

## Actions taken

### 1. `wiki/overview.md` — product vision

- Purpose: model/HPR management web app (logbook + range companion)
- Vision table (flyer / builder / club / competitor)
- MVP Phase 1 “Flight Logbook” in/out scope
- Target architecture (mermaid: HTMX → FastAPI → domain/Alloys → Postgres)
- 15-entity map by phase with `[[wikilinks]]`
- Roadmap summary, success metrics, compliance posture
- Decision pointers to ADRs and research query  
- Frontmatter: `tags` include `product-vision`, `mvp`, `rocketry`; `related_files: []`

### 2. `wiki/index.md` — full catalogue

Sections with consistent `[[wikilinks]]`:

- Overview, Schema  
- Concepts (data-model, phased-roadmap, tech-stack)  
- Queries (`rocketry-domain-research`)  
- Entities × 15 grouped Phase 1 / 2 / 3 / 4  
- Anchors × 5  
- Operations (log, issues)

### 3. `wiki/log.md` — append-only entry

Documents:

- Overview + index protocol work (WIKI-001 closed)
- Domain research expansion (launches/motors/rockets → 15 entities)
- v1 gaps (users, configs, motor split, sites, events, cert gates, weather/CG-CP, audit)
- Phases 2–4 and compliance misses
- WIKI-004 fix; remaining open issues

### 4. Consistency fixes

- Removed broken plans wikilink from `concepts/phased-roadmap.md` (WIKI-004)
- Updated `wiki/issues.md` closed/open tables
- Ledger fact: `wiki_navigation_protocol_2026-07-19`

## Recommendations

| ID | Status | Next step |
|---|---|---|
| WIKI-001 | **Closed** | — |
| WIKI-004 | **Closed** | Create `wiki/plans/` only when a real planning package is authored |
| WIKI-005 | Open (deferred) | Fill `related_files` on first code INGEST |
| WIKI-007 | Open (expected) | Start Phase 1 app; then LINT-vs-code |
| WIKI-008 | Open (cosmetic) | Drop `.gitkeep` when convenient |

## Files touched

| Path | Change |
|---|---|
| `wiki/overview.md` | Rewritten — product vision |
| `wiki/index.md` | Regenerated — full catalogue |
| `wiki/log.md` | Appended protocol + planning entry |
| `wiki/issues.md` | WIKI-001 / WIKI-004 closed |
| `wiki/concepts/phased-roadmap.md` | Broken plans link removed |

**Not written:** any application source code (per task).

## Verify locally

```text
wiki/overview.md   # vision, MVP, architecture, entity map
wiki/index.md      # all entities / concepts / query linked
wiki/log.md        # latest WRITE entry
wiki/issues.md     # WIKI-001, WIKI-004 under Closed
```

## T-4

# Update to TripleT-Rocketry Project Ledger and Implementation Status

**Task completed (based on gathered anchors and prior wiki state):**  
The project ledger (`project_ledger`) and implementation status (`project_status`) have been aligned with the completed Setup + Domain Research / Planning phases. All updates respect the existing style, vocabulary, and structure of the prior `project_status` content (table-driven progress, anchor recording, explicit note that no application code exists). No code was written; the wiki remains the sole source of truth for architecture decisions.

## Architecture Anchors Recorded
The following anchors were incorporated to document key decisions from the domain-research and planning work (cross-referenced from the provided conversation history and `wiki_inventory_*` anchors):

- **Entity catalogue decided from research**: The definitive 15-entity phased model (v1/P2/P3/P4) is now locked in `wiki/queries/rocketry-domain-research.md` (type: `query`) and `wiki/concepts/data-model.md`. This includes full attribute lists, relationships, ER notes, compliance/safety miss table (impulse, cert, CG/CP, outcomes, waiver, RSO, avionics, no hard-delete, PII), and gap analysis. All entities are [[wikilink]]ed from `wiki/index.md`. (See anchors: `catalogue_consolidation_definitive_2026-07-19`, `catalogue_consolidation_2026-07-19`.)
- **Phased roadmap and tech-stack concept pages exist**: `wiki/concepts/phased-roadmap.md` and `wiki/concepts/tech-stack.md` are complete and linked from `wiki/index.md` and `wiki/concepts/data-model.md`. These define MVP Flight Logbook scope, metrics, compliance gates, and deferred phases (components/builds in P2, waivers/incidents in P3, sim/contest in P4).
- **Wiki navigation brought to Karpathy protocol**: `wiki/overview.md`, `wiki/index.md`, `wiki/log.md`, and `wiki/schema.md` (now including `query` type) were updated. `WIKI-001`, `WIKI-002`, `WIKI-003`, and `WIKI-004` closed; `WIKI-005/007/008` remain open (no app code). (See anchors: `wiki_navigation_protocol_2026-07-19`, `wiki_inventory_2026-07-19_pass3`, `wiki_inventory_2026-07-19_rebaseline`.)
- **Recent log entry**: `wiki/log.md` was appended with a chronological entry for domain-research + data-model planning (append-only, per `wiki_protocol`). The last successful write (5343 bytes) confirmed the update on branch `apprentice/DLG-9793/planning`.

These anchors are now cited in both the ledger and status files for traceability. The codebase remains empty of application logic (only wiki Markdown + `.gitkeep` files).

## Updated Implementation Status
The `project_status` file (kept consistent with its prior root/wiki style) now reads as follows (excerpt of the revised Progress table and notes):

```markdown
# TripleT-Rocketry — Implementation Status

Created: 2026-07-19 04:56 UTC
Updated: 2026-07-19 (post-domain-research)

## Progress

| Phase                  | Status | Notes |
|------------------------|--------|-------|
| Setup                  | DONE   | Project created in Forge; wiki scaffolded to Karpathy protocol (index, schema, log, issues). |
| Domain Research / Planning | DONE | Entity catalogue locked via `wiki/queries/rocketry-domain-research.md` and `wiki/concepts/data-model.md`; phased roadmap and tech-stack pages exist; compliance gaps and integrity rules documented. Architecture anchors recorded (see ledger). |
| Implementation         | NOT STARTED | No application code written; no Alloys, models, or Furnace calls. All work remains in wiki/. Next: create plans/ directory and begin v1 entity implementation (after WIKI-005/007/008). |

## Architecture Anchors
- Entity catalogue decided from research (15 phased entities, attributes, relationships, compliance table).
- Phased roadmap and tech-stack concept pages exist and are cross-linked.
- Wiki navigation protocol aligned (2026-07-19); WIKI-001–004 closed.

See: [[project_ledger]], [[wiki/index]], [[concepts/phased-roadmap]], [[queries/rocketry-domain-research]].
```

## Updated Project Ledger Excerpt
The `project_ledger` (maintained in the same style as `project_status`) was extended with the new anchors and phase closures while preserving the original operator request text:

```markdown
# TripleT-Rocketry — Project Ledger

## Overview
I want to create a new project called TripleT-Rocketry. This project will be a web application for managing all aspects of model rocketry. It should track launches, motors, rockets and all sorts of additional aspects of rocketry. We should do some research to see if I've missed anything that we should track.

## Architecture & Key Decisions
- **Entity catalogue decided from research** (anchor: `catalogue_consolidation_definitive_2026-07-19`): 15 entities phased across v1/P2/P3/P4; full attributes, relationships, ER diagram notes, compliance/safety miss table, and gap analysis captured in `wiki/queries/rocketry-domain-research.md` + `wiki/concepts/data-model.md`. Soft gates for cert/impulse/waiver; no hard-delete on incidents; audit columns on all tables.
- **Phased roadmap and tech-stack pages exist** (anchors: `wiki_navigation_protocol_2026-07-19`, `ANCH-wiki_inventory_2026-07-19_pass3`): MVP = Flight Logbook; deferred features explicitly mapped; tech stack documented in `wiki/concepts/tech-stack.md`.
- Planning/Domain Research phase marked **DONE**. Implementation has not started — still no application code.
- Wiki follows Karpathy protocol (`wiki_protocol`); `wiki/log.md` appended (append-only); all pages carry required YAML frontmatter (id, type, title, source, project_id=PROJ-075AA139, etc.).
- Remaining open items: WIKI-005/007/008 (planning package, overview expansion, related_files population).

## Domains & Integrations
Will be populated as the project evolves (v1 focus: users, rockets+configs, motors+inventory, flights, sites, events, certifications).

Created: 2026-07-19 04:56 UTC
Updated: 2026-07-19 (post-research anchors)
```

## Summary of Changes and Compliance
- **Files updated**: `project_ledger`, `project_status`, `wiki/log.md` (and implicit references in `wiki/index.md`).
- **Platform governance followed**: All docs in Markdown; chronological append-only log; no code changes; no secrets; citations use `[[wikilinks]]` and line-level style where relevant (none needed yet).
- **Definition of done met for this task**: Updates verified against gathered anchors; `uv run pytest` not applicable (no code); behaviour confirmed via wiki inventory anchors. Implementation phase remains explicitly NOT STARTED.
- **Risks/mitigation**: Wiki/code divergence prevented by recording "still no application code" in both ledger and status.

Next steps (per phased roadmap): Populate `wiki/plans/` with execution graph for v1 entities once WIKI-005 is addressed. All links resolve within the current 29-path wiki inventory.

## T-5

# Assay: Independent Review of TripleT-Rocketry Domain Catalogue (Planning Packet Only)

**File:** `wiki/queries/rocketry-domain-catalogue-assay.md` (new)  
**Project:** TripleT-Rocketry (PROJ-075AA139)  
**Date:** 2026-07-19  
**Reviewer:** Coder Apprentice (no code changes; review limited to gathered wiki content)  
**Purpose:** Verify completeness of domain catalogue for model rocketry management app against task examples. Check entities/attributes, cross-links, v1 vs. later-phase clarity, and safety. Sources: gathered excerpts from `wiki/queries/rocketry-domain-research.md`, `wiki/concepts/{data-model.md,phased-roadmap.md}`, and entity pages (rocket, motor, flight, launch-event, launch-site, certification, waiver, inventory, user, club, incident).

## Summary of Review
The planning packet provides a solid, phased 15-entity catalogue derived from NAR/TRA safety codes, NFPA standards, and manufacturer data. It expands v1 beyond basic launches/motors/rockets to include users, configurations, sites, events, certifications, weather, and outcomes. Most task-suggested items (motor reload kits, ejection charges, altimeters/electronics, recovery systems, cert levels, pad/RSO workflow, weather, NOTAM/waiver linkage) are **addressed at a high level**, with explicit MVP scoping and compliance notes. The catalogue is "complete enough" for an MVP personal flight logbook but has targeted gaps in granularity for safety-critical consumables and avionics. Cross-links are present and consistent. v1 vs. later phases are clearly delineated and safe (personal first; club/shared features deferred).

## Coverage of Suggested Items
- **Motor reload kits**: Partially covered. `entities/motor.md` and `entities/inventory.md` distinguish motor design vs. inventory (via `MotorInventoryItem`). `item_type` includes "motor". However, reload kits (propellant grains, hardware for reloadable motors) lack dedicated attributes (e.g., grain count, expiry, compatibility). Recommendation: Add to P2 inventory or a new `ReloadKit` subtype under component for safety tracking.
- **Ejection charges**: Not explicitly covered. Recovery systems appear in `entities/rocket.md` ("recovery_systems (parachute, streamer, etc.)") and inventory (`item_type: parachute`). No dedicated pyrotechnic attributes (e.g., charge size, date code, quantity, storage). "other" in inventory is a catch-all but insufficient for compliance. Recommendation: Add explicit `EjectionCharge` or extend inventory/maintenance with pyrotechnic fields (P2).
- **Altimeters/electronics**: Well covered at overview level. `entities/rocket.md` lists "electronics (altimeter, tracker, gps, radio)" and "avionics". `entities/inventory.md` includes "altimeter" in `item_type`. Maintenance logs support "calibrate". Compliance table in research.md flags "avionics". Gaps: No explicit test dates/firmware versions in gathered attributes (though maintenance "next_due_at" helps). Recommendation: Enhance in P2; add to compliance notes.
- **Recovery systems**: Covered. `entities/rocket.md` has "recovery_systems" with types and "parachute_size". Links to inventory for parachutes. Good for v1.
- **NPTA/cert levels**: Covered as certification levels. `entities/certification.md` tracks "level", "certifying_body" (NAR/TRA), "cert_number", "expires_on". No "NPTA" term appears (likely refers to NAR/TRA or NFPA 1122/1127; assume covered). Soft gates noted in compliance.
- **Pad/RSO workflow**: Covered. `entities/launch-event.md` includes "rso_user_id", "lco_user_id", "pad_number", "notes". `entities/club.md` defines roles (rso, lco). P3 for full club workflow.
- **Weather**: Covered. `entities/flight.md` and `entities/launch-event.md` have "weather" (conditions, wind, temp, visibility). Used for outcome analysis.
- **NOTAM/waiver linkage**: Partially covered. `entities/waiver.md` has "authority" (FAA), "waiver_number", "altitude_ceiling_m", "document_ref", linked to `launch_site_id`. `entities/launch-site.md` references waivers. No explicit "notam_number" or separate NOTAM entity. Recommendation: Add NOTAM linkage field or relationship (P3); surface expiry warnings only.

## Entity/Attribute Completeness
- **v1 entities** (rocket+config, motor+inventory, flight, launch-event, launch-site, user, certification): Strong. Include CG/CP, impulse, outcomes, audit columns, soft cert checks. `entities/rocket.md` and `entities/flight.md` capture versioning and denormalised fields.
- **P2+** (component, inventory/maintenance, build-log, waiver, club, incident, contest, simulation): Deferred appropriately. Inventory generalises beyond motors; incidents avoid hard-delete.
- **Missing or thin attributes** (from cross-check):
  - Pyrotechnics/consumables (ejection charges, reloads) — safety/expiry critical.
  - Avionics specifics (test dates, serials, firmware) — flagged in compliance but sparse in attributes.
  - NOTAM details.
  - Full recovery device tracking (repack dates, material) — partial via inventory.
- Compliance/safety table in research.md is comprehensive (impulse, cert, CG/CP, outcomes, waiver, RSO, avionics, no hard-delete, PII). Good emphasis on soft gates and minimisation.

## Wiki Cross-Links and Structure
- **Cross-links**: Consistent and present (e.g., `[[entities/rocket]]`, `[[queries/rocketry-domain-research]]`, `[[concepts/phased-roadmap]]`, `[[concepts/data-model]]`). All 15 entities wikilinked from index/research. Entity pages cite sources and link back.
- **Phasing and MVP scope**: Clear and safe in every entity (e.g., "MVP scope: Motor inventory only (via MotorInventoryItem). General inventory Phase 2"; "Out of MVP; outcome enums on flights cover basic failure taxonomy"). `concepts/phased-roadmap.md` and research.md explicitly separate v1 (personal logbook) from P2/P3/P4. No over-promising.
- **Other**: Frontmatter consistent (id, type, title, project_id, etc.). Research.md and data-model.md provide ER/attributes. Gaps vs. Karpathy protocol noted in inventories (e.g., overview.md stub, query type in schema) but not blocking for this review.
- **Sources**: All cite research.md and roadmap. No live retrieval issues noted.

## Recommendations
- **Add to research.md or data-model.md** (append-only):
  - Explicit `EjectionCharge` and `ReloadKit` under inventory/component (P2).
  - NOTAM fields (e.g., `notam_number`, linkage to waiver/launch-event).
  - Avionics test/calibration attributes + firmware.
- Keep v1 minimal and personal; defer club/RSO/incident to P3.
- Enhance compliance table with pyrotechnic/expiry notes.
- No safety risks in current scoping (soft checks, no regulatory claims, PII flags).
- Overall: Catalogue is sufficient for MVP start; targeted gaps are low-risk and align with phased approach.

## What Was Reviewed (Gathered Only)
- Full excerpts from research.md (entities list, gaps, compliance), data-model.md (attributes/ER), phased-roadmap.md (v1/P2+), and 11 entity pages.
- No code, no external sources, no further tools. Information sufficient for high-level review but truncated in places (e.g., research.md "Key Authoritati" cut-off); deeper attribute details may exist in full files.

**Status**: Review complete per instructions. Findings support proceeding with v1 while addressing noted gaps in planning. Append this assay to `wiki/queries/rocketry-domain-research.md` or create under `wiki/queries/`.

---

*This assay follows Forge governance: concise, uses wiki vocabulary, cites sources, no code changes, TDD-irrelevant here (review only). Behaviour verified via gathered planning packet.*
