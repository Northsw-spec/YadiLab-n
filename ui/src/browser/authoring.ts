import type {
  Scenariosourcefinding,
  Scenariosourcehint,
  Scenariosourcenote,
  Scenariosourceobjective,
  Scenariosourcetroubleshootingobjective,
  Scenariosourcerule,
  Scenariosourcesolution,
  Scenariosourcetest,
} from "../../../core-model/src/generated/contracts.js";
import {
  replaceFindings,
  replaceNotes,
  replaceObjectives,
  replaceTroubleshootingObjectives,
  replaceTests,
  setCanonicalSolution,
  setCompletionRule,
  setHints,
} from "./builder.js";
import type { BrowserCommandResult, BrowserDiagnostic, BuilderWorkspace } from "./types.js";

export interface BuilderAuthoringModel {
  readonly testsJson: string;
  readonly findingsJson: string;
  readonly objectivesJson: string;
  readonly troubleshootingObjectivesJson: string;
  readonly hintsJson: string;
  readonly notesJson: string;
  readonly completionJson: string;
  readonly canonicalSolutionJson: string;
  readonly compileStatus: BuilderWorkspace["compile"]["status"];
  readonly compileDiagnostics: readonly BrowserDiagnostic[];
}

function diag(code: string, message: string): BrowserDiagnostic {
  return { severity: "error", code, message };
}

function fail(workspace: BuilderWorkspace, code: string, message: string): BrowserCommandResult<BuilderWorkspace> {
  return { ok: false, workspace, diagnostics: [diag(code, message)] };
}

