import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  applyRuntimeOperation,
  compileBuilderWorkspace,
  createBuilderWorkspace,
  createRuntimeCheckpoint,
  previewRuntime,
  redoRuntime,
  replayRuntimeOperations,
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
if (builder.compile.status !== "valid") process.exit(1);
const preview = previewRuntime(builder);
if (!preview.ok || preview.workspace.mode !== "runtime") process.exit(1);
const initial = preview.workspace;

let result = undoRuntime(initial);
ok(!result.ok, "undo on initial state fails closed");
eq(result.workspace, initial, "failed undo is atomic");
eq(result.diagnostics[0].code, "RUNTIME_UNDO_EMPTY", "empty undo diagnostic stable");
result = redoRuntime(initial);
ok(!result.ok, "redo on initial state fails closed");
eq(result.workspace, initial, "failed redo is atomic");
eq(result.diagnostics[0].code, "RUNTIME_REDO_EMPTY", "empty redo diagnostic stable");
result = restoreRuntimeCheckpoint(initial, "missing");
ok(!result.ok, "unknown checkpoint fails closed");
eq(result.workspace, initial, "unknown checkpoint restore atomic");
eq(result.diagnostics[0].code, "RUNTIME_CHECKPOINT_NOT_FOUND", "missing checkpoint diagnostic stable");

const badApply = applyRuntimeOperation(initial, { op: "set", target: "missing", path: "properties.x", value: true });
ok(!badApply.ok, "invalid Engine operation fails");
eq(badApply.workspace, initial, "failed Engine operation does not mutate history");
eq(badApply.workspace.history, initial.history, "failed Engine operation preserves history object");

const good = applyRuntimeOperation(initial, { op: "set", target: "firewall01", path: "properties.rules.0.action", value: "deny" });
if (!good.ok) process.exit(1);
const undone = undoRuntime(good.workspace);
if (!undone.ok) process.exit(1);
eq(undone.workspace.history.future.length, 1, "control undo creates redo branch");
const branch = applyRuntimeOperation(undone.workspace, { op: "set", target: "rds01", path: "properties.nla", value: true });
ok(branch.ok, "new branch operation succeeds");
if (!branch.ok) process.exit(1);
eq(branch.workspace.history.future.length, 0, "new operation after undo irreversibly clears redo branch");
const redoAfterBranch = redoRuntime(branch.workspace);
ok(!redoAfterBranch.ok, "cleared redo branch cannot be replayed accidentally");

const cp = createRuntimeCheckpoint(good.workspace, "");
ok(cp.ok, "blank checkpoint label accepted with deterministic default");
if (!cp.ok) process.exit(1);
eq(cp.workspace.history.checkpoints[0].label, "Checkpoint 1", "blank checkpoint label receives deterministic default");
const tampered = {
  ...cp.workspace,
  history: {
    ...cp.workspace.history,
    checkpoints: cp.workspace.history.checkpoints.map((item) => ({ ...item, scenarioHash: "other-hash" })),
  },
};
const badRestore = restoreRuntimeCheckpoint(tampered, "checkpoint-0001");
ok(!badRestore.ok, "tampered cross-scenario checkpoint rejected");
eq(badRestore.workspace, tampered, "cross-scenario checkpoint rejection atomic");
eq(badRestore.diagnostics[0].code, "RUNTIME_CHECKPOINT_SCENARIO_MISMATCH", "checkpoint hash diagnostic stable");

const badReplayTarget = replayRuntimeOperations(good.workspace, [{ op: "set", target: "missing", path: "properties.x", value: true }]);
ok(!badReplayTarget.ok, "replay with unknown target fails closed");
eq(badReplayTarget.workspace, good.workspace, "failed replay leaves original workspace untouched");
eq(badReplayTarget.diagnostics[0].code, "RUNTIME_REPLAY_FAILED", "replay failure diagnostic stable");
const badReplayPath = replayRuntimeOperations(good.workspace, [{ op: "set", target: "firewall01", path: "properties.rules.999.action", value: "deny" }]);
ok(!badReplayPath.ok, "replay with impossible path fails closed");
eq(badReplayPath.workspace, good.workspace, "failed replay path is atomic");

const cp2 = createRuntimeCheckpoint(cp.workspace, "Second");
ok(cp2.ok, "second checkpoint succeeds");
if (!cp2.ok) process.exit(1);
eq(cp2.workspace.history.checkpoints.map((x) => x.id), ["checkpoint-0001", "checkpoint-0002"], "checkpoint identifiers remain deterministic and monotonic");

console.log(`PASS runtime history adversarial suite: ${checks} assertions.`);
