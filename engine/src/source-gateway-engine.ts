import type { NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import { queryReachability } from "./network-engine.js";
import { withUdpIcmpFailureDiagnostic } from "./udp-icmp-engine.js";
import type { EngineQueryResult, ReachabilityDetails } from "./types.js";
import { readPath } from "./path.js";
import { addressInCidr, parseIpAddress } from "./ip.js";
import type { EngineState, RuntimeResourceState, TruthValue } from "./types.js";

interface GatewayEvidence { readonly kind: "modeled_state" | "topology_mapping"; readonly subject: string; readonly state: "KNOWN" | "ABSENT" | "MALFORMED"; readonly value?: unknown; }

export function sourceDefaultGatewayVerdict(
  state: EngineState,
  source: RuntimeResourceState,
  destination: RuntimeResourceState,
  path: readonly string[] | undefined,
): { readonly truth: TruthValue; readonly explanation: readonly string[]; readonly evidence: readonly GatewayEvidence[] } | undefined {
  if (source.properties.routes !== undefined) return undefined;
  const sourceCidrs = source.interfaces.flatMap((iface) => Array.isArray(iface.addresses) ? iface.addresses.filter((value): value is string => typeof value === "string" && value.includes("/")) : []);
  const destinationAddresses = addressesForResource(destination);
  let comparable = false;
  for (const cidr of sourceCidrs) {
    for (const address of destinationAddresses) {
      if (!parseIpAddress(cidr) || !parseIpAddress(address)) continue;
      const inCidr = addressInCidr(address, cidr);
      if (inCidr === undefined) continue;
      comparable = true;
      if (inCidr) return { truth: "TRUE", explanation: [`Destination '${destination.id}' is on-link for source address '${cidr}'; no default gateway is required for this modeled probe.`], evidence: [{ kind: "modeled_state", subject: `${source.id}.interfaces`, state: "KNOWN", value: source.interfaces }] };
    }
  }
  if (!comparable) return undefined;

  const gatewayRead = readPath(source, "properties.defaultGateway");
  if (!gatewayRead.found) {
    return {
      truth: "FALSE",
      explanation: [`Destination '${destination.id}' is off-link and '${source.id}' has no modeled default gateway or authoritative route table.`],
      evidence: [{ kind: "modeled_state", subject: `${source.id}.properties.defaultGateway`, state: "ABSENT" }],
    };
  }
  if (typeof gatewayRead.value !== "string" || !parseIpAddress(gatewayRead.value)) {
    return {
      truth: "UNKNOWN",
      explanation: [`Destination '${destination.id}' is off-link, but '${source.id}' has a malformed modeled default gateway.`],
      evidence: [{ kind: "modeled_state", subject: `${source.id}.properties.defaultGateway`, state: "MALFORMED", value: gatewayRead.value }],
    };
  }
  const gatewayOnLink = sourceCidrs.some((cidr) => addressInCidr(gatewayRead.value as string, cidr) === true);
  if (!gatewayOnLink) {
    return {
      truth: "FALSE",
      explanation: [`Modeled default gateway '${gatewayRead.value}' is not on-link for any modeled source interface prefix on '${source.id}'.`],
      evidence: [
        { kind: "modeled_state", subject: `${source.id}.properties.defaultGateway`, state: "KNOWN", value: gatewayRead.value },
        { kind: "modeled_state", subject: `${source.id}.interfaces`, state: "KNOWN", value: source.interfaces },
      ],
    };
  }
  if (!path || path.length < 2) {
    return {
      truth: "UNKNOWN",
      explanation: [`Default gateway '${gatewayRead.value}' is modeled, but no topology path is available to verify its next-hop identity.`],
      evidence: [{ kind: "modeled_state", subject: `${source.id}.properties.defaultGateway`, state: "KNOWN", value: gatewayRead.value }],
    };
  }
  const intermediateIds = path.slice(1, -1);
  let hasUnknownIntermediateAddress = false;
  for (const id of intermediateIds) {
    const resource = state.resources[id];
    if (!resource) { hasUnknownIntermediateAddress = true; continue; }
    const addresses = addressesForResource(resource);
    if (!addresses.length) { hasUnknownIntermediateAddress = true; continue; }
    if (addresses.includes(gatewayRead.value)) {
      return {
        truth: "TRUE",
        explanation: [`Modeled default gateway '${gatewayRead.value}' maps to topology next-hop resource '${id}'.`],
        evidence: [
          { kind: "modeled_state", subject: `${source.id}.properties.defaultGateway`, state: "KNOWN", value: gatewayRead.value },
          { kind: "topology_mapping", subject: `gateway:${gatewayRead.value}`, state: "KNOWN", value: [id] },
        ],
      };
    }
  }
  if (hasUnknownIntermediateAddress) {
    return {
      truth: "UNKNOWN",
      explanation: [`Modeled default gateway '${gatewayRead.value}' could not be verified because at least one intermediate topology resource lacks modeled addresses.`],
      evidence: [
        { kind: "modeled_state", subject: `${source.id}.properties.defaultGateway`, state: "KNOWN", value: gatewayRead.value },
        { kind: "topology_mapping", subject: `gateway:${gatewayRead.value}`, state: "ABSENT" },
      ],
    };
  }
  return {
    truth: "FALSE",
    explanation: [`Modeled default gateway '${gatewayRead.value}' does not map to any intermediate next-hop resource on the selected topology path.`],
    evidence: [
      { kind: "modeled_state", subject: `${source.id}.properties.defaultGateway`, state: "KNOWN", value: gatewayRead.value },
      { kind: "topology_mapping", subject: `gateway:${gatewayRead.value}`, state: "ABSENT" },
    ],
  };
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



export function queryReachabilityWithSourceGateway(
  scenario: NormalizedScenario,
  state: EngineState,
  source: RuntimeResourceState,
  destination: RuntimeResourceState,
  protocol: "tcp" | "udp" | "icmp" | "any",
  port?: number,
): { readonly result: EngineQueryResult<ReachabilityDetails>; readonly extraEvidence: readonly GatewayEvidence[] } {
  const network = queryReachability(scenario, state, source.id, destination.id, protocol, port);
  if (network.truth === "FALSE") return { result: network, extraEvidence: [] };
  const extraEvidence: GatewayEvidence[] = [];
  const extraExplanation: string[] = [];

  const sourceRoute = sourceDefaultGatewayVerdict(state, source, destination, network.value?.path);
  if (sourceRoute) {
    extraEvidence.push(...sourceRoute.evidence);
    extraExplanation.push(...sourceRoute.explanation);
    if (sourceRoute.truth !== "TRUE") {
      return {
        result: withUdpIcmpFailureDiagnostic({
          truth: sourceRoute.truth,
          value: {
            from: source.id,
            to: destination.id,
            protocol,
            networkTruthBeforeListener: sourceRoute.truth,
            ...(port !== undefined ? { port } : {}),
            ...(network.value?.path ? { path: network.value.path } : {}),
            blockingPoint: source.id,
          },
          explanation: [...extraExplanation, ...network.explanation],
        }),
        extraEvidence,
      };
    }
  }

  return {
    result: extraExplanation.length ? { ...network, explanation: [...extraExplanation, ...network.explanation] } : network,
    extraEvidence,
  };
}
