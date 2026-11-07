import assert from "node:assert/strict";
import { buildVisualJourneyFromActiveProbe, visualJourneyFrame } from "../../dist-browser-test/ui/src/browser/visual-journey.js";

const scenario = {
  scenarioId: "journey-demo",
  sourceHash: "hash-1",
  resources: [
    { id: "client", type: "windows.workstation", label: "Client", interfaces: [{ id: "c0", kind: "ethernet", mac: "02:00:00:00:00:10", addresses: [] }], properties: {} },
    { id: "router", type: "network.router", label: "Router", interfaces: [{ id: "p1", kind: "ethernet", addresses: [] }, { id: "p2", kind: "ethernet", addresses: [] }, { id: "p3", kind: "ethernet", addresses: [] }], properties: {} },
    { id: "server", type: "windows.server", label: "Server", interfaces: [{ id: "s0", kind: "ethernet", mac: "02:00:00:00:01:20", addresses: [] }], properties: {} },
    { id: "observer", type: "linux.host", label: "Observer", interfaces: [{ id: "o0", kind: "ethernet", mac: "02:00:00:00:02:30", addresses: [] }], properties: {} },
  ],
  zones: [],
  connections: [
    { id: "client-router", kind: "network", from: { resource: "client", port: "c0" }, to: { resource: "router", port: "p1" }, properties: { direction: "forward" } },
    { id: "router-server", kind: "network", from: { resource: "router", port: "p2" }, to: { resource: "server", port: "s0" }, properties: { direction: "forward" } },
    { id: "router-observer", kind: "network", from: { resource: "router", port: "p3" }, to: { resource: "observer", port: "o0" }, properties: { direction: "forward" } },
  ],
};

function transcript(overrides = {}) {
  return {
    engineId: "foundation.observation",
    engineVersion: "1",
    modeled: true,
    boundary: "NO_GUEST_COMMAND_EXECUTION",
    probeMode: "ACTIVE_MODELED_PROBE",
    scenarioId: "journey-demo",
    scenarioHash: "hash-1",
    stateRevision: 7,
    sourceId: "client",
    sourceLabel: "Client",
    sourceType: "windows.workstation",
    probeId: "windows.test_netconnection",
    command: "Test-NetConnection server -Port 443",
    category: "connectivity",
    truth: "TRUE",
    destinationId: "server",
    destinationLabel: "Server",
    protocol: "tcp",
    port: 443,
    path: ["client", "router", "server"],
    lines: [],
    evidence: [{ kind: "engine_query", subject: "engine.queryReachability", state: "TRUE", value: { path: ["client", "router", "server"] } }],
    ...overrides,
  };
}

{
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript());
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.model.events.length, 4);
  assert.deepEqual(result.model.events.map((event) => event.kind), ["flow.started", "flow.segment", "flow.segment", "flow.arrived"]);
  assert.deepEqual(result.model.events.filter((event) => event.kind === "flow.segment").map((event) => event.connectionId), ["client-router", "router-server"]);
  const frame = visualJourneyFrame(result.model, 2);
  assert.equal(frame.activeConnectionId, "router-server");
  assert.deepEqual(frame.completedConnectionIds, ["client-router"]);
  assert.deepEqual(frame.activeDirection, { from: "router", to: "server" });
}

{
  const comparisonScenario = {
    ...scenario,
    connections: scenario.connections.map((connection) => ({ ...connection, properties: {} })),
  };
  const pathComparison = {
    sourceId: "client", destinationId: "server", protocol: "tcp", servicePort: 443,
    forwardTruth: "TRUE", forwardPath: ["client", "router", "server"],
    returnTruth: "TRUE", returnPath: ["server", "router", "client"],
    symmetry: "SYMMETRIC", returnEvaluationMode: "NETWORK_ONLY", returnSecurityStatus: "RETURN_TUPLE_NOT_MODELED",
    natStateImplication: "NONE", interfaceComparisons: [], explanation: [],
  };
  const result = buildVisualJourneyFromActiveProbe(comparisonScenario, transcript({ pathComparison }));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.model.pathComparison.trace.symmetry, "SYMMETRIC");
  assert.deepEqual(result.model.pathComparison.forwardSegments, [
    { connectionId: "client-router", from: "client", to: "router" },
    { connectionId: "router-server", from: "router", to: "server" },
  ]);
  assert.deepEqual(result.model.pathComparison.returnSegments, [
    { connectionId: "router-server", from: "server", to: "router" },
    { connectionId: "client-router", from: "router", to: "client" },
  ]);
}

