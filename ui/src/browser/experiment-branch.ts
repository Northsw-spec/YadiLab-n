import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import { canonicalTroubleshootingJson } from "../../../observation-engine/src/index.js";
import type { EvidenceWorkspace } from "./evidence.js";
import type { TroubleshootingCase, TroubleshootingCaseRunReference } from "./troubleshooting-case.js";

export const EXPERIMENT_BRANCH_VERSION = "0.1.0" as const;
export type ExperimentBranchStatus = "DRAFT" | "TESTED" | "PROMOTED" | "ARCHIVED";
export type ExperimentForkSource = "BASELINE" | "CURRENT_WORKING_COPY";
export interface ExperimentBranch {
  readonly formatId: "infrastructure-cyber-lab.experiment-branch";
  readonly schemaVersion: "0.1.0";
  readonly experimentId: string;
  readonly title: string;
  readonly description: string;
  readonly parentCaseId?: string;
  readonly scenarioId: string;
  readonly forkSource: ExperimentForkSource;
  readonly ancestorRevision: number;
  readonly ancestorSource: ScenarioSource;
  readonly ancestorSourceIdentity: string;
  readonly workingSource: ScenarioSource;
  readonly workingSourceIdentity: string;
  readonly selectedFlowIds: readonly string[];
  readonly runs: readonly TroubleshootingCaseRunReference[];
  readonly notes: readonly string[];
  readonly status: ExperimentBranchStatus;
  readonly createdSequence: number;
  readonly branchIdentity: string;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
async function digest(value: unknown): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalTroubleshootingJson(value)));
  return Array.from(new Uint8Array(hash), (item) => item.toString(16).padStart(2, "0")).join("");
}
export async function computeExperimentSourceIdentity(source: ScenarioSource): Promise<string> { return digest(source); }
function branchProjection(value: ExperimentBranch): unknown { const { experimentId: _id, branchIdentity: _identity, ...rest } = value; return rest; }
export async function computeExperimentBranchIdentity(value: ExperimentBranch): Promise<string> { return digest(branchProjection(value)); }
function withIdentity(value: ExperimentBranch): Promise<ExperimentBranch> { return computeExperimentBranchIdentity(value).then((branchIdentity) => ({ ...value, branchIdentity })); }

export async function createExperimentBranch(args: {
  readonly source: ScenarioSource;
  readonly title: string;
  readonly description?: string;
  readonly parentCaseId?: string;
  readonly forkSource?: ExperimentForkSource;
  readonly ancestorRevision?: number;
  readonly selectedFlowIds?: readonly string[];
}): Promise<ExperimentBranch> {
  const source = clone(args.source);
  const ancestorSourceIdentity = await computeExperimentSourceIdentity(source);
  const draft = {
    formatId: "infrastructure-cyber-lab.experiment-branch" as const,
    schemaVersion: EXPERIMENT_BRANCH_VERSION,
    experimentId: typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `experiment-${Date.now()}`,
    title: args.title,
    description: args.description ?? "",
    ...(args.parentCaseId === undefined ? {} : { parentCaseId: args.parentCaseId }),
    scenarioId: source.scenarioId,
    forkSource: args.forkSource ?? "BASELINE",
    ancestorRevision: args.ancestorRevision ?? 0,
    ancestorSource: source,
    ancestorSourceIdentity,
    workingSource: clone(source),
    workingSourceIdentity: ancestorSourceIdentity,
    selectedFlowIds: [...new Set(args.selectedFlowIds ?? [])].sort(),
    runs: [],
    notes: [],
    status: "DRAFT" as const,
    createdSequence: 1,
    branchIdentity: "0".repeat(64),
  } satisfies Omit<ExperimentBranch, "branchIdentity"> & { branchIdentity: string };
  return withIdentity(draft);
}

export async function forkExperimentFromCase(args: {
  readonly value: TroubleshootingCase;
  readonly title: string;
  readonly forkSource: ExperimentForkSource;
  readonly selectedFlowIds?: readonly string[];
}): Promise<ExperimentBranch> {
  const source = args.forkSource === "BASELINE" ? args.value.startingSource : args.value.workingSource;
  return createExperimentBranch({ source, title: args.title, parentCaseId: args.value.caseId, forkSource: args.forkSource, ancestorRevision: args.forkSource === "BASELINE" ? 0 : 1, selectedFlowIds: args.selectedFlowIds ?? args.value.selectedFlowIds });
}

