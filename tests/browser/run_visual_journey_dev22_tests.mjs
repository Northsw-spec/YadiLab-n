import assert from "node:assert/strict";
import { buildVisualJourneyFromActiveProbe, visualJourneyFrame, VISUAL_JOURNEY_OUTCOME_MARKER_MS } from "../../dist-browser-test/ui/src/browser/visual-journey.js";

const resources = [
  { id: "client", type: "windows.workstation", label: "Client", interfaces: [{ id: "c0", kind: "ethernet", addresses: [] }], properties: {} },
  { id: "access", type: "network.switch", label: "Access", interfaces: [{ id: "a0", kind: "ethernet", addresses: [] }, { id: "a1", kind: "ethernet", addresses: [] }], properties: {} },
  { id: "core", type: "network.router", label: "Core", interfaces: [{ id: "r0", kind: "ethernet", addresses: [] }, { id: "r1", kind: "ethernet", addresses: [] }], properties: {} },
  { id: "fw", type: "network.firewall", label: "Firewall", interfaces: [{ id: "f0", kind: "ethernet", addresses: [] }, { id: "f1", kind: "ethernet", addresses: [] }], properties: {} },
  { id: "server", type: "linux.server", label: "Server", interfaces: [{ id: "s0", kind: "ethernet", addresses: [] }], properties: {} },
];
const scenario = {
  scenarioId: "dev22-multihop",
  sourceHash: "dev22-hash",
  resources,
  zones: [],
  connections: [
    { id: "c-access", kind: "network", from: { resource: "client", port: "c0" }, to: { resource: "access", port: "a0" }, properties: { direction: "forward" } },
    { id: "access-core", kind: "network", from: { resource: "access", port: "a1" }, to: { resource: "core", port: "r0" }, properties: { direction: "forward" } },
    { id: "core-fw", kind: "network", from: { resource: "core", port: "r1" }, to: { resource: "fw", port: "f0" }, properties: { direction: "forward" } },
    { id: "fw-server", kind: "network", from: { resource: "fw", port: "f1" }, to: { resource: "server", port: "s0" }, properties: { direction: "forward" } },
  ],
};

function transcript(overrides = {}) {
  return {
    engineId: "foundation.observation",
    engineVersion: "1",
    modeled: true,
    boundary: "NO_GUEST_COMMAND_EXECUTION",
    probeMode: "ACTIVE_MODELED_PROBE",
    scenarioId: scenario.scenarioId,
    scenarioHash: scenario.sourceHash,
    stateRevision: 22,
    sourceId: "client",
    sourceLabel: "Client",
    sourceType: "windows.workstation",
    probeId: "dev22.multihop",
    command: "modeled probe",
    category: "connectivity",
    truth: "TRUE",
    destinationId: "server",
    destinationLabel: "Server",
    protocol: "icmp",
    path: ["client", "access", "core", "fw", "server"],
    lines: [],
    evidence: [{ kind: "engine_query", subject: "engine.queryReachability", state: "TRUE", value: { path: ["client", "access", "core", "fw", "server"] } }],
    ...overrides,
  };
}

let assertions = 0;
const eq = (actual, expected, message) => { assertions += 1; assert.equal(actual, expected, message); };
const deep = (actual, expected, message) => { assertions += 1; assert.deepEqual(actual, expected, message); };
const ok = (value, message) => { assertions += 1; assert.ok(value, message); };

