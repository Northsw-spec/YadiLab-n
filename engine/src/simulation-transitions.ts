import type { EngineState } from "./types.js";
import { applyOperation } from "./state.js";
import { isRecord, jsonEqual } from "./json.js";
import {
  advanceSimulationEventPlan, cancelSimulationEvent, createSimulationEventPlan,
  inspectSimulationEventPlan, scheduleSimulationEvent, SIMULATION_EVENT_QUEUE_LIMIT,
} from "./simulation-clock.js";
import type { SimulationEventPlan } from "./simulation-clock.js";

/**
 * CONVERGENCE Dev.1b: transactional, source-bound Engine handoff.
 * Only a reserved simulation bookkeeping marker is written. No network
 * properties, routes, protocol state, or reachability truth are inferred.
 * This is not an OSPF protocol handler.
 */
export const SIMULATION_TRANSITION_FORMAT = "yadilab.engine.transition-handoff" as const;
export const SIMULATION_TRANSITION_VERSION = "1.0.0" as const;
export const SIMULATION_MARKER_KIND = "ENGINE_SIMULATION_MARKER" as const;
export const SIMULATION_MARKER_PROVENANCE = "ENGINE_SCHEDULED_MARKER" as const;
const MARKER_PATH = "properties.__yadilabSimulationEventMarker";
const MARKER_KEY = "__yadilabSimulationEventMarker";

export interface SimulationMarkerReceipt {
  readonly eventId: string;
  readonly eventSequence: number;
  readonly dueMs: number;
  readonly ownerResourceId: string;
  readonly revisionBefore: number;
  readonly revisionAfter: number;
  readonly provenance: typeof SIMULATION_MARKER_PROVENANCE;
}
export interface SimulationMarkerCancellation {
  readonly eventId: string;
  readonly eventSequence: number;
  readonly ownerResourceId: string;
  readonly cancelledAtMs: number;
}
export interface SimulationTransitionState {
  readonly formatId: typeof SIMULATION_TRANSITION_FORMAT;
  readonly schemaVersion: typeof SIMULATION_TRANSITION_VERSION;
  readonly originStateRevision: number;
  readonly clock: SimulationEventPlan;
  readonly applied: readonly SimulationMarkerReceipt[];
  readonly cancelled: readonly SimulationMarkerCancellation[];
}
export interface SimulationMarkerRequest {
  readonly eventId: string;
  readonly ownerResourceId: string;
  readonly atMs: number;
}
export type SimulationTransitionResult =
  | {
      readonly ok: true;
      readonly state: EngineState;
      readonly transition: SimulationTransitionState;
      readonly dispatched: readonly SimulationMarkerReceipt[];
    }
  | {
      readonly ok: false;
      readonly state: EngineState;
      readonly transition: SimulationTransitionState;
      readonly code: string;
      readonly message: string;
    };

function safeInteger(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
}
function fail(state: EngineState, transition: SimulationTransitionState, code: string): SimulationTransitionResult {
  return { ok: false, state, transition, code, message: code };
}
function receiptMarker(receipt: SimulationMarkerReceipt): Readonly<Record<string, unknown>> {
  return {
    formatId: "yadilab.engine.simulation-event-marker",
    schemaVersion: SIMULATION_TRANSITION_VERSION,
    eventId: receipt.eventId,
    sequence: receipt.eventSequence,
    atMs: receipt.dueMs,
    revision: receipt.revisionAfter,
    provenance: receipt.provenance,
  };
}
function markerValue(state: EngineState, target: string): unknown {
  return state.resources[target]?.properties?.[MARKER_KEY];
}
function eventIdentity(event: { readonly eventId: string; readonly eventSequence: number }): string {
  return event.eventId;
}

