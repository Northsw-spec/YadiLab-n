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
import { evaluateBoundedAtlasEligibility, classifyNetworkImportActivation, ATLAS_ACTIVATION_KINDS } from "../../ui/app/atlas-activation-policy.mjs";

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync("tests/fixtures/import/atlas001-capacity-manifest.json", "utf8"));
const temp = mkdtempSync(join(tmpdir(), "yadilab-atlas001-capacity-"));
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
  const parsed = await createXlsxImportAdapter(nodeZipArchiveBackend).parse({
    bytes,
    mediaType: item.mediaType,
  }, { options: {} });
  const normalized = normalizeNetworkInventoryDocument(parsed.document);
  const mapped = mapNetworkWorkbookToScenario(normalized.document);
  const diagnostics = [...parsed.diagnostics, ...normalized.diagnostics, ...mapped.diagnostics];
  assert.equal(mapped.ok, true, `${item.key}: source mapping failed ${JSON.stringify(diagnostics)}`);
  assert.equal(mapped.source?.resources.length, item.resources, `${item.key}: resource count`);
  assert.equal(mapped.source?.connections.length, item.connections, `${item.key}: connection count`);
  assert.deepEqual(mapped.source?.resources.map(resource => resource.id), item.resourceIds, `${item.key}: resource IDs`);
  assert.deepEqual(mapped.source?.connections.map(connection => connection.id), item.connectionIds, `${item.key}: connection IDs`);
  assert.equal(await idsHash(item.resourceIds), item.resourceIdsSha256, `${item.key}: external resource manifest hash`);
  assert.equal(await idsHash(item.connectionIds), item.connectionIdsSha256, `${item.key}: external connection manifest hash`);
  assert.deepEqual(mapped.source?.connections.map(connection => ({
    id: connection.id,
    from: connection.from.resource,
    fromPort: connection.from.port,
    to: connection.to.resource,
    toPort: connection.to.port,
  })), item.connectionsTruth, `${item.key}: endpoint/port provenance`);
  assert.equal(mapped.source?.zones.length, item.zones, `${item.key}: zones`);
  assert.ok(mapped.source?.connections.every(connection => connection.from.port && connection.to.port), `${item.key}: explicit ports were lost`);
  assert.equal(validateNetworkWorkbook(normalized.document).some(diagnostic => diagnostic.severity === "error"), false, `${item.key}: canonical workbook validation errors`);

  const sourceBeforeAtlas = JSON.stringify(mapped.source);
  const atlas = buildAtlasIndex({
    sourceIdentity: item.scenarioId,
    resources: mapped.source.resources,
    connections: mapped.source.connections,
    zones: mapped.source.zones,
  }, { version: "atlas-001-capacity-v1", targetNodesPerPage: 60, maxNodesPerPage: 100, maxInternalLinksPerPage: 250 });
  const atlasResources = atlas.pages.flatMap(page => page.resourceIds);
  assert.equal(atlasResources.length, item.resources, `${item.key}: Atlas resource total`);
  assert.equal(new Set(atlasResources).size, item.resources, `${item.key}: Atlas resource duplication/loss`);
  assert.equal(atlas.connectionById.size, item.connections, `${item.key}: Atlas connection register`);
  const pageByResource = new Map();
  for (const page of atlas.pages) for (const resourceId of page.resourceIds) pageByResource.set(resourceId, page.id);
  for (const connection of item.connectionsTruth) {
    const fromPage = pageByResource.get(connection.from);
    const toPage = pageByResource.get(connection.to);
    assert.ok(fromPage && toPage, `${item.key}: endpoint page missing for ${connection.id}`);
    const internalPages = atlas.pages.filter(page => page.internalConnectionIds.includes(connection.id));
    const references = atlas.pages.flatMap(page => page.boundaryReferences.filter(reference => reference.originalConnectionId === connection.id));
    if (fromPage === toPage) {
      assert.equal(internalPages.length, 1, `${item.key}: ${connection.id} is not internal on exactly one page`);
      assert.equal(references.length, 0, `${item.key}: internal ${connection.id} has boundary reference`);
    } else {
      assert.equal(internalPages.length, 0, `${item.key}: cross-page ${connection.id} became a physical edge`);
      assert.ok(references.length >= 2, `${item.key}: cross-page ${connection.id} lost boundary references`);
      assert.equal(new Set(references.map(reference => reference.destinationPageId)).size, 2, `${item.key}: cross-page destination set`);
    }
  }
  assert.equal(JSON.stringify(mapped.source), sourceBeforeAtlas, `${item.key}: Atlas mutated canonical source`);

  const candidate = {
    ok: true,
    filename: item.filename,
    workbookProfile: mapped.preview.profile,
    sheets: item.rawSheets,
    authoritativeSheets: mapped.preview.authoritativeSheets,
    source: mapped.source,
    devices: item.resources,
    links: item.connections,
    unmappedColumnCount: normalized.unmappedColumnCount,
    diagnostics,
  };
  const bounded = evaluateBoundedAtlasEligibility(candidate);
  const decision = classifyNetworkImportActivation(candidate, { boundedDecision: bounded });
  assert.equal(decision.kind, item.expectedActivation === "NORMAL" ? ATLAS_ACTIVATION_KINDS.NORMAL : item.expectedActivation === "BOUNDED_ATLAS" ? ATLAS_ACTIVATION_KINDS.BOUNDED_ATLAS : ATLAS_ACTIVATION_KINDS.BLOCKED, `${item.key}: activation policy`);
}

const branch = manifest.cases.find(item => item.key === "500-branch");
assert.ok(branch, "branch control fixture exists");
const parallel = branch.connectionsTruth.filter(connection => connection.from === "cap_500-branch_node_0001" && connection.to === "cap_500-branch_node_0002");
assert.equal(parallel.length, 2, "branch fixture retains parallel port-distinct links");
const disconnected = branch.connectionsTruth.filter(connection => Number(connection.from.slice(-4)) >= 291);
assert.ok(disconnected.length > 0, "branch fixture retains a disconnected component");

rmSync(temp, { recursive: true, force: true });
console.log(`PASS ATLAS-001 capacity fixtures: ${manifest.cases.length} independent XLSX sources, exact IDs/endpoints, Atlas page reconciliation and activation categories`);
