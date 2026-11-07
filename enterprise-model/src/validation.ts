import type { EnterpriseBaseline } from "../../core-model/src/generated/contracts.js";
type EnterpriseFact = EnterpriseBaseline["facts"][number];
import { parseCidr, parseIpAddress } from "../../core-model/src/network-address.js";
import { canonicalEnterpriseJson, computeEnterpriseBaselineIdentity } from "./canonical.js";
import type { EnterpriseBaselineVerification, EnterpriseHashProvider, EnterpriseModelDiagnostic } from "./types.js";

const MAC = /^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;
const SOURCE_ID = /^src_([0-9a-f]{64})$/;

function valueMatchesType(type: EnterpriseFact["valueType"], value: unknown): boolean {
  switch (type) {
    case "boolean": return typeof value === "boolean";
    case "integer": return typeof value === "number" && Number.isSafeInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "string": return typeof value === "string";
    case "ipv4": return typeof value === "string" && !value.includes("/") && parseIpAddress(value)?.family === 4;
    case "ipv6": return typeof value === "string" && !value.includes("/") && parseIpAddress(value)?.family === 6;
    case "cidr": return typeof value === "string" && value.includes("/") && parseCidr(value) !== undefined;
    case "mac": return typeof value === "string" && MAC.test(value);
    case "port": return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 65535;
    case "protocol": return typeof value === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(value);
    case "reference": return typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
    case "list": return Array.isArray(value);
    case "map": return value !== null && typeof value === "object" && !Array.isArray(value);
    default: return false;
  }
}

function pushDuplicateDiagnostics(ids: readonly string[], kind: string, diagnostics: EnterpriseModelDiagnostic[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) diagnostics.push({ code: "ENTERPRISE_DUPLICATE_ID", path: `/${kind}`, message: `Duplicate ${kind} id: ${id}` });
    seen.add(id);
  }
}

