import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  autosaveRuntimeProgress,
  clearAutosavedRuntimeProgress,
  compileBuilderWorkspace,
  createBuilderWorkspace,
  createRuntimeProgress,
  loadRuntimeProgressFile,
  MemoryProgressStore,
  previewRuntime,
  restoreAutosavedRuntimeProgress,
} from "../../dist-persistence-test/ui/src/browser/index.js";
import { ENGINE_VERSION } from "../../dist-persistence-test/engine/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const source = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-source.json"), "utf8"));
const catalogFile = JSON.parse(fs.readFileSync(path.join(root, "catalog/builtin-catalog.json"), "utf8"));
const schemaPass = () => ({ valid: true, diagnostics: [] });
const options = { compilerContext: { validateSource: schemaPass, validateNormalized: schemaPass, catalog: { capabilities: catalogFile.capabilities, profiles: catalogFile.profiles, assets: catalogFile.assets }, engineBaselineVersion: ENGINE_VERSION } };

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }
const clone = (x) => JSON.parse(JSON.stringify(x));

const builder = await compileBuilderWorkspace(createBuilderWorkspace(source), options);
if (builder.compile.status !== "valid") process.exit(1);
const preview = previewRuntime(builder);
if (!preview.ok || preview.workspace.mode !== "runtime") process.exit(1);
const runtime = preview.workspace;
const save = createRuntimeProgress(runtime);
const schemaPassSave = () => ({ valid: true, diagnostics: [] });

{
  const result = await loadRuntimeProgressFile(runtime, { name: "broken.yadiprogress", text: async () => "{broken" }, schemaPassSave);
  ok(!result.ok, "invalid JSON rejected");
  eq(result.diagnostics[0]?.code, "PROGRESS_FILE_PARSE_FAILED", "invalid JSON has explicit parse code");
  eq(result.workspace.engineState.stateRevision, 0, "parse failure is atomic");
}
{
  const result = await loadRuntimeProgressFile(runtime, { name: "wrong.yadiprogress", text: async () => JSON.stringify({ nope: true }) }, () => ({ valid: false, diagnostics: ["$: missing formatId"] }));
  ok(!result.ok, "schema-invalid save rejected");
  eq(result.diagnostics[0]?.code, "PROGRESS_SAVE_SCHEMA_INVALID", "schema-invalid save has explicit code");
  ok(result.diagnostics[0]?.message.includes("missing formatId"), "schema diagnostic detail preserved");
}
for (const [label, mutate, expectedCode] of [
  ["wrong scenario hash", (x) => { x.scenarioHash = "0".repeat(64); }, "SAVE_SCENARIO_HASH_MISMATCH"],
  ["wrong schema version", (x) => { x.schemaVersion = "9.9.9"; }, "SAVE_SCHEMA_VERSION_MISMATCH"],
  ["wrong engine version", (x) => { x.engineVersion = "9.9.9"; }, "SAVE_ENGINE_VERSION_MISMATCH"],
]) {
  const mutated = clone(save); mutate(mutated);
  const result = await loadRuntimeProgressFile(runtime, { name: `${label}.yadiprogress`, text: async () => JSON.stringify(mutated) }, schemaPassSave);
  ok(!result.ok, `${label} rejected after schema validation`);
  eq(result.diagnostics[0]?.code, expectedCode, `${label} preserves Engine compatibility code`);
  eq(result.workspace.engineState.stateRevision, 0, `${label} failure is atomic`);
}
{
  const store = new MemoryProgressStore();
  const result = await restoreAutosavedRuntimeProgress(runtime, store, schemaPassSave);
  ok(!result.ok, "missing autosave rejected");
  eq(result.diagnostics[0]?.code, "PROGRESS_AUTOSAVE_NOT_FOUND", "missing autosave explicit code");
}
{
  const failingStore = { put: async () => { throw new Error("disk full"); }, get: async () => undefined, delete: async () => {}, list: async () => [] };
  const result = await autosaveRuntimeProgress(runtime, failingStore);
  ok(!result.ok, "autosave write exception normalized");
  eq(result.diagnostics[0]?.code, "PROGRESS_AUTOSAVE_WRITE_FAILED", "write exception explicit code");
  ok(result.diagnostics[0]?.message.includes("disk full"), "write exception detail preserved");
}
{
  const failingStore = { put: async () => {}, get: async () => { throw new Error("database unavailable"); }, delete: async () => {}, list: async () => [] };
  const result = await restoreAutosavedRuntimeProgress(runtime, failingStore, schemaPassSave);
  ok(!result.ok, "autosave read exception normalized");
  eq(result.diagnostics[0]?.code, "PROGRESS_AUTOSAVE_READ_FAILED", "read exception explicit code");
}
{
  const failingStore = { put: async () => {}, get: async () => undefined, delete: async () => { throw new Error("delete denied"); }, list: async () => [] };
  const result = await clearAutosavedRuntimeProgress(runtime, failingStore);
  ok(!result.ok, "autosave delete exception normalized");
  eq(result.diagnostics[0]?.code, "PROGRESS_AUTOSAVE_DELETE_FAILED", "delete exception explicit code");
}
{
  const store = new MemoryProgressStore();
  const corrupted = clone(save);
  corrupted.scenarioHash = "0".repeat(64);
  // Store under the runtime key through a wrapper to simulate corrupted IndexedDB content.
  const corruptStore = { put: store.put.bind(store), get: async () => corrupted, delete: store.delete.bind(store), list: store.list.bind(store) };
  const result = await restoreAutosavedRuntimeProgress(runtime, corruptStore, schemaPassSave);
  ok(!result.ok, "corrupted stored save rejected by Engine compatibility checks");
  eq(result.diagnostics[0]?.code, "SAVE_SCENARIO_HASH_MISMATCH", "corrupted autosave preserves Engine diagnostic");
}
{
  const store = { put: async () => {}, get: async () => ({ nope: true }), delete: async () => {}, list: async () => [] };
  const result = await restoreAutosavedRuntimeProgress(runtime, store, () => ({ valid: false, diagnostics: ["bad stored record"] }));
  ok(!result.ok, "schema-invalid stored save rejected before Engine restore");
  eq(result.diagnostics[0]?.code, "PROGRESS_SAVE_SCHEMA_INVALID", "stored schema error explicit code");
}

console.log(`PASS progress-session adversarial suite: ${checks} assertions.`);
