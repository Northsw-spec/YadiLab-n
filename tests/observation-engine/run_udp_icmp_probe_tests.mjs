import assert from "node:assert/strict";
import { createInitialEngineState, queryReachability } from "../../dist-observation-engine-test/engine/src/index.js";
import { runActiveProbe, listActiveProbeDefinitions } from "../../dist-observation-engine-test/observation-engine/src/index.js";
import { udpIcmpScenario, server, switchedScenario, natScenario } from "../fixtures/phase97.mjs";
let functional = 0, adversarial = 0;
const eq = (a,b,m) => { assert.deepEqual(a,b,m); functional++; };
const bad = (a,b,m) => { assert.deepEqual(a,b,m); adversarial++; };
function probe(doc, protocol = "udp", port = 5300) {
  const os = doc.resources[0].type.split(".")[0];
  return runActiveProbe({ scenario: doc, state: createInitialEngineState(doc), sourceId: "client", destinationId: "server", probeId: `${os}.${protocol === "udp" ? "udp_delivery" : "ping"}`, ...(protocol === "udp" ? { port } : {}) });
}
for (const os of ["windows", "linux"]) {
  const doc = udpIcmpScenario(os), state = createInitialEngineState(doc);
  eq(listActiveProbeDefinitions(state, "client").some(row => row.probeId === `${os}.udp_delivery`), true, "UDP represented on both OS");
  const result = probe(doc);
  eq(result.ok, true, "OS-scoped UDP modeled probe available");
  eq(result.transcript.udpIcmpFailureDecision, queryReachability(doc, state, "client", "server", "udp", 5300).value.udpIcmpFailureDecision, "exact Engine trace, no Observation winner");
  eq(result.transcript.boundary, "NO_GUEST_COMMAND_EXECUTION", "never run actual host sockets");
  eq(result.transcript.udpIcmpFailureDecision.disposition, "DATAGRAM_DELIVERABLE", "deliverability not response");
  eq(result.transcript.command.includes(os === "windows" ? "Get-NetUDPEndpoint" : "ss -lunp"), true, "concrete Windows/Linux projection");
  eq(result.transcript.command.includes("modeled server"), true, "inspection explicitly targets modeled destination");
  const icmp = probe(doc, "icmp");
  eq(icmp.transcript.udpIcmpFailureDecision.disposition, "REQUEST_PATH_REACHABLE", "ping only proves request path");
  eq(icmp.transcript.udpIcmpFailureDecision.reply, "NOT_MODELED", "ping cannot fabricate echo reply");
  eq(icmp.transcript.lines.some(line => line.includes("timeout and retries are NOT_MODELED")), true, "unmodeled timer truth appears in transcript");
  const noListener = structuredClone(doc); server(noListener).properties.hostStack.sockets = [];
  eq(probe(noListener).transcript.udpIcmpFailureDecision.disposition, "NO_LISTENER", "probe distinguishes listener absence");
  server(noListener).properties.hostStack.complete = false;
  eq(probe(noListener).transcript.udpIcmpFailureDecision.disposition, "SNAPSHOT_INCOMPLETE", "probe incomplete state UNKNOWN");
  const offLink = structuredClone(doc); server(offLink).interfaces[0].addresses = ["10.98.0.20/24"];
  const sourceGate = probe(offLink);
  eq(sourceGate.transcript.truth, "FALSE", "existing default gateway gate retained");
  eq(sourceGate.transcript.udpIcmpFailureDecision.disposition, "NETWORK_BLOCKED", "gateway source override reclassified by Engine");
  eq(sourceGate.transcript.udpIcmpFailureDecision.listenerTruth, "NOT_EVALUATED", "upstream gateway gate discards downstream listener proof");
  const partialRoute = structuredClone(offLink); partialRoute.resources[0].properties.defaultGateway = "invalid";
  eq(probe(partialRoute).transcript.udpIcmpFailureDecision.truth, "UNKNOWN", "malformed gateway never guesses timeout");
  eq(probe(doc), result, "probe deterministic replay");
  for (const port of [undefined, 0, 65536, 5.5, "5300"]) bad(runActiveProbe({ scenario: doc, state, sourceId: "client", destinationId: "server", probeId: `${os}.udp_delivery`, ...(port !== undefined ? { port } : {}) }).ok, false, "malformed/missing port rejected at input boundary");
}
const stp = probe(switchedScenario());
eq(stp.transcript.udpIcmpFailureDecision.disposition, "NETWORK_BLOCKED", "STP authoritative before probe listener");
eq(stp.transcript.listenerServiceDecision, undefined, "no manufactured downstream proof");
const nat = probe(natScenario(), "udp", 15300);
eq(nat.transcript.udpIcmpFailureDecision.effectiveDestinationPort, 5300, "exact DNAT effective tuple propagated");
eq(nat.transcript.listenerServiceDecision.port, 5300, "listener remains Phase95 authoritative");
console.log(`PASS Phase97 Active Probe: ${functional} functional, ${adversarial} adversarial assertions.`);
