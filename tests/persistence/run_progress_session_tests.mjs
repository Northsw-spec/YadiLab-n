import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  applyRuntimeOperation,
  autosaveRuntimeProgress,
  clearAutosavedRuntimeProgress,
  compileBuilderWorkspace,
  createBuilderWorkspace,
  createProgressDownload,
  createRuntimeProgress,
  loadRuntimeProgressFile,
  MemoryProgressStore,
  previewRuntime,
  resetRuntime,
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

let builder = await compileBuilderWorkspace(createBuilderWorkspace(source), options);
eq(builder.compile.status, "valid", "control scenario compiles");
if (builder.compile.status !== "valid") process.exit(1);
const preview = previewRuntime(builder);
ok(preview.ok && preview.workspace.mode === "runtime", "runtime preview starts");
if (!preview.ok || preview.workspace.mode !== "runtime") process.exit(1);
const initial = preview.workspace;

const changedResult = applyRuntimeOperation(initial, { op: "set", target: "firewall01", path: "properties.rules.0.action", value: "deny" });
ok(changedResult.ok, "runtime change succeeds");
if (!changedResult.ok) process.exit(1);
const changed = changedResult.workspace;
eq(changed.engineState.stateRevision, 1, "changed runtime revision is one");
eq(changed.evaluation.completion.truth, "TRUE", "changed runtime is completed");

const descriptor = createProgressDownload(changed);
eq(descriptor.filename, "foundation_acceptance.yadiprogress", "portable progress uses centralized extension");
eq(descriptor.mime, "application/json", "portable progress uses JSON");
const exported = JSON.parse(descriptor.text);
eq(exported.scenarioHash, changed.scenario.sourceHash, "export binds exact scenario hash");
eq(exported.engineVersion, ENGINE_VERSION, "export binds exact engine version");
eq(exported.stateRevision, 1, "export includes mutable revision");

let validatorCalls = 0;
const validator = (input) => {
  validatorCalls += 1;
  const valid = input && typeof input === "object" && input.formatId === "infrastructure-cyber-lab.save" && typeof input.scenarioHash === "string" && input.resourceState && Array.isArray(input.completedObjectives) && Array.isArray(input.evidence);
  return { valid, diagnostics: valid ? [] : ["save schema rejected input"] };
};

const reset = resetRuntime(changed);
eq(reset.engineState.stateRevision, 0, "runtime reset before portable restore");
const fileLoaded = await loadRuntimeProgressFile(reset, { name: descriptor.filename, text: async () => descriptor.text }, validator);
ok(fileLoaded.ok, "portable progress file restores");
if (!fileLoaded.ok) process.exit(1);
eq(fileLoaded.workspace.engineState.stateRevision, 1, "portable restore reinstates state revision");
eq(fileLoaded.workspace.engineState.resources.firewall01.properties.rules[0].action, "deny", "portable restore reinstates mutable configuration");
eq(fileLoaded.workspace.evaluation.completion.truth, "TRUE", "portable restore reevaluates completion");
eq(fileLoaded.workspace.scenario.sourceHash, initial.scenario.sourceHash, "portable restore does not replace scenario definition");
eq(validatorCalls, 1, "portable restore validates schema exactly once");

const store = new MemoryProgressStore();
const autosaved = await autosaveRuntimeProgress(changed, store);
ok(autosaved.ok, "autosave writes progress");
eq(autosaved.workspace, changed, "autosave does not replace runtime workspace");
const stored = await store.get(changed.scenario.sourceHash);
ok(stored !== undefined, "autosave keyed by exact scenario hash");
eq(stored?.stateRevision, 1, "autosave stores latest state revision");

const restored = await restoreAutosavedRuntimeProgress(reset, store, validator);
ok(restored.ok, "autosaved progress restores");
if (!restored.ok) process.exit(1);
eq(restored.workspace.engineState.stateRevision, 1, "autosave restore reinstates revision");
eq(restored.workspace.engineState.resources.firewall01.properties.rules[0].action, "deny", "autosave restore reinstates mutable configuration");
eq(restored.workspace.evaluation.completion.truth, "TRUE", "autosave restore reevaluates completion");
eq(restored.workspace.scenario, reset.scenario, "autosave restore preserves canonical scenario object");

const cleared = await clearAutosavedRuntimeProgress(restored.workspace, store);
ok(cleared.ok, "autosave clear succeeds");
eq(await store.get(changed.scenario.sourceHash), undefined, "cleared autosave is absent");

const save = createRuntimeProgress(changed);
eq(save.scenarioHash, changed.scenario.sourceHash, "session layer uses existing Engine save contract");
eq(save.engineVersion, ENGINE_VERSION, "session layer uses existing Engine version contract");

const appSource = fs.readFileSync(path.join(root, "ui/app/main.mjs"), "utf8");
ok(appSource.includes("createProgressDownload"), "browser app exposes portable progress export");
ok(appSource.includes("loadRuntimeProgressFile"), "browser app routes portable progress import through session layer");
ok(appSource.includes("new IndexedDbProgressStore"), "browser app uses IndexedDB-backed autosave when available");
ok(appSource.includes('packageValidator("save")'), "browser app validates save contract before restore");
ok(appSource.includes("Återställ autosparning"), "browser app exposes exact-scenario autosave restore");
ok(appSource.includes("Rensa autosparning"), "browser app exposes autosave deletion");

console.log(`PASS progress-session suite: ${checks} assertions.`);
