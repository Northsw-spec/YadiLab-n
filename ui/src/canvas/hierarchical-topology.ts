import type { LayoutDocument, NormalizedScenario } from "../../../core-model/src/generated/contracts.js";
import { projectScenarioToCanvas } from "./projection.js";
import { computeOrthogonalRoutes } from "./topology-edge-routing.js";
import type { CanvasProjection, CanvasProjectionDiagnostic } from "./types.js";

export type HierarchyRole = "core" | "distribution" | "access" | "endpoint" | "device";
export type HierarchyScopeKind = "overview" | "branch";

export interface NavigationGroup {
  readonly id: string;
  readonly label: string;
  readonly memberIds: readonly string[];
  readonly kind: "declared-zone" | "derived-navigation";
  readonly presentationOnly: true;
  readonly level: number;
}

export interface LinkPartition {
  readonly internal: readonly NormalizedScenario["connections"][number][];
  readonly boundary: readonly NormalizedScenario["connections"][number][];
  readonly external: readonly NormalizedScenario["connections"][number][];
}

export interface HierarchyNeighbor {
  readonly neighborId: string;
  readonly connectionId: string;
}

export interface HierarchicalTopologyIndex {
  readonly scenarioId: string;
  readonly sourceHash: string;
  readonly assetLocks: readonly NormalizedScenario["assetLocks"][number][];
  readonly resources: readonly NormalizedScenario["resources"][number][];
  readonly resourcesById: ReadonlyMap<string, NormalizedScenario["resources"][number]>;
  readonly connections: readonly NormalizedScenario["connections"][number][];
  readonly connectionsById: ReadonlyMap<string, NormalizedScenario["connections"][number]>;
  readonly adjacency: ReadonlyMap<string, readonly HierarchyNeighbor[]>;
  readonly roleById: ReadonlyMap<string, HierarchyRole>;
  readonly overviewNodeIds: readonly string[];
  readonly overviewEdgeIds: readonly string[];
  readonly roleCounts: Readonly<Record<HierarchyRole, number>>;
}

export interface HierarchicalTopologyView {
  readonly kind: HierarchyScopeKind;
  readonly rootId?: string;
  readonly page: number;
  readonly pageCount: number;
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly hiddenNodeCount: number;
  readonly hiddenConnectionCount: number;
  readonly hiddenNeighborCount: number;
  readonly hiddenBoundaryConnectionCount: number;
  readonly visibleConnectionCount: number;
  readonly projection: CanvasProjection;
  readonly navigationGroups: readonly NavigationGroup[];
  readonly partition: LinkPartition;
  readonly incompleteView: boolean;
  readonly layoutStrategy: "arvidsjaur-grouped-orthogonal";
  readonly roleLabel: string;
}

const MAX_NODES = 100;
const MAX_EDGES = 250;
const NODE_WIDTH = 168;
const NODE_HEIGHT = 88;
const GAP_X = 36;
const GAP_Y = 48;
const PADDING_X = 56;
const PADDING_Y = 36;
const GROUP_GAP_X = 44;
const GROUP_GAP_Y = 48;
const GROUP_PADDING_X = 20;
const GROUP_PADDING_Y = 18;
const GROUP_HEADER = 42;
const GROUP_RESOURCE_GAP = 16;
const GROUP_CHILD_COLUMNS = 4;
const MAX_GROUP_COLUMNS = 3;

