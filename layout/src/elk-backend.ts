import ELK from "elkjs/lib/elk.bundled.js";
import type {
  LayoutBackend,
  LayoutBackendEdge,
  LayoutBackendEdgeSection,
  LayoutBackendNode,
  LayoutBackendPort,
  LayoutBackendResult,
  LayoutGraph,
  LayoutGraphNode,
  LayoutPortInput,
} from "./types.js";
import { ROOT_LAYOUT_PADDING, ZONE_CONTENT_PADDING, elkPadding } from "./geometry-policy.js";

interface ElkPointLike { x?: number; y?: number }
interface ElkPortLike extends ElkPointLike {
  id: string;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
}
interface ElkSectionLike { id?: string; startPoint?: ElkPointLike; bendPoints?: ElkPointLike[]; endPoint?: ElkPointLike }
interface ElkEdgeLike { id: string; sources?: string[]; targets?: string[]; sections?: ElkSectionLike[]; container?: string }
interface ElkNodeLike {
  id: string;
  x?: number; y?: number; width?: number; height?: number;
  children?: ElkNodeLike[];
  ports?: ElkPortLike[];
  edges?: ElkEdgeLike[];
}
interface ElkConstructor { new(): { layout(graph: unknown): Promise<ElkNodeLike> } }
type Point = { readonly x: number; readonly y: number };
type Origin = { readonly x: number; readonly y: number };
const ORTHOGONAL_EPSILON = 1e-6;

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }

function point(value: ElkPointLike | undefined, origin: Origin, code: string): Point {
  if (!value || !finite(value.x) || !finite(value.y)) throw new Error(`${code}: non-finite ELK point.`);
  return { x: value.x, y: value.y };
}

function portSide(port: LayoutPortInput): "NORTH" | "SOUTH" | "EAST" | "WEST" {
  return port.side ?? (port.direction === "output" ? "EAST" : "WEST");
}

function nodeToElk(node: LayoutGraphNode): Record<string, unknown> {
  const ports = node.ports.map((port) => ({
    id: port.id,
    width: 8,
    height: 8,
    layoutOptions: {
      "org.eclipse.elk.port.side": portSide(port),
      ...(port.index !== undefined ? { "org.eclipse.elk.port.index": String(port.index) } : {}),
    },
  }));
  const fixedOrder = node.ports.length > 0 && node.ports.every((port) => port.index !== undefined && port.side !== undefined);
  return {
    id: node.id,
    width: node.width,
    height: node.height,
    ...(node.children.length ? { children: node.children.map(nodeToElk) } : {}),
    ...(ports.length ? { ports } : {}),
    layoutOptions: {
      ...(node.kind === "zone" ? { "elk.padding": elkPadding(ZONE_CONTENT_PADDING) } : {}),
      ...(fixedOrder ? { "org.eclipse.elk.portConstraints": "FIXED_ORDER" } : ports.length ? { "org.eclipse.elk.portConstraints": "FIXED_SIDE" } : {}),
    },
  };
}

function collectNodes(
  nodes: readonly ElkNodeLike[] | undefined,
  parent: string | undefined,
  parentOrigin: Origin,
  outNodes: LayoutBackendNode[],
  outPorts: LayoutBackendPort[],
  origins: Map<string, Origin>,
): void {
  for (const node of nodes ?? []) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    if (!finite(x) || !finite(y) || !finite(node.width) || !finite(node.height)) throw new Error(`TOPOLOGY_LAYOUT_ELK_INVALID_NODE:${node.id}`);
    const origin = { x: parentOrigin.x + x, y: parentOrigin.y + y };
    origins.set(node.id, origin);
    // LayoutBackendNode remains parent-local for the legacy LayoutDocument
    // contract. Edge sections and ports below are the additive world-space
    // geometry consumed by the topology adapter.
    outNodes.push({ id: node.id, x, y, width: node.width, height: node.height, ...(parent ? { parent } : {}) });
    for (const port of node.ports ?? []) {
      const px = port.x ?? 0; const py = port.y ?? 0; const width = port.width ?? 8; const height = port.height ?? 8;
      if (![px, py, width, height].every(finite) || width <= 0 || height <= 0) throw new Error(`TOPOLOGY_LAYOUT_ELK_INVALID_PORT:${port.id}`);
      const sideValue = port.layoutOptions?.["org.eclipse.elk.port.side"];
      const side = sideValue === "NORTH" || sideValue === "SOUTH" || sideValue === "EAST" || sideValue === "WEST" ? sideValue : undefined;
      const indexValue = port.layoutOptions?.["org.eclipse.elk.port.index"];
      const index = indexValue !== undefined && Number.isInteger(Number(indexValue)) ? Number(indexValue) : undefined;
      outPorts.push({ id: port.id, ownerId: node.id, x: origin.x + px, y: origin.y + py, width, height, ...(side ? { side } : {}), ...(index !== undefined ? { index } : {}) });
    }
    collectNodes(node.children, node.id, origin, outNodes, outPorts, origins);
  }
}

function collectEdges(nodes: readonly ElkNodeLike[] | undefined, out: { edge: ElkEdgeLike; container: string }[]): void {
  for (const node of nodes ?? []) {
    for (const edge of node.edges ?? []) out.push({ edge, container: edge.container ?? node.id });
    collectEdges(node.children, out);
  }
}

