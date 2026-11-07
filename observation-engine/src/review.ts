import type {
  NormalizedScenario,
  Normalizedscenariotroubleshootingevidencerequirement,
  Normalizedscenariotroubleshootingobjective,
} from "../../core-model/src/generated/contracts.js";
import type {
  EvidenceObjectiveReview,
  EvidenceRequirementReview,
  ObservationDiagnostic,
  TroubleshootingEvidenceReview,
  TroubleshootingEvidenceReviewResult,
  TroubleshootingNotebook,
  TroubleshootingNotebookEntry,
} from "./types.js";
import { canonicalTroubleshootingJson, verifyTroubleshootingNotebook } from "./notebook.js";

export const EVIDENCE_REVIEW_ENGINE_ID = "foundation.evidence_review" as const;
export const EVIDENCE_REVIEW_ENGINE_VERSION = "0.1.0" as const;
export const EVIDENCE_REVIEW_BOUNDARY = "NOTEBOOK_ONLY_NO_DIAGNOSIS" as const;

function diagnostic(severity: ObservationDiagnostic["severity"], code: string, message: string): ObservationDiagnostic {
  return { severity, code, message };
}

async function sha256Utf8(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto SHA-256 is unavailable in this runtime");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function observationMatches(requirement: Extract<Normalizedscenariotroubleshootingevidencerequirement, { readonly kind: "observation" }>, entry: TroubleshootingNotebookEntry): boolean {
  if (entry.kind !== "observation") return false;
  if (requirement.category !== undefined && entry.category !== requirement.category) return false;
  if (requirement.targetId !== undefined && entry.targetId !== requirement.targetId) return false;
  if (requirement.command !== undefined && entry.command !== requirement.command) return false;
  return true;
}

function probeMatches(requirement: Extract<Normalizedscenariotroubleshootingevidencerequirement, { readonly kind: "active_probe" }>, entry: TroubleshootingNotebookEntry): boolean {
  if (entry.kind !== "active_probe") return false;
  if (requirement.category !== undefined && entry.category !== requirement.category) return false;
  if (requirement.sourceId !== undefined && entry.sourceId !== requirement.sourceId) return false;
  if (requirement.destinationId !== undefined && entry.destinationId !== requirement.destinationId) return false;
  if (requirement.protocol !== undefined && entry.protocol !== requirement.protocol) return false;
  if (requirement.port !== undefined && entry.port !== requirement.port) return false;
  if (requirement.queryName !== undefined && entry.queryName !== requirement.queryName) return false;
  if (requirement.truth !== undefined && entry.truth !== requirement.truth) return false;
  return true;
}

function matches(requirement: Normalizedscenariotroubleshootingevidencerequirement, entry: TroubleshootingNotebookEntry): boolean {
  return requirement.kind === "observation"
    ? observationMatches(requirement, entry)
    : probeMatches(requirement, entry);
}

function reviewUnordered(objective: Normalizedscenariotroubleshootingobjective, entries: readonly TroubleshootingNotebookEntry[]): EvidenceObjectiveReview {
  const requirements: EvidenceRequirementReview[] = objective.requirements.map((requirement) => {
    const match = entries.find((entry) => matches(requirement, entry));
    return {
      requirementId: requirement.id,
      label: requirement.label,
      kind: requirement.kind,
      status: match ? "SATISFIED" : "PENDING",
      ...(match ? { matchedEntryId: match.entryId, matchedSequence: match.sequence } : {}),
    };
  });
  return {
    objectiveId: objective.id,
    title: objective.title,
    ...(objective.description !== undefined ? { description: objective.description } : {}),
    required: objective.required,
    evidenceOrder: objective.evidenceOrder,
    status: requirements.every((requirement) => requirement.status === "SATISFIED") ? "SATISFIED" : "PENDING",
    requirements,
  };
}

function reviewOrdered(objective: Normalizedscenariotroubleshootingobjective, entries: readonly TroubleshootingNotebookEntry[]): EvidenceObjectiveReview {
  let lastSequence = 0;
  const requirements: EvidenceRequirementReview[] = objective.requirements.map((requirement) => {
    const eligible = entries.find((entry) => entry.sequence > lastSequence && matches(requirement, entry));
    if (eligible) {
      lastSequence = eligible.sequence;
      return {
        requirementId: requirement.id,
        label: requirement.label,
        kind: requirement.kind,
        status: "SATISFIED",
        matchedEntryId: eligible.entryId,
        matchedSequence: eligible.sequence,
      };
    }
    const earlier = entries.find((entry) => matches(requirement, entry));
    return {
      requirementId: requirement.id,
      label: requirement.label,
      kind: requirement.kind,
      status: earlier ? "OUT_OF_ORDER" : "PENDING",
      ...(earlier ? { matchedEntryId: earlier.entryId, matchedSequence: earlier.sequence } : {}),
    };
  });
  const status = requirements.every((requirement) => requirement.status === "SATISFIED")
    ? "SATISFIED"
    : requirements.some((requirement) => requirement.status === "OUT_OF_ORDER") ? "OUT_OF_ORDER" : "PENDING";
  return {
    objectiveId: objective.id,
    title: objective.title,
    ...(objective.description !== undefined ? { description: objective.description } : {}),
    required: objective.required,
    evidenceOrder: objective.evidenceOrder,
    status,
    requirements,
  };
}

function reviewProjection(review: Omit<TroubleshootingEvidenceReview, "reviewIdentity">): unknown {
  return review;
}

export async function reviewTroubleshootingEvidence(scenario: NormalizedScenario, notebook: TroubleshootingNotebook): Promise<TroubleshootingEvidenceReviewResult> {
  const notebookCheck = await verifyTroubleshootingNotebook(notebook);
  if (!notebookCheck.ok) return { ok: false, diagnostics: notebookCheck.diagnostics };
  if (notebook.scenarioId !== scenario.scenarioId || notebook.scenarioHash !== scenario.sourceHash) {
    return { ok: false, diagnostics: [diagnostic("error", "EVIDENCE_REVIEW_SCENARIO_MISMATCH", "Troubleshooting notebook does not belong to this exact normalized scenario identity.")] };
  }

  const objectives = (scenario.troubleshootingObjectives ?? []).map((objective) => objective.evidenceOrder === "ordered"
    ? reviewOrdered(objective, notebook.entries)
    : reviewUnordered(objective, notebook.entries));
  const required = objectives.filter((objective) => objective.required);
  const requiredEvidenceStatus = required.length === 0
    ? "NOT_CONFIGURED" as const
    : required.every((objective) => objective.status === "SATISFIED") ? "SATISFIED" as const : "PENDING" as const;
  const base = {
    engineId: EVIDENCE_REVIEW_ENGINE_ID,
    engineVersion: EVIDENCE_REVIEW_ENGINE_VERSION,
    boundary: EVIDENCE_REVIEW_BOUNDARY,
    scenarioId: scenario.scenarioId,
    scenarioHash: scenario.sourceHash,
    notebookIdentity: notebook.notebookIdentity,
    requiredEvidenceStatus,
    objectives,
  } satisfies Omit<TroubleshootingEvidenceReview, "reviewIdentity">;
  const reviewIdentity = await sha256Utf8(canonicalTroubleshootingJson(reviewProjection(base)));
  return { ok: true, review: { ...base, reviewIdentity }, diagnostics: [] };
}
