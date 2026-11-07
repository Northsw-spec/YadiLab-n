import type { EngineState } from "./types.js";
import {
  advanceOspfP2pDdSession, createOspfP2pDdSession, inspectOspfP2pDdSession,
  receiveOspfP2pDdDescription, receiveOspfP2pDdHello,
} from "./ospf-p2p-dd.js";
import type {
  OspfP2pDdConfig, OspfP2pDdObservation, OspfP2pDdRole,
  OspfP2pDdSession, OspfP2pDdTrace,
} from "./ospf-p2p-dd.js";
import type { OspfP2pHelloObservation, OspfP2pTrace } from "./ospf-p2p-hello.js";

/**
 * RFC 2328 §§10.3, 10.6, 10.8: bounded, synthetic, empty-DD Exchange
 * sequencing and retransmission intents. No packets are transmitted.
 * LSA summaries, ExchangeDone, Loading/Full and routing remain UNMODELED.
 */
export const OSPF_EXCHANGE_FORMAT = "yadilab.engine.ospfv2-p2p-dd-exchange" as const;
export const OSPF_EXCHANGE_VERSION = "1.0.0" as const;
export const OSPF_EXCHANGE_MAX_ACCEPTED = 128 as const;
export const OSPF_EXCHANGE_MAX_RETRANSMITS = 128 as const;
export const OSPF_EXCHANGE_MAX_ADVANCE_RETRANSMITS = 64 as const;
const SOURCE = "SYNTHETIC_OSPFV2_P2P_EXCHANGE_MODEL" as const;
const UINT32_MAX = 0xffffffff;

export interface OspfP2pExchangeConfig extends OspfP2pDdConfig {
  /** Deterministic RxmtInterval in whole milliseconds, not wall-clock. */
  readonly rxmtIntervalMs: number;
}
export interface OspfP2pExchangeRecord {
  readonly role: OspfP2pDdRole;
  /** Sequence of the latest synthetic local DD transmit intent. */
  readonly sequence: number;
  readonly options: number;
  readonly lastReceived: OspfP2pDdObservation;
  readonly lastSent: { readonly sequence: number; readonly atMs: number };
  readonly nextRetransmitAtMs?: number;
  readonly accepted: number;
  readonly retransmissions: number;
}
export interface OspfP2pExchangeSession {
  readonly formatId: typeof OSPF_EXCHANGE_FORMAT;
  readonly schemaVersion: typeof OSPF_EXCHANGE_VERSION;
  readonly dd: OspfP2pDdSession;
  readonly rxmtIntervalMs: number;
  readonly exchange?: OspfP2pExchangeRecord;
}
export interface OspfP2pExchangeTrace {
  readonly kind:
    | "DD_NEW_TX_INTENT" | "DD_RETRANSMIT_INTENT"
    | "DD_DUPLICATE_IGNORED" | "DD_DUPLICATE_REPLY_INTENT"
    | "DD_SEQUENCE_MISMATCH_RESET";
  readonly atMs: number;
  readonly source: typeof SOURCE;
  readonly sequence: number;
  readonly role: OspfP2pDdRole;
}
export type OspfP2pExchangeEvent = OspfP2pTrace | OspfP2pDdTrace | OspfP2pExchangeTrace;
export type OspfP2pExchangeResult =
  | { readonly ok: true; readonly session: OspfP2pExchangeSession; readonly events: readonly OspfP2pExchangeEvent[] }
  | { readonly ok: false; readonly session: OspfP2pExchangeSession; readonly code: string; readonly message: string };

