# ATLAS-001 G5.0 — Office-document verification dossier

Status: **G5.0 verification complete; G5.1 implementation not started**  
Decision scope: one source format, physical-page evidence, source-fidelity
contract, capacity limits, and a fail-closed hand-off to G5.1.  
`visualApproved = PENDING_USER`.

## A. Format decision

**Selected format: DOCX (WordprocessingML OPC).** No PDF import and no third
format are introduced. ODT remains an existing, separately tested
structure-review path but is not selected as the G5.0 source contract.

The decision is based on the current implementation, not on filename
extension alone:

- `enterprise-import/src/docx-tables-structural-preview.ts:143-242` validates
  the complete OPC package, local relationships, XML namespaces, direct body
  tables, source SHA-256 and source-bound cell locators. It is strictly
  `REVIEW_REQUIRED`, masks cell values, and cannot activate Builder/Engine.
- `enterprise-import/src/structured-office-source-inspection.ts:140-177`
  copies the original bytes before asynchronous work and returns only bounded
  structure metadata.
- DOCX has the wider existing package-member ceiling (128 files versus ODT's
  32; compare the `LIMITS` blocks at
  `docx-tables-structural-preview.ts:12-16` and
  `odt-tables-structural-preview.ts:13-17`). Both retain the same 16 MiB
  input, compression-ratio and active-content barriers.
- The selected format has a reproducible local authoring/rendering toolchain
  in this workspace (`python-docx` -> `soffice` -> `pdfinfo`) and the fixture
  below is byte-stable after OPC member normalization.

This is a G5.0 source-format decision only. It does **not** claim that a DOCX
document is already a supported network importer.

## B. Document/page contract

Three things remain distinct:

1. **Physical document pages** are the pages produced by a pinned renderer.
   A page number is authoritative only when the exact source SHA, renderer
   identity/version, locale, fonts and rendering command are recorded.
2. **Canonical network resources/connections** are existing model objects.
   They are never created from page adjacency, prose, a visual cable, or a
   manifest alone.
3. **Atlas pages** are deterministic view projections created by
   `ui/src/canvas/atlas-topology.ts:153-270`. They preserve canonical IDs and
   classify internal/boundary/external connections; they are not document
   pages.

Current DOCX locators are source-part and ordinal locators:
`word/document.xml`, `tableOrdinal`, `rowOrdinal`, `cellOrdinal`, plus the
original SHA-256 (`docx-tables-structural-preview.ts:101-112`). They are not
physical-page locators. G5.1 must add a physical-page reference only after
reproducible pagination has been established; it must never replace the
source-part locator.

## C. Reproducible 500-page evidence

The versioned synthetic controls are in
`tests/fixtures/atlas001-g5.0/`:

- `atlas001-g5-control-a-500-pages.docx`: 500 rendered pages, zero tables and
  zero topology declarations.
- `atlas001-g5-control-b-500-pages.docx`: 500 rendered pages, two explicit
  declaration tables, two resource IDs and one explicit port-paired
  connection. No additional relationship is inferred.
- `manifest.json`: exact SHA-256 values, expected page counts, declarations
  and the rendering method.
- `generate_g5_fixtures.py`: deterministic generator; fixed document metadata,
  stable OPC member order/timestamps, and no production network data.

Independent verification uses:

```text
soffice --headless --convert-to pdf --outdir <temporary> <fixture.docx>
pdfinfo <temporary>/<fixture>.pdf   # Pages: 500
```

The independent XML check reads `word/document.xml` directly and compares the
two control-B tables with the manifest. The YadiLab structural preview is run
separately and sees `REVIEW_REQUIRED`, `canActivate=false`,
`engineVerified=false`, and `physicalTopologyVerified=false`.

### G5.0 Evidence Hardening

`tests/fixtures/atlas001-g5.0/rendering-profile.json` is the accepted
GitHub-hosted renderer profile. It requires Ubuntu 24.04 x86_64, `C.UTF-8`,
LibreOffice 24.2, Poppler 24.x (`pdfinfo` and `pdftotext`), Python 3.12,
`python-docx==1.2.0`, and the required DejaVu Sans/Liberation Sans families.
The run records the exact observed tool strings, locale, font inventory hash,
fontconfig variables, layout twips and commands. A profile mismatch is a
failure; local diagnostics may opt out only with an explicit flag and are
marked `RENDERER_FINGERPRINT=FAIL`.

