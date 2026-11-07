import assert from "node:assert/strict";
import { createInitialEngineState, queryReachability, validateUdpIcmpFailureDecision } from "../../dist-engine-test/engine/src/index.js";
import { udpIcmpScenario, server, switchedScenario, natScenario } from "../fixtures/phase97.mjs";
let functional = 0, adversarial = 0, regression = 0;
const eq = (a,b,m) => { assert.deepEqual(a,b,m); functional++; };
const bad = (a,b,m) => { assert.deepEqual(a,b,m); adversarial++; };
const reg = (a,b,m) => { assert.deepEqual(a,b,m); regression++; };
const query = (doc, protocol = "udp", port = protocol === "udp" ? 5300 : undefined) => queryReachability(doc, createInitialEngineState(doc), "client", "server", protocol, port);
const trace = result => result.value?.udpIcmpFailureDecision;
const healthy = query(udpIcmpScenario());
eq(healthy.truth, "TRUE", "UDP BOUND socket and network path prove deliverability");
eq(trace(healthy).disposition, "DATAGRAM_DELIVERABLE", "UDP is not handshake establishment");
eq(trace(healthy).networkTruth, "TRUE", "network-before-listener truth explicit");
eq(trace(healthy).listenerTruth, "TRUE", "listener truth explicit");
eq(trace(healthy).listenerModel, "EXPLICIT_HOST_STACK", "explicit model provenance");
eq(trace(healthy).icmpEvidence, "NOT_MODELED", "no fabricated ICMP evidence");
eq(trace(healthy).timeout, "NOT_MODELED", "no invented timeout");
eq(Object.isFrozen(trace(healthy)), true, "downstream classification is immutable");
eq(Object.isFrozen(trace(healthy).explanation), true, "explanation immutable");
eq(validateUdpIcmpFailureDecision(healthy, trace(healthy)), true, "valid trace passes Engine validator");
eq(query(udpIcmpScenario()), healthy, "deterministic replay");
const noListener = udpIcmpScenario(); server(noListener).properties.hostStack.sockets = [];
const absent = query(noListener);
eq(absent.truth, "FALSE", "complete snapshot no UDP listener is false");
eq(trace(absent).disposition, "NO_LISTENER", "no listener differs from network drop");
eq(trace(absent).networkTruth, "TRUE", "listener false does not imply network false");
eq(trace(absent).icmpEvidence, "NOT_MODELED", "no listener does not generate Port Unreachable");
const partial = structuredClone(noListener); server(partial).properties.hostStack.complete = false;
const incomplete = query(partial);
eq(incomplete.truth, "UNKNOWN", "partial snapshot cannot prove absence");
eq(trace(incomplete).disposition, "SNAPSHOT_INCOMPLETE", "snapshot reason explicit");
const noPath = udpIcmpScenario(); noPath.connections = [];
eq(trace(query(noPath)).disposition, "NETWORK_BLOCKED", "UDP no path is not no listener");
eq(trace(query(noPath, "icmp")).disposition, "NETWORK_BLOCKED", "ICMP no path explicit");
const denied = udpIcmpScenario(); server(denied).properties.isFirewall = true; server(denied).properties.rules = [{ id: "deny", source: "any", destination: "server", protocol: "any", action: "deny" }]; server(denied).properties.defaultAction = "allow";
for (const protocol of ["udp", "icmp"]) {
  const blocked = query(denied, protocol);
  eq(blocked.truth, "FALSE", `${protocol} policy deny decisive`);
  eq(trace(blocked).disposition, "POLICY_BLOCKED", `${protocol} explicit deny classification`);
  eq(blocked.value.listenerServiceDecision, undefined, "policy deny before listener evaluation");
  eq(trace(blocked).policyTruth, "FALSE", "policy truth retained");
}
const icmp = query(udpIcmpScenario(), "icmp");
eq(trace(icmp).disposition, "REQUEST_PATH_REACHABLE", "ICMP request path only");
eq(trace(icmp).reply, "NOT_MODELED", "no echo reply invented");
eq(trace(icmp).port, undefined, "ICMP is portless");
eq(trace(icmp).listenerTruth, "NOT_REQUIRED", "ICMP no socket requirement");
eq(validateUdpIcmpFailureDecision(icmp, trace(icmp)), true, "portless trace valid");
const legacy = udpIcmpScenario(); delete server(legacy).properties.hostStack;
eq(trace(query(legacy)).listenerModel, "SERVICE_DECLARATIONS", "declaration-only provenance preserved");
eq(query(legacy).value.hostStackDecision.sockets, [], "no synthetic BOUND socket");

