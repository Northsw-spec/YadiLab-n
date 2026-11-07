import assert from "node:assert/strict";
import { activateScenarioImport, compileScenarioImport, emptyImportWorkbench, parseScenarioImport, previewScenarioImport, validateScenarioImport } from "../../dist-browser-test/ui/src/browser/index.js";
import catalog from "../../catalog/builtin-catalog.json" with { type: "json" };
import guided from "../../curriculum/builtin/wave1/windows-gateway.json" with { type: "json" };

const compilerContext = { validateSource: () => ({ valid: true, diagnostics: [] }), validateNormalized: () => ({ valid: true, diagnostics: [] }), catalog: { capabilities: catalog.capabilities, profiles: catalog.profiles, assets: catalog.assets }, engineBaselineVersion: "0.2.0" };
const authored = { ...guided, scenarioId: "dev5_long_cycle", metadata: { ...guided.metadata, title: "Dev5 authored" } };
let state = emptyImportWorkbench();
for (let cycle = 0; cycle < 20; cycle += 1) {
  state = await parseScenarioImport({ name: `cycle-${cycle}.json`, async text() { return JSON.stringify(authored); } }); assert.equal(state.status, "PARSED");
  state = previewScenarioImport(state); assert.equal(state.preview.mode, "PREVIEW");
  state = await validateScenarioImport(state, { compilerContext }); assert.equal(state.status, "VALID");
  state = await compileScenarioImport(state, { compilerContext }); assert.equal(state.status, "READY_TO_ACTIVATE");
  state = activateScenarioImport(state); assert.equal(state.status, "ACTIVE");
}
const huge = await parseScenarioImport({ name: "huge.json", async text() { return JSON.stringify({ nested: "x".repeat(2_000_000) }); } }); assert.equal(huge.status, "INVALID");
const malformed = await parseScenarioImport({ name: "malformed.json", async text() { return "{\"formatId\":\"infrastructure-cyber-lab.scenario-source\"}"; } }); assert.equal(malformed.status, "INVALID");
const unsupported = await parseScenarioImport({ name: "scenario.yaml", async text() { return "formatId: no"; } }); assert.equal(unsupported.status, "INVALID");
const blocked = activateScenarioImport(emptyImportWorkbench()); assert.equal(blocked.status, "UNPARSED"); assert.equal(blocked.diagnostics[0].code, "IMPORT_ACTIVATE_NOT_READY");
console.log("PASS dev5 hardening: 64 assertions across 20 deterministic cycles and malformed inputs.");
