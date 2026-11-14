import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectScenarioToCanvas } from "../../dist-browser-test/ui/src/canvas/projection.js";
import { computeOrthogonalRoutes } from "../../dist-browser-test/ui/src/canvas/topology-edge-routing.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-normalized.json"), "utf8"));
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };

function resource(id, type = "network.switch", zone) {
  return {
    id,
    type,
    label: id,
    ...(zone ? { zone } : {}),
    properties: {},
    interfaces: [],
    asset: { id: "actor.attacker", version: "1.0.0" },
  };
}

function makeScenario(ids, links, types = {}, zones = []) {
  return {
    ...base,
    scenarioId: `project088-${ids.join("-")}`,
    sourceHash: "project088-test-hash",
    zones,
    resources: ids.map((id) => resource(id, types[id] ?? "network.switch", zones.length ? zones[0].id : undefined)),
    connections: links.map(([id, from, to]) => ({ id, kind: "network", from: { resource: from }, to: { resource: to }, properties: {} })),
  };
}

function layoutFor(scenario, positions) {
  return {
    formatId: "infrastructure-cyber-lab.layout",
    schemaVersion: "0.1.0",
    scenarioId: scenario.scenarioId,
    engine: "elk.layered",
    nodes: scenario.nodes?.map(() => null) ?? scenario.resources.map((node) => ({
      id: node.id,
      x: positions[node.id]?.x ?? 0,
      y: positions[node.id]?.y ?? 0,
      width: 180,
      height: 96,
    })),
  };
}

function routeSegments(route, source, target) {
  const points = [
    { x: source.position.x + source.width, y: source.position.y + source.height / 2 },
    ...(route ?? []),
    { x: target.position.x, y: target.position.y + target.height / 2 },
  ];
  return points.slice(1).map((point, index) => [points[index], point]);
}

function segmentHitsNode([a, b], node) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return a.x === b.x
    ? a.x > node.position.x && a.x < node.position.x + node.width && maxY > node.position.y && minY < node.position.y + node.height
    : a.y === b.y
      ? a.y > node.position.y && a.y < node.position.y + node.height && maxX > node.position.x && minX < node.position.x + node.width
      : true;
}

function overlaps(a, b) {
  return a.position.x < b.position.x + b.width && a.position.x + a.width > b.position.x
    && a.position.y < b.position.y + b.height && a.position.y + a.height > b.position.y;
}

function verifyGraph(name, ids, links, positions, types = {}, zones = []) {
  const scenario = makeScenario(ids, links, types, zones);
  const projection = projectScenarioToCanvas(scenario, layoutFor(scenario, positions));
  const resourceNodes = projection.nodes.filter((node) => node.type === "resource");
  equal(resourceNodes.length, ids.length, `${name}: every canonical resource is rendered`);
  equal(projection.edges.length, links.length, `${name}: every canonical link is rendered`);
  equal(projection.edges.map((edge) => edge.id), links.map(([id]) => id).sort((a, b) => a.localeCompare(b)), `${name}: edge IDs remain canonical`);
  const sortPairs = (pairs) => pairs.slice().sort(([a, b], [c, d]) => `${a}\u0000${b}`.localeCompare(`${c}\u0000${d}`));
  equal(sortPairs(projection.edges.map((edge) => [edge.source, edge.target])), sortPairs(links.map(([, from, to]) => [from, to])), `${name}: endpoint pairs remain canonical`);
  ok(projection.nodes.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y)), `${name}: finite node geometry`);
  ok(resourceNodes.every((node, index) => resourceNodes.every((other, otherIndex) => index === otherIndex || !overlaps(node, other))), `${name}: resource nodes do not overlap`);
  const routes = computeOrthogonalRoutes(resourceNodes, projection.edges);
  ok([...routes.values()].every((points) => points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))), `${name}: route points are finite`);
  for (const edge of projection.edges) {
    const source = resourceNodes.find((node) => node.id === edge.source);
    const target = resourceNodes.find((node) => node.id === edge.target);
    const segments = routeSegments(routes.get(edge.id), source, target);
    const foreign = resourceNodes.filter((node) => node.id !== edge.source && node.id !== edge.target);
    ok(segments.every(([from, to]) => from.x === to.x || from.y === to.y), `${name}: ${edge.id} remains orthogonal`);
    ok(foreign.every((node) => !segments.some((segment) => segmentHitsNode(segment, node))), `${name}: ${edge.id} avoids foreign nodes`);
  }
  return projection;
}

const chainIds = ["router", "firewall", "core", "access", "client"];
verifyGraph("chain", chainIds, [["c1", "router", "firewall"], ["c2", "firewall", "core"], ["c3", "core", "access"], ["c4", "access", "client"]], {
  router: { x: 0, y: 0 }, firewall: { x: 260, y: 0 }, core: { x: 520, y: 0 }, access: { x: 780, y: 0 }, client: { x: 1040, y: 0 },
}, { router: "network.router", firewall: "network.firewall", core: "network.core", access: "network.access", client: "endpoint.windows" });

const starIds = ["switch", ...Array.from({ length: 38 }, (_, index) => `client-${String(index + 1).padStart(2, "0")}`)];
const starLinks = starIds.slice(1).map((id, index) => [`s${index + 1}`, "switch", id]);
const starPositions = Object.fromEntries(starIds.slice(1).map((id, index) => [id, { x: 420 + (index % 6) * 230, y: 160 + Math.floor(index / 6) * 150 }]));
starPositions.switch = { x: 0, y: 500 };
verifyGraph("star", starIds, starLinks, starPositions);