const uint32 = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= UINT32_MAX;
const safeMs = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const byte = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
const validMtu = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 68 && value <= 65535;
function validInterval(value: unknown): value is number {
  return safeMs(value) && value >= 1000 && value <= 60000 && value % 1000 === 0;
}
function validPacket(packet: OspfP2pDdObservation): boolean {
  return packet !== null && typeof packet === "object"
    && safeMs(packet.atMs) && typeof packet.senderRouterId === "string"
    && typeof packet.areaId === "string" && validMtu(packet.interfaceMtu)
    && byte(packet.options) && typeof packet.init === "boolean"
    && typeof packet.more === "boolean" && typeof packet.master === "boolean"
    && uint32(packet.ddSequence) && packet.ddSequence > 0
    && uint32(packet.lsaHeaderCount) && packet.lsaHeaderCount <= 1024;
}
function copyPacket(packet: OspfP2pDdObservation): OspfP2pDdObservation {
  return {
    atMs: packet.atMs, senderRouterId: packet.senderRouterId, areaId: packet.areaId,
    interfaceMtu: packet.interfaceMtu, options: packet.options,
    init: packet.init, more: packet.more, master: packet.master,
    ddSequence: packet.ddSequence, lsaHeaderCount: packet.lsaHeaderCount,
  };
}
function fail(session: OspfP2pExchangeSession, code: string): OspfP2pExchangeResult {
  return { ok: false, session, code, message: code };
}
function event(
  kind: OspfP2pExchangeTrace["kind"], atMs: number,
  role: OspfP2pDdRole, sequence: number,
): OspfP2pExchangeTrace {
  return { kind, atMs, role, sequence, source: SOURCE };
}
function withoutExchange(session: OspfP2pExchangeSession, dd: OspfP2pDdSession): OspfP2pExchangeSession {
  return {
    formatId: session.formatId, schemaVersion: session.schemaVersion,
    dd, rxmtIntervalMs: session.rxmtIntervalMs,
  };
}
function sameDdFields(left: OspfP2pDdObservation, right: OspfP2pDdObservation): boolean {
  // Exactly RFC 2328 §10.6's duplicate tuple; timestamp/MTU are not part of it.
  return left.init === right.init && left.more === right.more
    && left.master === right.master && left.options === right.options
    && left.ddSequence === right.ddSequence;
}
/** Reject corrupt, stale, foreign or inconsistent restored Exchange snapshots. */
export function inspectOspfP2pExchangeSession(
  session: OspfP2pExchangeSession, state: EngineState,
): string | null {
  if (!session || session.formatId !== OSPF_EXCHANGE_FORMAT
    || session.schemaVersion !== OSPF_EXCHANGE_VERSION
    || !validInterval(session.rxmtIntervalMs) || !session.dd) return "OSPF_EXCHANGE_SESSION_INVALID";
  const ddError = inspectOspfP2pDdSession(session.dd, state);
  if (ddError) return ddError;
  if (session.dd.phase !== "EXCHANGE") {
    return session.exchange === undefined ? null : "OSPF_EXCHANGE_STATE_INVALID";
  }
  const negotiated = session.dd.negotiated;
  const value = session.exchange;
  if (!negotiated || !value
    || value.role !== negotiated.role || !uint32(value.sequence) || value.sequence === 0
    || !byte(value.options) || value.options !== negotiated.observation.options
    || !uint32(value.accepted) || value.accepted > OSPF_EXCHANGE_MAX_ACCEPTED
    || !uint32(value.retransmissions) || value.retransmissions > OSPF_EXCHANGE_MAX_RETRANSMITS
    || !validPacket(value.lastReceived)
    || value.lastReceived.lsaHeaderCount !== 0
    || value.lastReceived.senderRouterId !== session.dd.hello.config.remoteRouterId
    || value.lastReceived.areaId !== session.dd.hello.config.areaId
    || value.lastReceived.options !== value.options
    || value.lastReceived.interfaceMtu > session.dd.localInterfaceMtu
    || value.lastReceived.atMs > session.dd.hello.clock.nowMs
    || !value.lastSent || !uint32(value.lastSent.sequence)
    || value.lastSent.sequence !== value.sequence || !safeMs(value.lastSent.atMs)
    || value.lastSent.atMs > session.dd.hello.clock.nowMs
    || (session.dd.hello.deadAtMs !== undefined
      && (value.lastReceived.atMs >= session.dd.hello.deadAtMs
        || value.lastSent.atMs >= session.dd.hello.deadAtMs))) {
    return "OSPF_EXCHANGE_LEDGER_INVALID";
  }
  const initial = negotiated.agreedSequence;
  if (value.role === "MASTER") {
    if (initial + 1 + value.accepted !== value.sequence || value.lastReceived.ddSequence !== value.sequence - 1
      || !safeMs(value.nextRetransmitAtMs)
      || value.nextRetransmitAtMs !== value.lastSent.atMs + session.rxmtIntervalMs
      || value.nextRetransmitAtMs <= value.lastSent.atMs) return "OSPF_EXCHANGE_LEDGER_INVALID";
  } else if (value.role === "SLAVE") {
    if (initial + value.accepted !== value.sequence
      || value.lastReceived.ddSequence !== value.sequence
      || value.nextRetransmitAtMs !== undefined
      || value.retransmissions !== 0) return "OSPF_EXCHANGE_LEDGER_INVALID";
  } else return "OSPF_EXCHANGE_LEDGER_INVALID";
  return null;
}
export function createOspfP2pExchangeSession(
  state: EngineState, config: OspfP2pExchangeConfig,
): OspfP2pExchangeSession {
  if (!config || !validInterval(config.rxmtIntervalMs)) throw Error("OSPF_EXCHANGE_CONFIG_INVALID");
  const { rxmtIntervalMs, ...ddConfig } = config;
  return {
    formatId: OSPF_EXCHANGE_FORMAT, schemaVersion: OSPF_EXCHANGE_VERSION,
    dd: createOspfP2pDdSession(state, ddConfig), rxmtIntervalMs,
  };
}
function transitionFromDd(
  previous: OspfP2pExchangeSession, dd: OspfP2pDdSession,
): OspfP2pExchangeSession {
  if (dd.phase !== "EXCHANGE" || previous.exchange === undefined) return withoutExchange(previous, dd);
  return { ...previous, dd };
}
/** Virtual time only. Master retransmits last outstanding intent on RxmtInterval;
 * slave never runs a retransmit clock. A Dead timer takes precedence on ties.
 */
