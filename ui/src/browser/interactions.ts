import type { Scenariosourceconnection } from "../../../core-model/src/generated/contracts.js";
import { setBuilderSelection, setLayoutOverride, upsertConnection } from "./builder.js";
import type { BrowserCommandResult, BrowserDiagnostic, BuilderWorkspace } from "./types.js";

export interface BuilderCanvasSelectionInput {
  readonly nodeIds?: readonly string[];
  readonly edgeIds?: readonly string[];
  readonly primary?: string;
}

export interface BuilderZoneResizeInput {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BuilderCanvasConnectionInput {
  readonly source: string | null | undefined;
  readonly target: string | null | undefined;
  readonly sourceHandle?: string | null;
  readonly targetHandle?: string | null;
  readonly kind?: Scenariosourceconnection["kind"];
}

const MIN_ZONE_WIDTH = 240;
const MIN_ZONE_HEIGHT = 160;
const MAX_ZONE_DIMENSION = 10000;

function error(code: string, message: string, objectId?: string): BrowserDiagnostic {
  return objectId ? { severity: "error", code, message, objectId } : { severity: "error", code, message };
}

function failure(workspace: BuilderWorkspace, diagnostic: BrowserDiagnostic): BrowserCommandResult<BuilderWorkspace> {
  return { ok: false, workspace, diagnostics: [diagnostic] };
}

function allSemanticIds(workspace: BuilderWorkspace): ReadonlySet<string> {
  return new Set([
    ...workspace.source.zones.map((item) => item.id),
    ...workspace.source.resources.map((item) => item.id),
    ...workspace.source.connections.map((item) => item.id),
  ]);
}

export function applyBuilderCanvasSelection(
  workspace: BuilderWorkspace,
  input: BuilderCanvasSelectionInput,
): BuilderWorkspace {
  const ids = [...(input.nodeIds ?? []), ...(input.edgeIds ?? [])];
  const known = allSemanticIds(workspace);
  const primary = input.primary && known.has(input.primary) ? input.primary : undefined;
  return setBuilderSelection(workspace, ids, primary);
}

export function resizeBuilderZone(
  workspace: BuilderWorkspace,
  input: BuilderZoneResizeInput,
): BrowserCommandResult<BuilderWorkspace> {
  const zone = workspace.source.zones.find((item) => item.id === input.id);
  if (!zone) {
    return failure(workspace, error("BUILDER_RESIZE_ZONE_REQUIRED", `Only semantic zones can be resized; '${input.id}' is not a zone.`, input.id));
  }
  const values = [input.x, input.y, input.width, input.height];
  if (values.some((value) => !Number.isFinite(value))) {
    return failure(workspace, error("BUILDER_RESIZE_NONFINITE", "Zone resize values must be finite numbers.", input.id));
  }
  if (input.width < MIN_ZONE_WIDTH || input.height < MIN_ZONE_HEIGHT) {
    return failure(workspace, error("BUILDER_RESIZE_TOO_SMALL", `Zone dimensions must be at least ${MIN_ZONE_WIDTH}x${MIN_ZONE_HEIGHT}.`, input.id));
  }
  if (input.width > MAX_ZONE_DIMENSION || input.height > MAX_ZONE_DIMENSION) {
    return failure(workspace, error("BUILDER_RESIZE_TOO_LARGE", `Zone dimensions must not exceed ${MAX_ZONE_DIMENSION}px.`, input.id));
  }
  const next = setLayoutOverride(workspace, {
    id: input.id,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
  });
  return { ok: true, workspace: next, diagnostics: [] };
}

function interfaceIdFromHandle(handle: string | null | undefined, direction: "source" | "target"): string | undefined {
  if (!handle) return undefined;
  const prefix = direction === "source" ? "out:" : "in:";
  if (!handle.startsWith(prefix)) return undefined;
  const value = handle.slice(prefix.length).trim();
  return value || undefined;
}

function hasInterface(workspace: BuilderWorkspace, resourceId: string, interfaceId: string | undefined): boolean {
  if (!interfaceId) return true;
  return workspace.source.resources.find((item) => item.id === resourceId)?.interfaces?.some((item) => item.id === interfaceId) ?? false;
}

function nextConnectionId(workspace: BuilderWorkspace): string {
  const used = new Set([
    ...workspace.source.zones.map((item) => item.id),
    ...workspace.source.resources.map((item) => item.id),
    ...workspace.source.connections.map((item) => item.id),
    ...workspace.source.tests.map((item) => item.id),
    ...workspace.source.findings.map((item) => item.id),
    ...workspace.source.objectives.map((item) => item.id),
  ]);
  for (let sequence = 1; sequence <= 999999; sequence += 1) {
    const id = `connection_${String(sequence).padStart(3, "0")}`;
    if (!used.has(id)) return id;
  }
  throw new Error("Could not allocate a deterministic connection id.");
}

export function createBuilderConnectionFromCanvas(
  workspace: BuilderWorkspace,
  input: BuilderCanvasConnectionInput,
): BrowserCommandResult<BuilderWorkspace> {
  const source = input.source?.trim();
  const target = input.target?.trim();
  if (!source || !target) {
    return failure(workspace, error("BUILDER_CONNECT_ENDPOINT_REQUIRED", "Interactive connection creation requires source and target resources."));
  }
  const resources = new Set(workspace.source.resources.map((item) => item.id));
  if (!resources.has(source) || !resources.has(target)) {
    return failure(workspace, error("BUILDER_CONNECT_RESOURCE_UNKNOWN", "Interactive connections may only join existing resources."));
  }
  if (source === target) {
    return failure(workspace, error("BUILDER_CONNECT_SELF", "Interactive self-connections are not created implicitly; use the typed inspector if the scenario intentionally requires one.", source));
  }
  const sourcePort = interfaceIdFromHandle(input.sourceHandle, "source");
  const targetPort = interfaceIdFromHandle(input.targetHandle, "target");
  if (input.sourceHandle && !sourcePort && input.sourceHandle !== "generic-out") {
    return failure(workspace, error("BUILDER_CONNECT_SOURCE_HANDLE_INVALID", `Unsupported source handle '${input.sourceHandle}'.`, source));
  }
  if (input.targetHandle && !targetPort && input.targetHandle !== "generic-in") {
    return failure(workspace, error("BUILDER_CONNECT_TARGET_HANDLE_INVALID", `Unsupported target handle '${input.targetHandle}'.`, target));
  }
  if (!hasInterface(workspace, source, sourcePort)) {
    return failure(workspace, error("BUILDER_CONNECT_SOURCE_INTERFACE_UNKNOWN", `Resource '${source}' has no interface '${sourcePort}'.`, source));
  }
  if (!hasInterface(workspace, target, targetPort)) {
    return failure(workspace, error("BUILDER_CONNECT_TARGET_INTERFACE_UNKNOWN", `Resource '${target}' has no interface '${targetPort}'.`, target));
  }

  const connection: Scenariosourceconnection = {
    id: nextConnectionId(workspace),
    kind: input.kind ?? "network",
    from: { resource: source, ...(sourcePort ? { port: sourcePort } : {}) },
    to: { resource: target, ...(targetPort ? { port: targetPort } : {}) },
    properties: {},
  };
  const result = upsertConnection(workspace, connection);
  if (!result.ok) return result;
  return {
    ok: true,
    workspace: setBuilderSelection(result.workspace, [connection.id], connection.id),
    diagnostics: [],
  };
}

export const BUILDER_ZONE_RESIZE_LIMITS = Object.freeze({
  minWidth: MIN_ZONE_WIDTH,
  minHeight: MIN_ZONE_HEIGHT,
  maxDimension: MAX_ZONE_DIMENSION,
});
