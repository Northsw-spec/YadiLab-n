import { ElkLayoutBackend } from "../../../layout/src/elk-backend.js";
import { inputPortId, outputPortId } from "../../../layout/src/projection.js";
import type {
  LayoutBackend,
  LayoutBackendEdge,
  LayoutGraph,
  LayoutGraphEdge,
  LayoutGraphNode,
  LayoutPortInput,
} from "../../../layout/src/types.js";
import type { HierarchicalTopologyView } from "./hierarchical-topology.js";
import type {
  CanvasNode,
  CanvasResourceData,
  CanvasProjection,
  CanvasVisualAttachmentHandle,
  CanvasZoneData,
} from "./types.js";

export const TOPOLOGY_LAYOUT_CONFIG_VERSION = "project-094-elk-v1";

export type TopologyViewportBucket = "mobile" | "compact" | "wide";

export interface TopologyLayoutRequest {
  readonly sourceHash: string;
  readonly scope: "overview" | "branch";
  readonly rootId?: string;
  readonly page: number;
  readonly viewportBucket: TopologyViewportBucket;
  readonly configVersion?: string;
}
export interface TopologyLayoutCandidate {
  readonly id: "A-flat-right" | "B-flat-down-high-degree" | "C-role-aware-fanout";
  readonly direction: "RIGHT" | "DOWN";
  readonly options: Readonly<Record<string, string>>;
  readonly acceptable: boolean;
  readonly rejectionReasons: readonly string[];
  readonly metrics: TopologyLayoutMetrics;
  readonly coordinateHash: string;
}

export interface TopologyLayoutMetrics {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly totalLength: number;
  readonly p95CableLength: number;
  readonly medianDetour: number;
  readonly p95Detour: number;
  readonly turns: number;
  readonly cableCrossings: number;
  readonly nodeOverlaps: number;
  readonly edgeNodeCrossings: number;
  readonly nonOrthogonalSegments: number;
  readonly bbox: { readonly width: number; readonly height: number };
  readonly elapsedMs: number;
}

export interface TopologyLayoutQuality {
  readonly winnerId: TopologyLayoutCandidate["id"];
  readonly candidates: readonly TopologyLayoutCandidate[];
  readonly deterministicHash: string;
  readonly hardGate: "PASS" | "FAIL";
  readonly baselineComparison: {
    readonly baselineTotalLength: number;
    readonly baselineP95Detour: number;
    readonly totalTarget: number;
    readonly p95Target: number;
    readonly totalImprovement: number;
    readonly p95Improvement: number;
    readonly totalTargetMet: boolean;
    readonly p95TargetMet: boolean;
    readonly qualityGate: "PASS" | "FAIL";
  };
}

export interface TopologyLayoutResult {
  readonly requestKey: string;
  readonly engine: "elk.layered";
  readonly projection: CanvasProjection;
  readonly quality: TopologyLayoutQuality;
  readonly diagnostics: readonly { readonly severity: "error" | "warning"; readonly code: string; readonly message: string }[];
}

