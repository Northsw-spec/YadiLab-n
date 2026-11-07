import type { NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import { queryDhcpDora, queryDnsChain, queryReachability, readPath, queryReachabilityWithSourceGateway } from "../../engine/src/index.js";
import { addressInCidr, parseIpAddress } from "../../engine/src/ip.js";
import type { UdpIcmpFailureDecisionTrace, ConntrackDecisionTrace, DhcpDoraDecisionTrace, DnsChainDecisionTrace, EngineQueryResult, EngineState, ForwardReturnPathComparisonTrace, HostStackDecisionTrace, ListenerServiceDecisionTrace, TcpStateMachineDecisionTrace, MacDecisionTrace, NatDecisionTrace, NeighborDecisionTrace, PolicyDecisionTrace, ReachabilityDetails, RouteDecisionTrace, StpDecisionTrace, VlanDecisionTrace, RuntimeResourceState, TruthValue } from "../../engine/src/index.js";
import { OBSERVATION_ENGINE_ID, OBSERVATION_ENGINE_VERSION, OBSERVATION_EXECUTION_BOUNDARY } from "./index.js";
import type {
  ActiveProbeDefinition,
  ActiveProbeEvidence,
  ActiveProbeRequest,
  ActiveProbeResult,
  ActiveProbeTranscript,
  ObservationDiagnostic,
  ObservationOs,
} from "./types.js";

const WINDOWS_TYPES = ["windows.domain_controller", "windows.rd_gateway", "windows.rds_host", "windows.server", "windows.workstation"] as const;
const LINUX_TYPES = ["linux.host", "linux.server", "linux.workstation"] as const;

function osForType(type: string): ObservationOs | undefined {
  if (type === "endpoint.windows" || (WINDOWS_TYPES as readonly string[]).includes(type) || type.startsWith("windows.")) return "windows";
  if (type === "endpoint.linux" || (LINUX_TYPES as readonly string[]).includes(type) || type.startsWith("linux.")) return "linux";
  return undefined;
}

function diagnostic(severity: ObservationDiagnostic["severity"], code: string, message: string, path?: string): ObservationDiagnostic {
  return path ? { severity, code, message, path } : { severity, code, message };
}

const PROBES: readonly ActiveProbeDefinition[] = [
  { probeId: "windows.udp_delivery", os: "windows", commandTemplate: "Get-NetUDPEndpoint -LocalPort <port> (modeled <destination>)", label: "UDP delivery / listener check", category: "connectivity", description: "Engine UDP path and destination listener projection; no datagram response, ICMP reply or timeout is fabricated.", argumentKind: "destination_port" },
  { probeId: "linux.udp_delivery", os: "linux", commandTemplate: "ss -lunp sport = :<port> (modeled <destination>)", label: "UDP delivery / listener check", category: "connectivity", description: "Engine UDP path and destination listener projection; no datagram response, ICMP reply or timeout is fabricated.", argumentKind: "destination_port" },
  { probeId: "windows.ping", os: "windows", commandTemplate: "ping <destination>", label: "Ping destination", category: "connectivity", description: "Modeled ICMP reachability using the deterministic Network Engine.", argumentKind: "destination" },
  { probeId: "windows.test_netconnection", os: "windows", commandTemplate: "Test-NetConnection <destination> -Port <port>", label: "Test TCP port", category: "connectivity", description: "Modeled TCP reachability and destination-listener check.", argumentKind: "destination_port" },
  { probeId: "windows.resolve_dnsname", os: "windows", commandTemplate: "Resolve-DnsName <name>", label: "Resolve DNS name", category: "dns", description: "Modeled DNS resolution through the source host's declared resolvers.", argumentKind: "dns_name" },
  { probeId: "windows.ipconfig_renew", os: "windows", commandTemplate: "ipconfig /renew", label: "Renew DHCP lease", category: "dhcp", description: "Modeled DHCP DORA using Engine-owned local L2 and explicit server offer state.", argumentKind: "none" },
  { probeId: "windows.tracert", os: "windows", commandTemplate: "tracert <destination>", label: "Trace modeled path", category: "path", description: "Modeled topology/reachability path and blocking point.", argumentKind: "destination" },
  { probeId: "linux.ping", os: "linux", commandTemplate: "ping -c 4 <destination>", label: "Ping destination", category: "connectivity", description: "Modeled ICMP reachability using the deterministic Network Engine.", argumentKind: "destination" },
  { probeId: "linux.nc_tcp", os: "linux", commandTemplate: "nc -vz <destination> <port>", label: "Test TCP port", category: "connectivity", description: "Modeled TCP reachability and destination-listener check.", argumentKind: "destination_port" },
  { probeId: "linux.dig", os: "linux", commandTemplate: "dig <name>", label: "Resolve DNS name", category: "dns", description: "Modeled DNS resolution through the source host's declared resolvers.", argumentKind: "dns_name" },
  { probeId: "linux.dhclient", os: "linux", commandTemplate: "dhclient -v", label: "Run DHCP DORA", category: "dhcp", description: "Modeled DHCP DORA using Engine-owned local L2 and explicit server offer state.", argumentKind: "none" },
  { probeId: "linux.tracepath", os: "linux", commandTemplate: "tracepath <destination>", label: "Trace modeled path", category: "path", description: "Modeled topology/reachability path and blocking point.", argumentKind: "destination" },
];

const PROBE_BY_ID = new Map(PROBES.map((probe) => [probe.probeId, probe] as const));

export function listActiveProbeDefinitions(state: EngineState, sourceId: string): readonly ActiveProbeDefinition[] {
  const source = state.resources[sourceId];
  if (!source) return [];
  const os = osForType(source.type);
  if (!os) return [];
  return PROBES.filter((probe) => probe.os === os).map(({ ...probe }) => probe);
}

export function listActiveProbeDestinations(state: EngineState, sourceId: string): readonly { readonly id: string; readonly label: string; readonly type: string }[] {
  if (!state.resources[sourceId] || !osForType(state.resources[sourceId]!.type)) return [];
  return Object.values(state.resources)
    .filter((resource) => resource.id !== sourceId)
    .map((resource) => ({ id: resource.id, label: resource.label, type: resource.type }))
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
}

function scenarioMatchesState(scenario: NormalizedScenario, state: EngineState): boolean {
  return scenario.scenarioId === state.scenarioId && scenario.sourceHash === state.scenarioHash;
}

function baseTranscript(args: {
  state: EngineState;
  source: RuntimeResourceState;
  probe: ActiveProbeDefinition;
  command: string;
  truth: TruthValue;
  lines: readonly string[];
  evidence: readonly ActiveProbeEvidence[];
  destination?: RuntimeResourceState;
  protocol?: "tcp" | "udp" | "icmp" | "any";
  port?: number;
  queryName?: string;
  resolvedAddress?: string;
  resolvedResourceIds?: readonly string[];
  path?: readonly string[];
  blockingPoint?: string;
  routeDecisions?: readonly RouteDecisionTrace[];
  neighborDecisions?: readonly NeighborDecisionTrace[];
  macDecisions?: readonly MacDecisionTrace[];
  vlanDecisions?: readonly VlanDecisionTrace[];
  stpDecisions?: readonly StpDecisionTrace[];
  policyDecisions?: readonly PolicyDecisionTrace[];
  natDecisions?: readonly NatDecisionTrace[];
  conntrackDecisions?: readonly ConntrackDecisionTrace[];
  pathComparison?: ForwardReturnPathComparisonTrace;
  hostStackDecision?: HostStackDecisionTrace;
  listenerServiceDecision?: ListenerServiceDecisionTrace;
  tcpStateMachineDecision?: TcpStateMachineDecisionTrace;
  udpIcmpFailureDecision?: UdpIcmpFailureDecisionTrace;
  dnsChainDecision?: DnsChainDecisionTrace;
  dhcpDoraDecision?: DhcpDoraDecisionTrace;
}): ActiveProbeTranscript {
  return {
    engineId: OBSERVATION_ENGINE_ID,
    engineVersion: OBSERVATION_ENGINE_VERSION,
    modeled: true,
    boundary: OBSERVATION_EXECUTION_BOUNDARY,
    probeMode: "ACTIVE_MODELED_PROBE",
    scenarioId: args.state.scenarioId,
    scenarioHash: args.state.scenarioHash,
    stateRevision: args.state.stateRevision,
    sourceId: args.source.id,
    sourceLabel: args.source.label,
    sourceType: args.source.type,
    probeId: args.probe.probeId,
    command: args.command,
    category: args.probe.category,
    truth: args.truth,
    ...(args.destination ? { destinationId: args.destination.id, destinationLabel: args.destination.label } : {}),
    ...(args.protocol ? { protocol: args.protocol } : {}),
    ...(args.port !== undefined ? { port: args.port } : {}),
    ...(args.queryName ? { queryName: args.queryName } : {}),
    ...(args.resolvedAddress ? { resolvedAddress: args.resolvedAddress } : {}),
    ...(args.resolvedResourceIds ? { resolvedResourceIds: args.resolvedResourceIds } : {}),
    ...(args.path ? { path: args.path } : {}),
    ...(args.blockingPoint ? { blockingPoint: args.blockingPoint } : {}),
    ...(args.routeDecisions?.length ? { routeDecisions: args.routeDecisions } : {}),
    ...(args.neighborDecisions?.length ? { neighborDecisions: args.neighborDecisions } : {}),
    ...(args.macDecisions?.length ? { macDecisions: args.macDecisions } : {}),
    ...(args.vlanDecisions?.length ? { vlanDecisions: args.vlanDecisions } : {}),
    ...(args.stpDecisions?.length ? { stpDecisions: args.stpDecisions } : {}),
    ...(args.policyDecisions?.length ? { policyDecisions: args.policyDecisions } : {}),
    ...(args.natDecisions?.length ? { natDecisions: args.natDecisions } : {}),
    ...(args.conntrackDecisions?.length ? { conntrackDecisions: args.conntrackDecisions } : {}),
    ...(args.pathComparison ? { pathComparison: args.pathComparison } : {}),
    ...(args.hostStackDecision ? { hostStackDecision: args.hostStackDecision } : {}),
    ...(args.listenerServiceDecision ? { listenerServiceDecision: args.listenerServiceDecision } : {}),
    ...(args.tcpStateMachineDecision ? { tcpStateMachineDecision: args.tcpStateMachineDecision } : {}),
    ...(args.udpIcmpFailureDecision ? { udpIcmpFailureDecision: args.udpIcmpFailureDecision } : {}),
    ...(args.dnsChainDecision ? { dnsChainDecision: args.dnsChainDecision } : {}),
    ...(args.dhcpDoraDecision ? { dhcpDoraDecision: args.dhcpDoraDecision } : {}),
    lines: args.lines,
    evidence: args.evidence,
  };
}





function reachabilityEvidence(result: EngineQueryResult<ReachabilityDetails>): readonly ActiveProbeEvidence[] {
  return [{ kind: "engine_query", subject: "engine.queryReachability", state: result.truth, ...(result.value ? { value: result.value } : {}) }];
}

function resultPath(result: EngineQueryResult<ReachabilityDetails>): readonly string[] | undefined { return result.value?.path; }
function resultBlockingPoint(result: EngineQueryResult<ReachabilityDetails>): string | undefined { return result.value?.blockingPoint; }
function resultRouteDecisions(result: EngineQueryResult<ReachabilityDetails>): readonly RouteDecisionTrace[] | undefined { return result.value?.routeDecisions; }
function resultNeighborDecisions(result: EngineQueryResult<ReachabilityDetails>): readonly NeighborDecisionTrace[] | undefined { return result.value?.neighborDecisions; }
function resultMacDecisions(result: EngineQueryResult<ReachabilityDetails>): readonly MacDecisionTrace[] | undefined { return result.value?.macDecisions; }
function resultVlanDecisions(result: EngineQueryResult<ReachabilityDetails>): readonly VlanDecisionTrace[] | undefined { return result.value?.vlanDecisions; }
function resultStpDecisions(result: EngineQueryResult<ReachabilityDetails>): readonly StpDecisionTrace[] | undefined { return result.value?.stpDecisions; }
function resultPolicyDecisions(result: EngineQueryResult<ReachabilityDetails>): readonly PolicyDecisionTrace[] | undefined { return result.value?.policyDecisions; }
function resultNatDecisions(result: EngineQueryResult<ReachabilityDetails>): readonly NatDecisionTrace[] | undefined { return result.value?.natDecisions; }
function resultConntrackDecisions(result: EngineQueryResult<ReachabilityDetails>): readonly ConntrackDecisionTrace[] | undefined { return result.value?.conntrackDecisions; }
function resultPathComparison(result: EngineQueryResult<ReachabilityDetails>): ForwardReturnPathComparisonTrace | undefined { return result.value?.pathComparison; }
function resultHostStackDecision(result: EngineQueryResult<ReachabilityDetails>): HostStackDecisionTrace | undefined { return result.value?.hostStackDecision; }
function resultListenerServiceDecision(result: EngineQueryResult<ReachabilityDetails>): ListenerServiceDecisionTrace | undefined { return result.value?.listenerServiceDecision; }
function resultTcpStateMachineDecision(result: EngineQueryResult<ReachabilityDetails>): TcpStateMachineDecisionTrace | undefined { return result.value?.tcpStateMachineDecision; }

function renderPathLine(result: EngineQueryResult<ReachabilityDetails>): string {
  const path = result.value?.path;
  if (!path?.length) return "Modeled path: <no declared viable path>";
  return `Modeled path: ${path.join(" -> ")}`;
}

function connectivityProbe(
  scenario: NormalizedScenario,
  state: EngineState,
  source: RuntimeResourceState,
  destination: RuntimeResourceState,
  probe: ActiveProbeDefinition,
  protocol: "icmp" | "tcp" | "udp",
  port?: number,
): ActiveProbeTranscript {
  const modeled = queryReachabilityWithSourceGateway(scenario, state, source, destination, protocol, port);
  const result = modeled.result;
  const command = protocol === "udp"
    ? (probe.os === "windows" ? `Get-NetUDPEndpoint -LocalPort ${port} (modeled ${destination.id})` : `ss -lunp sport = :${port} (modeled ${destination.id})`)
    : probe.probeId.endsWith("ping")
    ? (probe.os === "windows" ? `ping ${destination.id}` : `ping -c 4 ${destination.id}`)
    : (probe.os === "windows" ? `Test-NetConnection ${destination.id} -Port ${port}` : `nc -vz ${destination.id} ${port}`);
  const lines = [
    `[MODELED ACTIVE PROBE — no ${probe.os === "windows" ? "Windows guest command or PowerShell" : "Linux guest command"} executed]`,
    `Result: ${result.truth}`,
    `Source: ${source.id} (${source.label})`,
    `Destination: ${destination.id} (${destination.label})`,
    `Protocol: ${protocol.toUpperCase()}${port !== undefined ? ` port ${port}` : ""}`,
    renderPathLine(result),
    ...(result.value?.udpIcmpFailureDecision?.explanation ?? []),
    ...(result.value?.blockingPoint ? [`Blocking point: ${result.value.blockingPoint}`] : []),
    ...result.explanation.map((line) => `Engine: ${line}`),
  ];
  return baseTranscript({ state, source, probe, command, truth: result.truth, lines, evidence: [...modeled.extraEvidence, ...reachabilityEvidence(result)], destination, protocol, ...(port !== undefined ? { port } : {}), ...(resultPath(result) ? { path: resultPath(result)! } : {}), ...(resultBlockingPoint(result) ? { blockingPoint: resultBlockingPoint(result)! } : {}), ...(resultRouteDecisions(result)?.length ? { routeDecisions: resultRouteDecisions(result)! } : {}), ...(resultNeighborDecisions(result)?.length ? { neighborDecisions: resultNeighborDecisions(result)! } : {}), ...(resultMacDecisions(result)?.length ? { macDecisions: resultMacDecisions(result)! } : {}), ...(resultVlanDecisions(result)?.length ? { vlanDecisions: resultVlanDecisions(result)! } : {}), ...(resultStpDecisions(result)?.length ? { stpDecisions: resultStpDecisions(result)! } : {}), ...(resultPolicyDecisions(result)?.length ? { policyDecisions: resultPolicyDecisions(result)! } : {}), ...(resultNatDecisions(result)?.length ? { natDecisions: resultNatDecisions(result)! } : {}), ...(resultConntrackDecisions(result)?.length ? { conntrackDecisions: resultConntrackDecisions(result)! } : {}), ...(resultPathComparison(result) ? { pathComparison: resultPathComparison(result)! } : {}), ...(resultHostStackDecision(result) ? { hostStackDecision: resultHostStackDecision(result)! } : {}), ...(resultListenerServiceDecision(result) ? { listenerServiceDecision: resultListenerServiceDecision(result)! } : {}), ...(resultTcpStateMachineDecision(result) ? { tcpStateMachineDecision: resultTcpStateMachineDecision(result)! } : {}) , ...(result.value?.udpIcmpFailureDecision ? { udpIcmpFailureDecision: result.value.udpIcmpFailureDecision } : {}) });
}

function pathProbe(
  scenario: NormalizedScenario,
  state: EngineState,
  source: RuntimeResourceState,
  destination: RuntimeResourceState,
  probe: ActiveProbeDefinition,
): ActiveProbeTranscript {
  const modeled = queryReachabilityWithSourceGateway(scenario, state, source, destination, "icmp");
  const result = modeled.result;
  const path = result.value?.path;
  const blocking = result.value?.blockingPoint;
  let visiblePath: readonly string[] = path ?? [];
  if (path?.length && blocking) {
    const index = path.indexOf(blocking);
    if (index >= 0) visiblePath = path.slice(0, index + 1);
  }
  const command = probe.os === "windows" ? `tracert ${destination.id}` : `tracepath ${destination.id}`;
  const hopLines = visiblePath.length
    ? visiblePath.map((id, index) => `${index + 1}\t${id}${id === blocking ? "\t<blocking point>" : ""}`)
    : ["<no modeled hops proven>"];
  const lines = [
    `[MODELED ACTIVE PROBE — no ${probe.os === "windows" ? "Windows guest command" : "Linux guest command"} executed]`,
    `Path verdict: ${result.truth}`,
    ...hopLines,
    ...(path?.length && visiblePath.length < path.length ? ["Later topology nodes are not shown as reached after the blocking point."] : []),
    ...result.explanation.map((line) => `Engine: ${line}`),
  ];
  return baseTranscript({ state, source, probe, command, truth: result.truth, lines, evidence: [...modeled.extraEvidence, ...reachabilityEvidence(result)], destination, protocol: "icmp", ...(path ? { path } : {}), ...(blocking ? { blockingPoint: blocking } : {}), ...(resultRouteDecisions(result)?.length ? { routeDecisions: resultRouteDecisions(result)! } : {}), ...(resultNeighborDecisions(result)?.length ? { neighborDecisions: resultNeighborDecisions(result)! } : {}), ...(resultMacDecisions(result)?.length ? { macDecisions: resultMacDecisions(result)! } : {}), ...(resultVlanDecisions(result)?.length ? { vlanDecisions: resultVlanDecisions(result)! } : {}), ...(resultStpDecisions(result)?.length ? { stpDecisions: resultStpDecisions(result)! } : {}), ...(resultPolicyDecisions(result)?.length ? { policyDecisions: resultPolicyDecisions(result)! } : {}), ...(resultNatDecisions(result)?.length ? { natDecisions: resultNatDecisions(result)! } : {}), ...(resultConntrackDecisions(result)?.length ? { conntrackDecisions: resultConntrackDecisions(result)! } : {}), ...(resultPathComparison(result) ? { pathComparison: resultPathComparison(result)! } : {}), ...(resultHostStackDecision(result) ? { hostStackDecision: resultHostStackDecision(result)! } : {}) , ...(result.value?.listenerServiceDecision ? { listenerServiceDecision: result.value.listenerServiceDecision } : {}), ...(result.value?.udpIcmpFailureDecision ? { udpIcmpFailureDecision: result.value.udpIcmpFailureDecision } : {}) });
}

function normalizeDnsName(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 253 || /[\s\\/]/.test(trimmed)) return undefined;
  const normalized = trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
  if (!normalized || normalized.split(".").some((label) => !label || label.length > 63 || !/^[A-Za-z0-9_](?:[A-Za-z0-9_-]*[A-Za-z0-9_])?$/.test(label))) return undefined;
  return normalized.toLowerCase();
}

