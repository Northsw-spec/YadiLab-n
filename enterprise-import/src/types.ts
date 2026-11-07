import type { EnterpriseBaseline, EnterpriseImportReport, EnterpriseMappingProfile, EnterpriseMappingReview, EnterpriseReimportDiff, EnterpriseReimportMergePlan } from "../../core-model/src/generated/contracts.js";

export type MappingClass = "EXACT" | "ALIAS" | "USER_MAPPED";

export interface ImportDiagnostic {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly table?: string;
  readonly row?: number;
  readonly field?: string;
  readonly mappingId?: string;
}

export type ImportLocator =
  | { readonly kind: "table-cell"; readonly sheet: string; readonly row: number; readonly column: string }
  | { readonly kind: "record-row"; readonly table?: string; readonly row: number }
  | { readonly kind: "json-pointer"; readonly pointer: string };

export interface ImportCell {
  readonly value: unknown;
  readonly locator: ImportLocator;
}

export interface ImportRecord {
  readonly recordIndex: number;
  readonly fields: Readonly<Record<string, ImportCell>>;
}

export interface ImportTable {
  readonly tableId: string;
  readonly records: readonly ImportRecord[];
}

export interface ImportDocument {
  readonly tables: readonly ImportTable[];
}

export interface AdapterParseResult {
  readonly document: ImportDocument;
  readonly diagnostics: readonly ImportDiagnostic[];
}

export interface EnterpriseImportSourceInput {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly displayName?: string;
}

export interface EnterpriseImportAdapterContext {
  readonly options: Readonly<Record<string, unknown>>;
}

export interface EnterpriseImportAdapter {
  readonly id: string;
  readonly version: string;
  readonly mediaTypes: readonly string[];
  parse(source: EnterpriseImportSourceInput, context: EnterpriseImportAdapterContext): AdapterParseResult | Promise<AdapterParseResult>;
}

export interface EnterpriseImportHashProvider {
  sha256Bytes(input: Uint8Array): Promise<string>;
  sha256Utf8(input: string): Promise<string>;
}

export interface EnterpriseImportRequest {
  readonly baselineId: string;
  readonly source: EnterpriseImportSourceInput;
  readonly mappingProfile: EnterpriseMappingProfile;
  readonly adapter?: EnterpriseImportAdapter;
  readonly options?: Readonly<Record<string, unknown>>;
  readonly conflictResolutions?: EnterpriseBaseline["importContract"]["conflictResolutions"];
}

export interface EnterpriseImportResult {
  readonly report: EnterpriseImportReport;
  readonly baseline?: EnterpriseBaseline;
  readonly document?: ImportDocument;
}


export type EnterpriseMappingReviewArtifact = EnterpriseMappingReview;
export type EnterpriseReimportDiffArtifact = EnterpriseReimportDiff;
export type EnterpriseReimportMergePlanArtifact = EnterpriseReimportMergePlan;

export type MappingReviewDecision =
  | { readonly kind: "table"; readonly tableId: string; readonly sourceTable: string }
  | { readonly kind: "field"; readonly mappingId: string; readonly field: string };

export interface EnterpriseMappingReviewRequest {
  readonly source: EnterpriseImportSourceInput;
  readonly mappingProfile: EnterpriseMappingProfile;
  readonly adapter?: EnterpriseImportAdapter;
  readonly options?: Readonly<Record<string, unknown>>;
}

export interface EnterpriseMappingReviewResult {
  readonly review: EnterpriseMappingReview;
  readonly document?: ImportDocument;
}

export class EnterpriseImportError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "EnterpriseImportError";
  }
}
