import type {
  ScenarioSource,
  Scenariosourceconnection,
  Scenariosourceresource,
  Scenariosourcezone,
} from "../../../core-model/src/generated/contracts.js";
import {
  addResource,
  addZone,
  deleteConnection,
  deleteResource,
  deleteZone,
  duplicateResource,
  replaceResource,
  replaceZone,
  setMissionMetadata,
  upsertConnection,
} from "./builder.js";
import type { BrowserCommandResult, BrowserDiagnostic, BuilderWorkspace } from "./types.js";

export const ZONE_KINDS = ["internet", "wan", "dmz", "lan", "server", "management", "security", "backup", "guest", "custom"] as const;
export const CONNECTION_KINDS = ["network", "management", "trust", "authentication", "dependency", "data_flow"] as const;

export type ZoneKind = typeof ZONE_KINDS[number];
export type ConnectionKind = typeof CONNECTION_KINDS[number];

export type BuilderInspectorModel =
  | { readonly kind: "mission"; readonly title: string; readonly language: string; readonly briefing: string; readonly description: string }
  | { readonly kind: "zone"; readonly id: string; readonly label: string; readonly zoneKind: ZoneKind; readonly parent: string; readonly availableParents: readonly string[] }
  | {
      readonly kind: "resource";
      readonly id: string;
      readonly label: string;
      readonly resourceType: string;
      readonly zone: string;
      readonly profile: string;
      readonly vendor: string;
      readonly product: string;
      readonly assetId: string;
      readonly assetVersion: string;
      readonly propertiesJson: string;
      readonly interfacesJson: string;
      readonly availableZones: readonly string[];
    }
  | {
      readonly kind: "connection";
      readonly id: string;
      readonly connectionKind: ConnectionKind;
      readonly fromResource: string;
      readonly fromPort: string;
      readonly toResource: string;
      readonly toPort: string;
      readonly propertiesJson: string;
      readonly availableResources: readonly string[];
    };

export interface MissionInspectorInput {
  readonly title: string;
  readonly language: string;
  readonly briefing?: string;
  readonly description?: string;
}

export interface ZoneInspectorInput {
  readonly label: string;
  readonly kind: string;
  readonly parent?: string;
}

export interface ResourceInspectorInput {
  readonly label: string;
  readonly type: string;
  readonly zone?: string;
  readonly profile?: string;
  readonly vendor?: string;
  readonly product?: string;
  readonly assetId?: string;
  readonly assetVersion?: string;
  readonly propertiesJson: string;
  readonly interfacesJson: string;
}

export interface ConnectionInspectorInput {
  readonly kind: string;
  readonly fromResource: string;
  readonly fromPort?: string;
  readonly toResource: string;
  readonly toPort?: string;
  readonly propertiesJson: string;
}

function diagnostic(code: string, message: string, objectId?: string): BrowserDiagnostic {
  return objectId ? { severity: "error", code, message, objectId } : { severity: "error", code, message };
}

function fail(workspace: BuilderWorkspace, ...diagnostics: readonly BrowserDiagnostic[]): BrowserCommandResult<BuilderWorkspace> {
  return { ok: false, workspace, diagnostics };
}

function trimOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(workspace: BuilderWorkspace, text: string, code: string, objectId?: string): { ok: true; value: Readonly<Record<string, unknown>> } | BrowserCommandResult<BuilderWorkspace> {
  try {
    const value: unknown = text.trim() === "" ? {} : JSON.parse(text);
    if (!isPlainObject(value)) return fail(workspace, diagnostic(code, "Properties must be a JSON object.", objectId));
    return { ok: true, value };
  } catch (error) {
    return fail(workspace, diagnostic(code, `Invalid properties JSON: ${error instanceof Error ? error.message : String(error)}`, objectId));
  }
}

