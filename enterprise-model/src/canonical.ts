import type { EnterpriseBaseline } from "../../core-model/src/generated/contracts.js";
type EnterpriseFact = EnterpriseBaseline["facts"][number];
const ROLE_ORDER: Readonly<Record<string,number>> = { ANCESTOR:0, CURRENT:1, INCOMING:2 };
import type { EnterpriseBaselineDraft, EnterpriseHashProvider } from "./types.js";

function normalizedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedJson);
  if (value !== null && typeof value === "object") {
    const source = value as Readonly<Record<string, unknown>>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      // Hash input must retain all own JSON keys, including "__proto__".
      if (item !== undefined) Object.defineProperty(output, key, {
        value: normalizedJson(item), enumerable: true, writable: true, configurable: true,
      });
    }
    return output;
  }
  return value;
}

export function canonicalEnterpriseJson(value: unknown): string {
  return JSON.stringify(normalizedJson(value));
}

const sortBy = <T>(items: readonly T[], key: (item: T) => string): T[] =>
  [...items].sort((a, b) => key(a).localeCompare(key(b), "en"));

const sortedStrings = (items: readonly string[] | undefined): readonly string[] | undefined =>
  items ? [...items].sort((a, b) => a.localeCompare(b, "en")) : undefined;

function normalizeFact(fact: EnterpriseFact): EnterpriseFact {
  const copy: Record<string, unknown> = { ...fact };
  if ("provenanceRefs" in fact && Array.isArray(fact.provenanceRefs)) copy.provenanceRefs = sortedStrings(fact.provenanceRefs);
  if (fact.state === "INFERRED") {
    copy.inference = { ...fact.inference, inputFactRefs: sortedStrings(fact.inference.inputFactRefs) };
  }
  if (fact.state === "CONFLICTING") {
    copy.candidates = [...fact.candidates]
      .map((candidate) => ({ ...candidate, provenanceRefs: sortedStrings(candidate.provenanceRefs) }))
      .sort((a, b) => canonicalEnterpriseJson(a.value).localeCompare(canonicalEnterpriseJson(b.value), "en"));
  }
  return copy as EnterpriseFact;
}

export function enterpriseIdentityProjection(input: EnterpriseBaseline | EnterpriseBaselineDraft): unknown {
  return {
    formatId: input.formatId,
    schemaVersion: input.schemaVersion,
    modelVersion: input.modelVersion,
    baselineId: input.baselineId,
    importContract: {
      ...input.importContract,
      conflictResolutions: sortBy(input.importContract.conflictResolutions, (x) => x.resolutionId),
    },
    sources: sortBy(input.sources, (x) => x.sourceId).map(({ displayName: _displayName, ...source }) => source),
    provenance: sortBy(input.provenance, (x) => x.provenanceId),
    entities: sortBy(input.entities, (x) => x.entityId),
    relationships: sortBy(input.relationships, (x) => x.relationshipId).map((x) => ({ ...x, provenanceRefs: sortedStrings(x.provenanceRefs) })),
    facts: sortBy(input.facts, (x) => x.factId).map(normalizeFact),
    ...(input.lineage ? { lineage: { ...input.lineage, parents: [...input.lineage.parents].sort((a,b)=>(ROLE_ORDER[a.role]??99)-(ROLE_ORDER[b.role]??99)), resolutions: sortBy(input.lineage.resolutions, (x)=>x.entryKey) } } : {}),
  };
}

export const webCryptoEnterpriseHashProvider: EnterpriseHashProvider = {
  async sha256Utf8(input: string): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error("Web Crypto SHA-256 is unavailable in this runtime");
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  },
};

export async function computeEnterpriseBaselineIdentity(
  input: EnterpriseBaseline | EnterpriseBaselineDraft,
  hashProvider: EnterpriseHashProvider = webCryptoEnterpriseHashProvider,
): Promise<string> {
  return hashProvider.sha256Utf8(canonicalEnterpriseJson(enterpriseIdentityProjection(input)));
}