for (const mutation of [
  t => { t.destinationId = "ghost"; }, t => { t.sourceId = "other"; },
  t => { t.protocol = "tcp"; }, t => { t.port = 5301; }, t => { t.effectiveDestinationPort = 5301; },
  t => { t.truth = "FALSE"; }, t => { t.disposition = "NO_LISTENER"; },
  t => { t.networkTruth = "FALSE"; }, t => { t.listenerTruth = "FALSE"; },
  t => { t.icmpEvidence = { type: 3, code: 3 }; }, t => { t.timeout = 1000; },
  t => { t.retries = 4; }, t => { t.reply = "OBSERVED"; }, t => { t.icmpType = 3; },
  t => { t.listenerModel = "SERVICE_DECLARATIONS"; }, t => { delete t.explanation; },
]) {
  const forged = structuredClone(trace(healthy)); mutation(forged);
  bad(validateUdpIcmpFailureDecision(healthy, forged), false, "tampered/added failure evidence rejected");
}
for (const malformed of [null, [], "trace", {}, { ...trace(healthy), explanation: [null] }]) bad(validateUdpIcmpFailureDecision(healthy, malformed), false, "malformed trace fail-closed");
const forgedResult = structuredClone(healthy); forgedResult.value.listenerServiceDecision.truth = "FALSE";
bad(validateUdpIcmpFailureDecision(forgedResult, trace(healthy)), false, "forged listener evidence rejected");
const duplicatePolicy = structuredClone(query(denied)); duplicatePolicy.value.policyDecisions.push(duplicatePolicy.value.policyDecisions[0]);
bad(validateUdpIcmpFailureDecision(duplicatePolicy, trace(duplicatePolicy)), false, "duplicated evidence rejected");
for (const mutate of [
  h => { h.sockets.push(structuredClone(h.sockets[0])); },
  h => { h.sockets[0].processId = "ghost"; },
  h => { h.sockets[0].state = "LISTEN"; },
  h => { h.sockets[0].localPort = "5300"; },
  h => { h.complete = "true"; },
]) {
  const doc = udpIcmpScenario(); mutate(server(doc).properties.hostStack);
  const result = query(doc);
  bad(result.truth, "UNKNOWN", "malformed/duplicate/stale UDP state is UNKNOWN");
  bad(trace(result).disposition, "UNKNOWN", "no guessed failure reason for malformed state");
}
const ambiguous = udpIcmpScenario(); server(ambiguous).properties.hostStack.sockets.push({ ...server(ambiguous).properties.hostStack.sockets[0], id: "socket-2" });
bad(query(ambiguous).truth, "UNKNOWN", "unmodeled multi-BOUND delivery ambiguity fails closed");
const noPort = queryReachability(udpIcmpScenario(), createInitialEngineState(udpIcmpScenario()), "client", "server", "udp");
bad(noPort.truth, "UNKNOWN", "UDP diagnostic lacks mandatory destination port");
bad(query(udpIcmpScenario(), "icmp", 5300).truth, "UNKNOWN", "ICMP port spoof rejected");
const stp = query(switchedScenario());
reg(stp.truth, "FALSE", "STP remains decisive before UDP listener");
reg(trace(stp).disposition, "NETWORK_BLOCKED", "STP block classified from upstream truth");
reg(stp.value.listenerServiceDecision, undefined, "no downstream listener beyond STP");
reg(stp.value.stpDecisions[0].ports.find(row => row.interfaceId === "p2").state, "BLOCKING", "exact STP port state preserved");
const nat = query(natScenario(), "udp", 15300);
reg(nat.truth, "TRUE", "DNAT delivers to translated UDP BOUND port");
reg(trace(nat).port, 15300, "original UDP port bound");
reg(trace(nat).effectiveDestinationPort, 5300, "translated listener port bound");
reg(nat.value.listenerServiceDecision.port, 5300, "Phase95 trace preserves translated port");
const natAbsent = natScenario(); server(natAbsent).properties.hostStack.sockets = [];
const natAbsentResult = query(natAbsent, "udp", 15300);
reg(natAbsentResult.value.translatedPort, 5300, "DNAT tuple preserved on listener failure too");
reg(trace(natAbsentResult).disposition, "NO_LISTENER", "NAT no listener remains distinct");
const unknownRoute = udpIcmpScenario(); unknownRoute.resources[0].properties.routes = [{ destination: "server", via: "ghost", action: "forward" }];
reg(query(unknownRoute).value.listenerServiceDecision, undefined, "unknown upstream route does not fabricate endpoint evaluation");
console.log(`PASS Phase97 Engine: ${functional} functional, ${adversarial} adversarial, ${regression} cross-phase assertions.`);
