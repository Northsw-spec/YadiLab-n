import type { LayoutDocument, NormalizedScenario } from "../../../core-model/src/generated/contracts.js";
import { resolveResourceAsset } from "../../../asset-library/src/index.js";
import type {
  CanvasDimensions,
  CanvasEdge,
  CanvasInterfaceHandle,
  CanvasNode,
  CanvasProjection,
  CanvasProjectionDiagnostic,
} from "./types.js";
import { describeDeviceVisual, describeSemanticLink } from "./device-visuals.js";

const DEFAULT_ZONE: CanvasDimensions = { width: 720, height: 480 };
const DEFAULT_RESOURCE: CanvasDimensions = { width: 180, height: 96 };
const UNPLACED = { x: 0, y: 0 } as const;

function byId<T extends { readonly id: string }>(items: readonly T[]): readonly T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function zoneDepth(zoneId: string, parents: ReadonlyMap<string, string | undefined>, visiting = new Set<string>()): number {
  if (visiting.has(zoneId)) return 0;
  visiting.add(zoneId);
  const parent = parents.get(zoneId);
  return parent ? 1 + zoneDepth(parent, parents, visiting) : 0;
}

function handles(resource: NormalizedScenario["resources"][number]): readonly CanvasInterfaceHandle[] {
  return byId(resource.interfaces).map((iface) => ({
    interfaceId: iface.id,
    label: iface.label,
    addresses: [...iface.addresses],
    ...(iface.mac !== undefined ? { mac: iface.mac } : {}),
    stateLabel: "DECLARED",
    sourceHandleId: `out:${iface.id}`,
    targetHandleId: `in:${iface.id}`,
  }));
}

function validateLayoutIdentity(
  scenario: NormalizedScenario,
  layout: LayoutDocument | undefined,
  diagnostics: CanvasProjectionDiagnostic[],
): void {
  if (!layout) {
    diagnostics.push({
      severity: "warning",
      code: "CANVAS_LAYOUT_MISSING",
      message: "No layout document supplied; semantic objects are projected as unplaced until the Layout Engine resolves coordinates.",
    });
    return;
  }
  if (layout.scenarioId !== scenario.scenarioId) {
    diagnostics.push({
      severity: "error",
      code: "CANVAS_LAYOUT_SCENARIO_MISMATCH",
      message: `Layout scenario '${layout.scenarioId}' does not match '${scenario.scenarioId}'.`,
    });
  }
}