{
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript({ truth: "FALSE", blockingPoint: "router" }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.model.reachedPath, ["client", "router"]);
  assert.deepEqual(result.model.events.map((event) => event.kind), ["flow.started", "flow.segment", "flow.dropped"]);
  assert.equal(result.model.events.at(-1).resourceId, "router");
  assert.equal(visualJourneyFrame(result.model, 99).terminalState, "dropped");
}

{
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript({ truth: "FALSE", path: undefined, blockingPoint: undefined }));
  assert.equal(result.ok, true);
  assert.equal(result.model.terminalKind, "no_path");
  assert.deepEqual(result.model.events.map((event) => event.kind), ["flow.started", "route.no_path"]);
}

{
  const reverseScenario = {
    ...scenario,
    connections: [{ id: "bi", kind: "network", from: { resource: "router" }, to: { resource: "client" }, properties: {} }],
  };
  const result = buildVisualJourneyFromActiveProbe(reverseScenario, transcript({ destinationId: "router", destinationLabel: "Router", path: ["client", "router"], port: undefined }));
  assert.equal(result.ok, true);
  assert.equal(result.model.events[1].connectionId, "bi");
}

{
  const routeDecision = {
    resourceId: "router",
    destinationId: "server",
    nextHopResourceId: "server",
    truth: "TRUE",
    candidates: [
      { index: 0, routeId: "other", disposition: "NO_MATCH", selected: false, destination: "client" },
      { index: 1, routeId: "to-server", disposition: "MATCH", selected: true, destination: "server", via: "server", outgoingInterface: "wan0", declaredMetric: 10 },
    ],
    selectedRouteId: "to-server",
    declaredNextHop: "server",
    outgoingInterface: "wan0",
    explanation: ["Engine selected to-server."],
  };
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript({ routeDecisions: [routeDecision] }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.model.events.map((event) => event.kind), ["flow.started", "flow.segment", "route.decision", "flow.segment", "flow.arrived"]);
  assert.equal(result.model.events[2].routeDecision.selectedRouteId, "to-server");
  assert.equal(result.model.events[2].truth, "TRUE");
  assert.deepEqual(result.model.routeDecisions, [routeDecision]);
}

{
  const neighborDecision = {
    resourceId: "router",
    destinationId: "server",
    nextHopResourceId: "server",
    truth: "TRUE",
    candidates: [
      { index: 0, entryId: "client-neighbor", disposition: "NO_MATCH", selected: false, targetResourceId: "client", protocol: "ARP", address: "10.0.0.10", mac: "02:00:00:00:00:10", interfaceId: "lan0", state: "STALE" },
      { index: 1, entryId: "server-neighbor", disposition: "MATCH", selected: true, targetResourceId: "server", protocol: "ARP", address: "10.0.1.20", mac: "02:00:00:00:01:20", interfaceId: "lan1", state: "REACHABLE" },
    ],
    selectedEntryId: "server-neighbor",
    selectedProtocol: "ARP",
    selectedAddress: "10.0.1.20",
    selectedMac: "02:00:00:00:01:20",
    outgoingInterface: "lan1",
    selectedState: "REACHABLE",
    explanation: ["Engine selected server-neighbor."],
  };
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript({ neighborDecisions: [neighborDecision] }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.model.events.map((event) => event.kind), ["flow.started", "flow.segment", "neighbor.decision", "flow.segment", "flow.arrived"]);
  assert.equal(result.model.events[2].neighborDecision.selectedEntryId, "server-neighbor");
  assert.equal(result.model.events[2].neighborDecision.selectedMac, "02:00:00:00:01:20");
  assert.equal(result.model.events[2].truth, "TRUE");
  assert.deepEqual(result.model.neighborDecisions, [neighborDecision]);
}



