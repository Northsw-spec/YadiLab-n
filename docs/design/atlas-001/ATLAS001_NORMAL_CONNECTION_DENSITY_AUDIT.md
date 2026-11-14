# ATLAS-001 — NORMAL connection-density safety gate

Status: **F0/F1 measured; safety decision `PENDING_DECISION`**  
Scope: the existing PR #105 only. This gate introduces independent source
fixtures, a bounded real-Chromium measurement harness and the source CI guard;
it does not change the production activation policy, importer, canonical
network model, Runtime/Engine semantics, Atlas implementation or the approved
Connected Explorer fix.

## Decision

```text
NORMAL_CONNECTION_BUDGET=PENDING_DECISION
```

No generic connection limit is safe to derive from this matrix. The existing
resource policy remains the source of truth (`NORMAL` through 200 resources;
bounded Atlas for the existing larger profiles). `normalConnectionBudget` is
still omitted from the production activation call, so the measurement records
the current pre-fix behavior instead of pretending that a link cap exists.

The result is a real safety finding, not a PASS: topology-dependent layout
failures occur below the resource boundary, and the failures are not monotonic
in connection count. A connection-only threshold that preserves all verified
50/49, 100/99 and 200/199 NORMAL imports cannot be justified by these data.

## Independent source controls

`tests/fixtures/import/generate_atlas001_normal_density_fixtures.py` writes
deterministic six-sheet XLSX files without importing or calling YadiLab code.
Every resource, zone, connection and endpoint interface is declared in the
source workbook. Each endpoint occurrence receives its own explicit port, so
parallel and redundant links are never collapsed or inferred. The manifest
(`tests/fixtures/import/atlas001-normal-density-manifest.json`) records the
file SHA-256, canonical IDs, endpoint/port truth, zone IDs and byte size.

The nine controls are:

| Resources | Connections | Topology | Fixture |
|---:|---:|---|---|
| 50 | 49 | linear | `50-linear` |
| 50 | 150 | repeated star spokes | `50-star` |
| 50 | 400 | ring plus redundant/parallel links | `50-redundant` |
| 100 | 99 | linear | `100-linear` |
| 100 | 300 | repeated star spokes | `100-star` |
| 100 | 800 | ring plus redundant/parallel links | `100-redundant` |
| 200 | 199 | linear | `200-linear` |
| 200 | 600 | repeated star spokes | `200-star` |
| 200 | 1,600 | ring plus redundant/parallel links | `200-redundant` |

The source test is mandatory in `required-ci.yml` and verifies the importer
mapping, exact resource/connection IDs, exact ports and exact source-declared
zones. It also verifies that all nine cases currently reproduce `NORMAL`; it
does not call a product layout engine and is not presented as a Chromium
visualization PASS.

## Real compiled-Chromium measurement

The browser harness is
`tests/acceptance/run_atlas001_normal_connection_density_real_browser.py`.
It uploads the original XLSX bytes through the real network-import file input,
then exports the canonical source and checks it against the independent
manifest. It measures import preview, activation-to-builder commit, render
completion, global-ELK invocation count, event-loop responsiveness, exposed
heap memory, rendered resource/SVG-edge counts, resource and zone-header
overlaps, endpoint/port identity, orthogonal route markers, malformed paths,
page/console errors, external requests and explicit timeouts.

Each case runs in its own killable Chromium process. The recorded local run
used `ATLAS001_CASE_TIMEOUT_MS=20000`, an explicit 30,000 ms process bound and
a 250 ms event-loop probe. Missing product instrumentation is recorded as
`NOT_EXPOSED`; no compile-only or ELK-duration value is invented. The
machine-readable output and screenshots were written to the local evidence
directory `evidence/atlas001-normal-density/final-isolated/` (generated
evidence is intentionally not committed as source code).

### Measured matrix

