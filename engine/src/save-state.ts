import type { NormalizedScenario, SaveState } from "../../core-model/src/generated/contracts.js";
import { deepCloneJson, isRecord } from "./json.js";
import type { EngineEvaluation, EngineState, RuntimeResourceState } from "./types.js";
import { ENGINE_VERSION } from "./version.js";

export interface RestoreSaveSuccess {
  readonly ok: true;
  readonly state: EngineState;
}

export interface RestoreSaveFailure {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

export type RestoreSaveResult = RestoreSaveSuccess | RestoreSaveFailure;

export function createSaveState(
  scenario: NormalizedScenario,
  state: EngineState,
  evaluation: EngineEvaluation,
): SaveState {
  const resourceState: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const [id, resource] of Object.entries(state.resources)) {
    resourceState[id] = deepCloneJson(resource) as unknown as Readonly<Record<string, unknown>>;
  }
  return {
    formatId: "infrastructure-cyber-lab.save",
    schemaVersion: scenario.schemaVersion,
    scenarioHash: scenario.sourceHash,
    engineVersion: ENGINE_VERSION,
    stateRevision: state.stateRevision,
    clock: { mode: "virtual", tick: state.stateRevision },
    resourceState,
    completedObjectives: evaluation.objectives.filter((x) => x.state === "TRUE").map((x) => x.id).sort((a, b) => a.localeCompare(b, "en")),
    evidence: evaluation.evidence.map((event) => ({
      sequence: event.sequence,
      testId: event.testId,
      outcome: event.outcome,
      summary: event.summary,
    })),
  };
}

function fail(code: string, message: string): RestoreSaveFailure {
  return { ok: false, code, message };
}

export function restoreSaveState(scenario: NormalizedScenario, input: SaveState): RestoreSaveResult {
  if (input.formatId !== "infrastructure-cyber-lab.save") return fail("SAVE_FORMAT_MISMATCH", `Unsupported save format '${String(input.formatId)}'.`);
  if (input.scenarioHash !== scenario.sourceHash) return fail("SAVE_SCENARIO_HASH_MISMATCH", "Save belongs to a different scenario/source revision.");
  if (input.schemaVersion !== scenario.schemaVersion) return fail("SAVE_SCHEMA_VERSION_MISMATCH", `Save schema '${input.schemaVersion}' does not match scenario schema '${scenario.schemaVersion}'.`);
  if (input.engineVersion !== ENGINE_VERSION) return fail("SAVE_ENGINE_VERSION_MISMATCH", `Save Engine '${input.engineVersion}' is incompatible with Engine '${ENGINE_VERSION}'.`);
  if (!Number.isInteger(input.stateRevision) || input.stateRevision < 0) return fail("SAVE_STATE_REVISION_INVALID", "Save stateRevision must be a non-negative integer.");
  if (!isRecord(input.resourceState)) return fail("SAVE_RESOURCE_STATE_INVALID", "Save resourceState must be an object.");

  const expectedIds = scenario.resources.map((x) => x.id).sort((a, b) => a.localeCompare(b, "en"));
  const actualIds = Object.keys(input.resourceState).sort((a, b) => a.localeCompare(b, "en"));
  if (expectedIds.length !== actualIds.length || expectedIds.some((id, i) => id !== actualIds[i])) {
    return fail("SAVE_RESOURCE_SET_MISMATCH", "Save resource set does not exactly match the scenario resource set.");
  }

  const resources: Record<string, RuntimeResourceState> = {};
  for (const id of expectedIds) {
    const raw = input.resourceState[id];
    if (!isRecord(raw)) return fail("SAVE_RESOURCE_INVALID", `Save resource '${id}' is not an object.`);
    if (raw.id !== id) return fail("SAVE_RESOURCE_ID_MISMATCH", `Save resource key '${id}' does not match embedded id '${String(raw.id)}'.`);
    resources[id] = deepCloneJson(raw) as unknown as RuntimeResourceState;
  }

  return {
    ok: true,
    state: {
      scenarioId: scenario.scenarioId,
      scenarioHash: scenario.sourceHash,
      stateRevision: input.stateRevision,
      resources,
    },
  };
}
