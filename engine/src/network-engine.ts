import type { NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import { isRecord } from "./json.js";
import { queryHostStackView, queryListeningPort } from "./service-engine.js";
import { queryTcpStateMachine } from "./tcp-engine.js";
import { withUdpIcmpFailureDiagnostic } from "./udp-icmp-engine.js";
import { addressInCidr, parseCidr, parseIpAddress } from "./ip.js";
import type { ConntrackDecisionTrace, ConntrackEntryTrace, ConntrackState, EngineQueryResult, EngineState, ForwardReturnPathComparisonTrace, HostStackDecisionTrace, ListenerServiceDecisionTrace, TcpStateMachineDecisionTrace, PathInterfaceComparisonTrace, MacCandidateTrace, MacDecisionTrace, MacForwardingDisposition, MacLearningDisposition, NatDecisionTrace, NatRuleTrace, NeighborCandidateTrace, NeighborDecisionTrace, NeighborProtocol, NeighborState, ReachabilityDetails, PolicyDecisionTrace, PolicyRuleTrace, FirewallScope, RouteCandidateTrace, RouteDecisionTrace, RuntimeResourceState, StpBpduDisposition, StpDecisionTrace, StpPortRole, StpPortState, StpPortTrace, StpProtocol, TruthValue, VlanDecisionTrace, VlanPortMode, VlanPortTrace, VlanRewriteDisposition, VlanTagState } from "./types.js";

interface FlowQuery {
  readonly from: string;
  readonly to: string;
  readonly protocol: "tcp" | "udp" | "icmp" | "any";
  readonly port?: number;
}

interface PathEvaluationOptions {
  readonly includeSecurity?: boolean;
  readonly includeListener?: boolean;
}

interface PathVerdict {
  readonly networkTruthBeforeListener?: TruthValue;
  readonly truth: TruthValue;
  readonly path: readonly string[];
  readonly explanation: readonly string[];
  readonly blockingPoint?: string;
  readonly matchedPolicy?: string;
  readonly translatedPort?: number;
  readonly translatedSource?: string;
  readonly matchedSnatRule?: string;
  readonly routeDecisions?: readonly RouteDecisionTrace[];
  readonly neighborDecisions?: readonly NeighborDecisionTrace[];
  readonly macDecisions?: readonly MacDecisionTrace[];
  readonly vlanDecisions?: readonly VlanDecisionTrace[];
  readonly stpDecisions?: readonly StpDecisionTrace[];
  readonly policyDecisions?: readonly PolicyDecisionTrace[];
  readonly natDecisions?: readonly NatDecisionTrace[];
  readonly conntrackDecisions?: readonly ConntrackDecisionTrace[];
  readonly hostStackDecision?: HostStackDecisionTrace;
  readonly listenerServiceDecision?: ListenerServiceDecisionTrace;
  readonly tcpStateMachineDecision?: TcpStateMachineDecisionTrace;
}

interface PolicyVerdict {
  readonly truth: TruthValue;
  readonly explanation: readonly string[];
  readonly policy?: string;
  readonly routeDecision?: RouteDecisionTrace;
  readonly neighborDecision?: NeighborDecisionTrace;
  readonly macDecision?: MacDecisionTrace;
  readonly vlanDecision?: VlanDecisionTrace;
  readonly stpDecision?: StpDecisionTrace;
  readonly policyDecision?: PolicyDecisionTrace;
  readonly natDecision?: NatDecisionTrace;
  readonly conntrackDecision?: ConntrackDecisionTrace;
  readonly vlanFrame?: VlanFrameContext;
}


function targetAddresses(state: EngineState, resourceId: string): readonly string[] {
  const resource = state.resources[resourceId];
  if (!resource) return [];
  return resource.interfaces.flatMap((iface) => {
    const addresses = iface.addresses;
    return Array.isArray(addresses) ? addresses.filter((value): value is string => typeof value === "string") : [];
  });
}

function routeMatchScore(destination: string, state: EngineState, query: FlowQuery): number | undefined {
  if (destination === query.to) return 10000;
  const zone = state.resources[query.to]?.zone;
  if (zone !== undefined && destination === zone) return 9000;
  if (destination === "default" || destination === "any" || destination === "*") return 1;
  if (state.resources[destination]) return -1;
  if (Object.values(state.resources).some((resource) => resource.zone === destination)) return -1;
  const cidr = parseCidr(destination);
  if (!cidr) return undefined;
  const addresses = targetAddresses(state, query.to);
  for (const address of addresses) {
    if (!parseIpAddress(address)) continue;
    if (addressInCidr(address, destination) === true) return 100 + cidr.prefix;
  }
  return -1;
}

function evaluateRoute(
  state: EngineState,
  resourceId: string,
  nextHop: string,
  query: FlowQuery,
): PolicyVerdict | undefined {
  const resource = state.resources[resourceId];
  if (!resource) return { truth: "UNKNOWN", explanation: [`Route evaluator cannot find '${resourceId}'.`] };
  const rawRoutes = resource.properties.routes;
  if (rawRoutes === undefined) return undefined;
  const decision = (
    truth: TruthValue,
    candidates: readonly RouteCandidateTrace[],
    explanation: readonly string[],
    selected?: Readonly<Record<string, unknown>>,
    selectedRouteId?: string,
  ): RouteDecisionTrace => ({
    resourceId,
    destinationId: query.to,
    nextHopResourceId: nextHop,
    truth,
    candidates,
    ...(selectedRouteId ? { selectedRouteId } : {}),
    ...(typeof selected?.via === "string" ? { declaredNextHop: selected.via } : {}),
    ...(typeof selected?.interface === "string" ? { outgoingInterface: selected.interface } : {}),
    explanation,
  });
  if (!Array.isArray(rawRoutes)) {
    const explanation = [`Resource '${resourceId}' declares routes, but routes is not an array.`];
    return { truth: "UNKNOWN", explanation, routeDecision: decision("UNKNOWN", [], explanation) };
  }
  const candidates: { index: number; score: number; route: Readonly<Record<string, unknown>> }[] = [];
  const candidateTraces: RouteCandidateTrace[] = [];
  let malformed = false;
  let addressDependent = false;
  for (let index = 0; index < rawRoutes.length; index += 1) {
    const raw = rawRoutes[index];
    const generatedId = `${resourceId}.routes[${index}]`;
    if (!isRecord(raw)) {
      malformed = true;
      candidateTraces.push({ index, routeId: generatedId, disposition: "MALFORMED", selected: false });
      continue;
    }
    const routeId = typeof raw.id === "string" ? raw.id : generatedId;
    const visible = {
      index,
      routeId,
      selected: false,
      ...(typeof raw.destination === "string" ? { destination: raw.destination } : {}),
      ...(typeof raw.action === "string" ? { action: raw.action } : {}),
      ...(typeof raw.via === "string" ? { via: raw.via } : {}),
      ...(typeof raw.interface === "string" ? { outgoingInterface: raw.interface } : {}),
      ...(typeof raw.metric === "number" && Number.isFinite(raw.metric) ? { declaredMetric: raw.metric } : {}),
      ...(typeof raw.preference === "number" && Number.isFinite(raw.preference) ? { declaredPreference: raw.preference } : {}),
    };
    if (raw.enabled === false) {
      candidateTraces.push({ ...visible, disposition: "DISABLED" });
      continue;
    }
    if ((raw.enabled !== undefined && raw.enabled !== true) || typeof raw.destination !== "string") {
      malformed = true;
      candidateTraces.push({ ...visible, disposition: "MALFORMED" });
      continue;
    }
    if (parseCidr(raw.destination)) addressDependent = true;
    const score = routeMatchScore(raw.destination, state, query);
    if (score === undefined) {
      malformed = true;
      candidateTraces.push({ ...visible, disposition: "MALFORMED" });
      continue;
    }
    const cidr = parseCidr(raw.destination);
    candidateTraces.push({ ...visible, ...(cidr ? { prefixLength: cidr.prefix } : {}), disposition: score >= 0 ? "MATCH" : "NO_MATCH" });
    if (score >= 0) candidates.push({ index, score, route: raw });
  }
  if (candidates.length === 0) {
    if (malformed || (addressDependent && targetAddresses(state, query.to).length === 0)) {
      const explanation = [`Routing table on '${resourceId}' cannot be safely resolved for destination '${query.to}'.`];
      return { truth: "UNKNOWN", explanation, routeDecision: decision("UNKNOWN", candidateTraces, explanation) };
    }
    const explanation = [`Authoritative routing table on '${resourceId}' has no route to '${query.to}'.`];
    return { truth: "FALSE", policy: `${resourceId}.routes`, explanation, routeDecision: decision("FALSE", candidateTraces, explanation) };
  }
  const bestScore = Math.max(...candidates.map((entry) => entry.score));
  const best = candidates.filter((entry) => entry.score === bestScore);
  if (best.length > 1) {
    const signatures = new Set(best.map((entry) => `${String(entry.route.action ?? "forward")}|${String(entry.route.via ?? "")}|${String(entry.route.interface ?? "")}`));
    if (signatures.size > 1) {
      const explanation = [`Routing table on '${resourceId}' has equally-specific conflicting routes for '${query.to}'.`];
      return { truth: "UNKNOWN", explanation, routeDecision: decision("UNKNOWN", candidateTraces, explanation) };
    }
  }
  const chosen = best[0]!;
  const route = chosen.route;
  const name = typeof route.id === "string" ? route.id : `${resourceId}.routes[${chosen.index}]`;
  const selectedCandidates = candidateTraces.map((item) => ({ ...item, selected: item.index === chosen.index }));
  const action = route.action ?? "forward";
  if (action === "blackhole" || action === "unreachable" || action === "prohibit" || action === "deny" || action === "block") {
    const explanation = [`Route '${name}' on '${resourceId}' explicitly blocks/blackholes destination '${query.to}'.`];
    return { truth: "FALSE", policy: name, explanation, routeDecision: decision("FALSE", selectedCandidates, explanation, route, name) };
  }
  if (action !== "forward" && action !== "allow") {
    const explanation = [`Route '${name}' on '${resourceId}' has unsupported action '${String(action)}'.`];
    return { truth: "UNKNOWN", policy: name, explanation, routeDecision: decision("UNKNOWN", selectedCandidates, explanation, route, name) };
  }
  if (route.interface !== undefined) {
    if (typeof route.interface !== "string" || !resource.interfaces.some((iface) => iface.id === route.interface)) {
      const explanation = [`Route '${name}' references an undeclared interface on '${resourceId}'.`];
      return { truth: "UNKNOWN", policy: name, explanation, routeDecision: decision("UNKNOWN", selectedCandidates, explanation, route, name) };
    }
  }
  if (route.via !== undefined) {
    if (typeof route.via !== "string") {
      const explanation = [`Route '${name}' has non-string via data.`];
      return { truth: "UNKNOWN", policy: name, explanation, routeDecision: decision("UNKNOWN", selectedCandidates, explanation, route, name) };
    }
    const nextAddresses = targetAddresses(state, nextHop).map((value) => value.includes("/") ? value.slice(0, value.indexOf("/")) : value);
    if (route.via !== nextHop && !nextAddresses.includes(route.via)) {
      const explanation = [`Route '${name}' forwards via '${route.via}', not the declared next hop '${nextHop}'.`];
      return { truth: "FALSE", policy: name, explanation, routeDecision: decision("FALSE", selectedCandidates, explanation, route, name) };
    }
  }
  const explanation = [`Route '${name}' on '${resourceId}' selects the declared next hop '${nextHop}'.`];
  return { truth: "TRUE", policy: name, explanation, routeDecision: decision("TRUE", selectedCandidates, explanation, route, name) };
}

const NEIGHBOR_STATES = new Set<NeighborState>(["REACHABLE", "STALE", "INCOMPLETE", "FAILED", "UNKNOWN"]);
const NEIGHBOR_PROTOCOLS = new Set<NeighborProtocol>(["ARP", "ND"]);
const MAC_ADDRESS = /^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}$/;
const ETHERNET_BROADCAST_MAC = "ff:ff:ff:ff:ff:ff";

function isGroupMac(mac: string): boolean {
  return (Number.parseInt(mac.slice(0, 2), 16) & 1) === 1;
}

function hostAddress(value: string): string {
  return value.includes("/") ? value.slice(0, value.indexOf("/")) : value;
}

function evaluateNeighbor(
  state: EngineState,
  resourceId: string,
  nextHopResourceId: string,
  query: FlowQuery,
  routeDecision?: RouteDecisionTrace,
): PolicyVerdict | undefined {
  const resource = state.resources[resourceId];
  if (!resource) return { truth: "UNKNOWN", explanation: [`Neighbor evaluator cannot find '${resourceId}'.`] };
  const rawNeighbors = resource.properties.neighbors;
  if (rawNeighbors === undefined) return undefined;
  const decision = (
    truth: TruthValue,
    candidates: readonly NeighborCandidateTrace[],
    explanation: readonly string[],
    selected?: NeighborCandidateTrace,
  ): NeighborDecisionTrace => ({
    resourceId,
    destinationId: query.to,
    nextHopResourceId,
    truth,
    candidates,
    ...(selected ? { selectedEntryId: selected.entryId } : {}),
    ...(selected?.protocol ? { selectedProtocol: selected.protocol } : {}),
    ...(selected?.address ? { selectedAddress: selected.address } : {}),
    ...(selected?.mac ? { selectedMac: selected.mac } : {}),
    ...(selected?.interfaceId ? { outgoingInterface: selected.interfaceId } : {}),
    ...(selected?.state ? { selectedState: selected.state } : {}),
    explanation,
  });
  if (!Array.isArray(rawNeighbors)) {
    const explanation = [`Resource '${resourceId}' declares neighbors, but neighbors is not an array.`];
    return { truth: "UNKNOWN", explanation, neighborDecision: decision("UNKNOWN", [], explanation) };
  }

  const nextHopAddresses = new Set(targetAddresses(state, nextHopResourceId).map(hostAddress));
  const explicitIds = rawNeighbors.map((entry, index) => isRecord(entry) && typeof entry.id === "string" ? entry.id : `${resourceId}.neighbors[${index}]`);
  const duplicateIds = new Set(explicitIds.filter((id, index) => explicitIds.indexOf(id) !== index));
  const candidateTraces: NeighborCandidateTrace[] = [];
  let malformed = false;
  for (let index = 0; index < rawNeighbors.length; index += 1) {
    // Explicitly typed to avoid TS7022 circular inference in the strict browser typecheck;
    // no runtime behavior, routing semantics or neighbor decisions change.
    const raw: unknown = rawNeighbors[index];
    const entryId = explicitIds[index]!;
    if (!isRecord(raw)) {
      malformed = true;
      candidateTraces.push({ index, entryId, disposition: "MALFORMED", selected: false });
      continue;
    }
    const protocol = typeof raw.protocol === "string" && NEIGHBOR_PROTOCOLS.has(raw.protocol as NeighborProtocol) ? raw.protocol as NeighborProtocol : undefined;
    const stateValue = typeof raw.state === "string" && NEIGHBOR_STATES.has(raw.state as NeighborState) ? raw.state as NeighborState : undefined;
    const address = typeof raw.address === "string" ? raw.address : undefined;
    const parsedAddress = address ? parseIpAddress(address) : undefined;
    const targetResourceId = typeof raw.targetResourceId === "string" ? raw.targetResourceId : undefined;
    const interfaceId = typeof raw.interface === "string" ? raw.interface : undefined;
    const mac = typeof raw.mac === "string" ? raw.mac : undefined;
    const visible = {
      index,
      entryId,
      selected: false,
      ...(targetResourceId ? { targetResourceId } : {}),
      ...(protocol ? { protocol } : {}),
      ...(address ? { address } : {}),
      ...(mac ? { mac } : {}),
      ...(interfaceId ? { interfaceId } : {}),
      ...(stateValue ? { state: stateValue } : {}),
    };
    const targetKnown = targetResourceId === undefined || state.resources[targetResourceId] !== undefined;
    const targetConsistent = targetResourceId === undefined || targetResourceId === nextHopResourceId || !address || !nextHopAddresses.has(hostAddress(address));
    const addressConsistent = targetResourceId !== nextHopResourceId || nextHopAddresses.size === 0 || (address !== undefined && nextHopAddresses.has(address));
    const interfaceKnown = interfaceId === undefined || resource.interfaces.some((iface) => iface.id === interfaceId);
    const familyConsistent = parsedAddress !== undefined && protocol !== undefined
      ? (protocol === "ARP" ? parsedAddress.family === 4 : parsedAddress.family === 6)
      : false;
    const structurallyValid = !duplicateIds.has(entryId)
      && protocol !== undefined
      && stateValue !== undefined
      && address !== undefined
      && parsedAddress !== undefined
      && !address.includes("/")
      && familyConsistent
      && (mac === undefined || MAC_ADDRESS.test(mac))
      && (targetResourceId !== undefined || nextHopAddresses.size > 0)
      && targetKnown
      && targetConsistent
      && addressConsistent
      && interfaceKnown;
    if (!structurallyValid) {
      malformed = true;
      candidateTraces.push({ ...visible, disposition: "MALFORMED" });
      continue;
    }
    const matches = targetResourceId === nextHopResourceId || nextHopAddresses.has(address);
    candidateTraces.push({ ...visible, disposition: matches ? "MATCH" : "NO_MATCH" });
  }

  const matches = candidateTraces.filter((candidate) => candidate.disposition === "MATCH");
  if (matches.length !== 1) {
    const explanation = matches.length > 1
      ? [`Neighbor table on '${resourceId}' has multiple matching entries for next hop '${nextHopResourceId}'.`]
      : malformed
        ? [`Neighbor table on '${resourceId}' cannot be safely resolved for next hop '${nextHopResourceId}'.`]
        : [`Neighbor table on '${resourceId}' contains no modeled entry for next hop '${nextHopResourceId}'.`];
    return { truth: "UNKNOWN", explanation, neighborDecision: decision("UNKNOWN", candidateTraces, explanation) };
  }

  const match = matches[0]!;
  if (routeDecision?.outgoingInterface && match.interfaceId && routeDecision.outgoingInterface !== match.interfaceId) {
    const explanation = [`Neighbor entry '${match.entryId}' uses interface '${match.interfaceId}', inconsistent with selected route egress '${routeDecision.outgoingInterface}'.`];
    return { truth: "UNKNOWN", explanation, neighborDecision: decision("UNKNOWN", candidateTraces, explanation) };
  }
  const selected = candidateTraces.map((candidate) => ({ ...candidate, selected: candidate.index === match.index }));
  const selectedEntry = selected.find((candidate) => candidate.selected)!;
  const truth: TruthValue = selectedEntry.state === "REACHABLE" || selectedEntry.state === "STALE"
    ? "TRUE"
    : selectedEntry.state === "FAILED"
      ? "FALSE"
      : "UNKNOWN";
  const explanation = [`Neighbor entry '${selectedEntry.entryId}' on '${resourceId}' reports ${selectedEntry.protocol} ${selectedEntry.address} as ${selectedEntry.state}.`];
  return { truth, policy: selectedEntry.entryId, explanation, neighborDecision: decision(truth, selected, explanation, selectedEntry) };
}


