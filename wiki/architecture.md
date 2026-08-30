---
id: ADR-PROJ-2AB3391E
type: architecture
title: Architecture & Key Decisions
source: orch-2026-08-30
project_id: PROJ-2AB3391E
created: '2026-08-30'
updated: '2026-08-30'
tags:
- adr
- architecture
---

# Architecture Decision Record — TripleT-Rocketry

## Overview

TripleT-Rocketry follows the TripleT-Forge pattern: a wiki is the source of
truth, a small `app/` package holds runnable tools, and the GitHub repo is
the durable home. Every artifact is committed as its own commit so the
history is reviewable.

## Key Decisions

- **ADR-001 — Wiki as source of truth.** Domain knowledge lives in `wiki/*.md`
  with frontmatter (id / type / project_id / source / tags). Tools read the
  wiki rather than embedding hard-coded assumptions.
- **ADR-002 — Tooling in `app/` only.** Runnable Python lives under `app/` as
  small, single-purpose modules. No web framework, no global state. Stdlib
  preferred; pure-python deps only.
- **ADR-003 — Per-piece commits.** Each wiki file or tool module is its own
  commit with a focused message. Easier to bisect and roll back.
- **ADR-004 — Branch-local experimentation.** Future iterative work goes on a
  named branch (`apprentice/<dlg8>/<node>`) per the W1 worktree convention.
  Master is for accepted content only.
- **ADR-005 — External integrations as `domains`.** Anything that talks to
  the outside world (launch APIs, telemetry, weather) gets a domain entry in
  `domains.md` with its scope, expected I/O, and risk surface.

## Boundaries

- `wiki/` — markdown, frontmatter, no executable code.
- `app/` — small Python modules, one purpose each.
- `wiki/queries/` — recipes (operator queries) for common tasks; read-only.

## Open Questions

- ADR-006 — Where do test fixtures live? (`tests/fixtures/` next to `app/`?)
  To be decided once the first test is needed.
- ADR-007 — Do we adopt any external launch-data schema (e.g. RASAero CSV,
  OpenRocket XML) or define our own? Depends on first real motor.