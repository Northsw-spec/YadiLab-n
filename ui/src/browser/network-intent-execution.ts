import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import { canonicalTroubleshootingJson } from "../../../observation-engine/src/index.js";
import type { EngineEvaluation } from "../../../engine/src/index.js";
import {
  computeNetworkIntentIdentity,
  type EndpointSet,
  type FlowProfile,
  type IntentExpectation,
  type NetworkIntentContract,
  type NetworkIntentRule,
  verifyNetworkIntentContract,
} from "./network-intent.js";

export const INTENT_EXECUTION_VERSION = "0.1.0" as const;
export type ConcreteIntentResult = "PASS" | "FAIL" | "UNMODELED" | "NOT RUN" | "INVALID" | "NOT COMPARABLE" | "UNKNOWN";
export type IntentRunStatus = "NOT RUN" | "RUNNING" | "PARTIAL" | "COMPLETE" | "BLOCKED" | "STALE" | "HISTORICAL";

export interface ConcreteIntentCase {
  readonly caseId: string;
  readonly caseIdentity: string;
  readonly contractIdentity: string;
  readonly contractRevision: number;
  readonly ruleId: string;
  readonly ruleIdentity: string;
  readonly sourceSetId: string;
  readonly sourceSetIdentity: string;
  readonly destinationSetId: string;
  readonly destinationSetIdentity: string;
  readonly sourceNodeId: string;
  readonly destinationNodeId: string;
  readonly flowProfileId: string;
  readonly flowProfileIdentity: string;
  readonly flowId: string;
  readonly assertionIdentity: string;
  readonly expectation: IntentExpectation;
  readonly expected: string;
  readonly state: "READY" | "INVALID";
}

export interface IntentExpansion {
  readonly formatId: "infrastructure-cyber-lab.network-intent-expansion";
  readonly schemaVersion: "0.1.0";
  readonly contractIdentity: string;
  readonly contractRevision: number;
  readonly sourceIdentity: string;
  readonly sourceRevision: number;
  readonly cases: readonly ConcreteIntentCase[];
  readonly caseCount: number;
  readonly identity: string;
}

export interface IntentEngineRun {
  readonly runId: string;
  readonly sourceIdentity: string;
  readonly sourceRevision: number;
  readonly flowId: string;
  readonly evaluation: EngineEvaluation;
  readonly runtimeRevision?: number;
}

export interface IntentRunCaseResult {
  readonly caseIdentity: string;
  readonly contractIdentity: string;
  readonly contractRevision: number;
  readonly sourceIdentity: string;
  readonly sourceRevision: number;
  readonly flowId: string;
  readonly assertionIdentity: string;
  readonly expected: string;
  readonly actual: string;
  readonly result: ConcreteIntentResult;
  readonly engineRunId?: string;
  readonly runtimeRevision?: number;
  readonly reason?: string;
}

export interface IntentRun {
  readonly formatId: "infrastructure-cyber-lab.network-intent-run";
  readonly schemaVersion: "0.1.0";
  readonly runId: string;
  readonly contractIdentity: string;
  readonly contractRevision: number;
  readonly sourceIdentity: string;
  readonly sourceRevision: number;
  readonly expansionIdentity: string;
  readonly status: IntentRunStatus;
  readonly cases: readonly IntentRunCaseResult[];
  readonly counts: Readonly<Record<ConcreteIntentResult, number>>;
  readonly identity: string;
}

