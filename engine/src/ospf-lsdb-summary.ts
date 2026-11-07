import type { EngineState } from "./types.js";
import { inspectOspfP2pExchangeSession } from "./ospf-p2p-exchange.js";
import type { OspfP2pExchangeSession } from "./ospf-p2p-exchange.js";

/**
 * RFC 2328 §§10.6, 10.9, 12.1, 13.1: read-only Type 1/2 LSA header
 * comparison and bounded Link State Request *planning* from synthetic,
 * externally admitted DD summary observations. Never transmits requests,
 * installs LSAs, advances DD exchange, changes Engine state or claims FULL.
 */
export const OSPF_LSDB_SUMMARY_FORMAT = "yadilab.engine.ospfv2-lsdb-header-summary" as const;
export const OSPF_LSDB_SUMMARY_VERSION = "1.0.0" as const;
export const OSPF_LSDB_MAX_HEADERS = 256 as const;
export const OSPF_LSDB_MAX_BATCH_HEADERS = 32 as const;
export const OSPF_LSDB_MAX_BATCHES = 16 as const;
export const OSPF_LSA_MAX_AGE = 3600 as const;
export const OSPF_LSA_MAX_AGE_DIFF = 900 as const;

export type OspfLsaKind = 1 | 2;
export interface OspfLsaHeader {
  readonly lsAge: number;
  readonly options: number;
  readonly lsaType: OspfLsaKind;
  readonly linkStateId: string;
  readonly advertisingRouter: string;
  /** RFC 2328 signed 32-bit sequence, excluding reserved 0x80000000. */
  readonly lsSequenceNumber: number;
  readonly lsChecksum: number;
  readonly length: number;
}
export interface OspfLsaRequestIntent {
  readonly lsaType: OspfLsaKind;
  readonly linkStateId: string;
  readonly advertisingRouter: string;
  readonly reason: "MISSING_LOCAL" | "REMOTE_NEWER";
}
export interface OspfLsdbSummaryAnchor {
  readonly scenarioId: string;
  readonly scenarioHash: string;
  readonly stateRevision: number;
  readonly areaId: string;
  readonly localResourceId: string;
  readonly remoteResourceId: string;
  readonly role: "MASTER" | "SLAVE";
  readonly ddSequence: number;
  readonly acceptedDdCount: number;
  readonly exchangeTimeMs: number;
}
export interface OspfLsdbSummaryPlan {
  readonly formatId: typeof OSPF_LSDB_SUMMARY_FORMAT;
  readonly schemaVersion: typeof OSPF_LSDB_SUMMARY_VERSION;
  readonly anchor: OspfLsdbSummaryAnchor;
  readonly localHeaders: readonly OspfLsaHeader[];
  readonly remoteHeaders: readonly OspfLsaHeader[];
  readonly batchIds: readonly string[];
  readonly requestIntents: readonly OspfLsaRequestIntent[];
}
export type OspfLsdbSummaryResult =
  | { readonly ok: true; readonly plan: OspfLsdbSummaryPlan; readonly newRequests: readonly OspfLsaRequestIntent[] }
  | { readonly ok: false; readonly plan: OspfLsdbSummaryPlan; readonly code: string };