| Case | Preview ms | Activation ms | Render ms | Result | Evidence |
|---|---:|---:|---:|---|---|
| 50/49 linear | 405.4 | 921.9 | 271.7 | **PASS** | 50 nodes, 49 SVG edges, 5 zones, zero node/header overlaps, zero endpoint/port errors, zero non-orthogonal routes, zero page/console errors; memory 32,259,205 bytes; 16/16 probe ticks, max delay 0 ms |
| 50/150 star | 409.7 | 886.0 | — | **FAIL / ACTIVATION_BLOCKED** | `LAYOUT_UNREASONABLE_WHITESPACE` ratio 11.70; repeated spoke routes trigger `LAYOUT_EDGE_OVERLAP_EXCESSIVE`; Builder unchanged |
| 50/400 redundant | 422.9 | 3,894.5 | — | **FAIL / ACTIVATION_BLOCKED** | whitespace ratios 11.20–15.62 across zones; Builder unchanged |
| 100/99 linear | 399.4 | 1,594.6 | 634.9 | **PASS** | 100 nodes, 99 SVG edges, 10 zones, zero node/header overlaps, zero endpoint/port errors, zero non-orthogonal routes, zero page/console errors; memory 54,920,161 bytes; 16/16 probe ticks, max delay 0 ms |
| 100/300 star | 405.3 | 2,333.9 | — | **FAIL / ACTIVATION_BLOCKED** | whitespace ratio 39.53 plus repeated spoke route overlap; Builder unchanged |
| 100/800 redundant | 491.7 | 20,890.3 | — | **FAIL / TIMEOUT** | activation click exceeded the 20,000 ms case bound; layout completion and Builder preservation are **UNKNOWN** (a separate bounded repeat reached the existing layout guard instead) |
| 200/199 linear | 424.2 | 843.1 | — | **FAIL / ACTIVATION_BLOCKED** | whitespace ratios 9.14–9.35; Builder unchanged |
| 200/600 star | 412.4 | 11,719.4 | — | **FAIL / ACTIVATION_BLOCKED** | whitespace ratio 71.46 plus repeated spoke route overlap; Builder unchanged |
| 200/1,600 redundant | — | — | — | **FAIL / PROCESS_TIMEOUT** | isolated Chromium process exceeded 30,000 ms and was terminated; layout completion and Builder preservation are **UNKNOWN** |

For the five activation-blocked cases the existing layout-quality guard stopped
the NORMAL activation before a React Flow render. That is why rendered-node,
SVG-edge, memory and responsiveness fields are absent rather than estimated.
The source/export checks still prove that no canonical IDs, endpoints or ports
were lost before the guard, and the harness verified the Builder remained
unchanged. The 100/800 case exceeded the explicit activation-click bound in
the final run; a separate run with the same bound reached the layout guard
instead. The 100/800 and 200/1,600 timeout outcomes are explicitly UNKNOWN,
not successful fail-closed results.

The two successful cases prove the exact source-to-render path for their
profiles: all declared nodes and edges render, endpoint/port metadata matches
the source, routes carry the existing orthogonal marker, and no overlap or
browser error was observed. They do not generalize to every topology or to
the failed cases.

## Why no permanent connection budget is selected

The observed failures are topology/geometry-dependent rather than a monotonic
function of connection count: 100/99 passes while 200/199 fails, and the star
and redundant profiles fail at several different densities. A scalar threshold
would either leave known failing NORMAL profiles unguarded or block the
explicitly protected 50/49, 100/99 and 200/199 profiles. The existing bounded
Atlas path is not proven here for these `<=200` dense source profiles, so it is
not an authorized fallback.

Evidence still required before changing the production policy includes:

1. independent successful layout controls for representative linear,
   branched, ring, parallel and dense topologies across the normal resource
   range;
2. a verified bounded/Atlas path for a dense source with `<=200` resources,
   including all canonical links and ports;
3. product instrumentation that separates canonical compile, global ELK and
   React Flow render durations, plus repeatable memory ceilings;
4. repeated Chromium/OS runs that establish deterministic resource and
   responsiveness limits; and
5. a fail-closed activation decision that is validated both at preview and
   activation without changing the Builder on stale or over-budget sources.

## Regression and preservation status

- Existing 50/100/200 resource capacity controls and the 201/300/500/1000/1001
  matrix remain in the repository and were not changed by the production
  policy.
- `Connected Explorer` geometry guard and its regression test are untouched.
- No importer, canonical model, Runtime/Engine, Atlas or G5.2 contract code
  was changed.
- Required CI gains only the independent normal-density source test; the heavy
  Chromium stress matrix remains outside the critical CI path because its
  measured failures are the subject of this decision gate, not green tests to
  be hidden.
- No merge, main update, visual approval or new PR is performed in this phase.

The final GitHub HEAD, required checks and PR state must be retrieved fresh in
the handoff report; this document intentionally contains no hardcoded current
SHA or stale CI result.

## F2 root-cause investigation and minimal repair

F2 was run against the unchanged production code at the start of the phase.
The only difference between the archived F0/F1 measurement commit and that
HEAD was the later wording-only audit refresh, so the nine-case Chromium
matrix remains a valid baseline reproducer.  The baseline result is still
`F2_PARTIAL`: the two linear controls and the grid control do not explain the
dense failures by resource or connection count alone.

