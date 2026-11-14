/**
 * Presentation-only Connected Explorer safeguard. Unplaced (0,0) source
 * geometry and overlapping sibling cards must never be passed to React Flow
 * as a complete explorer view; canonical topology is never changed here.
 */
export function inspectConnectedExplorerGeometry(projection, zoneHeaderHeight = 112) {
  if (!projection || !Array.isArray(projection.nodes)) return { safe: false, reason: "MISSING_PROJECTION" };
  const nodes = projection.nodes;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const groups = new Map();
  for (const node of nodes) {
    if (node.type !== "resource" && node.type !== "zone") continue;
    const { x, y } = node.position ?? {};
    if (node.layoutStatus !== "resolved") return { safe: false, reason: "UNRESOLVED_GEOMETRY", nodeId: node.id };
    if (![x, y, node.width, node.height].every(Number.isFinite) || node.width <= 0 || node.height <= 0) {
      return { safe: false, reason: "INVALID_GEOMETRY", nodeId: node.id };
    }
    if (node.parentId) {
      const parent = byId.get(node.parentId);
      if (!parent || parent.type !== "zone" || parent.layoutStatus !== "resolved") {
        return { safe: false, reason: "MISSING_PARENT_GEOMETRY", nodeId: node.id };
      }
      if (node.type === "resource" && y < zoneHeaderHeight) {
        return { safe: false, reason: "ZONE_HEADER_OVERLAP", nodeId: node.id };
      }
      if (x < 0 || y < 0 || x + node.width > parent.width || y + node.height > parent.height) {
        return { safe: false, reason: "OUTSIDE_PARENT_BOUNDS", nodeId: node.id };
      }
    }
    const key = node.parentId ?? "$root";
    const siblings = groups.get(key) ?? [];
    siblings.push(node);
    groups.set(key, siblings);
  }
  for (const siblings of groups.values()) {
    siblings.sort((a, b) => a.position.x - b.position.x);
    for (let i = 0; i < siblings.length; i += 1) {
      const a = siblings[i];
      for (let j = i + 1; j < siblings.length; j += 1) {
        const b = siblings[j];
        if (b.position.x >= a.position.x + a.width) break;
        if (a.position.y < b.position.y + b.height && b.position.y < a.position.y + a.height) {
          return { safe: false, reason: "OVERLAPPING_SIBLINGS", nodeId: b.id };
        }
      }
    }
  }
  return { safe: true, reason: "RESOLVED" };
}
