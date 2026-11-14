import type { LayoutDocument, NormalizedScenario } from "../../core-model/src/generated/contracts.js";

export interface LayoutPortInput {
  readonly id: string;
  readonly ownerId: string;
  readonly interfaceId: string;
  readonly direction: "input" | "output";
  /** View-only side hint used by the ELK adapter. Canonical source data is unchanged. */
  readonly side?: "NORTH" | "SOUTH" | "EAST" | "WEST";
  /** Stable order is required when FIXED_ORDER is selected. */
  readonly index?: number;
  /** True for a per-link visual attachment created when no source port exists. */
  readonly viewOnly?: true;
}

export interface LayoutGraphNode {
  readonly id: string;
  readonly kind: "zone" | "resource";
  readonly width: number;
  readonly height: number;
  readonly parent?: string;
  readonly children: readonly LayoutGraphNode[];
  readonly ports: readonly LayoutPortInput[];
  /** Optional view-owned ELK options applied to this node/container. */
  readonly layoutOptions?: Readonly<Record<string, string>>;
}

export interface LayoutGraphEdge {
  readonly id: string;
  readonly sourceNode: string;
  readonly targetNode: string;
  readonly sourcePort?: string;
  readonly targetPort?: string;
  /** View-owned constraint edge; never part of canonical output. */
  readonly layoutOnly?: true;
}

export interface LayoutGraph {
  readonly id: "__root__";
  readonly children: readonly LayoutGraphNode[];
  readonly edges: readonly LayoutGraphEdge[];
  /** Optional, view-owned ELK options. Legacy callers continue to use defaults. */
  readonly layoutOptions?: Readonly<Record<string, string>>;
}

export interface LayoutBackendNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly parent?: string;
}

export interface LayoutBackendPort {
  readonly id: string;
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly side?: "NORTH" | "SOUTH" | "EAST" | "WEST";
  readonly index?: number;
  readonly viewOnly?: true;
}

export interface LayoutBackendPoint {
  readonly x: number;
  readonly y: number;
}

export interface LayoutBackendEdgeSection {
  readonly id: string;
  readonly startPoint: LayoutBackendPoint;
  readonly bendPoints: readonly LayoutBackendPoint[];
  readonly endPoint: LayoutBackendPoint;
}

export interface LayoutBackendEdge {
  readonly id: string;
  readonly sourceNode: string;
  readonly targetNode: string;
  readonly sourcePort?: string;
  readonly targetPort?: string;
  readonly sections: readonly LayoutBackendEdgeSection[];
  readonly container?: string;
}

export interface LayoutBackendResult {
  readonly nodes: readonly LayoutBackendNode[];
  /** Additive ELK output. Existing Builder consumers may ignore these fields. */
  readonly ports?: readonly LayoutBackendPort[];
  readonly edges?: readonly LayoutBackendEdge[];
  readonly diagnostics?: readonly LayoutDiagnostic[];
}

/** Identity envelope carried by cancellable browser layout jobs. */
export interface LayoutRequestContext {
  readonly requestId: string;
  readonly sourceSha: string;
  readonly sourceRevision: number;
  readonly projectGeneration: number;
  readonly builderIdentity: string;
  readonly compileIdentity: string;
}

export interface LayoutBackend {
  readonly id: string;
  layout(graph: LayoutGraph, context?: LayoutRequestContext): Promise<LayoutBackendResult>;
}

export interface ManualLayoutOverride {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
}

export interface AutoLayoutOptions {
  readonly schemaVersion?: string;
  readonly manualOverrides?: readonly ManualLayoutOverride[];
  /**
   * NORMAL may validate a second, compacted projection after ELK. This
   * option defers only the raw ELK sibling-whitespace diagnostic; all
   * structural, semantic, port, edge and geometry errors remain fatal.
   */
  readonly deferIntermediateWhitespace?: boolean;
}

export interface LayoutDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly objectId?: string;
  readonly message: string;
}

export interface AutoLayoutResult {
  readonly ok: boolean;
  readonly document?: LayoutDocument;
  readonly diagnostics: readonly LayoutDiagnostic[];
}

export type ScenarioResource = NormalizedScenario["resources"][number];
