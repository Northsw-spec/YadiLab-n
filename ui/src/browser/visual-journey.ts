import type { NormalizedScenario } from "../../../core-model/src/generated/contracts.js";
import type { ActiveProbeTranscript } from "../../../observation-engine/src/index.js";
import type { TruthValue } from "../../../engine/src/types.js";
import { isRecord, jsonEqual } from "../../../engine/src/json.js";
import { validateUdpIcmpFailureDecision } from "../../../engine/src/udp-icmp-engine.js";
import type { ReachabilityDetails } from "../../../engine/src/types.js";
import type { UdpIcmpFailureDecisionTrace, ConntrackDecisionTrace, DhcpDoraDecisionTrace, DnsChainDecisionTrace, ForwardReturnPathComparisonTrace, HostStackDecisionTrace, ListenerServiceDecisionTrace, TcpStateMachineDecisionTrace, TcpLifecycleState, MacDecisionTrace, NatDecisionTrace, NeighborDecisionTrace, PolicyDecisionTrace, RouteDecisionTrace, StpDecisionTrace, StpPortTrace, VlanDecisionTrace, L2PropagationEvent, L2PropagationResult, MtuEvaluationTrace } from "../../../engine/src/types.js";

export type VisualJourneyRendererMode = "pdu" | "particle" | "pulse";
export type VisualJourneyTerminalKind = "arrived" | "dropped" | "uncertain" | "no_path" | "diagnosed";

export const VISUAL_JOURNEY_OUTCOME_MARKER_MS = 4000;
export type VisualJourneyOutcomeKind = "destination_reached" | "dropped" | "unknown";
export type VisualJourneyOutcomeMarker = "success" | "drop" | "unknown" | "none";
export type VisualJourneyOutcomeAnchorRole = "DESTINATION" | "DROP_POINT" | "LAST_KNOWN";

export interface VisualJourneyOutcome {
  readonly kind: VisualJourneyOutcomeKind;
  readonly marker: VisualJourneyOutcomeMarker;
  readonly markerDurationMs: number;
  readonly truth: TruthValue;
  readonly reason: string;
  readonly exactLocation: boolean;
  readonly destinationId?: string;
  readonly anchorResourceId?: string;
  readonly anchorRole?: VisualJourneyOutcomeAnchorRole;
}

export interface VisualJourneyPlaybackContract {
  readonly schemaVersion: "1.0.0";
  readonly source: "ENGINE_EVENT_PROJECTION";
  readonly ordering: "STRICT_SEQUENCE";
  readonly replay: "DETERMINISTIC";
  readonly eventCount: number;
  readonly firstEventId: string;
  readonly terminalEventId: string;
  readonly outcome: VisualJourneyOutcome;
}
export type VisualJourneyEventKind =
  | "flow.started"
  | "udp.failure"
  | "icmp.failure"
  | "dns.resolve"
  | "dhcp.dora"
  | "route.decision"
  | "neighbor.decision"
  | "mac.learn"
  | "mac.lookup"
  | "mac.forward"
  | "mac.flood"
  | "vlan.classify"
  | "vlan.tag"
  | "vlan.untag"
  | "vlan.forward"
  | "stp.bpdu"
  | "stp.decision"
  | "mtu.evaluation"
  | "l2.propagation"
  | "l2.loop_reentry"
  | "l2.safety_limit"
  | "nat.transform"
  | "conntrack.lookup"
  | "policy.decision"
  | "hoststack.decision"
  | "listener.service"
  | "tcp.state"
  | "flow.segment"
  | "flow.arrived"
  | "flow.dropped"
  | "flow.uncertain"
  | "route.no_path";

export interface VisualJourneyEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly kind: VisualJourneyEventKind;
  readonly flowId: string;
  readonly provenance: "MODELED";
  readonly truth: TruthValue;
  readonly sourceResourceId: string;
  readonly targetResourceId?: string;
  readonly resourceId?: string;
  readonly connectionId?: string;
  readonly projectedConnectionIds?: readonly string[];
  readonly protocol?: "tcp" | "udp" | "icmp" | "any";
  readonly port?: number;
  readonly evidenceRefs: readonly string[];
  readonly summary: string;
  readonly routeDecision?: RouteDecisionTrace;
  readonly neighborDecision?: NeighborDecisionTrace;
  readonly macDecision?: MacDecisionTrace;
  readonly vlanDecision?: VlanDecisionTrace;
  readonly stpDecision?: StpDecisionTrace;
  readonly stpPort?: StpPortTrace;
  readonly natDecision?: NatDecisionTrace;
  readonly conntrackDecision?: ConntrackDecisionTrace;
  readonly policyDecision?: PolicyDecisionTrace;
  readonly hostStackDecision?: HostStackDecisionTrace;
  readonly listenerServiceDecision?: ListenerServiceDecisionTrace;
  readonly tcpStateMachineDecision?: TcpStateMachineDecisionTrace;
  readonly udpIcmpFailureDecision?: UdpIcmpFailureDecisionTrace;
  readonly dnsChainDecision?: DnsChainDecisionTrace;
  readonly dhcpDoraDecision?: DhcpDoraDecisionTrace;
  readonly outcome?: VisualJourneyOutcome;
  readonly l2PropagationEvent?: L2PropagationEvent;
  readonly l2PropagationCounters?: L2PropagationResult["counters"];
  readonly mtuEvaluation?: MtuEvaluationTrace;
}

export function buildL2PropagationVisualEvents(flowId:string, result:L2PropagationResult):readonly VisualJourneyEvent[] {
  return result.events.map((event,index)=>({
    eventId:event.eventId, sequence:index, flowId, kind:event.kind==="LOOP_REENTRY"?"l2.loop_reentry":event.kind==="SIMULATION_LIMIT"?"l2.safety_limit":"l2.propagation",
    provenance:"MODELED", truth:result.truth, sourceResourceId:event.currentResourceId,
    ...(event.connectionId?{connectionId:event.connectionId,projectedConnectionIds:[event.connectionId]}:{}), evidenceRefs:[event.eventId],
    summary:event.forwardingReason, l2PropagationEvent:event, l2PropagationCounters:result.counters,
  }));
}

export function buildMtuVisualJourneyEvent(flowId:string, trace:MtuEvaluationTrace):VisualJourneyEvent {
  return {
    eventId:`${flowId}_mtu_1`, sequence:1, kind:"mtu.evaluation", flowId, provenance:"MODELED", truth:trace.truth,
    sourceResourceId:trace.resourceId, ...(trace.connectionId?{connectionId:trace.connectionId,projectedConnectionIds:[trace.connectionId]}:{}),
    evidenceRefs:[trace.provenance, trace.resourceId, trace.egressInterface], summary:trace.explanation.join(" "), mtuEvaluation:trace,
  };
}

export interface VisualJourneyPathSegment {
  readonly connectionId: string;
  readonly from: string;
  readonly to: string;
}

export interface VisualJourneyPathComparison {
  readonly trace: ForwardReturnPathComparisonTrace;
  readonly forwardSegments: readonly VisualJourneyPathSegment[];
  readonly returnSegments: readonly VisualJourneyPathSegment[];
}

export interface VisualJourneyModel {
  readonly flowId: string;
  readonly scenarioId: string;
  readonly scenarioHash: string;
  readonly stateRevision: number;
  readonly sourceId: string;
  readonly destinationId?: string;
  readonly protocol?: "tcp" | "udp" | "icmp" | "any";
  readonly port?: number;
  readonly truth: TruthValue;
  readonly path: readonly string[];
  readonly reachedPath: readonly string[];
  readonly blockingPoint?: string;
  readonly terminalKind: VisualJourneyTerminalKind;
  readonly outcome: VisualJourneyOutcome;
  readonly playback: VisualJourneyPlaybackContract;
  readonly evidenceRefs: readonly string[];
  readonly routeDecisions: readonly RouteDecisionTrace[];
  readonly neighborDecisions: readonly NeighborDecisionTrace[];
  readonly macDecisions: readonly MacDecisionTrace[];
  readonly vlanDecisions: readonly VlanDecisionTrace[];
  readonly stpDecisions: readonly StpDecisionTrace[];
  readonly natDecisions: readonly NatDecisionTrace[];
  readonly conntrackDecisions: readonly ConntrackDecisionTrace[];
  readonly policyDecisions: readonly PolicyDecisionTrace[];
  readonly pathComparison?: VisualJourneyPathComparison;
  readonly hostStackDecision?: HostStackDecisionTrace;
  readonly listenerServiceDecision?: ListenerServiceDecisionTrace;
  readonly tcpStateMachineDecision?: TcpStateMachineDecisionTrace;
  readonly udpIcmpFailureDecision?: UdpIcmpFailureDecisionTrace;
  readonly dnsChainDecision?: DnsChainDecisionTrace;
  readonly dhcpDoraDecision?: DhcpDoraDecisionTrace;
  readonly events: readonly VisualJourneyEvent[];
}

export interface VisualJourneyDiagnostic {
  readonly severity: "warning" | "error";
  readonly code: string;
  readonly message: string;
}

export interface VisualJourneyBuildResult {
  readonly ok: boolean;
  readonly model?: VisualJourneyModel;
  readonly diagnostics: readonly VisualJourneyDiagnostic[];
}

export interface VisualJourneyFrame {
  readonly cursor: number;
  readonly event: VisualJourneyEvent;
  readonly completedConnectionIds: readonly string[];
  readonly activeConnectionId?: string;
  readonly activeConnectionIds: readonly string[];
  readonly activeDirection?: { readonly from: string; readonly to: string };
  readonly currentResourceId: string;
  readonly terminalState?: VisualJourneyTerminalKind;
  readonly outcome?: VisualJourneyOutcome;
}

export type VisualJourneyXRayDecisionKind =
  | "FLOW"
  | "ROUTING"
  | "ARP_ND"
  | "MAC_CAM"
  | "VLAN"
  | "STP_BPDU"
  | "NAT_PAT"
  | "CONNTRACK"
  | "FIREWALL_ACL"
  | "HOST_STACK"
  | "LISTENER_SERVICE"
  | "TCP_STATE"
  | "UDP_ICMP"
  | "DNS"
  | "DHCP"
  | "MTU";

export interface VisualJourneyXRayFrame {
  readonly schemaVersion: "1.0.0";
  readonly source: "ENGINE_EVENT_PROJECTION";
  readonly cursor: number;
  readonly eventCount: number;
  readonly eventId: string;
  readonly sequence: number;
  readonly eventKind: VisualJourneyEventKind;
  readonly decisionKind: VisualJourneyXRayDecisionKind;
  readonly flowId: string;
  readonly provenance: "MODELED";
  readonly truth: TruthValue;
  readonly sourceResourceId: string;
  readonly currentResourceId: string;
  readonly targetResourceId?: string;
  readonly connectionId?: string;
  readonly projectedConnectionIds: readonly string[];
  readonly protocol?: "tcp" | "udp" | "icmp" | "any";
  readonly port?: number;
  readonly evidenceRefs: readonly string[];
  readonly summary: string;
  readonly outcome?: VisualJourneyOutcome;
}

function enabledConnection(connection: NormalizedScenario["connections"][number]): boolean {
  return connection.properties.enabled !== false;
}

function connectionForHop(
  scenario: NormalizedScenario,
  from: string,
  to: string,
): NormalizedScenario["connections"][number] | undefined {
  const candidates = scenario.connections.filter((connection) => {
    if ((connection.kind !== "network" && connection.kind !== "management") || !enabledConnection(connection)) return false;
    if (connection.from.resource === from && connection.to.resource === to) return true;
    return connection.properties.direction !== "forward" && connection.from.resource === to && connection.to.resource === from;
  });
  return [...candidates].sort((a, b) => a.id.localeCompare(b.id, "en"))[0];
}

function stablePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function connectionForResourceInterface(
  scenario: NormalizedScenario,
  resourceId: string,
  interfaceId: string,
): NormalizedScenario["connections"][number] | undefined {
  const candidates = scenario.connections.filter((connection) => {
    if ((connection.kind !== "network" && connection.kind !== "management") || !enabledConnection(connection)) return false;
    if (connection.from.resource === resourceId) return connection.from.port === interfaceId;
    if (connection.to.resource === resourceId && connection.properties.direction !== "forward") return connection.to.port === interfaceId;
    return false;
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

function projectedMacConnections(
  scenario: NormalizedScenario,
  decision: MacDecisionTrace,
): { readonly connectionIds?: readonly string[]; readonly diagnostic?: VisualJourneyDiagnostic } {
  const interfaces = decision.forwarding === "UNICAST"
    ? (decision.selectedEgressInterface ? [decision.selectedEgressInterface] : [])
    : decision.forwarding === "FLOOD" || decision.forwarding === "BROADCAST"
      ? [...(decision.floodInterfaces ?? [])]
      : [];
  if (interfaces.length === 0) return { connectionIds: [] };
  const connectionIds: string[] = [];
  for (const interfaceId of interfaces) {
    const connection = connectionForResourceInterface(scenario, decision.resourceId, interfaceId);
    if (!connection) {
      return { diagnostic: { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_INTERFACE_UNMAPPED", message: `Engine MAC trace interface '${decision.resourceId}.${interfaceId}' does not map to exactly one eligible modeled connection.` } };
    }
    connectionIds.push(connection.id);
  }
  if (new Set(connectionIds).size !== connectionIds.length) {
    return { diagnostic: { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_CONNECTION_DUPLICATE", message: "Engine MAC trace projects multiple forwarding interfaces onto the same connection." } };
  }
  return { connectionIds };
}

function projectedVlanConnection(
  scenario: NormalizedScenario,
  decision: VlanDecisionTrace,
): { readonly connectionIds?: readonly string[]; readonly diagnostic?: VisualJourneyDiagnostic } {
  if (!decision.egressInterface || decision.truth !== "TRUE") return { connectionIds: [] };
  const connection = connectionForResourceInterface(scenario, decision.resourceId, decision.egressInterface);
  if (!connection) {
    return { diagnostic: { severity: "error", code: "VISUAL_JOURNEY_VLAN_TRACE_INTERFACE_UNMAPPED", message: `Engine VLAN trace egress '${decision.resourceId}.${decision.egressInterface}' does not map to exactly one eligible modeled connection.` } };
  }
  return { connectionIds: [connection.id] };
}

function projectedStpConnection(
  scenario: NormalizedScenario,
  decision: StpDecisionTrace,
  interfaceId: string | undefined = decision.egressInterface,
): { readonly connectionIds?: readonly string[]; readonly diagnostic?: VisualJourneyDiagnostic } {
  if (!interfaceId) return { connectionIds: [] };
  const connections = scenario.connections.filter((connection) => {
    if ((connection.kind !== "network" && connection.kind !== "management") || !enabledConnection(connection)) return false;
    return (connection.from.resource === decision.resourceId && connection.from.port === interfaceId)
      || (connection.to.resource === decision.resourceId && connection.to.port === interfaceId);
  });
  if (connections.length !== 1) {
    return { diagnostic: { severity: "error", code: "VISUAL_JOURNEY_STP_TRACE_INTERFACE_UNMAPPED", message: `Engine STP trace interface '${decision.resourceId}.${interfaceId}' does not map to exactly one eligible modeled connection.` } };
  }
  return { connectionIds: [connections[0]!.id] };
}

function evidenceRefs(transcript: ActiveProbeTranscript): readonly string[] {
  return transcript.evidence.map((item, index) => `${item.kind}:${stablePart(item.subject)}:${index + 1}`);
}

function reachedPath(path: readonly string[], blockingPoint: string | undefined): readonly string[] {
  if (!blockingPoint) return path;
  const index = path.indexOf(blockingPoint);
  return index >= 0 ? path.slice(0, index + 1) : path;
}

function pathReachedDestination(transcript: ActiveProbeTranscript, reached: readonly string[]): boolean {
  return Boolean(transcript.destinationId && reached.length > 0 && reached[reached.length - 1] === transcript.destinationId);
}

function packetReachedDestinationDespiteServiceFailure(transcript: ActiveProbeTranscript, reached: readonly string[]): boolean {
  if (!pathReachedDestination(transcript, reached)) return false;
  const disposition = transcript.listenerServiceDecision?.disposition;
  if (disposition === "NO_LISTENER" || disposition === "SERVICE_DISABLED" || disposition === "DECLARATION_ABSENT") return true;
  return transcript.tcpStateMachineDecision?.disposition === "CONNECTION_REFUSED";
}

function visualJourneyOutcome(transcript: ActiveProbeTranscript, reached: readonly string[]): VisualJourneyOutcome {
  const destinationId = transcript.destinationId;
  const lastReached = reached[reached.length - 1];
  const markerDurationMs = VISUAL_JOURNEY_OUTCOME_MARKER_MS;
  const udpIcmp = transcript.udpIcmpFailureDecision;

  if (udpIcmp) {
    if (["DATAGRAM_DELIVERABLE", "REQUEST_PATH_REACHABLE", "NO_LISTENER", "SERVICE_DISABLED"].includes(udpIcmp.disposition)) {
      if (destinationId && lastReached === destinationId) {
        return {
          kind: "destination_reached", marker: "success", markerDurationMs, truth: "TRUE", exactLocation: true,
          destinationId, anchorResourceId: destinationId, anchorRole: "DESTINATION",
          reason: udpIcmp.disposition === "NO_LISTENER"
            ? `Packet reached ${destinationId}; the Engine then classified the UDP listener as absent.`
            : udpIcmp.disposition === "SERVICE_DISABLED"
              ? `Packet reached ${destinationId}; the Engine then classified the declared service as disabled.`
              : `Engine evidence proves the modeled request path reached ${destinationId}.`,
        };
      }
      return {
        kind: "unknown", marker: lastReached ? "unknown" : "none", markerDurationMs, truth: "UNKNOWN", exactLocation: false,
        ...(destinationId ? { destinationId } : {}),
        ...(lastReached ? { anchorResourceId: lastReached, anchorRole: "LAST_KNOWN" as const } : {}),
        reason: "Engine classification indicates destination-side processing, but the modeled path does not prove arrival at the requested destination.",
      };
    }
    if (udpIcmp.disposition === "NETWORK_BLOCKED" || udpIcmp.disposition === "POLICY_BLOCKED") {
      return {
        kind: "dropped", marker: transcript.blockingPoint ? "drop" : "none", markerDurationMs, truth: "FALSE", exactLocation: Boolean(transcript.blockingPoint),
        ...(destinationId ? { destinationId } : {}),
        ...(transcript.blockingPoint ? { anchorResourceId: transcript.blockingPoint, anchorRole: "DROP_POINT" as const } : {}),
        reason: transcript.blockingPoint
          ? `Engine evidence proves the packet was blocked at ${transcript.blockingPoint}.`
          : "Engine evidence proves the request was blocked, but no exact drop resource is modeled.",
      };
    }
    return {
      kind: "unknown", marker: lastReached ? "unknown" : "none", markerDurationMs, truth: "UNKNOWN", exactLocation: false,
      ...(destinationId ? { destinationId } : {}),
      ...(lastReached ? { anchorResourceId: lastReached, anchorRole: "LAST_KNOWN" as const } : {}),
      reason: "UDP/ICMP outcome is incomplete or UNKNOWN; no success or drop is fabricated.",
    };
  }

  if (transcript.category === "dns" || transcript.category === "dhcp") {
    return {
      kind: "unknown", marker: "none", markerDurationMs, truth: "UNKNOWN", exactLocation: false,
      ...(destinationId ? { destinationId } : {}),
      reason: `${transcript.category.toUpperCase()} terminal truth is not converted into a packet-arrival/drop marker.`,
    };
  }

  if (transcript.truth === "TRUE" && pathReachedDestination(transcript, reached)) {
    return {
      kind: "destination_reached", marker: "success", markerDurationMs, truth: "TRUE", exactLocation: true,
      ...(destinationId ? { destinationId, anchorResourceId: destinationId, anchorRole: "DESTINATION" as const } : {}),
      reason: `Engine evidence proves the modeled path reached ${destinationId}.`,
    };
  }

  if (transcript.truth === "FALSE" && packetReachedDestinationDespiteServiceFailure(transcript, reached)) {
    return {
      kind: "destination_reached", marker: "success", markerDurationMs, truth: "TRUE", exactLocation: true,
      ...(destinationId ? { destinationId, anchorResourceId: destinationId, anchorRole: "DESTINATION" as const } : {}),
      reason: `The packet reached ${destinationId}; the overall probe failed only after destination-side listener/service evaluation.`,
    };
  }

  if (transcript.truth === "FALSE") {
    return {
      kind: "dropped", marker: transcript.blockingPoint ? "drop" : "none", markerDurationMs, truth: "FALSE", exactLocation: Boolean(transcript.blockingPoint),
      ...(destinationId ? { destinationId } : {}),
      ...(transcript.blockingPoint ? { anchorResourceId: transcript.blockingPoint, anchorRole: "DROP_POINT" as const } : {}),
      reason: transcript.blockingPoint
        ? `Engine evidence proves the modeled journey stopped at ${transcript.blockingPoint}.`
        : "The probe failed, but the Engine does not prove an exact drop resource; no red marker is fabricated.",
    };
  }

  return {
    kind: "unknown", marker: lastReached ? "unknown" : "none", markerDurationMs, truth: "UNKNOWN", exactLocation: false,
    ...(destinationId ? { destinationId } : {}),
    ...(lastReached ? { anchorResourceId: lastReached, anchorRole: "LAST_KNOWN" as const } : {}),
    reason: "Engine truth is UNKNOWN; no success or drop is fabricated.",
  };
}

function terminalKind(transcript: ActiveProbeTranscript, path: readonly string[], outcome: VisualJourneyOutcome): VisualJourneyTerminalKind {
  if (outcome.kind === "destination_reached") return "arrived";
  if (outcome.kind === "unknown") return "uncertain";
  if (!path.length) return "no_path";
  return "dropped";
}

function routeTraceDiagnostic(scenario: NormalizedScenario, path: readonly string[], decisions: readonly RouteDecisionTrace[]): VisualJourneyDiagnostic | undefined {
  const resourceIds = new Set(scenario.resources.map((resource) => resource.id));
  for (const decision of decisions) {
    if (!resourceIds.has(decision.resourceId) || !resourceIds.has(decision.nextHopResourceId)) {
      return { severity: "error", code: "VISUAL_JOURNEY_ROUTE_TRACE_RESOURCE_UNKNOWN", message: "Engine route trace references a resource absent from the scenario." };
    }
    const index = path.findIndex((resourceId, pathIndex) => resourceId === decision.resourceId && path[pathIndex + 1] === decision.nextHopResourceId);
    if (index < 0 || decision.destinationId !== path[path.length - 1]) {
      return { severity: "error", code: "VISUAL_JOURNEY_ROUTE_TRACE_PATH_MISMATCH", message: "Engine route trace does not bind to an adjacent hop and destination in the proven path." };
    }
    const selected = decision.candidates.filter((candidate) => candidate.selected);
    if ((decision.selectedRouteId === undefined && selected.length !== 0)
      || (decision.selectedRouteId !== undefined && (selected.length !== 1 || selected[0]!.routeId !== decision.selectedRouteId))) {
      return { severity: "error", code: "VISUAL_JOURNEY_ROUTE_TRACE_SELECTION_INVALID", message: "Engine route trace has an inconsistent selected-route marker." };
    }
  }
  return undefined;
}

function neighborTraceDiagnostic(scenario: NormalizedScenario, path: readonly string[], decisions: readonly NeighborDecisionTrace[]): VisualJourneyDiagnostic | undefined {
  const resourceIds = new Set(scenario.resources.map((resource) => resource.id));
  const hopKeys = new Set<string>();
  for (const decision of decisions) {
    if (!resourceIds.has(decision.resourceId) || !resourceIds.has(decision.nextHopResourceId)) {
      return { severity: "error", code: "VISUAL_JOURNEY_NEIGHBOR_TRACE_RESOURCE_UNKNOWN", message: "Engine neighbor trace references a resource absent from the scenario." };
    }
    const hopKey = `${decision.resourceId}\0${decision.nextHopResourceId}`;
    if (hopKeys.has(hopKey)) {
      return { severity: "error", code: "VISUAL_JOURNEY_NEIGHBOR_TRACE_DUPLICATE", message: "Engine neighbor trace contains more than one decision for the same path hop." };
    }
    hopKeys.add(hopKey);
    const index = path.findIndex((resourceId, pathIndex) => resourceId === decision.resourceId && path[pathIndex + 1] === decision.nextHopResourceId);
    if (index < 0 || decision.destinationId !== path[path.length - 1]) {
      return { severity: "error", code: "VISUAL_JOURNEY_NEIGHBOR_TRACE_PATH_MISMATCH", message: "Engine neighbor trace does not bind to an adjacent hop and destination in the proven path." };
    }
    const candidateKeys = new Set<string>();
    for (const candidate of decision.candidates) {
      const key = `${candidate.index}\0${candidate.entryId}`;
      if (candidateKeys.has(key)) {
        return { severity: "error", code: "VISUAL_JOURNEY_NEIGHBOR_TRACE_CANDIDATE_DUPLICATE", message: "Engine neighbor trace contains duplicate candidate identity." };
      }
      candidateKeys.add(key);
    }
    const selected = decision.candidates.filter((candidate) => candidate.selected);
    if (decision.selectedEntryId === undefined) {
      if (selected.length !== 0
        || decision.selectedProtocol !== undefined
        || decision.selectedAddress !== undefined
        || decision.selectedMac !== undefined
        || decision.outgoingInterface !== undefined
        || decision.selectedState !== undefined
        || decision.truth !== "UNKNOWN") {
        return { severity: "error", code: "VISUAL_JOURNEY_NEIGHBOR_TRACE_SELECTION_INVALID", message: "Engine neighbor trace has selected values without one authoritative selected entry." };
      }
      continue;
    }
    if (selected.length !== 1 || selected[0]!.entryId !== decision.selectedEntryId || selected[0]!.disposition !== "MATCH") {
      return { severity: "error", code: "VISUAL_JOURNEY_NEIGHBOR_TRACE_SELECTION_INVALID", message: "Engine neighbor trace has an inconsistent selected-entry marker." };
    }
    const selectedCandidate = selected[0]!;
    if (decision.selectedProtocol !== selectedCandidate.protocol
      || decision.selectedAddress !== selectedCandidate.address
      || decision.selectedMac !== selectedCandidate.mac
      || decision.outgoingInterface !== selectedCandidate.interfaceId
      || decision.selectedState !== selectedCandidate.state) {
      return { severity: "error", code: "VISUAL_JOURNEY_NEIGHBOR_TRACE_PROJECTION_MISMATCH", message: "Engine neighbor trace selected fields differ from the selected table row." };
    }
    const expectedTruth = selectedCandidate.state === "REACHABLE" || selectedCandidate.state === "STALE"
      ? "TRUE"
      : selectedCandidate.state === "FAILED"
        ? "FALSE"
        : selectedCandidate.state === "INCOMPLETE" || selectedCandidate.state === "UNKNOWN"
          ? "UNKNOWN"
          : undefined;
    if (expectedTruth === undefined || decision.truth !== expectedTruth) {
      return { severity: "error", code: "VISUAL_JOURNEY_NEIGHBOR_TRACE_TRUTH_MISMATCH", message: "Engine neighbor trace truth is inconsistent with its selected modeled state." };
    }
  }
  return undefined;
}


function macTraceDiagnostic(scenario: NormalizedScenario, path: readonly string[], decisions: readonly MacDecisionTrace[]): VisualJourneyDiagnostic | undefined {
  const resourceIds = new Set(scenario.resources.map((resource) => resource.id));
  const decisionKeys = new Set<string>();
  for (const decision of decisions) {
    if (!resourceIds.has(decision.sourceResourceId) || !resourceIds.has(decision.resourceId) || !resourceIds.has(decision.nextHopResourceId)) {
      return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_RESOURCE_UNKNOWN", message: "Engine MAC trace references a resource absent from the scenario." };
    }
    const key = `${decision.sourceResourceId}\0${decision.resourceId}\0${decision.nextHopResourceId}`;
    if (decisionKeys.has(key)) {
      return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_DUPLICATE", message: "Engine MAC trace contains duplicate switching decisions for the same path triple." };
    }
    decisionKeys.add(key);
    const index = path.findIndex((resourceId, pathIndex) => resourceId === decision.resourceId
      && path[pathIndex - 1] === decision.sourceResourceId
      && path[pathIndex + 1] === decision.nextHopResourceId);
    if (index <= 0 || decision.destinationId !== path[path.length - 1]) {
      return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_PATH_MISMATCH", message: "Engine MAC trace does not bind to an adjacent ingress/switch/egress path triple and destination." };
    }
    const resource = scenario.resources.find((candidate) => candidate.id === decision.resourceId)!;
    const interfaceIds = new Set(resource.interfaces.map((iface) => iface.id));
    for (const interfaceId of [decision.ingressInterface, decision.expectedEgressInterface, decision.selectedEgressInterface, ...(decision.floodInterfaces ?? [])]) {
      if (interfaceId !== undefined && !interfaceIds.has(interfaceId)) {
        return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_INTERFACE_UNKNOWN", message: `Engine MAC trace references undeclared interface '${decision.resourceId}.${interfaceId}'.` };
      }
    }
    const candidateIndices = new Set<number>();
    const candidateEntryIds = new Set<string>();
    for (const candidate of decision.candidates) {
      if (candidateIndices.has(candidate.index) || candidateEntryIds.has(candidate.entryId)) {
        return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_CANDIDATE_DUPLICATE", message: "Engine MAC trace contains duplicate candidate index or entry identity." };
      }
      candidateIndices.add(candidate.index);
      candidateEntryIds.add(candidate.entryId);
      if (candidate.interfaceId !== undefined && !interfaceIds.has(candidate.interfaceId)) {
        return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_INTERFACE_UNKNOWN", message: `Engine MAC trace candidate '${candidate.entryId}' references undeclared interface '${decision.resourceId}.${candidate.interfaceId}'.` };
      }
    }
    const normalizedSourceMac = decision.sourceMac?.toLowerCase();
    const normalizedDestinationMac = decision.destinationMac?.toLowerCase();
    const macSyntax = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/;
    if ((normalizedSourceMac !== undefined && !macSyntax.test(normalizedSourceMac))
      || (normalizedDestinationMac !== undefined && !macSyntax.test(normalizedDestinationMac))) {
      return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_MAC_INVALID", message: "Engine MAC trace contains a syntactically invalid source or destination MAC." };
    }
    for (const candidate of decision.candidates) {
      if (candidate.disposition === "MALFORMED") {
        if (candidate.selected) return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_SELECTION_INVALID", message: "Malformed MAC-table candidate cannot be selected." };
        continue;
      }
      const candidateMac = candidate.mac?.toLowerCase();
      if (!candidateMac || !macSyntax.test(candidateMac) || !candidate.interfaceId) {
        return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_CANDIDATE_INVALID", message: "Non-malformed Engine MAC candidate lacks a valid MAC/interface projection." };
      }
      const sourceMatch = normalizedSourceMac !== undefined && candidateMac === normalizedSourceMac;
      const destinationMatch = normalizedDestinationMac !== undefined && candidateMac === normalizedDestinationMac;
      const expectedDisposition = sourceMatch && destinationMatch
        ? "BOTH_MATCH"
        : sourceMatch
          ? "SOURCE_MATCH"
          : destinationMatch
            ? "DESTINATION_MATCH"
            : "NO_MATCH";
      if (candidate.disposition !== expectedDisposition) {
        return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_CANDIDATE_ROLE_INVALID", message: "Engine MAC candidate disposition disagrees with the trace source/destination MAC identity." };
      }
      const sameVlanScope = decision.vlan === undefined ? candidate.vlan === undefined : candidate.vlan === decision.vlan;
      if ((candidate.disposition === "SOURCE_MATCH" || candidate.disposition === "DESTINATION_MATCH" || candidate.disposition === "BOTH_MATCH") && !sameVlanScope) {
        return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_VLAN_SCOPE_INVALID", message: "Engine MAC matching candidate is outside the trace VLAN scope." };
      }
    }
    const sourceCandidates = decision.candidates.filter((candidate) => candidate.disposition === "SOURCE_MATCH" || candidate.disposition === "BOTH_MATCH");
    if (decision.learning === "LEARNED" && (sourceCandidates.length !== 0 || !decision.sourceMac || !decision.ingressInterface)) {
      return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_LEARNING_INVALID", message: "Engine MAC trace LEARNED disposition is inconsistent with its source candidates or ingress binding." };
    }
    if (decision.learning === "REFRESHED" && (sourceCandidates.length !== 1 || sourceCandidates[0]!.interfaceId !== decision.ingressInterface)) {
      return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_LEARNING_INVALID", message: "Engine MAC trace REFRESHED disposition does not bind the source entry to the ingress interface." };
    }
    if (decision.learning === "MOVED" && (sourceCandidates.length !== 1 || sourceCandidates[0]!.interfaceId === decision.ingressInterface || !decision.ingressInterface)) {
      return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_LEARNING_INVALID", message: "Engine MAC trace MOVED disposition does not represent one source entry on a different modeled interface." };
    }
    const selected = decision.candidates.filter((candidate) => candidate.selected);
    if ((decision.selectedEntryId === undefined && selected.length !== 0)
      || (decision.selectedEntryId !== undefined && (selected.length !== 1 || selected[0]!.entryId !== decision.selectedEntryId))) {
      return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_SELECTION_INVALID", message: "Engine MAC trace has an inconsistent selected FDB-row marker." };
    }
    const selectedCandidate = selected[0];
    if (selectedCandidate && decision.selectedEgressInterface !== selectedCandidate.interfaceId) {
      return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_PROJECTION_MISMATCH", message: "Engine MAC trace selected egress differs from the selected FDB row." };
    }
    const floodSet = decision.floodInterfaces ?? [];
    if (new Set(floodSet).size !== floodSet.length) {
      return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_FLOOD_DUPLICATE", message: "Engine MAC trace flood set contains duplicate interfaces." };
    }
    if (decision.forwarding === "UNICAST") {
      if (!selectedCandidate || !decision.selectedEgressInterface || !decision.expectedEgressInterface
        || (selectedCandidate.disposition !== "DESTINATION_MATCH" && selectedCandidate.disposition !== "BOTH_MATCH")) {
        return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_UNICAST_INCOMPLETE", message: "Engine MAC unicast trace is missing a destination-matching selected row or selected/expected egress binding." };
      }
      const expectedTruth = decision.selectedEgressInterface === decision.expectedEgressInterface ? "TRUE" : "FALSE";
      if (decision.truth !== expectedTruth) {
        return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_TRUTH_MISMATCH", message: "Engine MAC unicast truth disagrees with the selected modeled egress." };
      }
    } else if (decision.forwarding === "FILTERED") {
      if (!selectedCandidate || !decision.ingressInterface || decision.selectedEgressInterface !== decision.ingressInterface || decision.truth !== "FALSE"
        || (selectedCandidate.disposition !== "DESTINATION_MATCH" && selectedCandidate.disposition !== "BOTH_MATCH")) {
        return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_FILTER_INVALID", message: "Engine MAC filtered trace is inconsistent with ingress-port filtering." };
      }
    } else if (decision.forwarding === "FLOOD" || decision.forwarding === "BROADCAST") {
      if (selected.length !== 0 || !decision.expectedEgressInterface) {
        return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_FLOOD_INVALID", message: "Engine MAC flood trace contains a selected FDB row or lacks expected egress." };
      }
      const expectedTruth = floodSet.includes(decision.expectedEgressInterface) ? "TRUE" : "FALSE";
      if (decision.truth !== expectedTruth) {
        return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_TRUTH_MISMATCH", message: "Engine MAC flood truth disagrees with the modeled flood set." };
      }
    } else if (decision.forwarding === "UNKNOWN") {
      if (decision.truth !== "UNKNOWN") {
        return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_UNKNOWN_TRUTH", message: "Unknown MAC forwarding must remain UNKNOWN." };
      }
      if (selected.length !== 0 || decision.selectedEntryId !== undefined || decision.selectedEgressInterface !== undefined || floodSet.length !== 0) {
        return { severity: "error", code: "VISUAL_JOURNEY_MAC_TRACE_UNKNOWN_SELECTION", message: "Unknown MAC forwarding cannot expose a selected row, selected egress or authoritative flood set." };
      }
    }
  }
  return undefined;
}

function vlanTraceDiagnostic(scenario: NormalizedScenario, path: readonly string[], decisions: readonly VlanDecisionTrace[]): VisualJourneyDiagnostic | undefined {
  const resources = new Map(scenario.resources.map((resource) => [resource.id, resource]));
  const validVlan = (value: number | undefined): boolean => value !== undefined && Number.isInteger(value) && value >= 1 && value <= 4094;
  for (const decision of decisions) {
    const resource = resources.get(decision.resourceId);
    if (!resource || !resources.has(decision.sourceResourceId) || !resources.has(decision.nextHopResourceId)) {
      return { severity: "error", code: "VISUAL_JOURNEY_VLAN_TRACE_RESOURCE_UNKNOWN", message: "Engine VLAN trace references a resource absent from the scenario." };
    }
    const index = path.findIndex((resourceId, pathIndex) => resourceId === decision.resourceId
      && path[pathIndex - 1] === decision.sourceResourceId
      && path[pathIndex + 1] === decision.nextHopResourceId);
    if (index < 1 || decision.destinationId !== path[path.length - 1]) {
      return { severity: "error", code: "VISUAL_JOURNEY_VLAN_TRACE_PATH_MISMATCH", message: "Engine VLAN trace does not bind to an adjacent switching hop and destination in the proven path." };
    }
    const interfaceIds = new Set(resource.interfaces.map((iface) => iface.id));
    for (const interfaceId of [decision.ingressInterface, decision.egressInterface]) {
      if (interfaceId !== undefined && !interfaceIds.has(interfaceId)) {
        return { severity: "error", code: "VISUAL_JOURNEY_VLAN_TRACE_INTERFACE_UNKNOWN", message: `Engine VLAN trace references undeclared interface '${decision.resourceId}.${interfaceId}'.` };
      }
    }
    const seen = new Set<string>();
    for (const port of decision.ports) {
      if (seen.has(port.interfaceId) || !interfaceIds.has(port.interfaceId)) {
        return { severity: "error", code: "VISUAL_JOURNEY_VLAN_TRACE_PORT_TABLE_INVALID", message: "Engine VLAN trace contains duplicate or undeclared switchport rows." };
      }
      seen.add(port.interfaceId);
      if (port.mode === "ACCESS") {
        if (!validVlan(port.accessVlan) || port.allowedVlans !== undefined || port.nativeVlan !== undefined || (port.egressTag !== undefined && port.egressTag !== "UNTAGGED")) {
          return { severity: "error", code: "VISUAL_JOURNEY_VLAN_TRACE_PORT_CONFIG_INVALID", message: "Engine VLAN access-port projection is structurally inconsistent." };
        }
      } else if (port.mode === "TRUNK") {
        if (!port.allowedVlans?.length || port.allowedVlans.some((vlan) => !validVlan(vlan)) || new Set(port.allowedVlans).size !== port.allowedVlans.length
          || (port.nativeVlan !== undefined && (!validVlan(port.nativeVlan) || !port.allowedVlans.includes(port.nativeVlan)))) {
          return { severity: "error", code: "VISUAL_JOURNEY_VLAN_TRACE_PORT_CONFIG_INVALID", message: "Engine VLAN trunk-port projection is structurally inconsistent." };
        }
      } else if (port.disposition !== "MALFORMED" && port.disposition !== "UNUSED") {
        return { severity: "error", code: "VISUAL_JOURNEY_VLAN_TRACE_PORT_CONFIG_INVALID", message: "Engine VLAN port row lacks mode outside a malformed/unused state." };
      }
    }
    if (seen.size !== resource.interfaces.length) {
      return { severity: "error", code: "VISUAL_JOURNEY_VLAN_TRACE_PORT_TABLE_INCOMPLETE", message: "Engine VLAN trace does not project every declared switch interface exactly once." };
    }
    const ingressRow = decision.ingressInterface ? decision.ports.find((port) => port.interfaceId === decision.ingressInterface) : undefined;
    const egressRow = decision.egressInterface ? decision.ports.find((port) => port.interfaceId === decision.egressInterface) : undefined;
    if (decision.ingressInterface && ingressRow?.disposition !== "INGRESS") {
      return { severity: "error", code: "VISUAL_JOURNEY_VLAN_TRACE_ROLE_INVALID", message: "Engine VLAN ingress row is not marked INGRESS." };
    }
    if (decision.egressInterface && egressRow?.disposition !== "EGRESS") {
      return { severity: "error", code: "VISUAL_JOURNEY_VLAN_TRACE_ROLE_INVALID", message: "Engine VLAN egress row is not marked EGRESS." };
    }
    if (decision.truth === "TRUE") {
      if (!validVlan(decision.vlan) || !decision.ingressInterface || !decision.egressInterface || !decision.ingressMode || !decision.egressMode
        || !decision.ingressTag || !decision.egressTag || decision.rewrite === "UNKNOWN") {
        return { severity: "error", code: "VISUAL_JOURNEY_VLAN_TRACE_TRUE_INCOMPLETE", message: "TRUE Engine VLAN trace lacks authoritative VLAN, port, tag or rewrite evidence." };
      }
      const expectedRewrite = decision.ingressTag === "UNTAGGED" && decision.egressTag === "TAGGED"
        ? "ADD_TAG"
        : decision.ingressTag === "TAGGED" && decision.egressTag === "UNTAGGED"
          ? "REMOVE_TAG"
          : decision.ingressTag === "TAGGED" ? "PRESERVE_TAG" : "PRESERVE_UNTAGGED";
      if (decision.rewrite !== expectedRewrite) {
        return { severity: "error", code: "VISUAL_JOURNEY_VLAN_TRACE_REWRITE_INVALID", message: "Engine VLAN rewrite disagrees with ingress/egress tag state." };
      }
    }
    if (decision.truth === "UNKNOWN" && decision.rewrite !== "UNKNOWN") {
      return { severity: "error", code: "VISUAL_JOURNEY_VLAN_TRACE_UNKNOWN_REWRITE", message: "UNKNOWN Engine VLAN trace cannot assert an authoritative tag rewrite." };
    }
  }
  return undefined;
}

function stpTraceDiagnostic(scenario: NormalizedScenario, path: readonly string[], decisions: readonly StpDecisionTrace[]): VisualJourneyDiagnostic | undefined {
  const resources = new Map(scenario.resources.map((resource) => [resource.id, resource]));
  const roles = new Set(["ROOT", "DESIGNATED", "ALTERNATE", "BACKUP", "DISABLED", "UNKNOWN"]);
  const states = new Set(["FORWARDING", "BLOCKING", "DISCARDING", "LEARNING", "LISTENING", "DISABLED", "UNKNOWN"]);
  const bpdus = new Set(["SEND", "RECEIVE", "NONE", "UNKNOWN"]);
  for (const decision of decisions) {
    const resource = resources.get(decision.resourceId);
    if (!resource || !resources.has(decision.sourceResourceId) || !resources.has(decision.nextHopResourceId)) {
      return { severity: "error", code: "VISUAL_JOURNEY_STP_TRACE_RESOURCE_UNKNOWN", message: "Engine STP trace references a resource absent from the scenario." };
    }
    const pathIndex = path.findIndex((resourceId, index) => resourceId === decision.resourceId
      && path[index - 1] === decision.sourceResourceId && path[index + 1] === decision.nextHopResourceId);
    if (pathIndex < 1 || decision.destinationId !== path[path.length - 1]) {
      return { severity: "error", code: "VISUAL_JOURNEY_STP_TRACE_PATH_MISMATCH", message: "Engine STP trace does not bind to an adjacent switching hop and destination in the proven path." };
    }
    const interfaceIds = new Set(resource.interfaces.map((iface) => iface.id));
    if (!decision.ingressInterface || !decision.egressInterface
      || !interfaceIds.has(decision.ingressInterface) || !interfaceIds.has(decision.egressInterface)) {
      return { severity: "error", code: "VISUAL_JOURNEY_STP_TRACE_INTERFACE_UNKNOWN", message: "Engine STP trace lacks declared ingress/egress interfaces." };
    }
    const seen = new Set<string>();
    for (const port of decision.ports) {
      if (seen.has(port.interfaceId) || !interfaceIds.has(port.interfaceId)) {
        return { severity: "error", code: "VISUAL_JOURNEY_STP_TRACE_PORT_TABLE_INVALID", message: "Engine STP trace contains duplicate or undeclared port rows." };
      }
      seen.add(port.interfaceId);
      if ((port.role !== undefined && !roles.has(port.role)) || (port.state !== undefined && !states.has(port.state)) || (port.bpdu !== undefined && !bpdus.has(port.bpdu))) {
        return { severity: "error", code: "VISUAL_JOURNEY_STP_TRACE_PORT_VALUE_INVALID", message: "Engine STP trace contains an unsupported role, state or BPDU disposition." };
      }
      if (port.disposition !== "MALFORMED" && (port.role === undefined) !== (port.state === undefined)) {
        return { severity: "error", code: "VISUAL_JOURNEY_STP_TRACE_PORT_VALUE_INVALID", message: "Engine STP port role/state projection is structurally inconsistent." };
      }
    }
    if (seen.size !== resource.interfaces.length) {
      return { severity: "error", code: "VISUAL_JOURNEY_STP_TRACE_PORT_TABLE_INCOMPLETE", message: "Engine STP trace does not project every declared switch interface exactly once." };
    }
    const ingress = decision.ports.find((port) => port.interfaceId === decision.ingressInterface);
    const egress = decision.ports.find((port) => port.interfaceId === decision.egressInterface);
    if (ingress?.disposition !== "INGRESS" || egress?.disposition !== "EGRESS") {
      return { severity: "error", code: "VISUAL_JOURNEY_STP_TRACE_PATH_ROLE_INVALID", message: "Engine STP ingress/egress port markers are inconsistent." };
    }
    const statesOnPath = [ingress.state, egress.state];
    if (typeof decision.modelComplete !== "boolean") {
      return { severity: "error", code: "VISUAL_JOURNEY_STP_TRACE_COMPLETENESS_INVALID", message: "Engine STP trace lacks an explicit model-completeness boundary." };
    }
    const expectedTruth: TruthValue = !decision.modelComplete || statesOnPath.some((state) => state === undefined || state === "UNKNOWN")
      ? "UNKNOWN"
      : statesOnPath.every((state) => state === "FORWARDING")
        ? "TRUE"
        : "FALSE";
    if (decision.truth !== expectedTruth) {
      return { severity: "error", code: "VISUAL_JOURNEY_STP_TRACE_TRUTH_MISMATCH", message: "Engine STP truth disagrees with the exact ingress/egress forwarding states." };
    }
    if ((decision.bridgeId === undefined) !== (decision.rootBridgeId === undefined)
      || (decision.isRootBridge !== undefined && decision.bridgeId !== undefined && decision.isRootBridge !== (decision.bridgeId === decision.rootBridgeId))
      || (decision.rootPathCost !== undefined && (!Number.isInteger(decision.rootPathCost) || decision.rootPathCost < 0))) {
      return { severity: "error", code: "VISUAL_JOURNEY_STP_TRACE_BRIDGE_INVALID", message: "Engine STP bridge/root projection is inconsistent." };
    }
  }
  return undefined;
}

function natTraceDiagnostic(scenario: NormalizedScenario, path: readonly string[], reachedPath: readonly string[], decisions: readonly NatDecisionTrace[]): VisualJourneyDiagnostic | undefined {
  const resourceIds = new Set(scenario.resources.map((resource) => resource.id));
  const validKinds = new Set(["DNAT", "SNAT"]);
  const validDispositions = new Set(["MATCH", "NO_MATCH", "DISABLED", "MALFORMED", "INDETERMINATE", "NOT_EVALUATED", "OTHER_KIND", "DECLARED"]);
  const validTransformations = new Set(["TRANSLATED", "PASSTHROUGH", "BLOCKED", "UNKNOWN"]);
  const decisionKeys = new Set<string>();
  for (const decision of decisions) {
    if (!resourceIds.has(decision.resourceId)) {
      return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_RESOURCE_UNKNOWN", message: "Engine NAT/PAT trace references a resource absent from the scenario." };
    }
    if (!path.includes(decision.resourceId) || !reachedPath.includes(decision.resourceId) || decision.destinationId !== path[path.length - 1]) {
      return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_PATH_MISMATCH", message: "Engine NAT/PAT trace is not bound to the proven reached path and destination." };
    }
    if (!validKinds.has(decision.kind) || !validTransformations.has(decision.transformation)) {
      return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_KIND_INVALID", message: "Engine NAT/PAT trace has an unsupported decision kind or transformation disposition." };
    }
    const decisionKey = `${decision.kind}:${decision.resourceId}`;
    if (decisionKeys.has(decisionKey)) {
      return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_DUPLICATE", message: "Engine NAT/PAT trace contains duplicate decisions for the same translation layer and resource." };
    }
    decisionKeys.add(decisionKey);
    if ((decision.transformation === "BLOCKED" && decision.truth !== "FALSE")
      || (decision.transformation === "UNKNOWN" && decision.truth !== "UNKNOWN")
      || ((decision.transformation === "TRANSLATED" || decision.transformation === "PASSTHROUGH") && decision.truth !== "TRUE")) {
      return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_TRUTH_MISMATCH", message: "Engine NAT/PAT truth disagrees with the declared transformation disposition." };
    }
    if (decision.inputPort !== undefined && (!Number.isInteger(decision.inputPort) || decision.inputPort < 1 || decision.inputPort > 65535)) {
      return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_PORT_INVALID", message: "Engine NAT/PAT trace contains an invalid input port." };
    }
    if (decision.outputPort !== undefined && (!Number.isInteger(decision.outputPort) || decision.outputPort < 1 || decision.outputPort > 65535)) {
      return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_PORT_INVALID", message: "Engine NAT/PAT trace contains an invalid output port." };
    }
    if (decision.kind === "SNAT" && decision.inputPort !== decision.outputPort) {
      return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_SNAT_PAT_UNSUPPORTED", message: "Engine SNAT trace attempts to project source-port PAT, which is not modeled in this phase." };
    }
    if (decision.kind === "DNAT" && decision.inputSource !== decision.outputSource) {
      return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_DNAT_SOURCE_REWRITE", message: "Engine DNAT trace rewrites source identity, which contradicts the modeled DNAT semantics." };
    }
    const selected = decision.rules.filter((rule) => rule.selected);
    if (selected.length > 1 || selected.some((rule) => rule.disposition !== "MATCH")) {
      return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_SELECTION_INVALID", message: "Engine NAT/PAT trace contains an ambiguous or non-matching selected rule." };
    }
    if ((decision.selectedRuleId === undefined) !== (selected.length === 0)
      || (decision.selectedRuleId !== undefined && selected[0]?.ruleId !== decision.selectedRuleId)) {
      return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_SELECTION_INVALID", message: "Engine NAT/PAT selectedRuleId disagrees with the selected rule row." };
    }
    const ruleIds = new Set<string>();
    let terminalSeen = false;
    let malformedSeen = false;
    for (let index = 0; index < decision.rules.length; index += 1) {
      const rule = decision.rules[index]!;
      if (rule.index !== index || !rule.ruleId || !validDispositions.has(rule.disposition)) {
        return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_RULE_TABLE_INVALID", message: "Engine NAT/PAT trace rule table is incomplete, reordered or contains unsupported dispositions." };
      }
      if (ruleIds.has(rule.ruleId)) {
        return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_RULE_ID_DUPLICATE", message: "Engine NAT/PAT trace contains duplicate rule identities and cannot be rendered unambiguously." };
      }
      ruleIds.add(rule.ruleId);
      if (rule.disposition === "MALFORMED") malformedSeen = true;
      if (terminalSeen && !["NOT_EVALUATED", "OTHER_KIND", "DISABLED"].includes(rule.disposition)) {
        return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_ORDER_INVALID", message: "Engine NAT/PAT trace evaluates an ordered rule after a terminal match/indeterminate decision." };
      }
      if (rule.disposition === "NOT_EVALUATED" && !terminalSeen) {
        return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_ORDER_INVALID", message: "Engine NAT/PAT trace marks a rule NOT_EVALUATED before any terminal ordered decision." };
      }
      if (rule.disposition === "MATCH" || rule.disposition === "INDETERMINATE") terminalSeen = true;
    }
    if (decision.rules.some((rule) => rule.disposition === "DECLARED")
      && !(decision.truth === "UNKNOWN" && decision.transformation === "UNKNOWN" && malformedSeen)) {
      return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_DECLARED_INVALID", message: "Engine NAT/PAT trace leaves unevaluated DECLARED rows outside a fail-closed malformed SNAT prevalidation outcome." };
    }
    const selectedRule = selected[0];
    if (selectedRule) {
      const expectedType = decision.kind.toLowerCase();
      if (selectedRule.declaredType !== undefined && selectedRule.declaredType !== expectedType) {
        return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_SELECTED_KIND_MISMATCH", message: "Engine NAT/PAT selected rule kind disagrees with the decision layer." };
      }
      const action = selectedRule.action ?? "translate";
      if ((action === "deny" || action === "block") && (decision.truth !== "FALSE" || decision.transformation !== "BLOCKED")) {
        return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_ACTION_MISMATCH", message: "Engine NAT/PAT blocking rule disagrees with the decision truth/transformation." };
      }
      if ((action === "translate" || action === "allow") && decision.truth === "TRUE") {
        if (decision.kind === "DNAT") {
          const translated = decision.inputPort !== decision.outputPort;
          if ((decision.transformation === "TRANSLATED") !== translated) {
            return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_TRANSFORMATION_MISMATCH", message: "Engine DNAT transformation label disagrees with the input/output port projection." };
          }
        } else {
          const translated = decision.inputSource !== decision.outputSource;
          if ((decision.transformation === "TRANSLATED") !== translated) {
            return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_TRANSFORMATION_MISMATCH", message: "Engine SNAT transformation label disagrees with the input/output source projection." };
          }
        }
      }
    } else if (decision.transformation === "TRANSLATED") {
      return { severity: "error", code: "VISUAL_JOURNEY_NAT_TRACE_TRANSFORMATION_MISMATCH", message: "Engine NAT/PAT trace claims a translation without an authoritative selected rule." };
    }
  }
  return undefined;
}


function hostStackBindScope(address: string): "WILDCARD" | "LOOPBACK" | "SPECIFIC" {
  const lower = address.toLowerCase();
  if (lower === "*" || lower === "0.0.0.0" || lower === "::") return "WILDCARD";
  if (lower === "::1" || /^127(?:\.\d{1,3}){3}$/.test(lower)) return "LOOPBACK";
  return "SPECIFIC";
}

function hostStackProtocolMatches(declared: "tcp" | "udp" | "icmp" | "any" | undefined, requested: "tcp" | "udp" | "icmp" | "any"): boolean {
  if (requested === "any") return true;
  return declared === undefined || declared === "any" || declared === requested;
}

function hostStackTraceDiagnostic(transcript: ActiveProbeTranscript, trace: HostStackDecisionTrace): VisualJourneyDiagnostic | undefined {
  if (!transcript.destinationId || trace.resourceId !== transcript.destinationId) {
    return { severity: "error", code: "VISUAL_JOURNEY_HOST_STACK_RESOURCE_MISMATCH", message: "Engine host-stack trace is not bound to the requested destination resource." };
  }
  if (!(["TRUE", "FALSE", "UNKNOWN"] as const).includes(trace.truth)) {
    return { severity: "error", code: "VISUAL_JOURNEY_HOST_STACK_TRUTH_INVALID", message: "Engine host-stack trace contains an invalid truth value." };
  }
  if (trace.model !== "SERVICE_DECLARATIONS" && trace.model !== "EXPLICIT_HOST_STACK") {
    return { severity: "error", code: "VISUAL_JOURNEY_HOST_STACK_MODEL_INVALID", message: "Engine host-stack trace contains an unsupported model label." };
  }
  if (typeof trace.complete !== "boolean" || !Array.isArray(trace.processes) || !Array.isArray(trace.sockets) || !Array.isArray(trace.services)
      || !Array.isArray(trace.selectedServiceNames) || !Array.isArray(trace.selectedSocketIds) || !Array.isArray(trace.explanation)) {
    return { severity: "error", code: "VISUAL_JOURNEY_HOST_STACK_SHAPE_INVALID", message: "Engine host-stack trace is structurally incomplete." };
  }
  if (!["CONSISTENT", "MISMATCH", "UNMODELED"].includes(trace.listenerConsistency)) {
    return { severity: "error", code: "VISUAL_JOURNEY_HOST_STACK_CONSISTENCY_INVALID", message: "Engine host-stack trace contains an invalid listener-consistency label." };
  }
  if (trace.model === "SERVICE_DECLARATIONS" && (trace.complete || trace.processes.length || trace.sockets.length || trace.selectedSocketIds.length)) {
    return { severity: "error", code: "VISUAL_JOURNEY_HOST_STACK_SERVICE_ONLY_FABRICATION", message: "Service-only host-stack evidence must not fabricate process/socket ownership." };
  }
  if (trace.truth === "UNKNOWN" && (trace.processes.length || trace.sockets.length || trace.selectedServiceNames.length || trace.selectedSocketIds.length)) {
    return { severity: "error", code: "VISUAL_JOURNEY_HOST_STACK_UNKNOWN_DETAILS", message: "Fail-closed UNKNOWN host-stack evidence must not expose partially trusted ownership rows or selected listeners." };
  }

  const serviceNames = new Set<string>();
  const processIds = new Set<string>();
  const socketIds = new Set<string>();
  for (let index = 0; index < trace.services.length; index += 1) {
    const service = trace.services[index]!;
    if (service.index !== index || typeof service.name !== "string" || !service.name || serviceNames.has(service.name)
        || !Array.isArray(service.owningProcessIds) || !Array.isArray(service.socketIds)
        || (service.enabled !== undefined && typeof service.enabled !== "boolean")
        || (service.port !== undefined && (!Number.isInteger(service.port) || service.port < 1 || service.port > 65535))
        || (service.protocol !== undefined && !["tcp", "udp", "icmp", "any"].includes(service.protocol))) {
      return { severity: "error", code: "VISUAL_JOURNEY_HOST_STACK_SERVICE_INVALID", message: "Engine host-stack service rows are malformed, duplicated or out of order." };
    }
    serviceNames.add(service.name);
  }
  for (const process of trace.processes) {
    if (typeof process.processId !== "string" || !process.processId || processIds.has(process.processId) || typeof process.name !== "string" || !process.name
        || (process.pid !== undefined && (!Number.isInteger(process.pid) || process.pid < 1))
        || (process.service !== undefined && !serviceNames.has(process.service))) {
      return { severity: "error", code: "VISUAL_JOURNEY_HOST_STACK_PROCESS_INVALID", message: "Engine host-stack process rows are malformed, duplicated or reference an unknown service." };
    }
    processIds.add(process.processId);
  }
  for (const socket of trace.sockets) {
    if (typeof socket.socketId !== "string" || !socket.socketId || socketIds.has(socket.socketId)
        || (socket.protocol !== "tcp" && socket.protocol !== "udp")
        || typeof socket.localAddress !== "string" || !socket.localAddress
        || !Number.isInteger(socket.localPort) || socket.localPort < 1 || socket.localPort > 65535
        || !["LISTEN", "BOUND", "ESTABLISHED", "CLOSED", "UNKNOWN"].includes(socket.state)
        || socket.bindScope !== hostStackBindScope(socket.localAddress)
        || (socket.remoteAddress !== undefined && (typeof socket.remoteAddress !== "string" || !socket.remoteAddress))
        || (socket.remotePort !== undefined && (!Number.isInteger(socket.remotePort) || socket.remotePort < 1 || socket.remotePort > 65535))
        || (socket.processId !== undefined && !processIds.has(socket.processId))
        || (socket.service !== undefined && !serviceNames.has(socket.service))
        || (socket.protocol === "udp" && socket.state === "LISTEN")
        || (socket.protocol === "tcp" && socket.state === "BOUND")) {
      return { severity: "error", code: "VISUAL_JOURNEY_HOST_STACK_SOCKET_INVALID", message: "Engine host-stack socket rows are malformed or contain inconsistent bind/process/service evidence." };
    }
    const owner = socket.processId ? trace.processes.find((row) => row.processId === socket.processId) : undefined;
    if (owner?.service !== undefined && socket.service !== undefined && owner.service !== socket.service) {
      return { severity: "error", code: "VISUAL_JOURNEY_HOST_STACK_BINDING_MISMATCH", message: "Engine host-stack socket service disagrees with its owning process service binding." };
    }
    socketIds.add(socket.socketId);
  }

  for (const service of trace.services) {
    const expectedOwners = trace.processes.filter((process) => process.service === service.name).map((process) => process.processId).sort();
    const expectedSockets = trace.sockets.filter((socket) => socket.service === service.name).map((socket) => socket.socketId).sort();
    const actualOwners = [...service.owningProcessIds].sort();
    const actualSockets = [...service.socketIds].sort();
    if (new Set(actualOwners).size !== actualOwners.length || new Set(actualSockets).size !== actualSockets.length
        || actualOwners.some((id) => !processIds.has(id)) || actualSockets.some((id) => !socketIds.has(id))
        || JSON.stringify(actualOwners) !== JSON.stringify(expectedOwners) || JSON.stringify(actualSockets) !== JSON.stringify(expectedSockets)) {
      return { severity: "error", code: "VISUAL_JOURNEY_HOST_STACK_OWNERSHIP_MISMATCH", message: "Engine host-stack service ownership projection disagrees with the authoritative process/socket bindings." };
    }
  }

  const requestedProtocol = transcript.protocol ?? "any";
  const expectedServices = transcript.port === undefined || requestedProtocol === "icmp"
    ? []
    : trace.services.filter((service) => service.port === transcript.port && hostStackProtocolMatches(service.protocol, requestedProtocol)).map((service) => service.name).sort();
  const expectedSockets = transcript.port === undefined || requestedProtocol === "icmp"
    ? []
    : trace.sockets.filter((socket) => socket.localPort === transcript.port && hostStackProtocolMatches(socket.protocol, requestedProtocol)
      && ((socket.protocol === "tcp" && socket.state === "LISTEN") || (socket.protocol === "udp" && socket.state === "BOUND"))).map((socket) => socket.socketId).sort();
  const selectedServices = [...trace.selectedServiceNames].sort();
  const selectedSockets = [...trace.selectedSocketIds].sort();
  if (new Set(selectedServices).size !== selectedServices.length || selectedServices.some((name) => !serviceNames.has(name))
      || JSON.stringify(selectedServices) !== JSON.stringify(expectedServices)) {
    return { severity: "error", code: "VISUAL_JOURNEY_HOST_STACK_SELECTED_SERVICE_MISMATCH", message: "Engine host-stack selected service projection disagrees with the probe protocol/port." };
  }
  if (new Set(selectedSockets).size !== selectedSockets.length || selectedSockets.some((id) => !socketIds.has(id))
      || JSON.stringify(selectedSockets) !== JSON.stringify(expectedSockets)) {
    return { severity: "error", code: "VISUAL_JOURNEY_HOST_STACK_SELECTED_SOCKET_MISMATCH", message: "Engine host-stack selected socket projection disagrees with the probe protocol/port." };
  }

  let expectedConsistency: "CONSISTENT" | "MISMATCH" | "UNMODELED" = "UNMODELED";
  if (transcript.port !== undefined && requestedProtocol !== "icmp" && trace.model === "EXPLICIT_HOST_STACK" && trace.truth !== "UNKNOWN") {
    const matchingServices = trace.services.filter((service) => expectedServices.includes(service.name));
    const declaredTrue = matchingServices.some((service) => service.enabled === true);
    const declaredFalse = matchingServices.length === 0 || matchingServices.every((service) => service.enabled === false);
    if (declaredTrue) expectedConsistency = expectedSockets.length > 0 ? "CONSISTENT" : trace.complete ? "MISMATCH" : "UNMODELED";
    else if (declaredFalse) expectedConsistency = expectedSockets.length === 0 ? "CONSISTENT" : "MISMATCH";
  }
  if (trace.listenerConsistency !== expectedConsistency) {
    return { severity: "error", code: "VISUAL_JOURNEY_HOST_STACK_CONSISTENCY_MISMATCH", message: "Engine host-stack listener-consistency label disagrees with its own service/socket evidence." };
  }
  return undefined;
}

function udpIcmpTraceDiagnostic(transcript: ActiveProbeTranscript): VisualJourneyDiagnostic | undefined {
  const evidence = transcript.evidence.filter(row => row.kind === "engine_query" && row.subject === "engine.queryReachability");
  const trace = transcript.udpIcmpFailureDecision;
  const required = transcript.probeId.endsWith("udp_delivery") || evidence.some(row => isRecord(row.value) && (row.value.udpIcmpFailureDecision !== undefined || row.value.networkTruthBeforeListener !== undefined)) && (transcript.protocol === "udp" || transcript.protocol === "icmp");
  if (trace === undefined && !required) return undefined; // legacy transcripts remain compatible
  const fail = (): VisualJourneyDiagnostic => ({ severity: "error", code: "VISUAL_JOURNEY_UDP_ICMP_TRACE_INVALID", message: "UDP/ICMP classification is absent, malformed, duplicated, fabricated or inconsistent with the bound Engine result." });
  if (evidence.length !== 1 || !isRecord(evidence[0]?.value)) return fail();
  const value = evidence[0]!.value as unknown as ReachabilityDetails;
  if (evidence[0]!.state !== transcript.truth || value.from !== transcript.sourceId || value.to !== transcript.destinationId || value.protocol !== transcript.protocol || value.port !== transcript.port
      || !jsonEqual(value.udpIcmpFailureDecision, trace)
      || !validateUdpIcmpFailureDecision({ truth: transcript.truth, value, explanation: [] }, trace)) return fail();
  for (const key of ["path", "blockingPoint", "routeDecisions", "neighborDecisions", "macDecisions", "vlanDecisions", "stpDecisions", "policyDecisions", "natDecisions", "conntrackDecisions", "hostStackDecision", "listenerServiceDecision"] as const) {
    if (!jsonEqual(value[key], transcript[key])) return fail();
  }
  return undefined;
}

function listenerServiceTraceDiagnostic(
  transcript: ActiveProbeTranscript,
  trace: ListenerServiceDecisionTrace,
  hostStack: HostStackDecisionTrace | undefined,
): VisualJourneyDiagnostic | undefined {
  if (!transcript.destinationId || trace.resourceId !== transcript.destinationId || trace.protocol !== (transcript.protocol ?? "any") || trace.port !== transcript.port) {
    return { severity: "error", code: "VISUAL_JOURNEY_LISTENER_TRACE_BINDING_MISMATCH", message: "Engine listener/service trace is not bound to the requested destination protocol/port." };
  }
  if (!( ["TRUE", "FALSE", "UNKNOWN"] as const).includes(trace.truth)
      || !["NOT_REQUIRED", "SERVICE_DECLARATIONS", "EXPLICIT_HOST_STACK"].includes(trace.model)
      || typeof trace.complete !== "boolean"
      || !["NOT_REQUIRED", "LISTENING", "NOT_LISTENING", "UNKNOWN"].includes(trace.listenerState)
      || !["UNDECLARED", "ENABLED", "DISABLED", "MIXED", "UNKNOWN"].includes(trace.serviceState)
      || !["NOT_REQUIRED", "LISTENING", "NO_LISTENER", "SERVICE_DISABLED", "SERVICE_STATE_UNKNOWN", "DECLARATION_ABSENT", "SNAPSHOT_INCOMPLETE", "MALFORMED", "RESOURCE_ABSENT"].includes(trace.disposition)
      || !Array.isArray(trace.selectedServiceNames) || !Array.isArray(trace.selectedSocketIds) || !Array.isArray(trace.explanation)
      || !["CONSISTENT", "MISMATCH", "UNMODELED"].includes(trace.listenerConsistency)) {
    return { severity: "error", code: "VISUAL_JOURNEY_LISTENER_TRACE_SHAPE_INVALID", message: "Engine listener/service trace is structurally invalid." };
  }
  if (trace.truth !== transcript.truth && transcript.udpIcmpFailureDecision?.listenerTruth !== trace.truth) {
    return { severity: "error", code: "VISUAL_JOURNEY_LISTENER_TRACE_TRUTH_MISMATCH", message: "Engine listener/service truth disagrees with the terminal probe truth." };
  }
  if (!hostStack) {
    return { severity: "error", code: "VISUAL_JOURNEY_LISTENER_TRACE_HOST_STACK_REQUIRED", message: "Listener/service trace requires the Engine host-stack evidence it was derived from." };
  }
  if (trace.model === "NOT_REQUIRED") {
    if (transcript.port !== undefined && transcript.protocol !== "icmp" || trace.listenerState !== "NOT_REQUIRED" || trace.disposition !== "NOT_REQUIRED"
        || trace.truth !== "TRUE" || trace.selectedServiceNames.length || trace.selectedSocketIds.length) {
      return { severity: "error", code: "VISUAL_JOURNEY_LISTENER_TRACE_STATE_MISMATCH", message: "NOT_REQUIRED listener trace contradicts the requested flow or contains fabricated selection evidence." };
    }
    return undefined;
  }
  if (trace.model !== hostStack.model || trace.complete !== hostStack.complete || trace.listenerConsistency !== hostStack.listenerConsistency) {
    return { severity: "error", code: "VISUAL_JOURNEY_LISTENER_TRACE_MODEL_MISMATCH", message: "Listener/service trace disagrees with its authoritative Host Stack model/completeness/consistency evidence." };
  }
  const selectedServices = [...trace.selectedServiceNames].sort();
  const hostServices = [...hostStack.selectedServiceNames].sort();
  const selectedSockets = [...trace.selectedSocketIds].sort();
  const hostSockets = [...hostStack.selectedSocketIds].sort();
  if (new Set(selectedServices).size !== selectedServices.length || new Set(selectedSockets).size !== selectedSockets.length
      || JSON.stringify(selectedServices) !== JSON.stringify(hostServices) || JSON.stringify(selectedSockets) !== JSON.stringify(hostSockets)) {
    return { severity: "error", code: "VISUAL_JOURNEY_LISTENER_TRACE_SELECTION_MISMATCH", message: "Listener/service selected service/socket identities disagree with Host Stack evidence." };
  }
  const matchingServices = hostStack.services.filter((service) => hostStack.selectedServiceNames.includes(service.name));
  let expectedServiceState: ListenerServiceDecisionTrace["serviceState"] = "UNDECLARED";
  if (matchingServices.length) {
    const enabled = matchingServices.map((service) => service.enabled);
    if (enabled.every((value) => value === true)) expectedServiceState = "ENABLED";
    else if (enabled.every((value) => value === false)) expectedServiceState = "DISABLED";
    else if (enabled.some((value) => value === true) && enabled.some((value) => value === false)) expectedServiceState = "MIXED";
    else expectedServiceState = "UNKNOWN";
  }
  if (trace.serviceState !== expectedServiceState) {
    return { severity: "error", code: "VISUAL_JOURNEY_LISTENER_TRACE_SERVICE_STATE_MISMATCH", message: "Listener/service service-state label disagrees with selected service declarations." };
  }
  let expectedListenerState: ListenerServiceDecisionTrace["listenerState"];
  let expectedDisposition: ListenerServiceDecisionTrace["disposition"];
  let expectedTruth: ListenerServiceDecisionTrace["truth"];
  if (hostStack.truth === "UNKNOWN") {
    expectedListenerState = "UNKNOWN"; expectedDisposition = "MALFORMED"; expectedTruth = "UNKNOWN";
  } else if (hostStack.model === "SERVICE_DECLARATIONS") {
    if (hostStack.services.length === 0) {
      expectedListenerState = "UNKNOWN"; expectedDisposition = "DECLARATION_ABSENT"; expectedTruth = "UNKNOWN";
    } else if (hostStack.selectedServiceNames.length === 0) {
      expectedListenerState = "NOT_LISTENING"; expectedDisposition = "NO_LISTENER"; expectedTruth = "FALSE";
    } else if (matchingServices.some((service) => service.enabled === true)) {
      expectedListenerState = "LISTENING"; expectedDisposition = "LISTENING"; expectedTruth = "TRUE";
    } else if (matchingServices.every((service) => service.enabled === false)) {
      expectedListenerState = "NOT_LISTENING"; expectedDisposition = "SERVICE_DISABLED"; expectedTruth = "FALSE";
    } else {
      expectedListenerState = "UNKNOWN"; expectedDisposition = "SERVICE_STATE_UNKNOWN"; expectedTruth = "UNKNOWN";
    }
  } else if (hostStack.selectedSocketIds.length > 0) {
    expectedListenerState = "LISTENING"; expectedDisposition = "LISTENING"; expectedTruth = "TRUE";
  } else if (hostStack.complete) {
    expectedListenerState = "NOT_LISTENING"; expectedDisposition = expectedServiceState === "DISABLED" ? "SERVICE_DISABLED" : "NO_LISTENER"; expectedTruth = "FALSE";
  } else {
    expectedListenerState = "UNKNOWN"; expectedDisposition = "SNAPSHOT_INCOMPLETE"; expectedTruth = "UNKNOWN";
  }
  if (trace.listenerState !== expectedListenerState || trace.disposition !== expectedDisposition || trace.truth !== expectedTruth) {
    return { severity: "error", code: "VISUAL_JOURNEY_LISTENER_TRACE_STATE_MISMATCH", message: "Listener/service state/disposition disagrees with authoritative Host Stack evidence." };
  }
  return undefined;
}

const TCP_LIFECYCLE_STATES = new Set<TcpLifecycleState>([
  "CLOSED", "LISTEN", "SYN_SENT", "SYN_RECEIVED", "ESTABLISHED",
  "FIN_WAIT_1", "FIN_WAIT_2", "CLOSE_WAIT", "CLOSING", "LAST_ACK", "TIME_WAIT", "UNKNOWN",
]);

const TCP_CANONICAL_TRANSITIONS = [
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
] as const;

function tcpAllowedNextStates(state: TcpLifecycleState): readonly TcpLifecycleState[] {
  return [...new Set(TCP_CANONICAL_TRANSITIONS.filter((row) => row.from === state).map((row) => row.to as TcpLifecycleState))];
}

function scenarioResourceAddresses(scenario: NormalizedScenario, resourceId: string): readonly string[] {
  const resource = scenario.resources.find((row) => row.id === resourceId);
  if (!resource) return [];
  const out: string[] = [];
  for (const iface of resource.interfaces ?? []) {
    const values = iface.addresses;
    if (!Array.isArray(values)) continue;
    for (const value of values) if (typeof value === "string" && value) out.push(value.split("/")[0]!);
  }
  const properties = resource.properties as Readonly<Record<string, unknown>>;
  const single = properties.address;
  if (typeof single === "string" && single) out.push(single.split("/")[0]!);
  const many = properties.addresses;
  if (Array.isArray(many)) for (const value of many) if (typeof value === "string" && value) out.push(value.split("/")[0]!);
  return [...new Set(out)].sort((a, b) => a.localeCompare(b, "en"));
}

function tcpStateMachineTraceDiagnostic(
  scenario: NormalizedScenario,
  transcript: ActiveProbeTranscript,
  trace: TcpStateMachineDecisionTrace,
  hostStack: HostStackDecisionTrace | undefined,
  listener: ListenerServiceDecisionTrace | undefined,
): VisualJourneyDiagnostic | undefined {
  if (transcript.protocol !== "tcp" || transcript.port === undefined || !transcript.destinationId) {
    return { severity: "error", code: "VISUAL_JOURNEY_TCP_TRACE_CONTEXT_INVALID", message: "TCP state-machine trace is attached outside a TCP destination-port probe." };
  }
  if (trace.sourceId !== transcript.sourceId || trace.destinationId !== transcript.destinationId || trace.port !== transcript.port) {
    return { severity: "error", code: "VISUAL_JOURNEY_TCP_TRACE_BINDING_MISMATCH", message: "Engine TCP state-machine trace is not bound to the active probe tuple." };
  }
  if (!["TRUE", "FALSE", "UNKNOWN"].includes(trace.truth)
      || !["SERVICE_DECLARATIONS", "EXPLICIT_HOST_STACK"].includes(trace.model)
      || typeof trace.complete !== "boolean"
      || !["DECLARATION_ONLY", "LISTENING", "CONNECTION_REFUSED", "SESSION_OBSERVED", "SESSION_AMBIGUOUS", "SNAPSHOT_INCOMPLETE", "MALFORMED", "RESOURCE_ABSENT"].includes(trace.disposition)
      || !["TRUE", "FALSE", "UNKNOWN"].includes(trace.listenerTruth)
      || !Array.isArray(trace.socketRows) || !Array.isArray(trace.selectedSocketIds) || !Array.isArray(trace.currentStates)
      || !Array.isArray(trace.canonicalTransitions) || !Array.isArray(trace.explanation)
      || trace.sequenceAckTimeline !== "NOT_MODELED" || trace.retransmissionMarkers !== "NOT_MODELED") {
    return { severity: "error", code: "VISUAL_JOURNEY_TCP_TRACE_SHAPE_INVALID", message: "Engine TCP state-machine trace is structurally invalid." };
  }
  if (hostStack && trace.model !== hostStack.model) {
    return { severity: "error", code: "VISUAL_JOURNEY_TCP_TRACE_MODEL_MISMATCH", message: "TCP state-machine model disagrees with validated Host Stack model." };
  }
  if (listener && trace.listenerTruth !== listener.truth) {
    return { severity: "error", code: "VISUAL_JOURNEY_TCP_TRACE_LISTENER_MISMATCH", message: "TCP state-machine listener truth disagrees with validated listener/service evidence." };
  }
  if (trace.model === "SERVICE_DECLARATIONS" && (trace.socketRows.length || trace.selectedSocketIds.length || trace.currentStates.length || trace.complete)) {
    return { severity: "error", code: "VISUAL_JOURNEY_TCP_TRACE_DECLARATION_FABRICATION", message: "Declaration-only TCP trace must not fabricate socket lifecycle state." };
  }

  const socketIds = new Set<string>();
  for (const row of trace.socketRows) {
    if (typeof row.socketId !== "string" || !row.socketId || socketIds.has(row.socketId)
        || typeof row.localAddress !== "string" || !Number.isInteger(row.localPort) || row.localPort !== trace.port
        || !TCP_LIFECYCLE_STATES.has(row.state)
        || !["LISTENER", "SESSION", "CLOSED_OR_UNKNOWN"].includes(row.role)
        || typeof row.selected !== "boolean" || !Array.isArray(row.allowedNextStates)
        || row.allowedNextStates.some((state: TcpLifecycleState) => !TCP_LIFECYCLE_STATES.has(state))) {
      return { severity: "error", code: "VISUAL_JOURNEY_TCP_SOCKET_ROW_INVALID", message: "TCP state-machine socket row is malformed, duplicated or bound to another port." };
    }
    if (row.role === "LISTENER" && row.state !== "LISTEN") {
      return { severity: "error", code: "VISUAL_JOURNEY_TCP_ROLE_MISMATCH", message: "TCP LISTENER role is not bound to LISTEN state." };
    }
    if (row.role === "SESSION" && ["LISTEN", "CLOSED", "UNKNOWN"].includes(row.state)) {
      return { severity: "error", code: "VISUAL_JOURNEY_TCP_SESSION_ROLE_MISMATCH", message: "TCP SESSION role is bound to a non-session lifecycle state." };
    }
    if (row.role === "SESSION" && (typeof row.remoteAddress !== "string" || !row.remoteAddress || !Number.isInteger(row.remotePort))) {
      return { severity: "error", code: "VISUAL_JOURNEY_TCP_SESSION_PEER_MISSING", message: "TCP session row lacks explicit peer identity." };
    }
    socketIds.add(row.socketId);
  }
  if (trace.selectedSocketIds.some((id) => !socketIds.has(id))
      || trace.currentStates.some((state) => !TCP_LIFECYCLE_STATES.has(state))) {
    return { severity: "error", code: "VISUAL_JOURNEY_TCP_SELECTION_INVALID", message: "TCP state-machine selection references untrusted socket/state evidence." };
  }
  const selectedRows = trace.socketRows.filter((row) => row.selected).map((row) => row.socketId).sort();
  if (JSON.stringify(selectedRows) !== JSON.stringify([...trace.selectedSocketIds].sort())) {
    return { severity: "error", code: "VISUAL_JOURNEY_TCP_SELECTION_MISMATCH", message: "TCP selectedSocketIds disagree with row-level selected flags." };
  }
  const selectedStates = [...new Set(trace.socketRows.filter((row) => row.selected).map((row) => row.state))].sort();
  if (JSON.stringify(selectedStates) !== JSON.stringify([...trace.currentStates].sort())) {
    return { severity: "error", code: "VISUAL_JOURNEY_TCP_STATE_MISMATCH", message: "TCP currentStates disagree with selected socket rows." };
  }
  for (const transition of trace.canonicalTransitions) {
    if (!TCP_LIFECYCLE_STATES.has(transition.from) || !TCP_LIFECYCLE_STATES.has(transition.to) || typeof transition.trigger !== "string" || !transition.trigger) {
      return { severity: "error", code: "VISUAL_JOURNEY_TCP_TRANSITION_INVALID", message: "TCP canonical transition table is malformed." };
    }
  }
  if (JSON.stringify(trace.canonicalTransitions) !== JSON.stringify(TCP_CANONICAL_TRANSITIONS)) {
    return { severity: "error", code: "VISUAL_JOURNEY_TCP_TRANSITIONS_TAMPERED", message: "TCP canonical transition table is missing, reordered or modified." };
  }
  if (trace.model === "EXPLICIT_HOST_STACK" && hostStack) {
    if (trace.complete !== hostStack.complete) return { severity: "error", code: "VISUAL_JOURNEY_TCP_COMPLETENESS_MISMATCH", message: "TCP state-machine completeness disagrees with Host Stack evidence." };
    if (hostStack.truth === "UNKNOWN" || listener?.disposition === "MALFORMED") {
      if (trace.truth !== "UNKNOWN" || trace.disposition !== "MALFORMED" || trace.socketRows.length || trace.selectedSocketIds.length || trace.currentStates.length) {
        return { severity: "error", code: "VISUAL_JOURNEY_TCP_MALFORMED_PROJECTION", message: "Malformed Host Stack evidence cannot expose partial TCP state rows." };
      }
      return undefined;
    }
    const hostRows = hostStack.sockets.filter((socket) => socket.protocol === "tcp" && socket.localPort === trace.port);
    if (hostRows.length !== trace.socketRows.length) return { severity: "error", code: "VISUAL_JOURNEY_TCP_SOCKET_PROJECTION_MISMATCH", message: "TCP socket rows disagree with Host Stack evidence for the requested port." };
    const sourceAddresses = new Set(scenarioResourceAddresses(scenario, trace.sourceId));
    const matchingSessions = hostRows.filter((socket) => socket.state !== "LISTEN" && socket.remoteAddress !== undefined && sourceAddresses.has(socket.remoteAddress));
    const listeners = hostRows.filter((socket) => socket.state === "LISTEN");
    const expectedSelected = [...new Set((matchingSessions.length ? matchingSessions : listeners).map((socket) => socket.socketId))].sort();
    const expectedSelectedSet = new Set(expectedSelected);
    for (let index = 0; index < hostRows.length; index += 1) {
      const host = hostRows[index]!;
      const row = trace.socketRows[index]!;
      if (row.socketId !== host.socketId || row.localAddress !== host.localAddress || row.localPort !== host.localPort || row.state !== host.state
          || row.remoteAddress !== host.remoteAddress || row.remotePort !== host.remotePort || row.processId !== host.processId || row.service !== host.service
          || row.selected !== expectedSelectedSet.has(host.socketId)) {
        return { severity: "error", code: "VISUAL_JOURNEY_TCP_SOCKET_PROJECTION_MISMATCH", message: "TCP state-machine row differs from authoritative Host Stack socket evidence." };
      }
      const expectedRole = host.state === "LISTEN" ? "LISTENER" : (host.state === "CLOSED" || host.state === "UNKNOWN") ? "CLOSED_OR_UNKNOWN" : "SESSION";
      if (row.role !== expectedRole || JSON.stringify(row.allowedNextStates) !== JSON.stringify(tcpAllowedNextStates(host.state as TcpLifecycleState))) {
        return { severity: "error", code: "VISUAL_JOURNEY_TCP_STATE_PROJECTION_MISMATCH", message: "TCP role/next-state projection disagrees with the bounded state machine." };
      }
    }
    if (JSON.stringify([...trace.selectedSocketIds].sort()) !== JSON.stringify(expectedSelected)) {
      return { severity: "error", code: "VISUAL_JOURNEY_TCP_SELECTION_MISMATCH", message: "TCP selected socket identities disagree with source-bound Host Stack evidence." };
    }
    let expectedTruth: TruthValue;
    let expectedDisposition: TcpStateMachineDecisionTrace["disposition"];
    if (listener?.truth === "FALSE") { expectedTruth = "FALSE"; expectedDisposition = "CONNECTION_REFUSED"; }
    else if (listener?.truth === "UNKNOWN") { expectedTruth = "UNKNOWN"; expectedDisposition = "SNAPSHOT_INCOMPLETE"; }
    else if (matchingSessions.length) {
      const states = [...new Set(matchingSessions.map((row) => row.state))];
      if (matchingSessions.length > 1 && states.length > 1) { expectedTruth = "UNKNOWN"; expectedDisposition = "SESSION_AMBIGUOUS"; }
      else { expectedTruth = "TRUE"; expectedDisposition = "SESSION_OBSERVED"; }
    } else { expectedTruth = "TRUE"; expectedDisposition = "LISTENING"; }
    if (trace.truth !== expectedTruth || trace.disposition !== expectedDisposition) {
      return { severity: "error", code: "VISUAL_JOURNEY_TCP_OUTCOME_MISMATCH", message: "TCP state-machine truth/disposition disagrees with listener/session evidence." };
    }
  }
  return undefined;
}

function conntrackTraceDiagnostic(scenario: NormalizedScenario, path: readonly string[], reachedPath: readonly string[], decisions: readonly ConntrackDecisionTrace[]): VisualJourneyDiagnostic | undefined {
  const resourceIds = new Set(scenario.resources.map((resource) => resource.id));
  const validDispositions = new Set(["MATCH", "NO_MATCH", "DISABLED", "MALFORMED", "INDETERMINATE"]);
  const validStates = new Set(["NEW", "ESTABLISHED", "RELATED", "INVALID", "UNKNOWN"]);
  const decisionResources = new Set<string>();
  for (const decision of decisions) {
    if (!resourceIds.has(decision.resourceId)) return { severity: "error", code: "VISUAL_JOURNEY_CONNTRACK_TRACE_RESOURCE_UNKNOWN", message: "Engine conntrack trace references a resource absent from the scenario." };
    if (!path.includes(decision.resourceId) || !reachedPath.includes(decision.resourceId) || decision.destinationId !== path[path.length - 1]) {
      return { severity: "error", code: "VISUAL_JOURNEY_CONNTRACK_TRACE_PATH_MISMATCH", message: "Engine conntrack trace is not bound to the proven reached path and destination." };
    }
    if (decisionResources.has(decision.resourceId)) return { severity: "error", code: "VISUAL_JOURNEY_CONNTRACK_TRACE_DUPLICATE", message: "Engine conntrack trace contains duplicate decisions for one resource." };
    decisionResources.add(decision.resourceId);
    if (decision.complete !== undefined && typeof decision.complete !== "boolean") return { severity: "error", code: "VISUAL_JOURNEY_CONNTRACK_TRACE_COMPLETENESS_INVALID", message: "Engine conntrack trace has an invalid completeness boundary." };
    if (decision.observedPort !== undefined && (!Number.isInteger(decision.observedPort) || decision.observedPort < 1 || decision.observedPort > 65535)) return { severity: "error", code: "VISUAL_JOURNEY_CONNTRACK_TRACE_PORT_INVALID", message: "Engine conntrack trace contains an invalid observed port." };
    if (decision.connectionState !== undefined && !validStates.has(decision.connectionState)) return { severity: "error", code: "VISUAL_JOURNEY_CONNTRACK_TRACE_STATE_INVALID", message: "Engine conntrack trace contains an unsupported session state." };
    const ids = new Set<string>();
    const selected = decision.entries.filter((entry) => entry.selected);
    if (selected.length > 1 || selected.some((entry) => entry.disposition !== "MATCH")) return { severity: "error", code: "VISUAL_JOURNEY_CONNTRACK_TRACE_SELECTION_INVALID", message: "Engine conntrack trace contains an ambiguous or non-matching selected entry." };
    for (let index = 0; index < decision.entries.length; index += 1) {
      const entry = decision.entries[index]!;
      if (entry.index !== index || !entry.entryId || !validDispositions.has(entry.disposition)) return { severity: "error", code: "VISUAL_JOURNEY_CONNTRACK_TRACE_TABLE_INVALID", message: "Engine conntrack table is incomplete, reordered or contains an unsupported disposition." };
      if (ids.has(entry.entryId)) return { severity: "error", code: "VISUAL_JOURNEY_CONNTRACK_TRACE_ENTRY_ID_DUPLICATE", message: "Engine conntrack trace contains duplicate entry identities." };
      ids.add(entry.entryId);
      if (entry.state !== undefined && !validStates.has(entry.state)) return { severity: "error", code: "VISUAL_JOURNEY_CONNTRACK_TRACE_STATE_INVALID", message: "Engine conntrack row contains an unsupported state." };
      if (entry.selected && entry.disposition !== "MATCH") return { severity: "error", code: "VISUAL_JOURNEY_CONNTRACK_TRACE_SELECTION_INVALID", message: "Engine conntrack selected entry is not a tuple match." };
    }
    if ((decision.selectedEntryId === undefined) !== (selected.length === 0) || (decision.selectedEntryId !== undefined && selected[0]?.entryId !== decision.selectedEntryId)) {
      return { severity: "error", code: "VISUAL_JOURNEY_CONNTRACK_TRACE_SELECTION_INVALID", message: "Engine conntrack selectedEntryId disagrees with the selected table row." };
    }
    if (selected.length === 1 && decision.connectionState !== selected[0]?.state) return { severity: "error", code: "VISUAL_JOURNEY_CONNTRACK_TRACE_STATE_MISMATCH", message: "Engine conntrack selected row state disagrees with the decision state." };
    if (decision.truth === "TRUE") {
      if (selected.length !== 1 || decision.connectionState === undefined || decision.connectionState === "UNKNOWN") return { severity: "error", code: "VISUAL_JOURNEY_CONNTRACK_TRACE_TRUTH_MISMATCH", message: "TRUE conntrack trace lacks one selected row with a known state." };
    } else if (decision.truth === "FALSE") {
      if (decision.complete !== true || selected.length !== 0 || decision.connectionState !== undefined || decision.entries.some((entry) => entry.disposition === "MATCH" || entry.disposition === "INDETERMINATE" || entry.disposition === "MALFORMED")) {
        return { severity: "error", code: "VISUAL_JOURNEY_CONNTRACK_TRACE_TRUTH_MISMATCH", message: "FALSE conntrack trace is not a clean miss against a complete table." };
      }
    } else if (selected.length === 1 && decision.connectionState !== "UNKNOWN") {
      return { severity: "error", code: "VISUAL_JOURNEY_CONNTRACK_TRACE_TRUTH_MISMATCH", message: "UNKNOWN conntrack trace selects a row without UNKNOWN state." };
    }
  }
  return undefined;
}

function policyTraceDiagnostic(scenario: NormalizedScenario, path: readonly string[], reachedPath: readonly string[], decisions: readonly PolicyDecisionTrace[], conntrackDecisions: readonly ConntrackDecisionTrace[]): VisualJourneyDiagnostic | undefined {
  const resourceIds = new Set(scenario.resources.map((resource) => resource.id));
  const validKinds = new Set(["ACL", "FIREWALL"]);
  const validDispositions = new Set(["MATCH", "NO_MATCH", "DISABLED", "MALFORMED", "INDETERMINATE", "NOT_EVALUATED"]);
  const decisionKeys = new Set<string>();
  for (const decision of decisions) {
    if (!resourceIds.has(decision.resourceId)) {
      return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_RESOURCE_UNKNOWN", message: "Engine firewall/ACL trace references a resource absent from the scenario." };
    }
    if (!path.includes(decision.resourceId) || !reachedPath.includes(decision.resourceId) || decision.destinationId !== path[path.length - 1]) {
      return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_PATH_MISMATCH", message: "Engine firewall/ACL trace is not bound to the proven reached path and destination." };
    }
    if (!validKinds.has(decision.kind)) {
      return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_KIND_INVALID", message: "Engine firewall/ACL trace has an unsupported policy kind." };
    }
    const scenarioResource = scenario.resources.find((resource) => resource.id === decision.resourceId)!;
    if (decision.kind === "FIREWALL") {
      const expectedScope = scenarioResource.type === "network.firewall"
        ? "NETWORK"
        : scenarioResource.properties.isFirewall === true
          ? "LOCAL_HOST"
          : undefined;
      if (expectedScope === undefined || decision.firewallScope !== expectedScope) {
        return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_FIREWALL_SCOPE_MISMATCH", message: "Engine firewall trace scope disagrees with the authoritative resource classification." };
      }
    } else if (decision.firewallScope !== undefined) {
      return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_FIREWALL_SCOPE_INVALID", message: "ACL trace must not claim a firewall scope." };
    }
    const decisionKey = `${decision.kind}:${decision.resourceId}`;
    if (decisionKeys.has(decisionKey)) {
      return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_DUPLICATE", message: "Engine firewall/ACL trace contains duplicate decisions for the same policy layer and resource." };
    }
    decisionKeys.add(decisionKey);
    const selected = decision.rules.filter((rule) => rule.selected);
    if (selected.length > 1 || selected.some((rule) => rule.disposition !== "MATCH")) {
      return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_SELECTION_INVALID", message: "Engine firewall/ACL trace contains an ambiguous or non-matching selected rule." };
    }
    let terminalSeen = false;
    let indeterminateSeen = false;
    const ruleIds = new Set<string>();
    for (let index = 0; index < decision.rules.length; index += 1) {
      const rule = decision.rules[index]!;
      if (rule.index !== index || !rule.ruleId || !validDispositions.has(rule.disposition)) {
        return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_RULE_TABLE_INVALID", message: "Engine firewall/ACL trace rule table is incomplete, reordered or contains unsupported dispositions." };
      }
      if (ruleIds.has(rule.ruleId)) {
        return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_RULE_ID_DUPLICATE", message: "Engine firewall/ACL trace contains duplicate rule identities and cannot be rendered unambiguously." };
      }
      ruleIds.add(rule.ruleId);
      if (rule.connectionState !== undefined) {
        if (!["NEW", "ESTABLISHED", "RELATED", "INVALID"].includes(rule.connectionState) || !["TRUE", "FALSE", "UNKNOWN"].includes(String(rule.connectionStateMatch))) {
          return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_CONNTRACK_INVALID", message: "Stateful firewall rule lacks a valid Engine conntrack match projection." };
        }
        const conntrack = conntrackDecisions.find((candidate) => candidate.resourceId === decision.resourceId);
        const expected: TruthValue = conntrack === undefined || conntrack.truth === "UNKNOWN" || conntrack.connectionState === "UNKNOWN"
          ? "UNKNOWN"
          : conntrack.truth === "TRUE" && conntrack.connectionState === rule.connectionState
            ? "TRUE"
            : "FALSE";
        if (rule.connectionStateMatch !== expected) return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_CONNTRACK_MISMATCH", message: "Stateful firewall rule disagrees with Engine conntrack state." };
        if (rule.selected && rule.connectionStateMatch !== "TRUE") return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_CONNTRACK_SELECTION_INVALID", message: "Stateful firewall rule is selected without a proven conntrack-state match." };
      } else if (rule.connectionStateMatch !== undefined) {
        return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_CONNTRACK_INVALID", message: "Firewall rule exposes conntrack match truth without a declared connectionState." };
      }
      if (terminalSeen && rule.disposition !== "NOT_EVALUATED") {
        return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_ORDER_INVALID", message: "Engine firewall/ACL trace evaluates rules after an ordered terminal match/indeterminate decision." };
      }
      if (rule.disposition === "NOT_EVALUATED" && !terminalSeen) {
        return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_ORDER_INVALID", message: "Engine firewall/ACL trace marks a rule NOT_EVALUATED before any terminal ordered decision." };
      }
      if (rule.disposition === "INDETERMINATE") indeterminateSeen = true;
      if (rule.disposition === "MATCH" || rule.disposition === "INDETERMINATE") terminalSeen = true;
    }
    if (decision.usedDefault) {
      if (indeterminateSeen || selected.length !== 0 || decision.selectedPolicyId === undefined || decision.defaultAction === undefined) {
        return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_DEFAULT_INVALID", message: "Engine firewall/ACL default-action trace is structurally incomplete or also selects a rule." };
      }
      const expectedTruth: TruthValue = decision.defaultAction === "allow" ? "TRUE" : (decision.defaultAction === "deny" || decision.defaultAction === "block") ? "FALSE" : "UNKNOWN";
      if (decision.truth !== expectedTruth) {
        return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_TRUTH_MISMATCH", message: "Engine firewall/ACL default action disagrees with trace truth." };
      }
    } else if (selected.length === 1) {
      const rule = selected[0]!;
      if (decision.selectedPolicyId !== rule.ruleId) {
        return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_SELECTION_INVALID", message: "Engine firewall/ACL selected policy id disagrees with the selected ordered rule." };
      }
      const expectedTruth: TruthValue = rule.action === "allow" ? "TRUE" : (rule.action === "deny" || rule.action === "block") ? "FALSE" : "UNKNOWN";
      if (decision.truth !== expectedTruth) {
        return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_TRUTH_MISMATCH", message: "Engine firewall/ACL selected rule action disagrees with trace truth." };
      }
    } else if (decision.selectedPolicyId !== undefined) {
      return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_SELECTION_INVALID", message: "Engine firewall/ACL trace names a selected policy without a selected rule/default action." };
    }
    if (decision.truth === "TRUE" && !decision.usedDefault && selected.length !== 1) {
      return { severity: "error", code: "VISUAL_JOURNEY_POLICY_TRACE_TRUE_INCOMPLETE", message: "TRUE Engine firewall/ACL trace lacks an explicit selected allow rule or default action." };
    }
  }
  return undefined;
}


function samePath(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  const a = left ?? [];
  const b = right ?? [];
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function expectedPathSymmetry(forwardPath: readonly string[] | undefined, returnPath: readonly string[] | undefined): ForwardReturnPathComparisonTrace["symmetry"] {
  const forward = forwardPath ?? [];
  const returned = returnPath ?? [];
  if (forward.length === 0 && returned.length === 0) return "UNRESOLVED";
  if (forward.length === 0 || returned.length === 0) return "ASYMMETRIC";
  return samePath([...forward].reverse(), returned) ? "SYMMETRIC" : "ASYMMETRIC";
}

function projectPathSegments(
  scenario: NormalizedScenario,
  path: readonly string[] | undefined,
): { readonly segments: readonly VisualJourneyPathSegment[]; readonly diagnostic?: VisualJourneyDiagnostic } {
  if (!path?.length) return { segments: [] };
  const segments: VisualJourneyPathSegment[] = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    const from = path[index]!;
    const to = path[index + 1]!;
    const connection = connectionForHop(scenario, from, to);
    if (!connection) {
      return {
        segments,
        diagnostic: { severity: "error", code: "VISUAL_JOURNEY_PATH_COMPARISON_CONNECTION_UNMAPPED", message: `Engine comparison hop '${from}' -> '${to}' has no eligible modeled connection.` },
      };
    }
    segments.push({ connectionId: connection.id, from, to });
  }
  return { segments };
}

function dnsChainTraceDiagnostic(
  scenario: NormalizedScenario,
  transcript: ActiveProbeTranscript,
  trace: DnsChainDecisionTrace,
): VisualJourneyDiagnostic | undefined {
  if (transcript.category !== "dns" || trace.sourceId !== transcript.sourceId || trace.queryName !== transcript.queryName || trace.truth !== transcript.truth) {
    return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_BINDING_MISMATCH", message: "Engine DNS chain trace does not bind exactly to the active DNS probe." };
  }
  if (trace.resolvedAddress !== transcript.resolvedAddress || !samePath(trace.resolvedResourceIds, transcript.resolvedResourceIds)) {
    return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_ANSWER_MISMATCH", message: "Engine DNS chain answer differs from the active-probe answer projection." };
  }
  if ((trace.configuredResolversState === "ABSENT" || trace.configuredResolversState === "MALFORMED")
    && (trace.resolverAddresses.length !== 0 || trace.attempts.length !== 0 || trace.truth !== "UNKNOWN")) {
    return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_CONFIG_INVALID", message: "Unknown/malformed DNS resolver configuration cannot contain resolver attempts or decisive truth." };
  }
  if (trace.configuredResolversState === "KNOWN" && trace.attempts.length > trace.resolverAddresses.length) {
    return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_ATTEMPT_OVERFLOW", message: "DNS chain contains more resolver attempts than configured resolvers." };
  }
  const resourceById = new Map(scenario.resources.map((resource) => [resource.id, resource] as const));
  for (let index = 0; index < trace.attempts.length; index += 1) {
    const attempt = trace.attempts[index]!;
    if (attempt.index !== index || attempt.resolverAddress !== trace.resolverAddresses[index]) {
      return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_ORDER_INVALID", message: "DNS resolver attempt order differs from configured resolver order." };
    }
    if (new Set(attempt.mappedResourceIds).size !== attempt.mappedResourceIds.length
      || attempt.mappedResourceIds.some((id) => resourceById.get(id)?.type !== "network.dns_server")) {
      return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_MAPPING_INVALID", message: "DNS resolver mapping references duplicate, missing or non-DNS resources." };
    }
    if (attempt.disposition === "UNMAPPED" && (attempt.mappedResourceIds.length !== 0 || attempt.selectedResourceId !== undefined)) {
      return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_MAPPING_INVALID", message: "UNMAPPED DNS attempt contains a fabricated resolver resource." };
    }
    if (attempt.disposition === "AMBIGUOUS_MAPPING" && (attempt.mappedResourceIds.length < 2 || attempt.selectedResourceId !== undefined)) {
      return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_MAPPING_INVALID", message: "Ambiguous DNS mapping does not contain multiple unselected resolver resources." };
    }
    if (attempt.selectedResourceId !== undefined
      && (attempt.mappedResourceIds.length !== 1 || attempt.mappedResourceIds[0] !== attempt.selectedResourceId)) {
      return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_SELECTION_INVALID", message: "DNS selected resolver is inconsistent with resolver-address mapping." };
    }
    if (attempt.networkPath?.length) {
      if (attempt.networkPath[0] !== transcript.sourceId || attempt.networkPath[attempt.networkPath.length - 1] !== attempt.selectedResourceId) {
        return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_NETWORK_PATH_INVALID", message: "DNS resolver network path does not run from probe source to selected resolver." };
      }
      if (attempt.networkBlockingPoint && !attempt.networkPath.includes(attempt.networkBlockingPoint)) {
        return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_NETWORK_PATH_INVALID", message: "DNS resolver blocking point is absent from the resolver network path." };
      }
    }
    if (attempt.disposition === "NETWORK_BLOCKED" && attempt.networkTruth !== "FALSE") {
      return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_STAGE_INVALID", message: "NETWORK_BLOCKED DNS attempt lacks FALSE network truth." };
    }
    if (attempt.disposition === "NETWORK_UNKNOWN" && attempt.networkTruth !== "UNKNOWN") {
      return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_STAGE_INVALID", message: "NETWORK_UNKNOWN DNS attempt lacks UNKNOWN network truth." };
    }
    if (["SERVICE_DISABLED","SERVICE_UNKNOWN","RECORDS_UNKNOWN","NO_RECORD","RECORD_AMBIGUOUS","RECORD_MALFORMED","RESOLVED"].includes(attempt.disposition)
      && attempt.networkTruth !== "TRUE") {
      return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_STAGE_INVALID", message: "DNS application-stage attempt lacks proven resolver network reachability." };
    }
    if (attempt.disposition === "SERVICE_DISABLED" && !(attempt.serviceState === "KNOWN" && attempt.serviceEnabled === false)) {
      return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_STAGE_INVALID", message: "Disabled DNS service disposition contradicts service evidence." };
    }
    if (attempt.disposition === "NO_RECORD" && !(attempt.serviceEnabled === true && attempt.recordsState === "KNOWN" && attempt.matchedRecordCount === 0)) {
      return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_STAGE_INVALID", message: "NO_RECORD DNS disposition contradicts record evidence." };
    }
    if (attempt.disposition === "RESOLVED") {
      if (!(attempt.serviceEnabled === true && attempt.recordsState === "KNOWN" && attempt.matchedRecordCount === 1 && typeof attempt.answerAddress === "string")) {
        return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_STAGE_INVALID", message: "RESOLVED DNS disposition lacks complete answer evidence." };
      }
      if (new Set(attempt.answerResourceIds ?? []).size !== (attempt.answerResourceIds ?? []).length
        || (attempt.answerResourceIds ?? []).some((id) => !resourceById.has(id))) {
        return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_ANSWER_RESOURCE_INVALID", message: "DNS answer mapping contains duplicate or unknown resources." };
      }
    }
  }
  const resolved = trace.attempts.filter((attempt) => attempt.disposition === "RESOLVED");
  if (trace.truth === "TRUE") {
    const selected = resolved[0];
    if (resolved.length !== 1 || !selected
      || trace.selectedResolverAddress !== selected.resolverAddress
      || trace.selectedResolverResourceId !== selected.selectedResourceId
      || trace.resolvedAddress !== selected.answerAddress
      || !samePath(trace.resolvedResourceIds, selected.answerResourceIds)) {
      return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_SUCCESS_INVALID", message: "TRUE DNS chain does not have one coherent selected resolver and answer." };
    }
  } else if (resolved.length !== 0 || trace.resolvedAddress !== undefined || trace.resolvedResourceIds !== undefined) {
    return { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_NONTRUE_ANSWER", message: "Non-TRUE DNS chain must not contain a fabricated resolved answer." };
  }
  return undefined;
}


function dhcpDoraTraceDiagnostic(
  scenario: NormalizedScenario,
  transcript: ActiveProbeTranscript,
  trace: DhcpDoraDecisionTrace,
): VisualJourneyDiagnostic | undefined {
  if (transcript.category !== "dhcp" || trace.clientId !== transcript.sourceId || trace.truth !== transcript.truth) {
    return { severity: "error", code: "VISUAL_JOURNEY_DHCP_TRACE_BINDING_MISMATCH", message: "Engine DHCP DORA trace does not bind exactly to the active DHCP probe." };
  }
  if (transcript.destinationId !== undefined || (transcript.path?.length ?? 0) !== 0 || transcript.protocol !== undefined || transcript.port !== undefined) {
    return { severity: "error", code: "VISUAL_JOURNEY_DHCP_PACKET_PATH_FABRICATED", message: "DHCP DORA probe must not masquerade as an ordinary destination packet-path transcript." };
  }
  const expectedStages = ["DISCOVER", "OFFER", "REQUEST", "ACK"] as const;
  if (trace.stages.length !== expectedStages.length || trace.stages.some((row, index) => row.stage !== expectedStages[index])) {
    return { severity: "error", code: "VISUAL_JOURNEY_DHCP_STAGE_ORDER_INVALID", message: "DHCP DORA stage sequence must be DISCOVER, OFFER, REQUEST, ACK exactly once." };
  }
  const resourceById = new Map(scenario.resources.map((resource) => [resource.id, resource] as const));
  const seenServers = new Set<string>();
  for (let index = 0; index < trace.attempts.length; index += 1) {
    const attempt = trace.attempts[index]!;
    if (attempt.index !== index || seenServers.has(attempt.serverResourceId) || resourceById.get(attempt.serverResourceId)?.type !== "network.dhcp_server") {
      return { severity: "error", code: "VISUAL_JOURNEY_DHCP_SERVER_ATTEMPT_INVALID", message: "DHCP attempt order contains a duplicate, unknown, or non-DHCP server." };
    }
    seenServers.add(attempt.serverResourceId);
    if (attempt.discoverPath?.length) {
      if (attempt.discoverPath[0] !== trace.clientId || attempt.discoverPath[attempt.discoverPath.length - 1] !== attempt.serverResourceId) {
        return { severity: "error", code: "VISUAL_JOURNEY_DHCP_DISCOVER_PATH_INVALID", message: "DHCP Discover path does not run from client to candidate server." };
      }
      const projection = projectPathSegments(scenario, attempt.discoverPath);
      if (projection.diagnostic) return { severity: "error", code: "VISUAL_JOURNEY_DHCP_DISCOVER_PATH_INVALID", message: "DHCP Discover path contains an unmapped topology hop." };
    }
    if (attempt.offerReturnPath?.length) {
      if (attempt.offerReturnPath[0] !== attempt.serverResourceId || attempt.offerReturnPath[attempt.offerReturnPath.length - 1] !== trace.clientId) {
        return { severity: "error", code: "VISUAL_JOURNEY_DHCP_OFFER_PATH_INVALID", message: "DHCP Offer return path does not run from candidate server back to client." };
      }
      const projection = projectPathSegments(scenario, attempt.offerReturnPath);
      if (projection.diagnostic) return { severity: "error", code: "VISUAL_JOURNEY_DHCP_OFFER_PATH_INVALID", message: "DHCP Offer return path contains an unmapped topology hop." };
    }
    if (attempt.discoverTruth === "TRUE" && !attempt.discoverPath?.length) {
      return { severity: "error", code: "VISUAL_JOURNEY_DHCP_DISCOVER_PATH_INVALID", message: "TRUE DHCP Discover truth lacks a proven L2 path." };
    }
    const afterL2 = ["SERVER_STATE_UNKNOWN","SERVER_DISABLED","POOL_EXHAUSTED","POOL_UNKNOWN","OFFERS_UNKNOWN","NO_CLIENT_OFFER","OFFER_AMBIGUOUS","OFFER_MALFORMED","OFFERED"].includes(attempt.disposition);
    if (afterL2 && (attempt.discoverTruth !== "TRUE" || attempt.offerReturnTruth !== "TRUE" || !attempt.offerReturnPath?.length)) {
      return { severity: "error", code: "VISUAL_JOURNEY_DHCP_STAGE_EVIDENCE_INVALID", message: "DHCP server-state disposition lacks proven bidirectional local L2 evidence." };
    }
    if (attempt.disposition === "OFFERED") {
      if (!(attempt.serverEnabled === true && Number.isInteger(attempt.availableLeases) && (attempt.availableLeases ?? 0) > 0
        && attempt.matchedOfferCount === 1 && typeof attempt.offeredAddress === "string" && Number.isInteger(attempt.prefixLength))) {
        return { severity: "error", code: "VISUAL_JOURNEY_DHCP_OFFER_INVALID", message: "OFFERED DHCP attempt lacks complete explicit lease evidence." };
      }
    }
  }
  const offered = trace.attempts.filter((attempt) => attempt.disposition === "OFFERED");
  if (trace.truth === "TRUE") {
    const selected = offered[0];
    if (offered.length !== 1 || !selected || trace.selectedServerResourceId !== selected.serverResourceId
      || trace.offeredAddress !== selected.offeredAddress || trace.prefixLength !== selected.prefixLength
      || trace.gateway !== selected.gateway || !samePath(trace.dnsServers, selected.dnsServers)
      || trace.stages.some((row) => row.truth !== "TRUE")) {
      return { severity: "error", code: "VISUAL_JOURNEY_DHCP_SUCCESS_INVALID", message: "TRUE DHCP DORA trace does not have one coherent selected Offer and four TRUE stages." };
    }
  } else if (trace.selectedServerResourceId !== undefined || trace.offeredAddress !== undefined || trace.prefixLength !== undefined || trace.gateway !== undefined || trace.dnsServers !== undefined) {
    return { severity: "error", code: "VISUAL_JOURNEY_DHCP_NONTRUE_LEASE", message: "Non-TRUE DHCP DORA trace must not contain a fabricated selected lease." };
  }
  if ((trace.clientState === "ABSENT" || trace.clientState === "MALFORMED") && (trace.truth !== "UNKNOWN" || trace.attempts.length !== 0)) {
    return { severity: "error", code: "VISUAL_JOURNEY_DHCP_CLIENT_STATE_INVALID", message: "Unknown/malformed DHCP client state cannot contain server attempts or decisive truth." };
  }
  return undefined;
}

function pathComparisonDiagnostic(
  scenario: NormalizedScenario,
  transcript: ActiveProbeTranscript,
  comparison: ForwardReturnPathComparisonTrace,
): VisualJourneyDiagnostic | undefined {
  if (!transcript.destinationId || comparison.sourceId !== transcript.sourceId || comparison.destinationId !== transcript.destinationId) {
    return { severity: "error", code: "VISUAL_JOURNEY_PATH_COMPARISON_ENDPOINT_MISMATCH", message: "Engine forward/return comparison does not bind to the transcript endpoints." };
  }
  if (comparison.protocol !== transcript.protocol || comparison.servicePort !== transcript.port) {
    return { severity: "error", code: "VISUAL_JOURNEY_PATH_COMPARISON_TUPLE_MISMATCH", message: "Engine forward/return comparison tuple differs from the active-probe tuple." };
  }
  if (comparison.forwardTruth !== transcript.truth || !samePath(comparison.forwardPath, transcript.path) || comparison.forwardBlockingPoint !== transcript.blockingPoint) {
    return { severity: "error", code: "VISUAL_JOURNEY_PATH_COMPARISON_FORWARD_MISMATCH", message: "Engine path-comparison forward projection differs from the authoritative probe result." };
  }
  if (comparison.returnPath?.length) {
    if (comparison.returnPath[0] !== transcript.destinationId || comparison.returnPath[comparison.returnPath.length - 1] !== transcript.sourceId) {
      return { severity: "error", code: "VISUAL_JOURNEY_PATH_COMPARISON_RETURN_ENDPOINT_MISMATCH", message: "Engine return path does not run from destination back to source." };
    }
    if (comparison.returnBlockingPoint && !comparison.returnPath.includes(comparison.returnBlockingPoint)) {
      return { severity: "error", code: "VISUAL_JOURNEY_PATH_COMPARISON_RETURN_BLOCK_INVALID", message: "Engine return blocking point is absent from the return path." };
    }
  }
  if (comparison.symmetry !== expectedPathSymmetry(comparison.forwardPath, comparison.returnPath)) {
    return { severity: "error", code: "VISUAL_JOURNEY_PATH_COMPARISON_SYMMETRY_MISMATCH", message: "Engine symmetry classification disagrees with the projected forward/return paths." };
  }
  const expectedMode = transcript.port === undefined ? "FULL" : "NETWORK_ONLY";
  const expectedStatus = expectedMode === "FULL" ? "MODELED" : "RETURN_TUPLE_NOT_MODELED";
  if (comparison.returnEvaluationMode !== expectedMode || comparison.returnSecurityStatus !== expectedStatus) {
    return { severity: "error", code: "VISUAL_JOURNEY_PATH_COMPARISON_RETURN_MODE_INVALID", message: "Engine return-path security mode is inconsistent with tuple completeness." };
  }
  if (comparison.returnEvaluationMode === "NETWORK_ONLY"
    && ((comparison.returnPolicyDecisions?.length ?? 0) > 0 || (comparison.returnNatDecisions?.length ?? 0) > 0 || (comparison.returnConntrackDecisions?.length ?? 0) > 0)) {
    return { severity: "error", code: "VISUAL_JOURNEY_PATH_COMPARISON_SECURITY_FABRICATED", message: "NETWORK_ONLY return comparison must not contain reverse firewall/NAT/conntrack decisions." };
  }
  const expectedImplication = comparison.returnEvaluationMode === "NETWORK_ONLY"
    ? ((transcript.natDecisions?.length ?? 0) > 0 || (transcript.conntrackDecisions?.length ?? 0) > 0 ? "RETURN_TUPLE_REQUIRED" : "NONE")
    : ((transcript.natDecisions?.length ?? 0) > 0 || (transcript.conntrackDecisions?.length ?? 0) > 0 || (comparison.returnNatDecisions?.length ?? 0) > 0 || (comparison.returnConntrackDecisions?.length ?? 0) > 0 ? "MODELED" : "NONE");
  if (comparison.natStateImplication !== expectedImplication) {
    return { severity: "error", code: "VISUAL_JOURNEY_PATH_COMPARISON_STATE_IMPLICATION_INVALID", message: "Engine NAT/state implication marker disagrees with the underlying decision traces." };
  }

  const returnPath = comparison.returnPath ? [...comparison.returnPath] : [];
  const returnReached = reachedPath(returnPath, comparison.returnBlockingPoint);
  const routeDiagnostic = routeTraceDiagnostic(scenario, returnPath, comparison.returnRouteDecisions ?? []);
  if (routeDiagnostic) return { ...routeDiagnostic, code: `RETURN_${routeDiagnostic.code}` };
  const neighborDiagnostic = neighborTraceDiagnostic(scenario, returnPath, comparison.returnNeighborDecisions ?? []);
  if (neighborDiagnostic) return { ...neighborDiagnostic, code: `RETURN_${neighborDiagnostic.code}` };
  const macDiagnostic = macTraceDiagnostic(scenario, returnPath, comparison.returnMacDecisions ?? []);
  if (macDiagnostic) return { ...macDiagnostic, code: `RETURN_${macDiagnostic.code}` };
  const vlanDiagnostic = vlanTraceDiagnostic(scenario, returnPath, comparison.returnVlanDecisions ?? []);
  if (vlanDiagnostic) return { ...vlanDiagnostic, code: `RETURN_${vlanDiagnostic.code}` };
  const stpDiagnostic = stpTraceDiagnostic(scenario, returnPath, comparison.returnStpDecisions ?? []);
  if (stpDiagnostic) return { ...stpDiagnostic, code: `RETURN_${stpDiagnostic.code}` };
  const natDiagnostic = natTraceDiagnostic(scenario, returnPath, returnReached, comparison.returnNatDecisions ?? []);
  if (natDiagnostic) return { ...natDiagnostic, code: `RETURN_${natDiagnostic.code}` };
  const conntrackDiagnostic = conntrackTraceDiagnostic(scenario, returnPath, returnReached, comparison.returnConntrackDecisions ?? []);
  if (conntrackDiagnostic) return { ...conntrackDiagnostic, code: `RETURN_${conntrackDiagnostic.code}` };
  const policyDiagnostic = policyTraceDiagnostic(scenario, returnPath, returnReached, comparison.returnPolicyDecisions ?? [], comparison.returnConntrackDecisions ?? []);
  if (policyDiagnostic) return { ...policyDiagnostic, code: `RETURN_${policyDiagnostic.code}` };

  const expectedInterfaces = new Map<string, { forward: string | undefined; returned: string | undefined }>();
  for (const decision of transcript.routeDecisions ?? []) {
    const current = expectedInterfaces.get(decision.resourceId) ?? { forward: undefined, returned: undefined };
    current.forward = decision.outgoingInterface;
    expectedInterfaces.set(decision.resourceId, current);
  }
  for (const decision of comparison.returnRouteDecisions ?? []) {
    const current = expectedInterfaces.get(decision.resourceId) ?? { forward: undefined, returned: undefined };
    current.returned = decision.outgoingInterface;
    expectedInterfaces.set(decision.resourceId, current);
  }
  const expectedRows = [...expectedInterfaces.entries()].sort(([a], [b]) => a.localeCompare(b, "en"));
  if (comparison.interfaceComparisons.length !== expectedRows.length) {
    return { severity: "error", code: "VISUAL_JOURNEY_PATH_COMPARISON_INTERFACE_TABLE_INVALID", message: "Engine interface comparison table is incomplete." };
  }
  for (let index = 0; index < expectedRows.length; index += 1) {
    const [resourceId, expected] = expectedRows[index]!;
    const actual = comparison.interfaceComparisons[index]!;
    const differs = expected.forward !== undefined && expected.returned !== undefined && expected.forward !== expected.returned;
    if (actual.resourceId !== resourceId || actual.forwardOutgoingInterface !== expected.forward || actual.returnOutgoingInterface !== expected.returned || actual.differs !== differs) {
      return { severity: "error", code: "VISUAL_JOURNEY_PATH_COMPARISON_INTERFACE_TABLE_INVALID", message: "Engine interface comparison row disagrees with route-decision evidence." };
    }
  }
  return undefined;
}

function buildPlaybackContract(events: readonly VisualJourneyEvent[], outcome: VisualJourneyOutcome): VisualJourneyPlaybackContract {
  const first = events[0];
  const terminal = events[events.length - 1];
  if (!first || !terminal) throw new Error("Visual Journey playback contract requires at least one event.");
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.sequence !== index + 1) throw new Error("Visual Journey playback event sequence is not contiguous.");
    if (index > 0 && event.flowId !== first.flowId) throw new Error("Visual Journey playback contains mixed flow identities.");
  }
  return {
    schemaVersion: "1.0.0",
    source: "ENGINE_EVENT_PROJECTION",
    ordering: "STRICT_SEQUENCE",
    replay: "DETERMINISTIC",
    eventCount: events.length,
    firstEventId: first.eventId,
    terminalEventId: terminal.eventId,
    outcome,
  };
}

export function buildVisualJourneyFromActiveProbe(
  scenario: NormalizedScenario,
  transcript: ActiveProbeTranscript,
): VisualJourneyBuildResult {
  const diagnostics: VisualJourneyDiagnostic[] = [];
  if (scenario.scenarioId !== transcript.scenarioId || scenario.sourceHash !== transcript.scenarioHash) {
    return {
      ok: false,
      diagnostics: [{ severity: "error", code: "VISUAL_JOURNEY_SCENARIO_MISMATCH", message: "Active-probe evidence belongs to a different scenario revision." }],
    };
  }
  const resourceIds = new Set(scenario.resources.map((resource) => resource.id));
  if (!resourceIds.has(transcript.sourceId)) {
    return {
      ok: false,
      diagnostics: [{ severity: "error", code: "VISUAL_JOURNEY_SOURCE_UNKNOWN", message: `Journey source '${transcript.sourceId}' is absent from the scenario.` }],
    };
  }
  if (transcript.destinationId && !resourceIds.has(transcript.destinationId)) {
    return {
      ok: false,
      diagnostics: [{ severity: "error", code: "VISUAL_JOURNEY_DESTINATION_UNKNOWN", message: `Journey destination '${transcript.destinationId}' is absent from the scenario.` }],
    };
  }
  if (transcript.blockingPoint && !resourceIds.has(transcript.blockingPoint)) {
    return {
      ok: false,
      diagnostics: [{ severity: "error", code: "VISUAL_JOURNEY_BLOCKING_POINT_UNKNOWN", message: `Journey blocking point '${transcript.blockingPoint}' is absent from the scenario.` }],
    };
  }

  const path = transcript.path ? [...transcript.path] : [];
  if (path.length && path[0] !== transcript.sourceId) {
    return {
      ok: false,
      diagnostics: [{ severity: "error", code: "VISUAL_JOURNEY_PATH_SOURCE_MISMATCH", message: "Probe path does not begin at the transcript source." }],
    };
  }
  if (transcript.blockingPoint && path.length && !path.includes(transcript.blockingPoint)) {
    return {
      ok: false,
      diagnostics: [{ severity: "error", code: "VISUAL_JOURNEY_BLOCKING_POINT_PATH_MISMATCH", message: "Probe blocking point is not part of the Engine-proven path." }],
    };
  }
  if (transcript.truth === "TRUE" && transcript.blockingPoint) {
    return {
      ok: false,
      diagnostics: [{ severity: "error", code: "VISUAL_JOURNEY_BLOCKING_POINT_TRUTH_MISMATCH", message: "A TRUE active-probe transcript cannot also claim a blocking point." }],
    };
  }
  if (transcript.destinationId && path.length && path[path.length - 1] !== transcript.destinationId) {
    diagnostics.push({ severity: "warning", code: "VISUAL_JOURNEY_PATH_DESTINATION_DIFFERENT", message: "Probe path terminal node differs from the requested destination; the animation will stop at the proven path only." });
  }

  const udpIcmpDiagnostic = udpIcmpTraceDiagnostic(transcript);
  if (udpIcmpDiagnostic) return { ok: false, diagnostics: [...diagnostics, udpIcmpDiagnostic] };
  const udpIcmpFailureDecision = transcript.udpIcmpFailureDecision;
  // NAT binding is checked against Engine evidence before adapting the listener validator.
  const listenerTranscript = udpIcmpFailureDecision?.protocol === "udp"
    ? { ...transcript, port: udpIcmpFailureDecision.effectiveDestinationPort! } : transcript;
  const reached = reachedPath(path, transcript.blockingPoint);
  const routeDecisions = transcript.routeDecisions ? [...transcript.routeDecisions] : [];
  const routeDiagnostic = routeTraceDiagnostic(scenario, path, routeDecisions);
  if (routeDiagnostic) return { ok: false, diagnostics: [...diagnostics, routeDiagnostic] };
  const neighborDecisions = transcript.neighborDecisions ? [...transcript.neighborDecisions] : [];
  const neighborDiagnostic = neighborTraceDiagnostic(scenario, path, neighborDecisions);
  if (neighborDiagnostic) return { ok: false, diagnostics: [...diagnostics, neighborDiagnostic] };
  const macDecisions = transcript.macDecisions ? [...transcript.macDecisions] : [];
  const macDiagnostic = macTraceDiagnostic(scenario, path, macDecisions);
  if (macDiagnostic) return { ok: false, diagnostics: [...diagnostics, macDiagnostic] };
  const vlanDecisions = transcript.vlanDecisions ? [...transcript.vlanDecisions] : [];
  const vlanDiagnostic = vlanTraceDiagnostic(scenario, path, vlanDecisions);
  if (vlanDiagnostic) return { ok: false, diagnostics: [...diagnostics, vlanDiagnostic] };
  const stpDecisions = transcript.stpDecisions ? [...transcript.stpDecisions] : [];
  const stpDiagnostic = stpTraceDiagnostic(scenario, path, stpDecisions);
  if (stpDiagnostic) return { ok: false, diagnostics: [...diagnostics, stpDiagnostic] };
  const natDecisions = transcript.natDecisions ? [...transcript.natDecisions] : [];
  const natDiagnostic = natTraceDiagnostic(scenario, path, reached, natDecisions);
  if (natDiagnostic) return { ok: false, diagnostics: [...diagnostics, natDiagnostic] };
  const conntrackDecisions = transcript.conntrackDecisions ? [...transcript.conntrackDecisions] : [];
  const conntrackDiagnostic = conntrackTraceDiagnostic(scenario, path, reached, conntrackDecisions);
  if (conntrackDiagnostic) return { ok: false, diagnostics: [...diagnostics, conntrackDiagnostic] };
  const policyDecisions = transcript.policyDecisions ? [...transcript.policyDecisions] : [];
  const policyDiagnostic = policyTraceDiagnostic(scenario, path, reached, policyDecisions, conntrackDecisions);
  if (policyDiagnostic) return { ok: false, diagnostics: [...diagnostics, policyDiagnostic] };
  const hostStackDecision = transcript.hostStackDecision;
  if (hostStackDecision) {
    const hostStackDiagnostic = hostStackTraceDiagnostic(listenerTranscript, hostStackDecision);
    if (hostStackDiagnostic) return { ok: false, diagnostics: [...diagnostics, hostStackDiagnostic] };
  }
  const listenerServiceDecision = transcript.listenerServiceDecision;
  if (listenerServiceDecision) {
    const listenerDiagnostic = listenerServiceTraceDiagnostic(listenerTranscript, listenerServiceDecision, hostStackDecision);
    if (listenerDiagnostic) return { ok: false, diagnostics: [...diagnostics, listenerDiagnostic] };
  } else if (hostStackDecision && transcript.port !== undefined && transcript.protocol !== "icmp") {
    return { ok: false, diagnostics: [...diagnostics, { severity: "error", code: "VISUAL_JOURNEY_LISTENER_TRACE_REQUIRED", message: "Port-bearing Host Stack probe lacks Engine-owned listener/service decision evidence." }] };
  }
  const tcpStateMachineDecision = transcript.tcpStateMachineDecision;
  if (tcpStateMachineDecision) {
    const tcpDiagnostic = tcpStateMachineTraceDiagnostic(scenario, transcript, tcpStateMachineDecision, hostStackDecision, listenerServiceDecision);
    if (tcpDiagnostic) return { ok: false, diagnostics: [...diagnostics, tcpDiagnostic] };
  } else if (transcript.protocol === "tcp" && transcript.port !== undefined && hostStackDecision) {
    return { ok: false, diagnostics: [...diagnostics, { severity: "error", code: "VISUAL_JOURNEY_TCP_TRACE_REQUIRED", message: "TCP port probe with Host Stack evidence lacks Engine-owned TCP state-machine trace." }] };
  }
  const dnsChainDecision = transcript.dnsChainDecision;
  if (dnsChainDecision) {
    const dnsDiagnostic = dnsChainTraceDiagnostic(scenario, transcript, dnsChainDecision);
    if (dnsDiagnostic) return { ok: false, diagnostics: [...diagnostics, dnsDiagnostic] };
  } else if (transcript.category === "dns") {
    return { ok: false, diagnostics: [...diagnostics, { severity: "error", code: "VISUAL_JOURNEY_DNS_TRACE_REQUIRED", message: "DNS active probe lacks Engine-owned DNS chain evidence." }] };
  }
  const dhcpDoraDecision = transcript.dhcpDoraDecision;
  if (dhcpDoraDecision) {
    const dhcpDiagnostic = dhcpDoraTraceDiagnostic(scenario, transcript, dhcpDoraDecision);
    if (dhcpDiagnostic) return { ok: false, diagnostics: [...diagnostics, dhcpDiagnostic] };
  } else if (transcript.category === "dhcp") {
    return { ok: false, diagnostics: [...diagnostics, { severity: "error", code: "VISUAL_JOURNEY_DHCP_TRACE_REQUIRED", message: "DHCP active probe lacks Engine-owned DORA evidence." }] };
  }
  let pathComparison: VisualJourneyPathComparison | undefined;
  if (transcript.pathComparison) {
    const comparisonDiagnostic = pathComparisonDiagnostic(scenario, transcript, transcript.pathComparison);
    if (comparisonDiagnostic) return { ok: false, diagnostics: [...diagnostics, comparisonDiagnostic] };
    const forwardProjection = projectPathSegments(scenario, transcript.pathComparison.forwardPath);
    if (forwardProjection.diagnostic) return { ok: false, diagnostics: [...diagnostics, forwardProjection.diagnostic] };
    const returnProjection = projectPathSegments(scenario, transcript.pathComparison.returnPath);
    if (returnProjection.diagnostic) return { ok: false, diagnostics: [...diagnostics, returnProjection.diagnostic] };
    pathComparison = { trace: transcript.pathComparison, forwardSegments: forwardProjection.segments, returnSegments: returnProjection.segments };
  }
  const refs = evidenceRefs(transcript);
  const flowId = `flow-${stablePart(transcript.scenarioId)}-${transcript.stateRevision}-${stablePart(transcript.probeId)}-${stablePart(transcript.sourceId)}-${stablePart(transcript.destinationId ?? transcript.queryName ?? (transcript.category === "dhcp" ? "dhcp" : "target"))}`;
  const events: VisualJourneyEvent[] = [];
  let sequence = 0;
  const push = (event: Omit<VisualJourneyEvent, "eventId" | "sequence" | "flowId" | "provenance" | "truth" | "sourceResourceId" | "evidenceRefs"> & { readonly truth?: TruthValue }): void => {
    sequence += 1;
    const { truth: eventTruth, ...eventPayload } = event;
    events.push({
      eventId: `${flowId}-evt-${String(sequence).padStart(3, "0")}`,
      sequence,
      flowId,
      provenance: "MODELED",
      truth: eventTruth ?? transcript.truth,
      sourceResourceId: transcript.sourceId,
      evidenceRefs: refs,
      ...eventPayload,
    });
  };

  push({
    kind: "flow.started",
    resourceId: transcript.sourceId,
    ...(transcript.destinationId ? { targetResourceId: transcript.destinationId } : {}),
    ...(transcript.protocol ? { protocol: transcript.protocol } : {}),
    ...(transcript.port !== undefined ? { port: transcript.port } : {}),
    summary: transcript.category === "dns"
      ? `Modeled DNS chain started at ${transcript.sourceId} for ${transcript.queryName}.`
      : transcript.category === "dhcp"
        ? `Modeled DHCP DORA started at ${transcript.sourceId}; DORA paths come only from Engine trace evidence.`
        : `Modeled ${transcript.protocol?.toUpperCase() ?? "network"} journey started at ${transcript.sourceId}.`,
  });

  const emittedPolicyIndexes = new Set<number>();
  const emittedNatIndexes = new Set<number>();
  const emittedConntrackIndexes = new Set<number>();
  const pushNatEvents = (resourceId: string, targetResourceId?: string): void => {
    natDecisions.forEach((decision, decisionIndex) => {
      if (decision.resourceId !== resourceId || emittedNatIndexes.has(decisionIndex)) return;
      emittedNatIndexes.add(decisionIndex);
      const translationSummary = decision.kind === "DNAT"
        ? `${String(decision.inputPort ?? "any")} -> ${String(decision.outputPort ?? "any")}`
        : `${decision.inputSource ?? "UNKNOWN"} -> ${decision.outputSource ?? "UNKNOWN"}`;
      push({
        kind: "nat.transform",
        resourceId,
        ...(targetResourceId ? { targetResourceId } : {}),
        truth: decision.truth,
        natDecision: decision,
        summary: decision.selectedRuleId
          ? `${decision.kind} ${decision.selectedRuleId} on ${resourceId}: ${translationSummary} (${decision.transformation}).`
          : `${decision.kind} decision on ${resourceId}: ${decision.transformation}; no authoritative selected translation rule.`,
      });
    });
  };
  const pushConntrackEvents = (resourceId: string, targetResourceId?: string): void => {
    conntrackDecisions.forEach((decision, decisionIndex) => {
      if (decision.resourceId !== resourceId || emittedConntrackIndexes.has(decisionIndex)) return;
      emittedConntrackIndexes.add(decisionIndex);
      push({
        kind: "conntrack.lookup",
        resourceId,
        ...(targetResourceId ? { targetResourceId } : {}),
        truth: decision.truth,
        conntrackDecision: decision,
        summary: decision.selectedEntryId
          ? `Conntrack ${decision.selectedEntryId} on ${resourceId}: ${decision.connectionState ?? "UNKNOWN"}.`
          : `Conntrack lookup on ${resourceId}: ${decision.truth === "FALSE" ? "complete-table miss" : "state not provable"}.`,
      });
    });
  };
  const pushPolicyEvents = (resourceId: string, targetResourceId?: string): void => {
    policyDecisions.forEach((decision, decisionIndex) => {
      if (decision.resourceId !== resourceId || emittedPolicyIndexes.has(decisionIndex)) return;
      emittedPolicyIndexes.add(decisionIndex);
      push({
        kind: "policy.decision",
        resourceId,
        ...(targetResourceId ? { targetResourceId } : {}),
        truth: decision.truth,
        policyDecision: decision,
        summary: decision.selectedPolicyId
          ? `${decision.kind}${decision.firewallScope ? ` ${decision.firewallScope}` : ""} ${decision.selectedPolicyId} on ${resourceId}: ${decision.truth}${decision.usedDefault ? " (default)" : ""}.`
          : `${decision.kind}${decision.firewallScope ? ` ${decision.firewallScope}` : ""} decision on ${resourceId}: ${decision.truth}; no authoritative selected rule/default.`,
      });
    });
  };

  for (let index = 0; index < Math.max(0, path.length - 1); index += 1) {
    const from = path[index]!;
    const to = path[index + 1]!;
    if (!reached.includes(from)) break;
    pushNatEvents(from, to);
    const routeDecision = routeDecisions.find((item) => item.resourceId === from && item.nextHopResourceId === to);
    if (routeDecision) {
      push({
        kind: "route.decision",
        resourceId: from,
        targetResourceId: to,
        truth: routeDecision.truth,
        routeDecision,
        summary: routeDecision.selectedRouteId
          ? `Route ${routeDecision.selectedRouteId} selected on ${from} for ${routeDecision.destinationId}.`
          : `No authoritative route winner on ${from} for ${routeDecision.destinationId}.`,
      });
    }
    const neighborDecision = neighborDecisions.find((item) => item.resourceId === from && item.nextHopResourceId === to);
    if (neighborDecision) {
      push({
        kind: "neighbor.decision",
        resourceId: from,
        targetResourceId: to,
        truth: neighborDecision.truth,
        neighborDecision,
        summary: neighborDecision.selectedEntryId
          ? `${neighborDecision.selectedProtocol} neighbor ${neighborDecision.selectedAddress} is ${neighborDecision.selectedState} on ${from}.`
          : `No authoritative ARP/ND entry selected on ${from} for ${to}.`,
      });
    }
    const vlanDecision = index > 0 ? vlanDecisions.find((item) => item.sourceResourceId === path[index - 1] && item.resourceId === from && item.nextHopResourceId === to) : undefined;
    const macDecision = index > 0 ? macDecisions.find((item) => item.sourceResourceId === path[index - 1] && item.resourceId === from && item.nextHopResourceId === to) : undefined;
    const stpDecision = index > 0 ? stpDecisions.find((item) => item.sourceResourceId === path[index - 1] && item.resourceId === from && item.nextHopResourceId === to) : undefined;
    let projectedMac: ReturnType<typeof projectedMacConnections> | undefined;
    if (macDecision) {
      projectedMac = projectedMacConnections(scenario, macDecision);
      if (projectedMac.diagnostic) return { ok: false, diagnostics: [...diagnostics, projectedMac.diagnostic] };
      const learningTruth: TruthValue = macDecision.learning === "UNKNOWN" ? "UNKNOWN" : "TRUE";
      push({
        kind: "mac.learn",
        resourceId: from,
        targetResourceId: to,
        truth: learningTruth,
        macDecision,
        summary: `Source MAC ${macDecision.sourceMac ?? "UNKNOWN"} on ${from}: ${macDecision.learning}.`,
      });
    }
    if (vlanDecision) {
      push({
        kind: "vlan.classify",
        resourceId: from,
        targetResourceId: to,
        truth: vlanDecision.truth,
        vlanDecision,
        summary: vlanDecision.vlan !== undefined
          ? `VLAN ${vlanDecision.vlan} classified on ${from} ingress ${vlanDecision.ingressInterface ?? "UNKNOWN"}.`
          : `No authoritative VLAN classification on ${from}.`,
      });
    }
    if (macDecision) {
      const lookupTruth: TruthValue = macDecision.forwarding === "UNKNOWN" ? "UNKNOWN" : "TRUE";
      push({
        kind: "mac.lookup",
        resourceId: from,
        targetResourceId: to,
        truth: lookupTruth,
        macDecision,
        summary: `Destination MAC ${macDecision.destinationMac ?? "UNKNOWN"} lookup on ${from}: ${macDecision.forwarding}.`,
      });
    }
    if (stpDecision) {
      for (const port of stpDecision.ports.filter((candidate) => candidate.bpdu === "SEND" || candidate.bpdu === "RECEIVE")) {
        const projectedBpdu = projectedStpConnection(scenario, stpDecision, port.interfaceId);
        if (projectedBpdu.diagnostic) return { ok: false, diagnostics: [...diagnostics, projectedBpdu.diagnostic] };
        push({
          kind: "stp.bpdu",
          resourceId: from,
          targetResourceId: to,
          truth: port.bpdu === "UNKNOWN" ? "UNKNOWN" : "TRUE",
          ...(projectedBpdu.connectionIds?.length ? { projectedConnectionIds: projectedBpdu.connectionIds } : {}),
          stpDecision,
          stpPort: port,
          summary: `${stpDecision.protocol ?? "STP"} BPDU ${port.bpdu} on ${from}.${port.interfaceId}.`,
        });
      }
      const projectedStp = projectedStpConnection(scenario, stpDecision);
      if (projectedStp.diagnostic) return { ok: false, diagnostics: [...diagnostics, projectedStp.diagnostic] };
      push({
        kind: "stp.decision",
        resourceId: from,
        targetResourceId: to,
        truth: stpDecision.truth,
        ...(projectedStp.connectionIds?.length ? { projectedConnectionIds: projectedStp.connectionIds } : {}),
        stpDecision,
        summary: `STP data-plane decision on ${from}: ${stpDecision.truth} via ${stpDecision.egressInterface ?? "UNKNOWN"}.`,
      });
    }
    if (macDecision && (!stpDecision || stpDecision.truth === "TRUE")) {
      push({
        kind: macDecision.forwarding === "FLOOD" || macDecision.forwarding === "BROADCAST" ? "mac.flood" : "mac.forward",
        resourceId: from,
        targetResourceId: to,
        truth: macDecision.truth,
        ...(projectedMac?.connectionIds?.length ? { projectedConnectionIds: projectedMac.connectionIds } : {}),
        macDecision,
        summary: macDecision.forwarding === "FLOOD" || macDecision.forwarding === "BROADCAST"
          ? `${macDecision.forwarding} on ${from} to ${macDecision.floodInterfaces?.join(", ") || "UNKNOWN"}.`
          : `${macDecision.forwarding} on ${from}${macDecision.selectedEgressInterface ? ` via ${macDecision.selectedEgressInterface}` : ""}.`,
      });
    }
    if (vlanDecision?.truth === "TRUE") {
      const projectedVlan = projectedVlanConnection(scenario, vlanDecision);
      if (projectedVlan.diagnostic) return { ok: false, diagnostics: [...diagnostics, projectedVlan.diagnostic] };
      const kind: VisualJourneyEventKind = vlanDecision.rewrite === "ADD_TAG"
        ? "vlan.tag"
        : vlanDecision.rewrite === "REMOVE_TAG"
          ? "vlan.untag"
          : "vlan.forward";
      push({
        kind,
        resourceId: from,
        targetResourceId: to,
        truth: vlanDecision.truth,
        ...(projectedVlan.connectionIds?.length ? { projectedConnectionIds: projectedVlan.connectionIds } : {}),
        vlanDecision,
        summary: `VLAN ${vlanDecision.vlan} egress ${vlanDecision.egressInterface ?? "UNKNOWN"}: ${vlanDecision.rewrite} -> ${vlanDecision.egressTag ?? "UNKNOWN"}.`,
      });
    }
    pushConntrackEvents(from, to);
    pushPolicyEvents(from, to);
    if (index >= reached.length - 1) break;
    const connection = connectionForHop(scenario, from, to);
    if (!connection) {
      return {
        ok: false,
        diagnostics: [...diagnostics, { severity: "error", code: "VISUAL_JOURNEY_CONNECTION_UNMAPPED", message: `Engine path hop '${from}' -> '${to}' has no enabled network/management connection to render.` }],
      };
    }
    push({
      kind: "flow.segment",
      resourceId: from,
      targetResourceId: to,
      connectionId: connection.id,
      ...(transcript.protocol ? { protocol: transcript.protocol } : {}),
      ...(transcript.port !== undefined ? { port: transcript.port } : {}),
      summary: `${from} -> ${to} across ${connection.id}.`,
    });
  }

  const reachedTerminal = reached[reached.length - 1];
  if (reachedTerminal) {
    pushNatEvents(reachedTerminal, transcript.destinationId);
    pushConntrackEvents(reachedTerminal, transcript.destinationId);
    pushPolicyEvents(reachedTerminal, transcript.destinationId);
  }

  if (hostStackDecision) {
    push({
      kind: "hoststack.decision",
      resourceId: hostStackDecision.resourceId,
      ...(transcript.destinationId ? { targetResourceId: transcript.destinationId } : {}),
      truth: hostStackDecision.truth,
      hostStackDecision,
      summary: `Host Stack on ${hostStackDecision.resourceId}: ${hostStackDecision.truth}; snapshot ${hostStackDecision.complete ? "COMPLETE" : "INCOMPLETE"}.`,
    });
  }
  if (listenerServiceDecision) {
    push({
      kind: "listener.service",
      resourceId: listenerServiceDecision.resourceId,
      ...(transcript.destinationId ? { targetResourceId: transcript.destinationId } : {}),
      truth: listenerServiceDecision.truth,
      listenerServiceDecision,
      summary: `Listener/service on ${listenerServiceDecision.resourceId}${listenerServiceDecision.port !== undefined ? `:${listenerServiceDecision.port}` : ""}: ${listenerServiceDecision.disposition}.`,
    });
  }
  if (tcpStateMachineDecision) {
    push({
      kind: "tcp.state",
      resourceId: tcpStateMachineDecision.destinationId,
      targetResourceId: tcpStateMachineDecision.destinationId,
      truth: tcpStateMachineDecision.truth,
      tcpStateMachineDecision,
      protocol: "tcp",
      port: tcpStateMachineDecision.port,
      summary: `TCP state on ${tcpStateMachineDecision.destinationId}:${tcpStateMachineDecision.port}: ${tcpStateMachineDecision.disposition}.`,
    });
  }

  const outcome = visualJourneyOutcome(transcript, reached);
  const terminal = udpIcmpFailureDecision ? "diagnosed" : terminalKind(transcript, path, outcome);
  const terminalResource = outcome.anchorResourceId
    ?? (terminal === "arrived" ? transcript.destinationId : undefined)
    ?? transcript.blockingPoint
    ?? reached[reached.length - 1]
    ?? transcript.sourceId;
  const terminalTarget = transcript.destinationId ?? path[path.length - 1];
  const terminalEventKind: VisualJourneyEventKind = udpIcmpFailureDecision
    ? udpIcmpFailureDecision.protocol === "udp" ? "udp.failure" : "icmp.failure"
    : dhcpDoraDecision
    ? "dhcp.dora"
    : dnsChainDecision
      ? "dns.resolve"
    : terminal === "arrived"
      ? "flow.arrived"
      : terminal === "uncertain"
        ? "flow.uncertain"
        : terminal === "no_path"
          ? "route.no_path"
          : "flow.dropped";
  const terminalSummary = udpIcmpFailureDecision
    ? udpIcmpFailureDecision.explanation.join(" ")
    : dhcpDoraDecision
    ? `DHCP DORA concluded ${dhcpDoraDecision.truth}; this terminal marker is DHCP state truth, not a fabricated routed packet drop/arrival path.`
    : dnsChainDecision
      ? `DNS chain ${dnsChainDecision.queryName} concluded ${dnsChainDecision.truth}; this terminal marker is DNS truth, not a fabricated packet drop/arrival path.`
    : terminal === "arrived"
      ? `Journey arrived at ${terminalResource}. ${outcome.reason}`
      : terminal === "uncertain"
        ? `Journey became UNKNOWN at ${terminalResource}; later motion is not fabricated. ${outcome.reason}`
        : terminal === "no_path"
          ? `No declared topology path is proven from ${transcript.sourceId}${terminalTarget ? ` to ${terminalTarget}` : ""}. ${outcome.reason}`
          : `Journey stopped at ${terminalResource}; later topology nodes are not shown as reached. ${outcome.reason}`;
  push({
    kind: terminalEventKind,
    ...(udpIcmpFailureDecision ? { udpIcmpFailureDecision } : {}),
    resourceId: dhcpDoraDecision?.selectedServerResourceId ?? dnsChainDecision?.selectedResolverResourceId ?? terminalResource,
    ...(terminalTarget ? { targetResourceId: terminalTarget } : {}),
    ...(transcript.protocol ? { protocol: transcript.protocol } : {}),
    ...(transcript.port !== undefined ? { port: transcript.port } : {}),
    ...(dnsChainDecision ? { dnsChainDecision } : {}),
    ...(dhcpDoraDecision ? { dhcpDoraDecision } : {}),
    outcome,
    summary: terminalSummary,
  });

  return {
    ok: true,
    diagnostics,
    model: {
      flowId,
      scenarioId: transcript.scenarioId,
      scenarioHash: transcript.scenarioHash,
      stateRevision: transcript.stateRevision,
      sourceId: transcript.sourceId,
      ...(transcript.destinationId ? { destinationId: transcript.destinationId } : {}),
      ...(transcript.protocol ? { protocol: transcript.protocol } : {}),
      ...(transcript.port !== undefined ? { port: transcript.port } : {}),
      truth: transcript.truth,
      path,
      reachedPath: reached,
      ...(transcript.blockingPoint ? { blockingPoint: transcript.blockingPoint } : {}),
      terminalKind: terminal,
      outcome,
      playback: buildPlaybackContract(events, outcome),
      evidenceRefs: refs,
      routeDecisions,
      neighborDecisions,
      macDecisions,
      vlanDecisions,
      stpDecisions,
      natDecisions,
      conntrackDecisions,
      policyDecisions,
      ...(pathComparison ? { pathComparison } : {}),
      ...(hostStackDecision ? { hostStackDecision } : {}),
      ...(listenerServiceDecision ? { listenerServiceDecision } : {}),
      ...(tcpStateMachineDecision ? { tcpStateMachineDecision } : {}),
      ...(udpIcmpFailureDecision ? { udpIcmpFailureDecision } : {}),
      ...(dnsChainDecision ? { dnsChainDecision } : {}),
      ...(dhcpDoraDecision ? { dhcpDoraDecision } : {}),
      events,
    },
  };
}

export function visualJourneyFrame(model: VisualJourneyModel, cursor: number): VisualJourneyFrame {
  const clamped = Math.min(Math.max(Math.trunc(cursor), 0), model.events.length - 1);
  const event = model.events[clamped]!;
  const completedConnectionIds = model.events
    .slice(0, clamped)
    .filter((item): item is VisualJourneyEvent & { readonly connectionId: string } => item.kind === "flow.segment" && typeof item.connectionId === "string")
    .map((item) => item.connectionId);
  const activeConnectionIds = event.kind === "flow.segment"
    ? (event.connectionId ? [event.connectionId] : [])
    : [...(event.projectedConnectionIds ?? [])];
  const activeConnectionId = activeConnectionIds.length === 1 ? activeConnectionIds[0] : undefined;
  const terminalState = event.kind === "udp.failure" || event.kind === "icmp.failure"
    ? "diagnosed"
    : event.kind === "flow.arrived"
    ? "arrived"
    : event.kind === "flow.dropped"
      ? "dropped"
      : event.kind === "flow.uncertain"
        ? "uncertain"
        : event.kind === "route.no_path"
          ? "no_path"
          : undefined;
  return {
    cursor: clamped,
    event,
    completedConnectionIds,
    activeConnectionIds,
    ...(activeConnectionId ? { activeConnectionId } : {}),
    ...(event.kind === "flow.segment" && event.targetResourceId ? { activeDirection: { from: event.resourceId ?? model.sourceId, to: event.targetResourceId } } : {}),
    currentResourceId: event.kind === "flow.segment" ? (event.targetResourceId ?? event.resourceId ?? model.sourceId) : (event.resourceId ?? model.sourceId),
    ...(terminalState ? { terminalState } : {}),
    ...(event.outcome ? { outcome: event.outcome } : {}),
  };
}

function visualJourneyXRayDecisionKind(event: VisualJourneyEvent): VisualJourneyXRayDecisionKind {
  if (event.kind === "route.decision" || event.kind === "route.no_path") return "ROUTING";
  if (event.kind === "neighbor.decision") return "ARP_ND";
  if (event.kind.startsWith("mac.")) return "MAC_CAM";
  if (event.kind.startsWith("vlan.")) return "VLAN";
  if (event.kind.startsWith("stp.")) return "STP_BPDU";
  if (event.kind === "nat.transform") return "NAT_PAT";
  if (event.kind === "conntrack.lookup") return "CONNTRACK";
  if (event.kind === "policy.decision") return "FIREWALL_ACL";
  if (event.kind === "hoststack.decision") return "HOST_STACK";
  if (event.kind === "listener.service") return "LISTENER_SERVICE";
  if (event.kind === "tcp.state") return "TCP_STATE";
  if (event.kind === "udp.failure" || event.kind === "icmp.failure") return "UDP_ICMP";
  if (event.kind === "dns.resolve") return "DNS";
  if (event.kind === "dhcp.dora") return "DHCP";
  if (event.kind === "mtu.evaluation") return "MTU";
  return "FLOW";
}

export function visualJourneyXRayFrame(model: VisualJourneyModel, cursor: number): VisualJourneyXRayFrame {
  const frame = visualJourneyFrame(model, cursor);
  const event = frame.event;
  return {
    schemaVersion: "1.0.0",
    source: "ENGINE_EVENT_PROJECTION",
    cursor: frame.cursor,
    eventCount: model.events.length,
    eventId: event.eventId,
    sequence: event.sequence,
    eventKind: event.kind,
    decisionKind: visualJourneyXRayDecisionKind(event),
    flowId: event.flowId,
    provenance: event.provenance,
    truth: event.truth,
    sourceResourceId: event.sourceResourceId,
    currentResourceId: frame.currentResourceId,
    ...(event.targetResourceId ? { targetResourceId: event.targetResourceId } : {}),
    ...(event.connectionId ? { connectionId: event.connectionId } : {}),
    projectedConnectionIds: [...(event.projectedConnectionIds ?? [])],
    ...(event.protocol ? { protocol: event.protocol } : {}),
    ...(event.port !== undefined ? { port: event.port } : {}),
    evidenceRefs: [...event.evidenceRefs],
    summary: event.summary,
    ...(event.outcome ? { outcome: event.outcome } : {}),
  };
}
