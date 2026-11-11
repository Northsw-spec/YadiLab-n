# PROJECT-088 — topology architecture decision

## Scope and evidence

This decision was made from the current `main` commit
`9323725a4976685873a16a6849548fdaf5cc5b6a`, the PROJECT-087 implementation,
the two uploaded original workbooks, the uploaded `Main från Github 7 Nov.zip`
source archive, and the uploaded DEV12 IMPORT-002 compiled archive. The
historical source archive contains the nested `YadiLab-main ("YadiLab"-repot
7 Nov).zip` tree. The compiled archive contains build provenance and binaries,
not a complete source tree.

## Historical normal Canvas architecture

The historical source and the current repository retain the same semantic
boundary:

```text
ScenarioSource / canonical network
    ↓ compile
NormalizedScenario + LayoutDocument
    ↓ projectScenarioToCanvas()
CanvasProjection (real zones, resources and connections)
    ↓ toReactFlowProjection()
React Flow
```

`projectScenarioToCanvas()` emits one Canvas resource for every canonical
resource and one semantic edge for every canonical connection. Zone membership,
interface handles, source/target resource IDs and connection IDs remain part of
the derived visual projection. The older source's `layout/src/elk-backend.ts`
uses the same ELK Layered backend and port graph as the current code. The DEV12
binary is therefore a visual/functional reference, not an authority for
canonical data.

## PROJECT-087 architecture and exact regression

PROJECT-087 added `ui/src/canvas/network-overview.ts` and, in
`ui/app/main.mjs`, computed:

```js
const topologyOverview = !topologyFocusRoot && canonicalNetwork.resources.length >= 32
  ? buildNetworkOverviewProjection(...)
  : null;
const projection = topologyOverview ?? ... ?? vm?.canvas;
```

That precedence replaces the normal Canvas for the 47-resource Arvidsjaur
workbook with role/type group cards and summary edges. The cards are correctly
marked as visual summaries, but they are not editable resources and their edges
are not physical links. PROJECT-086 also introduced bounded focus projections
for very large sources; those projections are useful for scale, but they must
not be used as the default presentation for a small graph.

The regression is therefore projection selection, not an import or ELK
removal: the canonical graph and ordinary ELK layout still exist, but the
normal projection is hidden behind a type/role overview. A second usability
regression is that high-degree focus uses a deterministic bounded fallback and
the React Flow edge component draws generic Bezier paths, so layout/routing
information is not currently a first-class visual contract.

## Principles restored by PROJECT-088

1. **Normal topology is primary for manageable graphs.** The default view uses
   canonical resources, canonical connections and declared zones together.
2. **Types are visual metadata only.** They may choose icon, colour, label,
   filter and a soft layout preference; they never replace the graph with type
   groups.
3. **Canonical graph, view state and layout are separate.** A view may choose a
   bounded focus or an optional inventory summary, but it cannot mutate
   `ScenarioSource.resources` or `ScenarioSource.connections`.
4. **Identity is invariant.** Every rendered normal edge keeps its canonical
   connection ID and exact endpoint resources. A summary edge is explicitly
   non-physical and is never used in NORMAL TOPOLOGY or Builder.
5. **Zones remain containment/presentation.** A zone is not evidence of a cable;
   inter-zone links remain the declared connection edges.
6. **Existing Builder and Runtime guards remain authoritative.** Selection,
   Inspector drafts, source/layout revisions, compile, save/reload and Runtime
   authorization are not bypassed by a view-mode change.

## Chosen view modes

The UI exposes three explicit modes:

- `NORMAL TOPOLOGY`: default when the canonical graph fits the verified bounded
  render budget (currently up to 200 resources and the existing normal layout
  path). It renders the real graph and preserves Builder editability.
- `CONNECTED EXPLORER`: default for large canonical graphs. It renders a
  bounded subgraph selected from real canonical adjacency, with search, focus,
  pagination and back/breadcrumb navigation. Hidden branches are described as
  counts of real neighbors; no aggregate device or cable is created.
- `INVENTORY SUMMARY`: an explicit secondary view backed by
  `buildNetworkOverviewProjection()`. It is never selected implicitly for a
  manageable graph and never replaces the Builder graph.

Mode changes are view state only. Scenario identity, source revision, pending
Builder drafts and manual layout overrides survive a mode switch.

## Layout and routing contract

Normal layout starts from the real graph passed to the existing ELK/Builder
pipeline. Documented `layoutHints` and declared zones are soft layout inputs;
they are not physical direction or reachability evidence. Manual overrides are
applied after automatic layout through the existing `setLayoutOverride` and
must survive selection, Inspector changes and Save/Reload.

The visual layer now treats edge geometry as derived layout data. When the
layout backend provides bend points, the projection/adapter preserves them;
the React Flow edge renderer uses an orthogonal polyline with deterministic
parallel-edge offsets and falls back to a direct path only when no route was
provided. Canonical edge IDs and endpoints are never changed by routing.

For connected explorer pages, bounded topology-aware layout remains allowed for
responsiveness. It must select nodes and edges from canonical adjacency, retain
all selected source IDs, and never fabricate a link between disconnected
components.

## Why this avoids the rejected failure modes

The default manageable view cannot become a pyramid or type inventory because
its nodes and edges are created directly from the canonical graph. ELK receives
the real graph rather than role buckets, and route geometry is retained instead
of being discarded in favour of generic Bezier curves. Large networks still
avoid a 10,000-node React Flow mount through connected, bounded explorer pages.
The inventory summary remains available for orientation without being confused
with a physical topology.

## Compatibility retained

PROJECT-086/087 import profiles, SRC-22 review, provenance, exact IDs and
endpoint pairs, search/context/double-click navigation, breadcrumbs/back,
middle-button pan and wheel zoom, bounded 10k focus, Builder drafts, manual
layout and Runtime/Engine safety remain unchanged. The uploaded Arvidsjaur A
and B workbooks remain the acceptance fixtures; normal mode must expose their
47 resources, 46 declared links and 15 zones.
