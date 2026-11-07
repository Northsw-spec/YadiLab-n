import type { EngineState } from "./types.js";
import {
  advanceOspfDdSummarySession, inspectOspfDdSummarySession,
  receiveOspfDdSummaryHello,
} from "./ospf-dd-summary-admission.js";
import type { OspfDdSummarySession } from "./ospf-dd-summary-admission.js";
import type { OspfP2pHelloObservation } from "./ospf-p2p-hello.js";
import { compareOspfLsaHeaders } from "./ospf-lsdb-summary.js";
import type { OspfLsaHeader, OspfLsaRequestIntent } from "./ospf-lsdb-summary.js";
import { verifyOspfLsaBinary } from "./ospf-lsa-binary.js";

/**
 * RFC 2328 §§10.9,12.1.7,13.1: one *synthetic* LSR TX intent outstanding,
 * bounded RxmtInterval retry intents, and checksum-verified received LSA
 * bytes. A frozen DD summary snapshot is the request authority.
 * No wire send, flooding, LSDB install, LoadingDone, Full or Engine routing.
 */
export const OSPF_LSR_FORMAT = "yadilab.engine.ospfv2-lsr-lifecycle" as const;
export const OSPF_LSR_VERSION = "1.0.0" as const;
export const OSPF_LSR_MAX_PACKET_REQUESTS = 8 as const;
export const OSPF_LSR_MAX_UPDATE_LSAS = 8 as const;
export const OSPF_LSR_MAX_RETRIES = 64 as const;
export const OSPF_LSR_MAX_ADVANCE_RETRIES = 64 as const;
const SOURCE = "SYNTHETIC_OSPFV2_LSR_LIFECYCLE_MODEL" as const;

export interface OspfLsRequestCompletion {
  readonly request: OspfLsaRequestIntent;
  /** Exact bytes received, checked again on every state inspection. */
  readonly lsaBytes: readonly number[];
}
export interface OspfLsRequestOutstanding {
  readonly requests: readonly OspfLsaRequestIntent[];
  readonly issuedAtMs: number;
  readonly lastSentAtMs: number;
  readonly nextRetryAtMs: number;
  readonly retries: number;
}
export interface OspfLsRequestSession {
  readonly formatId: typeof OSPF_LSR_FORMAT;
  readonly schemaVersion: typeof OSPF_LSR_VERSION;
  readonly summary: OspfDdSummarySession;
  readonly maxPerPacket: number;
  readonly completed: readonly OspfLsRequestCompletion[];
  readonly outstanding?: OspfLsRequestOutstanding;
}
export interface OspfLsUpdateObservation {
  readonly atMs: number;
  readonly senderRouterId: string;
  readonly areaId: string;
  /** Synthetic, externally admitted payloads; NOT OSPF packet decoding. */
  readonly lsas: readonly (readonly number[])[];
}
export interface OspfLsRequestTrace {
  readonly kind:
    | "LSR_TX_INTENT" | "LSR_RETRANSMIT_INTENT"
    | "LSR_VERIFIED_LSA_RECEIVED" | "LSR_REQUEST_LIST_EMPTY"
    | "LSR_DISCARDED";
  readonly atMs: number;
  readonly source: typeof SOURCE;
  readonly identities: readonly OspfLsaRequestIntent[];
}
export type OspfLsRequestResult =
  | {
      readonly ok: true;
      readonly session: OspfLsRequestSession;
      readonly events: readonly OspfLsRequestTrace[];
    }
  | { readonly ok: false; readonly session: OspfLsRequestSession; readonly code: string };

const atTime = (t: unknown): t is number => typeof t === "number"
  && Number.isSafeInteger(t) && t >= 0;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const id = (r: Pick<OspfLsaRequestIntent, "lsaType" | "linkStateId" | "advertisingRouter">): string =>
  [r.lsaType, r.linkStateId, r.advertisingRouter].join("|");
const bad = (session: OspfLsRequestSession, code: string): OspfLsRequestResult =>
  ({ ok: false, session, code });
