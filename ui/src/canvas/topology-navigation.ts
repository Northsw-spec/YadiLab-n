import type { CanvasNode } from "./types.js";

export type TopologySearchEntity = "node" | "interface" | "service";
export interface TopologySearchResult { readonly entity: TopologySearchEntity; readonly nodeId: string; readonly nodeLabel: string; readonly field: string; readonly value: string; readonly detail: string; }
export interface TopologyNavigationState { readonly query: string; readonly nodeType?: string; readonly zone?: string; readonly vlan?: string; readonly pathNodeIds: readonly string[]; }
export interface TopologyCanonicalResource {
  readonly id: string;
  readonly label?: string;
  readonly type?: string;
  readonly vendor?: string;
  readonly product?: string;
  readonly interfaces?: readonly {
    readonly id?: string;
    readonly label?: string;
    readonly addresses?: readonly string[];
  }[];
  readonly properties?: Readonly<Record<string, unknown>>;
}
export interface TopologyCanonicalConnection {
  readonly id: string;
  readonly from: { readonly resource: string };
  readonly to: { readonly resource: string };
}
export interface TopologyCanonicalNetwork {
  readonly resources: readonly TopologyCanonicalResource[];
  readonly connections: readonly TopologyCanonicalConnection[];
}
export interface TopologyFocusPage {
  readonly rootId: string;
  readonly page: number;
  readonly pageCount: number;
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly totalNeighbors: number;
  readonly visibleNeighbors: number;
  readonly hiddenNeighbors: number;
  readonly totalLinks: number;
  readonly visibleLinks: number;
  readonly hiddenLinks: number;
}
const normalize = (value: unknown): string => String(value ?? "").trim().toLocaleLowerCase();
const values = (value: unknown): readonly string[] => Array.isArray(value) ? value.flatMap((item) => typeof item === "string" || typeof item === "number" ? [String(item)] : []) : [];
export function buildTopologySearchIndex(nodes: readonly CanvasNode[]): readonly TopologySearchResult[] {
  const results: TopologySearchResult[] = [];
  for (const node of nodes) { if (node.type !== "resource") continue; const data = node.data as unknown as Record<string, unknown>; const nodeLabel = String(data.label ?? node.id); results.push({ entity: "node", nodeId: node.id, nodeLabel, field: "node", value: nodeLabel, detail: "Node" }); results.push({ entity: "node", nodeId: node.id, nodeLabel, field: "nodeId", value: node.id, detail: "Node ID" }); for (const iface of Array.isArray(data.interfaces) ? data.interfaces as readonly Record<string, unknown>[] : []) { const name = String(iface.label ?? iface.interfaceId ?? ""); if (name) results.push({ entity: "interface", nodeId: node.id, nodeLabel, field: "interface", value: name, detail: `Interface on ${nodeLabel}` }); for (const address of values(iface.addresses)) results.push({ entity: "interface", nodeId: node.id, nodeLabel, field: "address", value: address, detail: `Address on ${nodeLabel}` }); } for (const service of values(data.services)) results.push({ entity: "service", nodeId: node.id, nodeLabel, field: "service", value: service, detail: `Service on ${nodeLabel}` }); }
  return results;
}
function canonicalProperties(resource: TopologyCanonicalResource): readonly { readonly field: string; readonly value: string }[] {
  const properties = resource.properties ?? {};
  const supported = ["site", "siteId", "campus", "building", "floor", "rack", "group", "groupId", "vlan", "vlanId"];
  return supported.flatMap((field) => values(properties[field]).map((value) => ({ field, value })));
}
export function buildTopologySearchIndexFromResources(resources: readonly TopologyCanonicalResource[]): readonly TopologySearchResult[] {
  const results: TopologySearchResult[] = [];
  for (const resource of resources) {
    const nodeLabel = String(resource.label ?? resource.id);
    const add = (entity: TopologySearchEntity, field: string, value: unknown, detail: string) => {
      const text = String(value ?? "");
      if (text) results.push({ entity, nodeId: resource.id, nodeLabel, field, value: text, detail });
    };
    add("node", "node", nodeLabel, "Node");
    add("node", "nodeId", resource.id, "Node ID");
    add("node", "type", resource.type, "Device type");
    add("node", "vendor", resource.vendor, "Vendor");
    add("node", "product", resource.product, "Product");
    for (const property of canonicalProperties(resource)) add("node", property.field, property.value, `Documented ${property.field}`);
    for (const iface of resource.interfaces ?? []) {
      add("interface", "interface", iface.label ?? iface.id, `Interface on ${nodeLabel}`);
      for (const address of iface.addresses ?? []) add("interface", "address", address, `Address on ${nodeLabel}`);
    }
  }
  return results;
}
export function buildTopologySearchIndexFromNetwork(network: TopologyCanonicalNetwork): readonly TopologySearchResult[] {
  return buildTopologySearchIndexFromResources(network.resources);
}
export function searchTopology(index: readonly TopologySearchResult[], query: string, limit = 40): readonly TopologySearchResult[] {
  const needle = normalize(query); if (!needle) return [];
  return index.filter((result) => normalize(result.value).includes(needle)).slice(0, Math.max(0, limit));
}
export function searchTopologyWithCount(index: readonly TopologySearchResult[], query: string, limit = 40): { readonly total: number; readonly results: readonly TopologySearchResult[] } {
  const needle = normalize(query); if (!needle) return { total: 0, results: [] };
  const matches = index.filter((result) => normalize(result.value).includes(needle));
  return { total: matches.length, results: matches.slice(0, Math.max(0, limit)) };
}
export function buildTopologyFocusPage(network: TopologyCanonicalNetwork, rootId: string, page = 1, maxNodes = 100, maxEdges = 250): TopologyFocusPage {
  const resources = new Set(network.resources.map((resource) => resource.id));
  if (!resources.has(rootId)) throw new Error("TOPOLOGY_FOCUS_UNKNOWN_NODE");
  const adjacency = new Set<string>();
  for (const connection of network.connections) {
    if (connection.from.resource === rootId && resources.has(connection.to.resource)) adjacency.add(connection.to.resource);
    if (connection.to.resource === rootId && resources.has(connection.from.resource)) adjacency.add(connection.from.resource);
  }
  const neighbors = [...adjacency].sort((a, b) => a.localeCompare(b, "en"));
  const safePageSize = Math.max(1, Math.min(Math.floor(maxNodes) - 1, neighbors.length || 1));
  const pageCount = Math.max(1, Math.ceil(neighbors.length / safePageSize));
  const safePage = Math.min(pageCount, Math.max(1, Math.floor(page)));
  const visibleNeighbors = neighbors.slice((safePage - 1) * safePageSize, safePage * safePageSize);
  const visible = new Set([rootId, ...visibleNeighbors]);
  const visibleEdges = network.connections
    .filter((connection) => visible.has(connection.from.resource) && visible.has(connection.to.resource))
    .sort((a, b) => a.id.localeCompare(b.id, "en"))
    .slice(0, Math.max(0, Math.floor(maxEdges)));
  const totalRootLinks = network.connections.filter((connection) => connection.from.resource === rootId || connection.to.resource === rootId).length;
  return {
    rootId,
    page: safePage,
    pageCount,
    nodeIds: [rootId, ...visibleNeighbors],
    edgeIds: visibleEdges.map((connection) => connection.id),
    totalNeighbors: neighbors.length,
    visibleNeighbors: visibleNeighbors.length,
    hiddenNeighbors: neighbors.length - visibleNeighbors.length,
    totalLinks: totalRootLinks,
    visibleLinks: visibleEdges.length,
    hiddenLinks: Math.max(0, totalRootLinks - visibleEdges.length),
  };
}
export function filterTopologyNodes(nodes: readonly CanvasNode[], state: TopologyNavigationState): Readonly<Record<string, "match" | "dim">> { const query = normalize(state.query); const path = new Set(state.pathNodeIds); const matched = new Set(searchTopology(buildTopologySearchIndex(nodes), state.query).map((result) => result.nodeId)); const result: Record<string, "match" | "dim"> = {}; for (const node of nodes) { const data = node.data as unknown as Record<string, unknown>; const typeMatch = !state.nodeType || normalize(data.resourceType) === normalize(state.nodeType); const zoneMatch = !state.zone || normalize(data.zoneKind) === normalize(state.zone); const vlanValues = [...values(data.vlans), ...values(data.vlanIds), ...(Array.isArray(data.interfaces) ? data.interfaces.flatMap((iface) => values((iface as Record<string, unknown>).vlan)) : [])]; const vlanMatch = !state.vlan || vlanValues.some((vlan) => normalize(vlan) === normalize(state.vlan)); const queryMatch = !query || matched.has(node.id); const pathMatch = !path.size || path.has(node.id); result[node.id] = typeMatch && zoneMatch && vlanMatch && queryMatch && pathMatch ? "match" : "dim"; } return result; }