interface Rect { readonly id: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
interface ElkGraphBuild {
  readonly graph: LayoutGraph;
  readonly visualHandles: ReadonlyMap<string, readonly CanvasVisualAttachmentHandle[]>;
  readonly resourceIds: ReadonlySet<string>;
  readonly groupIds: ReadonlySet<string>;
}
interface CandidateRun {
  readonly candidate: TopologyLayoutCandidate;
  /** Resource rectangles in root/world coordinates. */
  readonly nodes: ReadonlyMap<string, Rect>;
  /** Presentation-group rectangles in root/world coordinates. */
  readonly groups: ReadonlyMap<string, Rect>;
  readonly edges: readonly LayoutBackendEdge[];
}

const RESOURCE_WIDTH = 168;
const RESOURCE_HEIGHT = 88;
const ORTHOGONAL_EPSILON = 1e-6;
// Frozen Wave-A PROJECT-093 Access25 measurements.  These values are used
// only for the additive quality report; they never mutate source data.
const FROZEN_BASELINE_TOTAL_LENGTH = 49206.00018507434;
const FROZEN_BASELINE_P95_DETOUR = 1.537736060237084;

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createTopologyRequestKey(request: TopologyLayoutRequest): string {
  return [request.sourceHash, request.scope, request.rootId ?? "overview", String(request.page), request.viewportBucket, request.configVersion ?? TOPOLOGY_LAYOUT_CONFIG_VERSION].join("|");
}

function viewportBucket(width: number): TopologyViewportBucket {
  if (width <= 480) return "mobile";
  if (width <= 1100) return "compact";
  return "wide";
}

export function topologyViewportBucket(width: number): TopologyViewportBucket { return viewportBucket(width); }

function resourceNodes(projection: CanvasProjection): readonly (CanvasNode & { type: "resource"; data: CanvasResourceData })[] {
  return projection.nodes.filter((node): node is CanvasNode & { type: "resource"; data: CanvasResourceData } => node.type === "resource");
}

function presentationZones(projection: CanvasProjection): readonly (CanvasNode & { type: "zone"; data: CanvasZoneData })[] {
  return projection.nodes.filter((node): node is CanvasNode & { type: "zone"; data: CanvasZoneData } =>
    node.type === "zone" && (node.data as CanvasZoneData).presentationOnly === true);
}

function buildElkGraph(projection: CanvasProjection, profile: TopologyLayoutCandidate["id"]): ElkGraphBuild {
  const resources = resourceNodes(projection).slice().sort((a, b) => a.id.localeCompare(b.id, "en"));
  const resourceById = new Map(resources.map((resource) => [resource.id, resource] as const));
  const edges = projection.edges.slice().sort((a, b) => a.id.localeCompare(b.id, "en"));
  const portsByNode = new Map<string, LayoutPortInput[]>();
  const visualHandles = new Map<string, CanvasVisualAttachmentHandle[]>();
  const addPort = (nodeId: string, port: LayoutPortInput): void => {
    const ports = portsByNode.get(nodeId) ?? [];
    if (!ports.some((candidate) => candidate.id === port.id)) ports.push(port);
    portsByNode.set(nodeId, ports);
  };
  for (const resource of resources) {
    resource.data.interfaces.forEach((iface, index) => {
      addPort(resource.id, { id: outputPortId(resource.id, iface.interfaceId), ownerId: resource.id, interfaceId: iface.interfaceId, direction: "output", side: "EAST", index: index * 2 });
      addPort(resource.id, { id: inputPortId(resource.id, iface.interfaceId), ownerId: resource.id, interfaceId: iface.interfaceId, direction: "input", side: "WEST", index: index * 2 + 1 });
    });
  }
  const layoutEdges: LayoutGraphEdge[] = [];
  for (const edge of edges) {
    const sourcePort = edge.sourceHandle?.startsWith("out:") ? outputPortId(edge.source, edge.sourceHandle.slice(4)) : `__visual_port__:${edge.id}:source`;
    const targetPort = edge.targetHandle?.startsWith("in:") ? inputPortId(edge.target, edge.targetHandle.slice(3)) : `__visual_port__:${edge.id}:target`;
    if (!edge.sourceHandle?.startsWith("out:")) {
      addPort(edge.source, { id: sourcePort, ownerId: edge.source, interfaceId: sourcePort, direction: "output", side: "EAST", index: 1000 + layoutEdges.length * 2, viewOnly: true });
      const list = visualHandles.get(edge.source) ?? [];
      list.push({ handleId: sourcePort, connectionId: edge.id, direction: "source", side: "EAST" });
      visualHandles.set(edge.source, list);
    }
    if (!edge.targetHandle?.startsWith("in:")) {
      addPort(edge.target, { id: targetPort, ownerId: edge.target, interfaceId: targetPort, direction: "input", side: "WEST", index: 1001 + layoutEdges.length * 2, viewOnly: true });
      const list = visualHandles.get(edge.target) ?? [];
      list.push({ handleId: targetPort, connectionId: edge.id, direction: "target", side: "WEST" });
      visualHandles.set(edge.target, list);
    }
    layoutEdges.push({ id: edge.id, sourceNode: edge.source, targetNode: edge.target, sourcePort, targetPort });
  }
  // C is the fan-out-aware ELK profile.  These are explicit layout-only
  // constraints: they create short, deterministic client rows for a hub with
  // many endpoint neighbours, while canonical physical links remain the only
  // edges returned to React Flow.  No source relationship is invented.
  if (profile === "C-role-aware-fanout") {
    const targetsBySource = new Map<string, string[]>();
    for (const edge of edges) {
      const target = resourceById.get(edge.target);
      if (!target) continue;
      const type = `${target.data.deviceFamily ?? ""} ${target.data.resourceType ?? ""}`.toLowerCase();
      if (!/client|endpoint|workstation|desktop|laptop|tablet|mobile/.test(type)) continue;
      const targets = targetsBySource.get(edge.source) ?? [];
      targets.push(edge.target);
      targetsBySource.set(edge.source, targets);
    }
    for (const [source, targets] of [...targetsBySource.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))) {
      const uniqueTargets = [...new Set(targets)].sort((left, right) => left.localeCompare(right, "en"));
      if (uniqueTargets.length < 6) continue;
      for (let index = 0; index + 1 < uniqueTargets.length; index += 3) {
        const from = uniqueTargets[index]!;
        const to = uniqueTargets[index + 1]!;
        layoutEdges.push({ id: `__layout__:${profile}:${source}:${from}:${to}`, sourceNode: from, targetNode: to, layoutOnly: true });
        if (index + 2 < uniqueTargets.length) {
          const next = uniqueTargets[index + 2]!;
          layoutEdges.push({ id: `__layout__:${profile}:${source}:${to}:${next}`, sourceNode: to, targetNode: next, layoutOnly: true });
        }
      }
    }
  }
  const options: Record<string, string> = profile === "A-flat-right"
    ? { "elk.direction": "RIGHT", "org.eclipse.elk.layered.highDegreeNodes.treatment": "false", "elk.spacing.nodeNode": "40", "elk.layered.spacing.nodeNodeBetweenLayers": "80" }
    : profile === "B-flat-down-high-degree"
      ? { "elk.direction": "DOWN", "org.eclipse.elk.layered.highDegreeNodes.treatment": "true", "org.eclipse.elk.layered.highDegreeNodes.threshold": "16", "elk.spacing.nodeNode": "40", "elk.layered.spacing.nodeNodeBetweenLayers": "80" }
      : {
        "elk.direction": "RIGHT",
        "org.eclipse.elk.layered.highDegreeNodes.treatment": "true",
        "org.eclipse.elk.layered.highDegreeNodes.threshold": "12",
        "elk.spacing.nodeNode": "0",
        "elk.layered.spacing.nodeNodeBetweenLayers": "0",
        "elk.layered.spacing.edgeNodeBetweenLayers": "0",
        "elk.layered.spacing.edgeEdgeBetweenLayers": "0",
        "elk.spacing.edgeNode": "0",
        "elk.spacing.edgeEdge": "0",
        "org.eclipse.elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      };
  const resourceNodesById = new Map(resources.map((resource) => [resource.id, resource] as const));
  const groups = presentationZones(projection)
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
  const grouped = new Set<string>();
  const groupNodes: LayoutGraphNode[] = groups.flatMap((group) => {
    const members = (group.data.memberIds ?? [])
      .filter((id) => resourceNodesById.has(id))
      .sort((left, right) => left.localeCompare(right, "en"));
    if (!members.length) return [];
    members.forEach((id) => grouped.add(id));
    return [{
      id: group.id,
      kind: "zone",
      width: Math.max(group.width, RESOURCE_WIDTH + 48),
      height: Math.max(group.height, RESOURCE_HEIGHT + 90),
      children: members.map((id) => {
        const resource = resourceNodesById.get(id)!;
        return {
          id,
          kind: "resource" as const,
          width: resource.width || RESOURCE_WIDTH,
          height: resource.height || RESOURCE_HEIGHT,
          children: [],
          ports: (portsByNode.get(id) ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0) || a.id.localeCompare(b.id, "en")),
        };
      }),
      ports: [],
    }];
  });
  const ungroupedNodes: LayoutGraphNode[] = resources.filter((resource) => !grouped.has(resource.id)).map((resource) => ({
    id: resource.id,
    kind: "resource",
    width: resource.width || RESOURCE_WIDTH,
    height: resource.height || RESOURCE_HEIGHT,
    children: [],
    ports: (portsByNode.get(resource.id) ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0) || a.id.localeCompare(b.id, "en")),
  }));
  const children = [...groupNodes, ...ungroupedNodes];
  return {
    graph: { id: "__root__", children, edges: layoutEdges, layoutOptions: options },
    visualHandles,
    resourceIds: new Set(resources.map((resource) => resource.id)),
    groupIds: new Set(groupNodes.map((group) => group.id)),
  };
}