{
  const macDecision = {
    resourceId: "router", sourceResourceId: "client", destinationId: "server", nextHopResourceId: "server", truth: "TRUE",
    sourceMac: "02:00:00:00:00:10", destinationMac: "02:00:00:00:01:20", ingressInterface: "p1", expectedEgressInterface: "p2",
    selectedEntryId: "server-mac", selectedEgressInterface: "p2", learning: "REFRESHED", forwarding: "UNICAST",
    candidates: [
      { index: 0, entryId: "client-mac", disposition: "SOURCE_MATCH", selected: false, mac: "02:00:00:00:00:10", interfaceId: "p1" },
      { index: 1, entryId: "server-mac", disposition: "DESTINATION_MATCH", selected: true, mac: "02:00:00:00:01:20", interfaceId: "p2" },
    ], explanation: ["Engine selected p2."],
  };
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript({ macDecisions: [macDecision] }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.model.events.map((event) => event.kind), ["flow.started","flow.segment","mac.learn","mac.lookup","mac.forward","flow.segment","flow.arrived"]);
  assert.equal(result.model.events[4].macDecision.selectedEntryId, "server-mac");
  assert.equal(result.model.events[4].macDecision.selectedEgressInterface, "p2");
  assert.deepEqual(result.model.events[4].projectedConnectionIds, ["router-server"]);
  const macFrame = visualJourneyFrame(result.model, 4);
  assert.deepEqual(macFrame.activeConnectionIds, ["router-server"]);
  assert.equal(macFrame.activeConnectionId, "router-server");
  assert.deepEqual(result.model.macDecisions, [macDecision]);
}

{
  const floodDecision = {
    resourceId: "router", sourceResourceId: "client", destinationId: "server", nextHopResourceId: "server", truth: "TRUE",
    sourceMac: "02:00:00:00:00:10", destinationMac: "02:00:00:00:01:20", ingressInterface: "p1", expectedEgressInterface: "p2",
    floodInterfaces: ["p2", "p3"], learning: "LEARNED", forwarding: "FLOOD", candidates: [], explanation: ["Engine flood set p2,p3."],
  };
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript({ macDecisions: [floodDecision] }));
  assert.equal(result.ok, true);
  const floodEvent = result.model.events.find((event) => event.kind === "mac.flood");
  assert.deepEqual(floodEvent.projectedConnectionIds, ["router-server", "router-observer"]);
  const floodFrame = visualJourneyFrame(result.model, result.model.events.indexOf(floodEvent));
  assert.deepEqual(floodFrame.activeConnectionIds, ["router-server", "router-observer"]);
  assert.equal(floodFrame.activeConnectionId, undefined);
}



{
  const vlanDecision = {
    resourceId: "router", sourceResourceId: "client", destinationId: "server", nextHopResourceId: "server", truth: "TRUE",
    vlan: 10, ingressInterface: "p1", egressInterface: "p2", ingressMode: "ACCESS", egressMode: "TRUNK",
    ingressTag: "UNTAGGED", egressTag: "TAGGED", rewrite: "ADD_TAG",
    ports: [
      { interfaceId: "p1", mode: "ACCESS", accessVlan: 10, egressTag: "UNTAGGED", disposition: "INGRESS" },
      { interfaceId: "p2", mode: "TRUNK", allowedVlans: [10, 20], egressTag: "TAGGED", disposition: "EGRESS" },
      { interfaceId: "p3", mode: "ACCESS", accessVlan: 20, disposition: "BLOCKED" },
    ],
    explanation: ["Engine classifies VLAN 10 and tags trunk egress."],
  };
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript({ vlanDecisions: [vlanDecision] }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.model.events.map((event) => event.kind), ["flow.started","flow.segment","vlan.classify","vlan.tag","flow.segment","flow.arrived"]);
  assert.equal(result.model.events[2].vlanDecision.vlan, 10);
  assert.equal(result.model.events[3].vlanDecision.rewrite, "ADD_TAG");
  assert.deepEqual(result.model.events[3].projectedConnectionIds, ["router-server"]);
  const vlanFrame = visualJourneyFrame(result.model, 3);
  assert.deepEqual(vlanFrame.activeConnectionIds, ["router-server"]);
  assert.deepEqual(result.model.vlanDecisions, [vlanDecision]);
}

