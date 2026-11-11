import type { CanvasProjection, CanvasNode } from "./types.js";
import { computeOrthogonalRoutes } from "./topology-edge-routing.js";

const GRID_COLUMNS = 3;
const GRID_GAP_X = 96;
const GRID_GAP_Y = 84;
const GRID_PADDING = 72;

/**
 * The imported ELK document may place many independent declared zones in one
 * very tall column. For NORMAL TOPOLOGY, pack only root-level containers into
 * a stable grid and keep every child in its existing local coordinates. This
 * is a view projection: it does not rewrite LayoutDocument or Builder source.
 */
export function compactNormalTopologyProjection(projection: CanvasProjection): CanvasProjection {
  const rootItems = projection.nodes.filter((node) => !node.parentId);
  if (rootItems.length <= 1) return projection;
  const columns = Math.min(GRID_COLUMNS, Math.max(1, rootItems.length));
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights: number[] = [];
  rootItems.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, node.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, node.height);
  });
  const columnX: number[] = [];
  for (let column = 0; column < columns; column += 1) {
    columnX[column] = GRID_PADDING + columnWidths.slice(0, column).reduce((sum, width) => sum + width + GRID_GAP_X, 0);
  }
  const rowY: number[] = [];
  for (let row = 0; row < rowHeights.length; row += 1) {
    rowY[row] = GRID_PADDING + rowHeights.slice(0, row).reduce((sum, height) => sum + height + GRID_GAP_Y, 0);
  }
  const nextPositions = new Map<string, { x: number; y: number }>();
  rootItems.forEach((node, index) => {
    nextPositions.set(node.id, { x: columnX[index % columns] ?? GRID_PADDING, y: rowY[Math.floor(index / columns)] ?? GRID_PADDING });
  });
  const nodes = projection.nodes.map((node) => {
    const next = nextPositions.get(node.id);
    return next ? { ...node, position: next } : node;
  });
  const routes = computeOrthogonalRoutes(nodes, projection.edges);
  const edges = projection.edges.map((edge) => {
    const route = routes.get(edge.id);
    return route === undefined || route.length === 0
      ? edge
      : { ...edge, data: { ...edge.data, route, routeKind: "orthogonal" as const } };
  });
  return { ...projection, nodes, edges };
}
