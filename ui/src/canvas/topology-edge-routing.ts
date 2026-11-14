import type { CanvasEdge, CanvasNode, CanvasPosition, CanvasProjection, CanvasProjectionDiagnostic } from "./types.js";

export interface CanvasRoutePoint extends CanvasPosition {}

interface Rect extends CanvasPosition {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly kind: CanvasNode["type"];
}

const ROUTE_MARGIN = 28;
const PARALLEL_GAP = 14;
const PORT_SPAN_RATIO = 0.6;
/** Presentation-only minimum between measured interface-handle centers. */
export const NORMAL_MIN_PORT_SEPARATION_PX = 10;

function absoluteRects(nodes: readonly CanvasNode[]): ReadonlyMap<string, Rect> {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const cache = new Map<string, Rect>();
  const resolve = (id: string, visiting = new Set<string>()): Rect | undefined => {
    const cached = cache.get(id);
    if (cached) return cached;
    const node = byId.get(id);
    if (!node || visiting.has(id)) return undefined;
    const parent = node.parentId ? resolve(node.parentId, new Set([...visiting, id])) : undefined;
    const rect = {
      id: node.id,
      x: (parent?.x ?? 0) + node.position.x,
      y: (parent?.y ?? 0) + node.position.y,
      width: node.width,
      height: node.height,
      kind: node.type,
    };
    cache.set(id, rect);
    return rect;
  };
  for (const node of nodes) resolve(node.id);
  return cache;
}

function intersects(rect: Rect, a: CanvasPosition, b: CanvasPosition): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  if (a.x === b.x) {
    return a.x > rect.x && a.x < rect.x + rect.width && maxY > rect.y && minY < rect.y + rect.height;
  }
  if (a.y === b.y) {
    return a.y > rect.y && a.y < rect.y + rect.height && maxX > rect.x && minX < rect.x + rect.width;
  }
  // A route is expected to be orthogonal. Treat a diagonal candidate as
  // hostile so a future caller cannot silently reintroduce a crossing path.
  return true;
}

function pathIntersects(path: readonly CanvasPosition[], obstacles: readonly Rect[]): boolean {
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1]!;
    const current = path[index]!;
    if (obstacles.some((obstacle) => intersects(obstacle, previous, current))) return true;
  }
  return false;
}

function pathObstacleIds(path: readonly CanvasPosition[], obstacles: readonly Rect[]): readonly string[] {
  const ids = new Set<string>();
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1]!;
    const current = path[index]!;
    for (const obstacle of obstacles) {
      if (intersects(obstacle, previous, current)) ids.add(obstacle.id);
    }
  }
  return [...ids].sort((left, right) => left.localeCompare(right, "en"));
}

function pathHasBacktracking(path: readonly CanvasPosition[]): boolean {
  for (let index = 2; index < path.length; index += 1) {
    const previous = path[index - 2]!;
    const middle = path[index - 1]!;
    const current = path[index]!;
    const horizontal = previous.y === middle.y && middle.y === current.y;
    const vertical = previous.x === middle.x && middle.x === current.x;
    if (horizontal || vertical) {
      const first = horizontal ? middle.x - previous.x : middle.y - previous.y;
      const second = horizontal ? current.x - middle.x : current.y - middle.y;
      if (first !== 0 && second !== 0 && Math.sign(first) !== Math.sign(second)) return true;
    }
  }
  return false;
}

function pathLength(path: readonly CanvasPosition[]): number {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1]!;
    const current = path[index]!;
    total += Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
  }
  return total;
}

function dedupe(points: readonly CanvasPosition[]): CanvasRoutePoint[] {
  return points.filter((point, index) => index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y)
    .map((point) => ({ x: point.x, y: point.y }));
}

type RouteSide = "NORTH" | "SOUTH" | "EAST" | "WEST";

interface HandlePoint extends CanvasPosition {
  readonly side: RouteSide;
}