function rectsFromBackend(nodes: readonly { id: string; x: number; y: number; width: number; height: number; parent?: string }[]): ReadonlyMap<string, Rect> {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const cache = new Map<string, Rect>();
  const resolve = (id: string, visiting = new Set<string>()): Rect | undefined => {
    const cached = cache.get(id);
    if (cached) return cached;
    const node = byId.get(id);
    if (!node || visiting.has(id)) return undefined;
    const parent = node.parent ? resolve(node.parent, new Set([...visiting, id])) : undefined;
    const rect = { id, x: (parent?.x ?? 0) + node.x, y: (parent?.y ?? 0) + node.y, width: node.width, height: node.height };
    cache.set(id, rect);
    return rect;
  };
  for (const node of nodes) resolve(node.id);
  return cache;
}

function segmentLength(a: { x: number; y: number }, b: { x: number; y: number }): number { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

function pointList(edge: LayoutBackendEdge): readonly { x: number; y: number }[] {
  return edge.sections.flatMap((section, index) => index === 0 ? [section.startPoint, ...section.bendPoints, section.endPoint] : [...section.bendPoints, section.endPoint]);
}

function rectOverlap(a: Rect, b: Rect): boolean { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }

function segmentCrossesRect(a: { x: number; y: number }, b: { x: number; y: number }, rect: Rect): boolean {
  const margin = 1;
  if (a.x === b.x) return a.x > rect.x + margin && a.x < rect.x + rect.width - margin && Math.max(a.y, b.y) > rect.y + margin && Math.min(a.y, b.y) < rect.y + rect.height - margin;
  if (a.y === b.y) return a.y > rect.y + margin && a.y < rect.y + rect.height - margin && Math.max(a.x, b.x) > rect.x + margin && Math.min(a.x, b.x) < rect.x + rect.width - margin;
  return true;
}

interface Segment { readonly edgeId: string; readonly a: { x: number; y: number }; readonly b: { x: number; y: number } }

function normalizeParallelElkSections(edges: readonly LayoutBackendEdge[], nodes: ReadonlyMap<string, Rect>): readonly LayoutBackendEdge[] {
  const bundles = new Map<string, LayoutBackendEdge[]>();
  for (const edge of edges) {
    const key = `${edge.sourceNode}\u0000${edge.targetNode}`;
    const list = bundles.get(key) ?? [];
    list.push(edge);
    bundles.set(key, list);
  }
  const replacements = new Map<string, LayoutBackendEdge>();
  for (const bundle of bundles.values()) {
    if (bundle.length < 2) continue;
    const source = nodes.get(bundle[0]!.sourceNode); const target = nodes.get(bundle[0]!.targetNode);
    if (!source || !target || Math.abs(source.x - target.x) < Math.max(source.width, target.width)) continue;
    const leftToRight = source.x + source.width <= target.x;
    const ordered = bundle.slice().sort((left, right) => left.id.localeCompare(right.id, "en"));
    for (const [bundleIndex, edge] of ordered.entries()) {
      if (bundleIndex > 0) continue;
      const route = pointList(edge); const start = route[0]; const end = route.at(-1); const firstBend = route[1];
      if (!start || !end || !firstBend) continue;
      const firstDifferentYIndex = route.findIndex((point, index) => index > 0 && Math.abs(point.y - start.y) > ORTHOGONAL_EPSILON);
      const firstDifferentY = firstDifferentYIndex >= 0 ? route[firstDifferentYIndex] : undefined;
      if (!firstDifferentY) continue;
      // ELK has already selected the bundle corridor.  A small source-side
      // offset for the first parallel edge avoids a port permutation crossing
      // while retaining the remaining ELK bends and target-side lane.
      const lane = leftToRight ? firstBend.x - 12 : firstBend.x + 12;
      const prefix = [start, { x: lane, y: start.y }, { x: lane, y: firstDifferentY.y }, { x: firstDifferentY.x, y: firstDifferentY.y }];
      const repairedRoute = [...prefix, ...route.slice(firstDifferentYIndex + 1)];
      replacements.set(edge.id, { ...edge, sections: [{ id: edge.sections[0]!.id, startPoint: start, bendPoints: repairedRoute.slice(1, -1), endPoint: end }] });
    }
  }
  return edges.map((edge) => replacements.get(edge.id) ?? edge);
}

function properSegmentCrossing(left: Segment, right: Segment): boolean {
  const leftHorizontal = Math.abs(left.a.y - left.b.y) <= ORTHOGONAL_EPSILON;
  const rightHorizontal = Math.abs(right.a.y - right.b.y) <= ORTHOGONAL_EPSILON;
  if (leftHorizontal === rightHorizontal) return false;
  const horizontal = leftHorizontal ? left : right;
  const vertical = leftHorizontal ? right : left;
  const hx1 = Math.min(horizontal.a.x, horizontal.b.x); const hx2 = Math.max(horizontal.a.x, horizontal.b.x);
  const vy1 = Math.min(vertical.a.y, vertical.b.y); const vy2 = Math.max(vertical.a.y, vertical.b.y);
  const x = vertical.a.x; const y = horizontal.a.y;
  // Endpoint touches are expected at a real card/handle and are not cable
  // crossings.  Shared collinear lanes are overlaps, not crossings.
  const interior = x > hx1 + ORTHOGONAL_EPSILON && x < hx2 - ORTHOGONAL_EPSILON && y > vy1 + ORTHOGONAL_EPSILON && y < vy2 - ORTHOGONAL_EPSILON;
  return interior;
}

function metrics(graph: LayoutGraph, nodes: ReadonlyMap<string, Rect>, edges: readonly LayoutBackendEdge[], elapsedMs: number): TopologyLayoutMetrics {
  const rectList = [...nodes.values()];
  let nodeOverlaps = 0;
  for (let i = 0; i < rectList.length; i += 1) for (let j = i + 1; j < rectList.length; j += 1) if (rectOverlap(rectList[i]!, rectList[j]!)) nodeOverlaps += 1;
  const lengths: number[] = []; const detours: number[] = []; const segments: Segment[] = []; let turns = 0; let nonOrthogonalSegments = 0; let edgeNodeCrossings = 0;
  for (const edge of edges) {
    const points = pointList(edge); let length = 0;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1]!; const current = points[index]!;
      length += segmentLength(previous, current);
      if (Math.abs(previous.x - current.x) > ORTHOGONAL_EPSILON && Math.abs(previous.y - current.y) > ORTHOGONAL_EPSILON) nonOrthogonalSegments += 1;
      segments.push({ edgeId: edge.id, a: previous, b: current });
    }
    lengths.push(length); turns += Math.max(0, points.length - 2);
    const source = nodes.get(edge.sourceNode); const target = nodes.get(edge.targetNode);
    if (source && target) {
      const start = points[0]!; const end = points.at(-1)!;
      const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
      const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
      const direct = Math.abs(sourceCenter.x - targetCenter.x) + Math.abs(sourceCenter.y - targetCenter.y);
      // D_e is the centre-to-centre Manhattan lower bound.  Include the
      // measured card-centre → handle legs in the routed length so Q_e stays
      // >= 1 while still comparing the same physical route geometry.
      const centrePathLength = length + segmentLength(sourceCenter, start) + segmentLength(end, targetCenter);
      detours.push(centrePathLength / Math.max(1, direct));
    }
    for (let index = 1; index < points.length; index += 1) for (const rect of rectList) if (rect.id !== edge.sourceNode && rect.id !== edge.targetNode && segmentCrossesRect(points[index - 1]!, points[index]!, rect)) edgeNodeCrossings += 1;
  }
  const sorted = (values: readonly number[]) => values.slice().sort((a, b) => a - b);
  const sortedDetours = sorted(detours);
  const sortedLengths = sorted(lengths);
  const percentile = (values: readonly number[], p: number) => values.length ? values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1))]! : 0;
  let cableCrossings = 0;
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
      const left = segments[leftIndex]!; const right = segments[rightIndex]!;
      if (left.edgeId !== right.edgeId && properSegmentCrossing(left, right)) cableCrossings += 1;
    }
  }
  const minX = rectList.length ? Math.min(...rectList.map((rect) => rect.x)) : 0;
  const minY = rectList.length ? Math.min(...rectList.map((rect) => rect.y)) : 0;
  const maxX = rectList.length ? Math.max(...rectList.map((rect) => rect.x + rect.width)) : 0;
  const maxY = rectList.length ? Math.max(...rectList.map((rect) => rect.y + rect.height)) : 0;
  return { nodeCount: rectList.length, edgeCount: edges.length, totalLength: lengths.reduce((sum, value) => sum + value, 0), p95CableLength: percentile(sortedLengths, .95), medianDetour: percentile(sortedDetours, .5), p95Detour: percentile(sortedDetours, .95), turns, cableCrossings, nodeOverlaps, edgeNodeCrossings, nonOrthogonalSegments, bbox: { width: maxX - minX, height: maxY - minY }, elapsedMs };
}

