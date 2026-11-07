import type { OdtBuilderSnapshot, OdtReviewedAssociationSidecar } from "./odt-association-review.js";
import { ODT_REVIEWED_ASSOCIATION_FORMAT } from "./odt-association-review.js";

export const ODT_MULTI_REFERENCE_FORMAT = "yadilab.odt-reviewed-multi-references" as const;
export const MAX_ODT_REVIEWED_REFERENCES = 10;
const HEX = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);
const safeId = (v: unknown): v is string =>
  typeof v === "string" && ID.test(v) && !RESERVED.has(v);
const safeRevision = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const exactly = (v: unknown, keys: string[]): boolean =>
  !!v && typeof v === "object" && !Array.isArray(v) &&
  Object.keys(v).sort().join("|") === keys.sort().join("|");
const locatorFields = ["kind","sourceSha256","part","tableOrdinal","rowOrdinal","cellOrdinal"];

export interface OdtMultiDecision {
  readonly sourceSha256: string;
  readonly scenarioId: string;
  readonly sourceRevision: number;
  readonly acknowledgeNotVerified: boolean;
}
export interface OdtMultiReference {
  readonly cellLocator: {
    readonly kind: "odt-table-cell";
    readonly part: "content.xml";
    readonly sourceSha256: string;
    readonly tableOrdinal: number;
    readonly rowOrdinal: number;
    readonly cellOrdinal: number;
  };
  readonly targetResourceId: string;
  readonly assertion: "USER_ASSERTED_ASSOCIATION_NOT_VERIFIED";
}
export interface OdtMultiSidecar {
  readonly formatId: typeof ODT_MULTI_REFERENCE_FORMAT;
  readonly schemaVersion: "1.0.0";
  readonly status: "REVIEWED_ASSOCIATIONS_ONLY";
  readonly source: {
    readonly profileId: "office.odt-tables.structural.v1";
    readonly sha256: string;
    readonly semanticTrack: "CONFIG_DOCUMENTED";
  };
  readonly targetModel: { readonly scenarioId: string; readonly sourceRevision: number };
  readonly references: readonly OdtMultiReference[];
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
  readonly warnings: readonly string[];
}
export type OdtMultiResult =
 | { readonly status: "BLOCKED"; readonly diagnostics: readonly { readonly code: string; readonly message: string }[] }
 | { readonly status: "READY_FOR_EXPORT"; readonly diagnostics: readonly []; readonly sidecar: OdtMultiSidecar };
function block(code: string): OdtMultiResult {
  return { status: "BLOCKED", diagnostics: [{ code, message: code }] };
}

