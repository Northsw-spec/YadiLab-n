import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import { canonicalTroubleshootingJson } from "../../../observation-engine/src/index.js";
import { semanticSourceDiff, type SourceDiffDomain, type SourceDiffKind, type SourceDiffRecord } from "./revision-diff.js";

export const CHANGE_SET_VERSION = "0.1.0" as const;
export type ChangeSetStatus = "CURRENT" | "STALE";

export interface CanonicalChangeSet {
  readonly formatId: "infrastructure-cyber-lab.change-set";
  readonly schemaVersion: "0.1.0";
  readonly changeSetId: string;
  readonly scenarioId: string;
  readonly baseSourceIdentity: string;
  readonly targetSourceIdentity: string;
  readonly baseRevision: number;
  readonly targetRevision: number;
  readonly sourceDiff: readonly SourceDiffRecord[];
  readonly targetSource: ScenarioSource;
  readonly status: ChangeSetStatus;
  readonly identity: string;
}

export type ChangeSetApplyResult = { readonly ok: true; readonly source: ScenarioSource; readonly sourceIdentity: string } | { readonly ok: false; readonly diagnostics: readonly string[] };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hash = async (value: unknown): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalTroubleshootingJson(value)));
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("");
};
export async function computeCanonicalSourceIdentity(source: ScenarioSource): Promise<string> { return hash(source); }
function identityProjection(value: CanonicalChangeSet): unknown { const { changeSetId: _id, identity: _identity, ...rest } = value; return rest; }
export async function computeChangeSetIdentity(value: CanonicalChangeSet): Promise<string> { return hash(identityProjection(value)); }

export async function generateChangeSet(args: {
  readonly baseSource: ScenarioSource;
  readonly targetSource: ScenarioSource;
  readonly baseRevision: number;
  readonly targetRevision: number;
}): Promise<CanonicalChangeSet> {
  if (args.baseSource.scenarioId !== args.targetSource.scenarioId) throw new Error("CHANGE_SET_SCENARIO_MISMATCH");
  const baseSourceIdentity = await computeCanonicalSourceIdentity(args.baseSource);
  const targetSourceIdentity = await computeCanonicalSourceIdentity(args.targetSource);
  const draft = {
    formatId: "infrastructure-cyber-lab.change-set" as const, schemaVersion: CHANGE_SET_VERSION,
    changeSetId: "0".repeat(64), scenarioId: args.baseSource.scenarioId, baseSourceIdentity, targetSourceIdentity,
    baseRevision: args.baseRevision, targetRevision: args.targetRevision,
    sourceDiff: semanticSourceDiff(args.baseSource as unknown as Record<string, unknown>, args.targetSource as unknown as Record<string, unknown>),
    targetSource: clone(args.targetSource), status: "CURRENT" as const, identity: "0".repeat(64),
  } satisfies Omit<CanonicalChangeSet, "identity"> & { identity: string };
  const identity = await computeChangeSetIdentity(draft);
  return { ...draft, changeSetId: identity, identity };
}

export async function verifyChangeSet(value: unknown): Promise<{ readonly ok: true; readonly value: CanonicalChangeSet } | { readonly ok: false; readonly diagnostics: readonly string[] }> {
  if (!value || typeof value !== "object") return { ok: false, diagnostics: ["CHANGE_SET_NOT_OBJECT"] };
  const candidate = value as Partial<CanonicalChangeSet>;
  const errors: string[] = [];
  if (candidate.formatId !== "infrastructure-cyber-lab.change-set") errors.push("CHANGE_SET_FORMAT_INVALID");
  if (candidate.schemaVersion !== CHANGE_SET_VERSION) errors.push("CHANGE_SET_VERSION_UNSUPPORTED");
  if (!candidate.baseSourceIdentity || !candidate.targetSourceIdentity || !candidate.targetSource || !Array.isArray(candidate.sourceDiff)) errors.push("CHANGE_SET_REQUIRED_FIELDS_MISSING");
  if (candidate.targetSource && candidate.scenarioId !== candidate.targetSource.scenarioId) errors.push("CHANGE_SET_SCENARIO_MISMATCH");
  if (errors.length) return { ok: false, diagnostics: errors };
  if (await computeCanonicalSourceIdentity(candidate.targetSource as ScenarioSource) !== candidate.targetSourceIdentity) errors.push("CHANGE_SET_TARGET_INTEGRITY_FAILED");
  if (await computeChangeSetIdentity(candidate as CanonicalChangeSet) !== candidate.identity) errors.push("CHANGE_SET_IDENTITY_FAILED");
  return errors.length ? { ok: false, diagnostics: errors } : { ok: true, value: clone(candidate as CanonicalChangeSet) };
}

export async function getChangeSetStatus(value: CanonicalChangeSet, currentTargetSource: ScenarioSource): Promise<ChangeSetStatus> {
  return (await computeCanonicalSourceIdentity(currentTargetSource)) === value.targetSourceIdentity ? "CURRENT" : "STALE";
}
export async function markChangeSetStatus(value: CanonicalChangeSet, currentTargetSource: ScenarioSource): Promise<CanonicalChangeSet> {
  return { ...clone(value), status: await getChangeSetStatus(value, currentTargetSource) };
}
export async function applyChangeSet(value: CanonicalChangeSet, currentBaseSource: ScenarioSource): Promise<ChangeSetApplyResult> {
  const actual = await computeCanonicalSourceIdentity(currentBaseSource);
  if (actual !== value.baseSourceIdentity) return { ok: false, diagnostics: ["CHANGE_SET_BASE_IDENTITY_MISMATCH", "CHANGE_SET_APPLY_BLOCKED"] };
  const targetIdentity = await computeCanonicalSourceIdentity(value.targetSource);
  if (targetIdentity !== value.targetSourceIdentity) return { ok: false, diagnostics: ["CHANGE_SET_TARGET_INTEGRITY_FAILED"] };
  return { ok: true, source: clone(value.targetSource), sourceIdentity: targetIdentity };
}
export function exportChangeSet(value: CanonicalChangeSet): string { return `${JSON.stringify(value, null, 2)}\n`; }
export async function importChangeSet(text: string): Promise<{ readonly ok: true; readonly value: CanonicalChangeSet } | { readonly ok: false; readonly diagnostics: readonly string[] }> {
  try { return verifyChangeSet(JSON.parse(text) as unknown); } catch { return { ok: false, diagnostics: ["CHANGE_SET_JSON_INVALID"] }; }
}
export type { SourceDiffDomain, SourceDiffKind };
