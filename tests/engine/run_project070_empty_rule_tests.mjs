import assert from "node:assert/strict";
import fs from "node:fs";
import { createInitialEngineState, evaluateEngine, evaluateRule } from "../../dist-engine-test/engine/src/index.js";

const scenario = JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-normalized.json", "utf8"));
const state = createInitialEngineState(scenario);
const context = { scenario, state, testResults: {} };

for (const op of ["all", "any"]) {
  const result = evaluateRule({ op, rules: [] }, context);
  assert.equal(result.truth, "UNKNOWN", `${op} without children is not valid evidence`);
  assert.match(result.explanation[0], /no child rules/);
}
console.log("PASS empty ALL and ANY rules fail closed in direct Engine use");

const malformed = structuredClone(scenario);
malformed.completion = { op: "all", rules: [] };
const evaluation = evaluateEngine(malformed, createInitialEngineState(malformed));
assert.equal(evaluation.completion.truth, "UNKNOWN");
assert.match(evaluation.completion.explanation[0], /no child rules/);
console.log("PASS malformed empty completion cannot produce TRUE");

const valid = evaluateRule({ op: "all", rules: [{ op: "equals", target: "rds01", path: "properties.nla", value: false }] }, context);
assert.equal(valid.truth, "TRUE");
console.log("PASS non-empty ALL preserves valid truth evaluation");
