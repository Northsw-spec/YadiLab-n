import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const folder = mkdtempSync(join(tmpdir(), "yadilab-project091-layout-"));
try {
  const bundle = join(folder, "hierarchy.mjs");
  await build({ entryPoints: ["ui/src/canvas/hierarchical-topology.ts"], outfile: bundle, bundle: true, format: "esm", platform: "node", target: ["node22"], logLevel: "silent" });
  const { buildHierarchicalTopologyIndex, buildHierarchicalTopologyView, partitionConnections } = await import(pathToFileURL(bundle).href);
  const asset = { id: "fixture-icon", version: "1.0.0" };
  const core = (n) => `core-${n}`;
  const dist = (n) => `dist-${String(n).padStart(2, "0")}`;
  const access = (n) => `access-${String(n).padStart(2, "0")}`;
  const client = (n) => `client-${String(n).padStart(2, "0")}`;
  const resources = [
    ...[1, 2].map((n) => ({ id: core(n), label: `Core ${n}`, type: "network.core", asset, interfaces: [], properties: {} })),
    ...Array.from({ length: 16 }, (_, i) => ({ id: dist(i + 1), label: `Distribution ${i + 1}`, type: "network.distribution", asset, interfaces: [], properties: {} })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: access(i + 1), label: `Access ${i + 1}`, type: "network.access", asset, interfaces: [], properties: {} })),
    ...Array.from({ length: 32 }, (_, i) => ({ id: client(i + 1), label: `Client ${i + 1}`, type: "endpoint.windows", asset, interfaces: [], properties: {} })),
  ];
  const connections = [];
  let sequence = 1;
  const add = (from, to) => connections.push({ id: `link-${String(sequence++).padStart(3, "0")}`, kind: "network", from: { resource: from }, to: { resource: to }, properties: {} });
  add(core(1), core(2));
  for (let i = 1; i <= 16; i += 1) add(dist(i), core(i <= 8 ? 1 : 2));
  for (let i = 1; i <= 8; i += 1) add(access(i), dist(Math.ceil(i / 2)));
  for (let i = 1; i <= 8; i += 1) for (let j = 0; j < 4; j += 1) add(access(i), client((i - 1) * 4 + j + 1));
  add(access(1), dist(1)); // parallel source link must remain independent
  const model = {
    scenarioId: "project091-layout-fixture",
    sourceHash: "project091-source",
    assetLocks: [{ ...asset, path: "assets/builtin/endpoint.windows.svg", mime: "image/svg+xml", width: 160, height: 100, trusted: true }],
    resources,
    connections,
  };
  const index = buildHierarchicalTopologyIndex(model);
  const overview = buildHierarchicalTopologyView(index);
  assert.equal(overview.navigationGroups.length, 3, "overview derives core plus two distribution presentation chunks");
  assert.ok(overview.projection.nodes.some((node) => node.type === "zone"), "presentation groups are visible zones");
  assert.equal(overview.projection.edges.length, overview.partition.internal.length, "overview keeps every visible source link");
  assert.ok(overview.projection.edges.every((edge) => edge.data.hierarchyVisual === true && edge.data.routeKind === "orthogonal"), "overview edges are explicitly orthogonal");
  const branch = buildHierarchicalTopologyView(index, "branch", access(1));
  const visible = new Set(branch.nodeIds);
  const expected = partitionConnections(index.connections, visible).internal.map((link) => link.id).sort();
  assert.deepEqual(branch.projection.edges.map((edge) => edge.id).sort(), expected, "access branch has lossless visible-link selection");
  assert.ok(branch.navigationGroups.length >= 3, "access branch groups upstream, root and endpoints");
  assert.ok(branch.projection.nodes.filter((node) => node.type === "resource").every((node) => node.data.connectionState), "every visible device has an explicit connection state");
  for (const edge of branch.projection.edges) {
    const original = index.connectionsById.get(edge.id);
    assert.ok(original, `fabricated connection ${edge.id}`);
    assert.equal(edge.source, original.from.resource);
    assert.equal(edge.target, original.to.resource);
    assert.equal(edge.data.hierarchyVisual, true);
    assert.equal(edge.data.routeKind, "orthogonal");
  }
  console.log("PASS PROJECT-091 grouped hierarchy, lossless links, connection states and orthogonal routes");
} finally {
  rmSync(folder, { recursive: true, force: true });
}
