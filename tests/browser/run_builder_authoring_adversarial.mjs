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

// PROJECT-060: reject canonical solutions that Engine would refuse after
// the operator has already edited/saved a supposedly runnable project.
for (const unsafePath of [
  "id", "type", "zone", "label", "interfaces", "interfaces.0.id",
  "interfaces.0.name", "properties.__proto__.polluted",
  "properties.constructor.prototype.access",
]) {
  const denied = applyCanonicalSolutionAuthoring(ws, JSON.stringify({
    operations: [{ op: "set", target: "rds01", path: unsafePath, value: true }],
  }));
  ok(!denied.ok, "unsafe solution operation fails before source mutation: " + unsafePath);
  ok(denied.diagnostics.some(d => d.code === "BUILDER_AUTHORING_SOLUTION_PATH_FORBIDDEN"),
    "blocked solution path has stable diagnostic");
  eq(denied.workspace, ws, "rejected canonical solution retains same workspace");
  eq(JSON.stringify(denied.workspace.source), baseline,
    "rejected canonical solution leaves source byte-for-byte intact");
}
for (const invalidOperation of [
  { op: "set", target: "rds01", path: "properties.nla" },
  { op: "remove", target: "rds01", path: "properties.nla", value: true },
]) {
  const denied = applyCanonicalSolutionAuthoring(ws, JSON.stringify({ operations: [invalidOperation] }));
  ok(!denied.ok, "missing/extra operation values rejected");
  ok(denied.diagnostics.some(d => d.code === "BUILDER_AUTHORING_SOLUTION_OPERATION_INVALID"),
    "invalid operation shape reports precise diagnostic");
  eq(denied.workspace, ws, "bad operation shape preserves Builder");
}
const validAuthoring = applyCanonicalSolutionAuthoring(ws, JSON.stringify({
  operations: [
    { op: "set", target: "rds01", path: "properties.nla", value: true },
    { op: "set", target: "rds01", path: "interfaces.0.addresses", value: ["192.0.2.44"] },
  ],
}));
ok(validAuthoring.ok, "mutable property and selected interface state remain authorable");
eq(validAuthoring.workspace.source.canonicalSolution.operations.length, 2,
  "both accepted solution operations retain their authored order");
eq(JSON.stringify(ws.source), baseline,
  "positive authoring still leaves originating workspace immutable");

const main = fs.readFileSync(path.join(root, "ui/app/main.mjs"), "utf8");
ok(!main.includes("new Function("), "authoring UI does not execute arbitrary code");

console.log(`PASS builder authoring adversarial suite: ${checks} assertions.`);
