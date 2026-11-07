import type { EngineState } from "./types.js";
import {
  advanceOspfP2pSession, createOspfP2pSession, inspectOspfP2pSession,
  receiveOspfP2pHello,
} from "./ospf-p2p-hello.js";
import type {
  OspfP2pConfig, OspfP2pHelloObservation, OspfP2pSession, OspfP2pTrace,
} from "./ospf-p2p-hello.js";

/**
 * RFC 2328 §§10.1, 10.3, 10.6, 10.8: synthetic, already-admitted
 * P2P ExStart DD master/slave negotiation. No wire parsing or authentication.
 * EXCHANGE means NegotiationDone only; LSDB synchronization is UNMODELED.
 * No Engine writes, router forwarding changes, LSA flooding, or FULL state.
 */
export const OSPF_DD_FORMAT = "yadilab.engine.ospfv2-p2p-dd-exstart" as const;
export const OSPF_DD_VERSION = "1.0.0" as const;
const SOURCE = "SYNTHETIC_OSPFV2_P2P_DD_MODEL" as const;
const MAX_UINT32 = 0xffffffff;

export type OspfP2pDdPhase = "IDLE" | "EXSTART" | "EXCHANGE";
export type OspfP2pDdRole = "MASTER" | "SLAVE";
export interface OspfP2pDdConfig extends OspfP2pConfig {
  /** Unfragmented local receiving-interface IPv4 MTU in bytes. */
  readonly localInterfaceMtu: number;
  /** Explicit, deterministic initial DD sequence; never wall-clock/random. */
  readonly initialDdSequence: number;
}
/** Synthetic observation AFTER external OSPF packet admission, not wire data. */
export interface OspfP2pDdObservation {
  readonly atMs: number;
  readonly senderRouterId: string;
  readonly areaId: string;
  readonly interfaceMtu: number;
  readonly options: number;
  readonly init: boolean;
  readonly more: boolean;
  readonly master: boolean;
  readonly ddSequence: number;
  /** Only empty DD headers are supported in this bounded slice. */
  readonly lsaHeaderCount: number;
}
export interface OspfP2pDdReceipt {
  readonly observation: OspfP2pDdObservation;
  readonly role: OspfP2pDdRole;
  readonly agreedSequence: number;
}
export interface OspfP2pDdTrace {
  readonly kind: "DD_INITIAL_TX_INTENT" | "DD_NEGOTIATION_DONE";
  readonly atMs: number;
  readonly phase: "EXSTART" | "EXCHANGE";
  readonly source: typeof SOURCE;
  readonly role?: OspfP2pDdRole;
  readonly agreedSequence?: number;
}
export interface OspfP2pDdSession {
  readonly formatId: typeof OSPF_DD_FORMAT;
  readonly schemaVersion: typeof OSPF_DD_VERSION;
  readonly hello: OspfP2pSession;
  readonly localInterfaceMtu: number;
  readonly initialDdSequence: number;
  readonly phase: OspfP2pDdPhase;
  readonly negotiated?: OspfP2pDdReceipt;
}
export type OspfP2pDdResult =
  | { readonly ok: true; readonly session: OspfP2pDdSession; readonly events: readonly (OspfP2pTrace | OspfP2pDdTrace)[] }
  | { readonly ok: false; readonly session: OspfP2pDdSession; readonly code: string; readonly message: string };

const uint32 = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_UINT32;
const milliseconds = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const mtu = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 68 && n <= 65535;
const byte = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255;
const denied = (session: OspfP2pDdSession, code: string): OspfP2pDdResult =>
  ({ ok: false, session, code, message: code });

