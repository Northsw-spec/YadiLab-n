import type { NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import type { LayoutGraph, LayoutGraphEdge, LayoutGraphNode, LayoutPortInput } from "./types.js";

export const DEFAULT_RESOURCE_WIDTH = 180;
export const DEFAULT_RESOURCE_HEIGHT = 96;
export const DEFAULT_ZONE_WIDTH = 720;
export const DEFAULT_ZONE_HEIGHT = 480;

export function outputPortId(resourceId: string, interfaceId: string): string {
  return `${resourceId}::out::${interfaceId}`;
}
export function inputPortId(resourceId: string, interfaceId: string): string {
  return `${resourceId}::in::${interfaceId}`;
}

function resourcePorts(resource: NormalizedScenario["resources"][number]): readonly LayoutPortInput[] {
  return [...resource.interfaces]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((iface) => [
      { id: outputPortId(resource.id, iface.id), ownerId: resource.id, interfaceId: iface.id, direction: "output" as const },
      { id: inputPortId(resource.id, iface.id), ownerId: resource.id, interfaceId: iface.id, direction: "input" as const },
    ]);
}

export function buildLayoutGraph(scenario: NormalizedScenario): LayoutGraph {
  const zoneChildren = new Map<string | undefined, string[]>();
  for (const zone of scenario.zones) {
    const list = zoneChildren.get(zone.parent) ?? [];
    list.push(zone.id);
    zoneChildren.set(zone.parent, list);
  }
  for (const list of zoneChildren.values()) list.sort((a, b) => a.localeCompare(b));

  const resourcesByZone = new Map<string | undefined, NormalizedScenario["resources"][number][]>();
  for (const resource of scenario.resources) {
    const list = resourcesByZone.get(resource.zone) ?? [];
    list.push(resource);
    resourcesByZone.set(resource.zone, list);
  }
  for (const list of resourcesByZone.values()) list.sort((a, b) => a.id.localeCompare(b.id));

  const zones = new Map(scenario.zones.map((zone) => [zone.id, zone] as const));
  const makeZone = (id: string, parent?: string): LayoutGraphNode => {
    const childZones = (zoneChildren.get(id) ?? []).map((child) => makeZone(child, id));
    const childResources = (resourcesByZone.get(id) ?? []).map((resource): LayoutGraphNode => ({
      id: resource.id,
      kind: "resource",
      width: DEFAULT_RESOURCE_WIDTH,
      height: DEFAULT_RESOURCE_HEIGHT,
      parent: id,
      children: [],
      ports: resourcePorts(resource),
    }));
    if (!zones.has(id)) throw new Error(`Unknown zone '${id}' during layout projection.`);
    return {
      id,
      kind: "zone",
      width: DEFAULT_ZONE_WIDTH,
      height: DEFAULT_ZONE_HEIGHT,
      ...(parent ? { parent } : {}),
      children: [...childZones, ...childResources],
      ports: [],
    };
  };

  const rootZones = (zoneChildren.get(undefined) ?? []).map((id) => makeZone(id));
  const rootResources = (resourcesByZone.get(undefined) ?? []).map((resource): LayoutGraphNode => ({
    id: resource.id,
    kind: "resource",
    width: DEFAULT_RESOURCE_WIDTH,
    height: DEFAULT_RESOURCE_HEIGHT,
    children: [],
    ports: resourcePorts(resource),
  }));

  const edges: LayoutGraphEdge[] = [...scenario.connections]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((connection) => ({
      id: connection.id,
      sourceNode: connection.from.resource,
      targetNode: connection.to.resource,
      ...(connection.from.port ? { sourcePort: outputPortId(connection.from.resource, connection.from.port) } : {}),
      ...(connection.to.port ? { targetPort: inputPortId(connection.to.resource, connection.to.port) } : {}),
    }));

  return { id: "__root__", children: [...rootZones, ...rootResources], edges };
}
