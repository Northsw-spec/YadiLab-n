import type { DocxDisclosedCell } from "./docx-cell-disclosure.js";

export const DOCX_REVIEWED_ASSOCIATION_FORMAT = "yadilab.docx-reviewed-cell-references" as const;
const ID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;
const HEX = /^[0-9a-f]{64}$/;
const FORBIDDEN_IDS = new Set(["__proto__", "constructor", "prototype"]);
const safeId = (text: unknown): text is string =>
  typeof text === "string" && ID.test(text) && !FORBIDDEN_IDS.has(text);
const revision = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

export interface DocxBuilderSnapshot {
  readonly scenarioId: string;
  readonly sourceRevision: number;
  readonly resources: readonly { readonly id: string; readonly label: string }[];
}
export interface DocxAssociationDecision {
  readonly sourceSha256: string;
  readonly scenarioId: string;
  readonly sourceRevision: number;
  readonly targetResourceId: string;
  readonly acknowledgeNotVerified: boolean;
}
export interface DocxReviewedAssociationSidecar {
  readonly formatId: typeof DOCX_REVIEWED_ASSOCIATION_FORMAT;
  readonly schemaVersion: "1.0.0";
  readonly status: "REVIEWED_ASSOCIATIONS_ONLY";
  readonly source: {
    readonly profileId: "office.docx-tables.structural.v1";
    readonly sha256: string;
    readonly semanticTrack: "CONFIG_DOCUMENTED";
    readonly cellLocator: {
      readonly kind: "docx-table-cell";
      readonly sourceSha256: string;
      readonly part: "word/document.xml";
      readonly tableOrdinal: number;
      readonly rowOrdinal: number;
      readonly cellOrdinal: number;
    };
  };
  readonly targetModel: { readonly scenarioId: string; readonly sourceRevision: number };
  readonly association: {
    readonly targetResourceId: string;
    readonly assertion: "USER_ASSERTED_ASSOCIATION_NOT_VERIFIED";
  };
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
  readonly warnings: readonly string[];
}
export type DocxAssociationResult =
  | { readonly status: "READY_FOR_EXPORT"; readonly sidecar: DocxReviewedAssociationSidecar; readonly diagnostics: readonly [] }
  | { readonly status: "BLOCKED"; readonly diagnostics: readonly { readonly code: string; readonly message: string }[] };
function blocked(code: string): DocxAssociationResult {
  return { status: "BLOCKED", diagnostics: [{ code, message: code }] };
}
export function reviewDocxCellAssociation(
  disclosed: DocxDisclosedCell,
  model: DocxBuilderSnapshot | null,
  decision: DocxAssociationDecision,
): DocxAssociationResult {
  if (!disclosed || disclosed.status !== "REVEALED_UNVERIFIED" ||
      disclosed.semanticTrack !== "CONFIG_DOCUMENTED" ||
      disclosed.canActivate !== false || disclosed.engineVerified !== false ||
      disclosed.physicalTopologyVerified !== false ||
      !HEX.test(disclosed.sourceSha256) || !disclosed.locator ||
      disclosed.locator.kind !== "docx-table-cell" ||
      disclosed.locator.part !== "word/document.xml" ||
      disclosed.locator.sourceSha256 !== disclosed.sourceSha256 ||
      ![disclosed.locator.tableOrdinal, disclosed.locator.rowOrdinal, disclosed.locator.cellOrdinal]
        .every(n => revision(n)) || typeof disclosed.text !== "string" || !disclosed.text.length) {
    return blocked("DOCX_ASSOC_REVIEW_REQUIRED");
  }
  if (!model || !safeId(model.scenarioId) || !revision(model.sourceRevision) ||
      !Array.isArray(model.resources)) return blocked("DOCX_ASSOC_BUILDER_REQUIRED");
  const ids = new Set<string>();
  for (const r of model.resources) {
    if (!r || !safeId(r.id) || typeof r.label !== "string" || r.label.length > 512 ||
        ids.has(r.id)) return blocked("DOCX_ASSOC_MODEL_INVALID");
    ids.add(r.id);
  }
  if (!decision || decision.sourceSha256 !== disclosed.sourceSha256 ||
      decision.scenarioId !== model.scenarioId ||
      decision.sourceRevision !== model.sourceRevision) return blocked("DOCX_ASSOC_STALE");
  if (decision.acknowledgeNotVerified !== true) return blocked("DOCX_ASSOC_ACK_REQUIRED");
  if (!safeId(decision.targetResourceId) || !ids.has(decision.targetResourceId)) {
    return blocked("DOCX_ASSOC_TARGET_INVALID");
  }
  return {
    status: "READY_FOR_EXPORT",
    diagnostics: [],
    sidecar: {
      formatId: DOCX_REVIEWED_ASSOCIATION_FORMAT,
      schemaVersion: "1.0.0",
      status: "REVIEWED_ASSOCIATIONS_ONLY",
      source: {
        profileId: "office.docx-tables.structural.v1",
        sha256: disclosed.sourceSha256,
        semanticTrack: "CONFIG_DOCUMENTED",
        cellLocator: {
          kind: "docx-table-cell", sourceSha256: disclosed.locator.sourceSha256,
          part: "word/document.xml", tableOrdinal: disclosed.locator.tableOrdinal,
          rowOrdinal: disclosed.locator.rowOrdinal, cellOrdinal: disclosed.locator.cellOrdinal,
        },
      },
      targetModel: { scenarioId: model.scenarioId, sourceRevision: model.sourceRevision },
      association: { targetResourceId: decision.targetResourceId,
        assertion: "USER_ASSERTED_ASSOCIATION_NOT_VERIFIED" },
      engineVerified: false,
      physicalTopologyVerified: false,
      warnings: [
        "Operator-selected document-cell-to-modeled-resource reference, NOT a verified asset identity or physical topology.",
        "The DOCX cell text is NOT included in this sidecar. No Builder resource, ScenarioSource or Engine state was changed.",
      ],
    },
  };
}
