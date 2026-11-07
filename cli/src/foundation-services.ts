import type { NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import { compileScenario } from "../../compiler/src/index.js";
import { runScenarioRegression } from "../../engine/src/index.js";
import type { CliServiceOptions, CliServices } from "./types.js";
import { FOUNDATION_MIGRATION_REGISTRY, SOURCE_FORMAT_ID, checkCurrentSchemaVersion } from "../../versioning/src/index.js";
import { renderScenarioSvg } from "../../renderer/src/index.js";
import { openCliPackage } from "./package-runtime.js";
import type { LayoutDocument, NormalizedScenario as RenderScenario } from "../../core-model/src/generated/contracts.js";

export function createFoundationCliServices(options: CliServiceOptions): CliServices {
  return {
    validateSource: (input: unknown) => {
      const structural = options.compilerContext.validateSource(input);
      if (!structural.valid) return structural;
      const compatibility = checkCurrentSchemaVersion(input, SOURCE_FORMAT_ID);
      if (!compatibility) return structural;
      return { valid: false, diagnostics: [{ severity: "error", code: "SCHEMA_VERSION_UNSUPPORTED", path: "schemaVersion", message: compatibility.message, suggestion: "Run app migrate before validation/compilation." }] };
    },
    compileSource: (input: unknown) => compileScenario(input, options.compilerContext),
    runRegression: (input: unknown) => runScenarioRegression(input as NormalizedScenario),
    migrateDocument: (input: unknown) => FOUNDATION_MIGRATION_REGISTRY.migrate(input),
    renderScenario: (input: unknown, layout: unknown) => renderScenarioSvg(input as RenderScenario, layout as LayoutDocument),
    ...(options.packageRuntime ? { openPackage: (input: Blob) => openCliPackage(input, options.packageRuntime as NonNullable<typeof options.packageRuntime>) } : {}),
  };
}
