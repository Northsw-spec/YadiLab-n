import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import { canonicalTroubleshootingJson } from "../../../observation-engine/src/index.js";
import type { NetworkIntentContract } from "./network-intent.js";
import { computeNetworkIntentIdentity, verifyNetworkIntentContract } from "./network-intent.js";
import type { IntentExpansion } from "./network-intent-execution.js";
import { expandNetworkIntent } from "./network-intent-execution.js";

export const INTENT_BUNDLE_VERSION = "0.1.0" as const;
export type IntentBundleStatus = "CURRENT" | "HISTORICAL";

export interface IntentBundle {
  readonly formatId: "infrastructure-cyber-lab.network-intent-bundle";
  readonly schemaVersion: "0.1.0";
  readonly bundleId: string;
  readonly contract: NetworkIntentContract;
  readonly expansion: IntentExpansion;
  readonly sourceBinding: { readonly scenarioId: string; readonly sourceIdentity: string };
  readonly preview: {
    readonly contractCount: number;
    readonly ruleCount: number;
    readonly endpointSetCount: number;
    readonly flowProfileCount: number;
    readonly expectedExpansionCount: number;
  };
  readonly status: IntentBundleStatus;
  readonly integrity: { readonly contractIdentity: string; readonly expansionIdentity: string; readonly bundleIdentity: string };
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hash = async (value: unknown): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalTroubleshootingJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
const sourceIdentityOf = (source: ScenarioSource): Promise<string> => hash(source);
const projection = (value: IntentBundle): unknown => {
  const { bundleId: _bundleId, integrity: _integrity, status: _status, ...rest } = value;
  return rest;
};

export async function createIntentBundle(args: { readonly contract: NetworkIntentContract; readonly source: ScenarioSource }): Promise<IntentBundle> {
  const checked = await verifyNetworkIntentContract(args.contract, args.source);
  if (!checked.ok) throw new Error(`INTENT_BUNDLE_CONTRACT_INVALID:${checked.diagnostics.join(",")}`);
  const expansion = await expandNetworkIntent({ contract: checked.value, source: args.source, sourceIdentity: checked.value.sourceIdentity });
  const draft = {
    formatId: "infrastructure-cyber-lab.network-intent-bundle" as const,
    schemaVersion: INTENT_BUNDLE_VERSION,
    bundleId: "0".repeat(64), contract: clone(checked.value), expansion: clone(expansion),
    sourceBinding: { scenarioId: args.source.scenarioId, sourceIdentity: checked.value.sourceIdentity },
    preview: { contractCount: 1, ruleCount: checked.value.rules.length, endpointSetCount: checked.value.endpointSets.length, flowProfileCount: checked.value.flowProfiles.length, expectedExpansionCount: expansion.caseCount },
    status: "CURRENT" as const,
    integrity: { contractIdentity: checked.value.identity, expansionIdentity: expansion.identity, bundleIdentity: "0".repeat(64) },
  };
  const bundleIdentity = await hash(projection(draft as IntentBundle));
  return { ...draft, bundleId: bundleIdentity, integrity: { ...draft.integrity, bundleIdentity } };
}

export async function verifyIntentBundle(value: unknown, source?: ScenarioSource): Promise<{ readonly ok: true; readonly value: IntentBundle } | { readonly ok: false; readonly diagnostics: readonly string[] }> {
  if (!value || typeof value !== "object") return { ok: false, diagnostics: ["INTENT_BUNDLE_NOT_OBJECT"] };
  const candidate = value as Partial<IntentBundle>;
  const errors: string[] = [];
  if (candidate.formatId !== "infrastructure-cyber-lab.network-intent-bundle") errors.push("INTENT_BUNDLE_FORMAT_INVALID");
  if (candidate.schemaVersion !== INTENT_BUNDLE_VERSION) errors.push("INTENT_BUNDLE_VERSION_UNSUPPORTED");
  if (!candidate.contract || !candidate.expansion || !candidate.sourceBinding || !candidate.preview || !candidate.integrity) errors.push("INTENT_BUNDLE_REQUIRED_FIELDS_MISSING");
  if (candidate.contract && source) { const checked = await verifyNetworkIntentContract(candidate.contract, source); if (!checked.ok) errors.push(...checked.diagnostics); else if (checked.value.sourceIdentity !== candidate.sourceBinding?.sourceIdentity || await sourceIdentityOf(source) !== candidate.sourceBinding?.sourceIdentity) errors.push("INTENT_BUNDLE_SOURCE_BINDING_MISMATCH"); }
  if (candidate.sourceBinding && source && candidate.sourceBinding.scenarioId !== source.scenarioId) errors.push("INTENT_BUNDLE_SCENARIO_BINDING_MISMATCH");
  if (candidate.status !== "CURRENT" && candidate.status !== "HISTORICAL") errors.push("INTENT_BUNDLE_STATUS_INVALID");
  if (candidate.contract && candidate.integrity && candidate.integrity.contractIdentity !== candidate.contract.identity) errors.push("INTENT_BUNDLE_CONTRACT_INTEGRITY_FAILED");
  if (candidate.expansion && candidate.integrity && candidate.integrity.expansionIdentity !== candidate.expansion.identity) errors.push("INTENT_BUNDLE_EXPANSION_INTEGRITY_FAILED");
  if (candidate.preview && candidate.contract && candidate.expansion && (candidate.preview.ruleCount !== candidate.contract.rules.length || candidate.preview.endpointSetCount !== candidate.contract.endpointSets.length || candidate.preview.flowProfileCount !== candidate.contract.flowProfiles.length || candidate.preview.expectedExpansionCount !== candidate.expansion.caseCount)) errors.push("INTENT_BUNDLE_PREVIEW_INTEGRITY_FAILED");
  if (candidate.integrity && candidate.bundleId && candidate.integrity.bundleIdentity !== candidate.bundleId) errors.push("INTENT_BUNDLE_IDENTITY_BINDING_FAILED");
  if (candidate.expansion && candidate.contract && (candidate.expansion.contractIdentity !== candidate.contract.identity || candidate.expansion.contractRevision !== candidate.contract.revision)) errors.push("INTENT_BUNDLE_EXPANSION_CONTRACT_BINDING_FAILED");
  if (candidate.expansion && candidate.sourceBinding && candidate.expansion.sourceIdentity !== candidate.sourceBinding.sourceIdentity) errors.push("INTENT_BUNDLE_EXPANSION_SOURCE_BINDING_FAILED");
  if (candidate.expansion && candidate.expansion.caseCount !== candidate.expansion.cases.length) errors.push("INTENT_BUNDLE_EXPANSION_COUNT_INVALID");
  if (candidate.expansion) {
    const caseIds = new Set(candidate.expansion.cases.map((item) => item.caseIdentity));
    if (caseIds.size !== candidate.expansion.cases.length) errors.push("INTENT_BUNDLE_EXPANSION_DUPLICATE_CASE_ID");
  }
  if (candidate.expansion && source && candidate.contract && candidate.sourceBinding) {
    try {
      const expectedExpansion = await expandNetworkIntent({ contract: candidate.contract, source, sourceIdentity: candidate.sourceBinding.sourceIdentity, sourceRevision: candidate.expansion.sourceRevision });
      if (expectedExpansion.identity !== candidate.expansion.identity) errors.push("INTENT_BUNDLE_EXPANSION_INTEGRITY_FAILED");
    } catch { errors.push("INTENT_BUNDLE_EXPANSION_INVALID"); }
  }
  if (candidate.bundleId && await hash(projection(candidate as IntentBundle)) !== candidate.bundleId) errors.push("INTENT_BUNDLE_IDENTITY_FAILED");
  return errors.length ? { ok: false, diagnostics: [...new Set(errors)] } : { ok: true, value: clone(candidate as IntentBundle) };
}

export function previewIntentBundle(value: IntentBundle): Readonly<Record<string, unknown>> {
  return { formatId: value.formatId, schemaVersion: value.schemaVersion, sourceBinding: clone(value.sourceBinding), ...clone(value.preview), status: value.status, integrity: "VERIFIED" };
}
export function exportIntentBundle(value: IntentBundle): string { return `${JSON.stringify(value, null, 2)}\n`; }
export async function importIntentBundle(text: string, source?: ScenarioSource): Promise<{ readonly ok: true; readonly value: IntentBundle } | { readonly ok: false; readonly diagnostics: readonly string[] }> {
  try { const checked = await verifyIntentBundle(JSON.parse(text) as unknown, source); return checked.ok ? { ok: true, value: { ...checked.value, status: "HISTORICAL" } } : checked; }
  catch { return { ok: false, diagnostics: ["INTENT_BUNDLE_JSON_INVALID"] }; }
}

export async function rebindIntentBundleForSource(bundle: IntentBundle, source: ScenarioSource): Promise<NetworkIntentContract> {
  const checked = await verifyIntentBundle(bundle);
  if (!checked.ok) throw new Error(checked.diagnostics.join(","));
  const sourceIdentity = await hash(source);
  const rebound = { ...clone(checked.value.contract), sourceIdentity, identity: "0".repeat(64), contractId: "0".repeat(64) };
  const identity = await computeNetworkIntentIdentity(rebound);
  return { ...rebound, identity, contractId: identity };
}
