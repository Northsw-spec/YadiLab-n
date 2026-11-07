import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import { canonicalTroubleshootingJson } from "../../../observation-engine/src/index.js";
import { createInitialEngineState, evaluateEngine } from "../../../engine/src/index.js";
import type { EngineEvaluation, TruthValue } from "../../../engine/src/types.js";
import type { EvidenceWorkspace } from "./evidence.js";
import type { TroubleshootingCaseRunReference } from "./troubleshooting-case.js";

export const VERIFICATION_SUITE_VERSION = "0.1.0" as const;
export type VerificationAssertionType = "ENGINE_TEST_OUTCOME" | "DESTINATION" | "VERIFIED_DROP_NODE" | "SIMULATION_STATUS";
export type VerificationResultStatus = "PASS" | "FAIL" | "UNMODELED" | "NOT RUN" | "NOT COMPARABLE";
export interface VerificationAssertion { readonly assertionId: string; readonly flowId: string; readonly type: VerificationAssertionType; readonly expected: string; readonly order: number; readonly nodeId?: string; }
export interface VerificationSuite { readonly formatId: "infrastructure-cyber-lab.verification-suite"; readonly schemaVersion: "0.1.0"; readonly suiteId: string; readonly title: string; readonly description: string; readonly caseId?: string; readonly experimentId?: string; readonly selectedFlowIds: readonly string[]; readonly assertions: readonly VerificationAssertion[]; readonly identity: string; }
export interface VerificationAssertionResult { readonly assertionId: string; readonly flowId: string; readonly expected: string; readonly actual: string; readonly result: VerificationResultStatus; readonly runId?: string; readonly sourceIdentity: string; readonly sourceRevision: number; readonly evidence?: EvidenceWorkspace; readonly reason?: string; }
export interface VerificationSuiteRun { readonly runId: string; readonly suiteId: string; readonly sourceIdentity: string; readonly sourceRevision: number; readonly results: readonly VerificationAssertionResult[]; readonly summary: Readonly<Record<VerificationResultStatus, number>>; readonly historical: boolean; }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hash = async (value: unknown): Promise<string> => { const d = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalTroubleshootingJson(value))); return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join(""); };
function projection(value: VerificationSuite): unknown { const { suiteId: _id, identity: _identity, ...rest } = value; return rest; }
export async function computeVerificationSuiteIdentity(value: VerificationSuite): Promise<string> { return hash(projection(value)); }
export async function createVerificationSuite(args: { readonly title: string; readonly description?: string; readonly caseId?: string; readonly experimentId?: string; readonly selectedFlowIds: readonly string[]; readonly assertions: readonly Omit<VerificationAssertion, "order">[] }): Promise<VerificationSuite> {
  const selectedFlowIds = [...new Set(args.selectedFlowIds)].sort();
  const assertions = args.assertions.map((item, index) => ({ ...item, order: index + 1 }));
  if (!selectedFlowIds.length || !assertions.length) throw new Error("VERIFICATION_SUITE_EMPTY");
  if (new Set(assertions.map((item) => item.assertionId)).size !== assertions.length) throw new Error("VERIFICATION_SUITE_DUPLICATE_ASSERTION");
  if (assertions.some((item) => !selectedFlowIds.includes(item.flowId))) throw new Error("VERIFICATION_SUITE_ASSERTION_FLOW_NOT_SELECTED");
  const draft = { formatId: "infrastructure-cyber-lab.verification-suite" as const, schemaVersion: VERIFICATION_SUITE_VERSION, suiteId: "0".repeat(64), title: args.title, description: args.description ?? "", ...(args.caseId === undefined ? {} : { caseId: args.caseId }), ...(args.experimentId === undefined ? {} : { experimentId: args.experimentId }), selectedFlowIds, assertions, identity: "0".repeat(64) } as VerificationSuite;
  const identity = await computeVerificationSuiteIdentity(draft); return { ...draft, suiteId: identity, identity };
}
export async function verifyVerificationSuite(value: unknown): Promise<{ readonly ok: true; readonly value: VerificationSuite } | { readonly ok: false; readonly diagnostics: readonly string[] }> {
  if (!value || typeof value !== "object") return { ok: false, diagnostics: ["VERIFICATION_SUITE_NOT_OBJECT"] };
  const candidate = value as Partial<VerificationSuite>; const errors: string[] = [];
  if (candidate.formatId !== "infrastructure-cyber-lab.verification-suite") errors.push("VERIFICATION_SUITE_FORMAT_INVALID");
  if (candidate.schemaVersion !== VERIFICATION_SUITE_VERSION) errors.push("VERIFICATION_SUITE_VERSION_UNSUPPORTED");
  if (!Array.isArray(candidate.selectedFlowIds) || !Array.isArray(candidate.assertions)) errors.push("VERIFICATION_SUITE_REQUIRED_FIELDS_MISSING");
  const assertions = candidate.assertions ?? [];
  if (new Set(assertions.map((item) => item.assertionId)).size !== assertions.length) errors.push("VERIFICATION_SUITE_DUPLICATE_ASSERTION");
  const allowed = new Set<VerificationAssertionType>(["ENGINE_TEST_OUTCOME", "DESTINATION", "VERIFIED_DROP_NODE", "SIMULATION_STATUS"]);
  for (const item of assertions) { if (!allowed.has(item.type)) errors.push("VERIFICATION_ASSERTION_TYPE_UNSUPPORTED"); if (!candidate.selectedFlowIds?.includes(item.flowId)) errors.push("VERIFICATION_ASSERTION_FLOW_NOT_SELECTED"); if (typeof item.expected !== "string" || !item.expected.trim()) errors.push("VERIFICATION_ASSERTION_EXPECTED_INVALID"); }
  if (errors.length) return { ok: false, diagnostics: [...new Set(errors)] };
  if (await computeVerificationSuiteIdentity(candidate as VerificationSuite) !== candidate.identity) errors.push("VERIFICATION_SUITE_IDENTITY_FAILED");
  return errors.length ? { ok: false, diagnostics: errors } : { ok: true, value: clone(candidate as VerificationSuite) };
}

