import assert from "node:assert/strict";
import fs from "node:fs";
import { buildVisualJourneyFromActiveProbe, visualJourneyFrame } from "../../dist-browser-test/ui/src/browser/visual-journey.js";

const scenario = {
  scenarioId: "dev32-closure", sourceHash: "rev-a", zones: [],
  resources: [
    { id: "client", type: "linux.host", label: "Client", interfaces: [{ id: "eth0", kind: "ethernet", addresses: [] }], properties: {} },
    { id: "server", type: "linux.host", label: "Server", interfaces: [{ id: "eth0", kind: "ethernet", addresses: [] }], properties: {} },
  ],
  connections: [{ id: "client-server", kind: "network", from: { resource: "client", port: "eth0" }, to: { resource: "server", port: "eth0" }, properties: {} }],
};
const transcript = { engineId: "probe", engineVersion: "1", modeled: true, boundary: "NO_GUEST_COMMAND_EXECUTION", probeMode: "ACTIVE_MODELED_PROBE", scenarioId: "dev32-closure", scenarioHash: "rev-a", stateRevision: 4, sourceId: "client", sourceLabel: "Client", sourceType: "linux.host", probeId: "probe.connectivity", command: "modeled", category: "connectivity", truth: "TRUE", destinationId: "server", destinationLabel: "Server", path: ["client", "server"], lines: [], evidence: [{ kind: "engine_query", subject: "engine.queryReachability", state: "TRUE", value: { path: ["client", "server"] } }] };
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const first = buildVisualJourneyFromActiveProbe(scenario, transcript);
const second = buildVisualJourneyFromActiveProbe(scenario, transcript);
assert.equal(first.ok, true); assert.equal(second.ok, true); checks += 2;
assert.deepEqual(first.model, second.model); checks += 1;
assert.deepEqual(first.model.events.map((event) => event.eventId), ["flow-dev32-closure-4-probe.connectivity-client-server-evt-001", "flow-dev32-closure-4-probe.connectivity-client-server-evt-002", "flow-dev32-closure-4-probe.connectivity-client-server-evt-003"]); checks += 1;
const frame = visualJourneyFrame(first.model, 1);
assert.equal(frame.activeConnectionId, "client-server"); checks += 1;
const stale = buildVisualJourneyFromActiveProbe({ ...scenario, sourceHash: "rev-b" }, transcript);
assert.equal(stale.ok, false); checks += 1;
assert.equal(stale.diagnostics[0].code, "VISUAL_JOURNEY_SCENARIO_MISMATCH"); checks += 1;
const source = fs.readFileSync("ui/src/browser/visual-journey.ts", "utf8");
ok(source.includes("stateRevision: transcript.stateRevision"), "state revision is carried into the Journey model");
ok(source.includes("VISUAL_JOURNEY_SCENARIO_MISMATCH"), "stale scenario revisions fail closed");
console.log(`PASS dev32 integrated living-network closure: ${checks} assertions.`);
