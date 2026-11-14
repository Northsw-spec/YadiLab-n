import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const folder = mkdtempSync(join(tmpdir(), "yadilab-atlas001-g1-"));
try {
  const bundle = join(folder, "atlas-topology.mjs");
  await build({ entryPoints: ["ui/src/canvas/atlas-topology.ts"], outfile: bundle, bundle: true, format: "esm", platform: "node", target: ["node22"], logLevel: "silent" });
  const { buildAtlasIndex, projectAtlasPage } = await import(pathToFileURL(bundle).href);
  assert.equal(typeof buildAtlasIndex, "function");
  assert.equal(typeof projectAtlasPage, "function");

  const fixture = JSON.parse(readFileSync("docs/design/atlas-001/ATLAS_TVAA_SIDOR_SYNTHETISK_V1.json", "utf8"));
  const pageAssignments = Object.fromEntries(fixture.pages.flatMap((page) => page.resourceIds.map((id) => [id, page.pageId])));
  const canonical = {
    sourceIdentity: fixture.sourceIdentity,
    resources: fixture.resources,
    connections: fixture.connections,
  };
  const before = JSON.stringify(canonical);
  const index = buildAtlasIndex(canonical, { version: "atlas-001-contract-v1", pageAssignments, targetNodesPerPage: 100, maxNodesPerPage: 100, maxInternalLinksPerPage: 250 });
  assert.equal(index.pages.length, 2);
  const pageA = index.pageById.get("page-A");
  const pageB = index.pageById.get("page-B");
  assert.ok(pageA && pageB);
  assert.deepEqual(pageA.internalConnectionIds, ["link-core", "link-perimeter"]);
  assert.deepEqual(pageB.internalConnectionIds, ["link-clients", "link-servers"]);
  assert.deepEqual(pageA.boundaryConnectionIds, ["link-cross-other", "link-cross-parallel-1", "link-cross-parallel-2"]);
  assert.deepEqual(pageB.boundaryConnectionIds, ["link-cross-other", "link-cross-parallel-1", "link-cross-parallel-2"]);
  assert.deepEqual(pageA.externalConnectionIds, ["link-clients", "link-servers"]);
  assert.deepEqual(pageB.externalConnectionIds, ["link-core", "link-perimeter"]);
  assert.equal(pageA.boundaryReferences.length + pageB.boundaryReferences.length, 6);
  assert.deepEqual(pageA.boundaryReferences.filter((ref) => ref.originalConnectionId === "link-cross-parallel-1")[0], {
    originalConnectionId: "link-cross-parallel-1",
    localResourceId: "firewall01",
    localPortId: "dmz",
    remoteResourceId: "server01",
    remotePortId: "eth1",
    destinationPageId: "page-B",
    classification: "boundary",
  });
  const projectionA = projectAtlasPage(canonical, index, "page-A");
  assert.deepEqual(projectionA.connections.map((connection) => connection.id), ["link-core", "link-perimeter"]);
  assert.equal(JSON.stringify(canonical), before, "Atlas indexing must not mutate canonical source");

  const repeat = buildAtlasIndex(canonical, { version: "atlas-001-contract-v1", pageAssignments, targetNodesPerPage: 100, maxNodesPerPage: 100, maxInternalLinksPerPage: 250 });
  assert.deepEqual(repeat.pages, index.pages, "same input must yield byte-stable page metadata");

  assert.throws(() => buildAtlasIndex({ ...canonical, connections: [{ ...fixture.connections[0], from: { ...fixture.connections[0].from, resource: "missing" } }] }, { pageAssignments }), /ATLAS_UNKNOWN_ENDPOINT_RESOURCE/);
  assert.throws(() => buildAtlasIndex({ ...canonical, connections: [{ ...fixture.connections[0], from: { ...fixture.connections[0].from, port: 7 } }] }, { pageAssignments }), /ATLAS_INVALID_ENDPOINT_PORT/);

  const budgetModel = { sourceIdentity: "budget", resources: Array.from({ length: 101 }, (_, i) => ({ id: `r-${String(i).padStart(3, "0")}` })), connections: [] };
  const budgetIndex = buildAtlasIndex(budgetModel, { version: "atlas-001-contract-v1", targetNodesPerPage: 60, maxNodesPerPage: 100, maxInternalLinksPerPage: 250 });
  assert.equal(budgetIndex.pages.length, 2, "101 resources must split deterministically");
  assert.deepEqual(budgetIndex.pages.map((page) => page.resourceIds.length), [60, 41]);

  // G3 red reproduction: the old Atlas path was gated by vm?.canvas.  A
  // valid canonical model with no full Canvas therefore had no renderable
  // page.  The bounded projection entrypoint must exist and produce only the
  // selected resource/link subset after the product fix.
  const projectionBundle = join(folder, "projection.mjs");
  await build({ entryPoints: ["ui/src/canvas/projection.ts"], outfile: projectionBundle, bundle: true, format: "esm", platform: "node", target: ["node22"], logLevel: "silent" });
  const { projectScenarioSubsetToCanvas } = await import(pathToFileURL(projectionBundle).href);
  assert.equal(typeof projectScenarioSubsetToCanvas, "function", "bounded Atlas projection must be exposed by the existing Canvas projection");
  const boundedScenario = {
    formatId: "infrastructure-cyber-lab.scenario",
    schemaVersion: "1.0.0",
    scenarioId: "atlas-g3-red",
    sourceHash: "source-g3-red",
    metadata: { title: "G3", description: "", language: "en", authors: [], tags: [], briefing: "" },
    minimumEngineVersion: "1.0.0",
    capabilityLocks: [],
    profileLocks: [],
    zones: [],
    resources: [
      { id: "page-a", type: "server", label: "Page A", asset: { id: "fixture_icon", version: "1.0.0" }, interfaces: [{ id: "eth0", label: "eth0", addresses: [] }], properties: {} },
      { id: "page-b", type: "client", label: "Page B", asset: { id: "fixture_icon", version: "1.0.0" }, interfaces: [{ id: "eth0", label: "eth0", addresses: [] }], properties: {} },
      { id: "outside", type: "client", label: "Outside", asset: { id: "fixture_icon", version: "1.0.0" }, interfaces: [{ id: "eth0", label: "eth0", addresses: [] }], properties: {} },
    ],
    connections: [
      { id: "link-internal", kind: "network", from: { resource: "page-a", port: "eth0" }, to: { resource: "page-b", port: "eth0" }, properties: {} },
      { id: "link-boundary", kind: "network", from: { resource: "page-b", port: "eth0" }, to: { resource: "outside", port: "eth0" }, properties: {} },
    ],
    tests: [], findings: [], objectives: [], completion: { op: "all", rules: [] }, hints: [], assetLocks: [{ id: "fixture_icon", version: "1.0.0", path: "assets/builtin/endpoint.linux.svg", mime: "image/svg+xml", width: 64, height: 64, trusted: true }],
  };
  const g3Canvas = projectScenarioSubsetToCanvas(boundedScenario, ["page-a", "page-b"], ["link-internal"]);
  assert.deepEqual(g3Canvas.nodes.map((node) => node.id), ["page-a", "page-b"]);
  assert.deepEqual(g3Canvas.edges.map((edge) => edge.id), ["link-internal"]);
  assert.equal(g3Canvas.edges[0].sourceHandle, "out:eth0");
  assert.equal(g3Canvas.edges[0].targetHandle, "in:eth0");

  const acceptanceSource = readFileSync("tests/acceptance/run_atlas001_real_browser.py", "utf8");
  assert.match(acceptanceSource, /data-atlas-layout-quality.*PASS/, "G3 acceptance must require final PASS quality");
  assert.doesNotMatch(acceptanceSource, /data-atlas-layout-status=\"PENDING\".*data-atlas-layout-quality/, "G3 acceptance must not accept PENDING as a final layout");

  console.log("ATLAS-001 G1/G2 pure contract tests: PASS");
} finally {
  rmSync(folder, { recursive: true, force: true });
}
