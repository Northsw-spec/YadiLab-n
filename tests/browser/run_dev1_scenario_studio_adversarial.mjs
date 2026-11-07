import assert from "node:assert/strict";
import { createBuilderWorkspace, createScenarioDraft, addResource, addZone, upsertConnection, deleteZone } from "../../dist-browser-test/ui/src/browser/index.js";
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
const draft = createScenarioDraft({ scenarioId: "unsafe id / Unicode Å" });
ok(draft.scenarioId === "unsafe_id_unicode_", "scenario IDs are normalized without accepting path-like syntax");
let ws = createBuilderWorkspace(draft);
let result = addZone(ws, { id: "z", label: "Zone", kind: "lan" }); ok(result.ok, "zone can be added to draft"); ws = result.workspace;
result = addResource(ws, { id: "n", type: "server.generic", label: "Node", zone: "z", properties: {} }); ok(result.ok, "resource can be added to draft"); ws = result.workspace;
result = addResource(ws, { id: "n", type: "server.generic", label: "Duplicate", zone: "z", properties: {} }); ok(!result.ok && result.diagnostics[0]?.code === "BUILDER_DUPLICATE_ID", "duplicate IDs are rejected");
result = upsertConnection(ws, { id: "x", kind: "network", from: { resource: "n" }, to: { resource: "missing" }, properties: {} }); ok(!result.ok && result.diagnostics[0]?.code === "BUILDER_CONNECTION_ENDPOINT_UNKNOWN", "unknown endpoint is rejected");
result = deleteZone(ws, "z"); ok(!result.ok && result.diagnostics[0]?.code === "BUILDER_ZONE_NOT_EMPTY", "non-empty zone deletion requires explicit cascade");
console.log(`PASS dev1 Scenario Studio adversarial: ${checks} assertions.`);