function candidateAcceptable(metricsValue: TopologyLayoutMetrics, expectedNodeIds: ReadonlySet<string>, expectedEdgeIds: ReadonlySet<string>, nodes: ReadonlyMap<string, Rect>, edges: readonly LayoutBackendEdge[]): { acceptable: boolean; rejectionReasons: readonly string[] } {
  const reasons: string[] = [];
  if (metricsValue.nodeCount !== expectedNodeIds.size) reasons.push("NODE_ID_COUNT");
  if (metricsValue.edgeCount !== expectedEdgeIds.size) reasons.push("EDGE_ID_COUNT");
  if ([...nodes.keys()].some((id) => !expectedNodeIds.has(id))) reasons.push("UNKNOWN_NODE");
  if (edges.some((edge) => !expectedEdgeIds.has(edge.id))) reasons.push("UNKNOWN_EDGE");
  if (edges.some((edge) => edge.sections.length !== 1)) reasons.push("MULTI_SECTION_UNSUPPORTED");
  if (metricsValue.nodeOverlaps > 0) reasons.push("NODE_OVERLAP");
  if (metricsValue.edgeNodeCrossings > 0) reasons.push("EDGE_NODE_CROSSING");
  if (metricsValue.cableCrossings > 0) reasons.push("CABLE_CROSSING");
  if (metricsValue.nonOrthogonalSegments > 0) reasons.push("NON_ORTHOGONAL");
  if (edges.some((edge) => pointList(edge).some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)))) reasons.push("NONFINITE_ROUTE");
  return { acceptable: reasons.length === 0, rejectionReasons: reasons };
}

