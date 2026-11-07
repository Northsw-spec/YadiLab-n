import ELK from "elkjs/lib/elk.bundled.js";
import type { LayoutBackend, LayoutBackendNode, LayoutBackendResult, LayoutGraph, LayoutGraphNode } from "./types.js";
import { ROOT_LAYOUT_PADDING, ZONE_CONTENT_PADDING, elkPadding } from "./geometry-policy.js";

interface ElkNodeLike {
  id: string;
  x?: number; y?: number; width?: number; height?: number;
  children?: ElkNodeLike[];
}
interface ElkConstructor { new(): { layout(graph: unknown): Promise<ElkNodeLike> } }

function nodeToElk(node: LayoutGraphNode): Record<string, unknown> {
  return {
    id: node.id,
    width: node.width,
    height: node.height,
    ...(node.children.length ? { children: node.children.map(nodeToElk) } : {}),
    ...(node.ports.length ? { ports: node.ports.map((port) => ({ id: port.id, width: 8, height: 8 })) } : {}),
    layoutOptions: {
      "org.eclipse.elk.portConstraints": "FIXED_ORDER",
      ...(node.kind === "zone" ? { "elk.padding": elkPadding(ZONE_CONTENT_PADDING) } : {}),
    },
  };
}

function collect(nodes: readonly ElkNodeLike[] | undefined, parent: string | undefined, out: LayoutBackendNode[]): void {
  for (const node of nodes ?? []) {
    out.push({
      id: node.id,
      x: node.x ?? 0,
      y: node.y ?? 0,
      width: node.width ?? 0,
      height: node.height ?? 0,
      ...(parent ? { parent } : {}),
    });
    collect(node.children, node.id, out);
  }
}

export class ElkLayoutBackend implements LayoutBackend {
  readonly id = "elk.layered";

  async layout(graph: LayoutGraph): Promise<LayoutBackendResult> {
    const Ctor = ELK as unknown as ElkConstructor;
    const elk = new Ctor();
    const output = await elk.layout({
      id: graph.id,
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.hierarchyHandling": "INCLUDE_CHILDREN",
        "elk.spacing.nodeNode": "40",
        "elk.layered.spacing.nodeNodeBetweenLayers": "80",
        "elk.padding": elkPadding(ROOT_LAYOUT_PADDING),
      },
      children: graph.children.map(nodeToElk),
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        sources: [edge.sourcePort ?? edge.sourceNode],
        targets: [edge.targetPort ?? edge.targetNode],
      })),
    });
    const nodes: LayoutBackendNode[] = [];
    collect(output.children, undefined, nodes);
    return { nodes };
  }
}
