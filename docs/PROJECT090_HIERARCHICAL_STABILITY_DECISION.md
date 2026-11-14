# PROJECT-090 — Hierarchical topology and selection-stability decision

## Root cause

The 10k view used a bounded projection, but React Flow's `onSelectionChange`
callback still fed the selection back into the large Builder workspace. During
device/double-click navigation the controlled projection and the selection map
could therefore update each other until React raised error #185 (maximum update
depth). The previous large-network focus path also did not provide a
role-derived hierarchy, so it was not a usable overview of the source graph.

## Fix

- Build one deterministic index from canonical resources and connections,
  including role classification, adjacency, parallel connection IDs and
  source-derived overview membership.
- Render only bounded, source-faithful overview/branch projections (100 nodes
  and 250 edges are the safety ceilings). Layout is a deterministic hierarchical
  grid; no full 10k ELK layout is run.
- Keep the canonical model, identities, endpoints, interfaces and declared
  metadata untouched. Hidden and cross-boundary counts are computed from the
  original connection collection; no aggregate or fabricated cable is added.
- In a 10k hierarchy, selection is updated by the bounded node/focus path while
  React Flow's feedback callback is ignored. This breaks the feedback loop while
  keeping the Inspector tied to the canonical selected resource.
- Cache known semantic IDs for Builder selection filtering and disable the
  geometry-repair loop only for the bounded hierarchy projection.

## Evidence and limits

The dedicated hierarchy unit test uses an exact 10,000-device/10,000-link
fixture (2 core, 32 distribution, 256 access and 9,710 endpoints), plus
parallel, mesh and disconnected cases. Compiled Chromium acceptance verifies
overview, distribution and access navigation, source identity/export, repeated
selection, search, Inspector rendering, bounded DOM counts, screenshots and
absence of page errors or outside requests.

The original PROJECT-086 10k workbook was not present in the supplied files for
this run. The exact synthetic fixture is therefore reported as
`synthetic-ci-fixture`; the two supplied Arvidsjaur workbooks remain separate
regression sources and are not replaced by this fixture.

