import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  applyBuilderCanvasSelection,
  BUILDER_ZONE_RESIZE_LIMITS,
  createBuilderConnectionFromCanvas,
  createBuilderWorkspace,
  resizeBuilderZone,
} from "../../dist-browser-test/ui/src/browser/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const source = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-source.json"), "utf8"));
source.resources = source.resources.map((resource) => {
  if (resource.id === "firewall01") return { ...resource, interfaces: [{ id: "lan", label: "LAN", addresses: [] }] };
  if (resource.id === "rds01") return { ...resource, interfaces: [{ id: "eth0", label: "LAN", addresses: [] }] };
  return resource;
});
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }

let ws = createBuilderWorkspace(source);
const baselineSource = JSON.stringify(ws.source);
let result = resizeBuilderZone(ws, { id: "rds01", x: 0, y: 0, width: 500, height: 300 });
ok(!result.ok, "resource cannot be resized through zone resize path");
eq(JSON.stringify(result.workspace.source), baselineSource, "failed resource resize leaves source atomic");
result = resizeBuilderZone(ws, { id: "wan", x: Number.NaN, y: 0, width: 500, height: 300 });
ok(!result.ok, "non-finite resize rejected");
result = resizeBuilderZone(ws, { id: "wan", x: 0, y: 0, width: BUILDER_ZONE_RESIZE_LIMITS.minWidth - 1, height: 300 });
ok(!result.ok, "undersized zone width rejected");
result = resizeBuilderZone(ws, { id: "wan", x: 0, y: 0, width: 500, height: BUILDER_ZONE_RESIZE_LIMITS.minHeight - 1 });
ok(!result.ok, "undersized zone height rejected");
result = resizeBuilderZone(ws, { id: "wan", x: 0, y: 0, width: BUILDER_ZONE_RESIZE_LIMITS.maxDimension + 1, height: 500 });
ok(!result.ok, "unbounded zone size rejected");
eq(ws.layoutOverrides.length, 0, "failed resizes do not create layout override");

const badConnections = [
  [{ source: null, target: "rds01" }, "missing source rejected"],
  [{ source: "firewall01", target: null }, "missing target rejected"],
  [{ source: "missing", target: "rds01" }, "unknown source rejected"],
  [{ source: "firewall01", target: "missing" }, "unknown target rejected"],
  [{ source: "rds01", target: "rds01" }, "implicit self-connection rejected"],
  [{ source: "firewall01", target: "rds01", sourceHandle: "in:lan" }, "wrong source handle direction rejected"],
  [{ source: "firewall01", target: "rds01", targetHandle: "out:eth0" }, "wrong target handle direction rejected"],
  [{ source: "firewall01", target: "rds01", sourceHandle: "out:missing" }, "unknown source interface rejected"],
  [{ source: "firewall01", target: "rds01", targetHandle: "in:missing" }, "unknown target interface rejected"],
];
for (const [input, label] of badConnections) {
  const before = JSON.stringify(ws.source);
  const r = createBuilderConnectionFromCanvas(ws, input);
  ok(!r.ok, label);
  eq(JSON.stringify(r.workspace.source), before, `${label} atomically preserves source`);
}

const collisionSource = structuredClone(source);
collisionSource.connections.push({ id: "connection_001", kind: "network", from: { resource: "admin01" }, to: { resource: "rds01" }, properties: {} });
ws = createBuilderWorkspace(collisionSource);
result = createBuilderConnectionFromCanvas(ws, { source: "firewall01", target: "rds01", sourceHandle: "out:lan", targetHandle: "in:eth0" });
ok(result.ok, "interactive id allocator skips existing global id");
if (result.ok) eq(result.workspace.selection.primary, "connection_002", "deterministic allocator selects next free id");

ws = createBuilderWorkspace(source);
ws = applyBuilderCanvasSelection(ws, { nodeIds: ["wan", "missing"], edgeIds: ["fw_rds", "ghost"], primary: "ghost" });
eq(ws.selection.ids, ["fw_rds", "wan"], "visual ghost ids never enter semantic selection");
ok(ws.selection.primary === "fw_rds" || ws.selection.primary === "wan", "invalid primary is not preserved");

const ui = fs.readFileSync(path.join(root, "ui/app/main.mjs"), "utf8");
ok(!ui.includes("addEdge("), "browser UI does not create React Flow-only edges");
ok(!ui.includes("setNodes("), "browser UI does not create a parallel canonical node store");
ok(!ui.includes("setEdges("), "browser UI does not create a parallel canonical edge store");
ok(!ui.includes("dangerouslySetInnerHTML"), "new visual interactions do not add arbitrary HTML injection");

console.log(`PASS builder interactions adversarial suite: ${checks} assertions.`);
