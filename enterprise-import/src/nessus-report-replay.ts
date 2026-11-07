import { previewNessusSeveritySummary } from "./nessus-v2-preview.js";
import { reviewNessusHostReferences, type NessusBuilderSnapshot,
  type NessusHostReviewDecision } from "./nessus-association-review.js";
import { EnterpriseImportError } from "./types.js";

const MAX_REPORT_BYTES=512*1024;
const MAX_SOURCE_BYTES=2*1024*1024;
const HEX=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;
const RESERVED=new Set(["__proto__","constructor","prototype"]);
const deny=(code:string):never=>{throw new EnterpriseImportError(code,code);};
const obj=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const nat=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
const safeId=(v:unknown):v is string=>typeof v==="string"&&ID.test(v)&&!RESERVED.has(v);

/** Bounded JSON lexical gate: reject duplicate keys even though JSON.parse would discard them. */
function checkJsonStructure(source:string):void{
  let at=0,nodes=0;
  const fail=():never=>deny("NESSUS_REPLAY_REPORT_INVALID");
  const skip=()=>{while(at<source.length&&/\s/.test(source[at]!))at++;};
  const readString=():string=>{
    if(source[at]!=='"')return fail();
    const start=at++;let terminated=false;
    while(at<source.length){
      const c=source[at++]!;
      if(c==='"'){terminated=true;break;}
      if(c==="\\"){if(at>=source.length)return fail();at++;}
      else if(c.charCodeAt(0)<32)return fail();
      if(at-start>16384)return fail();
    }
    if(!terminated)return fail();
    try{
      const value=JSON.parse(source.slice(start,at)) as unknown;
      if(typeof value==="string")return value;
    }catch{}
    return fail();
  };
  const value=(depth:number):void=>{
    if(++nodes>50000||depth>16)return fail();
    skip();const c=source[at];
    if(c==="{"){
      at++;skip();const keys=new Set<string>();
      if(source[at]==="}"){at++;return;}
      for(let i=0;i<32;i++){
        skip();const key=readString();
        if(key.length>128||RESERVED.has(key)||keys.has(key))return fail();
        keys.add(key);skip();if(source[at++]!==":")return fail();
        value(depth+1);skip();
        if(source[at]==="}"){at++;return;}
        if(source[at++]!==",")return fail();
      }
      return fail();
    }
    if(c==="["){
      at++;skip();if(source[at]==="]"){at++;return;}
      for(let i=0;i<1100;i++){
        value(depth+1);skip();
        if(source[at]==="]"){at++;return;}
        if(source[at++]!==",")return fail();
      }
      return fail();
    }
    if(c==='"'){readString();return;}
    const token=/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[Ee][+-]?[0-9]+)?)/.exec(source.slice(at))?.[0];
    if(!token)return fail();
    at+=token.length;
  };
  value(0);skip();if(at!==source.length)return fail();
}
function canonical(v:unknown,depth=0,budget={nodes:0}):string{
  if(++budget.nodes>50000||depth>16)return deny("NESSUS_REPLAY_REPORT_INVALID");
  if(v===null||typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);
  if(typeof v==="number"){
    if(!Number.isFinite(v))return deny("NESSUS_REPLAY_REPORT_INVALID");
    return JSON.stringify(v);
  }
  if(Array.isArray(v)){
    if(v.length>1100)return deny("NESSUS_REPLAY_REPORT_INVALID");
    return "["+v.map(x=>canonical(x,depth+1,budget)).join(",")+"]";
  }
  if(obj(v)){
    const keys=Object.keys(v).sort();
    if(keys.length>32||keys.some(k=>RESERVED.has(k)))return deny("NESSUS_REPLAY_REPORT_INVALID");
    return "{"+keys.map(k=>JSON.stringify(k)+":"+canonical(v[k],depth+1,budget)).join(",")+"}";
  }
  return deny("NESSUS_REPLAY_REPORT_INVALID");
}
function readReport(bytes:Uint8Array):Record<string,unknown>{
  if(!(bytes instanceof Uint8Array)||bytes.length<2||bytes.length>MAX_REPORT_BYTES)
    return deny("NESSUS_REPLAY_REPORT_SIZE_INVALID");
  let parsed:unknown;
  try{
    const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
    checkJsonStructure(text);
    parsed=JSON.parse(text) as unknown;
  }catch(error){
    if(error instanceof EnterpriseImportError)throw error;
    return deny("NESSUS_REPLAY_REPORT_INVALID");
  }
  if(!obj(parsed))return deny("NESSUS_REPLAY_REPORT_INVALID");
  canonical(parsed);
  return parsed;
}
export interface NessusReplayMatch{
  readonly status:"REFERENCE_REPLAY_MATCH";
  readonly reportFormat:"yadilab.nessus-reviewed-host-references";
  readonly sourceSha256:string;
  readonly referencesChecked:number;
  readonly semanticTrack:"EVIDENCE_OBSERVED";
  readonly identityVerified:false;
  readonly physicalTopologyVerified:false;
  readonly engineVerified:false;
  readonly modelMutated:false;
}