type MacPortResolution =
  | { readonly ok: true; readonly interfaceId: string; readonly connectionId: string }
  | { readonly ok: false; readonly explanation: readonly string[] };

function endpointPortForResource(
  scenario: NormalizedScenario,
  state: EngineState,
  resourceId: string,
  peerId: string,
): MacPortResolution {
  const resource = state.resources[resourceId];
  if (!resource) return { ok: false, explanation: [`MAC evaluator cannot find '${resourceId}'.`] };
  const links = matchingConnections(scenario, resourceId, peerId);
  if (links.length !== 1) {
    return { ok: false, explanation: [`MAC evaluator requires exactly one enabled modeled link between '${resourceId}' and '${peerId}', found ${links.length}.`] };
  }
  const link = links[0]!;
  const endpoint = link.from.resource === resourceId ? link.from : link.to;
  if (typeof endpoint.port !== "string") {
    return { ok: false, explanation: [`Connection '${link.id}' does not model the '${resourceId}' interface/port.`] };
  }
  if (!resource.interfaces.some((iface) => iface.id === endpoint.port)) {
    return { ok: false, explanation: [`Connection '${link.id}' references undeclared interface '${endpoint.port}' on '${resourceId}'.`] };
  }
  return { ok: true, interfaceId: endpoint.port, connectionId: link.id };
}

function peerMacForConnection(
  scenario: NormalizedScenario,
  state: EngineState,
  peerId: string,
  resourceId: string,
): { readonly mac?: string; readonly explanation?: readonly string[] } {
  const peer = state.resources[peerId];
  if (!peer) return { explanation: [`MAC evaluator cannot find peer '${peerId}'.`] };
  if (peer.properties.macTable !== undefined) {
    return { explanation: [`Peer '${peerId}' is itself a modeled switching boundary; frame endpoint MAC is not inferred across multiple switches.`] };
  }
  const links = matchingConnections(scenario, resourceId, peerId);
  if (links.length !== 1) return { explanation: [`Frame endpoint MAC is ambiguous because '${resourceId}' and '${peerId}' have ${links.length} enabled modeled links.`] };
  const link = links[0]!;
  const endpoint = link.from.resource === peerId ? link.from : link.to;
  if (typeof endpoint.port !== "string") return { explanation: [`Connection '${link.id}' does not model peer interface/port for '${peerId}'.`] };
  const iface = peer.interfaces.find((candidate) => candidate.id === endpoint.port);
  if (!iface) return { explanation: [`Connection '${link.id}' references undeclared peer interface '${endpoint.port}' on '${peerId}'.`] };
  if (typeof iface.mac !== "string" || !MAC_ADDRESS.test(iface.mac)) return { explanation: [`Interface '${peerId}.${endpoint.port}' has no valid modeled MAC address.`] };
  return { mac: iface.mac.toLowerCase() };
}

function connectionVlanForSwitch(
  scenario: NormalizedScenario,
  resourceId: string,
  peerId: string,
): number | undefined | null {
  const links = matchingConnections(scenario, resourceId, peerId);
  if (links.length !== 1) return null;
  const raw = links[0]!.properties.vlan ?? links[0]!.properties.vlanId;
  if (raw === undefined) return undefined;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 4094 ? raw : null;
}

interface VlanFrameContext {
  readonly vlan: number;
  readonly tag: VlanTagState;
}

type ParsedSwitchport =
  | { readonly status: "ABSENT" }
  | { readonly status: "MALFORMED"; readonly explanation: string }
  | { readonly status: "VALID"; readonly mode: VlanPortMode; readonly accessVlan?: number; readonly allowedVlans?: readonly number[]; readonly nativeVlan?: number };

function validVlan(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 4094;
}

function parseSwitchport(resourceId: string, iface: Readonly<Record<string, unknown>>): ParsedSwitchport {
  const raw = iface.switchport;
  if (raw === undefined) return { status: "ABSENT" };
  if (!isRecord(raw)) return { status: "MALFORMED", explanation: `Switchport '${resourceId}.${String(iface.id ?? "unknown")}' is not an object.` };
  if (raw.mode === "access") {
    if (!validVlan(raw.accessVlan) || raw.allowedVlans !== undefined || raw.nativeVlan !== undefined) {
      return { status: "MALFORMED", explanation: `Access switchport '${resourceId}.${String(iface.id ?? "unknown")}' requires exactly one valid accessVlan and no trunk-only fields.` };
    }
    return { status: "VALID", mode: "ACCESS", accessVlan: raw.accessVlan };
  }
  if (raw.mode === "trunk") {
    if (!Array.isArray(raw.allowedVlans) || raw.allowedVlans.length === 0 || raw.accessVlan !== undefined
      || !raw.allowedVlans.every(validVlan) || new Set(raw.allowedVlans).size !== raw.allowedVlans.length
      || (raw.nativeVlan !== undefined && (!validVlan(raw.nativeVlan) || !raw.allowedVlans.includes(raw.nativeVlan)))) {
      return { status: "MALFORMED", explanation: `Trunk switchport '${resourceId}.${String(iface.id ?? "unknown")}' requires unique valid allowedVlans; nativeVlan, when present, must be allowed.` };
    }
    return {
      status: "VALID",
      mode: "TRUNK",
      allowedVlans: [...raw.allowedVlans].sort((a, b) => a - b),
      ...(raw.nativeVlan !== undefined ? { nativeVlan: raw.nativeVlan } : {}),
    };
  }
  return { status: "MALFORMED", explanation: `Switchport '${resourceId}.${String(iface.id ?? "unknown")}' has unsupported mode '${String(raw.mode)}'.` };
}

function hasExplicitSwitchportModel(resource: EngineState["resources"][string]): boolean {
  return resource.interfaces.some((iface) => iface.switchport !== undefined);
}

function switchportAllowsVlan(port: Extract<ParsedSwitchport, { readonly status: "VALID" }>, vlan: number): boolean {
  return port.mode === "ACCESS" ? port.accessVlan === vlan : Boolean(port.allowedVlans?.includes(vlan));
}

function switchportTagForVlan(port: Extract<ParsedSwitchport, { readonly status: "VALID" }>, vlan: number): VlanTagState | undefined {
  if (!switchportAllowsVlan(port, vlan)) return undefined;
  if (port.mode === "ACCESS") return "UNTAGGED";
  return port.nativeVlan === vlan ? "UNTAGGED" : "TAGGED";
}

function vlanRewrite(ingressTag: VlanTagState, egressTag: VlanTagState): VlanRewriteDisposition {
  if (ingressTag === "UNTAGGED" && egressTag === "TAGGED") return "ADD_TAG";
  if (ingressTag === "TAGGED" && egressTag === "UNTAGGED") return "REMOVE_TAG";
  return ingressTag === "TAGGED" ? "PRESERVE_TAG" : "PRESERVE_UNTAGGED";
}

function switchConnectionsForInterface(
  scenario: NormalizedScenario,
  resourceId: string,
  interfaceId: string,
): readonly NormalizedScenario["connections"][number][] {
  return scenario.connections.filter((connection) => {
    if ((connection.kind !== "network" && connection.kind !== "management") || !connectionEnabled(connection.properties)) return false;
    if (connection.from.resource === resourceId) return connection.from.port === interfaceId;
    return connection.to.resource === resourceId && connection.to.port === interfaceId && connection.properties.direction !== "forward";
  });
}

function vlanPortTraces(
  scenario: NormalizedScenario,
  resource: EngineState["resources"][string],
  ingressInterface: string | undefined,
  egressInterface: string | undefined,
  vlan: number | undefined,
): readonly VlanPortTrace[] {
  return resource.interfaces.map((iface) => {
    const interfaceId = typeof iface.id === "string" ? iface.id : "UNKNOWN";
    const parsed = parseSwitchport(resource.id, iface);
    if (parsed.status === "MALFORMED") return { interfaceId, disposition: "MALFORMED" };
    if (parsed.status === "ABSENT") {
      const connected = switchConnectionsForInterface(scenario, resource.id, interfaceId).length > 0;
      return { interfaceId, disposition: connected ? "MALFORMED" : "UNUSED" };
    }
    const visible = {
      interfaceId,
      mode: parsed.mode,
      ...(parsed.accessVlan !== undefined ? { accessVlan: parsed.accessVlan } : {}),
      ...(parsed.allowedVlans ? { allowedVlans: parsed.allowedVlans } : {}),
      ...(parsed.nativeVlan !== undefined ? { nativeVlan: parsed.nativeVlan } : {}),
      ...(vlan !== undefined && switchportTagForVlan(parsed, vlan) ? { egressTag: switchportTagForVlan(parsed, vlan)! } : {}),
    };
    if (interfaceId === ingressInterface) return { ...visible, disposition: "INGRESS" as const };
    if (interfaceId === egressInterface) return { ...visible, disposition: "EGRESS" as const };
    if (vlan === undefined) return { ...visible, disposition: "UNUSED" as const };
    return { ...visible, disposition: switchportAllowsVlan(parsed, vlan) ? "ELIGIBLE" as const : "BLOCKED" as const };
  });
}

function evaluateVlanSwitching(
  scenario: NormalizedScenario,
  state: EngineState,
  previousResourceId: string,
  resourceId: string,
  nextHopResourceId: string,
  query: FlowQuery,
  incomingFrame?: VlanFrameContext,
): PolicyVerdict | undefined {
  const resource = state.resources[resourceId];
  if (!resource) return { truth: "UNKNOWN", explanation: [`VLAN evaluator cannot find '${resourceId}'.`] };
  if (!hasExplicitSwitchportModel(resource)) return undefined;

  const ingress = endpointPortForResource(scenario, state, resourceId, previousResourceId);
  const egress = endpointPortForResource(scenario, state, resourceId, nextHopResourceId);
  const makeDecision = (
    truth: TruthValue,
    explanation: readonly string[],
    rewrite: VlanRewriteDisposition,
    vlan?: number,
    ingressPort?: Extract<ParsedSwitchport, { readonly status: "VALID" }>,
    egressPort?: Extract<ParsedSwitchport, { readonly status: "VALID" }>,
    ingressTag?: VlanTagState,
    egressTag?: VlanTagState,
  ): VlanDecisionTrace => ({
    resourceId,
    sourceResourceId: previousResourceId,
    nextHopResourceId,
    destinationId: query.to,
    truth,
    ...(vlan !== undefined ? { vlan } : {}),
    ...(ingress.ok ? { ingressInterface: ingress.interfaceId } : {}),
    ...(egress.ok ? { egressInterface: egress.interfaceId } : {}),
    ...(ingressPort ? { ingressMode: ingressPort.mode } : {}),
    ...(egressPort ? { egressMode: egressPort.mode } : {}),
    ...(ingressTag ? { ingressTag } : {}),
    ...(egressTag ? { egressTag } : {}),
    rewrite,
    ports: vlanPortTraces(scenario, resource, ingress.ok ? ingress.interfaceId : undefined, egress.ok ? egress.interfaceId : undefined, vlan),
    explanation,
  });

  if (!ingress.ok || !egress.ok) {
    const explanation = [...(!ingress.ok ? ingress.explanation : []), ...(!egress.ok ? egress.explanation : [])];
    return { truth: "UNKNOWN", explanation, vlanDecision: makeDecision("UNKNOWN", explanation, "UNKNOWN") };
  }
  const ingressIface = resource.interfaces.find((iface) => iface.id === ingress.interfaceId)!;
  const egressIface = resource.interfaces.find((iface) => iface.id === egress.interfaceId)!;
  const ingressPort = parseSwitchport(resourceId, ingressIface);
  const egressPort = parseSwitchport(resourceId, egressIface);
  if (ingressPort.status !== "VALID" || egressPort.status !== "VALID") {
    const explanation = [
      ingressPort.status === "MALFORMED" ? ingressPort.explanation : ingressPort.status === "ABSENT" ? `Ingress '${resourceId}.${ingress.interfaceId}' has no modeled switchport configuration.` : "",
      egressPort.status === "MALFORMED" ? egressPort.explanation : egressPort.status === "ABSENT" ? `Egress '${resourceId}.${egress.interfaceId}' has no modeled switchport configuration.` : "",
    ].filter(Boolean);
    return { truth: "UNKNOWN", explanation, vlanDecision: makeDecision("UNKNOWN", explanation, "UNKNOWN") };
  }
  if (switchConnectionsForInterface(scenario, resourceId, ingress.interfaceId).length !== 1 || switchConnectionsForInterface(scenario, resourceId, egress.interfaceId).length !== 1) {
    const explanation = [`VLAN decision on '${resourceId}' requires ingress and egress interfaces to map to exactly one enabled modeled connection each.`];
    return { truth: "UNKNOWN", explanation, vlanDecision: makeDecision("UNKNOWN", explanation, "UNKNOWN", undefined, ingressPort, egressPort) };
  }

  const ingressDeclared = connectionVlanForSwitch(scenario, resourceId, previousResourceId);
  const egressDeclared = connectionVlanForSwitch(scenario, resourceId, nextHopResourceId);
  if (ingressDeclared === null || egressDeclared === null) {
    const explanation = [`VLAN context on a connection adjacent to '${resourceId}' is malformed or ambiguous.`];
    return { truth: "UNKNOWN", explanation, vlanDecision: makeDecision("UNKNOWN", explanation, "UNKNOWN", undefined, ingressPort, egressPort) };
  }

  let vlan: number | undefined;
  let ingressTag: VlanTagState | undefined;
  if (incomingFrame) {
    vlan = incomingFrame.vlan;
    ingressTag = incomingFrame.tag;
    if (ingressDeclared !== undefined && ingressDeclared !== vlan) {
      const explanation = [`Incoming Engine frame VLAN ${vlan} conflicts with connection '${ingress.connectionId}' VLAN ${ingressDeclared}.`];
      return { truth: "UNKNOWN", explanation, vlanDecision: makeDecision("UNKNOWN", explanation, "UNKNOWN", vlan, ingressPort, egressPort, ingressTag) };
    }
  } else if (ingressPort.mode === "ACCESS") {
    vlan = ingressPort.accessVlan;
    ingressTag = "UNTAGGED";
    if (ingressDeclared !== undefined && ingressDeclared !== vlan) {
      const explanation = [`Access port '${resourceId}.${ingress.interfaceId}' classifies untagged ingress into VLAN ${vlan}, which conflicts with connection '${ingress.connectionId}' VLAN ${ingressDeclared}.`];
      return { truth: "FALSE", policy: ingress.connectionId, explanation, vlanDecision: makeDecision("FALSE", explanation, "PRESERVE_UNTAGGED", vlan, ingressPort, egressPort, ingressTag) };
    }
  } else {
    if (ingressDeclared === undefined) {
      const explanation = [`Trunk ingress '${resourceId}.${ingress.interfaceId}' needs an incoming Engine frame VLAN or an explicit connection VLAN; none is modeled.`];
      return { truth: "UNKNOWN", explanation, vlanDecision: makeDecision("UNKNOWN", explanation, "UNKNOWN", undefined, ingressPort, egressPort) };
    }
    vlan = ingressDeclared;
    ingressTag = switchportTagForVlan(ingressPort, vlan);
  }

  if (vlan === undefined) {
    const explanation = [`VLAN ingress classification on '${resourceId}.${ingress.interfaceId}' cannot be resolved from modeled state.`];
    return { truth: "UNKNOWN", explanation, vlanDecision: makeDecision("UNKNOWN", explanation, "UNKNOWN", undefined, ingressPort, egressPort, ingressTag) };
  }
  if (!switchportAllowsVlan(ingressPort, vlan)) {
    const explanation = [`Ingress switchport '${resourceId}.${ingress.interfaceId}' does not admit VLAN ${vlan}.`];
    return { truth: "FALSE", explanation, vlanDecision: makeDecision("FALSE", explanation, "UNKNOWN", vlan, ingressPort, egressPort, ingressTag) };
  }

  const acceptedIngressTag = switchportTagForVlan(ingressPort, vlan);
  if (ingressTag === undefined || acceptedIngressTag === undefined) {
    const explanation = [`VLAN ingress tag state on '${resourceId}.${ingress.interfaceId}' cannot be resolved from modeled state.`];
    return { truth: "UNKNOWN", explanation, vlanDecision: makeDecision("UNKNOWN", explanation, "UNKNOWN", vlan, ingressPort, egressPort, ingressTag) };
  }
  if (ingressTag !== acceptedIngressTag) {
    const explanation = [`Ingress frame on '${resourceId}.${ingress.interfaceId}' is ${ingressTag}, but modeled ${ingressPort.mode.toLowerCase()} semantics for VLAN ${vlan} require ${acceptedIngressTag}.`];
    return { truth: "FALSE", explanation, vlanDecision: makeDecision("FALSE", explanation, "UNKNOWN", vlan, ingressPort, egressPort, ingressTag) };
  }

  const egressTag = switchportTagForVlan(egressPort, vlan);
  if (egressTag === undefined) {
    const explanation = [`Egress switchport '${resourceId}.${egress.interfaceId}' does not carry VLAN ${vlan}.`];
    return { truth: "FALSE", explanation, vlanDecision: makeDecision("FALSE", explanation, "UNKNOWN", vlan, ingressPort, egressPort, ingressTag) };
  }
  if (egressDeclared !== undefined && egressDeclared !== vlan) {
    const explanation = [`Engine VLAN ${vlan} on '${resourceId}' conflicts with connection '${egress.connectionId}' VLAN ${egressDeclared}.`];
    return { truth: "FALSE", policy: egress.connectionId, explanation, vlanDecision: makeDecision("FALSE", explanation, vlanRewrite(ingressTag, egressTag), vlan, ingressPort, egressPort, ingressTag, egressTag) };
  }

  const rewrite = vlanRewrite(ingressTag, egressTag);
  const explanation = [
    `${ingressPort.mode} ingress '${resourceId}.${ingress.interfaceId}' classifies frame as VLAN ${vlan} (${ingressTag}).`,
    `${egressPort.mode} egress '${resourceId}.${egress.interfaceId}' carries VLAN ${vlan} as ${egressTag}; rewrite ${rewrite}.`,
  ];
  const decision = makeDecision("TRUE", explanation, rewrite, vlan, ingressPort, egressPort, ingressTag, egressTag);
  return { truth: "TRUE", explanation, vlanDecision: decision, vlanFrame: { vlan, tag: egressTag } };
}

