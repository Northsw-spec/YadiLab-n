import type {
  EnterpriseBaseline,
  EnterpriseTopologyProjection,
  ScenarioSource,
  Scenariosourceconnection,
  Scenariosourceresource,
  Scenariosourcezone,
} from "../../core-model/src/generated/contracts.js";
import { verifyEnterpriseBaseline } from "../../enterprise-model/src/index.js";
import type { EnterpriseProjectionInput, EnterpriseProjectionResult } from "./types.js";

export type { EnterpriseProjectionInput, EnterpriseProjectionOptions, EnterpriseProjectionResult } from "./types.js";

export const ENTERPRISE_PROJECTION_VERSION = "0.1.0" as const;
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const ZONE_KINDS = new Set(["internet", "wan", "dmz", "lan", "server", "management", "security", "backup", "guest", "custom"]);

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((x) => clone(x)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (v !== undefined) out[k] = clone(v);
    return out as T;
  }
  return value;
}

function scenarioIdFor(baseline: EnterpriseBaseline, requested?: string): string {
  if (requested !== undefined) return requested;
  const base = baseline.baselineId.slice(0, 48).replace(/_+$/g, "") || "baseline";
  return `ent_${base}_${baseline.baselineIdentity.slice(0, 8)}`.slice(0, 64).replace(/_+$/g, "");
}

function diagnostic(severity: "info" | "warning" | "error", code: string, message: string, objectId?: string) {
  return objectId ? { severity, code, message, objectId } as const : { severity, code, message } as const;
}

