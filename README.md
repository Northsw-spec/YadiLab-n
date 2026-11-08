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

The built-in Foundation test types undergo the same source-reference and
parameter checks during manual Save, Open and Compiler validation. A
reachability, routing, segmentation, authentication, membership, permission or
hardening test cannot silently refer to deleted resources. Invalid explicit
ports/protocols and competing `network.port_scan` `port`/`ports` declarations
are blocked; a genuinely omitted optional `network.route_test` protocol
continues to mean `any`. Direct Engine consumers report **UNKNOWN** when
explicitly invalid selectors are supplied, not a misleading defaulted TCP
or portless result. This is source integrity, not evidence that any physical
network probe has succeeded.

Identity and permission queries require actual own resource entries in Engine
state. JavaScript inherited names such as `constructor` cannot impersonate
an absent group, permission endpoint, or authentication subject. Engine
resource and test-result dictionaries are prototype-free, including after
runtime state mutations; a legitimately declared resource with that name
continues to work. UNKNOWN remains mandatory when the identity or evidence
is absent, including when reading externally restored plain-object state.

Engine permission decisions also require complete security-policy evidence.
A confirmed group allow must not return TRUE while an otherwise applicable
group deny has unknown membership. Incomplete or malformed permission rows
(including a missing explicit `effect`) yield UNKNOWN, not an inferred allow
or a silently truncated ACL. Explicitly invalid authentication fields such
as a string-valued MFA requirement or malformed allowlists also yield UNKNOWN,
without weakening a well-formed allow/deny and MFA evaluation.

Direct Runtime operations also preserve the immutable scenario identity envelope:
an operation cannot rewrite resource IDs, types, zones, labels, asset metadata
or whole network interfaces, and cannot change an interface's ID. A misspelled
operation kind or SET without a JSON value fails closed instead of implicitly
executing REMOVE or clearing an evidence property. Explicit mutable
`properties.*` edits and targeted interface state (including addresses,
MAC and MTU) remain available; batched operations remain atomic.

Canonical solution instructions are checked against the same immutable
identity boundary at every source entrypoint: Builder JSON Apply, Compiler,
native .yadilab Save and Open, and Runtime Engine execution. Even a
correctly rehashed project document cannot authorize resource ID/type/zone,
entire interface or interface-ID rewrites, or prototype-related JSON paths.
Source authoring fails before modifying the current Builder; valid mutable
configuration and interface-state edits remain supported. These source
guards are regression-tested by required Compiler, Builder authoring and
native project-file checks, not by inferring runtime or physical evidence.

Engine Runtime save-state restore additionally verifies that each restored
resource retains the immutable identity and topology envelope of the exact
normalized scenario (including type, zone, label, catalog asset, interface
count and interface IDs). A saved resource with malformed properties or
interfaces is rejected before becoming live Engine state. Declared mutable
property values, interface addresses, MAC and MTU remain restorable.
Both serialized and restored resource-ID maps are prototype-free, including
when a real resource is legitimately named `constructor`. A scenario hash
alone does not attest the saved Runtime state as trustworthy evidence.

Engine's direct network, TCP, DHCP, DNS, service, MTU, route, L2 and rule
queries resolve only **own** Runtime resource IDs, including when an external
caller supplies a plain JSON-reconstructed EngineState with a JavaScript
prototype. Missing IDs matching inherited names (`constructor`,
`toString`, `__proto__`) must produce UNKNOWN rather than false
reachability evidence or an exception. Explicitly declared resources with
those names remain usable. This guards Engine query boundaries, not physical
network connectivity.

Implementation and regression evidence live in [`ui/app/project-document.mjs`](ui/app/project-document.mjs), [`ui/app/project-file-controls.mjs`](ui/app/project-file-controls.mjs), [Node project-file regressions](tests/browser/run_project_document_tests.mjs) and [compiled-Chromium file acceptance](tests/acceptance/run_project_file_real_browser.py).

Builder Inspector, resource assets and JSON authoring editors are scoped to the
current project generation, not just the source revision (which restarts at
zero on New/Open). A queued click from an old project cannot apply its stale
settings or JSON to the replacement project. JSON editors capture the latest
input synchronously for same-event Apply before React repaints; only an
explicit valid Apply changes canonical source, and verified Save still uses
that canonical source. These safeguards do not constitute autosave of
unapplied form text or proof of Engine execution.

Resource Inspector preserves an existing catalog asset when editing unrelated
fields, writes explicitly supplied asset ID/version pairs, and removes an asset
only when both visible fields are cleared. Incomplete asset pairs are rejected
without changing the canonical source. The Builder's separate Create Connection
action rejects an already-used connection ID rather than silently overwriting
the existing topology link. Its Edit Connection action remains available for
deliberate updates. The asset semantics are regression-tested by the
mandatory Builder Inspector TypeScript/Node suite; duplicate link creation is
also rejected by an actual source-built Chromium UI acceptance.

Builder Delete Resource and cascading Delete Zone do not silently orphan
Foundation test selectors, nested findings/objectives/completion rules,
troubleshooting requirements, canonical solution operations, targeted notes,
layout hints, recorded neighbors/conntrack, or fault-origin bindings.
The action is rejected with the dependency category and the original source
remains unchanged; explicitly update the dependent declarations before
deleting their targets. An unreferenced resource or zone can still be
deleted normally, and an explicit connection cascade still removes only
the chosen topology edges, never unrelated test or evidence declarations.
Delete Connection and resource/zone cascades also refuse to delete an edge
that has a surviving note or fault-origin binding targeting that edge ID.
This prevents Builder from accepting a deletion that a subsequent verified
.yadilab Save/Open must reject as a dangling annotation. The operator must
retarget or remove the authored dependency explicitly; unrelated notes remain
intact on valid deletes.

