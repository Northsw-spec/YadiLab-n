import type { EngineState } from "./types.js";
import {
  advanceOspfP2pExchangeSession, inspectOspfP2pExchangeSession,
  receiveOspfP2pExchangeDescription, receiveOspfP2pExchangeHello,
} from "./ospf-p2p-exchange.js";
import type {
  OspfP2pExchangeEvent, OspfP2pExchangeSession,
} from "./ospf-p2p-exchange.js";
import type { OspfP2pDdObservation } from "./ospf-p2p-dd.js";
import type { OspfP2pHelloObservation } from "./ospf-p2p-hello.js";
import {
  createOspfLsdbSummaryPlan, inspectOspfLsdbSummaryPlan,
  recordOspfLsdbSummaryBatch, validOspfLsaHeader,
  OSPF_LSDB_MAX_BATCHES, OSPF_LSDB_MAX_BATCH_HEADERS,
} from "./ospf-lsdb-summary.js";
import type {
  OspfLsaHeader, OspfLsaRequestIntent, OspfLsdbSummaryPlan,
} from "./ospf-lsdb-summary.js";

/**
 * RFC 2328 §10.6: admit synthetic, already-associated DD summary headers
 * only AFTER Exchange sequence admission, then derive LS Request intents.
 * The existing DD Exchange core remains a strict *sequence-only* oracle:
 * its lsaHeaderCount=0 projection is never presented as real wire admission.
 * No LSDB body, LSA verification, LS Request transmission or FULL.
 */
export const OSPF_DD_SUMMARY_FORMAT = "yadilab.engine.ospfv2-dd-summary-admission" as const;
export const OSPF_DD_SUMMARY_VERSION = "1.0.0" as const;
const SOURCE = "SYNTHETIC_OSPFV2_DD_SUMMARY_ADMISSION_MODEL" as const;

export interface OspfDdSummaryPage {
  readonly packet: OspfP2pDdObservation;
  readonly headers: readonly OspfLsaHeader[];
}
export interface OspfDdSummarySession {
  readonly formatId: typeof OSPF_DD_SUMMARY_FORMAT;
  readonly schemaVersion: typeof OSPF_DD_SUMMARY_VERSION;
  readonly exchange: OspfP2pExchangeSession;
  readonly localHeaders: readonly OspfLsaHeader[];
  readonly pages: readonly OspfDdSummaryPage[];
  readonly plan?: OspfLsdbSummaryPlan;
}
export interface OspfDdSummaryTrace {
  readonly kind: "DD_LSA_HEADERS_ADMITTED" | "DD_SUMMARY_DISCARDED";
  readonly atMs: number;
  readonly source: typeof SOURCE;
  readonly headerCount: number;
}
export type OspfDdSummaryResult =
  | {
      readonly ok: true;
      readonly session: OspfDdSummarySession;
      readonly events: readonly (OspfP2pExchangeEvent | OspfDdSummaryTrace)[];
      readonly newRequests: readonly OspfLsaRequestIntent[];
    }
  | { readonly ok: false; readonly session: OspfDdSummarySession; readonly code: string };

