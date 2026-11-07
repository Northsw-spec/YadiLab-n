/** Ephemeral image-only view of validated PackageIO assets.
 *  Package media never enters the scenario model, Engine state or save files.
 *  In particular, scenario SVG is not mounted as inline DOM/HTML.
 */
import { isCustomSvgPath, sanitizeCustomSvg, validateMimeForPath, validateRasterAsset } from "../../../package-io/src/index.js";
import type { PackageFile } from "../../../package-io/src/index.js";

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

export interface PackageImageUrlHost {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export interface PackageMediaImage {
  readonly path: string;
  readonly mime: string;
  readonly size: number;
  /** An ephemeral blob: URL; use ONLY as the src of a native <img>. */
  readonly objectUrl: string;
  readonly trust: "sanitized-untrusted" | "untrusted-raster";
}

export interface RuntimePackageMedia {
  readonly images: readonly PackageMediaImage[];
  /** Idempotent; call when leaving Runtime, loading a new package or unmounting. */
  release(): void;
}

/** Call only after SafePackageIO.read has completed and the Runtime compatibility
 *  gates have passed. Defense in depth repeats MIME/path and SVG checks. */
export function createRuntimePackageMedia(
  files: ReadonlyMap<string, PackageFile>,
  host: PackageImageUrlHost,
): RuntimePackageMedia {
  const images: PackageMediaImage[] = [];
  const urls: string[] = [];
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    for (const url of urls) {
      try { host.revokeObjectURL(url); } catch { /* best-effort browser resource cleanup */ }
    }
    urls.length = 0;
  };
  try {
    for (const [path, file] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b, "en"))) {
      if (!path.startsWith("assets/")) continue;
      // Prevent a spoofed MIME or dangerous path even in a synthetic read result.
      validateMimeForPath(path, file.mime);
      if (!IMAGE_MIMES.has(file.mime)) throw new Error(`Unsupported package image MIME '${file.mime}'.`);
      const isSvg = isCustomSvgPath(path, file.mime);
      const safeBytes = isSvg ? sanitizeCustomSvg(file.bytes, path) : file.bytes;
      validateRasterAsset(safeBytes, path, file.mime);
      const blob = new Blob([Uint8Array.from(safeBytes)], { type: file.mime });
      const url = host.createObjectURL(blob);
      if (typeof url !== "string" || !url.startsWith("blob:") || url.length > 4096) {
        if (typeof url === "string" && url.length > 0) {
          try { host.revokeObjectURL(url); } catch { /* untrusted host */ }
        }
        throw new Error("Package image URL host did not create a local blob: URL.");
      }
      urls.push(url);
      images.push({
        path,
        mime: file.mime,
        size: safeBytes.byteLength,
        objectUrl: url,
        trust: isSvg ? "sanitized-untrusted" : "untrusted-raster",
      });
    }
    return { images, release };
  } catch (error) {
    release();
    throw error;
  }
}
