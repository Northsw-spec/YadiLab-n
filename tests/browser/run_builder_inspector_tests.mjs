import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  applyConnectionInspector,
  applyMissionInspector,
  applyResourceInspector,
  applyZoneInspector,
  buildBuilderInspectorModel,
  createBuilderWorkspace,
  createConnectionFromInspector,
  createResourceFromInspector,
  createZoneFromInspector,
  deleteSelectedBuilderObject,
  deleteResource,
  deleteZone,
  duplicateSelectedBuilderResource,
  setBuilderSelection,
} from "../../dist-browser-test/ui/src/browser/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const source = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-source.json"), "utf8"));
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }

let ws = createBuilderWorkspace(source);
let model = buildBuilderInspectorModel(ws);
eq(model.kind, "mission", "no selection exposes mission inspector");
if (model.kind !== "mission") process.exit(1);
eq(model.title, source.metadata.title, "mission inspector reflects source title");

let result = applyMissionInspector(ws, { title: "Inspector lab", language: "sv", briefing: "Edit visually", description: "Typed inspector" });
ok(result.ok, "mission inspector edit succeeds");
ws = result.workspace;
eq(ws.source.metadata.title, "Inspector lab", "mission title persisted through Builder API");
eq(ws.source.metadata.description, "Typed inspector", "mission description persisted");

ws = setBuilderSelection(ws, ["wan"], "wan");
model = buildBuilderInspectorModel(ws);
eq(model.kind, "zone", "zone selection exposes zone inspector");
if (model.kind !== "zone") process.exit(1);
ok(model.availableParents.includes("server"), "zone inspector lists other zones as parents");
result = applyZoneInspector(ws, "wan", { label: "External WAN", kind: "internet" });
ok(result.ok, "zone inspector edit succeeds");
ws = result.workspace;
eq(ws.source.zones.find((x) => x.id === "wan")?.label, "External WAN", "zone label persisted");
eq(ws.source.zones.find((x) => x.id === "wan")?.kind, "internet", "zone kind persisted");

ws = setBuilderSelection(ws, ["rds01"], "rds01");
model = buildBuilderInspectorModel(ws);
eq(model.kind, "resource", "resource selection exposes resource inspector");
if (model.kind !== "resource") process.exit(1);
eq(JSON.parse(model.propertiesJson).nla, false, "resource properties rendered as editable JSON");
result = applyResourceInspector(ws, "rds01", {
  label: "RDS Primary",
  type: "windows.rds_host",
  zone: "server",
  profile: "",
  vendor: "Microsoft",
  product: "Windows Server",
  propertiesJson: JSON.stringify({ rdp: { enabled: true, port: 3389 }, nla: true }),
  interfacesJson: JSON.stringify([{ id: "eth0", label: "LAN", addresses: ["10.0.0.20/24"] }]),
});
ok(result.ok, "resource inspector typed edit succeeds");
ws = result.workspace;
const rds = ws.source.resources.find((x) => x.id === "rds01");
eq(rds?.label, "RDS Primary", "resource label persisted");
eq(rds?.properties.nla, true, "resource properties persisted from JSON editor");
eq(rds?.interfaces?.[0]?.id, "eth0", "resource interfaces persisted");
eq(rds?.vendor, "Microsoft", "optional vendor persisted");

ws = setBuilderSelection(ws, ["fw_rds"], "fw_rds");
model = buildBuilderInspectorModel(ws);
eq(model.kind, "connection", "connection selection exposes connection inspector");
if (model.kind !== "connection") process.exit(1);
result = applyConnectionInspector(ws, "fw_rds", {
  kind: "management",
  fromResource: "firewall01",
  fromPort: "lan",
  toResource: "rds01",
  toPort: "eth0",
  propertiesJson: JSON.stringify({ purpose: "admin" }),
});
ok(result.ok, "connection inspector edit succeeds");
ws = result.workspace;
const link = ws.source.connections.find((x) => x.id === "fw_rds");
eq(link?.kind, "management", "connection kind persisted");
eq(link?.from.port, "lan", "connection source port persisted");
eq(link?.properties.purpose, "admin", "connection properties persisted");

