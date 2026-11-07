import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  addResource,
  addZone,
  autoLayoutBuilder,
  applyRuntimeOperation,
  compileBuilderWorkspace,
  createBuilderWorkspace,
  deleteConnection,
  deleteZone,
  duplicateResource,
  previewRuntime,
  readScenarioSourceFile,
  setBuilderSelection,
  setHints,
  setLayoutOverride,
  setMissionMetadata,
  setResourceProperty,
  replaceResource,
  replaceZone,
  upsertConnection,
  upsertFinding,
  upsertObjective,
  upsertTest,
} from "../../dist-browser-test/ui/src/browser/index.js";
import { CapabilityPackRegistry } from "../../dist-browser-test/capability-packs/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const source = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-source.json"), "utf8"));
const catalogFile = JSON.parse(fs.readFileSync(path.join(root, "catalog/builtin-catalog.json"), "utf8"));
const schemaPass = () => ({ valid: true, diagnostics: [] });
const options = { compilerContext: { validateSource: schemaPass, validateNormalized: schemaPass, catalog: { capabilities: catalogFile.capabilities, profiles: catalogFile.profiles, assets: catalogFile.assets }, engineBaselineVersion: "0.8.0" } };

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }

let ws = createBuilderWorkspace(source);

let metadataFail = setMissionMetadata(ws, { title: "" });
ok(!metadataFail.ok, "empty mission title rejected");
eq(metadataFail.workspace.sourceRevision, 0, "invalid metadata edit atomic");

let r = addZone(ws, { id: "wan", label: "Duplicate", kind: "wan" });
ok(!r.ok, "duplicate global zone id rejected");
eq(r.workspace.sourceRevision, 0, "duplicate zone rejection atomic");

r = addZone(ws, { id: "child", label: "Child", kind: "custom", parent: "missing" });
ok(!r.ok, "zone with missing parent rejected immediately");

r = addResource(ws, { id: "rds01", type: "server.generic", label: "Duplicate", properties: {} });
ok(!r.ok, "duplicate resource id rejected");

r = addResource(ws, { id: "x01", type: "server.generic", label: "X", zone: "missing", properties: {} });
ok(!r.ok, "resource with unknown zone rejected");
r = replaceZone(ws, { id: "missing", label: "Missing", kind: "custom" });
ok(!r.ok, "editing unknown zone rejected");
r = replaceZone(ws, { id: "wan", label: "WAN", kind: "wan", parent: "wan" });
ok(!r.ok, "zone self-parent rejected");
r = replaceResource(ws, { id: "missing", type: "server.generic", label: "Missing", properties: {}, interfaces: [] });
ok(!r.ok, "editing unknown resource rejected");
r = deleteZone(ws, "missing", true);
ok(!r.ok, "deleting unknown zone rejected");

r = duplicateResource(ws, "missing", "new01");
ok(!r.ok, "duplicate unknown resource rejected");
r = duplicateResource(ws, "rds01", "firewall01");
ok(!r.ok, "duplicate into existing id rejected");

r = upsertConnection(ws, { id: "bad_link", kind: "network", from: { resource: "rds01" }, to: { resource: "missing" }, properties: {} });
ok(!r.ok, "connection with missing endpoint rejected");

r = upsertConnection(ws, { id: "direct_rdp", kind: "network", from: { resource: "rds01" }, to: { resource: "firewall01" }, properties: {} });
ok(!r.ok, "connection cannot collide with test global id");

r = deleteConnection(ws, "missing");
ok(!r.ok, "delete unknown connection rejected");

r = setResourceProperty(ws, "missing", "properties.x", 1);
ok(!r.ok, "property edit unknown resource rejected");
r = setResourceProperty(ws, "rds01", "properties.missing.child", 1);
ok(!r.ok, "property edit cannot silently materialize unknown intermediate path");
r = setResourceProperty(ws, "rds01", "properties.rules.99.action", "deny");
ok(!r.ok, "out-of-range array path rejected");

r = upsertTest(ws, { id: "rds01", type: "network.reachability", params: {} });
ok(!r.ok, "test cannot collide with resource id");
r = upsertFinding(ws, { id: "wan", title: "bad", severity: "low", when: { op: "exists", target: "x", path: "x" } });
ok(!r.ok, "finding cannot collide with zone id");
r = upsertObjective(ws, { id: "firewall01", title: "bad", category: "x", required: true, condition: { op: "equals", target: "rds01", path: "properties.nla", value: true } });
ok(!r.ok, "objective cannot collide with resource id");

