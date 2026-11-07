import type { ArchiveBackend, ArchiveEntryDescriptor, ArchiveReadSession } from "../../package-io/src/types.js";
import { ZipJsArchiveBackend } from "../../package-io/src/zipjs-backend.js";
import { EnterpriseImportError } from "./types.js";

export interface WorkbookArchiveLimits {
  readonly maxFiles: number;
  readonly maxCompressedBytes: number;
  readonly maxDecompressedBytes: number;
  readonly maxSingleFileBytes: number;
  readonly maxCompressionRatio: number;
}

export const DEFAULT_WORKBOOK_LIMITS: WorkbookArchiveLimits = {
  maxFiles: 2048,
  maxCompressedBytes: 128 * 1024 * 1024,
  maxDecompressedBytes: 256 * 1024 * 1024,
  maxSingleFileBytes: 32 * 1024 * 1024,
  maxCompressionRatio: 100,
};

export interface SafeWorkbookArchive {
  readonly paths: readonly string[];
  has(path: string): boolean;
  read(path: string): Promise<Uint8Array>;
  close(): Promise<void>;
}

function fail(code: string, message: string): never { throw new EnterpriseImportError(code, message); }

function validatePath(path: string): void {
  if (!path || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) fail("IMPORT_ARCHIVE_PATH_INVALID", `Unsafe workbook archive path: ${path}`);
  const parts = path.split("/");
  if (parts.some((x) => x === "" || x === "." || x === "..")) fail("IMPORT_ARCHIVE_PATH_INVALID", `Unsafe workbook archive path: ${path}`);
}

function ratio(entry: ArchiveEntryDescriptor): number | undefined {
  if (entry.compressedSize === undefined || entry.uncompressedSize === undefined) return undefined;
  if (entry.uncompressedSize === 0) return 1;
  if (entry.compressedSize <= 0) return Number.POSITIVE_INFINITY;
  return entry.uncompressedSize / entry.compressedSize;
}

class SafeArchive implements SafeWorkbookArchive {
  readonly paths: readonly string[];
  private readonly byPath = new Map<string, ArchiveEntryDescriptor>();
  constructor(private readonly session: ArchiveReadSession, private readonly limits: WorkbookArchiveLimits) {
    const files = session.entries.filter((x) => !x.directory);
    if (files.length > limits.maxFiles) fail("IMPORT_ARCHIVE_TOO_MANY_FILES", `Workbook archive contains ${files.length} files; limit is ${limits.maxFiles}.`);
    let compressed = 0, decompressed = 0;
    for (const entry of files) {
      validatePath(entry.path);
      if (this.byPath.has(entry.path)) fail("IMPORT_ARCHIVE_DUPLICATE_PATH", `Workbook archive contains duplicate path ${entry.path}.`);
      if (entry.uncompressedSize !== undefined) {
        if (entry.uncompressedSize > limits.maxSingleFileBytes) fail("IMPORT_ARCHIVE_FILE_TOO_LARGE", `Workbook member ${entry.path} exceeds the per-file limit.`);
        decompressed += entry.uncompressedSize;
      }
      if (entry.compressedSize !== undefined) compressed += entry.compressedSize;
      const r = ratio(entry);
      if (r !== undefined && r > limits.maxCompressionRatio) fail("IMPORT_ARCHIVE_COMPRESSION_RATIO", `Workbook member ${entry.path} exceeds the compression-ratio limit.`);
      this.byPath.set(entry.path, entry);
    }
    if (compressed > limits.maxCompressedBytes) fail("IMPORT_ARCHIVE_COMPRESSED_TOO_LARGE", "Workbook archive exceeds the compressed-size limit.");
    if (decompressed > limits.maxDecompressedBytes) fail("IMPORT_ARCHIVE_DECOMPRESSED_TOO_LARGE", "Workbook archive exceeds the decompressed-size limit.");
    this.paths = Object.freeze([...this.byPath.keys()].sort((a, b) => a.localeCompare(b, "en")));
  }
  has(path: string): boolean { return this.byPath.has(path); }
  async read(path: string): Promise<Uint8Array> {
    const entry = this.byPath.get(path);
    if (!entry) fail("IMPORT_ARCHIVE_MEMBER_MISSING", `Workbook archive member ${path} is missing.`);
    const bytes = await entry.read();
    if (bytes.byteLength > this.limits.maxSingleFileBytes) fail("IMPORT_ARCHIVE_FILE_TOO_LARGE", `Workbook member ${path} exceeds the per-file limit after decompression.`);
    if (entry.uncompressedSize !== undefined && bytes.byteLength !== entry.uncompressedSize) fail("IMPORT_ARCHIVE_SIZE_MISMATCH", `Workbook member ${path} size does not match archive metadata.`);
    return bytes;
  }
  close(): Promise<void> { return this.session.close(); }
}

export async function openSafeWorkbookArchive(bytes: Uint8Array, backend: ArchiveBackend, limits: WorkbookArchiveLimits = DEFAULT_WORKBOOK_LIMITS): Promise<SafeWorkbookArchive> {
  let session: ArchiveReadSession;
  try { session = await backend.open(new Blob([Uint8Array.from(bytes)])); }
  catch (error) { throw new EnterpriseImportError("IMPORT_WORKBOOK_ARCHIVE_INVALID", `Workbook ZIP container could not be opened: ${error instanceof Error ? error.message : String(error)}`); }
  try { return new SafeArchive(session, limits); }
  catch (error) { await session.close().catch(() => {}); throw error; }
}

export function productionWorkbookArchiveBackend(): ArchiveBackend { return new ZipJsArchiveBackend(); }

export function normalizeArchiveTarget(baseFile: string, target: string): string {
  if (!target || target.includes("\\") || /^[A-Za-z]+:/.test(target)) fail("IMPORT_WORKBOOK_RELATIONSHIP_TARGET_INVALID", `Unsafe workbook relationship target: ${target}`);
  const base = baseFile.split("/").slice(0, -1);
  const parts = target.startsWith("/") ? [] : [...base];
  for (const part of target.replace(/^\/+/, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (parts.length === 0) fail("IMPORT_WORKBOOK_RELATIONSHIP_TARGET_INVALID", `Relationship target escapes package root: ${target}`); parts.pop(); }
    else parts.push(part);
  }
  const out = parts.join("/");
  validatePath(out);
  return out;
}