function parseInterfaces(workspace: BuilderWorkspace, text: string, objectId?: string): { ok: true; value: Scenariosourceresource["interfaces"] } | BrowserCommandResult<BuilderWorkspace> {
  try {
    const value: unknown = text.trim() === "" ? [] : JSON.parse(text);
    if (!Array.isArray(value)) return fail(workspace, diagnostic("BUILDER_INSPECTOR_INTERFACES_JSON", "Interfaces must be a JSON array.", objectId));
    for (const item of value) {
      if (!isPlainObject(item) || typeof item.id !== "string" || item.id.trim() === "") {
        return fail(workspace, diagnostic("BUILDER_INSPECTOR_INTERFACES_JSON", "Every interface must be an object with a non-empty id.", objectId));
      }
    }
    return { ok: true, value: value as unknown as Scenariosourceresource["interfaces"] };
  } catch (error) {
    return fail(workspace, diagnostic("BUILDER_INSPECTOR_INTERFACES_JSON", `Invalid interfaces JSON: ${error instanceof Error ? error.message : String(error)}`, objectId));
  }
}

function zoneKind(value: string): ZoneKind | undefined {
  return (ZONE_KINDS as readonly string[]).includes(value) ? value as ZoneKind : undefined;
}

function connectionKind(value: string): ConnectionKind | undefined {
  return (CONNECTION_KINDS as readonly string[]).includes(value) ? value as ConnectionKind : undefined;
}

function selectedSemantic(workspace: BuilderWorkspace): Scenariosourcezone | Scenariosourceresource | Scenariosourceconnection | undefined {
  const id = workspace.selection.primary;
  if (!id) return undefined;
  return workspace.source.zones.find((item) => item.id === id)
    ?? workspace.source.resources.find((item) => item.id === id)
    ?? workspace.source.connections.find((item) => item.id === id);
}

export function buildBuilderInspectorModel(workspace: BuilderWorkspace): BuilderInspectorModel {
  const selected = selectedSemantic(workspace);
  if (!selected) {
    return {
      kind: "mission",
      title: workspace.source.metadata.title,
      language: workspace.source.metadata.language,
      briefing: workspace.source.metadata.briefing ?? "",
      description: workspace.source.metadata.description ?? "",
    };
  }
  if (workspace.source.zones.some((item) => item.id === selected.id)) {
    const zone = selected as Scenariosourcezone;
    return {
      kind: "zone",
      id: zone.id,
      label: zone.label,
      zoneKind: zone.kind ?? "custom",
      parent: zone.parent ?? "",
      availableParents: workspace.source.zones.filter((item) => item.id !== zone.id).map((item) => item.id).sort(),
    };
  }
  if (workspace.source.resources.some((item) => item.id === selected.id)) {
    const resource = selected as Scenariosourceresource;
    return {
      kind: "resource",
      id: resource.id,
      label: resource.label,
      resourceType: resource.type,
      zone: resource.zone ?? "",
      profile: resource.profile ?? "",
      vendor: resource.vendor ?? "",
      product: resource.product ?? "",
      assetId: resource.asset?.id ?? "",
      assetVersion: resource.asset?.version ?? "",
      propertiesJson: JSON.stringify(resource.properties ?? {}, null, 2),
      interfacesJson: JSON.stringify(resource.interfaces ?? [], null, 2),
      availableZones: workspace.source.zones.map((item) => item.id).sort(),
    };
  }
  const connection = selected as Scenariosourceconnection;
  return {
    kind: "connection",
    id: connection.id,
    connectionKind: connection.kind,
    fromResource: connection.from.resource,
    fromPort: connection.from.port ?? "",
    toResource: connection.to.resource,
    toPort: connection.to.port ?? "",
    propertiesJson: JSON.stringify(connection.properties ?? {}, null, 2),
    availableResources: workspace.source.resources.map((item) => item.id).sort(),
  };
}

export function applyMissionInspector(workspace: BuilderWorkspace, input: MissionInspectorInput): BrowserCommandResult<BuilderWorkspace> {
  return setMissionMetadata(workspace, {
    title: input.title.trim(),
    language: input.language.trim(),
    briefing: input.briefing?.trim() ?? "",
    description: input.description?.trim() ?? "",
  });
}

export function applyZoneInspector(workspace: BuilderWorkspace, zoneId: string, input: ZoneInspectorInput): BrowserCommandResult<BuilderWorkspace> {
  const label = input.label.trim();
  if (!label) return fail(workspace, diagnostic("BUILDER_INSPECTOR_LABEL_REQUIRED", "Zone label must not be empty.", zoneId));
  const kind = zoneKind(input.kind);
  if (!kind) return fail(workspace, diagnostic("BUILDER_INSPECTOR_ZONE_KIND", `Unknown zone kind '${input.kind}'.`, zoneId));
  const parent = trimOptional(input.parent);
  const zone: Scenariosourcezone = { id: zoneId, label, kind, ...(parent ? { parent } : {}) };
  return replaceZone(workspace, zone);
}

