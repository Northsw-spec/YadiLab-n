import type { CanvasProjection, CanvasNode } from "./types.js";
import { computeOrthogonalRoutesChecked, NORMAL_MIN_PORT_SEPARATION_PX, validateOrthogonalProjection } from "./topology-edge-routing.js";

const GRID_COLUMNS = 5;
const GRID_GAP_X = 56;
const GRID_GAP_Y = 60;
const GRID_PADDING = 72;
const ZONE_HEADER = 72;
const RESOURCE_GAP = 28;
const ZONE_PADDING = 32;
const PORT_SPAN_RATIO = 0.6;
/**
 * The live interface handle is 8px wide. A 2px visual gap is the smallest
 * separation that keeps adjacent declared ports independently targetable in
 * Chromium; the measured pre-F5B 50/150 hub was below 1px. This is a
 * presentation invariant only and never changes canonical interfaces.
 */
type PortSide = "NORTH" | "SOUTH" | "EAST" | "WEST";
const SOURCE_DENSE_SIDES: readonly PortSide[] = ["EAST", "NORTH", "SOUTH", "WEST"];
const TARGET_DENSE_SIDES: readonly PortSide[] = ["WEST", "NORTH", "SOUTH", "EAST"];

function portSpan(count: number): number {
  return Math.ceil((count + 1) * NORMAL_MIN_PORT_SEPARATION_PX / PORT_SPAN_RATIO);
}

function densityAwareResource(node: CanvasNode): CanvasNode {
  if (node.type !== "resource" || node.data.semanticKind !== "resource" || node.data.interfaces.length < 1) return node;
  const dense = portSpan(node.data.interfaces.length) > node.height;
  if (!dense) return node;
  const sourceSide = new Map<string, PortSide>();
  const targetSide = new Map<string, PortSide>();
  node.data.interfaces.forEach((iface, index) => {
    sourceSide.set(iface.interfaceId, dense ? SOURCE_DENSE_SIDES[index % SOURCE_DENSE_SIDES.length]! : "EAST");
    targetSide.set(iface.interfaceId, dense ? TARGET_DENSE_SIDES[index % TARGET_DENSE_SIDES.length]! : "WEST");
  });
  const sideCounts = (values: ReadonlyMap<string, PortSide>): Record<PortSide, number> => {
    const counts: Record<PortSide, number> = { NORTH: 0, SOUTH: 0, EAST: 0, WEST: 0 };
    for (const side of values.values()) counts[side] += 1;
    return counts;
  };
  const sourceCounts = sideCounts(sourceSide);
  const targetCounts = sideCounts(targetSide);
  const height = Math.max(node.height, portSpan(Math.max(sourceCounts.EAST, sourceCounts.WEST, targetCounts.EAST, targetCounts.WEST)));
  const width = Math.max(node.width, portSpan(Math.max(sourceCounts.NORTH, sourceCounts.SOUTH, targetCounts.NORTH, targetCounts.SOUTH)));
  return {
    ...node,
    width,
    height,
    data: {
      ...node.data,
      interfaces: node.data.interfaces.map((iface) => {
        const source = sourceSide.get(iface.interfaceId);
        const target = targetSide.get(iface.interfaceId);
        return {
          ...iface,
          ...(source ? { sourceSide: source } : {}),
          ...(target ? { targetSide: target } : {}),
        };
      }),
    },
  };
}

interface GridMetrics {
  readonly columns: number;
  readonly columnWidths: readonly number[];
  readonly rowHeights: readonly number[];
}

function gridMetrics(children: readonly CanvasNode[]): GridMetrics {
  const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(children.length))));
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights: number[] = [];
  children.forEach((child, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, child.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, child.height);
  });
  return { columns, columnWidths, rowHeights };
}

function gridOffset(values: readonly number[], index: number, gap: number, padding: number): number {
  return padding + values.slice(0, index).reduce((sum, value) => sum + value + gap, 0);
}

/**
 * The imported ELK document may place many independent declared zones in one
 * very tall column. For NORMAL TOPOLOGY, pack only root-level containers into
 * a stable grid and keep every child in its existing local coordinates. This
 * is a view projection: it does not rewrite LayoutDocument or Builder source.
 */
export function compactNormalTopologyProjection(projection: CanvasProjection): CanvasProjection {
  const directChildren = new Map<string, CanvasNode[]>();
  const sizedNodes = projection.nodes.map(densityAwareResource);
  for (const node of sizedNodes) {
    if (node.parentId && node.type === "resource") {
      const children = directChildren.get(node.parentId) ?? [];
      children.push(node);
      directChildren.set(node.parentId, children);
    }
  }
  const reflowed = sizedNodes.map((node) => {
    if (node.type !== "zone") return node;
    const children = directChildren.get(node.id) ?? [];
    if (!children.length) return node;
    const { columns, columnWidths, rowHeights } = gridMetrics(children);
    const width = Math.max(node.width, ZONE_PADDING * 2 + columnWidths.reduce((sum, value) => sum + value, 0) + (columns - 1) * RESOURCE_GAP);
    const height = Math.max(node.height, ZONE_HEADER + ZONE_PADDING + rowHeights.reduce((sum, value) => sum + value, 0) + (rowHeights.length - 1) * RESOURCE_GAP + ZONE_PADDING);
    return { ...node, width, height };
  });
  const reflowedByParent = new Map<string, CanvasNode[]>(directChildren);
  const reflowedChildren = reflowed.map((node) => {
    if (!node.parentId || node.type !== "resource") return node;
    const siblings = reflowedByParent.get(node.parentId) ?? [];
    const index = siblings.findIndex((sibling) => sibling.id === node.id);
    if (index < 0) return node;
    const { columns, columnWidths, rowHeights } = gridMetrics(siblings);
    return {
      ...node,
      position: {
        x: gridOffset(columnWidths, index % columns, RESOURCE_GAP, ZONE_PADDING),
        y: ZONE_HEADER + gridOffset(rowHeights, Math.floor(index / columns), RESOURCE_GAP, ZONE_PADDING),
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