function handlePoint(rect: Rect, node: CanvasNode, handleId: string | undefined, role: "source" | "target"): HandlePoint {
  const interfaces = node.data.semanticKind === "resource" ? node.data.interfaces : [];
  // `out:` is four characters while `in:` is three.  Treating both prefixes
  // as four characters silently mapped every target handle to the card centre
  // and could turn an otherwise orthogonal route into a diagonal segment.
  const interfaceId = handleId?.startsWith("out:")
    ? handleId.slice(4)
    : handleId?.startsWith("in:")
      ? handleId.slice(3)
      : undefined;
  const index = interfaceId === undefined ? -1 : interfaces.findIndex((iface) => iface.interfaceId === interfaceId);
  const source = role === "source";
  const iface = index >= 0 ? interfaces[index] : undefined;
  const fallbackSide: RouteSide = source ? "EAST" : "WEST";
  const side = iface ? (source ? iface.sourceSide : iface.targetSide) ?? fallbackSide : fallbackSide;
  const onSide = interfaces.filter((candidate) => (source ? candidate.sourceSide : candidate.targetSide) === side || (!(source ? candidate.sourceSide : candidate.targetSide) && side === fallbackSide));
  const sideIndex = iface ? Math.max(0, onSide.findIndex((candidate) => candidate.interfaceId === iface.interfaceId)) : -1;
  const count = Math.max(1, onSide.length);
  const percent = sideIndex < 0 ? 0.5 : 0.2 + (sideIndex + 1) * PORT_SPAN_RATIO / (count + 1);
  if (side === "NORTH" || side === "SOUTH") {
    return { x: rect.x + rect.width * percent, y: side === "NORTH" ? rect.y : rect.y + rect.height, side };
  }
  return { x: side === "WEST" ? rect.x : rect.x + rect.width, y: rect.y + rect.height * percent, side };
}

function outward(point: HandlePoint, distance: number): CanvasPosition {
  if (point.side === "NORTH") return { x: point.x, y: point.y - distance };
  if (point.side === "SOUTH") return { x: point.x, y: point.y + distance };
  if (point.side === "WEST") return { x: point.x - distance, y: point.y };
  return { x: point.x + distance, y: point.y };
}

interface RouteForEdgeResult {
  readonly route?: readonly CanvasRoutePoint[];
  readonly fullPath?: readonly CanvasPosition[];
  readonly blockedObstacleIds: readonly string[];
}

export interface OrthogonalRouteFailure {
  readonly edgeId: string;
  readonly code: "TOPOLOGY_ROUTE_UNSAFE" | "TOPOLOGY_ROUTE_ENDPOINT_MISSING";
  readonly obstacleIds: readonly string[];
  readonly message: string;
}

export interface OrthogonalRouteResult {
  readonly routes: ReadonlyMap<string, readonly CanvasRoutePoint[]>;
  readonly failures: readonly OrthogonalRouteFailure[];
}

