# YadiLab

Copyright © 2026 Daniel Ölund. All rights reserved.

Clean repository for the YadiLab application. The original source code is retained in `Northsw-spec/YadiLab` as a read-only migration reference.

**Repository state:** Bootstrap only. Application source and three-workflow CI baseline must be imported and verified before this repository is considered usable.

## Scope
- Preserve the existing YadiLab application source and verified import/Engine behavior.
- Establish exactly three GitHub Actions workflows: `required-ci.yml`, `browser-tests.yml`, and `release.yml`.
- No old workflow files or old CI run history.
- New manual `.yadilab` project Save/Open work follows the verified migration; do not import the unmerged PR #159 implementation.
- GitHub-hosted Ubuntu CI PASS is project acceptance for Parrot; no routine manual Parrot tests.
- No periodic autosave or implicit project writes.

The source is publicly viewable but no permission for commercial use, redistribution, or derivative works is granted without the copyright holder's prior written permission. Third-party components retain their respective licenses.