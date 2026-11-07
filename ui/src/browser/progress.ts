import branding from "../../../app-config/branding.json" with { type: "json" };
import type { SaveState } from "../../../core-model/src/generated/contracts.js";
import { createSaveState, evaluateEngine, restoreSaveState } from "../../../engine/src/index.js";
import type { BrowserCommandResult, JsonDownloadDescriptor, RuntimeWorkspace, TextReadableFile } from "./types.js";
import { createRuntimeHistory } from "./runtime-history.js";

export function createRuntimeProgress(workspace: RuntimeWorkspace): SaveState {
  return createSaveState(workspace.scenario, workspace.engineState, workspace.evaluation);
}

export function createProgressDownload(workspace: RuntimeWorkspace): JsonDownloadDescriptor {
  const progress = createRuntimeProgress(workspace);
  return {
    filename: `${workspace.scenario.scenarioId}${branding.progressExtension}`,
    mime: "application/json",
    text: `${JSON.stringify(progress, null, 2)}\n`,
  };
}

export async function readProgressFile(file: TextReadableFile): Promise<unknown> {
  const text = await file.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new Error(`Could not parse progress file '${file.name}' as JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export function loadRuntimeProgress(workspace: RuntimeWorkspace, save: SaveState): BrowserCommandResult<RuntimeWorkspace> {
  const restored = restoreSaveState(workspace.scenario, save);
  if (!restored.ok) {
    return {
      ok: false,
      workspace,
      diagnostics: [{ severity: "error", code: restored.code, message: restored.message }],
    };
  }
  const next: RuntimeWorkspace = {
    ...workspace,
    engineState: restored.state,
    evaluation: evaluateEngine(workspace.scenario, restored.state),
    history: createRuntimeHistory(),
  };
  return { ok: true, workspace: next, diagnostics: [] };
}
