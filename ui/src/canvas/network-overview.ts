import type { CanvasEdge, CanvasNode, CanvasProjection } from "./types.js";
import { describeSemanticLink } from "./device-visuals.js";

export interface OverviewResource {
  readonly id: string;
  readonly label?: string;
  readonly type?: string;
}

export interface OverviewConnection {
  readonly id: string;
  readonly from: { readonly resource: string };
  readonly to: { readonly resource: string };
}

export interface OverviewGroup {
  readonly id: string;
  readonly label: string;
  readonly role: "core" | "distribution" | "access" | "client" | "documented-type";
  readonly documentedHierarchy: boolean;
  readonly members: readonly string[];
  readonly declaredLinks: number;
  readonly internalLinks: number;
}

export interface NetworkOverviewProjection extends CanvasProjection {
  readonly overview: true;
  readonly strategy: "documented-role-bands" | "neutral-type-bands";
  readonly canonicalNodes: number;
  readonly canonicalLinks: number;
  readonly groups: readonly OverviewGroup[];
}

const WIDTH = 300;
const HEIGHT = 132;
const GAP_X = 44;
const GAP_Y = 68;
const MAX_GROUPS = 64;

const roleForType = (type: string): { role: OverviewGroup["role"]; label: string; rank: number } | undefined => {
  switch (type.trim().toLowerCase()) {
    case "network.core": return { role: "core", label: "CORE", rank: 0 };
    case "network.distribution": return { role: "distribution", label: "DISTRIBUTION", rank: 1 };
    case "network.access": return { role: "access", label: "ACCESS", rank: 2 };
    case "endpoint.windows": return { role: "client", label: "CLIENTS", rank: 3 };
    default: return undefined;
  }
};

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group";
const sortIds = (a: string, b: string): number => a.localeCompare(b, "en");

function groupResources(resources: readonly OverviewResource[]): { groups: OverviewGroup[]; explicitRoles: boolean; byResource: Map<string, string> } {
  const explicitRoles = resources.some((resource) => roleForType(String(resource.type ?? "")) !== undefined);
  const buckets = new Map<string, { role: OverviewGroup["role"]; label: string; rank: number; members: string[]; documentedHierarchy: boolean }>();
  for (const resource of [...resources].sort((a, b) => sortIds(a.id, b.id))) {
    const type = String(resource.type ?? "resource.generic");
    const role = explicitRoles ? roleForType(type) : undefined;
    const key = role ? role.label : type.trim().toLowerCase();
    const bucket = buckets.get(key) ?? {
      role: role?.role ?? "documented-type",
      label: role?.label ?? type,
      rank: role?.rank ?? 50,
      members: [],
      documentedHierarchy: Boolean(role),
    };
    bucket.members.push(resource.id);
    buckets.set(key, bucket);
  }
  // A hostile workbook with one unique type per resource must still receive a
  // bounded overview. Merge only into neutral, explicitly-labelled type
  // buckets; this never claims a physical role or creates a physical node.
  if (buckets.size > MAX_GROUPS) {
    const compact = new Map<string, { role: OverviewGroup["role"]; label: string; rank: number; members: string[]; documentedHierarchy: boolean }>();
    for (const [key, bucket] of buckets) {
      const prefix = bucket.role === "documented-type" ? key.split(/[._-]/, 1)[0] || "documented" : key;
      const compactKey = bucket.role === "documented-type" ? `documented:${prefix}` : key;
      const prior = compact.get(compactKey);
      if (prior) prior.members.push(...bucket.members);
      else compact.set(compactKey, { ...bucket, label: bucket.role === "documented-type" ? `DOCUMENTED TYPES · ${prefix}` : bucket.label, members: [...bucket.members] });
    }
    buckets.clear();
    for (const [key, bucket] of compact) buckets.set(key, bucket);
  }
  const groups: OverviewGroup[] = [...buckets.entries()]
    .sort(([, a], [, b]) => a.rank - b.rank || a.label.localeCompare(b.label, "en"))
    .map(([key, bucket], index) => ({
      id: `overview-group-${String(index + 1).padStart(2, "0")}-${slug(key)}`,
      label: bucket.label,
      role: bucket.role,
      documentedHierarchy: bucket.documentedHierarchy,
      members: Object.freeze(bucket.members.slice().sort(sortIds)),
      declaredLinks: 0,
      internalLinks: 0,
    }));
  const byResource = new Map<string, string>();
  for (const resource of resources) {
    byResource.set(resource.id, groups.find((group) => group.members.includes(resource.id))?.id ?? groups[0]?.id ?? "");
  }
  return { groups, explicitRoles, byResource };
}

