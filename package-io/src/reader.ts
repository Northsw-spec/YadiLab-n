import type { NormalizedScenario, PackageManifest } from "../../core-model/src/generated/contracts.js";
import { PackageIOError } from "./errors.js";
import { sha256Hex } from "./hash.js";
import { canonicalJson, decodeJson, isRecord } from "./json.js";
import { assertNoDuplicatePaths, validateMimeForPath, validatePackagePath } from "./safety.js";
import { isCustomSvgPath, sanitizeCustomSvg } from "./svg-sanitizer.js";
import { validateRasterAsset } from "./raster-validator.js";
import type {
  ArchiveBackend,
  ArchiveEntryDescriptor,
  PackageFile,
  PackageManifestValidator,
  PackageReadLimits,
  PackageReadResult,
} from "./types.js";

function exactJsonEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function findEntry(entries: readonly ArchiveEntryDescriptor[], path: string): ArchiveEntryDescriptor | undefined {
  return entries.find((entry) => entry.path === path);
}

function checkMetadataLimits(entries: readonly ArchiveEntryDescriptor[], input: Blob, limits: PackageReadLimits): void {
  if (input.size > limits.maxCompressedBytes) {
    throw new PackageIOError("PACKAGE_COMPRESSED_SIZE_LIMIT", `Package compressed size ${input.size} exceeds limit ${limits.maxCompressedBytes}.`);
  }
  if (entries.length > limits.maxFiles) throw new PackageIOError("PACKAGE_FILE_COUNT_LIMIT", `Package has ${entries.length} entries; limit is ${limits.maxFiles}.`);

  let knownCompressed = 0;
  let knownDecompressed = 0;
  for (const entry of entries) {
    validatePackagePath(entry.path);
    if (entry.directory) throw new PackageIOError("PACKAGE_DIRECTORY_ENTRY_NOT_ALLOWED", `Explicit directory entry '${entry.path}' is not allowed.`, entry.path);
    if (entry.uncompressedSize !== undefined) {
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) throw new PackageIOError("PACKAGE_SIZE_METADATA_INVALID", `Invalid uncompressed size for '${entry.path}'.`, entry.path);
      if (entry.uncompressedSize > limits.maxSingleFileBytes) throw new PackageIOError("PACKAGE_SINGLE_FILE_LIMIT", `Entry '${entry.path}' exceeds single-file limit.`, entry.path);
      knownDecompressed += entry.uncompressedSize;
    }
    if (entry.compressedSize !== undefined) {
      if (!Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 0) throw new PackageIOError("PACKAGE_SIZE_METADATA_INVALID", `Invalid compressed size for '${entry.path}'.`, entry.path);
      knownCompressed += entry.compressedSize;
      if ((entry.uncompressedSize ?? 0) > 0) {
        if (entry.compressedSize === 0 || (entry.uncompressedSize ?? 0) / entry.compressedSize > limits.maxCompressionRatio) {
          throw new PackageIOError("PACKAGE_COMPRESSION_RATIO_LIMIT", `Entry '${entry.path}' exceeds compression-ratio limit.`, entry.path);
        }
      }
    }
  }
  if (knownCompressed > limits.maxCompressedBytes) throw new PackageIOError("PACKAGE_COMPRESSED_SIZE_LIMIT", "Known compressed entry sizes exceed package limit.");
  if (knownDecompressed > limits.maxDecompressedBytes) throw new PackageIOError("PACKAGE_DECOMPRESSED_SIZE_LIMIT", "Known decompressed entry sizes exceed package limit.");
  assertNoDuplicatePaths(entries.map((entry) => entry.path));
}