export async function verifyExperimentBranch(value: unknown): Promise<{ readonly ok: true; readonly value: ExperimentBranch } | { readonly ok: false; readonly diagnostics: readonly string[] }> {
  if (!value || typeof value !== "object") return { ok: false, diagnostics: ["EXPERIMENT_NOT_OBJECT"] };
  const candidate = value as Partial<ExperimentBranch>;
  const diagnostics: string[] = [];
  if (candidate.formatId !== "infrastructure-cyber-lab.experiment-branch") diagnostics.push("EXPERIMENT_FORMAT_INVALID");
  if (candidate.schemaVersion !== EXPERIMENT_BRANCH_VERSION) diagnostics.push("EXPERIMENT_VERSION_UNSUPPORTED");
  if (!candidate.ancestorSource || !candidate.workingSource || !Array.isArray(candidate.runs) || !Array.isArray(candidate.selectedFlowIds)) diagnostics.push("EXPERIMENT_REQUIRED_FIELDS_MISSING");
  if (candidate.ancestorSource && candidate.scenarioId !== candidate.ancestorSource.scenarioId) diagnostics.push("EXPERIMENT_ANCESTOR_SCENARIO_MISMATCH");
  if (candidate.workingSource && candidate.scenarioId !== candidate.workingSource.scenarioId) diagnostics.push("EXPERIMENT_WORKING_SCENARIO_MISMATCH");
  if (diagnostics.length) return { ok: false, diagnostics };
  if (await computeExperimentSourceIdentity(candidate.ancestorSource as ScenarioSource) !== candidate.ancestorSourceIdentity) diagnostics.push("EXPERIMENT_ANCESTOR_INTEGRITY_FAILED");
  if (await computeExperimentSourceIdentity(candidate.workingSource as ScenarioSource) !== candidate.workingSourceIdentity) diagnostics.push("EXPERIMENT_WORKING_INTEGRITY_FAILED");
  if (await computeExperimentBranchIdentity(candidate as ExperimentBranch) !== candidate.branchIdentity) diagnostics.push("EXPERIMENT_IDENTITY_FAILED");
  if (diagnostics.length) return { ok: false, diagnostics };
  return { ok: true, value: clone(candidate as ExperimentBranch) };
}

export async function replaceExperimentWorkingSource(value: ExperimentBranch, source: ScenarioSource): Promise<ExperimentBranch> {
  if (source.scenarioId !== value.scenarioId) throw new Error("EXPERIMENT_WORKING_SOURCE_SCENARIO_MISMATCH");
  return withIdentity({ ...clone(value), workingSource: clone(source), workingSourceIdentity: await computeExperimentSourceIdentity(source), status: "DRAFT" });
}
export async function resetExperimentBranch(value: ExperimentBranch): Promise<ExperimentBranch> { return replaceExperimentWorkingSource(value, value.ancestorSource); }
export async function markExperimentTested(value: ExperimentBranch): Promise<ExperimentBranch> { return withIdentity({ ...clone(value), status: "TESTED" }); }
export async function addExperimentNote(value: ExperimentBranch, note: string): Promise<ExperimentBranch> { return withIdentity({ ...clone(value), notes: [...value.notes, note] }); }
export async function attachExperimentRun(value: ExperimentBranch, evidence: EvidenceWorkspace, sourceRevision: number): Promise<ExperimentBranch> {
  const run: TroubleshootingCaseRunReference = { runId: `${evidence.scenarioHash}:${evidence.runtimeRevision}:${evidence.flowId}`, scenarioHash: evidence.scenarioHash, sourceRevision, runtimeRevision: evidence.runtimeRevision, flowId: evidence.flowId, outcome: evidence.outcome.kind, eventIds: evidence.records.map((record) => record.eventId), eventCount: evidence.records.length, faultState: "UNMODELED", archived: true };
  return withIdentity({ ...clone(value), runs: [...value.runs.filter((item) => item.runId !== run.runId), run], status: "TESTED" });
}
export async function discardExperimentBranch(value: ExperimentBranch): Promise<ExperimentBranch> { return withIdentity({ ...clone(value), status: "ARCHIVED" }); }
export function exportExperimentBranch(value: ExperimentBranch): string { return `${JSON.stringify(value, null, 2)}\n`; }
export async function importExperimentBranch(text: string): Promise<{ readonly ok: true; readonly value: ExperimentBranch } | { readonly ok: false; readonly diagnostics: readonly string[] }> { try { return verifyExperimentBranch(JSON.parse(text) as unknown); } catch { return { ok: false, diagnostics: ["EXPERIMENT_JSON_INVALID"] }; } }
