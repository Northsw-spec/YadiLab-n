export function resolveHierarchicalFallbackLaneX({ data, sourceX, targetX }) {
  const isHierarchical = data?.hierarchyVisual === true;
  const route = Array.isArray(data?.route) ? data.route : [];
  const middlePoint = route.length > 0
    ? route[Math.floor(route.length / 2)]
    : undefined;
  const fallbackX = (sourceX + targetX) / 2;
  const candidateX = Number(middlePoint?.x);
  const fallbackLaneX = isHierarchical && middlePoint && Number.isFinite(candidateX)
    ? candidateX
    : fallbackX;
  return { isHierarchical, route, fallbackLaneX };
}

function finitePoint(point) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function dedupe(points) {
  return points.filter((point, index, all) => index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
}

/**
 * Re-anchor layout-space bends to React Flow's live handle coordinates.
 * `route` contains deterministic bend points from the canvas router; the
 * first/last bend is aligned to the measured source/target handle axis and
 * any malformed diagonal is made Manhattan before rendering.
 */
export function anchorOrthogonalRoute({ sourceX, sourceY, targetX, targetY, route = [], routeOrigin = "legacy", sourcePosition, targetPosition }) {
  const source = finitePoint({ x: sourceX, y: sourceY });
  const target = finitePoint({ x: targetX, y: targetY });
  if (!source || !target) return [];
  const measured = route.map(finitePoint).filter(Boolean);
  if (!measured.length) return [source, { x: (source.x + target.x) / 2, y: source.y }, { x: (source.x + target.x) / 2, y: target.y }, target];
  const raw = routeOrigin === "elk" && measured.length >= 2
    ? [source, ...measured.slice(1, -1), target]
    : [source, ...measured, target];
  const verticalSource = sourcePosition === "top" || sourcePosition === "bottom";
  const verticalTarget = targetPosition === "top" || targetPosition === "bottom";
  if (raw.length > 2) {
    if (verticalSource) raw[1] = { x: source.x, y: raw[1].y };
    else raw[1] = { x: raw[1].x, y: source.y };
    const lastIndex = raw.length - 2;
    if (verticalTarget) raw[lastIndex] = { x: target.x, y: raw[lastIndex].y };
    else raw[lastIndex] = { x: raw[lastIndex].x, y: target.y };
  }
  const orthogonal = [];
  for (const point of raw) {
    const previous = orthogonal.at(-1);
    if (previous && previous.x !== point.x && previous.y !== point.y) {
      // Endpoint reconciliation is the only allowed post-ELK repair. A
      // malformed intermediate point is surfaced as a deterministic Manhattan
      // correction rather than silently selecting another router.
      orthogonal.push(verticalSource ? { x: previous.x, y: point.y } : { x: point.x, y: previous.y });
    }
    orthogonal.push(point);
  }
  return dedupe(orthogonal);
}

export function orthogonalEdgePath({ sourceX, sourceY, targetX, targetY, points = [], route = undefined, routeOrigin = "legacy", sourcePosition, targetPosition }) {
  const supplied = Array.isArray(route) ? route : points;
  const finalPoints = dedupe(anchorOrthogonalRoute({ sourceX, sourceY, targetX, targetY, route: supplied, routeOrigin, sourcePosition, targetPosition }));
  const pathPointsWithEndpoints = finalPoints[0]?.x === sourceX && finalPoints[0]?.y === sourceY
    ? finalPoints
    : [{ x: sourceX, y: sourceY }, ...finalPoints, { x: targetX, y: targetY }];
  const pathPointsNormalized = dedupe(pathPointsWithEndpoints);
  const d = pathPointsNormalized.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  let total = 0;
  for (let index = 1; index < pathPointsNormalized.length; index += 1) total += Math.abs(pathPointsNormalized[index].x - pathPointsNormalized[index - 1].x) + Math.abs(pathPointsNormalized[index].y - pathPointsNormalized[index - 1].y);
  let remaining = total / 2;
  let labelX = (sourceX + targetX) / 2;
  let labelY = (sourceY + targetY) / 2;
  for (let index = 1; index < pathPointsNormalized.length; index += 1) {
    const from = pathPointsNormalized[index - 1];
    const to = pathPointsNormalized[index];
    const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
    if (remaining <= length) {
      const ratio = length ? remaining / length : 0;
      labelX = from.x + (to.x - from.x) * ratio;
      labelY = from.y + (to.y - from.y) * ratio;
      break;
    }
    remaining -= length;
  }
  return [d, labelX, labelY];
}
