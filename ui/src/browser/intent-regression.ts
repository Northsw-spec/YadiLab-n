import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import { canonicalTroubleshootingJson } from "../../../observation-engine/src/index.js";
import type { IntentBundle } from "./intent-bundle.js";
import { rebindIntentBundleForSource, verifyIntentBundle } from "./intent-bundle.js";
import type { IntentExecutionRunner, IntentRun, IntentRunCaseResult } from "./network-intent-execution.js";
import { executeNetworkIntent } from "./network-intent-execution.js";

export const INTENT_REGRESSION_VERSION = "0.1.0" as const;
export type IntentRegressionStatus = "NOT RUN" | "COMPLETE" | "PARTIAL" | "BLOCKED" | "STALE";
export interface IntentRegressionSubject { readonly subjectId: string; readonly subjectKind: "BASELINE" | "CANDIDATE"; readonly source: ScenarioSource; readonly sourceIdentity: string; }
export interface IntentRegressionSubjectResult { readonly campaignIdentity: string; readonly subject: IntentRegressionSubject; readonly contractIdentity: string; readonly run: IntentRun; }
export interface IntentRegressionCampaign {
  readonly formatId: "infrastructure-cyber-lab.intent-regression-campaign";
  readonly schemaVersion: "0.1.0";
  readonly campaignId: string;
  readonly title: string;
  readonly bundleIdentity: string;
  readonly bundle: IntentBundle;
  readonly baseline: IntentRegressionSubject;
  readonly candidates: readonly IntentRegressionSubject[];
  readonly currentResults: readonly IntentRegressionSubjectResult[];
  readonly historicalResults: readonly IntentRegressionSubjectResult[];
  readonly status: IntentRegressionStatus;
  readonly identity: string;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hash = async (value: unknown): Promise<string> => { const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalTroubleshootingJson(value))); return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""); };
