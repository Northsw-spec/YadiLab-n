import assert from "node:assert/strict";
import fs from "node:fs";
import { createXlsxImportAdapter, mapNetworkWorkbookToScenario, normalizeNetworkInventoryDocument, validateNetworkWorkbook } from "../../dist-enterprise-import-test/enterprise-import/src/index.js";
import { nodeZipArchiveBackend } from "./node_zip_backend.mjs";

const cell = (value, sheet = "fixture", row = 2, column = "A") => ({ value, locator: { kind: "table-cell", sheet, row, column } });
const record = (recordIndex, fields, sheet = "fixture") => ({ recordIndex, fields: Object.fromEntries(Object.entries(fields).map(([key, value], index) => [key, cell(value, sheet, recordIndex, String.fromCharCode(65 + index))])) });
const canonical = ({ prefix = "", docs = false } = {}) => {
  const sheet = (name) => `${prefix}${name}`;
  const nodes = Array.from({ length: 47 }, (_, index) => record(index + 2, {
    nodeId: `node_${index + 1}`, displayName: `Node ${index + 1}`, type: index === 0 ? "network.router" : "network.switch", zoneId: `zone_${(index % 15) + 1}`,
    ...(docs ? { "Floor / Area": `Floor ${(index % 3) + 1}`, Department: "Training", Function: "Documented role", "Training Note": "Synthetic training source" } : {}),
  }, sheet("Nodes")));
  const interfaces = Array.from({ length: 49 }, (_, index) => { const node = `node_${(index % 47) + 1}`; return record(index + 2, { nodeId: node, interfaceId: `eth${index % 2}`, name: `eth${index % 2}`, IPv4: `192.0.2.${(index % 200) + 1}`, prefix: "24", ...(docs ? { "Addressing Note": "Documentation-only address" } : {}) }, sheet("Interfaces")); });
  const links = Array.from({ length: 46 }, (_, index) => record(index + 2, { linkId: `link_${index + 1}`, nodeA: `node_${index + 1}`, nodeB: `node_${index + 2}`, kind: "network", ...(docs ? { Medium: "Fiber Ethernet", "Training Note": "Declared source link" } : {}) }, sheet("Links")));
  const zones = Array.from({ length: 15 }, (_, index) => record(index + 2, { zoneId: `zone_${index + 1}`, displayName: `Zone ${index + 1}`, kind: "lan", ...(docs ? { "Illustrative Subnet": `192.0.${index}.0/24`, "Segmentation Note": "Documentation-only" } : {}) }, sheet("Zones")));
  const layout = Array.from({ length: 47 }, (_, index) => record(index + 2, { nodeId: `node_${index + 1}`, rank: index }, sheet("Layout")));
  const metadata = [record(2, { schemaVersion: "1.0.0", scenarioId: "arvidsjaur_training", title: "Fictional training workbook", description: "Synthetic data only", ...(docs ? { notice: "Not a real network", sourceUrl: "https://example.invalid/source", scope: "Training only" } : {}) }, sheet("Metadata"))];
  const names = ["Nodes", "Interfaces", "Links", "Zones", "Layout", "Metadata"];
  return { tables: [nodes, interfaces, links, zones, layout, metadata].map((records, index) => ({ tableId: `${prefix}${names[index]}`, records })) };
};
const src22 = () => {
  const base = canonical({ prefix: "SRC ", docs: true });
  const docs = Array.from({ length: 16 }, (_, index) => ({ tableId: `DOC ${String(index + 1).padStart(2, "0")}`, records: [record(2, { Section: `Documentation ${index + 1}`, Guidance: "Preserve as source documentation" }, `DOC ${String(index + 1).padStart(2, "0")}`)] }));
  return { tables: [...base.tables, ...docs] };
};

