import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  applyRuntimeOperation,
  compileBuilderWorkspace,
  createBuilderWorkspace,
  createProgressDownload,
  createRuntimeProgress,
  loadRuntimeProgress,
  MemoryProgressStore,
  previewRuntime,
  readProgressFile,
  requestPersistentStorage,
} from "../../dist-persistence-test/ui/src/browser/index.js";
import { ENGINE_VERSION, restoreSaveState } from "../../dist-persistence-test/engine/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const source = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-source.json"), "utf8"));
const catalogFile = JSON.parse(fs.readFileSync(path.join(root, "catalog/builtin-catalog.json"), "utf8"));
const schemaPass = () => ({ valid: true, diagnostics: [] });
const options = { compilerContext: { validateSource: schemaPass, validateNormalized: schemaPass, catalog: { capabilities: catalogFile.capabilities, profiles: catalogFile.profiles, assets: catalogFile.assets }, engineBaselineVersion: "0.8.0" } };

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }

let builder = await compileBuilderWorkspace(createBuilderWorkspace(source), options);
eq(builder.compile.status, "valid", "control scenario compiles");
if (builder.compile.status !== "valid") process.exit(1);
const preview = previewRuntime(builder);
ok(preview.ok && preview.workspace.mode === "runtime", "runtime preview starts");
if (!preview.ok || preview.workspace.mode !== "runtime") process.exit(1);
const initialRuntime = preview.workspace;

const op = applyRuntimeOperation(initialRuntime, { op: "set", target: "firewall01", path: "properties.rules.0.action", value: "deny" });
ok(op.ok, "runtime remediation succeeds");
if (!op.ok) process.exit(1);
const remediated = op.workspace;
eq(remediated.engineState.stateRevision, 1, "runtime revision advanced");
eq(remediated.evaluation.completion.truth, "TRUE", "remediated runtime complete");

const save = createRuntimeProgress(remediated);
eq(save.formatId, "infrastructure-cyber-lab.save", "generic save format id");
eq(save.schemaVersion, remediated.scenario.schemaVersion, "save records scenario schema version");
eq(save.scenarioHash, remediated.scenario.sourceHash, "save binds exact scenario source hash");
eq(save.engineVersion, ENGINE_VERSION, "save records exact Engine version");
eq(save.stateRevision, 1, "save records runtime revision");
eq(save.clock, { mode: "virtual", tick: 1 }, "virtual clock deterministic from state revision");
ok(save.completedObjectives.includes("block_direct_rdp"), "completed required objective recorded");
eq(save.evidence.find((x) => x.testId === "direct_rdp")?.outcome, "FALSE", "save records current evidence outcome");
ok(save.resourceState.firewall01 !== remediated.engineState.resources.firewall01, "save resource data deep-cloned from runtime state");

const descriptor = createProgressDownload(remediated);
eq(descriptor.filename, "foundation_acceptance.yadiprogress", "progress extension comes from centralized branding config");
eq(descriptor.mime, "application/json", "progress export uses portable JSON MIME");
eq(JSON.parse(descriptor.text).scenarioHash, save.scenarioHash, "progress export round-trips save state");

const parsed = await readProgressFile({ name: descriptor.filename, text: async () => descriptor.text });
eq(parsed.engineVersion, ENGINE_VERSION, "progress File API read parses exported Engine version");

const loaded = loadRuntimeProgress(initialRuntime, parsed);
ok(loaded.ok, "compatible progress loads into fresh runtime");
if (!loaded.ok) process.exit(1);
eq(loaded.workspace.engineState.stateRevision, 1, "loaded runtime restores state revision");
eq(loaded.workspace.evaluation.tests.find((x) => x.id === "direct_rdp")?.outcome, "FALSE", "loaded runtime reevaluates restored state");
eq(loaded.workspace.evaluation.completion.truth, "TRUE", "loaded runtime recomputes completion from restored state");

const restoredDirect = restoreSaveState(remediated.scenario, save);
ok(restoredDirect.ok, "Engine save restore accepts exact compatible save");
if (restoredDirect.ok) {
  eq(restoredDirect.state.scenarioHash, remediated.scenario.sourceHash, "restored Engine state bound to scenario hash");
  eq(restoredDirect.state.resources.firewall01.properties.rules[0].action, "deny", "restored mutable resource state preserved");
}

const store = new MemoryProgressStore();
await store.put(save);
let stored = await store.get(save.scenarioHash);
ok(stored !== undefined, "memory autosave store returns saved progress");
eq(stored?.stateRevision, 1, "memory store preserves state revision");
if (stored) stored.resourceState.firewall01.properties.rules[0].action = "tampered";
stored = await store.get(save.scenarioHash);
eq(stored?.resourceState.firewall01.properties.rules[0].action, "deny", "memory store isolates returned save objects");
eq((await store.list()).length, 1, "memory store lists saves");
await store.delete(save.scenarioHash);
eq(await store.get(save.scenarioHash), undefined, "memory store deletes by scenario hash");

let persistCalls = 0;
eq(await requestPersistentStorage(undefined), undefined, "persistent-storage request gracefully unsupported");
eq(await requestPersistentStorage({ persist: async () => { persistCalls += 1; return true; } }), true, "persistent-storage request returns browser decision");
eq(persistCalls, 1, "persistent-storage API called once");
eq(await requestPersistentStorage({ persist: async () => false }), false, "persistent-storage denial is surfaced rather than hidden");

fs.mkdirSync(path.join(root, "tests/generated"), { recursive: true });
fs.writeFileSync(path.join(root, "tests/generated/runtime-save.json"), `${JSON.stringify(save, null, 2)}\n`);

console.log(`PASS persistence suite: ${checks} assertions.`);