Generic Builder property-path writes are limited to resource `properties.*`,
not canonical `id`, `zone`, `interfaces`, `asset`, or other typed fields.
JSON path traversal accepts only own properties and refuses JavaScript
prototype-related segments such as `__proto__`, `constructor`, and
`prototype`. This prevents prototype pollution through the path editor
and stops unreviewed resource identity rewrites; typed Inspector commands
remain the supported way to edit resource identity and ports.

ReactFlow canvas selection and pane-click events act on the live, synchronously
published Builder/Runtime workspace, not a source snapshot captured before a
recent Inspector Apply. That avoids rolling back an authored source revision
or losing the UNSAVED status when canvas selection fires before React rerenders.
Drag, connect, and zone-resize gestures are additionally blocked if the
canonical source has changed since the displayed topology projection, and all
canvas mutations are denied across a New/Open/import project generation.
The actual UI and a mandatory same-turn regression test enforce this behavior.
It is a specific stale-event fix, not proof that every intermittent dirty
status issue has been diagnosed. The [original feature issue](https://github.com/Northsw-spec/YadiLab-n/issues/1) is historical scope, not the current implementation status.

## Network inventory import: IPv4, IPv6 and documented ports

Use the **Import JSON / Excel / CSV → Network Topology** action to preview a
`Devices` table before choosing an editable Builder or modeled Runtime. A
device row may declare `Asset ID`, `Hostname`, `Device Type`, IPv4
(`IP Address` / `Prefix Length`), `IPv6 Address` / `IPv6 Prefix`,
`MAC Address`, `Interface ID`, `Interface Name`, `MTU`, and
`Connected To`. When `Connected To` explicitly names a peer device, the
same row may also declare `Link ID`, `From Port` (or `Source Port`),
`To Port` (or `Target Port`), and `Link Type` (`Connection Type`).
These facts are preserved in the canonical connection. Both port identifiers
must match independently declared `Interface ID` values (or valid canonical
`Interface Name` identifiers) on their corresponding devices. A generic
`primary` interface inferred from IP/MAC is **not** proof of a physical port.
A link ID/port/type without `Connected To` is rejected rather than creating
an imaginary link. Addresses are not inferred from gateways or nearby nodes.

An explicit `Interface ID` must be a stable lowercase canonical ID for
link-port references. An `Interface Name` may instead be a descriptive label.
A Devices row represents **at most one interface**; use a canonical
`Metadata` + `Nodes` + `Interfaces` workbook for devices with multiple
documented interfaces. Shorthand `Devices` input may include an explicit
`Links` table, but **populated additional sheets** such as `Routes`,
`VLANs`, `STP`, `Firewall`, `Interfaces`, `Metadata` or vendor-specific
tabs are not silently included: their original source rows block activation
until the data is transformed into a supported canonical workbook. A selected
explicit `Links` table likewise blocks when it has populated unsupported
columns (e.g. bandwidth or VLAN); these are not modeled connection facts.
Truly blank optional template sheets and blank link rows are ignored without
fabricating a link or creating an artificial conflict with `Connected To`.
Both compact and full IPv6 notation, with an optional `/0` through `/128`
prefix, are validated before Builder activation. Invalid, competing,
or orphan address/prefix declarations are blocked. IPv6 zone identifiers
such as `%eth0` are not currently supported in imported addresses.

Only `Metadata`, `Zones`, `Nodes`, `Interfaces`, `Links`, and
`Layout` are projected by the quick canonical topology workbook mapping.
The standard workbook may also name `Routes`, `VLANs`, `STP`, `Services`,
`Firewall`, `NAT` and `Flows`, but **populated rows in those sheets cannot
currently be imported into Builder**. Such declarations are rejected with a
source-row diagnostic, rather than being counted as mapped or silently dropped.
A populated unsupported field on an otherwise projected sheet is similarly
blocked. Even within supported sheets, populated text fields such as workbook
title/description, zone or interface labels and gateway declarations must be
representable; invalid JSON/XLSX types are rejected rather than silently
falling back to generated labels. When both `Nodes.gateway` and
`Nodes.Default Gateway` are present they must agree, otherwise import is
blocked before Builder activation. Genuinely empty optional template rows and
columns are permitted.

A populated unrecognized `Devices` column (such as Access VLAN,
Rack, Switch Port, Site or firewall-zone metadata) **blocks** shorthand
topology activation with the original sheet, row and field shown in preview.
These facts cannot be silently omitted while declaring the inventory fully
imported. Empty optional template columns are allowed; for unsupported
populated fields, use a supported canonical mapping or revise the source.
A CSV, Excel or JSON file can be inspected without changing the Builder.

An imported address, MAC or interface label is a declaration, **not**
evidence of physical cabling, routing, reachability or successful Engine probes.
Connections require explicit source endpoint IDs and do not gain physical port
claims unless the source itself declares them. A preview can be READY for
editing while operational evidence remains UNKNOWN.

## Engineering policy and cold-start

**[`AGENTS.md` is the versioned development and automation entrypoint](AGENTS.md).** Read it from current GitHub `main` together with actual source, tests, schemas, current PRs and exact-commit Actions runs. Previous conversations, AI memory and old status documents are **not required** and must not be used as substitutes for those sources. The automation prompt controls workflow; GitHub contains the technical facts.

GitHub-hosted Ubuntu PASS is YadiLab project acceptance for Parrot; no routine manual Parrot testing. Security tests and real Chromium checks must report genuine results. A failed, cancelled, skipped or pending test is not PASS. Prefer small, reviewed pull requests and exactly three permanent workflows.

## Copyright and third parties

Original YadiLab code is publicly viewable but no license for commercial use, redistribution, or derivative works is granted without the copyright holder's prior written permission. Third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
