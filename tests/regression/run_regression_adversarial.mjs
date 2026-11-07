import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runScenarioRegression } from "../../dist-engine-test/engine/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const base = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-normalized.json"), "utf8"));
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }
function clone() { return structuredClone(base); }

{
  const s = clone();
  delete s.canonicalSolution;
  const r = runScenarioRegression(s);
  ok(!r.passed, "missing canonical solution fails regression");
  ok(!r.solutionApplied, "missing solution not marked applied");
  eq(r.diagnostics[0]?.code, "REGRESSION_CANONICAL_SOLUTION_MISSING", "missing solution diagnostic");
}

{
  const s = clone();
  s.tests[0].expectedInitial = "FALSE";
  const r = runScenarioRegression(s);
  ok(!r.passed, "wrong initial expectation fails");
  ok(r.checks.some((c) => c.id === "initial.test.direct_rdp" && !c.passed), "initial mismatch gate fails");
}

{
  const s = clone();
  for (const test of s.tests) delete test.expectedInitial;
  const r = runScenarioRegression(s);
  ok(!r.passed, "missing initial regression expectation fails verification");
  ok(r.checks.some((c) => c.id === "initial.expectations_present" && !c.passed), "missing initial expectation is explicit");
}

{
  const s = clone();
  for (const test of s.tests) delete test.expectedSolved;
  const r = runScenarioRegression(s);
  ok(!r.passed, "missing solved regression expectation fails verification");
  ok(r.checks.some((c) => c.id === "solved.expectations_present" && !c.passed), "missing solved expectation is explicit");
}

{
  const s = clone();
  s.tests[0].expectedSolved = "TRUE";
  const r = runScenarioRegression(s);
  ok(!r.passed, "wrong solved expectation fails");
  ok(r.checks.some((c) => c.id === "solved.test.direct_rdp" && !c.passed), "solved mismatch gate fails");
}

{
  const s = clone();
  s.canonicalSolution.operations[0].path = "properties.rules.99.action";
  const r = runScenarioRegression(s);
  ok(!r.passed, "invalid canonical operation fails");
  ok(!r.solutionApplied, "failed batch not marked applied");
  eq(r.diagnostics[0]?.code, "REGRESSION_CANONICAL_SOLUTION_FAILED", "operation failure diagnostic");
  eq(r.initialState.resources.firewall01.properties.rules[0].action, "allow", "failed canonical replay is atomic and preserves initial state");
}

{
  const s = clone();
  s.canonicalSolution.operations[0].target = "ghost";
  const r = runScenarioRegression(s);
  ok(!r.passed, "unknown canonical target fails");
  eq(r.operationsApplied, 0, "no partial operation count on failure");
}

{
  const s = clone();
  s.canonicalSolution.operations[0].value = "allow";
  s.tests[0].expectedSolved = "TRUE";
  const r = runScenarioRegression(s);
  ok(!r.passed, "solution that changes nothing meaningful fails objective/completion gates");
  ok(r.checks.some((c) => c.kind === "required-objective" && !c.passed), "required objective gate catches ineffective solution");
  ok(r.checks.some((c) => c.id === "solved.completion" && !c.passed), "completion gate catches ineffective solution");
}

{
  const s = clone();
  // Prove UNKNOWN never passes a solved expectation accidentally.
  s.tests[0].params.to = "ghost";
  s.tests[0].expectedInitial = "UNKNOWN";
  s.tests[0].expectedSolved = "FALSE";
  s.canonicalSolution.operations[0].value = "deny";
  const r = runScenarioRegression(s);
  ok(!r.passed, "UNKNOWN solved result does not satisfy FALSE expectation");
  ok(r.checks.some((c) => c.id === "solved.test.direct_rdp" && c.actual === "UNKNOWN" && !c.passed), "unknown solved outcome is explicit");
}

console.log(`PASS regression adversarial suite: ${checks} assertions.`);
