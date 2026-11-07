import { canonicalTroubleshootingJson } from "../../../observation-engine/src/index.js";
import type { VerificationResultStatus } from "./verification-suite.js";
import type { RegressionCampaign, RegressionCampaignSubjectResult } from "./regression-campaign.js";
import { computeRegressionCampaignIdentity, verifyRegressionCampaign } from "./regression-campaign.js";

export const CAMPAIGN_BUNDLE_VERSION = "0.1.0" as const;
export type PromotionVerificationGateState = "REQUIREMENTS MET" | "REQUIREMENTS NOT MET" | "STALE" | "NOT RUN" | "UNMODELED PRESENT" | "NOT COMPARABLE" | "BLOCKED";
export interface CampaignBundle {
  readonly formatId: "infrastructure-cyber-lab.campaign-bundle";
  readonly schemaVersion: "0.1.0";
  readonly campaign: RegressionCampaign;
  readonly archivedResults: readonly RegressionCampaignSubjectResult[];
  readonly exportedRunIds: readonly string[];
  readonly integrity: { readonly campaignIdentity: string; readonly archivedResultCount: number };
  readonly identity: string;
}
export interface PromotionVerificationGate {
  readonly formatId: "infrastructure-cyber-lab.promotion-verification-gate";
  readonly schemaVersion: "0.1.0";
  readonly caseId: string;
  readonly caseWorkingSourceIdentity: string;
  readonly candidateId: string;
  readonly candidateSourceIdentity: string;
  readonly baselineId: string;
  readonly suiteIdentity: string;
  readonly campaignIdentity: string;
  readonly campaignResultRevision: string;
  readonly requiredAssertionIds: readonly string[];
  readonly state: PromotionVerificationGateState;
  readonly fresh: boolean;
  readonly autoPromotion: false;
  readonly identity: string;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hash = async (value: unknown): Promise<string> => { const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalTroubleshootingJson(value))); return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""); };
const without = <T extends object>(value: T, keys: readonly string[]): T => { const copy = { ...value } as Record<string, unknown>; for (const key of keys) delete copy[key]; return copy as T; };

