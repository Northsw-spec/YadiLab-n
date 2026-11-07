import { canonicalTroubleshootingJson } from "../../../observation-engine/src/index.js";
import type { VerificationAssertionResult } from "./verification-suite.js";
import type { RegressionCampaign, RegressionCampaignSubjectResult } from "./regression-campaign.js";

export const RESULT_TRANSITION_MATRIX_VERSION = "0.1.0" as const;
export type ResultTransition = "PASS→PASS" | "PASS→FAIL" | "FAIL→PASS" | "FAIL→FAIL" | "PASS→UNMODELED" | "UNMODELED→PASS" | "UNMODELED→UNMODELED" | "NOT RUN→PASS" | "PASS→NOT RUN" | "NOT COMPARABLE" | "OTHER";
export interface ResultTransitionCell {
  readonly candidateId: string;
  readonly assertionId: string;
  readonly flowId: string;
  readonly baselineResult: string;
  readonly candidateResult: string;
  readonly transition: ResultTransition;
  readonly comparable: boolean;
  readonly regressionOnly: boolean;
  readonly stale: boolean;
  readonly baselineRunId?: string;
  readonly candidateRunId?: string;
}
export interface ResultTransitionMatrix {
  readonly formatId: "infrastructure-cyber-lab.result-transition-matrix";
  readonly schemaVersion: "0.1.0";
  readonly campaignIdentity: string;
  readonly suiteIdentity: string;
  readonly rows: readonly ResultTransitionCell[];
  readonly counts: Readonly<Record<ResultTransition, number>>;
  readonly stale: boolean;
  readonly identity: string;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hash = async (value: unknown): Promise<string> => { const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalTroubleshootingJson(value))); return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""); };
const resultKey = (item: VerificationAssertionResult): string => `${item.assertionId}\0${item.flowId}`;
const allowedTransitions = new Set<ResultTransition>(["PASS→PASS", "PASS→FAIL", "FAIL→PASS", "FAIL→FAIL", "PASS→UNMODELED", "UNMODELED→PASS", "UNMODELED→UNMODELED", "NOT RUN→PASS", "PASS→NOT RUN"]);

function comparable(base: ResultTransitionCell, baseline: RegressionCampaignSubjectResult, candidate: RegressionCampaignSubjectResult, suiteIdentity: string): boolean {
  return base.baselineResult !== "NOT COMPARABLE" && baseline.suiteIdentity === suiteIdentity && candidate.suiteIdentity === suiteIdentity && baseline.run.historical && candidate.run.historical && baseline.run.sourceIdentity === baseline.sourceIdentity && candidate.run.sourceIdentity === candidate.sourceIdentity && base.flowId.trim().length > 0;
}

export async function buildResultTransitionMatrix(campaign: RegressionCampaign): Promise<ResultTransitionMatrix> {
  const baseline = campaign.currentResults.find((item) => item.subjectKind === "BASELINE");
  const rows: ResultTransitionCell[] = [];
  const candidateDrift = await Promise.all(campaign.candidates.map(async (candidate) => (await hash(candidate.source)) !== candidate.sourceIdentity));
  const stale = campaign.status !== "COMPLETE" || !baseline || baseline.campaignIdentity !== campaign.identity || candidateDrift.some(Boolean);
  if (baseline) {
    const baseByKey = new Map(baseline.run.results.map((item) => [resultKey(item), item]));
    for (const candidate of campaign.currentResults.filter((item) => item.subjectKind === "CANDIDATE")) {
      const candidateByKey = new Map(candidate.run.results.map((item) => [resultKey(item), item]));
      const keys = [...new Set([...baseByKey.keys(), ...candidateByKey.keys()])].sort();
      for (const key of keys) {
        const base = baseByKey.get(key); const current = candidateByKey.get(key);
        const flowId = base?.flowId ?? current?.flowId ?? ""; const assertionId = base?.assertionId ?? current?.assertionId ?? "";
        const baselineResult = base?.result ?? "NOT RUN"; const candidateResult = current?.result ?? "NOT RUN";
        const candidateCell = { candidateId: candidate.subjectId, assertionId, flowId, baselineResult, candidateResult, transition: "NOT COMPARABLE" as ResultTransition, comparable: false, regressionOnly: false, stale: stale || candidate.campaignIdentity !== campaign.identity, ...(base?.runId ? { baselineRunId: base.runId } : {}), ...(current?.runId ? { candidateRunId: current.runId } : {}) };
        const raw = `${baselineResult}→${candidateResult}` as ResultTransition;
        const isComparable = Boolean(base && current && comparable(candidateCell, baseline, candidate, campaign.suite.identity) && base.assertionId === current.assertionId && base.flowId === current.flowId);
        rows.push({ ...candidateCell, transition: isComparable && allowedTransitions.has(raw) ? raw : (isComparable ? "OTHER" : "NOT COMPARABLE"), comparable: isComparable, regressionOnly: isComparable && raw === "PASS→FAIL" });
      }
    }
  }
  const counts = Object.fromEntries([...allowedTransitions, "NOT COMPARABLE", "OTHER"].map((transition) => [transition, rows.filter((row) => row.transition === transition).length])) as Record<ResultTransition, number>;
  const projection = { formatId: "infrastructure-cyber-lab.result-transition-matrix" as const, schemaVersion: RESULT_TRANSITION_MATRIX_VERSION, campaignIdentity: campaign.identity, suiteIdentity: campaign.suite.identity, rows, counts, stale };
  return { ...projection, identity: await hash(projection) };
}

