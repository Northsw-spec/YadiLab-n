import type { EngineState } from "./types.js";

/**
 * CONVERGENCE Dev.1: protocol-neutral, deterministic, *inert* event scheduler.
 * Dispatching a due event does NOT run a protocol, mutate EngineState, or
 * establish any network truth. Future Engine adapters must consume events
 * under a separate, explicitly verified state-revision transition contract.
 */
export const SIMULATION_EVENT_PLAN_FORMAT = "yadilab.engine.event-plan" as const;
export const SIMULATION_EVENT_PLAN_SCHEMA_VERSION = "1.0.0" as const;
export const SIMULATION_EVENT_QUEUE_LIMIT = 4096 as const;

export interface ScheduledSimulationEvent {
  readonly eventId: string;
  readonly kind: string;
  readonly atMs: number;
  readonly sequence: number;
  readonly targetResourceId?: string;
}

export interface SimulationEventPlan {
  readonly formatId: typeof SIMULATION_EVENT_PLAN_FORMAT;
  readonly schemaVersion: typeof SIMULATION_EVENT_PLAN_SCHEMA_VERSION;
  readonly scenarioId: string;
  readonly scenarioHash: string;
  /** Engine revision when the plan was created; fail closed if changed. */
  readonly baseStateRevision: number;
  /** Virtual milliseconds, independent of wall clock and stateRevision. */
  readonly nowMs: number;
  readonly nextSequence: number;
  readonly pending: readonly ScheduledSimulationEvent[];
}

export interface NewSimulationEvent {
  readonly eventId: string;
  readonly kind: string;
  readonly atMs: number;
  readonly targetResourceId?: string;
}

export type SimulationEventPlanResult =
  | { readonly ok: true; readonly plan: SimulationEventPlan; readonly dispatched: readonly ScheduledSimulationEvent[] }
  | { readonly ok: false; readonly plan: SimulationEventPlan; readonly code: string; readonly message: string };

const eventIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const eventKindPattern = /^[A-Z][A-Z0-9_]{0,63}$/;
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function compare(a: ScheduledSimulationEvent, b: ScheduledSimulationEvent): number {
  return a.atMs - b.atMs || a.sequence - b.sequence;
}
function fail(plan: SimulationEventPlan, code: string): SimulationEventPlanResult {
  return { ok: false, plan, code, message: code };
}
function validSource(state: EngineState): boolean {
  return typeof state?.scenarioId === "string" && state.scenarioId.length > 0
    && typeof state.scenarioHash === "string" && state.scenarioHash.length > 0
    && integer(state.stateRevision) && typeof state.resources === "object" && state.resources !== null && !Array.isArray(state.resources);
}

/** Create a fresh plan bound to one authoritative Engine snapshot. */
export function createSimulationEventPlan(state: EngineState): SimulationEventPlan {
  if (!validSource(state)) throw new Error("SIM_CLOCK_ENGINE_STATE_INVALID");
  return {
    formatId: SIMULATION_EVENT_PLAN_FORMAT,
    schemaVersion: SIMULATION_EVENT_PLAN_SCHEMA_VERSION,
    scenarioId: state.scenarioId,
    scenarioHash: state.scenarioHash,
    baseStateRevision: state.stateRevision,
    nowMs: 0,
    nextSequence: 0,
    pending: [],
  };
}