function addressesForResource(resource: RuntimeResourceState): readonly string[] {
  const out: string[] = [];
  for (const iface of resource.interfaces) {
    const raw = iface.addresses;
    if (!Array.isArray(raw)) continue;
    for (const value of raw) if (typeof value === "string") out.push(value.split("/")[0]!);
  }
  const propertyAddress = resource.properties.address;
  if (typeof propertyAddress === "string") out.push(propertyAddress.split("/")[0]!);
  const propertyAddresses = resource.properties.addresses;
  if (Array.isArray(propertyAddresses)) for (const value of propertyAddresses) if (typeof value === "string") out.push(value.split("/")[0]!);
  return [...new Set(out)].sort((a, b) => a.localeCompare(b, "en"));
}

function resourcesForAddress(state: EngineState, address: string): readonly RuntimeResourceState[] {
  return Object.values(state.resources)
    .filter((resource) => addressesForResource(resource).includes(address))
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
}

function dnsProbe(
  scenario: NormalizedScenario,
  state: EngineState,
  source: RuntimeResourceState,
  probe: ActiveProbeDefinition,
  queryNameInput: string,
): { readonly transcript: ActiveProbeTranscript; readonly diagnostics: readonly ObservationDiagnostic[] } {
  const diagnostics: ObservationDiagnostic[] = [];
  const evidence: ActiveProbeEvidence[] = [];
  const result = queryDnsChain(scenario, state, source.id, queryNameInput);
  const trace = result.value;
  const queryName = trace?.queryName ?? normalizeDnsName(queryNameInput)!;
  const command = `${probe.os === "windows" ? "Resolve-DnsName" : "dig"} ${queryName}`;

  if (!trace) {
    const transcript = baseTranscript({ state, source, probe, command, truth: "UNKNOWN", queryName, evidence, lines: ["[MODELED ACTIVE PROBE — no guest DNS command executed]", "DNS result: UNKNOWN", ...result.explanation.map((line) => `Engine: ${line}`)] });
    return { transcript, diagnostics };
  }

  evidence.push({
    kind: "modeled_state",
    subject: `${source.id}.properties.dnsServers`,
    state: trace.configuredResolversState,
    ...(trace.configuredResolversState === "KNOWN" ? { value: trace.resolverAddresses } : {}),
  });
  if (trace.configuredResolversState === "MALFORMED") {
    diagnostics.push(diagnostic("warning", "ACTIVE_PROBE_DNS_SERVERS_MALFORMED", `Modeled DNS server list on '${source.id}' is malformed.`, "properties.dnsServers"));
  }

  const attempts: string[] = [];
  for (const attempt of trace.attempts) {
    evidence.push({
      kind: "topology_mapping",
      subject: `resolver:${attempt.resolverAddress}`,
      state: attempt.mappedResourceIds.length === 1 ? "KNOWN" : attempt.mappedResourceIds.length === 0 ? "ABSENT" : "MALFORMED",
      ...(attempt.mappedResourceIds.length ? { value: attempt.mappedResourceIds } : {}),
    });
    if (attempt.selectedResourceId && attempt.networkTruth) {
      evidence.push({
        kind: "engine_query",
        subject: `reachability:${source.id}->${attempt.selectedResourceId}`,
        state: attempt.networkTruth,
        value: {
          ...(attempt.networkPath ? { path: attempt.networkPath } : {}),
          ...(attempt.networkBlockingPoint ? { blockingPoint: attempt.networkBlockingPoint } : {}),
        },
      });
    }
    if (attempt.selectedResourceId && attempt.serviceState) {
      evidence.push({ kind: "modeled_state", subject: `${attempt.selectedResourceId}.properties.dns.enabled`, state: attempt.serviceState, ...(attempt.serviceEnabled !== undefined ? { value: attempt.serviceEnabled } : {}) });
    }
    if (attempt.selectedResourceId && attempt.recordsState) {
      evidence.push({ kind: "modeled_state", subject: `${attempt.selectedResourceId}.properties.dns.records`, state: attempt.recordsState, ...(attempt.matchedRecordCount !== undefined ? { value: { matchedRecordCount: attempt.matchedRecordCount } } : {}) });
    }
    if (attempt.selectedResourceId && attempt.answerAddress !== undefined) {
      evidence.push({ kind: "dns_record", subject: `${attempt.selectedResourceId}:${queryName}`, state: "KNOWN", value: attempt.answerAddress });
      evidence.push({ kind: "topology_mapping", subject: `answer:${attempt.answerAddress}`, state: attempt.answerResourceIds?.length ? "KNOWN" : "ABSENT", ...(attempt.answerResourceIds?.length ? { value: attempt.answerResourceIds } : {}) });
    }

    switch (attempt.disposition) {
      case "UNMAPPED": attempts.push(`Resolver ${attempt.resolverAddress}: no declared network.dns_server matches this address.`); break;
      case "AMBIGUOUS_MAPPING": attempts.push(`Resolver ${attempt.resolverAddress}: address maps to multiple DNS server resources.`); break;
      case "NETWORK_BLOCKED": attempts.push(`Resolver ${attempt.resolverAddress} (${attempt.selectedResourceId}): network path is blocked.`); break;
      case "NETWORK_UNKNOWN": attempts.push(`Resolver ${attempt.resolverAddress} (${attempt.selectedResourceId}): network reachability is UNKNOWN.`); break;
      case "SERVICE_UNKNOWN": attempts.push(`Resolver ${attempt.resolverAddress} (${attempt.selectedResourceId}): DNS service state is ${(attempt.serviceState ?? "UNKNOWN").toLowerCase()}.`); break;
      case "SERVICE_DISABLED": attempts.push(`Resolver ${attempt.resolverAddress} (${attempt.selectedResourceId}): DNS service is disabled.`); break;
      case "RECORDS_UNKNOWN": attempts.push(`Resolver ${attempt.resolverAddress} (${attempt.selectedResourceId}): DNS records are ${(attempt.recordsState ?? "UNKNOWN").toLowerCase()}.`); break;
      case "NO_RECORD": attempts.push(`Resolver ${attempt.resolverAddress} (${attempt.selectedResourceId}): modeled authoritative records contain no '${queryName}' entry.`); break;
      case "RECORD_AMBIGUOUS": attempts.push(`Resolver ${attempt.resolverAddress} (${attempt.selectedResourceId}): multiple modeled records match '${queryName}'; Phase 93 requires one unambiguous A-like record.`); break;
      case "RECORD_MALFORMED": attempts.push(`Resolver ${attempt.resolverAddress} (${attempt.selectedResourceId}): matching record has malformed address.`); break;
      case "RESOLVED": break;
    }
  }

  let lines: string[];
  if (trace.truth === "TRUE") {
    const selected = trace.attempts.find((attempt) => attempt.disposition === "RESOLVED");
    lines = [
      "[MODELED ACTIVE PROBE — no guest DNS command executed]",
      "DNS result: TRUE",
      `Resolver: ${trace.selectedResolverAddress} (${trace.selectedResolverResourceId})`,
      `Name: ${queryName}`,
      `Address: ${trace.resolvedAddress}`,
      `Declared resource mapping: ${trace.resolvedResourceIds?.length ? trace.resolvedResourceIds.join(", ") : "<no declared resource matches returned address>"}`,
      ...attempts,
    ];
  } else if (trace.configuredResolversState === "ABSENT") {
    lines = ["[MODELED ACTIVE PROBE — no guest DNS command executed]", "DNS result: UNKNOWN", "Configured resolvers: <not modeled>"];
  } else if (trace.configuredResolversState === "MALFORMED") {
    lines = ["[MODELED ACTIVE PROBE — no guest DNS command executed]", "DNS result: UNKNOWN", "Configured resolvers: <malformed modeled value>"];
  } else if (!trace.resolverAddresses.length) {
    lines = ["[MODELED ACTIVE PROBE — no guest DNS command executed]", "DNS result: FALSE", "No DNS resolvers are configured in modeled state."];
  } else {
    lines = ["[MODELED ACTIVE PROBE — no guest DNS command executed]", `DNS result: ${trace.truth}${trace.attempts.some((attempt) => attempt.disposition === "NO_RECORD") ? " (modeled NXDOMAIN/no matching record)" : ""}`, ...attempts];
  }

  const transcript = baseTranscript({
    state,
    source,
    probe,
    command,
    truth: trace.truth,
    queryName,
    ...(trace.resolvedAddress ? { resolvedAddress: trace.resolvedAddress } : {}),
    ...(trace.resolvedResourceIds ? { resolvedResourceIds: trace.resolvedResourceIds } : {}),
    dnsChainDecision: trace,
    evidence,
    lines,
  });
  return { transcript, diagnostics };
}


