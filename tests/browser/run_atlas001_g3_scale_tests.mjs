import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const folder = mkdtempSync(join(tmpdir(), "yadilab-atlas001-g3-scale-"));
try {
  const atlasBundle = join(folder, "atlas-topology.mjs");
  const projectionBundle = join(folder, "projection.mjs");
  await build({ entryPoints: ["ui/src/canvas/atlas-topology.ts"], outfile: atlasBundle, bundle: true, format: "esm", platform: "node", target: ["node22"], logLevel: "silent" });
  await build({ entryPoints: ["ui/src/canvas/projection.ts"], outfile: projectionBundle, bundle: true, format: "esm", platform: "node", target: ["node22"], logLevel: "silent" });
  const { buildAtlasIndex, projectAtlasPage } = await import(pathToFileURL(atlasBundle).href);
  const { projectScenarioSubsetToCanvas } = await import(pathToFileURL(projectionBundle).href);

  const resources = Array.from({ length: 500 }, (_, index) => ({ id: `device-${String(index).padStart(4, "0")}`, label: `Device ${index}`, type: "network.switch", interfaces: [{ id: "eth0", addresses: [] }] }));
  const connections = Array.from({ length: 499 }, (_, index) => ({ id: `link-${String(index).padStart(4, "0")}`, from: { resource: resources[index].id, port: "eth0" }, to: { resource: resources[index + 1].id, port: "eth0" } }));
  const canonical = { sourceIdentity: "synthetic-500-atlas-g3", resources, connections };
  const before = JSON.stringify(canonical);
  const rules = { version: "atlas-001-g3-scale-v1", targetNodesPerPage: 60, maxNodesPerPage: 100, maxInternalLinksPerPage: 250 };
  const index = buildAtlasIndex(canonical, rules);
  const repeat = buildAtlasIndex(canonical, rules);
  assert.equal(index.pages.length, 9);
  assert.deepEqual(index.pages, repeat.pages, "500-node page membership must be deterministic");
  assert.equal(index.pages.reduce((sum, page) => sum + page.resourceIds.length, 0), 500);
  assert.equal(index.pages.flatMap((page) => page.resourceIds).length, new Set(index.pages.flatMap((page) => page.resourceIds)).size);
  assert.equal(index.connectionClassification.size, 499);
  for (const classifications of index.connectionClassification.values()) assert.equal(classifications.size, index.pages.length);
  assert.equal(JSON.stringify(canonical), before, "Scale indexing must not mutate canonical source");

  const first = projectAtlasPage(canonical, index, index.pages[0].id);
  assert.equal(first.resources.length, 60);
  assert.equal(first.connections.length, 59);
  assert.ok(first.page.boundaryConnectionIds.length > 0);

  const asset = { id: "fixture_icon", version: "1.0.0" };
  const normalized = {
    formatId: "infrastructure-cyber-lab.scenario", schemaVersion: "1.0.0", scenarioId: "atlas-g3-scale", sourceHash: "atlas-g3-scale-source",
    metadata: { title: "Atlas G3 scale", description: "", language: "en", authors: [], tags: [], briefing: "" }, minimumEngineVersion: "1.0.0", capabilityLocks: [], profileLocks: [],
    zones: [], resources: resources.map((resource) => ({ ...resource, asset, properties: {} })), connections: connections.map((connection) => ({ ...connection, kind: "network", properties: {} })),
    tests: [], findings: [], objectives: [], completion: { op: "all", rules: [] }, hints: [], assetLocks: [{ id: "fixture_icon", version: "1.0.0", path: "assets/builtin/endpoint.linux.svg", mime: "image/svg+xml", width: 64, height: 64, trusted: true }],
  };
  const boundedCanvas = projectScenarioSubsetToCanvas(normalized, first.page.resourceIds, first.page.internalConnectionIds);
  assert.equal(boundedCanvas.nodes.filter((node) => node.type === "resource").length, 60);
  assert.equal(boundedCanvas.edges.length, 59);
  assert.ok(boundedCanvas.nodes.every((node) => index.pages[0].resourceIds.includes(node.id)));
  assert.ok(boundedCanvas.edges.every((edge) => first.page.internalConnectionIds.includes(edge.id)));

  console.log("ATLAS-001 G3 synthetic 500-node bounded-scale control: PASS");
} finally {
  rmSync(folder, { recursive: true, force: true });
}
