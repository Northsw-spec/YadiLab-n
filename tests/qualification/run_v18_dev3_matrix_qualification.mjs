import assert from "node:assert/strict";
import fs from "node:fs";
import catalog from "../../catalog/builtin-catalog.json" with { type: "json" };
import { compileScenario } from "../../dist-browser-test/compiler/src/index.js";
import { createInitialEngineState, ENGINE_VERSION, evaluateEngine } from "../../dist-browser-test/engine/src/index.js";
import {
  computeCanonicalSourceIdentity,
  createEndpointSet,
  createFlowProfile,
  createNetworkIntentContract,
  executeNetworkIntent,
  buildIntentResultMatrix,
} from "../../dist-browser-test/ui/src/browser/index.js";

const source = JSON.parse(fs.readFileSync("tests/fixtures/qualification/enterprise-100-node-stress.source.json", "utf8"));
const sourceIdentity = await computeCanonicalSourceIdentity(source);
const flow = source.tests.find((test) => test.id === "user_to_db");
assert.ok(flow);
const sources = await createEndpointSet({ title: "100-node clients", nodeIds: ["win01", "win02", "win03"], source });
const destinations = await createEndpointSet({ title: "100-node servers", nodeIds: ["db01", "file01"], source });
const profile = await createFlowProfile({ title: "Qualification RDP/HTTPS profile", flowId: flow.id, protocol: flow.params.protocol, port: flow.params.port, source });
const contract = await createNetworkIntentContract({ title: "100-node matrix qualification", source, sourceIdentity, endpointSets: [sources, destinations], flowProfiles: [profile], rules: [{ sourceSetId: sources.setId, destinationSetId: destinations.setId, flowProfileId: profile.profileId, expectation: "MUST REACH", expected: "SUCCESS" }] });
const runner = { run: async (candidate, flowId, sourceRevision) => {
  const compiled = await compileScenario(candidate, { validateSource: () => ({ valid: true, diagnostics: [] }), validateNormalized: () => ({ valid: true, diagnostics: [] }), catalog: { capabilities: catalog.capabilities, profiles: catalog.profiles, assets: catalog.assets }, engineBaselineVersion: ENGINE_VERSION });
  if (!compiled.ok) throw new Error("DEV3_100_NODE_COMPILE_FAILED");
  const state = createInitialEngineState(compiled.model);
  return { runId: `qualification:${sourceRevision}:${flowId}`, sourceIdentity: await computeCanonicalSourceIdentity(candidate), sourceRevision, flowId, evaluation: evaluateEngine(compiled.model, state) };
} };
const run = await executeNetworkIntent({ contract, source, sourceIdentity, sourceRevision: 0, runSequence: 100, runner });
assert.equal(run.cases.length, 6);
const matrix = await buildIntentResultMatrix({ contract, source, run, sourceIdentity, sourceRevision: 0 });
assert.equal(matrix.cells.length, 4);
assert.equal(matrix.cells.filter((cell) => cell.caseIdentities.length).length, 1);
assert.equal(matrix.cells.find((cell) => cell.caseIdentities.length).caseIdentities.length, 6);
console.log(JSON.stringify({ status: "PASS", nodes: 100, concreteCases: run.cases.length, matrixCells: matrix.cells.length, populatedCells: 1, states: run.counts }, null, 2));