function validateManifestCrossReferences(manifest: PackageManifest, scenario: NormalizedScenario): void {
  if (manifest.scenarioId !== scenario.scenarioId) throw new PackageIOError("PACKAGE_SCENARIO_ID_MISMATCH", "Manifest scenarioId does not match scenario.json.");
  if (manifest.scenarioHash !== scenario.sourceHash) throw new PackageIOError("PACKAGE_SCENARIO_HASH_MISMATCH", "Manifest scenarioHash does not match scenario.json sourceHash.");
  if (manifest.schemaVersion !== scenario.schemaVersion) throw new PackageIOError("PACKAGE_SCHEMA_VERSION_MISMATCH", "Manifest schemaVersion does not match scenario.json.");
  if (manifest.minimumEngineVersion !== scenario.minimumEngineVersion) throw new PackageIOError("PACKAGE_ENGINE_VERSION_MISMATCH", "Manifest minimumEngineVersion does not match scenario.json.");
  if (!exactJsonEqual(manifest.capabilityLocks, scenario.capabilityLocks)) throw new PackageIOError("PACKAGE_CAPABILITY_LOCK_MISMATCH", "Manifest capability locks do not match scenario.json.");
  if (!exactJsonEqual(manifest.profileLocks, scenario.profileLocks)) throw new PackageIOError("PACKAGE_PROFILE_LOCK_MISMATCH", "Manifest profile locks do not match scenario.json.");
  const scenarioAssetLocks = scenario.assetLocks.map((x) => ({ id: x.id, version: x.version }));
  if (!exactJsonEqual(manifest.assetLocks, scenarioAssetLocks)) throw new PackageIOError("PACKAGE_ASSET_LOCK_MISMATCH", "Manifest asset locks do not match scenario.json.");
}

