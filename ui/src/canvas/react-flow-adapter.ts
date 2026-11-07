import type { CanvasEdge, CanvasNode, CanvasProjection } from "./types.js";

// Deliberately dependency-thin structural contract. @xyflow/react accepts these fields,
// but canonical scenario state never imports React Flow node/edge state.
export interface ReactFlowNodeProjection {
  readonly id: string;
  readonly type: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly width?: number;
  readonly height?: number;
  readonly parentId?: string;
  readonly extent?: "parent";
  readonly data: Readonly<Record<string, unknown>>;
}

export interface ReactFlowEdgeProjection {
  readonly id: string;
  readonly type: string;
  readonly source: string;
  readonly target: string;
  readonly sourceHandle?: string;
  readonly targetHandle?: string;
  readonly data: Readonly<Record<string, unknown>>;
}

function nodeToReactFlow(node: CanvasNode): ReactFlowNodeProjection {
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    width: node.width,
    height: node.height,
    ...(node.parentId !== undefined ? { parentId: node.parentId } : {}),
    ...(node.extent !== undefined ? { extent: node.extent } : {}),
    data: { ...node.data, layoutStatus: node.layoutStatus },
  };
}

function edgeToReactFlow(edge: CanvasEdge): ReactFlowEdgeProjection {
  return {
    id: edge.id,
    type: edge.type,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle !== undefined ? { sourceHandle: edge.sourceHandle } : {}),
    ...(edge.targetHandle !== undefined ? { targetHandle: edge.targetHandle } : {}),
    data: { ...edge.data },
  };
}

export function toReactFlowProjection(projection: CanvasProjection): {
  readonly nodes: readonly ReactFlowNodeProjection[];
  readonly edges: readonly ReactFlowEdgeProjection[];
} {
  return {
    nodes: projection.nodes.map(nodeToReactFlow),
    edges: projection.edges.map(edgeToReactFlow),
  };
}
