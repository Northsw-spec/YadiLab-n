import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import { compileBuilderWorkspace } from "./builder.js";
import type { BrowserDiagnostic, BrowserFoundationOptions, BuilderWorkspace } from "./types.js";
import { createBuilderWorkspace } from "./builder.js";

export type ImportWorkbenchStatus = "UNPARSED" | "PARSED" | "INVALID" | "VALID" | "COMPILED" | "READY_TO_ACTIVATE" | "ACTIVE";

export interface ImportWorkbenchPreview {
  readonly scenarioId: string;
  readonly title: string;
  readonly nodes: number;
  readonly links: number;
  readonly zones: number;
  readonly flows: number;
  readonly faults: number;
  readonly mode: "PREVIEW";
}

export interface ImportWorkbenchState {
  readonly status: ImportWorkbenchStatus;
  readonly fileName?: string;
  readonly source?: ScenarioSource;
  readonly workspace?: BuilderWorkspace;
  readonly preview?: ImportWorkbenchPreview;
  readonly diagnostics: readonly BrowserDiagnostic[];
}

export function emptyImportWorkbench(): ImportWorkbenchState {
  return { status: "UNPARSED", diagnostics: [] };
}

function error(code: string, message: string): BrowserDiagnostic { return { severity: "error", code, message }; }

function preview(source: ScenarioSource): ImportWorkbenchPreview {
  const flows = source.connections.filter((connection) => connection.kind === "data_flow").length;
  const faults = source.resources.reduce((count, resource) => count + (resource.properties && Object.prototype.hasOwnProperty.call(resource.properties, "faults") ? 1 : 0), 0);
  return { scenarioId: source.scenarioId, title: source.metadata.title, nodes: source.resources.length, links: source.connections.length, zones: source.zones.length, flows, faults, mode: "PREVIEW" };
}

function structuralSource(value: unknown): { ok: true; source: ScenarioSource } | { ok: false; diagnostics: readonly BrowserDiagnostic[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, diagnostics: [error("IMPORT_SOURCE_ROOT_INVALID", "Native scenario source must be a JSON object.")] };
  const candidate = value as Record<string, unknown>;
  const required = ["formatId", "schemaVersion", "scenarioId", "metadata", "requires", "zones", "resources", "connections", "tests", "findings", "objectives", "completion"];
  const missing = required.filter((key) => !(key in candidate));
  if (missing.length) return { ok: false, diagnostics: [error("IMPORT_SOURCE_REQUIRED_MISSING", `Native scenario source is missing: ${missing.join(", ")}.`)] };
  if (candidate.formatId !== "infrastructure-cyber-lab.scenario-source") return { ok: false, diagnostics: [error("IMPORT_SOURCE_FORMAT_UNSUPPORTED", "Unsupported native scenario source format.")] };
  if (!["zones", "resources", "connections", "tests", "findings", "objectives"].every((key) => Array.isArray(candidate[key]))) return { ok: false, diagnostics: [error("IMPORT_SOURCE_COLLECTION_INVALID", "Native scenario collections must be arrays.")] };
  return { ok: true, source: structuredClone(value) as ScenarioSource };
}

export async function parseScenarioImport(file: { readonly name: string; text(): Promise<string> }): Promise<ImportWorkbenchState> {
  if (!file.name.toLowerCase().endsWith(".json")) return { status: "INVALID", fileName: file.name, diagnostics: [error("IMPORT_SOURCE_EXTENSION_UNSUPPORTED", "Native authoring workbench accepts .json; use the enterprise tabular adapter for CSV/TSV.")] };
  let value: unknown;
  try { value = JSON.parse(await file.text()) as unknown; }
  catch (cause) { return { status: "INVALID", fileName: file.name, diagnostics: [error("IMPORT_SOURCE_JSON_INVALID", `Could not parse '${file.name}' as JSON: ${cause instanceof Error ? cause.message : String(cause)}`)] }; }
  const checked = structuralSource(value);
  if (!checked.ok) return { status: "INVALID", fileName: file.name, diagnostics: checked.diagnostics };
  const workspace = createBuilderWorkspace(checked.source);
  return { status: "PARSED", fileName: file.name, source: checked.source, workspace, diagnostics: [] };
}

export function previewScenarioImport(state: ImportWorkbenchState): ImportWorkbenchState {
  if (!state.source || !state.workspace || (state.status !== "PARSED" && state.status !== "VALID" && state.status !== "COMPILED" && state.status !== "READY_TO_ACTIVATE")) return { ...state, diagnostics: [error("IMPORT_PREVIEW_NOT_AVAILABLE", "Parse a structurally valid native source before preview.")] };
  return { ...state, preview: preview(state.source), diagnostics: [] };
}

export async function validateScenarioImport(state: ImportWorkbenchState, options: BrowserFoundationOptions): Promise<ImportWorkbenchState> {
  if (!state.workspace || !state.source) return { ...state, status: "INVALID", diagnostics: [error("IMPORT_VALIDATE_NOT_AVAILABLE", "No parsed native source is available.")] };
  const workspace = await compileBuilderWorkspace(state.workspace, options);
  if (workspace.compile.status === "invalid") return { ...state, status: "INVALID", workspace, diagnostics: workspace.compile.diagnostics.map((item) => ({ severity: item.severity, code: item.code, message: item.message })) };
  if (workspace.compile.status !== "valid") return { ...state, status: "INVALID", workspace, diagnostics: [error("IMPORT_VALIDATE_INCOMPLETE", "Compiler did not produce a valid or invalid result.")] };
  return { ...state, status: "VALID", workspace, diagnostics: [] };
}

export async function compileScenarioImport(state: ImportWorkbenchState, options: BrowserFoundationOptions): Promise<ImportWorkbenchState> {
  if (!state.workspace || !state.source) return { ...state, status: "INVALID", diagnostics: [error("IMPORT_COMPILE_NOT_AVAILABLE", "No parsed native source is available.")] };
  const workspace = await compileBuilderWorkspace(state.workspace, options);
  if (workspace.compile.status !== "valid") {
    const diagnostics = workspace.compile.status === "invalid" ? workspace.compile.diagnostics.map((item) => ({ severity: item.severity, code: item.code, message: item.message })) : [];
    return { ...state, status: "INVALID", workspace, diagnostics };
  }
  return { ...state, status: "READY_TO_ACTIVATE", workspace, diagnostics: [] };
}

export function activateScenarioImport(state: ImportWorkbenchState): ImportWorkbenchState {
  if (state.status !== "READY_TO_ACTIVATE" || !state.workspace) return { ...state, diagnostics: [error("IMPORT_ACTIVATE_NOT_READY", "Compile the imported source successfully before activation.")] };
  return { ...state, status: "ACTIVE", diagnostics: [] };
}