function trace(
  kind: OspfLsRequestTrace["kind"], atMs: number,
  identities: readonly OspfLsaRequestIntent[],
): OspfLsRequestTrace {
  return { kind, atMs, source: SOURCE, identities: identities.map((r) => ({ ...r })) };
}
function advertisedHeader(session: OspfLsRequestSession, key: string): OspfLsaHeader | undefined {
  return session.summary.plan?.remoteHeaders.find((h) => id(h) === key);
}
function remaining(session: OspfLsRequestSession): OspfLsaRequestIntent[] {
  const received = new Set(session.completed.map((x) => id(x.request)));
  return (session.summary.plan?.requestIntents ?? [])
    .filter((r) => !received.has(id(r))).map((r) => ({ ...r }));
}
/** Cross-check every completion against actual raw Fletcher-verified bytes. */
export function inspectOspfLsRequestSession(
  session: OspfLsRequestSession, state: EngineState,
): string | null {
  if (!session || session.formatId !== OSPF_LSR_FORMAT
    || session.schemaVersion !== OSPF_LSR_VERSION
    || !Number.isInteger(session.maxPerPacket) || session.maxPerPacket < 1
    || session.maxPerPacket > OSPF_LSR_MAX_PACKET_REQUESTS
    || !Array.isArray(session.completed) || session.completed.length > 256
    || !session.summary) return "OSPF_LSR_SESSION_INVALID";
  const parent = inspectOspfDdSummarySession(session.summary, state);
  if (parent) return parent;
  if (session.summary.exchange.dd.phase !== "EXCHANGE") {
    return session.outstanding === undefined && session.completed.length === 0
      ? null : "OSPF_LSR_CLEARED_STATE_INVALID";
  }
  if (!session.summary.plan) return "OSPF_LSR_SUMMARY_MISSING";
  const wanted = new Map(session.summary.plan.requestIntents.map((r) => [id(r), r]));
  const done = new Set<string>();
  for (const complete of session.completed) {
    if (!complete || !complete.request) return "OSPF_LSR_COMPLETION_INVALID";
    const k = id(complete.request);
    if (done.has(k) || !wanted.has(k) || !same(wanted.get(k), complete.request))
      return "OSPF_LSR_COMPLETION_INVALID";
    const checked = verifyOspfLsaBinary(complete.lsaBytes);
    const advertised = advertisedHeader(session, k);
    if (!checked.ok || !advertised || id(checked.header) !== k
      || compareOspfLsaHeaders(advertised, checked.header) < 0)
      return "OSPF_LSR_COMPLETION_INVALID";
    done.add(k);
  }
  const pending = remaining(session);
  if (!session.outstanding) return null;
  const o = session.outstanding;
  const now = session.summary.exchange.dd.hello.clock.nowMs;
  const interval = session.summary.exchange.rxmtIntervalMs;
  if (!Array.isArray(o.requests) || o.requests.length === 0
    || o.requests.length > session.maxPerPacket
    || !same(o.requests, pending.slice(0, o.requests.length))
    || !atTime(o.issuedAtMs) || !atTime(o.lastSentAtMs)
    || o.issuedAtMs > o.lastSentAtMs || o.lastSentAtMs > now
    || !atTime(o.nextRetryAtMs)
    || o.nextRetryAtMs !== o.lastSentAtMs + interval
    || !Number.isInteger(o.retries) || o.retries < 0 || o.retries > OSPF_LSR_MAX_RETRIES
    || (session.summary.exchange.dd.hello.deadAtMs !== undefined
      && o.lastSentAtMs >= session.summary.exchange.dd.hello.deadAtMs))
    return "OSPF_LSR_OUTSTANDING_INVALID";
  return null;
}
export function createOspfLsRequestSession(
  state: EngineState, summary: OspfDdSummarySession,
  maxPerPacket: number = OSPF_LSR_MAX_PACKET_REQUESTS,
): OspfLsRequestSession {
  if (!Number.isInteger(maxPerPacket) || maxPerPacket < 1
    || maxPerPacket > OSPF_LSR_MAX_PACKET_REQUESTS
    || inspectOspfDdSummarySession(summary, state)
    || summary.exchange.dd.phase !== "EXCHANGE" || !summary.plan)
    throw Error("OSPF_LSR_CONFIG_INVALID");
  return { formatId: OSPF_LSR_FORMAT, schemaVersion: OSPF_LSR_VERSION,
    summary, maxPerPacket, completed: [] };
}
export function issueOspfLsRequest(
  session: OspfLsRequestSession, state: EngineState,
): OspfLsRequestResult {
  const fault = inspectOspfLsRequestSession(session, state);
  if (fault) return bad(session, fault);
  if (session.summary.exchange.dd.phase !== "EXCHANGE") return bad(session, "OSPF_LSR_NEIGHBOR_NOT_READY");
  if (session.outstanding) return bad(session, "OSPF_LSR_ALREADY_OUTSTANDING");
  const requests = remaining(session).slice(0, session.maxPerPacket);
  if (requests.length === 0) return bad(session, "OSPF_LSR_NO_PENDING");
  const atMs = session.summary.exchange.dd.hello.clock.nowMs;
  const nextRetryAtMs = atMs + session.summary.exchange.rxmtIntervalMs;
  if (!atTime(nextRetryAtMs)) return bad(session, "OSPF_LSR_TIME_OVERFLOW");
  const outstanding: OspfLsRequestOutstanding = {
    requests, issuedAtMs: atMs, lastSentAtMs: atMs, nextRetryAtMs, retries: 0,
  };
  const next: OspfLsRequestSession = { ...session, outstanding };
  const post = inspectOspfLsRequestSession(next, state);
  return post ? bad(session, post) : {
    ok: true, session: next, events: [trace("LSR_TX_INTENT", atMs, requests)],
  };
}
function cleared(
  old: OspfLsRequestSession, summary: OspfDdSummarySession,
  atMs: number, events: OspfLsRequestTrace[],
): OspfLsRequestSession {
  const { outstanding: _old, ...noOutstanding } = old;
  if (old.outstanding || old.completed.length) {
    events.push(trace("LSR_DISCARDED", atMs, old.outstanding?.requests ?? []));
  }
  return { ...noOutstanding, summary, completed: [] };
}
/** Advance virtual time, applying parent Dead deadlines before LSR retry ties. */
export function advanceOspfLsRequestSession(
  session: OspfLsRequestSession, state: EngineState, untilMs: number,
): OspfLsRequestResult {
  const fault = inspectOspfLsRequestSession(session, state);
  if (fault) return bad(session, fault);
  if (!atTime(untilMs) || untilMs < session.summary.exchange.dd.hello.clock.nowMs)
    return bad(session, "OSPF_LSR_TIME_INVALID");
  let current = session;
  const events: OspfLsRequestTrace[] = [];
  let processed = 0;
  while (current.outstanding && current.outstanding.nextRetryAtMs <= untilMs) {
    if (processed >= OSPF_LSR_MAX_ADVANCE_RETRIES)
      return bad(session, "OSPF_LSR_ADVANCE_LIMIT");
    const deadline = current.outstanding.nextRetryAtMs;
    const advanced = advanceOspfDdSummarySession(current.summary, state, deadline);
    if (!advanced.ok) return bad(session, advanced.code);
    if (advanced.session.exchange.dd.phase !== "EXCHANGE") {
      current = cleared(current, advanced.session, deadline, events);
      break;
    }
    const existing = current.outstanding;
    if (existing.retries >= OSPF_LSR_MAX_RETRIES)
      return bad(session, "OSPF_LSR_RETRY_LIMIT");
    const nextRetryAtMs = deadline + current.summary.exchange.rxmtIntervalMs;
    if (!atTime(nextRetryAtMs)) return bad(session, "OSPF_LSR_TIME_OVERFLOW");
    const outstanding: OspfLsRequestOutstanding = {
      ...existing, lastSentAtMs: deadline, nextRetryAtMs, retries: existing.retries + 1,
    };
    events.push(trace("LSR_RETRANSMIT_INTENT", deadline, existing.requests));
    current = { ...current, summary: advanced.session, outstanding };
    processed += 1;
  }
  const final = advanceOspfDdSummarySession(current.summary, state, untilMs);
  if (!final.ok) return bad(session, final.code);
  current = final.session.exchange.dd.phase === "EXCHANGE"
    ? { ...current, summary: final.session }
    : cleared(current, final.session, untilMs, events);
  const post = inspectOspfLsRequestSession(current, state);
  return post ? bad(session, post) : { ok: true, session: current, events };
}
export function receiveOspfLsRequestHello(
  session: OspfLsRequestSession, state: EngineState, hello: OspfP2pHelloObservation,
): OspfLsRequestResult {
  if (!hello || !atTime(hello.atMs))
    return bad(session, "OSPF_LSR_HELLO_INVALID");
  const advanced = advanceOspfLsRequestSession(session, state, hello.atMs);
  if (!advanced.ok) return advanced;
  const accepted = receiveOspfDdSummaryHello(advanced.session.summary, state, hello);
  if (!accepted.ok) return bad(session, accepted.code);
  const events = [...advanced.events];
  const next = accepted.session.exchange.dd.phase === "EXCHANGE"
    ? { ...advanced.session, summary: accepted.session }
    : cleared(advanced.session, accepted.session, hello.atMs, events);
  const post = inspectOspfLsRequestSession(next, state);
  return post ? bad(session, post) : { ok: true, session: next, events };
}
/**
 * Receive synthetic, externally admitted LS Update payloads. To keep the
 * model honest, only currently outstanding requested LSAs are accepted;
 * unsolicited flooding, packet framing and install/ack are NOT implemented.
 */