const failed = (session: OspfDdSummarySession, code: string): OspfDdSummaryResult =>
  ({ ok: false, session, code });
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function copyPacket(p: OspfP2pDdObservation): OspfP2pDdObservation {
  return {
    atMs: p.atMs, senderRouterId: p.senderRouterId, areaId: p.areaId,
    interfaceMtu: p.interfaceMtu, options: p.options, init: p.init,
    more: p.more, master: p.master, ddSequence: p.ddSequence,
    lsaHeaderCount: p.lsaHeaderCount,
  };
}
function sequenceProjection(p: OspfP2pDdObservation): OspfP2pDdObservation {
  return { ...copyPacket(p), lsaHeaderCount: 0 };
}
function copyHeader(h: OspfLsaHeader): OspfLsaHeader {
  return {
    lsAge: h.lsAge, options: h.options, lsaType: h.lsaType,
    linkStateId: h.linkStateId, advertisingRouter: h.advertisingRouter,
    lsSequenceNumber: h.lsSequenceNumber, lsChecksum: h.lsChecksum, length: h.length,
  };
}
function metadataTrace(
  kind: OspfDdSummaryTrace["kind"], atMs: number, headerCount: number,
): OspfDdSummaryTrace {
  return { kind, atMs, headerCount, source: SOURCE };
}
function rebuildPlan(
  state: EngineState, exchange: OspfP2pExchangeSession,
  localHeaders: readonly OspfLsaHeader[], pages: readonly OspfDdSummaryPage[],
): OspfLsdbSummaryPlan | null {
  try {
    let plan = createOspfLsdbSummaryPlan(state, exchange, localHeaders);
    for (let n = 0; n < pages.length; n += 1) {
      const received = recordOspfLsdbSummaryBatch(
        plan, state, exchange, "dd." + (n + 1), pages[n]!.headers,
      );
      if (!received.ok) return null;
      plan = received.plan;
    }
    return plan;
  } catch {
    return null;
  }
}
/** Any change to DD sequence, virtual clock, or state invalidates a stale plan. */
export function inspectOspfDdSummarySession(
  session: OspfDdSummarySession, state: EngineState,
): string | null {
  if (!session || session.formatId !== OSPF_DD_SUMMARY_FORMAT
    || session.schemaVersion !== OSPF_DD_SUMMARY_VERSION
    || !Array.isArray(session.localHeaders) || !Array.isArray(session.pages)
    || session.pages.length > OSPF_LSDB_MAX_BATCHES
    || !session.pages.every((p) => p && Array.isArray(p.headers)
      && p.headers.length <= OSPF_LSDB_MAX_BATCH_HEADERS
      && p.headers.every(validOspfLsaHeader)
      && p.packet && Number.isSafeInteger(p.packet.lsaHeaderCount)
      && p.packet.lsaHeaderCount === p.headers.length)) return "OSPF_DD_SUMMARY_INVALID";
  const parentError = inspectOspfP2pExchangeSession(session.exchange, state);
  if (parentError) return parentError;
  if (session.exchange.dd.phase !== "EXCHANGE") {
    return session.pages.length === 0 && session.plan === undefined
      ? null : "OSPF_DD_SUMMARY_STATE_INVALID";
  }
  const e = session.exchange.exchange;
  if (!e || e.accepted !== session.pages.length || !session.plan)
    return "OSPF_DD_SUMMARY_LEDGER_INVALID";
  // Each accepted DD summary is the next observed sequence, not an
  // arbitrary list of independently supplied page IDs or stale headers.
  const agreed = session.exchange.dd.negotiated!;
  for (let n = 0; n < session.pages.length; n += 1) {
    const p = session.pages[n]!.packet;
    if (!Number.isSafeInteger(p.atMs) || p.atMs < agreed.observation.atMs
      || p.atMs > session.exchange.dd.hello.clock.nowMs
      || (n > 0 && p.atMs < session.pages[n - 1]!.packet.atMs)
      || !Number.isInteger(p.interfaceMtu) || p.interfaceMtu < 68
      || p.interfaceMtu > session.exchange.dd.localInterfaceMtu
      || p.senderRouterId !== session.exchange.dd.hello.config.remoteRouterId
      || p.areaId !== session.exchange.dd.hello.config.areaId
      || p.options !== e.options || p.init !== false
      || p.master !== (e.role === "SLAVE")
      || typeof p.more !== "boolean"
      || p.ddSequence !== agreed.agreedSequence + n + 1) {
      return "OSPF_DD_SUMMARY_LEDGER_INVALID";
    }
  }
  if (session.pages.length) {
    const last = session.pages[session.pages.length - 1]!;
    if (!same(sequenceProjection(last.packet), e.lastReceived))
      return "OSPF_DD_SUMMARY_LEDGER_INVALID";
  }
  const expected = rebuildPlan(state, session.exchange, session.localHeaders, session.pages);
  if (!expected || inspectOspfLsdbSummaryPlan(expected, state, session.exchange)
    || !same(expected, session.plan)) return "OSPF_DD_SUMMARY_LEDGER_INVALID";
  return null;
}
/** Begin only at fresh NegotiationDone; never attach to a partially processed exchange. */
export function createOspfDdSummarySession(
  state: EngineState, exchange: OspfP2pExchangeSession,
  localHeaders: readonly OspfLsaHeader[],
): OspfDdSummarySession {
  const initial = createOspfLsdbSummaryPlan(state, exchange, localHeaders);
  if (!exchange.exchange || exchange.exchange.accepted !== 0)
    throw Error("OSPF_DD_SUMMARY_FRESH_EXCHANGE_REQUIRED");
  const session: OspfDdSummarySession = {
    formatId: OSPF_DD_SUMMARY_FORMAT, schemaVersion: OSPF_DD_SUMMARY_VERSION,
    exchange, localHeaders: initial.localHeaders, pages: [], plan: initial,
  };
  const error = inspectOspfDdSummarySession(session, state);
  if (error) throw Error(error);
  return session;
}
/** Rebind every summary header plan to the new, exact Exchange snapshot. */
function rebind(
  previous: OspfDdSummarySession, state: EngineState,
  exchange: OspfP2pExchangeSession, pages: readonly OspfDdSummaryPage[],
): OspfDdSummarySession | null {
  if (exchange.dd.phase !== "EXCHANGE") {
    // exactOptionalPropertyTypes requires truly removing the optional plan.
    const { plan: _discarded, ...reset } = previous;
    return { ...reset, exchange, pages: [] };
  }
  const plan = rebuildPlan(state, exchange, previous.localHeaders, pages);
  return plan ? { ...previous, exchange, pages, plan } : null;
}
export function advanceOspfDdSummarySession(
  session: OspfDdSummarySession, state: EngineState, untilMs: number,
): OspfDdSummaryResult {
  const error = inspectOspfDdSummarySession(session, state);
  if (error) return failed(session, error);
  const advanced = advanceOspfP2pExchangeSession(session.exchange, state, untilMs);
  if (!advanced.ok) return failed(session, advanced.code);
  const rebound = rebind(session, state, advanced.session, session.pages);
  if (!rebound || inspectOspfDdSummarySession(rebound, state))
    return failed(session, "OSPF_DD_SUMMARY_REBIND_INVALID");
  const wasDiscarded = session.pages.length > 0 && rebound.pages.length === 0;
  return {
    ok: true, session: rebound, newRequests: [],
    events: [...advanced.events,
      ...(wasDiscarded ? [metadataTrace("DD_SUMMARY_DISCARDED", untilMs, session.pages.length)] : [])],
  };
}
export function receiveOspfDdSummaryHello(
  session: OspfDdSummarySession, state: EngineState, hello: OspfP2pHelloObservation,
): OspfDdSummaryResult {
  const error = inspectOspfDdSummarySession(session, state);
  if (error) return failed(session, error);
  const received = receiveOspfP2pExchangeHello(session.exchange, state, hello);
  if (!received.ok) return failed(session, received.code);
  const rebound = rebind(session, state, received.session, session.pages);
  if (!rebound || inspectOspfDdSummarySession(rebound, state))
    return failed(session, "OSPF_DD_SUMMARY_REBIND_INVALID");
  const discarded = session.pages.length > 0 && rebound.pages.length === 0;
  return {
    ok: true, session: rebound, newRequests: [],
    events: [...received.events,
      ...(discarded ? [metadataTrace("DD_SUMMARY_DISCARDED", hello.atMs, session.pages.length)] : [])],
  };
}
/**
 * Sequence admission must precede recording headers. The existing Exchange
 * checker receives a *metadata-only projection*, while this adapter guards
 * and owns the full LSA header batch and request ledger as one transaction.
 */
