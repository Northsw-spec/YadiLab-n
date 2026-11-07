import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  compileBuilderWorkspace,
  createBuilderWorkspace,
  createRuntimeProgress,
  loadRuntimeProgress,
  previewRuntime,
  readProgressFile,
} from "../../dist-persistence-test/ui/src/browser/index.js";
import { restoreSaveState } from "../../dist-persistence-test/engine/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const source = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-source.json"), "utf8"));
const catalogFile = JSON.parse(fs.readFileSync(path.join(root, "catalog/builtin-catalog.json"), "utf8"));
const schemaPass = () => ({ valid: true, diagnostics: [] });
const options = { compilerContext: { validateSource: schemaPass, validateNormalized: schemaPass, catalog: { capabilities: catalogFile.capabilities, profiles: catalogFile.profiles, assets: catalogFile.assets }, engineBaselineVersion: "0.8.0" } };

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

const cases = [
  ["scenario hash", { ...clone(save), scenarioHash: "0".repeat(64) }, "SAVE_SCENARIO_HASH_MISMATCH"],
  ["schema version", { ...clone(save), schemaVersion: "9.9.9" }, "SAVE_SCHEMA_VERSION_MISMATCH"],
  ["engine version", { ...clone(save), engineVersion: "9.9.9" }, "SAVE_ENGINE_VERSION_MISMATCH"],
  ["negative revision", { ...clone(save), stateRevision: -1 }, "SAVE_STATE_REVISION_INVALID"],
];
for (const [name, mutated, code] of cases) {
  const result = restoreSaveState(runtime.scenario, mutated);
  ok(!result.ok, `${name} mismatch rejected`);
  if (!result.ok) eq(result.code, code, `${name} reports explicit diagnostic code`);
  const browser = loadRuntimeProgress(runtime, mutated);
  ok(!browser.ok, `${name} mismatch blocked by Runtime loader`);
  eq(browser.workspace.engineState.stateRevision, 0, `${name} failure is atomic`);
}

{
  const mutated = clone(save);
  delete mutated.resourceState.rds01;
  const result = restoreSaveState(runtime.scenario, mutated);
  ok(!result.ok, "missing resource in save rejected");
  if (!result.ok) eq(result.code, "SAVE_RESOURCE_SET_MISMATCH", "missing resource diagnostic explicit");
}
{
  const mutated = clone(save);
  mutated.resourceState.evil = { id: "evil", type: "server.generic", label: "evil", interfaces: [], properties: {} };
  const result = restoreSaveState(runtime.scenario, mutated);
  ok(!result.ok, "extra resource in save rejected");
  if (!result.ok) eq(result.code, "SAVE_RESOURCE_SET_MISMATCH", "extra resource diagnostic explicit");
}
{
  const mutated = clone(save);
  mutated.resourceState.rds01.id = "firewall01";
  const result = restoreSaveState(runtime.scenario, mutated);
  ok(!result.ok, "embedded resource identity mismatch rejected");
  if (!result.ok) eq(result.code, "SAVE_RESOURCE_ID_MISMATCH", "resource identity mismatch diagnostic explicit");
}

let parseFailed = false;
try { await readProgressFile({ name: "bad.yadiprogress", text: async () => "{broken" }); }
catch (error) { parseFailed = error instanceof Error && error.message.includes("bad.yadiprogress"); }
ok(parseFailed, "malformed progress JSON rejected with filename context");

console.log(`PASS persistence adversarial suite: ${checks} assertions.`);