`run_atlas001_g5_0_fixture.py` now verifies every page marker in one
`pdftotext -layout` pass, exact page count, PDF creation/non-empty output,
resource declarations on page 101, the connection/ports on page 251, the
documentation note on page 401, and all six neighboring pages. It emits
`atlas001-g5-0-evidence.json` with per-PDF SHA-256, timings, peak child RSS,
source/XML checks, declaration-page checks and acceptance statuses.

`run_atlas001_g5_0_negative.py` covers stale/incorrect SHA, changed endpoint
or port, wrong page count, misplaced/flowed declarations, corrupt PDF,
renderer/version/font/locale drift, missing tools and Control-A injection.
These probes must fail with non-zero status when the expected evidence is
invalid.

The structural test is wired into the existing `source-and-security` job.
The physical qualification and negative suite are wired into the existing
`browser-regressions / compiled-chromium` job after installing the declared
renderer packages. No fourth workflow was added.

## D. Source-integrity matrix

| Concern | Current evidence | G5.0 result |
|---|---|---|
| Original bytes | SHA-256 computed from the immutable copied byte snapshot | PASS |
| Package safety | OPC relationship, XML namespace, active/embedded-content, size and compression checks | PASS |
| Structural location | `word/document.xml` + table/row/cell ordinals | PASS |
| Value disclosure | One explicitly acknowledged cell, revalidated against current SHA; secret-looking values blocked (`docx-cell-disclosure.ts:50-111`) | PASS for reviewed cell only |
| Multiple references | Maximum ten, unique source cells/targets, user-asserted sidecar, no Engine mutation (`docx-multi-reference-review.ts:57-137`) | PASS for metadata-only sidecar |
| Physical page reference | Not emitted by the current product parser | PENDING_G5.1 |
| Source/normalization/presentation distinction | Structural preview and Atlas projection are separate; no page-derived model mutation | PASS |
| Changed bytes after review | SHA mismatch/stale-source barriers | PASS |

The existing reviewed topology candidate is also fail-closed: it requires
explicit node/link batches, exact SHA, complete row coverage and separate
consent (`office-large-reviewed-topology.ts:200-263`). Unknown endpoints,
duplicate IDs, invalid roles and reused ports block; the explicit port values
are retained as source locators (`office-large-reviewed-topology.ts:265-340`).
This candidate is deliberately not wired to live activation.

## E. Capacity report and limits

The fixture proves **500 physical pages**, not 500 imported network devices.
Current DOCX structural limits are:

| Profile | Input | Archive | XML | Tables / rows / cells |
|---|---:|---:|---:|---:|
| default | 16 MiB | 128 files, 16 MiB compressed, 32 MiB decompressed, 4 MiB member, 100× ratio | 1 MiB | 20 / 200 / 2,000 |
| explicit v1 | same | same | 4 MiB | 20 / 1,001 / 20,000 |
| explicit v2 | same | 64 MiB decompressed, 8 MiB member | 8 MiB | 20 / 5,001 / 50,000 |
| explicit v3 | same | 96 MiB decompressed, 16 MiB member | 16 MiB | 20 / 10,001 / 100,000 |

The corresponding ODT path uses the same byte/XML/row/cell budgets but a
32-file archive ceiling. Existing SCALE-001 measurements are intentionally
reported as structural-only; they do not prove physical pagination, Atlas
activation, or Engine capacity.

## F. Exact G5.1 contract and tests

G5.1 may proceed only as a separately reviewed implementation and must:

1. Keep DOCX as the sole selected source format; do not add PDF or a third
   parser. Reuse the existing safe OPC parser, immutable SHA snapshot,
   `ScenarioSource`/provenance model and `buildAtlasIndex`/
   `projectAtlasPage` path.
2. Record, for every disclosed fact, the original SHA, parser/profile ID,
   `word/document.xml` table/row/cell locator, renderer identity/version and
   physical page only when pagination is reproducible. Preserve source,
   normalization and presentation fields separately.
3. Require explicit operator review for every value that becomes a modeled
   resource or connection. A link requires explicit source rows for both
   endpoints and both ports; prose, proximity and page co-location are not
   evidence. Conflicts, duplicate IDs, invalid ports, stale bytes, missing
   pages and corrupt packages must be `REVIEW_REQUIRED`, `UNKNOWN` or
   `BLOCKED`, never partially fabricated.
