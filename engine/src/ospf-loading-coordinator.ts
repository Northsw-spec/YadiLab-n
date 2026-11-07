import type { EngineState } from "./types.js";
import {
  advanceOspfDdFinishSession, inspectOspfDdFinishSession,
  receiveOspfDdFinishDescription, receiveOspfDdFinishHello,
} from "./ospf-dd-exchange-done.js";
import type { OspfDdFinishEvent, OspfDdFinishSession } from "./ospf-dd-exchange-done.js";
import {
  advanceOspfLsRequestSession, createOspfLsRequestSession,
  inspectOspfLsRequestSession, issueOspfLsRequest,
  receiveOspfLsRequestHello, receiveOspfLsRequestUpdate,
} from "./ospf-lsr-lifecycle.js";
import type {
  OspfLsRequestSession, OspfLsRequestTrace, OspfLsUpdateObservation,
} from "./ospf-lsr-lifecycle.js";
import type { OspfP2pDdObservation } from "./ospf-p2p-dd.js";
import type { OspfP2pHelloObservation } from "./ospf-p2p-hello.js";
import type { OspfLsaHeader, OspfLsaRequestIntent } from "./ospf-lsdb-summary.js";

/**
 * RFC 2328 §§10.3, 10.9: frozen DD ExchangeDone and verified LSA receipts
 * must refer to the EXACT same source-bound DD summary snapshot. This
 * coordinator never infers an actual FULL neighbor, installed LSDB or routes.
 */
export const OSPF_LOADING_FORMAT = "yadilab.engine.ospfv2-loading-coordinator" as const;
export const OSPF_LOADING_VERSION = "1.0.0" as const;
const SOURCE = "SYNTHETIC_OSPFV2_LOADING_COORDINATOR_MODEL" as const;

export type OspfLoadingPhase =
  | "EXCHANGE_MODEL"
  | "LOADING_MODEL"
  | "REQUESTS_SATISFIED_MODEL"
  | "NO_LOADING_REQUIRED_MODEL";

export interface OspfLoadingSession {
  readonly formatId: typeof OSPF_LOADING_FORMAT;
  readonly schemaVersion: typeof OSPF_LOADING_VERSION;
  readonly finish: OspfDdFinishSession;
  readonly requests: OspfLsRequestSession;
  readonly phase: OspfLoadingPhase;
}
export interface OspfLoadingTrace {
  readonly kind:
    | "LOADING_ENTERED_MODEL"
    | "LOADING_DONE_ELIGIBLE_MODEL"
    | "NO_LOADING_REQUIRED_UNVERIFIED_MODEL"
    | "LOADING_RESET_MODEL";
  readonly atMs: number;
  readonly source: typeof SOURCE;
  readonly outstandingCount: number;
}
export type OspfLoadingEvent = OspfDdFinishEvent | OspfLsRequestTrace | OspfLoadingTrace;
export type OspfLoadingResult =
  | {
      readonly ok: true;
      readonly session: OspfLoadingSession;
      readonly events: readonly OspfLoadingEvent[];
      readonly remainingRequests: readonly OspfLsaRequestIntent[];
    }
  | { readonly ok: false; readonly session: OspfLoadingSession; readonly code: string };

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
const requestKey = (r: OspfLsaRequestIntent): string =>
  [r.lsaType, r.linkStateId, r.advertisingRouter].join("|");
const denied = (session: OspfLoadingSession, code: string): OspfLoadingResult =>
  ({ ok: false, session, code });

function remaining(session: OspfLoadingSession): OspfLsaRequestIntent[] {
  const done = new Set(session.requests.completed.map((item) => requestKey(item.request)));
  return (session.requests.summary.plan?.requestIntents ?? [])
    .filter((r) => !done.has(requestKey(r))).map((r) => ({ ...r }));
}
function trace(
  kind: OspfLoadingTrace["kind"], atMs: number, outstandingCount: number,
): OspfLoadingTrace {
  return { kind, atMs, outstandingCount, source: SOURCE };
}
function withUpdatedSummary(
  old: OspfLsRequestSession, finish: OspfDdFinishSession,
  clear: boolean,
): OspfLsRequestSession {
  if (!clear) return { ...old, summary: finish.summary };
  const { outstanding: _discard, ...withoutOutstanding } = old;
  return { ...withoutOutstanding, summary: finish.summary, completed: [] };
}
function phaseFromEvidence(session: OspfLoadingSession): OspfLoadingPhase {
  if (!session.finish.exchangeDone) return "EXCHANGE_MODEL";
  const total = session.requests.summary.plan?.requestIntents.length ?? 0;
  if (total === 0) return "NO_LOADING_REQUIRED_MODEL";
  return remaining(session).length > 0 ? "LOADING_MODEL" : "REQUESTS_SATISFIED_MODEL";
}
function progress(
  prior: OspfLoadingSession, next: OspfLoadingSession,
  events: OspfLoadingEvent[], atMs: number,
): OspfLoadingSession {
  const derived = phaseFromEvidence(next);
  const count = remaining(next).length;
  if (prior.phase !== derived) {
    if (derived === "EXCHANGE_MODEL") {
      if (prior.phase !== "EXCHANGE_MODEL")
        events.push(trace("LOADING_RESET_MODEL", atMs, count));
    } else if (derived === "LOADING_MODEL") {
      events.push(trace("LOADING_ENTERED_MODEL", atMs, count));
    } else if (derived === "REQUESTS_SATISFIED_MODEL") {
      events.push(trace("LOADING_DONE_ELIGIBLE_MODEL", atMs, 0));
    } else {
      events.push(trace("NO_LOADING_REQUIRED_UNVERIFIED_MODEL", atMs, 0));
    }
  }
  return { ...next, phase: derived };
}
function success(
  session: OspfLoadingSession, events: readonly OspfLoadingEvent[],
): OspfLoadingResult {
  return { ok: true, session, events, remainingRequests: remaining(session) };
}

