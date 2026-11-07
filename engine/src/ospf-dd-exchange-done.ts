import type { EngineState } from "./types.js";
import {
  advanceOspfDdSummarySession, inspectOspfDdSummarySession,
  receiveOspfDdSummaryDescription, receiveOspfDdSummaryHello,
} from "./ospf-dd-summary-admission.js";
import type {
  OspfDdSummaryResult, OspfDdSummarySession,
  OspfDdSummaryTrace,
} from "./ospf-dd-summary-admission.js";
import type { OspfP2pDdObservation } from "./ospf-p2p-dd.js";
import type { OspfP2pHelloObservation, OspfP2pTrace } from "./ospf-p2p-hello.js";
import type { OspfP2pExchangeEvent } from "./ospf-p2p-exchange.js";
import type { OspfLsaHeader } from "./ospf-lsdb-summary.js";

export const OSPF_DD_FINISH_FORMAT = "yadilab.engine.ospfv2-dd-finish" as const;
export const OSPF_DD_FINISH_VERSION = "1.0.0" as const;
export const OSPF_DD_FINISH_MAX_LOCAL_PAGES = 17 as const;
const SOURCE = "SYNTHETIC_OSPFV2_DD_FINISH_MODEL" as const;

/**
 * RFC 2328 §10.6: virtual M-bit completion intent, on top of already-admitted
 * DD sequence + summary snapshots. Not actual outgoing DD packets, an
 * installed LSDB, wire-verified ExchangeDone or an actual FULL adjacency.
 */
export interface OspfDdLocalSummaryIntent {
  readonly atMs: number;
  readonly sequence: number;
  readonly more: boolean;
  readonly headers: readonly OspfLsaHeader[];
}
export interface OspfDdFinishSession {
  readonly formatId: typeof OSPF_DD_FINISH_FORMAT;
  readonly schemaVersion: typeof OSPF_DD_FINISH_VERSION;
  readonly summary: OspfDdSummarySession;
  readonly pageSize: number;
  readonly localTx: readonly OspfDdLocalSummaryIntent[];
  readonly exchangeDone: boolean;
}
export interface OspfDdFinishTrace {
  readonly kind:
    | "DD_LOCAL_SUMMARY_TX_INTENT"
    | "DD_EXCHANGE_DONE_MODEL"
    | "DD_LOADING_REQUIRED_MODEL"
    | "DD_EMPTY_REQUESTS_UNVERIFIED"
    | "DD_FINISH_DISCARDED";
  readonly atMs: number;
  readonly source: typeof SOURCE;
  readonly sequence: number;
  readonly more?: boolean;
  readonly headerCount?: number;
}
export type OspfDdFinishEvent = OspfP2pTrace | OspfP2pExchangeEvent
  | OspfDdSummaryTrace | OspfDdFinishTrace;
export type OspfDdFinishResult =
  | { readonly ok: true; readonly session: OspfDdFinishSession; readonly events: readonly OspfDdFinishEvent[] }
  | { readonly ok: false; readonly session: OspfDdFinishSession; readonly code: string };

