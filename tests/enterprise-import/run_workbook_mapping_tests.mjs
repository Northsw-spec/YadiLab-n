import assert from "node:assert/strict";
import { mapNetworkWorkbookToScenario, previewNetworkWorkbook, validateNetworkWorkbook } from "../../dist-enterprise-import-test/enterprise-import/src/index.js";

const cell = (value) => ({ value, locator: { kind: "record-row", table: "test", row: 1 } });
const record = (recordIndex, fields) => ({ recordIndex, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, cell(value)])) });
const workbook = (count = 30) => ({ tables: [
  { tableId: "Metadata", records: [record(1, { schemaVersion: "1.0.0", scenarioId: `workbook_${count}`, title: `Workbook ${count}` })] },
  { tableId: "Nodes", records: Array.from({ length: count }, (_, i) => record(i + 1, { nodeId: `node_${i + 1}`, displayName: `Node ${i + 1}`, type: "server.generic" })) },
  { tableId: "Interfaces", records: Array.from({ length: count }, (_, i) => record(i + 1, { nodeId: `node_${i + 1}`, interfaceId: "eth0", name: "eth0", IPv4: `10.0.${Math.floor(i / 254)}.${(i % 254) + 1}`, prefix: "24", MTU: 1500 })) },
  { tableId: "Links", records: Array.from({ length: Math.max(0, count - 1) }, (_, i) => record(i + 1, { linkId: `link_${i + 1}`, nodeA: `node_${i + 1}`, interfaceA: "eth0", nodeB: `node_${i + 2}`, interfaceB: "eth0", kind: "network" })) },
  { tableId: "Layout", records: Array.from({ length: count }, (_, i) => record(i + 1, { nodeId: `node_${i + 1}`, rank: i })) },
] });
for (const count of [30, 50, 80]) { const result = mapNetworkWorkbookToScenario(workbook(count)); assert.equal(result.ok, true); assert.equal(result.source?.resources.length, count); assert.equal(result.source?.connections.length, count - 1); assert.equal(result.preview.mode, "PREVIEW"); }
const bad = workbook(2); bad.tables.find((x) => x.tableId === "Links").records[0].fields.nodeB.value = "missing"; const diagnostics = validateNetworkWorkbook(bad); assert.ok(diagnostics.some((x) => x.code === "WORKBOOK_LINK_ENDPOINT_UNKNOWN")); assert.equal(mapNetworkWorkbookToScenario(bad).ok, false);
const preview = previewNetworkWorkbook(workbook(30)); assert.equal(preview.rowsPerSheet.Nodes, 30); assert.equal(preview.mappedRows.Nodes, 30); assert.equal(preview.errors, 0);
// IMPORT-033: the preview must not advertise a source as importable when
// its zone or layout references cannot survive canonical Builder validation.
// Positive path: explicit Zones may be attached to Nodes and layoutHints.
const zoned = workbook(2);
zoned.tables.push({ tableId: "Zones", records: [
  record(1, { zoneId: "floor_a", displayName: "Floor A", kind: "lan" }),
] });
zoned.tables.find(x => x.tableId === "Nodes").records[0].fields.zoneId = cell("floor_a");
zoned.tables.find(x => x.tableId === "Layout").records[0].fields.nodeId.value = "floor_a";
const zonedResult = mapNetworkWorkbookToScenario(zoned);
assert.equal(zonedResult.ok, true, JSON.stringify(zonedResult.diagnostics));
assert.equal(zonedResult.source.resources[0].zone, "floor_a");
assert.equal(zonedResult.source.layoutHints[0].target, "floor_a");
assert.deepEqual(zonedResult.source.zones.map(x => x.id), ["floor_a"]);

const unknownZone = workbook(2);
unknownZone.tables.find(x => x.tableId === "Nodes").records[0].fields.zoneId = cell("missing_zone");
const unknownZoneResult = mapNetworkWorkbookToScenario(unknownZone);
assert.equal(unknownZoneResult.ok, false);
assert.ok(unknownZoneResult.diagnostics.some(x =>
  x.code === "WORKBOOK_NODE_ZONE_UNKNOWN" && x.table === "Nodes" && x.row === 1));
assert.ok(unknownZoneResult.preview.errors > 0);
assert.equal(unknownZoneResult.source, undefined,
  "Invalid reference must never expose a seemingly importable source");

const duplicatedZone = workbook(2);
duplicatedZone.tables.push({ tableId: "Zones", records: [
  record(1, { zoneId: "site_a", displayName: "Site A" }),
  record(2, { zoneId: "site_a", displayName: "Duplicate Site A" }),
] });
assert.ok(validateNetworkWorkbook(duplicatedZone).some(x =>
  x.code === "WORKBOOK_DUPLICATE_ZONE_ID"));
assert.equal(mapNetworkWorkbookToScenario(duplicatedZone).ok, false);

const collidingZone = workbook(2);
collidingZone.tables.push({ tableId: "Zones", records: [
  record(1, { zoneId: "node_1", displayName: "Zone collides with node ID" }),
] });
assert.ok(validateNetworkWorkbook(collidingZone).some(x =>
  x.code === "WORKBOOK_CANONICAL_ID_COLLISION"));
assert.equal(mapNetworkWorkbookToScenario(collidingZone).ok, false);

const ghostLayout = workbook(2);
ghostLayout.tables.find(x => x.tableId === "Layout").records[0].fields.nodeId.value = "missing_target";
const ghostLayoutResult = mapNetworkWorkbookToScenario(ghostLayout);
assert.equal(ghostLayoutResult.ok, false);
assert.ok(ghostLayoutResult.diagnostics.some(x =>
  x.code === "WORKBOOK_LAYOUT_TARGET_UNKNOWN" && x.table === "Layout" && x.row === 1));
assert.equal(ghostLayoutResult.source, undefined,
  "Unknown layout object must not be emitted into canonical layoutHints");
console.log("PASS IMPORT-033: declared zones/layout references accepted; unknown, duplicate and colliding IDs rejected");
console.log("PASS dev2 workbook mapping: 15 assertions across 30/50/80 nodes and fail-closed references.");
