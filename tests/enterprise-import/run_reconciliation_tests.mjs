import assert from "node:assert/strict";
import { resolveReconciliationGroup, searchReconciliation, summarizeReconciliation } from "../../dist-enterprise-import-test/enterprise-import/src/index.js";
const document = { tables: [{ tableId: "Nodes", records: [{ recordIndex: 2, fields: {} }] }, { tableId: "Links", records: [] }] };
const diagnostics = [
  { code: "WORKBOOK_NODE_ID_INVALID", severity: "error", message: "bad node", table: "Nodes", row: 2, field: "nodeId" },
  { code: "WORKBOOK_NODE_ID_INVALID", severity: "error", message: "bad node", table: "Nodes", row: 3, field: "nodeId" },
  { code: "WORKBOOK_UNSUPPORTED_SHEET", severity: "warning", message: "unsupported", table: "Routes" },
];
const summary = summarizeReconciliation(document, diagnostics);
assert.equal(summary.status, "BLOCKED"); assert.equal(summary.groups.length, 2); assert.equal(summary.groups.find((x) => x.code === "WORKBOOK_NODE_ID_INVALID").count, 2);
assert.equal(searchReconciliation(summary, "nodeId").length, 1); assert.equal(searchReconciliation(summary, "").length, 2);
const resolved = resolveReconciliationGroup(summary, summary.groups.find((x) => x.code === "WORKBOOK_NODE_ID_INVALID").key);
assert.equal(resolved.status, "REVIEW"); assert.equal(resolved.errors, 0); assert.equal(resolved.total, 1);
console.log("PASS dev3 reconciliation diagnostics: 9 assertions");