function fail(session: OspfDdFinishSession, code: string): OspfDdFinishResult {
  return { ok: false, session, code };
}
function trace(
  kind: OspfDdFinishTrace["kind"], atMs: number, sequence: number,
  more?: boolean, headerCount?: number,
): OspfDdFinishTrace {
  return {
    kind, atMs, sequence, source: SOURCE,
    ...(more === undefined ? {} : { more }),
    ...(headerCount === undefined ? {} : { headerCount }),
  };
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function copyHeader(h: OspfLsaHeader): OspfLsaHeader {
  return {
    lsAge: h.lsAge, options: h.options, lsaType: h.lsaType,
    linkStateId: h.linkStateId, advertisingRouter: h.advertisingRouter,
    lsSequenceNumber: h.lsSequenceNumber, lsChecksum: h.lsChecksum,
    length: h.length,
  };
}
function localIntent(session: OspfDdFinishSession, index: number): OspfDdLocalSummaryIntent | null {
  if (index >= OSPF_DD_FINISH_MAX_LOCAL_PAGES) return null;
  const agreed = session.summary.exchange.dd.negotiated;
  if (!agreed) return null;
  const sequence = agreed.agreedSequence + index + 1;
  if (sequence > 0xffffffff) return null;
  const local = session.summary.localHeaders;
  const from = index * session.pageSize;
  const to = Math.min(from + session.pageSize, local.length);
  const headers = local.slice(from, to).map(copyHeader);
  const more = to < local.length;
  const accepted = session.summary.pages;
  const role = session.summary.exchange.exchange?.role;
  const atMs = role === "MASTER"
    ? index === 0 ? agreed.observation.atMs : accepted[index - 1]?.packet.atMs
    : accepted[index]?.packet.atMs;
  if (!Number.isSafeInteger(atMs)) return null;
  return { atMs: atMs!, sequence, more, headers };
}
function readyForCompletion(session: OspfDdFinishSession): boolean {
  const records = session.summary.pages;
  const last = session.localTx.at(-1);
  if (!last || records.length === 0) return false;
  const remote = records.at(-1)!.packet;
  if (last.more || remote.more) return false;
  const count = session.summary.localHeaders.length;
  if (session.localTx.length * session.pageSize < count) return false;
  const role = session.summary.exchange.exchange?.role;
  return role === "MASTER"
    ? last.sequence === remote.ddSequence && records.length === session.localTx.length
    : last.sequence === remote.ddSequence;
}
export function inspectOspfDdFinishSession(
  session: OspfDdFinishSession, state: EngineState,
): string | null {
  if (!session || session.formatId !== OSPF_DD_FINISH_FORMAT
    || session.schemaVersion !== OSPF_DD_FINISH_VERSION
    || !Number.isInteger(session.pageSize) || session.pageSize < 1
    || session.pageSize > 32 || !Array.isArray(session.localTx)
    || session.localTx.length > OSPF_DD_FINISH_MAX_LOCAL_PAGES
    || typeof session.exchangeDone !== "boolean" || !session.summary)
    return "OSPF_DD_FINISH_INVALID";
  const parent = inspectOspfDdSummarySession(session.summary, state);
  if (parent) return parent;
  if (session.summary.localHeaders.some((h) => h.lsAge === 3600))
    return "OSPF_DD_FINISH_MAXAGE_UNMODELED";
  if (session.summary.exchange.dd.phase !== "EXCHANGE") {
    return session.localTx.length === 0 && !session.exchangeDone
      ? null : "OSPF_DD_FINISH_STALE";
  }
  const role = session.summary.exchange.exchange?.role;
  const accepted = session.summary.pages.length;
  const expected = role === "MASTER"
    ? accepted + (session.exchangeDone ? 0 : 1) : accepted;
  if (expected !== session.localTx.length
    || session.localTx.some((tx, n) => !same(tx, localIntent(session, n))))
    return "OSPF_DD_FINISH_TX_LEDGER_INVALID";
  const messages = session.summary.pages;
  for (let n = 1; n < messages.length; n += 1) {
    if (!messages[n - 1]!.packet.more && messages[n]!.packet.more)
      return "OSPF_DD_FINISH_REMOTE_MORE_REGRESSION";
  }
  if (session.exchangeDone && !readyForCompletion(session))
    return "OSPF_DD_FINISH_DONE_INVALID";
  if (!session.exchangeDone && readyForCompletion(session)
    && role === "SLAVE") return "OSPF_DD_FINISH_DONE_INVALID";
  return null;
}
export function createOspfDdFinishSession(
  state: EngineState, summary: OspfDdSummarySession, pageSize: number,
): OspfDdFinishSession {
  const invalid = inspectOspfDdSummarySession(summary, state);
  if (invalid || summary.exchange.dd.phase !== "EXCHANGE"
    || !summary.exchange.exchange || summary.exchange.exchange.accepted !== 0
    || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 32
    || summary.localHeaders.some((h) => h.lsAge === 3600))
    throw Error("OSPF_DD_FINISH_CONFIG_INVALID");
  const initial: OspfDdFinishSession = {
    formatId: OSPF_DD_FINISH_FORMAT, schemaVersion: OSPF_DD_FINISH_VERSION,
    summary, pageSize, localTx: [], exchangeDone: false,
  };
  const first = summary.exchange.exchange.role === "MASTER" ? localIntent(initial, 0) : null;
  if (summary.exchange.exchange.role === "MASTER" && !first)
    throw Error("OSPF_DD_FINISH_SEQUENCE_OVERFLOW");
  const result: OspfDdFinishSession = first
    ? { ...initial, localTx: [first] } : initial;
  const post = inspectOspfDdFinishSession(result, state);
  if (post) throw Error(post);
  return result;
}
function resetForParent(
  current: OspfDdFinishSession, updated: OspfDdSummarySession,
  atMs: number, events: OspfDdFinishEvent[],
): OspfDdFinishSession {
  if (updated.exchange.dd.phase !== "EXCHANGE") {
    if (current.localTx.length || current.exchangeDone)
      events.push(trace("DD_FINISH_DISCARDED", atMs, 0));
    return { ...current, summary: updated, localTx: [], exchangeDone: false };
  }
  return { ...current, summary: updated };
}
function parentEvents(result: OspfDdSummaryResult): OspfDdFinishEvent[] {
  return result.ok ? [...result.events] : [];
}
function suppressFinishedCoreRetries(events: OspfDdFinishEvent[]): OspfDdFinishEvent[] {
  return events.filter((e) => e.kind !== "DD_RETRANSMIT_INTENT"
    && e.kind !== "DD_NEW_TX_INTENT");
}
export function advanceOspfDdFinishSession(
  session: OspfDdFinishSession, state: EngineState, untilMs: number,
): OspfDdFinishResult {
  const error = inspectOspfDdFinishSession(session, state);
  if (error) return fail(session, error);
  const advanced = advanceOspfDdSummarySession(session.summary, state, untilMs);
  if (!advanced.ok) return fail(session, advanced.code);
  const events = session.exchangeDone
    ? suppressFinishedCoreRetries(parentEvents(advanced))
    : parentEvents(advanced);
  const next = resetForParent(session, advanced.session, untilMs, events);
  const post = inspectOspfDdFinishSession(next, state);
  return post ? fail(session, post) : { ok: true, session: next, events };
}
export function receiveOspfDdFinishHello(
  session: OspfDdFinishSession, state: EngineState, hello: OspfP2pHelloObservation,
): OspfDdFinishResult {
  const error = inspectOspfDdFinishSession(session, state);
  if (error) return fail(session, error);
  const updated = receiveOspfDdSummaryHello(session.summary, state, hello);
  if (!updated.ok) return fail(session, updated.code);
  const events = session.exchangeDone
    ? suppressFinishedCoreRetries(parentEvents(updated))
    : parentEvents(updated);
  const next = resetForParent(session, updated.session, hello.atMs, events);
  const post = inspectOspfDdFinishSession(next, state);
  return post ? fail(session, post) : { ok: true, session: next, events };
}
export function receiveOspfDdFinishDescription(
  session: OspfDdFinishSession, state: EngineState,
  packet: OspfP2pDdObservation, headers: readonly OspfLsaHeader[],
): OspfDdFinishResult {
  const error = inspectOspfDdFinishSession(session, state);
  if (error) return fail(session, error);
  const accepted = receiveOspfDdSummaryDescription(session.summary, state, packet, headers);
  if (!accepted.ok) return fail(session, accepted.code);
  const events = parentEvents(accepted);
  if (accepted.session.exchange.dd.phase !== "EXCHANGE")
    return (() => {
      const next = resetForParent(session, accepted.session, packet.atMs, events);
      const post = inspectOspfDdFinishSession(next, state);
      return post ? fail(session, post) : { ok: true, session: next, events };
    })();
  if (session.summary.exchange.dd.phase !== "EXCHANGE") {
    // A SeqNumberMismatch or Dead reset may later renegotiate ExStart.
    // Recover only a fresh Exchange (zero accepted DD pages).
    if (accepted.session.exchange.exchange?.accepted !== 0)
      return fail(session, "OSPF_DD_FINISH_RENEGOTIATION_INVALID");
    let fresh: OspfDdFinishSession;
    try {
      fresh = createOspfDdFinishSession(state, accepted.session, session.pageSize);
    } catch {
      return fail(session, "OSPF_DD_FINISH_RENEGOTIATION_INVALID");
    }
    const first = fresh.localTx[0];
    if (first) events.push(trace("DD_LOCAL_SUMMARY_TX_INTENT", first.atMs,
      first.sequence, first.more, first.headers.length));
    return { ok: true, session: fresh, events };
  }
  const before = session.summary.pages.length;
  const after = accepted.session.pages.length;
  if (after === before) {
    const next = { ...session, summary: accepted.session };
    const post = inspectOspfDdFinishSession(next, state);
    return post ? fail(session, post) : { ok: true, session: next, events };
  }
  if (session.exchangeDone) return fail(session, "OSPF_DD_FINISH_AFTER_DONE_UNMODELED");
  if (after !== before + 1) return fail(session, "OSPF_DD_FINISH_SEQUENCE_INVALID");
  if (before > 0 && !session.summary.pages.at(-1)!.packet.more && packet.more)
    return fail(session, "OSPF_DD_FINISH_REMOTE_MORE_REGRESSION");
  const role = accepted.session.exchange.exchange?.role;
  if (role !== "MASTER" && role !== "SLAVE") return fail(session, "OSPF_DD_FINISH_ROLE_INVALID");
  const rebased: OspfDdFinishSession = { ...session, summary: accepted.session };
  let localTx = session.localTx;
  let done = false;
  if (role === "MASTER") {
    // Last local M=0 DD is acknowledged by the just-received slave DD.
    done = readyForCompletion({ ...rebased, localTx, exchangeDone: true });
    if (!done) {
      const next = localIntent(rebased, session.localTx.length);
      if (!next) return fail(session, "OSPF_DD_FINISH_TX_LIMIT");
      localTx = [...localTx, next];
      events.push(trace("DD_LOCAL_SUMMARY_TX_INTENT", next.atMs,
        next.sequence, next.more, next.headers.length));
    } else {
      // Parent sequence oracle mechanically emits another DD intent. This
      // wrapper suppresses it after RFC local/peer M-bit termination.
      const trimmed = suppressFinishedCoreRetries(events);
      events.splice(0, events.length, ...trimmed);
    }
  } else {
    const reply = localIntent(rebased, session.localTx.length);
    if (!reply) return fail(session, "OSPF_DD_FINISH_TX_LIMIT");
    localTx = [...localTx, reply];
    events.push(trace("DD_LOCAL_SUMMARY_TX_INTENT", reply.atMs,
      reply.sequence, reply.more, reply.headers.length));
    done = readyForCompletion({ ...rebased, localTx, exchangeDone: true });
  }
  const next: OspfDdFinishSession = {
    ...rebased, localTx, exchangeDone: done,
  };
  if (done) {
    events.push(trace("DD_EXCHANGE_DONE_MODEL", packet.atMs, packet.ddSequence));
    events.push(trace(next.summary.plan?.requestIntents.length
      ? "DD_LOADING_REQUIRED_MODEL" : "DD_EMPTY_REQUESTS_UNVERIFIED",
      packet.atMs, packet.ddSequence));
  }
  const post = inspectOspfDdFinishSession(next, state);
  return post ? fail(session, post) : { ok: true, session: next, events };
}
