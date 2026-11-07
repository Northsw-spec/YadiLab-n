import type { LayoutDocument, NormalizedScenario, ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import type { CompilerContext, CompilerDiagnostic } from "../../../compiler/src/index.js";
import type { EngineEvaluation, EngineState, ScenarioOperation } from "../../../engine/src/index.js";
import type { ManualLayoutOverride } from "../../../layout/src/types.js";

export type WorkspaceMode = "builder" | "runtime";
export type SelectionKind = "zone" | "resource" | "connection";

export interface WorkspaceSelection {
  readonly ids: readonly string[];
  readonly primary?: string;
}

export type BuilderCompileState =
  | { readonly status: "idle" }
  | { readonly status: "invalid"; readonly diagnostics: readonly CompilerDiagnostic[] }
  | {
      readonly status: "valid";
      readonly model: NormalizedScenario;
      readonly diagnostics: readonly CompilerDiagnostic[];
    };

export interface BuilderWorkspace {
  readonly mode: "builder";
  readonly source: ScenarioSource;
  readonly sourceRevision: number;
  readonly dirty: boolean;
  readonly selection: WorkspaceSelection;
  readonly layoutOverrides: readonly ManualLayoutOverride[];
  readonly layout?: LayoutDocument;
  readonly compile: BuilderCompileState;
}

export interface RuntimeCheckpoint {
  readonly id: string;
  readonly label: string;
  readonly scenarioHash: string;
  readonly state: EngineState;
}

export interface RuntimeHistory {
  readonly past: readonly EngineState[];
  readonly future: readonly EngineState[];
  readonly checkpoints: readonly RuntimeCheckpoint[];
}

export interface RuntimeWorkspace {
  readonly mode: "runtime";
  /** Canonical editable source that produced this Runtime workspace, when one exists. */
  readonly source?: ScenarioSource;
  readonly scenario: NormalizedScenario;
  readonly engineState: EngineState;
  readonly evaluation: EngineEvaluation;
  readonly selection: WorkspaceSelection;
  readonly sourceRevision: number;
  readonly layout?: LayoutDocument;
  readonly history: RuntimeHistory;
}

export type BrowserWorkspace = BuilderWorkspace | RuntimeWorkspace;

export interface BrowserDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly objectId?: string;
}

export interface BrowserCommandSuccess<T> {
  readonly ok: true;
  readonly workspace: T;
  readonly diagnostics: readonly BrowserDiagnostic[];
}

export interface BrowserCommandFailure<T> {
  readonly ok: false;
  readonly workspace: T;
  readonly diagnostics: readonly BrowserDiagnostic[];
}

export type BrowserCommandResult<T> = BrowserCommandSuccess<T> | BrowserCommandFailure<T>;

export interface BrowserFoundationOptions {
  readonly compilerContext: CompilerContext;
}

export interface RuntimeOperationRequest {
  readonly operation: ScenarioOperation;
}

export interface JsonDownloadDescriptor {
  readonly filename: string;
  readonly mime: "application/json";
  readonly text: string;
}

export interface TextReadableFile {
  readonly name: string;
  text(): Promise<string>;
}


export interface BlobDownloadDescriptor {
  readonly filename: string;
  readonly mime: string;
  readonly blob: Blob;
}

export interface BrowserDownloadHost {
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  clickDownload(url: string, filename: string): void;
}
