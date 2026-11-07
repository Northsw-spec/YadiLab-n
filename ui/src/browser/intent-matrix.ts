import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import { canonicalTroubleshootingJson } from "../../../observation-engine/src/index.js";
import type { EndpointSet, FlowProfile, NetworkIntentContract } from "./network-intent.js";
import {
  expandNetworkIntent,
  verifyIntentRunCurrent,
  verifyIntentRunIntegrity,
  type ConcreteIntentResult,
  type IntentExpansion,
  type IntentRun,
  type IntentRunCaseResult,
} from "./network-intent-execution.js";

export const INTENT_MATRIX_VERSION = "0.1.0" as const;
export type IntentMatrixFreshness = "CURRENT" | "STALE/HISTORICAL";
export type IntentMatrixAggregateState = ConcreteIntentResult | "MIXED" | "NO CASES";

export interface IntentMatrixCounts {
  readonly PASS: number;
  readonly FAIL: number;
  readonly UNMODELED: number;
  readonly "NOT RUN": number;
  readonly INVALID: number;
  readonly "NOT COMPARABLE": number;
  readonly UNKNOWN: number;
  readonly SIMULATION_LIMIT: number;
}

export interface IntentMatrixDimension {
  readonly id: string;
  readonly identity: string;
  readonly title: string;
  readonly nodeIds: readonly string[];
}

export interface IntentMatrixCell {
  readonly cellId: string;
  readonly sourceSetId: string;
  readonly sourceSetIdentity: string;
  readonly destinationSetId: string;
  readonly destinationSetIdentity: string;
  readonly flowProfileId: string;
  readonly flowProfileIdentity: string;
  readonly ruleIds: readonly string[];
  readonly caseIdentities: readonly string[];
  readonly counts: IntentMatrixCounts;
  readonly state: IntentMatrixAggregateState;
  readonly freshness: IntentMatrixFreshness;
}

