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
export function anchorOrthogonalRoute({ sourceX, sourceY, targetX, targetY, route = [] }) {
  const source = finitePoint({ x: sourceX, y: sourceY });
  const target = finitePoint({ x: targetX, y: targetY });
  if (!source || !target) return [];
  const bends = route.map(finitePoint).filter(Boolean);
  if (!bends.length) return [
    { x: source.x, y: source.y },
    { x: (source.x + target.x) / 2, y: source.y },
    { x: (source.x + target.x) / 2, y: target.y },
    { x: target.x, y: target.y },
  ];
  // React Flow's topology handles are right/left in the canonical projection;
  // preserve a vertical first/last leg when the router explicitly requested
  // one, otherwise align the horizontal leg to the live handle y.
  const adjusted = bends.map((point) => ({ ...point }));
  const first = adjusted[0];
  if (first && first.x !== source.x && first.y !== source.y) first.y = source.y;
  const last = adjusted.at(-1);
  if (last && last.x !== target.x && last.y !== target.y) last.y = target.y;
  const raw = [source, ...adjusted, target];
  const orthogonal = [];
  for (const point of raw) {
    const previous = orthogonal.at(-1);
    if (previous && previous.x !== point.x && previous.y !== point.y) {
      // Prefer a horizontal first leg. This matches right/left handles and is
      // deterministic for a route that was measured before React Flow mounted.
      orthogonal.push({ x: point.x, y: previous.y });
    }
    orthogonal.push(point);
  }
  return dedupe(orthogonal);
}

export function orthogonalEdgePath({ sourceX, sourceY, targetX, targetY, points = [], route = undefined }) {
  const supplied = Array.isArray(route) ? route : points;
  const pathPoints = (Array.isArray(route)
    ? route.map(finitePoint).filter(Boolean)
    : anchorOrthogonalRoute({ sourceX, sourceY, targetX, targetY, route: supplied }))
    .filter(Boolean);
  const anchored = Array.isArray(route) && pathPoints.length
    ? anchorOrthogonalRoute({ sourceX, sourceY, targetX, targetY, route: pathPoints.slice(1, -1) })
    : pathPoints;
  const finalPoints = dedupe(anchored.length ? anchored : anchorOrthogonalRoute({ sourceX, sourceY, targetX, targetY, route: [] }));
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
