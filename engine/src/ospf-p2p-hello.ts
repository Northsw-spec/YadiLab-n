import type { EngineState } from "./types.js";
import {
  advanceSimulationEventPlan, cancelSimulationEvent, createSimulationEventPlan,
  inspectSimulationEventPlan, scheduleSimulationEvent,
} from "./simulation-clock.js";
import type { SimulationEventPlan, ScheduledSimulationEvent } from "./simulation-clock.js";

/**
 * RFC 2328 §§9.5, 10.2-10.5: a deliberately bounded, synthetic OSPFv2
 * point-to-point Hello/neighbor-inactivity model. No raw packet admission,
 * authentication, DD exchange, LSDB, SPF, route installation or Engine writes.
 * EXSTART denotes adjacency *attempt*, never a FULL adjacency.
 */
export const OSPF_P2P_FORMAT = "yadilab.engine.ospfv2-p2p-hello" as const;
export const OSPF_P2P_VERSION = "1.0.0" as const;
export const OSPF_P2P_MAX_EVENTS = 2048 as const;
export const OSPF_P2P_MAX_ADVANCE_EVENTS = 512 as const;
const HELLO_KIND = "OSPF_HELLO_TX";
const DEAD_KIND = "OSPF_NEIGHBOR_DEAD";
const ORIGIN = "SYNTHETIC_OSPFV2_P2P_MODEL" as const;

export type OspfP2pNeighborState = "DOWN" | "INIT" | "EXSTART";
export type OspfP2pTraceKind = "HELLO_TX_INTENT" | "HELLO_RX_ACCEPTED" | "INACTIVITY_EXPIRED";
export interface OspfP2pConfig {
  readonly localResourceId: string;
  readonly remoteResourceId: string;
  readonly localRouterId: string;
  readonly remoteRouterId: string;
  readonly areaId: string;
  readonly helloIntervalMs: number;
  readonly deadIntervalMs: number;
}
export interface OspfP2pHelloObservation {
  readonly atMs: number;
  readonly senderRouterId: string;
  readonly areaId: string;
  readonly helloIntervalMs: number;
  readonly deadIntervalMs: number;
  readonly seenRouterIds: readonly string[];
}
export interface OspfP2pTrace {
  readonly kind: OspfP2pTraceKind;
  readonly atMs: number;
  readonly neighborState: OspfP2pNeighborState;
  readonly source: typeof ORIGIN;
  readonly eventId?: string;
}
export interface OspfP2pSession {
  readonly formatId: typeof OSPF_P2P_FORMAT;
  readonly schemaVersion: typeof OSPF_P2P_VERSION;
  readonly config: OspfP2pConfig;
  readonly clock: SimulationEventPlan;
  readonly neighborState: OspfP2pNeighborState;
  readonly nextHelloOrdinal: number;
  readonly nextDeadOrdinal: number;
  readonly lastHelloAtMs?: number;
  readonly deadAtMs?: number;
}
export type OspfP2pResult =
  | { readonly ok: true; readonly session: OspfP2pSession; readonly events: readonly OspfP2pTrace[] }
  | { readonly ok: false; readonly session: OspfP2pSession; readonly code: string; readonly message: string };

