---
id: ANCH-wp0_operator_clear_stale_worktree_dlg_a70b
type: anchor
title: wp0_operator_clear_stale_worktree_dlg_a70b
source: forge
project_id: PROJ-075AA139
created: '2026-09-01'
updated: '2026-09-01'
tags:
- anchor
---

BLOCKED 2026-08-27 DLG-A70B7445B2FB/T-1: only add_fact works. write_file, apply_diff, list_project_files, grep, anvil, git_diff, discover_tools, send/receive_message, read_node_output, check_github_repo_exists all fail: git worktree add failed because path projects/.forge/node-worktrees/DLG-A70B7445B2FB/T-1 already exists (branch apprentice/DLG-A70B/node-T-1). Operator must: git worktree remove --force that path or rm -rf then git worktree prune; delete stale branch apprentice/DLG-A70B/node-T-1; re-dispatch WP0 Coder. No fake origin. Scaffold not written this session.
