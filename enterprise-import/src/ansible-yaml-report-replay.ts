import { previewAnsibleStaticInventory } from "./ansible-yaml-preview.js";
import { ANSIBLE_ASSOCIATION_FORMAT, reviewAnsibleInventoryAssociations,
  type AnsibleBuilderSnapshot, type AnsibleAssociationDecision } from "./ansible-association-review.js";
import { EnterpriseImportError } from "./types.js";

const MAX_REPORT_BYTES=256*1024;
const MAX_SOURCE_BYTES=256*1024;
const HEX=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;
const RESERVED=new Set(["__proto__","constructor","prototype"]);
const deny=(code:string):never=>{throw new EnterpriseImportError(code,code);};
const obj=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const safeId=(v:unknown):v is string=>typeof v==="string"&&ID.test(v)&&!RESERVED.has(v);
const nat=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;

/**
 * Strict JSON lexical gate before JSON.parse: rejects duplicate keys even when
 * JSON.parse would silently keep the last property. All boundaries are fixed.
 * No eval, prototype assignment, unbounded recursion or raw input in errors.
 */
function checkJsonStructure(source:string):void{
  let index=0,nodes=0;
  const skip=()=>{while(index<source.length&&/\s/.test(source[index]!))index++;};
  const fail=()=>deny("ANSIBLE_YAML_REPLAY_REPORT_INVALID");
  const string=():string=>{
    if(source[index]!=='"')return fail();
    const start=index++;
    let closed=false;
    while(index<source.length){
      const c=source[index++]!;
      if(c==='"'){closed=true;break;}
      if(c==="\\"){if(index>=source.length)return fail();index++;}
      else if(c.charCodeAt(0)<32)return fail();
      if(index-start>16384)return fail();
    }
    if(!closed)return fail();
    let v:unknown;
    try{v=JSON.parse(source.slice(start,index)) as unknown;}catch{return fail();}
    if(typeof v!=="string")return fail();
    return v;
  };
  const value=(depth:number):void=>{
    skip();
    if(++nodes>12000||depth>14)return fail();
    const c=source[index];
    if(c==="{"){
      index++;skip();
      const keys=new Set<string>();
      if(source[index]==="}"){index++;return;}
      for(let entries=0;entries<26;entries++){
        skip();
        const key=string();
        if(RESERVED.has(key)||keys.has(key)||key.length>128)return fail();
        keys.add(key);skip();
        if(source[index++]!==":")return fail();
        value(depth+1);skip();
        if(source[index]==="}"){index++;return;}
        if(source[index++]!==",")return fail();
      }
      return fail();
    }
    if(c==="["){
      index++;skip();
      if(source[index]==="]"){index++;return;}
      for(let entries=0;entries<201;entries++){
        value(depth+1);skip();
        if(source[index]==="]"){index++;return;}
        if(source[index++]!==",")return fail();
      }
      return fail();
    }
    if(c==='"'){string();return;}
    const rest=source.slice(index);
    const token=/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[Ee][+-]?[0-9]+)?)/.exec(rest)?.[0];
    if(!token)return fail();
    index+=token.length;
  };
  value(0);skip();
  if(index!==source.length)return fail();
}
function canonical(v:unknown,depth=0,budget={nodes:0}):string{
  if(++budget.nodes>12000||depth>14)deny("ANSIBLE_YAML_REPLAY_REPORT_INVALID");
  if(v===null||typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);
  if(typeof v==="number"){
    if(!Number.isFinite(v))deny("ANSIBLE_YAML_REPLAY_REPORT_INVALID");
    return JSON.stringify(v);
  }
  if(Array.isArray(v)){
    if(v.length>200)deny("ANSIBLE_YAML_REPLAY_REPORT_INVALID");
    return "["+v.map(x=>canonical(x,depth+1,budget)).join(",")+"]";
  }
  if(obj(v)){
    const keys=Object.keys(v).sort();
    if(keys.length>25||keys.some(k=>RESERVED.has(k)))deny("ANSIBLE_YAML_REPLAY_REPORT_INVALID");
    return "{"+keys.map(k=>JSON.stringify(k)+":"+canonical(v[k],depth+1,budget)).join(",")+"}";
  }
  return deny("ANSIBLE_YAML_REPLAY_REPORT_INVALID");
}
function readReport(bytes:Uint8Array):Record<string,unknown>{
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<2||
     bytes.byteLength>MAX_REPORT_BYTES)deny("ANSIBLE_YAML_REPLAY_REPORT_SIZE_INVALID");
  let source:string,report:unknown;
  try{
    source=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
    checkJsonStructure(source);
    report=JSON.parse(source) as unknown;
  }catch(error){
    if(error instanceof EnterpriseImportError)throw error;
    return deny("ANSIBLE_YAML_REPLAY_REPORT_INVALID");
  }
  if(!obj(report))return deny("ANSIBLE_YAML_REPLAY_REPORT_INVALID");
  canonical(report);
  return report;
}