{
  const vlanDecision = {
    resourceId: "router", sourceResourceId: "client", destinationId: "server", nextHopResourceId: "server", truth: "TRUE",
    vlan: 10, ingressInterface: "p1", egressInterface: "p2", ingressMode: "TRUNK", egressMode: "ACCESS",
    ingressTag: "TAGGED", egressTag: "UNTAGGED", rewrite: "REMOVE_TAG",
    ports: [
      { interfaceId: "p1", mode: "TRUNK", allowedVlans: [10, 20], egressTag: "TAGGED", disposition: "INGRESS" },
      { interfaceId: "p2", mode: "ACCESS", accessVlan: 10, egressTag: "UNTAGGED", disposition: "EGRESS" },
      { interfaceId: "p3", mode: "ACCESS", accessVlan: 20, disposition: "BLOCKED" },
    ],
    explanation: ["Engine removes the VLAN tag on access egress."],
  };
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript({ vlanDecisions: [vlanDecision] }));
  assert.equal(result.ok, true);
  assert.ok(result.model.events.some((event) => event.kind === "vlan.untag"));
  const untag = result.model.events.find((event) => event.kind === "vlan.untag");
  assert.equal(untag.vlanDecision.egressTag, "UNTAGGED");
  assert.deepEqual(untag.projectedConnectionIds, ["router-server"]);
}

{
  const stpDecision = {
    resourceId: "router", sourceResourceId: "client", destinationId: "server", nextHopResourceId: "server", truth: "TRUE", modelComplete: true,
    ingressInterface: "p1", egressInterface: "p2", protocol: "RSTP", bridgeId: "b1", rootBridgeId: "root", rootPathCost: 4, isRootBridge: false,
    ports: [
      { interfaceId: "p1", disposition: "INGRESS", role: "ROOT", state: "FORWARDING", bpdu: "RECEIVE" },
      { interfaceId: "p2", disposition: "EGRESS", role: "DESIGNATED", state: "FORWARDING", bpdu: "SEND" },
      { interfaceId: "p3", disposition: "OTHER", role: "ALTERNATE", state: "DISCARDING", bpdu: "RECEIVE" },
    ],
    explanation: ["Engine STP permits the path."],
  };
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript({ stpDecisions: [stpDecision] }));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.model.events.filter((event) => event.kind === "stp.bpdu").map((event) => event.projectedConnectionIds?.[0]), ["client-router", "router-server", "router-observer"]);
  const decisionEvent = result.model.events.find((event) => event.kind === "stp.decision");
  assert.equal(decisionEvent.stpDecision.rootBridgeId, "root");
  assert.deepEqual(decisionEvent.projectedConnectionIds, ["router-server"]);
  assert.deepEqual(result.model.stpDecisions, [stpDecision]);
}

{
  const blockedStp = {
    resourceId: "router", sourceResourceId: "client", destinationId: "server", nextHopResourceId: "server", truth: "FALSE", modelComplete: true,
    ingressInterface: "p1", egressInterface: "p2", protocol: "STP", bridgeId: "b1", rootBridgeId: "b1", isRootBridge: true,
    ports: [
      { interfaceId: "p1", disposition: "INGRESS", role: "DESIGNATED", state: "FORWARDING", bpdu: "SEND" },
      { interfaceId: "p2", disposition: "EGRESS", role: "ALTERNATE", state: "BLOCKING", bpdu: "RECEIVE" },
      { interfaceId: "p3", disposition: "OTHER", role: "DESIGNATED", state: "FORWARDING", bpdu: "SEND" },
    ], explanation: ["Engine STP blocks p2."],
  };
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript({ truth: "FALSE", blockingPoint: "router", stpDecisions: [blockedStp] }));
  assert.equal(result.ok, true);
  assert.ok(result.model.events.some((event) => event.kind === "stp.decision" && event.truth === "FALSE"));
  assert.equal(result.model.events.at(-1).kind, "flow.dropped");
  assert.equal(result.model.events.some((event) => event.kind === "flow.segment" && event.connectionId === "router-server"), false);
}

