import type { NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import { addressInCidr, parseIpAddress } from "./ip.js";
import { queryReachability } from "./network-engine.js";
import { readPath } from "./path.js";
import type {
  DnsChainDecisionTrace,
  DnsConfiguredResolversState,
  DnsResolverAttemptTrace,
  DnsResolverDisposition,
  EngineQueryResult,
  EngineState,
  ReachabilityDetails,
  RuntimeResourceState,
  TruthValue,
} from "./types.js";

export function normalizeDnsQueryName(name: string): string | undefined {
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

function dnsRecords(resource: RuntimeResourceState): { readonly state: "KNOWN" | "ABSENT" | "MALFORMED"; readonly records?: readonly Readonly<Record<string, unknown>>[] } {
  const read = readPath(resource, "properties.dns.records");
  if (!read.found) return { state: "ABSENT" };
  if (!Array.isArray(read.value) || !read.value.every((record) => record !== null && typeof record === "object" && !Array.isArray(record))) return { state: "MALFORMED" };
  return { state: "KNOWN", records: read.value as readonly Readonly<Record<string, unknown>>[] };
}

function dnsEnabled(resource: RuntimeResourceState): { readonly state: "KNOWN" | "ABSENT" | "MALFORMED"; readonly enabled?: boolean } {
  const read = readPath(resource, "properties.dns.enabled");
  if (!read.found) return { state: "ABSENT" };
  if (typeof read.value !== "boolean") return { state: "MALFORMED" };
  return { state: "KNOWN", enabled: read.value };
}

function sourceGatewayTruth(
  state: EngineState,
  source: RuntimeResourceState,
  destination: RuntimeResourceState,
  path: readonly string[] | undefined,
): { readonly truth: TruthValue; readonly explanation: readonly string[] } | undefined {
  if (source.properties.routes !== undefined) return undefined;
  const sourceCidrs = source.interfaces.flatMap((iface) => Array.isArray(iface.addresses)
    ? iface.addresses.filter((value): value is string => typeof value === "string" && value.includes("/"))
    : []);
  const destinationAddresses = addressesForResource(destination);
  let comparable = false;
  for (const cidr of sourceCidrs) {
    for (const address of destinationAddresses) {
      if (!parseIpAddress(cidr) || !parseIpAddress(address)) continue;
      const inCidr = addressInCidr(address, cidr);
      if (inCidr === undefined) continue;
      comparable = true;
      if (inCidr) return { truth: "TRUE", explanation: [`DNS resolver '${destination.id}' is on-link for source prefix '${cidr}'.`] };
    }
  }
  if (!comparable) return undefined;

  const gatewayRead = readPath(source, "properties.defaultGateway");
  if (!gatewayRead.found) return { truth: "FALSE", explanation: [`Resolver '${destination.id}' is off-link and '${source.id}' has no modeled default gateway or authoritative route table.`] };
  if (typeof gatewayRead.value !== "string" || !parseIpAddress(gatewayRead.value)) return { truth: "UNKNOWN", explanation: [`Resolver '${destination.id}' is off-link, but '${source.id}' has a malformed modeled default gateway.`] };
  const gatewayOnLink = sourceCidrs.some((cidr) => addressInCidr(gatewayRead.value as string, cidr) === true);
  if (!gatewayOnLink) return { truth: "FALSE", explanation: [`Modeled default gateway '${gatewayRead.value}' is not on-link for '${source.id}'.`] };
  if (!path || path.length < 2) return { truth: "UNKNOWN", explanation: [`Default gateway '${gatewayRead.value}' is modeled, but no resolver path is available to verify its next-hop identity.`] };
  const intermediateIds = path.slice(1, -1);
  let unknownAddress = false;
  for (const id of intermediateIds) {
    const resource = state.resources[id];
    if (!resource) { unknownAddress = true; continue; }
    const addresses = addressesForResource(resource);
    if (!addresses.length) { unknownAddress = true; continue; }
    if (addresses.includes(gatewayRead.value)) return { truth: "TRUE", explanation: [`Modeled default gateway '${gatewayRead.value}' maps to resolver-path next hop '${id}'.`] };
  }
  if (unknownAddress) return { truth: "UNKNOWN", explanation: [`Modeled default gateway '${gatewayRead.value}' cannot be verified because an intermediate resolver-path resource lacks modeled addresses.`] };
  return { truth: "FALSE", explanation: [`Modeled default gateway '${gatewayRead.value}' does not map to the selected resolver path.`] };
}

function resolverReachability(
  scenario: NormalizedScenario,
  state: EngineState,
  source: RuntimeResourceState,
  resolver: RuntimeResourceState,
): EngineQueryResult<ReachabilityDetails> {
  const network = queryReachability(scenario, state, source.id, resolver.id, "any");
  if (network.truth === "FALSE") return network;
  const gateway = sourceGatewayTruth(state, source, resolver, network.value?.path);
  if (!gateway || gateway.truth === "TRUE") {
    return gateway ? { ...network, explanation: [...gateway.explanation, ...network.explanation] } : network;
  }
  return {
    truth: gateway.truth,
    value: {
      from: source.id,
      to: resolver.id,
      protocol: "any",
      ...(network.value?.path ? { path: network.value.path } : {}),
      blockingPoint: source.id,
    },
    explanation: [...gateway.explanation, ...network.explanation],
  };
}

function configuredResolverState(source: RuntimeResourceState): { state: DnsConfiguredResolversState; addresses: readonly string[] } {
  const read = readPath(source, "properties.dnsServers");
  if (!read.found) return { state: "ABSENT", addresses: [] };
  if (!Array.isArray(read.value) || !read.value.every((item) => typeof item === "string")) return { state: "MALFORMED", addresses: [] };
  return { state: "KNOWN", addresses: [...read.value] as readonly string[] };
}

export function queryDnsChain(
  scenario: NormalizedScenario,
  state: EngineState,
  sourceId: string,
  queryNameInput: string,
): EngineQueryResult<DnsChainDecisionTrace> {
  const source = state.resources[sourceId];
  const queryName = normalizeDnsQueryName(queryNameInput);
  if (!source || !queryName) {
    return { truth: "UNKNOWN", explanation: [!source ? `DNS source '${sourceId}' does not exist in Engine state.` : "DNS query name is invalid."] };
  }

  const configured = configuredResolverState(source);
  const base = {
    sourceId,
    queryName,
    configuredResolversState: configured.state,
    resolverAddresses: configured.addresses,
  } as const;
  if (configured.state === "ABSENT") {
    const trace: DnsChainDecisionTrace = { ...base, truth: "UNKNOWN", attempts: [], explanation: ["Configured DNS resolvers are not modeled on the source host."] };
    return { truth: trace.truth, value: trace, explanation: trace.explanation };
  }
  if (configured.state === "MALFORMED") {
    const trace: DnsChainDecisionTrace = { ...base, truth: "UNKNOWN", attempts: [], explanation: ["Configured DNS resolver state is malformed."] };
    return { truth: trace.truth, value: trace, explanation: trace.explanation };
  }
  if (configured.addresses.length === 0) {
    const trace: DnsChainDecisionTrace = { ...base, truth: "FALSE", attempts: [], explanation: ["No DNS resolvers are configured in modeled state."] };
    return { truth: trace.truth, value: trace, explanation: trace.explanation };
  }

  const attempts: DnsResolverAttemptTrace[] = [];
  let sawUnknown = false;
  for (let index = 0; index < configured.addresses.length; index += 1) {
    const resolverAddress = configured.addresses[index]!;
    const mapped = resourcesForAddress(state, resolverAddress).filter((resource) => resource.type === "network.dns_server");
    const mappedResourceIds = mapped.map((resource) => resource.id);
    if (mapped.length === 0) {
      sawUnknown = true;
      attempts.push({ index, resolverAddress, mappedResourceIds, disposition: "UNMAPPED" });
      continue;
    }
    if (mapped.length > 1) {
      sawUnknown = true;
      attempts.push({ index, resolverAddress, mappedResourceIds, disposition: "AMBIGUOUS_MAPPING" });
      continue;
    }

    const resolver = mapped[0]!;
    const reachability = resolverReachability(scenario, state, source, resolver);
    const common = {
      index,
      resolverAddress,
      mappedResourceIds,
      selectedResourceId: resolver.id,
      networkTruth: reachability.truth,
      ...(reachability.value?.path ? { networkPath: reachability.value.path } : {}),
      ...(reachability.value?.blockingPoint ? { networkBlockingPoint: reachability.value.blockingPoint } : {}),
      networkExplanation: reachability.explanation,
    } as const;
    if (reachability.truth === "FALSE") {
      attempts.push({ ...common, disposition: "NETWORK_BLOCKED" });
      continue;
    }
    if (reachability.truth === "UNKNOWN") {
      sawUnknown = true;
      attempts.push({ ...common, disposition: "NETWORK_UNKNOWN" });
      continue;
    }

    const service = dnsEnabled(resolver);
    if (service.state !== "KNOWN") {
      sawUnknown = true;
      attempts.push({ ...common, serviceState: service.state, disposition: "SERVICE_UNKNOWN" });
      continue;
    }
    if (!service.enabled) {
      attempts.push({ ...common, serviceState: "KNOWN", serviceEnabled: false, disposition: "SERVICE_DISABLED" });
      continue;
    }

    const records = dnsRecords(resolver);
    if (records.state !== "KNOWN") {
      sawUnknown = true;
      attempts.push({ ...common, serviceState: "KNOWN", serviceEnabled: true, recordsState: records.state, disposition: "RECORDS_UNKNOWN" });
      continue;
    }
    const matches = records.records!.filter((record) => {
      const rawName = typeof record.name === "string" ? record.name : typeof record.hostname === "string" ? record.hostname : typeof record.fqdn === "string" ? record.fqdn : undefined;
      return rawName ? normalizeDnsQueryName(rawName) === queryName : false;
    });
    if (matches.length === 0) {
      const attempt: DnsResolverAttemptTrace = { ...common, serviceState: "KNOWN", serviceEnabled: true, recordsState: "KNOWN", matchedRecordCount: 0, disposition: "NO_RECORD" };
      attempts.push(attempt);
      const trace: DnsChainDecisionTrace = {
        ...base,
        truth: "FALSE",
        attempts,
        selectedResolverAddress: resolverAddress,
        selectedResolverResourceId: resolver.id,
        explanation: [`Resolver '${resolver.id}' returned no modeled record for '${queryName}'.`],
      };
      return { truth: trace.truth, value: trace, explanation: trace.explanation };
    }
    if (matches.length > 1) {
      sawUnknown = true;
      attempts.push({ ...common, serviceState: "KNOWN", serviceEnabled: true, recordsState: "KNOWN", matchedRecordCount: matches.length, disposition: "RECORD_AMBIGUOUS" });
      continue;
    }
    const address = matches[0]!.address;
    if (typeof address !== "string" || !address.trim()) {
      sawUnknown = true;
      attempts.push({ ...common, serviceState: "KNOWN", serviceEnabled: true, recordsState: "KNOWN", matchedRecordCount: 1, disposition: "RECORD_MALFORMED" });
      continue;
    }
    const answerResourceIds = resourcesForAddress(state, address).map((resource) => resource.id);
    attempts.push({ ...common, serviceState: "KNOWN", serviceEnabled: true, recordsState: "KNOWN", matchedRecordCount: 1, answerAddress: address, answerResourceIds, disposition: "RESOLVED" });
    const trace: DnsChainDecisionTrace = {
      ...base,
      truth: "TRUE",
      attempts,
      selectedResolverAddress: resolverAddress,
      selectedResolverResourceId: resolver.id,
      resolvedAddress: address,
      resolvedResourceIds: answerResourceIds,
      explanation: [`Resolver '${resolver.id}' resolved '${queryName}' to '${address}'.`],
    };
    return { truth: trace.truth, value: trace, explanation: trace.explanation };
  }

  const truth: TruthValue = sawUnknown ? "UNKNOWN" : "FALSE";
  const trace: DnsChainDecisionTrace = {
    ...base,
    truth,
    attempts,
    explanation: [truth === "UNKNOWN" ? "No configured resolver produced a conclusive DNS answer." : "All configured resolvers failed conclusively."],
  };
  return { truth, value: trace, explanation: trace.explanation };
}
