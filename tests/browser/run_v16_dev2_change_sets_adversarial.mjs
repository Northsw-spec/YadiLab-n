import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { generateChangeSet, importChangeSet, applyChangeSet, verifyChangeSet } from "../../dist-browser-test/ui/src/browser/change-set.js";
import { createVerificationSuite, runVerificationSuite, verifyVerificationSuite } from "../../dist-browser-test/ui/src/browser/verification-suite.js";
const source = JSON.parse(await fs.readFile("tests/fixtures/valid/scenario-source.json", "utf8"));
const target = { ...source, metadata: { ...source.metadata, description: "changed" } };
const changeSet = await generateChangeSet({ baseSource: source, targetSource: target, baseRevision: 0, targetRevision: 1 });
for (const tamper of [
  { ...changeSet, baseSourceIdentity: undefined },
  { ...changeSet, targetSourceIdentity: "f".repeat(64) },
  { ...changeSet, sourceDiff: [...changeSet.sourceDiff, { kind: "BOGUS", domain: "NOPE", id: "x" }] },
  { ...changeSet, identity: "f".repeat(64) },
]) assert.equal((await verifyChangeSet(tamper)).ok, false);
const wrongScenario = { ...source, scenarioId: "other_scenario" };
await assert.rejects(() => generateChangeSet({ baseSource: source, targetSource: wrongScenario, baseRevision: 0, targetRevision: 1 }), /CHANGE_SET_SCENARIO_MISMATCH/);
const wrongBase = await applyChangeSet(changeSet, { ...source, metadata: { ...source.metadata, title: "unrelated" } });
assert.equal(wrongBase.ok, false);
assert.equal((await importChangeSet("not-json")).ok, false);
const suite = await createVerificationSuite({ title: "Tamper", selectedFlowIds: [source.tests[0].id], assertions: [{ assertionId: "a", flowId: source.tests[0].id, type: "ENGINE_TEST_OUTCOME", expected: "SUCCESS" }] });
for (const tamper of [
  { ...suite, schemaVersion: "9.9.9" },
  { ...suite, assertions: [{ ...suite.assertions[0], type: "UNKNOWN_ASSERTION" }] },
  { ...suite, assertions: [{ ...suite.assertions[0], flowId: "missing-flow" }] },
  { ...suite, assertions: [{ ...suite.assertions[0], assertionId: "a" }, { ...suite.assertions[0], assertionId: "a" }] },
  { ...suite, identity: "f".repeat(64) },
]) assert.equal((await verifyVerificationSuite(tamper)).ok, false);
const stale = await runVerificationSuite(suite, { ...source, metadata: { ...source.metadata, title: "new source" } }, 2, { run: async (_source, flowId, sourceRevision) => ({ runId: `old-${flowId}`, sourceIdentity: "a".repeat(64), sourceRevision, flowId, evaluation: { tests: [{ id: flowId, outcome: "TRUE" }], testResults: {}, findings: [], objectives: [], completion: { truth: "TRUE", explanation: [] }, evidence: [] } }) });
assert.equal(stale.results[0].sourceRevision, 2);
assert.equal(stale.historical, true);
console.log("PASS v1.6 Dev2 adversarial: malformed/tampered Change Sets, wrong scenario/base, malformed suite, unknown assertion, invalid flow, duplicate IDs, stale historical run binding");
