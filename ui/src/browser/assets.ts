import type { AssetDefinition } from "../../../compiler/src/types.js";
import type { BrowserCommandResult, BrowserDiagnostic, BuilderWorkspace } from "./types.js";
import { replaceResource } from "./builder.js";

export interface BuilderAssetPaletteItem {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly path: string;
  readonly mime: "image/svg+xml" | "image/png";
  readonly appliesTo: readonly string[];
  readonly compatibleWithSelection: boolean;
}

export interface BuilderAssetLibraryModel {
  readonly selectedResourceId?: string;
  readonly explicitAssetId?: string;
  readonly explicitAssetVersion?: string;
  readonly items: readonly BuilderAssetPaletteItem[];
}

function diagnostic(code: string, message: string, objectId?: string): BrowserDiagnostic {
  return objectId ? { severity: "error", code, message, objectId } : { severity: "error", code, message };
}

function applies(asset: AssetDefinition, resourceType: string): boolean {
  return asset.appliesTo.some((pattern) => pattern === "*" || pattern === resourceType || (pattern.endsWith(".*") && resourceType.startsWith(pattern.slice(0, -1))));
}

function selectedResource(workspace: BuilderWorkspace) {
  const id = workspace.selection.primary;
  return id ? workspace.source.resources.find((resource) => resource.id === id) : undefined;
}

export function buildBuilderAssetLibraryModel(workspace: BuilderWorkspace, assets: readonly AssetDefinition[]): BuilderAssetLibraryModel {
  const resource = selectedResource(workspace);
  return {
    ...(resource ? { selectedResourceId: resource.id } : {}),
    ...(resource?.asset ? { explicitAssetId: resource.asset.id, explicitAssetVersion: resource.asset.version } : {}),
    items: assets
      .filter((asset) => asset.trusted && asset.path.startsWith("assets/builtin/"))
      .map((asset) => ({
        id: asset.id,
        version: asset.version,
        label: asset.label,
        path: asset.path,
        mime: asset.mime,
        appliesTo: [...asset.appliesTo],
        compatibleWithSelection: resource ? applies(asset, resource.type) : false,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "en") || a.id.localeCompare(b.id, "en") || a.version.localeCompare(b.version, "en")),
  };
}

export function applyAssetToSelectedResource(
  workspace: BuilderWorkspace,
  asset: AssetDefinition,
): BrowserCommandResult<BuilderWorkspace> {
  const resource = selectedResource(workspace);
  if (!resource) return { ok: false, workspace, diagnostics: [diagnostic("BUILDER_ASSET_RESOURCE_REQUIRED", "Select a resource before applying an asset.")] };
  if (!asset.trusted || !asset.path.startsWith("assets/builtin/")) {
    return { ok: false, workspace, diagnostics: [diagnostic("BUILDER_ASSET_UNTRUSTED", `Asset '${asset.id}@${asset.version}' is not a trusted built-in asset.`, resource.id)] };
  }
  if (!applies(asset, resource.type)) {
    return { ok: false, workspace, diagnostics: [diagnostic("BUILDER_ASSET_TYPE_MISMATCH", `Asset '${asset.id}' does not apply to resource type '${resource.type}'.`, resource.id)] };
  }
  return replaceResource(workspace, { ...resource, asset: { id: asset.id, version: asset.version } });
}

export function clearAssetFromSelectedResource(workspace: BuilderWorkspace): BrowserCommandResult<BuilderWorkspace> {
  const resource = selectedResource(workspace);
  if (!resource) return { ok: false, workspace, diagnostics: [diagnostic("BUILDER_ASSET_RESOURCE_REQUIRED", "Select a resource before clearing an explicit asset.")] };
  const next = { ...resource } as typeof resource & { asset?: typeof resource.asset };
  delete next.asset;
  return replaceResource(workspace, next);
}