export async function readScenarioPackage(
  backend: ArchiveBackend,
  manifestValidator: PackageManifestValidator,
  input: Blob,
  limits: PackageReadLimits,
): Promise<PackageReadResult> {
  const session = await backend.open(input);
  try {
    const entries = session.entries;
    checkMetadataLimits(entries, input, limits);
    const manifestEntry = findEntry(entries, "manifest.json");
    if (!manifestEntry) throw new PackageIOError("PACKAGE_MANIFEST_MISSING", "Package is missing manifest.json.");

    const manifestBytes = await manifestEntry.read();
    if (manifestBytes.byteLength > limits.maxSingleFileBytes) throw new PackageIOError("PACKAGE_SINGLE_FILE_LIMIT", "manifest.json exceeds single-file limit.", "manifest.json");
    let manifestInput: unknown;
    try {
      manifestInput = decodeJson(manifestBytes, "manifest.json");
    } catch (cause) {
      throw new PackageIOError("PACKAGE_MANIFEST_JSON_INVALID", `manifest.json is not valid UTF-8 JSON: ${cause instanceof Error ? cause.message : String(cause)}.`, "manifest.json");
    }
    const manifestValidation = manifestValidator(manifestInput);
    if (!manifestValidation.valid) {
      throw new PackageIOError("PACKAGE_MANIFEST_SCHEMA_INVALID", `manifest.json failed schema validation${manifestValidation.diagnostics?.length ? `: ${manifestValidation.diagnostics.join(" | ")}` : "."}`, "manifest.json");
    }
    const manifest = manifestInput as PackageManifest;
    assertNoDuplicatePaths(manifest.files.map((file) => file.path));
    if (manifest.files.some((file) => file.path === "manifest.json")) throw new PackageIOError("PACKAGE_MANIFEST_SELF_ENTRY", "manifest.json must not list itself in manifest.files.");

    const archivePaths = entries.map((entry) => entry.path).filter((path) => path !== "manifest.json").sort((a, b) => a.localeCompare(b, "en"));
    const manifestPaths = manifest.files.map((file) => file.path).sort((a, b) => a.localeCompare(b, "en"));
    if (!exactJsonEqual(archivePaths, manifestPaths)) throw new PackageIOError("PACKAGE_FILE_SET_MISMATCH", "Archive file set does not exactly match manifest.files.");

    const files = new Map<string, PackageFile>();
    let actualDecompressed = manifestBytes.byteLength;
    for (const fileEntry of manifest.files) {
      validatePackagePath(fileEntry.path);
      validateMimeForPath(fileEntry.path, fileEntry.mime);
      const archiveEntry = findEntry(entries, fileEntry.path);
      if (!archiveEntry) throw new PackageIOError("PACKAGE_FILE_MISSING", `Manifest file '${fileEntry.path}' is missing from archive.`, fileEntry.path);
      const bytes = await archiveEntry.read();
      actualDecompressed += bytes.byteLength;
      if (bytes.byteLength > limits.maxSingleFileBytes) throw new PackageIOError("PACKAGE_SINGLE_FILE_LIMIT", `File '${fileEntry.path}' exceeds single-file limit.`, fileEntry.path);
      if (actualDecompressed > limits.maxDecompressedBytes) throw new PackageIOError("PACKAGE_DECOMPRESSED_SIZE_LIMIT", "Actual decompressed content exceeds package limit.");
      if (bytes.byteLength !== fileEntry.size) throw new PackageIOError("PACKAGE_FILE_SIZE_MISMATCH", `File '${fileEntry.path}' size does not match manifest.`, fileEntry.path);
      const digest = await sha256Hex(bytes);
      if (digest !== fileEntry.sha256) throw new PackageIOError("PACKAGE_FILE_HASH_MISMATCH", `File '${fileEntry.path}' SHA-256 does not match manifest.`, fileEntry.path);
      const safeBytes = isCustomSvgPath(fileEntry.path, fileEntry.mime) ? sanitizeCustomSvg(bytes, fileEntry.path) : bytes;
      validateRasterAsset(safeBytes, fileEntry.path, fileEntry.mime);
      files.set(fileEntry.path, { path: fileEntry.path, bytes: safeBytes, mime: fileEntry.mime });
    }

    const scenarioFile = files.get("scenario.json");
    if (!scenarioFile) throw new PackageIOError("PACKAGE_SCENARIO_MISSING", "Package is missing scenario.json.");
    let scenarioInput: unknown;
    try {
      scenarioInput = decodeJson(scenarioFile.bytes, "scenario.json");
    } catch (cause) {
      throw new PackageIOError("PACKAGE_SCENARIO_JSON_INVALID", `scenario.json is invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}.`, "scenario.json");
    }
    if (!isRecord(scenarioInput)) throw new PackageIOError("PACKAGE_SCENARIO_INVALID", "scenario.json must contain a JSON object.", "scenario.json");
    if (Object.hasOwn(scenarioInput, "canonicalSolution")) throw new PackageIOError("PACKAGE_EMBEDDED_SOLUTION_FORBIDDEN", "scenario.json must not embed canonicalSolution; author solutions belong in solution.json.", "scenario.json");
    const scenario = scenarioInput as unknown as NormalizedScenario;
    validateManifestCrossReferences(manifest, scenario);

    if (manifest.distribution === "student" && files.has("solution.json")) {
      throw new PackageIOError("PACKAGE_STUDENT_SOLUTION_FORBIDDEN", "Student distribution contains solution.json.", "solution.json");
    }

    let solution: unknown;
    const solutionFile = files.get("solution.json");
    if (solutionFile) {
      try {
        solution = decodeJson(solutionFile.bytes, "solution.json");
      } catch (cause) {
        throw new PackageIOError("PACKAGE_SOLUTION_JSON_INVALID", `solution.json is invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}.`, "solution.json");
      }
    }

    let layout: unknown;
    const layoutFile = files.get("layout.json");
    if (layoutFile) {
      try {
        layout = decodeJson(layoutFile.bytes, "layout.json");
      } catch (cause) {
        throw new PackageIOError("PACKAGE_LAYOUT_JSON_INVALID", `layout.json is invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}.`, "layout.json");
      }
    }

    return {
      manifest,
      manifestBytes: new Uint8Array(manifestBytes),
      scenario,
      ...(solution !== undefined ? { solution } : {}),
      ...(layout !== undefined ? { layout } : {}),
      files,
    };
  } finally {
    await session.close();
  }
}
