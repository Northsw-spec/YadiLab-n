import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import { canonicalTroubleshootingJson } from "../../../observation-engine/src/index.js";
import type { EvidenceRecord, EvidenceWorkspace } from "./evidence.js";

export const TROUBLESHOOTING_CASE_VERSION = "0.1.0" as const;
export type TroubleshootingCaseStatus = "OPEN" | "RESOLVED" | "ARCHIVED";
export type TroubleshootingBookmarkKind = "NODE" | "EVIDENCE" | "INSPECTOR_EVENT" | "JOURNEY_STEP" | "TIMELINE" | "DIFF" | "RUN";

export interface TroubleshootingBookmark { readonly bookmarkId: string; readonly kind: TroubleshootingBookmarkKind; readonly referenceId: string; readonly label?: string; readonly createdSequence: number; }
export interface TroubleshootingUserNote { readonly noteId: string; readonly label: "USER NOTE" | "HYPOTHESIS / USER NOTE"; readonly text: string; readonly createdSequence: number; }
export interface TroubleshootingCaseRunReference {
  readonly runId: string;
  readonly scenarioHash: string;
  readonly sourceRevision: number;
  readonly runtimeRevision: number;
  readonly flowId: string;
  readonly outcome: string;
  readonly eventIds: readonly string[];
  readonly eventCount: number;
  readonly faultState: "HEALTHY" | "PREVIEW" | "APPLIED" | "ROLLED_BACK" | "UNMODELED";
  readonly archived: boolean;
}
export interface TroubleshootingCase {
  readonly formatId: "infrastructure-cyber-lab.troubleshooting-case";
  readonly schemaVersion: "0.1.0";
  readonly caseId: string;
  readonly title: string;
  readonly description: string;
  readonly status: TroubleshootingCaseStatus;
  readonly scenarioId: string;
  readonly startingSource: ScenarioSource;
  readonly startingSourceIdentity: string;
  readonly selectedFlowIds: readonly string[];
  readonly runs: readonly TroubleshootingCaseRunReference[];
  readonly bookmarks: readonly TroubleshootingBookmark[];
  readonly notes: readonly TroubleshootingUserNote[];
  readonly workingSource: ScenarioSource;
  readonly caseIdentity: string;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("");
}
function sourceProjection(source: ScenarioSource): unknown { return source; }
export async function computeCaseSourceIdentity(source: ScenarioSource): Promise<string> { return sha256(canonicalTroubleshootingJson(sourceProjection(source))); }
function caseProjection(value: TroubleshootingCase): unknown { const { caseIdentity: _identity, caseId: _caseId, ...rest } = value; return rest; }
export async function computeTroubleshootingCaseIdentity(value: TroubleshootingCase): Promise<string> { return sha256(canonicalTroubleshootingJson(caseProjection(value))); }

export async function createTroubleshootingCase(args: {
  readonly source: ScenarioSource;
  readonly title: string;
  readonly description?: string;
  readonly selectedFlowIds?: readonly string[];
}): Promise<TroubleshootingCase> {
  const source = clone(args.source);
  const startingSourceIdentity = await computeCaseSourceIdentity(source);
  const draft: TroubleshootingCase = {
    formatId: "infrastructure-cyber-lab.troubleshooting-case", schemaVersion: TROUBLESHOOTING_CASE_VERSION,
    caseId: "0".repeat(64), title: args.title, description: args.description ?? "", status: "OPEN",
    scenarioId: source.scenarioId, startingSource: source, startingSourceIdentity,
    selectedFlowIds: [...new Set(args.selectedFlowIds ?? [])].sort(), runs: [], bookmarks: [], notes: [], workingSource: clone(source), caseIdentity: "0".repeat(64),
  };
  const caseIdentity = await computeTroubleshootingCaseIdentity(draft);
  const caseId = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : caseIdentity;
  return { ...draft, caseId, caseIdentity };
}

export async function verifyTroubleshootingCase(value: unknown): Promise<{ readonly ok: true; readonly value: TroubleshootingCase } | { readonly ok: false; readonly diagnostics: readonly string[] }> {
  if (!value || typeof value !== "object") return { ok: false, diagnostics: ["CASE_NOT_OBJECT"] };
  const candidate = value as Partial<TroubleshootingCase>;
  const diagnostics: string[] = [];
  if (candidate.formatId !== "infrastructure-cyber-lab.troubleshooting-case") diagnostics.push("CASE_FORMAT_INVALID");
  if (candidate.schemaVersion !== TROUBLESHOOTING_CASE_VERSION) diagnostics.push("CASE_VERSION_UNSUPPORTED");
  if (!candidate.startingSource || !candidate.workingSource || !Array.isArray(candidate.runs) || !Array.isArray(candidate.bookmarks) || !Array.isArray(candidate.notes)) diagnostics.push("CASE_REQUIRED_FIELDS_MISSING");
  if (candidate.startingSource && candidate.scenarioId !== candidate.startingSource.scenarioId) diagnostics.push("CASE_SCENARIO_MISMATCH");
  if (candidate.title !== undefined && typeof candidate.title !== "string") diagnostics.push("CASE_TITLE_INVALID");
  if (candidate.description !== undefined && typeof candidate.description !== "string") diagnostics.push("CASE_DESCRIPTION_INVALID");
  if (diagnostics.length) return { ok: false, diagnostics };
  const sourceIdentity = await computeCaseSourceIdentity(candidate.startingSource as ScenarioSource);
  if (sourceIdentity !== candidate.startingSourceIdentity) diagnostics.push("CASE_SOURCE_INTEGRITY_FAILED");
  const computed = await computeTroubleshootingCaseIdentity(candidate as TroubleshootingCase);
  if (computed !== candidate.caseIdentity || typeof candidate.caseId !== "string" || candidate.caseId.length < 8) diagnostics.push("CASE_IDENTITY_FAILED");
  if (diagnostics.length) return { ok: false, diagnostics };
  return { ok: true, value: clone(candidate as TroubleshootingCase) };
}