{
  const dnatDecision = {
    resourceId: "router", destinationId: "server", kind: "DNAT", truth: "TRUE", policyMode: "required", transformation: "TRANSLATED",
    selectedRuleId: "web-forward", inputSource: "10.0.0.10", outputSource: "10.0.0.10", inputPort: 8443, outputPort: 443,
    rules: [
      { index: 0, ruleId: "web-forward", declaredType: "dnat", disposition: "MATCH", selected: true, source: "client", destination: "server", protocol: "tcp", externalPort: 8443, translatedPort: 443, action: "translate", sourceMatch: "TRUE", destinationMatch: true, protocolMatch: true, portMatch: true },
      { index: 1, ruleId: "egress-snat", declaredType: "snat", disposition: "NOT_EVALUATED", selected: false, source: "client", destination: "server", protocol: "tcp", port: 443, translatedSource: "198.51.100.44", action: "translate" },
    ], explanation: ["Engine translated TCP/8443 to server:443."],
  };
  const snatDecision = {
    resourceId: "router", destinationId: "server", kind: "SNAT", truth: "TRUE", policyMode: "required", transformation: "TRANSLATED",
    selectedRuleId: "egress-snat", inputSource: "10.0.0.10", outputSource: "198.51.100.44", inputPort: 443, outputPort: 443,
    rules: [
      { index: 0, ruleId: "web-forward", declaredType: "dnat", disposition: "OTHER_KIND", selected: false, source: "client", destination: "server", protocol: "tcp", externalPort: 8443, translatedPort: 443, action: "translate" },
      { index: 1, ruleId: "egress-snat", declaredType: "snat", disposition: "MATCH", selected: true, source: "client", destination: "server", protocol: "tcp", port: 443, translatedSource: "198.51.100.44", action: "translate", sourceMatch: "TRUE", destinationMatch: true, protocolMatch: true, portMatch: true },
    ], explanation: ["Engine translated source 10.0.0.10 to 198.51.100.44."],
  };
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript({ port: 8443, natDecisions: [dnatDecision, snatDecision] }));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.model.events.map((event) => event.kind), ["flow.started", "flow.segment", "nat.transform", "nat.transform", "flow.segment", "flow.arrived"]);
  const natEvents = result.model.events.filter((event) => event.kind === "nat.transform");
  assert.deepEqual(natEvents.map((event) => event.natDecision.kind), ["DNAT", "SNAT"]);
  assert.equal(natEvents[0].natDecision.inputPort, 8443);
  assert.equal(natEvents[0].natDecision.outputPort, 443);
  assert.equal(natEvents[1].natDecision.inputSource, "10.0.0.10");
  assert.equal(natEvents[1].natDecision.outputSource, "198.51.100.44");
  assert.deepEqual(result.model.natDecisions, [dnatDecision, snatDecision]);
}

{
  const blockedNat = {
    resourceId: "router", destinationId: "server", kind: "DNAT", truth: "FALSE", policyMode: "required", transformation: "BLOCKED",
    selectedRuleId: "block-web", inputSource: "10.0.0.10", outputSource: "10.0.0.10", inputPort: 443, outputPort: 443,
    rules: [{ index: 0, ruleId: "block-web", declaredType: "dnat", disposition: "MATCH", selected: true, source: "client", destination: "server", protocol: "tcp", externalPort: 443, action: "block", sourceMatch: "TRUE", destinationMatch: true, protocolMatch: true, portMatch: true }],
    explanation: ["Engine DNAT layer explicitly blocks the flow."],
  };
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript({ truth: "FALSE", blockingPoint: "router", natDecisions: [blockedNat] }));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.model.events.map((event) => event.kind), ["flow.started", "flow.segment", "nat.transform", "flow.dropped"]);
  assert.equal(result.model.events.find((event) => event.kind === "nat.transform").truth, "FALSE");
  assert.equal(result.model.events.some((event) => event.kind === "flow.segment" && event.connectionId === "router-server"), false);
}

{
  const firewallScenario = {
    ...scenario,
    resources: scenario.resources.map((resource) => resource.id === "router" ? { ...resource, type: "network.firewall" } : resource),
  };
  const policyDecision = {
    resourceId: "router", destinationId: "server", kind: "FIREWALL", firewallScope: "NETWORK", truth: "TRUE",
    rules: [
      { index: 0, ruleId: "deny-ssh", disposition: "NO_MATCH", selected: false, protocol: "tcp", port: 22, action: "deny", sourceMatch: "TRUE", destinationMatch: true, protocolMatch: true, portMatch: false },
      { index: 1, ruleId: "allow-web", disposition: "MATCH", selected: true, protocol: "tcp", port: 443, action: "allow", sourceMatch: "TRUE", destinationMatch: true, protocolMatch: true, portMatch: true },
      { index: 2, ruleId: "late-deny", disposition: "NOT_EVALUATED", selected: false, action: "deny" },
    ],
    selectedPolicyId: "allow-web", defaultAction: "deny", usedDefault: false, explanation: ["Engine selected allow-web."],
  };
  const result = buildVisualJourneyFromActiveProbe(firewallScenario, transcript({ policyDecisions: [policyDecision] }));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.model.events.map((event) => event.kind), ["flow.started", "flow.segment", "policy.decision", "flow.segment", "flow.arrived"]);
  const event = result.model.events.find((item) => item.kind === "policy.decision");
  assert.equal(event.policyDecision.selectedPolicyId, "allow-web");
  assert.equal(event.policyDecision.rules[2].disposition, "NOT_EVALUATED");
  assert.equal(event.truth, "TRUE");
  assert.deepEqual(result.model.policyDecisions, [policyDecision]);
}

