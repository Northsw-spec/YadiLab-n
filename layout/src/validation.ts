import type { LayoutBackendNode, LayoutDiagnostic, LayoutGraph } from "./types.js";

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