/** Rebuild the P4 sidecar from actual original scan bytes and current modeled IDs. */
export async function replayNessusSavedReferences(
  originalBytes:Uint8Array,reportBytes:Uint8Array,
  builder:NessusBuilderSnapshot|null,acknowledged:boolean,
):Promise<NessusReplayMatch>{
  if(acknowledged!==true)return deny("NESSUS_REPLAY_CONSENT_REQUIRED");
  if(!builder)return deny("NESSUS_REPLAY_BUILDER_REQUIRED");
  if(!(originalBytes instanceof Uint8Array)||originalBytes.length===0||
     originalBytes.length>MAX_SOURCE_BYTES)return deny("NESSUS_REPLAY_SOURCE_SIZE_INVALID");
  const report=readReport(reportBytes);
  if(report.formatId!=="yadilab.nessus-reviewed-host-references")
    return deny("NESSUS_REPLAY_FORMAT_UNSUPPORTED");
  const source=report.source,target=report.targetModel,associations=report.associations;
  if(report.schemaVersion!=="1.0.0"||report.status!=="REVIEWED_ASSOCIATIONS_ONLY"||
     !obj(source)||!obj(target)||!HEX.test(source.sha256 as string)||
     !safeId(target.scenarioId)||!nat(target.sourceRevision))
    return deny("NESSUS_REPLAY_REPORT_INVALID");
  if(!Array.isArray(associations)||associations.length<1||associations.length>20)
    return deny("NESSUS_REPLAY_COUNT_INVALID");
  const choices:NessusHostReviewDecision["references"][number][]=[];
  for(const item of associations){
    if(!obj(item)||!obj(item.hostLocator)||!nat(item.hostLocator.hostOrdinal)||
       !safeId(item.targetResourceId)||
       item.hostLocator.kind!=="nessus-report-host"||
       !HEX.test(item.hostLocator.sourceSha256 as string)||
       item.assertion!=="USER_ASSERTED_ASSOCIATION_NOT_VERIFIED")
      return deny("NESSUS_REPLAY_ASSOCIATION_INVALID");
    choices.push({hostOrdinal:item.hostLocator.hostOrdinal,targetResourceId:item.targetResourceId});
  }
  const parsed=await previewNessusSeveritySummary(originalBytes).catch(
    ()=>deny("NESSUS_REPLAY_SOURCE_BLOCKED"));
  if(parsed.sourceSha256!==source.sha256)return deny("NESSUS_REPLAY_SOURCE_CHANGED");
  const reviewed=reviewNessusHostReferences(parsed,builder,{
    sourceSha256:parsed.sourceSha256,
    scenarioId:target.scenarioId as string,
    sourceRevision:target.sourceRevision as number,
    acknowledgeNotVerified:true,references:choices,
  });
  if(reviewed.status!=="READY_FOR_EXPORT"||!reviewed.sidecar)
    return deny("NESSUS_REPLAY_MODEL_MISMATCH");
  if(canonical(report)!==canonical(reviewed.sidecar))
    return deny("NESSUS_REPLAY_REPORT_MISMATCH");
  return Object.freeze({
    status:"REFERENCE_REPLAY_MATCH" as const,
    reportFormat:"yadilab.nessus-reviewed-host-references" as const,
    sourceSha256:parsed.sourceSha256,
    referencesChecked:choices.length,
    semanticTrack:"EVIDENCE_OBSERVED" as const,
    identityVerified:false as const,physicalTopologyVerified:false as const,
    engineVerified:false as const,modelMutated:false as const,
  });
}
