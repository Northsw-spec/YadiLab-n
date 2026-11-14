# ATLAS-001 F4A — Cancellable Layout Architecture & Safety Proof

Status: `F4A_ARCHITECTURE: PARTIAL`
Scope: isolated proof and measurements only; no product integration, no merge.

The existing product source was measured at
`b09a7073f3da6cec8d95b8b6bb87ade8098b5bb0`; this F4A evidence/report is
committed at PR HEAD `13177a61a70fb6556529f219ebd3de1ecc1cbb78`. The Worker
proof is deliberately not a product PASS. It uses the same ELK distribution as
the product, but it does not replace `ElkLayoutBackend`, mutate Builder state,
or change the activation policy.

## Governance and live GitHub state

The cold-start check was performed against the live repository, not the PR
description's historical verification text.

| Item | Observed value |
|---|---|
| Repository | `Northsw-spec/YadiLab-n` |
| PR | [#105](https://github.com/Northsw-spec/YadiLab-n/pull/105) |
| PR state | `OPEN`, `merged=false`, `draft=false`, `mergeable=true` |
| PR HEAD after F4A push | `13177a61a70fb6556529f219ebd3de1ecc1cbb78` |
| `main` at cold start | `8b75e344b702a3ad645759b89ef47720952ec424` |
| Other open PRs | none returned by the repository-scoped open-PR search |
| Reviews | no review submissions, no review threads, no requested reviewers |
| Required run | `43596916706` (`YadiLab required CI`) |
| `source-and-security` | SUCCESS (job `132453281183`) |
| `browser-regressions / compiled-chromium` | SUCCESS (job `132453281266`) |
| `yadilab-required-ci` | SUCCESS (job `132455396753`) |
| Branch protection API | `UNKNOWN`: GitHub returned HTTP 403 `Resource not accessible by integration` |
| Repository rulesets | empty response (`[]`) |

No merge, branch-protection bypass, new PR, or `main` write was performed.

## Execution-chain map

The following is the actual browser call chain. Unless explicitly marked
otherwise, these phases execute on the browser's main JavaScript thread.

1. **XLSX import — main thread.**
   `previewNetworkTopologyFile` reads the selected bytes, hashes them with
   `webCryptoImportHashProvider.sha256Bytes`, selects the adapter, parses XLSX,
   normalizes the workbook, maps it to `ScenarioSource`, and binds source
   provenance. The function is async at its I/O boundaries, but no Worker is
   created; parsing, normalization, mapping and provenance construction run in
   the caller's UI execution context.
2. **Canonical compilation — main thread.**
   `compileBuilderWorkspace` awaits `compileScenario`. The compiler performs
   validation, deep cloning, resolution and canonical model construction in the
   same execution context.
3. **ELK graph construction — main thread.**
   `runAutoLayout` calls `buildLayoutGraph(scenario)` synchronously before
   calling the backend.
4. **ELK layout — currently main thread.**
   `ElkLayoutBackend` imports `elkjs/lib/elk.bundled.js` and calls `new ELK()`
   without `workerUrl` or `workerFactory`. ELK's bundled browser wrapper falls
   back to its inline/fake worker implementation. The `await` at
   `elk.layout(...)` yields a Promise but does not move CPU work off the main
   thread and supplies no cancellation handle.
5. **Layout validation — main thread.**
   `runAutoLayout` validates backend nodes, ports, edges and the final visual
   layout before creating a `LayoutDocument`. Any error returns `ok: false`.
6. **NORMAL compaction — main thread.**
   `compactNormalTopologyProjection` deterministically packs the projection.
   It then calls the checked orthogonal router and final projection validator.
7. **Orthogonal routing — main thread.**
   `computeOrthogonalRoutesChecked` and `validateOrthogonalProjection` are
   synchronous view operations. They run after the ELK result and before the
   final NORMAL canvas is exposed.
8. **React Flow rendering — main thread.**
   React state is published only after the existing identity checks and the
   fail-closed NORMAL validation. React Flow then creates DOM/SVG nodes and
   edges on the browser main thread.

The existing `isCurrent`/`isLiveCompile` checks protect against a stale import
or compile replacing a newer Builder workspace. They do not terminate an ELK
calculation that is already running.

## Root cause and F3 reproduction boundary

The timeout is not caused by a missing `Promise` await. The relevant source
boundary is:

```text
ElkLayoutBackend.layout
  -> new ELK()                         (no workerUrl/workerFactory)
  -> elk.layout(graph)
  -> elkjs bundled fake/inline worker
  -> synchronous CPU work on the browser main thread
```

F3's final Chromium matrix remains the authoritative product evidence:

- `50/49` and `100/99`: full UI pass.
- `50/150`, `50/400`, `100/300`, `100/800`, `200/199`, `200/600`:
  fail-closed `SAFE_BLOCKED` by the existing raw/layout safety gates.
- `200/1600`: `UNKNOWN`; the isolated Chromium process exceeded its explicit
  55-second harness bound and was terminated. That is not product cancellation
  and no final geometry or Builder-preservation result was claimed.

F3 did not expose per-phase timers. F4A therefore does not invent a phase
duration for the 200/1600 timeout.

## Reproducible phase measurements

`tests/acceptance/run_atlas001_f4_phase_measurements.mjs` measures the existing
pipeline without changing it. It records elapsed time plus Node process
`rss`, `heapUsed` and `external` memory before and after every phase. The JSON
artifact is:

[`ATLAS001_F4_PHASE_MEASUREMENTS.json`](evidence/f4/ATLAS001_F4_PHASE_MEASUREMENTS.json)

The following values are the exact run at the source HEAD above (milliseconds;
memory deltas are retained in the JSON artifact):

| Profile | Import parse | Normalize | Map | Compile | Graph | ELK | Validation | Canvas | NORMAL compaction + routing |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50/49 linear | 78.346 | 2.682 | 4.749 | 20.093 | 1.812 | 464.747 | 4.862 | 5.687 | 17.988 |
| 100/99 linear | 45.748 | 0.068 | 2.818 | 8.290 | 0.387 | 200.768 | 2.039 | 2.500 | 66.679 |
| 200-grid (control) | 98.210 | 0.085 | 5.233 | 20.166 | 1.046 | 376.684 | 7.089 | 6.842 | 81.556 |
| 100/800 redundant | 378.104 | 0.083 | 11.659 | 22.941 | 1.727 | **NOT_RUN_SAFE_BOUNDARY** | not run | not run | not run |
| 200/1600 redundant | 309.549 | 0.241 | 22.412 | 48.924 | 6.785 | **NOT_RUN_SAFE_BOUNDARY** | not run | not run | not run |

The other F0–F3 density profiles have the same source phases measured in the
artifact. Their current inline ELK phase is intentionally not invoked when the
profile is outside the three bounded controls above; no missing value is an
estimate. `NOT_RUN_SAFE_BOUNDARY` means the current backend was not called in a
non-cancellable process for that dense profile.

The phase artifact also shows that graph construction and compilation remain
small relative to the observed dense timeout. It does not prove that ELK is
the only possible cost in a future product build; it proves the current
backend boundary and records what was actually measured.

The measured NORMAL compaction runs produced 0 errors. The 100/99 and
200-grid controls produced respectively 7 and 25 warning diagnostics for
final cable crossings; those warnings are intentionally retained and do not
override the existing raw ELK safety gate.

Focused regression results in this F4A worktree:

- `npm run test:atlas001-normal-density-source`: PASS (all 9 independent
  density workbooks, exact IDs/ports/endpoints).
- `npm run test:atlas001-capacity-source`: PASS (all 9 capacity fixtures and
  activation policy matrix).
- `npm run test:project091-layout`: PASS.
- `npm run test:project094-engine`: PASS.
- `npm run test:layout`: **FAIL** at the pre-existing fixture assertion
  `backend-independent layout succeeds`. The fixture helper places children at
  `y=72`, while the current source geometry contract reserves a 112px zone
  header; this failure predates F4A's isolated files and was not weakened or
  hidden. It is an explicit follow-up blocker for the full layout suite.

## Isolated Worker proof

The proof page is:

[`atlas001-f4-worker-poc.html`](../../../tests/worker/atlas001-f4-worker-poc.html)

The runner is:

[`run_atlas001_f4_worker_poc.py`](../../../tests/acceptance/run_atlas001_f4_worker_poc.py)

It loads the repository's `elk-api.js` and `elk-worker.js` and passes an
explicit `workerUrl` to ELK. The proof protocol has the following safety
properties:

- explicit per-request budget;
- actual `elk.terminateWorker()` on timeout (not only `Promise.race`);
- one active layout job at a time (`maxConcurrentWorkers = 1`);
- request identity `{requestId, sourceSha, sourceRevision}`;
- complete node/edge count validation before acceptance;
- identity check before appending an accepted result;
- no late result is allowed to become an accepted result;
- a subsequent job starts after the aborted job's Worker was terminated;
- termination observation window records post-termination messages;
- a native continuously-posting Worker probe shows its counter stops after
  `Worker.terminate()`.

The reproducible command was:

```text
python tests/acceptance/run_atlas001_f4_worker_poc.py \
  --url http://127.0.0.1:19183/tests/worker/atlas001-f4-worker-poc.html \
  --evidence-dir evidence/atlas001-f4 \
  --first-budget-ms 250 \
  --second-budget-ms 20000
```

Evidence:

- [`ATLAS001_F4_WORKER_POC.json`](evidence/f4/ATLAS001_F4_WORKER_POC.json)
- [`ATLAS001_F4_WORKER_POC.png`](evidence/f4/ATLAS001_F4_WORKER_POC.png)

The actual result was:

| Job | Fixture | Budget | Result | Evidence |
|---|---|---:|---|---|
| first | 200 resources / 1,600 links (`200-redundant`) | 250 ms | `ABORTED`, `F4A_LAYOUT_TIMEOUT_ABORTED` at 260 ms | Worker terminated; 0 messages after termination; event loop ticks 16; max delay 7 ms |
| second | 50 resources / 49 links (`50-linear`) | 20,000 ms | `PASS`, `F4A_LAYOUT_COMPLETE` at 580 ms | 50 nodes and 49 edges; exact request identity preserved; event loop ticks 36; max delay 4 ms |

Across the sequence, `workerCount=2`, `maxConcurrentWorkers=1`, and only the
second identity was accepted. The negative identity probe rejected an older
request with `F4A_STALE_RESULT_IGNORED`. The independent termination probe observed 88
messages before termination and 0 afterwards. Chromium did not expose a
worker-specific memory counter; the POC records `performance.memory` when
available and otherwise records `null` rather than estimating memory.

This is an architecture proof, not a product implementation. It does not
prove that the current Builder remains unchanged during a real product abort,
because no product Builder was called.

## Compatibility and risk analysis

The smallest safe integration boundary is a cancellable adapter around the
existing `LayoutBackend`, not a second layout engine and not a new parser.
Important risks are:

1. **Asset/runtime delivery.** `elk-worker.js` must be available at a stable
   source-built URL under the app's CSP and compiled Chromium packaging.
2. **Worker lifecycle.** Every timeout must terminate and replace the Worker;
   a shared Worker must not retain a previous graph or request identity.
3. **Clone and memory cost.** The full layout graph crosses a structured-clone
   boundary. F4B needs measured clone/worker memory for 50/49, 100/99,
   200-grid, 100/800 and 200/1600, with a bounded failure diagnostic rather
   than an arbitrary connection cap.
4. **ELK result compatibility.** The worker path must preserve the existing
   nodes, ports, edge sections, orthogonality and `LayoutBackend` validation
   contracts. A result with missing nodes, ports or sections must be rejected.
5. **React/Builder commit race.** A timeout or abort must leave the active
   workspace untouched; a result from an older `{sourceSha, sourceRevision,
   projectGeneration}` must be discarded before any state publication.
6. **Existing regressions.** The raw ELK safety gate, NORMAL final-view
   validation, Atlas boundaries, Connected Explorer geometry fix, source
   provenance and Save/Open contracts must remain in force.

## Minimum F4B product change (proposal only)

F4B should add one worker-backed implementation of the existing
`LayoutBackend` contract and one coordinator:

1. Construct a per-job envelope containing `requestId`, canonical `sourceSha`,
   source revision and Builder project generation.
2. Serialize the already-built `LayoutGraph` to one Worker using the existing
   ELK `elk-api.js`/`elk-worker.js` pair.
3. Enforce a deadline with a timer that calls `terminateWorker()` and rejects
   with a diagnostic such as `LAYOUT_TIMEOUT_ABORTED`.
4. Keep at most one active job; terminate the old Worker before accepting a new
   import/layout request.
5. Validate the complete result with the existing backend/port/edge/visual
   validators. Only then return a new workspace; never publish a partial
   layout.
6. Re-check source SHA, revision and project generation immediately before the
   Builder mutation. A stale result is discarded with a visible diagnostic.
7. Add real product tests for timeout, abort, stale result, Builder identity,
   re-import after abort and complete cable/port preservation across all nine
   density profiles plus the 300/500 Atlas controls.
8. Add phase instrumentation and worker resource measurements before choosing
   any operational budget. `NORMAL_CONNECTION_BUDGET` must remain a decision,
   not a guessed hard limit.

No step above was implemented in F4A.

## Decision point

| Required status | F4A result |
|---|---|
| `F4A_ARCHITECTURE` | `PARTIAL` — Worker feasibility and hard termination are proven in isolation; product integration is intentionally pending. |
| `WORKER_ABORT_PROOF` | `PASS` — actual Worker termination, no post-termination messages, and a subsequent job were observed. |
| `MAIN_THREAD_RESPONSIVENESS` | `PASS` for the isolated POC; `UNKNOWN` for the current product because the product still uses inline ELK. |
| `STALE_RESULT_GUARD` | `PASS` for the POC identity gate; product layout cancellation is not integrated. |
| `BUILDER_UNCHANGED_ON_ABORT` | `UNKNOWN` — existing fail-closed/identity checks are present, but F4A did not call a product Worker or Builder abort path. |
| `NORMAL_CONNECTION_BUDGET` | `PENDING_DECISION` — no arbitrary connection threshold introduced. |
| `F4B_IMPLEMENTATION` | `NOT_STARTED` |

**Concrete F4B decision:** GO for a separately reviewed product-integration
change using the existing ELK engine behind a cancellable Worker boundary;
NO-GO for claiming that the current product is cancellable until the product
tests in the proposal prove Builder preservation and stale-result safety.