export function receiveOspfDdSummaryDescription(
  session: OspfDdSummarySession, state: EngineState,
  packet: OspfP2pDdObservation, headers: readonly OspfLsaHeader[],
): OspfDdSummaryResult {
  const error = inspectOspfDdSummarySession(session, state);
  if (error) return failed(session, error);
  if (!packet || !Number.isSafeInteger(packet.lsaHeaderCount)
    || packet.lsaHeaderCount < 0 || packet.lsaHeaderCount > OSPF_LSDB_MAX_BATCH_HEADERS
    || !Array.isArray(headers) || packet.lsaHeaderCount !== headers.length
    || !headers.every(validOspfLsaHeader))
    return failed(session, "OSPF_DD_SUMMARY_HEADERS_INVALID");
  if (session.exchange.dd.phase === "EXSTART" && headers.length !== 0)
    return failed(session, "OSPF_DD_SUMMARY_EXSTART_NONEMPTY");
  const core = receiveOspfP2pExchangeDescription(
    session.exchange, state, sequenceProjection(packet),
  );
  if (!core.ok) return failed(session, core.code);
  const reset = core.events.some((e) => e.kind === "DD_SEQUENCE_MISMATCH_RESET");
  if (reset || core.session.dd.phase !== "EXCHANGE") {
    const cleared = rebind(session, state, core.session, []);
    if (!cleared || inspectOspfDdSummarySession(cleared, state))
      return failed(session, "OSPF_DD_SUMMARY_REBIND_INVALID");
    return { ok: true, session: cleared, newRequests: [],
      events: [...core.events,
        ...(session.pages.length ? [metadataTrace("DD_SUMMARY_DISCARDED", packet.atMs, session.pages.length)] : [])] };
  }
  const priorCount = session.exchange.exchange?.accepted ?? 0;
  const nextCount = core.session.exchange!.accepted;
  if (nextCount === priorCount && session.exchange.dd.phase === "EXSTART") {
    if (headers.length !== 0) return failed(session, "OSPF_DD_SUMMARY_EXSTART_NONEMPTY");
    const newlyBound = rebind(session, state, core.session, []);
    if (!newlyBound || inspectOspfDdSummarySession(newlyBound, state))
      return failed(session, "OSPF_DD_SUMMARY_REBIND_INVALID");
    return { ok: true, session: newlyBound, events: core.events, newRequests: [] };
  }
  if (nextCount === priorCount) {
    const duplicate = core.events.some((e) => e.kind === "DD_DUPLICATE_IGNORED"
      || e.kind === "DD_DUPLICATE_REPLY_INTENT");
    const priorHeaders = session.pages.length
      ? session.pages[session.pages.length - 1]!.headers : [];
    if (!duplicate || !same(headers, priorHeaders))
      return failed(session, "OSPF_DD_SUMMARY_DUPLICATE_MISMATCH");
    const samePage = rebind(session, state, core.session, session.pages);
    if (!samePage || inspectOspfDdSummarySession(samePage, state))
      return failed(session, "OSPF_DD_SUMMARY_REBIND_INVALID");
    return { ok: true, session: samePage, events: core.events, newRequests: [] };
  }
  if (nextCount !== priorCount + 1 || session.pages.length >= OSPF_LSDB_MAX_BATCHES)
    return failed(session, "OSPF_DD_SUMMARY_BATCH_LIMIT");
  const pages: OspfDdSummaryPage[] = [...session.pages, {
    packet: copyPacket(packet), headers: headers.map(copyHeader),
  }];
  const next = rebind(session, state, core.session, pages);
  if (!next || inspectOspfDdSummarySession(next, state))
    return failed(session, "OSPF_DD_SUMMARY_BATCH_INVALID");
  const oldRequests = new Set((session.plan?.requestIntents ?? [])
    .map((r) => [r.lsaType, r.linkStateId, r.advertisingRouter].join("|")));
  const newRequests = next.plan!.requestIntents.filter((r) =>
    !oldRequests.has([r.lsaType, r.linkStateId, r.advertisingRouter].join("|")));
  return {
    ok: true, session: next, newRequests,
    events: [...core.events, metadataTrace("DD_LSA_HEADERS_ADMITTED", packet.atMs, headers.length)],
  };
}