function safe(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
}
function fail(session: OspfP2pSession, code: string): OspfP2pResult {
  return { ok: false, session, code, message: code };
}
function ip4(s: unknown, allowZero: boolean): s is string {
  if (typeof s !== "string" || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(s)) return false;
  const octets = s.split(".").map(Number);
  return octets.every((x) => Number.isInteger(x) && x <= 255)
    && (allowZero || octets.some((x) => x !== 0));
}
function configValid(config: OspfP2pConfig, state: EngineState): boolean {
  if (!config || typeof config.localResourceId !== "string" || typeof config.remoteResourceId !== "string"
    || !Object.prototype.hasOwnProperty.call(state.resources ?? {}, config.localResourceId)
    || !Object.prototype.hasOwnProperty.call(state.resources ?? {}, config.remoteResourceId)
    || config.localResourceId === config.remoteResourceId
    || state.resources[config.localResourceId]?.type !== "network.router"
    || state.resources[config.remoteResourceId]?.type !== "network.router"
    || !ip4(config.localRouterId, false) || !ip4(config.remoteRouterId, false)
    || config.localRouterId === config.remoteRouterId || !ip4(config.areaId, true)
    || !safe(config.helloIntervalMs) || config.helloIntervalMs < 1000
    || config.helloIntervalMs % 1000 !== 0
    || !safe(config.deadIntervalMs) || config.deadIntervalMs <= config.helloIntervalMs
    || config.deadIntervalMs % 1000 !== 0) return false;
  return true;
}
function isHelloEvent(event: ScheduledSimulationEvent, session: OspfP2pSession): boolean {
  return event.kind === HELLO_KIND && event.targetResourceId === session.config.localResourceId
    && event.eventId === "ospf.hello." + (session.nextHelloOrdinal - 1);
}
function isDeadEvent(event: ScheduledSimulationEvent, session: OspfP2pSession): boolean {
  return event.kind === DEAD_KIND && event.targetResourceId === session.config.remoteResourceId
    && event.eventId === "ospf.dead." + (session.nextDeadOrdinal - 1)
    && event.atMs === session.deadAtMs;
}
/** Verify source, counters, state/timer ownership and the scheduler's actual queue. */
export function inspectOspfP2pSession(session: OspfP2pSession, state: EngineState): string | null {
  if (!session || session.formatId !== OSPF_P2P_FORMAT || session.schemaVersion !== OSPF_P2P_VERSION
    || !session.clock || !configValid(session.config, state)) return "OSPF_P2P_SESSION_INVALID";
  const mismatch = inspectSimulationEventPlan(session.clock, state);
  if (mismatch) return mismatch;
  if (!safe(session.nextHelloOrdinal) || session.nextHelloOrdinal < 1
    || !safe(session.nextDeadOrdinal)
    || session.clock.nextSequence > OSPF_P2P_MAX_EVENTS
    || !["DOWN","INIT","EXSTART"].includes(session.neighborState)) return "OSPF_P2P_SESSION_INVALID";
  const hello = session.clock.pending.filter((e) => e.kind === HELLO_KIND);
  const dead = session.clock.pending.filter((e) => e.kind === DEAD_KIND);
  if (hello.length !== 1 || dead.length > 1 || session.clock.pending.length !== hello.length + dead.length
    || !isHelloEvent(hello[0]!, session)) return "OSPF_P2P_TIMER_OWNERSHIP_INVALID";
  if (session.neighborState === "DOWN") {
    if (dead.length !== 0 || session.lastHelloAtMs !== undefined || session.deadAtMs !== undefined) {
      return "OSPF_P2P_TIMER_OWNERSHIP_INVALID";
    }
  } else if (dead.length !== 1 || !isDeadEvent(dead[0]!, session)
    || !safe(session.lastHelloAtMs) || !safe(session.deadAtMs)
    || session.lastHelloAtMs > session.clock.nowMs
    || session.deadAtMs !== session.lastHelloAtMs + session.config.deadIntervalMs) {
    return "OSPF_P2P_TIMER_OWNERSHIP_INVALID";
  }
  return null;
}
export function createOspfP2pSession(state: EngineState, config: OspfP2pConfig): OspfP2pSession {
  if (!configValid(config, state)) throw new Error("OSPF_P2P_CONFIG_INVALID");
  const clock = createSimulationEventPlan(state);
  const first = scheduleSimulationEvent(clock, state, {
    eventId: "ospf.hello.0", kind: HELLO_KIND, atMs: 0, targetResourceId: config.localResourceId,
  });
  if (!first.ok) throw new Error(first.code);
  const session: OspfP2pSession = {
    formatId: OSPF_P2P_FORMAT, schemaVersion: OSPF_P2P_VERSION, config,
    clock: first.plan, neighborState: "DOWN", nextHelloOrdinal: 1, nextDeadOrdinal: 0,
  };
  const error = inspectOspfP2pSession(session, state);
  if (error) throw new Error(error);
  return session;
}
function eventLimit(session: OspfP2pSession): boolean {
  return session.clock.nextSequence >= OSPF_P2P_MAX_EVENTS;
}
function trace(kind: OspfP2pTraceKind, atMs: number, neighborState: OspfP2pNeighborState, eventId?: string): OspfP2pTrace {
  return { kind, atMs, neighborState, source: ORIGIN, ...(eventId === undefined ? {} : { eventId }) };
}
export function advanceOspfP2pSession(
  session: OspfP2pSession, state: EngineState, untilMs: number,
): OspfP2pResult {
  const invalid = inspectOspfP2pSession(session, state);
  if (invalid) return fail(session, invalid);
  if (!safe(untilMs) || untilMs < session.clock.nowMs) return fail(session, "OSPF_P2P_TIME_INVALID");
  let current = session;
  const events: OspfP2pTrace[] = [];
  let processed = 0;
  while (current.clock.pending.length && current.clock.pending[0]!.atMs <= untilMs) {
    if (processed >= OSPF_P2P_MAX_ADVANCE_EVENTS) return fail(session, "OSPF_P2P_ADVANCE_LIMIT");
    const atMs = current.clock.pending[0]!.atMs;
    const advancement = advanceSimulationEventPlan(current.clock, state, atMs);
    if (!advancement.ok) return fail(session, advancement.code);
    current = { ...current, clock: advancement.plan };
    for (const fired of advancement.dispatched) {
      processed += 1;
      if (processed > OSPF_P2P_MAX_ADVANCE_EVENTS) return fail(session, "OSPF_P2P_ADVANCE_LIMIT");
      if (fired.kind === HELLO_KIND && isHelloEvent(fired, current)) {
        const nextMs = atMs + current.config.helloIntervalMs;
        if (!safe(nextMs)) return fail(session, "OSPF_P2P_TIME_OVERFLOW");
        if (eventLimit(current)) return fail(session, "OSPF_P2P_EVENT_LIMIT");
        const scheduled = scheduleSimulationEvent(current.clock, state, {
          eventId: "ospf.hello." + current.nextHelloOrdinal,
          kind: HELLO_KIND, atMs: nextMs, targetResourceId: current.config.localResourceId,
        });
        if (!scheduled.ok) return fail(session, scheduled.code);
        current = { ...current, clock: scheduled.plan, nextHelloOrdinal: current.nextHelloOrdinal + 1 };
        events.push(trace("HELLO_TX_INTENT", atMs, current.neighborState, fired.eventId));
      } else if (fired.kind === DEAD_KIND && isDeadEvent(fired, current)) {
        const { lastHelloAtMs: _last, deadAtMs: _deadline, ...rest } = current;
        current = { ...rest, neighborState: "DOWN" };
        events.push(trace("INACTIVITY_EXPIRED", atMs, "DOWN", fired.eventId));
      } else {
        return fail(session, "OSPF_P2P_UNOWNED_EVENT");
      }
    }
  }
  const finalAdvance = advanceSimulationEventPlan(current.clock, state, untilMs);
  if (!finalAdvance.ok) return fail(session, finalAdvance.code);
  current = { ...current, clock: finalAdvance.plan };
  const finalProblem = inspectOspfP2pSession(current, state);
  if (finalProblem) return fail(session, finalProblem);
  return { ok: true, session: current, events };
}
/**
 * Explicit synthetic Hello input, NOT a packet decoder or authenticated wire
 * observation. Process timers through atMs first (dead timer wins a tie).
 * A Hello listing the local Router ID moves P2P Init to ExStart; database
 * negotiation and Full state are intentionally outside the model.
 */
