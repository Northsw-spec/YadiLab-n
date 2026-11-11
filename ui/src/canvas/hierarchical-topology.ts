import type { LayoutDocument, NormalizedScenario } from "../../../core-model/src/generated/contracts.js";
import { projectScenarioToCanvas } from "./projection.js";
import type { CanvasProjection } from "./types.js";

export type HierarchyRole = "core" | "distribution" | "access" | "endpoint" | "device";
export type HierarchyScopeKind = "overview" | "branch";

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
  readonly layoutStrategy: "bounded-hierarchical-grid";
  readonly roleLabel: string;
}

const MAX_NODES = 100;
const MAX_EDGES = 250;
const NODE_WIDTH = 180;
const NODE_HEIGHT = 96;
const GAP_X = 48;
const GAP_Y = 64;
const PADDING_X = 72;
const PADDING_Y = 48;
const MAX_COLUMNS = 8;

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

function selectBranch(index: HierarchicalTopologyIndex, rootId: string, page: number): { nodeIds: readonly string[]; edgeIds: readonly string[]; page: number; pageCount: number; totalNeighbors: number; visibleNeighbors: number; totalRootLinks: number; visibleRootLinks: number } {
  if (!index.resourcesById.has(rootId)) throw new Error("HIERARCHY_UNKNOWN_ROOT");
  const neighbors = [...pageRootLinks(index, rootId)];
  const pageSize = MAX_NODES - 1;
  const pageCount = Math.max(1, Math.ceil(Math.max(1, neighbors.length) / pageSize));
  const safePage = Math.min(pageCount, Math.max(1, Math.floor(page)));
  const visibleNeighbors = neighbors.slice((safePage - 1) * pageSize, safePage * pageSize);
  const nodeIds = [rootId, ...new Set(visibleNeighbors.map((item) => item.neighborId))];
  const selectedNodes = new Set(nodeIds);
  const rootEdgeIds = visibleNeighbors.map((item) => item.connectionId);
  const edgeIds = [...rootEdgeIds];
  const selectedEdges = new Set(edgeIds);
  for (const connection of index.connections) {
    if (edgeIds.length >= MAX_EDGES) break;
    if (!selectedNodes.has(connection.from.resource) || !selectedNodes.has(connection.to.resource)) continue;
    if (selectedEdges.has(connection.id)) continue;
    edgeIds.push(connection.id);
    selectedEdges.add(connection.id);
  }
  return {
    nodeIds,
    edgeIds,
    page: safePage,
    pageCount,
    totalNeighbors: new Set(neighbors.map((item) => item.neighborId)).size,
    visibleNeighbors: new Set(visibleNeighbors.map((item) => item.neighborId)).size,
    totalRootLinks: neighbors.length,
    visibleRootLinks: rootEdgeIds.length,
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

function layoutDocument(index: HierarchicalTopologyIndex, nodeIds: readonly string[], edgeIds: readonly string[], kind: HierarchyScopeKind, rootId: string | undefined, scenarioId: string): LayoutDocument {
  const levels = hierarchyLevel(index, nodeIds, edgeIds, kind, rootId);
  const byLevel = new Map<number, string[]>();
  for (const id of nodeIds) {
    const list = byLevel.get(levels.get(id) ?? 0) ?? [];
    list.push(id);
    byLevel.set(levels.get(id) ?? 0, list);
  }
  const nodes: { id: string; x: number; y: number; width: number; height: number }[] = [];
  let nextY = PADDING_Y;
  for (const [, ids] of [...byLevel.entries()].sort((left, right) => left[0] - right[0])) {
    const ordered = ids.sort((left, right) => {
      const leftRole = index.roleById.get(left) ?? "device";
      const rightRole = index.roleById.get(right) ?? "device";
      return leftRole.localeCompare(rightRole, "en") || compareId(left, right);
    });
    const columns = Math.min(MAX_COLUMNS, Math.max(1, ordered.length));
    ordered.forEach((id, position) => {
      const row = Math.floor(position / columns);
      const column = position % columns;
      nodes.push({ id, x: PADDING_X + column * (NODE_WIDTH + GAP_X), y: nextY + row * (NODE_HEIGHT + GAP_Y), width: NODE_WIDTH, height: NODE_HEIGHT });
    });
    const rows = Math.max(1, Math.ceil(ordered.length / columns));
    nextY += rows * NODE_HEIGHT + Math.max(0, rows - 1) * GAP_Y + GAP_Y;
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
  const selected = kind === "overview"
    ? { nodeIds: index.overviewNodeIds, edgeIds: index.overviewEdgeIds, page: 1, pageCount: 1, totalNeighbors: 0, visibleNeighbors: 0, totalRootLinks: index.overviewEdgeIds.length, visibleRootLinks: index.overviewEdgeIds.length }
    : selectBranch(index, rootId ?? "", page);
  const nodeSet = new Set(selected.nodeIds);
  const edgeSet = new Set(selected.edgeIds);
  const resources = selected.nodeIds.map((id) => index.resourcesById.get(id)).filter(Boolean).map((resource) => {
    const { zone: _zone, ...withoutZone } = resource!;
    return withoutZone;
  });
  const connections = selected.edgeIds.map((id) => index.connectionsById.get(id)).filter(Boolean);
  const bounded = {
    formatId: "infrastructure-cyber-lab.scenario",
    schemaVersion: "0.1.0",
    scenarioId: index.scenarioId,
    sourceHash: index.sourceHash,
    metadata: { title: roleLabel(index, rootId, kind) },
    assetLocks: index.assetLocks,
    zones: [],
    resources,
    connections,
  } as unknown as NormalizedScenario;
  const layout = layoutDocument(index, selected.nodeIds, selected.edgeIds, kind, rootId, index.scenarioId);
  const base = projectScenarioToCanvas(bounded, layout);
  const projection: CanvasProjection = {
    ...base,
    nodes: base.nodes.map((node) => node.type === "resource" ? {
      ...node,
      data: { ...node.data, hierarchyRole: index.roleById.get(node.id) ?? "device", hierarchyScope: kind, hierarchyRootId: rootId },
    } : node),
  };
  const hiddenBoundaryConnectionCount = index.connections.filter((connection) => nodeSet.has(connection.from.resource) !== nodeSet.has(connection.to.resource)).length;
  return {
    kind,
    ...(rootId ? { rootId } : {}),
    page: selected.page,
    pageCount: selected.pageCount,
    nodeIds: selected.nodeIds,
    edgeIds: selected.edgeIds,
    hiddenNodeCount: Math.max(0, index.resources.length - selected.nodeIds.length),
    hiddenConnectionCount: Math.max(0, index.connections.length - edgeSet.size),
    hiddenNeighborCount: kind === "overview" ? Math.max(0, index.resources.length - selected.nodeIds.length) : Math.max(0, selected.totalNeighbors - selected.visibleNeighbors),
    hiddenBoundaryConnectionCount,
    visibleConnectionCount: selected.edgeIds.length,
    projection,
    layoutStrategy: "bounded-hierarchical-grid",
    roleLabel: roleLabel(index, rootId, kind),
  };
}

