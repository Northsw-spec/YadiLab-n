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
  console.log("PASS SCALE-001 hierarchical high-degree focus uses bounded deterministic fallback with source identity preserved");
} finally {
  rmSync(folder, { recursive: true, force: true });
}
