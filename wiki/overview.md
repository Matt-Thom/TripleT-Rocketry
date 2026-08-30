---
id: OVR-PROJ-2AB3391E
type: overview
title: Overview
source: orch-2026-08-30
project_id: PROJ-2AB3391E
created: '2026-08-30'
updated: '2026-08-30'
tags:
- overview
- rocketry
---

# TripleT-Rocketry — Overview

## Purpose

TripleT-Rocketry is a model rocketry wiki and tooling project, governed by
TripleT-Forge. It captures design decisions, tooling, and integration notes
for amateur / high-power model rockets in a way that follows the
TripleT-Forge "wiki as source of truth" pattern.

## Scope

- **Rocket design documentation** — airframes, recovery, propulsion.
- **Thrust-curve tooling** — Python helpers for parsing + interpolating
  motor thrust-curve data (see `app/thrust_curve.py`).
- **Launch-data integration** — planned interface to external launch /
  range data sources (NASA, vendor APIs).

## Architecture

The project keeps its source of truth in this `wiki/` tree plus a small
`app/` package for runnable tools. Decisions live as ADRs in
`architecture.md`; domain boundaries are mapped in `domains.md`;
query-style recipes are in `queries/`.

## Status

| Subsystem | State |
|-----------|-------|
| `wiki/overview.md` | written |
| `wiki/architecture.md` | written |
| `wiki/domains.md` | written |
| `app/thrust_curve.py` | written (delegated) |
| `wiki/queries/` | scaffolded |

## Linked repository

[github.com/Matt-Thom/TripleT-Rocketry](https://github.com/Matt-Thom/TripleT-Rocketry)
— bound via `project_repositories.local_clone_path` to this working tree.