function routerIdComparison(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 4; i += 1) {
    if (left[i]! !== right[i]!) return left[i]! < right[i]! ? -1 : 1;
  }
  return 0;
}
function validObservation(packet: OspfP2pDdObservation): boolean {
  return packet !== null && typeof packet === "object"
    && milliseconds(packet.atMs)
    && typeof packet.senderRouterId === "string"
    && typeof packet.areaId === "string"
    && mtu(packet.interfaceMtu) && byte(packet.options)
    && typeof packet.init === "boolean" && typeof packet.more === "boolean"
    && typeof packet.master === "boolean" && uint32(packet.ddSequence)
    && packet.ddSequence > 0
    && uint32(packet.lsaHeaderCount) && packet.lsaHeaderCount <= 1024;
}
/** Return role + DD sequence only for the two explicit RFC ExStart cases. */
function negotiatedRole(
  session: OspfP2pDdSession, packet: OspfP2pDdObservation,
): { role: OspfP2pDdRole; agreedSequence: number } | null {
  const order = routerIdComparison(session.hello.config.remoteRouterId, session.hello.config.localRouterId);
  if (order > 0 && packet.init && packet.more && packet.master && packet.lsaHeaderCount === 0) {
    return { role: "SLAVE", agreedSequence: packet.ddSequence };
  }
  if (order < 0 && !packet.init && !packet.master && packet.lsaHeaderCount === 0
    && packet.ddSequence === session.initialDdSequence) {
    return { role: "MASTER", agreedSequence: session.initialDdSequence };
  }
  return null;
}
/** Checks source, Hello timer ownership, and receipt-state consistency. */
export function inspectOspfP2pDdSession(session: OspfP2pDdSession, state: EngineState): string | null {
  if (!session || session.formatId !== OSPF_DD_FORMAT || session.schemaVersion !== OSPF_DD_VERSION
    || !session.hello || !mtu(session.localInterfaceMtu)
    || !uint32(session.initialDdSequence) || session.initialDdSequence === 0
    || !["IDLE", "EXSTART", "EXCHANGE"].includes(session.phase)) return "OSPF_DD_SESSION_INVALID";
  const parentProblem = inspectOspfP2pSession(session.hello, state);
  if (parentProblem) return parentProblem;
  if (session.phase === "IDLE") {
    return session.hello.neighborState === "EXSTART" || session.negotiated !== undefined
      ? "OSPF_DD_STATE_INVALID" : null;
  }
  if (session.hello.neighborState !== "EXSTART") return "OSPF_DD_STATE_INVALID";
  if (session.phase === "EXSTART") {
    return session.negotiated === undefined ? null : "OSPF_DD_STATE_INVALID";
  }
  const receipt = session.negotiated;
  if (!receipt || !validObservation(receipt.observation)) return "OSPF_DD_RECEIPT_INVALID";
  const p = receipt.observation;
  if (p.senderRouterId !== session.hello.config.remoteRouterId
    || p.areaId !== session.hello.config.areaId
    || p.interfaceMtu > session.localInterfaceMtu
    || p.atMs > session.hello.clock.nowMs
    || (session.hello.deadAtMs !== undefined && p.atMs >= session.hello.deadAtMs)) {
    return "OSPF_DD_RECEIPT_INVALID";
  }
  const expected = negotiatedRole(session, p);
  if (!expected || expected.role !== receipt.role || expected.agreedSequence !== receipt.agreedSequence) {
    return "OSPF_DD_RECEIPT_INVALID";
  }
  return null;
}

