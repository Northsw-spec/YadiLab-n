import type { CompileResult, CompilerContext, SchemaValidationResult } from "../../compiler/src/types.js";
import type { ScenarioRegressionReport } from "../../engine/src/regression.js";
import type { MigrationResult } from "../../versioning/src/index.js";
import type { SvgRenderResult } from "../../renderer/src/index.js";
import type { CliPackageOpenResult, CliPackageRuntimeOptions } from "./package-runtime.js";

export interface CliIO {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  readBytes?(path: string): Promise<Uint8Array>;
  writeBytes?(path: string, content: Uint8Array): Promise<void>;
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface CliServices {
  validateSource(input: unknown): SchemaValidationResult;
  compileSource(input: unknown): Promise<CompileResult>;
  runRegression(input: unknown): ScenarioRegressionReport;
  migrateDocument(input: unknown): MigrationResult;
  renderScenario(input: unknown, layout: unknown): SvgRenderResult;
  openPackage?(input: Blob): Promise<CliPackageOpenResult>;
}

export interface CliExecutionResult {
  readonly exitCode: 0 | 1 | 2;
  readonly command?: string;
}

export interface CliServiceOptions {
  readonly compilerContext: CompilerContext;
  readonly packageRuntime?: CliPackageRuntimeOptions;
}