function normalized(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function resourceRole(resource: NormalizedScenario["resources"][number]): HierarchyRole {
  const properties = (resource.properties ?? {}) as Readonly<Record<string, unknown>>;
  const explicit = [properties.role, properties.networkRole, properties.deviceRole, properties.layer]
    .map(normalized).filter(Boolean).join(" ");
  const type = normalized(resource.type);
  const label = normalized(resource.label);
  const value = `${explicit} ${type} ${label}`;
  if (/\bcore\b/.test(value)) return "core";
  if (/\bdistribution\b|\bdist(?:ribution)?[-_ ]?(?:switch|sw)?\b/.test(value)) return "distribution";
  if (/\baccess\b/.test(value)) return "access";
  if (/\bclient\b|\bendpoint\b|\bworkstation\b|\bdesktop\b|\blaptop\b|\bhost\b/.test(value)) return "endpoint";
  return "device";
}

function compareId(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function addNeighbor(adjacency: Map<string, HierarchyNeighbor[]>, id: string, neighborId: string, connectionId: string): void {
  const list = adjacency.get(id) ?? [];
  list.push({ neighborId, connectionId });
  adjacency.set(id, list);
}

/**
 * Build an indexed, source-derived navigation model once per compiled source.
 * This index is presentation state only: it never adds, removes or rewrites a
 * canonical resource or connection.
 */
export function buildHierarchicalTopologyIndex(network: Pick<NormalizedScenario, "scenarioId" | "sourceHash" | "resources" | "connections" | "assetLocks">): HierarchicalTopologyIndex {
  const resources = [...network.resources].sort((left, right) => compareId(left.id, right.id));
  const connections = [...network.connections].sort((left, right) => compareId(left.id, right.id));
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource] as const));
  const connectionsById = new Map(connections.map((connection) => [connection.id, connection] as const));
  const roleById = new Map(resources.map((resource) => [resource.id, resourceRole(resource)] as const));
  const adjacency = new Map<string, HierarchyNeighbor[]>(resources.map((resource) => [resource.id, []]));
  for (const connection of connections) {
    if (!resourcesById.has(connection.from.resource) || !resourcesById.has(connection.to.resource) || connection.from.resource === connection.to.resource) continue;
    addNeighbor(adjacency, connection.from.resource, connection.to.resource, connection.id);
    addNeighbor(adjacency, connection.to.resource, connection.from.resource, connection.id);
  }
  for (const [id, list] of adjacency) {
    list.sort((left, right) => compareId(left.neighborId, right.neighborId) || compareId(left.connectionId, right.connectionId));
    adjacency.set(id, list);
  }
  const roleIds = (role: HierarchyRole) => resources.filter((resource) => roleById.get(resource.id) === role).map((resource) => resource.id);
  const coreIds = roleIds("core");
  const distributionIds = roleIds("distribution");
  let overviewNodeIds: string[];
  if (coreIds.length || distributionIds.length) {
    overviewNodeIds = [...new Set([...coreIds, ...distributionIds])].sort(compareId).slice(0, MAX_NODES);
  } else {
    // A workbook without explicit role metadata still gets a bounded neutral
    // overview. Degree is a navigation aid, never a claim about physical role.
    const candidates = resources
      .filter((resource) => (adjacency.get(resource.id)?.length ?? 0) > 0 && roleById.get(resource.id) !== "endpoint")
      .sort((left, right) => (adjacency.get(right.id)?.length ?? 0) - (adjacency.get(left.id)?.length ?? 0) || compareId(left.id, right.id));
    overviewNodeIds = candidates.slice(0, MAX_NODES).map((resource) => resource.id);
    if (!overviewNodeIds.length) overviewNodeIds = resources.slice(0, MAX_NODES).map((resource) => resource.id);
  }
  const overviewSet = new Set(overviewNodeIds);
  const overviewEdgeIds = connections.filter((connection) => overviewSet.has(connection.from.resource) && overviewSet.has(connection.to.resource)).map((connection) => connection.id);
  const roleCounts = {
    core: roleIds("core").length,
    distribution: roleIds("distribution").length,
    access: roleIds("access").length,
    endpoint: roleIds("endpoint").length,
    device: roleIds("device").length,
  } as const;
  return {
    scenarioId: network.scenarioId,
    sourceHash: network.sourceHash,
    assetLocks: [...network.assetLocks],
    resources,
    resourcesById,
    connections,
    connectionsById,
    adjacency,
    roleById,
    overviewNodeIds,
    overviewEdgeIds,
    roleCounts,
  };
}

function pageRootLinks(index: HierarchicalTopologyIndex, rootId: string): readonly HierarchyNeighbor[] {
  return index.adjacency.get(rootId) ?? [];
}

/** Partition the canonical connection collection without rewriting or truncating IDs. */
export function partitionConnections(
  connections: readonly NormalizedScenario["connections"][number][],
  visibleNodeIds: ReadonlySet<string>,
): LinkPartition {
  const internal: NormalizedScenario["connections"][number][] = [];
  const boundary: NormalizedScenario["connections"][number][] = [];
  const external: NormalizedScenario["connections"][number][] = [];
  for (const link of connections) {
    const fromVisible = visibleNodeIds.has(link.from.resource);
    const toVisible = visibleNodeIds.has(link.to.resource);
    if (fromVisible && toVisible) internal.push(link);
    else if (fromVisible !== toVisible) boundary.push(link);
    else external.push(link);
  }
  return { internal, boundary, external };
}

