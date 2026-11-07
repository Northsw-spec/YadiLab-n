import { DRAWIO_PREVIEW_PROFILE, type DrawioStructurePreview } from "./drawio-structural-preview.js";

export const DRAWIO_REVIEWED_FORMAT = "yadilab.drawio-reviewed-vertex-references" as const;
export const MAX_DRAWIO_REVIEWED_VERTICES = 20;
const HEX=/^[0-9a-f]{64}$/;
const ID=/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;
const RESERVED=new Set(["__proto__","constructor","prototype"]);
const safeId=(v:unknown):v is string=>typeof v==="string"&&ID.test(v)&&!RESERVED.has(v);
const safeOrdinal=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
export interface DrawioBuilderSnapshot {
  readonly scenarioId:string;
  readonly sourceRevision:number;
  readonly resources:readonly {readonly id:string;readonly label:string}[];
}
export interface DrawioReviewedDecision {
  readonly sourceSha256:string;
  readonly scenarioId:string;
  readonly sourceRevision:number;
  readonly acknowledgeNotVerified:boolean;
  readonly references:readonly {readonly pageOrdinal:number;readonly vertexOrdinal:number;readonly targetResourceId:string}[];
}
export interface DrawioReviewedSidecar {
  readonly formatId:typeof DRAWIO_REVIEWED_FORMAT;
  readonly schemaVersion:"1.0.0";
  readonly status:"REVIEWED_ASSOCIATIONS_ONLY";
  readonly source:{readonly profileId:typeof DRAWIO_PREVIEW_PROFILE;readonly sha256:string;readonly semanticTrack:"TOPOLOGY_DECLARED"};
  readonly targetModel:{readonly scenarioId:string;readonly sourceRevision:number};
  readonly associations:readonly {
    readonly locator:{readonly kind:"drawio-vertex-ordinal";readonly sourceSha256:string;readonly pageOrdinal:number;readonly vertexOrdinal:number};
    readonly targetResourceId:string;
    readonly assertion:"USER_ASSERTED_ASSOCIATION_NOT_VERIFIED";
  }[];
  readonly warnings:readonly string[];
  readonly identityVerified:false;
  readonly physicalTopologyVerified:false;
  readonly engineVerified:false;
  readonly modelMutated:false;
}
export type DrawioReviewedResult =
 | {readonly status:"BLOCKED";readonly diagnostics:readonly {readonly code:string;readonly message:string}[]}
 | {readonly status:"READY_FOR_EXPORT";readonly diagnostics:readonly [];readonly sidecar:DrawioReviewedSidecar};
const blocked=(code:string):DrawioReviewedResult=>({status:"BLOCKED",diagnostics:[{code,message:code}]});