/** Strictly validate restored plans and Engine marker ownership before use. */
export function inspectSimulationTransitionState(transition: SimulationTransitionState, state: EngineState): string | null {
  if (!transition || transition.formatId !== SIMULATION_TRANSITION_FORMAT
    || transition.schemaVersion !== SIMULATION_TRANSITION_VERSION
    || !safeInteger(transition.originStateRevision)
    || !Array.isArray(transition.applied) || !Array.isArray(transition.cancelled)
    || !transition.clock) return "SIM_TRANSITION_FORMAT_INVALID";
  const sourceProblem = inspectSimulationEventPlan(transition.clock, state);
  if (sourceProblem) return sourceProblem;
  if (transition.applied.length + transition.cancelled.length + transition.clock.pending.length > SIMULATION_EVENT_QUEUE_LIMIT
    || transition.originStateRevision + transition.applied.length !== state.stateRevision
    || !Number.isSafeInteger(transition.originStateRevision + transition.applied.length)) return "SIM_TRANSITION_LEDGER_INVALID";

  const seenIds = new Set<string>();
  const seenSequences = new Set<number>();
  const accept = (eventId: unknown, sequence: unknown): boolean => {
    if (typeof eventId !== "string" || eventId.length === 0
      || !safeInteger(sequence) || sequence >= transition.clock.nextSequence
      || seenIds.has(eventId) || seenSequences.has(sequence)) return false;
    seenIds.add(eventId);
    seenSequences.add(sequence);
    return true;
  };
  const latestByOwner = new Map<string, SimulationMarkerReceipt>();
  let previousAtMs = 0;
  let previousSequence = -1;
  for (let i = 0; i < transition.applied.length; i += 1) {
    const receipt = transition.applied[i];
    if (!receipt || receipt.provenance !== SIMULATION_MARKER_PROVENANCE
      || !accept(receipt.eventId, receipt.eventSequence)
      || typeof receipt.ownerResourceId !== "string"
      || !Object.prototype.hasOwnProperty.call(state.resources, receipt.ownerResourceId)
      || !safeInteger(receipt.dueMs) || receipt.dueMs > transition.clock.nowMs
      || receipt.dueMs < previousAtMs
      || (receipt.dueMs === previousAtMs && receipt.eventSequence <= previousSequence)
      || receipt.revisionBefore !== transition.originStateRevision + i
      || receipt.revisionAfter !== transition.originStateRevision + i + 1) {
      return "SIM_TRANSITION_LEDGER_INVALID";
    }
    previousAtMs = receipt.dueMs;
    previousSequence = receipt.eventSequence;
    latestByOwner.set(receipt.ownerResourceId, receipt);
  }
  for (const cancelled of transition.cancelled) {
    if (!cancelled || !accept(cancelled.eventId, cancelled.eventSequence)
      || typeof cancelled.ownerResourceId !== "string"
      || !Object.prototype.hasOwnProperty.call(state.resources, cancelled.ownerResourceId)
      || !safeInteger(cancelled.cancelledAtMs) || cancelled.cancelledAtMs > transition.clock.nowMs) {
      return "SIM_TRANSITION_LEDGER_INVALID";
    }
  }
  for (const event of transition.clock.pending) {
    if (event.kind !== SIMULATION_MARKER_KIND || typeof event.targetResourceId !== "string"
      || !accept(event.eventId, event.sequence)) return "SIM_TRANSITION_UNOWNED_EVENT";
  }

  // A reserved state property must match the most recent Engine-owned receipt.
  // An arbitrary user/imported marker cannot be silently claimed as provenance.
  for (const [resourceId, resource] of Object.entries(state.resources)) {
    if (!resource || !isRecord(resource.properties)) return "SIM_TRANSITION_ENGINE_STATE_INVALID";
    const observed = markerValue(state, resourceId);
    const last = latestByOwner.get(resourceId);
    if (last) {
      if (!jsonEqual(observed, receiptMarker(last))) return "SIM_TRANSITION_MARKER_MISMATCH";
    } else if (observed !== undefined) {
      return "SIM_TRANSITION_RESERVED_FIELD_OCCUPIED";
    }
  }
  return null;
}

export function createSimulationTransitionState(state: EngineState): SimulationTransitionState {
  const transition: SimulationTransitionState = {
    formatId: SIMULATION_TRANSITION_FORMAT,
    schemaVersion: SIMULATION_TRANSITION_VERSION,
    originStateRevision: state.stateRevision,
    clock: createSimulationEventPlan(state),
    applied: [],
    cancelled: [],
  };
  const problem = inspectSimulationTransitionState(transition, state);
  if (problem) throw new Error(problem);
  return transition;
}

