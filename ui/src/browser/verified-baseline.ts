import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import { canonicalTroubleshootingJson } from "../../../observation-engine/src/index.js";

export const VERIFIED_BASELINE_VERSION = "0.1.0" as const;
export type VerifiedBaselineOriginType = "CASE_BASELINE" | "CASE_WORKING_COPY" | "EXPERIMENT_SOURCE" | "PROMOTED_CASE_WORKING_COPY" | "CANONICAL_SCENARIO";
export type VerifiedBaselineStatus = "VERIFIED SNAPSHOT" | "ARCHIVED";

export interface VerifiedBaselineEvidenceReference {
  readonly suiteId?: string;
  readonly suiteRunId?: string;
  readonly sourceIdentity: string;
  readonly sourceRevision: number;
  readonly historical: true;
}

export interface VerifiedBaseline {
  readonly formatId: "infrastructure-cyber-lab.verified-baseline";
  readonly schemaVersion: "0.1.0";
  readonly baselineId: string;
  readonly title: string;
  readonly description: string;
  readonly canonicalSourceSnapshot: ScenarioSource;
  readonly canonicalSourceIdentity: string;
  readonly sourceSchemaVersion: string;
  readonly originType: VerifiedBaselineOriginType;
  readonly originId: string;
  readonly createdSequence: number;
  readonly verificationEvidence?: VerifiedBaselineEvidenceReference;
  readonly userNotes: readonly string[];
  readonly status: VerifiedBaselineStatus;
  readonly integrity: { readonly sourceSha256: string; readonly baselineSha256: string };
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hash = async (value: unknown): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalTroubleshootingJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
const sourceHash = (source: ScenarioSource): Promise<string> => hash(source);
function baselineProjection(value: VerifiedBaseline): unknown {
  const { baselineId: _baselineId, integrity: _integrity, ...rest } = value;
  return rest;
}
const baselineHash = (value: VerifiedBaseline): Promise<string> => hash(baselineProjection(value));

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) freeze(item);
  }
  return value;
}

export async function computeVerifiedBaselineSourceIdentity(source: ScenarioSource): Promise<string> { return sourceHash(source); }
export async function computeVerifiedBaselineIdentity(value: VerifiedBaseline): Promise<string> { return baselineHash(value); }

export async function createVerifiedBaseline(args: {
  readonly source: ScenarioSource;
  readonly title: string;
  readonly description?: string;
  readonly originType: VerifiedBaselineOriginType;
  readonly originId: string;
  readonly createdSequence?: number;
  readonly verificationEvidence?: VerifiedBaselineEvidenceReference;
  readonly userNotes?: readonly string[];
}): Promise<VerifiedBaseline> {
  if (!args.title.trim()) throw new Error("VERIFIED_BASELINE_TITLE_REQUIRED");
  if (!args.originId.trim()) throw new Error("VERIFIED_BASELINE_ORIGIN_REQUIRED");
  const snapshot = clone(args.source);
  const canonicalSourceIdentity = await sourceHash(snapshot);
  const draft = {
    formatId: "infrastructure-cyber-lab.verified-baseline" as const,
    schemaVersion: VERIFIED_BASELINE_VERSION,
    baselineId: "0".repeat(64),
    title: args.title,
    description: args.description ?? "",
    canonicalSourceSnapshot: snapshot,
    canonicalSourceIdentity,
    sourceSchemaVersion: snapshot.schemaVersion,
    originType: args.originType,
    originId: args.originId,
    createdSequence: args.createdSequence ?? 1,
    ...(args.verificationEvidence ? { verificationEvidence: clone(args.verificationEvidence) } : {}),
    userNotes: [...(args.userNotes ?? [])],
    status: "VERIFIED SNAPSHOT" as const,
    integrity: { sourceSha256: canonicalSourceIdentity, baselineSha256: "0".repeat(64) },
  } satisfies Omit<VerifiedBaseline, "baselineId" | "integrity"> & { baselineId: string; integrity: VerifiedBaseline["integrity"] };
  const baselineId = await baselineHash(draft as VerifiedBaseline);
  const result = { ...draft, baselineId, integrity: { sourceSha256: canonicalSourceIdentity, baselineSha256: baselineId } };
  return freeze(result);
}

