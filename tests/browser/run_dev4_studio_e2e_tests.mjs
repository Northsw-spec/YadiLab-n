import assert from "node:assert/strict";
import fs from "node:fs";
import { addResource, compileBuilderWorkspace, createBuilderWorkspace, setResourceInterfaces, setResourceConfiguration, setLayoutOverride, upsertConnection, previewRuntime } from "../../dist-browser-test/ui/src/browser/index.js";
import catalog from "../../catalog/builtin-catalog.json" with { type: "json" };

const source = JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-source.json", "utf8"));
const context = { validateSource: () => ({ valid: true, diagnostics: [] }), validateNormalized: () => ({ valid: true, diagnostics: [] }), catalog: { capabilities: catalog.capabilities, profiles: catalog.profiles, assets: catalog.assets }, engineBaselineVersion: "0.2.0" };
let ws = createBuilderWorkspace(source);
const counts = [30, 50, 80];
for (const count of counts) {
  while (ws.source.resources.length < count) {
    const id = `authored_${ws.source.resources.length + 1}`;
    const created = addResource(ws, { id, type: "server.generic", label: `Authored ${id}`, properties: {}, interfaces: [] });
    assert.equal(created.ok, true); ws = created.workspace;
  }
  assert.equal(ws.source.resources.length, count);
}
const configured = setResourceInterfaces(ws, "authored_30", [{ id: "eth0", addresses: ["10.30.0.10/24"], mtu: 1500 }]); assert.equal(configured.ok, true); ws = configured.workspace;
const routed = setResourceConfiguration(ws, "authored_30", "routes", [{ id: "default", destination: "0.0.0.0/0", nextHop: "10.30.0.1" }]); assert.equal(routed.ok, true); ws = routed.workspace;
const linked = upsertConnection(ws, { id: "authored_flow", kind: "network", from: { resource: "authored_30" }, to: { resource: "authored_31" }, properties: { protocol: "tcp", port: 443 } }); assert.equal(linked.ok, true); ws = linked.workspace;
const compiled = await compileBuilderWorkspace(ws, { compilerContext: context }); assert.equal(compiled.compile.status, "valid");
const runtime = previewRuntime(compiled); assert.equal(runtime.ok, true); assert.equal(runtime.workspace.mode, "runtime");
const edited = setResourceConfiguration(ws, "authored_30", "services", [{ id: "https", port: 443, enabled: true }]); assert.equal(edited.ok, true); assert.equal(edited.workspace.compile.status, "idle");
const moved = setLayoutOverride(compiled, { id: "authored_30", x: 9999, y: -9999, width: 220, height: 100 }); assert.deepEqual(moved.source, compiled.source);
console.log("PASS dev4 Studio end-to-end core: 12 assertions.");