export function receiveOspfLsRequestUpdate(
  session: OspfLsRequestSession, state: EngineState,
  packet: OspfLsUpdateObservation,
): OspfLsRequestResult {
  const fault = inspectOspfLsRequestSession(session, state);
  if (fault) return bad(session, fault);
  if (!packet || !atTime(packet.atMs)
    || packet.atMs < session.summary.exchange.dd.hello.clock.nowMs
    || packet.senderRouterId !== session.summary.exchange.dd.hello.config.remoteRouterId
    || packet.areaId !== session.summary.exchange.dd.hello.config.areaId)
    return bad(session, "OSPF_LSR_UPDATE_SOURCE_INVALID");
  if (!Array.isArray(packet.lsas) || packet.lsas.length < 1
    || packet.lsas.length > OSPF_LSR_MAX_UPDATE_LSAS)
    return bad(session, "OSPF_LSR_UPDATE_BATCH_INVALID");
  const advanced = advanceOspfLsRequestSession(session, state, packet.atMs);
  if (!advanced.ok) return bad(session, advanced.code);
  if (advanced.session.summary.exchange.dd.phase !== "EXCHANGE"
    || !advanced.session.outstanding)
    return bad(session, "OSPF_LSR_NOT_OUTSTANDING");
  const matched: OspfLsRequestCompletion[] = [];
  const existing = new Map(advanced.session.outstanding.requests.map((r) => [id(r), r]));
  const seen = new Set<string>();
  for (const bytes of packet.lsas) {
    const checked = verifyOspfLsaBinary(bytes);
    if (!checked.ok) return bad(session, checked.code);
    const k = id(checked.header);
    if (!existing.has(k) || seen.has(k)) return bad(session, "OSPF_LSR_UPDATE_UNEXPECTED_LSA");
    const advertised = advertisedHeader(advanced.session, k);
    if (!advertised || compareOspfLsaHeaders(advertised, checked.header) < 0)
      return bad(session, "OSPF_LSR_UPDATE_OLDER_THAN_REQUESTED");
    const request = existing.get(k)!;
    matched.push({ request: { ...request }, lsaBytes: checked.bytes });
    seen.add(k);
  }
  const remainingOutstanding = advanced.session.outstanding.requests
    .filter((r) => !seen.has(id(r)));
  const { outstanding: _discard, ...rest } = advanced.session;
  const updated: OspfLsRequestSession = {
    ...rest,
    completed: [...advanced.session.completed, ...matched],
    ...(remainingOutstanding.length ? { outstanding: {
      ...advanced.session.outstanding, requests: remainingOutstanding,
    } } : {}),
  };
  const post = inspectOspfLsRequestSession(updated, state);
  if (post) return bad(session, post);
  const complete = remaining(updated).length === 0;
  return {
    ok: true, session: updated,
    events: [
      ...advanced.events,
      trace("LSR_VERIFIED_LSA_RECEIVED", packet.atMs, matched.map((m) => m.request)),
      ...(complete ? [trace("LSR_REQUEST_LIST_EMPTY", packet.atMs, [])] : []),
    ],
  };
}
