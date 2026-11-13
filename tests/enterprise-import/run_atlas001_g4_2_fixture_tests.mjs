import assert from "node:assert/strict";
import fs from "node:fs";
import { createXlsxImportAdapter, mapNetworkWorkbookToScenario, normalizeNetworkInventoryDocument } from "../../dist-enterprise-import-test/enterprise-import/src/index.js";
import { nodeZipArchiveBackend } from "./node_zip_backend.mjs";

const cases = [
  { path: "tests/fixtures/import/atlas001-g4-2-normal-10.xlsx", sha: "dccddcf8c675bf86192865137a8fcf754b27299d38645c39b9a10edc48677c1a", resources: 10, connections: 9, scenario: "atlas_g4_2_normal_10" },
  { path: "tests/fixtures/import/atlas001-g4-2-blocked-1200.xlsx", sha: "286fd2aaee26e80c426e8bd35bb8100fbc22d494190da7ed83f7550e8bee34d7", resources: 1200, connections: 1200, scenario: "atlas_g4_2_blocked_1200" },
];

for (const item of cases) {
  const bytes = new Uint8Array(fs.readFileSync(item.path));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const sha = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  assert.equal(sha, item.sha, `${item.path} bytes changed`);
  const parsed = await createXlsxImportAdapter(nodeZipArchiveBackend).parse({ bytes, mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, { options: {} });
  const normalized = normalizeNetworkInventoryDocument(parsed.document);
  const mapped = mapNetworkWorkbookToScenario(normalized.document);
  assert.equal(mapped.ok, true, `${item.path}: ${JSON.stringify([...parsed.diagnostics, ...normalized.diagnostics, ...mapped.diagnostics])}`);
  assert.equal(mapped.preview.profile, "standard");
  assert.equal(mapped.source?.scenarioId, item.scenario);
  assert.equal(mapped.source?.resources.length, item.resources);
  assert.equal(mapped.source?.connections.length, item.connections);
  assert.ok(mapped.source?.connections.every(connection => connection.from.port && connection.to.port), `${item.path} lost declared ports`);
}

console.log("ATLAS-001 G4.2 fixtures: PASS (valid 10/9 NORMAL and 1200/1200 BLOCKED XLSX sources retain canonical counts, IDs and ports)");