export interface IntentExecutionRunner {
  readonly run: (source: ScenarioSource, flowId: string, sourceRevision: number) => Promise<IntentEngineRun>;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hash = async (value: unknown): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalTroubleshootingJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
const sourceIdentityOf = (source: ScenarioSource): Promise<string> => hash(source);
const endpointMap = (contract: NetworkIntentContract): Map<string, EndpointSet> => new Map(contract.endpointSets.map((item) => [item.setId, item]));
const profileMap = (contract: NetworkIntentContract): Map<string, FlowProfile> => new Map(contract.flowProfiles.map((item) => [item.profileId, item]));
const ruleIdentity = (rule: NetworkIntentRule): Promise<string> => hash({ ruleId: rule.ruleId, title: rule.title, sourceSetId: rule.sourceSetId, destinationSetId: rule.destinationSetId, flowProfileId: rule.flowProfileId, expectation: rule.expectation, expected: rule.expected });
const assertionIdentity = (ruleId: string, expectation: IntentExpectation, expected: string): Promise<string> => hash({ ruleId, expectation, expected });

export async function expandNetworkIntent(args: { readonly contract: NetworkIntentContract; readonly source: ScenarioSource; readonly sourceIdentity?: string; readonly sourceRevision?: number }): Promise<IntentExpansion> {
  const checked = await verifyNetworkIntentContract(args.contract, args.source);
  if (!checked.ok) throw new Error(checked.diagnostics.join(","));
  const actualSourceIdentity = args.sourceIdentity ?? await sourceIdentityOf(args.source);
  if (actualSourceIdentity !== checked.value.sourceIdentity) throw new Error("INTENT_EXPANSION_SOURCE_MISMATCH");
  const sets = endpointMap(checked.value);
  const profiles = profileMap(checked.value);
  const cases: ConcreteIntentCase[] = [];
  for (const rule of [...checked.value.rules].sort((left, right) => left.ruleId.localeCompare(right.ruleId))) {
    const sourceSet = sets.get(rule.sourceSetId);
    const destinationSet = sets.get(rule.destinationSetId);
    const profile = profiles.get(rule.flowProfileId);
    const flow = profile && args.source.tests.find((test) => test.id === profile.flowId && test.type === "network.reachability");
    if (!sourceSet || !destinationSet || !profile || !flow) {
      cases.push({ caseId: `invalid:${rule.ruleId}`, caseIdentity: await hash({ contractIdentity: checked.value.identity, contractRevision: checked.value.revision, ruleId: rule.ruleId, sourceSetId: rule.sourceSetId, destinationSetId: rule.destinationSetId, flowProfileId: rule.flowProfileId }), contractIdentity: checked.value.identity, contractRevision: checked.value.revision, ruleId: rule.ruleId, ruleIdentity: await ruleIdentity(rule), sourceSetId: rule.sourceSetId, sourceSetIdentity: sourceSet?.identity ?? "", destinationSetId: rule.destinationSetId, destinationSetIdentity: destinationSet?.identity ?? "", sourceNodeId: "", destinationNodeId: "", flowProfileId: rule.flowProfileId, flowProfileIdentity: profile?.identity ?? "", flowId: profile?.flowId ?? "", assertionIdentity: await assertionIdentity(rule.ruleId, rule.expectation, rule.expected), expectation: rule.expectation, expected: rule.expected, state: "INVALID" });
      continue;
    }
    const ruleId = await ruleIdentity(rule);
    const assertionId = await assertionIdentity(rule.ruleId, rule.expectation, rule.expected);
    for (const sourceNodeId of [...sourceSet.nodeIds].sort()) {
      for (const destinationNodeId of [...destinationSet.nodeIds].sort()) {
        const projection = { contractIdentity: checked.value.identity, contractRevision: checked.value.revision, ruleIdentity: ruleId, sourceSetIdentity: sourceSet.identity, destinationSetIdentity: destinationSet.identity, sourceNodeId, destinationNodeId, flowProfileIdentity: profile.identity, assertionIdentity: assertionId, sourceIdentity: actualSourceIdentity, sourceRevision: args.sourceRevision ?? 0 };
        const caseIdentity = await hash(projection);
        cases.push({ caseId: caseIdentity, caseIdentity, ...projection, ruleId: rule.ruleId, sourceSetId: sourceSet.setId, destinationSetId: destinationSet.setId, flowProfileId: profile.profileId, flowId: profile.flowId, expectation: rule.expectation, expected: rule.expected, state: "READY" });
      }
    }
  }
  const caseIdentities = new Set(cases.map((item) => item.caseIdentity));
  if (caseIdentities.size !== cases.length) throw new Error("INTENT_EXPANSION_DUPLICATE_CASE_ID");
  const sourceRevision = args.sourceRevision ?? 0;
  const projection = { formatId: "infrastructure-cyber-lab.network-intent-expansion" as const, schemaVersion: INTENT_EXECUTION_VERSION, contractIdentity: checked.value.identity, contractRevision: checked.value.revision, sourceIdentity: actualSourceIdentity, sourceRevision, cases, caseCount: cases.length };
  return { ...projection, identity: await hash(projection) };
}

function caseSource(source: ScenarioSource, item: ConcreteIntentCase): ScenarioSource {
  const next = clone(source);
  const flow = next.tests.find((test) => test.id === item.flowId);
  if (!flow || flow.type !== "network.reachability") throw new Error("INTENT_CASE_FLOW_REFERENCE_INVALID");
  return { ...next, tests: next.tests.map((test) => test.id === item.flowId && test.type === "network.reachability" ? { ...test, params: { ...test.params, from: item.sourceNodeId, to: item.destinationNodeId } } : test) };
}

function actualOutcome(evaluation: EngineEvaluation, flowId: string): string {
  const test = evaluation.tests.find((item) => item.id === flowId);
  return test?.outcome === "TRUE" ? "SUCCESS" : test?.outcome === "FALSE" ? "DROP" : test ? "UNKNOWN" : "UNMODELED";
}

function resultFor(expected: string, actual: string): ConcreteIntentResult {
  if (actual === "UNMODELED") return "UNMODELED";
  if (actual === "UNKNOWN") return "UNKNOWN";
  return actual === expected ? "PASS" : "FAIL";
}

const emptyCounts = (): Record<ConcreteIntentResult, number> => ({ PASS: 0, FAIL: 0, UNMODELED: 0, "NOT RUN": 0, INVALID: 0, "NOT COMPARABLE": 0, UNKNOWN: 0 });

export async function executeNetworkIntent(args: { readonly contract: NetworkIntentContract; readonly source: ScenarioSource; readonly sourceIdentity?: string; readonly sourceRevision?: number; readonly expansion?: IntentExpansion; readonly runSequence: number; readonly runner: IntentExecutionRunner }): Promise<IntentRun> {
  const expansion = args.expansion ?? await expandNetworkIntent(args);
  const actualSourceIdentity = args.sourceIdentity ?? await sourceIdentityOf(args.source);
  if (expansion.sourceIdentity !== actualSourceIdentity) throw new Error("INTENT_RUN_SOURCE_MISMATCH");
  const currentExpansion = await expandNetworkIntent({ ...args, sourceIdentity: actualSourceIdentity });
  if (expansion.identity !== currentExpansion.identity) throw new Error("INTENT_RUN_EXPANSION_STALE");
  const runId = await hash({ contractIdentity: expansion.contractIdentity, contractRevision: expansion.contractRevision, expansionIdentity: expansion.identity, sourceIdentity: actualSourceIdentity, sourceRevision: expansion.sourceRevision, runSequence: args.runSequence });
  const results: IntentRunCaseResult[] = [];
  for (const item of expansion.cases) {
    if (item.state === "INVALID") { results.push({ caseIdentity: item.caseIdentity, contractIdentity: item.contractIdentity, contractRevision: item.contractRevision, sourceIdentity: actualSourceIdentity, sourceRevision: expansion.sourceRevision, flowId: item.flowId, assertionIdentity: item.assertionIdentity, expected: item.expected, actual: "INVALID", result: "INVALID", reason: "Invalid concrete case reference." }); continue; }
    try {
      const executionSource = caseSource(args.source, item);
      const executionSourceIdentity = await sourceIdentityOf(executionSource);
      const engineRun = await args.runner.run(executionSource, item.flowId, expansion.sourceRevision);
      if (engineRun.sourceIdentity !== executionSourceIdentity || engineRun.sourceRevision !== expansion.sourceRevision || engineRun.flowId !== item.flowId) throw new Error("INTENT_RUN_ENGINE_BINDING_MISMATCH");
      const actual = actualOutcome(engineRun.evaluation, item.flowId);
      results.push({ caseIdentity: item.caseIdentity, contractIdentity: item.contractIdentity, contractRevision: item.contractRevision, sourceIdentity: actualSourceIdentity, sourceRevision: expansion.sourceRevision, flowId: item.flowId, assertionIdentity: item.assertionIdentity, expected: item.expected, actual, result: resultFor(item.expected, actual), engineRunId: engineRun.runId, ...(engineRun.runtimeRevision === undefined ? {} : { runtimeRevision: engineRun.runtimeRevision }) });
    } catch (error) { results.push({ caseIdentity: item.caseIdentity, contractIdentity: item.contractIdentity, contractRevision: item.contractRevision, sourceIdentity: actualSourceIdentity, sourceRevision: expansion.sourceRevision, flowId: item.flowId, assertionIdentity: item.assertionIdentity, expected: item.expected, actual: "NOT RUN", result: "NOT RUN", reason: error instanceof Error ? error.message : String(error) }); }
  }
  const counts = emptyCounts();
  for (const result of results) counts[result.result] += 1;
  const status: IntentRunStatus = results.length === 0 ? "BLOCKED" : counts["NOT RUN"] > 0 ? (counts.PASS + counts.FAIL + counts.UNMODELED + counts.UNKNOWN > 0 ? "PARTIAL" : "BLOCKED") : "COMPLETE";
  const draft = { formatId: "infrastructure-cyber-lab.network-intent-run" as const, schemaVersion: INTENT_EXECUTION_VERSION, runId, contractIdentity: expansion.contractIdentity, contractRevision: expansion.contractRevision, sourceIdentity: actualSourceIdentity, sourceRevision: expansion.sourceRevision, expansionIdentity: expansion.identity, status, cases: results, counts };
  return { ...draft, identity: await hash(draft) };
}

export async function verifyIntentRunCurrent(run: IntentRun, args: { readonly contract: NetworkIntentContract; readonly source: ScenarioSource; readonly sourceIdentity?: string; readonly sourceRevision?: number }): Promise<{ readonly current: boolean; readonly status: "CURRENT" | "STALE"; readonly reason?: string }> {
  const sourceIdentity = args.sourceIdentity ?? await sourceIdentityOf(args.source);
  if (run.contractIdentity !== args.contract.identity || run.contractRevision !== args.contract.revision) return { current: false, status: "STALE", reason: "INTENT_RUN_CONTRACT_CHANGED" };
  if (run.sourceIdentity !== sourceIdentity || run.sourceRevision !== (args.sourceRevision ?? 0)) return { current: false, status: "STALE", reason: "INTENT_RUN_SOURCE_CHANGED" };
  const expansion = await expandNetworkIntent({ ...args, sourceIdentity });
  if (run.expansionIdentity !== expansion.identity) return { current: false, status: "STALE", reason: "INTENT_RUN_EXPANSION_CHANGED" };
  return { current: true, status: "CURRENT" };
}

export async function verifyIntentRunIntegrity(value: unknown, args: { readonly contract: NetworkIntentContract; readonly source: ScenarioSource; readonly sourceIdentity?: string; readonly sourceRevision?: number }): Promise<{ readonly ok: true; readonly value: IntentRun } | { readonly ok: false; readonly diagnostics: readonly string[] }> {
  if (!value || typeof value !== "object") return { ok: false, diagnostics: ["INTENT_RUN_NOT_OBJECT"] };
  const candidate = value as IntentRun;
  const errors: string[] = [];
  if (candidate.formatId !== "infrastructure-cyber-lab.network-intent-run") errors.push("INTENT_RUN_FORMAT_INVALID");
  if (candidate.schemaVersion !== INTENT_EXECUTION_VERSION) errors.push("INTENT_RUN_VERSION_UNSUPPORTED");
  const sourceIdentity = args.sourceIdentity ?? await sourceIdentityOf(args.source);
  if (candidate.contractIdentity !== args.contract.identity || candidate.contractRevision !== args.contract.revision) errors.push("INTENT_RUN_CONTRACT_BINDING_INVALID");
  if (candidate.sourceIdentity !== sourceIdentity || candidate.sourceRevision !== (args.sourceRevision ?? 0)) errors.push("INTENT_RUN_SOURCE_BINDING_INVALID");
  const expansion = await expandNetworkIntent({ ...args, sourceIdentity });
  if (candidate.expansionIdentity !== expansion.identity) errors.push("INTENT_RUN_EXPANSION_BINDING_INVALID");
  const expectedCases = new Map(expansion.cases.map((item) => [item.caseIdentity, item]));
  const seen = new Set<string>();
  const counts = emptyCounts();
  for (const result of candidate.cases ?? []) {
    const item = expectedCases.get(result.caseIdentity);
    if (!item) { errors.push("INTENT_RUN_UNKNOWN_CASE"); continue; }
    if (seen.has(result.caseIdentity)) errors.push("INTENT_RUN_DUPLICATE_CASE");
    seen.add(result.caseIdentity);
    if (result.contractIdentity !== item.contractIdentity || result.contractRevision !== item.contractRevision || result.sourceIdentity !== sourceIdentity || result.sourceRevision !== expansion.sourceRevision || result.flowId !== item.flowId || result.assertionIdentity !== item.assertionIdentity || result.expected !== item.expected) errors.push("INTENT_RUN_CASE_BINDING_INVALID");
    if (!(result.result in counts)) errors.push("INTENT_RUN_RESULT_INVALID");
    else counts[result.result] += 1;
  }
  if (seen.size !== expansion.cases.length) errors.push("INTENT_RUN_CASE_SET_INCOMPLETE");
  for (const key of Object.keys(counts) as ConcreteIntentResult[]) if (candidate.counts?.[key] !== counts[key]) errors.push("INTENT_RUN_COUNTS_INVALID");
  const { identity: _identity, ...projection } = candidate;
  if (await hash(projection) !== candidate.identity) errors.push("INTENT_RUN_IDENTITY_FAILED");
  return errors.length ? { ok: false, diagnostics: [...new Set(errors)] } : { ok: true, value: clone(candidate) };
}

export const exportIntentRun = (run: IntentRun): string => `${JSON.stringify(run, null, 2)}\n`;
export const computeIntentContractIdentity = computeNetworkIntentIdentity;