{
  const firewallScenario = {
    ...scenario,
    resources: scenario.resources.map((resource) => resource.id === "router" ? { ...resource, type: "network.firewall" } : resource),
  };
  const blockedPolicy = {
    resourceId: "router", destinationId: "server", kind: "FIREWALL", firewallScope: "NETWORK", truth: "FALSE",
    rules: [{ index: 0, ruleId: "deny-web", disposition: "MATCH", selected: true, protocol: "tcp", port: 443, action: "deny", sourceMatch: "TRUE", destinationMatch: true, protocolMatch: true, portMatch: true }],
    selectedPolicyId: "deny-web", defaultAction: "allow", usedDefault: false, explanation: ["Engine selected deny-web."],
  };
  const result = buildVisualJourneyFromActiveProbe(firewallScenario, transcript({ truth: "FALSE", blockingPoint: "router", policyDecisions: [blockedPolicy] }));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.model.events.map((event) => event.kind), ["flow.started", "flow.segment", "policy.decision", "flow.dropped"]);
  assert.equal(result.model.events.find((event) => event.kind === "policy.decision").truth, "FALSE");
  assert.equal(result.model.events.some((event) => event.kind === "flow.segment" && event.connectionId === "router-server"), false);
}


{
  const firewallScenario = {
    ...scenario,
    resources: scenario.resources.map((resource) => resource.id === "router" ? { ...resource, type: "network.firewall" } : resource),
  };
  const conntrackDecision = {
    resourceId: "router", destinationId: "server", truth: "TRUE", complete: true,
    entries: [
      { index: 0, entryId: "ct-web", disposition: "MATCH", selected: true, source: "198.51.100.10", destination: "server", protocol: "tcp", port: 443, state: "ESTABLISHED", sourceMatch: "TRUE", destinationMatch: true, protocolMatch: true, portMatch: true },
    ],
    selectedEntryId: "ct-web", connectionState: "ESTABLISHED", observedSource: "198.51.100.10", observedPort: 443,
    explanation: ["Engine matched ct-web."],
  };
  const policyDecision = {
    resourceId: "router", destinationId: "server", kind: "FIREWALL", firewallScope: "NETWORK", truth: "TRUE",
    rules: [
      { index: 0, ruleId: "allow-established-web", disposition: "MATCH", selected: true, protocol: "tcp", port: 443, action: "allow", connectionState: "ESTABLISHED", connectionStateMatch: "TRUE", sourceMatch: "TRUE", destinationMatch: true, protocolMatch: true, portMatch: true },
    ],
    selectedPolicyId: "allow-established-web", defaultAction: "deny", usedDefault: false, explanation: ["Engine selected stateful allow."],
  };
  const result = buildVisualJourneyFromActiveProbe(firewallScenario, transcript({ conntrackDecisions: [conntrackDecision], policyDecisions: [policyDecision] }));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.model.events.map((event) => event.kind), ["flow.started", "flow.segment", "conntrack.lookup", "policy.decision", "flow.segment", "flow.arrived"]);
  const conntrackEvent = result.model.events.find((event) => event.kind === "conntrack.lookup");
  assert.equal(conntrackEvent.conntrackDecision.selectedEntryId, "ct-web");
  assert.equal(conntrackEvent.conntrackDecision.connectionState, "ESTABLISHED");
  assert.equal(conntrackEvent.truth, "TRUE");
  assert.deepEqual(result.model.conntrackDecisions, [conntrackDecision]);
}


