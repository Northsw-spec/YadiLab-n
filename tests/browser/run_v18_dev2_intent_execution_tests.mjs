import assert from "node:assert/strict";
import fs from "node:fs";
import {
  computeCanonicalSourceIdentity,
  createEndpointSet,
  createFlowProfile,
  createNetworkIntentContract,
  executeNetworkIntent,
  expandNetworkIntent,
  verifyIntentRunCurrent,
  verifyIntentRunIntegrity,
} from "../../dist-browser-test/ui/src/browser/index.js";
import catalog from "../../catalog/builtin-catalog.json" with { type: "json" };
import { compileScenario } from "../../dist-browser-test/compiler/src/index.js";
import { createInitialEngineState, ENGINE_VERSION, evaluateEngine } from "../../dist-browser-test/engine/src/index.js";

const source = JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-source.json", "utf8"));
const sourceIdentity = await computeCanonicalSourceIdentity(source);
const flow = source.tests.find((test) => test.type === "network.reachability");
assert.ok(flow);
const p = flow.params;
const makeSet = (title, ids) => createEndpointSet({ title, nodeIds: ids, source });
const sourceSet = await makeSet("Sources", ["attacker", "admin01"]);
const destinationSet = await makeSet("Destinations", ["rds01"]);
const profile = await createFlowProfile({ title: "RDP", flowId: flow.id, protocol: p.protocol, port: p.port, source });
const contract = await createNetworkIntentContract({ title: "Dev2 execution", source, sourceIdentity, endpointSets: [sourceSet, destinationSet], flowProfiles: [profile], rules: [{ sourceSetId: sourceSet.setId, destinationSetId: destinationSet.setId, flowProfileId: profile.profileId, expectation: "MUST REACH", expected: "SUCCESS" }] });
const expansion = await expandNetworkIntent({ contract, source, sourceIdentity, sourceRevision: 4 });
assert.equal(expansion.caseCount, 2);
assert.deepEqual(expansion.cases.map((item) => `${item.sourceNodeId}->${item.destinationNodeId}`), ["admin01->rds01", "attacker->rds01"]);
assert.equal(new Set(expansion.cases.map((item) => item.caseIdentity)).size, 2);
const expansionAgain = await expandNetworkIntent({ contract, source, sourceIdentity, sourceRevision: 4 });
assert.equal(expansion.identity, expansionAgain.identity);
await assert.rejects(() => executeNetworkIntent({ contract, source, sourceIdentity, sourceRevision: 4, expansion: { ...expansion, identity: "tampered-expansion" }, runSequence: 0, runner: { run: async () => { throw new Error("must not execute stale expansion"); } } }), /INTENT_RUN_EXPANSION_STALE/);
const calls = [];
const fakeRunner = { run: async (candidate, flowId, sourceRevision) => { calls.push({ candidate, flowId, sourceRevision }); return { runId: `engine-${calls.length}`, sourceIdentity: await computeCanonicalSourceIdentity(candidate), sourceRevision, flowId, evaluation: { tests: [{ id: flowId, outcome: "TRUE" }], findings: [], objectives: [], evidence: [], completion: { truth: "TRUE" } } }; } };
const run = await executeNetworkIntent({ contract, source, sourceIdentity, sourceRevision: 4, expansion, runSequence: 1, runner: fakeRunner });
assert.equal(run.status, "COMPLETE");
assert.equal(run.cases.length, 2);
assert.equal(run.counts.PASS, 2);
assert.equal(calls.length, 2);
assert.notEqual(calls[0].candidate, source);
const current = await verifyIntentRunCurrent(run, { contract, source, sourceIdentity, sourceRevision: 4 });
assert.equal(current.status, "CURRENT");
assert.equal((await verifyIntentRunIntegrity(run, { contract, source, sourceIdentity, sourceRevision: 4 })).ok, true);
const tamperedRun = structuredClone(run); tamperedRun.cases[0].caseIdentity = "tampered";
assert.equal((await verifyIntentRunIntegrity(tamperedRun, { contract, source, sourceIdentity, sourceRevision: 4 })).ok, false);
const staleSource = structuredClone(source); staleSource.metadata = { ...staleSource.metadata, description: "changed" };
const stale = await verifyIntentRunCurrent(run, { contract, source: staleSource, sourceRevision: 4 });
assert.equal(stale.status, "STALE");
const negativeRunner = { run: async (candidate, flowId, sourceRevision) => ({ runId: "unknown-run", sourceIdentity: await computeCanonicalSourceIdentity(candidate), sourceRevision, flowId, evaluation: { tests: [{ id: flowId, outcome: "UNKNOWN" }], findings: [], objectives: [], evidence: [], completion: { truth: "UNKNOWN" } } }) };
const deny = await createNetworkIntentContract({ title: "Deny", source, sourceIdentity, endpointSets: [sourceSet, destinationSet], flowProfiles: [profile], rules: [{ sourceSetId: sourceSet.setId, destinationSetId: destinationSet.setId, flowProfileId: profile.profileId, expectation: "MUST NOT REACH", expected: "DROP" }] });
const denyRun = await executeNetworkIntent({ contract: deny, source, sourceIdentity, sourceRevision: 1, runSequence: 1, runner: negativeRunner });
assert.equal(denyRun.cases[0].actual, "UNKNOWN");
assert.equal(denyRun.cases[0].result, "UNKNOWN");
const dropRunner = { run: async (candidate, flowId, sourceRevision) => ({ runId: "drop-run", sourceIdentity: await computeCanonicalSourceIdentity(candidate), sourceRevision, flowId, evaluation: { tests: [{ id: flowId, outcome: "FALSE" }], findings: [], objectives: [], evidence: [], completion: { truth: "FALSE" } } }) };
const denyPass = await executeNetworkIntent({ contract: deny, source, sourceIdentity, sourceRevision: 1, runSequence: 2, runner: dropRunner });
assert.equal(denyPass.cases[0].result, "PASS");
const reachFail = await executeNetworkIntent({ contract, source, sourceIdentity, sourceRevision: 0, runSequence: 3, runner: dropRunner });
assert.equal(reachFail.counts.FAIL, 2);
const partialRunner = { run: async (candidate, flowId, sourceRevision) => { if (candidate.tests.find((test) => test.id === flowId).params.from === "attacker") throw new Error("SIMULATED_CASE_ERROR"); return { runId: "partial-run", sourceIdentity: await computeCanonicalSourceIdentity(candidate), sourceRevision, flowId, evaluation: { tests: [{ id: flowId, outcome: "TRUE" }], findings: [], objectives: [], evidence: [], completion: { truth: "TRUE" } } }; } };
const partial = await executeNetworkIntent({ contract, source, sourceIdentity, sourceRevision: 0, runSequence: 4, runner: partialRunner });
assert.equal(partial.status, "PARTIAL");
assert.equal(partial.counts["NOT RUN"], 1);
const wrongBindingRunner = { run: async (candidate, flowId, sourceRevision) => ({ runId: "wrong-binding", sourceIdentity, sourceRevision, flowId, evaluation: { tests: [{ id: flowId, outcome: "TRUE" }], findings: [], objectives: [], evidence: [], completion: { truth: "TRUE" } } }) };
const blocked = await executeNetworkIntent({ contract, source, sourceIdentity, sourceRevision: 0, runSequence: 5, runner: wrongBindingRunner });
assert.equal(blocked.status, "PARTIAL");
assert.equal(blocked.counts["NOT RUN"], 1);
assert.equal(blocked.counts.PASS, 1);
const unmodeledRunner = { run: async (candidate, flowId, sourceRevision) => ({ runId: "unmodeled-run", sourceIdentity: await computeCanonicalSourceIdentity(candidate), sourceRevision, flowId, evaluation: { tests: [], findings: [], objectives: [], evidence: [], completion: { truth: "UNKNOWN" } } }) };
const unmodeled = await executeNetworkIntent({ contract, source, sourceIdentity, sourceRevision: 0, runSequence: 6, runner: unmodeledRunner });
assert.equal(unmodeled.counts.UNMODELED, 2);
const duplicateRules = await createNetworkIntentContract({ title: "Duplicate semantic rules", source, sourceIdentity, endpointSets: [sourceSet, destinationSet], flowProfiles: [profile], rules: [{ title: "one", sourceSetId: sourceSet.setId, destinationSetId: destinationSet.setId, flowProfileId: profile.profileId, expectation: "MUST REACH", expected: "SUCCESS" }, { title: "two", sourceSetId: sourceSet.setId, destinationSetId: destinationSet.setId, flowProfileId: profile.profileId, expectation: "MUST REACH", expected: "SUCCESS" }] });
const duplicateExpansion = await expandNetworkIntent({ contract: duplicateRules, source, sourceIdentity });
assert.equal(duplicateExpansion.caseCount, 4);
assert.equal(new Set(duplicateExpansion.cases.map((item) => item.ruleId)).size, 2);
const realRunner = { run: async (candidate, flowId, sourceRevision) => {
  const compiled = await compileScenario(candidate, { validateSource: () => ({ valid: true, diagnostics: [] }), validateNormalized: () => ({ valid: true, diagnostics: [] }), catalog: { capabilities: catalog.capabilities, profiles: catalog.profiles, assets: catalog.assets }, engineBaselineVersion: ENGINE_VERSION });
  if (!compiled.ok) throw new Error("DEV2_ENGINE_COMPILE_FAILED");
  const state = createInitialEngineState(compiled.model);
  return { runId: `${candidate.scenarioId}:${sourceRevision}:${flowId}`, sourceIdentity: await computeCanonicalSourceIdentity(candidate), sourceRevision, flowId, evaluation: evaluateEngine(compiled.model, state) };
} };
const realRun = await executeNetworkIntent({ contract, source, sourceIdentity, sourceRevision: 0, runSequence: 2, runner: realRunner });
assert.equal(realRun.status, "COMPLETE");
assert.ok(realRun.cases.every((item) => ["PASS", "FAIL", "UNMODELED", "UNKNOWN"].includes(item.result)));
console.log("v18 dev2 intent expansion/execution tests: PASS (24 assertions)");
