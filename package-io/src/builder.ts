import type { NormalizedScenario, PackageManifest } from "../../core-model/src/generated/contracts.js";
import { PackageIOError } from "./errors.js";
import { sha256Hex } from "./hash.js";
import { encodeJson } from "./json.js";
import { assertNoDuplicatePaths, validateMimeForPath } from "./safety.js";
import { isCustomSvgPath, sanitizeCustomSvg } from "./svg-sanitizer.js";
import { validateRasterAsset } from "./raster-validator.js";
import type { ArchiveBackend, ArchiveWriteEntry, PackageBuildOptions, PackageFile } from "./types.js";

function withoutCanonicalSolution(scenario: NormalizedScenario): Omit<NormalizedScenario, "canonicalSolution"> {
  const { canonicalSolution: _solution, ...rest } = scenario;
  return rest;
}

function addFile(files: PackageFile[], file: PackageFile): void {
  validateMimeForPath(file.path, file.mime);
  const bytes = isCustomSvgPath(file.path, file.mime) ? sanitizeCustomSvg(file.bytes, file.path) : new Uint8Array(file.bytes);
  validateRasterAsset(bytes, file.path, file.mime);
  files.push({ ...file, bytes });
}

export async function buildScenarioPackage(
  backend: ArchiveBackend,
  scenario: NormalizedScenario,
  options: PackageBuildOptions,
): Promise<Blob> {
  const packageVersion = options.packageVersion ?? "0.1.0";
  const files: PackageFile[] = [];

  addFile(files, {
    path: "scenario.json",
    bytes: encodeJson(withoutCanonicalSolution(scenario)),
    mime: "application/json",
  });

  if (options.layout !== undefined) {
    addFile(files, { path: "layout.json", bytes: encodeJson(options.layout), mime: "application/json" });
  }

  if (options.distribution === "author" && scenario.canonicalSolution !== undefined) {
    addFile(files, { path: "solution.json", bytes: encodeJson(scenario.canonicalSolution), mime: "application/json" });
  }

  for (const asset of options.assets ?? []) {
    if (!asset.path.startsWith("assets/")) throw new PackageIOError("PACKAGE_ASSET_PATH_INVALID", `Asset '${asset.path}' must be under assets/.`, asset.path);
    addFile(files, asset);
  }
  for (const doc of options.docs ?? []) {
    if (!doc.path.startsWith("docs/")) throw new PackageIOError("PACKAGE_DOC_PATH_INVALID", `Document '${doc.path}' must be under docs/.`, doc.path);
    addFile(files, doc);
  }

  files.sort((a, b) => a.path.localeCompare(b.path, "en"));
  assertNoDuplicatePaths(files.map((file) => file.path));

  const manifestFiles = [];
  for (const file of files) {
    manifestFiles.push({
      path: file.path,
      size: file.bytes.byteLength,
      sha256: await sha256Hex(file.bytes),
      mime: file.mime,
    });
  }

  const manifest: PackageManifest = {
    formatId: "infrastructure-cyber-lab.package",
    packageVersion,
    distribution: options.distribution,
    scenarioId: scenario.scenarioId,
    scenarioHash: scenario.sourceHash,
    schemaVersion: scenario.schemaVersion,
    minimumEngineVersion: scenario.minimumEngineVersion,
    entrypoint: "scenario.json",
    integrityAlgorithm: "sha256",
    capabilityLocks: scenario.capabilityLocks,
    profileLocks: scenario.profileLocks,
    assetLocks: scenario.assetLocks.map((x) => ({ id: x.id, version: x.version })),
    files: manifestFiles,
  };

  const archiveEntries: ArchiveWriteEntry[] = [
    { path: "manifest.json", bytes: encodeJson(manifest) },
    ...files.map((file) => ({ path: file.path, bytes: file.bytes })),
  ];
  return backend.write(archiveEntries);
}
