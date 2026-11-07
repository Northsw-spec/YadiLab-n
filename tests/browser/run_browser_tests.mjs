import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  addResource,
  addZone,
  autoLayoutBuilder,
  applyRuntimeOperation,
  buildBuilderViewModel,
  buildRuntimeViewModel,
  clearLayoutOverride,
  compileBuilderWorkspace,
  createBuilderWorkspace,
  createScenarioSourceDownload,
  deleteConnection,
  deleteResource,
  deleteZone,
  duplicateResource,
  previewRuntime,
  readScenarioSourceFile,
  replaceResource,
  replaceZone,
  resetRuntime,
  setBuilderSelection,
  setCanonicalSolution,
  setHints,
  setLayoutOverride,
  setMissionMetadata,
  setResourceProperty,
  setRuntimeSelection,
  triggerJsonDownload,
  upsertConnection,
  upsertFinding,
  upsertObjective,
  upsertTest,
} from "../../dist-browser-test/ui/src/browser/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const source = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-source.json"), "utf8"));
const catalogFile = JSON.parse(fs.readFileSync(path.join(root, "catalog/builtin-catalog.json"), "utf8"));
const schemaPass = () => ({ valid: true, diagnostics: [] });
const options = {
  compilerContext: {
    validateSource: schemaPass,
    validateNormalized: schemaPass,
    catalog: { capabilities: catalogFile.capabilities, profiles: catalogFile.profiles, assets: catalogFile.assets },
    engineBaselineVersion: "0.8.0",
  },
};

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }

let ws = createBuilderWorkspace(source);
eq(ws.mode, "builder", "workspace starts in builder mode");
eq(ws.sourceRevision, 0, "initial source revision zero");
eq(ws.dirty, false, "initial workspace clean");
eq(ws.compile.status, "idle", "compile initially idle");
ok(ws.source !== source, "source deep-cloned into workspace");

ws = setBuilderSelection(ws, ["rds01", "firewall01", "missing", "rds01"], "rds01");
eq(ws.selection.ids, ["firewall01", "rds01"], "selection filters unknown and deduplicates deterministically");
eq(ws.selection.primary, "rds01", "explicit valid primary retained");
ok(setBuilderSelection(ws, ["firewall01", "rds01"], "rds01") === ws, "unchanged Builder selection preserves workspace identity");

let result = setMissionMetadata(ws, { title: "Foundation browser acceptance", briefing: "Use Builder then preview Runtime." });
ok(result.ok, "mission metadata edit succeeds");
ws = result.workspace;
eq(ws.source.metadata.title, "Foundation browser acceptance", "mission title updated");
eq(ws.source.metadata.briefing, "Use Builder then preview Runtime.", "mission briefing updated");

result = addZone(ws, { id: "backup", label: "Backup", kind: "backup" });
ok(result.ok, "zone can be added");
ws = result.workspace;
eq(ws.source.zones.at(-1)?.id, "backup", "zone appended");
result = replaceZone(ws, { id: "backup", label: "Backup zone", kind: "backup" });
ok(result.ok, "zone edit succeeds");
ws = result.workspace;
eq(ws.source.zones.find((x) => x.id === "backup")?.label, "Backup zone", "zone edit stored");
eq(ws.sourceRevision, 3, "semantic edits increment revision deterministically");
eq(ws.dirty, true, "semantic edit marks dirty");
eq(ws.compile.status, "idle", "semantic edit invalidates compile");

result = addResource(ws, { id: "backup01", type: "server.generic", label: "Backup01", zone: "backup", properties: { enabled: true }, interfaces: [] });
ok(result.ok, "resource can be added");
ws = result.workspace;
eq(ws.source.resources.at(-1)?.zone, "backup", "resource zone retained");
result = replaceResource(ws, { ...ws.source.resources.find((x) => x.id === "backup01"), id: "backup01", type: "server.generic", label: "Backup Primary", zone: "backup", properties: { enabled: true }, interfaces: [] });
ok(result.ok, "resource typed edit succeeds");
ws = result.workspace;
eq(ws.source.resources.find((x) => x.id === "backup01")?.label, "Backup Primary", "resource label edit stored");

