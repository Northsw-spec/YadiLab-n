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
  buildBuilderAuthoringModel,
  createBuilderWorkspace,
} from "../../dist-browser-test/ui/src/browser/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const source = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-source.json"), "utf8"));
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }

let ws = createBuilderWorkspace(source);
let model = buildBuilderAuthoringModel(ws);
eq(JSON.parse(model.testsJson).length, source.tests.length, "authoring model includes tests");
eq(JSON.parse(model.findingsJson).length, source.findings.length, "authoring model includes findings");
eq(JSON.parse(model.objectivesJson).length, source.objectives.length, "authoring model includes objectives");
eq(model.compileStatus, "idle", "authoring model exposes compile state");

let tests = JSON.parse(model.testsJson);
tests.push({ id: "nla_test", type: "windows.hardening_check", label: "NLA enabled", params: { target: "rds01" } });
let result = applyTestsAuthoring(ws, JSON.stringify(tests));
ok(result.ok, "tests authoring succeeds"); ws = result.workspace;
eq(ws.source.tests.at(-1)?.id, "nla_test", "new test persisted");

const findings = [{ id: "nla_missing", title: "NLA missing", severity: "medium", when: { op: "equals", target: "rds01", path: "properties.nla", value: false }, evidenceTests: ["nla_test"] }];
result = applyFindingsAuthoring(ws, JSON.stringify(findings));
ok(result.ok, "findings authoring succeeds"); ws = result.workspace;
eq(ws.source.findings.length, 1, "findings collection replaced atomically");

const objectives = [{ id: "enable_nla", title: "Enable NLA", category: "hardening", required: true, condition: { op: "equals", target: "rds01", path: "properties.nla", value: true } }];
result = applyObjectivesAuthoring(ws, JSON.stringify(objectives));
ok(result.ok, "objectives authoring succeeds"); ws = result.workspace;
eq(ws.source.objectives[0]?.id, "enable_nla", "objective persisted");

result = applyHintsAuthoring(ws, JSON.stringify([{ level: 1, text: "Inspect RDP security settings." }, { level: 2, text: "Enable NLA." }]));
ok(result.ok, "hints authoring succeeds"); ws = result.workspace;
eq(ws.source.hints?.length, 2, "hints persisted");

result = applyCompletionAuthoring(ws, JSON.stringify({ op: "equals", target: "rds01", path: "properties.nla", value: true }));
ok(result.ok, "completion authoring succeeds"); ws = result.workspace;
eq(ws.source.completion.op, "equals", "completion rule persisted");

result = applyCanonicalSolutionAuthoring(ws, JSON.stringify({ operations: [{ op: "set", target: "rds01", path: "properties.nla", value: true }] }));
ok(result.ok, "canonical solution authoring succeeds"); ws = result.workspace;
eq(ws.source.canonicalSolution?.operations.length, 1, "canonical solution persisted");

result = applyCanonicalSolutionAuthoring(ws, "");
ok(result.ok, "blank canonical solution removes solution explicitly"); ws = result.workspace;
ok(ws.source.canonicalSolution === undefined, "canonical solution removed");
eq(ws.compile.status, "idle", "authoring changes invalidate compile");
ok(ws.sourceRevision >= 6, "authoring changes increment source revision");

model = buildBuilderAuthoringModel(ws);
eq(JSON.parse(model.hintsJson).length, 2, "authoring model round-trips hints");
eq(JSON.parse(model.completionJson).op, "equals", "authoring model round-trips completion");
eq(model.canonicalSolutionJson, "", "authoring model represents absent solution as blank");

const main = fs.readFileSync(path.join(root, "ui/app/main.mjs"), "utf8");
ok(main.includes("BuilderAuthoringPanels"), "browser app includes authoring panel component");
ok(main.includes("Test JSON"), "browser app exposes tests authoring panel");
ok(main.includes("Fynd JSON"), "browser app exposes findings authoring panel");
ok(main.includes("Mål JSON"), "browser app exposes objectives authoring panel");
ok(main.includes("Kanonisk lösning JSON"), "browser app exposes solution authoring panel");
ok(main.includes("Valideringsstatus"), "browser app exposes validation status");

console.log(`PASS builder authoring suite: ${checks} assertions.`);