export interface IntentResultMatrix {
  readonly formatId: "infrastructure-cyber-lab.intent-result-matrix";
  readonly schemaVersion: "0.1.0";
  readonly projectionRevision: "0.1.0";
  readonly identity: string;
  readonly runIdentity: string;
  readonly contractIdentity: string;
  readonly contractRevision: number;
  readonly sourceIdentity: string;
  readonly sourceRevision: number;
  readonly freshness: IntentMatrixFreshness;
  readonly sourceDimensions: readonly IntentMatrixDimension[];
  readonly destinationDimensions: readonly IntentMatrixDimension[];
  readonly flowProfiles: readonly IntentMatrixDimension[];
  readonly cells: readonly IntentMatrixCell[];
  readonly caseResults: readonly IntentRunCaseResult[];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hash = async (value: unknown): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalTroubleshootingJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
const sourceIdentityOf = (source: ScenarioSource): Promise<string> => hash(source);
const compare = (a: string, b: string): number => a.localeCompare(b);
const sorted = <T extends { readonly id?: string; readonly identity: string }>(items: readonly T[]): readonly T[] => [...items].sort((a, b) => (a.id ?? "").localeCompare(b.id ?? "") || a.identity.localeCompare(b.identity));
const emptyCounts = (): IntentMatrixCounts => ({ PASS: 0, FAIL: 0, UNMODELED: 0, "NOT RUN": 0, INVALID: 0, "NOT COMPARABLE": 0, UNKNOWN: 0, SIMULATION_LIMIT: 0 });

function dimension(set: EndpointSet | FlowProfile): IntentMatrixDimension {
  return { id: "setId" in set ? set.setId : set.profileId, identity: set.identity, title: set.title, nodeIds: "nodeIds" in set ? [...set.nodeIds].sort(compare) : [set.flowId] };
}

function aggregate(results: readonly IntentRunCaseResult[], freshness: IntentMatrixFreshness): { readonly counts: IntentMatrixCounts; readonly state: IntentMatrixAggregateState } {
  const counts: Record<keyof IntentMatrixCounts, number> = emptyCounts();
  for (const item of results) {
    const key = item.result as keyof IntentMatrixCounts;
    if (key in counts) counts[key] += 1;
    else counts["NOT COMPARABLE"] += 1;
  }
  if (!results.length) return { counts, state: "NO CASES" };
  const states = [...new Set(results.map((item) => item.result))];
  if (states.length === 1) return { counts, state: states[0] as IntentMatrixAggregateState };
  return { counts, state: "MIXED" };
}

function validateHistoricalRun(run: IntentRun, expansion: IntentExpansion, contract: NetworkIntentContract): void {
  if (run.contractIdentity !== contract.identity || run.contractRevision !== contract.revision || run.expansionIdentity !== expansion.identity || run.sourceIdentity !== expansion.sourceIdentity || run.sourceRevision !== expansion.sourceRevision) throw new Error("INTENT_MATRIX_HISTORICAL_BINDING_INVALID");
  const expected = new Set(expansion.cases.map((item) => item.caseIdentity));
  const actual = new Set(run.cases.map((item) => item.caseIdentity));
  if (actual.size !== run.cases.length || actual.size !== expected.size || [...expected].some((item) => !actual.has(item))) throw new Error("INTENT_MATRIX_HISTORICAL_CASE_SET_INVALID");
}

export async function buildIntentResultMatrix(args: { readonly contract: NetworkIntentContract; readonly source: ScenarioSource; readonly run: IntentRun; readonly expansion?: IntentExpansion; readonly historicalContract?: NetworkIntentContract; readonly sourceIdentity?: string; readonly sourceRevision?: number }): Promise<IntentResultMatrix> {
  const sourceIdentity = args.sourceIdentity ?? await sourceIdentityOf(args.source);
  const sourceRevision = args.sourceRevision ?? args.run.sourceRevision;
  const currentBinding = args.run.contractIdentity === args.contract.identity && args.run.contractRevision === args.contract.revision && args.run.sourceIdentity === sourceIdentity && args.run.sourceRevision === sourceRevision;
  let expansion: IntentExpansion;
  if (currentBinding) {
    const integrity = await verifyIntentRunIntegrity(args.run, { contract: args.contract, source: args.source, sourceIdentity, sourceRevision });
    if (!integrity.ok) throw new Error(integrity.diagnostics.join(","));
    expansion = await expandNetworkIntent({ contract: args.contract, source: args.source, sourceIdentity, sourceRevision });
  } else {
    if (!args.expansion) throw new Error("INTENT_MATRIX_HISTORICAL_EXPANSION_REQUIRED");
    validateHistoricalRun(args.run, args.expansion, args.historicalContract ?? args.contract);
    expansion = args.expansion;
  }
  const projectionContract = currentBinding ? args.contract : args.historicalContract ?? args.contract;
  const current = currentBinding ? await verifyIntentRunCurrent(args.run, { contract: args.contract, source: args.source, sourceIdentity, sourceRevision }) : { current: false as const, status: "STALE" as const };
  const freshness: IntentMatrixFreshness = current.current ? "CURRENT" : "STALE/HISTORICAL";
  const cases = new Map(expansion.cases.map((item) => [item.caseIdentity, item]));
  const sourceSets = sorted(projectionContract.endpointSets).map(dimension);
  const destinationSets = sorted(projectionContract.endpointSets).map(dimension);
  const profiles = sorted(projectionContract.flowProfiles).map(dimension);
  const cells: IntentMatrixCell[] = [];
  for (const sourceSet of sourceSets) for (const destinationSet of destinationSets) for (const profile of profiles) {
    const contributing = args.run.cases.filter((result) => {
      const item = cases.get(result.caseIdentity);
      return item?.sourceSetId === sourceSet.id && item.destinationSetId === destinationSet.id && item.flowProfileId === profile.id;
    });
    const ruleIds = [...new Set(contributing.flatMap((result) => { const item = cases.get(result.caseIdentity); return item ? [item.ruleId] : []; }))].sort(compare);
    const aggregateResult = aggregate(contributing, freshness);
    const cellProjection = { sourceSetIdentity: sourceSet.identity, destinationSetIdentity: destinationSet.identity, flowProfileIdentity: profile.identity, caseIdentities: contributing.map((item) => item.caseIdentity).sort(compare) };
    cells.push({ cellId: await hash(cellProjection), sourceSetId: sourceSet.id, sourceSetIdentity: sourceSet.identity, destinationSetId: destinationSet.id, destinationSetIdentity: destinationSet.identity, flowProfileId: profile.id, flowProfileIdentity: profile.identity, ruleIds, caseIdentities: cellProjection.caseIdentities, ...aggregateResult, freshness });
  }
  const projection = { formatId: "infrastructure-cyber-lab.intent-result-matrix" as const, schemaVersion: INTENT_MATRIX_VERSION, projectionRevision: INTENT_MATRIX_VERSION, runIdentity: args.run.identity, contractIdentity: projectionContract.identity, contractRevision: projectionContract.revision, sourceIdentity: expansion.sourceIdentity, sourceRevision: expansion.sourceRevision, freshness, sourceDimensions: sourceSets, destinationDimensions: destinationSets, flowProfiles: profiles, cells, caseResults: clone(args.run.cases) };
  return { ...projection, identity: await hash(projection) };
}

export async function verifyIntentResultMatrix(matrix: IntentResultMatrix, args: { readonly contract: NetworkIntentContract; readonly source: ScenarioSource; readonly run: IntentRun; readonly expansion?: IntentExpansion; readonly historicalContract?: NetworkIntentContract; readonly sourceIdentity?: string; readonly sourceRevision?: number }): Promise<{ readonly ok: true } | { readonly ok: false; readonly diagnostics: readonly string[] }> {
  try {
    const { identity: suppliedIdentity, ...suppliedProjection } = matrix;
    if (await hash(suppliedProjection) !== suppliedIdentity) return { ok: false, diagnostics: ["INTENT_MATRIX_IDENTITY_FAILED"] };
    const expected = await buildIntentResultMatrix(args);
    if (matrix.identity !== expected.identity) return { ok: false, diagnostics: ["INTENT_MATRIX_IDENTITY_FAILED"] };
    if (matrix.runIdentity !== args.run.identity) return { ok: false, diagnostics: ["INTENT_MATRIX_RUN_BINDING_INVALID"] };
    return { ok: true };
  } catch (error) {
    return { ok: false, diagnostics: [error instanceof Error ? error.message : String(error)] };
  }
}

export function filterIntentResultMatrix(matrix: IntentResultMatrix, filters: { readonly state?: IntentMatrixAggregateState; readonly sourceSetId?: string; readonly destinationSetId?: string; readonly flowProfileId?: string; readonly ruleId?: string }): IntentResultMatrix {
  const cells = matrix.cells.filter((cell) => (!filters.state || cell.state === filters.state) && (!filters.sourceSetId || cell.sourceSetId === filters.sourceSetId) && (!filters.destinationSetId || cell.destinationSetId === filters.destinationSetId) && (!filters.flowProfileId || cell.flowProfileId === filters.flowProfileId) && (!filters.ruleId || cell.ruleIds.includes(filters.ruleId)));
  return { ...matrix, cells };
}

export function intentMatrixCellCases(matrix: IntentResultMatrix, cellId: string): readonly IntentRunCaseResult[] {
  const cell = matrix.cells.find((item) => item.cellId === cellId);
  if (!cell) throw new Error("INTENT_MATRIX_UNKNOWN_CELL");
  const allowed = new Set(cell.caseIdentities);
  return matrix.caseResults.filter((item) => allowed.has(item.caseIdentity));
}