export function applyResourceInspector(workspace: BuilderWorkspace, resourceId: string, input: ResourceInspectorInput): BrowserCommandResult<BuilderWorkspace> {
  const current = workspace.source.resources.find((item) => item.id === resourceId);
  if (!current) return fail(workspace, diagnostic("BUILDER_RESOURCE_UNKNOWN", `Resource '${resourceId}' does not exist.`, resourceId));
  const label = input.label.trim();
  const type = input.type.trim();
  if (!label) return fail(workspace, diagnostic("BUILDER_INSPECTOR_LABEL_REQUIRED", "Resource label must not be empty.", resourceId));
  if (!type) return fail(workspace, diagnostic("BUILDER_INSPECTOR_TYPE_REQUIRED", "Resource type must not be empty.", resourceId));
  const properties = parseJsonObject(workspace, input.propertiesJson, "BUILDER_INSPECTOR_PROPERTIES_JSON", resourceId);
  if (!("value" in properties)) return properties;
  const interfaces = parseInterfaces(workspace, input.interfacesJson, resourceId);
  if (!("value" in interfaces)) return interfaces;
  const zone = trimOptional(input.zone);
  const profile = trimOptional(input.profile);
  const vendor = trimOptional(input.vendor);
  const product = trimOptional(input.product);
  const assetId = trimOptional(input.assetId);
  const assetVersion = trimOptional(input.assetVersion);
  if ((assetId && !assetVersion) || (!assetId && assetVersion)) return fail(workspace, diagnostic("BUILDER_INSPECTOR_ASSET_PAIR", "Asset ID and version must either both be set or both be empty.", resourceId));
  const resource: Scenariosourceresource = {
    id: resourceId,
    type,
    label,
    properties: properties.value,
    interfaces: interfaces.value ?? [],
    ...(zone ? { zone } : {}),
    ...(profile ? { profile } : {}),
    ...(vendor ? { vendor } : {}),
    ...(product ? { product } : {}),
  };
  return replaceResource(workspace, resource);
}

export function applyConnectionInspector(workspace: BuilderWorkspace, connectionId: string, input: ConnectionInspectorInput): BrowserCommandResult<BuilderWorkspace> {
  const kind = connectionKind(input.kind);
  if (!kind) return fail(workspace, diagnostic("BUILDER_INSPECTOR_CONNECTION_KIND", `Unknown connection kind '${input.kind}'.`, connectionId));
  const fromResource = input.fromResource.trim();
  const toResource = input.toResource.trim();
  if (!fromResource || !toResource) return fail(workspace, diagnostic("BUILDER_INSPECTOR_CONNECTION_ENDPOINT", "Both connection endpoints are required.", connectionId));
  const properties = parseJsonObject(workspace, input.propertiesJson, "BUILDER_INSPECTOR_PROPERTIES_JSON", connectionId);
  if (!("value" in properties)) return properties;
  const fromPort = trimOptional(input.fromPort);
  const toPort = trimOptional(input.toPort);
  const connection: Scenariosourceconnection = {
    id: connectionId,
    kind,
    from: { resource: fromResource, ...(fromPort ? { port: fromPort } : {}) },
    to: { resource: toResource, ...(toPort ? { port: toPort } : {}) },
    properties: properties.value,
  };
  return upsertConnection(workspace, connection);
}

export function createZoneFromInspector(workspace: BuilderWorkspace, id: string, input: ZoneInspectorInput): BrowserCommandResult<BuilderWorkspace> {
  const normalizedId = id.trim();
  if (!normalizedId) return fail(workspace, diagnostic("BUILDER_INSPECTOR_ID_REQUIRED", "Zone id must not be empty."));
  const label = input.label.trim();
  if (!label) return fail(workspace, diagnostic("BUILDER_INSPECTOR_LABEL_REQUIRED", "Zone label must not be empty.", normalizedId));
  const kind = zoneKind(input.kind);
  if (!kind) return fail(workspace, diagnostic("BUILDER_INSPECTOR_ZONE_KIND", `Unknown zone kind '${input.kind}'.`, normalizedId));
  const parent = trimOptional(input.parent);
  return addZone(workspace, { id: normalizedId, label, kind, ...(parent ? { parent } : {}) });
}