export function buildNetworkOverviewProjection(args: {
  readonly scenarioId: string;
  readonly sourceHash?: string;
  readonly resources: readonly OverviewResource[];
  readonly connections: readonly OverviewConnection[];
}): NetworkOverviewProjection {
  const { groups: initialGroups, explicitRoles, byResource } = groupResources(args.resources);
  const linkCounts = new Map<string, number>();
  const internalCounts = new Map<string, number>();
  for (const connection of args.connections) {
    const from = byResource.get(connection.from.resource);
    const to = byResource.get(connection.to.resource);
    if (!from || !to) continue;
    if (from === to) {
      internalCounts.set(from, (internalCounts.get(from) ?? 0) + 1);
      continue;
    }
    const pair = [from, to].sort(sortIds).join("|");
    linkCounts.set(pair, (linkCounts.get(pair) ?? 0) + 1);
  }
  const groups = initialGroups.map((group) => Object.freeze({
    ...group,
    declaredLinks: [...linkCounts.entries()].filter(([pair]) => pair.split("|").includes(group.id)).reduce((sum, [, count]) => sum + count, 0) + (internalCounts.get(group.id) ?? 0),
    internalLinks: internalCounts.get(group.id) ?? 0,
  }));
  const cols = explicitRoles ? Math.max(1, Math.min(4, Math.max(...groups.map((group) => groups.filter((candidate) => candidate.role === group.role).length), 1))) : Math.max(1, Math.min(4, Math.ceil(Math.sqrt(groups.length))));
  const nodes: CanvasNode[] = groups.map((group, index) => {
    const row = explicitRoles ? groups.slice(0, index).filter((candidate) => candidate.role === group.role).length : Math.floor(index / cols);
    const column = explicitRoles ? groups.filter((candidate) => candidate.role === group.role).findIndex((candidate) => candidate.id === group.id) : index % cols;
    const roleLine = group.documentedHierarchy ? `DOCUMENTED ROLE · ${group.role.toUpperCase()}` : "DOCUMENTED TYPE · NEUTRAL VIEW";
    return {
      id: group.id,
      type: "resource",
      position: { x: 64 + column * (WIDTH + GAP_X), y: 56 + (explicitRoles ? group.role === "core" ? 0 : group.role === "distribution" ? 1 : group.role === "access" ? 2 : group.role === "client" ? 3 : row : row) * (HEIGHT + GAP_Y) },
      width: WIDTH,
      height: HEIGHT,
      data: {
        semanticId: group.id,
        semanticKind: "resource",
        label: `${group.label} · ${group.members.length} devices`,
        resourceType: "overview.group",
        deviceFamily: "generic",
        deviceRoleLabel: roleLine,
        interfaces: [],
        overviewGroup: true,
        overviewGroupId: group.id,
        overviewMembers: group.members,
        overviewRole: group.role,
        overviewDeclaredLinks: group.declaredLinks,
        overviewInternalLinks: group.internalLinks,
        overviewSummary: `${group.members.length} documented devices · ${group.declaredLinks} declared links · click to open a real source device`,
      },
      layoutStatus: "resolved",
    } as CanvasNode;
  });
  const edges: CanvasEdge[] = [...linkCounts.entries()].sort(([a], [b]) => a.localeCompare(b, "en")).map(([pair, count]) => {
    const [source, target] = pair.split("|");
    return {
      id: `overview-summary-${slug(source!)}-${slug(target!)}`,
      type: "semantic",
      source: source!,
      target: target!,
      data: {
        semanticId: `overview-summary-${pair}`,
        connectionKind: "network",
        properties: { summaryOnly: true, declaredLinkCount: count },
        visual: { ...describeSemanticLink("network", {}), accessibleLabel: `VISUAL SUMMARY · ${count} declared links · not a physical link` },
      },
    } as CanvasEdge;
  });
  return {
    overview: true,
    strategy: explicitRoles ? "documented-role-bands" : "neutral-type-bands",
    canonicalNodes: args.resources.length,
    canonicalLinks: args.connections.length,
    groups: Object.freeze(groups),
    scenarioId: args.scenarioId,
    sourceHash: args.sourceHash ?? "",
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    diagnostics: [],
  };
}

