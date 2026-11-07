import assert from "node:assert/strict";
import { createBuilderWorkspace, addResource, upsertConnection } from "../../dist-browser-test/ui/src/browser/index.js";
import { setResourceInterfaces, setResourceConfiguration, setConnectionConfiguration, configurationSummary } from "../../dist-browser-test/ui/src/browser/index.js";

const source = {
  formatId: "infrastructure-cyber-lab.scenario-source", schemaVersion: "0.1.0", scenarioId: "dev2", metadata: { title: "Dev2", language: "sv", briefing: "Dev2" },
  requires: { capabilities: [], profiles: [] }, zones: [{ id: "lan", label: "LAN", kind: "lan" }],
  resources: [{ id: "r1", type: "network.router", label: "Router", zone: "lan", properties: {} }, { id: "r2", type: "server.generic", label: "Server", zone: "lan", properties: {} }],
  connections: [{ id: "c1", kind: "network", from: { resource: "r1" }, to: { resource: "r2" }, properties: {} }], tests: [], findings: [], objectives: [{ id: "o1", title: "Objective", requirements: [] }], completion: { op: "all", rules: [] },
};
let ws = createBuilderWorkspace(source);
let result = setResourceInterfaces(ws, "r1", [{ id: "eth0", addresses: ["10.0.0.1/24"], mtu: 1500 }]); assert.equal(result.ok, true); ws = result.workspace;
result = setResourceConfiguration(ws, "r1", "routes", [{ id: "default", destination: "0.0.0.0/0", nextHop: "10.0.0.254" }]); assert.equal(result.ok, true); ws = result.workspace;
result = setConnectionConfiguration(ws, "c1", { vlan: { mode: "access", accessVlan: 10 }, firewall: { action: "allow" } }); assert.equal(result.ok, true); ws = result.workspace;
assert.equal(ws.source.resources[0].interfaces[0].id, "eth0"); assert.equal(ws.source.connections[0].properties.vlan.accessVlan, 10);
assert.equal(configurationSummary(ws.source).interfaces, 1); assert.equal(configurationSummary(ws.source).routes, 1); assert.equal(configurationSummary(ws.source).vlans, 0);
result = setResourceInterfaces(ws, "r1", [{ id: "eth0", addresses: [] }, { id: "eth0", addresses: [] }]); assert.equal(result.ok, false); assert.equal(result.diagnostics[0].code, "CONFIG_INTERFACE_DUPLICATE");
console.log("PASS dev2 configuration core: 8 assertions.");