export async function verifyVerifiedBaseline(value: unknown): Promise<{ readonly ok: true; readonly value: VerifiedBaseline } | { readonly ok: false; readonly diagnostics: readonly string[] }> {
  if (!value || typeof value !== "object") return { ok: false, diagnostics: ["VERIFIED_BASELINE_NOT_OBJECT"] };
  const candidate = value as Partial<VerifiedBaseline>;
  const errors: string[] = [];
  if (candidate.formatId !== "infrastructure-cyber-lab.verified-baseline") errors.push("VERIFIED_BASELINE_FORMAT_INVALID");
  if (candidate.schemaVersion !== VERIFIED_BASELINE_VERSION) errors.push("VERIFIED_BASELINE_VERSION_UNSUPPORTED");
  if (!candidate.canonicalSourceSnapshot || typeof candidate.canonicalSourceIdentity !== "string") errors.push("VERIFIED_BASELINE_SOURCE_MISSING");
  if (!candidate.title || !candidate.originId || !candidate.originType) errors.push("VERIFIED_BASELINE_METADATA_MISSING");
  if (!candidate.integrity || candidate.integrity.sourceSha256 !== candidate.canonicalSourceIdentity) errors.push("VERIFIED_BASELINE_SOURCE_INTEGRITY_METADATA_INVALID");
  if (candidate.verificationEvidence && (candidate.verificationEvidence.historical !== true || candidate.verificationEvidence.sourceIdentity !== candidate.canonicalSourceIdentity || !Number.isInteger(candidate.verificationEvidence.sourceRevision) || candidate.verificationEvidence.sourceRevision < 0)) errors.push("VERIFIED_BASELINE_EVIDENCE_NOT_HISTORICAL_OR_BOUND");
  if (errors.length) return { ok: false, diagnostics: errors };
  const source = candidate.canonicalSourceSnapshot as ScenarioSource;
  if (await sourceHash(source) !== candidate.canonicalSourceIdentity) errors.push("VERIFIED_BASELINE_SOURCE_HASH_MISMATCH");
  if (await baselineHash(candidate as VerifiedBaseline) !== candidate.baselineId) errors.push("VERIFIED_BASELINE_IDENTITY_MISMATCH");
  if (candidate.integrity?.baselineSha256 !== candidate.baselineId) errors.push("VERIFIED_BASELINE_INTEGRITY_HASH_MISMATCH");
  return errors.length ? { ok: false, diagnostics: [...new Set(errors)] } : { ok: true, value: freeze(clone(candidate as VerifiedBaseline)) };
}

export function inspectVerifiedBaseline(value: VerifiedBaseline): Readonly<Record<string, unknown>> {
  return { baselineId: value.baselineId, title: value.title, status: value.status, sourceIdentity: value.canonicalSourceIdentity, originType: value.originType, originId: value.originId, verificationEvidence: value.verificationEvidence ?? null };
}

export async function archiveVerifiedBaseline(value: VerifiedBaseline): Promise<VerifiedBaseline> {
  const checked = await verifyVerifiedBaseline(value);
  if (!checked.ok) throw new Error(checked.diagnostics.join(","));
  return createVerifiedBaseline({ source: checked.value.canonicalSourceSnapshot, title: checked.value.title, description: checked.value.description, originType: checked.value.originType, originId: checked.value.originId, createdSequence: checked.value.createdSequence, ...(checked.value.verificationEvidence ? { verificationEvidence: checked.value.verificationEvidence } : {}), userNotes: checked.value.userNotes }).then((next) => ({ ...next, baselineId: checked.value.baselineId, status: "ARCHIVED", integrity: checked.value.integrity }));
}

export async function reproduceVerifiedBaseline(value: VerifiedBaseline, runner: (source: ScenarioSource) => Promise<unknown>): Promise<{ readonly ok: true; readonly result: unknown; readonly sourceIdentity: string } | { readonly ok: false; readonly diagnostics: readonly string[] }> {
  const checked = await verifyVerifiedBaseline(value);
  if (!checked.ok) return checked;
  return { ok: true, result: await runner(clone(checked.value.canonicalSourceSnapshot)), sourceIdentity: checked.value.canonicalSourceIdentity };
}

export function exportVerifiedBaseline(value: VerifiedBaseline): string { return `${JSON.stringify(value, null, 2)}\n`; }
export async function importVerifiedBaseline(text: string): Promise<{ readonly ok: true; readonly value: VerifiedBaseline } | { readonly ok: false; readonly diagnostics: readonly string[] }> {
  try { return verifyVerifiedBaseline(JSON.parse(text) as unknown); } catch { return { ok: false, diagnostics: ["VERIFIED_BASELINE_JSON_INVALID"] }; }
}
