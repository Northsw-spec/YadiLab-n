# YadiLab-n — engineering contract for stateless development

Copyright © 2026 Daniel Ölund. All rights reserved. Preserve the original notices and [third-party notices](THIRD_PARTY_NOTICES.md). Work **only** in `Northsw-spec/YadiLab-n`. `Northsw-spec/YadiLab` is historical reference material, **not** a target for edits, workflow execution or unreviewed code copying.

## Sources of truth — no chat history or memory needed

A developer, coding agent or scheduled automation must be able to start from a fresh session and this repository alone. Do **not** require ChatGPT memory, prior chats, prior automation output, cached summaries or remembered commit IDs to develop YadiLab.

1. **The current GitHub commit's code, machine-readable schemas, dependencies and tests** define implemented behavior and constraints. Inspect them; neither this file nor an issue can override actual code.
2. **GitHub's live refs, open PR heads and Actions results** define what is integrated and verified. Check exact SHA/PR HEAD. A successful check on another commit is not proof for the current one. Pending, skipped, cancelled and failed are not PASS.
3. **This versioned `AGENTS.md`** defines the development policy and entrypoints. `README.md` is the user-facing overview. GitHub issues and PR descriptions record intentions and historical decisions, not present-day behavior until code is merged.
4. **Older `docs/` snapshots and historical repository artifacts** may help explain design but are never a substitute for inspecting fresh code and CI. If any summary conflicts with current code or GitHub status, correct the stale summary; do not treat it as technical truth.

Do not hardcode the “latest main SHA,” latest CI result or active PR list into versioned guidance. Retrieve them afresh every run. If GitHub cannot be inspected, disclose the precise blocker and do not invent work, checks or outcomes.

## Mandatory cold-start sequence for every coding session

1. Read `AGENTS.md` and `README.md` **from the current main commit**, then inspect the actual code, tests and schemas relevant to the chosen task.
2. Fetch the exact `main` SHA, **all open PRs and their latest heads**, and relevant GitHub Actions runs/check jobs. Check for another active writer before making changes; avoid duplicate PRs and conflicting concurrent edits.
3. Prefer completing/fixing the existing relevant PR. Otherwise choose a reproducible user-visible defect or capability gap, add negative and positive regression evidence, and change product code in a small feature branch. Documentation is part of the fix when it is materially outdated; pure status/document churn is not a substitute for functional progress.
4. Verify actual GitHub-hosted Ubuntu source/security, real compiled Chromium and `yadilab-required-ci` on the **exact PR HEAD** before merging through protected `main`. On failure, inspect the real job log and fix the same PR. Never label unrun work PASS.
5. After merge, retrieve the new exact `main` SHA and independently verify **main required CI and the independent Linux release** on that SHA. Leave any unfinished PR or unresolved validation explicitly PENDING with a traceable URL and next action.

A scheduled automation's prompt defines **when and how to work**; GitHub defines **what actually exists**. The prompt must send every run through this cold-start path, not carry a duplicated or stale technical specification in its own text. Prompt edits, workflow activity and a finished chat response do not themselves constitute a shipped code change.

## Technical entrypoints (check current implementation before editing)

| Concern | Source and tests to inspect |
| --- | --- |
| Native editable `.yadilab` format, SHA-256, file conflict and verified readback | `ui/app/project-document.mjs`, `tests/browser/run_project_document_tests.mjs` |
| New / Open / Save / Save As / Ctrl+S, dirty state and browser picker behavior | `ui/app/project-file-controls.mjs`, `ui/app/main.mjs`, `tests/acceptance/run_project_file_real_browser.py` |
| Canonical scenario source and editable-project validation | `schema/scenario-source.schema.json`, `validator/src/index.ts` |
| Network inventory import, explicit source links and review | `ui/src/browser/network-topology-import.ts`, `enterprise-import/src/network-inventory.ts`, `enterprise-import/src/workbook-mapping.ts`, `tests/enterprise-import/run_network_topology_import_checkpoint.mjs` |
| Build and exact-SHA acceptance | `package.json`, `package-lock.json`, the three GitHub Actions workflows below |

The manual `.yadilab` file workflow is **implemented**, not an unstarted “next feature.” New/Save/Open/Save As remain explicitly user-controlled; a browser download cannot be claimed as a verified durable disk write. No periodic autosave, silent project writes or automatic overwrite of unrelated projects. Never revive an old, unmerged project-file PR merely because a stale document mentions it.

An imported node, MAC, port, link or address may be modeled **only as explicitly supported by the original source and review**. Preserve canonical IDs, source locators and original files. Never infer a cable, port, route, reachability or Engine TRUE from proximity, IP/gateway, a draft or a file's hash. Missing external evidence remains UNKNOWN. Reopening editable source does not restore a previous runtime/Engine PASS.

## CI and release contract

Exactly **three** permanent workflows exist. Do not add feature-specific workflows:

- `.github/workflows/required-ci.yml`: required Ubuntu source/security checks plus its reusable browser check, with the `yadilab-required-ci` gate.
- `.github/workflows/browser-tests.yml`: real, source-built Chromium acceptances called by required CI.
- `.github/workflows/release.yml`: independent Linux build/attestation and exact-commit artifact on `main`.

The files themselves define the concrete commands and test scope. Do not imply that all historical tests run when only selected regressions are active. GitHub-hosted Ubuntu acceptance is the development gate; do not demand routine manual Parrot tests.

## Reporting and ownership

Only one YadiLab coding writer at a time; do not create an additional development automation. A report must name changed product files and before/after behavior, PR URL, exact head/merge SHA, confirmed source/security/Chromium/main-release results, and concrete blockers. If no code changed, say **INGEN KODÄNDRING** with a verifiable reason. Never report background progress between scheduled runs.
