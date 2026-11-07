import type { EnterpriseBaseline, EnterpriseReimportMergePlan } from "../../core-model/src/generated/contracts.js";
import { canonicalEnterpriseJson, computeEnterpriseBaselineIdentity } from "../../enterprise-model/src/canonical.js";
import { verifyEnterpriseBaseline } from "../../enterprise-model/src/validation.js";
import { webCryptoEnterpriseHashProvider } from "../../enterprise-model/src/canonical.js";
import { EnterpriseImportError } from "./types.js";

export type EnterpriseMergeResolution = Readonly<{ entryKey: string; choice: "CURRENT" | "INCOMING" | "DELETE" }>;
export interface EnterpriseMergeApplyResult { readonly planHash: string; readonly baseline: EnterpriseBaseline; readonly resolutions: readonly EnterpriseMergeResolution[]; }

type Entity = EnterpriseBaseline["entities"][number];
type Relationship = EnterpriseBaseline["relationships"][number];
type Fact = EnterpriseBaseline["facts"][number];
type PlanEntry = EnterpriseReimportMergePlan["entries"][number];
type ObjectKind = PlanEntry["objectKind"];

type AnyObject = Entity | Relationship | Fact;

const ROLE_ORDER: Record<string, number> = { ANCESTOR: 0, CURRENT: 1, INCOMING: 2 };

function stripProvenance(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripProvenance);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "provenanceRefs" || k === "factId") continue;
      out[k] = stripProvenance(v);
    }
    return out;
  }
  return value;
}

function semantic(kind: ObjectKind, value: AnyObject | undefined): unknown {
  if (!value) return { __absent: true };
  if (kind === "ENTITY") {
    const { provenanceRefs: _p, ...rest } = value as Entity;
    return rest;
  }
  if (kind === "RELATIONSHIP") {
    const { provenanceRefs: _p, ...rest } = value as Relationship;
    return rest;
  }
  return stripProvenance(value as Fact);
}

function full(value: AnyObject | undefined): unknown { return value ?? { __absent: true }; }
function same(a: unknown, b: unknown): boolean { return canonicalEnterpriseJson(a) === canonicalEnterpriseJson(b); }
function factKey(fact: Fact): string { return `${fact.subjectRef}\u0000${fact.path}`; }
function entryKey(kind: ObjectKind, key: string): string {
  if (kind === "FACT") {
    const [subject, path] = key.split("\u0000") as [string, string];
    return `fact:${subject}:${path}`;
  }
  return `${kind === "ENTITY" ? "entity" : "relationship"}:${key}`;
}

function indexUnique<T>(items: readonly T[], key: (item: T) => string, code: string): Map<string, T> {
  const out = new Map<string, T>();
  for (const item of items) {
    const k = key(item);
    if (out.has(k)) throw new EnterpriseImportError(code, `Ambiguous merge key ${k}.`);
    out.set(k, item);
  }
  return out;
}

async function assertValidInput(label: string, baseline: EnterpriseBaseline): Promise<void> {
  const result = await verifyEnterpriseBaseline(baseline);
  if (!result.ok) throw new EnterpriseImportError("REIMPORT_MERGE_INPUT_INVALID", `${label} baseline is invalid: ${result.diagnostics.map((x) => x.code).join(", ")}.`);
}

function baselineRef(x: EnterpriseBaseline): { baselineId: string; baselineIdentity: string } {
  return { baselineId: x.baselineId, baselineIdentity: x.baselineIdentity };
}

function classify(kind: ObjectKind, key: string, ancestor: AnyObject | undefined, current: AnyObject | undefined, incoming: AnyObject | undefined): PlanEntry | undefined {
  const aFull = full(ancestor), cFull = full(current), iFull = full(incoming);
  const aSem = semantic(kind, ancestor), cSem = semantic(kind, current), iSem = semantic(kind, incoming);
  const currentChanged = !same(aFull, cFull);
  const incomingChanged = !same(aFull, iFull);
  if (!currentChanged && !incomingChanged) return undefined;

  const base = { entryKey: entryKey(kind, key), objectKind: kind, ...(ancestor ? { ancestor } : {}), ...(current ? { current } : {}), ...(incoming ? { incoming } : {}) } as const;
  if (!currentChanged && incomingChanged) {
    const provenanceOnly = same(aSem, iSem);
    return { ...base, decision: "AUTO_APPLY_INCOMING", reason: provenanceOnly ? "INCOMING_PROVENANCE_REFRESH" : "CURRENT_UNCHANGED_INCOMING_CHANGED" };
  }
  if (currentChanged && !incomingChanged) return { ...base, decision: "KEEP_CURRENT", reason: "CURRENT_CHANGED_INCOMING_UNCHANGED" };
  if (same(cSem, iSem)) return { ...base, decision: "ALREADY_CONVERGED", reason: "BOTH_CHANGED_SAME" };
  return { ...base, decision: "REVIEW_REQUIRED", reason: "BOTH_CHANGED_DIFFERENT" };
}