const STP_PROTOCOLS = new Set<StpProtocol>(["STP", "RSTP", "MSTP", "UNKNOWN"]);
const STP_PORT_ROLES = new Set<StpPortRole>(["ROOT", "DESIGNATED", "ALTERNATE", "BACKUP", "DISABLED", "UNKNOWN"]);
const STP_PORT_STATES = new Set<StpPortState>(["FORWARDING", "BLOCKING", "DISCARDING", "LEARNING", "LISTENING", "DISABLED", "UNKNOWN"]);
const STP_BPDU_DISPOSITIONS = new Set<StpBpduDisposition>(["SEND", "RECEIVE", "NONE", "UNKNOWN"]);

interface ParsedStpBridge {
  readonly protocol: StpProtocol;
  readonly bridgeId: string;
  readonly rootBridgeId: string;
  readonly rootPathCost?: number;
}

interface ParsedStpPort {
  readonly interfaceId: string;
  readonly role: StpPortRole;
  readonly state: StpPortState;
  readonly bpdu?: StpBpduDisposition;
}

interface ParsedStpModel {
  readonly explicit: boolean;
  readonly malformed: boolean;
  readonly bridge?: ParsedStpBridge;
  readonly ports: ReadonlyMap<string, ParsedStpPort>;
  readonly explanation: readonly string[];
}

function parseStpModel(resource: EngineState["resources"][string]): ParsedStpModel {
  const rawBridge = resource.properties.stp;
  const rawPorts = resource.properties.stpPorts;
  if (rawBridge === undefined && rawPorts === undefined) {
    return { explicit: false, malformed: false, ports: new Map(), explanation: [] };
  }

  let malformed = false;
  const explanation: string[] = [];
  let bridge: ParsedStpBridge | undefined;
  if (rawBridge !== undefined) {
    if (!isRecord(rawBridge)
      || typeof rawBridge.protocol !== "string" || !STP_PROTOCOLS.has(rawBridge.protocol as StpProtocol)
      || typeof rawBridge.bridgeId !== "string" || rawBridge.bridgeId.length === 0
      || typeof rawBridge.rootBridgeId !== "string" || rawBridge.rootBridgeId.length === 0
      || (rawBridge.rootPathCost !== undefined && (!Number.isInteger(rawBridge.rootPathCost) || (rawBridge.rootPathCost as number) < 0))) {
      malformed = true;
      explanation.push(`STP bridge state on '${resource.id}' is malformed.`);
    } else {
      bridge = {
        protocol: rawBridge.protocol as StpProtocol,
        bridgeId: rawBridge.bridgeId,
        rootBridgeId: rawBridge.rootBridgeId,
        ...(typeof rawBridge.rootPathCost === "number" ? { rootPathCost: rawBridge.rootPathCost } : {}),
      };
    }
  }

  const ports = new Map<string, ParsedStpPort>();
  if (!Array.isArray(rawPorts)) {
    malformed = true;
    explanation.push(`Resource '${resource.id}' declares STP state, but stpPorts is not an array.`);
  } else {
    for (let index = 0; index < rawPorts.length; index += 1) {
      const raw = rawPorts[index];
      if (!isRecord(raw)
        || typeof raw.interface !== "string"
        || !resource.interfaces.some((iface) => iface.id === raw.interface)
        || ports.has(raw.interface)
        || typeof raw.role !== "string" || !STP_PORT_ROLES.has(raw.role as StpPortRole)
        || typeof raw.state !== "string" || !STP_PORT_STATES.has(raw.state as StpPortState)
        || (raw.bpdu !== undefined && (typeof raw.bpdu !== "string" || !STP_BPDU_DISPOSITIONS.has(raw.bpdu as StpBpduDisposition)))) {
        malformed = true;
        explanation.push(`STP port row ${index} on '${resource.id}' is malformed, duplicate or references an undeclared interface.`);
        continue;
      }
      ports.set(raw.interface, {
        interfaceId: raw.interface,
        role: raw.role as StpPortRole,
        state: raw.state as StpPortState,
        ...(raw.bpdu !== undefined ? { bpdu: raw.bpdu as StpBpduDisposition } : {}),
      });
    }
  }
  return { explicit: true, malformed, ...(bridge ? { bridge } : {}), ports, explanation };
}

function stpPortTraces(
  scenario: NormalizedScenario,
  resource: EngineState["resources"][string],
  model: ParsedStpModel,
  ingressInterface: string | undefined,
  egressInterface: string | undefined,
): readonly StpPortTrace[] {
  return resource.interfaces.map((iface) => {
    const interfaceId = typeof iface.id === "string" ? iface.id : "UNKNOWN";
    const parsed = model.ports.get(interfaceId);
    const connected = switchConnectionsForInterface(scenario, resource.id, interfaceId).length > 0;
    const disposition = interfaceId === ingressInterface
      ? "INGRESS" as const
      : interfaceId === egressInterface
        ? "EGRESS" as const
        : parsed || !connected
          ? "OTHER" as const
          : "MALFORMED" as const;
    return {
      interfaceId,
      disposition,
      ...(parsed ? { role: parsed.role, state: parsed.state, ...(parsed.bpdu ? { bpdu: parsed.bpdu } : {}) } : {}),
    };
  });
}

function evaluateStpSwitching(
  scenario: NormalizedScenario,
  state: EngineState,
  previousResourceId: string,
  resourceId: string,
  nextHopResourceId: string,
  query: FlowQuery,
): PolicyVerdict | undefined {
  const resource = state.resources[resourceId];
  if (!resource) return { truth: "UNKNOWN", explanation: [`STP evaluator cannot find '${resourceId}'.`] };
  const model = parseStpModel(resource);
  if (!model.explicit) return undefined;
  const ingress = endpointPortForResource(scenario, state, resourceId, previousResourceId);
  const egress = endpointPortForResource(scenario, state, resourceId, nextHopResourceId);
  const decision = (truth: TruthValue, explanation: readonly string[], modelComplete: boolean): StpDecisionTrace => ({
    resourceId,
    sourceResourceId: previousResourceId,
    nextHopResourceId,
    destinationId: query.to,
    truth,
    modelComplete,
    ...(ingress.ok ? { ingressInterface: ingress.interfaceId } : {}),
    ...(egress.ok ? { egressInterface: egress.interfaceId } : {}),
    ...(model.bridge ? {
      protocol: model.bridge.protocol,
      bridgeId: model.bridge.bridgeId,
      rootBridgeId: model.bridge.rootBridgeId,
      ...(model.bridge.rootPathCost !== undefined ? { rootPathCost: model.bridge.rootPathCost } : {}),
      isRootBridge: model.bridge.bridgeId === model.bridge.rootBridgeId,
    } : {}),
    ports: stpPortTraces(scenario, resource, model, ingress.ok ? ingress.interfaceId : undefined, egress.ok ? egress.interfaceId : undefined),
    explanation,
  });

  if (!ingress.ok || !egress.ok) {
    const explanation = [...model.explanation, ...(!ingress.ok ? ingress.explanation : []), ...(!egress.ok ? egress.explanation : [])];
    return { truth: "UNKNOWN", explanation, stpDecision: decision("UNKNOWN", explanation, false) };
  }
  const connectedInterfaces = resource.interfaces
    .filter((iface) => typeof iface.id === "string" && switchConnectionsForInterface(scenario, resourceId, iface.id).length > 0)
    .map((iface) => iface.id as string);
  const incomplete = connectedInterfaces.some((interfaceId) => !model.ports.has(interfaceId));
  const ambiguousConnectivity = connectedInterfaces.some((interfaceId) => switchConnectionsForInterface(scenario, resourceId, interfaceId).length !== 1);
  if (model.malformed || incomplete || ambiguousConnectivity) {
    const explanation = [
      ...model.explanation,
      ...(incomplete ? [`STP state on '${resourceId}' does not cover every connected modeled interface.`] : []),
      ...(ambiguousConnectivity ? [`STP state on '${resourceId}' cannot bind a connected interface to exactly one modeled link.`] : []),
    ];
    return { truth: "UNKNOWN", explanation, stpDecision: decision("UNKNOWN", explanation, false) };
  }
  const ingressPort = model.ports.get(ingress.interfaceId);
  const egressPort = model.ports.get(egress.interfaceId);
  if (!ingressPort || !egressPort || ingressPort.state === "UNKNOWN" || egressPort.state === "UNKNOWN") {
    const explanation = [`STP forwarding state on '${resourceId}' ingress or egress is UNKNOWN.`];
    return { truth: "UNKNOWN", explanation, stpDecision: decision("UNKNOWN", explanation, true) };
  }
  if (ingressPort.state !== "FORWARDING" || egressPort.state !== "FORWARDING") {
    const blocked = [ingressPort, egressPort].filter((port) => port.state !== "FORWARDING");
    const explanation = [`STP on '${resourceId}' prevents data forwarding on ${blocked.map((port) => `${port.interfaceId} (${port.role}/${port.state})`).join(", ")}.`];
    return { truth: "FALSE", policy: `${resourceId}.stpPorts`, explanation, stpDecision: decision("FALSE", explanation, true) };
  }
  const explanation = [`STP on '${resourceId}' permits data forwarding from '${ingress.interfaceId}' to '${egress.interfaceId}'.`];
  return { truth: "TRUE", explanation, stpDecision: decision("TRUE", explanation, true) };
}

function floodInterfacesForSwitch(
  scenario: NormalizedScenario,
  state: EngineState,
  resourceId: string,
  ingressInterface: string,
  vlan: number | undefined,
): readonly string[] | undefined {
  const resource = state.resources[resourceId];
  if (!resource) return undefined;
  const ports = new Set<string>();
  const explicitSwitchports = hasExplicitSwitchportModel(resource);
  const stpModel = parseStpModel(resource);
  if (stpModel.explicit && stpModel.malformed) return undefined;
  const seenConnectedPorts = new Set<string>();
  for (const connection of scenario.connections) {
    if ((connection.kind !== "network" && connection.kind !== "management") || !connectionEnabled(connection.properties)) continue;
    let endpoint;
    if (connection.from.resource === resourceId) endpoint = connection.from;
    else if (connection.to.resource === resourceId && connection.properties.direction !== "forward") endpoint = connection.to;
    else continue;
    if (typeof endpoint.port !== "string" || !resource.interfaces.some((iface) => iface.id === endpoint.port)) return undefined;
    if (seenConnectedPorts.has(endpoint.port)) return undefined;
    seenConnectedPorts.add(endpoint.port);
    if (endpoint.port === ingressInterface) continue;
    if (stpModel.explicit) {
      const stpPort = stpModel.ports.get(endpoint.port);
      if (!stpPort || stpPort.state === "UNKNOWN") return undefined;
      if (stpPort.state !== "FORWARDING") continue;
    }
    if (explicitSwitchports) {
      if (vlan === undefined) return undefined;
      const iface = resource.interfaces.find((candidate) => candidate.id === endpoint.port)!;
      const parsed = parseSwitchport(resourceId, iface);
      if (parsed.status !== "VALID") return undefined;
      if (switchportAllowsVlan(parsed, vlan)) ports.add(endpoint.port);
      continue;
    }
    const rawVlan = connection.properties.vlan ?? connection.properties.vlanId;
    if (rawVlan !== undefined) {
      if (!validVlan(rawVlan)) return undefined;
      if (vlan === undefined) return undefined;
      if (rawVlan !== vlan) continue;
    } else if (vlan !== undefined) {
      return undefined;
    }
    ports.add(endpoint.port);
  }
  return [...ports].sort((a, b) => a.localeCompare(b, "en"));
}

function evaluateMacSwitching(
  scenario: NormalizedScenario,
  state: EngineState,
  previousResourceId: string,
  resourceId: string,
  nextHopResourceId: string,
  query: FlowQuery,
  effectiveVlan?: number,
): PolicyVerdict | undefined {
  const resource = state.resources[resourceId];
  if (!resource) return { truth: "UNKNOWN", explanation: [`MAC evaluator cannot find '${resourceId}'.`] };
  const rawTable = resource.properties.macTable;
  if (rawTable === undefined) return undefined;

  const ingress = endpointPortForResource(scenario, state, resourceId, previousResourceId);
  const egress = endpointPortForResource(scenario, state, resourceId, nextHopResourceId);
  const source = peerMacForConnection(scenario, state, previousResourceId, resourceId);
  const destination = peerMacForConnection(scenario, state, nextHopResourceId, resourceId);
  const ingressVlan = effectiveVlan !== undefined ? effectiveVlan : connectionVlanForSwitch(scenario, resourceId, previousResourceId);
  const egressVlan = effectiveVlan !== undefined ? effectiveVlan : connectionVlanForSwitch(scenario, resourceId, nextHopResourceId);
  const vlan = effectiveVlan !== undefined ? effectiveVlan : (ingressVlan !== null && egressVlan !== null && ingressVlan === egressVlan ? ingressVlan : undefined);

  const makeDecision = (
    truth: TruthValue,
    candidates: readonly MacCandidateTrace[],
    learning: MacLearningDisposition,
    forwarding: MacForwardingDisposition,
    explanation: readonly string[],
    selected?: MacCandidateTrace,
    floodInterfaces?: readonly string[],
  ): MacDecisionTrace => ({
    resourceId,
    sourceResourceId: previousResourceId,
    nextHopResourceId,
    destinationId: query.to,
    truth,
    ...(source.mac ? { sourceMac: source.mac } : {}),
    ...(destination.mac ? { destinationMac: destination.mac } : {}),
    ...(ingress.ok ? { ingressInterface: ingress.interfaceId } : {}),
    ...(egress.ok ? { expectedEgressInterface: egress.interfaceId } : {}),
    ...(selected ? { selectedEntryId: selected.entryId } : {}),
    ...(selected?.interfaceId ? { selectedEgressInterface: selected.interfaceId } : {}),
    ...(floodInterfaces ? { floodInterfaces } : {}),
    ...(vlan !== undefined ? { vlan } : {}),
    learning,
    forwarding,
    candidates,
    explanation,
  });

  if (!Array.isArray(rawTable)) {
    const explanation = [`Resource '${resourceId}' declares macTable, but macTable is not an array.`];
    return { truth: "UNKNOWN", explanation, macDecision: makeDecision("UNKNOWN", [], "UNKNOWN", "UNKNOWN", explanation) };
  }
  if (!ingress.ok || !egress.ok || !source.mac || !destination.mac || ingressVlan === null || egressVlan === null || ingressVlan !== egressVlan) {
    const explanation = [
      ...(!ingress.ok ? ingress.explanation : []),
      ...(!egress.ok ? egress.explanation : []),
      ...(source.explanation ?? []),
      ...(destination.explanation ?? []),
      ...(ingressVlan === null || egressVlan === null ? [`MAC switching VLAN context on '${resourceId}' is malformed or ambiguous.`] : []),
      ...(ingressVlan !== null && egressVlan !== null && ingressVlan !== egressVlan ? [`Ingress and egress VLAN context differ on '${resourceId}'; Phase C MAC slice will not infer a cross-VLAN frame.`] : []),
    ];
    return { truth: "UNKNOWN", explanation, macDecision: makeDecision("UNKNOWN", [], "UNKNOWN", "UNKNOWN", explanation) };
  }

  const normalizedSource = source.mac.toLowerCase();
  const normalizedDestination = destination.mac.toLowerCase();
  if (isGroupMac(normalizedSource)) {
    const explanation = [`Source MAC ${normalizedSource} on '${previousResourceId}' is a group/broadcast address and cannot be learned as an Ethernet source.`];
    return { truth: "UNKNOWN", explanation, macDecision: makeDecision("UNKNOWN", [], "UNKNOWN", "UNKNOWN", explanation) };
  }
  if (normalizedSource === normalizedDestination && previousResourceId !== nextHopResourceId) {
    const explanation = [`Distinct modeled peers '${previousResourceId}' and '${nextHopResourceId}' expose the same MAC ${normalizedSource}; forwarding identity is ambiguous.`];
    return { truth: "UNKNOWN", explanation, macDecision: makeDecision("UNKNOWN", [], "UNKNOWN", "UNKNOWN", explanation) };
  }
  if (isGroupMac(normalizedDestination) && normalizedDestination !== ETHERNET_BROADCAST_MAC) {
    const explanation = [`Destination MAC ${normalizedDestination} is multicast/group-addressed; Phase C MAC/CAM does not model multicast membership and will not invent a flood decision.`];
    return { truth: "UNKNOWN", explanation, macDecision: makeDecision("UNKNOWN", [], "UNKNOWN", "UNKNOWN", explanation) };
  }

  const ids = rawTable.map((entry, index) => isRecord(entry) && typeof entry.id === "string" ? entry.id : `${resourceId}.macTable[${index}]`);
  const duplicateIds = new Set(ids.filter((id, index) => ids.indexOf(id) !== index));
  const candidates: MacCandidateTrace[] = [];
  let malformed = false;
  for (let index = 0; index < rawTable.length; index += 1) {
    const raw = rawTable[index];
    const entryId = ids[index]!;
    if (!isRecord(raw)) {
      malformed = true;
      candidates.push({ index, entryId, disposition: "MALFORMED", selected: false });
      continue;
    }
    const mac = typeof raw.mac === "string" && MAC_ADDRESS.test(raw.mac) ? raw.mac.toLowerCase() : undefined;
    const interfaceId = typeof raw.interface === "string" ? raw.interface : undefined;
    const entryVlan = raw.vlan === undefined ? undefined : (typeof raw.vlan === "number" && Number.isInteger(raw.vlan) && raw.vlan >= 1 && raw.vlan <= 4094 ? raw.vlan : null);
    const structurallyValid = !duplicateIds.has(entryId)
      && mac !== undefined
      && interfaceId !== undefined
      && resource.interfaces.some((iface) => iface.id === interfaceId)
      && entryVlan !== null;
    if (!structurallyValid) {
      malformed = true;
      candidates.push({ index, entryId, disposition: "MALFORMED", selected: false, ...(mac ? { mac } : {}), ...(interfaceId ? { interfaceId } : {}), ...(typeof entryVlan === "number" ? { vlan: entryVlan } : {}) });
      continue;
    }
    const inScope = vlan === undefined ? entryVlan === undefined : entryVlan === vlan;
    const sourceMatch = inScope && mac === normalizedSource;
    const destinationMatch = inScope && mac === normalizedDestination;
    const disposition = sourceMatch && destinationMatch ? "BOTH_MATCH" : sourceMatch ? "SOURCE_MATCH" : destinationMatch ? "DESTINATION_MATCH" : "NO_MATCH";
    candidates.push({ index, entryId, disposition, selected: false, mac, interfaceId, ...(typeof entryVlan === "number" ? { vlan: entryVlan } : {}) });
  }

  const sourceMatches = candidates.filter((candidate) => candidate.disposition === "SOURCE_MATCH" || candidate.disposition === "BOTH_MATCH");
  const destinationMatches = candidates.filter((candidate) => candidate.disposition === "DESTINATION_MATCH" || candidate.disposition === "BOTH_MATCH");
  let learning: MacLearningDisposition = "UNKNOWN";
  if (sourceMatches.length === 0 && !malformed) learning = "LEARNED";
  else if (sourceMatches.length === 1) {
    const learned = sourceMatches[0]!;
    learning = learned.interfaceId === ingress.interfaceId ? "REFRESHED" : "MOVED";
  }

  if (destinationMatches.length > 1 || sourceMatches.length > 1 || malformed) {
    const explanation = [`MAC table on '${resourceId}' is ambiguous or malformed; no forwarding winner is invented.`];
    return { truth: "UNKNOWN", explanation, macDecision: makeDecision("UNKNOWN", candidates, learning, "UNKNOWN", explanation) };
  }

  if (normalizedDestination === ETHERNET_BROADCAST_MAC) {
    const flood = floodInterfacesForSwitch(scenario, state, resourceId, ingress.interfaceId, vlan);
    if (!flood) {
      const explanation = [`Broadcast flood set on '${resourceId}' cannot be derived from complete modeled interface/connection state.`];
      return { truth: "UNKNOWN", explanation, macDecision: makeDecision("UNKNOWN", candidates, learning, "UNKNOWN", explanation) };
    }
    const truth: TruthValue = flood.includes(egress.interfaceId) ? "TRUE" : "FALSE";
    const explanation = [`Broadcast frame on '${resourceId}' floods to modeled egress set ${flood.join(", ") || "(none)"}.`];
    return { truth, explanation, macDecision: makeDecision(truth, candidates, learning, "BROADCAST", explanation, undefined, flood) };
  }

  if (destinationMatches.length === 1) {
    const selectedEntry = destinationMatches[0]!;
    const selectedCandidates = candidates.map((candidate) => ({ ...candidate, selected: candidate.index === selectedEntry.index }));
    if (selectedEntry.interfaceId === ingress.interfaceId) {
      const explanation = [`MAC table on '${resourceId}' resolves destination ${normalizedDestination} to ingress interface '${ingress.interfaceId}', so the frame is filtered.`];
      return { truth: "FALSE", policy: selectedEntry.entryId, explanation, macDecision: makeDecision("FALSE", selectedCandidates, learning, "FILTERED", explanation, selectedEntry) };
    }
    const truth: TruthValue = selectedEntry.interfaceId === egress.interfaceId ? "TRUE" : "FALSE";
    const explanation = truth === "TRUE"
      ? [`MAC table entry '${selectedEntry.entryId}' on '${resourceId}' selects modeled egress '${selectedEntry.interfaceId}'.`]
      : [`MAC table entry '${selectedEntry.entryId}' on '${resourceId}' selects '${selectedEntry.interfaceId}', not path egress '${egress.interfaceId}'.`];
    return { truth, policy: selectedEntry.entryId, explanation, macDecision: makeDecision(truth, selectedCandidates, learning, "UNICAST", explanation, selectedEntry) };
  }

  const flood = floodInterfacesForSwitch(scenario, state, resourceId, ingress.interfaceId, vlan);
  if (!flood) {
    const explanation = [`Unknown-unicast flood set on '${resourceId}' cannot be derived from complete modeled interface/connection state.`];
    return { truth: "UNKNOWN", explanation, macDecision: makeDecision("UNKNOWN", candidates, learning, "UNKNOWN", explanation) };
  }
  const truth: TruthValue = flood.includes(egress.interfaceId) ? "TRUE" : "FALSE";
  const explanation = [`Destination MAC ${normalizedDestination} is absent from modeled MAC table on '${resourceId}'; Engine uses modeled unknown-unicast flood set ${flood.join(", ") || "(none)"}.`];
  return { truth, explanation, macDecision: makeDecision(truth, candidates, learning, "FLOOD", explanation, undefined, flood) };
}