export function advanceOspfP2pExchangeSession(
  session: OspfP2pExchangeSession, state: EngineState, untilMs: number,
): OspfP2pExchangeResult {
  const bad = inspectOspfP2pExchangeSession(session, state);
  if (bad) return fail(session, bad);
  if (!safeMs(untilMs) || untilMs < session.dd.hello.clock.nowMs) return fail(session, "OSPF_EXCHANGE_TIME_INVALID");
  let current = session;
  const events: OspfP2pExchangeEvent[] = [];
  let count = 0;
  while (current.exchange?.role === "MASTER"
    && current.exchange.nextRetransmitAtMs !== undefined
    && current.exchange.nextRetransmitAtMs <= untilMs) {
    if (count >= OSPF_EXCHANGE_MAX_ADVANCE_RETRANSMITS) return fail(session, "OSPF_EXCHANGE_ADVANCE_LIMIT");
    if (current.exchange.retransmissions >= OSPF_EXCHANGE_MAX_RETRANSMITS) {
      return fail(session, "OSPF_EXCHANGE_RETRANSMIT_LIMIT");
    }
    const deadline = current.exchange.nextRetransmitAtMs;
    const progress = advanceOspfP2pDdSession(current.dd, state, deadline);
    if (!progress.ok) return fail(session, progress.code);
    events.push(...progress.events);
    if (progress.session.phase !== "EXCHANGE") {
      current = withoutExchange(current, progress.session);
      break;
    }
    const next = deadline + current.rxmtIntervalMs;
    if (!safeMs(next)) return fail(session, "OSPF_EXCHANGE_TIME_OVERFLOW");
    const exchange: OspfP2pExchangeRecord = {
      ...current.exchange,
      lastSent: { sequence: current.exchange.sequence, atMs: deadline },
      nextRetransmitAtMs: next,
      retransmissions: current.exchange.retransmissions + 1,
    };
    events.push(event("DD_RETRANSMIT_INTENT", deadline, exchange.role, exchange.sequence));
    current = { ...current, dd: progress.session, exchange };
    count += 1;
  }
  const final = advanceOspfP2pDdSession(current.dd, state, untilMs);
  if (!final.ok) return fail(session, final.code);
  events.push(...final.events);
  current = transitionFromDd(current, final.session);
  const post = inspectOspfP2pExchangeSession(current, state);
  return post ? fail(session, post) : { ok: true, session: current, events };
}
export function receiveOspfP2pExchangeHello(
  session: OspfP2pExchangeSession, state: EngineState, hello: OspfP2pHelloObservation,
): OspfP2pExchangeResult {
  const bad = inspectOspfP2pExchangeSession(session, state);
  if (bad) return fail(session, bad);
  // Advance all protocol timers at the same virtual timestamp first.
  if (!hello || !safeMs(hello.atMs) || hello.atMs < session.dd.hello.clock.nowMs)
    return fail(session, "OSPF_EXCHANGE_TIME_INVALID");
  const advanced = advanceOspfP2pExchangeSession(session, state, hello.atMs);
  if (!advanced.ok) return advanced;
  const received = receiveOspfP2pDdHello(advanced.session.dd, state, hello);
  if (!received.ok) return fail(session, received.code);
  const next = transitionFromDd(advanced.session, received.session);
  const post = inspectOspfP2pExchangeSession(next, state);
  return post ? fail(session, post) : { ok: true, session: next, events: [...advanced.events, ...received.events] };
}
/** Model only empty DD headers. Unsupported LSAs fail closed instead of inventing LSDB truth. */
export function receiveOspfP2pExchangeDescription(
  session: OspfP2pExchangeSession, state: EngineState, packet: OspfP2pDdObservation,
): OspfP2pExchangeResult {
  const invalid = inspectOspfP2pExchangeSession(session, state);
  if (invalid) return fail(session, invalid);
  if (!validPacket(packet) || packet.atMs < session.dd.hello.clock.nowMs)
    return fail(session, "OSPF_EXCHANGE_PACKET_INVALID");
  if (packet.senderRouterId !== session.dd.hello.config.remoteRouterId
    || packet.areaId !== session.dd.hello.config.areaId)
    return fail(session, "OSPF_EXCHANGE_PACKET_MISMATCH");
  if (packet.interfaceMtu > session.dd.localInterfaceMtu) return fail(session, "OSPF_EXCHANGE_MTU_REJECTED");
  if (packet.lsaHeaderCount !== 0) return fail(session, "OSPF_EXCHANGE_LSA_HEADERS_UNMODELED");
  const advanced = advanceOspfP2pExchangeSession(session, state, packet.atMs);
  if (!advanced.ok) return fail(session, advanced.code);
  if (advanced.session.dd.phase === "IDLE") return fail(session, "OSPF_EXCHANGE_NEIGHBOR_NOT_READY");
  if (advanced.session.dd.phase === "EXSTART") {
    const accepted = receiveOspfP2pDdDescription(advanced.session.dd, state, packet);
    if (!accepted.ok) return fail(session, accepted.code);
    const agreement = accepted.session.negotiated!;
    const role = agreement.role;
    const firstSequence = agreement.agreedSequence + (role === "MASTER" ? 1 : 0);
    const nextRetransmit = packet.atMs + advanced.session.rxmtIntervalMs;
    if (!uint32(firstSequence) || !safeMs(nextRetransmit))
      return fail(session, "OSPF_EXCHANGE_SEQUENCE_OVERFLOW");
    const exchange: OspfP2pExchangeRecord = {
      role, sequence: firstSequence, options: packet.options,
      lastReceived: copyPacket(packet),
      lastSent: { sequence: firstSequence, atMs: packet.atMs },
      ...(role === "MASTER" ? { nextRetransmitAtMs: nextRetransmit } : {}),
      accepted: 0, retransmissions: 0,
    };
    const next = { ...advanced.session, dd: accepted.session, exchange };
    const post = inspectOspfP2pExchangeSession(next, state);
    return post ? fail(session, post) : {
      ok: true, session: next,
      events: [...advanced.events, ...accepted.events, event("DD_NEW_TX_INTENT", packet.atMs, role, firstSequence)],
    };
  }
  const old = advanced.session.exchange;
  if (!old) return fail(session, "OSPF_EXCHANGE_STATE_INVALID");
  const events = [...advanced.events];
  if (sameDdFields(old.lastReceived, packet)) {
    events.push(event(
      old.role === "MASTER" ? "DD_DUPLICATE_IGNORED" : "DD_DUPLICATE_REPLY_INTENT",
      packet.atMs, old.role, old.lastSent.sequence,
    ));
    return { ok: true, session: advanced.session, events };
  }
  const expectedSequence = old.role === "MASTER" ? old.sequence : old.sequence + 1;
  const wrong = packet.init || packet.options !== old.options
    || packet.master !== (old.role === "SLAVE")
    || !uint32(expectedSequence) || packet.ddSequence !== expectedSequence;
  if (wrong) {
    // RFC SeqNumberMismatch: teardown and try ExStart again; no fake Full/route.
    const proposed = advanced.session.dd.initialDdSequence + 1;
    if (!uint32(proposed)) return fail(session, "OSPF_EXCHANGE_SEQUENCE_OVERFLOW");
    const { negotiated: _previous, ...rest } = advanced.session.dd;
    const restart: OspfP2pDdSession = { ...rest, phase: "EXSTART", initialDdSequence: proposed };
    const next = withoutExchange(advanced.session, restart);
    const post = inspectOspfP2pExchangeSession(next, state);
    return post ? fail(session, post) : {
      ok: true, session: next,
      events: [
        ...events, event("DD_SEQUENCE_MISMATCH_RESET", packet.atMs, old.role, old.sequence),
        { kind: "DD_INITIAL_TX_INTENT", atMs: packet.atMs, phase: "EXSTART", source: "SYNTHETIC_OSPFV2_P2P_DD_MODEL" },
      ],
    };
  }
  if (old.accepted >= OSPF_EXCHANGE_MAX_ACCEPTED) return fail(session, "OSPF_EXCHANGE_PACKET_LIMIT");
  const newSequence = old.role === "MASTER" ? old.sequence + 1 : packet.ddSequence;
  if (!uint32(newSequence) || !safeMs(packet.atMs + advanced.session.rxmtIntervalMs))
    return fail(session, "OSPF_EXCHANGE_SEQUENCE_OVERFLOW");
  const exchange: OspfP2pExchangeRecord = {
    ...old, sequence: newSequence,
    lastReceived: copyPacket(packet),
    lastSent: { sequence: newSequence, atMs: packet.atMs },
    ...(old.role === "MASTER" ? { nextRetransmitAtMs: packet.atMs + advanced.session.rxmtIntervalMs } : {}),
    accepted: old.accepted + 1,
  };
  const next: OspfP2pExchangeSession = { ...advanced.session, exchange };
  const post = inspectOspfP2pExchangeSession(next, state);
  return post ? fail(session, post) : {
    ok: true, session: next,
    events: [...events, event("DD_NEW_TX_INTENT", packet.atMs, old.role, newSequence)],
  };
}
