import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  applyConnectionInspector,
  applyMissionInspector,
  applyResourceInspector,
  applyZoneInspector,
  createBuilderWorkspace,
  createConnectionFromInspector,
  createResourceFromInspector,
  createZoneFromInspector,
  deleteSelectedBuilderObject,
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
const baseline = JSON.stringify(ws.source);
let r = applyMissionInspector(ws, { title: "", language: "sv" });
ok(!r.ok, "empty mission title rejected through inspector");
eq(JSON.stringify(r.workspace.source), baseline, "failed mission edit atomic");

r = createZoneFromInspector(ws, "", { label: "X", kind: "lan" });
ok(!r.ok, "empty zone id rejected");
r = createZoneFromInspector(ws, "x", { label: "X", kind: "not-a-zone" });
ok(!r.ok, "unknown zone kind rejected");
r = applyZoneInspector(ws, "wan", { label: "WAN", kind: "not-a-zone" });
ok(!r.ok, "invalid zone kind cannot be written to existing zone");

// Immediate cycle prevention: server -> wan then wan -> server must be rejected.
r = applyZoneInspector(ws, "server", { label: "Server", kind: "server", parent: "wan" });
ok(r.ok, "control parent assignment succeeds");
if (r.ok) ws = r.workspace;
r = applyZoneInspector(ws, "wan", { label: "WAN", kind: "wan", parent: "server" });
ok(!r.ok, "zone parent cycle rejected immediately in Builder");
ok(r.diagnostics.some((d) => d.code === "BUILDER_ZONE_PARENT_CYCLE"), "cycle diagnostic is explicit");

ws = createBuilderWorkspace(source);
r = applyResourceInspector(ws, "rds01", { label: "RDS", type: "windows.rds_host", zone: "server", propertiesJson: "[]", interfacesJson: "[]" });
ok(!r.ok, "resource properties must be JSON object");
r = applyResourceInspector(ws, "rds01", { label: "RDS", type: "windows.rds_host", zone: "server", propertiesJson: "{nope", interfacesJson: "[]" });
ok(!r.ok, "malformed resource properties JSON rejected");
r = applyResourceInspector(ws, "rds01", { label: "RDS", type: "windows.rds_host", zone: "server", propertiesJson: "{}", interfacesJson: "{}" });
ok(!r.ok, "interfaces must be JSON array");
r = applyResourceInspector(ws, "rds01", { label: "RDS", type: "windows.rds_host", zone: "server", propertiesJson: "{}", interfacesJson: "[{}]" });
ok(!r.ok, "interface without id rejected");
r = applyResourceInspector(ws, "rds01", { label: "", type: "windows.rds_host", zone: "server", propertiesJson: "{}", interfacesJson: "[]" });
ok(!r.ok, "empty resource label rejected");
r = applyResourceInspector(ws, "rds01", { label: "RDS", type: "", zone: "server", propertiesJson: "{}", interfacesJson: "[]" });
ok(!r.ok, "empty resource type rejected");
r = createResourceFromInspector(ws, "new01", { label: "X", type: "server.generic", zone: "missing", propertiesJson: "{}", interfacesJson: "[]" });
ok(!r.ok, "new resource cannot target unknown zone");

r = applyConnectionInspector(ws, "fw_rds", { kind: "bogus", fromResource: "firewall01", toResource: "rds01", propertiesJson: "{}" });
ok(!r.ok, "unknown connection kind rejected");
r = applyConnectionInspector(ws, "fw_rds", { kind: "network", fromResource: "", toResource: "rds01", propertiesJson: "{}" });
ok(!r.ok, "empty connection endpoint rejected");
r = applyConnectionInspector(ws, "fw_rds", { kind: "network", fromResource: "firewall01", toResource: "missing", propertiesJson: "{}" });
ok(!r.ok, "unknown connection endpoint rejected by semantic Builder API");
r = createConnectionFromInspector(ws, "", { kind: "network", fromResource: "firewall01", toResource: "rds01", propertiesJson: "{}" });
ok(!r.ok, "empty connection id rejected");
r = createConnectionFromInspector(ws, "new_link", { kind: "network", fromResource: "firewall01", toResource: "rds01", propertiesJson: "[]" });
ok(!r.ok, "connection properties must be JSON object");

