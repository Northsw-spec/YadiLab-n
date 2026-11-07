import {
  canonicalTroubleshootingJson,
  createTroubleshootingNotebook,
  reviewRemediationLoop,
  reviewTroubleshootingEvidence,
  verifyTroubleshootingNotebook,
  type RemediationReview,
  type TroubleshootingEvidenceReview,
  type TroubleshootingNotebook,
  type TroubleshootingNotebookEntry,
} from "../../../observation-engine/src/index.js";
import type { BrowserDiagnostic, BrowserWorkspace } from "./types.js";

export const GUIDED_TROUBLESHOOTING_ID = "foundation.guided_troubleshooting" as const;
export const GUIDED_TROUBLESHOOTING_VERSION = "0.1.0" as const;
export const GUIDED_TROUBLESHOOTING_BOUNDARY = "PROCESS_GUIDANCE_NO_DIAGNOSIS" as const;

export type GuidedTroubleshootingPhase =
  | "COLLECT_EVIDENCE"
  | "REVIEW_EVIDENCE"
  | "FORM_HYPOTHESIS"
  | "REMEDIATE"
  | "COLLECT_AFTER_EVIDENCE"
  | "VERIFICATION_COMPLETE"
  | "CONTINUE_INVESTIGATION";

export type GuidedTroubleshootingStepId =
  | "collect_evidence"
  | "review_evidence"
  | "form_hypothesis"
  | "typed_remediation"
  | "collect_after_evidence"
  | "verify_remediation";

export type GuidedTroubleshootingStepStatus = "COMPLETE" | "READY" | "WAITING" | "OPTIONAL" | "ATTENTION";

export interface GuidedTroubleshootingStep {
  readonly stepId: GuidedTroubleshootingStepId;
  readonly label: string;
  readonly status: GuidedTroubleshootingStepStatus;
  readonly detail: string;
}

export interface GuidedTroubleshootingWorkflow {
  readonly engineId: typeof GUIDED_TROUBLESHOOTING_ID;
  readonly engineVersion: typeof GUIDED_TROUBLESHOOTING_VERSION;
  readonly boundary: typeof GUIDED_TROUBLESHOOTING_BOUNDARY;
  readonly scenarioId: string;
  readonly scenarioHash: string;
  readonly stateRevision: number;
  readonly notebookIdentity: string;
  readonly phase: GuidedTroubleshootingPhase;
  readonly nextAction: string;
  readonly steps: readonly GuidedTroubleshootingStep[];
  readonly currentRevisionEvidenceCount: number;
  readonly requiredEvidenceStatus: TroubleshootingEvidenceReview["requiredEvidenceStatus"];
  readonly latestRemediationEntryId?: string;
  readonly remediationStatus?: RemediationReview["status"];
  readonly workflowIdentity: string;
}

export interface GuidedTroubleshootingResult {
  readonly ok: boolean;
  readonly workflow?: GuidedTroubleshootingWorkflow;
  readonly diagnostics: readonly BrowserDiagnostic[];
}

