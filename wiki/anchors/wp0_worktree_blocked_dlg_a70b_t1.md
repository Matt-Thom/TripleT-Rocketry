---
id: ANCH-wp0_worktree_blocked_dlg_a70b_t1
type: anchor
title: wp0_worktree_blocked_dlg_a70b_t1
source: forge
project_id: PROJ-075AA139
created: '2026-09-01'
updated: '2026-09-01'
tags:
- anchor
---

BLOCKED 2026-08-27 DLG-A70B7445B2FB/T-1: write_file, apply_diff, list_project_files, read_file, grep, anvil, discover_tools, write_agent_note all fail with: git worktree add failed because path projects/.forge/node-worktrees/DLG-A70B7445B2FB/T-1 already exists (branch apprentice/DLG-A70B/node-T-1). add_fact works. Task forbids aborting on missing stale path, but platform still requires worktree for all tree writes. Operator must: git worktree remove --force that path or rm -rf then git worktree prune; delete stale branch apprentice/DLG-A70B/node-T-1; re-dispatch WP0 Coder.