export async function createCampaignBundle(campaign: RegressionCampaign): Promise<CampaignBundle> {
  const check = await verifyRegressionCampaign(campaign); if (!check.ok) throw new Error(check.diagnostics.join(","));
  const archivedResults = [...check.value.currentResults].map(clone);
  const draft = { formatId: "infrastructure-cyber-lab.campaign-bundle" as const, schemaVersion: CAMPAIGN_BUNDLE_VERSION, campaign: { ...check.value, currentResults: [], historicalResults: archivedResults, status: "NOT RUN" as const }, archivedResults, exportedRunIds: archivedResults.flatMap((item) => [item.run.runId]), integrity: { campaignIdentity: check.value.identity, archivedResultCount: archivedResults.length }, identity: "0".repeat(64) };
  const identity = await hash(without(draft, ["identity"])); return { ...draft, identity };
}
export async function verifyCampaignBundle(value: unknown): Promise<{ readonly ok: true; readonly value: CampaignBundle } | { readonly ok: false; readonly diagnostics: readonly string[] }> {
  if (!value || typeof value !== "object") return { ok: false, diagnostics: ["CAMPAIGN_BUNDLE_NOT_OBJECT"] };
  const candidate = value as Partial<CampaignBundle>; const errors: string[] = [];
  if (candidate.formatId !== "infrastructure-cyber-lab.campaign-bundle") errors.push("CAMPAIGN_BUNDLE_FORMAT_INVALID");
  if (candidate.schemaVersion !== CAMPAIGN_BUNDLE_VERSION) errors.push("CAMPAIGN_BUNDLE_VERSION_UNSUPPORTED");
  if (!candidate.campaign || !Array.isArray(candidate.archivedResults) || !candidate.integrity) errors.push("CAMPAIGN_BUNDLE_REQUIRED_FIELDS_MISSING");
  if (candidate.campaign) { const check = await verifyRegressionCampaign(candidate.campaign); if (!check.ok) errors.push(...check.diagnostics); else if (check.value.identity !== candidate.integrity?.campaignIdentity) errors.push("CAMPAIGN_BUNDLE_CAMPAIGN_BINDING_FAILED"); }
  if (candidate.archivedResults && candidate.integrity && candidate.archivedResults.length !== candidate.integrity.archivedResultCount) errors.push("CAMPAIGN_BUNDLE_RESULT_COUNT_FAILED");
  if (candidate.identity && await hash(without(candidate as CampaignBundle, ["identity"])) !== candidate.identity) errors.push("CAMPAIGN_BUNDLE_IDENTITY_FAILED");
  return errors.length ? { ok: false, diagnostics: [...new Set(errors)] } : { ok: true, value: clone(candidate as CampaignBundle) };
}
export function exportCampaignBundle(value: CampaignBundle): string { return `${JSON.stringify(value, null, 2)}\n`; }
export async function importCampaignBundle(text: string): Promise<{ readonly ok: true; readonly value: CampaignBundle } | { readonly ok: false; readonly diagnostics: readonly string[] }> { try { return verifyCampaignBundle(JSON.parse(text) as unknown); } catch { return { ok: false, diagnostics: ["CAMPAIGN_BUNDLE_JSON_INVALID"] }; } }
export async function createPromotionVerificationGate(args: { readonly caseId: string; readonly caseWorkingSourceIdentity: string; readonly candidateId: string; readonly candidateSourceIdentity: string; readonly baselineId: string; readonly suiteIdentity: string; readonly campaign: RegressionCampaign; readonly requiredAssertionIds?: readonly string[] }): Promise<PromotionVerificationGate> {
  const required = [...new Set(args.requiredAssertionIds ?? args.campaign.suite.assertions.map((item) => item.assertionId))].sort();
  const candidate = args.campaign.currentResults.find((item) => item.subjectId === args.candidateId && item.subjectKind === "CANDIDATE");
  const baseline = args.campaign.currentResults.find((item) => item.subjectKind === "BASELINE");
  let state: PromotionVerificationGateState = "NOT RUN"; let fresh = false;
  if (!candidate || !baseline) state = "NOT RUN";
  else if (args.campaign.status !== "COMPLETE" || candidate.campaignIdentity !== args.campaign.identity || candidate.suiteIdentity !== args.suiteIdentity || candidate.sourceIdentity !== args.candidateSourceIdentity || candidate.run.sourceIdentity !== candidate.sourceIdentity || !candidate.run.historical) state = "STALE";
  else {
    const selected = candidate.run.results.filter((item) => required.includes(item.assertionId));
    if (selected.length !== required.length) state = "NOT COMPARABLE";
    else if (selected.some((item) => item.result === "UNMODELED")) state = "UNMODELED PRESENT";
    else if (selected.some((item) => item.result !== ("PASS" as VerificationResultStatus))) state = "REQUIREMENTS NOT MET";
    else { state = "REQUIREMENTS MET"; fresh = true; }
  }
  const draft = { formatId: "infrastructure-cyber-lab.promotion-verification-gate" as const, schemaVersion: "0.1.0" as const, caseId: args.caseId, caseWorkingSourceIdentity: args.caseWorkingSourceIdentity, candidateId: args.candidateId, candidateSourceIdentity: args.candidateSourceIdentity, baselineId: args.baselineId, suiteIdentity: args.suiteIdentity, campaignIdentity: args.campaign.identity, campaignResultRevision: candidate?.run.runId ?? "", requiredAssertionIds: required, state, fresh, autoPromotion: false as const, identity: "0".repeat(64) };
  return { ...draft, identity: await hash(without(draft, ["identity"])) };
}
export async function verifyPromotionVerificationGate(value: unknown): Promise<{ readonly ok: true; readonly value: PromotionVerificationGate } | { readonly ok: false; readonly diagnostics: readonly string[] }> {
  if (!value || typeof value !== "object") return { ok: false, diagnostics: ["PROMOTION_GATE_NOT_OBJECT"] };
  const candidate = value as PromotionVerificationGate; const errors: string[] = [];
  if (candidate.formatId !== "infrastructure-cyber-lab.promotion-verification-gate" || candidate.schemaVersion !== "0.1.0") errors.push("PROMOTION_GATE_FORMAT_INVALID");
  if (candidate.autoPromotion !== false) errors.push("PROMOTION_GATE_AUTO_PROMOTION_FORBIDDEN");
  if (candidate.state === "REQUIREMENTS MET" && !candidate.fresh) errors.push("PROMOTION_GATE_FRESHNESS_CONFLICT");
  if (await hash(without(candidate, ["identity"])) !== candidate.identity) errors.push("PROMOTION_GATE_IDENTITY_FAILED");
  return errors.length ? { ok: false, diagnostics: errors } : { ok: true, value: clone(candidate) };
}