async function runCandidate(projection: CanvasProjection, profile: TopologyLayoutCandidate["id"], backend: LayoutBackend): Promise<CandidateRun> {
  const started = performance.now();
  const { graph, resourceIds, groupIds } = buildElkGraph(projection, profile);
  const raw = await backend.layout(graph);
  const allNodes = rectsFromBackend(raw.nodes);
  const nodes = new Map([...allNodes.entries()].filter(([id]) => resourceIds.has(id)));
  const groups = new Map([...allNodes.entries()].filter(([id]) => groupIds.has(id)));
  const edges = normalizeParallelElkSections(
    [...(raw.edges ?? [])].filter((edge) => !edge.id.startsWith("__layout__:")).sort((a, b) => a.id.localeCompare(b.id, "en")),
    nodes,
  );
  const metric = metrics(graph, nodes, edges, performance.now() - started);
  const expectedNodeIds = resourceIds; const expectedEdgeIds = new Set(graph.edges.filter((edge) => !edge.layoutOnly).map((edge) => edge.id));
  const hard = candidateAcceptable(metric, expectedNodeIds, expectedEdgeIds, nodes, edges);
  const options: Record<string, string> = {
    "elk.algorithm": "layered",
    "org.eclipse.elk.edgeRouting": "ORTHOGONAL",
    "org.eclipse.elk.layered.mergeEdges": "false",
    "org.eclipse.elk.hierarchyHandling": "INCLUDE_CHILDREN",
    ...(graph.layoutOptions ?? {}),
  };
  const candidate: TopologyLayoutCandidate = { id: profile, direction: options["elk.direction"] === "DOWN" ? "DOWN" : "RIGHT", options, acceptable: hard.acceptable, rejectionReasons: hard.rejectionReasons, metrics: metric, coordinateHash: hashString(JSON.stringify({ nodes: [...nodes.values()], edges: edges.map((edge) => ({ id: edge.id, p: pointList(edge) })) })) };
  return { candidate, nodes, groups, edges };
}