export async function setTroubleshootingCaseStatus(value: TroubleshootingCase, status: TroubleshootingCaseStatus): Promise<TroubleshootingCase> { const next = { ...clone(value), status }; return { ...next, caseIdentity: await computeTroubleshootingCaseIdentity(next) }; }
export async function addTroubleshootingCaseNote(value: TroubleshootingCase, text: string, hypothesis = false): Promise<TroubleshootingCase> {
  const note: TroubleshootingUserNote = { noteId: `note-${value.notes.length + 1}`, label: hypothesis ? "HYPOTHESIS / USER NOTE" : "USER NOTE", text, createdSequence: value.notes.length + 1 };
  const next = { ...clone(value), notes: [...value.notes, note] }; return { ...next, caseIdentity: await computeTroubleshootingCaseIdentity(next) };
}
export async function addTroubleshootingBookmark(value: TroubleshootingCase, kind: TroubleshootingBookmarkKind, referenceId: string, label?: string): Promise<TroubleshootingCase> {
  const bookmark: TroubleshootingBookmark = { bookmarkId: `bookmark-${value.bookmarks.length + 1}`, kind, referenceId, ...(label === undefined ? {} : { label }), createdSequence: value.bookmarks.length + 1 };
  const next = { ...clone(value), bookmarks: [...value.bookmarks, bookmark] }; return { ...next, caseIdentity: await computeTroubleshootingCaseIdentity(next) };
}
export async function replaceTroubleshootingCaseWorkingSource(value: TroubleshootingCase, source: ScenarioSource): Promise<TroubleshootingCase> {
  if (source.scenarioId !== value.scenarioId) throw new Error("CASE_WORKING_SOURCE_SCENARIO_MISMATCH");
  const next = { ...clone(value), workingSource: clone(source) }; return { ...next, caseIdentity: await computeTroubleshootingCaseIdentity(next) };
}
export async function resetTroubleshootingCase(value: TroubleshootingCase): Promise<TroubleshootingCase> {
  const next = { ...clone(value), workingSource: clone(value.startingSource) }; return { ...next, caseIdentity: await computeTroubleshootingCaseIdentity(next) };
}
export async function attachCaseRun(value: TroubleshootingCase, evidence: EvidenceWorkspace, sourceRevision: number, faultState: TroubleshootingCaseRunReference["faultState"] = "UNMODELED"): Promise<TroubleshootingCase> {
  const run: TroubleshootingCaseRunReference = { runId: `${evidence.scenarioHash}:${evidence.runtimeRevision}:${evidence.flowId}`, scenarioHash: evidence.scenarioHash, sourceRevision, runtimeRevision: evidence.runtimeRevision, flowId: evidence.flowId, outcome: evidence.outcome.kind, eventIds: evidence.records.map((record) => record.eventId), eventCount: evidence.records.length, faultState, archived: true };
  const next = { ...clone(value), runs: [...value.runs.filter((item) => item.runId !== run.runId), run] }; return { ...next, caseIdentity: await computeTroubleshootingCaseIdentity(next) };
}
export function resolveCaseBookmark(value: TroubleshootingCase, bookmark: TroubleshootingBookmark): { readonly available: true; readonly referenceId: string } | { readonly available: false; readonly label: "UNAVAILABLE / HISTORICAL REFERENCE" } {
  const available = bookmark.kind === "RUN" ? value.runs.some((run) => run.runId === bookmark.referenceId) : bookmark.kind === "EVIDENCE" || bookmark.kind === "INSPECTOR_EVENT" ? value.runs.some((run) => run.eventIds.includes(bookmark.referenceId)) : true;
  return available ? { available: true, referenceId: bookmark.referenceId } : { available: false, label: "UNAVAILABLE / HISTORICAL REFERENCE" };
}
export function buildInvestigationIndex(value: TroubleshootingCase): { readonly bookmarks: readonly TroubleshootingBookmark[]; readonly notes: readonly TroubleshootingUserNote[]; readonly runCount: number; readonly userNoteCount: number } { return { bookmarks: [...value.bookmarks].sort((a, b) => a.createdSequence - b.createdSequence), notes: [...value.notes].sort((a, b) => a.createdSequence - b.createdSequence), runCount: value.runs.length, userNoteCount: value.notes.length }; }
export function exportTroubleshootingCase(value: TroubleshootingCase): string { return `${JSON.stringify(value, null, 2)}\n`; }
export async function importTroubleshootingCase(text: string): Promise<{ readonly ok: true; readonly value: TroubleshootingCase } | { readonly ok: false; readonly diagnostics: readonly string[] }> { try { return verifyTroubleshootingCase(JSON.parse(text) as unknown); } catch { return { ok: false, diagnostics: ["CASE_JSON_INVALID"] }; } }