function routeForEdge(
  edge: CanvasEdge,
  source: Rect,
  target: Rect,
  sourceNode: CanvasNode,
  targetNode: CanvasNode,
  allRects: readonly Rect[],
  parallelIndex: number,
  parallelCount: number,
  existingSegments: readonly RouteSegment[],
): RouteForEdgeResult {
  const sourcePoint = handlePoint(source, sourceNode, edge.sourceHandle, "source");
  const targetPoint = handlePoint(target, targetNode, edge.targetHandle, "target");
  const offset = parallelCount > 1 ? (parallelIndex - (parallelCount - 1) / 2) * PARALLEL_GAP : 0;
  const sourceExit = outward(sourcePoint, ROUTE_MARGIN);
  const targetEntry = outward(targetPoint, ROUTE_MARGIN);
  // Zones are visual containers, not physical resources. Treating their
  // enclosing rectangles as obstacles would make every valid inter-zone
  // route appear blocked and force a straight fallback through resources.
  const obstacleRects = allRects.filter((rect) => rect !== source && rect !== target && rect.kind === "resource");
  const minX = Math.min(source.x, target.x);
  const maxX = Math.max(source.x + source.width, target.x + target.width);
  const minY = Math.min(source.y, target.y);
  const maxY = Math.max(source.y + source.height, target.y + target.height);
  const laneYTop = minY - ROUTE_MARGIN - Math.abs(offset);
  const laneYBottom = maxY + ROUTE_MARGIN + Math.abs(offset);
  const laneXLeft = minX - ROUTE_MARGIN - Math.abs(offset);
  const laneXRight = maxX + ROUTE_MARGIN + Math.abs(offset);
  const middleX = (sourcePoint.x + targetPoint.x) / 2 + offset;
  const middleY = (sourcePoint.y + targetPoint.y) / 2 + offset;
  const parallelLaneY = sourcePoint.y + offset;
  const parallelLaneX = sourcePoint.x + offset;
  const candidates: CanvasPosition[][] = [
    [sourcePoint, { x: sourcePoint.x, y: parallelLaneY }, { x: targetPoint.x, y: parallelLaneY }, targetPoint],
    [sourcePoint, { x: parallelLaneX, y: sourcePoint.y }, { x: parallelLaneX, y: targetPoint.y }, targetPoint],
    [sourcePoint, { x: targetPoint.x, y: sourcePoint.y }, targetPoint],
    [sourcePoint, { x: sourcePoint.x, y: targetPoint.y }, targetPoint],
    // A handle can face a neighbouring resource even when the safe lane is
    // on the opposite side of the card. Leave along the card boundary first
    // so the candidate does not cross that neighbour merely to reach the
    // bounded top/bottom or left/right lane.
    [sourcePoint, { x: sourcePoint.x, y: laneYTop }, { x: targetPoint.x, y: laneYTop }, targetPoint],
    [sourcePoint, { x: sourcePoint.x, y: laneYBottom }, { x: targetPoint.x, y: laneYBottom }, targetPoint],
    [sourcePoint, { x: laneXLeft, y: sourcePoint.y }, { x: laneXLeft, y: targetPoint.y }, targetPoint],
    [sourcePoint, { x: laneXRight, y: sourcePoint.y }, { x: laneXRight, y: targetPoint.y }, targetPoint],
    [sourcePoint, sourceExit, { x: targetEntry.x, y: sourceExit.y }, targetEntry, targetPoint],
    [sourcePoint, sourceExit, { x: middleX, y: sourceExit.y }, { x: middleX, y: targetEntry.y }, targetEntry, targetPoint],
    [sourcePoint, sourceExit, { x: sourceExit.x, y: laneYTop }, { x: targetEntry.x, y: laneYTop }, targetEntry, targetPoint],
    [sourcePoint, sourceExit, { x: sourceExit.x, y: laneYBottom }, { x: targetEntry.x, y: laneYBottom }, targetEntry, targetPoint],
    [sourcePoint, sourceExit, { x: laneXLeft, y: sourceExit.y }, { x: laneXLeft, y: targetEntry.y }, targetEntry, targetPoint],
    [sourcePoint, sourceExit, { x: laneXRight, y: sourceExit.y }, { x: laneXRight, y: targetEntry.y }, targetEntry, targetPoint],
    [sourcePoint, sourceExit, { x: middleX, y: sourceExit.y }, { x: middleX, y: middleY }, { x: targetEntry.x, y: middleY }, targetEntry, targetPoint],
    [sourcePoint, sourceExit, { x: sourceExit.x, y: parallelLaneY }, { x: targetEntry.x, y: parallelLaneY }, targetEntry, targetPoint],
  ];
  const valid = candidates.filter((candidate) => !pathHasBacktracking(candidate) && !pathIntersects(candidate, obstacleRects));
  if (!valid.length) {
    const blockedObstacleIds = [...new Set(candidates.flatMap((candidate) => pathObstacleIds(candidate, obstacleRects)))].sort((left, right) => left.localeCompare(right, "en"));
    return {
      blockedObstacleIds,
    };
  }
  const conflictCount = (path: readonly CanvasPosition[]): number => {
    const segments = path.slice(1).map((point, index) => ({ edgeId: edge.id, a: path[index]!, b: point }));
    return segments.reduce((total, segment) => total + existingSegments.filter((existing) => cableConflict(segment, existing)).length, 0);
  };
  const selected = valid.slice().sort((a, b) => conflictCount(a) - conflictCount(b) || pathLength(a) - pathLength(b))[0] ?? [sourcePoint, targetPoint];
  // Keep only bend points; React Flow supplies the live endpoint coordinates.
  return {
    route: dedupe(selected.slice(1, -1)),
    fullPath: selected,
    blockedObstacleIds: [],
  };
}