interface BranchSelection {
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly page: number;
  readonly pageCount: number;
  readonly totalNeighbors: number;
  readonly visibleNeighbors: number;
  readonly totalRootLinks: number;
  readonly visibleRootLinks: number;
  readonly partition: LinkPartition;
}

function branchNeighborPages(index: HierarchicalTopologyIndex, rootId: string): readonly string[][] {
  const neighbors = [...new Set(pageRootLinks(index, rootId).map((item) => item.neighborId))].sort(compareId);
  const pages: string[][] = [];
  let current: string[] = [];
  for (const neighborId of neighbors) {
    const candidate = new Set([rootId, ...current, neighborId]);
    const internalCount = partitionConnections(index.connections, candidate).internal.length;
    if (current.length && (current.length >= MAX_NODES - 1 || internalCount > MAX_EDGES)) {
      pages.push(current);
      current = [];
    }
    current.push(neighborId);
  }
  if (current.length || !pages.length) pages.push(current);
  return pages;
}

function selectBranch(index: HierarchicalTopologyIndex, rootId: string, page: number): BranchSelection {
  if (!index.resourcesById.has(rootId)) throw new Error("HIERARCHY_UNKNOWN_ROOT");
  const rootLinks = [...pageRootLinks(index, rootId)];
  const neighbors = [...new Set(rootLinks.map((item) => item.neighborId))].sort(compareId);
  const pages = branchNeighborPages(index, rootId);
  const pageCount = pages.length;
  const safePage = Math.min(pageCount, Math.max(1, Math.floor(page)));
  const visibleNeighborIds = pages[safePage - 1] ?? [];
  const nodeIds = [rootId, ...visibleNeighborIds];
  const partition = partitionConnections(index.connections, new Set(nodeIds));
  const edgeIds = partition.internal.map((connection) => connection.id);
  const visibleRootLinks = partition.internal.filter((connection) => connection.from.resource === rootId || connection.to.resource === rootId).length;
  return {
    nodeIds,
    edgeIds,
    page: safePage,
    pageCount,
    totalNeighbors: neighbors.length,
    visibleNeighbors: visibleNeighborIds.length,
    totalRootLinks: rootLinks.length,
    visibleRootLinks,
    partition,
  };
}

function hierarchyLevel(index: HierarchicalTopologyIndex, nodeIds: readonly string[], edgeIds: readonly string[], kind: HierarchyScopeKind, rootId?: string): Map<string, number> {
  const levels = new Map<string, number>();
  const selected = new Set(nodeIds);
  if (kind === "overview") {
    for (const id of nodeIds) {
      const role = index.roleById.get(id);
      levels.set(id, role === "core" ? 0 : role === "distribution" ? 1 : 2);
    }
    return levels;
  }
  if (!rootId) return levels;
  levels.set(rootId, 0);
  const edges = edgeIds.map((id) => index.connectionsById.get(id)).filter(Boolean);
  const queue = [rootId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (!current) continue;
    for (const connection of edges) {
      const neighbor = connection!.from.resource === current ? connection!.to.resource : connection!.to.resource === current ? connection!.from.resource : undefined;
      if (!neighbor || !selected.has(neighbor) || levels.has(neighbor)) continue;
      levels.set(neighbor, (levels.get(current) ?? 0) + 1);
      queue.push(neighbor);
    }
  }
  for (const id of nodeIds) if (!levels.has(id)) levels.set(id, 1);
  return levels;
}

function groupLabel(index: HierarchicalTopologyIndex, memberIds: readonly string[], role: HierarchyRole, kind: HierarchyScopeKind, rootId?: string): string {
  const labels = memberIds.map((id) => index.resourcesById.get(id)?.label ?? id).sort(compareId);
  if (kind === "overview" && role === "core") return "Core network";
  if (kind === "overview" && role === "distribution") return `Distribution ${labels[0] ?? "branch"}${labels.length > 1 ? `–${labels.at(-1)}` : ""}`;
  if (rootId && memberIds.includes(rootId)) return index.resourcesById.get(rootId)?.label ?? rootId;
  if (role === "endpoint") return `Connected endpoints · ${labels[0] ?? "devices"}${labels.length > 1 ? `–${labels.at(-1)}` : ""}`;
  return `${role[0]?.toUpperCase() ?? "C"}${role.slice(1)} devices · ${labels.length}`;
}