/**
 * Fail closed on a forged mismatch between independent DD and LSR clock,
 * source, sequence, summary pages, request list or verification receipts.
 */
export function inspectOspfLoadingSession(
  session: OspfLoadingSession, state: EngineState,
): string | null {
  if (!session || session.formatId !== OSPF_LOADING_FORMAT
    || session.schemaVersion !== OSPF_LOADING_VERSION
    || !session.finish || !session.requests
    || !["EXCHANGE_MODEL", "LOADING_MODEL",
      "REQUESTS_SATISFIED_MODEL", "NO_LOADING_REQUIRED_MODEL"].includes(session.phase))
    return "OSPF_LOADING_SESSION_INVALID";
  const finishError = inspectOspfDdFinishSession(session.finish, state);
  if (finishError) return finishError;
  const requestError = inspectOspfLsRequestSession(session.requests, state);
  if (requestError) return requestError;
  if (!same(session.finish.summary, session.requests.summary))
    return "OSPF_LOADING_SNAPSHOT_MISMATCH";
  if (session.phase !== phaseFromEvidence(session))
    return "OSPF_LOADING_PHASE_INVALID";
  if (session.phase === "EXCHANGE_MODEL"
    && (session.requests.outstanding !== undefined || session.requests.completed.length > 0))
    return "OSPF_LOADING_PREMATURE_REQUEST";
  if (session.phase === "REQUESTS_SATISFIED_MODEL"
    && session.requests.outstanding !== undefined)
    return "OSPF_LOADING_STALE_OUTSTANDING";
  return null;
}

/** Creation is only legal at fresh NegotiationDone, before any remote DD page. */
export function createOspfLoadingSession(
  state: EngineState, finish: OspfDdFinishSession, maxPerPacket = 8,
): OspfLoadingSession {
  if (inspectOspfDdFinishSession(finish, state)
    || finish.exchangeDone || finish.summary.exchange.dd.phase !== "EXCHANGE"
    || finish.summary.pages.length !== 0
    || finish.summary.exchange.exchange?.accepted !== 0)
    throw Error("OSPF_LOADING_FRESH_EXCHANGE_REQUIRED");
  const requests = createOspfLsRequestSession(state, finish.summary, maxPerPacket);
  const next: OspfLoadingSession = {
    formatId: OSPF_LOADING_FORMAT, schemaVersion: OSPF_LOADING_VERSION,
    finish, requests, phase: "EXCHANGE_MODEL",
  };
  const post = inspectOspfLoadingSession(next, state);
  if (post) throw Error(post);
  return next;
}

