import assert from "node:assert/strict";
import fs from "node:fs";
import { mapNetworkWorkbookToScenario } from "../../dist-enterprise-import-test/enterprise-import/src/index.js";

const cell = (value, sheet, row, column) => ({ value, locator: { kind: "table-cell", sheet, row, column } });
const record = (index, fields, sheet) => ({
  recordIndex: index,
  fields: Object.fromEntries(Object.entries(fields).map(([key, value], offset) => [key, cell(value, sheet, index, String.fromCharCode(65 + offset))])),
});
const canonicalRows = (sheetPrefix = "") => {
  const names = ["Nodes", "Interfaces", "Links", "Zones", "Layout", "Metadata"];
  const sheet = (name) => `${sheetPrefix}${name}`;
  const nodes = Array.from({ length: 47 }, (_, index) => record(index + 2, {
    nodeId: `node_${index + 1}`, displayName: `Node ${index + 1}`, type: "network.switch", zoneId: `zone_${(index % 15) + 1}`,
  }, sheet("Nodes")));
  const interfaces = Array.from({ length: 49 }, (_, index) => record(index + 2, {
    nodeId: `node_${(index % 47) + 1}`, interfaceId: `eth${index % 2}`, name: `eth${index % 2}`, IPv4: `192.0.2.${index + 1}`, prefix: "24",
  }, sheet("Interfaces")));
  const links = Array.from({ length: 46 }, (_, index) => record(index + 2, {
    linkId: `link_${index + 1}`, nodeA: `node_${index + 1}`, nodeB: `node_${index + 2}`, kind: "network",
  }, sheet("Links")));
  const zones = Array.from({ length: 15 }, (_, index) => record(index + 2, {
    zoneId: `zone_${index + 1}`, displayName: `Zone ${index + 1}`, kind: "lan",
  }, sheet("Zones")));
  const layout = Array.from({ length: 47 }, (_, index) => record(index + 2, { nodeId: `node_${index + 1}`, rank: index }, sheet("Layout")));
  const metadata = [record(2, { schemaVersion: "1.0.0", scenarioId: "project089", title: "PROJECT-089" }, sheet("Metadata"))];
  return [nodes, interfaces, links, zones, layout, metadata].map((records, index) => ({ tableId: sheet(names[index]), records }));
};

const srcTables = canonicalRows("SRC ");
// Producer variation: harmless casing and NBSP/extra spacing must not hide a
// supported canonical source. Locators still point to the original sheet IDs.
const variantNames = ["SRC\u00a0Nodes", "src  interfaces", "SRC Links", "src Zones", "SRC Layout", "SRC Metadata"];
const variantDocument = {
  tables: srcTables.map((table, index) => ({ ...table, tableId: variantNames[index], records: table.records.map((row) => ({
    ...row, fields: Object.fromEntries(Object.entries(row.fields).map(([field, source]) => [field, { ...source, locator: { ...source.locator, sheet: variantNames[index] } }])),
  })) })).concat([{ tableId: "00 Documentation", records: [record(2, { Note: "Preserve this documentation sheet" }, "00 Documentation")] }]),
};
const variant = mapNetworkWorkbookToScenario(variantDocument);
assert.equal(variant.ok, true, JSON.stringify(variant.diagnostics));
assert.equal(variant.preview.profile, "legacy-src-22");
assert.equal(variant.source.resources.length, 47);
assert.equal(variant.source.connections.length, 46);
assert.equal(variant.preview.authoritativeSheets.length, 6);
assert.equal(variant.preview.documentationSheets.length, 1);
assert.ok(variant.source.notes.some((note) => note.text.includes("Preserve this documentation sheet")));

const incomplete = mapNetworkWorkbookToScenario({ tables: srcTables.filter((table) => table.tableId !== "SRC Links") });
assert.equal(incomplete.ok, false);
assert.ok(incomplete.diagnostics.some((diagnostic) => diagnostic.code === "WORKBOOK_SOURCE_PROFILE_INCOMPLETE"));

const collision = mapNetworkWorkbookToScenario({ tables: [...srcTables, { ...srcTables[0], tableId: "SRC\u00a0Nodes" }] });
assert.equal(collision.ok, false);
assert.ok(collision.diagnostics.some((diagnostic) => diagnostic.code === "WORKBOOK_SHEET_NAME_COLLISION"));

for (const path of [process.env.PROJECT089_XLSX_A, process.env.PROJECT089_XLSX_B].filter(Boolean)) {
  // The byte-level parser/adapter test is intentionally opt-in for local
  // originals; CI still exercises representative source fixtures.
  assert.ok(fs.statSync(path).size > 0, `original workbook missing: ${path}`);
}

const ui = fs.readFileSync("ui/app/main.mjs", "utf8");
const css = fs.readFileSync("ui/app/app.css", "utf8");
assert.match(ui, /data-network-import-detected/);
assert.match(ui, /data-network-import-confirmation/);
assert.match(ui, /data-legacy-workbook-consent/);
assert.match(css, /network-import-panel input\[type="checkbox"\].*24px/);
assert.match(css, /network-import-confirmation \{ position: sticky/);
console.log("PASS PROJECT-089 import detection, fail-closed collisions, consent UI and sticky confirmation contract");
