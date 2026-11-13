import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createXlsxImportAdapter, mapNetworkWorkbookToScenario, normalizeNetworkInventoryDocument, validateNetworkWorkbook } from "../../dist-enterprise-import-test/enterprise-import/src/index.js";
import { nodeZipArchiveBackend } from "./node_zip_backend.mjs";

const temp = mkdtempSync(join(tmpdir(), "yadilab-atlas001-g4-"));
const atlasBundle = join(temp, "atlas-topology.mjs");
await build({ entryPoints: ["ui/src/canvas/atlas-topology.ts"], outfile: atlasBundle, bundle: true, format: "esm", platform: "node", target: ["node22"], logLevel: "silent" });
const { buildAtlasIndex } = await import(pathToFileURL(atlasBundle).href);

const fixturePath = "tests/fixtures/import/atlas001-g4-500.xlsx";
const bytes = new Uint8Array(fs.readFileSync(fixturePath));
const expectedSha = "84a32fb149903e89488ec656d036622b5b81b7086c84b8352f24138273e48fde";
const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
const sha = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
assert.equal(sha, expectedSha, "synthetic-xlsx-fixture bytes changed");

const parsed = await createXlsxImportAdapter(nodeZipArchiveBackend).parse({ bytes, mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, { options: {} });
const normalized = normalizeNetworkInventoryDocument(parsed.document);
const mapped = mapNetworkWorkbookToScenario(normalized.document);
assert.equal(mapped.ok, true, JSON.stringify([...parsed.diagnostics, ...normalized.diagnostics, ...mapped.diagnostics]));
assert.equal(mapped.preview.profile, "standard");
assert.equal(mapped.source?.scenarioId, "atlas_g4_synthetic_500");
assert.equal(mapped.source?.resources.length, 500);
assert.equal(mapped.source?.connections.length, 499);
assert.equal(mapped.source?.zones.length, 10);
assert.equal(mapped.source?.resources.reduce((count, resource) => count + (resource.interfaces?.length ?? 0), 0), 998);
assert.deepEqual(mapped.source?.resources.map(resource => resource.id), Array.from({ length: 500 }, (_, index) => `g4_node_${String(index + 1).padStart(3, "0")}`));
assert.deepEqual(mapped.source?.connections.map(connection => [connection.id, connection.from.resource, connection.from.port, connection.to.resource, connection.to.port]), Array.from({ length: 499 }, (_, index) => [`g4_link_${String(index + 1).padStart(3, "0")}`, `g4_node_${String(index + 1).padStart(3, "0")}`, "right", `g4_node_${String(index + 2).padStart(3, "0")}`, "left"]));

const atlas = buildAtlasIndex({ sourceIdentity: "atlas_g4_synthetic_500", resources: mapped.source.resources, connections: mapped.source.connections, zones: mapped.source.zones }, { version: "atlas-001-g4-v1", targetNodesPerPage: 60, maxNodesPerPage: 100, maxInternalLinksPerPage: 250 });
assert.equal(atlas.pages.length, 10);
assert.equal(atlas.pages.reduce((sum, page) => sum + page.resourceIds.length, 0), 500);
assert.equal(new Set(atlas.pages.flatMap(page => page.resourceIds)).size, 500);
assert.equal(atlas.pages.flatMap(page => page.boundaryReferences).length, 18);
assert.equal(atlas.pages.reduce((sum, page) => sum + page.internalConnectionIds.length, 0), 490);
assert.equal([...atlas.connectionById.keys()].length, 499);
for (const page of atlas.pages) {
  assert.ok(page.resourceIds.length <= 100);
  assert.ok(page.internalConnectionIds.length <= 250);
  assert.ok(page.boundaryReferences.every(reference => atlas.connectionById.has(reference.originalConnectionId)));
}

const duplicate = structuredClone(normalized.document);
duplicate.tables.find(table => table.tableId === "Nodes").records[1].fields.nodeId.value = "g4_node_001";
assert.ok(validateNetworkWorkbook(duplicate).some(diagnostic => diagnostic.code === "WORKBOOK_DUPLICATE_NODE_ID"));
const missingEndpoint = structuredClone(normalized.document);
missingEndpoint.tables.find(table => table.tableId === "Links").records[1].fields.nodeB.value = "missing-node";
assert.ok(validateNetworkWorkbook(missingEndpoint).some(diagnostic => diagnostic.code === "WORKBOOK_LINK_ENDPOINT_UNKNOWN"));

console.log(`ATLAS-001 G4 synthetic-xlsx-fixture: PASS (${mapped.source.resources.length} resources, ${mapped.source.connections.length} links, ${atlas.pages.length} pages, sha256=${sha})`);

const fixtureBPath = "tests/fixtures/import/atlas001-g4b-500.xlsx";
const bytesB = new Uint8Array(fs.readFileSync(fixtureBPath));
const digestB = await globalThis.crypto.subtle.digest("SHA-256", bytesB);
const shaB = Array.from(new Uint8Array(digestB), value => value.toString(16).padStart(2, "0")).join("");
assert.equal(shaB, "5b9db7325077e7b0b1a6cfc02ec42426889b210826abc7efe24e2ef140ab51e1", "independent G4.1 fixture bytes changed");
const parsedB = await createXlsxImportAdapter(nodeZipArchiveBackend).parse({ bytes: bytesB, mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, { options: {} });
const normalizedB = normalizeNetworkInventoryDocument(parsedB.document);
const mappedB = mapNetworkWorkbookToScenario(normalizedB.document);
assert.equal(mappedB.ok, true, JSON.stringify([...parsedB.diagnostics, ...normalizedB.diagnostics, ...mappedB.diagnostics]));
assert.equal(mappedB.preview.profile, "standard");
assert.equal(mappedB.source?.scenarioId, "atlas_g4_b_synthetic_500");
assert.equal(mappedB.source?.resources.length, 500);
assert.equal(mappedB.source?.connections.length, 500);
assert.equal(mappedB.source?.zones.length, 4);
assert.equal(new Set(mappedB.source?.resources.map(resource => resource.zone)).size, 4, "fixture B retains independent zoning");
assert.equal(mappedB.source?.connections.filter(connection => connection.from.resource === "b4_device_001" && connection.to.resource === "b4_device_002").length, 2, "fixture B retains parallel links");
assert.equal(mappedB.source?.connections.some(connection => connection.from.resource === "b4_device_491" && connection.to.resource === "b4_device_492"), true, "fixture B retains disconnected component");
assert.ok(mappedB.source?.connections.every(connection => connection.from.port && connection.to.port), "fixture B endpoints retain ports");
const atlasB = buildAtlasIndex({ sourceIdentity: "atlas_g4_b_synthetic_500", resources: mappedB.source.resources, connections: mappedB.source.connections, zones: mappedB.source.zones }, { version: "atlas-001-g4.1-v1", targetNodesPerPage: 60, maxNodesPerPage: 100, maxInternalLinksPerPage: 250 });
assert.equal(atlasB.pages.reduce((sum, page) => sum + page.resourceIds.length, 0), 500);
assert.equal(new Set(atlasB.pages.flatMap(page => page.resourceIds)).size, 500);
assert.equal([...atlasB.connectionById.keys()].length, 500);
assert.equal(atlasB.pages.length, 9, "fixture B retains its independent zone-derived page structure");
assert.ok(atlasB.pages.flatMap(page => page.boundaryReferences).length > 0, "fixture B has boundary references");
console.log(`ATLAS-001 G4.1 independent-xlsx-fixture: PASS (${mappedB.source.resources.length} resources, ${mappedB.source.connections.length} links, ${atlasB.pages.length} pages, sha256=${shaB})`);
rmSync(temp, { recursive: true, force: true });
