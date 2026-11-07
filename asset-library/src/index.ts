import type { NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import type { AssetDefinition } from "../../compiler/src/types.js";

export interface AssetRenderDescriptor {
  readonly id: string;
  readonly version: string;
  readonly path: string;
  readonly mime: "image/svg+xml" | "image/png";
  readonly width: number;
  readonly height: number;
  readonly trusted: true;
  readonly objectFit: "contain";
}

export interface AssetPaletteItem {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly path: string;
  readonly mime: "image/svg+xml" | "image/png";
  readonly appliesTo: readonly string[];
  readonly width: number;
  readonly height: number;
}

export type AssetResolution =
  | { readonly ok: true; readonly asset: AssetRenderDescriptor }
  | { readonly ok: false; readonly code: "ASSET_LOCK_MISSING" | "ASSET_LOCK_DUPLICATE" | "ASSET_LOCK_UNTRUSTED" | "ASSET_LOCK_PATH_INVALID" | "ASSET_LOCK_MIME_INVALID"; readonly message: string };

export function safeBuiltinAssetPath(path: string): boolean {
  return /^assets\/builtin\/[a-z0-9_.-]+\.(?:svg|png)$/.test(path) && !path.includes("..") && !path.includes("\\");
}

export function buildAssetPalette(assets: readonly AssetDefinition[]): readonly AssetPaletteItem[] {
  return assets
    .filter((asset) => asset.trusted && safeBuiltinAssetPath(asset.path))
    .map((asset) => ({
      id: asset.id,
      version: asset.version,
      label: asset.label,
      path: asset.path,
      mime: asset.mime,
      appliesTo: [...asset.appliesTo],
      width: asset.width,
      height: asset.height,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "en") || a.id.localeCompare(b.id, "en") || a.version.localeCompare(b.version, "en"));
}

export function resolveResourceAsset(
  scenario: NormalizedScenario,
  resource: NormalizedScenario["resources"][number],
): AssetResolution {
  const matches = scenario.assetLocks.filter((lock) => lock.id === resource.asset.id && lock.version === resource.asset.version);
  if (matches.length === 0) {
    return { ok: false, code: "ASSET_LOCK_MISSING", message: `Resource '${resource.id}' references missing asset lock '${resource.asset.id}@${resource.asset.version}'.` };
  }
  if (matches.length !== 1) {
    return { ok: false, code: "ASSET_LOCK_DUPLICATE", message: `Asset lock '${resource.asset.id}@${resource.asset.version}' occurs ${matches.length} times.` };
  }
  const lock = matches[0]!;
  if (lock.trusted !== true) return { ok: false, code: "ASSET_LOCK_UNTRUSTED", message: `Built-in asset lock '${lock.id}@${lock.version}' is not trusted.` };
  if (!safeBuiltinAssetPath(lock.path)) return { ok: false, code: "ASSET_LOCK_PATH_INVALID", message: `Built-in asset path '${lock.path}' is unsafe.` };
  if ((lock.mime === "image/svg+xml" && !lock.path.endsWith(".svg")) || (lock.mime === "image/png" && !lock.path.endsWith(".png"))) {
    return { ok: false, code: "ASSET_LOCK_MIME_INVALID", message: `Asset MIME '${lock.mime}' does not match '${lock.path}'.` };
  }
  return {
    ok: true,
    asset: {
      id: lock.id,
      version: lock.version,
      path: lock.path,
      mime: lock.mime,
      width: lock.width,
      height: lock.height,
      trusted: true,
      objectFit: "contain",
    },
  };
}