{
  const localFirewallScenario = {
    ...scenario,
    resources: scenario.resources.map((resource) => resource.id === "server"
      ? { ...resource, properties: { ...resource.properties, isFirewall: true } }
      : resource),
  };
  const localPolicyDecision = {
    resourceId: "server", destinationId: "server", kind: "FIREWALL", firewallScope: "LOCAL_HOST", truth: "TRUE",
    rules: [
      { index: 0, ruleId: "local-allow-web", disposition: "MATCH", selected: true, protocol: "tcp", port: 443, action: "allow", sourceMatch: "TRUE", destinationMatch: true, protocolMatch: true, portMatch: true },
    ],
    selectedPolicyId: "local-allow-web", defaultAction: "deny", usedDefault: false, explanation: ["Engine selected the local host firewall allow rule."],
  };
  const result = buildVisualJourneyFromActiveProbe(localFirewallScenario, transcript({ policyDecisions: [localPolicyDecision] }));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const event = result.model.events.find((item) => item.kind === "policy.decision" && item.resourceId === "server");
  assert.equal(event?.policyDecision.firewallScope, "LOCAL_HOST");
  assert.equal(event?.policyDecision.selectedPolicyId, "local-allow-web");
  assert.equal(event?.summary.includes("LOCAL_HOST"), true);
  assert.deepEqual(result.model.policyDecisions, [localPolicyDecision]);
}


{
  const hostStackDecision = {
    resourceId: "server", truth: "TRUE", model: "EXPLICIT_HOST_STACK", complete: true,
    processes: [{ processId: "proc-web", name: "httpd.exe", pid: 4242, service: "https" }],
    sockets: [{ socketId: "sock-web", protocol: "tcp", localAddress: "0.0.0.0", localPort: 443, bindScope: "WILDCARD", state: "LISTEN", processId: "proc-web", service: "https" }],
    services: [{ index: 0, name: "https", enabled: true, port: 443, protocol: "tcp", owningProcessIds: ["proc-web"], socketIds: ["sock-web"] }],
    selectedServiceNames: ["https"], selectedSocketIds: ["sock-web"], listenerConsistency: "CONSISTENT", explanation: ["Explicit modeled host stack."],
  };
  const listenerServiceDecision = {
    resourceId: "server", truth: "TRUE", protocol: "tcp", port: 443, model: "EXPLICIT_HOST_STACK", complete: true,
    listenerState: "LISTENING", serviceState: "ENABLED", disposition: "LISTENING", selectedServiceNames: ["https"], selectedSocketIds: ["sock-web"], listenerConsistency: "CONSISTENT", explanation: ["Explicit LISTEN socket proves listener truth."],
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
  const result = buildVisualJourneyFromActiveProbe(scenario, transcript({ hostStackDecision, listenerServiceDecision, tcpStateMachineDecision }));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.model.hostStackDecision.model, "EXPLICIT_HOST_STACK");
  assert.equal(result.model.hostStackDecision.processes[0].pid, 4242);
  assert.equal(result.model.hostStackDecision.sockets[0].bindScope, "WILDCARD");
  assert.deepEqual(result.model.hostStackDecision.selectedSocketIds, ["sock-web"]);
  assert.equal(result.model.hostStackDecision.listenerConsistency, "CONSISTENT");
  assert.equal(result.model.listenerServiceDecision.listenerState, "LISTENING");
  assert.equal(result.model.listenerServiceDecision.serviceState, "ENABLED");
  assert.equal(result.model.listenerServiceDecision.disposition, "LISTENING");
  assert.equal(result.model.tcpStateMachineDecision.disposition, "LISTENING");
  assert.deepEqual(result.model.tcpStateMachineDecision.currentStates, ["LISTEN"]);
  assert.equal(result.model.tcpStateMachineDecision.sequenceAckTimeline, "NOT_MODELED");
}



{
  const dnsScenario = {
    ...scenario,
    resources: [...scenario.resources, { id: "dns1", type: "network.dns_server", label: "DNS", interfaces: [{ id: "d0", kind: "ethernet", addresses: ["10.0.0.53/24"] }], properties: {} }],
  };
  const dnsChainDecision = {
    sourceId: "client", queryName: "app.lab.test", truth: "TRUE", configuredResolversState: "KNOWN", resolverAddresses: ["10.0.0.53"],
    attempts: [{ index: 0, resolverAddress: "10.0.0.53", mappedResourceIds: ["dns1"], selectedResourceId: "dns1", networkTruth: "TRUE", networkPath: ["client", "dns1"], serviceState: "KNOWN", serviceEnabled: true, recordsState: "KNOWN", matchedRecordCount: 1, answerAddress: "10.0.0.80", answerResourceIds: ["server"], disposition: "RESOLVED" }],
    selectedResolverAddress: "10.0.0.53", selectedResolverResourceId: "dns1", resolvedAddress: "10.0.0.80", resolvedResourceIds: ["server"], explanation: ["Modeled resolution."],
  };
  const dnsTranscript = transcript({
    probeId: "windows.resolve_dnsname", command: "Resolve-DnsName app.lab.test", category: "dns", truth: "TRUE",
    destinationId: undefined, destinationLabel: undefined, protocol: undefined, port: undefined, path: undefined,
    queryName: "app.lab.test", resolvedAddress: "10.0.0.80", resolvedResourceIds: ["server"], dnsChainDecision,
  });
  const result = buildVisualJourneyFromActiveProbe(dnsScenario, dnsTranscript);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.model.dnsChainDecision.truth, "TRUE");
  assert.equal(result.model.dnsChainDecision.attempts[0].disposition, "RESOLVED");
  assert.equal(result.model.events.some((event) => event.kind === "dns.resolve"), true);
  assert.equal(result.model.events.find((event) => event.kind === "dns.resolve")?.resourceId, "dns1");
  assert.equal(result.model.events.at(-1)?.summary.includes("not a fabricated packet drop/arrival path"), true);
}



