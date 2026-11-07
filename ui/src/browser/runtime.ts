import { createInitialEngineState, evaluateEngine } from "../../../engine/src/index.js";
import { BUILTIN_CAPABILITY_PACK_REGISTRY } from "../../../capability-packs/src/index.js";
import type { CapabilityPackRegistry } from "../../../capability-packs/src/index.js";
import type { ScenarioOperation } from "../../../engine/src/index.js";
import type { BrowserCommandResult, BrowserDiagnostic, BuilderWorkspace, RuntimeWorkspace } from "./types.js";
import { applyRuntimeOperationWithHistory, createRuntimeHistory, resetRuntimeWithHistory } from "./runtime-history.js";

function error(code: string, message: string, objectId?: string): BrowserDiagnostic {
  return objectId ? { severity: "error", code, message, objectId } : { severity: "error", code, message };
}

export function previewRuntime(
  workspace: BuilderWorkspace,
  capabilityRegistry: CapabilityPackRegistry = BUILTIN_CAPABILITY_PACK_REGISTRY,
): BrowserCommandResult<RuntimeWorkspace | BuilderWorkspace> {
  if (workspace.compile.status !== "valid") {
    return { ok: false, workspace, diagnostics: [error("RUNTIME_COMPILE_REQUIRED", "Runtime preview requires a successful current compile.")] };
  }
  const scenario = workspace.compile.model;
  const capabilityResolution = capabilityRegistry.resolveLocks(scenario.capabilityLocks);
  if (!capabilityResolution.ok) {
    return {
      ok: false,
      workspace,
      diagnostics: capabilityResolution.diagnostics.map((item) => error(`RUNTIME_${item.code}`, item.message, item.id)),
    };
  }
  const engineState = createInitialEngineState(scenario);
  const runtime: RuntimeWorkspace = {
    mode: "runtime",
    source: workspace.source,
    scenario,
    engineState,
    evaluation: evaluateEngine(scenario, engineState),
    selection: workspace.selection,
    sourceRevision: workspace.sourceRevision,
    ...(workspace.layout ? { layout: workspace.layout } : {}),
    history: createRuntimeHistory(),
  };
  return { ok: true, workspace: runtime, diagnostics: [] };
}

export function setRuntimeSelection(workspace: RuntimeWorkspace, ids: readonly string[], primary?: string): RuntimeWorkspace {
  const known = new Set([
    ...workspace.scenario.zones.map((x) => x.id),
    ...workspace.scenario.resources.map((x) => x.id),
    ...workspace.scenario.connections.map((x) => x.id),
  ]);
  const filtered = [...new Set(ids.filter((id) => known.has(id)))].sort((a, b) => a.localeCompare(b, "en"));
  const selectedPrimary = primary && filtered.includes(primary) ? primary : filtered[0];
  if (workspace.selection.primary === selectedPrimary &&
      workspace.selection.ids.length === filtered.length &&
      workspace.selection.ids.every((id, index) => id === filtered[index])) return workspace;
  return { ...workspace, selection: selectedPrimary ? { ids: filtered, primary: selectedPrimary } : { ids: filtered } };
}

export function applyRuntimeOperation(workspace: RuntimeWorkspace, operation: ScenarioOperation): BrowserCommandResult<RuntimeWorkspace> {
  return applyRuntimeOperationWithHistory(workspace, operation);
}

export function resetRuntime(workspace: RuntimeWorkspace): RuntimeWorkspace {
  return resetRuntimeWithHistory(workspace);
}
