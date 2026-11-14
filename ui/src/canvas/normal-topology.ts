import type { CanvasProjection, CanvasNode } from "./types.js";
import { computeOrthogonalRoutesChecked, validateOrthogonalProjection } from "./topology-edge-routing.js";

const GRID_COLUMNS = 5;
const GRID_GAP_X = 56;
const GRID_GAP_Y = 60;
const GRID_PADDING = 72;
const ZONE_HEADER = 72;
const RESOURCE_WIDTH = 180;
const RESOURCE_HEIGHT = 96;
const RESOURCE_GAP = 28;
const ZONE_PADDING = 32;

/**
 * The imported ELK document may place many independent declared zones in one
 * very tall column. For NORMAL TOPOLOGY, pack only root-level containers into
 * a stable grid and keep every child in its existing local coordinates. This
 * is a view projection: it does not rewrite LayoutDocument or Builder source.
 */
export function compactNormalTopologyProjection(projection: CanvasProjection): CanvasProjection {
  const directChildren = new Map<string, CanvasNode[]>();
  for (const node of projection.nodes) {
    if (node.parentId && node.type === "resource") {
      const children = directChildren.get(node.parentId) ?? [];
      children.push(node);
      directChildren.set(node.parentId, children);
    }
  }
  const reflowed = projection.nodes.map((node) => {
    if (node.type !== "zone") return node;
    const children = directChildren.get(node.id) ?? [];
    if (!children.length) return node;
    const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(children.length))));
    const rows = Math.ceil(children.length / columns);
    const width = Math.max(node.width, ZONE_PADDING * 2 + columns * RESOURCE_WIDTH + (columns - 1) * RESOURCE_GAP);
    const height = ZONE_HEADER + ZONE_PADDING + rows * RESOURCE_HEIGHT + (rows - 1) * RESOURCE_GAP + ZONE_PADDING;
    return { ...node, width, height };
  });
  const reflowedByParent = new Map<string, CanvasNode[]>(directChildren);
  const reflowedChildren = reflowed.map((node) => {
    if (!node.parentId || node.type !== "resource") return node;
    const siblings = reflowedByParent.get(node.parentId) ?? [];
    const index = siblings.findIndex((sibling) => sibling.id === node.id);
    if (index < 0) return node;
    const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(siblings.length))));
    return {
      ...node,
      position: {
        x: ZONE_PADDING + (index % columns) * (RESOURCE_WIDTH + RESOURCE_GAP),
        y: ZONE_HEADER + ZONE_PADDING + Math.floor(index / columns) * (RESOURCE_HEIGHT + RESOURCE_GAP),
      },
    };
  });
  const rootItems = reflowedChildren.filter((node) => !node.parentId);
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
  const nodes = reflowedChildren.map((node) => {
    const next = nextPositions.get(node.id);
    return next ? { ...node, position: next } : node;
  });
  const routeResult = computeOrthogonalRoutesChecked(nodes, projection.edges);
  const routes = routeResult.routes;
  const edges = projection.edges.map((edge) => {
    const route = routes.get(edge.id);
    return route === undefined
      ? edge
      : { ...edge, data: { ...edge.data, route, routeKind: "orthogonal" as const } };
  });
  const finalProjection = { ...projection, nodes, edges };
  const validation = validateOrthogonalProjection(finalProjection, projection, routeResult);
  return {
    ...finalProjection,
    diagnostics: [...projection.diagnostics, ...validation.diagnostics],
  };
}
