/**
 * ATLAS-001: deterministic, lossless page index and projection.
 *
 * This module is deliberately pure.  It accepts a structural view of the
 * existing canonical model and returns view-only page metadata.  It never
 * mutates resources/connections and it never creates a replacement network
 * model or a synthetic physical link.
 */

export type AtlasEndpoint = {
  readonly resource: string;
  readonly port?: string;
};

export type AtlasResource = {
  readonly id: string;
  readonly label?: string;
  readonly zone?: string;
  readonly zoneId?: string;
  readonly scope?: string;
  readonly [key: string]: unknown;
};

export type AtlasConnection = {
  readonly id: string;
  readonly from: AtlasEndpoint;
  readonly to: AtlasEndpoint;
  readonly [key: string]: unknown;
};

export type AtlasCanonicalNetwork = {
  readonly resources: readonly AtlasResource[];
  readonly connections: readonly AtlasConnection[];
  readonly sourceIdentity?: string;
  readonly sourceHash?: string;
  readonly zones?: readonly { readonly id: string; readonly label?: string }[];
};

export type AtlasRules = {
  readonly version?: string;
  readonly targetNodesPerPage?: number;
  readonly maxNodesPerPage?: number;
  readonly maxInternalLinksPerPage?: number;
  readonly pageAssignments?: Readonly<Record<string, string>>;
  readonly scopeAssignments?: Readonly<Record<string, string>>;
  readonly zoneAssignments?: Readonly<Record<string, string>>;
};

export type AtlasLinkClassification = "internal" | "boundary" | "external";

export type AtlasBoundaryReference = {
  readonly originalConnectionId: string;
  readonly localResourceId: string;
  readonly localPortId?: string;
  readonly remoteResourceId: string;
  readonly remotePortId?: string;
  readonly destinationPageId?: string;
  readonly classification: "boundary";
};

export type AtlasPage = {
  readonly id: string;
  readonly label: string;
  readonly basis: "explicit-scope" | "declared-zone" | "neutral-chunk";
  readonly resourceIds: readonly string[];
  readonly internalConnectionIds: readonly string[];
  readonly boundaryConnectionIds: readonly string[];
  readonly externalConnectionIds: readonly string[];
  readonly boundaryReferences: readonly AtlasBoundaryReference[];
  readonly renderMode: "topology" | "link-list";
  readonly blockedReason?: string;
};

export type AtlasIndex = {
  readonly version: string;
  readonly sourceIdentity: string;
  readonly pages: readonly AtlasPage[];
  readonly pageById: ReadonlyMap<string, AtlasPage>;
  readonly pageByResourceId: ReadonlyMap<string, string>;
  readonly connectionClassification: ReadonlyMap<string, ReadonlyMap<string, AtlasLinkClassification>>;
  readonly connectionById: ReadonlyMap<string, AtlasConnection>;
  readonly resourceById: ReadonlyMap<string, AtlasResource>;
  readonly diagnostics: readonly string[];
};

export type AtlasPageProjection = {
  readonly page: AtlasPage;
  readonly resources: readonly AtlasResource[];
  readonly connections: readonly AtlasConnection[];
  readonly internalConnections: readonly AtlasConnection[];
  readonly boundaryReferences: readonly AtlasBoundaryReference[];
  readonly sourceIdentity: string;
};

const DEFAULT_RULES: Required<Pick<AtlasRules, "version" | "targetNodesPerPage" | "maxNodesPerPage" | "maxInternalLinksPerPage">> = {
  version: "atlas-001-v1",
  targetNodesPerPage: 60,
  maxNodesPerPage: 100,
  maxInternalLinksPerPage: 250,
};

const compareIds = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });

function asId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`ATLAS_INVALID_${label}_ID`);
  return value;
}

function stablePageId(base: string, part: number, total: number): string {
  return total <= 1 ? base : `${base}:part-${part + 1}-of-${total}`;
}

function encodeKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

type Assignment = { readonly id: string; readonly basis: AtlasPage["basis"]; readonly label: string };

function resourceAssignment(resource: AtlasResource, rules: AtlasRules, zoneLabels: ReadonlyMap<string, string>): Assignment {
  const explicit = rules.pageAssignments?.[resource.id] ?? rules.scopeAssignments?.[resource.id];
  if (explicit) return { id: explicit, basis: "explicit-scope", label: explicit };
  const scope = resource.scope;
  if (typeof scope === "string" && scope.trim()) return { id: `scope:${encodeKey(scope)}`, basis: "explicit-scope", label: scope };
  const zone = rules.zoneAssignments?.[resource.id] ?? resource.zoneId ?? resource.zone;
  if (typeof zone === "string" && zone.trim()) {
    const label = zoneLabels.get(zone) ?? zone;
    return { id: `zone:${encodeKey(zone)}`, basis: "declared-zone", label };
  }
  return { id: "neutral", basis: "neutral-chunk", label: "Neutral documented resources" };
}