function declaredVlans(resource: EngineState["resources"][string]): readonly number[] | undefined | null {
  const single = resource.properties.vlan;
  const many = resource.properties.vlans;
  if (single === undefined && many === undefined) return undefined;
  const values: unknown[] = [];
  if (single !== undefined) values.push(single);
  if (many !== undefined) {
    if (!Array.isArray(many)) return null;
    values.push(...many);
  }
  if (!values.every((value) => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 4094)) return null;
  return [...new Set(values as number[])].sort((a, b) => a - b);
}

function matchingConnections(scenario: NormalizedScenario, from: string, to: string): readonly NormalizedScenario["connections"][number][] {
  return scenario.connections.filter((connection) => {
    if ((connection.kind !== "network" && connection.kind !== "management") || !connectionEnabled(connection.properties)) return false;
    if (connection.from.resource === from && connection.to.resource === to) return true;
    return connection.properties.direction !== "forward" && connection.from.resource === to && connection.to.resource === from;
  });
}

function evaluateVlanSegment(scenario: NormalizedScenario, state: EngineState, from: string, to: string): PolicyVerdict {
  const links = matchingConnections(scenario, from, to);
  if (links.length === 0) return { truth: "FALSE", explanation: [`No enabled connection remains between '${from}' and '${to}'.`] };
  let sawUnknown = false;
  const explanations: string[] = [];
  for (const link of links) {
    const raw = link.properties.vlan ?? link.properties.vlanId;
    if (raw === undefined) return { truth: "TRUE", policy: link.id, explanation: [`Connection '${link.id}' has no VLAN constraint.`] };
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 4094) {
      sawUnknown = true;
      explanations.push(`Connection '${link.id}' has invalid VLAN '${String(raw)}'.`);
      continue;
    }
    const fromMembership = declaredVlans(state.resources[from]!);
    const toMembership = declaredVlans(state.resources[to]!);
    if (fromMembership === null || toMembership === null) {
      sawUnknown = true;
      explanations.push(`VLAN membership on '${from}' or '${to}' is malformed.`);
      continue;
    }
    if (fromMembership !== undefined && !fromMembership.includes(raw)) {
      explanations.push(`'${from}' is not a member of VLAN ${raw} required by connection '${link.id}'.`);
      continue;
    }
    if (toMembership !== undefined && !toMembership.includes(raw)) {
      explanations.push(`'${to}' is not a member of VLAN ${raw} required by connection '${link.id}'.`);
      continue;
    }
    return { truth: "TRUE", policy: link.id, explanation: [`Connection '${link.id}' carries VLAN ${raw} and declared endpoint memberships are compatible.`] };
  }
  return sawUnknown
    ? { truth: "UNKNOWN", explanation: explanations }
    : { truth: "FALSE", explanation: explanations.length > 0 ? explanations : [`No VLAN-compatible connection exists between '${from}' and '${to}'.`] };
}

// IPv4-only, deterministic source identity for bounded Foundation SNAT.
// A host with no address or several candidate addresses has no provable egress source.
function uniqueIpv4Source(state: EngineState, resourceId: string): string | undefined {
  const addresses = targetAddresses(state, resourceId);
  if (addresses.length === 0) return undefined;
  const parsed = addresses.map((address) => address.split("/")[0]!);
  if (parsed.some((address) => parseIpAddress(address)?.family !== 4)) return undefined;
  const unique = [...new Set(parsed)];
  return unique.length === 1 ? unique[0] : undefined;
}

// Resource/zone selectors preserve their original semantic identity through NAT.
// Only explicit IP/CIDR source predicates inspect the observed source address.
function matchSourceSelector(value: unknown, query: FlowQuery, state: EngineState, observedSource: string | undefined): TruthValue {
  const zone = state.resources[query.from]?.zone;
  if (ruleEndpointMatches(value, query.from, zone)) return "TRUE";
  if (typeof value !== "string") return "UNKNOWN";
  const cidr = parseCidr(value);
  if (cidr) {
    if (observedSource === undefined) return "UNKNOWN";
    return addressInCidr(observedSource, value) === true ? "TRUE" : "FALSE";
  }
  // A mistyped address/CIDR is not an unrelated resource selector.
  if (value.includes("/") || /^\d+\.\d+\./.test(value) || value.includes(":")) return "UNKNOWN";
  return "FALSE";
}

function unevaluatedPolicyRules(
  rawRules: readonly unknown[],
  startIndex: number,
  resourceId: string,
  collection: "acls" | "rules",
): readonly PolicyRuleTrace[] {
  return rawRules.slice(startIndex).map((raw, offset) => {
    const index = startIndex + offset;
    const generatedId = `${resourceId}.${collection}[${index}]`;
    if (!isRecord(raw)) return { index, ruleId: generatedId, disposition: "NOT_EVALUATED" as const, selected: false };
    return {
      index,
      ruleId: typeof raw.id === "string" ? raw.id : generatedId,
      disposition: "NOT_EVALUATED" as const,
      selected: false,
      ...(typeof raw.source === "string" ? { source: raw.source } : {}),
      ...(typeof raw.destination === "string" ? { destination: raw.destination } : {}),
      ...(typeof raw.protocol === "string" ? { protocol: raw.protocol } : {}),
      ...(typeof raw.port === "number" && Number.isInteger(raw.port) ? { port: raw.port } : {}),
      ...(typeof raw.action === "string" ? { action: raw.action } : {}),
      ...(["NEW", "ESTABLISHED", "RELATED", "INVALID"].includes(String(raw.connectionState))
        ? { connectionState: raw.connectionState as Exclude<ConntrackState, "UNKNOWN"> }
        : {}),
    };
  });
}

function evaluateAcl(state: EngineState, resourceId: string, query: FlowQuery, observedSource?: string): PolicyVerdict | undefined {
  const resource = state.resources[resourceId];
  if (!resource) return { truth: "UNKNOWN", explanation: [`ACL evaluator cannot find '${resourceId}'.`] };
  const rawRules = resource.properties.acls;
  const defaultAction = resource.properties.aclDefaultAction;
  if (rawRules === undefined && defaultAction === undefined) return undefined;
  const decision = (
    truth: TruthValue,
    rules: readonly PolicyRuleTrace[],
    explanation: readonly string[],
    selectedPolicyId?: string,
    usedDefault = false,
  ): PolicyDecisionTrace => ({
    resourceId,
    destinationId: query.to,
    kind: "ACL",
    truth,
    ...(observedSource !== undefined ? { observedSource } : {}),
    rules,
    ...(selectedPolicyId !== undefined ? { selectedPolicyId } : {}),
    ...(typeof defaultAction === "string" ? { defaultAction } : {}),
    usedDefault,
    explanation,
  });
  if (rawRules !== undefined && !Array.isArray(rawRules)) {
    const explanation = [`Resource '${resourceId}' declares ACLs, but acls is not an array.`];
    return { truth: "UNKNOWN", explanation, policyDecision: decision("UNKNOWN", [], explanation) };
  }
  const rules = rawRules ?? [];
  const toZone = state.resources[query.to]?.zone;
  let malformed = false;
  const traces: PolicyRuleTrace[] = [];
  for (let index = 0; index < rules.length; index += 1) {
    const raw = rules[index];
    const generatedId = `${resourceId}.acls[${index}]`;
    if (!isRecord(raw)) {
      malformed = true;
      traces.push({ index, ruleId: generatedId, disposition: "MALFORMED", selected: false });
      continue;
    }
    const ruleId = typeof raw.id === "string" ? raw.id : generatedId;
    const visible = {
      index,
      ruleId,
      selected: false,
      ...(typeof raw.source === "string" ? { source: raw.source } : {}),
      ...(typeof raw.destination === "string" ? { destination: raw.destination } : {}),
      ...(typeof raw.protocol === "string" ? { protocol: raw.protocol } : {}),
      ...(typeof raw.port === "number" && Number.isInteger(raw.port) ? { port: raw.port } : {}),
      ...(typeof raw.action === "string" ? { action: raw.action } : {}),
    };
    if (raw.enabled === false) {
      traces.push({ ...visible, disposition: "DISABLED" });
      continue;
    }
    const sourceMatch = matchSourceSelector(raw.source ?? "any", query, state, observedSource);
    const destinationMatches = ruleEndpointMatches(raw.destination ?? "any", query.to, toZone);
    const protocol = normalizeProtocol(raw.protocol ?? "any");
    if (!protocol) {
      malformed = true;
      traces.push({ ...visible, disposition: "MALFORMED", sourceMatch, destinationMatch: destinationMatches });
      continue;
    }
    const protocolMatches = protocol === "any" || (query.protocol !== "any" && protocol === query.protocol);
    const portMatches = raw.port === undefined || (query.port !== undefined && raw.port === query.port);
    const matchDetails = { sourceMatch, destinationMatch: destinationMatches, protocolMatch: protocolMatches, portMatch: portMatches };
    if (!destinationMatches || !protocolMatches || !portMatches || sourceMatch === "FALSE") {
      traces.push({ ...visible, ...matchDetails, disposition: "NO_MATCH" });
      continue;
    }
    if (sourceMatch === "UNKNOWN") {
      const next = [...traces, { ...visible, ...matchDetails, disposition: "INDETERMINATE" as const }, ...unevaluatedPolicyRules(rules, index + 1, resourceId, "acls")];
      const explanation = [`ACL source selector on '${resourceId}' cannot be resolved against a known source address.`];
      return { truth: "UNKNOWN", explanation, policyDecision: decision("UNKNOWN", next, explanation) };
    }
    const selected = { ...visible, ...matchDetails, disposition: "MATCH" as const, selected: true };
    const next = [...traces, selected, ...unevaluatedPolicyRules(rules, index + 1, resourceId, "acls")];
    if (raw.action === "allow") {
      const explanation = [`ACL '${ruleId}' on '${resourceId}' explicitly allows the flow.`];
      return { truth: "TRUE", policy: ruleId, explanation, policyDecision: decision("TRUE", next, explanation, ruleId) };
    }
    if (raw.action === "deny" || raw.action === "block") {
      const explanation = [`ACL '${ruleId}' on '${resourceId}' explicitly blocks the flow.`];
      return { truth: "FALSE", policy: ruleId, explanation, policyDecision: decision("FALSE", next, explanation, ruleId) };
    }
    const explanation = [`ACL '${ruleId}' on '${resourceId}' matches but has unsupported action '${String(raw.action)}'.`];
    return { truth: "UNKNOWN", policy: ruleId, explanation, policyDecision: decision("UNKNOWN", next, explanation, ruleId) };
  }
  if (defaultAction === "allow") {
    const policy = `${resourceId}.aclDefaultAction`;
    const explanation = [`ACL default action on '${resourceId}' allows unmatched traffic.`];
    return { truth: "TRUE", policy, explanation, policyDecision: decision("TRUE", traces, explanation, policy, true) };
  }
  if (defaultAction === "deny" || defaultAction === "block") {
    const policy = `${resourceId}.aclDefaultAction`;
    const explanation = [`ACL default action on '${resourceId}' blocks unmatched traffic.`];
    return { truth: "FALSE", policy, explanation, policyDecision: decision("FALSE", traces, explanation, policy, true) };
  }
  if (defaultAction !== undefined) {
    const explanation = [`ACL default action on '${resourceId}' is unsupported/malformed.`];
    return { truth: "UNKNOWN", explanation, policyDecision: decision("UNKNOWN", traces, explanation) };
  }
  if (malformed) {
    const explanation = [`ACL data on '${resourceId}' contains unsupported/malformed entries.`];
    return { truth: "UNKNOWN", explanation, policyDecision: decision("UNKNOWN", traces, explanation) };
  }
  const explanation = [`No ACL rule matched on '${resourceId}', and no aclDefaultAction is declared.`];
  return { truth: "UNKNOWN", explanation, policyDecision: decision("UNKNOWN", traces, explanation) };
}

interface NatVerdict extends PolicyVerdict {
  readonly translatedPort?: number;
  readonly natDecision?: NatDecisionTrace;
}

function natRuleVisible(raw: Readonly<Record<string, unknown>>, index: number, resourceId: string): Omit<NatRuleTrace, "disposition" | "selected"> {
  return {
    index,
    ruleId: typeof raw.id === "string" ? raw.id : `${resourceId}.natRules[${index}]`,
    ...(typeof raw.type === "string" ? { declaredType: raw.type } : { declaredType: "dnat" }),
    ...(typeof raw.source === "string" ? { source: raw.source } : {}),
    ...(typeof raw.destination === "string" ? { destination: raw.destination } : {}),
    ...(typeof raw.protocol === "string" ? { protocol: raw.protocol } : {}),
    ...(typeof raw.port === "number" && Number.isInteger(raw.port) ? { port: raw.port } : {}),
    ...(typeof raw.externalPort === "number" && Number.isInteger(raw.externalPort) ? { externalPort: raw.externalPort } : {}),
    ...(typeof raw.action === "string" ? { action: raw.action } : {}),
    ...(typeof raw.translatedDestination === "string" ? { translatedDestination: raw.translatedDestination } : {}),
    ...(typeof raw.translatedPort === "number" && Number.isInteger(raw.translatedPort) ? { translatedPort: raw.translatedPort } : {}),
    ...(typeof raw.translatedSource === "string" ? { translatedSource: raw.translatedSource } : {}),
  };
}