function dhcpProbe(
  scenario: NormalizedScenario,
  state: EngineState,
  source: RuntimeResourceState,
  probe: ActiveProbeDefinition,
): { readonly transcript: ActiveProbeTranscript; readonly diagnostics: readonly ObservationDiagnostic[] } {
  const evidence: ActiveProbeEvidence[] = [];
  const result = queryDhcpDora(scenario, state, source.id);
  const trace = result.value;
  const command = probe.commandTemplate;

  if (!trace) {
    return {
      transcript: baseTranscript({
        state, source, probe, command, truth: "UNKNOWN", evidence,
        lines: ["[MODELED ACTIVE PROBE — no guest DHCP command executed]", "DHCP DORA: UNKNOWN", ...result.explanation.map((line) => `Engine: ${line}`)],
      }),
      diagnostics: [],
    };
  }

  evidence.push({
    kind: "modeled_state",
    subject: `${source.id}.properties.dhcp`,
    state: trace.clientState,
    ...(trace.clientState === "KNOWN" ? { value: { enabled: trace.clientEnabled } } : {}),
  });
  for (const attempt of trace.attempts) {
    evidence.push({
      kind: "engine_query",
      subject: `dhcp-l2:${source.id}->${attempt.serverResourceId}`,
      state: attempt.discoverTruth,
      value: {
        disposition: attempt.disposition,
        ...(attempt.discoverPath ? { discoverPath: attempt.discoverPath } : {}),
        ...(attempt.offerReturnTruth ? { offerReturnTruth: attempt.offerReturnTruth } : {}),
        ...(attempt.offerReturnPath ? { offerReturnPath: attempt.offerReturnPath } : {}),
      },
    });
    if (attempt.serverEnabled !== undefined) evidence.push({ kind: "modeled_state", subject: `${attempt.serverResourceId}.properties.dhcp.enabled`, state: "KNOWN", value: attempt.serverEnabled });
    if (attempt.availableLeases !== undefined) evidence.push({ kind: "modeled_state", subject: `${attempt.serverResourceId}.properties.dhcp.availableLeases`, state: "KNOWN", value: attempt.availableLeases });
    if (attempt.offeredAddress !== undefined) evidence.push({ kind: "modeled_state", subject: `${attempt.serverResourceId}.properties.dhcp.offers`, state: "KNOWN", value: { client: source.id, address: attempt.offeredAddress } });
  }

  const lines: string[] = [
    "[MODELED ACTIVE PROBE — no guest DHCP command executed]",
    `DHCP DORA: ${trace.truth}`,
    `Client state: ${trace.clientState}${trace.clientEnabled !== undefined ? ` / enabled=${String(trace.clientEnabled)}` : ""}`,
  ];
  for (const phase of trace.stages) {
    lines.push(`${phase.stage}: ${phase.truth}${phase.serverResourceId ? ` via ${phase.serverResourceId}` : ""}`);
  }
  for (const attempt of trace.attempts) {
    lines.push(`Server ${attempt.serverResourceId}: ${attempt.disposition} / Discover=${attempt.discoverTruth}${attempt.offerReturnTruth ? ` / Offer-return=${attempt.offerReturnTruth}` : ""}${attempt.offeredAddress ? ` / offer=${attempt.offeredAddress}` : ""}`);
  }
  if (trace.truth === "TRUE") {
    lines.push(`Selected server: ${trace.selectedServerResourceId}`);
    lines.push(`Lease: ${trace.offeredAddress}/${trace.prefixLength}`);
    if (trace.gateway) lines.push(`Gateway: ${trace.gateway}`);
    if (trace.dnsServers?.length) lines.push(`DNS: ${trace.dnsServers.join(", ")}`);
  }
  lines.push("DHCP relay, dynamic pool allocation, lease mutation, renewal/rebind, and guest command execution are not modeled in this Phase 94 probe.");

  return {
    transcript: baseTranscript({ state, source, probe, command, truth: trace.truth, dhcpDoraDecision: trace, evidence, lines }),
    diagnostics: [],
  };
}

