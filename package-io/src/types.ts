import type { NormalizedScenario, PackageManifest } from "../../core-model/src/generated/contracts.js";

export interface PackageReadLimits {
  readonly maxFiles: number;
  readonly maxCompressedBytes: number;
  readonly maxDecompressedBytes: number;
  readonly maxSingleFileBytes: number;
  readonly maxCompressionRatio: number;
}

export interface ArchiveEntryDescriptor {
  readonly path: string;
  readonly directory: boolean;
  readonly compressedSize?: number;
  readonly uncompressedSize?: number;
  read(): Promise<Uint8Array>;
}

export interface ArchiveWriteEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface ArchiveReadSession {
  readonly entries: readonly ArchiveEntryDescriptor[];
  close(): Promise<void>;
}

export interface ArchiveBackend {
  open(input: Blob): Promise<ArchiveReadSession>;
  write(entries: readonly ArchiveWriteEntry[]): Promise<Blob>;
}

export interface PackageManifestValidation {
  readonly valid: boolean;
  readonly diagnostics?: readonly string[];
}

export type PackageManifestValidator = (input: unknown) => PackageManifestValidation;

export interface PackageAssetInput {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly mime: string;
}

export interface PackageDocumentInput {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly mime: string;
}

export interface PackageBuildOptions {
  readonly distribution: "author" | "student";
  readonly layout?: unknown;
  readonly assets?: readonly PackageAssetInput[];
  readonly docs?: readonly PackageDocumentInput[];
  readonly packageVersion?: string;
}

export interface PackageFile {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly mime: string;
}

export interface PackageReadResult {
  readonly manifest: PackageManifest;
  readonly manifestBytes: Uint8Array;
  readonly scenario: NormalizedScenario;
  readonly solution?: unknown;
  readonly layout?: unknown;
  readonly files: ReadonlyMap<string, PackageFile>;
}

export interface PackageIO {
  read(input: Blob, limits: PackageReadLimits): Promise<PackageReadResult>;
  write(scenario: NormalizedScenario, options: PackageBuildOptions): Promise<Blob>;
}