result = createZoneFromInspector(ws, "backup", { label: "Backup", kind: "backup" });
ok(result.ok, "visual create zone command succeeds");
ws = result.workspace;
result = createResourceFromInspector(ws, "backup01", {
  label: "Backup01", type: "server.generic", zone: "backup", propertiesJson: "{}", interfacesJson: "[]",
});
ok(result.ok, "visual create resource command succeeds");
ws = result.workspace;
result = createResourceFromInspector(ws, "backup02", {
  label: "Backup02", type: "server.generic", zone: "backup", propertiesJson: "{}", interfacesJson: "[]",
});
ok(result.ok, "second visual resource succeeds");
ws = result.workspace;
result = createConnectionFromInspector(ws, "backup_link", {
  kind: "data_flow", fromResource: "backup01", toResource: "backup02", propertiesJson: "{\"encrypted\":true}",
});
ok(result.ok, "visual create connection command succeeds");
ws = result.workspace;
eq(ws.source.connections.find((x) => x.id === "backup_link")?.properties.encrypted, true, "new connection properties stored");

ws = setBuilderSelection(ws, ["backup01"], "backup01");
result = duplicateSelectedBuilderResource(ws, "backup03", "Backup03");
ok(result.ok, "selected resource can be duplicated visually");
ws = result.workspace;
eq(ws.source.resources.find((x) => x.id === "backup03")?.zone, "backup", "duplicate retains semantic zone");

ws = setBuilderSelection(ws, ["backup03"], "backup03");
result = deleteSelectedBuilderObject(ws, false);
ok(result.ok, "unreferenced selected resource can be deleted visually");
ws = result.workspace;
ok(!ws.source.resources.some((x) => x.id === "backup03"), "selected resource deleted");
eq(ws.compile.status, "idle", "inspector semantic edits invalidate compile result");
ok(ws.sourceRevision >= 10, "inspector edits increment source revision");

// BUILDER-052: the typed resource editor is a canonical source editor.
// An unrelated label change must not drop an explicit asset requirement.
const sourceWithAsset = structuredClone(source);
const originalAsset = { id: "endpoint.windows", version: "1.0.0" };
const assetResource = sourceWithAsset.resources.find((item) => item.id === "rds01");
if (!assetResource) throw Error("asset resource fixture unavailable");
assetResource.asset = originalAsset;
let assetWorkspace = createBuilderWorkspace(sourceWithAsset);
const sourceAssetDigest = JSON.stringify(assetWorkspace.source);
const assetInput = {
  label: "RDS with preserved asset", type: assetResource.type,
  zone: assetResource.zone, propertiesJson: JSON.stringify(assetResource.properties),
  interfacesJson: JSON.stringify(assetResource.interfaces ?? []),
};
result = applyResourceInspector(assetWorkspace, "rds01", assetInput);
ok(result.ok, "resource label edit succeeds with existing asset");
assetWorkspace = result.workspace;
eq(assetWorkspace.source.resources.find((item) => item.id === "rds01")?.asset,
  originalAsset, "resource label edit preserves existing canonical asset when asset pair omitted");
result = applyResourceInspector(assetWorkspace, "rds01",
  { ...assetInput, assetId: originalAsset.id, assetVersion: originalAsset.version });
ok(result.ok, "same explicit asset pair stays accepted");
eq(result.workspace.source.resources.find((item) => item.id === "rds01")?.asset,
  originalAsset, "unchanged visible asset fields preserve exact requirement");
assetWorkspace = result.workspace;
result = applyResourceInspector(assetWorkspace, "rds01",
  { ...assetInput, assetId: "endpoint.linux", assetVersion: "2.0.0" });
ok(result.ok, "resource can update an asset pair intentionally");
eq(result.workspace.source.resources.find((item) => item.id === "rds01")?.asset,
  { id: "endpoint.linux", version: "2.0.0" },
  "edited asset ID and version survive canonical source replacement");
