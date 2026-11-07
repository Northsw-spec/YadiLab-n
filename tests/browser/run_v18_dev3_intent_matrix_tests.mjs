import assert from "node:assert/strict";
import fs from "node:fs";
import {
  computeCanonicalSourceIdentity,
  createEndpointSet,
  createFlowProfile,
  createNetworkIntentContract,
  executeNetworkIntent,
  expandNetworkIntent,
  buildIntentResultMatrix,
  filterIntentResultMatrix,
  intentMatrixCellCases,
  verifyIntentResultMatrix,
} from "../../dist-browser-test/ui/src/browser/index.js";

const source = JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-source.json", "utf8"));
const sourceIdentity = await computeCanonicalSourceIdentity(source);
const flow = source.tests.find((test) => test.id === "direct_rdp");
assert.ok(flow);
const makeSet = (title, nodeIds) => createEndpointSet({ title, nodeIds, source });
const clients = await makeSet("Same title", ["attacker", "admin01", "firewall01"]);
const destinations = await makeSet("Same title", ["rds01", "firewall01"]);
const profile = await createFlowProfile({ title: "RDP", flowId: flow.id, protocol: "tcp", port: 3389, source });
const contract = await createNetworkIntentContract({ title: "Dev3 matrix", source, sourceIdentity, endpointSets: [clients, destinations], flowProfiles: [profile], rules: [{ sourceSetId: clients.setId, destinationSetId: destinations.setId, flowProfileId: profile.profileId, expectation: "MUST REACH", expected: "SUCCESS" }] });
const runner = { run: async (candidate, flowId, sourceRevision) => {
  const from = candidate.tests.find((test) => test.id === flowId).params.from;
  const outcome = from === "admin01" ? "TRUE" : from === "attacker" ? "FALSE" : "UNKNOWN";
  return { runId: `engine-${from}`, sourceIdentity: await computeCanonicalSourceIdentity(candidate), sourceRevision, flowId, runtimeRevision: 8, evaluation: { tests: [{ id: flowId, outcome }], findings: [], objectives: [], evidence: [], completion: { truth: outcome } } };
} };
const run = await executeNetworkIntent({ contract, source, sourceIdentity, sourceRevision: 2, runSequence: 1, runner });
assert.equal(run.status, "COMPLETE");
assert.equal(run.counts.PASS, 2);
assert.equal(run.counts.FAIL, 2);
assert.equal(run.counts.UNKNOWN, 2);
const matrix = await buildIntentResultMatrix({ contract, source, run, sourceIdentity, sourceRevision: 2 });
assert.equal(matrix.freshness, "CURRENT");
assert.equal(matrix.cells.length, 4);
assert.equal(matrix.sourceDimensions[0].title, matrix.destinationDimensions[0].title);
assert.equal(new Set(matrix.sourceDimensions.map((item) => item.identity)).size, matrix.sourceDimensions.length);
assert.equal(matrix.cells.filter((cell) => cell.state === "MIXED").length, 1);
const mixed = matrix.cells.find((cell) => cell.state === "MIXED");
assert.ok(mixed);
assert.deepEqual(mixed.counts, { PASS: 2, FAIL: 2, UNMODELED: 0, "NOT RUN": 0, INVALID: 0, "NOT COMPARABLE": 0, UNKNOWN: 2, SIMULATION_LIMIT: 0 });
assert.equal(intentMatrixCellCases(matrix, mixed.cellId).length, 6);
assert.equal(filterIntentResultMatrix(matrix, { state: "MIXED" }).cells.length, 1);
assert.equal(filterIntentResultMatrix(matrix, { ruleId: contract.rules[0].ruleId }).cells.length, 1);
const filtered = filterIntentResultMatrix(matrix, { sourceSetId: clients.setId, destinationSetId: destinations.setId, flowProfileId: profile.profileId });
assert.equal(filtered.cells.length, 1);
assert.equal((await verifyIntentResultMatrix(matrix, { contract, source, run, sourceIdentity, sourceRevision: 2 })).ok, true);
const tampered = structuredClone(matrix); tampered.cells[0].state = "PASS";
assert.equal((await verifyIntentResultMatrix(tampered, { contract, source, run, sourceIdentity, sourceRevision: 2 })).ok, false);
const staleSource = structuredClone(source); staleSource.metadata = { ...staleSource.metadata, description: "changed" };
const historicalExpansion = await expandNetworkIntent({ contract, source, sourceIdentity, sourceRevision: 2 });
const staleMatrix = await buildIntentResultMatrix({ contract, source: staleSource, run, expansion: historicalExpansion, sourceRevision: 2 });
assert.equal(staleMatrix.freshness, "STALE/HISTORICAL");
assert.equal(staleMatrix.cells[0].freshness, "STALE/HISTORICAL");
const changedContract = await createNetworkIntentContract({ title: "Dev3 matrix changed", source, sourceIdentity, endpointSets: [clients, destinations], flowProfiles: [profile], rules: [{ sourceSetId: clients.setId, destinationSetId: destinations.setId, flowProfileId: profile.profileId, expectation: "MUST REACH", expected: "SUCCESS" }], revision: 2 });
const intentStaleMatrix = await buildIntentResultMatrix({ contract: changedContract, historicalContract: contract, source, run, expansion: historicalExpansion, sourceIdentity, sourceRevision: 2 });
assert.equal(intentStaleMatrix.freshness, "STALE/HISTORICAL");
const deny = await createNetworkIntentContract({ title: "Deny matrix", source, sourceIdentity, endpointSets: [clients, destinations], flowProfiles: [profile], rules: [{ sourceSetId: clients.setId, destinationSetId: destinations.setId, flowProfileId: profile.profileId, expectation: "MUST NOT REACH", expected: "DROP" }] });
const denyRun = await executeNetworkIntent({ contract: deny, source, sourceIdentity, sourceRevision: 2, runSequence: 2, runner });
const denyMatrix = await buildIntentResultMatrix({ contract: deny, source, run: denyRun, sourceIdentity, sourceRevision: 2 });
assert.ok(denyMatrix.cells.every((cell) => cell.state !== "PASS"));
console.log("v18 dev3 intent matrix tests: PASS (25 assertions)");
