import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const folder = mkdtempSync(join(tmpdir(), "yadilab-p4b1-hierarchy-"));
try {
  const bundle = join(folder, "focus.mjs");
  await build({ entryPoints: ["ui/app/scaled-network-ten-thousand-focus.mjs"], outfile: bundle, bundle: true, format: "esm", platform: "node", target: ["node22"], logLevel: "silent" });
  const { buildScaledNetworkTenThousandFocus } = await import(pathToFileURL(bundle).href);
  const id = (index) => index === 0 ? "access-switch-000" : `client-${String(index).padStart(5, "0")}`;
  const resources = Array.from({ length: 10000 }, (_, index) => ({
    id: id(index),
    label: index === 0 ? "Access Switch with a documented high degree" : `Client workstation ${String(index).padStart(5, "0")} with a long documented hostname`,
    type: index === 0 ? "network.switch" : "endpoint.windows",
    asset: { id: "fixture_icon", version: "1.0.0" },
    interfaces: [],
    properties: {},
  }));
  const connections = [];
  for (let index = 1; index <= 99; index += 1) connections.push({ id: `link-${String(connections.length).padStart(5, "0")}`, kind: "network", from: { resource: id(0) }, to: { resource: id(index) }, properties: {} });
  for (let index = 100; index < 9999; index += 1) connections.push({ id: `link-${String(connections.length).padStart(5, "0")}`, kind: "network", from: { resource: id(index) }, to: { resource: id(index + 1) }, properties: {} });
  connections.push({ id: `link-${String(connections.length).padStart(5, "0")}`, kind: "network", from: { resource: id(100) }, to: { resource: id(101) }, properties: {} });
  connections.push({ id: `link-${String(connections.length).padStart(5, "0")}`, kind: "network", from: { resource: id(100) }, to: { resource: id(101) }, properties: {} });
  const model = {
    formatId: "infrastructure-cyber-lab.scenario", schemaVersion: "0.1.0", scenarioId: "p4b1_hierarchical_fallback",
    metadata: { title: "Deterministic hierarchical fallback" },
    assetLocks: [{ id: "fixture_icon", version: "1.0.0", path: "assets/builtin/endpoint.linux.svg", mime: "image/svg+xml", width: 64, height: 64, trusted: true }],
    zones: [], resources, connections, tests: [], findings: [], objectives: [], hints: [], notes: [], completion: { op: "all", rules: [] },
  };
  const result = await buildScaledNetworkTenThousandFocus(model, resources.map((resource) => resource.id), 1);
  assert.equal(result.canonicalNodes, 10000);
  assert.equal(result.canonicalLinks, 10000);
  assert.equal(result.focusedNodes, 100);
  assert.equal(result.focusedEdges, 99);
  assert.equal(result.layoutStrategy, "bounded-deterministic-topology");
  const positions = new Map(result.focusCanvas.nodes.map((node) => [node.id, node.position]));
  assert.ok(positions.get(id(0)).y < positions.get(id(1)).y, "fallback keeps the declared access-switch root above its clients");
  assert.ok(result.layoutDiagnostics.some((diagnostic) => diagnostic.code === "LAYOUT_UNREASONABLE_WHITESPACE" || diagnostic.code === "LAYOUT_LABEL_UNREADABLE"));
  assert.ok(result.focusCanvas.edges.every((edge) => model.connections.some((source) => source.id === edge.id && source.from.resource === edge.source && source.to.resource === edge.target)));
  const focused = await buildScaledNetworkTenThousandFocus(model, resources.map((resource) => resource.id), 1, { rootId: id(0) });
  assert.equal(focused.focusRoot, id(0));
  assert.equal(focused.focusPage.totalRootLinks, 99);
  assert.equal(focused.focusPage.visibleRootLinks, 99);
  assert.equal(focused.focusPage.visibleNeighborLinks, 0);
  assert.equal(focused.focusPage.totalVisibleLinks, 99);
  assert.equal(focused.focusedNodes, 100);
  assert.equal(focused.focusedEdges, 99);
  const focusedPositions = new Map(focused.focusCanvas.nodes.map((node) => [node.id, node.position]));
  assert.ok(focusedPositions.get(id(0)).y < focusedPositions.get(id(1)).y, "root focus preserves a branching hierarchy");

  const threeId = (index) => index === 0 ? "root-node" : index <= 30 ? `branch-${String(index).padStart(2, "0")}` : index === 31 ? "leaf-node" : `filler-${String(index).padStart(5, "0")}`;
  const threeResources = resources.map((resource, index) => ({ ...resource, id: threeId(index), label: `Node ${threeId(index)}` }));
  const threeConnections = [];
  const addThree = (from, to, suffix) => threeConnections.push({ id: `three-link-${String(threeConnections.length + 1).padStart(5, "0")}-${suffix}`, kind: "network", from: { resource: from }, to: { resource: to }, properties: {} });
  for (let index = 1; index <= 30; index += 1) addThree(threeId(0), threeId(index), "branch");
  addThree(threeId(0), threeId(1), "parallel-a");
  addThree(threeId(0), threeId(1), "parallel-b");
  addThree(threeId(1), threeId(31), "leaf");
  for (let index = 32; index < 9999; index += 1) addThree(threeId(index), threeId(index + 1), "filler");
  assert.equal(threeConnections.length, 10000);
  const threeModel = { ...model, scenarioId: "p4b1_three_level_banded_fallback", resources: threeResources, connections: threeConnections };
  const threeIds = threeResources.map((resource) => resource.id);
  const threeLevel = await buildScaledNetworkTenThousandFocus(threeModel, threeIds, 1);
  const threeLevelAgain = await buildScaledNetworkTenThousandFocus(threeModel, threeIds, 1);
  assert.equal(threeLevel.layoutStrategy, "bounded-deterministic-topology");
  assert.equal(threeLevel.layoutDiagnostics.some((diagnostic) => diagnostic.severity === "error"), false);
  assert.ok(threeLevel.layoutDiagnostics.some((diagnostic) => diagnostic.code === "SCALE_P4B1_LAYOUT_FALLBACK"));
  const threeRects = new Map(threeLevel.focusCanvas.nodes.map((node) => [node.id, { ...node.position, width: node.width, height: node.height }]));
  const threeRectsAgain = new Map(threeLevelAgain.focusCanvas.nodes.map((node) => [node.id, node.position]));
  for (const [nodeId, rect] of threeRects) {
    assert.ok(Number.isFinite(rect.x) && Number.isFinite(rect.y) && rect.width > 0 && rect.height > 0, `finite positive geometry for ${nodeId}`);
    assert.deepEqual({ x: rect.x, y: rect.y }, threeRectsAgain.get(nodeId), `deterministic position for ${nodeId}`);
  }
  const rectList = [...threeRects.entries()];
  for (let left = 0; left < rectList.length; left += 1) for (let right = left + 1; right < rectList.length; right += 1) {
    const [, a] = rectList[left]; const [, b] = rectList[right];
    const overlap = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    assert.equal(overlap, false, `fallback rectangles overlap: ${rectList[left][0]} / ${rectList[right][0]}`);
  }
  const branchYs = Array.from({ length: 30 }, (_, index) => threeRects.get(threeId(index + 1)).y);
  assert.ok(threeRects.get("root-node").y < Math.min(...branchYs));
  assert.ok(Math.max(...branchYs) < threeRects.get("leaf-node").y, "leaf occupies a later graph-level band");
  assert.ok(threeLevel.focusCanvas.edges.every((edge) => threeConnections.some((source) => source.id === edge.id && source.from.resource === edge.source && source.to.resource === edge.target)));

  const starResources = Array.from({ length: 10000 }, (_, index) => ({ ...resources[index], id: index === 0 ? "star-root" : `star-neighbor-${String(index).padStart(4, "0")}`, label: `Star ${index}` }));
  const starConnections = starResources.slice(1).map((resource, index) => ({ id: `star-link-${String(index + 1).padStart(5, "0")}`, kind: "network", from: { resource: "star-root" }, to: { resource: resource.id }, properties: {} }));
  starConnections.push({ id: "star-link-10000", kind: "network", from: { resource: "star-root" }, to: { resource: "star-neighbor-0001" }, properties: {} });
  const starModel = { ...model, scenarioId: "p4b1_focus_101_pages", resources: starResources, connections: starConnections };
  const starIds = starResources.map((resource) => resource.id);
  const starPage100 = await buildScaledNetworkTenThousandFocus(starModel, starIds, 100, { rootId: "star-root" });
  const starPage101 = await buildScaledNetworkTenThousandFocus(starModel, starIds, 101, { rootId: "star-root" });
  assert.equal(starPage100.focusPage.pageCount, 101);
  assert.equal(starPage101.focusPage.pageCount, 101);
  assert.equal(starPage100.focusPage.page, 100);
  assert.equal(starPage101.focusPage.page, 101);
  assert.ok(starPage101.focusedNodes <= 100 && starPage101.focusedEdges <= 250);
  await assert.rejects(() => buildScaledNetworkTenThousandFocus(starModel, starIds, 102, { rootId: "star-root" }), (error) => error?.code === "SCALE_P4B1_SELECTION_BLOCKED");
  await assert.rejects(() => buildScaledNetworkTenThousandFocus(starModel, starIds, 0, { rootId: "star-root" }), (error) => error?.code === "SCALE_P4B1_SELECTION_BLOCKED");
  await assert.rejects(() => buildScaledNetworkTenThousandFocus(starModel, starIds, 1.5, { rootId: "star-root" }), (error) => error?.code === "SCALE_P4B1_SELECTION_BLOCKED");
  await assert.rejects(() => buildScaledNetworkTenThousandFocus(starModel, starIds, Number.NaN, { rootId: "star-root" }), (error) => error?.code === "SCALE_P4B1_SELECTION_BLOCKED");
  await assert.rejects(() => buildScaledNetworkTenThousandFocus(starModel, starIds, 101), (error) => error?.code === "SCALE_P4B1_SELECTION_BLOCKED");
  console.log("PASS SCALE-001 hierarchical high-degree focus uses bounded deterministic fallback with source identity preserved");
} finally {
  rmSync(folder, { recursive: true, force: true });
}
