import {
  createTroubleshootingNotebook,
  reviewTroubleshootingEvidence,
  type TroubleshootingEvidenceReview,
  type TroubleshootingNotebook,
} from "../../../observation-engine/src/index.js";
import type { BrowserDiagnostic, BrowserWorkspace } from "./types.js";

export interface RuntimeEvidenceReviewUiResult {
  readonly ok: boolean;
  readonly review?: TroubleshootingEvidenceReview;
  readonly diagnostics: readonly BrowserDiagnostic[];
}

function error(code: string, message: string): BrowserDiagnostic { return { severity: "error", code, message }; }

export async function reviewRuntimeTroubleshootingEvidence(workspace: BrowserWorkspace, notebook?: TroubleshootingNotebook): Promise<RuntimeEvidenceReviewUiResult> {
  if (workspace.mode !== "runtime") return { ok: false, diagnostics: [error("EVIDENCE_REVIEW_RUNTIME_REQUIRED", "Troubleshooting evidence review is available only in Runtime.")] };
  const exactNotebook = notebook ?? await createTroubleshootingNotebook(workspace.scenario.scenarioId, workspace.scenario.sourceHash);
  const result = await reviewTroubleshootingEvidence(workspace.scenario, exactNotebook);
  if (!result.ok || !result.review) return { ok: false, diagnostics: result.diagnostics.map((item) => ({ severity: item.severity, code: item.code, message: item.message })) };
  return { ok: true, review: result.review, diagnostics: [] };
}
