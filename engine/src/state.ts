import type { NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import { isMutableRuntimeOperationPath } from "../../core-model/src/operation-policy.js";
import { deepCloneJson } from "./json.js";
import { removePath, setPath } from "./path.js";
import type { EngineState, OperationResult, RuntimeResourceState, ScenarioOperation } from "./types.js";

function cloneResource(resource: NormalizedScenario["resources"][number]): RuntimeResourceState {
  return deepCloneJson(resource) as RuntimeResourceState;
}

export function createInitialEngineState(scenario: NormalizedScenario): EngineState {
  // A user-supplied scenario ID can legally be "constructor". A null-
  // prototype map prevents an absent ID from resolving Object.prototype.
  const resources: Record<string, RuntimeResourceState> = Object.create(null);
  for (const resource of scenario.resources) resources[resource.id] = cloneResource(resource);
  return {
    scenarioId: scenario.scenarioId,
    scenarioHash: scenario.sourceHash,
    stateRevision: 0,
    resources,
  };
}

export function applyOperation(state: EngineState, operation: ScenarioOperation): OperationResult {
  const reject = (code: string, message: string): OperationResult => ({
    ok: false, state, diagnostic: { code, message, target: operation?.target, path: operation?.path },
  });
  // Direct consumers may be JavaScript callers rather than schema-validated
  // packages. A misspelled op previously silently took the REMOVE branch;
  // a SET without a value could erase an existing JSON property.
  if (!operation || (operation.op !== "set" && operation.op !== "remove") ||
      typeof operation.target !== "string")
    return reject("ENGINE_OPERATION_INVALID", "Operation must declare set/remove and a string target.");
  if ((operation.op === "set" &&
        (!Object.prototype.hasOwnProperty.call(operation, "value") || operation.value === undefined)) ||
      (operation.op === "remove" && Object.prototype.hasOwnProperty.call(operation, "value")))
    return reject("ENGINE_OPERATION_INVALID", "Set requires a declared JSON value; remove must not carry a value.");
  if (!isMutableRuntimeOperationPath(operation.path))
    return reject("ENGINE_OPERATION_PATH_FORBIDDEN",
      "Runtime mutations may change only properties.* or fields of an existing interface, never identity, interface ID or resource structure.");
  const resource = Object.prototype.hasOwnProperty.call(state.resources, operation.target)
    ? state.resources[operation.target] : undefined;
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
      // Preserve the null-prototype identity namespace after each revision.
      resources: Object.assign(Object.create(null), state.resources, {
        [operation.target]: write.value as unknown as RuntimeResourceState,
      }) as Record<string, RuntimeResourceState>,
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
