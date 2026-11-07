import { isRecord, jsonEqual } from "./json.js";
import type { EngineQueryResult, ReachabilityDetails, TruthValue, UdpIcmpFailureDecisionTrace, UdpIcmpFailureDisposition } from "./types.js";

const truths = new Set<unknown>(["TRUE", "FALSE", "UNKNOWN"]);
const validPort = (port: unknown): port is number => typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535;

// Engine-only classifier. No topology, routing, listener or policy winner is recalculated.
function classify(result: EngineQueryResult<ReachabilityDetails>): UdpIcmpFailureDecisionTrace | undefined {
  const value = result.value;
  if (!value || (value.protocol !== "udp" && value.protocol !== "icmp")) return undefined;
  const networkTruth = value.networkTruthBeforeListener ?? result.truth;
  const policies = value.policyDecisions ?? [];
  const policyTruth = policies.length === 0 ? "NOT_EVALUATED" : policies.some(row => row.truth === "FALSE") ? "FALSE" : policies.some(row => row.truth === "UNKNOWN") ? "UNKNOWN" : "TRUE";
  const listener = value.listenerServiceDecision;
  const effectiveDestinationPort = value.translatedPort ?? value.port;
  let disposition: UdpIcmpFailureDisposition = "UNKNOWN";
  const inputValid = value.protocol === "icmp" ? value.port === undefined : validPort(value.port) && validPort(effectiveDestinationPort);
  if (inputValid && result.truth === "FALSE" && !listener) disposition = policyTruth === "FALSE" ? "POLICY_BLOCKED" : "NETWORK_BLOCKED";
  else if (inputValid && networkTruth === "TRUE") {
    if (value.protocol === "icmp" && result.truth === "TRUE") disposition = "REQUEST_PATH_REACHABLE";
    else if (listener?.resourceId === value.to && listener.protocol === "udp" && listener.port === effectiveDestinationPort) {
      if (result.truth === "TRUE" && listener.truth === "TRUE") disposition = "DATAGRAM_DELIVERABLE";
      else if (result.truth === "FALSE" && listener.truth === "FALSE") disposition = listener.disposition === "SERVICE_DISABLED" ? "SERVICE_DISABLED" : "NO_LISTENER";
      else if (result.truth === "UNKNOWN" && listener.disposition === "SNAPSHOT_INCOMPLETE") disposition = "SNAPSHOT_INCOMPLETE";
    }
  }
  const explanation = Object.freeze([
    `Engine ${value.protocol.toUpperCase()} classification: ${disposition}; network ${networkTruth}, policy ${policyTruth}, listener ${value.protocol === "icmp" ? "NOT_REQUIRED" : listener?.truth ?? "NOT_EVALUATED"}.`,
    "Semantic reachability is not proof of a received datagram, application response or Echo Reply. ICMP wire type/code, unreachable response, timeout and retries are NOT_MODELED.",
  ]);
  return Object.freeze({
    sourceId: value.from, destinationId: value.to, protocol: value.protocol,
    ...(value.port !== undefined ? { port: value.port } : {}),
    ...(value.protocol === "udp" && effectiveDestinationPort !== undefined ? { effectiveDestinationPort } : {}),
    ...(value.translatedSource !== undefined ? { translatedSource: value.translatedSource } : {}),
    truth: result.truth, networkTruth, policyTruth,
    listenerTruth: value.protocol === "icmp" ? "NOT_REQUIRED" : listener?.truth ?? "NOT_EVALUATED",
    ...(value.protocol === "udp" && listener ? { listenerModel: listener.model, listenerDisposition: listener.disposition } : {}),
    disposition, icmpEvidence: "NOT_MODELED", reply: "NOT_MODELED", timeout: "NOT_MODELED", retries: "NOT_MODELED", explanation,
  });
}

export function withUdpIcmpFailureDiagnostic(result: EngineQueryResult<ReachabilityDetails>): EngineQueryResult<ReachabilityDetails> {
  const trace = classify(result);
  return trace && result.value ? { ...result, value: { ...result.value, udpIcmpFailureDecision: trace } } : result;
}

// Validation lives in Engine, not in React. Reject added wire/timer fields, wrong binding,
// duplicate policy evidence and contradictions. This checks semantic integrity, not signatures.
export function validateUdpIcmpFailureDecision(result: EngineQueryResult<ReachabilityDetails>, trace: unknown): boolean {
  try {
    const value = result.value;
    if (!isRecord(value) || !truths.has(result.truth) || !truths.has(value.networkTruthBeforeListener)
        || typeof value.from !== "string" || !value.from || typeof value.to !== "string" || !value.to
        || !isRecord(trace) || !Array.isArray(result.explanation) || !result.explanation.every(row => typeof row === "string")) return false;
    if (value.protocol === "udp" ? !validPort(value.port) || !validPort(value.translatedPort ?? value.port) : value.protocol !== "icmp" || value.port !== undefined) return false;
    const policies = value.policyDecisions ?? [];
    if (!Array.isArray(policies)) return false;
    const keys = new Set<string>();
    for (const row of policies) {
      if (!isRecord(row) || !truths.has(row.truth) || typeof row.resourceId !== "string" || !["ACL", "FIREWALL"].includes(String(row.kind))) return false;
      const key = `${row.resourceId}:${row.kind}`;
      if (keys.has(key)) return false;
      keys.add(key);
    }
    const listener = value.listenerServiceDecision;
    if (listener && (!isRecord(listener) || !truths.has(listener.truth) || value.networkTruthBeforeListener !== "TRUE"
        || listener.resourceId !== value.to || listener.protocol !== value.protocol || listener.port !== (value.translatedPort ?? value.port))) return false;
    const expected = classify(result);
    if (!expected || !jsonEqual(expected, trace)) return false;
    if (expected.disposition === "UNKNOWN" && result.truth !== "UNKNOWN") return false;
    if (result.truth === "TRUE" && value.networkTruthBeforeListener !== "TRUE") return false;
    if (value.protocol === "udp" && value.networkTruthBeforeListener === "TRUE" && !listener) return false;
    if (policies.some(row => row.truth !== "TRUE") && value.networkTruthBeforeListener === "TRUE") return false;
    return true;
  } catch {
    return false;
  }
}