export async function verifyEnterpriseBaseline(
  baseline: EnterpriseBaseline,
  hashProvider?: EnterpriseHashProvider,
): Promise<EnterpriseBaselineVerification> {
  const diagnostics: EnterpriseModelDiagnostic[] = [];
  const sourceIds = new Set(baseline.sources.map((x) => x.sourceId));
  const provenanceIds = new Set(baseline.provenance.map((x) => x.provenanceId));
  const entityIds = new Set(baseline.entities.map((x) => x.entityId));
  const relationshipIds = new Set(baseline.relationships.map((x) => x.relationshipId));
  const factIds = new Set(baseline.facts.map((x) => x.factId));

  pushDuplicateDiagnostics(baseline.sources.map((x) => x.sourceId), "sources", diagnostics);
  pushDuplicateDiagnostics(baseline.provenance.map((x) => x.provenanceId), "provenance", diagnostics);
  pushDuplicateDiagnostics(baseline.entities.map((x) => x.entityId), "entities", diagnostics);
  pushDuplicateDiagnostics(baseline.relationships.map((x) => x.relationshipId), "relationships", diagnostics);
  pushDuplicateDiagnostics(baseline.facts.map((x) => x.factId), "facts", diagnostics);

  const globalObjectIds = [...baseline.entities.map((x) => x.entityId), ...baseline.relationships.map((x) => x.relationshipId), ...baseline.facts.map((x) => x.factId)];
  if (new Set(globalObjectIds).size !== globalObjectIds.length) {
    diagnostics.push({ code: "ENTERPRISE_GLOBAL_ID_COLLISION", path: "/", message: "Entity, relationship and fact IDs must be globally unique." });
  }

  baseline.sources.forEach((source, index) => {
    const match = SOURCE_ID.exec(source.sourceId);
    if (!match || match[1] !== source.sha256) diagnostics.push({ code: "ENTERPRISE_SOURCE_ID_HASH_MISMATCH", path: `/sources/${index}/sourceId`, message: "sourceId must be src_ followed by the exact source SHA-256." });
  });

  baseline.provenance.forEach((prov, index) => {
    if (!sourceIds.has(prov.sourceRef)) diagnostics.push({ code: "ENTERPRISE_UNKNOWN_SOURCE_REF", path: `/provenance/${index}/sourceRef`, message: `Unknown sourceRef: ${prov.sourceRef}` });
  });

  baseline.entities.forEach((entity, index) => {
    if (entity.siteRef && !entityIds.has(entity.siteRef)) diagnostics.push({ code: "ENTERPRISE_UNKNOWN_SITE_REF", path: `/entities/${index}/siteRef`, message: `Unknown siteRef: ${entity.siteRef}` });
    if (entity.zoneRef && !entityIds.has(entity.zoneRef)) diagnostics.push({ code: "ENTERPRISE_UNKNOWN_ZONE_REF", path: `/entities/${index}/zoneRef`, message: `Unknown zoneRef: ${entity.zoneRef}` });
    for (const ref of entity.provenanceRefs ?? []) if (!provenanceIds.has(ref)) diagnostics.push({ code: "ENTERPRISE_UNKNOWN_PROVENANCE_REF", path: `/entities/${index}/provenanceRefs`, message: `Unknown provenanceRef: ${ref}` });
  });

  baseline.relationships.forEach((rel, index) => {
    if (!entityIds.has(rel.fromRef)) diagnostics.push({ code: "ENTERPRISE_UNKNOWN_RELATIONSHIP_ENDPOINT", path: `/relationships/${index}/fromRef`, message: `Unknown entity: ${rel.fromRef}` });
    if (!entityIds.has(rel.toRef)) diagnostics.push({ code: "ENTERPRISE_UNKNOWN_RELATIONSHIP_ENDPOINT", path: `/relationships/${index}/toRef`, message: `Unknown entity: ${rel.toRef}` });
    for (const ref of rel.provenanceRefs) if (!provenanceIds.has(ref)) diagnostics.push({ code: "ENTERPRISE_UNKNOWN_PROVENANCE_REF", path: `/relationships/${index}/provenanceRefs`, message: `Unknown provenanceRef: ${ref}` });
    if ((rel.state === "KNOWN" || rel.state === "INFERRED") && rel.provenanceRefs.length === 0 && rel.state === "KNOWN") diagnostics.push({ code: "ENTERPRISE_KNOWN_RELATIONSHIP_WITHOUT_PROVENANCE", path: `/relationships/${index}`, message: "KNOWN relationships require provenance." });
  });

  baseline.facts.forEach((fact, index) => {
    if (!entityIds.has(fact.subjectRef) && !relationshipIds.has(fact.subjectRef)) diagnostics.push({ code: "ENTERPRISE_UNKNOWN_FACT_SUBJECT", path: `/facts/${index}/subjectRef`, message: `Unknown fact subject: ${fact.subjectRef}` });
    if ("provenanceRefs" in fact && fact.provenanceRefs) for (const ref of fact.provenanceRefs) if (!provenanceIds.has(ref)) diagnostics.push({ code: "ENTERPRISE_UNKNOWN_PROVENANCE_REF", path: `/facts/${index}/provenanceRefs`, message: `Unknown provenanceRef: ${ref}` });
    if (fact.state === "KNOWN" || fact.state === "INFERRED") {
      if (!valueMatchesType(fact.valueType, fact.value)) diagnostics.push({ code: "ENTERPRISE_VALUE_TYPE_MISMATCH", path: `/facts/${index}/value`, message: `Value does not match declared valueType ${fact.valueType}.` });
    }
    if (fact.state === "INFERRED") {
      for (const ref of fact.inference.inputFactRefs) {
        if (!factIds.has(ref)) diagnostics.push({ code: "ENTERPRISE_UNKNOWN_INFERENCE_INPUT", path: `/facts/${index}/inference/inputFactRefs`, message: `Unknown input fact: ${ref}` });
        if (ref === fact.factId) diagnostics.push({ code: "ENTERPRISE_SELF_INFERENCE", path: `/facts/${index}/inference/inputFactRefs`, message: "A fact may not infer itself." });
      }
    }
    if (fact.state === "CONFLICTING") {
      const values = new Set<string>();
      fact.candidates.forEach((candidate, candidateIndex) => {
        if (!valueMatchesType(fact.valueType, candidate.value)) diagnostics.push({ code: "ENTERPRISE_VALUE_TYPE_MISMATCH", path: `/facts/${index}/candidates/${candidateIndex}/value`, message: `Candidate does not match declared valueType ${fact.valueType}.` });
        const key = canonicalEnterpriseJson(candidate.value);
        if (values.has(key)) diagnostics.push({ code: "ENTERPRISE_DUPLICATE_CONFLICT_CANDIDATE", path: `/facts/${index}/candidates`, message: "CONFLICTING candidates must contain distinct values." });
        values.add(key);
        for (const ref of candidate.provenanceRefs) if (!provenanceIds.has(ref)) diagnostics.push({ code: "ENTERPRISE_UNKNOWN_PROVENANCE_REF", path: `/facts/${index}/candidates/${candidateIndex}/provenanceRefs`, message: `Unknown provenanceRef: ${ref}` });
      });
    }
  });

  if (baseline.lineage) {
    const roles = baseline.lineage.parents.map((x)=>x.role);
    for (const role of ["ANCESTOR","CURRENT","INCOMING"] as const) if (roles.filter((x)=>x===role).length !== 1) diagnostics.push({ code:"ENTERPRISE_LINEAGE_PARENT_ROLE_INVALID", path:"/lineage/parents", message:`Lineage must contain exactly one ${role} parent.` });
    const resolutionKeys = baseline.lineage.resolutions.map((x)=>x.entryKey);
    if (new Set(resolutionKeys).size !== resolutionKeys.length) diagnostics.push({ code:"ENTERPRISE_LINEAGE_DUPLICATE_RESOLUTION", path:"/lineage/resolutions", message:"Lineage merge resolution entryKey values must be unique." });
  }

  const computedIdentity = await computeEnterpriseBaselineIdentity(baseline, hashProvider);
  if (computedIdentity !== baseline.baselineIdentity) diagnostics.push({ code: "ENTERPRISE_BASELINE_IDENTITY_MISMATCH", path: "/baselineIdentity", message: `Expected baselineIdentity ${computedIdentity}.` });
  return { ok: diagnostics.length === 0, computedIdentity, diagnostics };
}
