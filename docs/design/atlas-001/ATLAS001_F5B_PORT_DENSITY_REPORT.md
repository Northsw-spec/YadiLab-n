# ATLAS-001 F5B — port-density routing and visual safety

## Handoff status

This report records the F5B implementation and the compiled-Chromium
measurements from Debian GNU/Linux 13 (trixie). It does not grant visual
approval and does not merge PR #105.

    phase: ATLAS-001 F5B
    starting_pr_head: db089a95139ec5881bae5e27a9e605fd7f13d9c1
    pr: 105
    main_mutated: false
    merge: not_performed
    status: F5B_PARTIAL
    functional_matrix: PASS
    visual_acceptance: PARTIAL
    normal_connection_budget: PENDING_DECISION

The exact final PR SHA, required CI run IDs and artifact URLs are deliberately
resolved from live GitHub at handoff time. The compiled build marker and the
persisted Chromium evidence are the authoritative per-run identity; no stale
SHA is copied into this historical design report.

## Root cause

The F5A failure was not a missing canonical link. The independent density
fixtures declare every interface and connection. The failure is presentation
geometry:

1. ELK's intermediate graph contains coincident edge segments for high-degree
   hubs. The existing raw visual gate therefore rejects the star profiles.
2. A single EAST/WEST port stack cannot keep a hub's declared interfaces
   independently targetable at the measured card height.
3. Deferring the raw coincidence warning is safe only if the final Canvas
   projection proves all canonical IDs, handles, node bounds and cable routes.
   The current bounded candidate router still finds cable crossings/overlaps
   for dense star and redundant graphs, so activation remains fail-closed.
4. The 100/800 and 200/1600 profiles reach the existing 15-second Worker
   timeout; the Worker is terminated and the Builder is preserved.

No Runtime, Engine, importer or canonical source model was changed.

## Implementation

The production change is intentionally limited to the existing NORMAL
projection and its evidence:

- layout/src/types.ts, layout/src/auto-layout.ts and ui/src/browser/layout.ts:
  explicit NORMAL-only deferral of intermediate whitespace and raw
  edge-coincidence diagnostics. Other ELK errors remain fatal; final
  projection validation is still mandatory.
- ui/src/canvas/normal-topology.ts: density-aware view-only resource
  expansion, deterministic four-side port assignment for dense resources and
  size-aware zone packing. Non-dense resources retain the F5A projection.
- ui/src/canvas/topology-edge-routing.ts: source/target-aware handle geometry,
  orthogonal parallel-lane candidates, cable conflict accounting and strict
  final dense-presentation diagnostics. The legacy card-boundary lanes are
  explicit opt-in for grouped hierarchy views and are not enabled for NORMAL
  F5B measurements.
- ui/src/canvas/types.ts and ui/app/main.mjs: optional view-only side metadata
  and actual-handle rendering. The import path publishes bounded Worker
  metrics only for test evidence; no fallback to inline ELK is added.
- tests/layout/run_layout_tests.mjs: regression assertions for the explicit
  intermediate edge-overlap deferral.
- tests/acceptance/run_atlas001_f5b_port_density_real_browser.py: compiled
  Chromium matrix, real SVG/handle measurements, four viewport screenshots,
  bounded timeout controls and persistent JSON evidence.
- .github/workflows/browser-tests.yml: runs the F5B matrix in the existing
  compiled-Chromium job and persists its evidence with the existing artifact.

All canonical resource IDs, connection IDs, endpoint ports, source provenance
and Builder replacement guards remain intact. Unsafe final geometry is never
activated.

## Compiled Chromium measurements

Fixture: tests/fixtures/import/atlas001-normal-density-200-linear.xlsx,
source SHA-256
526c0ea8c0cf46d7a37c19b5183246cda7e750ecedc7e5dfff97fc904c79cebf.