/** Fail-closed, deterministic **metadata-only** aggregation of P4 review outputs. */
export function reviewOdtMultiReferences(
  staged: readonly OdtReviewedAssociationSidecar[],
  model: OdtBuilderSnapshot | null,
  decision: OdtMultiDecision,
): OdtMultiResult {
  if (!model || !safeId(model.scenarioId) || !safeRevision(model.sourceRevision) ||
      !Array.isArray(model.resources)) return block("ODT_MULTI_BUILDER_REQUIRED");
  const ids = new Set<string>();
  for (const resource of model.resources) {
    if (!resource || !safeId(resource.id) || typeof resource.label !== "string" ||
        resource.label.length > 512 || ids.has(resource.id)) return block("ODT_MULTI_MODEL_INVALID");
    ids.add(resource.id);
  }
  if (!decision || !HEX.test(decision.sourceSha256) ||
      decision.scenarioId !== model.scenarioId ||
      decision.sourceRevision !== model.sourceRevision) return block("ODT_MULTI_STALE");
  if (decision.acknowledgeNotVerified !== true) return block("ODT_MULTI_ACK_REQUIRED");
  if (!Array.isArray(staged) || staged.length < 2 ||
      staged.length > MAX_ODT_REVIEWED_REFERENCES) return block("ODT_MULTI_COUNT_INVALID");

  const cellKeys = new Set<string>(), targets = new Set<string>();
  const references: OdtMultiReference[] = [];
  for (const item of staged) {
    if (!exactly(item, ["formatId","schemaVersion","status","source","targetModel",
      "association","engineVerified","physicalTopologyVerified","warnings"]) ||
      item.formatId !== ODT_REVIEWED_ASSOCIATION_FORMAT ||
      item.schemaVersion !== "1.0.0" || item.status !== "REVIEWED_ASSOCIATIONS_ONLY" ||
      item.engineVerified !== false || item.physicalTopologyVerified !== false ||
      !exactly(item.source, ["profileId","sha256","semanticTrack","cellLocator"]) ||
      item.source.profileId !== "office.odt-tables.structural.v1" ||
      item.source.semanticTrack !== "CONFIG_DOCUMENTED" ||
      item.source.sha256 !== decision.sourceSha256 ||
      !exactly(item.targetModel,["scenarioId","sourceRevision"]) ||
      item.targetModel.scenarioId !== model.scenarioId ||
      item.targetModel.sourceRevision !== model.sourceRevision ||
      !exactly(item.association,["targetResourceId","assertion"]) ||
      item.association.assertion !== "USER_ASSERTED_ASSOCIATION_NOT_VERIFIED" ||
      !safeId(item.association.targetResourceId) || !ids.has(item.association.targetResourceId) ||
      !Array.isArray(item.warnings) ||
      item.warnings.length !== 2 ||
      item.warnings[0] !== "This is an operator-selected ODT document-cell-to-modeled-resource reference, NOT verified asset identity or physical network topology." ||
      item.warnings[1] !== "The original ODT cell value is NOT exported. Builder resources, ScenarioSource and Engine remain unchanged.") {
      return block("ODT_MULTI_REFERENCE_INVALID");
    }
    const loc = item.source.cellLocator;
    if (!exactly(loc,locatorFields) ||
        loc.kind !== "odt-table-cell" || loc.part !== "content.xml" ||
        loc.sourceSha256 !== decision.sourceSha256 ||
        !safeRevision(loc.tableOrdinal) || !safeRevision(loc.rowOrdinal) ||
        !safeRevision(loc.cellOrdinal)) return block("ODT_MULTI_LOCATOR_INVALID");
    const key = [loc.tableOrdinal,loc.rowOrdinal,loc.cellOrdinal].join(":");
    if (cellKeys.has(key) || targets.has(item.association.targetResourceId)) {
      return block("ODT_MULTI_DUPLICATE_REFERENCE");
    }
    cellKeys.add(key);
    targets.add(item.association.targetResourceId);
    references.push({
      cellLocator: {kind:"odt-table-cell",part:"content.xml",
        sourceSha256: loc.sourceSha256,tableOrdinal:loc.tableOrdinal,
        rowOrdinal:loc.rowOrdinal,cellOrdinal:loc.cellOrdinal},
      targetResourceId:item.association.targetResourceId,
      assertion:"USER_ASSERTED_ASSOCIATION_NOT_VERIFIED",
    });
  }
  references.sort((a,b) => a.cellLocator.tableOrdinal - b.cellLocator.tableOrdinal ||
    a.cellLocator.rowOrdinal - b.cellLocator.rowOrdinal ||
    a.cellLocator.cellOrdinal - b.cellLocator.cellOrdinal);
  return {
    status:"READY_FOR_EXPORT",diagnostics:[],
    sidecar:{
      formatId:ODT_MULTI_REFERENCE_FORMAT,schemaVersion:"1.0.0",
      status:"REVIEWED_ASSOCIATIONS_ONLY",
      source:{profileId:"office.odt-tables.structural.v1",
        sha256:decision.sourceSha256,semanticTrack:"CONFIG_DOCUMENTED"},
      targetModel:{scenarioId:model.scenarioId,sourceRevision:model.sourceRevision},
      references,engineVerified:false,physicalTopologyVerified:false,
      warnings:[
        "All document-cell-to-model references are operator-selected and NOT independently verified asset identities or physical network facts.",
        "No ODT cell values were included; this report did not modify Builder or Engine state.",
      ],
    },
  };
}
