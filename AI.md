# TripleT-Rocketry — AI Collaboration Guide

> Read this every session before touching code or docs.

This project's `wiki/` follows the **Karpathy Project Wiki** pattern. The wiki is
the single source of truth for architecture, decisions, and operational history.

## Session startup checklist

1. Read `wiki/index.md` — find the page(s) relevant to your task
2. Read `wiki/overview.md` — architecture and tech stack
3. Read the specific entity/concept pages your work touches
4. After you make structural code changes, update the relevant wiki pages and
   append an entry to `wiki/log.md`

## Wiki layout

```
wiki/
├── index.md     # Catalog of every page (regenerated; do not hand-edit)
├── log.md       # Append-only chronological record of wiki operations
├── schema.md    # Frontmatter and authoring conventions
├── overview.md  # Architecture overview, tech stack, key decisions
├── concepts/    # Pattern pages (auth-flow, error-handling, deployment, …)
├── entities/    # Component pages (one per service / module / API)
├── queries/     # Filed query results worth keeping
└── issues.md    # Issue inbox (quality findings, blocked-sync notices)
```

## Rules

- **Source code is the source of truth.** Wiki documents code; never contradicts it.
- **YAML frontmatter is required** on every page. See `wiki/schema.md` for the schema.
- **Cite source code** as `path/file.py:42` (file:line format).
- **Cross-link wiki pages** with `[[wikilinks]]`.
- **Use mermaid** for architecture and flow diagrams.
- **Skip trivial changes** — don't pollute the wiki with formatting or typo fixes.
- **Every wiki write updates `index.md` and appends to `log.md`.**

When the wiki and code disagree, the code wins — update the wiki.