4. Produce only canonical `ScenarioSource` resources/connections and then
   the existing deterministic Atlas index/projection. No second topology
   model and no independent page-derived cable graph.
5. Retain hard archive/XML/cell limits. Any larger profile requires a new
   explicit, versioned contract and measurements; limits may not be weakened
   to make a fixture pass.

Required G5.1 tests (all must be negative-tested as well as positive-tested):

- 500 rendered pages with zero declarations -> zero resources/connections and
  no Atlas fabrication.
- 500 rendered pages with explicit declarations on separate pages -> exact
  known IDs/ports and exact source locators, compared with an independently
  extracted manifest; manifest injection alone must fail.
- split tables, cross-page links, duplicate IDs, invalid/reused ports,
  contradictory declarations, no-topology prose, changed bytes after review,
  corrupt/active/external package content and every hard-limit boundary.
- deterministic repeated parse and repeated Atlas index/projection; canonical
  IDs/endpoints/ports remain unchanged.
- renderer fingerprint/font/locale drift must invalidate a physical-page
  assertion rather than silently changing provenance.

## G5.0 acceptance statuses

| Gate | Status | Evidence / limitation |
|---|---|---|
| `FORMAT_SELECTED` | **PASS** | DOCX selected; no third format/PDF path |
| `PHYSICAL_PAGE_COUNT` | **PASS (local; CI evidence required)** | Both synthetic controls render to exactly 500 pages; strict GitHub evidence is required on final HEAD |
| `PAGE_ORDER` | **PASS (local; CI evidence required)** | All 500 markers and six neighboring pages are checked from rendered PDF text |
| `DECLARATION_PAGE_LOCATION` | **PASS (local; CI evidence required)** | Control-B pages 101/251/401 are independently checked, including neighbors |
| `SOURCE_STRUCTURE` | **PASS** | Safe structural preview, exact table/cell counts and fail-closed barriers |
| `PROVENANCE` | **PASS with G5.1 page-ref gap** | SHA, XML locators and renderer evidence are preserved; physical-page refs are not yet product output |
| `NETWORK_FACT_EXTRACTION` | **REVIEW_REQUIRED** | Explicit reviewed candidate exists; no inference and no live activation |
| `ATLAS_COMPATIBILITY` | **PENDING_G5.1** | Existing Atlas projection is ready for canonical input; DOCX→Atlas integration is not implemented |
| `NEGATIVE_TESTS` | **PASS (local; CI evidence required)** | Dedicated fail-closed regression suite covers source, renderer, PDF and pagination drift |
| `GITHUB_CI_EVIDENCE` | **PENDING** | Must be proven by the final PR run's explicit job logs and uploaded evidence artifact |
| `G5.1_READY` | **CONDITIONAL / NO-GO for implementation** | Contract and tests are specified, but implementation requires a new explicit review |

## Verification commands run

```text
./node_modules/.bin/tsc -p tests/tsconfig.enterprise-import.json
node tests/enterprise-import/run_atlas001_g5_0_fixture_tests.mjs
python3 tests/qualification/run_atlas001_g5_0_fixture.py
./node_modules/.bin/tsc -p tests/tsconfig.browser.json
node tests/browser/run_docx_p3_cell_review_tests.mjs
node tests/browser/run_odt_p3_cell_review_tests.mjs
node tests/browser/run_ic010_p3c_office_structure_tests.mjs
node tests/browser/run_scale001_p1a_office_large_structural_tests.mjs
node tests/browser/run_scale001_p1b2_office_reviewed_topology_tests.mjs
node tests/browser/run_scale001_s2_5000_office_structural_frozen_tests.mjs
node tests/enterprise-import/run_docx_tables_p1_tests.mjs
node tests/enterprise-import/run_odt_tables_p1_tests.mjs
```

The local qualification run uses the managed Debian renderer with an explicit
unaccepted-profile override, so it is evidence of functional checks but not a
renderer-profile PASS. The strict GitHub run is authoritative for
`RENDERER_FINGERPRINT`, `GITHUB_CI_EVIDENCE` and final acceptance. No product
import path, merge or visual approval was changed by G5.0.
