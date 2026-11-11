import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const folder = mkdtempSync(join(tmpdir(), "yadilab-project090-hierarchy-"));
try {
  const bundle = join(folder, "hierarchy.mjs");
  await build({ entryPoints: ["ui/src/canvas/hierarchical-topology.ts"], outfile: bundle, bundle: true, format: "esm", platform: "node", target: ["node22"], logLevel: "silent" });
  const { buildHierarchicalTopologyIndex, buildHierarchicalTopologyView } = await import(pathToFileURL(bundle).href);
  const core = (index) => `core-${String(index).padStart(3, "0")}`;
  const distribution = (index) => `distribution-${String(index).padStart(4, "0")}`;
  const access = (index) => `access-${String(index).padStart(4, "0")}`;
  const client = (index) => `client-${String(index).padStart(5, "0")}`;
  const asset = { id: "fixture-icon", version: "1.0.0" };
  const resources = [
    ...[1, 2].map((index) => ({ id: core(index), label: `Core ${index}`, type: "network.core", asset, interfaces: [], properties: {} })),
    ...Array.from({ length: 32 }, (_, index) => ({ id: distribution(index + 1), label: `Distribution ${index + 1}`, type: "network.distribution", asset, interfaces: [], properties: {} })),
    ...Array.from({ length: 256 }, (_, index) => ({ id: access(index + 1), label: `Access Switch ${index + 1}`, type: "network.access", asset, interfaces: [], properties: {} })),
    ...Array.from({ length: 9710 }, (_, index) => ({ id: client(index + 1), label: `Client ${index + 1}`, type: "endpoint.windows", asset, interfaces: [], properties: {} })),
  ];
  const connections = [];
  let sequence = 1;
  const add = (from, to) => connections.push({ id: `link-${String(sequence++).padStart(5, "0")}`, kind: "network", from: { resource: from }, to: { resource: to }, properties: {} });
  add(core(1), core(2));
  add(core(1), core(2));
  for (let index = 1; index <= 32; index += 1) add(distribution(index), core(index <= 16 ? 1 : 2));
  for (let index = 1; index <= 256; index += 1) add(access(index), distribution(Math.floor((index - 1) / 8) + 1));
  let clientIndex = 1;
  for (let switchIndex = 1; switchIndex <= 256; switchIndex += 1) {
    const count = switchIndex <= 18 ? 37 : 38;
    for (let offset = 0; offset < count; offset += 1) add(access(switchIndex), client(clientIndex++));
  }
  assert.equal(resources.length, 10000);
  assert.equal(connections.length, 10000);
  const model = { scenarioId: "project090-fixture", sourceHash: "fixture-source-hash", assetLocks: [{ ...asset, path: "assets/builtin/endpoint.windows.svg", mime: "image/svg+xml", width: 160, height: 100, trusted: true }], resources, connections };
  const index = buildHierarchicalTopologyIndex(model);
  assert.deepEqual(index.roleCounts, { core: 2, distribution: 32, access: 256, endpoint: 9710, device: 0 });
  assert.equal(index.overviewNodeIds.length, 34, "overview contains only actual core/distribution devices");
  assert.equal(index.overviewEdgeIds.length, 34, "overview contains only actual core/distribution links");
  const overview = buildHierarchicalTopologyView(index);
  assert.equal(overview.nodeIds.length, 34);
  assert.equal(overview.edgeIds.length, 34);
  assert.equal(overview.hiddenConnectionCount, 9966);
  assert.equal(new Set(overview.edgeIds).size, overview.edgeIds.length);
  assert.ok(overview.projection.nodes.every((node) => overview.nodeIds.includes(node.id)));
  assert.ok(overview.projection.edges.every((edge) => overview.edgeIds.includes(edge.id)));
  const distributionView = buildHierarchicalTopologyView(index, "branch", distribution(4));
  assert.equal(distributionView.nodeIds.length, 10, "distribution branch keeps its upstream core and eight access switches");
  assert.equal(distributionView.visibleConnectionCount, 9);
  const distributionNodeSet = new Set(distributionView.nodeIds);
  const expectedDistributionBoundary = connections.filter((connection) => distributionNodeSet.has(connection.from.resource) !== distributionNodeSet.has(connection.to.resource)).length;
  assert.equal(distributionView.hiddenBoundaryConnectionCount, expectedDistributionBoundary, "cross-boundary links remain truthful and unaggregated");
  const accessView = buildHierarchicalTopologyView(index, "branch", access(2));
  assert.equal(accessView.nodeIds.length, 39, "access branch keeps its switch and 38 connected clients plus upstream");
  assert.equal(accessView.visibleConnectionCount, 38);
  assert.equal(accessView.hiddenConnectionCount, 9962);
  assert.ok(accessView.projection.nodes.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y)));
  assert.ok(accessView.projection.edges.every((edge) => connections.some((source) => source.id === edge.id && source.from.resource === edge.source && source.to.resource === edge.target)));
  const accessAgain = buildHierarchicalTopologyView(index, "branch", access(2));
  assert.deepEqual(accessAgain.projection.nodes.map((node) => [node.id, node.position]), accessView.projection.nodes.map((node) => [node.id, node.position]), "navigation is deterministic");

  const irregular = {
    scenarioId: "project090-irregular", sourceHash: "irregular-source-hash",
    resources: [
      { id: "root", label: "Root", type: "network.router", asset, interfaces: [], properties: {} },
      { id: "mesh-a", label: "Mesh A", type: "network.switch", asset, interfaces: [], properties: {} },
      { id: "mesh-b", label: "Mesh B", type: "network.switch", asset, interfaces: [], properties: {} },
      { id: "isolated", label: "Isolated", type: "endpoint.linux", asset, interfaces: [], properties: {} },
    ],
    assetLocks: [{ ...asset, path: "assets/builtin/endpoint.windows.svg", mime: "image/svg+xml", width: 160, height: 100, trusted: true }],
    connections: [
      { id: "edge-a", kind: "network", from: { resource: "root" }, to: { resource: "mesh-a" }, properties: {} },
      { id: "edge-b", kind: "network", from: { resource: "root" }, to: { resource: "mesh-b" }, properties: {} },
      { id: "edge-parallel", kind: "network", from: { resource: "root" }, to: { resource: "mesh-a" }, properties: {} },
      { id: "edge-ring", kind: "network", from: { resource: "mesh-a" }, to: { resource: "mesh-b" }, properties: {} },
    ],
  };
  const irregularIndex = buildHierarchicalTopologyIndex(irregular);
  const irregularView = buildHierarchicalTopologyView(irregularIndex, "branch", "root");
  assert.equal(irregularView.edgeIds.length, 4, "parallel and mesh links remain distinct");
  assert.equal(irregularView.hiddenNodeCount, 1, "disconnected device remains canonical but outside the bounded view");
  assert.equal(new Set(irregularView.edgeIds).size, 4);
  console.log("PASS PROJECT-090 hierarchy preserves canonical 10k identities, links, cross-boundary counts and deterministic bounded views");
} finally {
  rmSync(folder, { recursive: true, force: true });
}
