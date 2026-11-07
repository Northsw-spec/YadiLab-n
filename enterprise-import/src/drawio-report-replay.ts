import { previewDrawioStructure } from "./drawio-structural-preview.js";
import { DRAWIO_REVIEWED_FORMAT, reviewDrawioVertexAssociations,
  type DrawioBuilderSnapshot, type DrawioReviewedDecision } from "./drawio-association-review.js";
import { EnterpriseImportError } from "./types.js";

const MAX_REPORT_BYTES=64*1024;
const MAX_DRAWIO_BYTES=2*1024*1024;
const HEX=/^[0-9a-f]{64}$/;
const ID=/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;
const RESERVED=new Set(["__proto__","constructor","prototype"]);
const safeId=(v:unknown):v is string=>typeof v==="string"&&ID.test(v)&&!RESERVED.has(v);
const nat=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
const rec=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const deny=(code:string):never=>{throw new EnterpriseImportError(code,code);};

/** Canonical full shape comparison with recursion/node/key/array budgets. */
function canonical(v:unknown,depth=0,budget={nodes:0}):string{
  if(++budget.nodes>1500||depth>14)deny("DRAWIO_REPLAY_REPORT_INVALID");
  if(v===null||typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);
  if(typeof v==="number"){
    if(!Number.isFinite(v))deny("DRAWIO_REPLAY_REPORT_INVALID");
    return JSON.stringify(v);
  }
  if(Array.isArray(v)){
    if(v.length>24)deny("DRAWIO_REPLAY_REPORT_INVALID");
    return "["+v.map(x=>canonical(x,depth+1,budget)).join(",")+"]";
  }
  if(rec(v)){
    const keys=Object.keys(v).sort();
    if(keys.length>25||keys.some(k=>RESERVED.has(k)))deny("DRAWIO_REPLAY_REPORT_INVALID");
    return "{"+keys.map(k=>JSON.stringify(k)+":"+canonical(v[k],depth+1,budget)).join(",")+"}";
  }
  return deny("DRAWIO_REPLAY_REPORT_INVALID");
}
function reportObject(bytes:Uint8Array):Record<string,unknown>{
  if(!(bytes instanceof Uint8Array)||bytes.length<2||bytes.length>MAX_REPORT_BYTES)
    deny("DRAWIO_REPLAY_REPORT_SIZE_INVALID");
  let value:unknown;
  try { value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)) as unknown; }
  catch { deny("DRAWIO_REPLAY_REPORT_INVALID"); }
  if(!rec(value))throw new EnterpriseImportError("DRAWIO_REPLAY_REPORT_INVALID","DRAWIO_REPLAY_REPORT_INVALID");
  canonical(value);
  return value;
}

export interface DrawioReplayMatch {
  readonly status:"REFERENCE_REPLAY_MATCH";
  readonly reportFormat:typeof DRAWIO_REVIEWED_FORMAT;
  readonly sourceSha256:string;
  readonly referencesChecked:number;
  readonly semanticTrack:"TOPOLOGY_DECLARED";
  readonly identityVerified:false;
  readonly physicalTopologyVerified:false;
  readonly engineVerified:false;
  readonly modelMutated:false;
}

/** Compare a complete P4 sidecar to fresh canonical reconstruction from original bytes. */
export async function replayDrawioSavedReferences(
  drawioBytes:Uint8Array, reportBytes:Uint8Array,
  model:DrawioBuilderSnapshot|null, acknowledged:boolean,
):Promise<DrawioReplayMatch>{
  if(acknowledged!==true)deny("DRAWIO_REPLAY_CONSENT_REQUIRED");
  if(!model)deny("DRAWIO_REPLAY_BUILDER_REQUIRED");
  if(!(drawioBytes instanceof Uint8Array)||drawioBytes.length<1||
     drawioBytes.length>MAX_DRAWIO_BYTES)deny("DRAWIO_REPLAY_SOURCE_SIZE_INVALID");
  const report=reportObject(reportBytes);
  if(report.formatId!==DRAWIO_REVIEWED_FORMAT)deny("DRAWIO_REPLAY_FORMAT_UNSUPPORTED");
  const source=report.source, target=report.targetModel, savedRefs=report.associations;
  if(report.schemaVersion!=="1.0.0"||report.status!=="REVIEWED_ASSOCIATIONS_ONLY"||
     !rec(source)||!rec(target)||
     !HEX.test(String(source.sha256))||!safeId(target.scenarioId)||
     !nat(target.sourceRevision)){
    throw new EnterpriseImportError("DRAWIO_REPLAY_REPORT_INVALID","DRAWIO_REPLAY_REPORT_INVALID");
  }
  if(!Array.isArray(savedRefs)||savedRefs.length<1||savedRefs.length>20)
    throw new EnterpriseImportError("DRAWIO_REPLAY_COUNT_INVALID","DRAWIO_REPLAY_COUNT_INVALID");

  const references:DrawioReviewedDecision["references"][number][]=[];
  for(const item of savedRefs){
    if(!rec(item)||!rec(item.locator)||item.locator.kind!=="drawio-vertex-ordinal"||
       !HEX.test(String(item.locator.sourceSha256))||
       !nat(item.locator.pageOrdinal)||!nat(item.locator.vertexOrdinal)||
       !safeId(item.targetResourceId)||
       item.assertion!=="USER_ASSERTED_ASSOCIATION_NOT_VERIFIED"){
      deny("DRAWIO_REPLAY_LOCATOR_INVALID");
    }
    references.push({pageOrdinal:item.locator.pageOrdinal,
      vertexOrdinal:item.locator.vertexOrdinal,targetResourceId:item.targetResourceId});
  }

  const preview=await previewDrawioStructure(drawioBytes).catch(()=>{
    throw new EnterpriseImportError("DRAWIO_REPLAY_SOURCE_BLOCKED","DRAWIO_REPLAY_SOURCE_BLOCKED");
  });
  if(preview.sourceSha256!==source.sha256)deny("DRAWIO_REPLAY_SOURCE_CHANGED");

  const result=reviewDrawioVertexAssociations(preview,model,{
    sourceSha256:source.sha256 as string,
    scenarioId:target.scenarioId as string,
    sourceRevision:target.sourceRevision as number,
    acknowledgeNotVerified:true,references,
  });
  if(result.status!=="READY_FOR_EXPORT")throw new EnterpriseImportError("DRAWIO_REPLAY_MODEL_MISMATCH","DRAWIO_REPLAY_MODEL_MISMATCH");
  if(canonical(report)!==canonical(result.sidecar))deny("DRAWIO_REPLAY_REPORT_MISMATCH");
  return Object.freeze({
    status:"REFERENCE_REPLAY_MATCH",
    reportFormat:DRAWIO_REVIEWED_FORMAT,
    sourceSha256:preview.sourceSha256,
    referencesChecked:references.length,
    semanticTrack:"TOPOLOGY_DECLARED",
    identityVerified:false,physicalTopologyVerified:false,
    engineVerified:false,modelMutated:false,
  });
}
