import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createXlsxImportAdapter,
  mapNetworkWorkbookToScenario,
  normalizeNetworkInventoryDocument,
  validateNetworkWorkbook,
} from "../../dist-enterprise-import-test/enterprise-import/src/index.js";
import { nodeZipArchiveBackend } from "./node_zip_backend.mjs";
import { classifyNetworkImportActivation, ATLAS_ACTIVATION_KINDS } from "../../ui/app/atlas-activation-policy.mjs";

const manifest = JSON.parse(fs.readFileSync("tests/fixtures/import/atlas001-normal-density-manifest.json", "utf8"));
const temp = mkdtempSync(join(tmpdir(), "yadilab-atlas001-normal-density-"));
const atlasBundle = join(temp, "atlas-topology.mjs");
await build({
  entryPoints: ["ui/src/canvas/atlas-topology.ts"],
  outfile: atlasBundle,
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node22"],
  logLevel: "silent",
});
const { buildAtlasIndex } = await import(pathToFileURL(atlasBundle).href);

const sha256 = async bytes => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
};
const idsHash = async ids => sha256(new TextEncoder().encode(JSON.stringify(ids)));

for (const item of manifest.cases) {
  const bytes = new Uint8Array(fs.readFileSync(item.path));
  assert.equal(await sha256(bytes), item.sha256, `${item.key}: fixture bytes changed`);
  const parsed = await createXlsxImportAdapter(nodeZipArchiveBackend).parse({ bytes, mediaType: item.mediaType }, { options: {} });
  const normalized = normalizeNetworkInventoryDocument(parsed.document);
  const mapped = mapNetworkWorkbookToScenario(normalized.document);
  const diagnostics = [...parsed.diagnostics, ...normalized.diagnostics, ...mapped.diagnostics];
  assert.equal(mapped.ok, true, `${item.key}: source mapping failed ${JSON.stringify(diagnostics)}`);
  assert.equal(mapped.source?.resources.length, item.resources, `${item.key}: resource count`);
  assert.equal(mapped.source?.connections.length, item.connections, `${item.key}: connection count`);
  assert.deepEqual(mapped.source?.zones.map(zone => zone.id), item.zoneIds, `${item.key}: zone IDs`);
  assert.deepEqual(mapped.source?.resources.map(resource => resource.id), item.resourceIds, `${item.key}: resource IDs`);
  assert.deepEqual(mapped.source?.connections.map(connection => connection.id), item.connectionIds, `${item.key}: connection IDs`);
  assert.equal(await idsHash(item.resourceIds), item.resourceIdsSha256, `${item.key}: external resource hash`);
  assert.equal(await idsHash(item.connectionIds), item.connectionIdsSha256, `${item.key}: external connection hash`);
  assert.deepEqual(mapped.source?.connections.map(connection => ({
    id: connection.id,
    from: connection.from.resource,
    fromPort: connection.from.port,
    to: connection.to.resource,
    toPort: connection.to.port,
  })), item.connectionsTruth, `${item.key}: endpoint/port provenance`);
  assert.equal(validateNetworkWorkbook(normalized.document).some(diagnostic => diagnostic.severity === "error"), false, `${item.key}: workbook validation errors`);
  const resourceById = new Map(mapped.source.resources.map(resource => [resource.id, resource]));
  for (const connection of mapped.source.connections) {
    const source = resourceById.get(connection.from.resource);
    const target = resourceById.get(connection.to.resource);
    assert.ok(source?.interfaces.some(iface => iface.id === connection.from.port), `${item.key}: source port not declared`);
    assert.ok(target?.interfaces.some(iface => iface.id === connection.to.port), `${item.key}: target port not declared`);
  }
  const sourceBeforeAtlas = JSON.stringify(mapped.source);
  const atlas = buildAtlasIndex({
    sourceIdentity: item.scenarioId,
    resources: mapped.source.resources,
    connections: mapped.source.connections,
    zones: mapped.source.zones,
  }, { version: "atlas-001-normal-density-v1", targetNodesPerPage: 60, maxNodesPerPage: 100, maxInternalLinksPerPage: 250 });
  assert.equal(atlas.connectionById.size, item.connections, `${item.key}: Atlas connection register`);
  assert.equal(atlas.pages.flatMap(page => page.resourceIds).length, item.resources, `${item.key}: Atlas resource total`);
  assert.equal(JSON.stringify(mapped.source), sourceBeforeAtlas, `${item.key}: Atlas mutated canonical source`);

  const candidate = {
    ok: true,
    filename: item.filename,
    workbookProfile: mapped.preview.profile,
    sheets: mapped.preview.originalSheets,
    authoritativeSheets: mapped.preview.authoritativeSheets,
    source: mapped.source,
    devices: item.resources,
    links: item.connections,
    unmappedColumnCount: normalized.unmappedColumnCount,
    diagnostics,
  };
  const decision = classifyNetworkImportActivation(candidate);
  // This is the red reproducer: without a verified normal link budget, every
  // density point currently enters NORMAL solely because resources <= 200.
  assert.equal(decision.kind, ATLAS_ACTIVATION_KINDS.NORMAL, `${item.key}: unexpected pre-fix activation decision`);
}

rmSync(temp, { recursive: true, force: true });
console.log(`PASS ATLAS-001 normal density fixtures: ${manifest.cases.length} independent XLSX sources, exact ports and pre-fix NORMAL reproduction`);