const sourceIdentity = (source: ScenarioSource): Promise<string> => hash(source);
const identityProjection = (value: IntentRegressionCampaign): unknown => { const { campaignId: _campaignId, identity: _identity, currentResults: _current, historicalResults: _historical, status: _status, ...rest } = value; return rest; };
export async function computeIntentRegressionIdentity(value: IntentRegressionCampaign): Promise<string> { return hash(identityProjection(value)); }
async function checkedSubject(subject: IntentRegressionSubject): Promise<IntentRegressionSubject> { const actual = await sourceIdentity(subject.source); if (actual !== subject.sourceIdentity) throw new Error(`INTENT_REGRESSION_SOURCE_INTEGRITY_FAILED:${subject.subjectId}`); return clone(subject); }
export async function createIntentRegressionCampaign(args: { readonly title: string; readonly bundle: IntentBundle; readonly baseline: IntentRegressionSubject; readonly candidates: readonly IntentRegressionSubject[] }): Promise<IntentRegressionCampaign> {
  const bundleCheck = await verifyIntentBundle(args.bundle); if (!bundleCheck.ok) throw new Error(bundleCheck.diagnostics.join(","));
  if (args.baseline.subjectKind !== "BASELINE") throw new Error("INTENT_REGRESSION_BASELINE_KIND_INVALID");
  const baseline = await checkedSubject(args.baseline); const candidates = await Promise.all(args.candidates.map(checkedSubject));
  if (new Set(candidates.map((item) => item.subjectId)).size !== candidates.length || candidates.some((item) => item.subjectId === baseline.subjectId)) throw new Error("INTENT_REGRESSION_DUPLICATE_SUBJECT");
  const draft = { formatId: "infrastructure-cyber-lab.intent-regression-campaign" as const, schemaVersion: INTENT_REGRESSION_VERSION, campaignId: "0".repeat(64), title: args.title, bundleIdentity: args.bundle.bundleId, bundle: clone(args.bundle), baseline, candidates: candidates.sort((a, b) => a.subjectId.localeCompare(b.subjectId)), currentResults: [], historicalResults: [], status: "NOT RUN" as const, identity: "0".repeat(64) };
  const identity = await computeIntentRegressionIdentity(draft as IntentRegressionCampaign); return { ...draft, campaignId: identity, identity };
}
export async function runIntentRegressionCampaign(campaign: IntentRegressionCampaign, runner: IntentExecutionRunner): Promise<IntentRegressionCampaign> {
  const checked = await verifyIntentRegressionCampaign(campaign); if (!checked.ok) throw new Error(checked.diagnostics.join(","));
  const results: IntentRegressionSubjectResult[] = [];
  for (const subject of [checked.value.baseline, ...checked.value.candidates]) {
    try { const contract = await rebindIntentBundleForSource(checked.value.bundle, subject.source); const run = await executeNetworkIntent({ contract, source: subject.source, sourceIdentity: subject.sourceIdentity, sourceRevision: 0, runSequence: results.length + 1, runner }); results.push({ campaignIdentity: checked.value.identity, subject: clone(subject), contractIdentity: contract.identity, run }); }
    catch { return { ...checked.value, currentResults: results, status: results.length ? "PARTIAL" : "BLOCKED" }; }
  }
  return { ...checked.value, currentResults: results, status: "COMPLETE" };
}
export async function verifyIntentRegressionCampaign(value: unknown): Promise<{ readonly ok: true; readonly value: IntentRegressionCampaign } | { readonly ok: false; readonly diagnostics: readonly string[] }> {
  if (!value || typeof value !== "object") return { ok: false, diagnostics: ["INTENT_REGRESSION_NOT_OBJECT"] };
  const candidate = value as Partial<IntentRegressionCampaign>; const errors: string[] = [];
  if (candidate.formatId !== "infrastructure-cyber-lab.intent-regression-campaign") errors.push("INTENT_REGRESSION_FORMAT_INVALID");
  if (candidate.schemaVersion !== INTENT_REGRESSION_VERSION) errors.push("INTENT_REGRESSION_VERSION_UNSUPPORTED");
  if (!candidate.bundle || !candidate.baseline || !Array.isArray(candidate.candidates) || !Array.isArray(candidate.currentResults)) errors.push("INTENT_REGRESSION_REQUIRED_FIELDS_MISSING");
  if (candidate.bundle) { const bundleCheck = await verifyIntentBundle(candidate.bundle); if (!bundleCheck.ok) errors.push(...bundleCheck.diagnostics); else if (candidate.bundleIdentity !== bundleCheck.value.bundleId) errors.push("INTENT_REGRESSION_BUNDLE_BINDING_FAILED"); }
  if (candidate.baseline) { try { await checkedSubject(candidate.baseline); } catch (error) { errors.push(error instanceof Error ? error.message : "INTENT_REGRESSION_BASELINE_INTEGRITY_FAILED"); } }
  for (const subject of candidate.candidates ?? []) { try { await checkedSubject(subject); } catch (error) { errors.push(error instanceof Error ? error.message : `INTENT_REGRESSION_SOURCE_INTEGRITY_FAILED:${subject.subjectId}`); } }
  if (candidate.identity && await computeIntentRegressionIdentity(candidate as IntentRegressionCampaign) !== candidate.identity) errors.push("INTENT_REGRESSION_IDENTITY_FAILED");
  return errors.length ? { ok: false, diagnostics: [...new Set(errors)] } : { ok: true, value: clone(candidate as IntentRegressionCampaign) };
}
export async function intentRegressionResultsAreCurrent(campaign: IntentRegressionCampaign): Promise<boolean> { const checked = await verifyIntentRegressionCampaign(campaign); if (!checked.ok || checked.value.status !== "COMPLETE") return false; return checked.value.currentResults.length === checked.value.candidates.length + 1 && checked.value.currentResults.every((result) => result.campaignIdentity === checked.value.identity && result.run.contractIdentity === result.contractIdentity && result.run.sourceIdentity === result.subject.sourceIdentity && result.run.status === "COMPLETE"); }
export interface IntentRegressionTransition { readonly candidateId: string; readonly caseKey: string; readonly baselineResult: string; readonly candidateResult: string; readonly transition: string; readonly comparable: boolean; readonly regressionOnly: boolean; readonly stale: boolean; }
export interface IntentRegressionMatrix { readonly formatId: "infrastructure-cyber-lab.intent-regression-matrix"; readonly schemaVersion: "0.1.0"; readonly campaignIdentity: string; readonly rows: readonly IntentRegressionTransition[]; readonly stale: boolean; readonly identity: string; }
const caseKey = (item: IntentRunCaseResult): string => `${item.assertionIdentity}\0${item.caseIdentity}`;
export async function buildIntentRegressionMatrix(campaign: IntentRegressionCampaign): Promise<IntentRegressionMatrix> { const current = await intentRegressionResultsAreCurrent(campaign); const baseline = campaign.currentResults.find((item) => item.subject.subjectKind === "BASELINE"); const rows: IntentRegressionTransition[] = []; if (baseline) for (const candidate of campaign.currentResults.filter((item) => item.subject.subjectKind === "CANDIDATE")) { const base = new Map(baseline.run.cases.map((item) => [caseKey(item), item])); const cur = new Map(candidate.run.cases.map((item) => [caseKey(item), item])); for (const key of [...new Set([...base.keys(), ...cur.keys()])].sort()) { const before = base.get(key); const after = cur.get(key); const comparable = Boolean(before && after && before.assertionIdentity === after.assertionIdentity && before.expected === after.expected && before.result !== "NOT COMPARABLE" && after.result !== "NOT COMPARABLE"); const transition = comparable ? `${before?.result}→${after?.result}` : "NOT COMPARABLE"; rows.push({ candidateId: candidate.subject.subjectId, caseKey: key, baselineResult: before?.result ?? "NOT RUN", candidateResult: after?.result ?? "NOT RUN", transition, comparable, regressionOnly: comparable && transition === "PASS→FAIL", stale: !current }); } } const projection = { formatId: "infrastructure-cyber-lab.intent-regression-matrix" as const, schemaVersion: "0.1.0" as const, campaignIdentity: campaign.identity, rows, stale: !current }; return { ...projection, identity: await hash(projection) }; }
export function exportIntentRegressionCampaign(value: IntentRegressionCampaign): string { return `${JSON.stringify(value, null, 2)}\n`; }

