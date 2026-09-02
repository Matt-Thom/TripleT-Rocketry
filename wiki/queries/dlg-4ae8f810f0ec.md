---
id: QRY-dlg-4ae8f810f0ec
type: query
title: what is the purpose of this project ?
source: forge
project_id: PROJ-075AA139
created: '2026-08-17'
updated: '2026-08-17'
tags:
- query
---

# what is the purpose of this project ?

- **Delegation:** DLG-4AE8F810F0EC
- **Blueprint:** DYN-AE1A1F40

## Request

what is the purpose of this project ?

## T-1

# TripleT-Rocketry purpose (PROJ-075AA139)

Read-only inspection only. No files were written, edited, committed, or appended. No alloys or web research were used.

## 1. Purpose

TripleT-Rocketry is a personal-to-club-scale web application for managing model and high-power rocketry. The founding request is a logbook that tracks launches, motors, rockets, and related rocketry work. Planning later named the MVP **Flight Logbook + Range Companion**: flyers log user-owned rockets and configurations, motor catalog plus inventory, flights (CG/CP, impulse gates, soft certification checks, weather, outcomes), launch sites/events, and basic NAR/TRA certifications. Soft safety warnings only — no regulatory filing engine. Later phases add components/builds, clubs/waivers/incidents, then simulations/contests. Application code is not started; the wiki is the planning source of truth.

## 2. What the app is meant to track / manage

**MVP (Phase 1 — Flight Logbook)**

- Users / ownership
- Rockets and versioned `RocketConfiguration` (CG/CP, mass, recovery)
- Motors: catalog (impulse class, cert) vs inventory
- Flights / launches (outcome, weather, altitude)
- Launch sites and launch events (RSO/LCO)
- Self-reported certifications with soft cert/impulse gates

**Later phases**

- Phase 2: components, general inventory/maintenance, build logs
- Phase 3: clubs, waivers, incidents (no hard-delete)
- Phase 4: contests, simulations

## 3. Sources used

| File | Role |
|---|---|
| `README.md` | Name only; no product goal |
| `AI.md` | Wiki-as-source-of-truth protocol; no product goal |
| `CLAUDE.md` | Pointer to `AI.md` / `wiki/index.md` |
| `wiki/index.md` | Catalog; links overview only (no entity/concept pages on disk) |
| `wiki/overview.md` | **Stub** — “Purpose, linked-repo summary, metadata.” |
| `wiki/queries/dlg-abf59861a253.md` | Original operator request + planning package (vision, MVP, 15-entity catalogue) |
| `wiki/queries/dlg-97936ebe2e2f.md` | Inventory + locked 15-entity phased catalogue |

Also listed (no extra product-goal text): `wiki/schema.md`, `wiki/log.md`, `wiki/issues.md`. `wiki/concepts/` and `wiki/entities/` contain only `.gitkeep`. Claimed pages such as `wiki/queries/rocketry-domain-research.md` and `wiki/concepts/{data-model,phased-roadmap,tech-stack}.md` are **not in the current tree**; their content is preserved only inside the two query files above.