/** Also validates untrusted/restored plans, not only plans created by this API. */
export function inspectSimulationEventPlan(plan: SimulationEventPlan, state: EngineState): string | null {
  if (!validSource(state)) return "SIM_CLOCK_ENGINE_STATE_INVALID";
  if (!plan || plan.formatId !== SIMULATION_EVENT_PLAN_FORMAT
    || plan.schemaVersion !== SIMULATION_EVENT_PLAN_SCHEMA_VERSION
    || !integer(plan.nowMs) || !integer(plan.nextSequence)
    || !Array.isArray(plan.pending) || plan.pending.length > SIMULATION_EVENT_QUEUE_LIMIT) {
    return "SIM_CLOCK_PLAN_INVALID";
  }
  if (plan.scenarioId !== state.scenarioId || plan.scenarioHash !== state.scenarioHash) {
    return "SIM_CLOCK_SOURCE_MISMATCH";
  }
  if (plan.baseStateRevision !== state.stateRevision) return "SIM_CLOCK_STALE_REVISION";
  const ids = new Set<string>();
  const sequences = new Set<number>();
  let previous: ScheduledSimulationEvent | undefined;
  for (const event of plan.pending) {
    if (!event || typeof event.eventId !== "string" || typeof event.kind !== "string"
      || !eventIdPattern.test(event.eventId) || !eventKindPattern.test(event.kind)
      || !integer(event.atMs) || event.atMs < plan.nowMs
      || !integer(event.sequence) || event.sequence >= plan.nextSequence
      || (event.targetResourceId !== undefined && (typeof event.targetResourceId !== "string"
        || !Object.prototype.hasOwnProperty.call(state.resources, event.targetResourceId)))
      || ids.has(event.eventId) || sequences.has(event.sequence)
      || (previous !== undefined && compare(previous, event) >= 0)) {
      return "SIM_CLOCK_PLAN_INVALID";
    }
    ids.add(event.eventId);
    sequences.add(event.sequence);
    previous = event;
  }
  return null;
}

export function scheduleSimulationEvent(
  plan: SimulationEventPlan,
  state: EngineState,
  event: NewSimulationEvent,
): SimulationEventPlanResult {
  const invalid = inspectSimulationEventPlan(plan, state);
  if (invalid) return fail(plan, invalid);
  if (!event || typeof event.eventId !== "string" || typeof event.kind !== "string"
    || !eventIdPattern.test(event.eventId) || !eventKindPattern.test(event.kind)
    || !integer(event.atMs) || event.atMs < plan.nowMs
    || (event.targetResourceId !== undefined && (typeof event.targetResourceId !== "string"
      || !Object.prototype.hasOwnProperty.call(state.resources, event.targetResourceId)))) {
    return fail(plan, "SIM_CLOCK_EVENT_INVALID");
  }
  if (plan.pending.some((item) => item.eventId === event.eventId)) {
    return fail(plan, "SIM_CLOCK_DUPLICATE_EVENT");
  }
  if (plan.pending.length >= SIMULATION_EVENT_QUEUE_LIMIT || plan.nextSequence === Number.MAX_SAFE_INTEGER) {
    return fail(plan, "SIM_CLOCK_QUEUE_LIMIT");
  }
  const scheduled: ScheduledSimulationEvent = {
    eventId: event.eventId,
    kind: event.kind,
    atMs: event.atMs,
    sequence: plan.nextSequence,
    ...(event.targetResourceId !== undefined ? { targetResourceId: event.targetResourceId } : {}),
  };
  return {
    ok: true,
    plan: {
      ...plan,
      nextSequence: plan.nextSequence + 1,
      pending: [...plan.pending, scheduled].sort(compare),
    },
    dispatched: [],
  };
}

export function cancelSimulationEvent(
  plan: SimulationEventPlan,
  state: EngineState,
  eventId: string,
): SimulationEventPlanResult {
  const invalid = inspectSimulationEventPlan(plan, state);
  if (invalid) return fail(plan, invalid);
  if (!plan.pending.some((item) => item.eventId === eventId)) {
    return fail(plan, "SIM_CLOCK_EVENT_NOT_FOUND");
  }
  return {
    ok: true,
    plan: { ...plan, pending: plan.pending.filter((item) => item.eventId !== eventId) },
    dispatched: [],
  };
}

export function advanceSimulationEventPlan(
  plan: SimulationEventPlan,
  state: EngineState,
  untilMs: number,
): SimulationEventPlanResult {
  const invalid = inspectSimulationEventPlan(plan, state);
  if (invalid) return fail(plan, invalid);
  if (!integer(untilMs) || untilMs < plan.nowMs) return fail(plan, "SIM_CLOCK_TIME_INVALID");
  // Pending events already have a stable (dueMs, insertion sequence) ordering.
  const dispatched = plan.pending.filter((event) => event.atMs <= untilMs);
  const pending = plan.pending.slice(dispatched.length);
  return {
    ok: true,
    plan: { ...plan, nowMs: untilMs, pending },
    dispatched,
  };
}
