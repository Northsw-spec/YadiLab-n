import type { FaultOverlay, FaultPack, NormalizedScenario, ScenarioSource } from "../../core-model/src/generated/contracts.js";
import type { EngineState, ScenarioOperation } from "../../engine/src/index.js";

export type FaultDiagnosticSeverity = "info" | "warning" | "error";
export interface FaultDiagnostic { readonly severity: FaultDiagnosticSeverity; readonly code: string; readonly message: string; readonly objectId?: string; }
export interface FaultHashProvider { sha256Utf8(input: string): Promise<string>; }
export interface FaultPackVerification { readonly ok: boolean; readonly diagnostics: readonly FaultDiagnostic[]; }
export interface FaultInjectionRequest {
  readonly scenario: NormalizedScenario;
  readonly state: EngineState;
  readonly pack: FaultPack;
  readonly faultId: string;
  readonly bindings: Readonly<Record<string,string>>;
  readonly seed: number;
  readonly mode: FaultOverlay["mode"];
  readonly activeOverlay?: FaultOverlay;
  readonly overlayId?: string;
  readonly instanceId?: string;
}
export interface FaultInjectionSuccess {
  readonly ok: true;
  readonly state: EngineState;
  readonly overlay: FaultOverlay;
  readonly operations: readonly ScenarioOperation[];
  readonly inverseOperations: readonly ScenarioOperation[];
  readonly diagnostics: readonly FaultDiagnostic[];
}
export interface FaultInjectionFailure {
  readonly ok: false;
  readonly state: EngineState;
  readonly diagnostics: readonly FaultDiagnostic[];
}
export type FaultInjectionResult = FaultInjectionSuccess | FaultInjectionFailure;
export interface FaultRollbackResult extends FaultInjectionFailure { readonly ok: false; }
export interface FaultRollbackSuccess { readonly ok: true; readonly state: EngineState; readonly overlay: FaultOverlay; readonly diagnostics: readonly FaultDiagnostic[]; }
export type FaultRollback = FaultRollbackSuccess | FaultRollbackResult;
export interface FaultVariantResult { readonly ok: true; readonly source: ScenarioSource; readonly diagnostics: readonly FaultDiagnostic[]; }
export interface FaultVariantFailure { readonly ok: false; readonly diagnostics: readonly FaultDiagnostic[]; }
export type MaterializeFaultVariantResult = FaultVariantResult | FaultVariantFailure;

export interface FaultGenerationConstraints {
  readonly requireDistinctFaultDefinitions?: boolean;
  readonly allowedDomains?: readonly string[];
  readonly allowedTargetTypes?: readonly string[];
  readonly allowedFaultIds?: readonly string[];
  readonly excludedFaultIds?: readonly string[];
  readonly maxTotalChangedResources?: number;
  readonly difficulty?: import("../../core-model/src/generated/contracts.js").FaultGenerationPlan["request"]["difficulty"];
}

export interface FaultScenarioGenerationRequest {
  readonly scenario: NormalizedScenario;
  readonly state: EngineState;
  readonly packs: readonly FaultPack[];
  readonly seed: number;
  readonly faultCount: number;
  readonly constraints?: FaultGenerationConstraints;
  readonly overlayId?: string;
}

export interface FaultScenarioGenerationSuccess {
  readonly ok: true;
  readonly state: EngineState;
  readonly overlay: FaultOverlay;
  readonly plan: import("../../core-model/src/generated/contracts.js").FaultGenerationPlan;
  readonly diagnostics: readonly FaultDiagnostic[];
}

export interface FaultScenarioGenerationFailure {
  readonly ok: false;
  readonly state: EngineState;
  readonly diagnostics: readonly FaultDiagnostic[];
}

export type FaultScenarioGenerationResult = FaultScenarioGenerationSuccess | FaultScenarioGenerationFailure;
