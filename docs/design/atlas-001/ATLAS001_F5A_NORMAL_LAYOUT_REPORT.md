# ATLAS-001 F5A — NORMAL final-view recovery report

## Scope

F5A keeps the existing ELK Worker, canonical importer, NORMAL resource
boundary (`<=200` resources), checked orthogonal router and F4B cancellation
contract. It introduces no second layout engine, parser, inferred link or
connection budget.

The change is a strict two-stage decision:

1. ELK output must pass all structural, semantic, node, port and edge checks.
   Only `LAYOUT_UNREASONABLE_WHITESPACE` may be reported as
   `LAYOUT_INTERMEDIATE_WHITESPACE_DEFERRED` for the NORMAL import path.
2. The real compacted NORMAL Canvas projection is built and validated before
   the imported workspace can replace the active Builder. Any final-view
   error blocks activation and leaves the Builder unchanged.

The default `runAutoLayout` contract remains strict. The deferral option is
explicitly opt-in and is used only by the normal network-import activation.

## P0 result — 200/199 linear

Independent source fixture:

`tests/fixtures/import/atlas001-normal-density-200-linear.xlsx`

Source SHA-256:

`526c0ea8c0cf46d7a37c19b5183246cda7e750ecedc7e5dfff97fc904c79cebf`

Baseline before F5A: `ACTIVATION_BLOCKED` with eleven raw
`LAYOUT_UNREASONABLE_WHITESPACE` diagnostics. The independent NORMAL
projection check already showed zero resource overlaps, zero zone-header
overlaps, zero diagonal segments and zero foreign-resource crossings.

F5A compiled-Chromium result at 1366 × 768:

| Measure | Result |
|---|---:|
| Source resources | 200 |
| Source explicit connections | 199 |
| Rendered React Flow resources | 200 |
| Rendered SVG connections | 199 |
| Zones | 10 |
| Resource overlaps | 0 |
| Zone-header overlaps | 0 |
| Endpoint/port errors | 0 |
| Non-orthogonal routes | 0 |
| Malformed SVG paths | 0 |
| Page errors | 0 |
| Console errors | 0 |
| Final status | `FULL_UI_PASS` |

The evidence runner verifies the complete canonical resource and connection
ID sets, every source/target endpoint and port, source provenance SHA, actual
React Flow nodes, actual SVG paths and the final NORMAL validation gate. The
Chromium screenshot is named
`atlas001-normal-density-200-linear-1366x768.png` and is uploaded with the
workflow's persistent Chromium evidence artifact.

## Negative controls and remaining safe blocks

| Profile | F5A result | Reason |
|---|---|---|
| 50/150 star | `SAFE_BLOCKED` | real raw port/route crowding and `LAYOUT_EDGE_OVERLAP_EXCESSIVE` |
| 100/300 star | `SAFE_BLOCKED` | same topology-dependent edge coincidence at larger scale |
| 200/600 star | `SAFE_BLOCKED` | same topology-dependent edge coincidence at larger scale |
| 50/400 redundant | `SAFE_BLOCKED` | checked router reports `TOPOLOGY_ROUTE_UNSAFE`; no unsafe cable is rendered |

All negative controls proved `builderUnchanged=true`, produced no page or
console errors, and retained their failure screenshots. F5A does not lower
the whitespace threshold, disable edge-overlap validation, enable the former
global-corridor experiment or approve a blocked route.

100/800 and 200/1600 remain F4B controlled-timeout profiles. They are not
promoted to NORMAL visual PASS by F5A. `NORMAL_CONNECTION_BUDGET` remains a
decision, not a guessed link limit.

## Regression preservation

- F4B Worker termination, 15-second timeout, Cancel, stale-result rejection,
  Builder preservation and re-import remain unchanged.
- F3 checked routing remains fail-closed when a safe route is unavailable.
- Canonical source IDs, endpoint ports, zones, provenance and Save/Open
  contracts are not rewritten by the projection.
- Existing 50/49, 100/99, 200-grid, Atlas, Connected Explorer and
  PROJECT-088/090/091/093/094 tests remain in the required workflow.

## F5B recommendation

Keep star and redundant profiles `SAFE_BLOCKED` until a separately reviewed
F5B design proves a port-density-aware presentation and bounded routing policy
with real Chromium evidence. F5B should measure port separability, parallel
link readability, cable crossings/overlaps, route length, memory and event-loop
delay before changing node port presentation. Do not reactivate global outer
corridors or introduce a scalar NORMAL connection budget.

The exact PR HEAD, CI conclusions and artifact URLs belong in the live
handoff report and must be retrieved from GitHub for each run; this document
intentionally contains no stale SHA or merge claim.
