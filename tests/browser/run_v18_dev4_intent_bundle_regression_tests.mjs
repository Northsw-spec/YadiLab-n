import assert from "node:assert/strict";
import fs from "node:fs";
import {
  computeCanonicalSourceIdentity, createEndpointSet, createFlowProfile, createNetworkIntentContract,
  createIntentBundle, exportIntentBundle, importIntentBundle, previewIntentBundle,
  createIntentRegressionCampaign, runIntentRegressionCampaign, buildIntentRegressionMatrix,
  createIntentPromotionGate, verifyIntentPromotionGate, verifyIntentRegressionCampaign,
} from "../../dist-browser-test/ui/src/browser/index.js";

const source = JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-source.json", "utf8"));
const sourceIdentity = await computeCanonicalSourceIdentity(source);
const flow = source.tests.find((item) => item.type === "network.reachability"); assert.ok(flow);
const sourceSet = await createEndpointSet({ title: "Clients", nodeIds: [flow.params.from], source });
const destinationSet = await createEndpointSet({ title: "Destinations", nodeIds: [flow.params.to], source });
const profile = await createFlowProfile({ title: "Regression flow", flowId: flow.id, source });
const contract = await createNetworkIntentContract({ title: "Dev4 intent", source, sourceIdentity, endpointSets: [sourceSet, destinationSet], flowProfiles: [profile], rules: [{ sourceSetId: sourceSet.setId, destinationSetId: destinationSet.setId, flowProfileId: profile.profileId, expectation: "MUST REACH", expected: "SUCCESS" }] });
const bundle = await createIntentBundle({ contract, source });
assert.equal(previewIntentBundle(bundle).expectedExpansionCount, 1);
const imported = await importIntentBundle(exportIntentBundle(bundle), source); assert.equal(imported.ok, true); assert.equal(imported.ok && imported.value.status, "HISTORICAL");
const tampered = structuredClone(bundle); tampered.contract.title = "tampered"; assert.equal((await importIntentBundle(JSON.stringify(tampered))).ok, false);
const drifted = structuredClone(source); drifted.metadata = { ...drifted.metadata, description: "source drift" }; assert.equal((await importIntentBundle(exportIntentBundle(bundle), drifted)).ok, false);
const baseline = { subjectId: "baseline", subjectKind: "BASELINE", source, sourceIdentity };
const candidate = { subjectId: "candidate-a", subjectKind: "CANDIDATE", source: structuredClone(source), sourceIdentity };
const campaign = await createIntentRegressionCampaign({ title: "Dev4 campaign", bundle, baseline, candidates: [candidate] });
const runner = { run: async (candidateSource, flowId, sourceRevision) => ({ runId: `${candidateSource.scenarioId}:${flowId}:${sourceRevision}`, sourceIdentity: await computeCanonicalSourceIdentity(candidateSource), sourceRevision, flowId, evaluation: { tests: [{ id: flowId, outcome: "TRUE" }], objectives: [], findings: [], completion: { truth: "TRUE" }, evidence: [] } }) };
const complete = await runIntentRegressionCampaign(campaign, runner); assert.equal(complete.status, "COMPLETE"); assert.equal(complete.currentResults.length, 2);
assert.equal((await verifyIntentRegressionCampaign(complete)).ok, true);
const matrix = await buildIntentRegressionMatrix(complete); assert.equal(matrix.stale, false); assert.equal(matrix.rows.length, 1); assert.equal(matrix.rows[0].transition, "PASS→PASS");
const gate = await createIntentPromotionGate({ campaign: complete, candidateId: "candidate-a" }); assert.equal(gate.state, "REQUIREMENTS MET"); assert.equal(gate.autoPromotion, false); assert.equal((await verifyIntentPromotionGate(gate)).ok, true);
const stale = structuredClone(complete); stale.candidates[0].source.metadata = { ...stale.candidates[0].source.metadata, description: "changed" }; const staleGate = await createIntentPromotionGate({ campaign: stale, candidateId: "candidate-a" }); assert.equal(staleGate.state, "STALE");
const noCases = await createNetworkIntentContract({ title: "Empty", source, sourceIdentity, endpointSets: [sourceSet, destinationSet], flowProfiles: [profile], rules: [] }); const emptyBundle = await createIntentBundle({ contract: noCases, source }); const emptyCampaign = await createIntentRegressionCampaign({ title: "Empty", bundle: emptyBundle, baseline, candidates: [candidate] }); const emptyRun = await runIntentRegressionCampaign(emptyCampaign, runner); const emptyGate = await createIntentPromotionGate({ campaign: emptyRun, candidateId: "candidate-a" }); assert.equal(emptyGate.state, "NOT COMPARABLE");
console.log("PASS v1.8 Dev4 Intent Bundle + Regression + Gate: 15 assertions.");