function unevaluatedNatRules(rawRules: readonly unknown[], startIndex: number, resourceId: string): readonly NatRuleTrace[] {
  return rawRules.slice(startIndex).map((raw, offset) => {
    const index = startIndex + offset;
    if (!isRecord(raw)) return { index, ruleId: `${resourceId}.natRules[${index}]`, disposition: "NOT_EVALUATED" as const, selected: false };
    return { ...natRuleVisible(raw, index, resourceId), disposition: "NOT_EVALUATED" as const, selected: false };
  });
}

function evaluateDnat(
  state: EngineState,
  resourceId: string,
  query: FlowQuery,
  currentSource: string | undefined,
  currentPort: number | undefined,
): NatVerdict | undefined {
  const resource = state.resources[resourceId];
  if (!resource) return { truth: "UNKNOWN", explanation: [`NAT evaluator cannot find '${resourceId}'.`] };
  const rawRules = resource.properties.natRules;
  const policy = resource.properties.natPolicy;
  const makeDecision = (
    truth: TruthValue,
    transformation: NatDecisionTrace["transformation"],
    rules: readonly NatRuleTrace[],
    explanation: readonly string[],
    selectedRuleId?: string,
    outputPort = currentPort,
  ): NatDecisionTrace => ({
    resourceId,
    destinationId: query.to,
    kind: "DNAT",
    truth,
    ...(policy === "required" || policy === "optional" ? { policyMode: policy } : {}),
    transformation,
    rules,
    ...(selectedRuleId !== undefined ? { selectedRuleId } : {}),
    ...(currentSource !== undefined ? { inputSource: currentSource, outputSource: currentSource } : {}),
    ...(currentPort !== undefined ? { inputPort: currentPort } : {}),
    ...(outputPort !== undefined ? { outputPort } : {}),
    explanation,
  });
  if (policy !== undefined && policy !== "required" && policy !== "optional") {
    const explanation = [`Resource '${resourceId}' has unsupported natPolicy '${String(policy)}'.`];
    return { truth: "UNKNOWN", explanation, natDecision: makeDecision("UNKNOWN", "UNKNOWN", [], explanation) };
  }
  if (rawRules === undefined) {
    if (policy === "required") {
      const explanation = [`NAT policy on '${resourceId}' requires a DNAT rule, but no natRules are declared.`];
      return { truth: "FALSE", policy: `${resourceId}.natPolicy`, explanation, natDecision: makeDecision("FALSE", "BLOCKED", [], explanation) };
    }
    if (policy === "optional") {
      const explanation = [`Optional DNAT policy on '${resourceId}' has no declared natRules; destination port is preserved.`];
      return { truth: "TRUE", explanation, natDecision: makeDecision("TRUE", "PASSTHROUGH", [], explanation) };
    }
    return undefined;
  }
  if (!Array.isArray(rawRules)) {
    const explanation = [`Resource '${resourceId}' declares NAT, but natRules is not an array.`];
    return { truth: "UNKNOWN", explanation, natDecision: makeDecision("UNKNOWN", "UNKNOWN", [], explanation) };
  }
  const hasDnatDeclaration = policy !== undefined || rawRules.some((raw) => isRecord(raw) && (raw.type ?? "dnat") !== "snat");
  if (!hasDnatDeclaration) return undefined;
  const fromZone = state.resources[query.from]?.zone;
  const toZone = state.resources[query.to]?.zone;
  let malformed = false;
  const traces: NatRuleTrace[] = [];
  for (let index = 0; index < rawRules.length; index += 1) {
    const raw = rawRules[index];
    if (!isRecord(raw)) {
      malformed = true;
      traces.push({ index, ruleId: `${resourceId}.natRules[${index}]`, disposition: "MALFORMED", selected: false });
      continue;
    }
    const visible = natRuleVisible(raw, index, resourceId);
    if (raw.enabled === false) {
      traces.push({ ...visible, disposition: "DISABLED", selected: false });
      continue;
    }
    if (raw.enabled !== undefined && raw.enabled !== true) {
      malformed = true;
      traces.push({ ...visible, disposition: "MALFORMED", selected: false });
      continue;
    }
    const type = raw.type ?? "dnat";
    if (type === "snat") {
      traces.push({ ...visible, disposition: "OTHER_KIND", selected: false });
      continue;
    }
    if (type !== "dnat") {
      malformed = true;
      traces.push({ ...visible, disposition: "MALFORMED", selected: false });
      continue;
    }
    if (raw.translatedDestination !== undefined && raw.translatedDestination !== query.to) {
      traces.push({ ...visible, disposition: "NO_MATCH", selected: false, destinationMatch: false });
      continue;
    }
    const sourceMatches = ruleEndpointMatches(raw.source ?? "any", query.from, fromZone);
    const destinationMatches = ruleEndpointMatches(raw.destination ?? "any", query.to, toZone);
    const protocol = normalizeProtocol(raw.protocol ?? "any");
    if (!protocol) {
      malformed = true;
      traces.push({ ...visible, disposition: "MALFORMED", selected: false, sourceMatch: sourceMatches ? "TRUE" : "FALSE", destinationMatch: destinationMatches });
      continue;
    }
    const protocolMatches = protocol === "any" || (query.protocol !== "any" && protocol === query.protocol);
    const externalPort = raw.externalPort ?? raw.port;
    if (externalPort !== undefined && (typeof externalPort !== "number" || !Number.isInteger(externalPort) || externalPort < 1 || externalPort > 65535)) {
      malformed = true;
      traces.push({ ...visible, disposition: "MALFORMED", selected: false, sourceMatch: sourceMatches ? "TRUE" : "FALSE", destinationMatch: destinationMatches, protocolMatch: protocolMatches });
      continue;
    }
    const portMatches = externalPort === undefined || (currentPort !== undefined && externalPort === currentPort);
    const matchDetails = { sourceMatch: sourceMatches ? "TRUE" as const : "FALSE" as const, destinationMatch: destinationMatches, protocolMatch: protocolMatches, portMatch: portMatches };
    if (!sourceMatches || !destinationMatches || !protocolMatches || !portMatches) {
      traces.push({ ...visible, ...matchDetails, disposition: "NO_MATCH", selected: false });
      continue;
    }
    const name = visible.ruleId;
    const action = raw.action ?? "translate";
    if (action === "deny" || action === "block") {
      const selected = { ...visible, ...matchDetails, action, disposition: "MATCH" as const, selected: true };
      const rows = [...traces, selected, ...unevaluatedNatRules(rawRules, index + 1, resourceId)];
      const explanation = [`DNAT rule '${name}' on '${resourceId}' explicitly blocks the flow.`];
      return { truth: "FALSE", policy: name, explanation, natDecision: makeDecision("FALSE", "BLOCKED", rows, explanation, name) };
    }
    if (action !== "translate" && action !== "allow") {
      const selected = { ...visible, ...matchDetails, action: String(action), disposition: "MATCH" as const, selected: true };
      const rows = [...traces, selected, ...unevaluatedNatRules(rawRules, index + 1, resourceId)];
      const explanation = [`DNAT rule '${name}' on '${resourceId}' has unsupported action '${String(action)}'.`];
      return { truth: "UNKNOWN", policy: name, explanation, natDecision: makeDecision("UNKNOWN", "UNKNOWN", rows, explanation, name) };
    }
    const translatedPort = raw.translatedPort === undefined ? currentPort : raw.translatedPort;
    if (translatedPort !== undefined && (typeof translatedPort !== "number" || !Number.isInteger(translatedPort) || translatedPort < 1 || translatedPort > 65535)) {
      const malformedRow = { ...visible, ...matchDetails, action, disposition: "MALFORMED" as const, selected: false };
      const rows = [...traces, malformedRow, ...unevaluatedNatRules(rawRules, index + 1, resourceId)];
      const explanation = [`DNAT rule '${name}' has invalid translatedPort '${String(translatedPort)}'.`];
      return { truth: "UNKNOWN", policy: name, explanation, natDecision: makeDecision("UNKNOWN", "UNKNOWN", rows, explanation) };
    }
    const selected = { ...visible, ...matchDetails, action, disposition: "MATCH" as const, selected: true };
    const rows = [...traces, selected, ...unevaluatedNatRules(rawRules, index + 1, resourceId)];
    const explanation = [`DNAT rule '${name}' on '${resourceId}' maps ${query.protocol.toUpperCase()}/${String(currentPort ?? "any")} to ${query.to}:${String(translatedPort ?? "any")}.`];
    return {
      truth: "TRUE",
      policy: name,
      ...(translatedPort !== undefined ? { translatedPort } : {}),
      explanation,
      natDecision: makeDecision("TRUE", translatedPort !== currentPort ? "TRANSLATED" : "PASSTHROUGH", rows, explanation, name, translatedPort),
    };
  }
  if (malformed) {
    const explanation = [`NAT data on '${resourceId}' contains malformed/unsupported entries relevant to deterministic evaluation.`];
    return { truth: "UNKNOWN", explanation, natDecision: makeDecision("UNKNOWN", "UNKNOWN", traces, explanation) };
  }
  if (policy === "required") {
    const explanation = [`NAT policy on '${resourceId}' requires a matching DNAT rule for '${query.to}'.`];
    return { truth: "FALSE", policy: `${resourceId}.natPolicy`, explanation, natDecision: makeDecision("FALSE", "BLOCKED", traces, explanation) };
  }
  const explanation = [`No DNAT rule matched on '${resourceId}'; destination port is preserved.`];
  return { truth: "TRUE", explanation, natDecision: makeDecision("TRUE", "PASSTHROUGH", traces, explanation) };
}

interface SnatVerdict extends PolicyVerdict {
  readonly translatedSource?: string;
  readonly natDecision?: NatDecisionTrace;
}

function evaluateSnat(
  state: EngineState,
  resourceId: string,
  query: FlowQuery,
  currentSource: string | undefined,
  currentPort: number | undefined,
): SnatVerdict | undefined {
  const resource = state.resources[resourceId];
  if (!resource) return { truth: "UNKNOWN", explanation: [`SNAT evaluator cannot find '${resourceId}'.`] };
  const policy = resource.properties.snatPolicy;
  const rawRules = resource.properties.natRules;
  const makeDecision = (
    truth: TruthValue,
    transformation: NatDecisionTrace["transformation"],
    rules: readonly NatRuleTrace[],
    explanation: readonly string[],
    selectedRuleId?: string,
    outputSource = currentSource,
  ): NatDecisionTrace => ({
    resourceId,
    destinationId: query.to,
    kind: "SNAT",
    truth,
    ...(policy === "required" || policy === "optional" ? { policyMode: policy } : {}),
    transformation,
    rules,
    ...(selectedRuleId !== undefined ? { selectedRuleId } : {}),
    ...(currentSource !== undefined ? { inputSource: currentSource } : {}),
    ...(outputSource !== undefined ? { outputSource } : {}),
    ...(currentPort !== undefined ? { inputPort: currentPort, outputPort: currentPort } : {}),
    explanation,
  });
  if (policy !== undefined && policy !== "required" && policy !== "optional") {
    const explanation = [`Resource '${resourceId}' has unsupported snatPolicy '${String(policy)}'.`];
    return { truth: "UNKNOWN", explanation, natDecision: makeDecision("UNKNOWN", "UNKNOWN", [], explanation) };
  }
  if (rawRules === undefined) {
    if (policy === "required") {
      const explanation = [`SNAT required on '${resourceId}' but no natRules are declared.`];
      return { truth: "FALSE", policy: `${resourceId}.snatPolicy`, explanation, natDecision: makeDecision("FALSE", "BLOCKED", [], explanation) };
    }
    if (policy === "optional") {
      const explanation = [`Optional SNAT policy on '${resourceId}' has no declared natRules; source identity is preserved.`];
      return { truth: "TRUE", explanation, natDecision: makeDecision("TRUE", "PASSTHROUGH", [], explanation) };
    }
    return undefined;
  }
  if (!Array.isArray(rawRules)) {
    const explanation = [`SNAT on '${resourceId}' has a malformed natRules value.`];
    return { truth: "UNKNOWN", explanation, natDecision: makeDecision("UNKNOWN", "UNKNOWN", [], explanation) };
  }
  const traces: NatRuleTrace[] = [];
  let hasSnatDeclaration = policy !== undefined;
  let malformed = false;
  for (let index = 0; index < rawRules.length; index += 1) {
    const raw = rawRules[index];
    if (!isRecord(raw)) {
      malformed = true;
      traces.push({ index, ruleId: `${resourceId}.natRules[${index}]`, disposition: "MALFORMED", selected: false });
      continue;
    }
    const visible = natRuleVisible(raw, index, resourceId);
    if (raw.enabled === false) {
      if ((raw.type ?? "dnat") === "snat") hasSnatDeclaration = true;
      traces.push({ ...visible, disposition: "DISABLED", selected: false });
      continue;
    }
    if (raw.enabled !== undefined && raw.enabled !== true) {
      malformed = true;
      traces.push({ ...visible, disposition: "MALFORMED", selected: false });
      continue;
    }
    const type = raw.type ?? "dnat";
    if (type === "dnat") {
      traces.push({ ...visible, disposition: "OTHER_KIND", selected: false });
      continue;
    }
    if (type !== "snat") {
      malformed = true;
      traces.push({ ...visible, disposition: "MALFORMED", selected: false });
      continue;
    }
    hasSnatDeclaration = true;
    const protocol = normalizeProtocol(raw.protocol ?? "any");
    const portValid = raw.port === undefined || (typeof raw.port === "number" && Number.isInteger(raw.port) && raw.port >= 1 && raw.port <= 65535);
    const action = raw.action ?? "translate";
    const actionValid = ["translate", "allow", "deny", "block"].includes(String(action));
    const translationValid = action === "deny" || action === "block"
      || (typeof raw.translatedSource === "string" && parseIpAddress(raw.translatedSource)?.family === 4 && !raw.translatedSource.includes("/") && raw.translatedPort === undefined);
    if (!protocol || !portValid || !actionValid || !translationValid) {
      malformed = true;
      traces.push({ ...visible, ...(typeof action === "string" ? { action } : {}), disposition: "MALFORMED", selected: false });
      continue;
    }
    traces.push({ ...visible, action: String(action), disposition: "DECLARED", selected: false });
  }
  if (!hasSnatDeclaration && !malformed) return undefined;
  if (malformed) {
    const explanation = [`SNAT rules on '${resourceId}' contain malformed/unsupported declarations; no source rewrite is selected.`];
    return { truth: "UNKNOWN", explanation, natDecision: makeDecision("UNKNOWN", "UNKNOWN", traces, explanation) };
  }
  const toZone = state.resources[query.to]?.zone;
  const evaluated = traces.map((trace) => ({ ...trace }));
  for (let index = 0; index < rawRules.length; index += 1) {
    const raw = rawRules[index];
    if (!isRecord(raw)) continue;
    const trace = evaluated[index]!;
    if (trace.disposition !== "DECLARED") continue;
    const sourceMatch = matchSourceSelector(raw.source ?? "any", query, state, currentSource);
    const destinationMatches = ruleEndpointMatches(raw.destination ?? "any", query.to, toZone);
    const protocol = normalizeProtocol(raw.protocol ?? "any")!;
    const protocolMatches = protocol === "any" || (query.protocol !== "any" && protocol === query.protocol);
    const portMatches = raw.port === undefined || raw.port === currentPort;
    const matchDetails = { sourceMatch, destinationMatch: destinationMatches, protocolMatch: protocolMatches, portMatch: portMatches };
    if (!destinationMatches || !protocolMatches || !portMatches || sourceMatch === "FALSE") {
      evaluated[index] = { ...trace, ...matchDetails, disposition: "NO_MATCH", selected: false };
      continue;
    }
    if (sourceMatch === "UNKNOWN") {
      evaluated[index] = { ...trace, ...matchDetails, disposition: "INDETERMINATE", selected: false };
      for (let later = index + 1; later < evaluated.length; later += 1) if (evaluated[later]!.disposition === "DECLARED") evaluated[later] = { ...evaluated[later]!, disposition: "NOT_EVALUATED" };
      const explanation = [`SNAT '${trace.ruleId}' requires an unambiguous source address.`];
      return { truth: "UNKNOWN", policy: trace.ruleId, explanation, natDecision: makeDecision("UNKNOWN", "UNKNOWN", evaluated, explanation) };
    }
    const action = raw.action ?? "translate";
    if (action === "deny" || action === "block") {
      evaluated[index] = { ...trace, ...matchDetails, action, disposition: "MATCH", selected: true };
      for (let later = index + 1; later < evaluated.length; later += 1) if (evaluated[later]!.disposition === "DECLARED") evaluated[later] = { ...evaluated[later]!, disposition: "NOT_EVALUATED" };
      const explanation = [`SNAT rule '${trace.ruleId}' on '${resourceId}' explicitly blocks the forward flow.`];
      return { truth: "FALSE", policy: trace.ruleId, explanation, natDecision: makeDecision("FALSE", "BLOCKED", evaluated, explanation, trace.ruleId) };
    }
    const translatedSource = raw.translatedSource as string;
    if (currentSource === undefined || parseIpAddress(currentSource)?.family !== 4) {
      evaluated[index] = { ...trace, ...matchDetails, disposition: "INDETERMINATE", selected: false };
      for (let later = index + 1; later < evaluated.length; later += 1) if (evaluated[later]!.disposition === "DECLARED") evaluated[later] = { ...evaluated[later]!, disposition: "NOT_EVALUATED" };
      const explanation = [`SNAT '${trace.ruleId}' has no provable unique original IPv4 source address.`];
      return { truth: "UNKNOWN", policy: trace.ruleId, explanation, natDecision: makeDecision("UNKNOWN", "UNKNOWN", evaluated, explanation) };
    }
    evaluated[index] = { ...trace, ...matchDetails, action: String(action), disposition: "MATCH", selected: true };
    for (let later = index + 1; later < evaluated.length; later += 1) if (evaluated[later]!.disposition === "DECLARED") evaluated[later] = { ...evaluated[later]!, disposition: "NOT_EVALUATED" };
    const explanation = [`SNAT rule '${trace.ruleId}' on '${resourceId}' translates source ${currentSource} -> ${translatedSource} for the declared forward path (return path not simulated).`];
    return {
      truth: "TRUE",
      policy: trace.ruleId,
      translatedSource,
      explanation,
      natDecision: makeDecision("TRUE", translatedSource !== currentSource ? "TRANSLATED" : "PASSTHROUGH", evaluated, explanation, trace.ruleId, translatedSource),
    };
  }
  const finalized = evaluated.map((trace) => trace.disposition === "DECLARED" ? { ...trace, disposition: "NO_MATCH" as const } : trace);
  if (policy === "required") {
    const explanation = [`SNAT required on '${resourceId}' but no matching SNAT rule was found.`];
    return { truth: "FALSE", policy: `${resourceId}.snatPolicy`, explanation, natDecision: makeDecision("FALSE", "BLOCKED", finalized, explanation) };
  }
  const explanation = [`No SNAT rule matched on '${resourceId}'; source identity is preserved.`];
  return { truth: "TRUE", explanation, natDecision: makeDecision("TRUE", "PASSTHROUGH", finalized, explanation) };
}


