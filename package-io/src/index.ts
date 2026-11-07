import type { NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import { buildScenarioPackage } from "./builder.js";
import { readScenarioPackage } from "./reader.js";
import type { ArchiveBackend, PackageBuildOptions, PackageIO, PackageManifestValidator, PackageReadLimits, PackageReadResult } from "./types.js";

export const DEFAULT_PACKAGE_LIMITS: PackageReadLimits = {
  maxFiles: 512,
  maxCompressedBytes: 64 * 1024 * 1024,
  maxDecompressedBytes: 256 * 1024 * 1024,
  maxSingleFileBytes: 32 * 1024 * 1024,
  maxCompressionRatio: 100,
};

export class SafePackageIO implements PackageIO {
  constructor(
    private readonly backend: ArchiveBackend,
    private readonly manifestValidator: PackageManifestValidator,
  ) {}

  read(input: Blob, limits: PackageReadLimits = DEFAULT_PACKAGE_LIMITS): Promise<PackageReadResult> {
    return readScenarioPackage(this.backend, this.manifestValidator, input, limits);
  }

  write(scenario: NormalizedScenario, options: PackageBuildOptions): Promise<Blob> {
    return buildScenarioPackage(this.backend, scenario, options);
  }
}

export { PackageIOError } from "./errors.js";
export { sha256Hex } from "./hash.js";
export { canonicalJson, decodeJson, encodeJson, isRecord } from "./json.js";
export { assertNoDuplicatePaths, validateMimeForPath, validatePackagePath } from "./safety.js";
export { sanitizeCustomSvg, isCustomSvgPath } from "./svg-sanitizer.js";
export { validateRasterAsset } from "./raster-validator.js";
export { buildScenarioPackage } from "./builder.js";
export { readScenarioPackage } from "./reader.js";
export { ZipJsArchiveBackend } from "./zipjs-backend.js";
export { MemoryArchiveBackend } from "./memory-backend.js";
export type { MemoryArchiveRecord } from "./memory-backend.js";
export type {
  ArchiveBackend,
  ArchiveEntryDescriptor,
  ArchiveReadSession,
  ArchiveWriteEntry,
  PackageAssetInput,
  PackageBuildOptions,
  PackageDocumentInput,
  PackageFile,
  PackageIO,
  PackageManifestValidation,
  PackageManifestValidator,
  PackageReadLimits,
  PackageReadResult,
} from "./types.js";
