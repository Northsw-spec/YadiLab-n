# YadiLab-n — verified development rules

YadiLab source belongs to Daniel Ölund. Preserve copyright and third-party license notices. The old repository remains a historical reference, not an authority for new CI. This repository has exactly three permanent GitHub Actions workflows.

## Source and verification rules
- GitHub source and the actual current commit are authoritative. No invented progress or release claims.
- Record exact SHA, branch and workflow run result. Pending, cancelled, skipped and failed are not PASS.
- GitHub-hosted Ubuntu PASS is project acceptance for Parrot. No routine manual or Parrot-native tests.
- Keep imported network node IDs, links, ports, original evidence and negative security regression tests accurate.
- Use one active coding writer. No workflow-per-feature CI expansion; consolidate cases in the three existing workflows.
- This new baseline runs focused security, Engine, import, build and actual compiled Chromium checks. It does not claim to have run every historical test.

## Next deliverable: new manual .yadilab project file
The prior unmerged PR #159 implementation must not be imported. Write tests first, then implement New, Open, Save, Save As, Ctrl+S, durable read-back integrity and unsaved-change warning. No periodic autosave, silent writes or cloud-style project persistence. Application preferences remain separate from project content. Reject corrupted or unsafe project files before mutating workspace.
