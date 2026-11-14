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

function handleY(rect: Rect, node: CanvasNode, handleId: string | undefined): number {
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
  if (index < 0 || !interfaces.length) return rect.y + rect.height / 2;
  // Mirrors handlesFor(): handles occupy the central 60% of the card. The
  // calculation is deterministic and is only a routing hint; the renderer
  // re-anchors to the measured handle coordinates after React Flow mounts.
  return rect.y + rect.height * (0.2 + (index + 1) * 0.6 / (interfaces.length + 1));
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
  const sourceOffsetY = handleY(source, sourceNode, edge.sourceHandle);
  const targetOffsetY = handleY(target, targetNode, edge.targetHandle);
  const sourcePoint = { x: source.x + source.width, y: sourceOffsetY };
  const targetPoint = { x: target.x, y: targetOffsetY };
  const offset = parallelCount > 1 ? (parallelIndex - (parallelCount - 1) / 2) * PARALLEL_GAP : 0;
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
  const candidates: CanvasPosition[][] = [
    // Keep the parallel-lane offset orthogonal.  The previous two-point
    // candidate moved both coordinates at once, which produced a diagonal
    // first/last segment whenever a blocked route fell back to this option.
    [sourcePoint, { x: sourcePoint.x, y: parallelLaneY }, { x: targetPoint.x, y: parallelLaneY }, targetPoint],
    [sourcePoint, { x: middleX, y: sourcePoint.y }, { x: middleX, y: targetPoint.y }, targetPoint],
    [sourcePoint, { x: sourcePoint.x, y: laneYTop }, { x: targetPoint.x, y: laneYTop }, targetPoint],
    [sourcePoint, { x: sourcePoint.x, y: laneYBottom }, { x: targetPoint.x, y: laneYBottom }, targetPoint],
    [sourcePoint, { x: laneXLeft, y: sourcePoint.y }, { x: laneXLeft, y: targetPoint.y }, targetPoint],
    [sourcePoint, { x: laneXRight, y: sourcePoint.y }, { x: laneXRight, y: targetPoint.y }, targetPoint],
    [sourcePoint, { x: middleX, y: sourcePoint.y }, { x: middleX, y: middleY }, { x: targetPoint.x, y: middleY }, targetPoint],
  ];
  const valid = candidates.filter((candidate) => !pathIntersects(candidate, obstacleRects));
  if (!valid.length) {
    const blockedObstacleIds = [...new Set(candidates.flatMap((candidate) => pathObstacleIds(candidate, obstacleRects)))].sort((left, right) => left.localeCompare(right, "en"));
    return {
      blockedObstacleIds,
    };
  }
  const conflictCount = (path: readonly CanvasPosition[]): number => {
    const segments = path.slice(1).map((point, index) => ({ edgeId: edge.id, a: path[index]!, b: point }));
    return segments.reduce((total, segment) => total + existingSegments.filter((existing) => properCableCrossing(segment, existing)).length, 0);
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
    const sourcePoint = { x: source.x + source.width, y: handleY(source, sourceNode, edge.sourceHandle) };
    const targetPoint = { x: target.x, y: handleY(target, targetNode, edge.targetHandle) };
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
  for (let leftIndex = 0; leftIndex < routeSegments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < routeSegments.length; rightIndex += 1) {
      const left = routeSegments[leftIndex]!;
      const right = routeSegments[rightIndex]!;
      if (left.edgeId === right.edgeId) continue;
      if (properCableCrossing(left, right)) diagnostics.push({ severity: "warning", code: "TOPOLOGY_FINAL_CABLE_CROSSING", objectId: `${left.edgeId}:${right.edgeId}`, message: `Final NORMAL cables '${left.edgeId}' and '${right.edgeId}' cross; the existing raw ELK gate remains authoritative until a complete cable-level optimizer is approved.` });
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