r = setHints(ws, [{ level: 1, text: "a" }, { level: 1, text: "b" }]);
ok(!r.ok, "duplicate hint levels rejected");

const same = setLayoutOverride(ws, { id: "missing", x: 1, y: 2 });
eq(same.layoutOverrides, [], "layout override for unknown semantic object ignored");
eq(JSON.stringify(same.source), JSON.stringify(ws.source), "ignored layout override cannot mutate source");

ws = setBuilderSelection(ws, ["missing"], "missing");
eq(ws.selection.ids, [], "unknown builder selection removed");
ok(ws.selection.primary === undefined, "unknown primary selection removed");

const beforeCompile = createBuilderWorkspace(source);
const invalidOptions = {
  compilerContext: {
    ...options.compilerContext,
    validateSource: () => ({ valid: false, diagnostics: [{ severity: "error", code: "BROWSER_SCHEMA_REJECT", path: "$", message: "synthetic" }] }),
  },
};
const invalidCompile = await compileBuilderWorkspace(beforeCompile, invalidOptions);
eq(invalidCompile.compile.status, "invalid", "builder preserves compiler validation failure");
if (invalidCompile.compile.status === "invalid") ok(invalidCompile.compile.diagnostics.some((d) => d.code === "BROWSER_SCHEMA_REJECT"), "compiler diagnostic surfaced unchanged");
const invalidPreview = previewRuntime(invalidCompile);
ok(!invalidPreview.ok, "runtime preview blocked after invalid compile");
eq(invalidPreview.workspace.mode, "builder", "failed preview remains Builder mode");

const idleBuilder = createBuilderWorkspace(source);
const idlePreview = previewRuntime(idleBuilder);
ok(!idlePreview.ok, "runtime preview blocked for stale/idle compile");
const layoutOnIdle = await autoLayoutBuilder(idleBuilder, { id: "never", async layout() { throw new Error("must not execute"); } });
ok(!layoutOnIdle.ok, "auto-layout blocked until compile succeeds");

let compiled = await compileBuilderWorkspace(createBuilderWorkspace(source), options);
eq(compiled.compile.status, "valid", "control compile valid");
if (compiled.compile.status !== "valid") process.exit(1);
let preview = previewRuntime(compiled);
ok(preview.ok && preview.workspace.mode === "runtime", "control runtime preview valid");
if (!preview.ok || preview.workspace.mode !== "runtime") process.exit(1);

const missingWindowsRuntime = new CapabilityPackRegistry([{ id: "core.network", version: "1.0.0", execution: "engine" }]);
const blockedPreview = previewRuntime(compiled, missingWindowsRuntime);
ok(!blockedPreview.ok, "Builder Runtime preview refuses unavailable exact capability pack before play");
if (blockedPreview.ok) process.exit(1);
ok(blockedPreview.diagnostics.some((x) => x.code === "RUNTIME_CAPABILITY_PACK_UNAVAILABLE" && x.objectId === "core.windows"), "Builder preview names unavailable capability pack");
const runtime = preview.workspace;
const failedOperation = applyRuntimeOperation(runtime, { op: "set", target: "missing", path: "properties.x", value: 1 });
ok(!failedOperation.ok, "runtime unknown target operation rejected by Engine");
eq(failedOperation.workspace.engineState.stateRevision, 0, "failed runtime operation atomic");
const failedPath = applyRuntimeOperation(runtime, { op: "set", target: "rds01", path: "properties.missing.child", value: 1 });
ok(!failedPath.ok, "runtime invalid path rejected by Engine");
eq(failedPath.workspace.engineState.stateRevision, 0, "failed runtime path leaves state revision unchanged");

let parseFailed = false;
try { await readScenarioSourceFile({ name: "bad.json", text: async () => "{nope" }); }
catch (error) { parseFailed = error instanceof Error && error.message.includes("bad.json"); }
ok(parseFailed, "malformed imported JSON fails with filename context");

// Runtime must contain normalized immutable scenario and not Builder source object identity.
ok(runtime.scenario !== compiled.source, "runtime scenario is normalized compiler product, not Builder source object");
ok(runtime.engineState.resources.rds01 !== compiled.source.resources.find((x) => x.id === "rds01"), "runtime resource state is isolated from Builder source objects");

console.log(`PASS browser adversarial suite: ${checks} assertions.`);
