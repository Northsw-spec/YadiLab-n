import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";

/**
 * A source edit cannot silently keep presenting an old DOCX review as current.
 * The metadata remains available for audit/replay, but is explicitly historical
 * until a fresh, source-bound review is activated.
 */
export function markOfficeReviewProvenanceHistorical(source: ScenarioSource): ScenarioSource {
  const provenance = source.officeReviewProvenance;
  if (!provenance || provenance.status !== "CURRENT") return source;
  return {
    ...source,
    officeReviewProvenance: { ...provenance, status: "HISTORICAL" },
  };
}
