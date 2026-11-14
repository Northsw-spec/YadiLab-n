import type { LayoutBackendEdge, LayoutBackendNode, LayoutBackendPort, LayoutDiagnostic, LayoutGraph, LayoutGraphNode } from "./types.js";

const ORTHOGONAL_EPSILON = 1e-6;

function flattenGraph(graph: LayoutGraph) {
  const expected = new Map<string, string | undefined>();
  const visit = (nodes: typeof graph.children) => {
    for (const node of nodes) {
      expected.set(node.id, node.parent);
      visit(node.children);
    }
  };
  visit(graph.children);
  return expected;
}

export function validateBackendResult(graph: LayoutGraph, nodes: readonly LayoutBackendNode[]): readonly LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  const expected = flattenGraph(graph);
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) diagnostics.push({ severity: "error", code: "LAYOUT_DUPLICATE_NODE", objectId: node.id, message: `Backend returned duplicate node '${node.id}'.` });
    seen.add(node.id);
    if (!expected.has(node.id)) diagnostics.push({ severity: "error", code: "LAYOUT_UNKNOWN_NODE", objectId: node.id, message: `Backend returned unknown node '${node.id}'.` });
    if (![node.x,node.y,node.width,node.height].every(Number.isFinite) || node.width <= 0 || node.height <= 0) {
      diagnostics.push({ severity: "error", code: "LAYOUT_INVALID_GEOMETRY", objectId: node.id, message: `Backend returned invalid geometry for '${node.id}'.` });
    }
    if (expected.has(node.id) && expected.get(node.id) !== node.parent) {
      diagnostics.push({ severity: "error", code: "LAYOUT_PARENT_MISMATCH", objectId: node.id, message: `Backend parent for '${node.id}' does not match semantic hierarchy.` });
    }
  }
  for (const id of expected.keys()) if (!seen.has(id)) diagnostics.push({ severity: "error", code: "LAYOUT_NODE_MISSING", objectId: id, message: `Backend omitted semantic node '${id}'.` });
  return diagnostics;
}

export function validateBackendPorts(graph: LayoutGraph, ports: readonly LayoutBackendPort[]): readonly LayoutDiagnostic[] {
  const expected = new Map<string, string>();
  const walk = (nodes: readonly LayoutGraphNode[]): void => {
    for (const node of nodes) {
      for (const port of node.ports) expected.set(port.id, node.id);
      walk(node.children);
    }
  };
  walk(graph.children);
  const diagnostics: LayoutDiagnostic[] = [];
  const seen = new Set<string>();
  for (const port of ports) {
    if (seen.has(port.id)) diagnostics.push({ severity: "error", code: "LAYOUT_DUPLICATE_PORT", objectId: port.id, message: `Backend returned duplicate port '${port.id}'.` });
    seen.add(port.id);
    if (!expected.has(port.id)) diagnostics.push({ severity: "error", code: "LAYOUT_UNKNOWN_PORT", objectId: port.id, message: `Backend returned unknown port '${port.id}'.` });
    if (![port.x, port.y, port.width, port.height].every(Number.isFinite) || port.width <= 0 || port.height <= 0) diagnostics.push({ severity: "error", code: "LAYOUT_INVALID_PORT_GEOMETRY", objectId: port.id, message: `Backend returned invalid geometry for '${port.id}'.` });
    if (expected.has(port.id) && expected.get(port.id) !== port.ownerId) diagnostics.push({ severity: "error", code: "LAYOUT_PORT_OWNER_MISMATCH", objectId: port.id, message: `Backend port owner for '${port.id}' does not match the graph.` });
  }
  for (const id of expected.keys()) if (!seen.has(id)) diagnostics.push({ severity: "error", code: "LAYOUT_PORT_MISSING", objectId: id, message: `Backend omitted semantic port '${id}'.` });
  return diagnostics;
}

export function validateBackendEdges(graph: LayoutGraph, edges: readonly LayoutBackendEdge[]): readonly LayoutDiagnostic[] {
  const expected = new Map(graph.edges.map((edge) => [edge.id, edge] as const));
  const diagnostics: LayoutDiagnostic[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    if (seen.has(edge.id)) diagnostics.push({ severity: "error", code: "LAYOUT_DUPLICATE_EDGE", objectId: edge.id, message: `Backend returned duplicate edge '${edge.id}'.` });
    seen.add(edge.id);
    const source = expected.get(edge.id);
    if (!source) diagnostics.push({ severity: "error", code: "LAYOUT_UNKNOWN_EDGE", objectId: edge.id, message: `Backend returned unknown edge '${edge.id}'.` });
    else {
      if (source.sourceNode !== edge.sourceNode || source.targetNode !== edge.targetNode) diagnostics.push({ severity: "error", code: "LAYOUT_EDGE_ENDPOINT_MISMATCH", objectId: edge.id, message: `Backend changed the canonical endpoints for '${edge.id}'.` });
      if (source.sourcePort !== edge.sourcePort || source.targetPort !== edge.targetPort) diagnostics.push({ severity: "error", code: "LAYOUT_EDGE_PORT_MISMATCH", objectId: edge.id, message: `Backend changed the canonical ports for '${edge.id}'.` });
    }
    if (!edge.sections.length) diagnostics.push({ severity: "error", code: "TOPOLOGY_LAYOUT_EDGE_SECTION_MISSING", objectId: edge.id, message: `Backend returned no route section for '${edge.id}'.` });
    for (const section of edge.sections) {
      const points = [section.startPoint, ...section.bendPoints, section.endPoint];
      if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) diagnostics.push({ severity: "error", code: "LAYOUT_INVALID_EDGE_GEOMETRY", objectId: edge.id, message: `Backend returned non-finite route geometry for '${edge.id}'.` });
      for (let index = 1; index < points.length; index += 1) if (Math.abs(points[index - 1]!.x - points[index]!.x) > ORTHOGONAL_EPSILON && Math.abs(points[index - 1]!.y - points[index]!.y) > ORTHOGONAL_EPSILON) diagnostics.push({ severity: "error", code: "TOPOLOGY_LAYOUT_EDGE_NON_ORTHOGONAL", objectId: edge.id, message: `Backend returned a diagonal segment for '${edge.id}'.` });
    }
  }
  for (const id of expected.keys()) if (!seen.has(id)) diagnostics.push({ severity: "error", code: "LAYOUT_EDGE_MISSING", objectId: id, message: `Backend omitted semantic edge '${id}'.` });
  return diagnostics;
}