export function computeOrthogonalRoutesChecked(nodes: readonly CanvasNode[], edges: readonly CanvasEdge[]): OrthogonalRouteResult {
  const rects = absoluteRects(nodes);
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const groups = new Map<string, CanvasEdge[]>();
  for (const edge of edges) {
    if (edge.data.summaryOnly) continue;
    const pair = [edge.source, edge.target].sort((a, b) => a.localeCompare(b, "en")).join("\u0000");
    const list = groups.get(pair) ?? [];
    list.push(edge);
    groups.set(pair, list);
  }
  const routes = new Map<string, readonly CanvasRoutePoint[]>();
  const failures: OrthogonalRouteFailure[] = [];
  const routedSegments: RouteSegment[] = [];
  for (const edge of edges) {
    const source = rects.get(edge.source);
    const target = rects.get(edge.target);
    if (edge.data.summaryOnly) continue;
    if (!source || !target) {
      failures.push({
        edgeId: edge.id,
        code: "TOPOLOGY_ROUTE_ENDPOINT_MISSING",
        obstacleIds: [],
        message: `Connection '${edge.id}' has no resolved source/target canvas rectangle for routing.`,
      });
      continue;
    }
    const pair = [edge.source, edge.target].sort((a, b) => a.localeCompare(b, "en")).join("\u0000");
    const siblings = groups.get(pair) ?? [edge];
    const index = siblings.findIndex((candidate) => candidate.id === edge.id);
    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);
    if (!sourceNode || !targetNode) {
      failures.push({
        edgeId: edge.id,
        code: "TOPOLOGY_ROUTE_ENDPOINT_MISSING",
        obstacleIds: [],
        message: `Connection '${edge.id}' has no resolved source/target canvas node for routing.`,
      });
      continue;
    }
    const result = routeForEdge(edge, source, target, sourceNode, targetNode, [...rects.values()], Math.max(0, index), siblings.length, routedSegments);
    if (result.route !== undefined) {
      routes.set(edge.id, result.route);
      if (result.fullPath) {
        for (let segmentIndex = 1; segmentIndex < result.fullPath.length; segmentIndex += 1) routedSegments.push({ edgeId: edge.id, a: result.fullPath[segmentIndex - 1]!, b: result.fullPath[segmentIndex]! });
      }
      continue;
    }
    failures.push({
      edgeId: edge.id,
      code: "TOPOLOGY_ROUTE_UNSAFE",
      obstacleIds: result.blockedObstacleIds,
      message: result.blockedObstacleIds.length
        ? `Connection '${edge.id}' has no safe orthogonal route within the bounded candidate set; blocked resources: ${result.blockedObstacleIds.join(", ")}.`
        : `Connection '${edge.id}' has no safe orthogonal route within the bounded candidate set.`,
    });
  }
  return { routes, failures };
}

export function computeOrthogonalRoutes(nodes: readonly CanvasNode[], edges: readonly CanvasEdge[]): ReadonlyMap<string, readonly CanvasRoutePoint[]> {
  return computeOrthogonalRoutesChecked(nodes, edges).routes;
}

export interface OrthogonalProjectionValidation {
  readonly safe: boolean;
  readonly diagnostics: readonly CanvasProjectionDiagnostic[];
  readonly foreignResourceCrossings: number;
}

function finite(value: number): boolean { return Number.isFinite(value); }

function strictRectOverlap(left: Rect, right: Rect): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
}

interface RouteSegment {
  readonly edgeId: string;
  readonly a: CanvasPosition;
  readonly b: CanvasPosition;
}

function properCableCrossing(left: RouteSegment, right: RouteSegment): boolean {
  const leftHorizontal = left.a.y === left.b.y;
  const rightHorizontal = right.a.y === right.b.y;
  if (leftHorizontal === rightHorizontal) return false;
  const horizontal = leftHorizontal ? left : right;
  const vertical = leftHorizontal ? right : left;
  const x = vertical.a.x;
  const y = horizontal.a.y;
  return x > Math.min(horizontal.a.x, horizontal.b.x)
    && x < Math.max(horizontal.a.x, horizontal.b.x)
    && y > Math.min(vertical.a.y, vertical.b.y)
    && y < Math.max(vertical.a.y, vertical.b.y);
}

