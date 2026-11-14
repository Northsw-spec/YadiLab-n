# ATLAS-001 Import & Visualization Capacity Gate

This document records the scope and fail-closed interpretation of the
capacity gate.  The compiled Chromium job writes the machine-readable runtime
evidence to `atlas001-import-visualization-capacity.json`; that artifact is the
authority for exact timings, DOM/SVG observations, screenshots, commit SHA and
workflow run ID.  A source/parser test or a Builder compile is not presented as
a Chromium visualization PASS.

## Governance and scope

- Existing PR only: `#105`.
- `main` is not modified and the PR is not merged by this change.
- No new parser, graph engine, topology model, G5.2 implementation or visual
  approval change is introduced.
- ATLAS bounded activation continues to use the existing ELK/Atlas pipeline;
  global ELK is intentionally not called for `BOUNDED_ATLAS`.
- The committed evidence script uses independent XLSX bytes through the real
  file input.  Its external manifest is assertion data only; it never feeds
  Builder or the product model.

## Capacity truth table

The statuses below describe the acceptance contract exercised by the committed
Chromium matrix.  `FULL_UI_PASS` and `BOUNDED_ATLAS_PASS` are emitted only after
Builder export/readback, React Flow node IDs and actual SVG paths have been
checked.  Until a CI artifact exists for a particular run, its runtime result
is `NOT_TESTED`, not an implied PASS.

| Resources | XLSX six-sheet source | CSV | ODS | DOCX reviewed Office path | Normal Canvas | Atlas |
|---:|---|---|---|---|---|---|
| 50 | `FULL_UI_PASS` in compiled Chromium matrix | `NOT_TESTED` in this gate | `NOT_TESTED` in this gate | `NOT_TESTED` in this gate | `FULL_UI_PASS` | `NOT_TESTED` |
| 100 | `FULL_UI_PASS` in compiled Chromium matrix | `NOT_TESTED` in this gate | `NOT_TESTED` in this gate | `NOT_TESTED` in this gate | `FULL_UI_PASS` | `NOT_TESTED` |
| 200 | `FULL_UI_PASS` boundary case | `NOT_TESTED` in this gate | `NOT_TESTED` in this gate | `NOT_TESTED` in this gate | `FULL_UI_PASS` | `NOT_TESTED` |
| 201 | `BOUNDED_ATLAS_PASS` boundary case | `NOT_TESTED` in this gate | `NOT_TESTED` in this gate | `NOT_TESTED` in this gate | `BLOCKED_BY_POLICY` | `BOUNDED_ATLAS_PASS` |
| 300 | `BOUNDED_ATLAS_PASS` (branched control; lowercase-sheet control also run) | `NOT_TESTED` in this gate | `NOT_TESTED` in this gate | `NOT_TESTED` in this gate | `BLOCKED_BY_POLICY` | `BOUNDED_ATLAS_PASS` |
| 500 | `BOUNDED_ATLAS_PASS` (branched/redundant control) | `NOT_TESTED` in this gate | `NOT_TESTED` in this gate | `NOT_TESTED` in this gate | `BLOCKED_BY_POLICY` | `BOUNDED_ATLAS_PASS` |
| 1 000 | `BOUNDED_ATLAS_PASS` upper bounded case | `NOT_TESTED` in this gate | `NOT_TESTED` in this gate | `NOT_TESTED` in this gate | `BLOCKED_BY_POLICY` | `BOUNDED_ATLAS_PASS` |
| 1 001 | `BLOCKED_BY_POLICY` before Builder/global ELK | `NOT_TESTED` in this gate | `NOT_TESTED` in this gate | `NOT_TESTED` in this gate | `BLOCKED_BY_POLICY` | `BLOCKED_BY_POLICY` |

The exact runtime status is per fixture and viewport in the evidence manifest;
the table is not a substitute for that artifact.

## Independent fixtures and reconciliation

`tests/fixtures/import/generate_atlas001_capacity_fixtures.py` writes fixed
timestamp XLSX packages without calling YadiLab's parser, normalizer or
Builder.  The manifest records each file SHA-256, all canonical resource and
connection IDs, endpoint resources, endpoint ports and zone IDs.  The matrix
contains:

- compact spanning-grid 50/100/200 cases plus linear 201/1000/1001 controls;
- a 300 branched case and an identical lowercase-sheet-name variant;
- a 500 branched case with one source-declared parallel pair on distinct ports
  and a disconnected component.

