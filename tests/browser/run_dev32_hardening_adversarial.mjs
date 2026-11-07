import assert from "node:assert/strict";
import { buildVisualJourneyFromActiveProbe } from "../../dist-browser-test/ui/src/browser/visual-journey.js";

const scenario = { scenarioId: "hardening", sourceHash: "hash-a", zones: [], resources: [
  { id: "a", type: "linux.host", label: "A", interfaces: [{ id: "eth0", kind: "ethernet", addresses: [] }], properties: {} },
  { id: "b", type: "linux.host", label: "B", interfaces: [{ id: "eth0", kind: "ethernet", addresses: [] }], properties: {} },
], connections: [{ id: "a-b", kind: "network", from: { resource: "a", port: "eth0" }, to: { resource: "b", port: "eth0" }, properties: {} }] };
const base = { engineId: "probe", engineVersion: "1", modeled: true, boundary: "NO_GUEST_COMMAND_EXECUTION", probeMode: "ACTIVE_MODELED_PROBE", scenarioId: "hardening", scenarioHash: "hash-a", stateRevision: 1, sourceId: "a", sourceLabel: "A", sourceType: "linux.host", probeId: "probe", command: "modeled", category: "connectivity", truth: "TRUE", destinationId: "b", destinationLabel: "B", path: ["a", "b"], lines: [], evidence: [] };
const cases = [
  [{ ...base, scenarioHash: "hash-old" }, "VISUAL_JOURNEY_SCENARIO_MISMATCH"],
  [{ ...base, sourceId: "missing" }, "VISUAL_JOURNEY_SOURCE_UNKNOWN"],
  [{ ...base, destinationId: "missing" }, "VISUAL_JOURNEY_DESTINATION_UNKNOWN"],
  [{ ...base, path: ["b", "a"] }, "VISUAL_JOURNEY_PATH_SOURCE_MISMATCH"],
  [{ ...base, blockingPoint: "b", path: ["a"] }, "VISUAL_JOURNEY_BLOCKING_POINT_PATH_MISMATCH"],
];
for (const [input, code] of cases) { const result = buildVisualJourneyFromActiveProbe(scenario, input); assert.equal(result.ok, false, code); assert.equal(result.diagnostics[0].code, code); }
console.log(`PASS dev32 hardening adversarial: ${cases.length} fail-closed cases.`);
