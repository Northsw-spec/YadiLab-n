import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const iconSource = readFileSync("ui/src/canvas/icon-registry.ts", "utf8");
const mainSource = readFileSync("ui/app/main.mjs", "utf8");
const cssSource = readFileSync("ui/app/app.css", "utf8");

assert.match(iconSource, /export function iconDescriptor/);
assert.match(iconSource, /export function classifyResourceIcon/);
assert.match(iconSource, /export function classifyLogicalIcon/);
assert.match(mainSource, /data-topology-camera/);
assert.match(mainSource, /data-link-vlan/);
assert.match(mainSource, /anchorOrthogonalRoute/);
assert.doesNotMatch(mainSource, /legacy-workspace-menus/);
assert.doesNotMatch(cssSource, /\.legacy-workspace-menus\b/);

const folder = mkdtempSync(join(tmpdir(), "yadilab-project093-contract-"));
try {
  const bundle = join(folder, "icon-registry.mjs");
  await build({
    entryPoints: ["ui/src/canvas/icon-registry.ts"],
    outfile: bundle,
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node22"],
    logLevel: "silent",
  });
  const { classifyLogicalIcon, classifyResourceIcon, iconRegistry } = await import(pathToFileURL(bundle).href);
  const registry = iconRegistry();
  assert.ok(registry.length >= 18, "icon registry is unexpectedly incomplete");
  assert.equal(new Set(registry.map((icon) => icon.key)).size, registry.length, "icon keys are duplicated");
  assert.ok(registry.every((icon) => icon.viewBox === "0 0 24 24" && icon.path), "icons must use local 24x24 paths");

  const sourceDriven = classifyResourceIcon("network.access", { label: "router" });
  assert.equal(sourceDriven.key, "switch", "resource icon classification must use the source type");
  const unknown = classifyResourceIcon("custom-device", { label: "router" });
  assert.equal(unknown.key, "unknown-resource", "labels must not invent a device class");
  assert.equal(classifyLogicalIcon("VLAN").key, "vlan", "VLAN semantics must map to the VLAN icon");
  assert.equal(classifyLogicalIcon("subnet").key, "network-segment", "segment semantics must map to a logical icon");
} finally {
  rmSync(folder, { recursive: true, force: true });
}

const { anchorOrthogonalRoute, orthogonalEdgePath } = await import("../../ui/app/semantic-edge-routing.mjs");
const anchored = anchorOrthogonalRoute({
  sourceX: 10,
  sourceY: 20,
  targetX: 110,
  targetY: 140,
  route: [{ x: 60, y: 70 }, { x: 80, y: 100 }],
});
assert.ok(anchored.length >= 4, "anchored route must preserve both endpoints and bends");
for (const [before, after] of anchored.slice(1).map((point, index) => [anchored[index], point])) {
  assert.ok(before.x === after.x || before.y === after.y, "anchored route contains a diagonal segment");
}
const [path] = orthogonalEdgePath({ sourceX: 10, sourceY: 20, targetX: 110, targetY: 140, route: anchored });
assert.doesNotMatch(path, /[CQSAZcqsa]/, "canonical route must be an SVG polyline");

console.log("PASS PROJECT-093 icon, VLAN, source-fidelity and orthogonal-route contracts");
