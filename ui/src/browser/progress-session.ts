import type { SaveState } from "../../../core-model/src/generated/contracts.js";
import type { BrowserCommandResult, BrowserDiagnostic, RuntimeWorkspace, TextReadableFile } from "./types.js";
import { createRuntimeProgress, loadRuntimeProgress, readProgressFile } from "./progress.js";
import type { ProgressStore } from "./persistence.js";

export interface SaveContractValidation {
  readonly valid: boolean;
  readonly diagnostics?: readonly string[];
}

export type SaveContractValidator = (input: unknown) => SaveContractValidation;

function error(code: string, message: string): BrowserDiagnostic {
  return { severity: "error", code, message };
}

function validateSaveInput(input: unknown, validateSave: SaveContractValidator): { ok: true; save: SaveState } | { ok: false; diagnostics: readonly BrowserDiagnostic[] } {
  const result = validateSave(input);
  if (!result.valid) {
    const messages = result.diagnostics?.length ? result.diagnostics : ["Progress save failed schema validation."];
    return { ok: false, diagnostics: messages.map((message) => error("PROGRESS_SAVE_SCHEMA_INVALID", message)) };
  }
  return { ok: true, save: input as SaveState };
}

export async function loadRuntimeProgressFile(
  workspace: RuntimeWorkspace,
  file: TextReadableFile,
  validateSave: SaveContractValidator,
): Promise<BrowserCommandResult<RuntimeWorkspace>> {
  let input: unknown;
  try {
    input = await readProgressFile(file);
  } catch (cause) {
    return { ok: false, workspace, diagnostics: [error("PROGRESS_FILE_PARSE_FAILED", cause instanceof Error ? cause.message : String(cause))] };
  }
  const checked = validateSaveInput(input, validateSave);
  if (!checked.ok) return { ok: false, workspace, diagnostics: checked.diagnostics };
  return loadRuntimeProgress(workspace, checked.save);
}

export async function autosaveRuntimeProgress(
  workspace: RuntimeWorkspace,
  store: ProgressStore,
): Promise<BrowserCommandResult<RuntimeWorkspace>> {
  try {
    await store.put(createRuntimeProgress(workspace));
    return { ok: true, workspace, diagnostics: [] };
  } catch (cause) {
    return { ok: false, workspace, diagnostics: [error("PROGRESS_AUTOSAVE_WRITE_FAILED", cause instanceof Error ? cause.message : String(cause))] };
  }
}

export async function restoreAutosavedRuntimeProgress(
  workspace: RuntimeWorkspace,
  store: ProgressStore,
  validateSave: SaveContractValidator,
): Promise<BrowserCommandResult<RuntimeWorkspace>> {
  let input: SaveState | undefined;
  try {
    input = await store.get(workspace.scenario.sourceHash);
  } catch (cause) {
    return { ok: false, workspace, diagnostics: [error("PROGRESS_AUTOSAVE_READ_FAILED", cause instanceof Error ? cause.message : String(cause))] };
  }
  if (!input) return { ok: false, workspace, diagnostics: [error("PROGRESS_AUTOSAVE_NOT_FOUND", "No autosaved progress exists for this exact scenario hash.")] };
  const checked = validateSaveInput(input, validateSave);
  if (!checked.ok) return { ok: false, workspace, diagnostics: checked.diagnostics };
  return loadRuntimeProgress(workspace, checked.save);
}

export async function clearAutosavedRuntimeProgress(
  workspace: RuntimeWorkspace,
  store: ProgressStore,
): Promise<BrowserCommandResult<RuntimeWorkspace>> {
  try {
    await store.delete(workspace.scenario.sourceHash);
    return { ok: true, workspace, diagnostics: [] };
  } catch (cause) {
    return { ok: false, workspace, diagnostics: [error("PROGRESS_AUTOSAVE_DELETE_FAILED", cause instanceof Error ? cause.message : String(cause))] };
  }
}
