import type { NormalizedScenario } from "../../../core-model/src/generated/contracts.js";
import type { AssetRenderDescriptor } from "../../../asset-library/src/index.js";
import type { DeviceVisualFamily, SemanticLinkDescriptor } from "./device-visuals.js";

export type CanvasNodeKind = "zone" | "resource";
export type LayoutStatus = "resolved" | "unplaced";

export interface CanvasPosition {
  readonly x: number;
  readonly y: number;
}

export interface CanvasDimensions {
  readonly width: number;
  readonly height: number;
}

export interface CanvasInterfaceHandle {
  readonly interfaceId: string;
  readonly label: string;
  readonly addresses: readonly string[];
  readonly mac?: string;
  readonly stateLabel: "DECLARED";
  readonly sourceHandleId: string;
  readonly targetHandleId: string;
}

export interface CanvasZoneData {
  readonly semanticId: string;
  readonly semanticKind: "zone";
  readonly label: string;
  readonly zoneKind: string;
}

export interface CanvasResourceData {
  readonly semanticId: string;
  readonly semanticKind: "resource";
  readonly label: string;
  readonly resourceType: string;
  readonly vendor?: string;
  readonly product?: string;
  readonly deviceFamily: DeviceVisualFamily;
  readonly deviceRoleLabel: string;
  readonly asset?: AssetRenderDescriptor;
  readonly interfaces: readonly CanvasInterfaceHandle[];
}

export type CanvasNodeData = CanvasZoneData | CanvasResourceData;

export interface CanvasNode {
  readonly id: string;
  readonly type: CanvasNodeKind;
  readonly position: CanvasPosition;
  readonly width: number;
  readonly height: number;
  readonly parentId?: string;
  readonly extent?: "parent";
  readonly data: CanvasNodeData;
  readonly layoutStatus: LayoutStatus;
}

export interface CanvasEdgeData {
  readonly semanticId: string;
  readonly connectionKind: NormalizedScenario["connections"][number]["kind"];
  readonly properties: Readonly<Record<string, unknown>>;
  readonly visual: SemanticLinkDescriptor;
}

export interface CanvasEdge {
  readonly id: string;
  readonly type: "semantic";
  readonly source: string;
  readonly target: string;
  readonly sourceHandle?: string;
  readonly targetHandle?: string;
  readonly data: CanvasEdgeData;
}

export interface CanvasProjectionDiagnostic {
  readonly severity: "warning" | "error";
  readonly code: string;
  readonly objectId?: string;
  readonly message: string;
}

export interface CanvasProjection {
  readonly scenarioId: string;
  readonly sourceHash: string;
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
  readonly diagnostics: readonly CanvasProjectionDiagnostic[];
}