/** Receive DD summary only through the existing sequence/M-bit admission. */
export function receiveOspfLoadingDescription(
  session: OspfLoadingSession, state: EngineState,
  packet: OspfP2pDdObservation, headers: readonly OspfLsaHeader[],
): OspfLoadingResult {
  const invalid = inspectOspfLoadingSession(session, state);
  if (invalid) return denied(session, invalid);
  const accepted = receiveOspfDdFinishDescription(session.finish, state, packet, headers);
  if (!accepted.ok) return denied(session, accepted.code);
  const wasReset = session.finish.summary.exchange.dd.phase === "EXCHANGE"
    && accepted.session.summary.exchange.dd.phase !== "EXCHANGE";
  const freshNegotiation = session.finish.summary.exchange.dd.phase !== "EXCHANGE"
    && accepted.session.summary.exchange.dd.phase === "EXCHANGE";
  const clear = wasReset || freshNegotiation;
  const next: OspfLoadingSession = {
    ...session, finish: accepted.session,
    requests: withUpdatedSummary(session.requests, accepted.session, clear),
  };
  const events: OspfLoadingEvent[] = [...accepted.events];
  const updated = progress(session, next, events, packet.atMs);
  const post = inspectOspfLoadingSession(updated, state);
  return post ? denied(session, post) : success(updated, events);
}
/** Drive both parent virtual clocks atomically; never silently swallow LSR retries. */
export function advanceOspfLoadingSession(
  session: OspfLoadingSession, state: EngineState, untilMs: number,
): OspfLoadingResult {
  const invalid = inspectOspfLoadingSession(session, state);
  if (invalid) return denied(session, invalid);
  const lsr = advanceOspfLsRequestSession(session.requests, state, untilMs);
  if (!lsr.ok) return denied(session, lsr.code);
  const dd = advanceOspfDdFinishSession(session.finish, state, untilMs);
  if (!dd.ok) return denied(session, dd.code);
  const candidate: OspfLoadingSession = { ...session, finish: dd.session, requests: lsr.session };
  if (!same(candidate.finish.summary, candidate.requests.summary))
    return denied(session, "OSPF_LOADING_SNAPSHOT_MISMATCH");
  const events: OspfLoadingEvent[] = [...dd.events, ...lsr.events];
  const updated = progress(session, candidate, events, untilMs);
  const post = inspectOspfLoadingSession(updated, state);
  return post ? denied(session, post) : success(updated, events);
}
/** Forward Hello to both parent state machines at one virtual timestamp. */
export function receiveOspfLoadingHello(
  session: OspfLoadingSession, state: EngineState,
  hello: OspfP2pHelloObservation,
): OspfLoadingResult {
  const invalid = inspectOspfLoadingSession(session, state);
  if (invalid) return denied(session, invalid);
  if (!hello || !Number.isSafeInteger(hello.atMs) || hello.atMs < 0)
    return denied(session, "OSPF_LOADING_HELLO_INVALID");
  const lsr = receiveOspfLsRequestHello(session.requests, state, hello);
  if (!lsr.ok) return denied(session, lsr.code);
  const dd = receiveOspfDdFinishHello(session.finish, state, hello);
  if (!dd.ok) return denied(session, dd.code);
  const candidate: OspfLoadingSession = { ...session, finish: dd.session, requests: lsr.session };
  if (!same(candidate.finish.summary, candidate.requests.summary))
    return denied(session, "OSPF_LOADING_SNAPSHOT_MISMATCH");
  const events: OspfLoadingEvent[] = [...dd.events, ...lsr.events];
  const updated = progress(session, candidate, events, hello.atMs);
  const post = inspectOspfLoadingSession(updated, state);
  return post ? denied(session, post) : success(updated, events);
}
/** LSR request intents are forbidden before DD completion and after exhaustion. */
export function issueOspfLoadingRequest(
  session: OspfLoadingSession, state: EngineState,
): OspfLoadingResult {
  const invalid = inspectOspfLoadingSession(session, state);
  if (invalid) return denied(session, invalid);
  if (session.phase !== "LOADING_MODEL")
    return denied(session, "OSPF_LOADING_REQUEST_NOT_PERMITTED");
  const issued = issueOspfLsRequest(session.requests, state);
  if (!issued.ok) return denied(session, issued.code);
  const next: OspfLoadingSession = { ...session, requests: issued.session };
  const post = inspectOspfLoadingSession(next, state);
  return post ? denied(session, post) : success(next, issued.events);
}
/**
 * Receive only externally admitted, checksum-verified outstanding synthetic
 * LSA replies. Completion is a MODEL-ONLY LoadingDone eligibility signal.
 * In particular, never create a FULL neighbor or route.
 */
export function receiveOspfLoadingUpdate(
  session: OspfLoadingSession, state: EngineState,
  packet: OspfLsUpdateObservation,
): OspfLoadingResult {
  const invalid = inspectOspfLoadingSession(session, state);
  if (invalid) return denied(session, invalid);
  if (session.phase !== "LOADING_MODEL")
    return denied(session, "OSPF_LOADING_UPDATE_NOT_PERMITTED");
  const received = receiveOspfLsRequestUpdate(session.requests, state, packet);
  if (!received.ok) return denied(session, received.code);
  const dd = advanceOspfDdFinishSession(session.finish, state, packet.atMs);
  if (!dd.ok) return denied(session, dd.code);
  const candidate: OspfLoadingSession = {
    ...session, finish: dd.session, requests: received.session,
  };
  if (!same(candidate.finish.summary, candidate.requests.summary))
    return denied(session, "OSPF_LOADING_SNAPSHOT_MISMATCH");
  const events: OspfLoadingEvent[] = [...dd.events, ...received.events];
  const updated = progress(session, candidate, events, packet.atMs);
  const post = inspectOspfLoadingSession(updated, state);
  return post ? denied(session, post) : success(updated, events);
}
