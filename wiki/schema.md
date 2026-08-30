---
id: SCH-PROJ-2AB3391E
type: schema
title: Schema & Conventions
source: forge
project_id: PROJ-2AB3391E
created: '2026-08-30'
updated: '2026-08-30'
tags:
- schema
---

This project's wiki follows the **Karpathy Project Wiki** pattern (an
auto-maintained knowledge base) layered with Forge's per-row frontmatter for
ledger-row identity tracking.

## Layout

```
wiki/
├── index.md      # Catalog of pages (auto-regenerated)
├── log.md        # Append-only chronological log of every wiki operation
├── schema.md     # This file
├── overview.md   # Architecture, tech stack, key decisions
├── issues.md     # Issue inbox / quality findings
├── concepts/     # Pattern pages (one per cross-cutting concern)
├── entities/     # Component pages (one per service, module, API)
└── queries/      # Filed answers to non-trivial architecture questions
```

## Frontmatter schema

Every `.md` page in `wiki/` (and the project's anchor / fact rows) carries YAML
frontmatter. Required fields:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable row id, e.g. `OVR-PROJ-CF0988FC`, `ENT-user-service` |
| `type` | enum | One of: `index`, `overview`, `schema`, `log`, `issue`, `concept`, `entity`, `anchor`, `fact` |
| `title` | string | Human-readable page title |
| `source` | enum | `forge` (machine-written), `human`, or `external` |
| `project_id` | string | Owning project, e.g. `PROJ-CF0988FC` |
| `created` | date | ISO 8601 (`YYYY-MM-DD`) |
| `updated` | date | ISO 8601 (`YYYY-MM-DD`) |

Optional fields:

| Field | Type | Notes |
|---|---|---|
| `tags` | list[str] | Free-form labels |
| `related_files` | list[str] | Source paths the page documents (e.g. `src/services/user.ts`) |

## Conventions

- **Cross-references** use `[[wikilinks]]` between wiki pages.
- **Source citations** use the `path/file.py:42` format.
- **Diagrams** are inline mermaid code blocks.
- **`index.md` is regenerated automatically** — do not hand-edit it.
- **`log.md` is append-only** — never rewrite history.
- Pages with `source: forge` may be regenerated; pages with `source: human` are
  preserved across regenerations.

## Operations

- **INIT** — first-time scaffold (this directory you're reading).
- **INGEST** — runs after structural code changes; updates the relevant
  entity/concept pages and appends to `log.md`.
- **QUERY** — answers a question; if the synthesis is reusable, files it under
  `queries/`.
- **LINT** — verifies the wiki against the live codebase, flags drift.