function collinearCableOverlap(left: RouteSegment, right: RouteSegment): boolean {
  const leftHorizontal = left.a.y === left.b.y;
  const rightHorizontal = right.a.y === right.b.y;
  if (leftHorizontal !== rightHorizontal) return false;
  if (leftHorizontal) {
    if (left.a.y !== right.a.y) return false;
    const overlap = Math.min(Math.max(left.a.x, left.b.x), Math.max(right.a.x, right.b.x))
      - Math.max(Math.min(left.a.x, left.b.x), Math.min(right.a.x, right.b.x));
    return overlap > 1;
  }
  if (left.a.x !== right.a.x) return false;
  const overlap = Math.min(Math.max(left.a.y, left.b.y), Math.max(right.a.y, right.b.y))
    - Math.max(Math.min(left.a.y, left.b.y), Math.min(right.a.y, right.b.y));
  return overlap > 1;
}

function cableConflict(left: RouteSegment, right: RouteSegment): boolean {
  return properCableCrossing(left, right) || collinearCableOverlap(left, right);
}


function setDifference(actual: readonly string[], expected: readonly string[]): readonly string[] {
  const expectedSet = new Set(expected);
  return actual.filter((id) => !expectedSet.has(id)).sort((left, right) => left.localeCompare(right, "en"));
}

/**
 * Strict validation of the geometry that NORMAL actually presents after its
 * deterministic compaction.  The raw ELK visual gate remains independent;
 * this check is a complementary fail-closed guard for the final projection.
 */
