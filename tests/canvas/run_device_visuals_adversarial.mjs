import assert from "node:assert/strict";
import fs from "node:fs";
import { describeDeviceVisual, describeSemanticLink } from "../../dist-canvas-test/ui/src/canvas/index.js";

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };
const ok = (value, message) => { assert.ok(value, message); checks += 1; };

eq(describeDeviceVisual("customer.unmodeled_appliance"), { family: "generic", roleLabel: "Resource" }, "unknown resource type remains generic");
eq(describeDeviceVisual("  NETWORK.ROUTER  ").family, "router", "classification is stable across harmless casing/space");
eq(describeDeviceVisual("customer.switchboard").family, "generic", "partial switch substring does not invent a switch chassis");
eq(describeDeviceVisual("runtime.jvm_service").family, "generic", "partial VM substring does not invent a server chassis");
eq(describeDeviceVisual("vendor.router.appliance").family, "router", "explicit router type segment remains extensible");

const falseLink = describeSemanticLink("network", { enabled: false });
eq(falseLink.enabled, false, "only explicit false disables a link");
ok(falseLink.accessibleLabel.endsWith("DISABLED"), "disabled state has text, not color alone");
eq(describeSemanticLink("network", { enabled: 0 }).enabled, true, "numeric zero does not fabricate disabled truth");
eq(describeSemanticLink("network", { direction: "sideways" }).direction, "unspecified", "unknown direction remains unspecified");
eq(describeSemanticLink("network", { vlan: 5000 }).vlanLabel, undefined, "invalid VLAN number is not displayed as modeled");
eq(describeSemanticLink("network", { vlan: "<script>" }).vlanLabel, undefined, "unsafe VLAN label is rejected from visual label");
eq(describeSemanticLink("dependency", {}).accessibleLabel, "DEPENDENCY", "missing optional semantics are not invented");

const source = fs.readFileSync("ui/src/canvas/device-visuals.ts", "utf8");
const main = fs.readFileSync("ui/app/main.mjs", "utf8");
ok(!source.includes("Math.random"), "device presentation is deterministic");
const intervalCalls = [...main.matchAll(/\b(?:globalThis\.)?setInterval\s*\(/g)];
eq(intervalCalls.length, 1, "only the topology geometry repair owns an interval timer");
const geometryRepairStart = main.indexOf("function ReactFlowGeometryRepair");
const downloadBlobStart = main.indexOf("function downloadBlob");
ok(geometryRepairStart >= 0 && downloadBlobStart > geometryRepairStart, "topology geometry repair is an isolated function");
const geometryRepair = main.slice(geometryRepairStart, downloadBlobStart);
ok(geometryRepair.includes("globalThis.setInterval(refresh, 100)"), "the only interval retries React Flow geometry measurement");
ok(!geometryRepair.includes("setJourney") && !geometryRepair.includes("activeInterfaceIds"), "geometry retry cannot fabricate journey/device activity");
const resourceNodeStart = main.indexOf("function ResourceNode");
const zoneNodeStart = main.indexOf("function ZoneNode");
const resourceNode = main.slice(resourceNodeStart, zoneNodeStart);
ok(!resourceNode.includes("setInterval") && !resourceNode.includes("setTimeout"), "device activity renderer owns no timer source");
ok(resourceNode.includes('const active = modeledStateFocus || ["current", "arrived", "dropped", "uncertain", "no_path"].includes(data.journeyState) || (data.activeInterfaceIds?.length ?? 0) > 0;'), "device activity derives only from modeled state focus or current journey evidence");
ok(main.includes("const activeConnectionIds = new Set(journeyFrame?.activeConnectionIds ?? []);"), "link activity is bound to the current journey frame");
ok(main.includes("const activeProjectedEdges = baseFlow.edges.filter((edge) => activeConnectionIds.has(edge.id));"), "interface activity is derived only from active journey edges");

console.log(`PASS real device visuals adversarial: ${checks}`);