{
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript());
  eq(result.ok, true, JSON.stringify(result.diagnostics));
  deep(result.model.reachedPath, ["client", "access", "core", "fw", "server"]);
  deep(result.model.events.filter((event) => event.kind === "flow.segment").map((event) => event.connectionId), ["c-access", "access-core", "core-fw", "fw-server"]);
  eq(result.model.outcome.kind, "destination_reached");
  eq(result.model.outcome.marker, "success");
  eq(result.model.outcome.markerDurationMs, 4000);
  eq(VISUAL_JOURNEY_OUTCOME_MARKER_MS, 4000);
  eq(result.model.outcome.anchorResourceId, "server");
  eq(result.model.outcome.anchorRole, "DESTINATION");
  eq(result.model.outcome.exactLocation, true);
  eq(result.model.playback.schemaVersion, "1.0.0");
  eq(result.model.playback.source, "ENGINE_EVENT_PROJECTION");
  eq(result.model.playback.ordering, "STRICT_SEQUENCE");
  eq(result.model.playback.replay, "DETERMINISTIC");
  eq(result.model.playback.eventCount, result.model.events.length);
  eq(result.model.playback.firstEventId, result.model.events[0].eventId);
  eq(result.model.playback.terminalEventId, result.model.events.at(-1).eventId);
  deep(result.model.events.map((event) => event.sequence), result.model.events.map((_, index) => index + 1));
  eq(visualJourneyFrame(result.model, result.model.events.length - 2).outcome, undefined);
  eq(visualJourneyFrame(result.model, 999).outcome.kind, "destination_reached");
  eq(visualJourneyFrame(result.model, 999).currentResourceId, "server");
}

{
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript({ truth: "FALSE", blockingPoint: "fw" }));
  eq(result.ok, true, JSON.stringify(result.diagnostics));
  deep(result.model.reachedPath, ["client", "access", "core", "fw"]);
  deep(result.model.events.filter((event) => event.kind === "flow.segment").map((event) => event.connectionId), ["c-access", "access-core", "core-fw"]);
  eq(result.model.events.some((event) => event.connectionId === "fw-server"), false, "Dropped packet must not animate beyond the verified drop point.");
  eq(result.model.outcome.kind, "dropped");
  eq(result.model.outcome.marker, "drop");
  eq(result.model.outcome.markerDurationMs, 4000);
  eq(result.model.outcome.anchorResourceId, "fw");
  eq(result.model.outcome.anchorRole, "DROP_POINT");
  eq(result.model.outcome.exactLocation, true);
  eq(result.model.events.at(-1).kind, "flow.dropped");
  eq(visualJourneyFrame(result.model, 999).terminalState, "dropped");
}

{
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript({ truth: "FALSE", path: ["client", "access", "core"], blockingPoint: undefined }));
  eq(result.ok, true, JSON.stringify(result.diagnostics));
  eq(result.model.outcome.kind, "dropped");
  eq(result.model.outcome.marker, "none", "No red marker may be fabricated without an exact Engine-owned drop resource.");
  eq(result.model.outcome.exactLocation, false);
  eq(result.model.outcome.anchorResourceId, undefined);
}

{
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript({ truth: "UNKNOWN", path: ["client", "access", "core"] }));
  eq(result.ok, true, JSON.stringify(result.diagnostics));
  eq(result.model.outcome.kind, "unknown");
  eq(result.model.outcome.marker, "unknown");
  eq(result.model.outcome.anchorResourceId, "core");
  eq(result.model.outcome.anchorRole, "LAST_KNOWN");
  eq(result.model.outcome.exactLocation, false);
  eq(result.model.terminalKind, "uncertain");
  eq(result.model.events.at(-1).kind, "flow.uncertain");
}

{
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript({ truth: "TRUE", path: ["client", "access", "core"] }));
  eq(result.ok, true, JSON.stringify(result.diagnostics));
  eq(result.model.outcome.kind, "unknown", "TRUE must not fabricate destination arrival when the proven path stops before the requested destination.");
  eq(result.model.outcome.marker, "unknown");
  eq(result.model.terminalKind, "uncertain");
  ok(result.diagnostics.some((diagnostic) => diagnostic.code === "VISUAL_JOURNEY_PATH_DESTINATION_DIFFERENT"));
}

console.log(`PASS dev22 canonical playback + outcome functional: ${assertions}`);