assetWorkspace = result.workspace;
result = applyResourceInspector(assetWorkspace, "rds01",
  { ...assetInput, assetId: "", assetVersion: "" });
ok(result.ok, "user can explicitly clear both asset fields");
ok(!("asset" in (result.workspace.source.resources.find((item) => item.id === "rds01") ?? {})),
  "clearing the pair deliberately removes asset binding");
ok(sourceAssetDigest.includes(originalAsset.id), "fixture source contained original catalog requirement");
result = createResourceFromInspector(createBuilderWorkspace(source), "owned_asset", {
  label: "Owned resource", type: "server.generic", zone: "server",
  propertiesJson: "{}", interfacesJson: "[]",
  assetId: "server.generic", assetVersion: "1.0.0",
});
ok(result.ok, "create resource accepts an explicit asset pair");
eq(result.workspace.source.resources.find((item) => item.id === "owned_asset")?.asset,
  { id: "server.generic", version: "1.0.0" },
  "resource creation includes both visibly entered asset fields");

// BUILDER-053: legitimate unreferenced deletions remain available and are
// atomic. Only source-backed references, not a generic Delete ban, are new.
const deleteReady = structuredClone(source);
deleteReady.connections = [];
deleteReady.tests = [];
deleteReady.findings = [];
deleteReady.objectives = [{
  id: "retain_admin", title: "Keep retained resource", category: "validation",
  required: false,
  condition: { op: "equals", target: "admin01", path: "properties.safe", value: true },
}];
deleteReady.completion = {
  op: "equals", target: "admin01", path: "properties.safe", value: true,
};
deleteReady.canonicalSolution = { operations: [] };
deleteReady.layoutHints = [];
deleteReady.notes = [];
deleteReady.troubleshootingObjectives = [];
let deletionWorkspace = createBuilderWorkspace(deleteReady);
const initialResourceCount = deletionWorkspace.source.resources.length;
const deletion = deleteResource(deletionWorkspace, "rds01", false);
ok(deletion.ok, "Delete Resource succeeds when no canonical dependency retains its ID");
eq(deletion.workspace.source.resources.length, initialResourceCount - 1,
  "positive Delete removes exactly one unreferenced resource");
ok(!deletion.workspace.source.resources.some((item) => item.id === "rds01"),
  "positive Delete removed intended resource ID");
eq(deletion.workspace.source.objectives, deleteReady.objectives,
  "positive Delete retains unchanged authored objectives");
deletionWorkspace = createBuilderWorkspace(deleteReady);
const cascade = deleteZone(deletionWorkspace, "server", true);
ok(cascade.ok, "Delete Zone cascade works when descendants have no retained references");
ok(!cascade.workspace.source.zones.some((item) => item.id === "server"),
  "positive cascade removes selected zone");
ok(!cascade.workspace.source.resources.some((item) => item.id === "rds01"),
  "positive cascade removes only unreferenced child resources");
eq(cascade.workspace.source.resources.length, initialResourceCount - 1,
  "positive zone cascade retains all unrelated resources");
eq(cascade.workspace.source.completion, deleteReady.completion,
  "positive cascade preserves unrelated completion truth");
ok(cascade.workspace.sourceRevision > deletionWorkspace.sourceRevision,
  "valid deletions still invalidate stale Compiler previews");

const mainSource = fs.readFileSync(path.join(root, "ui/app/main.mjs"), "utf8");
ok(mainSource.includes("BuilderInspector"), "browser UI contains typed BuilderInspector component");
ok(mainSource.includes("Skapa topologiobjekt"), "browser UI exposes visual create controls");
ok(mainSource.includes("Verkställ inspektörsändringar"), "browser UI exposes explicit inspector apply action");
ok(mainSource.includes("Delete selected"), "browser UI exposes selected-object deletion");

console.log(`PASS builder inspector suite: ${checks} assertions.`);
