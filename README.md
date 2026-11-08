# YadiLab

Copyright © 2026 Daniel Ölund. All rights reserved.

The active YadiLab application repository, migrated to a new Git history from the verified original source commit `785683d62cf93e0599b439c513dcb7a28f79aab8` in [Northsw-spec/YadiLab](https://github.com/Northsw-spec/YadiLab). The original repository is retained as a reference.

## Verified migration scope

- Existing application source, assets, Go launcher, npm manifests, automated tests, import adapters, and machine-readable project data migrated with source blob identities preserved.
- No legacy GitHub Actions workflow files or historic CI per-feature workflow structure.
- Exactly three CI workflows: `.github/workflows/required-ci.yml`, `browser-tests.yml`, and `release.yml`.
- Focused Engine, security, import, genuine Chromium, and independent Linux-release checks run on GitHub-hosted Ubuntu.
- The historical Markdown documentation and old CI-only test/runner code were deliberately not imported. The earlier unmerged project-file implementation in PR #159 was also excluded.
- Full prior test-suite coverage is **not** claimed: selected core regressions are active, while other migrated tests remain available to add when their value is validated.

**Current build status is determined exclusively by the latest GitHub Actions run for the exact commit.** Do not infer PASS from this README.

## Editable .yadilab projects (implemented)

The application provides user-controlled **New, Open, Save, Save As and Ctrl+S** for editable `.yadilab` documents, with schema and reference checks, unsaved-change warnings, native-disk conflict detection and byte-for-byte post-write verification. A browser fallback download is **not** treated as a verified durable save. File reopening restores editable source, **not** previous runtime evaluation or Engine PASS. There is no project autosave, silent overwrite, cloud project storage or inferred network connectivity.

Implementation and regression evidence live in [`ui/app/project-document.mjs`](ui/app/project-document.mjs), [`ui/app/project-file-controls.mjs`](ui/app/project-file-controls.mjs), [Node project-file regressions](tests/browser/run_project_document_tests.mjs) and [compiled-Chromium file acceptance](tests/acceptance/run_project_file_real_browser.py). The [original feature issue](https://github.com/Northsw-spec/YadiLab-n/issues/1) is historical scope, not the current implementation status.

## Engineering policy and cold-start

**[`AGENTS.md` is the versioned development and automation entrypoint](AGENTS.md).** Read it from current GitHub `main` together with actual source, tests, schemas, current PRs and exact-commit Actions runs. Previous conversations, AI memory and old status documents are **not required** and must not be used as substitutes for those sources. The automation prompt controls workflow; GitHub contains the technical facts.

GitHub-hosted Ubuntu PASS is YadiLab project acceptance for Parrot; no routine manual Parrot testing. Security tests and real Chromium checks must report genuine results. A failed, cancelled, skipped or pending test is not PASS. Prefer small, reviewed pull requests and exactly three permanent workflows.

## Copyright and third parties

Original YadiLab code is publicly viewable but no license for commercial use, redistribution, or derivative works is granted without the copyright holder's prior written permission. Third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
