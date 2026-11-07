import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  applyRuntimeOperation,
  compileBuilderWorkspace,
  createBuilderWorkspace,
  createRuntimeCheckpoint,
  createRuntimeProgress,
  loadRuntimeProgress,
  previewRuntime,
  redoRuntime,
  replayRuntimeOperations,
  resetRuntime,
  restoreRuntimeCheckpoint,
  undoRuntime,
} from "../../dist-browser-test/ui/src/browser/index.js";
import { ENGINE_VERSION } from "../../dist-browser-test/engine/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const source = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-source.json"), "utf8"));
const catalogFile = JSON.parse(fs.readFileSync(path.join(root, "catalog/builtin-catalog.json"), "utf8"));
const schemaPass = () => ({ valid: true, diagnostics: [] });
const options = { compilerContext: { validateSource: schemaPass, validateNormalized: schemaPass, catalog: { capabilities: catalogFile.capabilities, profiles: catalogFile.profiles, assets: catalogFile.assets }, engineBaselineVersion: ENGINE_VERSION } };

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks += 1; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks += 1; };

const builder = await compileBuilderWorkspace(createBuilderWorkspace(source), options);
eq(builder.compile.status, "valid", "fixture compiles");
if (builder.compile.status !== "valid") process.exit(1);
const preview = previewRuntime(builder);
ok(preview.ok && preview.workspace.mode === "runtime", "runtime preview starts");
if (!preview.ok || preview.workspace.mode !== "runtime") process.exit(1);
let runtime = preview.workspace;
eq(runtime.history.past.length, 0, "new Runtime starts with empty undo stack");
eq(runtime.history.future.length, 0, "new Runtime starts with empty redo stack");
eq(runtime.history.checkpoints.length, 0, "new Runtime starts with no checkpoints");

let result = applyRuntimeOperation(runtime, { op: "set", target: "firewall01", path: "properties.rules.0.action", value: "deny" });
ok(result.ok, "first deterministic operation succeeds");
if (!result.ok) process.exit(1);
runtime = result.workspace;
eq(runtime.engineState.stateRevision, 1, "operation increments Engine revision");
eq(runtime.history.past.length, 1, "operation records previous Engine state");
eq(runtime.history.future.length, 0, "operation keeps redo empty");
eq(runtime.engineState.resources.firewall01.properties.rules[0].action, "deny", "operation state visible");

result = undoRuntime(runtime);
ok(result.ok, "undo succeeds");
if (!result.ok) process.exit(1);
runtime = result.workspace;
eq(runtime.engineState.stateRevision, 0, "undo restores prior revision");
eq(runtime.engineState.resources.firewall01.properties.rules[0].action, "allow", "undo restores prior value");
eq(runtime.history.past.length, 0, "undo consumes past entry");
eq(runtime.history.future.length, 1, "undo creates redo entry");

result = redoRuntime(runtime);
ok(result.ok, "redo succeeds");
if (!result.ok) process.exit(1);
runtime = result.workspace;
eq(runtime.engineState.stateRevision, 1, "redo restores later revision");
eq(runtime.engineState.resources.firewall01.properties.rules[0].action, "deny", "redo restores later value");
eq(runtime.history.past.length, 1, "redo restores undo stack");
eq(runtime.history.future.length, 0, "redo consumes future entry");

result = createRuntimeCheckpoint(runtime, " Perimeter fixed ");
ok(result.ok, "checkpoint creation succeeds");
if (!result.ok) process.exit(1);
runtime = result.workspace;
eq(runtime.history.checkpoints.length, 1, "checkpoint stored");
eq(runtime.history.checkpoints[0].id, "checkpoint-0001", "checkpoint id deterministic");
eq(runtime.history.checkpoints[0].label, "Perimeter fixed", "checkpoint label normalized");
eq(runtime.history.checkpoints[0].state.stateRevision, 1, "checkpoint captures Engine state");

result = applyRuntimeOperation(runtime, { op: "set", target: "rds01", path: "properties.nla", value: true });
ok(result.ok, "second operation succeeds");
if (!result.ok) process.exit(1);
runtime = result.workspace;
eq(runtime.engineState.stateRevision, 2, "second operation advances revision");
eq(runtime.history.checkpoints.length, 1, "normal operation preserves checkpoint list");

