import type { CanvasEdge, CanvasNode, CanvasPosition } from "./types.js";

export interface CanvasRoutePoint extends CanvasPosition {}

interface Rect extends CanvasPosition {
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

function routeForEdge(
  edge: CanvasEdge,
  source: Rect,
  target: Rect,
  allRects: readonly Rect[],
  parallelIndex: number,
  parallelCount: number,
): readonly CanvasRoutePoint[] {
  const sourcePoint = { x: source.x + source.width, y: source.y + source.height / 2 };
  const targetPoint = { x: target.x, y: target.y + target.height / 2 };
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
  const candidates: CanvasPosition[][] = [
    [sourcePoint, { x: targetPoint.x, y: sourcePoint.y + offset }, targetPoint],
    [sourcePoint, { x: middleX, y: sourcePoint.y }, { x: middleX, y: targetPoint.y }, targetPoint],
    [sourcePoint, { x: sourcePoint.x, y: laneYTop }, { x: targetPoint.x, y: laneYTop }, targetPoint],
    [sourcePoint, { x: sourcePoint.x, y: laneYBottom }, { x: targetPoint.x, y: laneYBottom }, targetPoint],
    [sourcePoint, { x: laneXLeft, y: sourcePoint.y }, { x: laneXLeft, y: targetPoint.y }, targetPoint],
    [sourcePoint, { x: laneXRight, y: sourcePoint.y }, { x: laneXRight, y: targetPoint.y }, targetPoint],
    [sourcePoint, { x: middleX, y: sourcePoint.y }, { x: middleX, y: middleY }, { x: targetPoint.x, y: middleY }, targetPoint],
  ];
  const valid = candidates.filter((candidate) => !pathIntersects(candidate, obstacleRects));
  const selected = (valid.length ? valid : candidates).slice().sort((a, b) => pathLength(a) - pathLength(b))[0] ?? [sourcePoint, targetPoint];
  // Keep only bend points; React Flow supplies the live endpoint coordinates.
  return dedupe(selected.slice(1, -1));
}

export function computeOrthogonalRoutes(nodes: readonly CanvasNode[], edges: readonly CanvasEdge[]): ReadonlyMap<string, readonly CanvasRoutePoint[]> {
  const rects = absoluteRects(nodes);
  const groups = new Map<string, CanvasEdge[]>();
  for (const edge of edges) {
    if (edge.data.summaryOnly) continue;
    const pair = [edge.source, edge.target].sort((a, b) => a.localeCompare(b, "en")).join("\u0000");
    const list = groups.get(pair) ?? [];
    list.push(edge);
    groups.set(pair, list);
  }
  const routes = new Map<string, readonly CanvasRoutePoint[]>();
  for (const edge of edges) {
    const source = rects.get(edge.source);
    const target = rects.get(edge.target);
    if (!source || !target || edge.data.summaryOnly) continue;
    const pair = [edge.source, edge.target].sort((a, b) => a.localeCompare(b, "en")).join("\u0000");
    const siblings = groups.get(pair) ?? [edge];
    const index = siblings.findIndex((candidate) => candidate.id === edge.id);
    routes.set(edge.id, routeForEdge(edge, source, target, [...rects.values()], Math.max(0, index), siblings.length));
  }
  return routes;
}