const treeIds = ["root", "branch-a", "branch-b", "leaf-a1", "leaf-a2", "leaf-b1", "leaf-b2"];
verifyGraph("tree", treeIds, [["t1", "root", "branch-a"], ["t2", "root", "branch-b"], ["t3", "branch-a", "leaf-a1"], ["t4", "branch-a", "leaf-a2"], ["t5", "branch-b", "leaf-b1"], ["t6", "branch-b", "leaf-b2"]], {
  root: { x: 0, y: 200 }, "branch-a": { x: 300, y: 0 }, "branch-b": { x: 300, y: 400 }, "leaf-a1": { x: 650, y: 0 }, "leaf-a2": { x: 650, y: 150 }, "leaf-b1": { x: 650, y: 400 }, "leaf-b2": { x: 650, y: 550 },
});

const ringIds = ["ring-a", "ring-b", "ring-c", "ring-d"];
verifyGraph("ring", ringIds, [["r1", "ring-a", "ring-b"], ["r2", "ring-b", "ring-c"], ["r3", "ring-c", "ring-d"], ["r4", "ring-d", "ring-a"]], {
  "ring-a": { x: 0, y: 0 }, "ring-b": { x: 400, y: 0 }, "ring-c": { x: 400, y: 300 }, "ring-d": { x: 0, y: 300 },
});

const parallel = verifyGraph("parallel", ["left", "right"], [["p1", "left", "right"], ["p2", "left", "right"], ["p3", "left", "right"]], { left: { x: 0, y: 0 }, right: { x: 500, y: 0 } });
const parallelRoutes = computeOrthogonalRoutes(parallel.nodes.filter((node) => node.type === "resource"), parallel.edges);
equal(new Set([...parallelRoutes.values()].map((points) => JSON.stringify(points))).size, 3, "parallel links receive distinct deterministic routes");

// F2 regression: source/target handles must both anchor to their declared
// interfaces even when an obstacle forces a detour.  Before the focused
// routing fix, the `in:` prefix was sliced as if it were four characters;
// target handles fell back to the card centre and produced diagonal SVG
// segments for the first/last parallel lanes.
const routedInterfaces = Array.from({ length: 3 }, (_, index) => ({
  interfaceId: `p${index}`,
  label: `p${index}`,
  addresses: [],
  stateLabel: "DECLARED",
  sourceHandleId: `out:p${index}`,
  targetHandleId: `in:p${index}`,
}));
const routedResource = (id, x, y, interfaces = routedInterfaces) => ({
  id,
  type: "resource",
  position: { x, y },
  width: 180,
  height: 96,
  layoutStatus: "resolved",
  data: {
    semanticId: id,
    semanticKind: "resource",
    label: id,
    resourceType: "network.switch",
    deviceFamily: "network",
    deviceRoleLabel: "Switch",
    interfaces,
  },
});
const routedNodes = [
  routedResource("route-source", 520, 400),
  routedResource("route-target", 7000, 300),
  routedResource("route-obstacle", 3000, 250, []),
];
const routedEdges = routedInterfaces.map((iface, index) => ({
  id: `route-${index}`,
  type: "semantic",
  source: "route-source",
  target: "route-target",
  sourceHandle: iface.sourceHandleId,
  targetHandle: iface.targetHandleId,
  data: { semanticId: `route-${index}`, connectionKind: "network", properties: {}, visual: {} },
}));
const routed = computeOrthogonalRoutes(routedNodes, routedEdges);
for (const edge of routedEdges) {
  const index = Number(edge.sourceHandle.slice(-1));
  const source = routedNodes[0];
  const target = routedNodes[1];
  const sourceY = source.position.y + source.height * (0.2 + (index + 1) * 0.6 / (routedInterfaces.length + 1));
  const targetY = target.position.y + target.height * (0.2 + (index + 1) * 0.6 / (routedInterfaces.length + 1));
  const points = [
    { x: source.position.x + source.width, y: sourceY },
    ...(routed.get(edge.id) ?? []),
    { x: target.position.x, y: targetY },
  ];
  ok(points.slice(1).every((point, pointIndex) => {
    const previous = points[pointIndex];
    return point.x === previous.x || point.y === previous.y;
  }), `${edge.id}: declared interface handles keep detour orthogonal`);
}

verifyGraph("disconnected", ["a", "b", "c", "d"], [["d1", "a", "b"], ["d2", "c", "d"]], { a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, c: { x: 0, y: 300 }, d: { x: 300, y: 300 } });
verifyGraph("mixed-zones", ["router-z", "fw-z", "server-z", "client-z"], [["m1", "router-z", "fw-z"], ["m2", "fw-z", "server-z"], ["m3", "server-z", "client-z"]], {
  "router-z": { x: 0, y: 0 }, "fw-z": { x: 320, y: 0 }, "server-z": { x: 640, y: 160 }, "client-z": { x: 960, y: 160 },
}, { "router-z": "network.router", "fw-z": "network.firewall", "server-z": "server.generic", "client-z": "endpoint.windows" }, [{ id: "zone-1", label: "Documented LAN", kind: "lan" }]);

const manual = makeScenario(["manual-a", "manual-b"], [["manual-link", "manual-a", "manual-b"]]);
const manualProjection = projectScenarioToCanvas(manual, layoutFor(manual, { "manual-a": { x: 720, y: 40 }, "manual-b": { x: 80, y: 240 } }));
equal(manualProjection.nodes.find((node) => node.id === "manual-a").position, { x: 720, y: 40 }, "manual layout position is preserved");
equal(manualProjection.nodes.find((node) => node.id === "manual-b").position, { x: 80, y: 240 }, "second manual layout position is preserved");

console.log(`PASS PROJECT-088 topology models: ${checks} assertions across chain/star/tree/ring/parallel/disconnected/mixed-zone/manual graphs.`);