function normalizeSection(section: ElkSectionLike, origin: Origin, edgeId: string, index: number): LayoutBackendEdgeSection {
  if (!section.startPoint || !section.endPoint) throw new Error(`TOPOLOGY_LAYOUT_EDGE_SECTION_INVALID:${edgeId}:${index}`);
  // ELK sections are in the edge container's local coordinate frame. Add the
  // container origin exactly once here; callers receive world-space geometry.
  const toWorld = (p: ElkPointLike) => {
    if (!finite(p.x) || !finite(p.y)) throw new Error(`TOPOLOGY_LAYOUT_EDGE_SECTION_INVALID:${edgeId}:${index}`);
    return { x: p.x + origin.x, y: p.y + origin.y };
  };
  const startPoint = toWorld(section.startPoint);
  const endPoint = toWorld(section.endPoint);
  const bendPoints = (section.bendPoints ?? []).map(toWorld);
  const all = [startPoint, ...bendPoints, endPoint];
  for (let pointIndex = 1; pointIndex < all.length; pointIndex += 1) {
    const previous = all[pointIndex - 1]!; const current = all[pointIndex]!;
    if (Math.abs(previous.x - current.x) > ORTHOGONAL_EPSILON && Math.abs(previous.y - current.y) > ORTHOGONAL_EPSILON) throw new Error(`TOPOLOGY_LAYOUT_EDGE_NON_ORTHOGONAL:${edgeId}:${index}`);
  }
  return { id: section.id ?? `${edgeId}_s${index}`, startPoint, bendPoints, endPoint };
}

function normalizeEdges(output: ElkNodeLike, origins: ReadonlyMap<string, Origin>, inputEdges: ReadonlyMap<string, { sourceNode: string; targetNode: string; sourcePort?: string; targetPort?: string }>): LayoutBackendEdge[] {
  const raw: { edge: ElkEdgeLike; container: string }[] = [];
  for (const edge of output.edges ?? []) raw.push({ edge, container: edge.container ?? output.id });
  collectEdges(output.children, raw);
  return raw.map(({ edge, container }) => {
    const sourcePort = edge.sources?.[0]; const targetPort = edge.targets?.[0];
    if (!sourcePort || !targetPort) throw new Error(`TOPOLOGY_LAYOUT_EDGE_ENDPOINT_MISSING:${edge.id}`);
    const sections = (edge.sections ?? []).map((section, index) => normalizeSection(section, origins.get(container) ?? { x: 0, y: 0 }, edge.id, index));
    if (!sections.length) throw new Error(`TOPOLOGY_LAYOUT_EDGE_SECTION_MISSING:${edge.id}`);
    const input = inputEdges.get(edge.id);
    return {
      id: edge.id,
      sourceNode: input?.sourceNode ?? (sourcePort.includes("::") ? sourcePort.split("::")[0]! : sourcePort),
      targetNode: input?.targetNode ?? (targetPort.includes("::") ? targetPort.split("::")[0]! : targetPort),
      ...(input?.sourcePort ? { sourcePort: input.sourcePort } : {}),
      ...(input?.targetPort ? { targetPort: input.targetPort } : {}),
      sections,
      ...(container !== output.id ? { container } : {}),
    };
  });
}

export class ElkLayoutBackend implements LayoutBackend {
  readonly id = "elk.layered";

  async layout(graph: LayoutGraph): Promise<LayoutBackendResult> {
    const Ctor = ELK as unknown as ElkConstructor;
    const elk = new Ctor();
    let output: ElkNodeLike;
    try {
      output = await elk.layout({
        id: graph.id,
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "RIGHT",
          "elk.hierarchyHandling": "INCLUDE_CHILDREN",
          "org.eclipse.elk.edgeRouting": "ORTHOGONAL",
          "org.eclipse.elk.layered.mergeEdges": "false",
          "org.eclipse.elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
          "org.eclipse.elk.randomSeed": "094",
          "elk.spacing.nodeNode": "40",
          "elk.layered.spacing.nodeNodeBetweenLayers": "80",
          "elk.padding": elkPadding(ROOT_LAYOUT_PADDING),
          ...(graph.layoutOptions ?? {}),
        },
        children: graph.children.map(nodeToElk),
      edges: graph.edges.map((edge) => ({ id: edge.id, sources: [edge.sourcePort ?? edge.sourceNode], targets: [edge.targetPort ?? edge.targetNode] })),
      });
    } catch (cause) {
      throw new Error(`TOPOLOGY_LAYOUT_ELK_FAILED:${cause instanceof Error ? cause.message : String(cause)}`);
    }
    const nodes: LayoutBackendNode[] = []; const ports: LayoutBackendPort[] = [];
    const origins = new Map<string, Origin>([[graph.id, { x: 0, y: 0 }]]);
    collectNodes(output.children, undefined, { x: 0, y: 0 }, nodes, ports, origins);
    const inputEdges = new Map(graph.edges.map((edge) => [edge.id, edge] as const));
    const edges = normalizeEdges(output, origins, inputEdges);
    return { nodes, ports, edges };
  }
}