result = duplicateResource(ws, "backup01", "backup02", "Backup02");
ok(result.ok, "resource can be duplicated");
ws = result.workspace;
eq(ws.source.resources.find((x) => x.id === "backup02")?.label, "Backup02", "duplicate gets requested label");
eq(ws.source.resources.find((x) => x.id === "backup02")?.properties, { enabled: true }, "duplicate retains properties");

result = setResourceProperty(ws, "rds01", "properties.nla", true);
ok(result.ok, "inspector property edit succeeds");
ws = result.workspace;
eq(ws.source.resources.find((x) => x.id === "rds01")?.properties.nla, true, "property edit applied to source");
eq(source.resources.find((x) => x.id === "rds01")?.properties.nla, false, "original fixture remains immutable");

result = upsertConnection(ws, { id: "backup_link", kind: "management", from: { resource: "backup01" }, to: { resource: "backup02" }, properties: { purpose: "replication" } });
ok(result.ok, "connection creation succeeds");
ws = result.workspace;
eq(ws.source.connections.find((x) => x.id === "backup_link")?.kind, "management", "connection stored semantically");

result = upsertConnection(ws, { id: "backup_link", kind: "data_flow", from: { resource: "backup01" }, to: { resource: "backup02" }, properties: { purpose: "backup" } });
ok(result.ok, "connection edit succeeds");
ws = result.workspace;
eq(ws.source.connections.find((x) => x.id === "backup_link")?.kind, "data_flow", "connection edit replaces same id");

result = deleteConnection(ws, "backup_link");
ok(result.ok, "connection deletion succeeds");
ws = result.workspace;
ok(!ws.source.connections.some((x) => x.id === "backup_link"), "connection removed");

result = upsertTest(ws, { id: "backup_enabled", type: "windows.hardening_check", label: "Backup enabled", params: { target: "backup01", path: "properties.enabled", equals: true }, expectedInitial: "TRUE", expectedSolved: "TRUE" });
ok(result.ok, "test upsert succeeds");
ws = result.workspace;
ok(ws.source.tests.some((x) => x.id === "backup_enabled"), "test stored");

result = upsertFinding(ws, { id: "backup_disabled", title: "Backup disabled", severity: "medium", when: { op: "equals", target: "backup01", path: "properties.enabled", value: false }, evidenceTests: ["backup_enabled"] });
ok(result.ok, "finding upsert succeeds");
ws = result.workspace;
ok(ws.source.findings.some((x) => x.id === "backup_disabled"), "finding stored");

result = upsertObjective(ws, { id: "backup_ready", title: "Backup ready", category: "backup", required: false, condition: { op: "equals", target: "backup01", path: "properties.enabled", value: true } });
ok(result.ok, "objective upsert succeeds");
ws = result.workspace;
ok(ws.source.objectives.some((x) => x.id === "backup_ready"), "objective stored");

result = setHints(ws, [{ level: 1, text: "Inspect the perimeter rule." }, { level: 2, text: "Check RDP exposure." }]);
ok(result.ok, "hint ladder can be replaced");
ws = result.workspace;
eq(ws.source.hints?.length, 2, "hints stored");

result = setCanonicalSolution(ws, { operations: [{ op: "set", target: "firewall01", path: "properties.rules.0.action", value: "deny" }] });
ok(result.ok, "canonical solution can be set");
ws = result.workspace;
eq(ws.source.canonicalSolution?.operations.length, 1, "canonical solution stored");

const sourceBeforeLayout = JSON.stringify(ws.source);
ws = setLayoutOverride(ws, { id: "rds01", x: 400, y: 220, width: 210, height: 110 });
eq(ws.layoutOverrides.length, 1, "manual layout override stored separately");
eq(JSON.stringify(ws.source), sourceBeforeLayout, "layout override does not mutate semantic source");
ws = clearLayoutOverride(ws, "rds01");
eq(ws.layoutOverrides.length, 0, "layout override can be cleared");

ws = await compileBuilderWorkspace(ws, options);
eq(ws.compile.status, "valid", "builder compiles using real Phase 2 compiler");
if (ws.compile.status !== "valid") process.exit(1);
eq(ws.compile.model.scenarioId, ws.source.scenarioId, "compiled model identity matches source");
eq(ws.compile.model.minimumEngineVersion, "0.8.0", "browser compiler uses supplied engine baseline");

