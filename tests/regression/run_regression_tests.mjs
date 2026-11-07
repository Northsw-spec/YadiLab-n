import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  ENGINE_VERSION,
  replayCanonicalSolution,
  runScenarioRegression,
} from "../../dist-engine-test/engine/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const fixture = (rel) => JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures", rel), "utf8"));
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }

const scenario = fixture("valid/scenario-normalized.json");
eq(ENGINE_VERSION, "0.8.0", "engine version includes DNAT-aware reachability");

const replay = replayCanonicalSolution(scenario);
ok(replay.ok, "canonical solution replays");
eq(replay.operationsApplied, 1, "exact canonical operation count");
eq(replay.initialState.stateRevision, 0, "initial revision is zero");
eq(replay.solvedState?.stateRevision, 1, "solved revision equals applied operation count");
eq(replay.initialState.resources.firewall01.properties.rules[0].action, "allow", "initial state preserved");
eq(replay.solvedState?.resources.firewall01.properties.rules[0].action, "deny", "canonical operation applied");

const report = runScenarioRegression(scenario);
ok(report.passed, `fixture regression passes: ${JSON.stringify(report.diagnostics)}`);
ok(report.solutionApplied, "solution marked applied");
eq(report.operationsApplied, 1, "report operation count");
eq(report.initialEvaluation.tests[0].outcome, "TRUE", "initial fault is present");
eq(report.initialEvaluation.tests[1].outcome, "TRUE", "legitimate management path initially works");
eq(report.initialEvaluation.completion.truth, "FALSE", "initial scenario is unsolved");
eq(report.solvedEvaluation?.tests[0].outcome, "FALSE", "solved expectation reached");
eq(report.solvedEvaluation?.tests[1].outcome, "TRUE", "legitimate management path remains working after remediation");
eq(report.solvedEvaluation?.findings[0].state, "FALSE", "finding resolves after canonical solution");
eq(report.solvedEvaluation?.objectives[0].state, "TRUE", "required objective passes");
eq(report.solvedEvaluation?.completion.truth, "TRUE", "completion passes");
ok(report.checks.every((check) => check.passed), "every regression gate passes");
eq(report.checks.map((check) => check.id), [
  "initial.expectations_present",
  "initial.test.direct_rdp",
  "initial.test.admin_rdp",
  "initial.completion",
  "solution.apply",
  "solved.expectations_present",
  "solved.test.direct_rdp",
  "solved.test.admin_rdp",
  "solved.objective.block_direct_rdp",
  "solved.completion",
], "check ordering is deterministic");

const report2 = runScenarioRegression(scenario);
eq(report2, report, "repeated canonical regression is byte-structure deterministic");

const compiled = JSON.parse(fs.readFileSync(path.join(root, "tests/generated/compiled-foundation.json"), "utf8"));
eq(compiled.tests[0].expectedSolved, "FALSE", "compiler preserves expectedSolved");
const compiledReport = runScenarioRegression(compiled);
ok(compiledReport.passed, `compiler-generated model passes Phase 4 regression: ${JSON.stringify(compiledReport.diagnostics)}`);
eq(compiledReport.solvedEvaluation?.completion.truth, "TRUE", "compiled scenario reaches solved completion");

console.log(`PASS regression suite: ${checks} assertions.`);
