import type { LayoutDocument, PackageManifest } from "../../../core-model/src/generated/contracts.js";
import { BUILTIN_CAPABILITY_PACK_REGISTRY } from "../../../capability-packs/src/index.js";
import type { CapabilityPackRegistry, CapabilityPackRuntimeDescriptor } from "../../../capability-packs/src/index.js";
import { compareSemVer, parseSemVer } from "../../../compiler/src/index.js";
import { createInitialEngineState, ENGINE_VERSION, evaluateEngine } from "../../../engine/src/index.js";
import { DEFAULT_PACKAGE_LIMITS, PackageIOError } from "../../../package-io/src/index.js";
import type { PackageIO, PackageReadResult } from "../../../package-io/src/index.js";
import type { BrowserDiagnostic, RuntimeWorkspace } from "./types.js";
import { checkCurrentSchemaVersion, NORMALIZED_FORMAT_ID } from "../../../versioning/src/index.js";
import { createRuntimeHistory } from "./runtime-history.js";
import { createRuntimePackageMedia } from "./package-media.js";
import type { PackageImageUrlHost, RuntimePackageMedia } from "./package-media.js";

export interface PackageContractValidation {
  readonly valid: boolean;
  readonly diagnostics?: readonly string[];
}

export type PackageContractValidator = (input: unknown) => PackageContractValidation;

export interface RuntimePackageOpenOptions {
  readonly packageIO: PackageIO;
  readonly validateNormalized: PackageContractValidator;
  readonly validateLayout: PackageContractValidator;
  readonly allowAuthorPackage?: boolean;
  readonly capabilityRegistry?: CapabilityPackRegistry;
  /** Browser-only opt-in; never required for headless package opening. */
  readonly imageUrlHost?: PackageImageUrlHost;
}

export interface RuntimePackageFileInfo {
  readonly path: string;
  readonly mime: string;
  readonly size: number;
}

export interface RuntimePackageInfo {
  readonly manifest: PackageManifest;
  readonly distribution: "student" | "author";
  readonly assets: readonly RuntimePackageFileInfo[];
  readonly docs: readonly RuntimePackageFileInfo[];
  readonly authorSolutionPresent: boolean;
  readonly capabilityPacks: readonly CapabilityPackRuntimeDescriptor[];
}

export type RuntimePackageOpenResult =
  | {
      readonly ok: true;
      readonly workspace: RuntimeWorkspace;
      readonly packageInfo: RuntimePackageInfo;
      readonly media?: RuntimePackageMedia;
      readonly diagnostics: readonly BrowserDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly BrowserDiagnostic[];
    };

function error(code: string, message: string, objectId?: string): BrowserDiagnostic {
  return objectId ? { severity: "error", code, message, objectId } : { severity: "error", code, message };
}

function validationDiagnostics(code: string, label: string, diagnostics: readonly string[] | undefined): readonly BrowserDiagnostic[] {
  const values = diagnostics?.length ? diagnostics : [`${label} failed schema validation.`];
  return values.map((message) => error(code, message));
}

function classifyFiles(read: PackageReadResult): Pick<RuntimePackageInfo, "assets" | "docs"> {
  const toInfo = ([path, file]: readonly [string, { readonly mime: string; readonly bytes: Uint8Array }]): RuntimePackageFileInfo => ({
    path,
    mime: file.mime,
    size: file.bytes.byteLength,
  });
  return {
    assets: [...read.files.entries()].filter(([path]) => path.startsWith("assets/")).map(toInfo).sort((a, b) => a.path.localeCompare(b.path, "en")),
    docs: [...read.files.entries()].filter(([path]) => path.startsWith("docs/")).map(toInfo).sort((a, b) => a.path.localeCompare(b.path, "en")),
  };
}

function asLayout(input: unknown): LayoutDocument {
  return input as LayoutDocument;
}

