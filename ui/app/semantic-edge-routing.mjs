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

export function orthogonalEdgePath({ sourceX, sourceY, targetX, targetY, points = [] }) {
  const pathPoints = [{ x: sourceX, y: sourceY }, ...points, { x: targetX, y: targetY }]
    .filter((point, index, all) => index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
  const d = pathPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  let total = 0;
  for (let index = 1; index < pathPoints.length; index += 1) total += Math.abs(pathPoints[index].x - pathPoints[index - 1].x) + Math.abs(pathPoints[index].y - pathPoints[index - 1].y);
  let remaining = total / 2;
  let labelX = (sourceX + targetX) / 2;
  let labelY = (sourceY + targetY) / 2;
  for (let index = 1; index < pathPoints.length; index += 1) {
    const from = pathPoints[index - 1];
    const to = pathPoints[index];
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
