import { PackageIOError } from "./errors.js";

const TOP_LEVEL_FILES = new Set(["manifest.json", "scenario.json", "layout.json", "tests.json", "solution.json"]);
const MIME_BY_EXTENSION: Readonly<Record<string, readonly string[]>> = {
  ".json": ["application/json"],
  ".md": ["text/markdown", "text/plain"],
  ".txt": ["text/plain"],
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".webp": ["image/webp"],
  ".svg": ["image/svg+xml"],
};

function extension(path: string): string {
  const name = path.split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

export function validatePackagePath(path: string): void {
  if (path.length === 0) throw new PackageIOError("PACKAGE_PATH_EMPTY", "Package path is empty.", path);
  if (path.length > 512) throw new PackageIOError("PACKAGE_PATH_TOO_LONG", "Package path exceeds 512 characters.", path);
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) throw new PackageIOError("PACKAGE_PATH_ABSOLUTE", `Absolute package path '${path}' is forbidden.`, path);
  if (path.includes("\\")) throw new PackageIOError("PACKAGE_PATH_BACKSLASH", `Backslashes are forbidden in package path '${path}'.`, path);
  if (/[%](?:2e|2f|5c)/i.test(path)) throw new PackageIOError("PACKAGE_PATH_ENCODED_TRAVERSAL", `Encoded traversal/separator sequence is forbidden in '${path}'.`, path);
  if (/[\u0000-\u001f\u007f]/.test(path)) throw new PackageIOError("PACKAGE_PATH_CONTROL", `Control characters are forbidden in '${path}'.`, path);
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new PackageIOError("PACKAGE_PATH_TRAVERSAL", `Unsafe path segment in '${path}'.`, path);
  }
  const top = segments[0];
  if (segments.length === 1) {
    if (!TOP_LEVEL_FILES.has(path)) throw new PackageIOError("PACKAGE_PATH_ROOT_NOT_ALLOWED", `Top-level file '${path}' is not allowed.`, path);
  } else if (top !== "assets" && top !== "docs") {
    throw new PackageIOError("PACKAGE_PATH_ROOT_NOT_ALLOWED", `Package path '${path}' must be under assets/ or docs/.`, path);
  }
}

export function validateMimeForPath(path: string, mime: string): void {
  validatePackagePath(path);
  const ext = extension(path);
  const allowed = MIME_BY_EXTENSION[ext];
  if (!allowed || !allowed.includes(mime)) {
    throw new PackageIOError("PACKAGE_MIME_NOT_ALLOWED", `MIME '${mime}' is not allowed for '${path}'.`, path);
  }
  if (path.startsWith("assets/") && !mime.startsWith("image/")) {
    throw new PackageIOError("PACKAGE_ASSET_MIME_INVALID", `Asset '${path}' must be an allowed image type.`, path);
  }
  if (path.startsWith("docs/") && mime !== "text/markdown" && mime !== "text/plain") {
    throw new PackageIOError("PACKAGE_DOC_MIME_INVALID", `Document '${path}' must be Markdown or plain text in Foundation.`, path);
  }
}

export function assertNoDuplicatePaths(paths: readonly string[]): void {
  const exact = new Set<string>();
  const folded = new Set<string>();
  for (const path of paths) {
    validatePackagePath(path);
    if (exact.has(path)) throw new PackageIOError("PACKAGE_DUPLICATE_PATH", `Duplicate package path '${path}'.`, path);
    const lower = path.toLocaleLowerCase("en-US");
    if (folded.has(lower)) throw new PackageIOError("PACKAGE_CASE_COLLISION", `Case-colliding package path '${path}'.`, path);
    exact.add(path);
    folded.add(lower);
  }
}
