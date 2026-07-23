# Agent notes

Apprentice-authored lessons, gotchas and decisions for this project.
Operators may edit freely — agents only ever append.

## [2026-07-23T09:01Z] gotcha — code_quality (delegation DLG-4297)

GitHub init (DLG-4297421D5B98): Local repo already initialised on master (tip 1da3e9a07f06cfa8710a5021e02da9c9f55a36a0). No origin remote in .git/config. Push/create requires run_shell_in_anvil + network + FORGE_SECRET_GIT_* credentials — shell tool was not authorized for this run. Re-dispatch with shell authorized (and credentials present) to complete origin add + gh repo create + push -u origin master.

## [2026-07-23T09:02Z] gotcha — code_quality (delegation DLG-4297)

GitHub init still blocked (DLG-4297421D5B98). Inspected via read_file on .git/* (shell Anvil down: Docker not available). master@3e1e4a0d; no [remote "origin"] in .git/config. discover_tools: no gh/push/github-write; only http_get + git_blame/commit/diff/log. Cannot create GitHub repo or push without operator enabling Anvil+network+FORGE_SECRET_GIT_* or a platform push tool. Do not force-reinit .git.

## [2026-07-23T09:04Z] gotcha — code_quality (delegation DLG-4297)

GitHub init still blocked (DLG-4297421D5B98). Inspected via read_file on .git/* (shell Anvil down: Docker not available). master@3e1e4a0d; no [remote "origin"] in .git/config. discover_tools: no gh/push/github-write; only http_get + git_blame/commit/diff/log. Cannot create GitHub repo or push without operator enabling Anvil+network+FORGE_SECRET_GIT_* or a platform push tool. Do not force-reinit .git.

## [2026-07-23T09:05Z] gotcha — code_quality (delegation DLG-4297)

GitHub init (DLG-4297421D5B98) re-check: local .git intact; HEAD apprentice/DLG-4297/code_quality; master tip 3e1e4a0d94b9c4b410c43d81d23d66b73f79ae7c; .git/config has [core]+[user] only — no [remote "origin"]. Toolset still lacks git push/remote/gh/GitHub-write; run_shell_in_anvil and run_python_in_anvil return anvil_unavailable (Docker not available). Only http_get + read-only git_* available. Steps 2–5 remain operator-blocked.

## [2026-07-23T09:06Z] gotcha — code_quality (delegation DLG-4297)

Local git probe (read-only): .git exists; branch apprentice/DLG-4297/code_quality @ c36ffec65c0214c1c9a9ad460bb1b9a0d6c2c71a; master @ 3e1e4a0d94b9c4b410c43d81d23d66b73f79ae7c; has_origin=false (.git/config has [core]+[user] only); status=clean (inferred); commit_count_head=16, commit_count_master=15. Anvil still unavailable — no shell/python sandbox. Do not re-init or add origin without operator credentials + network.