`run_atlas001_capacity_fixture_tests.mjs` verifies the real XLSX adapter,
canonical mapping, exact IDs/endpoints/ports, source immutability, Atlas page
resource union and the internal-vs-boundary invariant.  It is an isolated
source test; it is not counted as a Chromium PASS.

## Corrected compatibility defect

The preview keeps producer worksheet names in `sheets` but also exposes the
verified canonical identities in `authoritativeSheets`.  Bounded policy now
checks those canonical identities.  The network normalizer maps recognized
standard/legacy-six workbooks through the existing compatibility document,
while retaining original cell locators for provenance.  This fixes a valid
`Metadata/Zones/Nodes/Interfaces/Links/Layout` workbook whose producer used
lowercase names without widening the accepted profile or merging unknown
tables.

The red regression is `run_atlas001_capacity_gate_tests.mjs`; the independent
lowercase workbook is exercised by both the source fixture test and the real
Chromium matrix.

## Normal connection budget

The current import path still has no independently proven generic connection
budget for NORMAL activation.  The gate therefore records:

```text
NORMAL_CONNECTION_BUDGET=PENDING_DECISION
```

No permanent connection threshold is invented here.  The existing verified
resource policy remains `NORMAL <= 200`, while bounded XLSX remains
`201..1000 resources` and `<= 2000 explicit connections`.  A future connection
benchmark must measure import, compile, global ELK, render, memory, SVG edge
count and layout quality before changing that decision.

## Format and negative-test limits

This gate's real Chromium matrix is deliberately XLSX-only.  Existing CSV/TSV,
JSON, ODS and reviewed DOCX/IC-040 suites remain separate contracts; they are
not silently promoted to capacity visualization claims here.  The evidence
manifest marks those combinations `NOT_TESTED` unless a dedicated test emits a
different permitted status.

The 1,001-resource fixture proves the policy barrier, leaves the active Builder
source unchanged and records zero global ELK invocations.  Stale source SHA,
workspace races, malformed workbooks, duplicate IDs, conflicting link sources,
archive limits and consent guards remain governed by their existing IC-020 and
enterprise-import tests; this capacity gate does not claim to have rerun every
one of those suites.

## Acceptance checklist

| Gate | State in this change |
|---|---|
| `IMPORT_50_FULL_UI` | CI Chromium matrix; evidence artifact required |
| `IMPORT_100_FULL_UI` | CI Chromium matrix; evidence artifact required |
| `IMPORT_200_BOUNDARY` | CI Chromium matrix; evidence artifact required |
| `IMPORT_201_BOUNDARY` | CI Chromium matrix; evidence artifact required |
| `IMPORT_300_BOUNDED_ATLAS` | CI Chromium matrix; all pages visited |
| `IMPORT_500_BOUNDED_ATLAS` | CI Chromium matrix; all pages visited |
| `IMPORT_1000_BOUNDARY` | CI Chromium matrix; all pages visited |
| `IMPORT_1001_FAIL_CLOSED` | CI Chromium matrix; Builder/global ELK unchanged |
| `XLSX_CANONICAL_SHEET_COMPATIBILITY` | Source test + lowercase Chromium fixture |
| `CANONICAL_RESOURCE_RECONCILIATION` | External manifest + export/readback assertions |
| `CANONICAL_CONNECTION_RECONCILIATION` | External manifest + every Atlas page |
| `EXACT_ENDPOINT_PORT_IDENTITY` | Source test + DOM/SVG assertions |
| `REAL_REACT_FLOW_NODES` | Chromium DOM assertions |
| `REAL_SVG_EDGES` | Chromium SVG path assertions |
| `ATLAS_ALL_PAGE_RECONCILIATION` | Chromium all-page traversal |
| `BOUNDARY_LINK_NAVIGATION` | Chromium boundary click and destination assertion |
| `NO_UNBOUNDED_GLOBAL_ELK` | Bounded/blocked trace must stay at zero |
| `NORMAL_CONNECTION_BUDGET` | `PENDING_DECISION` |
| `STALE_SOURCE_GUARD` | Existing contract; not rerun by this gate |
| `STALE_WORKSPACE_GUARD` | Existing contract; not rerun by this gate |
| `NEGATIVE_IMPORT_TESTS` | Capacity negative included; broader suite remains separate |
| `AV001_TECHNICAL_GATES` | Existing AV-001 contracts remain unchanged |
| `GITHUB_CI_EXACT_HEAD` | Required CI must report green on final PR HEAD |
| `G5_2_CONTRACT_UNCHANGED` | Existing 76-assertion contract test |
| `VISUAL_APPROVAL_UNCHANGED` | No approval state changed |
| `PR105_MERGED_NO` | Intentionally not merged |

