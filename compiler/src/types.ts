import type { NormalizedScenario, ScenarioSource } from "../../core-model/src/generated/contracts.js";

export type DiagnosticSeverity = "error" | "warning";

export interface CompilerDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly suggestion?: string;
}

export interface SchemaValidationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly CompilerDiagnostic[];
}

export type SchemaValidator = (data: unknown) => SchemaValidationResult;

export interface CapabilityClaims {
  readonly resourceTypePrefixes?: readonly string[];
  readonly testTypePrefixes?: readonly string[];
  readonly connectionKinds?: readonly string[];
  readonly ruleOps?: readonly string[];
}

export interface CapabilityDefinition {
  readonly id: string;
  readonly version: string;
  readonly minimumEngineVersion: string;
  readonly claims?: CapabilityClaims;
}

export interface ProfileResourceDefaults {
  readonly vendor?: string;
  readonly product?: string;
  readonly interfaces?: readonly {
    readonly id: string;
    readonly label?: string;
    readonly addresses?: readonly string[];
    readonly mac?: string;
  }[];
  readonly properties?: Readonly<Record<string, unknown>>;
}

export interface ProfileDefinition {
  readonly id: string;
  readonly version: string;
  readonly minimumEngineVersion: string;
  readonly appliesTo: readonly string[];
  readonly defaults?: ProfileResourceDefaults;
}


export interface AssetDefinition {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly path: string;
  readonly mime: "image/svg+xml" | "image/png";
  readonly appliesTo: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly trusted: true;
}

export interface CompilerCatalog {
  readonly capabilities: readonly CapabilityDefinition[];
  readonly profiles: readonly ProfileDefinition[];
  readonly assets: readonly AssetDefinition[];
}

export interface HashProvider {
  sha256Utf8(input: string): Promise<string>;
}

export interface CompilerContext {
  readonly validateSource: SchemaValidator;
  readonly validateNormalized: SchemaValidator;
  readonly catalog: CompilerCatalog;
  readonly engineBaselineVersion: string;
  readonly hashProvider?: HashProvider;
}

export interface LayoutRequest {
  readonly scenarioId: string;
  readonly hints: NonNullable<ScenarioSource["layoutHints"]>;
}

export interface CompileSuccess {
  readonly ok: true;
  readonly model: NormalizedScenario;
  readonly layoutRequest: LayoutRequest;
  readonly diagnostics: readonly CompilerDiagnostic[];
}

export interface CompileFailure {
  readonly ok: false;
  readonly diagnostics: readonly CompilerDiagnostic[];
}

export type CompileResult = CompileSuccess | CompileFailure;

export interface ResolvedDefinition<T> {
  readonly requirementId: string;
  readonly requestedRange: string;
  readonly definition: T;
}
