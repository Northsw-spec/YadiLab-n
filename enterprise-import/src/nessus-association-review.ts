import type { NessusSeveritySummary } from "./nessus-v2-preview.js";
import { NESSUS_EVIDENCE_PROFILE } from "./nessus-v2-preview.js";

export const NESSUS_REVIEWED_REFERENCES_FORMAT = "yadilab.nessus-reviewed-host-references" as const;
export const MAX_NESSUS_REVIEWED_HOSTS = 20;
const HEX=/^[0-9a-f]{64}$/;
const ID=/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;
const RESERVED=new Set(["__proto__","constructor","prototype"]);
const safeId=(x:unknown):x is string=>typeof x==="string" && ID.test(x) && !RESERVED.has(x);
const rev=(x:unknown):x is number=>Number.isSafeInteger(x) && (x as number)>=0;

export interface NessusBuilderSnapshot {
  readonly scenarioId:string;
  readonly sourceRevision:number;
  readonly resources:readonly {readonly id:string;readonly label:string}[];
}
export interface NessusHostReviewDecision {
  readonly sourceSha256:string;
  readonly scenarioId:string;
  readonly sourceRevision:number;
  readonly acknowledgeNotVerified:boolean;
  readonly references:readonly {readonly hostOrdinal:number;readonly targetResourceId:string}[];
}
export interface NessusHostReference {
  readonly hostLocator:{
    readonly kind:"nessus-report-host";
    readonly sourceSha256:string;
    readonly hostOrdinal:number;
  };
  readonly targetResourceId:string;
  readonly assertion:"USER_ASSERTED_ASSOCIATION_NOT_VERIFIED";
}
export interface NessusReviewedHostSidecar {
  readonly formatId:typeof NESSUS_REVIEWED_REFERENCES_FORMAT;
  readonly schemaVersion:"1.0.0";
  readonly status:"REVIEWED_ASSOCIATIONS_ONLY";
  readonly source:{readonly profileId:typeof NESSUS_EVIDENCE_PROFILE;
    readonly sha256:string;readonly semanticTrack:"EVIDENCE_OBSERVED"};
  readonly targetModel:{readonly scenarioId:string;readonly sourceRevision:number};
  readonly associations:readonly NessusHostReference[];
  readonly warnings:readonly string[];
  readonly engineVerified:false;
  readonly physicalTopologyVerified:false;
  readonly identityVerified:false;
  readonly modelMutated:false;
}
export type NessusHostReviewResult =
  | {readonly status:"BLOCKED";readonly diagnostics:readonly {readonly code:string;readonly message:string}[]}
  | {readonly status:"READY_FOR_EXPORT";readonly diagnostics:readonly [];readonly sidecar:NessusReviewedHostSidecar};
const blocked=(code:string):NessusHostReviewResult=>({
  status:"BLOCKED",diagnostics:[{code,message:code}],
});

/** Operator-selected ordinal references only. Not any factual asset mapping. */
export function reviewNessusHostReferences(
  preview:NessusSeveritySummary,
  model:NessusBuilderSnapshot|null,
  decision:NessusHostReviewDecision,
):NessusHostReviewResult {
  if(!preview||preview.profileId!==NESSUS_EVIDENCE_PROFILE ||
     preview.status!=="EVIDENCE_ONLY" || preview.semanticTrack!=="EVIDENCE_OBSERVED" ||
     preview.canActivate!==false || preview.engineVerified!==false ||
     preview.physicalTopologyVerified!==false || !HEX.test(preview.sourceSha256) ||
     !rev(preview.hostCount)||preview.hostCount>256||
     !rev(preview.findingCount)||preview.findingCount>10000 ||
     !Array.isArray(preview.severityCounts)||preview.severityCounts.length!==5||
     !preview.severityCounts.every(rev) ||
     preview.severityCounts.reduce((sum,x)=>sum+x,0)!==preview.findingCount) {
    return blocked("NESSUS_ASSOC_SOURCE_INVALID");
  }
  if(!model||!safeId(model.scenarioId)||!rev(model.sourceRevision)||
     !Array.isArray(model.resources))return blocked("NESSUS_ASSOC_BUILDER_REQUIRED");
  const ids=new Set<string>();
  for(const resource of model.resources){
    if(!resource||!safeId(resource.id)||typeof resource.label!=="string"||
       resource.label.length>512||ids.has(resource.id)){
      return blocked("NESSUS_ASSOC_MODEL_INVALID");
    }
    ids.add(resource.id);
  }
  if(!decision||decision.sourceSha256!==preview.sourceSha256||
     decision.scenarioId!==model.scenarioId||
     decision.sourceRevision!==model.sourceRevision){
    return blocked("NESSUS_ASSOC_STALE");
  }
  if(decision.acknowledgeNotVerified!==true)return blocked("NESSUS_ASSOC_ACK_REQUIRED");
  if(!Array.isArray(decision.references)||decision.references.length<1||
     decision.references.length>MAX_NESSUS_REVIEWED_HOSTS||
     decision.references.length>preview.hostCount)return blocked("NESSUS_ASSOC_COUNT_INVALID");
  const ordinals=new Set<number>(),targets=new Set<string>(),associations:NessusHostReference[]=[];
  for(const ref of decision.references){
    if(!ref||!rev(ref.hostOrdinal)||
       ref.hostOrdinal>=preview.hostCount||
       !safeId(ref.targetResourceId)||!ids.has(ref.targetResourceId)||
       ordinals.has(ref.hostOrdinal)||targets.has(ref.targetResourceId)){
      return blocked("NESSUS_ASSOC_SELECTION_INVALID");
    }
    ordinals.add(ref.hostOrdinal);
    targets.add(ref.targetResourceId);
    associations.push({
      hostLocator:{kind:"nessus-report-host",sourceSha256:preview.sourceSha256,
        hostOrdinal:ref.hostOrdinal},
      targetResourceId:ref.targetResourceId,
      assertion:"USER_ASSERTED_ASSOCIATION_NOT_VERIFIED",
    });
  }
  associations.sort((a,b)=>a.hostLocator.hostOrdinal-b.hostLocator.hostOrdinal);
  return {
    status:"READY_FOR_EXPORT",diagnostics:[],
    sidecar:{
      formatId:NESSUS_REVIEWED_REFERENCES_FORMAT,
      schemaVersion:"1.0.0",status:"REVIEWED_ASSOCIATIONS_ONLY",
      source:{profileId:NESSUS_EVIDENCE_PROFILE,sha256:preview.sourceSha256,
        semanticTrack:"EVIDENCE_OBSERVED"},
      targetModel:{scenarioId:model.scenarioId,sourceRevision:model.sourceRevision},
      associations,
      warnings:[
        "ReportHost ordinal references are operator-selected and are NOT independently verified identities, vulnerabilities, scan time, IP addresses or physical network facts.",
        "No source host names, IPs, plugin data or finding text were exported. Builder, ScenarioSource and Engine remain unchanged.",
      ],
      engineVerified:false,physicalTopologyVerified:false,
      identityVerified:false,modelMutated:false,
    },
  };
}
