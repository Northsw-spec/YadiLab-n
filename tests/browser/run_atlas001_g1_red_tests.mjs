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

  console.log("ATLAS-001 G1/G2 pure contract tests: PASS");
} finally {
  rmSync(folder, { recursive: true, force: true });
}