const layoutBackend = {
  id: "test.layout",
  async layout(graph) {
    const out = [];
    graph.children.forEach((node, rootIndex) => {
      out.push({ id: node.id, x: rootIndex * 800, y: 0, width: node.width, height: node.height });
      node.children.forEach((child, childIndex) => {
        out.push({ id: child.id, x: 40 + (childIndex % 2) * 240, y: 80 + Math.floor(childIndex / 2) * 140, width: child.width, height: child.height, parent: node.id });
      });
    });
    return { nodes: out };
  },
};
ws = setLayoutOverride(ws, { id: "rds01", x: 300, y: 300, width: 220, height: 120 });
const layoutResult = await autoLayoutBuilder(ws, layoutBackend);
ok(layoutResult.ok, `Builder invokes Phase 8 layout through backend contract: ${JSON.stringify(layoutResult.diagnostics)}`);
if (!layoutResult.ok) process.exit(1);
ws = layoutResult.workspace;
eq(ws.layout?.scenarioId, ws.source.scenarioId, "resolved layout bound to current scenario");
eq(ws.layout?.nodes.find((x) => x.id === "rds01")?.x, 300, "manual drag override wins over auto-layout coordinates");
eq(ws.layout?.nodes.find((x) => x.id === "rds01")?.manualOverride, true, "manual override remains explicit in layout document");

const builderVm = buildBuilderViewModel(ws);
eq(builderVm.compileStatus, "valid", "builder view model reports compile state");
ok(builderVm.panels.includes("validation"), "builder exposes validation panel");
ok(builderVm.panels.includes("solution"), "builder exposes canonical solution panel");
ok(builderVm.canvas !== undefined, "compiled builder exposes topology projection");
eq(builderVm.canvas?.sourceHash, ws.compile.model.sourceHash, "builder canvas derives from compiled model");
eq(builderVm.canvas?.nodes.find((x) => x.id === "rds01")?.position.x, 300, "Builder canvas consumes resolved layout projection");

const runtimePreview = previewRuntime(ws);
ok(runtimePreview.ok, "runtime preview starts from successful compile");
if (!runtimePreview.ok || runtimePreview.workspace.mode !== "runtime") process.exit(1);
let runtime = runtimePreview.workspace;
eq(runtime.engineState.stateRevision, 0, "runtime state starts at revision zero");
eq(runtime.evaluation.tests.find((x) => x.id === "direct_rdp")?.outcome, "TRUE", "runtime evaluates initial attack path");
eq(runtime.evaluation.completion.truth, "FALSE", "runtime initial completion derives from engine state");
eq(runtime.layout?.nodes.find((x) => x.id === "rds01")?.x, 300, "runtime preview receives Builder layout without making it semantic state");

runtime = setRuntimeSelection(runtime, ["rds01", "missing", "firewall01"], "firewall01");
eq(runtime.selection.ids, ["firewall01", "rds01"], "runtime selection is view-only and filtered");
eq(runtime.selection.primary, "firewall01", "runtime primary selection retained");
ok(setRuntimeSelection(runtime, ["rds01", "firewall01"], "firewall01") === runtime, "unchanged Runtime selection preserves workspace identity");

const sourceRevisionBeforeRuntime = runtime.sourceRevision;
const operationResult = applyRuntimeOperation(runtime, { op: "set", target: "firewall01", path: "properties.rules.0.action", value: "deny" });
ok(operationResult.ok, "runtime operation goes through Engine reducer");
if (!operationResult.ok) process.exit(1);
runtime = operationResult.workspace;
eq(runtime.engineState.stateRevision, 1, "runtime operation increments engine revision");
eq(runtime.sourceRevision, sourceRevisionBeforeRuntime, "runtime mutation cannot change Builder source revision");
eq(runtime.evaluation.tests.find((x) => x.id === "direct_rdp")?.outcome, "FALSE", "runtime reevaluates attack path after remediation");
eq(runtime.evaluation.tests.find((x) => x.id === "admin_rdp")?.outcome, "TRUE", "legitimate management path remains available");
eq(runtime.evaluation.completion.truth, "TRUE", "completion derives from updated engine state");