export function runActiveProbe(request: ActiveProbeRequest): ActiveProbeResult {
  if (!scenarioMatchesState(request.scenario, request.state)) return { ok: false, diagnostics: [diagnostic("error", "ACTIVE_PROBE_STATE_SCENARIO_MISMATCH", "Active probe scenario and Engine state identity do not match.")] };
  const source = request.state.resources[request.sourceId];
  if (!source) return { ok: false, diagnostics: [diagnostic("error", "ACTIVE_PROBE_SOURCE_NOT_FOUND", `Active probe source '${request.sourceId}' does not exist in Engine state.`)] };
  const os = osForType(source.type);
  if (!os) return { ok: false, diagnostics: [diagnostic("error", "ACTIVE_PROBE_SOURCE_UNSUPPORTED", `Resource '${source.id}' type '${source.type}' is not a supported Windows/Linux active-probe source.`)] };
  const probe = PROBE_BY_ID.get(request.probeId);
  if (!probe) return { ok: false, diagnostics: [diagnostic("error", "ACTIVE_PROBE_UNKNOWN", `Active probe '${request.probeId}' is not registered.`)] };
  if (probe.os !== os) return { ok: false, diagnostics: [diagnostic("error", "ACTIVE_PROBE_OS_MISMATCH", `Probe '${request.probeId}' is for ${probe.os}, but source '${source.id}' is ${os}.`)] };

  if (probe.argumentKind === "none") {
    const result = dhcpProbe(request.scenario, request.state, source, probe);
    return { ok: true, transcript: result.transcript, diagnostics: result.diagnostics };
  }

  if (probe.argumentKind === "dns_name") {
    const queryName = typeof request.queryName === "string" ? normalizeDnsName(request.queryName) : undefined;
    if (!queryName) return { ok: false, diagnostics: [diagnostic("error", "ACTIVE_PROBE_DNS_NAME_INVALID", "DNS query name must be a single valid modeled DNS name without whitespace or path characters.")] };
    const result = dnsProbe(request.scenario, request.state, source, probe, queryName);
    return { ok: true, transcript: result.transcript, diagnostics: result.diagnostics };
  }

  if (!request.destinationId) return { ok: false, diagnostics: [diagnostic("error", "ACTIVE_PROBE_DESTINATION_REQUIRED", `Probe '${request.probeId}' requires a destination resource.`)] };
  const destination = request.state.resources[request.destinationId];
  if (!destination) return { ok: false, diagnostics: [diagnostic("error", "ACTIVE_PROBE_DESTINATION_NOT_FOUND", `Active probe destination '${request.destinationId}' does not exist in Engine state.`)] };
  if (destination.id === source.id) return { ok: false, diagnostics: [diagnostic("error", "ACTIVE_PROBE_SELF_DESTINATION_UNSUPPORTED", "Wave 2 active probes require a distinct modeled destination resource.")] };

  if (probe.argumentKind === "destination_port") {
    if (!Number.isInteger(request.port) || request.port === undefined || request.port < 1 || request.port > 65535) return { ok: false, diagnostics: [diagnostic("error", "ACTIVE_PROBE_PORT_INVALID", "Transport active probe port must be an integer in 1..65535.")] };
    return { ok: true, transcript: connectivityProbe(request.scenario, request.state, source, destination, probe, probe.probeId.endsWith("udp_delivery") ? "udp" : "tcp", request.port), diagnostics: [] };
  }
  if (probe.category === "path") return { ok: true, transcript: pathProbe(request.scenario, request.state, source, destination, probe), diagnostics: [] };
  return { ok: true, transcript: connectivityProbe(request.scenario, request.state, source, destination, probe, "icmp"), diagnostics: [] };
}