export function validateOrthogonalProjection(
  projection: CanvasProjection,
  expected: CanvasProjection = projection,
  routeResult: OrthogonalRouteResult = computeOrthogonalRoutesChecked(projection.nodes, projection.edges),
): OrthogonalProjectionValidation {
  const diagnostics: CanvasProjectionDiagnostic[] = [];
  const rects = absoluteRects(projection.nodes);
  const expectedNodeIds = expected.nodes.map((node) => node.id);
  const expectedEdgeIds = expected.edges.map((edge) => edge.id);
  const nodeIds = projection.nodes.map((node) => node.id);
  const edgeIds = projection.edges.map((edge) => edge.id);
  const duplicate = (ids: readonly string[], code: string, label: string): void => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) diagnostics.push({ severity: "error", code, objectId: id, message: `Duplicate ${label} ID '${id}' in final NORMAL projection.` });
      seen.add(id);
    }
  };
  duplicate(nodeIds, "TOPOLOGY_FINAL_DUPLICATE_NODE_ID", "node");
  duplicate(edgeIds, "TOPOLOGY_FINAL_DUPLICATE_EDGE_ID", "edge");
  const missingNodes = setDifference(expectedNodeIds, nodeIds);
  const extraNodes = setDifference(nodeIds, expectedNodeIds);
  if (missingNodes.length || extraNodes.length) diagnostics.push({ severity: "error", code: "TOPOLOGY_FINAL_NODE_ID_SET_MISMATCH", message: `Final NORMAL node IDs differ from canonical projection (missing: ${missingNodes.join(", ") || "none"}; extra: ${extraNodes.join(", ") || "none"}).` });
  const missingEdges = setDifference(expectedEdgeIds, edgeIds);
  const extraEdges = setDifference(edgeIds, expectedEdgeIds);
  if (missingEdges.length || extraEdges.length) diagnostics.push({ severity: "error", code: "TOPOLOGY_FINAL_EDGE_ID_SET_MISMATCH", message: `Final NORMAL edge IDs differ from canonical projection (missing: ${missingEdges.join(", ") || "none"}; extra: ${extraEdges.join(", ") || "none"}).` });

  for (const node of projection.nodes) {
    const rect = rects.get(node.id);
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(finite) || rect.width <= 0 || rect.height <= 0) {
      diagnostics.push({ severity: "error", code: "TOPOLOGY_FINAL_NONFINITE_NODE_GEOMETRY", objectId: node.id, message: `Final NORMAL node '${node.id}' has invalid coordinates or dimensions.` });
      continue;
    }
    if (node.parentId) {
      const parent = rects.get(node.parentId);
      if (!parent || rect.x < parent.x || rect.y < parent.y || rect.x + rect.width > parent.x + parent.width || rect.y + rect.height > parent.y + parent.height) {
        diagnostics.push({ severity: "error", code: "TOPOLOGY_FINAL_NODE_OUTSIDE_PARENT", objectId: node.id, message: `Final NORMAL node '${node.id}' lies outside its declared parent zone.` });
      }
    }
  }
  const resources = projection.nodes.filter((node) => node.type === "resource").map((node) => rects.get(node.id)).filter((rect): rect is Rect => Boolean(rect));
  for (const node of projection.nodes.filter((candidate) => candidate.type === "resource")) {
    const rect = rects.get(node.id);
    if (!rect || node.data.semanticKind !== "resource" || node.data.interfaces.length < 2) continue;
    for (const [role, fallback] of [["source", "EAST"], ["target", "WEST"]] as const) {
      const groups = new Map<string, number>();
      for (const iface of node.data.interfaces) {
        const side = (role === "source" ? iface.sourceSide : iface.targetSide) ?? fallback;
        groups.set(side, (groups.get(side) ?? 0) + 1);
      }
      for (const [side, count] of groups) {
        if (count < 2) continue;
        const span = side === "NORTH" || side === "SOUTH" ? rect.width : rect.height;
        const separation = span * PORT_SPAN_RATIO / (count + 1);
        if (separation + 1e-6 < NORMAL_MIN_PORT_SEPARATION_PX) {
          diagnostics.push({
            severity: "error",
            code: "TOPOLOGY_FINAL_PORT_SEPARATION_UNSAFE",
            objectId: node.id,
            message: `Resource '${node.id}' ${role} side ${side} has ${separation.toFixed(2)}px between adjacent declared interface handles; at least ${NORMAL_MIN_PORT_SEPARATION_PX}px is required.`,
          });
        }
      }
    }
  }
  for (let leftIndex = 0; leftIndex < resources.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < resources.length; rightIndex += 1) {
      if (strictRectOverlap(resources[leftIndex]!, resources[rightIndex]!)) diagnostics.push({ severity: "error", code: "TOPOLOGY_FINAL_RESOURCE_OVERLAP", objectId: resources[rightIndex]!.id, message: `Final NORMAL resources '${resources[leftIndex]!.id}' and '${resources[rightIndex]!.id}' overlap.` });
    }
  }
  const zones = projection.nodes.filter((node) => node.type === "zone");
  for (const zone of zones) {
    const zoneRect = rects.get(zone.id);
    if (!zoneRect) continue;
    const header = { ...zoneRect, height: ZONE_HEADER_HEIGHT };
    for (const resource of resources) {
      if (resource.id === zone.id) continue;
      let ancestor = projection.nodes.find((candidate) => candidate.id === resource.id)?.parentId;
      while (ancestor) {
        if (ancestor === zone.id && strictRectOverlap(resource, header)) diagnostics.push({ severity: "error", code: "TOPOLOGY_FINAL_ZONE_HEADER_OVERLAP", objectId: resource.id, message: `Resource '${resource.id}' overlaps reserved header space of zone '${zone.id}'.` });
        ancestor = projection.nodes.find((candidate) => candidate.id === ancestor)?.parentId;
      }
    }
  }

  for (const failure of routeResult.failures) diagnostics.push({ severity: "error", code: failure.code, objectId: failure.edgeId, message: failure.message });
  const nodeById = new Map(projection.nodes.map((node) => [node.id, node] as const));
  let foreignResourceCrossings = 0;
  const routeSegments: RouteSegment[] = [];
  const densePresentation = projection.nodes.some((node) => node.type === "resource" && node.data.semanticKind === "resource" && node.data.interfaces.some((iface) => iface.sourceSide !== undefined || iface.targetSide !== undefined));
  for (const edge of projection.edges) {
    if (edge.data.summaryOnly) continue;
    const source = rects.get(edge.source);
    const target = rects.get(edge.target);
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!source || !target || !sourceNode || !targetNode) continue;
    for (const [handle, node, direction] of [[edge.sourceHandle, sourceNode, "source"], [edge.targetHandle, targetNode, "target"]] as const) {
      if (handle === undefined) continue;
      const prefix = direction === "source" ? "out:" : "in:";
      const interfaces = node.data.semanticKind === "resource" ? node.data.interfaces : [];
      const validHandle = handle.startsWith(prefix) && node.data.semanticKind === "resource" && interfaces.some((iface) => iface.interfaceId === handle.slice(prefix.length));
      if (!validHandle) diagnostics.push({ severity: "error", code: "TOPOLOGY_FINAL_ENDPOINT_PORT_INVALID", objectId: edge.id, message: `Connection '${edge.id}' has an invalid ${direction} port handle '${handle}'.` });
    }
    const route = routeResult.routes.get(edge.id);
    if (!route) continue;
    const sourcePoint = handlePoint(source, sourceNode, edge.sourceHandle, "source");
    const targetPoint = handlePoint(target, targetNode, edge.targetHandle, "target");
    const points = [sourcePoint, ...route, targetPoint];
    if (points.some((point) => !finite(point.x) || !finite(point.y))) {
      diagnostics.push({ severity: "error", code: "TOPOLOGY_FINAL_NONFINITE_ROUTE", objectId: edge.id, message: `Connection '${edge.id}' has a non-finite final route.` });
      continue;
    }
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1]!;
      const current = points[index]!;
      routeSegments.push({ edgeId: edge.id, a: previous, b: current });
      if (previous.x !== current.x && previous.y !== current.y) diagnostics.push({ severity: "error", code: "TOPOLOGY_FINAL_NON_ORTHOGONAL_ROUTE", objectId: edge.id, message: `Connection '${edge.id}' has a diagonal final route segment.` });
    }
    const obstacles = resources.filter((rect) => rect.id !== edge.source && rect.id !== edge.target);
    const blocked = pathObstacleIds(points, obstacles);
    if (blocked.length) {
      foreignResourceCrossings += blocked.length;
      diagnostics.push({ severity: "error", code: "TOPOLOGY_FINAL_FOREIGN_RESOURCE_CROSSING", objectId: edge.id, message: `Connection '${edge.id}' crosses foreign resources: ${blocked.join(", ")}.` });
    }
  }
  const reportedCableConflicts = new Set<string>();
  for (let leftIndex = 0; leftIndex < routeSegments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < routeSegments.length; rightIndex += 1) {
      const left = routeSegments[leftIndex]!;
      const right = routeSegments[rightIndex]!;
      if (left.edgeId === right.edgeId) continue;
      const pairId = [left.edgeId, right.edgeId].sort((a, b) => a.localeCompare(b, "en")).join(":");
      if (reportedCableConflicts.has(pairId)) continue;
      if (properCableCrossing(left, right)) {
        reportedCableConflicts.add(pairId);
        diagnostics.push({ severity: densePresentation ? "error" : "warning", code: "TOPOLOGY_FINAL_CABLE_CROSSING", objectId: pairId, message: `Final NORMAL cables '${left.edgeId}' and '${right.edgeId}' cross.` });
      } else if (collinearCableOverlap(left, right)) {
        reportedCableConflicts.add(pairId);
        diagnostics.push({ severity: densePresentation ? "error" : "warning", code: "TOPOLOGY_FINAL_CABLE_OVERLAP", objectId: pairId, message: `Final NORMAL cables '${left.edgeId}' and '${right.edgeId}' overlap for more than one pixel.` });
      }
    }
  }
  const routedEdgeIds = new Set(routeResult.routes.keys());
  const failedEdgeIds = new Set(routeResult.failures.map((failure) => failure.edgeId));
  for (const edge of projection.edges) {
    if (!edge.data.summaryOnly && !routedEdgeIds.has(edge.id) && !failedEdgeIds.has(edge.id)) diagnostics.push({ severity: "error", code: "TOPOLOGY_FINAL_ROUTE_MISSING", objectId: edge.id, message: `Connection '${edge.id}' has no verified route in the final NORMAL projection.` });
  }
  return { safe: !diagnostics.some((diagnostic) => diagnostic.severity === "error"), diagnostics, foreignResourceCrossings };
}

const ZONE_HEADER_HEIGHT = 72;
