---
id: ANCH-wp0_operator_action_required
type: anchor
title: wp0_operator_action_required
source: forge
project_id: PROJ-075AA139
created: '2026-09-01'
updated: '2026-09-01'
tags:
- anchor
---

Operator must: (1) git worktree remove --force projects/.forge/node-worktrees/DLG-245365605819/T-1 OR rm -rf that path then git worktree prune; (2) delete stale branch apprentice/DLG-2453/node-T-1 if it still exists; (3) re-dispatch WP0 Coder so a fresh node worktree can be created. Until then no project-tree writes are possible.