export function projectScenarioToCanvas(
  scenario: NormalizedScenario,
  layout?: LayoutDocument,
): CanvasProjection {
  const diagnostics: CanvasProjectionDiagnostic[] = [];
  validateLayoutIdentity(scenario, layout, diagnostics);
  const usableLayout = layout?.scenarioId === scenario.scenarioId ? layout : undefined;
  const layoutById = new Map((usableLayout?.nodes ?? []).map((node) => [node.id, node] as const));

  const zoneIds = new Set(scenario.zones.map((zone) => zone.id));
  const resourceIds = new Set(scenario.resources.map((resource) => resource.id));
  const semanticIds = new Set([...zoneIds, ...resourceIds]);
  for (const item of usableLayout?.nodes ?? []) {
    if (!semanticIds.has(item.id)) {
      diagnostics.push({
        severity: "warning",
        code: "CANVAS_LAYOUT_ORPHAN",
        objectId: item.id,
        message: `Layout node '${item.id}' has no matching semantic zone/resource and was ignored.`,
      });
    }
  }

  const parents = new Map(scenario.zones.map((zone) => [zone.id, zone.parent] as const));
  const sortedZones = [...scenario.zones].sort((a, b) => {
    const depth = zoneDepth(a.id, parents) - zoneDepth(b.id, parents);
    return depth || a.id.localeCompare(b.id);
  });

  const nodes: CanvasNode[] = [];
  for (const zone of sortedZones) {
    const l = layoutById.get(zone.id);
    if (!l) diagnostics.push({ severity: "warning", code: "CANVAS_NODE_UNPLACED", objectId: zone.id, message: `Zone '${zone.id}' has no resolved layout.` });
    nodes.push({
      id: zone.id,
      type: "zone",
      position: l ? { x: l.x, y: l.y } : UNPLACED,
      width: l?.width ?? DEFAULT_ZONE.width,
      height: l?.height ?? DEFAULT_ZONE.height,
      ...(zone.parent ? { parentId: zone.parent, extent: "parent" as const } : {}),
      data: { semanticId: zone.id, semanticKind: "zone", label: zone.label, zoneKind: zone.kind },
      layoutStatus: l ? "resolved" : "unplaced",
    });
  }

  for (const resource of byId(scenario.resources)) {
    const l = layoutById.get(resource.id);
    const resolvedAsset = resolveResourceAsset(scenario, resource);
    const deviceVisual = describeDeviceVisual(resource.type);
    if (!resolvedAsset.ok) diagnostics.push({ severity: "error", code: resolvedAsset.code, objectId: resource.id, message: resolvedAsset.message });
    if (!l) diagnostics.push({ severity: "warning", code: "CANVAS_NODE_UNPLACED", objectId: resource.id, message: `Resource '${resource.id}' has no resolved layout.` });
    nodes.push({
      id: resource.id,
      type: "resource",
      position: l ? { x: l.x, y: l.y } : UNPLACED,
      width: l?.width ?? DEFAULT_RESOURCE.width,
      height: l?.height ?? DEFAULT_RESOURCE.height,
      ...(resource.zone ? { parentId: resource.zone, extent: "parent" as const } : {}),
      data: {
        semanticId: resource.id,
        semanticKind: "resource",
        label: resource.label,
        resourceType: resource.type,
        ...(resource.vendor !== undefined ? { vendor: resource.vendor } : {}),
        ...(resource.product !== undefined ? { product: resource.product } : {}),
        deviceFamily: deviceVisual.family,
        deviceRoleLabel: deviceVisual.roleLabel,
        ...(resolvedAsset.ok ? { asset: resolvedAsset.asset } : {}),
        interfaces: handles(resource),
      },
      layoutStatus: l ? "resolved" : "unplaced",
    });
  }

  const interfaceIds = new Map(scenario.resources.map((resource) => [resource.id, new Set(resource.interfaces.map((iface) => iface.id))] as const));
  const edges: CanvasEdge[] = [];
  for (const connection of byId(scenario.connections)) {
    const fromPort = connection.from.port;
    const toPort = connection.to.port;
    if (fromPort && !interfaceIds.get(connection.from.resource)?.has(fromPort)) {
      diagnostics.push({ severity: "error", code: "CANVAS_SOURCE_PORT_UNKNOWN", objectId: connection.id, message: `Connection '${connection.id}' references unknown source port '${fromPort}'.` });
    }
    if (toPort && !interfaceIds.get(connection.to.resource)?.has(toPort)) {
      diagnostics.push({ severity: "error", code: "CANVAS_TARGET_PORT_UNKNOWN", objectId: connection.id, message: `Connection '${connection.id}' references unknown target port '${toPort}'.` });
    }
    edges.push({
      id: connection.id,
      type: "semantic",
      source: connection.from.resource,
      target: connection.to.resource,
      ...(fromPort ? { sourceHandle: `out:${fromPort}` } : {}),
      ...(toPort ? { targetHandle: `in:${toPort}` } : {}),
      data: {
        semanticId: connection.id,
        connectionKind: connection.kind,
        properties: connection.properties,
        visual: describeSemanticLink(connection.kind, connection.properties),
      },
    });
  }

  return {
    scenarioId: scenario.scenarioId,
    sourceHash: scenario.sourceHash,
    nodes,
    edges,
    diagnostics,
  };
}
