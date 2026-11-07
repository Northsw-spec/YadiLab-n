import assert from "node:assert/strict";
import { activateScenarioImport, compileScenarioImport, emptyImportWorkbench, parseScenarioImport, previewScenarioImport, validateScenarioImport } from "../../dist-browser-test/ui/src/browser/index.js";
import catalog from "../../catalog/builtin-catalog.json" with { type: "json" };
import guided from "../../curriculum/builtin/wave1/windows-gateway.json" with { type: "json" };

const file = { name: "authored.json", async text() { return JSON.stringify({ ...guided, scenarioId: "authored_dev3" }); } };
const compilerContext = { validateSource: () => ({ valid: true, diagnostics: [] }), validateNormalized: () => ({ valid: true, diagnostics: [] }), catalog: { capabilities: catalog.capabilities, profiles: catalog.profiles, assets: catalog.assets }, engineBaselineVersion: "0.2.0" };
let state = emptyImportWorkbench(); assert.equal(state.status, "UNPARSED");
state = await parseScenarioImport(file); assert.equal(state.status, "PARSED");
state = previewScenarioImport(state); assert.equal(state.preview.mode, "PREVIEW"); assert.equal(state.preview.scenarioId, "authored_dev3");
state = await validateScenarioImport(state, { compilerContext }); assert.equal(state.status, "VALID");
state = await compileScenarioImport(state, { compilerContext }); assert.equal(state.status, "READY_TO_ACTIVATE");
state = activateScenarioImport(state); assert.equal(state.status, "ACTIVE");
const bad = await parseScenarioImport({ name: "bad.json", async text() { return "[]"; } }); assert.equal(bad.status, "INVALID");
const csv = await parseScenarioImport({ name: "scenario.csv", async text() { return ""; } }); assert.equal(csv.status, "INVALID");
const malformed = await parseScenarioImport({ name: "broken.json", async text() { return "{"; } }); assert.equal(malformed.status, "INVALID");
console.log("PASS dev3 import workbench core: 9 assertions.");
