import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  applyCanonicalSolutionAuthoring,
  applyCompletionAuthoring,
  applyFindingsAuthoring,
  applyHintsAuthoring,
  applyObjectivesAuthoring,
  applyTestsAuthoring,
  createBuilderWorkspace,
} from "../../dist-browser-test/ui/src/browser/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const source = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-source.json"), "utf8"));
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }

const ws = createBuilderWorkspace(source);
const baseline = JSON.stringify(ws.source);
let r = applyTestsAuthoring(ws, "{bad");
ok(!r.ok, "malformed tests JSON rejected");
eq(JSON.stringify(r.workspace.source), baseline, "malformed tests authoring atomic");
r = applyTestsAuthoring(ws, "{}");
ok(!r.ok, "tests must be array");
r = applyTestsAuthoring(ws, JSON.stringify([{ id: "x", type: "network.reachability", params: {} }, { id: "x", type: "network.reachability", params: {} }]));
ok(!r.ok, "duplicate test IDs rejected");
r = applyTestsAuthoring(ws, JSON.stringify([{ id: "rds01", type: "network.reachability", params: {} }]));
ok(!r.ok, "test ID cannot collide with resource");
r = applyTestsAuthoring(ws, JSON.stringify([{ id: "x", type: 5, params: {} }]));
ok(!r.ok, "test type must be string");
r = applyTestsAuthoring(ws, JSON.stringify([{ id: "x", type: "x", params: [] }]));
ok(!r.ok, "test params must be object");

r = applyFindingsAuthoring(ws, JSON.stringify([{ id: "x", title: "X", severity: "high" }]));
ok(!r.ok, "finding requires rule object");
r = applyObjectivesAuthoring(ws, JSON.stringify([{ id: "x", title: "X", category: "c", required: "yes", condition: { op: "all", rules: [] } }]));
ok(!r.ok, "objective required must be boolean");
r = applyHintsAuthoring(ws, JSON.stringify([{ level: 1, text: "a" }, { level: 1, text: "b" }]));
ok(!r.ok, "duplicate hint level rejected by Builder boundary");
r = applyHintsAuthoring(ws, JSON.stringify([{ level: 1.5, text: "x" }]));
ok(!r.ok, "hint level must be integer");
r = applyCompletionAuthoring(ws, "[]");
ok(!r.ok, "completion must be rule object");
r = applyCompletionAuthoring(ws, JSON.stringify({ nope: true }));
ok(!r.ok, "completion requires op");
r = applyCanonicalSolutionAuthoring(ws, JSON.stringify({ operations: {} }));
ok(!r.ok, "canonical solution operations must be array");
r = applyCanonicalSolutionAuthoring(ws, JSON.stringify({ operations: [{ op: "shell", target: "x", path: "p" }] }));
ok(!r.ok, "arbitrary solution operations rejected");
r = applyCanonicalSolutionAuthoring(ws, JSON.stringify({ operations: [{ op: "set", target: "x" }] }));
ok(!r.ok, "canonical operation path required");

const main = fs.readFileSync(path.join(root, "ui/app/main.mjs"), "utf8");
ok(!main.includes("new Function("), "authoring UI does not execute arbitrary code");

console.log(`PASS builder authoring adversarial suite: ${checks} assertions.`);