function collectEntries(kind: ObjectKind, ancestor: Map<string, AnyObject>, current: Map<string, AnyObject>, incoming: Map<string, AnyObject>): PlanEntry[] {
  const keys = [...new Set([...ancestor.keys(), ...current.keys(), ...incoming.keys()])].sort((a, b) => a.localeCompare(b, "en"));
  const out: PlanEntry[] = [];
  for (const key of keys) {
    const item = classify(kind, key, ancestor.get(key), current.get(key), incoming.get(key));
    if (item) out.push(item);
  }
  return out;
}

export async function planEnterpriseReimportMerge(ancestor: EnterpriseBaseline, current: EnterpriseBaseline, incoming: EnterpriseBaseline): Promise<EnterpriseReimportMergePlan> {
  if (ancestor.baselineId !== current.baselineId || ancestor.baselineId !== incoming.baselineId) throw new EnterpriseImportError("REIMPORT_MERGE_BASELINE_ID_MISMATCH", "Three-way merge requires the same baselineId for ancestor, current and incoming baselines.");
  await assertValidInput("ancestor", ancestor); await assertValidInput("current", current); await assertValidInput("incoming", incoming);

  const entries = [
    ...collectEntries("ENTITY", indexUnique(ancestor.entities, x => x.entityId, "REIMPORT_MERGE_DUPLICATE_ENTITY_KEY") as Map<string, AnyObject>, indexUnique(current.entities, x => x.entityId, "REIMPORT_MERGE_DUPLICATE_ENTITY_KEY") as Map<string, AnyObject>, indexUnique(incoming.entities, x => x.entityId, "REIMPORT_MERGE_DUPLICATE_ENTITY_KEY") as Map<string, AnyObject>),
    ...collectEntries("RELATIONSHIP", indexUnique(ancestor.relationships, x => x.relationshipId, "REIMPORT_MERGE_DUPLICATE_RELATIONSHIP_KEY") as Map<string, AnyObject>, indexUnique(current.relationships, x => x.relationshipId, "REIMPORT_MERGE_DUPLICATE_RELATIONSHIP_KEY") as Map<string, AnyObject>, indexUnique(incoming.relationships, x => x.relationshipId, "REIMPORT_MERGE_DUPLICATE_RELATIONSHIP_KEY") as Map<string, AnyObject>),
    ...collectEntries("FACT", indexUnique(ancestor.facts, factKey, "REIMPORT_MERGE_AMBIGUOUS_FACT_KEY") as Map<string, AnyObject>, indexUnique(current.facts, factKey, "REIMPORT_MERGE_AMBIGUOUS_FACT_KEY") as Map<string, AnyObject>, indexUnique(incoming.facts, factKey, "REIMPORT_MERGE_AMBIGUOUS_FACT_KEY") as Map<string, AnyObject>),
  ].sort((a, b) => a.entryKey.localeCompare(b.entryKey, "en"));

  const summary = { autoApplyIncoming: 0, keepCurrent: 0, alreadyConverged: 0, reviewRequired: 0 };
  for (const e of entries) {
    if (e.decision === "AUTO_APPLY_INCOMING") summary.autoApplyIncoming++;
    else if (e.decision === "KEEP_CURRENT") summary.keepCurrent++;
    else if (e.decision === "ALREADY_CONVERGED") summary.alreadyConverged++;
    else summary.reviewRequired++;
  }
  const diagnostics: EnterpriseReimportMergePlan["diagnostics"][number][] = entries.filter((x) => x.decision === "REVIEW_REQUIRED").map((x) => ({ code: "REIMPORT_MERGE_REVIEW_REQUIRED", severity: "warning", message: "Current and incoming state changed differently from the common ancestor and require an explicit choice.", entryKey: x.entryKey }));
  return {
    formatId: "infrastructure-cyber-lab.enterprise-reimport-merge-plan", schemaVersion: "0.1.0",
    status: summary.reviewRequired > 0 ? "REVIEW_REQUIRED" : "READY",
    ancestorBaseline: baselineRef(ancestor), currentBaseline: baselineRef(current), incomingBaseline: baselineRef(incoming), summary, entries, diagnostics,
  };
}

export async function computeEnterpriseMergePlanHash(plan: EnterpriseReimportMergePlan): Promise<string> {
  return webCryptoEnterpriseHashProvider.sha256Utf8(canonicalEnterpriseJson(plan));
}

function unionById<T>(left: readonly T[], right: readonly T[], key: (x: T) => string, code: string): Map<string, T> {
  const out = new Map<string, T>();
  for (const item of [...left, ...right]) {
    const k = key(item); const existing = out.get(k);
    if (existing && !same(existing, item)) throw new EnterpriseImportError(code, `Conflicting dependency object ${k}.`);
    out.set(k, item);
  }
  return out;
}

