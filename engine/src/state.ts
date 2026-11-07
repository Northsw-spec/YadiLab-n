import type { NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import { deepCloneJson } from "./json.js";
import { removePath, setPath } from "./path.js";
import type { EngineState, OperationResult, RuntimeResourceState, ScenarioOperation } from "./types.js";

function cloneResource(resource: NormalizedScenario["resources"][number]): RuntimeResourceState {
  return deepCloneJson(resource) as RuntimeResourceState;
}

export function createInitialEngineState(scenario: NormalizedScenario): EngineState {
  const resources: Record<string, RuntimeResourceState> = {};
  for (const resource of scenario.resources) resources[resource.id] = cloneResource(resource);
  return {
    scenarioId: scenario.scenarioId,
    scenarioHash: scenario.sourceHash,
    stateRevision: 0,
    resources,
  };
}

export function applyOperation(state: EngineState, operation: ScenarioOperation): OperationResult {
  const resource = state.resources[operation.target];
  if (!resource) {
    return {
      ok: false,
      state,
      diagnostic: {
        code: "ENGINE_UNKNOWN_TARGET",
        message: `Operation target '${operation.target}' does not exist in runtime state.`,
        target: operation.target,
        path: operation.path,
      },
    };
  }

  const write = operation.op === "set"
    ? setPath(resource as unknown as Readonly<Record<string, unknown>>, operation.path, operation.value)
    : removePath(resource as unknown as Readonly<Record<string, unknown>>, operation.path);

  if (!write.ok) {
    return {
      ok: false,
      state,
      diagnostic: {
        code: "ENGINE_OPERATION_PATH_INVALID",
        message: write.reason,
        target: operation.target,
        path: operation.path,
      },
    };
  }

  return {
    ok: true,
    state: {
      ...state,
      stateRevision: state.stateRevision + 1,
      resources: {
        ...state.resources,
        [operation.target]: write.value as unknown as RuntimeResourceState,
      },
    },
  };
}

export function applyOperations(state: EngineState, operations: readonly ScenarioOperation[]): OperationResult {
  const original = state;
  let current = state;
  for (const operation of operations) {
    const result = applyOperation(current, operation);
    if (!result.ok) return { ...result, state: original };
    current = result.state;
  }
  return { ok: true, state: current };
}