export function createResourceFromInspector(workspace: BuilderWorkspace, id: string, input: ResourceInspectorInput): BrowserCommandResult<BuilderWorkspace> {
  const normalizedId = id.trim();
  if (!normalizedId) return fail(workspace, diagnostic("BUILDER_INSPECTOR_ID_REQUIRED", "Resource id must not be empty."));
  const label = input.label.trim();
  const type = input.type.trim();
  if (!label || !type) return fail(workspace, diagnostic("BUILDER_INSPECTOR_RESOURCE_REQUIRED", "Resource id, label and type are required.", normalizedId));
  const properties = parseJsonObject(workspace, input.propertiesJson, "BUILDER_INSPECTOR_PROPERTIES_JSON", normalizedId);
  if (!("value" in properties)) return properties;
  const interfaces = parseInterfaces(workspace, input.interfacesJson, normalizedId);
  if (!("value" in interfaces)) return interfaces;
  const zone = trimOptional(input.zone);
  const profile = trimOptional(input.profile);
  const vendor = trimOptional(input.vendor);
  const product = trimOptional(input.product);
  return addResource(workspace, {
    id: normalizedId,
    label,
    type,
    properties: properties.value,
    interfaces: interfaces.value ?? [],
    ...(zone ? { zone } : {}),
    ...(profile ? { profile } : {}),
    ...(vendor ? { vendor } : {}),
    ...(product ? { product } : {}),
  });
}

export function createConnectionFromInspector(workspace: BuilderWorkspace, id: string, input: ConnectionInspectorInput): BrowserCommandResult<BuilderWorkspace> {
  const normalizedId = id.trim();
  if (!normalizedId) return fail(workspace, diagnostic("BUILDER_INSPECTOR_ID_REQUIRED", "Connection id must not be empty."));
  return applyConnectionInspector(workspace, normalizedId, input);
}

export function duplicateSelectedBuilderResource(workspace: BuilderWorkspace, newId: string, newLabel?: string): BrowserCommandResult<BuilderWorkspace> {
  const selected = workspace.selection.primary;
  if (!selected || !workspace.source.resources.some((item) => item.id === selected)) {
    return fail(workspace, diagnostic("BUILDER_INSPECTOR_RESOURCE_SELECTION_REQUIRED", "Select a resource before duplicating."));
  }
  return duplicateResource(workspace, selected, newId.trim(), newLabel?.trim());
}

export function deleteSelectedBuilderObject(workspace: BuilderWorkspace, cascade = false): BrowserCommandResult<BuilderWorkspace> {
  const selected = workspace.selection.primary;
  if (!selected) return fail(workspace, diagnostic("BUILDER_INSPECTOR_SELECTION_REQUIRED", "Select a topology object before deleting."));
  if (workspace.source.zones.some((item) => item.id === selected)) return deleteZone(workspace, selected, cascade);
  if (workspace.source.resources.some((item) => item.id === selected)) return deleteResource(workspace, selected, cascade);
  if (workspace.source.connections.some((item) => item.id === selected)) return deleteConnection(workspace, selected);
  return fail(workspace, diagnostic("BUILDER_INSPECTOR_SELECTION_UNKNOWN", `Selected object '${selected}' no longer exists.`, selected));
}

export function builderInspectorSelectionKind(workspace: BuilderWorkspace): "zone" | "resource" | "connection" | "mission" {
  const selected = workspace.selection.primary;
  if (!selected) return "mission";
  if (workspace.source.zones.some((item) => item.id === selected)) return "zone";
  if (workspace.source.resources.some((item) => item.id === selected)) return "resource";
  if (workspace.source.connections.some((item) => item.id === selected)) return "connection";
  return "mission";
}

export function inspectorSourceSnapshot(workspace: BuilderWorkspace): ScenarioSource {
  return workspace.source;
}
