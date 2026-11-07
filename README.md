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

## Next feature: manual .yadilab project files

[Feature specification and frozen acceptance criteria](https://github.com/Northsw-spec/YadiLab-n/issues/1).

Implement an explicit editable project file with New/Open/Save/Save As/Ctrl+S, verified read-back and preservation of declared topology identities, unsaved-change warnings and a safe failure path. No automatic periodic saving, cloud persistence, fabricated connectivity or import of the abandoned old PR #159 implementation.

## Engineering policy

GitHub-hosted Ubuntu PASS is YadiLab project acceptance for Parrot; no routine manual Parrot testing. Security tests and real Chromium checks must report genuine results. A failed, cancelled, skipped or pending test is not PASS. Prefer small, reviewed pull requests and exactly three permanent workflows.

## Copyright and third parties

Original YadiLab code is publicly viewable but no license for commercial use, redistribution, or derivative works is granted without the copyright holder's prior written permission. Third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