function chooseCandidate(runs: readonly CandidateRun[]): CandidateRun {
  const acceptable = runs.filter((run) => run.candidate.acceptable);
  const compact = (run: CandidateRun): boolean => Math.max(run.candidate.metrics.bbox.width, run.candidate.metrics.bbox.height) <= 2400;
  const pool = acceptable.length ? acceptable : runs;
  return [...pool].sort((left, right) => {
    const a = left.candidate.metrics; const b = right.candidate.metrics;
    return Number(right.candidate.acceptable) - Number(left.candidate.acceptable)
      || Number(compact(right)) - Number(compact(left))
      || a.cableCrossings - b.cableCrossings
      || a.p95Detour - b.p95Detour
      || a.totalLength - b.totalLength
      || (a.bbox.width * a.bbox.height) - (b.bbox.width * b.bbox.height)
      || a.elapsedMs - b.elapsedMs
      || left.candidate.id.localeCompare(right.candidate.id, "en");
  })[0]!;
}

function applyRun(view: HierarchicalTopologyView, run: CandidateRun, visualHandles: ReadonlyMap<string, readonly CanvasVisualAttachmentHandle[]>): CanvasProjection {
  const base = view.projection;
  const positions = run.nodes;
  const nodes = base.nodes.map((node) => {
    if (node.type === "zone") {
      const group = run.groups.get(node.id);
      return group ? { ...node, position: { x: group.x, y: group.y }, width: group.width, height: group.height } : node;
    }
    const position = positions.get(node.id);
    if (!position) return node;
    const parent = node.parentId ? run.groups.get(node.parentId) : undefined;
    const localPosition = parent ? { x: position.x - parent.x, y: position.y - parent.y } : { x: position.x, y: position.y };
    const attachments = visualHandles.get(node.id);
    const attachmentGeometry = attachments?.length
      ? attachments.map((attachment) => {
        const routed = run.edges.find((edge) => edge.id === attachment.connectionId);
        const route = routed ? pointList(routed) : [];
        // Match the live React Flow handle to the adjacent ELK section point,
        // not merely the raw port center.  This keeps parallel source links
        // on their own orthogonal lane without discarding ELK bends.
        const endpoint = route.length >= 2
          ? attachment.direction === "source" ? route[1] : route.at(-2)
          : route[0];
        const topPercent = endpoint ? Math.max(0, Math.min(100, ((endpoint.y - position.y) / Math.max(1, position.height)) * 100)) : undefined;
        return topPercent === undefined ? attachment : { ...attachment, topPercent };
      })
      : undefined;
    return { ...node, position: localPosition, width: position.width, height: position.height, ...(attachmentGeometry?.length ? { data: { ...node.data, visualAttachmentHandles: attachmentGeometry } } : {}) };
  });
  const edgesById = new Map(run.edges.map((edge) => [edge.id, edge] as const));
  const edges = base.edges.map((edge) => {
    const routed = edgesById.get(edge.id);
    if (!routed) return edge;
    const route = pointList(routed);
    const data = { ...edge.data, route, routeKind: "orthogonal" as const, routeOrigin: "elk" as const };
    const sourceHandle = edge.sourceHandle ?? `__visual_port__:${edge.id}:source`;
    const targetHandle = edge.targetHandle ?? `__visual_port__:${edge.id}:target`;
    return { ...edge, ...(sourceHandle ? { sourceHandle } : {}), ...(targetHandle ? { targetHandle } : {}), data };
  });
  return { ...base, nodes, edges, diagnostics: base.diagnostics };
}

