import assert from "node:assert/strict";
import { buildVisualJourneyFromActiveProbe } from "../../dist-browser-test/ui/src/browser/visual-journey.js";

const scenario = {
  scenarioId: "dev22-guards", sourceHash: "guard-hash", zones: [],
  resources: [
    { id: "a", type: "linux.host", label: "A", interfaces: [{ id: "a0", addresses: [] }], properties: {} },
    { id: "b", type: "network.router", label: "B", interfaces: [{ id: "b0", addresses: [] }, { id: "b1", addresses: [] }], properties: {} },
    { id: "c", type: "linux.host", label: "C", interfaces: [{ id: "c0", addresses: [] }], properties: {} },
  ],
  connections: [
    { id: "ab", kind: "network", from: { resource: "a", port: "a0" }, to: { resource: "b", port: "b0" }, properties: { direction: "forward" } },
    { id: "bc", kind: "network", from: { resource: "b", port: "b1" }, to: { resource: "c", port: "c0" }, properties: { direction: "forward" } },
  ],
};
function base(overrides = {}) {
  return {
    engineId: "foundation.observation", engineVersion: "1", modeled: true, boundary: "NO_GUEST_COMMAND_EXECUTION", probeMode: "ACTIVE_MODELED_PROBE",
    scenarioId: scenario.scenarioId, scenarioHash: scenario.sourceHash, stateRevision: 1,
    sourceId: "a", sourceLabel: "A", sourceType: "linux.host", probeId: "guard", command: "probe", category: "connectivity",
    truth: "FALSE", destinationId: "c", destinationLabel: "C", protocol: "icmp", path: ["a", "b", "c"], blockingPoint: "b",
    lines: [], evidence: [{ kind: "engine_query", subject: "reachability", state: "FALSE", value: {} }],
    ...overrides,
  };
}
let assertions = 0;
function code(transcript) {
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript);
  assertions += 1;
  assert.equal(result.ok, false, "adversarial transcript must fail closed");
  return result.diagnostics[0]?.code;
}
assert.equal(code(base({ destinationId: "ghost" })), "VISUAL_JOURNEY_DESTINATION_UNKNOWN");
assert.equal(code(base({ blockingPoint: "ghost" })), "VISUAL_JOURNEY_BLOCKING_POINT_UNKNOWN");
assert.equal(code(base({ path: ["a", "c"], blockingPoint: "b" })), "VISUAL_JOURNEY_BLOCKING_POINT_PATH_MISMATCH");
assert.equal(code(base({ truth: "TRUE", blockingPoint: "b" })), "VISUAL_JOURNEY_BLOCKING_POINT_TRUTH_MISMATCH");

console.log(`PASS dev22 canonical playback + outcome adversarial: ${assertions}`);
