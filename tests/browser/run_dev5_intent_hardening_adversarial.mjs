import assert from "node:assert/strict";
import fs from "node:fs";
import {
  computeCanonicalSourceIdentity,
  createEndpointSet,
  createFlowProfile,
  createNetworkIntentContract,
  previewNetworkIntent,
  verifyNetworkIntentContract,
} from "../../dist-browser-test/ui/src/browser/index.js";

const source = JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-normalized.json", "utf8"));
const flow = source.tests.find((test) => test.type === "network.reachability");
assert.ok(flow);
const ids = source.resources.map((resource) => resource.id);
const sourceIdentity = await computeCanonicalSourceIdentity(source);
const from = await createEndpointSet({ title: "source", nodeIds: [flow.params.from], source });
const to = await createEndpointSet({ title: "destination", nodeIds: [flow.params.to], source });
const profile = await createFlowProfile({ title: "profile", flowId: flow.id, source, protocol: flow.params.protocol, port: flow.params.port });
const contract = await createNetworkIntentContract({ title: "hardening", source, sourceIdentity, endpointSets: [from, to], flowProfiles: [profile], rules: [{ sourceSetId: from.setId, destinationSetId: to.setId, flowProfileId: profile.profileId, expectation: "MUST REACH", expected: "SUCCESS" }] });

const duplicateRule = { ...contract, rules: [{ ...contract.rules[0] }, { ...contract.rules[0] }] };
const duplicateCheck = await verifyNetworkIntentContract(duplicateRule, source);
assert.equal(duplicateCheck.ok, false);
assert.ok(duplicateCheck.diagnostics.includes("INTENT_CONTRACT_DUPLICATE_RULE_ID"));

const danglingRule = { ...contract, rules: [{ ...contract.rules[0], sourceSetId: "missing-set" }] };
const danglingCheck = await verifyNetworkIntentContract(danglingRule, source);
assert.equal(danglingCheck.ok, false);
assert.ok(danglingCheck.diagnostics.includes("INTENT_CONTRACT_ENDPOINT_REFERENCE_INVALID"));

const foreignSource = { ...source, scenarioId: "foreign-scenario" };
const foreignCheck = await verifyNetworkIntentContract(contract, foreignSource);
assert.equal(foreignCheck.ok, false);
assert.ok(foreignCheck.diagnostics.includes("INTENT_CONTRACT_SCENARIO_MISMATCH"));

const alternateNode = ids.find((id) => id !== flow.params.from && id !== flow.params.to);
assert.ok(alternateNode);
const alternateFrom = await createEndpointSet({ title: "alternate", nodeIds: [alternateNode], source });
const alternateContract = await createNetworkIntentContract({ title: "preview-only", source, sourceIdentity, endpointSets: [alternateFrom, to], flowProfiles: [profile], rules: [{ sourceSetId: alternateFrom.setId, destinationSetId: to.setId, flowProfileId: profile.profileId, expectation: "MUST REACH", expected: "SUCCESS" }] });
const preview = await previewNetworkIntent(alternateContract, source);
assert.equal(preview.counts.READY, 1);
assert.equal(preview.cases[0].state, "READY");

console.log("PASS Dev5 intent hardening adversarial: duplicate IDs, dangling references, foreign binding, and non-executing preview");