{
  const dhcpScenario = {
    ...scenario,
    resources: [
      ...scenario.resources,
      { id: "sw1", type: "network.switch", label: "Switch", interfaces: [{ id: "p1", addresses: [] }, { id: "p2", addresses: [] }], properties: {} },
      { id: "dhcp1", type: "network.dhcp_server", label: "DHCP", interfaces: [{ id: "d0", addresses: ["10.20.0.2/24"] }], properties: {} },
    ],
    connections: [
      ...scenario.connections,
      { id: "client-sw", kind: "network", from: { resource: "client", port: "c0" }, to: { resource: "sw1", port: "p1" }, properties: {} },
      { id: "sw-dhcp", kind: "network", from: { resource: "sw1", port: "p2" }, to: { resource: "dhcp1", port: "d0" }, properties: {} },
    ],
  };
  const dhcpDoraDecision = {
    clientId: "client", truth: "TRUE", clientState: "KNOWN", clientEnabled: true,
    attempts: [{ index: 0, serverResourceId: "dhcp1", discoverTruth: "TRUE", discoverPath: ["client", "sw1", "dhcp1"], discoverExplanation: [], offerReturnTruth: "TRUE", offerReturnPath: ["dhcp1", "sw1", "client"], offerReturnExplanation: [], serverEnabled: true, availableLeases: 5, matchedOfferCount: 1, offeredAddress: "10.20.0.100", gateway: "10.20.0.1", dnsServers: ["10.20.0.53"], prefixLength: 24, disposition: "OFFERED" }],
    stages: [
      { stage: "DISCOVER", truth: "TRUE", explanation: [] },
      { stage: "OFFER", truth: "TRUE", serverResourceId: "dhcp1", explanation: [] },
      { stage: "REQUEST", truth: "TRUE", serverResourceId: "dhcp1", explanation: [] },
      { stage: "ACK", truth: "TRUE", serverResourceId: "dhcp1", explanation: [] },
    ],
    selectedServerResourceId: "dhcp1", offeredAddress: "10.20.0.100", gateway: "10.20.0.1", dnsServers: ["10.20.0.53"], prefixLength: 24, explanation: [],
  };
  const dhcpTranscript = transcript({
    probeId: "windows.ipconfig_renew", command: "ipconfig /renew", category: "dhcp", truth: "TRUE",
    destinationId: undefined, destinationLabel: undefined, protocol: undefined, port: undefined, path: undefined,
    dhcpDoraDecision,
  });
  const result = buildVisualJourneyFromActiveProbe(dhcpScenario, dhcpTranscript);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.model.dhcpDoraDecision.truth, "TRUE");
  assert.equal(result.model.dhcpDoraDecision.selectedServerResourceId, "dhcp1");
  assert.deepEqual(result.model.dhcpDoraDecision.attempts[0].discoverPath, ["client", "sw1", "dhcp1"]);
  assert.deepEqual(result.model.dhcpDoraDecision.attempts[0].offerReturnPath, ["dhcp1", "sw1", "client"]);
  assert.deepEqual(result.model.events.map((event) => event.kind), ["flow.started", "dhcp.dora"]);
  assert.equal(result.model.events.at(-1)?.resourceId, "dhcp1");
  assert.equal(result.model.events.at(-1)?.summary.includes("not a fabricated routed packet drop/arrival path"), true);
}

await import("./run_udp_icmp_journey_tests.mjs");
await import("./run_udp_icmp_xray_contract.mjs");
console.log("PASS visual journey functional: 44");
