import assert from "node:assert/strict";
import { orthogonalEdgePath, resolveHierarchicalFallbackLaneX } from "../../ui/app/semantic-edge-routing.mjs";

const absentRoute = resolveHierarchicalFallbackLaneX({
  data: { hierarchyVisual: true, routeKind: "orthogonal" },
  sourceX: 10,
  targetX: 90,
});
assert.equal(absentRoute.isHierarchical, true, "hierarchical edge remains hierarchical when route is absent");
assert.deepEqual(absentRoute.route, [], "missing route is normalized to an empty route");
assert.equal(absentRoute.fallbackLaneX, 50, "missing route uses the finite midpoint lane");
const [absentPath] = orthogonalEdgePath({
  sourceX: 10,
  sourceY: 20,
  targetX: 90,
  targetY: 140,
  points: [
    { x: absentRoute.fallbackLaneX, y: 20 },
    { x: absentRoute.fallbackLaneX, y: 140 },
  ],
});
assert.match(absentPath, /^M 10 20 L 50 20 L 50 140 L 90 140$/);
assert.doesNotMatch(absentPath, /[CQSAZcqsa]/, "missing route still renders a polyline");

const malformedRoute = resolveHierarchicalFallbackLaneX({
  data: { hierarchyVisual: true, routeKind: "orthogonal", route: [{ x: "not-a-number", y: 40 }] },
  sourceX: 10,
  targetX: 90,
});
assert.equal(malformedRoute.fallbackLaneX, 50, "non-finite route coordinate fails closed to midpoint");

const validRoute = resolveHierarchicalFallbackLaneX({
  data: { hierarchyVisual: true, routeKind: "orthogonal", route: [{ x: 44, y: 40 }] },
  sourceX: 10,
  targetX: 90,
});
assert.equal(validRoute.fallbackLaneX, 44, "finite route coordinate remains available to the renderer");

console.log("PASS PROJECT-091 hierarchical edge renderer handles absent and malformed routes");