interface ConntrackVerdict {
  readonly truth: TruthValue;
  readonly explanation: readonly string[];
  readonly connectionState?: ConntrackState;
  readonly conntrackDecision: ConntrackDecisionTrace;
}

function evaluateConntrack(
  state: EngineState,
  firewallId: string,
  query: FlowQuery,
  observedSource?: string,
): ConntrackVerdict | undefined {
  const firewall = state.resources[firewallId];
  if (!firewall) return undefined;
  const rawTable = firewall.properties.conntrack;
  if (rawTable === undefined) return undefined;

  const decision = (
    truth: TruthValue,
    entries: readonly ConntrackEntryTrace[],
    explanation: readonly string[],
    complete?: boolean,
    selectedEntryId?: string,
    connectionState?: ConntrackState,
  ): ConntrackDecisionTrace => ({
    resourceId: firewallId,
    destinationId: query.to,
    truth,
    ...(complete !== undefined ? { complete } : {}),
    entries,
    ...(selectedEntryId !== undefined ? { selectedEntryId } : {}),
    ...(connectionState !== undefined ? { connectionState } : {}),
    ...(observedSource !== undefined ? { observedSource } : {}),
    ...(query.port !== undefined ? { observedPort: query.port } : {}),
    explanation,
  });

  if (!isRecord(rawTable)) {
    const explanation = [`Conntrack table on '${firewallId}' is malformed; stateful policy cannot rely on it.`];
    return { truth: "UNKNOWN", explanation, conntrackDecision: decision("UNKNOWN", [], explanation) };
  }
  const tableKeys = new Set(["complete", "entries"]);
  const tableHasUnknownField = Object.keys(rawTable).some((key) => !tableKeys.has(key));
  const complete = rawTable.complete;
  const rawEntries = rawTable.entries;
  if (typeof complete !== "boolean" || !Array.isArray(rawEntries) || tableHasUnknownField) {
    const explanation = [`Conntrack table on '${firewallId}' has unsupported or incomplete structure.`];
    return { truth: "UNKNOWN", explanation, conntrackDecision: decision("UNKNOWN", [], explanation, typeof complete === "boolean" ? complete : undefined) };
  }

  const allowedEntryKeys = new Set(["id", "enabled", "source", "destination", "protocol", "port", "state"]);
  const seenIds = new Set<string>();
  const entries: ConntrackEntryTrace[] = [];
  let malformed = false;
  let indeterminate = false;
  const matchedIndexes: number[] = [];

  for (let index = 0; index < rawEntries.length; index += 1) {
    const raw = rawEntries[index];
    const generatedId = `${firewallId}.conntrack.entries[${index}]`;
    if (!isRecord(raw)) {
      malformed = true;
      entries.push({ index, entryId: generatedId, disposition: "MALFORMED", selected: false });
      continue;
    }
    const entryId = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : generatedId;
    const visible = {
      index,
      entryId,
      selected: false,
      ...(typeof raw.source === "string" ? { source: raw.source } : {}),
      ...(typeof raw.destination === "string" ? { destination: raw.destination } : {}),
      ...(typeof raw.protocol === "string" ? { protocol: raw.protocol } : {}),
      ...(typeof raw.port === "number" && Number.isInteger(raw.port) ? { port: raw.port } : {}),
      ...(["NEW", "ESTABLISHED", "RELATED", "INVALID", "UNKNOWN"].includes(String(raw.state)) ? { state: raw.state as ConntrackState } : {}),
    };
    const unknownField = Object.keys(raw).some((key) => !allowedEntryKeys.has(key));
    const duplicate = seenIds.has(entryId);
    if (!duplicate) seenIds.add(entryId);
    const source = typeof raw.source === "string" ? raw.source : undefined;
    const sourceIp = source === undefined ? undefined : parseIpAddress(source);
    const sourceValid = source !== undefined && sourceIp?.family === 4 && !source.includes("/");
    const destinationValid = typeof raw.destination === "string" && state.resources[raw.destination] !== undefined;
    const protocolValid = raw.protocol === "tcp" || raw.protocol === "udp" || raw.protocol === "icmp";
    const stateValid = raw.state === "NEW" || raw.state === "ESTABLISHED" || raw.state === "RELATED" || raw.state === "INVALID" || raw.state === "UNKNOWN";
    const enabledValid = raw.enabled === undefined || typeof raw.enabled === "boolean";
    const portValid = raw.protocol === "icmp"
      ? raw.port === undefined
      : (raw.protocol === "tcp" || raw.protocol === "udp")
        ? typeof raw.port === "number" && Number.isInteger(raw.port) && raw.port >= 1 && raw.port <= 65535
        : false;
    if (unknownField || duplicate || typeof raw.id !== "string" || raw.id.length === 0 || !sourceValid || !destinationValid || !protocolValid || !stateValid || !enabledValid || !portValid) {
      malformed = true;
      entries.push({ ...visible, disposition: "MALFORMED" });
      continue;
    }
    if (raw.enabled === false) {
      entries.push({ ...visible, disposition: "DISABLED" });
      continue;
    }

    const sourceMatch: TruthValue = observedSource === undefined ? "UNKNOWN" : observedSource === raw.source ? "TRUE" : "FALSE";
    const destinationMatch = raw.destination === query.to;
    const protocolKnown = query.protocol !== "any";
    const protocolMatch = protocolKnown && raw.protocol === query.protocol;
    const portKnown = raw.protocol === "icmp" || query.port !== undefined;
    const portMatch = raw.protocol === "icmp" ? query.port === undefined : (query.port !== undefined && raw.port === query.port);
    const matchDetails = { sourceMatch, destinationMatch, protocolMatch, portMatch };

    if (!destinationMatch || sourceMatch === "FALSE" || (protocolKnown && !protocolMatch) || (portKnown && !portMatch)) {
      entries.push({ ...visible, ...matchDetails, disposition: "NO_MATCH" });
      continue;
    }
    if (sourceMatch === "UNKNOWN" || !protocolKnown || !portKnown) {
      indeterminate = true;
      entries.push({ ...visible, ...matchDetails, disposition: "INDETERMINATE" });
      continue;
    }
    matchedIndexes.push(entries.length);
    entries.push({ ...visible, ...matchDetails, disposition: "MATCH" });
  }

  if (malformed) {
    const explanation = [`Conntrack table on '${firewallId}' contains malformed, duplicate or unsupported active state; lookup fails closed.`];
    return { truth: "UNKNOWN", explanation, conntrackDecision: decision("UNKNOWN", entries, explanation, complete) };
  }
  if (matchedIndexes.length > 1) {
    const explanation = [`Conntrack lookup on '${firewallId}' is ambiguous because multiple active entries match the same modeled tuple.`];
    return { truth: "UNKNOWN", explanation, conntrackDecision: decision("UNKNOWN", entries, explanation, complete) };
  }
  if (matchedIndexes.length === 1) {
    const matchedIndex = matchedIndexes[0]!;
    const matched = entries[matchedIndex]!;
    const selected = { ...matched, selected: true };
    const selectedEntries = entries.map((entry, index) => index === matchedIndex ? selected : entry);
    const connectionState = selected.state!;
    if (connectionState === "UNKNOWN") {
      const explanation = [`Conntrack entry '${selected.entryId}' on '${firewallId}' matches the tuple but declares UNKNOWN state.`];
      return { truth: "UNKNOWN", connectionState, explanation, conntrackDecision: decision("UNKNOWN", selectedEntries, explanation, complete, selected.entryId, connectionState) };
    }
    const explanation = [`Conntrack entry '${selected.entryId}' on '${firewallId}' proves ${connectionState} state for the modeled tuple.`];
    return { truth: "TRUE", connectionState, explanation, conntrackDecision: decision("TRUE", selectedEntries, explanation, complete, selected.entryId, connectionState) };
  }
  if (indeterminate) {
    const explanation = [`Conntrack lookup on '${firewallId}' cannot be resolved because the modeled tuple is incomplete or ambiguous.`];
    return { truth: "UNKNOWN", explanation, conntrackDecision: decision("UNKNOWN", entries, explanation, complete) };
  }
  if (!complete) {
    const explanation = [`Conntrack table on '${firewallId}' is explicitly incomplete and no matching entry is present; absence cannot be treated as proof.`];
    return { truth: "UNKNOWN", explanation, conntrackDecision: decision("UNKNOWN", entries, explanation, complete) };
  }
  const explanation = [`Complete conntrack table on '${firewallId}' contains no matching session entry.`];
  return { truth: "FALSE", explanation, conntrackDecision: decision("FALSE", entries, explanation, complete) };
}

function normalizeProtocol(value: unknown): "tcp" | "udp" | "icmp" | "any" | undefined {
  return value === "tcp" || value === "udp" || value === "icmp" || value === "any" ? value : undefined;
}

function ruleEndpointMatches(value: unknown, resourceId: string, zone: string | undefined): boolean {
  return value === "any" || value === "*" || value === resourceId || (zone !== undefined && value === zone);
}

function evaluateFirewall(
  state: EngineState,
  firewallId: string,
  firewallScope: FirewallScope,
  query: FlowQuery,
  observedSource?: string,
  conntrack?: ConntrackDecisionTrace,
): PolicyVerdict {
  const firewall = state.resources[firewallId];
  if (!firewall) return { truth: "UNKNOWN", explanation: [`Firewall '${firewallId}' is absent from runtime state.`] };
  const rawRules = firewall.properties.rules;
  const defaultAction = firewall.properties.defaultAction;
  const decision = (
    truth: TruthValue,
    rules: readonly PolicyRuleTrace[],
    explanation: readonly string[],
    selectedPolicyId?: string,
    usedDefault = false,
  ): PolicyDecisionTrace => ({
    resourceId: firewallId,
    destinationId: query.to,
    kind: "FIREWALL",
    firewallScope,
    truth,
    ...(observedSource !== undefined ? { observedSource } : {}),
    rules,
    ...(selectedPolicyId !== undefined ? { selectedPolicyId } : {}),
    ...(typeof defaultAction === "string" ? { defaultAction } : {}),
    usedDefault,
    explanation,
  });
  if (!Array.isArray(rawRules)) {
    const explanation = [`Firewall '${firewallId}' has no declared ordered ruleset.`];
    return { truth: "UNKNOWN", explanation, policyDecision: decision("UNKNOWN", [], explanation) };
  }
  const toZone = state.resources[query.to]?.zone;
  let malformedRelevant = false;
  const traces: PolicyRuleTrace[] = [];

  for (let index = 0; index < rawRules.length; index += 1) {
    const raw = rawRules[index];
    const generatedId = `${firewallId}.rules[${index}]`;
    if (!isRecord(raw)) {
      malformedRelevant = true;
      traces.push({ index, ruleId: generatedId, disposition: "MALFORMED", selected: false });
      continue;
    }
    const ruleId = typeof raw.id === "string" ? raw.id : generatedId;
    const visible = {
      index,
      ruleId,
      selected: false,
      ...(typeof raw.source === "string" ? { source: raw.source } : {}),
      ...(typeof raw.destination === "string" ? { destination: raw.destination } : {}),
      ...(typeof raw.protocol === "string" ? { protocol: raw.protocol } : {}),
      ...(typeof raw.port === "number" && Number.isInteger(raw.port) ? { port: raw.port } : {}),
      ...(typeof raw.action === "string" ? { action: raw.action } : {}),
      ...(["NEW", "ESTABLISHED", "RELATED", "INVALID"].includes(String(raw.connectionState)) ? { connectionState: raw.connectionState as Exclude<ConntrackState, "UNKNOWN"> } : {}),
    };
    if (raw.enabled === false) {
      traces.push({ ...visible, disposition: "DISABLED" });
      continue;
    }
    const sourceMatch = matchSourceSelector(raw.source ?? "any", query, state, observedSource);
    const destinationMatches = ruleEndpointMatches(raw.destination ?? "any", query.to, toZone);
    const declaredProtocol = normalizeProtocol(raw.protocol ?? "any");
    if (declaredProtocol === undefined) {
      malformedRelevant = true;
      traces.push({ ...visible, disposition: "MALFORMED", sourceMatch, destinationMatch: destinationMatches });
      continue;
    }
    const protocolMatches = declaredProtocol === "any" || (query.protocol !== "any" && declaredProtocol === query.protocol);
    const portMatches = raw.port === undefined || (query.port !== undefined && raw.port === query.port);
    const matchDetails = { sourceMatch, destinationMatch: destinationMatches, protocolMatch: protocolMatches, portMatch: portMatches };
    if (!destinationMatches || !protocolMatches || !portMatches || sourceMatch === "FALSE") {
      traces.push({ ...visible, ...matchDetails, disposition: "NO_MATCH" });
      continue;
    }
    if (sourceMatch === "UNKNOWN") {
      const next = [...traces, { ...visible, ...matchDetails, disposition: "INDETERMINATE" as const }, ...unevaluatedPolicyRules(rawRules, index + 1, firewallId, "rules")];
      const explanation = [`Firewall source selector on '${firewallId}' cannot be resolved against a known source address.`];
      return { truth: "UNKNOWN", explanation, policyDecision: decision("UNKNOWN", next, explanation) };
    }
    const requiredConnectionState = raw.connectionState;
    if (requiredConnectionState !== undefined) {
      if (requiredConnectionState !== "NEW" && requiredConnectionState !== "ESTABLISHED" && requiredConnectionState !== "RELATED" && requiredConnectionState !== "INVALID") {
        const next = [...traces, { ...visible, ...matchDetails, disposition: "MALFORMED" as const }, ...unevaluatedPolicyRules(rawRules, index + 1, firewallId, "rules")];
        const explanation = [`Firewall '${firewallId}' rule '${ruleId}' declares an unsupported connectionState.`];
        return { truth: "UNKNOWN", policy: ruleId, explanation, policyDecision: decision("UNKNOWN", next, explanation, ruleId) };
      }
      if (conntrack === undefined) {
        const next = [...traces, { ...visible, ...matchDetails, connectionStateMatch: "UNKNOWN" as const, disposition: "INDETERMINATE" as const }, ...unevaluatedPolicyRules(rawRules, index + 1, firewallId, "rules")];
        const explanation = [`Firewall '${firewallId}' rule '${ruleId}' requires ${requiredConnectionState} state, but no Engine-owned conntrack table is available.`];
        return { truth: "UNKNOWN", policy: ruleId, explanation, policyDecision: decision("UNKNOWN", next, explanation, ruleId) };
      }
      if (conntrack.truth === "UNKNOWN" || conntrack.connectionState === "UNKNOWN") {
        const next = [...traces, { ...visible, ...matchDetails, connectionStateMatch: "UNKNOWN" as const, disposition: "INDETERMINATE" as const }, ...unevaluatedPolicyRules(rawRules, index + 1, firewallId, "rules")];
        const explanation = [`Firewall '${firewallId}' rule '${ruleId}' requires ${requiredConnectionState} state, but conntrack state is not provable.`];
        return { truth: "UNKNOWN", policy: ruleId, explanation, policyDecision: decision("UNKNOWN", next, explanation, ruleId) };
      }
      const connectionStateMatch: TruthValue = conntrack.truth === "TRUE" && conntrack.connectionState === requiredConnectionState ? "TRUE" : "FALSE";
      if (connectionStateMatch === "FALSE") {
        traces.push({ ...visible, ...matchDetails, connectionStateMatch, disposition: "NO_MATCH" });
        continue;
      }
      Object.assign(matchDetails, { connectionStateMatch });
    }
    const selected = { ...visible, ...matchDetails, disposition: "MATCH" as const, selected: true };
    const next = [...traces, selected, ...unevaluatedPolicyRules(rawRules, index + 1, firewallId, "rules")];
    const action = raw.action;
    if (action === "allow") {
      const explanation = [`Firewall '${firewallId}' rule '${ruleId}' explicitly allows the flow.`];
      return { truth: "TRUE", policy: ruleId, explanation, policyDecision: decision("TRUE", next, explanation, ruleId) };
    }
    if (action === "deny" || action === "block") {
      const explanation = [`Firewall '${firewallId}' rule '${ruleId}' explicitly blocks the flow.`];
      return { truth: "FALSE", policy: ruleId, explanation, policyDecision: decision("FALSE", next, explanation, ruleId) };
    }
    const explanation = [`Firewall '${firewallId}' rule '${ruleId}' matches, but action is not a supported allow/deny value.`];
    return { truth: "UNKNOWN", policy: ruleId, explanation, policyDecision: decision("UNKNOWN", next, explanation, ruleId) };
  }

  if (defaultAction === "allow") {
    const policy = `${firewallId}.defaultAction`;
    const explanation = [`Firewall '${firewallId}' default action allows unmatched traffic.`];
    return { truth: "TRUE", policy, explanation, policyDecision: decision("TRUE", traces, explanation, policy, true) };
  }
  if (defaultAction === "deny" || defaultAction === "block") {
    const policy = `${firewallId}.defaultAction`;
    const explanation = [`Firewall '${firewallId}' default action blocks unmatched traffic.`];
    return { truth: "FALSE", policy, explanation, policyDecision: decision("FALSE", traces, explanation, policy, true) };
  }
  if (defaultAction !== undefined) {
    const explanation = [`Firewall '${firewallId}' default action is unsupported/malformed.`];
    return { truth: "UNKNOWN", explanation, policyDecision: decision("UNKNOWN", traces, explanation) };
  }
  if (malformedRelevant) {
    const explanation = [`Firewall '${firewallId}' contains policy data the Foundation engine cannot safely interpret.`];
    return { truth: "UNKNOWN", explanation, policyDecision: decision("UNKNOWN", traces, explanation) };
  }
  const explanation = [`No firewall rule matched on '${firewallId}', and no defaultAction is declared.`];
  return { truth: "UNKNOWN", explanation, policyDecision: decision("UNKNOWN", traces, explanation) };
}

