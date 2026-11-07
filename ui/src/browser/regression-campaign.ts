import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import { canonicalTroubleshootingJson } from "../../../observation-engine/src/index.js";
import type { VerificationEngineRun, VerificationSuite, VerificationSuiteRun, VerificationRunner } from "./verification-suite.js";
import { computeVerificationSuiteIdentity, runVerificationSuite, verifyVerificationSuite } from "./verification-suite.js";
import type { VerifiedBaseline } from "./verified-baseline.js";
import { verifyVerifiedBaseline } from "./verified-baseline.js";

export const REGRESSION_CAMPAIGN_VERSION = "0.1.0" as const;
export type RegressionCampaignStatus = "NOT RUN" | "COMPLETE" | "PARTIAL" | "BLOCKED" | "STALE";
export type CampaignSubjectKind = "BASELINE" | "CANDIDATE";

export interface RegressionCampaignCandidate {
  readonly candidateId: string;
  readonly title: string;
  readonly source: ScenarioSource;
  readonly sourceIdentity: string;
}
export interface RegressionCampaignSubjectResult {
  readonly campaignIdentity: string;
  readonly subjectId: string;
  readonly subjectKind: CampaignSubjectKind;
  readonly sourceIdentity: string;
  readonly suiteIdentity: string;
  readonly run: VerificationSuiteRun;
}
export interface RegressionCampaign {
  readonly formatId: "infrastructure-cyber-lab.regression-campaign";
  readonly schemaVersion: "0.1.0";
  readonly campaignId: string;
  readonly title: string;
  readonly description: string;
  readonly baseline: { readonly baselineId: string; readonly source: ScenarioSource; readonly sourceIdentity: string };
  readonly candidates: readonly RegressionCampaignCandidate[];
  readonly suite: VerificationSuite;
  readonly selectedFlowIds: readonly string[];
  readonly runOrder: readonly string[];
  readonly currentResults: readonly RegressionCampaignSubjectResult[];
  readonly historicalResults: readonly RegressionCampaignSubjectResult[];
  readonly status: RegressionCampaignStatus;
  readonly identity: string;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hash = async (value: unknown): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalTroubleshootingJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
const sourceIdentity = (source: ScenarioSource): Promise<string> => hash(source);
function identityProjection(value: RegressionCampaign): unknown {
  const { campaignId: _campaignId, identity: _identity, currentResults: _current, historicalResults: _historical, status: _status, ...rest } = value;
  return rest;
}

export async function computeRegressionCampaignIdentity(value: RegressionCampaign): Promise<string> { return hash(identityProjection(value)); }

export async function createRegressionCampaign(args: {
  readonly title: string;
  readonly description?: string;
  readonly baseline: VerifiedBaseline;
  readonly candidates: readonly RegressionCampaignCandidate[];
  readonly suite: VerificationSuite;
  readonly selectedFlowIds?: readonly string[];
}): Promise<RegressionCampaign> {
  const baselineCheck = await verifyVerifiedBaseline(args.baseline);
  if (!baselineCheck.ok) throw new Error(`REGRESSION_CAMPAIGN_BASELINE_INVALID:${baselineCheck.diagnostics.join(",")}`);
  const suiteCheck = await verifyVerificationSuite(args.suite);
  if (!suiteCheck.ok) throw new Error(`REGRESSION_CAMPAIGN_SUITE_INVALID:${suiteCheck.diagnostics.join(",")}`);
  const candidates = [] as RegressionCampaignCandidate[];
  for (const candidate of args.candidates) {
    const identity = await sourceIdentity(candidate.source);
    if (identity !== candidate.sourceIdentity) throw new Error(`REGRESSION_CAMPAIGN_CANDIDATE_INTEGRITY_FAILED:${candidate.candidateId}`);
    if (!candidate.candidateId.trim() || !candidate.title.trim()) throw new Error("REGRESSION_CAMPAIGN_CANDIDATE_METADATA_INVALID");
    candidates.push({ ...clone(candidate), source: clone(candidate.source) });
  }
  if (new Set(candidates.map((candidate) => candidate.candidateId)).size !== candidates.length) throw new Error("REGRESSION_CAMPAIGN_DUPLICATE_CANDIDATE");
  const selectedFlowIds = [...new Set<string>(args.selectedFlowIds ?? suiteCheck.value.selectedFlowIds)].sort();
  if (selectedFlowIds.some((flowId) => !suiteCheck.value.selectedFlowIds.includes(flowId))) throw new Error("REGRESSION_CAMPAIGN_FLOW_NOT_IN_SUITE");
  const draft = {
    formatId: "infrastructure-cyber-lab.regression-campaign" as const,
    schemaVersion: REGRESSION_CAMPAIGN_VERSION,
    campaignId: "0".repeat(64), title: args.title, description: args.description ?? "",
    baseline: { baselineId: baselineCheck.value.baselineId, source: clone(baselineCheck.value.canonicalSourceSnapshot), sourceIdentity: baselineCheck.value.canonicalSourceIdentity },
    candidates: candidates.sort((a, b) => a.candidateId.localeCompare(b.candidateId)), suite: clone(suiteCheck.value), selectedFlowIds,
    runOrder: ["baseline", ...candidates.map((candidate) => candidate.candidateId)], currentResults: [], historicalResults: [], status: "NOT RUN" as const, identity: "0".repeat(64),
  } satisfies Omit<RegressionCampaign, "campaignId" | "identity"> & { campaignId: string; identity: string };
  const identity = await computeRegressionCampaignIdentity(draft as RegressionCampaign);
  return { ...draft, campaignId: identity, identity };
}

export function summarizeRegressionCampaign(value: RegressionCampaign | readonly RegressionCampaignSubjectResult[]): Readonly<Record<string, Readonly<Record<string, number>>>> {
  const results: readonly RegressionCampaignSubjectResult[] = Array.isArray(value) ? value : (value as RegressionCampaign).currentResults;
  return Object.fromEntries(results.map((item) => [item.subjectId, item.run.summary]));
}

export async function runRegressionCampaign(campaign: RegressionCampaign, runner: VerificationRunner): Promise<RegressionCampaign> {
  const checked = await verifyRegressionCampaign(campaign);
  if (!checked.ok) throw new Error(checked.diagnostics.join(","));
  const results: RegressionCampaignSubjectResult[] = [];
  const subjects = [{ subjectId: "baseline", subjectKind: "BASELINE" as const, source: checked.value.baseline.source, sourceIdentity: checked.value.baseline.sourceIdentity }, ...checked.value.candidates.map((candidate) => ({ subjectId: candidate.candidateId, subjectKind: "CANDIDATE" as const, source: candidate.source, sourceIdentity: candidate.sourceIdentity }))];
  for (const subject of subjects) {
    try {
      const run = await runVerificationSuite(checked.value.suite, clone(subject.source), results.length, runner);
      results.push({ campaignIdentity: checked.value.identity, subjectId: subject.subjectId, subjectKind: subject.subjectKind, sourceIdentity: subject.sourceIdentity, suiteIdentity: checked.value.suite.identity, run });
    } catch (error) {
      return { ...checked.value, currentResults: results, status: results.length ? "PARTIAL" : "BLOCKED" };
    }
  }
  return { ...checked.value, currentResults: results, status: "COMPLETE" };
}

export async function verifyRegressionCampaign(value: unknown): Promise<{ readonly ok: true; readonly value: RegressionCampaign } | { readonly ok: false; readonly diagnostics: readonly string[] }> {
  if (!value || typeof value !== "object") return { ok: false, diagnostics: ["REGRESSION_CAMPAIGN_NOT_OBJECT"] };
  const candidate = value as Partial<RegressionCampaign>; const errors: string[] = [];
  if (candidate.formatId !== "infrastructure-cyber-lab.regression-campaign") errors.push("REGRESSION_CAMPAIGN_FORMAT_INVALID");
  if (candidate.schemaVersion !== REGRESSION_CAMPAIGN_VERSION) errors.push("REGRESSION_CAMPAIGN_VERSION_UNSUPPORTED");
  if (!candidate.baseline || !candidate.suite || !Array.isArray(candidate.candidates) || !Array.isArray(candidate.runOrder)) errors.push("REGRESSION_CAMPAIGN_REQUIRED_FIELDS_MISSING");
  if (candidate.baseline && (!candidate.baseline.baselineId || !candidate.baseline.source || !candidate.baseline.sourceIdentity)) errors.push("REGRESSION_CAMPAIGN_BASELINE_INVALID");
  if (candidate.candidates && new Set(candidate.candidates.map((item) => item.candidateId)).size !== candidate.candidates.length) errors.push("REGRESSION_CAMPAIGN_DUPLICATE_CANDIDATE");
  if (errors.length) return { ok: false, diagnostics: [...new Set(errors)] };
  const suite = await verifyVerificationSuite(candidate.suite);
  if (!suite.ok) errors.push(...suite.diagnostics);
  if (candidate.baseline && await sourceIdentity(candidate.baseline.source as ScenarioSource) !== candidate.baseline.sourceIdentity) errors.push("REGRESSION_CAMPAIGN_BASELINE_INTEGRITY_FAILED");
  for (const item of candidate.candidates ?? []) if (await sourceIdentity(item.source) !== item.sourceIdentity) errors.push(`REGRESSION_CAMPAIGN_CANDIDATE_INTEGRITY_FAILED:${item.candidateId}`);
  if (await computeRegressionCampaignIdentity(candidate as RegressionCampaign) !== candidate.identity) errors.push("REGRESSION_CAMPAIGN_IDENTITY_FAILED");
  return errors.length ? { ok: false, diagnostics: [...new Set(errors)] } : { ok: true, value: clone(candidate as RegressionCampaign) };
}

export async function campaignResultsAreCurrent(campaign: RegressionCampaign): Promise<boolean> {
  if (campaign.status !== "COMPLETE" || campaign.currentResults.length !== campaign.candidates.length + 1) return false;
  if (await computeVerificationSuiteIdentity(campaign.suite) !== campaign.suite.identity) return false;
  return campaign.currentResults.every((result) => result.campaignIdentity === campaign.identity && result.suiteIdentity === campaign.suite.identity && result.run.sourceIdentity === result.sourceIdentity && result.run.historical);
}

export function exportRegressionCampaign(value: RegressionCampaign): string { return `${JSON.stringify(value, null, 2)}\n`; }
export async function importRegressionCampaign(text: string): Promise<{ readonly ok: true; readonly value: RegressionCampaign } | { readonly ok: false; readonly diagnostics: readonly string[] }> { try { return verifyRegressionCampaign(JSON.parse(text) as unknown); } catch { return { ok: false, diagnostics: ["REGRESSION_CAMPAIGN_JSON_INVALID"] }; } }
