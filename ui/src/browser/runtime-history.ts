import { applyOperation, createInitialEngineState, evaluateEngine } from "../../../engine/src/index.js";
import type { EngineState, ScenarioOperation } from "../../../engine/src/index.js";
import type { BrowserCommandResult, BrowserDiagnostic, RuntimeCheckpoint, RuntimeHistory, RuntimeWorkspace } from "./types.js";

function error(code: string, message: string): BrowserDiagnostic {
  return { severity: "error", code, message };
}

export function createRuntimeHistory(): RuntimeHistory {
  return { past: [], future: [], checkpoints: [] };
}

function withState(workspace: RuntimeWorkspace, state: EngineState, history: RuntimeHistory): RuntimeWorkspace {
  return {
    ...workspace,
    engineState: state,
    evaluation: evaluateEngine(workspace.scenario, state),
    history,
  };
}

export function applyRuntimeOperationWithHistory(
  workspace: RuntimeWorkspace,
  operation: ScenarioOperation,
): BrowserCommandResult<RuntimeWorkspace> {
  const result = applyOperation(workspace.engineState, operation);
  if (!result.ok) {
    return {
      ok: false,
      workspace,
      diagnostics: [{ severity: "error", code: result.diagnostic.code, message: result.diagnostic.message, ...(result.diagnostic.target ? { objectId: result.diagnostic.target } : {}) }],
    };
  }
  const history: RuntimeHistory = {
    past: [...workspace.history.past, workspace.engineState],
    future: [],
    checkpoints: workspace.history.checkpoints,
  };
  return { ok: true, workspace: withState(workspace, result.state, history), diagnostics: [] };
}

export function undoRuntime(workspace: RuntimeWorkspace): BrowserCommandResult<RuntimeWorkspace> {
  const previous = workspace.history.past.at(-1);
  if (!previous) return { ok: false, workspace, diagnostics: [error("RUNTIME_UNDO_EMPTY", "No earlier Runtime state is available to undo.")] };
  const history: RuntimeHistory = {
    past: workspace.history.past.slice(0, -1),
    future: [...workspace.history.future, workspace.engineState],
    checkpoints: workspace.history.checkpoints,
  };
  return { ok: true, workspace: withState(workspace, previous, history), diagnostics: [] };
}

export function redoRuntime(workspace: RuntimeWorkspace): BrowserCommandResult<RuntimeWorkspace> {
  const next = workspace.history.future.at(-1);
  if (!next) return { ok: false, workspace, diagnostics: [error("RUNTIME_REDO_EMPTY", "No later Runtime state is available to redo.")] };
  const history: RuntimeHistory = {
    past: [...workspace.history.past, workspace.engineState],
    future: workspace.history.future.slice(0, -1),
    checkpoints: workspace.history.checkpoints,
  };
  return { ok: true, workspace: withState(workspace, next, history), diagnostics: [] };
}

export function resetRuntimeWithHistory(workspace: RuntimeWorkspace): RuntimeWorkspace {
  const initial = createInitialEngineState(workspace.scenario);
  const history: RuntimeHistory = {
    past: [...workspace.history.past, workspace.engineState],
    future: [],
    checkpoints: workspace.history.checkpoints,
  };
  return withState(workspace, initial, history);
}

export function createRuntimeCheckpoint(
  workspace: RuntimeWorkspace,
  label?: string,
): BrowserCommandResult<RuntimeWorkspace> {
  const sequence = workspace.history.checkpoints.length + 1;
  const id = `checkpoint-${String(sequence).padStart(4, "0")}`;
  const checkpoint: RuntimeCheckpoint = {
    id,
    label: label?.trim() || `Checkpoint ${sequence}`,
    scenarioHash: workspace.scenario.sourceHash,
    state: workspace.engineState,
  };
  const history: RuntimeHistory = {
    ...workspace.history,
    checkpoints: [...workspace.history.checkpoints, checkpoint],
  };
  return { ok: true, workspace: { ...workspace, history }, diagnostics: [] };
}

export function restoreRuntimeCheckpoint(
  workspace: RuntimeWorkspace,
  checkpointId: string,
): BrowserCommandResult<RuntimeWorkspace> {
  const checkpoint = workspace.history.checkpoints.find((item) => item.id === checkpointId);
  if (!checkpoint) return { ok: false, workspace, diagnostics: [error("RUNTIME_CHECKPOINT_NOT_FOUND", `Checkpoint '${checkpointId}' does not exist.`)] };
  if (checkpoint.scenarioHash !== workspace.scenario.sourceHash) {
    return { ok: false, workspace, diagnostics: [error("RUNTIME_CHECKPOINT_SCENARIO_MISMATCH", "Checkpoint belongs to a different scenario hash.")] };
  }
  const history: RuntimeHistory = {
    past: [...workspace.history.past, workspace.engineState],
    future: [],
    checkpoints: workspace.history.checkpoints,
  };
  return { ok: true, workspace: withState(workspace, checkpoint.state, history), diagnostics: [] };
}

export function replayRuntimeOperations(
  workspace: RuntimeWorkspace,
  operations: readonly ScenarioOperation[],
): BrowserCommandResult<RuntimeWorkspace> {
  let current = createInitialEngineState(workspace.scenario);
  const past: EngineState[] = [];
  for (const operation of operations) {
    const before = current;
    const result = applyOperation(current, operation);
    if (!result.ok) {
      return {
        ok: false,
        workspace,
        diagnostics: [error("RUNTIME_REPLAY_FAILED", `Replay failed at target '${operation.target}': ${result.diagnostic.message}`)],
      };
    }
    past.push(before);
    current = result.state;
  }
  const history: RuntimeHistory = {
    past,
    future: [],
    checkpoints: workspace.history.checkpoints,
  };
  return { ok: true, workspace: withState(workspace, current, history), diagnostics: [] };
}