function parseJson(workspace: BuilderWorkspace, text: string, code: string): unknown | BrowserCommandResult<BuilderWorkspace> {
  try { return JSON.parse(text); }
  catch (error) { return fail(workspace, code, `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

function isFailure(value: unknown): value is BrowserCommandResult<BuilderWorkspace> {
  return typeof value === "object" && value !== null && "ok" in value && (value as { ok?: unknown }).ok === false;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObjectArray(workspace: BuilderWorkspace, text: string, code: string, label: string): readonly Record<string, unknown>[] | BrowserCommandResult<BuilderWorkspace> {
  const parsed = parseJson(workspace, text, code);
  if (isFailure(parsed)) return parsed;
  if (!Array.isArray(parsed) || parsed.some((item) => !isObject(item))) return fail(workspace, code, `${label} must be a JSON array of objects.`);
  return parsed;
}

function requireIds(workspace: BuilderWorkspace, items: readonly Record<string, unknown>[], code: string, label: string): BrowserCommandResult<BuilderWorkspace> | undefined {
  for (const item of items) {
    if (typeof item.id !== "string" || item.id.trim() === "") return fail(workspace, code, `Every ${label} must have a non-empty id.`);
  }
  return undefined;
}

function compileDiagnostics(workspace: BuilderWorkspace): readonly BrowserDiagnostic[] {
  if (workspace.compile.status !== "invalid") return [];
  return workspace.compile.diagnostics.map((item) => ({ severity: item.severity, code: item.code, message: item.message }));
}

export function buildBuilderAuthoringModel(workspace: BuilderWorkspace): BuilderAuthoringModel {
  return {
    testsJson: JSON.stringify(workspace.source.tests, null, 2),
    findingsJson: JSON.stringify(workspace.source.findings, null, 2),
    objectivesJson: JSON.stringify(workspace.source.objectives, null, 2),
    troubleshootingObjectivesJson: JSON.stringify(workspace.source.troubleshootingObjectives ?? [], null, 2),
    hintsJson: JSON.stringify(workspace.source.hints ?? [], null, 2),
    notesJson: JSON.stringify(workspace.source.notes ?? [], null, 2),
    completionJson: JSON.stringify(workspace.source.completion, null, 2),
    canonicalSolutionJson: workspace.source.canonicalSolution ? JSON.stringify(workspace.source.canonicalSolution, null, 2) : "",
    compileStatus: workspace.compile.status,
    compileDiagnostics: compileDiagnostics(workspace),
  };
}

export function applyTestsAuthoring(workspace: BuilderWorkspace, text: string): BrowserCommandResult<BuilderWorkspace> {
  const items = requireObjectArray(workspace, text, "BUILDER_AUTHORING_TESTS_JSON", "tests");
  if (isFailure(items)) return items;
  const ids = requireIds(workspace, items, "BUILDER_AUTHORING_TESTS_JSON", "test");
  if (ids) return ids;
  for (const item of items) {
    if (typeof item.type !== "string" || !isObject(item.params)) return fail(workspace, "BUILDER_AUTHORING_TESTS_JSON", "Every test must have a string type and object params.");
  }
  return replaceTests(workspace, items as unknown as readonly Scenariosourcetest[]);
}

export function applyFindingsAuthoring(workspace: BuilderWorkspace, text: string): BrowserCommandResult<BuilderWorkspace> {
  const items = requireObjectArray(workspace, text, "BUILDER_AUTHORING_FINDINGS_JSON", "findings");
  if (isFailure(items)) return items;
  const ids = requireIds(workspace, items, "BUILDER_AUTHORING_FINDINGS_JSON", "finding");
  if (ids) return ids;
  for (const item of items) {
    if (typeof item.title !== "string" || typeof item.severity !== "string" || !isObject(item.when)) return fail(workspace, "BUILDER_AUTHORING_FINDINGS_JSON", "Every finding must have title, severity and rule object 'when'.");
  }
  return replaceFindings(workspace, items as unknown as readonly Scenariosourcefinding[]);
}

export function applyObjectivesAuthoring(workspace: BuilderWorkspace, text: string): BrowserCommandResult<BuilderWorkspace> {
  const items = requireObjectArray(workspace, text, "BUILDER_AUTHORING_OBJECTIVES_JSON", "objectives");
  if (isFailure(items)) return items;
  const ids = requireIds(workspace, items, "BUILDER_AUTHORING_OBJECTIVES_JSON", "objective");
  if (ids) return ids;
  for (const item of items) {
    if (typeof item.title !== "string" || typeof item.category !== "string" || typeof item.required !== "boolean" || !isObject(item.condition)) return fail(workspace, "BUILDER_AUTHORING_OBJECTIVES_JSON", "Every objective must have title, category, required boolean and condition rule.");
  }
  return replaceObjectives(workspace, items as unknown as readonly Scenariosourceobjective[]);
}

export function applyTroubleshootingObjectivesAuthoring(workspace: BuilderWorkspace, text: string): BrowserCommandResult<BuilderWorkspace> {
  const items = requireObjectArray(workspace, text, "BUILDER_AUTHORING_TROUBLESHOOTING_OBJECTIVES_JSON", "troubleshooting objectives");
  if (isFailure(items)) return items;
  const ids = requireIds(workspace, items, "BUILDER_AUTHORING_TROUBLESHOOTING_OBJECTIVES_JSON", "troubleshooting objective");
  if (ids) return ids;
  for (const item of items) {
    if (typeof item.title !== "string" || typeof item.required !== "boolean" || (item.evidenceOrder !== "ordered" && item.evidenceOrder !== "unordered") || !Array.isArray(item.requirements) || item.requirements.length === 0) {
      return fail(workspace, "BUILDER_AUTHORING_TROUBLESHOOTING_OBJECTIVES_JSON", "Every troubleshooting objective must have title, required boolean, evidenceOrder ordered/unordered and a non-empty requirements array.");
    }
    for (const requirement of item.requirements) {
      if (!isObject(requirement) || typeof requirement.id !== "string" || typeof requirement.label !== "string" || (requirement.kind !== "observation" && requirement.kind !== "active_probe")) {
        return fail(workspace, "BUILDER_AUTHORING_TROUBLESHOOTING_OBJECTIVES_JSON", "Every troubleshooting requirement must have id, label and kind observation/active_probe.");
      }
    }
  }
  return replaceTroubleshootingObjectives(workspace, items as unknown as readonly Scenariosourcetroubleshootingobjective[]);
}

export function applyHintsAuthoring(workspace: BuilderWorkspace, text: string): BrowserCommandResult<BuilderWorkspace> {
  const items = requireObjectArray(workspace, text, "BUILDER_AUTHORING_HINTS_JSON", "hints");
  if (isFailure(items)) return items;
  for (const item of items) {
    if (!Number.isInteger(item.level) || typeof item.text !== "string") return fail(workspace, "BUILDER_AUTHORING_HINTS_JSON", "Every hint must have integer level and string text.");
  }
  return setHints(workspace, items as unknown as readonly Scenariosourcehint[]);
}

export function applyNotesAuthoring(workspace: BuilderWorkspace, text: string): BrowserCommandResult<BuilderWorkspace> {
  const items = requireObjectArray(workspace, text, "BUILDER_AUTHORING_NOTES_JSON", "notes");
  if (isFailure(items)) return items;
  const ids = requireIds(workspace, items, "BUILDER_AUTHORING_NOTES_JSON", "note");
  if (ids) return ids;
  for (const item of items) {
    if (typeof item.text !== "string" || item.text.trim() === "") return fail(workspace, "BUILDER_AUTHORING_NOTES_JSON", "Every note must have non-empty text.");
    if (item.title !== undefined && typeof item.title !== "string") return fail(workspace, "BUILDER_AUTHORING_NOTES_JSON", "Note title must be a string when present.");
    if (item.target !== undefined && typeof item.target !== "string") return fail(workspace, "BUILDER_AUTHORING_NOTES_JSON", "Note target must be a semantic object id when present.");
  }
  return replaceNotes(workspace, items as unknown as readonly Scenariosourcenote[]);
}

export function applyCompletionAuthoring(workspace: BuilderWorkspace, text: string): BrowserCommandResult<BuilderWorkspace> {
  const parsed = parseJson(workspace, text, "BUILDER_AUTHORING_COMPLETION_JSON");
  if (isFailure(parsed)) return parsed;
  if (!isObject(parsed) || typeof parsed.op !== "string") return fail(workspace, "BUILDER_AUTHORING_COMPLETION_JSON", "Completion must be a declarative rule object with an op field.");
  return setCompletionRule(workspace, parsed as unknown as Scenariosourcerule);
}

export function applyCanonicalSolutionAuthoring(workspace: BuilderWorkspace, text: string): BrowserCommandResult<BuilderWorkspace> {
  if (text.trim() === "") return setCanonicalSolution(workspace, undefined);
  const parsed = parseJson(workspace, text, "BUILDER_AUTHORING_SOLUTION_JSON");
  if (isFailure(parsed)) return parsed;
  if (!isObject(parsed) || !Array.isArray(parsed.operations)) return fail(workspace, "BUILDER_AUTHORING_SOLUTION_JSON", "Canonical solution must be an object with an operations array.");
  for (const operation of parsed.operations) {
    if (!isObject(operation) || (operation.op !== "set" && operation.op !== "remove") || typeof operation.target !== "string" || typeof operation.path !== "string") {
      return fail(workspace, "BUILDER_AUTHORING_SOLUTION_JSON", "Every canonical operation must be a set/remove operation with target and path.");
    }
  }
  return setCanonicalSolution(workspace, parsed as unknown as Scenariosourcesolution);
}