function buildNavigationGroups(index: HierarchicalTopologyIndex, nodeIds: readonly string[], kind: HierarchyScopeKind, rootId: string | undefined, levels: ReadonlyMap<string, number>): readonly NavigationGroup[] {
  const selected = new Set(nodeIds);
  const groups: NavigationGroup[] = [];
  const assigned = new Set<string>();
  const declared = new Map<string, string[]>();
  for (const id of nodeIds) {
    const resource = index.resourcesById.get(id);
    if (!resource?.zone) continue;
    const list = declared.get(resource.zone) ?? [];
    list.push(id);
    declared.set(resource.zone, list);
  }
  for (const [zoneId, members] of [...declared.entries()].sort(([a], [b]) => compareId(a, b))) {
    const sortedMembers = members.slice().sort(compareId);
    groups.push({
      id: `navigation-group-declared-${zoneId}`,
      label: index.resourcesById.get(sortedMembers[0]!)?.label ? `Documented zone · ${zoneId}` : zoneId,
      memberIds: sortedMembers,
      kind: "declared-zone",
      presentationOnly: true,
      level: Math.min(...sortedMembers.map((id) => levels.get(id) ?? 0)),
    });
    sortedMembers.forEach((id) => assigned.add(id));
  }
  const buckets = new Map<string, string[]>();
  for (const id of nodeIds) {
    if (assigned.has(id)) continue;
    const role = index.roleById.get(id) ?? "device";
    const level = levels.get(id) ?? 0;
    const key = `${level}:${role}`;
    const list = buckets.get(key) ?? [];
    list.push(id);
    buckets.set(key, list);
  }
  for (const [key, memberIds] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    const [levelText, roleText] = key.split(":");
    const role = (roleText as HierarchyRole) || "device";
    const level = Number(levelText);
    const sorted = memberIds.sort(compareId);
    for (let offset = 0; offset < sorted.length; offset += 8) {
      const members = sorted.slice(offset, offset + 8);
      groups.push({
        id: `navigation-group-${kind}-${level}-${role}-${String(groups.length + 1).padStart(2, "0")}`,
        label: groupLabel(index, members, role, kind, rootId),
        memberIds: members,
        kind: "derived-navigation",
        presentationOnly: true,
        level,
      });
    }
  }
  return groups.sort((left, right) => left.level - right.level || compareId(left.id, right.id));
}

function groupMetrics(memberCount: number): { width: number; height: number; columns: number } {
  const columns = Math.min(GROUP_CHILD_COLUMNS, Math.max(1, Math.ceil(Math.sqrt(memberCount))));
  const rows = Math.max(1, Math.ceil(memberCount / columns));
  return {
    columns,
    width: GROUP_PADDING_X * 2 + columns * NODE_WIDTH + Math.max(0, columns - 1) * GROUP_RESOURCE_GAP,
    height: GROUP_HEADER + GROUP_PADDING_Y * 2 + rows * NODE_HEIGHT + Math.max(0, rows - 1) * GROUP_RESOURCE_GAP,
  };
}