const runtimeVm = buildRuntimeViewModel(runtime);
ok(runtimeVm.panels.includes("mission"), "runtime exposes Mission");
ok(runtimeVm.panels.includes("configuration"), "runtime exposes Configuration");
ok(runtimeVm.panels.includes("tests"), "runtime exposes Tests");
ok(runtimeVm.panels.includes("findings"), "runtime exposes Findings");
ok(runtimeVm.panels.includes("evidence"), "runtime exposes Evidence");
ok(runtimeVm.panels.includes("progress"), "runtime exposes Progress");
ok(runtimeVm.panels.includes("hints"), "runtime exposes Hints");
ok(runtimeVm.panels.includes("learning"), "runtime exposes Learning");
eq(runtimeVm.stateRevision, 1, "runtime view reports authoritative Engine revision");
eq(runtimeVm.completion.truth, "TRUE", "runtime view completion from Engine evaluation");

runtime = resetRuntime(runtime);
eq(runtime.engineState.stateRevision, 0, "runtime reset recreates initial state");
eq(runtime.evaluation.tests.find((x) => x.id === "direct_rdp")?.outcome, "TRUE", "runtime reset restores initial fault");

const descriptor = createScenarioSourceDownload(ws.source, "lab.json");
eq(descriptor.filename, "lab.json", "explicit export filename honored");
eq(descriptor.mime, "application/json", "export uses JSON MIME type");
ok(descriptor.text.endsWith("\n"), "export is stable newline-terminated text");
eq(JSON.parse(descriptor.text).scenarioId, ws.source.scenarioId, "export round-trips source data");

const imported = await readScenarioSourceFile({ name: "lab.json", text: async () => descriptor.text });
eq(imported.scenarioId, ws.source.scenarioId, "standard file text() import parses JSON");

const hostCalls = [];
const host = {
  createObjectUrl(blob) { hostCalls.push(["create", blob.type, blob.size]); return "blob:test"; },
  clickDownload(url, filename) { hostCalls.push(["click", url, filename]); },
  revokeObjectUrl(url) { hostCalls.push(["revoke", url]); },
};
triggerJsonDownload(descriptor, host);
eq(hostCalls[0]?.[0], "create", "browser download creates Blob URL");
eq(hostCalls[1], ["click", "blob:test", "lab.json"], "browser download triggers explicit filename");
eq(hostCalls[2], ["revoke", "blob:test"], "browser download revokes Blob URL");

// Explicit cascade behavior is deterministic and never hidden.
let zoneWs = createBuilderWorkspace(source);
let zoneBlocked = deleteZone(zoneWs, "server");
ok(!zoneBlocked.ok, "non-empty zone deletion is blocked without explicit cascade");
let zoneCascade = deleteZone(zoneWs, "server", true);
ok(zoneCascade.ok, "explicit zone cascade succeeds");
if (zoneCascade.ok) {
  ok(!zoneCascade.workspace.source.zones.some((x) => x.id === "server"), "zone cascade removes zone");
  ok(!zoneCascade.workspace.source.resources.some((x) => x.id === "rds01"), "zone cascade removes contained resource");
  ok(!zoneCascade.workspace.source.connections.some((x) => x.from.resource === "rds01" || x.to.resource === "rds01"), "zone cascade removes affected connections");
}

let deleteWs = createBuilderWorkspace(source);
let blockedDelete = deleteResource(deleteWs, "rds01");
ok(!blockedDelete.ok, "referenced resource deletion is blocked without explicit cascade");
eq(blockedDelete.workspace.source.resources.length, deleteWs.source.resources.length, "failed delete is atomic");
let cascadeDelete = deleteResource(deleteWs, "rds01", true);
ok(cascadeDelete.ok, "explicit cascade allows resource deletion");
if (cascadeDelete.ok) {
  ok(!cascadeDelete.workspace.source.resources.some((x) => x.id === "rds01"), "cascade deletes resource");
  ok(!cascadeDelete.workspace.source.connections.some((x) => x.from.resource === "rds01" || x.to.resource === "rds01"), "cascade deletes only referencing connections");
}

console.log(`PASS browser foundation suite: ${checks} assertions.`);