function chosenProvenanceRefs(entities: readonly Entity[], relationships: readonly Relationship[], facts: readonly Fact[]): Set<string> {
  const refs = new Set<string>();
  for (const e of entities) for (const r of e.provenanceRefs ?? []) refs.add(r);
  for (const r of relationships) for (const p of r.provenanceRefs) refs.add(p);
  for (const f of facts) {
    if ("provenanceRefs" in f && f.provenanceRefs) for (const p of f.provenanceRefs) refs.add(p);
    if (f.state === "CONFLICTING") for (const c of f.candidates) for (const p of c.provenanceRefs) refs.add(p);
  }
  return refs;
}

function mapForKind(baseline: EnterpriseBaseline, kind: ObjectKind): Map<string, AnyObject> {
  if (kind === "ENTITY") return indexUnique(baseline.entities, x => x.entityId, "REIMPORT_MERGE_DUPLICATE_ENTITY_KEY") as Map<string, AnyObject>;
  if (kind === "RELATIONSHIP") return indexUnique(baseline.relationships, x => x.relationshipId, "REIMPORT_MERGE_DUPLICATE_RELATIONSHIP_KEY") as Map<string, AnyObject>;
  return indexUnique(baseline.facts, factKey, "REIMPORT_MERGE_AMBIGUOUS_FACT_KEY") as Map<string, AnyObject>;
}

function rawKeyFromEntry(entry: PlanEntry): string {
  if (entry.objectKind === "ENTITY") return entry.entryKey.slice("entity:".length);
  if (entry.objectKind === "RELATIONSHIP") return entry.entryKey.slice("relationship:".length);
  const rest = entry.entryKey.slice("fact:".length); const split = rest.indexOf(":/");
  if (split < 0) throw new EnterpriseImportError("REIMPORT_MERGE_ENTRY_KEY_INVALID", `Invalid fact merge entry key ${entry.entryKey}.`);
  return `${rest.slice(0, split)}\u0000${rest.slice(split + 1)}`;
}

