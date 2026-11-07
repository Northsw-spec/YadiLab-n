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
  setLayoutOverride,
} from "../../dist-browser-test/ui/src/browser/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const source = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-source.json"), "utf8"));
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }

// Add explicit interfaces so handle -> semantic interface mapping can be verified.
source.resources = source.resources.map((resource) => {
  if (resource.id === "firewall01") return { ...resource, interfaces: [{ id: "lan", label: "LAN", addresses: ["10.0.0.1/24"] }] };
  if (resource.id === "rds01") return { ...resource, interfaces: [{ id: "eth0", label: "LAN", addresses: ["10.0.0.20/24"] }] };
  return resource;
});

let ws = createBuilderWorkspace(source);
ws = applyBuilderCanvasSelection(ws, { nodeIds: ["rds01", "wan", "rds01"], edgeIds: ["fw_rds"], primary: "fw_rds" });
eq(ws.selection.ids, ["fw_rds", "rds01", "wan"], "canvas selection is deduplicated and normalized by semantic Builder selection");
eq(ws.selection.primary, "fw_rds", "explicit primary edge is preserved");
ws = applyBuilderCanvasSelection(ws, { nodeIds: ["missing", "wan"], primary: "missing" });
eq(ws.selection.ids, ["wan"], "unknown visual selections are filtered out");
eq(ws.selection.primary, "wan", "primary falls back to first valid semantic id");

// Seed a current layout to prove live overrides update the view projection immediately.
ws = {
  ...ws,
  layout: {
    formatId: "infrastructure-cyber-lab.layout",
    schemaVersion: "0.1.0",
    scenarioId: source.scenarioId,
    engine: "elk.layered",
    nodes: [
      { id: "wan", x: 5, y: 6, width: 720, height: 480 },
      { id: "rds01", x: 100, y: 110, width: 180, height: 96, parent: "server" },
    ],
  },
};
let resized = resizeBuilderZone(ws, { id: "wan", x: 20, y: 30, width: 840, height: 560 });
ok(resized.ok, "zone resize succeeds");
if (!resized.ok) process.exit(1);
ws = resized.workspace;
eq(ws.layoutOverrides.find((item) => item.id === "wan"), { id: "wan", x: 20, y: 30, width: 840, height: 560 }, "zone resize stored as manual override");
eq(ws.layout?.nodes.find((item) => item.id === "wan")?.width, 840, "current layout width updates immediately");
eq(ws.layout?.nodes.find((item) => item.id === "wan")?.height, 560, "current layout height updates immediately");
eq(ws.layout?.nodes.find((item) => item.id === "wan")?.manualOverride, true, "current layout marks manual override");
eq(ws.sourceRevision, 0, "pure layout resize does not mutate semantic source revision");
eq(ws.compile.status, "idle", "layout resize does not invent semantic compile changes");
ok(BUILDER_ZONE_RESIZE_LIMITS.minWidth >= 200, "zone minimum width is explicit");

// Existing setLayoutOverride also performs immediate projection update for drag operations.
ws = setLayoutOverride(ws, { id: "rds01", x: 140, y: 150, width: 190, height: 100 });
eq(ws.layout?.nodes.find((item) => item.id === "rds01")?.x, 140, "drag override updates current resource x");
eq(ws.layout?.nodes.find((item) => item.id === "rds01")?.width, 190, "drag override updates current resource dimensions");

let connected = createBuilderConnectionFromCanvas(ws, {
  source: "firewall01",
  target: "rds01",
  sourceHandle: "out:lan",
  targetHandle: "in:eth0",
});
ok(connected.ok, "interactive connection with interface handles succeeds");
if (!connected.ok) process.exit(1);
ws = connected.workspace;
const interactive = ws.source.connections.find((item) => item.id === "connection_001");
eq(interactive?.kind, "network", "interactive connection defaults to semantic network kind");
eq(interactive?.from, { resource: "firewall01", port: "lan" }, "source handle maps to source interface id");
eq(interactive?.to, { resource: "rds01", port: "eth0" }, "target handle maps to target interface id");
eq(ws.selection.primary, "connection_001", "new interactive connection becomes selected semantic object");
eq(ws.compile.status, "idle", "interactive semantic connection invalidates compile state");
ok(ws.sourceRevision > 0, "interactive connection increments semantic source revision");

connected = createBuilderConnectionFromCanvas(ws, {
  source: "admin01",
  target: "rds01",
  sourceHandle: "generic-out",
  targetHandle: "generic-in",
  kind: "management",
});
ok(connected.ok, "generic visual handles can create semantic connection without interface ids");
if (!connected.ok) process.exit(1);
ws = connected.workspace;
eq(ws.source.connections.find((item) => item.id === "connection_002")?.kind, "management", "requested semantic connection kind is preserved");
eq(ws.source.connections.find((item) => item.id === "connection_002")?.from, { resource: "admin01" }, "generic source handle does not fabricate interface");

const ui = fs.readFileSync(path.join(root, "ui/app/main.mjs"), "utf8");
ok(ui.includes("NodeResizer"), "browser UI includes visual zone resize control");
ok(ui.includes("onSelectionChange"), "browser UI listens to React Flow selection changes");
ok(ui.includes('multiSelectionKeyCode: "Shift"'), "browser UI exposes explicit Shift multi-select");
ok(ui.includes("nodesConnectable: workspace.mode === \"builder\""), "interactive connection handles are enabled only in Builder");
ok(ui.includes("onConnect"), "browser UI routes connection gestures through an explicit handler");
ok(ui.includes("createBuilderConnectionFromCanvas"), "browser connection gesture calls semantic interaction adapter");
ok(ui.includes("resizeBuilderZone"), "zone resize gesture calls semantic-safe layout adapter");

console.log(`PASS builder interactions suite: ${checks} assertions.`);
