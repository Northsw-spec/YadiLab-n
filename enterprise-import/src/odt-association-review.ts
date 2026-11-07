import type { OdtReviewedCell } from "./odt-cell-disclosure.js";

export const ODT_REVIEWED_ASSOCIATION_FORMAT = "yadilab.odt-reviewed-cell-references" as const;
const ID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/;
const RESERVED = new Set(["__proto__","prototype","constructor"]);
const safeId = (x:unknown):x is string => typeof x==="string" && ID.test(x) && !RESERVED.has(x);
const revision = (x:unknown):x is number => Number.isSafeInteger(x) && (x as number)>=0;
const exactKeys = (obj:unknown,keys:string[]):boolean =>
  !!obj && typeof obj==="object" && !Array.isArray(obj) &&
  Object.keys(obj).sort().join("|")===keys.sort().join("|");

export interface OdtBuilderSnapshot {
  readonly scenarioId:string;
  readonly sourceRevision:number;
  readonly resources:readonly { readonly id:string; readonly label:string }[];
}
export interface OdtAssociationDecision {
  readonly sourceSha256:string;
  readonly scenarioId:string;
  readonly sourceRevision:number;
  readonly targetResourceId:string;
  readonly acknowledgeNotVerified:boolean;
}
export interface OdtReviewedAssociationSidecar {
  readonly formatId:typeof ODT_REVIEWED_ASSOCIATION_FORMAT;
  readonly schemaVersion:"1.0.0";
  readonly status:"REVIEWED_ASSOCIATIONS_ONLY";
  readonly source:{
    readonly profileId:"office.odt-tables.structural.v1";
    readonly sha256:string;
    readonly semanticTrack:"CONFIG_DOCUMENTED";
    readonly cellLocator:{
      readonly kind:"odt-table-cell";
      readonly part:"content.xml";
      readonly sourceSha256:string;
      readonly tableOrdinal:number;
      readonly rowOrdinal:number;
      readonly cellOrdinal:number;
    };
  };
  readonly targetModel:{readonly scenarioId:string;readonly sourceRevision:number};
  readonly association:{
    readonly targetResourceId:string;
    readonly assertion:"USER_ASSERTED_ASSOCIATION_NOT_VERIFIED";
  };
  readonly engineVerified:false;
  readonly physicalTopologyVerified:false;
  readonly warnings:readonly string[];
}
export type OdtAssociationResult =
 | {readonly status:"BLOCKED";readonly diagnostics:readonly {readonly code:string;readonly message:string}[]}
 | {readonly status:"READY_FOR_EXPORT";readonly sidecar:OdtReviewedAssociationSidecar;readonly diagnostics:readonly []};
function blocked(code:string):OdtAssociationResult {
  return {status:"BLOCKED",diagnostics:[{code,message:code}]};
}
/**
 * Pure metadata-only operator-declared ODT cell -> EXISTING modeled resource.
 * Only use after consented P3 disclosure and a fresh P3 source validation
 * immediately before export. This never asserts any real asset identity.
 */
export function reviewOdtCellAssociation(
  disclosed:OdtReviewedCell,
  model:OdtBuilderSnapshot|null,
  decision:OdtAssociationDecision,
):OdtAssociationResult {
  if(!disclosed ||
     !exactKeys(disclosed,["status","semanticTrack","sourceSha256","locator","text",
       "canActivate","engineVerified","physicalTopologyVerified"]) ||
     disclosed.status!=="REVEALED_UNVERIFIED" ||
     disclosed.semanticTrack!=="CONFIG_DOCUMENTED" ||
     disclosed.canActivate!==false || disclosed.engineVerified!==false ||
     disclosed.physicalTopologyVerified!==false ||
     typeof disclosed.sourceSha256!=="string" || !SHA.test(disclosed.sourceSha256) ||
     !disclosed.locator ||
     !exactKeys(disclosed.locator,["kind","part","sourceSha256",
       "tableOrdinal","rowOrdinal","cellOrdinal"]) ||
     disclosed.locator.kind!=="odt-table-cell" ||
     disclosed.locator.part!=="content.xml" ||
     disclosed.locator.sourceSha256!==disclosed.sourceSha256 ||
     !revision(disclosed.locator.tableOrdinal) ||
     !revision(disclosed.locator.rowOrdinal) ||
     !revision(disclosed.locator.cellOrdinal) ||
     typeof disclosed.text!=="string" || disclosed.text.length===0 ||
     disclosed.text.length>128) return blocked("ODT_ASSOC_REVIEW_REQUIRED");

  if(!model || !safeId(model.scenarioId) || !revision(model.sourceRevision) ||
      !Array.isArray(model.resources))return blocked("ODT_ASSOC_BUILDER_REQUIRED");
  const ids=new Set<string>();
  for(const item of model.resources){
    if(!item || !safeId(item.id) || typeof item.label!=="string" ||
       item.label.length>512 || ids.has(item.id))return blocked("ODT_ASSOC_MODEL_INVALID");
    ids.add(item.id);
  }
  if(!decision || decision.sourceSha256!==disclosed.sourceSha256 ||
     decision.scenarioId!==model.scenarioId ||
     decision.sourceRevision!==model.sourceRevision)return blocked("ODT_ASSOC_STALE");
  if(decision.acknowledgeNotVerified!==true)return blocked("ODT_ASSOC_ACK_REQUIRED");
  if(!safeId(decision.targetResourceId)||!ids.has(decision.targetResourceId)){
    return blocked("ODT_ASSOC_TARGET_INVALID");
  }
  return {
    status:"READY_FOR_EXPORT",diagnostics:[],
    sidecar:{
      formatId:ODT_REVIEWED_ASSOCIATION_FORMAT,
      schemaVersion:"1.0.0",status:"REVIEWED_ASSOCIATIONS_ONLY",
      source:{
        profileId:"office.odt-tables.structural.v1",sha256:disclosed.sourceSha256,
        semanticTrack:"CONFIG_DOCUMENTED",
        cellLocator:{
          kind:"odt-table-cell",part:"content.xml",
          sourceSha256:disclosed.locator.sourceSha256,
          tableOrdinal:disclosed.locator.tableOrdinal,
          rowOrdinal:disclosed.locator.rowOrdinal,
          cellOrdinal:disclosed.locator.cellOrdinal,
        },
      },
      targetModel:{scenarioId:model.scenarioId,sourceRevision:model.sourceRevision},
      association:{
        targetResourceId:decision.targetResourceId,
        assertion:"USER_ASSERTED_ASSOCIATION_NOT_VERIFIED",
      },
      engineVerified:false,physicalTopologyVerified:false,
      warnings:[
        "This is an operator-selected ODT document-cell-to-modeled-resource reference, NOT verified asset identity or physical network topology.",
        "The original ODT cell value is NOT exported. Builder resources, ScenarioSource and Engine remain unchanged.",
      ],
    },
  };
}