export async function openRuntimePackage(input: Blob, options: RuntimePackageOpenOptions): Promise<RuntimePackageOpenResult> {
  let read: PackageReadResult;
  try {
    read = await options.packageIO.read(input, DEFAULT_PACKAGE_LIMITS);
  } catch (cause) {
    if (cause instanceof PackageIOError) return { ok: false, diagnostics: [error(cause.code, cause.message, cause.path)] };
    return { ok: false, diagnostics: [error("BROWSER_PACKAGE_READ_FAILED", cause instanceof Error ? cause.message : String(cause))] };
  }

  if (read.manifest.distribution === "author" && options.allowAuthorPackage !== true) {
    return { ok: false, diagnostics: [error("BROWSER_AUTHOR_PACKAGE_NOT_ALLOWED", "Runtime opening defaults to student packages. Author packages require explicit instructor authorization.")] };
  }

  const normalized = options.validateNormalized(read.scenario);
  if (!normalized.valid) return { ok: false, diagnostics: validationDiagnostics("BROWSER_PACKAGE_SCENARIO_SCHEMA_INVALID", "scenario.json", normalized.diagnostics) };

  const schemaCompatibility = checkCurrentSchemaVersion(read.scenario, NORMALIZED_FORMAT_ID);
  if (schemaCompatibility) {
    return { ok: false, diagnostics: [error("BROWSER_PACKAGE_SCHEMA_VERSION_UNSUPPORTED", schemaCompatibility.message)] };
  }

  const currentEngine = parseSemVer(ENGINE_VERSION);
  const requiredEngine = parseSemVer(read.scenario.minimumEngineVersion);
  if (!currentEngine || !requiredEngine) {
    return { ok: false, diagnostics: [error("BROWSER_PACKAGE_ENGINE_VERSION_INVALID", `Package contains invalid Engine version metadata '${read.scenario.minimumEngineVersion}'.`)] };
  }
  if (compareSemVer(currentEngine, requiredEngine) < 0) {
    return { ok: false, diagnostics: [error("BROWSER_PACKAGE_ENGINE_TOO_OLD", `Scenario requires Engine ${read.scenario.minimumEngineVersion}; current Engine is ${ENGINE_VERSION}.`)] };
  }

  const capabilityRegistry = options.capabilityRegistry ?? BUILTIN_CAPABILITY_PACK_REGISTRY;
  const capabilityResolution = capabilityRegistry.resolveLocks(read.scenario.capabilityLocks);
  if (!capabilityResolution.ok) {
    return {
      ok: false,
      diagnostics: capabilityResolution.diagnostics.map((item) =>
        error(`BROWSER_PACKAGE_${item.code}`, item.message, item.id),
      ),
    };
  }

  let layout: LayoutDocument | undefined;
  if (read.layout !== undefined) {
    const checked = options.validateLayout(read.layout);
    if (!checked.valid) return { ok: false, diagnostics: validationDiagnostics("BROWSER_PACKAGE_LAYOUT_SCHEMA_INVALID", "layout.json", checked.diagnostics) };
    layout = asLayout(read.layout);
    if (layout.scenarioId !== read.scenario.scenarioId) {
      return { ok: false, diagnostics: [error("BROWSER_PACKAGE_LAYOUT_SCENARIO_MISMATCH", `layout.json scenario '${layout.scenarioId}' does not match '${read.scenario.scenarioId}'.`)] };
    }
  }

  // Only create ephemeral image URLs after *all* package and Runtime gates have passed.
  // A failed image gate cannot leave a partially playable workspace.
  let media: RuntimePackageMedia | undefined;
  try {
    if (options.imageUrlHost) media = createRuntimePackageMedia(read.files, options.imageUrlHost);
  } catch (cause) {
    return { ok: false, diagnostics: [error("BROWSER_PACKAGE_MEDIA_REJECTED", cause instanceof Error ? cause.message : String(cause))] };
  }

  try {
    const engineState = createInitialEngineState(read.scenario);
    const workspace: RuntimeWorkspace = {
      mode: "runtime",
      scenario: read.scenario,
      engineState,
      evaluation: evaluateEngine(read.scenario, engineState),
      selection: { ids: [] },
      sourceRevision: 0,
      ...(layout ? { layout } : {}),
      history: createRuntimeHistory(),
    };
    const files = classifyFiles(read);
    return {
      ok: true,
      workspace,
      packageInfo: {
        manifest: read.manifest,
        distribution: read.manifest.distribution,
        assets: files.assets,
        docs: files.docs,
        authorSolutionPresent: read.solution !== undefined,
        capabilityPacks: capabilityResolution.resolved,
      },
      ...(media ? { media } : {}),
      diagnostics: [],
    };
  } catch (cause) {
    media?.release();
    return { ok: false, diagnostics: [error("BROWSER_PACKAGE_RUNTIME_INITIALIZATION_FAILED", cause instanceof Error ? cause.message : String(cause))] };
  }
}
