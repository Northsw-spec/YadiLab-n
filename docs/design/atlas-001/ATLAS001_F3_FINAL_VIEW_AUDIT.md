# ATLAS-001 F3 — Safe final-view validation and bounded routing

Status: **F3_PARTIAL**. The final compiled-Chromium matrix is recorded below;
the 200/1600 profile still exceeds the killable test-process bound and the
product has no independently abortable compile/layout phase. Exact PR-CI
status is still verified at handoff time.

Final local verification commit: `e80647403fbcc3176966670aee531543fb4c3a8c`.
The Chromium run used the independent XLSX fixtures, loopback compiled bundle,
`/usr/bin/chromium`, viewport `1366x768`, a `45,000 ms` per-case bound and a
`55,000 ms` isolated-process bound. The machine-readable result and the eight
available screenshots are published with this audit under
`docs/design/atlas-001/evidence/f3/`.

## Scope and unchanged contracts

F3 changes only the existing Canvas routing/projection path. The canonical
network model, importer, Engine, Atlas pages, Connected Explorer, ELK raw
layout gate, `NORMAL_CONNECTION_BUDGET=PENDING_DECISION` and all source IDs,
ports and provenance remain unchanged.

The raw ELK visual gate is still authoritative. NORMAL compaction now has a
second, strict final-view check; it is not used to weaken or bypass the raw
gate.

## P0 root cause and reproducer

F2's independent `50/400 redundant` measurement recorded 27 foreign-resource
route-segment crossings. The defect was the explicit fallback in
`topology-edge-routing.ts`: when every bounded candidate was blocked, the
shortest blocked candidate was advertised as an orthogonal route.

The archived F2 examples identify the exact source geometry, including:

| Connection | Foreign resource | Resource rectangle (world coordinates) |
|---|---|---|
| `density_50-redundant_link_0069` | `density_50-redundant_node_0008` | `x=312,y=424,w=180,h=96` |
| `density_50-redundant_link_0069` | `density_50-redundant_node_0027` | `x=4876,y=424,w=180,h=96` |
| `density_50-redundant_link_0075` | `density_50-redundant_node_0017` | `x=2450,y=424,w=180,h=96` |
| `density_50-redundant_link_0115` | `density_50-redundant_node_0027` | `x=4876,y=424,w=180,h=96` |
| `density_50-redundant_link_0115` | `density_50-redundant_node_0008` | `x=312,y=424,w=180,h=96` |
| `density_50-redundant_link_0125` | `density_50-redundant_node_0017` | `x=2450,y=424,w=180,h=96` |
| `density_50-redundant_link_0125` | `density_50-redundant_node_0029` | `x=5292,y=424,w=180,h=96` |

The F3 checked router removes that fallback. For the same fixture, the
bounded route result is explicit `TOPOLOGY_ROUTE_UNSAFE` for these 15 links:

`0069, 0075, 0115, 0125, 0169, 0175, 0213, 0253, 0255, 0259, 0309,
0355, 0393, 0395, 0399` (all with the canonical
`density_50-redundant_link_` prefix). No route is emitted for those links, so
no foreign-resource cable is rendered. The focused PROJECT-088 regression
also proves the negative case with a synthetic obstacle and records the
blocking resource ID.

## Bounded alternative experiment

An isolated deterministic experiment added four global outer corridors to the
local candidate set. It found 400/400 resource-safe paths, but the resulting
layout had 5,929 cable crossings, 18,864 collinear cable overlaps, total route
length 1,558,835 px and p95 route length 9,951 px. That is not a readable or
safe final view, so the global-corridor strategy is deliberately not enabled.
The product therefore fails closed when the verified local budget cannot find
a safe route.

## Final-view validation

`validateOrthogonalProjection()` validates the actual post-compaction
projection, independently of raw ELK. It checks:

- finite positive node geometry and parent containment;
- resource-resource overlap and reserved zone-header overlap;
- exact canonical node/edge ID sets and duplicate IDs;
- declared endpoint/port handles when present;
- finite orthogonal route segments and foreign-resource crossings;
- cable crossings as explicit warnings for the existing accepted NORMAL
  profiles (raw ELK remains the activation authority).

Any route failure, missing route, foreign-resource crossing, malformed
geometry or identity mismatch is an error. `main.mjs` renders no NORMAL graph
when final-view errors exist; it never falls back to a straight/Bezier cable
graph.

The checked router also keeps deterministic parallel lanes, preserves the
canonical source/target handles and retains the existing `computeOrthogonalRoutes`
map API for PROJECT-088/090/091 callers.

## Timeout boundary

F3 confirms that the current product exposes no independently abortable phase
between canonical compile, global ELK, route calculation and React Flow mount.
The existing 100/800 and 200/1600 observations are therefore test-harness
timeouts/unknown outcomes, not product cancellation. No unsafe Promise race or
main-thread fake cancellation was added. A worker-backed cancellable ELK
boundary remains a separate architecture decision.

## Final compiled-Chromium classification

| Profile | F3 classification | Final Chromium evidence |
|---|---|---|
| 50/49 linear | **FULL_UI_PASS** | 50 resources, 49 SVG edges, zero overlaps/port errors/non-orthogonal routes; no page or console errors. Screenshot: `atlas001-normal-density-50-linear-1366x768.png`. |
| 50/150 star | **SAFE_BLOCKED** | Existing raw ELK gate blocked activation with `LAYOUT_UNREASONABLE_WHITESPACE` and `LAYOUT_EDGE_OVERLAP_EXCESSIVE`; Builder unchanged. Failure screenshot recorded. |
| 50/400 redundant | **SAFE_BLOCKED** | Existing raw ELK gate blocked activation with `LAYOUT_UNREASONABLE_WHITESPACE`; the checked router also reports 15 explicit `TOPOLOGY_ROUTE_UNSAFE` links in the isolated projection. Failure screenshot recorded. |
| 100/99 linear | **FULL_UI_PASS** | 100 resources, 99 SVG edges, zero overlaps/port errors/non-orthogonal routes; no page or console errors. Screenshot: `atlas001-normal-density-100-linear-1366x768.png`. |
| 100/300 star | **SAFE_BLOCKED** | Existing raw ELK gate blocked activation with whitespace and repeated-spoke overlap diagnostics; Builder unchanged. Failure screenshot recorded. |
| 100/800 redundant | **SAFE_BLOCKED** | In the final 45-second run the raw ELK gate returned a bounded `LAYOUT_UNREASONABLE_WHITESPACE` block in 24.5 seconds; Builder unchanged. The earlier 20-second run remains a historical timeout observation, not a product cancellation. Failure screenshot recorded. |
| 200/199 linear | **SAFE_BLOCKED** | Existing raw ELK gate blocked activation with whitespace diagnostics; Builder unchanged. Failure screenshot recorded. |
| 200/600 star | **SAFE_BLOCKED** | Existing raw ELK gate blocked activation with whitespace and repeated-spoke overlap diagnostics; Builder unchanged. Failure screenshot recorded. |
| 200/1600 redundant | **UNKNOWN** | The isolated Chromium process exceeded the explicit 55-second bound and was terminated. No final geometry or Builder-preservation result is claimed; no product cancellation exists. |

The two `FULL_UI_PASS` cases are the only profiles for which final React Flow
geometry was rendered and measured. The five `SAFE_BLOCKED` cases were stopped
by the existing raw safety gate before a graph could be presented. The six
`SAFE_BLOCKED` cases are not treated as UI passes. The final
`UNKNOWN` is deliberately not relabelled as controlled success: the bound is
owned by the test harness, not by the product.