const integer = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x);
const unsigned = (x: unknown, max: number): x is number => integer(x) && x >= 0 && x <= max;
function ipv4(s: unknown, allowZero: boolean): s is string {
  if (typeof s !== "string" || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(s)) return false;
  const octets = s.split(".").map(Number);
  return octets.every((x) => x <= 255) && (allowZero || octets.some((x) => x !== 0));
}
export function validOspfLsaHeader(h: unknown): h is OspfLsaHeader {
  if (!h || typeof h !== "object") return false;
  const v = h as Partial<OspfLsaHeader>;
  return (v.lsaType === 1 || v.lsaType === 2)
    && ipv4(v.linkStateId, true) && ipv4(v.advertisingRouter, false)
    && (v.lsaType !== 1 || v.linkStateId === v.advertisingRouter)
    && unsigned(v.lsAge, OSPF_LSA_MAX_AGE)
    && unsigned(v.options, 255)
    && integer(v.lsSequenceNumber) && v.lsSequenceNumber >= -2147483647
    && v.lsSequenceNumber <= 2147483647
    && unsigned(v.lsChecksum, 65535) && v.lsChecksum !== 0
    && unsigned(v.length, 65535) && v.length >= 24;
}
function clean(h: OspfLsaHeader): OspfLsaHeader {
  return {
    lsAge: h.lsAge, options: h.options, lsaType: h.lsaType,
    linkStateId: h.linkStateId, advertisingRouter: h.advertisingRouter,
    lsSequenceNumber: h.lsSequenceNumber, lsChecksum: h.lsChecksum, length: h.length,
  };
}
function key(h: Pick<OspfLsaHeader, "lsaType" | "linkStateId" | "advertisingRouter">): string {
  return [h.lsaType, ...h.linkStateId.split(".").map((x) => x.padStart(3, "0")),
    ...h.advertisingRouter.split(".").map((x) => x.padStart(3, "0"))].join(".");
}
function orderedUnique(items: readonly OspfLsaHeader[]): boolean {
  let last = "";
  for (const h of items) {
    if (!validOspfLsaHeader(h)) return false;
    const current = key(h);
    if (current <= last) return false;
    last = current;
  }
  return true;
}
function normalize(items: readonly OspfLsaHeader[], max: number): OspfLsaHeader[] | null {
  if (!Array.isArray(items) || items.length > max || !items.every(validOspfLsaHeader)) return null;
  const normalized = items.map(clean).sort((a, b) => key(a).localeCompare(key(b), "en"));
  return orderedUnique(normalized) ? normalized : null;
}
/** 1: remote is newer, 0: equivalent, -1: local is newer. Same LSA key only. */
export function compareOspfLsaHeaders(local: OspfLsaHeader, remote: OspfLsaHeader): -1 | 0 | 1 {
  if (!validOspfLsaHeader(local) || !validOspfLsaHeader(remote)
    || key(local) !== key(remote)) throw Error("OSPF_LSA_COMPARISON_INVALID");
  if (local.lsSequenceNumber !== remote.lsSequenceNumber)
    return local.lsSequenceNumber < remote.lsSequenceNumber ? 1 : -1;
  if (local.lsChecksum !== remote.lsChecksum)
    return local.lsChecksum < remote.lsChecksum ? 1 : -1;
  if (local.lsAge === OSPF_LSA_MAX_AGE && remote.lsAge !== OSPF_LSA_MAX_AGE) return -1;
  if (remote.lsAge === OSPF_LSA_MAX_AGE && local.lsAge !== OSPF_LSA_MAX_AGE) return 1;
  if (Math.abs(local.lsAge - remote.lsAge) > OSPF_LSA_MAX_AGE_DIFF)
    return local.lsAge > remote.lsAge ? 1 : -1;
  return 0;
}
function deriveRequests(local: readonly OspfLsaHeader[], remote: readonly OspfLsaHeader[]): OspfLsaRequestIntent[] {
  const localByKey = new Map(local.map((h) => [key(h), h] as const));
  const requests: OspfLsaRequestIntent[] = [];
  for (const h of remote) {
    const prior = localByKey.get(key(h));
    const reason = !prior ? "MISSING_LOCAL"
      : compareOspfLsaHeaders(prior, h) === 1 ? "REMOTE_NEWER" : null;
    if (reason) requests.push({
      lsaType: h.lsaType, linkStateId: h.linkStateId,
      advertisingRouter: h.advertisingRouter, reason,
    });
  }
  return requests;
}
function snapshotAnchor(state: EngineState, session: OspfP2pExchangeSession): OspfLsdbSummaryAnchor {
  const cfg = session.dd.hello.config;
  return {
    scenarioId: state.scenarioId, scenarioHash: state.scenarioHash,
    stateRevision: state.stateRevision, areaId: cfg.areaId,
    localResourceId: cfg.localResourceId, remoteResourceId: cfg.remoteResourceId,
    role: session.exchange!.role, ddSequence: session.exchange!.sequence,
    acceptedDdCount: session.exchange!.accepted,
    exchangeTimeMs: session.dd.hello.clock.nowMs,
  };
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

/** This is a snapshot of header metadata, not a running or writable LSDB. */
export function createOspfLsdbSummaryPlan(
  state: EngineState, exchange: OspfP2pExchangeSession,
  localHeaders: readonly OspfLsaHeader[],
): OspfLsdbSummaryPlan {
  if (inspectOspfP2pExchangeSession(exchange, state) || exchange.dd.phase !== "EXCHANGE"
    || !exchange.exchange) throw Error("OSPF_LSDB_EXCHANGE_REQUIRED");
  const local = normalize(localHeaders, OSPF_LSDB_MAX_HEADERS);
  if (!local) throw Error("OSPF_LSDB_LOCAL_HEADERS_INVALID");
  return {
    formatId: OSPF_LSDB_SUMMARY_FORMAT, schemaVersion: OSPF_LSDB_SUMMARY_VERSION,
    anchor: snapshotAnchor(state, exchange), localHeaders: local,
    remoteHeaders: [], batchIds: [], requestIntents: [],
  };
}
export function inspectOspfLsdbSummaryPlan(
  plan: OspfLsdbSummaryPlan, state: EngineState, exchange: OspfP2pExchangeSession,
): string | null {
  if (!plan || plan.formatId !== OSPF_LSDB_SUMMARY_FORMAT
    || plan.schemaVersion !== OSPF_LSDB_SUMMARY_VERSION
    || !plan.anchor || !Array.isArray(plan.localHeaders)
    || !Array.isArray(plan.remoteHeaders) || !Array.isArray(plan.batchIds)
    || !Array.isArray(plan.requestIntents)
    || plan.localHeaders.length > OSPF_LSDB_MAX_HEADERS
    || plan.remoteHeaders.length > OSPF_LSDB_MAX_HEADERS
    || plan.batchIds.length > OSPF_LSDB_MAX_BATCHES) return "OSPF_LSDB_PLAN_INVALID";
  if (!orderedUnique(plan.localHeaders) || !orderedUnique(plan.remoteHeaders)
    || !plan.batchIds.every((id) => typeof id === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(id))
    || new Set(plan.batchIds).size !== plan.batchIds.length) return "OSPF_LSDB_PLAN_INVALID";
  if (!same(deriveRequests(plan.localHeaders, plan.remoteHeaders), plan.requestIntents))
    return "OSPF_LSDB_REQUEST_LEDGER_INVALID";
  const fault = inspectOspfP2pExchangeSession(exchange, state);
  if (fault) return fault;
  if (exchange.dd.phase !== "EXCHANGE" || !exchange.exchange
    || !same(snapshotAnchor(state, exchange), plan.anchor)) return "OSPF_LSDB_STALE_EXCHANGE";
  return null;
}
export function recordOspfLsdbSummaryBatch(
  plan: OspfLsdbSummaryPlan, state: EngineState, exchange: OspfP2pExchangeSession,
  batchId: string, headers: readonly OspfLsaHeader[],
): OspfLsdbSummaryResult {
  const invalid = inspectOspfLsdbSummaryPlan(plan, state, exchange);
  if (invalid) return { ok: false, plan, code: invalid };
  if (typeof batchId !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(batchId)
    || plan.batchIds.includes(batchId)) return { ok: false, plan, code: "OSPF_LSDB_BATCH_ID_INVALID" };
  if (plan.batchIds.length >= OSPF_LSDB_MAX_BATCHES)
    return { ok: false, plan, code: "OSPF_LSDB_BATCH_LIMIT" };
  const incoming = normalize(headers, OSPF_LSDB_MAX_BATCH_HEADERS);
  if (!incoming) return { ok: false, plan, code: "OSPF_LSDB_BATCH_INVALID" };
  if (plan.remoteHeaders.length + incoming.length > OSPF_LSDB_MAX_HEADERS)
    return { ok: false, plan, code: "OSPF_LSDB_HEADER_LIMIT" };
  const joined = normalize([...plan.remoteHeaders, ...incoming], OSPF_LSDB_MAX_HEADERS);
  if (!joined) return { ok: false, plan, code: "OSPF_LSDB_DUPLICATE_LSA" };
  const requests = deriveRequests(plan.localHeaders, joined);
  const previous = new Set(plan.requestIntents.map(key));
  const proposed: OspfLsdbSummaryPlan = {
    ...plan, remoteHeaders: joined, batchIds: [...plan.batchIds, batchId],
    requestIntents: requests,
  };
  const post = inspectOspfLsdbSummaryPlan(proposed, state, exchange);
  return post ? { ok: false, plan, code: post } : {
    ok: true, plan: proposed, newRequests: requests.filter((r) => !previous.has(key(r))),
  };
}