function error(code: string, message: string): BrowserDiagnostic { return { severity: "error", code, message }; }
async function sha256(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function isEvidence(entry: TroubleshootingNotebookEntry): boolean { return entry.kind === "observation" || entry.kind === "active_probe"; }

export async function buildGuidedTroubleshootingWorkflow(workspace: BrowserWorkspace, notebook?: TroubleshootingNotebook): Promise<GuidedTroubleshootingResult> {
  if (workspace.mode !== "runtime") return { ok: false, diagnostics: [error("GUIDED_TROUBLESHOOTING_RUNTIME_REQUIRED", "Guided troubleshooting is available only in Runtime.")] };
  const exactNotebook = notebook ?? await createTroubleshootingNotebook(workspace.scenario.scenarioId, workspace.scenario.sourceHash);
  const verified = await verifyTroubleshootingNotebook(exactNotebook);
  if (!verified.ok) return { ok: false, diagnostics: verified.diagnostics.map((item) => error(item.code, item.message)) };
  if (exactNotebook.scenarioId !== workspace.scenario.scenarioId || exactNotebook.scenarioHash !== workspace.scenario.sourceHash) {
    return { ok: false, diagnostics: [error("GUIDED_TROUBLESHOOTING_SCENARIO_MISMATCH", "Notebook and Runtime scenario identities differ.")] };
  }

  const evidenceResult = await reviewTroubleshootingEvidence(workspace.scenario, exactNotebook);
  if (!evidenceResult.ok || !evidenceResult.review) return { ok: false, diagnostics: evidenceResult.diagnostics.map((item) => error(item.code, item.message)) };
  const evidenceReview = evidenceResult.review;

  const currentEvidence = exactNotebook.entries.filter((entry) => isEvidence(entry) && entry.stateRevision === workspace.engineState.stateRevision);
  const currentHypothesis = exactNotebook.entries.some((entry) => entry.kind === "learner_note" && entry.noteKind === "hypothesis" && entry.stateRevision === workspace.engineState.stateRevision);
  const remediations = exactNotebook.entries.filter((entry): entry is Extract<TroubleshootingNotebookEntry, { kind: "remediation_action" }> => entry.kind === "remediation_action");
  const latestRemediation = remediations.at(-1);
  let remediationReview: RemediationReview | undefined;
  if (latestRemediation) {
    const result = await reviewRemediationLoop(exactNotebook, latestRemediation.entryId);
    if (!result.ok || !result.review) return { ok: false, diagnostics: result.diagnostics.map((item) => error(item.code, item.message)) };
    remediationReview = result.review;
  }

  const baselineRevision = latestRemediation?.beforeStateRevision ?? workspace.engineState.stateRevision;
  const baselineEvidence = exactNotebook.entries.filter((entry) => isEvidence(entry) && entry.stateRevision === baselineRevision && (!latestRemediation || entry.sequence < latestRemediation.sequence));
  const hypothesisBeforeRemediation = exactNotebook.entries.some((entry) => entry.kind === "learner_note" && entry.noteKind === "hypothesis" && entry.stateRevision === baselineRevision && (!latestRemediation || entry.sequence < latestRemediation.sequence));
  const afterEvidence = latestRemediation ? exactNotebook.entries.filter((entry) => isEvidence(entry) && entry.stateRevision === latestRemediation.afterStateRevision && entry.sequence > latestRemediation.sequence) : [];
  const hasMatchedAfterEvidence = remediationReview ? remediationReview.status !== "PENDING_AFTER_EVIDENCE" : false;

  let phase: GuidedTroubleshootingPhase;
  let nextAction: string;
  if (latestRemediation) {
    if (!hasMatchedAfterEvidence) {
      phase = "COLLECT_AFTER_EVIDENCE";
      nextAction = "Run and save the same relevant observation or probe after the remediation so the before/after evidence can be compared.";
    } else if (remediationReview?.status === "VERIFIED_IMPROVEMENT") {
      phase = "VERIFICATION_COMPLETE";
      nextAction = "The notebook contains a verified before/after improvement. Review the evidence and record your learner conclusion if appropriate.";
    } else {
      phase = "CONTINUE_INVESTIGATION";
      nextAction = "The saved before/after evidence does not verify an improvement. Continue investigating from the evidence; the workflow will not choose another remediation for you.";
    }
  } else if (currentEvidence.length === 0) {
    phase = "COLLECT_EVIDENCE";
    nextAction = "Run a modeled observation or active probe and save the result to the notebook.";
  } else if (evidenceReview.requiredEvidenceStatus === "PENDING") {
    phase = "REVIEW_EVIDENCE";
    nextAction = "Review the learner-visible troubleshooting objectives and collect the still-missing evidence. The workflow does not choose a command or diagnosis.";
  } else if (!currentHypothesis) {
    phase = "FORM_HYPOTHESIS";
    nextAction = "Write a learner hypothesis that is supported by the evidence collected so far.";
  } else {
    phase = "REMEDIATE";
    nextAction = "If your evidence supports the hypothesis, choose and preview a typed remediation. The workflow does not recommend which action or value to use.";
  }

  const evidenceConfigured = evidenceReview.requiredEvidenceStatus !== "NOT_CONFIGURED";
  const steps: GuidedTroubleshootingStep[] = [
    {
      stepId: "collect_evidence",
      label: "Collect baseline evidence",
      status: baselineEvidence.length > 0 ? "COMPLETE" : "READY",
      detail: baselineEvidence.length > 0 ? `${baselineEvidence.length} saved evidence entr${baselineEvidence.length === 1 ? "y" : "ies"} at baseline revision ${baselineRevision}.` : "Save at least one modeled observation or active probe from the current Runtime revision.",
    },
    {
      stepId: "review_evidence",
      label: "Review evidence objectives",
      status: !evidenceConfigured ? "OPTIONAL" : evidenceReview.requiredEvidenceStatus === "SATISFIED" ? "COMPLETE" : baselineEvidence.length > 0 && !latestRemediation ? "READY" : "WAITING",
      detail: !evidenceConfigured ? "No required troubleshooting evidence objectives are configured for this scenario." : `Required evidence status: ${evidenceReview.requiredEvidenceStatus}.`,
    },
    {
      stepId: "form_hypothesis",
      label: "Record learner hypothesis",
      status: hypothesisBeforeRemediation || currentHypothesis ? "COMPLETE" : latestRemediation ? "OPTIONAL" : baselineEvidence.length > 0 ? "READY" : "WAITING",
      detail: hypothesisBeforeRemediation || currentHypothesis ? "A learner-authored hypothesis is recorded for the relevant baseline revision." : "The workflow does not infer or write a diagnosis; the learner owns the hypothesis.",
    },
    {
      stepId: "typed_remediation",
      label: "Preview and commit typed remediation",
      status: latestRemediation ? "COMPLETE" : baselineEvidence.length > 0 ? "READY" : "WAITING",
      detail: latestRemediation ? `Latest remediation: ${latestRemediation.entryId}, Runtime revision ${latestRemediation.beforeStateRevision} → ${latestRemediation.afterStateRevision}.` : "Choose a typed action only if the collected evidence supports it. No action is selected automatically.",
    },
    {
      stepId: "collect_after_evidence",
      label: "Collect matching after-evidence",
      status: !latestRemediation ? "WAITING" : hasMatchedAfterEvidence ? "COMPLETE" : afterEvidence.length > 0 ? "READY" : "READY",
      detail: !latestRemediation ? "Available after a remediation is committed." : hasMatchedAfterEvidence ? "A matching before/after evidence pair is available." : `${afterEvidence.length} post-remediation evidence entr${afterEvidence.length === 1 ? "y" : "ies"} saved; run the same relevant check used before remediation.`,
    },
    {
      stepId: "verify_remediation",
      label: "Verify before/after result",
      status: !latestRemediation || !remediationReview ? "WAITING" : remediationReview.status === "VERIFIED_IMPROVEMENT" ? "COMPLETE" : remediationReview.status === "PENDING_AFTER_EVIDENCE" ? "WAITING" : "ATTENTION",
      detail: remediationReview ? `Remediation review status: ${remediationReview.status}.` : "Verification becomes available from notebook evidence after remediation.",
    },
  ];

  const identityInput = {
    engineId: GUIDED_TROUBLESHOOTING_ID,
    engineVersion: GUIDED_TROUBLESHOOTING_VERSION,
    boundary: GUIDED_TROUBLESHOOTING_BOUNDARY,
    scenarioId: workspace.scenario.scenarioId,
    scenarioHash: workspace.scenario.sourceHash,
    stateRevision: workspace.engineState.stateRevision,
    notebookIdentity: exactNotebook.notebookIdentity,
    evidenceReviewIdentity: evidenceReview.reviewIdentity,
    latestRemediationEntryId: latestRemediation?.entryId ?? null,
    remediationReviewIdentity: remediationReview?.reviewIdentity ?? null,
    phase,
    steps,
  };
  const workflowIdentity = await sha256(canonicalTroubleshootingJson(identityInput));
  const workflow: GuidedTroubleshootingWorkflow = {
    engineId: GUIDED_TROUBLESHOOTING_ID,
    engineVersion: GUIDED_TROUBLESHOOTING_VERSION,
    boundary: GUIDED_TROUBLESHOOTING_BOUNDARY,
    scenarioId: workspace.scenario.scenarioId,
    scenarioHash: workspace.scenario.sourceHash,
    stateRevision: workspace.engineState.stateRevision,
    notebookIdentity: exactNotebook.notebookIdentity,
    phase,
    nextAction,
    steps,
    currentRevisionEvidenceCount: currentEvidence.length,
    requiredEvidenceStatus: evidenceReview.requiredEvidenceStatus,
    ...(latestRemediation ? { latestRemediationEntryId: latestRemediation.entryId } : {}),
    ...(remediationReview ? { remediationStatus: remediationReview.status } : {}),
    workflowIdentity,
  };
  return { ok: true, workflow, diagnostics: [] };
}
