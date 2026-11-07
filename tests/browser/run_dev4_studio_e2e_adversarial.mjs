import assert from "node:assert/strict";
import { addResource, createBuilderWorkspace } from "../../dist-browser-test/ui/src/browser/index.js";
const source = { formatId: "infrastructure-cyber-lab.scenario-source", schemaVersion: "0.1.0", scenarioId: "dev4", metadata: { title: "Dev4", language: "sv", briefing: "Dev4" }, requires: { capabilities: [], profiles: [] }, zones: [], resources: [], connections: [], tests: [], findings: [], objectives: [{ id: "o1", title: "Objective", requirements: [] }], completion: { op: "all", rules: [] } };
let ws = createBuilderWorkspace(source);
let result = addResource(ws, { id: "node_1", type: "server.generic", label: "Nodé 😀", properties: {} }); assert.equal(result.ok, true); ws = result.workspace;
result = addResource(ws, { id: "node_1", type: "server.generic", label: "Duplicate", properties: {} }); assert.equal(result.ok, false);
result = addResource(ws, { id: " ", type: "server.generic", label: "Whitespace", properties: {} }); assert.equal(result.ok, true);
result = addResource(ws, { id: "huge", type: "server.generic", label: "x".repeat(5000), properties: {} }); assert.equal(result.ok, true);
console.log("PASS dev4 Studio adversarial: 4 assertions.");