function layoutDocument(index: HierarchicalTopologyIndex, nodeIds: readonly string[], edgeIds: readonly string[], kind: HierarchyScopeKind, rootId: string | undefined, scenarioId: string, groups: readonly NavigationGroup[]): LayoutDocument {
  const levels = hierarchyLevel(index, nodeIds, edgeIds, kind, rootId);
  const metrics = new Map(groups.map((group) => [group.id, groupMetrics(group.memberIds.length)] as const));
  const byLevel = new Map<number, NavigationGroup[]>();
  for (const group of groups) {
    const list = byLevel.get(group.level) ?? [];
    list.push(group);
    byLevel.set(group.level, list);
  }
  const nodes: { id: string; x: number; y: number; width: number; height: number }[] = [];
  const groupPositions = new Map<string, { x: number; y: number }>();
  let nextY = PADDING_Y;
  for (const [, levelGroups] of [...byLevel.entries()].sort(([a], [b]) => a - b)) {
    const ordered = levelGroups.slice().sort((left, right) => compareId(left.id, right.id));
    const columns = Math.min(MAX_GROUP_COLUMNS, Math.max(1, ordered.length));
    const maxWidth = Math.max(...ordered.map((group) => metrics.get(group.id)?.width ?? NODE_WIDTH));
    const maxHeight = Math.max(...ordered.map((group) => metrics.get(group.id)?.height ?? NODE_HEIGHT));
    const rows = Math.max(1, Math.ceil(ordered.length / columns));
    ordered.forEach((group, position) => {
      const column = position % columns;
      const row = Math.floor(position / columns);
      const x = PADDING_X + column * (maxWidth + GROUP_GAP_X);
      const y = nextY + row * (maxHeight + GROUP_GAP_Y);
      const size = metrics.get(group.id) ?? { width: NODE_WIDTH, height: NODE_HEIGHT };
      groupPositions.set(group.id, { x, y });
      nodes.push({ id: group.id, x, y, width: size.width, height: size.height });
    });
    nextY += rows * maxHeight + Math.max(0, rows - 1) * GROUP_GAP_Y + GROUP_GAP_Y;
  }
  for (const group of groups) {
    const position = groupPositions.get(group.id) ?? { x: PADDING_X, y: nextY };
    const size = metrics.get(group.id) ?? { width: NODE_WIDTH, height: NODE_HEIGHT, columns: 1 };
    group.memberIds.slice().sort(compareId).forEach((id, positionIndex) => {
      const row = Math.floor(positionIndex / size.columns);
      const column = positionIndex % size.columns;
      nodes.push({
        id,
        x: GROUP_PADDING_X + column * (NODE_WIDTH + GROUP_RESOURCE_GAP),
        y: GROUP_HEADER + GROUP_PADDING_Y + row * (NODE_HEIGHT + GROUP_RESOURCE_GAP),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    });
  }
  return { formatId: "infrastructure-cyber-lab.layout", schemaVersion: "0.1.0", scenarioId, engine: "elk.layered", nodes };
}

function roleLabel(index: HierarchicalTopologyIndex, rootId: string | undefined, kind: HierarchyScopeKind): string {
  if (kind === "overview") return "Network overview";
  const role = rootId ? index.roleById.get(rootId) : undefined;
  return role === "distribution" ? "Distribution branch" : role === "access" ? "Access network" : "Connected branch";
}

/** Build a bounded view that renders only actual source nodes and links. */
export function buildHierarchicalTopologyView(index: HierarchicalTopologyIndex, kind: HierarchyScopeKind = "overview", rootId?: string, page = 1): HierarchicalTopologyView {
  const overviewPartition = partitionConnections(index.connections, new Set(index.overviewNodeIds));
  const selected = kind === "overview"
    ? {
      nodeIds: index.overviewNodeIds,
      edgeIds: overviewPartition.internal.map((connection) => connection.id),
      page: 1,
      pageCount: 1,
      totalNeighbors: 0,
      visibleNeighbors: 0,
      totalRootLinks: overviewPartition.internal.length,
      visibleRootLinks: overviewPartition.internal.length,
      partition: overviewPartition,
    }
    : selectBranch(index, rootId ?? "", page);
  const nodeSet = new Set(selected.nodeIds);
  const levels = hierarchyLevel(index, selected.nodeIds, selected.edgeIds, kind, rootId);
  const navigationGroups = buildNavigationGroups(index, selected.nodeIds, kind, rootId, levels);
  const groupByResource = new Map(navigationGroups.flatMap((group) => group.memberIds.map((id) => [id, group.id] as const)));
  const zones = navigationGroups.map((group) => ({
    id: group.id,
    label: group.label,
    kind: "custom" as const,
  }));
  const resources = selected.nodeIds.map((id) => index.resourcesById.get(id)).filter(Boolean).map((resource) => {
    const { zone: _sourceZone, ...withoutZone } = resource!;
    return { ...withoutZone, zone: groupByResource.get(resource!.id) };
  });
  const connections = selected.partition.internal;
  const bounded = {
    formatId: "infrastructure-cyber-lab.scenario",
    schemaVersion: "0.1.0",
    scenarioId: index.scenarioId,
    sourceHash: index.sourceHash,
    metadata: { title: roleLabel(index, rootId, kind) },
    assetLocks: index.assetLocks,
    zones,
    resources,
    connections,
  } as unknown as NormalizedScenario;
  const layout = layoutDocument(index, selected.nodeIds, selected.edgeIds, kind, rootId, index.scenarioId, navigationGroups);
  const base = projectScenarioToCanvas(bounded, layout);
  const routes = computeOrthogonalRoutes(base.nodes, base.edges);
  const visibleByResource = new Map<string, number>();
  const boundaryByResource = new Map<string, number>();
  for (const connection of selected.partition.internal) {
    visibleByResource.set(connection.from.resource, (visibleByResource.get(connection.from.resource) ?? 0) + 1);
    visibleByResource.set(connection.to.resource, (visibleByResource.get(connection.to.resource) ?? 0) + 1);
  }
  for (const connection of selected.partition.boundary) {
    if (nodeSet.has(connection.from.resource)) boundaryByResource.set(connection.from.resource, (boundaryByResource.get(connection.from.resource) ?? 0) + 1);
    if (nodeSet.has(connection.to.resource)) boundaryByResource.set(connection.to.resource, (boundaryByResource.get(connection.to.resource) ?? 0) + 1);
  }
  const diagnostics: CanvasProjectionDiagnostic[] = [...base.diagnostics];
  const incompleteView = selected.partition.internal.length > MAX_EDGES;
  if (incompleteView) {
    diagnostics.push({ severity: "error", code: "HIERARCHY_LINK_BUDGET_EXCEEDED", message: `Visible source links (${selected.partition.internal.length}) exceed the bounded rendering budget (${MAX_EDGES}); this view is explicitly marked incomplete and no links were silently removed.` });
  }
  const projection: CanvasProjection = {
    ...base,
    diagnostics,
    nodes: base.nodes.map((node) => {
      if (node.type === "zone") {
        const group = navigationGroups.find((candidate) => candidate.id === node.id);
        return {
          ...node,
          data: {
            ...node.data,
            ...(group ? { presentationOnly: true as const, navigationGroupKind: group.kind, memberIds: group.memberIds } : {}),
          },
        };
      }
      const visibleCount = visibleByResource.get(node.id) ?? 0;
      const boundaryCount = boundaryByResource.get(node.id) ?? 0;
      const omittedCount = 0;
      const connectionState = incompleteView && (visibleCount > 0 || boundaryCount > 0)
        ? "INCOMPLETE_VIEW" as const
        : visibleCount > 0
          ? "CONNECTED" as const
          : boundaryCount > 0
            ? "BOUNDARY_CONNECTED" as const
            : "SOURCE_ISOLATED" as const;
      return {
        ...node,
        data: {
          ...node.data,
          hierarchyRole: index.roleById.get(node.id) ?? "device",
          hierarchyVisual: true as const,
          connectionState,
          visibleConnectionCount: visibleCount,
          boundaryConnectionCount: boundaryCount,
          omittedConnectionCount: omittedCount,
          ...(groupByResource.has(node.id) ? { presentationGroupId: groupByResource.get(node.id)! } : {}),
        },
      };
    }),
    edges: base.edges.map((edge) => {
      const route = routes.get(edge.id);
      return {
        ...edge,
        data: {
          ...edge.data,
          hierarchyVisual: true as const,
          ...(route && route.length ? { route, routeKind: "orthogonal" as const } : {}),
        },
      };
    }),
  };
  return {
    kind,
    ...(rootId ? { rootId } : {}),
    page: selected.page,
    pageCount: selected.pageCount,
    nodeIds: selected.nodeIds,
    edgeIds: selected.edgeIds,
    hiddenNodeCount: Math.max(0, index.resources.length - selected.nodeIds.length),
    hiddenConnectionCount: selected.partition.boundary.length + selected.partition.external.length,
    hiddenNeighborCount: kind === "overview" ? Math.max(0, index.resources.length - selected.nodeIds.length) : Math.max(0, selected.totalNeighbors - selected.visibleNeighbors),
    hiddenBoundaryConnectionCount: selected.partition.boundary.length,
    visibleConnectionCount: selected.partition.internal.length,
    navigationGroups,
    partition: selected.partition,
    incompleteView,
    projection,
    layoutStrategy: "arvidsjaur-grouped-orthogonal",
    roleLabel: roleLabel(index, rootId, kind),
  };
}