export function createOspfP2pDdSession(state: EngineState, config: OspfP2pDdConfig): OspfP2pDdSession {
  if (!config || !mtu(config.localInterfaceMtu)
    || !uint32(config.initialDdSequence) || config.initialDdSequence === 0) {
    throw new Error("OSPF_DD_CONFIG_INVALID");
  }
  const { localInterfaceMtu, initialDdSequence, ...helloConfig } = config;
  const session: OspfP2pDdSession = {
    formatId: OSPF_DD_FORMAT, schemaVersion: OSPF_DD_VERSION,
    hello: createOspfP2pSession(state, helloConfig),
    localInterfaceMtu, initialDdSequence, phase: "IDLE",
  };
  const error = inspectOspfP2pDdSession(session, state);
  if (error) throw new Error(error);
  return session;
}
function promote(
  old: OspfP2pDdSession, parent: OspfP2pSession,
  events: readonly OspfP2pTrace[],
): { session: OspfP2pDdSession; events: readonly (OspfP2pTrace | OspfP2pDdTrace)[] } {
  const expired = events.some((e) => e.kind === "INACTIVITY_EXPIRED");
  const keepExchange = old.phase === "EXCHANGE" && !expired && parent.neighborState === "EXSTART";
  const phase: OspfP2pDdPhase = parent.neighborState !== "EXSTART"
    ? "IDLE" : keepExchange ? "EXCHANGE" : "EXSTART";
  const retainReceipt = keepExchange && old.negotiated !== undefined;
  const session: OspfP2pDdSession = {
    ...old, hello: parent, phase,
    ...(retainReceipt ? { negotiated: old.negotiated } : {}),
  };
  if (!retainReceipt) {
    // Spreading the old value above would preserve an invalid stale DD receipt.
    const { negotiated: _unused, ...reset } = session;
    const intent: OspfP2pDdTrace[] = phase === "EXSTART" && (old.phase !== "EXSTART" || expired)
      ? [{ kind: "DD_INITIAL_TX_INTENT", atMs: parent.clock.nowMs, phase: "EXSTART", source: SOURCE }]
      : [];
    return { session: reset, events: [...events, ...intent] };
  }
  return { session, events };
}
export function advanceOspfP2pDdSession(
  session: OspfP2pDdSession, state: EngineState, untilMs: number,
): OspfP2pDdResult {
  const invalid = inspectOspfP2pDdSession(session, state);
  if (invalid) return denied(session, invalid);
  const result = advanceOspfP2pSession(session.hello, state, untilMs);
  if (!result.ok) return denied(session, result.code);
  const changed = promote(session, result.session, result.events);
  const error = inspectOspfP2pDdSession(changed.session, state);
  return error ? denied(session, error) : { ok: true, ...changed };
}
export function receiveOspfP2pDdHello(
  session: OspfP2pDdSession, state: EngineState, packet: OspfP2pHelloObservation,
): OspfP2pDdResult {
  const invalid = inspectOspfP2pDdSession(session, state);
  if (invalid) return denied(session, invalid);
  const result = receiveOspfP2pHello(session.hello, state, packet);
  if (!result.ok) return denied(session, result.code);
  const changed = promote(session, result.session, result.events);
  const error = inspectOspfP2pDdSession(changed.session, state);
  return error ? denied(session, error) : { ok: true, ...changed };
}
/**
 * Accepts only negotiation-completing synthetic DD observations in ExStart.
 * Once Exchange is reached, DD summaries/LSDB synchronization are unsupported.
 */
export function receiveOspfP2pDdDescription(
  session: OspfP2pDdSession, state: EngineState, packet: OspfP2pDdObservation,
): OspfP2pDdResult {
  const invalid = inspectOspfP2pDdSession(session, state);
  if (invalid) return denied(session, invalid);
  if (!validObservation(packet) || packet.atMs < session.hello.clock.nowMs) {
    return denied(session, "OSPF_DD_PACKET_INVALID");
  }
  if (packet.senderRouterId !== session.hello.config.remoteRouterId
    || packet.areaId !== session.hello.config.areaId) return denied(session, "OSPF_DD_PACKET_MISMATCH");
  if (packet.interfaceMtu > session.localInterfaceMtu) return denied(session, "OSPF_DD_MTU_REJECTED");
  if (packet.lsaHeaderCount !== 0) return denied(session, "OSPF_DD_HEADERS_UNMODELED");
  const advanced = advanceOspfP2pDdSession(session, state, packet.atMs);
  if (!advanced.ok) return denied(session, advanced.code);
  if (advanced.session.phase === "IDLE") return denied(session, "OSPF_DD_NEIGHBOR_NOT_READY");
  if (advanced.session.phase === "EXCHANGE") return denied(session, "OSPF_DD_EXCHANGE_UNMODELED");
  const accepted = negotiatedRole(advanced.session, packet);
  if (!accepted) return denied(session, "OSPF_DD_NEGOTIATION_NOT_MATCHED");
  const negotiated: OspfP2pDdReceipt = {
    observation: {
      atMs: packet.atMs, senderRouterId: packet.senderRouterId, areaId: packet.areaId,
      interfaceMtu: packet.interfaceMtu, options: packet.options,
      init: packet.init, more: packet.more, master: packet.master,
      ddSequence: packet.ddSequence, lsaHeaderCount: packet.lsaHeaderCount,
    },
    ...accepted,
  };
  const next: OspfP2pDdSession = { ...advanced.session, phase: "EXCHANGE", negotiated };
  const error = inspectOspfP2pDdSession(next, state);
  if (error) return denied(session, error);
  return {
    ok: true, session: next,
    events: [...advanced.events, {
      kind: "DD_NEGOTIATION_DONE", atMs: packet.atMs, phase: "EXCHANGE", source: SOURCE,
      role: accepted.role, agreedSequence: accepted.agreedSequence,
    }],
  };
}
