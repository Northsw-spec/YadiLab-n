import assert from "node:assert/strict";
import { buildVisualJourneyFromActiveProbe, visualJourneyXRayFrame } from "../../dist-browser-test/ui/src/browser/visual-journey.js";

const scenario = {
  scenarioId: "dev23-xray", sourceHash: "dev23-hash", zones: [],
  resources: [
    { id: "client", type: "windows.workstation", label: "Client", interfaces: [{ id: "c0", kind: "ethernet", addresses: [] }], properties: {} },
    { id: "router", type: "network.router", label: "Router", interfaces: [{ id: "r0", kind: "ethernet", addresses: [] }, { id: "r1", kind: "ethernet", addresses: [] }], properties: {} },
    { id: "server", type: "linux.server", label: "Server", interfaces: [{ id: "s0", kind: "ethernet", addresses: [] }], properties: {} },
  ],
  connections: [
    { id: "client-router", kind: "network", from: { resource: "client", port: "c0" }, to: { resource: "router", port: "r0" }, properties: { direction: "forward" } },
    { id: "router-server", kind: "network", from: { resource: "router", port: "r1" }, to: { resource: "server", port: "s0" }, properties: { direction: "forward" } },
  ],
};
function transcript(overrides={}) {
  return {
    engineId: "foundation.observation", engineVersion: "1", modeled: true, boundary: "NO_GUEST_COMMAND_EXECUTION", probeMode: "ACTIVE_MODELED_PROBE",
    scenarioId: scenario.scenarioId, scenarioHash: scenario.sourceHash, stateRevision: 23,
    sourceId: "client", sourceLabel: "Client", sourceType: "windows.workstation", probeId: "dev23.xray", command: "modeled probe", category: "connectivity",
    truth: "TRUE", destinationId: "server", destinationLabel: "Server", protocol: "tcp", port: 443,
    path: ["client","router","server"], lines: [],
    evidence: [{ kind: "engine_query", subject: "engine.queryReachability", state: "TRUE", value: { path: ["client","router","server"] } }],
    ...overrides,
  };
}
const routeDecision = {
  resourceId: "router", destinationId: "server", nextHopResourceId: "server", truth: "TRUE",
  candidates: [{ index: 0, routeId: "to-server", disposition: "MATCH", selected: true, destination: "server", via: "server", outgoingInterface: "r1", declaredMetric: 10 }],
  selectedRouteId: "to-server", declaredNextHop: "server", outgoingInterface: "r1", explanation: ["Engine selected route."],
};
const hostStackDecision = {
  resourceId: "server", truth: "TRUE", model: "EXPLICIT_HOST_STACK", complete: true,
  processes: [{ processId: "proc-web", name: "web", pid: 23, service: "https" }],
  sockets: [{ socketId: "sock-web", protocol: "tcp", localAddress: "0.0.0.0", localPort: 443, bindScope: "WILDCARD", state: "LISTEN", processId: "proc-web", service: "https" }],
  services: [{ index: 0, name: "https", enabled: true, port: 443, protocol: "tcp", owningProcessIds: ["proc-web"], socketIds: ["sock-web"] }],
  selectedServiceNames: ["https"], selectedSocketIds: ["sock-web"], listenerConsistency: "CONSISTENT", explanation: ["Explicit host stack."],
};
const listenerServiceDecision = {
  resourceId: "server", truth: "TRUE", protocol: "tcp", port: 443, model: "EXPLICIT_HOST_STACK", complete: true,
  listenerState: "LISTENING", serviceState: "ENABLED", disposition: "LISTENING", selectedServiceNames: ["https"], selectedSocketIds: ["sock-web"], listenerConsistency: "CONSISTENT", explanation: ["Listener proven."],
};
const tcpStateMachineDecision = {
  sourceId: "client", destinationId: "server", port: 443, truth: "TRUE", model: "EXPLICIT_HOST_STACK", complete: true,
  disposition: "LISTENING", listenerTruth: "TRUE",
  socketRows: [{ socketId: "sock-web", localAddress: "0.0.0.0", localPort: 443, state: "LISTEN", role: "LISTENER", selected: true, processId: "proc-web", service: "https", allowedNextStates: ["SYN_RECEIVED"] }],
  selectedSocketIds: ["sock-web"], currentStates: ["LISTEN"],
  canonicalTransitions: [
    { from: "CLOSED", to: "SYN_SENT", trigger: "active open / SYN" },
    { from: "CLOSED", to: "LISTEN", trigger: "passive open" },
    { from: "LISTEN", to: "SYN_RECEIVED", trigger: "SYN received" },
    { from: "SYN_SENT", to: "ESTABLISHED", trigger: "SYN/ACK received; ACK sent" },
    { from: "SYN_RECEIVED", to: "ESTABLISHED", trigger: "ACK received" },
    { from: "ESTABLISHED", to: "FIN_WAIT_1", trigger: "active close / FIN" },
    { from: "ESTABLISHED", to: "CLOSE_WAIT", trigger: "peer FIN received" },
    { from: "FIN_WAIT_1", to: "FIN_WAIT_2", trigger: "ACK of local FIN" },
    { from: "FIN_WAIT_1", to: "CLOSING", trigger: "peer FIN before local FIN ACK" },
    { from: "FIN_WAIT_1", to: "TIME_WAIT", trigger: "peer FIN and local FIN acknowledged" },
    { from: "FIN_WAIT_2", to: "TIME_WAIT", trigger: "peer FIN received; ACK sent" },
    { from: "CLOSE_WAIT", to: "LAST_ACK", trigger: "local close / FIN" },
    { from: "CLOSING", to: "TIME_WAIT", trigger: "ACK of local FIN" },
    { from: "LAST_ACK", to: "CLOSED", trigger: "ACK of local FIN" },
    { from: "TIME_WAIT", to: "CLOSED", trigger: "TIME-WAIT timer expiry" },
  ],
  sequenceAckTimeline: "NOT_MODELED", retransmissionMarkers: "NOT_MODELED", explanation: ["Explicit LISTEN state."],
};

