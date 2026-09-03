---
id: DOM-PROJ-2AB3391E
type: domains
title: Domains & Integrations
source: orch-2026-08-30
project_id: PROJ-2AB3391E
created: '2026-08-30'
updated: '2026-08-30'
tags:
- domains
- integrations
---

# Domains & Integrations

## Rocket Design (internal)

- **Airframe** — body tubes, nose cones, fins. Currently scoped to single-stage
  amateur rockets. Future: multi-stage + boosters.
- **Recovery** — parachute sizing + deployment events. Future: streamer +
  dual-deploy.
- **Propulsion** — solid motors (Estes / AeroTech class). Thrust-curve ingestion
  via `app/thrust_curve.py`.

## Tooling (internal)

- **`app/thrust_curve.py`** — parse motor data, interpolate between sample
  points, return a `(time, thrust)` series suitable for plotting or
  simulation.

## External Integrations

- **GitHub** — source of truth for wiki + code. Auth via
  `forge:cred:github` in Redis (encrypted). Used by the
  `ALLOY-GIT-0003` alloy that powers delegated commits.
- **TripleT-Forge** — the governing platform; projects are managed via the
  Forge API and the mastersmith plans delegations.
- **NASA launch data** *(planned)* — future integration to ingest historical
  launch records and atmospheric profiles.
- **Vendor APIs** *(planned)* — motor data from AeroTech / Apogee / Cesaroni.

## Risk Surfaces

- **GitHub PAT** is the single secret that lets the alloy commit. Rotate via
  `forge:cred:github` and re-issue the alloy's plan if rotated mid-delegation.
- **External launch / weather APIs** — rate-limited and may require keys;
  treat the wiki as the cache, not the live source.