result = restoreRuntimeCheckpoint(runtime, "checkpoint-0001");
ok(result.ok, "checkpoint restore succeeds");
if (!result.ok) process.exit(1);
runtime = result.workspace;
eq(runtime.engineState.stateRevision, 1, "checkpoint restores captured revision");
eq(runtime.engineState.resources.rds01.properties.nla, false, "checkpoint restores captured configuration");
eq(runtime.history.future.length, 0, "checkpoint restore clears redo branch");
eq(runtime.history.checkpoints.length, 1, "checkpoint restore preserves checkpoints");

const beforeReset = runtime;
runtime = resetRuntime(runtime);
eq(runtime.engineState.stateRevision, 0, "reset returns to initial Engine revision");
eq(runtime.engineState.resources.firewall01.properties.rules[0].action, "allow", "reset returns initial firewall state");
eq(runtime.history.past.at(-1).stateRevision, beforeReset.engineState.stateRevision, "reset is undoable and records prior state");
result = undoRuntime(runtime);
ok(result.ok, "reset can be undone");
if (!result.ok) process.exit(1);
runtime = result.workspace;
eq(runtime.engineState.resources.firewall01.properties.rules[0].action, "deny", "undo reset restores pre-reset configuration");

const replayOps = [
  { op: "set", target: "firewall01", path: "properties.rules.0.action", value: "deny" },
  { op: "set", target: "rds01", path: "properties.nla", value: true },
];
const replay1 = replayRuntimeOperations(runtime, replayOps);
ok(replay1.ok, "deterministic replay succeeds");
if (!replay1.ok) process.exit(1);
eq(replay1.workspace.engineState.stateRevision, 2, "replay starts at initial state and applies two operations");
eq(replay1.workspace.history.past.length, 2, "replay reconstructs undo history");
eq(replay1.workspace.history.future.length, 0, "replay clears redo history");
eq(replay1.workspace.engineState.resources.firewall01.properties.rules[0].action, "deny", "replay applies first operation");
eq(replay1.workspace.engineState.resources.rds01.properties.nla, true, "replay applies second operation");
const replay2 = replayRuntimeOperations(runtime, replayOps);
ok(replay2.ok, "same replay succeeds again");
if (!replay2.ok) process.exit(1);
eq(replay2.workspace.engineState, replay1.workspace.engineState, "same scenario + same operation list yields same Engine state");

const save = createRuntimeProgress(replay1.workspace);
const changedAgain = applyRuntimeOperation(replay1.workspace, { op: "set", target: "rds01", path: "properties.nla", value: false });
ok(changedAgain.ok, "post-save change succeeds");
if (!changedAgain.ok) process.exit(1);
ok(changedAgain.workspace.history.past.length > 0, "post-save workspace has history");
const loaded = loadRuntimeProgress(changedAgain.workspace, save);
ok(loaded.ok, "progress load succeeds");
if (!loaded.ok) process.exit(1);
eq(loaded.workspace.engineState, replay1.workspace.engineState, "progress load restores saved Engine state");
eq(loaded.workspace.history.past.length, 0, "progress load starts a new undo baseline");
eq(loaded.workspace.history.future.length, 0, "progress load clears redo history");
eq(loaded.workspace.history.checkpoints.length, 0, "progress load clears session-only checkpoints");

eq(loaded.workspace.scenario, changedAgain.workspace.scenario, "history/state lifecycle never replaces canonical scenario object");

const appSource = fs.readFileSync(path.join(root, "ui/app/main.mjs"), "utf8");
ok(appSource.includes("undoRuntime"), "browser app routes Undo through Runtime history API");
ok(appSource.includes("redoRuntime"), "browser app routes Redo through Runtime history API");
ok(appSource.includes("Skapa checkpoint"), "browser app exposes checkpoint creation");
ok(appSource.includes("Återställ senaste checkpoint"), "browser app exposes checkpoint restore");
ok(appSource.includes("resetRuntime(workspace)"), "browser app keeps Reset routed through Runtime API");

console.log(`PASS runtime history suite: ${checks} assertions.`);