let assertions=0;
const eq=(a,b,m)=>{assertions++;assert.equal(a,b,m)};
const deep=(a,b,m)=>{assertions++;assert.deepEqual(a,b,m)};

const result=buildVisualJourneyFromActiveProbe(scenario, transcript({ routeDecisions:[routeDecision], hostStackDecision, listenerServiceDecision, tcpStateMachineDecision }));
eq(result.ok,true,JSON.stringify(result.diagnostics));
const kinds=result.model.events.map(e=>e.kind);
deep(kinds,["flow.started","flow.segment","route.decision","flow.segment","hoststack.decision","listener.service","tcp.state","flow.arrived"]);
const expectedFamilies={
  "flow.started":"FLOW", "flow.segment":"FLOW", "route.decision":"ROUTING", "hoststack.decision":"HOST_STACK",
  "listener.service":"LISTENER_SERVICE", "tcp.state":"TCP_STATE", "flow.arrived":"FLOW",
};
for (let cursor=0;cursor<result.model.events.length;cursor++) {
  const event=result.model.events[cursor]; const x=visualJourneyXRayFrame(result.model,cursor);
  eq(x.schemaVersion,"1.0.0"); eq(x.source,"ENGINE_EVENT_PROJECTION"); eq(x.cursor,cursor); eq(x.eventCount,result.model.events.length);
  eq(x.eventId,event.eventId); eq(x.sequence,event.sequence); eq(x.eventKind,event.kind); eq(x.decisionKind,expectedFamilies[event.kind]);
  eq(x.truth,event.truth); eq(x.provenance,"MODELED"); deep(x.evidenceRefs,event.evidenceRefs); eq(x.summary,event.summary);
}
const routeIndex=kinds.indexOf("route.decision");
const routeX=visualJourneyXRayFrame(result.model,routeIndex);
eq(routeX.currentResourceId,"router"); eq(routeX.targetResourceId,"server"); eq(routeX.decisionKind,"ROUTING");
const hostX=visualJourneyXRayFrame(result.model,kinds.indexOf("hoststack.decision")); eq(hostX.currentResourceId,"server"); eq(hostX.decisionKind,"HOST_STACK");
const listenerX=visualJourneyXRayFrame(result.model,kinds.indexOf("listener.service")); eq(listenerX.decisionKind,"LISTENER_SERVICE");
const tcpX=visualJourneyXRayFrame(result.model,kinds.indexOf("tcp.state")); eq(tcpX.protocol,"tcp"); eq(tcpX.port,443); eq(tcpX.decisionKind,"TCP_STATE");
const terminal=visualJourneyXRayFrame(result.model,999); eq(terminal.eventKind,"flow.arrived"); eq(terminal.outcome.kind,"destination_reached");
console.log(`PASS dev23 synchronized Event X-Ray functional: ${assertions}`);