export async function applyEnterpriseReimportMerge(args: {
  ancestor: EnterpriseBaseline; current: EnterpriseBaseline; incoming: EnterpriseBaseline; plan: EnterpriseReimportMergePlan; resolutions?: readonly EnterpriseMergeResolution[];
}): Promise<EnterpriseMergeApplyResult> {
  const fresh = await planEnterpriseReimportMerge(args.ancestor, args.current, args.incoming);
  if (!same(fresh, args.plan)) throw new EnterpriseImportError("REIMPORT_MERGE_PLAN_STALE", "Merge plan does not match the supplied ancestor/current/incoming baselines.");
  const resolutions = [...(args.resolutions ?? [])].sort((a, b) => a.entryKey.localeCompare(b.entryKey, "en"));
  const resolutionByKey = new Map<string, EnterpriseMergeResolution>();
  for (const r of resolutions) {
    if (resolutionByKey.has(r.entryKey)) throw new EnterpriseImportError("REIMPORT_MERGE_RESOLUTION_DUPLICATE", `Duplicate merge resolution for ${r.entryKey}.`);
    resolutionByKey.set(r.entryKey, r);
  }
  const reviewKeys = new Set(args.plan.entries.filter((x) => x.decision === "REVIEW_REQUIRED").map((x) => x.entryKey));
  for (const r of resolutions) if (!reviewKeys.has(r.entryKey)) throw new EnterpriseImportError("REIMPORT_MERGE_RESOLUTION_STALE", `Resolution ${r.entryKey} does not match a current review-required merge entry.`);
  for (const key of reviewKeys) if (!resolutionByKey.has(key)) throw new EnterpriseImportError("REIMPORT_MERGE_RESOLUTION_REQUIRED", `Merge entry ${key} requires an explicit resolution.`);

  const selected = {
    ENTITY: mapForKind(args.current, "ENTITY"), RELATIONSHIP: mapForKind(args.current, "RELATIONSHIP"), FACT: mapForKind(args.current, "FACT"),
  } satisfies Record<ObjectKind, Map<string, AnyObject>>;
  const incomingMaps = { ENTITY: mapForKind(args.incoming, "ENTITY"), RELATIONSHIP: mapForKind(args.incoming, "RELATIONSHIP"), FACT: mapForKind(args.incoming, "FACT") } satisfies Record<ObjectKind, Map<string, AnyObject>>;

  for (const entry of args.plan.entries) {
    const key = rawKeyFromEntry(entry); let choice: "CURRENT" | "INCOMING" | "DELETE";
    if (entry.decision === "AUTO_APPLY_INCOMING" || entry.decision === "ALREADY_CONVERGED") choice = incomingMaps[entry.objectKind].has(key) ? "INCOMING" : "DELETE";
    else if (entry.decision === "KEEP_CURRENT") choice = selected[entry.objectKind].has(key) ? "CURRENT" : "DELETE";
    else choice = resolutionByKey.get(entry.entryKey)!.choice;
    if (choice === "DELETE") { selected[entry.objectKind].delete(key); continue; }
    if (choice === "CURRENT") {
      if (!selected[entry.objectKind].has(key)) throw new EnterpriseImportError("REIMPORT_MERGE_RESOLUTION_INVALID", `CURRENT is absent for ${entry.entryKey}.`);
      continue;
    }
    const incomingValue = incomingMaps[entry.objectKind].get(key);
    if (!incomingValue) throw new EnterpriseImportError("REIMPORT_MERGE_RESOLUTION_INVALID", `INCOMING is absent for ${entry.entryKey}.`);
    selected[entry.objectKind].set(key, incomingValue);
  }

  const entities = [...selected.ENTITY.values()] as Entity[];
  const relationships = [...selected.RELATIONSHIP.values()] as Relationship[];
  const facts = [...selected.FACT.values()] as Fact[];
  entities.sort((a, b) => a.entityId.localeCompare(b.entityId, "en"));
  relationships.sort((a, b) => a.relationshipId.localeCompare(b.relationshipId, "en"));
  facts.sort((a, b) => factKey(a).localeCompare(factKey(b), "en"));

  const provenancePool = unionById(args.current.provenance, args.incoming.provenance, x => x.provenanceId, "REIMPORT_MERGE_PROVENANCE_COLLISION");
  const requiredProv = chosenProvenanceRefs(entities, relationships, facts);
  const provenance = [...requiredProv].sort((a, b) => a.localeCompare(b, "en")).map((id) => {
    const p = provenancePool.get(id); if (!p) throw new EnterpriseImportError("REIMPORT_MERGE_MISSING_PROVENANCE", `Selected object references missing provenance ${id}.`); return p;
  });
  const sourcePool = new Map<string, EnterpriseBaseline["sources"][number]>();
  for (const source of [...args.current.sources, ...args.incoming.sources]) {
    const existing = sourcePool.get(source.sourceId);
    if (existing) {
      const { displayName: _a, ...a } = existing; const { displayName: _b, ...b } = source;
      if (!same(a,b)) throw new EnterpriseImportError("REIMPORT_MERGE_SOURCE_COLLISION", `Conflicting source descriptor ${source.sourceId}.`);
    }
    sourcePool.set(source.sourceId, source);
  }
  const sourceIds = new Set(provenance.map((x) => x.sourceRef));
  for (const source of args.incoming.sources) sourceIds.add(source.sourceId);
  const sources = [...sourceIds].sort((a, b) => a.localeCompare(b, "en")).map((id) => {
    const s = sourcePool.get(id); if (!s) throw new EnterpriseImportError("REIMPORT_MERGE_MISSING_SOURCE", `Selected provenance references missing source ${id}.`); return s;
  });

  const planHash = await computeEnterpriseMergePlanHash(args.plan);
  if (args.plan.entries.length === 0 && args.current.baselineIdentity === args.incoming.baselineIdentity && resolutions.length === 0) {
    return { planHash, baseline: args.current, resolutions };
  }
  const lineage: NonNullable<EnterpriseBaseline["lineage"]> = {
    kind: "REIMPORT_MERGE", mergePlanSha256: planHash,
    parents: [
      { role: "ANCESTOR", baselineIdentity: args.ancestor.baselineIdentity },
      { role: "CURRENT", baselineIdentity: args.current.baselineIdentity },
      { role: "INCOMING", baselineIdentity: args.incoming.baselineIdentity },
    ], resolutions: resolutions.map((x) => ({ entryKey: x.entryKey, choice: x.choice })),
  };
  const draft = {
    formatId: args.incoming.formatId, schemaVersion: args.incoming.schemaVersion, modelVersion: args.incoming.modelVersion,
    baselineId: args.incoming.baselineId, baselineIdentity: "0".repeat(64), importContract: args.incoming.importContract,
    sources, provenance, entities, relationships, facts, lineage,
  } as EnterpriseBaseline;
  const baselineIdentity = await computeEnterpriseBaselineIdentity(draft);
  const baseline = { ...draft, baselineIdentity } as EnterpriseBaseline;
  const verification = await verifyEnterpriseBaseline(baseline);
  if (!verification.ok) throw new EnterpriseImportError("REIMPORT_MERGE_RESULT_INVALID", `Merged baseline failed semantic verification: ${verification.diagnostics.map((x) => x.code).join(", ")}.`);
  return { planHash, baseline, resolutions };
}
