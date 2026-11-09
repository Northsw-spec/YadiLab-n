import assert from "node:assert/strict";
import fs from "node:fs";
import { createInitialEngineState, evaluateRule } from "../../dist-engine-test/engine/src/index.js";

const scenario = JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-normalized.json", "utf8"));
const context = { scenario, state: createInitialEngineState(scenario), testResults: {} };
const leaf = { op: "equals", target: "rds01", path: "properties.nla", value: false };

let deep = leaf;
for (let index = 0; index < 20_000; index += 1) deep = { op: "not", rule: deep };
const deepResult = evaluateRule(deep, context);
assert.equal(deepResult.truth, "UNKNOWN");
assert.match(deepResult.explanation[0], /256-level safety limit/);
console.log("PASS deeply nested direct Engine rules fail closed without stack overflow");

const broadResult = evaluateRule({ op: "all", rules: Array.from({ length: 10_000 }, () => leaf) }, context);
assert.equal(broadResult.truth, "UNKNOWN");
assert.match(broadResult.explanation[0], /10000-node safety limit/);
console.log("PASS oversized direct Engine rule trees fail closed before evaluation");

const malformed = evaluateRule({ op: "equals", target: "rds01", path: 1, value: false }, context);
assert.equal(malformed.truth, "UNKNOWN");
console.log("PASS malformed direct rule operands fail closed without throwing");

let valid = leaf;
for (let index = 0; index < 200; index += 1) valid = { op: "not", rule: valid };
assert.equal(evaluateRule(valid, context).truth, "TRUE");
console.log("PASS bounded valid nested rules preserve truth evaluation");