interface FirewallClassification {
  readonly scope?: FirewallScope;
  readonly malformed?: boolean;
  readonly explanation?: readonly string[];
}

function classifyFirewall(state: EngineState, resourceId: string): FirewallClassification {
  const resource = state.resources[resourceId];
  if (!resource) return {};
  if (resource.type === "network.firewall") return { scope: "NETWORK" };
  const marker = resource.properties.isFirewall;
  if (marker === true) return { scope: "LOCAL_HOST" };
  if (marker !== undefined && marker !== false) {
    return { malformed: true, explanation: [`Resource '${resourceId}' has malformed isFirewall state; firewall scope cannot be proven.`] };
  }
  if (resource.properties.rules !== undefined || resource.properties.defaultAction !== undefined) {
    return { malformed: true, explanation: [`Resource '${resourceId}' declares firewall policy without isFirewall=true; local firewall scope cannot be proven.`] };
  }
  return {};
}

function connectionEnabled(properties: Readonly<Record<string, unknown>>): boolean {
  return properties.enabled !== false;
}

function adjacency(scenario: NormalizedScenario): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, Set<string>>();
  const add = (from: string, to: string): void => {
    const set = map.get(from) ?? new Set<string>();
    set.add(to);
    map.set(from, set);
  };
  for (const connection of scenario.connections) {
    if ((connection.kind !== "network" && connection.kind !== "management") || !connectionEnabled(connection.properties)) continue;
    add(connection.from.resource, connection.to.resource);
    const direction = connection.properties.direction;
    if (direction !== "forward") add(connection.to.resource, connection.from.resource);
  }
  const out = new Map<string, readonly string[]>();
  for (const [key, values] of map.entries()) out.set(key, [...values].sort((a, b) => a.localeCompare(b, "en")));
  return out;
}

function enumeratePaths(scenario: NormalizedScenario, from: string, to: string, limit = 128): { readonly paths: readonly (readonly string[])[]; readonly truncated: boolean } {
  if (from === to) return { paths: [[from]], truncated: false };
  const graph = adjacency(scenario);
  const queue: string[][] = [[from]];
  const found: string[][] = [];
  let truncated = false;
  const maxDepth = Math.max(1, scenario.resources.length);

  while (queue.length > 0) {
    const path = queue.shift()!;
    if (path.length > maxDepth) continue;
    const current = path[path.length - 1]!;
    for (const next of graph.get(current) ?? []) {
      if (path.includes(next)) continue;
      const candidate = [...path, next];
      if (next === to) {
        found.push(candidate);
        if (found.length >= limit) {
          truncated = queue.length > 0;
          return { paths: found, truncated };
        }
      } else {
        queue.push(candidate);
      }
    }
  }
  return { paths: found, truncated };
}

function evaluatePath(scenario: NormalizedScenario, state: EngineState, path: readonly string[], query: FlowQuery, options: PathEvaluationOptions = {}): PathVerdict {
  const includeSecurity = options.includeSecurity !== false;
  const includeListener = options.includeListener !== false;
  const explanations: string[] = [`Topology path: ${path.join(" -> ")}.`];
  let sawUnknown = false;
  let unknownPoint: string | undefined;
  let unknownPolicy: string | undefined;
  let effectivePort = query.port;
  let effectiveSource = uniqueIpv4Source(state, query.from);
  let matchedSnatRule: string | undefined;
  const observedSources = new Map<string, string | undefined>();
  const routeDecisions: RouteDecisionTrace[] = [];
  const neighborDecisions: NeighborDecisionTrace[] = [];
  const macDecisions: MacDecisionTrace[] = [];
  const vlanDecisions: VlanDecisionTrace[] = [];
  const stpDecisions: StpDecisionTrace[] = [];
  const policyDecisions: PolicyDecisionTrace[] = [];
  const natDecisions: NatDecisionTrace[] = [];
  const conntrackDecisions: ConntrackDecisionTrace[] = [];
  let hostStackDecision: HostStackDecisionTrace | undefined;
  let listenerServiceDecision: ListenerServiceDecisionTrace | undefined;
  let tcpStateMachineDecision: TcpStateMachineDecisionTrace | undefined;
  let networkTruthBeforeListener: TruthValue | undefined;
  const traceDetails = () => ({
    ...(networkTruthBeforeListener ? { networkTruthBeforeListener } : {}),
    ...(effectivePort !== query.port && effectivePort !== undefined ? { translatedPort: effectivePort } : {}),
    ...(matchedSnatRule !== undefined && effectiveSource !== undefined ? { translatedSource: effectiveSource, matchedSnatRule } : {}),
    ...(routeDecisions.length ? { routeDecisions } : {}),
    ...(neighborDecisions.length ? { neighborDecisions } : {}),
    ...(macDecisions.length ? { macDecisions } : {}),
    ...(vlanDecisions.length ? { vlanDecisions } : {}),
    ...(stpDecisions.length ? { stpDecisions } : {}),
    ...(policyDecisions.length ? { policyDecisions } : {}),
    ...(natDecisions.length ? { natDecisions } : {}),
    ...(conntrackDecisions.length ? { conntrackDecisions } : {}),
    ...(hostStackDecision ? { hostStackDecision } : {}),
    ...(listenerServiceDecision ? { listenerServiceDecision } : {}),
    ...(tcpStateMachineDecision ? { tcpStateMachineDecision } : {}),
  });
  observedSources.set(path[0]!, effectiveSource);

  let carriedVlanFrame: { readonly from: string; readonly to: string; readonly frame: VlanFrameContext } | undefined;
  for (let index = 0; index < path.length - 1; index += 1) {
    const current = path[index]!;
    const next = path[index + 1]!;

    // NAT is evaluated only after this transit resource has actually been reached.
    // This preserves lower-layer blocking authority: an upstream VLAN/MAC/STP/route/neighbor
    // failure cannot fabricate a NAT decision for a downstream resource that never saw the flow.
    if (includeSecurity && index > 0 && index < path.length - 1) {
      observedSources.set(current, effectiveSource);
      const nat = evaluateDnat(state, current, query, effectiveSource, effectivePort);
      if (nat) {
        if (nat.natDecision) natDecisions.push(nat.natDecision);
        explanations.push(...nat.explanation);
        if (nat.truth === "FALSE") return { truth: "FALSE", path, explanation: explanations, blockingPoint: current, ...(nat.policy ? { matchedPolicy: nat.policy } : {}), ...traceDetails() };
        if (nat.truth === "UNKNOWN") { sawUnknown = true; unknownPoint = current; unknownPolicy = nat.policy; }
        if (nat.truth === "TRUE" && nat.translatedPort !== undefined) effectivePort = nat.translatedPort;
      }
      const snat = evaluateSnat(state, current, query, effectiveSource, effectivePort);
      if (snat) {
        if (snat.natDecision) natDecisions.push(snat.natDecision);
        explanations.push(...snat.explanation);
        if (snat.truth === "FALSE") return { truth: "FALSE", path, explanation: explanations, blockingPoint: current, ...(snat.policy ? { matchedPolicy: snat.policy } : {}), ...traceDetails() };
        // A downstream policy decision cannot be inferred using an unknown source rewrite.
        if (snat.truth === "UNKNOWN") return { truth: "UNKNOWN", path, explanation: explanations, blockingPoint: current, ...(snat.policy ? { matchedPolicy: snat.policy } : {}), ...traceDetails() };
        if (snat.translatedSource !== undefined) effectiveSource = snat.translatedSource;
        if (snat.policy !== undefined) matchedSnatRule = snat.policy;
      }
    }

    const vlan = evaluateVlanSegment(scenario, state, current, next);
    explanations.push(...vlan.explanation);
    if (vlan.truth === "FALSE") return { truth: "FALSE", path, explanation: explanations, blockingPoint: current, ...(vlan.policy ? { matchedPolicy: vlan.policy } : {}), ...traceDetails() };
    if (vlan.truth === "UNKNOWN") { sawUnknown = true; unknownPoint = current; unknownPolicy = vlan.policy; }

    if (index > 0) {
      const previous = path[index - 1]!;
      const incomingFrame = carriedVlanFrame?.from === previous && carriedVlanFrame.to === current ? carriedVlanFrame.frame : undefined;
      carriedVlanFrame = undefined;
      const vlanSwitch = evaluateVlanSwitching(scenario, state, previous, current, next, query, incomingFrame);
      if (vlanSwitch) {
        if (vlanSwitch.vlanDecision) vlanDecisions.push(vlanSwitch.vlanDecision);
        explanations.push(...vlanSwitch.explanation);
        if (vlanSwitch.truth === "FALSE") return { truth: "FALSE", path, explanation: explanations, blockingPoint: current, ...(vlanSwitch.policy ? { matchedPolicy: vlanSwitch.policy } : {}), ...traceDetails() };
        if (vlanSwitch.truth === "UNKNOWN") { sawUnknown = true; unknownPoint = current; unknownPolicy = vlanSwitch.policy; }
        if (vlanSwitch.truth === "TRUE" && vlanSwitch.vlanFrame) carriedVlanFrame = { from: current, to: next, frame: vlanSwitch.vlanFrame };
      }

      if (!vlanSwitch || vlanSwitch.truth === "TRUE") {
        const mac = evaluateMacSwitching(scenario, state, previous, current, next, query, vlanSwitch?.vlanDecision?.vlan);
        const stp = evaluateStpSwitching(scenario, state, previous, current, next, query);
        if (mac) {
          if (mac.macDecision) macDecisions.push(mac.macDecision);
          explanations.push(...mac.explanation);
        }
        if (stp) {
          if (stp.stpDecision) stpDecisions.push(stp.stpDecision);
          explanations.push(...stp.explanation);
        }
        if (mac?.truth === "FALSE") return { truth: "FALSE", path, explanation: explanations, blockingPoint: current, ...(mac.policy ? { matchedPolicy: mac.policy } : {}), ...traceDetails() };
        if (stp?.truth === "FALSE") return { truth: "FALSE", path, explanation: explanations, blockingPoint: current, ...(stp.policy ? { matchedPolicy: stp.policy } : {}), ...traceDetails() };
        if (mac?.truth === "UNKNOWN") { sawUnknown = true; unknownPoint = current; unknownPolicy = mac.policy; }
        if (stp?.truth === "UNKNOWN") { sawUnknown = true; unknownPoint = current; unknownPolicy = stp.policy; }
      }
    } else {
      carriedVlanFrame = undefined;
    }

    const route = evaluateRoute(state, current, next, query);
    if (route) {
      if (route.routeDecision) routeDecisions.push(route.routeDecision);
      explanations.push(...route.explanation);
      if (route.truth === "FALSE") return { truth: "FALSE", path, explanation: explanations, blockingPoint: current, ...(route.policy ? { matchedPolicy: route.policy } : {}), ...traceDetails() };
      if (route.truth === "UNKNOWN") { sawUnknown = true; unknownPoint = current; unknownPolicy = route.policy; }
    }
    const neighbor = evaluateNeighbor(state, current, next, query, route?.routeDecision);
    if (neighbor) {
      if (neighbor.neighborDecision) neighborDecisions.push(neighbor.neighborDecision);
      explanations.push(...neighbor.explanation);
      if (neighbor.truth === "FALSE") return { truth: "FALSE", path, explanation: explanations, blockingPoint: current, ...(neighbor.policy ? { matchedPolicy: neighbor.policy } : {}), ...traceDetails() };
      if (neighbor.truth === "UNKNOWN") { sawUnknown = true; unknownPoint = current; unknownPolicy = neighbor.policy; }
    }
  }

  observedSources.set(path[path.length - 1]!, effectiveSource);
  const sourceDetails = matchedSnatRule !== undefined && effectiveSource !== undefined
    ? { translatedSource: effectiveSource, matchedSnatRule }
    : {};

  if (includeSecurity) for (const resourceId of path) {
    const acl = evaluateAcl(state, resourceId, query, observedSources.get(resourceId));
    if (acl) {
      if (acl.policyDecision) policyDecisions.push(acl.policyDecision);
      explanations.push(...acl.explanation);
      if (acl.truth === "FALSE") return { truth: "FALSE", path, explanation: explanations, blockingPoint: resourceId, ...(acl.policy ? { matchedPolicy: acl.policy } : {}), ...traceDetails() };
      if (acl.truth === "UNKNOWN") { sawUnknown = true; unknownPoint = resourceId; unknownPolicy = acl.policy; }
    }
    const firewall = classifyFirewall(state, resourceId);
    if (firewall.malformed) {
      explanations.push(...(firewall.explanation ?? []));
      return { truth: "UNKNOWN", path, explanation: explanations, blockingPoint: resourceId, ...traceDetails() };
    }
    if (firewall.scope === undefined) continue;
    const conntrack = evaluateConntrack(state, resourceId, query, observedSources.get(resourceId));
    if (conntrack) {
      conntrackDecisions.push(conntrack.conntrackDecision);
      explanations.push(...conntrack.explanation);
    }
    const policy = evaluateFirewall(state, resourceId, firewall.scope, query, observedSources.get(resourceId), conntrack?.conntrackDecision);
    if (policy.policyDecision) policyDecisions.push(policy.policyDecision);
    explanations.push(...policy.explanation);
    if (policy.truth === "FALSE") {
      return {
        truth: "FALSE",
        path,
        explanation: explanations,
        blockingPoint: resourceId,
        ...(policy.policy !== undefined ? { matchedPolicy: policy.policy } : {}),
        ...traceDetails(),
      };
    }
    if (policy.truth === "UNKNOWN") {
      sawUnknown = true;
      unknownPoint = resourceId;
      unknownPolicy = policy.policy;
    }
  }

  // Uncertain upstream UDP/ICMP evidence cannot prove that the endpoint was reached.
  // Preserve existing TCP/any semantics; Phase 97 does not reinterpret Phase 96.
  networkTruthBeforeListener = sawUnknown ? "UNKNOWN" : "TRUE";
  if (sawUnknown && (query.protocol === "udp" || query.protocol === "icmp")) {
    return { truth: "UNKNOWN", path, explanation: explanations,
      ...(unknownPoint ? { blockingPoint: unknownPoint } : {}), ...traceDetails() };
  }
  if (includeListener) {
    const hostStack = queryHostStackView(state, query.to, query.protocol, effectivePort);
    if (hostStack.value) hostStackDecision = hostStack.value;
    const listener = queryListeningPort(state, query.to, query.protocol, effectivePort);
    if (listener.value) listenerServiceDecision = listener.value;
    if (query.protocol === "tcp" && effectivePort !== undefined) {
      const tcpState = queryTcpStateMachine(state, query.from, query.to, effectivePort);
      if (tcpState.value) tcpStateMachineDecision = tcpState.value;
    }
    explanations.push(...listener.explanation);
    if (query.protocol === "udp" && listenerServiceDecision &&
        (listenerServiceDecision.selectedSocketIds.length > 1 ||
          hostStackDecision && new Set(hostStackDecision.services.map(row => row.name)).size !== hostStackDecision.services.length)) {
      sawUnknown = true;
      unknownPoint = query.to;
      explanations.push("UDP delivery target is ambiguous or contains duplicate service identities; socket selection/reuse semantics are NOT_MODELED.");
    }
    if (listener.truth === "FALSE") {
      return { truth: "FALSE", path, explanation: explanations, blockingPoint: query.to, ...traceDetails() };
    }
    if (listener.truth === "UNKNOWN") sawUnknown = true;
  }

  if (sawUnknown) {
    return {
      truth: "UNKNOWN",
      path,
      explanation: explanations,
      ...(effectivePort !== query.port && effectivePort !== undefined ? { translatedPort: effectivePort } : {}),
      ...sourceDetails,
      ...(unknownPoint !== undefined ? { blockingPoint: unknownPoint } : {}),
      ...(unknownPolicy !== undefined ? { matchedPolicy: unknownPolicy } : {}),
      ...traceDetails(),
    };
  }
  return { truth: "TRUE", path, explanation: explanations, ...(effectivePort !== query.port && effectivePort !== undefined ? { translatedPort: effectivePort } : {}), ...sourceDetails, ...traceDetails() };
}