export interface AnsibleYamlReplayMatch{
  readonly status:"REFERENCE_REPLAY_MATCH";
  readonly reportFormat:typeof ANSIBLE_ASSOCIATION_FORMAT;
  readonly sourceSha256:string;
  readonly referencesChecked:number;
  readonly semanticTrack:"CONFIG_DOCUMENTED";
  readonly identityVerified:false;
  readonly physicalTopologyVerified:false;
  readonly engineVerified:false;
  readonly modelMutated:false;
}

/** Reconstruct exact production P3 metadata from the actual original YAML. */
export async function replayAnsibleYamlSavedReferences(
  yamlBytes:Uint8Array,reportBytes:Uint8Array,
  builder:AnsibleBuilderSnapshot|null,acknowledged:boolean,
):Promise<AnsibleYamlReplayMatch>{
  if(acknowledged!==true)deny("ANSIBLE_YAML_REPLAY_CONSENT_REQUIRED");
  if(!builder)deny("ANSIBLE_YAML_REPLAY_BUILDER_REQUIRED");
  if(!(yamlBytes instanceof Uint8Array)||yamlBytes.byteLength===0||
     yamlBytes.byteLength>MAX_SOURCE_BYTES)deny("ANSIBLE_YAML_REPLAY_SOURCE_SIZE_INVALID");
  const report=readReport(reportBytes);
  if(report.formatId!==ANSIBLE_ASSOCIATION_FORMAT)
    deny("ANSIBLE_YAML_REPLAY_FORMAT_UNSUPPORTED");
  const source=report.source,target=report.targetModel,associations=report.associations;
  if(report.schemaVersion!=="1.0.0"||report.status!=="REVIEWED_ASSOCIATIONS_ONLY"||
     !obj(source)||!obj(target)||typeof source.sha256!=="string"||
     !HEX.test(source.sha256)||!safeId(target.scenarioId)||
     !nat(target.sourceRevision))return deny("ANSIBLE_YAML_REPLAY_REPORT_INVALID");
  if(!Array.isArray(associations)||associations.length<1||associations.length>80)
    return deny("ANSIBLE_YAML_REPLAY_COUNT_INVALID");
  const choices:AnsibleAssociationDecision["associations"][number][]=[];
  for(const item of associations){
    if(!obj(item)||!nat(item.hostOrdinal)||!safeId(item.targetResourceId)||
       item.assertion!=="USER_ASSERTED_ASSOCIATION_NOT_VERIFIED")
      return deny("ANSIBLE_YAML_REPLAY_ASSOCIATION_INVALID");
    choices.push({hostOrdinal:item.hostOrdinal,resourceId:item.targetResourceId});
  }
  const parsed=await previewAnsibleStaticInventory(yamlBytes).catch(
    ()=>deny("ANSIBLE_YAML_REPLAY_SOURCE_BLOCKED"));
  if(parsed.sourceSha256!==source.sha256)deny("ANSIBLE_YAML_REPLAY_SOURCE_CHANGED");
  const regenerated=reviewAnsibleInventoryAssociations(parsed,builder,{
    sourceSha256:parsed.sourceSha256,
    scenarioId:target.scenarioId as string,
    sourceRevision:target.sourceRevision as number,
    acknowledgeNotVerified:true,
    associations:choices,
  });
  if(regenerated.status!=="READY_FOR_EXPORT"||!regenerated.sidecar)
    deny("ANSIBLE_YAML_REPLAY_MODEL_MISMATCH");
  if(canonical(report)!==canonical(regenerated.sidecar))
    deny("ANSIBLE_YAML_REPLAY_REPORT_MISMATCH");
  return Object.freeze({
    status:"REFERENCE_REPLAY_MATCH",reportFormat:ANSIBLE_ASSOCIATION_FORMAT,
    sourceSha256:parsed.sourceSha256,referencesChecked:choices.length,
    semanticTrack:"CONFIG_DOCUMENTED",
    identityVerified:false,physicalTopologyVerified:false,
    engineVerified:false,modelMutated:false,
  });
}