export function filterResultTransitionMatrix(matrix: ResultTransitionMatrix, filters: { readonly transition?: ResultTransition; readonly candidateId?: string; readonly flowId?: string; }): readonly ResultTransitionCell[] {
  return matrix.rows.filter((row) => (filters.transition === undefined || row.transition === filters.transition) && (filters.candidateId === undefined || row.candidateId === filters.candidateId) && (filters.flowId === undefined || row.flowId === filters.flowId));
}

export function transitionIsRegressionOnly(cell: ResultTransitionCell): boolean { return cell.comparable && cell.transition === "PASS→FAIL" && cell.regressionOnly; }
export function exportResultTransitionMatrix(value: ResultTransitionMatrix): string { return `${JSON.stringify(value, null, 2)}\n`; }
export async function verifyResultTransitionMatrix(value: unknown): Promise<{ readonly ok: true; readonly value: ResultTransitionMatrix } | { readonly ok: false; readonly diagnostics: readonly string[] }> {
  if (!value || typeof value !== "object") return { ok: false, diagnostics: ["RESULT_TRANSITION_MATRIX_NOT_OBJECT"] };
  const candidate = value as Partial<ResultTransitionMatrix>; const errors: string[] = [];
  if (candidate.formatId !== "infrastructure-cyber-lab.result-transition-matrix") errors.push("RESULT_TRANSITION_MATRIX_FORMAT_INVALID");
  if (candidate.schemaVersion !== RESULT_TRANSITION_MATRIX_VERSION) errors.push("RESULT_TRANSITION_MATRIX_VERSION_UNSUPPORTED");
  if (!Array.isArray(candidate.rows) || !candidate.counts || typeof candidate.campaignIdentity !== "string" || typeof candidate.suiteIdentity !== "string") errors.push("RESULT_TRANSITION_MATRIX_REQUIRED_FIELDS_MISSING");
  for (const row of candidate.rows ?? []) { if (row.comparable && row.transition === "NOT COMPARABLE") errors.push("RESULT_TRANSITION_MATRIX_COMPARABLE_CONFLICT"); if (row.regressionOnly && row.transition !== "PASS→FAIL") errors.push("RESULT_TRANSITION_MATRIX_FALSE_REGRESSION_LABEL"); }
  if (errors.length) return { ok: false, diagnostics: [...new Set(errors)] };
  const { identity: _identity, ...projection } = candidate as ResultTransitionMatrix;
  if (await hash(projection) !== candidate.identity) errors.push("RESULT_TRANSITION_MATRIX_IDENTITY_FAILED");
  return errors.length ? { ok: false, diagnostics: errors } : { ok: true, value: clone(candidate as ResultTransitionMatrix) };
}
