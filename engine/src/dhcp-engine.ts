import type { NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import { parseIpAddress } from "./ip.js";
import { queryLayer2BroadcastReachability } from "./network-engine.js";
import { readPath } from "./path.js";
import type {
  DhcpDoraDecisionTrace,
  DhcpDoraStageTrace,
  DhcpServerAttemptTrace,
  EngineQueryResult,
  EngineState,
  RuntimeResourceState,
  TruthValue,
} from "./types.js";

function literalIpv4(value: unknown): value is string {
  return typeof value === "string" && parseIpAddress(value)?.family === 4 && !value.includes("/");
}

function clientDhcpState(client: RuntimeResourceState): { state: "KNOWN" | "ABSENT" | "MALFORMED"; enabled?: boolean } {
  const read = readPath(client, "properties.dhcp");
  if (!read.found) return { state: "ABSENT" };
  if (!read.value || typeof read.value !== "object" || Array.isArray(read.value)) return { state: "MALFORMED" };
  const enabled = (read.value as Readonly<Record<string, unknown>>).enabled;
  if (typeof enabled !== "boolean") return { state: "MALFORMED" };
  return { state: "KNOWN", enabled };
}

function stage(stage: DhcpDoraStageTrace["stage"], truth: TruthValue, explanation: readonly string[], serverResourceId?: string): DhcpDoraStageTrace {
  return { stage, truth, ...(serverResourceId ? { serverResourceId } : {}), explanation };
}

function serverAttempt(
  scenario: NormalizedScenario, state: EngineState, client: RuntimeResourceState, server: RuntimeResourceState, index: number,
): DhcpServerAttemptTrace {
  const discover = queryLayer2BroadcastReachability(scenario, state, client.id, server.id);
  const base = { index, serverResourceId: server.id, discoverTruth: discover.truth, ...(discover.value?.path ? { discoverPath: discover.value.path } : {}), discoverExplanation: discover.explanation } as const;
  if (discover.truth === "FALSE") return { ...base, disposition: "L2_BLOCKED" };
  if (discover.truth === "UNKNOWN") return { ...base, disposition: "L2_UNKNOWN" };

  const returned = queryLayer2BroadcastReachability(scenario, state, server.id, client.id);
  const withReturn = { ...base, offerReturnTruth: returned.truth, ...(returned.value?.path ? { offerReturnPath: returned.value.path } : {}), offerReturnExplanation: returned.explanation } as const;
  if (returned.truth === "FALSE") return { ...withReturn, disposition: "L2_BLOCKED" };
  if (returned.truth === "UNKNOWN") return { ...withReturn, disposition: "L2_UNKNOWN" };

  const read = readPath(server, "properties.dhcp");
  if (!read.found || !read.value || typeof read.value !== "object" || Array.isArray(read.value)) return { ...withReturn, disposition: "SERVER_STATE_UNKNOWN" };
  const dhcp = read.value as Readonly<Record<string, unknown>>;
  if (typeof dhcp.enabled !== "boolean") return { ...withReturn, disposition: "SERVER_STATE_UNKNOWN" };
  if (!dhcp.enabled) return { ...withReturn, serverEnabled: false, disposition: "SERVER_DISABLED" };

  const available = dhcp.availableLeases;
  if (!Number.isInteger(available) || (available as number) < 0) return { ...withReturn, serverEnabled: true, disposition: "POOL_UNKNOWN" };
  if ((available as number) === 0) return { ...withReturn, serverEnabled: true, availableLeases: 0, disposition: "POOL_EXHAUSTED" };

  if (!Array.isArray(dhcp.offers) || !dhcp.offers.every((item) => item !== null && typeof item === "object" && !Array.isArray(item))) {
    return { ...withReturn, serverEnabled: true, availableLeases: available as number, disposition: "OFFERS_UNKNOWN" };
  }
  const matches = (dhcp.offers as readonly Readonly<Record<string, unknown>>[]).filter((offer) => offer.client === client.id);
  if (matches.length === 0) return { ...withReturn, serverEnabled: true, availableLeases: available as number, matchedOfferCount: 0, disposition: "NO_CLIENT_OFFER" };
  if (matches.length > 1) return { ...withReturn, serverEnabled: true, availableLeases: available as number, matchedOfferCount: matches.length, disposition: "OFFER_AMBIGUOUS" };
  const offer = matches[0]!;
  if (!literalIpv4(offer.address)) return { ...withReturn, serverEnabled: true, availableLeases: available as number, matchedOfferCount: 1, disposition: "OFFER_MALFORMED" };

  const prefixLength = dhcp.prefixLength;
  if (!Number.isInteger(prefixLength) || (prefixLength as number) < 0 || (prefixLength as number) > 32) return { ...withReturn, serverEnabled: true, availableLeases: available as number, matchedOfferCount: 1, offeredAddress: offer.address, disposition: "OFFER_MALFORMED" };
  const gateway = dhcp.gateway;
  if (gateway !== undefined && !literalIpv4(gateway)) return { ...withReturn, serverEnabled: true, availableLeases: available as number, matchedOfferCount: 1, offeredAddress: offer.address, prefixLength: prefixLength as number, disposition: "OFFER_MALFORMED" };
  const dnsServers = dhcp.dnsServers;
  if (dnsServers !== undefined && (!Array.isArray(dnsServers) || !dnsServers.every(literalIpv4) || new Set(dnsServers).size !== dnsServers.length)) return { ...withReturn, serverEnabled: true, availableLeases: available as number, matchedOfferCount: 1, offeredAddress: offer.address, prefixLength: prefixLength as number, ...(typeof gateway === "string" ? { gateway } : {}), disposition: "OFFER_MALFORMED" };

  return {
    ...withReturn, serverEnabled: true, availableLeases: available as number, matchedOfferCount: 1, offeredAddress: offer.address,
    ...(typeof gateway === "string" ? { gateway } : {}),
    ...(Array.isArray(dnsServers) ? { dnsServers: dnsServers as readonly string[] } : {}),
    prefixLength: prefixLength as number, disposition: "OFFERED",
  };
}

export function queryDhcpDora(scenario: NormalizedScenario, state: EngineState, clientId: string): EngineQueryResult<DhcpDoraDecisionTrace> {
  const client = state.resources[clientId];
  if (!client) return { truth: "UNKNOWN", explanation: [`DHCP client '${clientId}' does not exist in Engine state.`] };
  const clientState = clientDhcpState(client);
  const base = { clientId, clientState: clientState.state } as const;
  if (clientState.state !== "KNOWN") {
    const explanation = [clientState.state === "ABSENT" ? "DHCP client configuration is not modeled." : "DHCP client configuration is malformed."];
    const trace: DhcpDoraDecisionTrace = { ...base, truth: "UNKNOWN", attempts: [], stages: [stage("DISCOVER", "UNKNOWN", explanation), stage("OFFER", "UNKNOWN", explanation), stage("REQUEST", "UNKNOWN", explanation), stage("ACK", "UNKNOWN", explanation)], explanation };
    return { truth: trace.truth, value: trace, explanation };
  }
  if (!clientState.enabled) {
    const explanation = ["Modeled DHCP client is disabled; no Discover is emitted."];
    const trace: DhcpDoraDecisionTrace = { ...base, clientEnabled: false, truth: "FALSE", attempts: [], stages: [stage("DISCOVER", "FALSE", explanation), stage("OFFER", "FALSE", ["No Offer can follow a disabled client."]), stage("REQUEST", "FALSE", ["No Request is emitted without an Offer."]), stage("ACK", "FALSE", ["No ACK is possible without a Request."])], explanation };
    return { truth: trace.truth, value: trace, explanation };
  }

  const servers = Object.values(state.resources).filter((resource) => resource.type === "network.dhcp_server").sort((a,b) => a.id.localeCompare(b.id,"en"));
  const attempts = servers.map((server,index) => serverAttempt(scenario,state,client,server,index));
  if (servers.length === 0) {
    const explanation = ["No modeled network.dhcp_server resource exists; external/relay DHCP is not fabricated."];
    const trace: DhcpDoraDecisionTrace = { ...base, clientEnabled: true, truth: "FALSE", attempts, stages: [stage("DISCOVER","TRUE",["Client emits a modeled local DHCP Discover broadcast."]), stage("OFFER","FALSE",explanation), stage("REQUEST","FALSE",["No Request is emitted because no Offer is modeled."]), stage("ACK","FALSE",["No ACK is possible without a Request."])], explanation };
    return { truth: trace.truth, value: trace, explanation };
  }
  const offered = attempts.filter((attempt) => attempt.disposition === "OFFERED");
  const uncertain = attempts.some((attempt) => ["L2_UNKNOWN","SERVER_STATE_UNKNOWN","POOL_UNKNOWN","OFFERS_UNKNOWN","OFFER_AMBIGUOUS","OFFER_MALFORMED"].includes(attempt.disposition));
  if (offered.length > 1) {
    const explanation = [`${offered.length} modeled DHCP servers can offer a lease; client offer-selection policy/timing is not modeled.`];
    const trace: DhcpDoraDecisionTrace = { ...base, clientEnabled: true, truth: "UNKNOWN", attempts, stages: [stage("DISCOVER","TRUE",["Client emits a modeled local DHCP Discover broadcast."]), stage("OFFER","TRUE",[`${offered.length} offers are provable.`]), stage("REQUEST","UNKNOWN",explanation), stage("ACK","UNKNOWN",["ACK cannot be selected without a modeled Request target."])], explanation };
    return { truth: trace.truth, value: trace, explanation };
  }
  if (offered.length === 0) {
    const truth: TruthValue = uncertain ? "UNKNOWN" : "FALSE";
    const explanation = [truth === "UNKNOWN" ? "No unique DHCP Offer is provable because one or more candidate server states are incomplete or ambiguous." : "No modeled DHCP server can produce a valid Offer for this client."];
    const trace: DhcpDoraDecisionTrace = { ...base, clientEnabled: true, truth, attempts, stages: [stage("DISCOVER","TRUE",["Client emits a modeled local DHCP Discover broadcast."]), stage("OFFER",truth,explanation), stage("REQUEST",truth,truth === "UNKNOWN" ? ["Request target is not provable."] : ["No Request is emitted because no Offer is available."]), stage("ACK",truth,truth === "UNKNOWN" ? ["ACK is not provable."] : ["No ACK is possible without a Request."])], explanation };
    return { truth: trace.truth, value: trace, explanation };
  }

  const selected = offered[0]!;
  const explanation = [`Modeled DORA completes through '${selected.serverResourceId}' with lease '${selected.offeredAddress}'.`];
  const trace: DhcpDoraDecisionTrace = {
    ...base, clientEnabled: true, truth: "TRUE", attempts, selectedServerResourceId: selected.serverResourceId, offeredAddress: selected.offeredAddress!,
    ...(selected.gateway ? { gateway: selected.gateway } : {}), ...(selected.dnsServers ? { dnsServers: selected.dnsServers } : {}), prefixLength: selected.prefixLength!,
    stages: [
      stage("DISCOVER","TRUE",["Client emits a modeled local DHCP Discover broadcast."]),
      stage("OFFER","TRUE",[`Server '${selected.serverResourceId}' returns the unique modeled Offer.`],selected.serverResourceId),
      stage("REQUEST","TRUE",[`Client requests the unique modeled Offer from '${selected.serverResourceId}'.`],selected.serverResourceId),
      stage("ACK","TRUE",[`Server '${selected.serverResourceId}' ACKs lease '${selected.offeredAddress}'.`],selected.serverResourceId),
    ], explanation,
  };
  return { truth: trace.truth, value: trace, explanation };
}