export interface VerificationEngineRun { readonly runId: string; readonly sourceIdentity: string; readonly sourceRevision: number; readonly flowId: string; readonly evaluation: EngineEvaluation; readonly evidence?: EvidenceWorkspace; }
export interface VerificationRunner { readonly run: (source: ScenarioSource, flowId: string, sourceRevision: number) => Promise<VerificationEngineRun>; }
function actualFor(assertion: VerificationAssertion, source: ScenarioSource, run: VerificationEngineRun): { actual: string; result: VerificationResultStatus; reason?: string } {
  if (assertion.type === "ENGINE_TEST_OUTCOME") { const test = run.evaluation.tests.find((item) => item.id === assertion.flowId); if (!test) return { actual: "UNMODELED", result: "UNMODELED", reason: "Flow is not present in the current canonical source." }; const actual = test.outcome === "TRUE" ? "SUCCESS" : test.outcome === "FALSE" ? "DROP" : "UNKNOWN"; return { actual, result: actual === assertion.expected ? "PASS" : "FAIL" }; }
  if (assertion.type === "DESTINATION" || assertion.type === "VERIFIED_DROP_NODE" || assertion.type === "SIMULATION_STATUS") return { actual: "UNMODELED", result: "UNMODELED", reason: "The requested field is not available from the normal Engine evaluation contract." };
  return { actual: "UNMODELED", result: "UNMODELED" };
}
export async function runVerificationSuite(suite: VerificationSuite, source: ScenarioSource, sourceRevision: number, runner: VerificationRunner): Promise<VerificationSuiteRun> {
  const sourceIdentity = await hash(source); const selected = new Set(source.tests.map((item) => item.id)); const results: VerificationAssertionResult[] = [];
  for (const assertion of [...suite.assertions].sort((a, b) => a.order - b.order)) {
    if (!suite.selectedFlowIds.includes(assertion.flowId) || !selected.has(assertion.flowId)) { results.push({ assertionId: assertion.assertionId, flowId: assertion.flowId, expected: assertion.expected, actual: "NOT RUN", result: "NOT RUN", sourceIdentity, sourceRevision, reason: "Invalid or unavailable flow reference." }); continue; }
    const run = await runner.run(source, assertion.flowId, sourceRevision); const outcome = actualFor(assertion, source, run);
    results.push({ assertionId: assertion.assertionId, flowId: assertion.flowId, expected: assertion.expected, actual: outcome.actual, result: outcome.result, runId: run.runId, sourceIdentity, sourceRevision, ...(run.evidence ? { evidence: run.evidence } : {}), ...(outcome.reason ? { reason: outcome.reason } : {}) });
  }
  const summary = Object.fromEntries(([
    "PASS", "FAIL", "UNMODELED", "NOT RUN", "NOT COMPARABLE",
  ] as const).map((status) => [status, results.filter((item) => item.result === status).length])) as Readonly<Record<VerificationResultStatus, number>>;
  return { runId: `${suite.identity}:${sourceIdentity}:${sourceRevision}`, suiteId: suite.suiteId, sourceIdentity, sourceRevision, results, summary, historical: true };
}
export function engineRunner(): VerificationRunner { return { run: async (source, flowId, sourceRevision) => { const model = await import("../../../compiler/src/index.js").then(async ({ compileScenario }) => { const context = { capabilities: new Map(), profiles: new Map() } as never; const result = await compileScenario(source, context); if (!result.ok) throw new Error("VERIFICATION_COMPILE_FAILED"); return result.model; }); const evaluation = evaluateEngine(model, createInitialEngineState(model)); return { runId: `${source.scenarioId}:${sourceRevision}:${flowId}`, sourceIdentity: await hash(source), sourceRevision, flowId, evaluation }; } }; }
export function suiteRunReference(run: VerificationSuiteRun): readonly TroubleshootingCaseRunReference[] { return run.results.filter((item) => item.runId).map((item) => ({ runId: item.runId as string, scenarioHash: run.sourceIdentity, sourceRevision: run.sourceRevision, runtimeRevision: 0, flowId: item.flowId, outcome: item.actual, eventIds: item.evidence?.records.map((record) => record.eventId) ?? [], eventCount: item.evidence?.records.length ?? 0, faultState: "UNMODELED", archived: true })); }
export function exportVerificationSuite(value: VerificationSuite): string { return `${JSON.stringify(value, null, 2)}\n`; }
export async function importVerificationSuite(text: string): Promise<{ readonly ok: true; readonly value: VerificationSuite } | { readonly ok: false; readonly diagnostics: readonly string[] }> { try { return verifyVerificationSuite(JSON.parse(text) as unknown); } catch { return { ok: false, diagnostics: ["VERIFICATION_SUITE_JSON_INVALID"] }; } }
export type { TruthValue };
