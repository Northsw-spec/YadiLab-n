import assert from "node:assert/strict";
import { createInitialEngineState } from "../../dist-visual-journey-test/engine/src/index.js";
import { runActiveProbe } from "../../dist-visual-journey-test/observation-engine/src/index.js";
import { buildVisualJourneyFromActiveProbe, visualJourneyFrame } from "../../dist-visual-journey-test/ui/src/browser/visual-journey.js";
import { udpIcmpScenario, server, switchedScenario, natScenario } from "../fixtures/phase97.mjs";
let functional = 0, adversarial = 0;
const eq = (a,b,m) => { assert.deepEqual(a,b,m); functional++; };
const bad = (a,b,m) => { assert.deepEqual(a,b,m); adversarial++; };
const transcript = (doc, protocol = "udp", port = 5300) => runActiveProbe({ scenario: doc, state: createInitialEngineState(doc), sourceId: "client", destinationId: "server", probeId: `linux.${protocol === "udp" ? "udp_delivery" : "ping"}`, ...(protocol === "udp" ? { port } : {}) }).transcript;
const doc = udpIcmpScenario();
const healthy = transcript(doc);
const noListener = udpIcmpScenario(); server(noListener).properties.hostStack.sockets = [];
const partial = structuredClone(noListener); server(partial).properties.hostStack.complete = false;
const noPath = udpIcmpScenario(); noPath.connections = [];
const ambiguous = udpIcmpScenario(); server(ambiguous).properties.hostStack.sockets.push({ ...server(ambiguous).properties.hostStack.sockets[0], id: "socket-2" });
const cases = [[doc, "udp", 5300], [doc, "icmp"], [noListener, "udp", 5300], [partial, "udp", 5300], [noPath, "udp", 5300], [switchedScenario(), "udp", 5300], [natScenario(), "udp", 15300], [ambiguous, "udp", 5300]];
for (const [scenario, protocol, port] of cases) {
  const input = transcript(scenario, protocol, port);
  const result = buildVisualJourneyFromActiveProbe(scenario, input);
  eq(result.ok, true, JSON.stringify(result.diagnostics));
  eq(result.model.udpIcmpFailureDecision, input.udpIcmpFailureDecision, "exact trace into Journey");
  eq(result.model.events.at(-1).kind, `${protocol}.failure`, "diagnostic terminal marker, not wire arrival/drop");
  eq(result.model.events.at(-1).udpIcmpFailureDecision, input.udpIcmpFailureDecision, "timeline exact Engine decision");
  eq(result.model.events.some(row => row.kind === "flow.dropped" || row.kind === "flow.arrived"), false, "no fabricated datagram receipt/drop event");
  eq(visualJourneyFrame(result.model, 999).terminalState, "diagnosed", "reduced motion/scrub preserves diagnostic semantics");
  eq(buildVisualJourneyFromActiveProbe(scenario, input).model.events, result.model.events, "identical replay events");
}
const stpJourney = buildVisualJourneyFromActiveProbe(switchedScenario(), transcript(switchedScenario()));
eq(stpJourney.model.reachedPath, ["client", "switch"], "animation stops where STP proof stops");
eq(stpJourney.model.events.some(row => row.kind === "flow.segment" && row.targetResourceId === "server"), false, "no future hop after blocked port");
const mutations = [
  t => { t.udpIcmpFailureDecision.disposition = "NO_LISTENER"; },
  t => { t.udpIcmpFailureDecision.icmpEvidence = { type: 3, code: 3 }; },
  t => { t.udpIcmpFailureDecision.timeout = 1000; },
  t => { t.udpIcmpFailureDecision.protocol = "icmp"; },
  t => { t.udpIcmpFailureDecision.destinationId = "client"; },
  t => { t.udpIcmpFailureDecision.port = 5301; },
  t => { t.listenerServiceDecision.truth = "FALSE"; },
  t => { t.udpIcmpFailureDecision = {}; },
  t => { t.udpIcmpFailureDecision = null; },
  t => { t.evidence.push(t.evidence.find(row => row.subject === "engine.queryReachability")); },
  t => { delete t.udpIcmpFailureDecision; },
  t => { delete t.hostStackDecision; },
  t => { t.truth = "FALSE"; },
];
for (const mutate of mutations) {
  const forged = structuredClone(healthy); mutate(forged);
  bad(buildVisualJourneyFromActiveProbe(doc, forged).ok, false, "tampered transcript rejected fail-closed");
}
// Even coordinated editing of summary and embedded trace cannot contradict Host Stack evidence.
const coordinated = structuredClone(healthy);
coordinated.udpIcmpFailureDecision.listenerTruth = "FALSE";
coordinated.udpIcmpFailureDecision.disposition = "NO_LISTENER";
coordinated.evidence.find(row => row.subject === "engine.queryReachability").value.udpIcmpFailureDecision = coordinated.udpIcmpFailureDecision;
bad(buildVisualJourneyFromActiveProbe(doc, coordinated).ok, false, "coordinated reason/evidence tamper rejected");
console.log(`PASS Phase97 Visual Journey: ${functional} functional, ${adversarial} adversarial assertions.`);
