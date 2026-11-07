import type { LayoutDocument, NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import { BUILTIN_CAPABILITY_PACK_REGISTRY, type CapabilityPackRegistry } from "../../capability-packs/src/index.js";
import { compareSemVer, parseSemVer } from "../../compiler/src/index.js";
import { createInitialEngineState, ENGINE_VERSION, evaluateEngine, runScenarioRegression } from "../../engine/src/index.js";
import { DEFAULT_PACKAGE_LIMITS, PackageIOError, type PackageIO, type PackageReadResult } from "../../package-io/src/index.js";
import { checkCurrentSchemaVersion, NORMALIZED_FORMAT_ID } from "../../versioning/src/index.js";
import type { SchemaValidationResult } from "../../compiler/src/types.js";

export interface CliPackageDiagnostic {
  readonly severity: "error";
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export type CliPackageOpenResult =
  | { readonly ok: true; readonly read: PackageReadResult; readonly diagnostics: readonly CliPackageDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly CliPackageDiagnostic[] };

export interface CliPackageRuntimeOptions {
  readonly packageIO: PackageIO;
  readonly validateNormalized: (input: unknown) => SchemaValidationResult;
  readonly validateLayout: (input: unknown) => SchemaValidationResult;
  readonly capabilityRegistry?: CapabilityPackRegistry;
}

function diagnostic(code: string, message: string, path?: string): CliPackageDiagnostic {
  return path ? { severity: "error", code, message, path } : { severity: "error", code, message };
}

export async function openCliPackage(input: Blob, options: CliPackageRuntimeOptions): Promise<CliPackageOpenResult> {
  let read: PackageReadResult;
  try {
    read = await options.packageIO.read(input, DEFAULT_PACKAGE_LIMITS);
  } catch (cause) {
    if (cause instanceof PackageIOError) return { ok: false, diagnostics: [diagnostic(cause.code, cause.message, cause.path)] };
    return { ok: false, diagnostics: [diagnostic("CLI_PACKAGE_READ_FAILED", cause instanceof Error ? cause.message : String(cause))] };
  }

  const structural = options.validateNormalized(read.scenario);
  if (!structural.valid) {
    return {
      ok: false,
      diagnostics: structural.diagnostics.map((item) => diagnostic("CLI_PACKAGE_SCENARIO_SCHEMA_INVALID", item.message, item.path)),
    };
  }
  const compatibility = checkCurrentSchemaVersion(read.scenario, NORMALIZED_FORMAT_ID);
  if (compatibility) return { ok: false, diagnostics: [diagnostic("CLI_PACKAGE_SCHEMA_VERSION_UNSUPPORTED", compatibility.message, "schemaVersion")] };

  const currentEngine = parseSemVer(ENGINE_VERSION);
  const requiredEngine = parseSemVer(read.scenario.minimumEngineVersion);
  if (!currentEngine || !requiredEngine) {
    return { ok: false, diagnostics: [diagnostic("CLI_PACKAGE_ENGINE_VERSION_INVALID", `Invalid Engine version metadata '${read.scenario.minimumEngineVersion}'.`)] };
  }
  if (compareSemVer(currentEngine, requiredEngine) < 0) {
    return { ok: false, diagnostics: [diagnostic("CLI_PACKAGE_ENGINE_TOO_OLD", `Scenario requires Engine ${read.scenario.minimumEngineVersion}; current Engine is ${ENGINE_VERSION}.`)] };
  }

  const registry = options.capabilityRegistry ?? BUILTIN_CAPABILITY_PACK_REGISTRY;
  const resolved = registry.resolveLocks(read.scenario.capabilityLocks);
  if (!resolved.ok) {
    return {
      ok: false,
      diagnostics: resolved.diagnostics.map((item) => diagnostic(`CLI_PACKAGE_${item.code}`, item.message, item.id)),
    };
  }

  if (read.layout !== undefined) {
    const layoutValidation = options.validateLayout(read.layout);
    if (!layoutValidation.valid) {
      return {
        ok: false,
        diagnostics: layoutValidation.diagnostics.map((item) => diagnostic("CLI_PACKAGE_LAYOUT_SCHEMA_INVALID", item.message, item.path)),
      };
    }
    const layout = read.layout as LayoutDocument;
    if (layout.scenarioId !== read.scenario.scenarioId) {
      return { ok: false, diagnostics: [diagnostic("CLI_PACKAGE_LAYOUT_SCENARIO_MISMATCH", `layout.json scenario '${layout.scenarioId}' does not match '${read.scenario.scenarioId}'.`, "layout.json")] };
    }
  }

  return { ok: true, read, diagnostics: [] };
}

export function inspectPackage(read: PackageReadResult) {
  const paths = [...read.files.keys()].sort((a, b) => a.localeCompare(b, "en"));
  return {
    formatId: read.manifest.formatId,
    kind: "scenario-package",
    scenarioId: read.scenario.scenarioId,
    title: read.scenario.metadata.title,
    schemaVersion: read.scenario.schemaVersion,
    packageVersion: read.manifest.packageVersion,
    distribution: read.manifest.distribution,
    fileCount: paths.length + 1,
    files: ["manifest.json", ...paths],
    capabilityCount: read.scenario.capabilityLocks.length,
    profileCount: read.scenario.profileLocks.length,
    assetCount: read.scenario.assetLocks.length,
    hasLayout: read.layout !== undefined,
    hasAuthorSolution: read.solution !== undefined,
  } as const;
}

export function testPackage(read: PackageReadResult) {
  if (read.solution !== undefined) {
    const authorScenario = { ...read.scenario, canonicalSolution: read.solution } as NormalizedScenario;
    const report = runScenarioRegression(authorScenario);
    return {
      mode: "author-regression",
      scenarioId: report.scenarioId,
      passed: report.passed,
      solutionApplied: report.solutionApplied,
      operationsApplied: report.operationsApplied,
      checks: report.checks,
      diagnostics: report.diagnostics,
    } as const;
  }

  const state = createInitialEngineState(read.scenario);
  const evaluation = evaluateEngine(read.scenario, state);
  const checks = read.scenario.tests
    .filter((test) => test.expectedInitial !== undefined)
    .map((test) => {
      const actual = evaluation.tests.find((item) => item.id === test.id)?.outcome ?? "UNKNOWN";
      return {
        id: `initial.test.${test.id}`,
        passed: actual === test.expectedInitial,
        expected: test.expectedInitial,
        actual,
      };
    });
  checks.push({
    id: "initial.completion",
    passed: evaluation.completion.truth === "FALSE",
    expected: "FALSE",
    actual: evaluation.completion.truth,
  });
  const passed = checks.length > 1 && checks.every((check) => check.passed);
  return {
    mode: "student-initial-state",
    scenarioId: read.scenario.scenarioId,
    passed,
    solutionApplied: false,
    checks,
    diagnostics: passed ? [] : [{ code: "PACKAGE_INITIAL_EXPECTATION_FAILED", message: "One or more student-package initial-state expectations failed." }],
  } as const;
}
