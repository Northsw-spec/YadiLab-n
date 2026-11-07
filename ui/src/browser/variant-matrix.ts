import { canonicalTroubleshootingJson } from "../../../observation-engine/src/index.js";
import type { EvidenceWorkspace } from "./evidence.js";
import { openRunPairDiff, type MultiRunRecord } from "./multi-run.js";
import type { CanonicalChangeSet } from "./change-set.js";
import type { VerificationAssertion, VerificationResultStatus, VerificationSuite, VerificationSuiteRun } from "./verification-suite.js";

export const VARIANT_MATRIX_VERSION = "0.1.0" as const;
export type MatrixVariantKind = "ANCESTOR" | "EXPERIMENT";
export type MatrixDisplayStatus = VerificationResultStatus | "HISTORICAL";
export interface VariantMatrixVariant {
  readonly variantId: string;
  readonly kind: MatrixVariantKind;
  readonly title: string;
  readonly experimentId?: string;
  readonly sourceIdentity: string;
  readonly sourceRevision: number;
  readonly changeSet?: Pick<CanonicalChangeSet, "changeSetId" | "baseSourceIdentity" | "targetSourceIdentity" | "sourceDiff">;
  readonly suiteRuns: readonly VerificationSuiteRun[];
}
export interface VariantMatrixRow {
  readonly rowId: string;
  readonly variantId: string;
  readonly variantKind: MatrixVariantKind;
  readonly variantTitle: string;
  readonly sourceIdentity: string;
  readonly sourceRevision: number;
  readonly assertionId: string;
  readonly flowId: string;
  readonly expected: string;
  readonly actual: string;
  readonly result: VerificationResultStatus;
  readonly displayStatus: MatrixDisplayStatus;
  readonly current: boolean;
  readonly runId?: string;
  readonly evidence?: EvidenceWorkspace;
}
export interface VariantMatrix {
  readonly formatId: "infrastructure-cyber-lab.variant-matrix";
  readonly schemaVersion: "0.1.0";
  readonly matrixId: string;
  readonly caseId: string;
  readonly suiteId: string;
  readonly suiteIdentity: string;
  readonly ancestor: VariantMatrixVariant;
  readonly experiments: readonly VariantMatrixVariant[];
  readonly rows: readonly VariantMatrixRow[];
  readonly identity: string;
}
export interface MatrixFilters { readonly results?: readonly MatrixDisplayStatus[]; readonly flowId?: string; readonly variantId?: string; }
export interface MatrixSelection { readonly variantId: string; readonly rowId?: string; readonly runId?: string; readonly assertionId?: string; }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
async function hash(value: unknown): Promise<string> { const d = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalTroubleshootingJson(value))); return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join(""); }
function identityProjection(value: VariantMatrix): unknown { const { matrixId: _id, identity: _identity, ...rest } = value; return rest; }
export async function computeVariantMatrixIdentity(value: VariantMatrix): Promise<string> { return hash(identityProjection(value)); }
function isRunForCurrentSource(run: VerificationSuiteRun, variant: VariantMatrixVariant, suite: VerificationSuite): boolean { return run.sourceIdentity === variant.sourceIdentity && run.sourceRevision === variant.sourceRevision && run.suiteId === suite.suiteId && run.runId.startsWith(`${suite.identity}:`); }
function latestHistoricalRun(variant: VariantMatrixVariant, suite: VerificationSuite): VerificationSuiteRun | undefined { return [...variant.suiteRuns].reverse().find((run) => run.suiteId === suite.suiteId); }
function rowsForVariant(variant: VariantMatrixVariant, suite: VerificationSuite): readonly VariantMatrixRow[] {
  const currentRun = [...variant.suiteRuns].reverse().find((run) => isRunForCurrentSource(run, variant, suite));
  const historicalRun = currentRun ?? latestHistoricalRun(variant, suite);
  const resultByAssertion = new Map((historicalRun?.results ?? []).map((result) => [result.assertionId, result]));
  return suite.assertions.slice().sort((a, b) => a.order - b.order).map((assertion: VerificationAssertion) => {
    const result = resultByAssertion.get(assertion.assertionId);
    const current = Boolean(currentRun && result && result.sourceIdentity === variant.sourceIdentity && result.sourceRevision === variant.sourceRevision);
    return {
      rowId: `${variant.variantId}:${suite.identity}:${assertion.assertionId}`,
      variantId: variant.variantId, variantKind: variant.kind, variantTitle: variant.title,
      sourceIdentity: variant.sourceIdentity, sourceRevision: variant.sourceRevision,
      assertionId: assertion.assertionId, flowId: assertion.flowId, expected: result?.expected ?? assertion.expected,
      actual: result?.actual ?? "NOT RUN", result: result?.result ?? "NOT RUN", displayStatus: result && !current ? "HISTORICAL" : result?.result ?? "NOT RUN", current,
      ...(result?.runId === undefined ? {} : { runId: result.runId }), ...(result?.evidence === undefined ? {} : { evidence: result.evidence }),
    };
  });
}
export async function buildVariantMatrix(args: { readonly caseId: string; readonly suite: VerificationSuite; readonly ancestor: Omit<VariantMatrixVariant, "kind">; readonly experiments: readonly Omit<VariantMatrixVariant, "kind">[] }): Promise<VariantMatrix> {
  const variants: readonly VariantMatrixVariant[] = [{ ...clone(args.ancestor), kind: "ANCESTOR" }, ...args.experiments.map((item) => ({ ...clone(item), kind: "EXPERIMENT" as const }))];
  if (variants.length < 4) throw new Error("VARIANT_MATRIX_REQUIRES_ANCESTOR_AND_THREE_EXPERIMENTS");
  if (new Set(variants.map((item) => item.variantId)).size !== variants.length) throw new Error("VARIANT_MATRIX_DUPLICATE_VARIANT_ID");
  if (new Set(variants.map((item) => item.sourceIdentity)).size !== variants.length) throw new Error("VARIANT_MATRIX_SOURCE_IDENTITY_COLLISION");
  if (variants.some((item) => item.kind === "ANCESTOR" && item.experimentId !== undefined)) throw new Error("VARIANT_MATRIX_ANCESTOR_EXPERIMENT_ID");
  const rows = variants.flatMap((variant) => rowsForVariant(variant, args.suite));
  const draft = { formatId: "infrastructure-cyber-lab.variant-matrix" as const, schemaVersion: VARIANT_MATRIX_VERSION, matrixId: "0".repeat(64), caseId: args.caseId, suiteId: args.suite.suiteId, suiteIdentity: args.suite.identity, ancestor: variants[0] as VariantMatrixVariant, experiments: variants.slice(1), rows, identity: "0".repeat(64) };
  const identity = await computeVariantMatrixIdentity(draft as VariantMatrix); return { ...draft, matrixId: identity, identity };
}
export function filterVariantMatrix(matrix: VariantMatrix, filters: MatrixFilters = {}): readonly VariantMatrixRow[] { return matrix.rows.filter((row) => (!filters.results?.length || filters.results.includes(row.displayStatus)) && (!filters.flowId || row.flowId === filters.flowId) && (!filters.variantId || row.variantId === filters.variantId)); }
export function summarizeVariantMatrix(matrix: VariantMatrix): Readonly<Record<VerificationResultStatus, number>> { const counts: Record<VerificationResultStatus, number> = { PASS: 0, FAIL: 0, UNMODELED: 0, "NOT RUN": 0, "NOT COMPARABLE": 0 }; for (const row of matrix.rows) if (row.current) counts[row.result] += 1; return counts; }
export function selectMatrixVariant(matrix: VariantMatrix, variantId: string): MatrixSelection { if (![matrix.ancestor, ...matrix.experiments].some((variant) => variant.variantId === variantId)) throw new Error("VARIANT_MATRIX_UNKNOWN_VARIANT"); return { variantId }; }
export function selectMatrixResult(matrix: VariantMatrix, rowId: string): MatrixSelection { const row = matrix.rows.find((item) => item.rowId === rowId); if (!row) throw new Error("VARIANT_MATRIX_UNKNOWN_RESULT"); return { variantId: row.variantId, rowId: row.rowId, ...(row.runId === undefined ? {} : { runId: row.runId }), assertionId: row.assertionId }; }
export function matrixRowEvidence(matrix: VariantMatrix, rowId: string): EvidenceWorkspace { const row = matrix.rows.find((item) => item.rowId === rowId); if (!row) throw new Error("VARIANT_MATRIX_UNKNOWN_RESULT"); if (!row.evidence) throw new Error("VARIANT_MATRIX_EVIDENCE_UNAVAILABLE"); return row.evidence; }
export function compareVariantRuns(a: MultiRunRecord, b: MultiRunRecord): ReturnType<typeof openRunPairDiff> { return openRunPairDiff(a, b); }
export function variantById(matrix: VariantMatrix, variantId: string): VariantMatrixVariant { const variant = [matrix.ancestor, ...matrix.experiments].find((item) => item.variantId === variantId); if (!variant) throw new Error("VARIANT_MATRIX_UNKNOWN_VARIANT"); return variant; }
export function exportVariantMatrix(value: VariantMatrix): string { return `${JSON.stringify(value, null, 2)}\n`; }
export type { VerificationResultStatus };
