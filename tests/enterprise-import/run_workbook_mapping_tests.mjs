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
console.log("PASS dev2 workbook mapping: 15 assertions across 30/50/80 nodes and fail-closed references.");