export async function layoutHierarchicalTopologyView(
  view: HierarchicalTopologyView,
  request: TopologyLayoutRequest,
  backend: LayoutBackend = new ElkLayoutBackend(),
): Promise<TopologyLayoutResult> {
  const requestKey = createTopologyRequestKey(request);
  const projection = view.projection;
  const runs = await Promise.all([
    runCandidate(projection, "A-flat-right", backend),
    runCandidate(projection, "B-flat-down-high-degree", backend),
    runCandidate(projection, "C-role-aware-fanout", backend),
  ]);
  const winner = chooseCandidate(runs);
  const graphBuild = buildElkGraph(projection, winner.candidate.id);
  const totalTarget = FROZEN_BASELINE_TOTAL_LENGTH * 0.8;
  const p95Target = FROZEN_BASELINE_P95_DETOUR * 0.8;
  const totalImprovement = 1 - winner.candidate.metrics.totalLength / FROZEN_BASELINE_TOTAL_LENGTH;
  const p95Improvement = 1 - winner.candidate.metrics.p95Detour / FROZEN_BASELINE_P95_DETOUR;
  const totalTargetMet = winner.candidate.metrics.totalLength < totalTarget;
  const p95TargetMet = winner.candidate.metrics.p95Detour < p95Target;
  const quality: TopologyLayoutQuality = {
    winnerId: winner.candidate.id,
    candidates: runs.map((run) => run.candidate),
    deterministicHash: hashString(JSON.stringify(runs.map((run) => [run.candidate.id, run.candidate.coordinateHash]))),
    hardGate: winner.candidate.acceptable ? "PASS" : "FAIL",
    baselineComparison: { baselineTotalLength: FROZEN_BASELINE_TOTAL_LENGTH, baselineP95Detour: FROZEN_BASELINE_P95_DETOUR, totalTarget, p95Target, totalImprovement, p95Improvement, totalTargetMet, p95TargetMet, qualityGate: totalTargetMet && p95TargetMet ? "PASS" : "FAIL" },
  };
  const diagnostics = [
    ...(winner.candidate.acceptable ? [] : [{ severity: "error" as const, code: "TOPOLOGY_LAYOUT_QUALITY_GATE_FAIL", message: `No ELK candidate passed hard geometry gates: ${winner.candidate.rejectionReasons.join(", ") || "unknown"}.` }]),
    ...(!totalTargetMet || !p95TargetMet ? [{ severity: "error" as const, code: "TOPOLOGY_LAYOUT_QUALITY_BELOW_BASELINE", message: `ELK winner missed the frozen PROJECT-093 improvement target: total ${Math.round(totalImprovement * 100)}%, p95 detour ${Math.round(p95Improvement * 100)}%.` }] : []),
  ];
  const nextProjection = applyRun(view, winner, graphBuild.visualHandles);
  return { requestKey, engine: "elk.layered", projection: nextProjection, quality, diagnostics };
}
