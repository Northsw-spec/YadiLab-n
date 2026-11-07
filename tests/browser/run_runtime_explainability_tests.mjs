import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  applyRuntimeOperation,
  buildRuntimeDetailModel,
  buildRuntimeViewModel,
  compileBuilderWorkspace,
  createBuilderWorkspace,
  createRuntimeCheckpoint,
  previewRuntime,
  REQUIRED_RUNTIME_SURFACES,
} from "../../dist-browser-test/ui/src/browser/index.js";
import { ENGINE_VERSION } from "../../dist-browser-test/engine/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const source = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-source.json"), "utf8"));
const catalogFile = JSON.parse(fs.readFileSync(path.join(root, "catalog/builtin-catalog.json"), "utf8"));
const schemaPass = () => ({ valid: true, diagnostics: [] });
const options = { compilerContext: { validateSource: schemaPass, validateNormalized: schemaPass, catalog: { capabilities: catalogFile.capabilities, profiles: catalogFile.profiles, assets: catalogFile.assets }, engineBaselineVersion: ENGINE_VERSION } };
let checks = 0;
const ok = (v,m)=>{assert.ok(v,m);checks+=1;};
const eq = (a,b,m)=>{assert.deepEqual(a,b,m);checks+=1;};

const builder = await compileBuilderWorkspace(createBuilderWorkspace(source), options);
if (builder.compile.status !== "valid") process.exit(1);
const preview = previewRuntime(builder);
if (!preview.ok || preview.workspace.mode !== "runtime") process.exit(1);
let runtime = preview.workspace;
const before = JSON.stringify(runtime);
let details = buildRuntimeDetailModel(runtime);
eq(JSON.stringify(runtime), before, "presenter is read-only and does not mutate RuntimeWorkspace");
eq(details.mission.title, runtime.scenario.metadata.title, "mission title projected");
eq(details.mission.briefing, runtime.scenario.metadata.briefing, "mission briefing projected");
eq(details.tests.length, runtime.evaluation.tests.length, "all tests projected");
ok(details.tests.every((item) => item.explanation.length > 0), "test explanations preserved");
eq(details.findings[0].state, runtime.evaluation.findings[0].state, "finding state projected from Engine evaluation");
eq(details.objectives[0].state, runtime.evaluation.objectives[0].state, "objective state projected from Engine evaluation");
eq(details.evidence.length, runtime.evaluation.evidence.length, "all evidence events projected");
ok(details.evidence.every((item) => item.summary.length > 0), "evidence summaries preserved");
eq(details.progress.stateRevision, 0, "progress reflects Engine revision");
eq(details.progress.completion, runtime.evaluation.completion.truth, "progress reflects Engine completion truth");
eq(details.progress.undoDepth, 0, "initial undo depth projected");
eq(details.progress.redoDepth, 0, "initial redo depth projected");
eq(details.progress.checkpoints.length, 0, "initial checkpoints projected");

let op = applyRuntimeOperation(runtime, { op: "set", target: "firewall01", path: "properties.rules.0.action", value: "deny" });
ok(op.ok, "control remediation operation succeeds");
if (!op.ok) process.exit(1);
runtime = op.workspace;
const cp = createRuntimeCheckpoint(runtime, "Solved perimeter");
ok(cp.ok, "control checkpoint succeeds");
if (!cp.ok) process.exit(1);
runtime = cp.workspace;
details = buildRuntimeDetailModel(runtime);
eq(details.progress.stateRevision, 1, "progress updates after Engine operation");
eq(details.progress.undoDepth, 1, "progress exposes undo depth");
eq(details.progress.checkpoints[0].label, "Solved perimeter", "progress exposes checkpoint label");
eq(details.findings.find((x) => x.id === "rdp_exposed")?.state, "FALSE", "resolved finding state is explicit FALSE");
eq(details.objectives.find((x) => x.id === "block_direct_rdp")?.state, "TRUE", "satisfied objective state is explicit TRUE");
eq(details.progress.completion, "TRUE", "completion becomes TRUE after remediation");
ok(details.progress.completionExplanation.length > 0, "completion remains explainable");

const vm = buildRuntimeViewModel(runtime);
eq(vm.panels, REQUIRED_RUNTIME_SURFACES, "Runtime view-model exposes every required Masterprompt surface");
eq(vm.undoDepth, 1, "view-model exposes undo depth");
eq(vm.checkpointCount, 1, "view-model exposes checkpoint count");

const appSource = fs.readFileSync(path.join(root, "ui/app/main.mjs"), "utf8");
for (const surface of ["mission","tests","findings","evidence","progress","hints","learning"]) {
  ok(appSource.includes(`data-runtime-panel\": \"${surface}`) || appSource.includes(`data-runtime-panel": "${surface}`), `browser source renders ${surface} Runtime surface`);
}
ok(!appSource.includes("item.active"), "browser source no longer reads nonexistent finding.active");
ok(!appSource.includes("item.truth"), "browser source no longer reads nonexistent objective.truth");
ok(appSource.includes("item.state"), "browser source renders explicit Engine state fields");
ok(appSource.includes("Explanation"), "browser source renders Engine explanations");

console.log(`PASS runtime explainability suite: ${checks} assertions.`);
