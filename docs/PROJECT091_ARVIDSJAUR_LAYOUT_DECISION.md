# PROJECT-091 — Arvidsjaur grouped layout and lossless hierarchy links

## Root causes

The PROJECT-090 bounded view selected a node set and then accumulated edges up
to the edge budget. That made the visible node set and rendered source-link set
diverge: a source-connected node could look isolated, and dense scopes could
silently lose internal links. The projection also removed all zones and used a
generic resource grid. Hierarchy edges had no route data, so the renderer fell
back to Bezier paths and produced the reported noodle graph.

## Decision and implementation

The hierarchy now follows the required view pipeline:

`canonical model → hierarchy index → bounded scope → link partition →
presentation groups → orthogonal routes → React Flow`.

- `partitionConnections()` classifies every canonical link as internal,
  boundary or external. Every internal link is projected by its original ID and
  endpoint pair. Branch pagination is based on both node and link budgets; it
  never truncates an internal edge list to satisfy a budget.
- Each visible resource receives an explicit `CONNECTED`,
  `BOUNDARY_CONNECTED`, `SOURCE_ISOLATED` or `INCOMPLETE_VIEW` state, including
  visible/boundary/omitted counts. Boundary indicators are rendered on the
  device card.
- Overview, distribution and access scopes receive presentation-only
  Arvidsjaur-style groups. Group members are canonical resource IDs only;
  presentation groups never enter the source model, export or Builder edits.
  Declared source zones are represented as `declared-zone` groups and derived
  connectivity groups as `derived-navigation`.
- Group containers use the existing ZoneNode and device cards. Hierarchical
  edges carry explicit `hierarchyVisual` and orthogonal route metadata. The
  live React Flow endpoint coordinates re-anchor each lane so the final SVG
  path contains only horizontal/vertical segments; ordinary and Runtime edges
  keep their existing Bezier behavior.
- PROJECT-090's selection-loop guard remains unchanged: the bounded hierarchy
  does not feed React Flow's large-workspace selection callback back into the
  10k projection.

## Evidence

`run_project091_arvidsjaur_layout_real_browser.py` reconciles the compiled
Chromium SVG path IDs, source/target attributes and `d` geometry against the
canonical fixture at overview, distribution and access levels. It also checks
group containers, connection-state markers, boundary indicators, Inspector
selection, page errors and outside requests, and captures four screenshots.

The exact PROJECT-086 10k workbook was not supplied in this run, so the 10k
browser evidence is explicitly labelled `synthetic-ci-fixture`. The supplied
Arvidsjaur workbooks remain available for the existing import/consent checks;
their original SHA-256 values are not replaced by synthetic data.