function factValue(fact: EnterpriseBaseline["facts"][number]): unknown | undefined {
  return fact.state === "KNOWN" || fact.state === "INFERRED" ? fact.value : undefined;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function resolvedFactByPath(
  facts: readonly EnterpriseBaseline["facts"][number][],
  path: string,
  diagnostics: ReturnType<typeof diagnostic>[],
  objectId: string,
): EnterpriseBaseline["facts"][number] | undefined {
  const candidates = facts.filter((fact) => fact.path === path && (fact.state === "KNOWN" || fact.state === "INFERRED"));
  if (candidates.length === 0) return undefined;
  const signatures = new Set(candidates.map((fact) => canonical(factValue(fact))));
  if (signatures.size > 1) {
    diagnostics.push(diagnostic("warning", "PROJECTION_FACT_PATH_CONFLICT", `Multiple resolved facts disagree at '${path}'; active scenario semantics were not projected for that path.`, objectId));
    return undefined;
  }
  return [...candidates].sort((a, b) => a.factId.localeCompare(b.factId, "en"))[0];
}

type ConcreteZoneKind = Exclude<Scenariosourcezone["kind"], undefined>;

function zoneKindFor(entity: EnterpriseBaseline["entities"][number], facts: readonly EnterpriseBaseline["facts"][number][], diagnostics: ReturnType<typeof diagnostic>[]): ConcreteZoneKind {
  const fact = resolvedFactByPath(facts, "/zone/kind", diagnostics, entity.entityId);
  const value = fact && factValue(fact);
  if (typeof value === "string" && ZONE_KINDS.has(value)) return value as ConcreteZoneKind;
  if (entity.entityType === "network.internet") return "internet";
  if (entity.entityType.endsWith(".dmz")) return "dmz";
  if (entity.entityType.endsWith(".management_zone")) return "management";
  return "custom";
}

function isDeclaredZoneType(entityType: string): boolean {
  return entityType === "location.site" || entityType === "network.site" || entityType === "network.zone" || entityType.endsWith(".site") || entityType.endsWith(".zone");
}

function requiredCapabilityForType(type: string): string | undefined {
  if (type.startsWith("network.")) return "core.network";
  if (type.startsWith("identity.")) return "core.identity";
  if (type.startsWith("windows.")) return "core.windows";
  if (type.startsWith("linux.")) return "core.linux";
  if (type.startsWith("virtualization.")) return "core.virtualization";
  if (type.startsWith("security.")) return "core.security";
  if (type.startsWith("logging.")) return "core.logging";
  if (type.startsWith("backup.")) return "core.backup";
  return undefined;
}

function relationKind(type: string): Scenariosourceconnection["kind"] | undefined {
  if (type === "network.management" || type.startsWith("management.")) return "management";
  if (type.startsWith("network.")) return "network";
  if (type === "identity.trust" || type.startsWith("trust.")) return "trust";
  if (type === "identity.authentication" || type.startsWith("authentication.")) return "authentication";
  return undefined;
}

function pointerSegment(value: string): string {
  return value.replace(/~1/g, "/").replace(/~0/g, "~");
}

function factsFor(baseline: EnterpriseBaseline, subjectRef: string): readonly EnterpriseBaseline["facts"][number][] {
  return baseline.facts.filter((fact) => fact.subjectRef === subjectRef).sort((a, b) => a.factId.localeCompare(b.factId, "en"));
}

function relevantProvenance(baseline: EnterpriseBaseline, refs: readonly string[]) {
  const wanted = new Set(refs);
  return baseline.provenance.filter((p) => wanted.has(p.provenanceId)).sort((a, b) => a.provenanceId.localeCompare(b.provenanceId, "en")).map(clone);
}

function projectResource(
  baseline: EnterpriseBaseline,
  entity: EnterpriseBaseline["entities"][number],
  zoneIds: ReadonlySet<string>,
  diagnostics: ReturnType<typeof diagnostic>[],
): { resource: Scenariosourceresource; projectedFacts: number } {
  const facts = factsFor(baseline, entity.entityId);
  const projectedFactIds = new Set<string>();
  const ifaceMap = new Map<string, { id: string; label: string; addresses: string[]; mac?: string }>();

  for (const fact of facts) {
    if (fact.state !== "KNOWN" && fact.state !== "INFERRED") continue;
    const match = /^\/network\/interfaces\/([^/]+)\/(ipv4|ipv6|cidr|addresses|mac|label)$/.exec(fact.path);
    if (!match) continue;
    const ifaceId = pointerSegment(match[1]!);
    if (!ID.test(ifaceId)) {
      diagnostics.push(diagnostic("warning", "PROJECTION_INTERFACE_ID_UNSUPPORTED", `Interface path '${fact.path}' contains an interface identifier that cannot be represented as a scenario ID.`, entity.entityId));
      continue;
    }
    const iface = ifaceMap.get(ifaceId) ?? { id: ifaceId, label: ifaceId, addresses: [] };
    const value = factValue(fact);
    if (match[2] === "label" && typeof value === "string") { iface.label = value; projectedFactIds.add(fact.factId); }
    else if (match[2] === "mac" && typeof value === "string") { iface.mac = value; projectedFactIds.add(fact.factId); }
    else if ((match[2] === "ipv4" || match[2] === "ipv6" || match[2] === "cidr") && typeof value === "string") { iface.addresses.push(value); projectedFactIds.add(fact.factId); }
    else if (match[2] === "addresses" && Array.isArray(value) && value.every((x) => typeof x === "string")) { iface.addresses.push(...value); projectedFactIds.add(fact.factId); }
    ifaceMap.set(ifaceId, iface);
  }

  const properties: Record<string, unknown> = {};
  const directMappings: readonly [string, string][] = [
    ["/network/defaultGateway", "defaultGateway"],
    ["/network/routes", "routes"],
    ["/network/firewall/rules", "rules"],
    ["/network/rules", "rules"],
    ["/network/natRules", "natRules"],
    ["/network/snatPolicy", "snatPolicy"],
    ["/services", "services"],
    ["/network/services", "services"],
  ];
  for (const [path, key] of directMappings) {
    const fact = resolvedFactByPath(facts, path, diagnostics, entity.entityId);
    if (!fact) continue;
    properties[key] = clone(factValue(fact));
    projectedFactIds.add(fact.factId);
  }

  const vendorFact = resolvedFactByPath(facts, "/asset/vendor", diagnostics, entity.entityId) ?? resolvedFactByPath(facts, "/vendor", diagnostics, entity.entityId);
  const productFact = resolvedFactByPath(facts, "/asset/product", diagnostics, entity.entityId) ?? resolvedFactByPath(facts, "/product", diagnostics, entity.entityId);
  const vendor = vendorFact && factValue(vendorFact);
  const product = productFact && factValue(productFact);
  if (vendorFact && typeof vendor === "string") projectedFactIds.add(vendorFact.factId);
  if (productFact && typeof product === "string") projectedFactIds.add(productFact.factId);

  const allProvRefs = new Set<string>(entity.provenanceRefs ?? []);
  for (const fact of facts) if ("provenanceRefs" in fact && fact.provenanceRefs) for (const ref of fact.provenanceRefs) allProvRefs.add(ref);
  const relationships = baseline.relationships.filter((rel) => rel.fromRef === entity.entityId || rel.toRef === entity.entityId).sort((a, b) => a.relationshipId.localeCompare(b.relationshipId, "en"));
  for (const rel of relationships) for (const ref of rel.provenanceRefs) allProvRefs.add(ref);

  properties.enterprise = {
    baselineId: baseline.baselineId,
    baselineIdentity: baseline.baselineIdentity,
    entityId: entity.entityId,
    entityType: entity.entityType,
    provenanceRefs: [...(entity.provenanceRefs ?? [])].sort((a, b) => a.localeCompare(b, "en")),
    provenance: relevantProvenance(baseline, [...allProvRefs]),
    facts: facts.map(clone),
    relationships: relationships.map(clone),
    projectionReady: true,
  };

  const zone = entity.zoneRef && zoneIds.has(entity.zoneRef) ? entity.zoneRef : entity.siteRef && zoneIds.has(entity.siteRef) ? entity.siteRef : undefined;
  const interfaces = [...ifaceMap.values()].sort((a, b) => a.id.localeCompare(b.id, "en")).map((iface) => ({
    id: iface.id,
    label: iface.label,
    addresses: [...new Set(iface.addresses)].sort((a, b) => a.localeCompare(b, "en")),
    ...(iface.mac ? { mac: iface.mac } : {}),
  }));

  return {
    resource: {
      id: entity.entityId,
      type: entity.entityType,
      label: entity.label,
      ...(zone ? { zone } : {}),
      ...(typeof vendor === "string" ? { vendor } : {}),
      ...(typeof product === "string" ? { product } : {}),
      interfaces,
      properties,
    },
    projectedFacts: projectedFactIds.size,
  };
}

export async function projectEnterpriseBaselineToScenario(input: EnterpriseProjectionInput): Promise<EnterpriseProjectionResult> {
  const { baseline } = input;
  const options = input.options ?? {};
  const diagnostics: ReturnType<typeof diagnostic>[] = [];
  const scenarioId = scenarioIdFor(baseline, options.scenarioId);
  if (!ID.test(scenarioId)) diagnostics.push(diagnostic("error", "PROJECTION_SCENARIO_ID_INVALID", `Scenario ID '${scenarioId}' is not a valid stable scenario identifier.`));

  const verification = await verifyEnterpriseBaseline(baseline);
  if (!verification.ok) {
    diagnostics.push(diagnostic("error", "PROJECTION_BASELINE_INVALID", `Enterprise baseline failed semantic verification (${verification.diagnostics.length} diagnostic(s)).`));
  }

  const referencedAsSite = new Set(baseline.entities.flatMap((entity) => entity.siteRef ? [entity.siteRef] : []));
  const referencedAsZone = new Set(baseline.entities.flatMap((entity) => entity.zoneRef ? [entity.zoneRef] : []));
  const zoneEntityIds = new Set(baseline.entities.filter((entity) => referencedAsSite.has(entity.entityId) || referencedAsZone.has(entity.entityId) || isDeclaredZoneType(entity.entityType)).map((entity) => entity.entityId));
  const entitiesById = new Map(baseline.entities.map((entity) => [entity.entityId, entity] as const));

  const zones: Scenariosourcezone[] = [...zoneEntityIds].sort((a, b) => a.localeCompare(b, "en")).map((id) => {
    const entity = entitiesById.get(id)!;
    const facts = factsFor(baseline, id);
    const parentCandidate = entity.zoneRef && zoneEntityIds.has(entity.zoneRef) ? entity.zoneRef : entity.siteRef && zoneEntityIds.has(entity.siteRef) ? entity.siteRef : undefined;
    if (entity.zoneRef && entity.siteRef && entity.zoneRef !== entity.siteRef && zoneEntityIds.has(entity.zoneRef) && zoneEntityIds.has(entity.siteRef)) {
      diagnostics.push(diagnostic("warning", "PROJECTION_ZONE_PARENT_AMBIGUOUS", `Zone '${id}' declares both zoneRef and siteRef; zoneRef '${entity.zoneRef}' is used as the direct parent.`, id));
    }
    return { id, label: entity.label, kind: zoneKindFor(entity, facts, diagnostics), ...(parentCandidate && parentCandidate !== id ? { parent: parentCandidate } : {}) };
  });

  const resourceEntities = baseline.entities.filter((entity) => !zoneEntityIds.has(entity.entityId)).sort((a, b) => a.entityId.localeCompare(b.entityId, "en"));
  let projectedFacts = 0;
  const resources: Scenariosourceresource[] = resourceEntities.map((entity) => {
    const result = projectResource(baseline, entity, zoneEntityIds, diagnostics);
    projectedFacts += result.projectedFacts;
    return result.resource;
  });

  if (resources.length === 0) diagnostics.push(diagnostic("error", "PROJECTION_NO_RESOURCE_ENTITIES", "Enterprise baseline contains no resource entities that can be projected to a scenario topology."));

  const resourceIds = new Set(resources.map((resource) => resource.id));
  const interfacesByResource = new Map(resources.map((resource) => [resource.id, new Set((resource.interfaces ?? []).map((iface) => iface.id))] as const));
  const connections: Scenariosourceconnection[] = [];
  let skippedRelationships = 0;
  for (const rel of [...baseline.relationships].sort((a, b) => a.relationshipId.localeCompare(b.relationshipId, "en"))) {
    if (rel.state !== "KNOWN" && rel.state !== "INFERRED") {
      skippedRelationships += 1;
      diagnostics.push(diagnostic("warning", "PROJECTION_RELATIONSHIP_UNRESOLVED", `Relationship '${rel.relationshipId}' is ${rel.state} and was not made active in the scenario topology.`, rel.relationshipId));
      continue;
    }
    if (!resourceIds.has(rel.fromRef) || !resourceIds.has(rel.toRef)) {
      skippedRelationships += 1;
      diagnostics.push(diagnostic("info", "PROJECTION_RELATIONSHIP_CONTAINER_ENDPOINT", `Relationship '${rel.relationshipId}' involves a projected site/zone container and remains enterprise metadata rather than a scenario connection.`, rel.relationshipId));
      continue;
    }
    const kind = relationKind(rel.relationshipType);
    if (!kind) {
      skippedRelationships += 1;
      diagnostics.push(diagnostic("warning", "PROJECTION_RELATIONSHIP_UNSUPPORTED", `Relationship type '${rel.relationshipType}' has no supported current Engine connection projection and remains enterprise metadata.`, rel.relationshipId));
      continue;
    }
    const relFacts = factsFor(baseline, rel.relationshipId);
    const fromIfaceFact = resolvedFactByPath(relFacts, "/from/interface", diagnostics, rel.relationshipId) ?? resolvedFactByPath(relFacts, "/network/fromInterface", diagnostics, rel.relationshipId);
    const toIfaceFact = resolvedFactByPath(relFacts, "/to/interface", diagnostics, rel.relationshipId) ?? resolvedFactByPath(relFacts, "/network/toInterface", diagnostics, rel.relationshipId);
    const fromIface = fromIfaceFact && factValue(fromIfaceFact);
    const toIface = toIfaceFact && factValue(toIfaceFact);
    const fromPort = typeof fromIface === "string" && interfacesByResource.get(rel.fromRef)?.has(fromIface) ? fromIface : undefined;
    const toPort = typeof toIface === "string" && interfacesByResource.get(rel.toRef)?.has(toIface) ? toIface : undefined;
    if (typeof fromIface === "string" && !fromPort) diagnostics.push(diagnostic("warning", "PROJECTION_RELATIONSHIP_SOURCE_INTERFACE_UNKNOWN", `Relationship '${rel.relationshipId}' references source interface '${fromIface}' that is not projectable on '${rel.fromRef}'.`, rel.relationshipId));
    if (typeof toIface === "string" && !toPort) diagnostics.push(diagnostic("warning", "PROJECTION_RELATIONSHIP_TARGET_INTERFACE_UNKNOWN", `Relationship '${rel.relationshipId}' references target interface '${toIface}' that is not projectable on '${rel.toRef}'.`, rel.relationshipId));
    connections.push({
      id: rel.relationshipId,
      kind,
      from: { resource: rel.fromRef, ...(fromPort ? { port: fromPort } : {}) },
      to: { resource: rel.toRef, ...(toPort ? { port: toPort } : {}) },
      properties: {
        enterprise: {
          relationshipType: rel.relationshipType,
          state: rel.state,
          provenanceRefs: [...rel.provenanceRefs].sort((a, b) => a.localeCompare(b, "en")),
          provenance: relevantProvenance(baseline, rel.provenanceRefs),
          facts: relFacts.map(clone),
        },
      },
    });
  }

  const capabilities = new Set<string>();
  for (const resource of resources) {
    const capability = requiredCapabilityForType(resource.type);
    if (capability) capabilities.add(capability);
  }
  for (const connection of connections) {
    if (connection.kind === "network" || connection.kind === "management") capabilities.add("core.network");
    if (connection.kind === "trust" || connection.kind === "authentication") capabilities.add("core.identity");
  }

  const source: ScenarioSource | undefined = resources.length > 0 && !diagnostics.some((d) => d.severity === "error") ? {
    formatId: "infrastructure-cyber-lab.scenario-source",
    schemaVersion: "0.1.0",
    scenarioId,
    metadata: {
      title: options.title ?? `Enterprise baseline ${baseline.baselineId}`,
      description: "Deterministic topology projection from a normalized enterprise baseline.",
      language: options.language ?? "sv",
      tags: ["enterprise-import", "baseline-projection"],
      briefing: "Importerad enterprise-baseline. Granska topologin och lägg därefter till träningsmål, faults och diagnostik efter behov.",
    },
    enterpriseOrigin: {
      baselineId: baseline.baselineId,
      baselineIdentity: baseline.baselineIdentity,
      modelVersion: baseline.modelVersion,
      projectionVersion: ENTERPRISE_PROJECTION_VERSION,
      sources: [...baseline.sources].sort((a, b) => a.sourceId.localeCompare(b.sourceId, "en")).map((s) => ({ sourceId: s.sourceId, sha256: s.sha256, mediaType: s.mediaType })),
    },
    requires: {
      capabilities: [...capabilities].sort((a, b) => a.localeCompare(b, "en")).map((id) => ({ id, version: "^1.0.0" })),
      profiles: [],
    },
    zones,
    resources,
    connections,
    tests: [],
    findings: [],
    objectives: [{
      id: "baseline_ready",
      title: "Imported enterprise baseline is available",
      category: "enterprise-import",
      required: true,
      condition: { op: "equals", target: resources[0]!.id, path: "properties.enterprise.projectionReady", value: true },
    }],
    completion: { op: "equals", target: resources[0]!.id, path: "properties.enterprise.projectionReady", value: true },
    hints: [],
  } : undefined;

  const report: EnterpriseTopologyProjection = {
    formatId: "infrastructure-cyber-lab.enterprise-topology-projection",
    schemaVersion: ENTERPRISE_PROJECTION_VERSION,
    baselineId: baseline.baselineId,
    baselineIdentity: baseline.baselineIdentity,
    scenarioId,
    status: source ? "READY" : "BLOCKED",
    stats: {
      zones: zones.length,
      resources: resources.length,
      connections: connections.length,
      preservedFacts: baseline.facts.length,
      projectedFacts,
      skippedRelationships,
    },
    diagnostics,
  };
  return source ? { ok: true, source, report } : { ok: false, report };
}