export function scheduleSimulationMarker(
  transition: SimulationTransitionState, state: EngineState, request: SimulationMarkerRequest,
): SimulationTransitionResult {
  const problem = inspectSimulationTransitionState(transition, state);
  if (problem) return fail(state, transition, problem);
  if (!request || typeof request.ownerResourceId !== "string"
    || !Object.prototype.hasOwnProperty.call(state.resources, request.ownerResourceId)) {
    return fail(state, transition, "SIM_TRANSITION_OWNER_INVALID");
  }
  if (transition.applied.some((x) => eventIdentity(x) === request.eventId)
    || transition.cancelled.some((x) => eventIdentity(x) === request.eventId)) {
    return fail(state, transition, "SIM_TRANSITION_EVENT_REUSED");
  }
  if (transition.applied.length + transition.cancelled.length + transition.clock.pending.length
    >= SIMULATION_EVENT_QUEUE_LIMIT) return fail(state, transition, "SIM_TRANSITION_LEDGER_LIMIT");
  const scheduled = scheduleSimulationEvent(transition.clock, state, {
    eventId: request.eventId, kind: SIMULATION_MARKER_KIND,
    atMs: request.atMs, targetResourceId: request.ownerResourceId,
  });
  if (!scheduled.ok) return fail(state, transition, scheduled.code);
  return {
    ok: true, state, transition: { ...transition, clock: scheduled.plan }, dispatched: [],
  };
}

export function cancelSimulationMarker(
  transition: SimulationTransitionState, state: EngineState, eventId: string, ownerResourceId: string,
): SimulationTransitionResult {
  const problem = inspectSimulationTransitionState(transition, state);
  if (problem) return fail(state, transition, problem);
  const pending = transition.clock.pending.find((x) => x.eventId === eventId);
  if (!pending) return fail(state, transition, "SIM_TRANSITION_EVENT_NOT_PENDING");
  if (pending.targetResourceId !== ownerResourceId) return fail(state, transition, "SIM_TRANSITION_OWNER_MISMATCH");
  const cancelled = cancelSimulationEvent(transition.clock, state, eventId);
  if (!cancelled.ok) return fail(state, transition, cancelled.code);
  const record: SimulationMarkerCancellation = {
    eventId: pending.eventId, eventSequence: pending.sequence,
    ownerResourceId, cancelledAtMs: transition.clock.nowMs,
  };
  return {
    ok: true, state,
    transition: { ...transition, clock: cancelled.plan, cancelled: [...transition.cancelled, record] },
    dispatched: [],
  };
}

export function advanceSimulationTransitions(
  transition: SimulationTransitionState, state: EngineState, untilMs: number,
): SimulationTransitionResult {
  const problem = inspectSimulationTransitionState(transition, state);
  if (problem) return fail(state, transition, problem);
  const advanced = advanceSimulationEventPlan(transition.clock, state, untilMs);
  if (!advanced.ok) return fail(state, transition, advanced.code);
  if (state.stateRevision + advanced.dispatched.length > Number.MAX_SAFE_INTEGER) {
    return fail(state, transition, "SIM_TRANSITION_REVISION_LIMIT");
  }
  let current = state;
  const dispatched: SimulationMarkerReceipt[] = [];
  for (const event of advanced.dispatched) {
    // The scheduler's own ordered event stream exclusively owns the handler.
    if (event.kind !== SIMULATION_MARKER_KIND || !event.targetResourceId) {
      return fail(state, transition, "SIM_TRANSITION_UNOWNED_EVENT");
    }
    const receipt: SimulationMarkerReceipt = {
      eventId: event.eventId, eventSequence: event.sequence, dueMs: event.atMs,
      ownerResourceId: event.targetResourceId, revisionBefore: current.stateRevision,
      revisionAfter: current.stateRevision + 1, provenance: SIMULATION_MARKER_PROVENANCE,
    };
    const applied = applyOperation(current, {
      op: "set", target: event.targetResourceId, path: MARKER_PATH, value: receiptMarker(receipt),
    });
    // Roll back the *entire* advance (clock and state) on any Engine failure.
    if (!applied.ok) return fail(state, transition, "SIM_TRANSITION_ENGINE_OPERATION_FAILED");
    current = applied.state;
    dispatched.push(receipt);
  }
  return {
    ok: true,
    state: current,
    transition: {
      ...transition,
      clock: { ...advanced.plan, baseStateRevision: current.stateRevision },
      applied: [...transition.applied, ...dispatched],
    },
    dispatched,
  };
}