function splitResourceIds(resourceIds: readonly string[], connections: readonly AtlasConnection[], maxNodes: number, maxLinks: number): { ids: string[]; linkCount: number; linkList: boolean }[] {
  const sorted = [...resourceIds].sort(compareIds);
  if (!sorted.length) return [];
  const groups: string[][] = [];
  for (let offset = 0; offset < sorted.length; offset += Math.max(1, maxNodes)) groups.push(sorted.slice(offset, offset + Math.max(1, maxNodes)));
  const result: { ids: string[]; linkCount: number; linkList: boolean }[] = [];
  for (const group of groups) {
    const members = new Set(group);
    const linkCount = connections.filter((connection) => members.has(connection.from.resource) && members.has(connection.to.resource)).length;
    if (linkCount <= maxLinks || group.length <= 1) {
      result.push({ ids: group, linkCount, linkList: linkCount > maxLinks });
      continue;
    }
    const midpoint = Math.ceil(group.length / 2);
    const nested = splitResourceIds(group.slice(0, midpoint), connections, maxNodes, maxLinks)
      .concat(splitResourceIds(group.slice(midpoint), connections, maxNodes, maxLinks));
    result.push(...nested);
  }
  return result;
}

/** Build a deterministic page index without changing canonical data. */
export function buildAtlasIndex(network: AtlasCanonicalNetwork, inputRules: AtlasRules = {}): AtlasIndex {
  const rules = { ...DEFAULT_RULES, ...inputRules };
  const resources = [...(network?.resources ?? [])];
  const connections = [...(network?.connections ?? [])];
  const resourceById = new Map<string, AtlasResource>();
  for (const resource of resources) {
    const id = asId(resource?.id, "RESOURCE");
    if (resourceById.has(id)) throw new Error(`ATLAS_DUPLICATE_RESOURCE_ID:${id}`);
    resourceById.set(id, resource);
  }
  const connectionById = new Map<string, AtlasConnection>();
  for (const connection of connections) {
    const id = asId(connection?.id, "CONNECTION");
    if (connectionById.has(id)) throw new Error(`ATLAS_DUPLICATE_CONNECTION_ID:${id}`);
    const from = asId(connection?.from?.resource, "ENDPOINT_RESOURCE");
    const to = asId(connection?.to?.resource, "ENDPOINT_RESOURCE");
    if (!resourceById.has(from) || !resourceById.has(to)) throw new Error(`ATLAS_UNKNOWN_ENDPOINT_RESOURCE:${id}`);
    if (connection.from.port !== undefined && typeof connection.from.port !== "string") throw new Error(`ATLAS_INVALID_ENDPOINT_PORT:${id}`);
    if (connection.to.port !== undefined && typeof connection.to.port !== "string") throw new Error(`ATLAS_INVALID_ENDPOINT_PORT:${id}`);
    connectionById.set(id, connection);
  }
  const zoneLabels = new Map((network?.zones ?? []).map((zone) => [zone.id, zone.label ?? zone.id]));
  const assignmentByResource = new Map([...resourceById.values()].map((resource) => [resource.id, resourceAssignment(resource, rules, zoneLabels)]));
  const grouped = new Map<string, { assignment: Assignment; resourceIds: string[] }>();
  for (const resource of [...resourceById.values()].sort((a, b) => compareIds(a.id, b.id))) {
    const assignment = assignmentByResource.get(resource.id)!;
    const current = grouped.get(assignment.id) ?? { assignment, resourceIds: [] };
    current.resourceIds.push(resource.id);
    grouped.set(assignment.id, current);
  }
  const pages: AtlasPage[] = [];
  const pageByResourceId = new Map<string, string>();
  const rawPageGroups = [...grouped.values()].sort((a, b) => compareIds(a.assignment.id, b.assignment.id));
  for (const group of rawPageGroups) {
    const chunks = splitResourceIds(group.resourceIds, connections, Math.min(rules.targetNodesPerPage, rules.maxNodesPerPage), rules.maxInternalLinksPerPage);
    chunks.forEach((chunk, index) => {
      const pageId = stablePageId(group.assignment.id, index, chunks.length);
      for (const resourceId of chunk.ids) pageByResourceId.set(resourceId, pageId);
      const members = new Set(chunk.ids);
      const internalConnectionIds: string[] = [];
      const boundaryConnectionIds: string[] = [];
      const externalConnectionIds: string[] = [];
      for (const connection of connections.sort((a, b) => compareIds(a.id, b.id))) {
        const fromLocal = members.has(connection.from.resource);
        const toLocal = members.has(connection.to.resource);
        if (fromLocal && toLocal) internalConnectionIds.push(connection.id);
        else if (fromLocal || toLocal) boundaryConnectionIds.push(connection.id);
        else externalConnectionIds.push(connection.id);
      }
      pages.push({
        id: pageId,
        label: chunks.length > 1 ? `${group.assignment.label} · del ${index + 1}/${chunks.length}` : group.assignment.label,
        basis: group.assignment.basis,
        resourceIds: [...chunk.ids],
        internalConnectionIds,
        boundaryConnectionIds,
        externalConnectionIds,
        boundaryReferences: [],
        renderMode: chunk.linkList ? "link-list" : "topology",
        ...(chunk.linkList ? { blockedReason: `Internal link budget exceeded (${chunk.linkCount} > ${rules.maxInternalLinksPerPage}); no links were truncated.` } : {}),
      });
    });
  }
  // A source with no resources still has a deterministic empty page, so the
  // UI can state why there is no topology instead of inventing one.
  if (!pages.length) pages.push({ id: `${rules.version}:empty`, label: "Empty documented network", basis: "neutral-chunk", resourceIds: [], internalConnectionIds: [], boundaryConnectionIds: [], externalConnectionIds: connections.map((connection) => connection.id), boundaryReferences: [], renderMode: "link-list", blockedReason: "No documented resources." });
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const connectionClassification = new Map<string, Map<string, AtlasLinkClassification>>();
  const refsByPage = new Map<string, AtlasBoundaryReference[]>();
  for (const page of pages) refsByPage.set(page.id, []);
  for (const connection of connections) {
    const fromPage = pageByResourceId.get(connection.from.resource);
    const toPage = pageByResourceId.get(connection.to.resource);
    if (!fromPage || !toPage) throw new Error(`ATLAS_UNASSIGNED_ENDPOINT_RESOURCE:${connection.id}`);
    const perPage = new Map<string, AtlasLinkClassification>();
    if (fromPage === toPage) perPage.set(fromPage, "internal");
    else {
      perPage.set(fromPage, "boundary");
      perPage.set(toPage, "boundary");
      refsByPage.get(fromPage)!.push({ originalConnectionId: connection.id, localResourceId: connection.from.resource, ...(connection.from.port ? { localPortId: connection.from.port } : {}), remoteResourceId: connection.to.resource, ...(connection.to.port ? { remotePortId: connection.to.port } : {}), destinationPageId: toPage, classification: "boundary" });
      refsByPage.get(toPage)!.push({ originalConnectionId: connection.id, localResourceId: connection.to.resource, ...(connection.to.port ? { localPortId: connection.to.port } : {}), remoteResourceId: connection.from.resource, ...(connection.from.port ? { remotePortId: connection.from.port } : {}), destinationPageId: fromPage, classification: "boundary" });
    }
    // A page which contains neither endpoint keeps an explicit external
    // classification.  It is metadata, never a projected physical edge.
    for (const page of pages) if (!perPage.has(page.id)) perPage.set(page.id, "external");
    connectionClassification.set(connection.id, perPage);
  }
  const finalPages = pages.map((page) => ({ ...page, boundaryReferences: [...(refsByPage.get(page.id) ?? [])].sort((a, b) => compareIds(a.originalConnectionId, b.originalConnectionId) || compareIds(a.localResourceId, b.localResourceId)) }));
  return {
    version: rules.version,
    sourceIdentity: String(network?.sourceIdentity ?? network?.sourceHash ?? "unknown-source"),
    pages: finalPages,
    pageById: new Map(finalPages.map((page) => [page.id, page])),
    pageByResourceId,
    connectionClassification,
    connectionById,
    resourceById,
    diagnostics: [],
  };
}

/** Project only one page; canonical objects keep their original references. */
export function projectAtlasPage(network: AtlasCanonicalNetwork, index: AtlasIndex, pageId: string): AtlasPageProjection {
  const page = index.pageById.get(pageId);
  if (!page) throw new Error(`ATLAS_UNKNOWN_PAGE_ID:${pageId}`);
  const resources = page.resourceIds.map((id) => index.resourceById.get(id)).filter((resource): resource is AtlasResource => Boolean(resource));
  const connections = page.internalConnectionIds.map((id) => index.connectionById.get(id)).filter((connection): connection is AtlasConnection => Boolean(connection));
  const expected = new Set(page.internalConnectionIds);
  if (connections.some((connection) => !expected.has(connection.id))) throw new Error(`ATLAS_PROJECTION_ID_MISMATCH:${page.id}`);
  return {
    page,
    resources,
    connections: [...connections],
    internalConnections: [...connections],
    boundaryReferences: [...page.boundaryReferences],
    sourceIdentity: index.sourceIdentity,
  };
}

export function atlasPageForResource(index: AtlasIndex, resourceId: string): AtlasPage | undefined {
  const pageId = index.pageByResourceId.get(resourceId);
  return pageId ? index.pageById.get(pageId) : undefined;
}
