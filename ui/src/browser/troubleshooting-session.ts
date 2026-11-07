import branding from "../../../app-config/branding.json" with { type: "json" };
import {
  addLearnerNoteToNotebook,
  captureActiveProbeInNotebook,
  captureObservationInNotebook,
  createTroubleshootingNotebook,
  verifyTroubleshootingNotebook,
} from "../../../observation-engine/src/index.js";
import type {
  ActiveProbeTranscript,
  ObservationTranscript,
  TroubleshootingNotebook,
  TroubleshootingNoteKind,
} from "../../../observation-engine/src/index.js";
import type { BrowserDiagnostic, BrowserWorkspace, JsonDownloadDescriptor, RuntimeWorkspace, TextReadableFile } from "./types.js";

export interface TroubleshootingNotebookUiResult {
  readonly ok: boolean;
  readonly notebook?: TroubleshootingNotebook;
  readonly diagnostics: readonly BrowserDiagnostic[];
}
export interface TroubleshootingNotebookValidation { readonly valid: boolean; readonly diagnostics?: readonly string[]; }
export type TroubleshootingNotebookValidator = (input: unknown) => TroubleshootingNotebookValidation;
function error(code: string, message: string): BrowserDiagnostic { return { severity: "error", code, message }; }
function mapDiagnostics(items: readonly { readonly severity: "warning" | "error"; readonly code: string; readonly message: string }[]): readonly BrowserDiagnostic[] { return items.map((item) => ({ severity: item.severity, code: item.code, message: item.message })); }
async function ensureNotebook(workspace: RuntimeWorkspace, notebook?: TroubleshootingNotebook): Promise<TroubleshootingNotebookUiResult> {
  if (!notebook) return { ok: true, notebook: await createTroubleshootingNotebook(workspace.scenario.scenarioId, workspace.scenario.sourceHash), diagnostics: [] };
  if (notebook.scenarioId !== workspace.scenario.scenarioId || notebook.scenarioHash !== workspace.scenario.sourceHash) return { ok: false, diagnostics: [error("NOTEBOOK_UI_SCENARIO_MISMATCH", "Troubleshooting notebook belongs to a different scenario identity.")] };
  const verified = await verifyTroubleshootingNotebook(notebook);
  return verified.ok ? { ok: true, notebook, diagnostics: [] } : { ok: false, diagnostics: mapDiagnostics(verified.diagnostics) };
}
export async function captureRuntimeObservationEvidence(workspace: BrowserWorkspace, notebook: TroubleshootingNotebook | undefined, transcript: ObservationTranscript, learnerNote?: string): Promise<TroubleshootingNotebookUiResult> {
  if (workspace.mode !== "runtime") return { ok: false, diagnostics: [error("NOTEBOOK_UI_RUNTIME_REQUIRED", "Troubleshooting evidence can be captured only in Runtime.")] };
  if (transcript.stateRevision !== workspace.engineState.stateRevision) return { ok: false, diagnostics: [error("NOTEBOOK_UI_STALE_TRANSCRIPT", "Observation transcript was captured from an earlier Runtime revision. Run the observation again before saving evidence.")] };
  const ready = await ensureNotebook(workspace, notebook); if (!ready.ok || !ready.notebook) return ready;
  const result = await captureObservationInNotebook(ready.notebook, transcript, learnerNote);
  return result.ok && result.notebook ? { ok: true, notebook: result.notebook, diagnostics: [] } : { ok: false, diagnostics: mapDiagnostics(result.diagnostics) };
}
export async function captureRuntimeActiveProbeEvidence(workspace: BrowserWorkspace, notebook: TroubleshootingNotebook | undefined, transcript: ActiveProbeTranscript, learnerNote?: string): Promise<TroubleshootingNotebookUiResult> {
  if (workspace.mode !== "runtime") return { ok: false, diagnostics: [error("NOTEBOOK_UI_RUNTIME_REQUIRED", "Troubleshooting evidence can be captured only in Runtime.")] };
  if (transcript.stateRevision !== workspace.engineState.stateRevision) return { ok: false, diagnostics: [error("NOTEBOOK_UI_STALE_TRANSCRIPT", "Active-probe transcript was captured from an earlier Runtime revision. Run the probe again before saving evidence.")] };
  const ready = await ensureNotebook(workspace, notebook); if (!ready.ok || !ready.notebook) return ready;
  const result = await captureActiveProbeInNotebook(ready.notebook, transcript, learnerNote);
  return result.ok && result.notebook ? { ok: true, notebook: result.notebook, diagnostics: [] } : { ok: false, diagnostics: mapDiagnostics(result.diagnostics) };
}
export async function addRuntimeTroubleshootingNote(workspace: BrowserWorkspace, notebook: TroubleshootingNotebook | undefined, noteKind: TroubleshootingNoteKind, text: string): Promise<TroubleshootingNotebookUiResult> {
  if (workspace.mode !== "runtime") return { ok: false, diagnostics: [error("NOTEBOOK_UI_RUNTIME_REQUIRED", "Troubleshooting notes can be added only in Runtime.")] };
  const ready = await ensureNotebook(workspace, notebook); if (!ready.ok || !ready.notebook) return ready;
  const result = await addLearnerNoteToNotebook(ready.notebook, workspace.engineState.stateRevision, noteKind, text);
  return result.ok && result.notebook ? { ok: true, notebook: result.notebook, diagnostics: [] } : { ok: false, diagnostics: mapDiagnostics(result.diagnostics) };
}
export function createTroubleshootingNotebookDownload(notebook: TroubleshootingNotebook): JsonDownloadDescriptor {
  return { filename: `${notebook.scenarioId}${branding.notebookExtension}`, mime: "application/json", text: `${JSON.stringify(notebook, null, 2)}\n` };
}
export async function readTroubleshootingNotebookFile(file: TextReadableFile): Promise<unknown> {
  const text = await file.text();
  try { return JSON.parse(text) as unknown; } catch (cause) { throw new Error(`Could not parse troubleshooting notebook '${file.name}' as JSON: ${cause instanceof Error ? cause.message : String(cause)}`); }
}
export async function loadTroubleshootingNotebookFile(workspace: BrowserWorkspace, file: TextReadableFile, validate: TroubleshootingNotebookValidator): Promise<TroubleshootingNotebookUiResult> {
  if (workspace.mode !== "runtime") return { ok: false, diagnostics: [error("NOTEBOOK_UI_RUNTIME_REQUIRED", "Troubleshooting notebooks can be loaded only in Runtime.")] };
  let input: unknown;
  try { input = await readTroubleshootingNotebookFile(file); } catch (cause) { return { ok: false, diagnostics: [error("NOTEBOOK_UI_PARSE_FAILED", cause instanceof Error ? cause.message : String(cause))] }; }
  const schema = validate(input);
  if (!schema.valid) return { ok: false, diagnostics: (schema.diagnostics?.length ? schema.diagnostics : ["Troubleshooting notebook failed schema validation."]).map((message) => error("NOTEBOOK_UI_SCHEMA_INVALID", message)) };
  const notebook = input as TroubleshootingNotebook;
  const ready = await ensureNotebook(workspace, notebook);
  return ready.ok && ready.notebook ? { ok: true, notebook: ready.notebook, diagnostics: [] } : ready;
}