r = deleteSelectedBuilderObject(ws, true);
ok(!r.ok, "delete requires explicit selection");
ws = setBuilderSelection(ws, ["wan"], "wan");
r = duplicateSelectedBuilderResource(ws, "wan-copy");
ok(!r.ok, "duplicate requires resource selection");

// BUILDER-052: partial asset input must never erase a previously bound
// asset. "Create connection" cannot overwrite an existing physical link.
const assetSource = structuredClone(source);
const rdsAsset = assetSource.resources.find((item) => item.id === "rds01");
if (!rdsAsset) throw Error("BUILDER-052 fixture missing rds01");
rdsAsset.asset = { id: "endpoint.windows", version: "1.0.0" };
const bound = createBuilderWorkspace(assetSource);
const boundBytes = JSON.stringify(bound.source);
const resourceInput = {
  label: "RDS reconfigured", type: rdsAsset.type, zone: rdsAsset.zone,
  propertiesJson: JSON.stringify(rdsAsset.properties),
  interfacesJson: JSON.stringify(rdsAsset.interfaces ?? []),
};
for (const malformed of [
  { assetId: "endpoint.windows" },
  { assetVersion: "1.0.0" },
  { assetId: "", assetVersion: "1.0.0" },
  { assetId: "endpoint.windows", assetVersion: "" },
]) {
  const denied = applyResourceInspector(bound, "rds01", { ...resourceInput, ...malformed });
  ok(!denied.ok, "incomplete explicit asset pair rejected");
  ok(denied.diagnostics.some((d) => d.code === "BUILDER_INSPECTOR_ASSET_PAIR"),
    "incomplete asset pair gets an explicit diagnostic");
  eq(JSON.stringify(denied.workspace.source), boundBytes,
    "rejected asset edit leaves asset and entire source unmodified");
}
const invalidCreateAsset = createResourceFromInspector(bound, "asset_pair_bad", {
  label: "Invalid", type: "server.generic", zone: "server",
  propertiesJson: "{}", interfacesJson: "[]", assetId: "endpoint.windows",
});
ok(!invalidCreateAsset.ok, "resource creation rejects half of an asset pair");
eq(JSON.stringify(invalidCreateAsset.workspace.source), boundBytes,
  "invalid asset creation did not mutate source");

const originalLink = source.connections[0];
if (!originalLink) throw Error("BUILDER-052 fixture missing a connection");
const originalLinkBytes = JSON.stringify(originalLink);
const originalWorkspace = createBuilderWorkspace(source);
const creation = createConnectionFromInspector(originalWorkspace, originalLink.id, {
  kind: "management",
  fromResource: "rds01", toResource: "firewall01", propertiesJson: '{"rewired":true}',
});
ok(!creation.ok, "Create connection with existing ID must reject rather than upsert");
ok(creation.diagnostics.some((d) => d.code === "BUILDER_DUPLICATE_ID"),
  "duplicate connection ID diagnostic is explicit");
eq(creation.workspace, originalWorkspace, "duplicate Create returns unchanged original Builder");
eq(JSON.stringify(originalWorkspace.source.connections[0]), originalLinkBytes,
  "existing link remains unchanged after duplicate create");
eq(creation.workspace.sourceRevision, originalWorkspace.sourceRevision,
  "failed duplicate Create did not increment source revision");
const editedLink = applyConnectionInspector(originalWorkspace, originalLink.id, {
  kind: originalLink.kind,
  fromResource: originalLink.from.resource,
  fromPort: originalLink.from.port,
  toResource: originalLink.to.resource,
  toPort: originalLink.to.port,
  propertiesJson: JSON.stringify(originalLink.properties),
});
ok(editedLink.ok, "dedicated Edit connection path still supports updating existing connection");

const ui = fs.readFileSync(path.join(root, "ui/app/main.mjs"), "utf8");
ok(!ui.includes("dangerouslySetInnerHTML"), "Builder Inspector does not inject arbitrary HTML");
ok(!ui.includes("eval("), "Builder Inspector does not execute arbitrary code");

console.log(`PASS builder inspector adversarial suite: ${checks} assertions.`);