### 200/199 linear versus 200/199 grid

The two cases have the same resource and connection counts but different
source-declared topology:

| Case | Declared zones | Raw ELK geometry | Raw occupied-area ratio | Result before NORMAL view packing |
|---|---:|---|---:|---|
| 200/199 grid | 1 | one compact child field (about 5,796 × 2,370 px) | 3.98 | accepted |
| 200/199 linear | 10 | ten 20-resource chains; each child field about 4,284 × 755 px | 9.14–9.35 | rejected (`LAYOUT_UNREASONABLE_WHITESPACE`) |

ELK is configured globally as a RIGHT-directed layered graph.  The linear
case therefore produces genuinely elongated intermediate child layouts; the
one-zone simulation is even worse (about 86.9 ratio), so the source-declared
zones are not the sole explanation.  At the same time, NORMAL immediately
passes the raw document through `compactNormalTopologyProjection`, which
packs each zone into a bounded three-column view and reroutes its edges.  The
raw visual gate is consequently evaluating an intermediate layout that is not
the geometry the operator sees.  This proves a combined cause: **A** (the raw
ELK geometry is unreasonable for the linear graph) and **B** (the gate runs
before the NORMAL projection and can reject a final view that has no node or
header overlap).  The declared zones and links are legitimate source
structure (**C**); removing or merging them would be an unsafe workaround.

### Star and redundant controls

The star controls are not only a validator false positive.  The hub-zone raw
ratios were 11.70 (50/150), 39.53 (100/300) and 71.46 (200/600), and the hub
output ports were packed to sub-pixel spacing (about 0.69 px between adjacent
ports in the 50/150 case).  The raw validator's centre-pair grouping is coarse,
but the underlying source-side port crowding is real.  The NORMAL compactor
does produce zero resource overlaps, zero zone-header overlaps, zero
non-orthogonal segments and zero foreign-resource crossings for the three star
sizes in an isolated projection check; activation still stops before that
view because the raw gate rejects the intermediate document.

Redundant links are a separate safety boundary.  The 50/400 raw zone ratios
were 11.20–15.62, 100/800 exceeded the 20-second activation bound, and
200/1,600 exceeded the 30-second isolated Chromium process bound.  The final
50/400 projection has no resource/header overlap and, after the routing fix
below, no diagonal segments, but 27 route segments still intersect a foreign
resource in the isolated geometry check.  It is therefore not safe to bypass
the raw gate for redundant profiles.  The timeout cases remain **UNKNOWN** for
final geometry and Builder-preservation because the current product exposes no
bounded compile/layout/render phase markers.

### Minimal verified repair

One narrow production defect was independently reproducible in the shared
NORMAL/hierarchy route helper.  `handleY()` sliced `in:<interface>` as though
the prefix had four characters; every target handle consequently fell back to
the card centre.  In addition, the parallel-lane fallback moved x and y in one
candidate at once.  Under a blocked-detour choice this advertised an
`orthogonal` route containing a diagonal SVG segment.  F2 changes only
`ui/src/canvas/topology-edge-routing.ts`:

* parse `out:` and `in:` prefixes with their actual lengths;
* express the offset parallel lane as four axis-aligned points.

`tests/browser/run_project088_topology_tests.mjs` now contains a focused
three-link, obstacle-forced regression that checks the declared source and
target interface anchors and every route segment.  No threshold, activation
policy, importer, canonical ID/port/connection, Atlas, G5.1/G5.2 or
Connected Explorer code was changed.  The repair does not claim to unblock the
raw ELK failures; it removes a genuine route-corruption defect while leaving
unsafe topologies fail-closed.

### Post-repair isolated projection checks

These are deterministic Node-side checks of the actual NORMAL projection,
not a substitute for the compiled-Chromium baseline above:

| Case | Routes | Resource overlaps | Header overlaps | Non-orthogonal segments | Foreign-resource crossings |
|---|---:|---:|---:|---:|---:|
| 200/199 linear | 199 | 0 | 0 | 0 | 0 |
| 50/150 star | 150 | 0 | 0 | 0 | 0 |
| 100/300 star | 300 | 0 | 0 | 0 | 0 |
| 200/600 star | 600 | 0 | 0 | 0 | 0 |
| 50/400 redundant | 400 | 0 | 0 | 0 | 27 |

The remaining raw-gate mismatch and the redundant-route crossings require a
separate architecture decision and a bounded final-view validator; no
connection budget is selected in F2 (`NORMAL_CONNECTION_BUDGET=PENDING_DECISION`).