| Viewport | Resources / SVG links | Handles | Min port separation (flow px) | Foreign crossings | Endpoint errors | Diagonal / malformed | Cable crossing pairs | Cable overlap pairs | ELK ms | Max event-loop delay | Heap used |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1366×768 | 200 / 199 | 796 | 18.39 | 0 | 0 | 0 / 0 | 57 | 42 | 1131.0 | 1 ms | 126.5 MB |
| 1280×800 | 200 / 199 | 796 | 18.39 | 0 | 0 | 0 / 0 | 57 | 42 | 1244.9 | 0 ms | 103.5 MB |
| 1920×1080 | 200 / 199 | 796 | 18.39 | 0 | 0 | 0 / 0 | 57 | 42 | 985.9 | 0 ms | 95.5 MB |
| 390×844 | 200 / 199 | 796 | 18.39 | 0 | 0 | 0 / 0 | 57 | 42 | 981.6 | 0 ms | 114.3 MB |

The linear profile is structurally safe and preserves the F5A canonical
counts, provenance, endpoint identity, orthogonality and Builder replacement.
The measured cable conflicts are not hidden: they keep F5B visual acceptance
at PARTIAL. F5A's historical FULL_UI_PASS remains a separate acceptance
record based on its structural gates; it is not relabeled by this report.

## Density matrix outcomes

| Fixture | Expected F5B role | Actual compiled-Chromium outcome | Builder |
|---|---|---|---|
| 50/150 star | primary repair target | ACTIVATION_BLOCKED; TOPOLOGY_FINAL_CABLE_OVERLAP and TOPOLOGY_FINAL_CABLE_CROSSING | unchanged |
| 100/300 star | scaling negative control | ACTIVATION_BLOCKED; final cable overlap/crossing diagnostics | unchanged |
| 200/600 star | scaling negative control | ACTIVATION_BLOCKED; final cable overlap/crossing diagnostics | unchanged |
| 50/400 redundant | routing negative control | ACTIVATION_BLOCKED; TOPOLOGY_ROUTE_UNSAFE plus final cable diagnostics | unchanged |
| 100/800 redundant | bounded performance | LAYOUT_TIMEOUT_ABORTED at the existing 15-second operational budget | unchanged |
| 200/1600 redundant | bounded performance | LAYOUT_TIMEOUT_ABORTED at the existing 15-second operational budget | unchanged |
| 200/199 linear | mandatory regression | 4 viewport structural PASS; F5B visual observation remains PARTIAL because of measured cable conflicts | replaced only after validation |

The star and redundant failure screenshots are evidence of the blocked import
state, not dense-topology visual approval. No unsafe dense hub was rendered as
an accepted topology, so a genuine dense-hub detail screenshot is correctly
NOT_AVAILABLE for this phase.

## Safety and regression evidence

Local source checks passed:

    npm run typecheck:layout
    npm run typecheck:canvas
    npm run typecheck:browser
    npm run test:layout
    npm run test:project088-topology
    npm run test:project090-hierarchy
    npm run test:project094-engine

The existing npm run test:canvas adversarial interval-count assertion remains
an unrelated pre-F5B failure: it observes two pre-existing topology timers
where that old test expects one. F5B does not weaken or rewrite that test.

The F5B browser matrix records zero page errors, zero console errors and zero
unexpected external requests for the accepted linear views. Worker timeout
cases terminate within the existing bounded budget and are followed by no
Builder replacement. The negative final-geometry path is explicit and
fail-closed.

## Decision

F5B_PARTIAL is the only evidence-backed conclusion. The four-side port
presentation and explicit final validation are safe improvements, but the
current router has not demonstrated cable-level visual acceptance for the
50/150 star (nor the larger star/redundant profiles), and the retained
200/199 route set exposes measurable crossing/overlap observations.

Do not promote the star/redundant profiles, do not choose a scalar NORMAL
connection budget, and do not claim visual approval. A future phase should
design and prove a deterministic local lane allocator (with the same
fail-closed final validation) before attempting another activation change.
