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
export const MAX_GROUPS = 64;

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
  type Bucket = { role: OverviewGroup["role"]; label: string; rank: number; members: string[]; documentedHierarchy: boolean };
  const buckets = new Map<string, Bucket>();
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
  // bounded overview. Keep the documented role buckets deterministic, retain
  // as many neutral type buckets as fit, then put every remainder in one
  // explicitly neutral summary bucket. The hard bound is intentional: this is
  // a visual overview, never a second copy of the canonical resource graph.
  if (buckets.size > MAX_GROUPS) {
    const entries = [...buckets.entries()];
    const roleBuckets = entries
      .filter(([, bucket]) => bucket.documentedHierarchy)
      .sort(([, a], [, b]) => a.rank - b.rank || a.label.localeCompare(b.label, "en"));
    const neutralBuckets = entries
      .filter(([, bucket]) => !bucket.documentedHierarchy)
      .sort(([, a], [, b]) => b.members.length - a.members.length || a.label.localeCompare(b.label, "en"));
    // There are only four known documented roles, but keeping this defensive
    // makes the invariant hold even if roleForType grows in the future.
    const roleKeep = roleBuckets.slice(0, Math.max(0, MAX_GROUPS - 1));
    const remainder = [...roleBuckets.slice(roleKeep.length), ...neutralBuckets];
    const neutralKeepCount = Math.max(0, MAX_GROUPS - roleKeep.length - 1);
    const neutralKeep = neutralBuckets.slice(0, neutralKeepCount);
    const compact = new Map<string, Bucket>([...roleKeep, ...neutralKeep]);
    const keptKeys = new Set([...roleKeep, ...neutralKeep].map(([key]) => key));
    const mergedEntries = remainder.filter(([key]) => !keptKeys.has(key));
    if (mergedEntries.length) {
      const mergedMembers = mergedEntries.flatMap(([, bucket]) => bucket.members).sort(sortIds);
      compact.set("documented:other", {
        role: "documented-type",
        label: `OTHER DOCUMENTED TYPES · ${mergedEntries.length} types · ${mergedMembers.length} devices`,
        rank: 50,
        members: mergedMembers,
        documentedHierarchy: false,
      });
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
  for (const group of groups) {
    for (const resourceId of group.members) byResource.set(resourceId, group.id);
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
    declaredLinks: [...linkCounts.entries()].filter(([pair]) => {
      const [from, to] = pair.split("|");
      return from === group.id || to === group.id;
    }).reduce((sum, [, count]) => sum + count, 0) + (internalCounts.get(group.id) ?? 0),
    internalLinks: internalCounts.get(group.id) ?? 0,
  }));
  // Every band is laid out independently. Role bands are 0–3 and neutral
  // types always occupy band 4, so mixed-role workbooks cannot collide a
  // neutral card with a role card even when a band contains many groups.
  const bandFor = (group: OverviewGroup): number => {
    if (!explicitRoles) return 0;
    if (group.role === "core") return 0;
    if (group.role === "distribution") return 1;
    if (group.role === "access") return 2;
    if (group.role === "client") return 3;
    return 4;
  };
  const groupsByBand = new Map<number, OverviewGroup[]>();
  for (const group of groups) {
    const band = bandFor(group);
    const bandGroups = groupsByBand.get(band) ?? [];
    bandGroups.push(group);
    groupsByBand.set(band, bandGroups);
  }
  const positions = new Map<string, { x: number; y: number }>();
  let bandY = 56;
  for (const band of [...groupsByBand.keys()].sort((a, b) => a - b)) {
    const bandGroups = groupsByBand.get(band)!;
    const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(bandGroups.length))));
    const rows = Math.ceil(bandGroups.length / cols);
    bandGroups.forEach((group, index) => {
      positions.set(group.id, {
        x: 64 + (index % cols) * (WIDTH + GAP_X),
        y: bandY + Math.floor(index / cols) * (HEIGHT + GAP_Y),
      });
    });
    bandY += rows * HEIGHT + Math.max(0, rows - 1) * GAP_Y + GAP_Y;
  }
  const nodes: CanvasNode[] = groups.map((group, index) => {
    const position = positions.get(group.id) ?? { x: 64, y: 56 + index * (HEIGHT + GAP_Y) };
    const roleLine = group.documentedHierarchy ? `DOCUMENTED ROLE · ${group.role.toUpperCase()}` : "DOCUMENTED TYPE · NEUTRAL VIEW";
    return {
      id: group.id,
      type: "resource",
      position,
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
        summaryOnly: true,
        declaredLinkCount: count,
        overviewSourceHash: args.sourceHash ?? "",
        properties: { summaryOnly: true, declaredLinkCount: count },
        visual: { ...describeSemanticLink("network", {}), accessibleLabel: `VISUAL SUMMARY · ${count} declared links · not a physical link` },
      },
      sourceHandle: "overview-out",
      targetHandle: "overview-in",
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