export type IntentPromotionGateState = "REQUIREMENTS MET" | "REQUIREMENTS NOT MET" | "STALE" | "NOT RUN" | "UNKNOWN PRESENT" | "UNMODELED PRESENT" | "NOT COMPARABLE" | "BLOCKED";
export interface IntentPromotionGate { readonly formatId: "infrastructure-cyber-lab.intent-promotion-verification-gate"; readonly schemaVersion: "0.1.0"; readonly campaignIdentity: string; readonly candidateId: string; readonly requiredCaseCount: number; readonly state: IntentPromotionGateState; readonly fresh: boolean; readonly autoPromotion: false; readonly identity: string; }
export async function createIntentPromotionGate(args: { readonly campaign: IntentRegressionCampaign; readonly candidateId: string; readonly requiredCaseIdentities?: readonly string[] }): Promise<IntentPromotionGate> {
  const candidate = args.campaign.currentResults.find((item) => item.subject.subjectId === args.candidateId && item.subject.subjectKind === "CANDIDATE"); const baseline = args.campaign.currentResults.find((item) => item.subject.subjectKind === "BASELINE");
  const required = [...(args.requiredCaseIdentities ?? args.campaign.bundle.expansion.cases.filter((item) => item.state === "READY").map((item) => item.caseIdentity))].sort(); let state: IntentPromotionGateState = "NOT RUN"; let fresh = false;
  if (!candidate || !baseline) state = "NOT RUN"; else if (required.length === 0) state = "NOT COMPARABLE"; else if (!(await intentRegressionResultsAreCurrent(args.campaign))) state = "STALE"; else { const selected = candidate.run.cases.filter((item) => required.includes(item.caseIdentity)); if (selected.length !== required.length) state = "NOT COMPARABLE"; else if (selected.some((item) => item.result === "UNKNOWN")) state = "UNKNOWN PRESENT"; else if (selected.some((item) => item.result === "UNMODELED" || item.result === "INVALID" || item.result === "NOT RUN")) state = "UNMODELED PRESENT"; else if (selected.some((item) => item.result !== "PASS")) state = "REQUIREMENTS NOT MET"; else { state = "REQUIREMENTS MET"; fresh = true; } }
  const draft = { formatId: "infrastructure-cyber-lab.intent-promotion-verification-gate" as const, schemaVersion: "0.1.0" as const, campaignIdentity: args.campaign.identity, candidateId: args.candidateId, requiredCaseCount: required.length, state, fresh, autoPromotion: false as const, identity: "0".repeat(64) }; const { identity: _identity, ...identityProjection } = draft; return { ...draft, identity: await hash(identityProjection) };
}
export async function verifyIntentPromotionGate(value: unknown): Promise<{ readonly ok: true; readonly value: IntentPromotionGate } | { readonly ok: false; readonly diagnostics: readonly string[] }> { if (!value || typeof value !== "object") return { ok: false, diagnostics: ["INTENT_PROMOTION_GATE_NOT_OBJECT"] }; const candidate = value as IntentPromotionGate; const errors: string[] = []; if (candidate.formatId !== "infrastructure-cyber-lab.intent-promotion-verification-gate" || candidate.schemaVersion !== "0.1.0") errors.push("INTENT_PROMOTION_GATE_FORMAT_INVALID"); if (candidate.autoPromotion !== false) errors.push("INTENT_PROMOTION_GATE_AUTO_PROMOTION_FORBIDDEN"); if (candidate.state === "REQUIREMENTS MET" && !candidate.fresh) errors.push("INTENT_PROMOTION_GATE_FRESHNESS_CONFLICT"); const { identity: _identity, ...projection } = candidate; if (await hash(projection) !== candidate.identity) errors.push("INTENT_PROMOTION_GATE_IDENTITY_FAILED"); return errors.length ? { ok: false, diagnostics: errors } : { ok: true, value: clone(candidate) }; }