function queryReachabilityOneWay(
  scenario: NormalizedScenario,
  state: EngineState,
  from: string,
  to: string,
  protocol: "tcp" | "udp" | "icmp" | "any" = "any",
  port?: number,
  options: PathEvaluationOptions = {},
): EngineQueryResult<ReachabilityDetails> {
  if (!state.resources[from] || !state.resources[to]) {
    return { truth: "UNKNOWN", explanation: [`Reachability endpoint is absent from runtime state: '${from}' -> '${to}'.`] };
  }
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    return { truth: "UNKNOWN", explanation: [`Port '${String(port)}' is outside 1..65535.`] };
  }

  const query: FlowQuery = { from, to, protocol, ...(port !== undefined ? { port } : {}) };
  const { paths, truncated } = enumeratePaths(scenario, from, to);
  if (paths.length === 0) {
    return {
      truth: "FALSE",
      value: { from, to, protocol, ...(port !== undefined ? { port } : {}), networkTruthBeforeListener: "FALSE" },
      explanation: [`No declared network/management topology path exists from '${from}' to '${to}'.`],
    };
  }

  const verdicts = paths.map((path) => evaluatePath(scenario, state, path, query, options));
  const proven = verdicts.find((item) => item.truth === "TRUE");
  if (proven) {
    return {
      truth: "TRUE",
      value: { from, to, protocol, ...(port !== undefined ? { port } : {}), path: proven.path, networkTruthBeforeListener: proven.networkTruthBeforeListener ?? proven.truth, ...(proven.matchedPolicy ? { matchedPolicy: proven.matchedPolicy } : {}), ...(proven.translatedPort !== undefined ? { translatedPort: proven.translatedPort } : {}), ...(proven.translatedSource !== undefined ? { translatedSource: proven.translatedSource } : {}), ...(proven.matchedSnatRule !== undefined ? { matchedSnatRule: proven.matchedSnatRule } : {}), ...(proven.routeDecisions?.length ? { routeDecisions: proven.routeDecisions } : {}), ...(proven.neighborDecisions?.length ? { neighborDecisions: proven.neighborDecisions } : {}), ...(proven.macDecisions?.length ? { macDecisions: proven.macDecisions } : {}), ...(proven.vlanDecisions?.length ? { vlanDecisions: proven.vlanDecisions } : {}), ...(proven.stpDecisions?.length ? { stpDecisions: proven.stpDecisions } : {}), ...(proven.policyDecisions?.length ? { policyDecisions: proven.policyDecisions } : {}), ...(proven.natDecisions?.length ? { natDecisions: proven.natDecisions } : {}), ...(proven.conntrackDecisions?.length ? { conntrackDecisions: proven.conntrackDecisions } : {}), ...(proven.hostStackDecision ? { hostStackDecision: proven.hostStackDecision } : {}), ...(proven.listenerServiceDecision ? { listenerServiceDecision: proven.listenerServiceDecision } : {}), ...(proven.tcpStateMachineDecision ? { tcpStateMachineDecision: proven.tcpStateMachineDecision } : {}) },
      explanation: proven.explanation,
    };
  }

  const uncertain = verdicts.find((item) => item.truth === "UNKNOWN");
  if (uncertain || truncated) {
    const chosen = uncertain ?? verdicts[0]!;
    return {
      truth: "UNKNOWN",
      value: {
        from,
        to,
        protocol,
        ...(port !== undefined ? { port } : {}),
        path: chosen.path,
        networkTruthBeforeListener: chosen.networkTruthBeforeListener ?? chosen.truth,
        ...(chosen.blockingPoint ? { blockingPoint: chosen.blockingPoint } : {}),
        ...(chosen.matchedPolicy ? { matchedPolicy: chosen.matchedPolicy } : {}),
        ...(chosen.translatedPort !== undefined ? { translatedPort: chosen.translatedPort } : {}), ...(chosen.translatedSource !== undefined ? { translatedSource: chosen.translatedSource } : {}), ...(chosen.matchedSnatRule !== undefined ? { matchedSnatRule: chosen.matchedSnatRule } : {}),
        ...(chosen.routeDecisions?.length ? { routeDecisions: chosen.routeDecisions } : {}),
        ...(chosen.neighborDecisions?.length ? { neighborDecisions: chosen.neighborDecisions } : {}),
        ...(chosen.macDecisions?.length ? { macDecisions: chosen.macDecisions } : {}),
        ...(chosen.vlanDecisions?.length ? { vlanDecisions: chosen.vlanDecisions } : {}),
        ...(chosen.stpDecisions?.length ? { stpDecisions: chosen.stpDecisions } : {}),
        ...(chosen.policyDecisions?.length ? { policyDecisions: chosen.policyDecisions } : {}),
        ...(chosen.natDecisions?.length ? { natDecisions: chosen.natDecisions } : {}),
        ...(chosen.conntrackDecisions?.length ? { conntrackDecisions: chosen.conntrackDecisions } : {}),
        ...(chosen.hostStackDecision ? { hostStackDecision: chosen.hostStackDecision } : {}),
        ...(chosen.listenerServiceDecision ? { listenerServiceDecision: chosen.listenerServiceDecision } : {}),
        ...(chosen.tcpStateMachineDecision ? { tcpStateMachineDecision: chosen.tcpStateMachineDecision } : {}),
      },
      explanation: [...chosen.explanation, ...(truncated ? ["Path search reached the deterministic Foundation safety limit; absence of another viable path is not proven."] : [])],
    };
  }

  const blocked = verdicts[0]!;
  return {
    truth: "FALSE",
    value: {
      from,
      to,
      protocol,
      ...(port !== undefined ? { port } : {}),
      path: blocked.path,
      networkTruthBeforeListener: blocked.networkTruthBeforeListener ?? blocked.truth,
      ...(blocked.blockingPoint ? { blockingPoint: blocked.blockingPoint } : {}),
      ...(blocked.matchedPolicy ? { matchedPolicy: blocked.matchedPolicy } : {}),
      ...(blocked.translatedPort !== undefined ? { translatedPort: blocked.translatedPort } : {}), ...(blocked.translatedSource !== undefined ? { translatedSource: blocked.translatedSource } : {}), ...(blocked.matchedSnatRule !== undefined ? { matchedSnatRule: blocked.matchedSnatRule } : {}),
      ...(blocked.routeDecisions?.length ? { routeDecisions: blocked.routeDecisions } : {}),
      ...(blocked.neighborDecisions?.length ? { neighborDecisions: blocked.neighborDecisions } : {}),
      ...(blocked.macDecisions?.length ? { macDecisions: blocked.macDecisions } : {}),
      ...(blocked.vlanDecisions?.length ? { vlanDecisions: blocked.vlanDecisions } : {}),
      ...(blocked.stpDecisions?.length ? { stpDecisions: blocked.stpDecisions } : {}),
      ...(blocked.policyDecisions?.length ? { policyDecisions: blocked.policyDecisions } : {}),
      ...(blocked.natDecisions?.length ? { natDecisions: blocked.natDecisions } : {}),
      ...(blocked.conntrackDecisions?.length ? { conntrackDecisions: blocked.conntrackDecisions } : {}),
      ...(blocked.hostStackDecision ? { hostStackDecision: blocked.hostStackDecision } : {}),
      ...(blocked.listenerServiceDecision ? { listenerServiceDecision: blocked.listenerServiceDecision } : {}),
      ...(blocked.tcpStateMachineDecision ? { tcpStateMachineDecision: blocked.tcpStateMachineDecision } : {}),
    },
    explanation: blocked.explanation,
  };
}


function layer2Transit(resource: RuntimeResourceState | undefined): boolean {
  return resource?.type === "network.switch" || resource?.type === "network.l2_switch" || resource?.type === "network.l3_switch";
}

function evaluateLayer2BroadcastPath(
  scenario: NormalizedScenario,
  state: EngineState,
  path: readonly string[],
): PathVerdict {
  const from = path[0]!;
  const to = path[path.length - 1]!;
  const query: FlowQuery = { from, to, protocol: "udp", port: 67 };
  const explanation: string[] = [`DHCP L2 broadcast path: ${path.join(" -> ")}.`];
  const vlanDecisions: VlanDecisionTrace[] = [];
  const stpDecisions: StpDecisionTrace[] = [];
  let sawUnknown = false;
  let unknownPoint: string | undefined;
  let carriedVlanFrame: { readonly from: string; readonly to: string; readonly frame: VlanFrameContext } | undefined;

  for (let index = 0; index < path.length - 1; index += 1) {
    const current = path[index]!;
    const next = path[index + 1]!;
    if (index > 0 && index < path.length - 1 && !layer2Transit(state.resources[current])) {
      return { truth: "FALSE", path, blockingPoint: current, explanation: [...explanation, `Resource '${current}' is an L3/non-switch transit boundary; DHCP relay is not modeled in Phase 94.`], vlanDecisions, stpDecisions };
    }

    const segment = evaluateVlanSegment(scenario, state, current, next);
    explanation.push(...segment.explanation);
    if (segment.truth === "FALSE") return { truth: "FALSE", path, blockingPoint: current, explanation, vlanDecisions, stpDecisions };
    if (segment.truth === "UNKNOWN") { sawUnknown = true; unknownPoint = current; }

    if (index > 0) {
      const previous = path[index - 1]!;
      const incomingFrame = carriedVlanFrame?.from === previous && carriedVlanFrame.to === current ? carriedVlanFrame.frame : undefined;
      carriedVlanFrame = undefined;
      const vlanSwitch = evaluateVlanSwitching(scenario, state, previous, current, next, query, incomingFrame);
      if (vlanSwitch) {
        if (vlanSwitch.vlanDecision) vlanDecisions.push(vlanSwitch.vlanDecision);
        explanation.push(...vlanSwitch.explanation);
        if (vlanSwitch.truth === "FALSE") return { truth: "FALSE", path, blockingPoint: current, explanation, vlanDecisions, stpDecisions };
        if (vlanSwitch.truth === "UNKNOWN") { sawUnknown = true; unknownPoint = current; }
        if (vlanSwitch.truth === "TRUE" && vlanSwitch.vlanFrame) carriedVlanFrame = { from: current, to: next, frame: vlanSwitch.vlanFrame };
      }
      if (!vlanSwitch || vlanSwitch.truth === "TRUE") {
        const stp = evaluateStpSwitching(scenario, state, previous, current, next, query);
        if (stp?.stpDecision) stpDecisions.push(stp.stpDecision);
        if (stp) explanation.push(...stp.explanation);
        if (stp?.truth === "FALSE") return { truth: "FALSE", path, blockingPoint: current, explanation, vlanDecisions, stpDecisions };
        if (stp?.truth === "UNKNOWN") { sawUnknown = true; unknownPoint = current; }
      }
    }
  }
  return { truth: sawUnknown ? "UNKNOWN" : "TRUE", path, ...(unknownPoint ? { blockingPoint: unknownPoint } : {}), explanation, vlanDecisions, stpDecisions };
}

export function queryLayer2BroadcastReachability(
  scenario: NormalizedScenario,
  state: EngineState,
  from: string,
  to: string,
): EngineQueryResult<ReachabilityDetails> {
  if (!state.resources[from] || !state.resources[to]) return { truth: "UNKNOWN", explanation: [`L2 broadcast endpoint '${!state.resources[from] ? from : to}' is absent from Engine state.`] };
  const enumerated = enumeratePaths(scenario, from, to);
  if (enumerated.paths.length === 0) return { truth: "FALSE", value: { from, to, protocol: "udp", port: 67 }, explanation: [`No enabled modeled topology path exists from '${from}' to '${to}' for local DHCP broadcast.`] };
  const verdicts = enumerated.paths.map((path) => evaluateLayer2BroadcastPath(scenario, state, path));
  const proven = verdicts.find((item) => item.truth === "TRUE");
  if (proven) return { truth: "TRUE", value: { from, to, protocol: "udp", port: 67, path: proven.path, ...(proven.vlanDecisions?.length ? { vlanDecisions: proven.vlanDecisions } : {}), ...(proven.stpDecisions?.length ? { stpDecisions: proven.stpDecisions } : {}) }, explanation: proven.explanation };
  const uncertain = verdicts.find((item) => item.truth === "UNKNOWN");
  if (uncertain || enumerated.truncated) {
    const chosen = uncertain ?? verdicts[0]!;
    return { truth: "UNKNOWN", value: { from, to, protocol: "udp", port: 67, path: chosen.path, ...(chosen.blockingPoint ? { blockingPoint: chosen.blockingPoint } : {}), ...(chosen.vlanDecisions?.length ? { vlanDecisions: chosen.vlanDecisions } : {}), ...(chosen.stpDecisions?.length ? { stpDecisions: chosen.stpDecisions } : {}) }, explanation: [...chosen.explanation, ...(enumerated.truncated ? ["L2 path search reached the deterministic safety limit."] : [])] };
  }
  const blocked = verdicts[0]!;
  return { truth: "FALSE", value: { from, to, protocol: "udp", port: 67, path: blocked.path, ...(blocked.blockingPoint ? { blockingPoint: blocked.blockingPoint } : {}), ...(blocked.vlanDecisions?.length ? { vlanDecisions: blocked.vlanDecisions } : {}), ...(blocked.stpDecisions?.length ? { stpDecisions: blocked.stpDecisions } : {}) }, explanation: blocked.explanation };
}

function pathSymmetry(forwardPath: readonly string[] | undefined, returnPath: readonly string[] | undefined): ForwardReturnPathComparisonTrace["symmetry"] {
  const forward = forwardPath ?? [];
  const returned = returnPath ?? [];
  if (forward.length === 0 && returned.length === 0) return "UNRESOLVED";
  if (forward.length === 0 || returned.length === 0) return "ASYMMETRIC";
  const expectedReturn = [...forward].reverse();
  return expectedReturn.length === returned.length && expectedReturn.every((resourceId, index) => returned[index] === resourceId)
    ? "SYMMETRIC"
    : "ASYMMETRIC";
}

function interfaceComparisons(
  forwardRoutes: readonly RouteDecisionTrace[] | undefined,
  returnRoutes: readonly RouteDecisionTrace[] | undefined,
): readonly PathInterfaceComparisonTrace[] {
  const forwardByResource = new Map((forwardRoutes ?? []).map((decision) => [decision.resourceId, decision] as const));
  const returnByResource = new Map((returnRoutes ?? []).map((decision) => [decision.resourceId, decision] as const));
  const ids = [...new Set([...forwardByResource.keys(), ...returnByResource.keys()])].sort((a, b) => a.localeCompare(b, "en"));
  return ids.map((resourceId) => {
    const forwardOutgoingInterface = forwardByResource.get(resourceId)?.outgoingInterface;
    const returnOutgoingInterface = returnByResource.get(resourceId)?.outgoingInterface;
    return {
      resourceId,
      ...(forwardOutgoingInterface !== undefined ? { forwardOutgoingInterface } : {}),
      ...(returnOutgoingInterface !== undefined ? { returnOutgoingInterface } : {}),
      differs: forwardOutgoingInterface !== undefined && returnOutgoingInterface !== undefined && forwardOutgoingInterface !== returnOutgoingInterface,
    };
  });
}

function buildPathComparison(
  from: string,
  to: string,
  protocol: "tcp" | "udp" | "icmp" | "any",
  port: number | undefined,
  forward: EngineQueryResult<ReachabilityDetails>,
  returned: EngineQueryResult<ReachabilityDetails>,
  returnSecurityModeled: boolean,
): ForwardReturnPathComparisonTrace {
  const forwardPath = forward.value?.path;
  const returnPath = returned.value?.path;
  const symmetry = pathSymmetry(forwardPath, returnPath);
  const forwardHasNatState = Boolean(forward.value?.natDecisions?.length || forward.value?.conntrackDecisions?.length);
  const returnHasNatState = Boolean(returned.value?.natDecisions?.length || returned.value?.conntrackDecisions?.length);
  const natStateImplication: ForwardReturnPathComparisonTrace["natStateImplication"] = returnSecurityModeled
    ? (forwardHasNatState || returnHasNatState ? "MODELED" : "NONE")
    : (forwardHasNatState ? "RETURN_TUPLE_REQUIRED" : "NONE");
  const explanation = [
    `Forward path verdict is ${forward.truth}; return-path verdict is ${returned.truth}.`,
    symmetry === "SYMMETRIC"
      ? "Return path is the exact reverse of the proven forward path."
      : symmetry === "ASYMMETRIC"
        ? "Forward and return paths differ, or only one direction has a declared path."
        : "Path symmetry is unresolved because neither direction has a proven path.",
    returnSecurityModeled
      ? "Return path uses the full Engine security/state pipeline with endpoint-listener evaluation disabled for response traffic."
      : "Return path is NETWORK_ONLY because the reverse TCP/UDP destination port is not modeled; Engine does not fabricate reverse NAT/firewall/conntrack truth.",
  ];
  return {
    sourceId: from,
    destinationId: to,
    protocol,
    ...(port !== undefined ? { servicePort: port } : {}),
    forwardTruth: forward.truth,
    ...(forwardPath?.length ? { forwardPath } : {}),
    ...(forward.value?.blockingPoint ? { forwardBlockingPoint: forward.value.blockingPoint } : {}),
    returnTruth: returned.truth,
    ...(returnPath?.length ? { returnPath } : {}),
    ...(returned.value?.blockingPoint ? { returnBlockingPoint: returned.value.blockingPoint } : {}),
    symmetry,
    returnEvaluationMode: returnSecurityModeled ? "FULL" : "NETWORK_ONLY",
    returnSecurityStatus: returnSecurityModeled ? "MODELED" : "RETURN_TUPLE_NOT_MODELED",
    natStateImplication,
    interfaceComparisons: interfaceComparisons(forward.value?.routeDecisions, returned.value?.routeDecisions),
    ...(returned.value?.routeDecisions?.length ? { returnRouteDecisions: returned.value.routeDecisions } : {}),
    ...(returned.value?.neighborDecisions?.length ? { returnNeighborDecisions: returned.value.neighborDecisions } : {}),
    ...(returned.value?.macDecisions?.length ? { returnMacDecisions: returned.value.macDecisions } : {}),
    ...(returned.value?.vlanDecisions?.length ? { returnVlanDecisions: returned.value.vlanDecisions } : {}),
    ...(returned.value?.stpDecisions?.length ? { returnStpDecisions: returned.value.stpDecisions } : {}),
    ...(returned.value?.policyDecisions?.length ? { returnPolicyDecisions: returned.value.policyDecisions } : {}),
    ...(returned.value?.natDecisions?.length ? { returnNatDecisions: returned.value.natDecisions } : {}),
    ...(returned.value?.conntrackDecisions?.length ? { returnConntrackDecisions: returned.value.conntrackDecisions } : {}),
    explanation,
  };
}

export function queryReachability(
  scenario: NormalizedScenario,
  state: EngineState,
  from: string,
  to: string,
  protocol: "tcp" | "udp" | "icmp" | "any" = "any",
  port?: number,
): EngineQueryResult<ReachabilityDetails> {
  if (protocol === "udp" && port === undefined || protocol === "icmp" && port !== undefined) {
    return withUdpIcmpFailureDiagnostic({ truth: "UNKNOWN", value: { from, to, protocol,
      ...(port !== undefined ? { port } : {}), networkTruthBeforeListener: "UNKNOWN" },
      explanation: ["UDP diagnostic requires a destination port; ICMP is portless. Invalid protocol/port binding."] });
  }
  const forward = queryReachabilityOneWay(scenario, state, from, to, protocol, port);
  if (!forward.value || !state.resources[from] || !state.resources[to]) return forward;

  // A TCP/UDP response targets a client ephemeral port that Foundation does not currently model.
  // Never mirror the service destination port onto the return packet. Portless modeled flows can
  // safely traverse the full reverse security/state pipeline; service-port flows use network-only
  // return analysis so route/L2 asymmetry remains visible without fabricated firewall/conntrack truth.
  const returnSecurityModeled = port === undefined;
  const returned = queryReachabilityOneWay(
    scenario,
    state,
    to,
    from,
    protocol,
    undefined,
    { includeSecurity: returnSecurityModeled, includeListener: false },
  );
  const pathComparison = buildPathComparison(from, to, protocol, port, forward, returned, returnSecurityModeled);
  return withUdpIcmpFailureDiagnostic({
    ...forward,
    value: { ...forward.value, pathComparison },
  });
}
