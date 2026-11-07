import type { LayoutDocument, NormalizedScenario } from "../../core-model/src/generated/contracts.js";

export interface LayoutPortInput {
  readonly id: string;
  readonly ownerId: string;
  readonly interfaceId: string;
  readonly direction: "input" | "output";
}

export interface LayoutGraphNode {
  readonly id: string;
  readonly kind: "zone" | "resource";
  readonly width: number;
  readonly height: number;
  readonly parent?: string;
  readonly children: readonly LayoutGraphNode[];
  readonly ports: readonly LayoutPortInput[];
}

export interface LayoutGraphEdge {
  readonly id: string;
  readonly sourceNode: string;
  readonly targetNode: string;
  readonly sourcePort?: string;
  readonly targetPort?: string;
}

export interface LayoutGraph {
  readonly id: "__root__";
  readonly children: readonly LayoutGraphNode[];
  readonly edges: readonly LayoutGraphEdge[];
}

export interface LayoutBackendNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly parent?: string;
}

export interface LayoutBackendResult {
  readonly nodes: readonly LayoutBackendNode[];
}

export interface LayoutBackend {
  readonly id: string;
  layout(graph: LayoutGraph): Promise<LayoutBackendResult>;
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
