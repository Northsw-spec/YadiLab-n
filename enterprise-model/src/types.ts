import type { EnterpriseBaseline } from "../../core-model/src/generated/contracts.js";

export type EnterpriseBaselineDraft = Omit<EnterpriseBaseline, "baselineIdentity">;

export interface EnterpriseModelDiagnostic {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface EnterpriseHashProvider {
  sha256Utf8(input: string): Promise<string>;
}

export interface EnterpriseBaselineVerification {
  readonly ok: boolean;
  readonly computedIdentity: string;
  readonly diagnostics: readonly EnterpriseModelDiagnostic[];
}