export function receiveOspfP2pHello(
  session: OspfP2pSession, state: EngineState, hello: OspfP2pHelloObservation,
): OspfP2pResult {
  const invalid = inspectOspfP2pSession(session, state);
  if (invalid) return fail(session, invalid);
  if (!hello || !safe(hello.atMs) || hello.atMs < session.clock.nowMs
    || !Array.isArray(hello.seenRouterIds) || hello.seenRouterIds.length > 32
    || !hello.seenRouterIds.every((x) => ip4(x, false))
    || new Set(hello.seenRouterIds).size !== hello.seenRouterIds.length
    || !ip4(hello.senderRouterId, false) || !ip4(hello.areaId, true)
    || !safe(hello.helloIntervalMs) || !safe(hello.deadIntervalMs)) {
    return fail(session, "OSPF_P2P_HELLO_INVALID");
  }
  if (hello.senderRouterId !== session.config.remoteRouterId
    || hello.areaId !== session.config.areaId
    || hello.helloIntervalMs !== session.config.helloIntervalMs
    || hello.deadIntervalMs !== session.config.deadIntervalMs) {
    return fail(session, "OSPF_P2P_HELLO_MISMATCH");
  }
  const expiresAt = hello.atMs + session.config.deadIntervalMs;
  if (!safe(expiresAt)) return fail(session, "OSPF_P2P_TIME_OVERFLOW");
  const advanced = advanceOspfP2pSession(session, state, hello.atMs);
  if (!advanced.ok) return fail(session, advanced.code);
  let clock = advanced.session.clock;
  const previous = clock.pending.find((e) => e.kind === DEAD_KIND);
  if (previous) {
    const cancelled = cancelSimulationEvent(clock, state, previous.eventId);
    if (!cancelled.ok) return fail(session, cancelled.code);
    clock = cancelled.plan;
  }
  if (clock.nextSequence >= OSPF_P2P_MAX_EVENTS) return fail(session, "OSPF_P2P_EVENT_LIMIT");
  const deadEvent = scheduleSimulationEvent(clock, state, {
    eventId: "ospf.dead." + advanced.session.nextDeadOrdinal,
    kind: DEAD_KIND, atMs: expiresAt, targetResourceId: session.config.remoteResourceId,
  });
  if (!deadEvent.ok) return fail(session, deadEvent.code);
  const neighborState: OspfP2pNeighborState = hello.seenRouterIds.includes(session.config.localRouterId)
    ? "EXSTART" : "INIT";
  const next: OspfP2pSession = {
    ...advanced.session, clock: deadEvent.plan, neighborState,
    lastHelloAtMs: hello.atMs, deadAtMs: expiresAt,
    nextDeadOrdinal: advanced.session.nextDeadOrdinal + 1,
  };
  const nextError = inspectOspfP2pSession(next, state);
  if (nextError) return fail(session, nextError);
  return {
    ok: true, session: next,
    events: [...advanced.events, trace("HELLO_RX_ACCEPTED", hello.atMs, neighborState)],
  };
}