/** Validate all preview fields, not merely a spoofable source hash. */
export function validDrawioSummary(s:DrawioStructurePreview):boolean{
  if(!s||s.profileId!==DRAWIO_PREVIEW_PROFILE||s.status!=="PREVIEW_ONLY"||
     s.semanticTrack!=="TOPOLOGY_DECLARED"||s.canActivate!==false||
     s.engineVerified!==false||s.physicalTopologyVerified!==false||
     s.modelMutated!==false||typeof s.sourceSha256!=="string"||!HEX.test(s.sourceSha256)||
     !safeOrdinal(s.pageCount)||s.pageCount<1||s.pageCount>16||
     !safeOrdinal(s.vertexCount)||s.vertexCount>1000||
     !safeOrdinal(s.drawnEdgeCount)||s.drawnEdgeCount>2000||
     !safeOrdinal(s.compressedPageCount)||s.compressedPageCount>s.pageCount||
     !Array.isArray(s.pages)||s.pages.length!==s.pageCount)return false;
  let vertexSum=0,edgeSum=0;
  for(const [ordinal,p] of s.pages.entries()){
    if(!p||p.pageOrdinal!==ordinal||!safeOrdinal(p.vertexCount)||
       !safeOrdinal(p.drawnEdgeCount))return false;
    vertexSum+=p.vertexCount;edgeSum+=p.drawnEdgeCount;
  }
  return vertexSum===s.vertexCount&&edgeSum===s.drawnEdgeCount;
}
function validBuilder(model:DrawioBuilderSnapshot|null):boolean{
  if(!model||!safeId(model.scenarioId)||!safeOrdinal(model.sourceRevision)||
     !Array.isArray(model.resources)||model.resources.length>20000)return false;
  const known=new Set<string>();
  for(const r of model.resources){
    if(!r||!safeId(r.id)||typeof r.label!=="string"||r.label.length>512||
       known.has(r.id))return false;
    known.add(r.id);
  }
  return true;
}
export function reviewDrawioVertexAssociations(
  preview:DrawioStructurePreview,
  model:DrawioBuilderSnapshot|null,
  decision:DrawioReviewedDecision,
):DrawioReviewedResult{
  if(!validDrawioSummary(preview))return blocked("DRAWIO_ASSOC_SOURCE_INVALID");
  if(!validBuilder(model))return blocked("DRAWIO_ASSOC_BUILDER_REQUIRED");
  if(!model)return blocked("DRAWIO_ASSOC_BUILDER_REQUIRED");
  if(!decision||decision.sourceSha256!==preview.sourceSha256||
     decision.scenarioId!==model.scenarioId||
     decision.sourceRevision!==model.sourceRevision)return blocked("DRAWIO_ASSOC_STALE");
  if(decision.acknowledgeNotVerified!==true)return blocked("DRAWIO_ASSOC_ACK_REQUIRED");
  if(!Array.isArray(decision.references)||decision.references.length<1||
     decision.references.length>MAX_DRAWIO_REVIEWED_VERTICES)return blocked("DRAWIO_ASSOC_COUNT_INVALID");
  const resources=new Set(model.resources.map(x=>x.id));
  const sources=new Set<string>(),targets=new Set<string>();
  const associations:DrawioReviewedSidecar["associations"][number][]=[];
  for(const item of decision.references){
    if(!item||!safeOrdinal(item.pageOrdinal)||item.pageOrdinal>=preview.pageCount||
       !safeOrdinal(item.vertexOrdinal)||item.vertexOrdinal>=preview.pages[item.pageOrdinal]!.vertexCount||
       !safeId(item.targetResourceId)||!resources.has(item.targetResourceId)){
      return blocked("DRAWIO_ASSOC_SELECTION_INVALID");
    }
    const key=item.pageOrdinal+":"+item.vertexOrdinal;
    if(sources.has(key)||targets.has(item.targetResourceId)){
      return blocked("DRAWIO_ASSOC_DUPLICATE");
    }
    sources.add(key);targets.add(item.targetResourceId);
    associations.push({
      locator:{kind:"drawio-vertex-ordinal",sourceSha256:preview.sourceSha256,
        pageOrdinal:item.pageOrdinal,vertexOrdinal:item.vertexOrdinal},
      targetResourceId:item.targetResourceId,
      assertion:"USER_ASSERTED_ASSOCIATION_NOT_VERIFIED",
    });
  }
  associations.sort((a,b)=>a.locator.pageOrdinal-b.locator.pageOrdinal||
    a.locator.vertexOrdinal-b.locator.vertexOrdinal);
  return {status:"READY_FOR_EXPORT",diagnostics:[],sidecar:{
    formatId:DRAWIO_REVIEWED_FORMAT,schemaVersion:"1.0.0",status:"REVIEWED_ASSOCIATIONS_ONLY",
    source:{profileId:DRAWIO_PREVIEW_PROFILE,sha256:preview.sourceSha256,
      semanticTrack:"TOPOLOGY_DECLARED"},
    targetModel:{scenarioId:model.scenarioId,sourceRevision:model.sourceRevision},
    associations,
    warnings:[
      "Manual page and vertex ordinal references are unverified source positions, not identified physical assets or observed network state.",
      "Drawn edges are NOT physical cables. Builder, ScenarioSource, Engine and topology remain unchanged.",
    ],
    identityVerified:false,physicalTopologyVerified:false,
    engineVerified:false,modelMutated:false,
  }};
}
