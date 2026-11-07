import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import { canonicalTroubleshootingJson } from "../../../observation-engine/src/index.js";
import type { CanonicalChangeSet } from "./change-set.js";
import { computeCanonicalSourceIdentity } from "./change-set.js";
import type { ExperimentBranch } from "./experiment-branch.js";
import type { TroubleshootingCase } from "./troubleshooting-case.js";
import type { VerificationSuite } from "./verification-suite.js";

export const PROMOTION_VERSION = "0.1.0" as const;
export type PromotionHistoryKind = "PROMOTION" | "ROLLBACK";
export interface PromotionHistoryEntry {
  readonly entryId: string;
  readonly kind: PromotionHistoryKind;
  readonly sequence: number;
  readonly caseId: string;
  readonly experimentId?: string;
  readonly sourceIdentityBefore: string;
  readonly sourceIdentityAfter: string;
  readonly sourceRevisionBefore: number;
  readonly sourceRevisionAfter: number;
}
export interface PromotionSnapshot {
  readonly snapshotId: string;
  readonly caseId: string;
  readonly source: ScenarioSource;
  readonly sourceIdentity: string;
  readonly sourceRevision: number;
  readonly integrity: string;
}
export interface PromotionPreview {
  readonly formatId: "infrastructure-cyber-lab.promotion-preview";
  readonly schemaVersion: "0.1.0";
  readonly previewId: string;
  readonly caseId: string;
  readonly experimentId: string;
  readonly experimentSourceIdentity: string;
  readonly experimentSourceRevision: number;
  readonly experimentAncestorIdentity: string;
  readonly targetWorkingSourceIdentity: string;
  readonly targetWorkingSourceRevision: number;
  readonly changeSetId: string;
  readonly changeSetIdentity: string;
  readonly changeSet: Pick<CanonicalChangeSet, "baseSourceIdentity" | "targetSourceIdentity" | "sourceDiff">;
  readonly suiteSummary?: Readonly<Record<string, number>>;
  readonly status: "ACTIVE" | "CONSUMED";
  readonly identity: string;
}
export interface PromotionState {
  readonly caseValue: TroubleshootingCase;
  readonly workingRevision: number;
  readonly preview: PromotionPreview;
  readonly snapshot: PromotionSnapshot;
  readonly history: readonly PromotionHistoryEntry[];
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalTroubleshootingJson(value));
  const result = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result), (item) => item.toString(16).padStart(2, "0")).join("");
}
async function assertCurrentExperiment(experiment: ExperimentBranch): Promise<string> {
  if (!experiment.experimentId || !experiment.workingSourceIdentity) throw new Error("PROMOTION_UNKNOWN_EXPERIMENT_SOURCE");
  const actual = await computeCanonicalSourceIdentity(experiment.workingSource);
  if (actual !== experiment.workingSourceIdentity) throw new Error("PROMOTION_EXPERIMENT_SOURCE_INTEGRITY_FAILED");
  if (experiment.status === "ARCHIVED") throw new Error("PROMOTION_ARCHIVED_EXPERIMENT_BLOCKED");
  return actual;
}
export async function createPromotionPreview(args: {
  readonly caseValue: TroubleshootingCase;
  readonly caseWorkingRevision: number;
  readonly experiment: ExperimentBranch;
  readonly changeSet: CanonicalChangeSet;
  readonly suiteSummary?: Readonly<Record<string, number>>;
}): Promise<PromotionPreview> {
  const target = await assertCurrentExperiment(args.experiment);
  const currentCase = await computeCanonicalSourceIdentity(args.caseValue.workingSource);
  if (!currentCase) throw new Error("PROMOTION_UNKNOWN_TARGET_SOURCE");
  if (args.changeSet.baseSourceIdentity !== currentCase) throw new Error("PROMOTION_CHANGE_SET_TARGET_BASE_MISMATCH");
  if (args.changeSet.targetSourceIdentity !== target) throw new Error("PROMOTION_CHANGE_SET_TARGET_STALE");
  if (args.experiment.ancestorSourceIdentity !== args.changeSet.baseSourceIdentity) throw new Error("PROMOTION_ANCESTOR_LINEAGE_MISMATCH");
  const draft = {
    formatId: "infrastructure-cyber-lab.promotion-preview" as const,
    schemaVersion: PROMOTION_VERSION,
    previewId: "0".repeat(64), caseId: args.caseValue.caseId, experimentId: args.experiment.experimentId,
    experimentSourceIdentity: target, experimentSourceRevision: args.experiment.ancestorRevision + 1,
    experimentAncestorIdentity: args.experiment.ancestorSourceIdentity,
    targetWorkingSourceIdentity: currentCase, targetWorkingSourceRevision: args.caseWorkingRevision,
    changeSetId: args.changeSet.changeSetId, changeSetIdentity: args.changeSet.identity,
    changeSet: { baseSourceIdentity: args.changeSet.baseSourceIdentity, targetSourceIdentity: args.changeSet.targetSourceIdentity, sourceDiff: clone(args.changeSet.sourceDiff) },
    ...(args.suiteSummary === undefined ? {} : { suiteSummary: clone(args.suiteSummary) }), status: "ACTIVE" as const, identity: "0".repeat(64),
  };
  const identity = await digest(draft);
  return { ...draft, previewId: identity, identity };
}
export async function validatePromotionPreview(args: { readonly preview: PromotionPreview; readonly caseValue: TroubleshootingCase; readonly caseWorkingRevision: number; readonly experiment: ExperimentBranch }): Promise<void> {
  if (args.preview.status !== "ACTIVE") throw new Error("PROMOTION_PREVIEW_ALREADY_CONSUMED");
  if (args.preview.caseId !== args.caseValue.caseId) throw new Error("PROMOTION_PREVIEW_CASE_MISMATCH");
  if (args.preview.experimentId !== args.experiment.experimentId) throw new Error("PROMOTION_PREVIEW_EXPERIMENT_MISMATCH");
  if (args.preview.targetWorkingSourceRevision !== args.caseWorkingRevision) throw new Error("PROMOTION_TARGET_CHANGED");
  const target = await assertCurrentExperiment(args.experiment);
  const currentCase = await computeCanonicalSourceIdentity(args.caseValue.workingSource);
  if (currentCase !== args.preview.targetWorkingSourceIdentity) throw new Error("PROMOTION_TARGET_CHANGED");
  if (target !== args.preview.experimentSourceIdentity) throw new Error("PROMOTION_SOURCE_CHANGED_PREVIEW_STALE");
  if (args.preview.changeSet.targetSourceIdentity !== target || args.preview.changeSet.baseSourceIdentity !== currentCase) throw new Error("PROMOTION_PREVIEW_CHANGE_SET_STALE");
}
export async function promoteWithPreview(args: { readonly preview: PromotionPreview; readonly caseValue: TroubleshootingCase; readonly caseWorkingRevision: number; readonly experiment: ExperimentBranch; readonly history?: readonly PromotionHistoryEntry[] }): Promise<PromotionState> {
  await validatePromotionPreview(args);
  const before = await computeCanonicalSourceIdentity(args.caseValue.workingSource);
  const snapshotDraft = { snapshotId: "0".repeat(64), caseId: args.caseValue.caseId, source: clone(args.caseValue.workingSource), sourceIdentity: before, sourceRevision: args.caseWorkingRevision, integrity: "0".repeat(64) };
  const snapshotIntegrity = await digest({ caseId: snapshotDraft.caseId, source: snapshotDraft.source, sourceIdentity: snapshotDraft.sourceIdentity, sourceRevision: snapshotDraft.sourceRevision });
  const snapshot = { ...snapshotDraft, snapshotId: snapshotIntegrity, integrity: snapshotIntegrity };
  const nextCase = { ...clone(args.caseValue), workingSource: clone(args.experiment.workingSource) };
  const after = await computeCanonicalSourceIdentity(nextCase.workingSource);
  if (after !== args.preview.experimentSourceIdentity) throw new Error("PROMOTION_RESULT_IDENTITY_MISMATCH");
  const historyEntry: PromotionHistoryEntry = { entryId: `promotion-${(args.history?.length ?? 0) + 1}`, kind: "PROMOTION", sequence: (args.history?.length ?? 0) + 1, caseId: args.caseValue.caseId, experimentId: args.experiment.experimentId, sourceIdentityBefore: before, sourceIdentityAfter: after, sourceRevisionBefore: args.caseWorkingRevision, sourceRevisionAfter: args.caseWorkingRevision + 1 };
  return { caseValue: nextCase, workingRevision: args.caseWorkingRevision + 1, preview: { ...args.preview, status: "CONSUMED" }, snapshot, history: [...(args.history ?? []), historyEntry] };
}
export async function rollbackPromotion(args: { readonly state: PromotionState }): Promise<PromotionState> {
  const current = await computeCanonicalSourceIdentity(args.state.caseValue.workingSource);
  if (current !== args.state.preview.experimentSourceIdentity || args.state.workingRevision !== args.state.snapshot.sourceRevision + 1) throw new Error("ROLLBACK_CURRENT_SOURCE_DRIFTED");
  const integrity = await digest({ caseId: args.state.snapshot.caseId, source: args.state.snapshot.source, sourceIdentity: args.state.snapshot.sourceIdentity, sourceRevision: args.state.snapshot.sourceRevision });
  if (integrity !== args.state.snapshot.integrity) throw new Error("ROLLBACK_SNAPSHOT_INTEGRITY_FAILED");
  const nextCase = { ...clone(args.state.caseValue), workingSource: clone(args.state.snapshot.source) };
  const after = await computeCanonicalSourceIdentity(nextCase.workingSource);
  if (after !== args.state.snapshot.sourceIdentity) throw new Error("ROLLBACK_RESULT_IDENTITY_MISMATCH");
  const sequence = args.state.history.length + 1;
  const entry: PromotionHistoryEntry = { entryId: `rollback-${sequence}`, kind: "ROLLBACK", sequence, caseId: args.state.caseValue.caseId, experimentId: args.state.preview.experimentId, sourceIdentityBefore: current, sourceIdentityAfter: after, sourceRevisionBefore: args.state.workingRevision, sourceRevisionAfter: args.state.snapshot.sourceRevision };
  return { ...args.state, caseValue: nextCase, workingRevision: args.state.snapshot.sourceRevision, history: [...args.state.history, entry] };
}
export function exportPromotionHistory(value: readonly PromotionHistoryEntry[]): string { return `${JSON.stringify(value, null, 2)}\n`; }
export type { VerificationSuite };
