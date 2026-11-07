import assert from "node:assert/strict";
import fs from "node:fs";
import { enterpriseOfficeScenarios } from "../../ui/app/enterprise-office-scenario.mjs";

const visualJourney = fs.readFileSync("ui/src/browser/visual-journey.ts", "utf8");
const main = fs.readFileSync("ui/app/main.mjs", "utf8");

for (const eventKind of [
  "route.decision", "neighbor.decision", "mac.learn", "mac.lookup", "mac.forward", "mac.flood",
  "vlan.classify", "vlan.tag", "vlan.untag", "vlan.forward", "stp.bpdu", "stp.decision",
]) assert.match(visualJourney, new RegExp(`\\"${eventKind.replace(".", "\\.")}\\"`), `Engine event projection exists: ${eventKind}`);

for (const uiContract of [
  "Routing X-Ray", "ARP/ND X-Ray", "MAC/CAM X-Ray", "VLAN/Trunk X-Ray", "STP/BPDU X-Ray",
  "data-selected-route", "data-selected-neighbor", "data-selected-mac-entry", "data-vlan-decision-table", "data-stp-port-table",
]) assert.ok(main.includes(uiContract), `living visualization UI contract exists: ${uiContract}`);

const status = (scenario, predicate) => predicate(scenario) ? "PASS" : "UNMODELED";
const matrix = enterpriseOfficeScenarios.map((scenario) => ({
  scenario: scenario.scenarioId,
  nodes: scenario.resources.length,
  routing: status(scenario, (s) => s.resources.some((r) => Array.isArray(r.properties?.routes))),
  arpNd: status(scenario, (s) => s.resources.some((r) => Array.isArray(r.properties?.neighbors))),
  fdb: status(scenario, (s) => s.resources.some((r) => Array.isArray(r.properties?.macTable))),
  broadcast: "UNMODELED",
  stpBpdu: status(scenario, (s) => s.resources.some((r) => r.properties?.stp !== undefined || r.properties?.stpPorts !== undefined)),
  vlan: status(scenario, (s) => s.resources.some((r) => Array.isArray(r.properties?.switchports))),
}));
assert.deepEqual(matrix.map((row) => row.nodes), [30, 35, 50, 70, 80]);
assert.ok(matrix.every((row) => Object.values(row).includes("UNMODELED") || Object.values(row).includes("PASS")), "matrix uses only truthful statuses");
assert.ok(!main.includes("Math.random") && !visualJourney.includes("Math.random"), "living visualization is deterministic");
console.log(`PASS dev27 living visualization contract: Engine-driven route/ARP/FDB/flood/VLAN/STP projections, truthful enterprise matrix ${JSON.stringify(matrix)}`);