const a = mapNetworkWorkbookToScenario(canonical({ docs: true }));
assert.equal(a.ok, true, JSON.stringify(a.diagnostics));
assert.equal(a.preview.profile, "legacy-six");
assert.equal(a.source.resources.length, 47);
assert.equal(a.source.resources.reduce((sum, resource) => sum + (resource.interfaces?.length ?? 0), 0), 49);
assert.equal(a.source.connections.length, 46);
assert.equal(a.source.zones.length, 15);
assert.equal(a.source.notes.length > 0, true);
assert.deepEqual(a.source.connections.map((connection) => [connection.id, connection.from.resource, connection.to.resource]), canonical({ docs: true }).tables.find((table) => table.tableId === "Links").records.map((row) => [row.fields.linkId.value, row.fields.nodeA.value, row.fields.nodeB.value]));

const b = mapNetworkWorkbookToScenario(src22());
assert.equal(b.ok, true, JSON.stringify(b.diagnostics));
assert.equal(b.preview.profile, "legacy-src-22");
assert.equal(b.preview.sheetsFound.length, 22);
assert.equal(b.preview.authoritativeSheets.length, 6);
assert.equal(b.preview.documentationSheets.length, 16);
assert.equal(b.source.resources.length, 47);
assert.equal(b.source.connections.length, 46);
assert.equal(b.source.notes.length > a.source.notes.length, true);
assert.ok(b.diagnostics.some((diagnostic) => diagnostic.code === "WORKBOOK_DOCUMENTATION_SHEET_PRESERVED"));
const normalizedSrc = normalizeNetworkInventoryDocument(src22());
assert.equal(normalizedSrc.document.tables.some((table) => table.tableId === "SRC Nodes"), true, "SRC profile must retain original worksheet names through inventory normalization");

const conflict = { tables: [...canonical({ docs: true }).tables, ...src22().tables.filter((table) => table.tableId.startsWith("SRC "))] };
assert.ok(validateNetworkWorkbook(conflict).some((diagnostic) => diagnostic.code === "WORKBOOK_SOURCE_TABLE_CONFLICT"));
assert.equal(mapNetworkWorkbookToScenario(conflict).ok, false);

const unknownEndpoint = canonical({ docs: true });
unknownEndpoint.tables.find((table) => table.tableId === "Links").records[0].fields.nodeB.value = "missing_node";
assert.ok(validateNetworkWorkbook(unknownEndpoint).some((diagnostic) => diagnostic.code === "WORKBOOK_LINK_ENDPOINT_UNKNOWN"));

const duplicateLink = canonical({ docs: true });
duplicateLink.tables.find((table) => table.tableId === "Links").records[1].fields.linkId.value = "link_1";
assert.ok(validateNetworkWorkbook(duplicateLink).some((diagnostic) => diagnostic.code === "WORKBOOK_DUPLICATE_LINK_ID"));

const invalidPrefix = canonical({ docs: true });
invalidPrefix.tables.find((table) => table.tableId === "Interfaces").records[0].fields.prefix.value = "99";
assert.ok(validateNetworkWorkbook(invalidPrefix).some((diagnostic) => diagnostic.code === "WORKBOOK_IPV4_PREFIX_INVALID"));

const originals = [process.env.PROJECT087_XLSX_A, process.env.PROJECT087_XLSX_B].filter(Boolean);
if (originals.length === 2) {
  for (const path of originals) {
    const parsed = await createXlsxImportAdapter(nodeZipArchiveBackend).parse({ bytes: new Uint8Array(fs.readFileSync(path)), mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, { options: {} });
    const result = mapNetworkWorkbookToScenario(parsed.document);
    assert.equal(result.ok, true, `${path}: ${JSON.stringify(result.diagnostics)}`);
    assert.equal(result.source.resources.length, 47);
    assert.equal(result.source.connections.length, 46);
  }
  console.log("PASS PROJECT-087 originals: both supplied Arvidsjaur XLSX files imported with 47/49/46/15 canonical counts");
} else {
  console.log("PASS PROJECT-087 synthetic workbook profiles: six-sheet and SRC-22 compatibility plus fail-closed negatives");
}
