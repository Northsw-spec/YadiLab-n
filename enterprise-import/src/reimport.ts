import type { EnterpriseBaseline, EnterpriseReimportDiff } from "../../core-model/src/generated/contracts.js";
import { canonicalEnterpriseJson } from "../../enterprise-model/src/canonical.js";
import { EnterpriseImportError } from "./types.js";

type Entity=EnterpriseBaseline["entities"][number]; type Relationship=EnterpriseBaseline["relationships"][number]; type Fact=EnterpriseBaseline["facts"][number];
function entitySemantic(x:Entity):Record<string,unknown>{ const {provenanceRefs:_,...rest}=x; return rest as unknown as Record<string,unknown>; }
function entityEvidence(x:Entity):Record<string,unknown>{ return x as unknown as Record<string,unknown>; }
function relationshipSemantic(x:Relationship):Record<string,unknown>{ const {provenanceRefs:_,...rest}=x; return rest as unknown as Record<string,unknown>; }
function relationshipEvidence(x:Relationship):Record<string,unknown>{ return x as unknown as Record<string,unknown>; }
function stripFactProvenance(value:unknown):unknown{
  if(Array.isArray(value)) return value.map(stripFactProvenance);
  if(value&&typeof value==="object"){
    const out:Record<string,unknown>={};
    for(const [k,v] of Object.entries(value as Record<string,unknown>)) if(k!=="provenanceRefs"&&k!=="factId") out[k]=stripFactProvenance(v);
    return out;
  }
  return value;
}
function factSemantic(x:Fact):Record<string,unknown>{ return stripFactProvenance(x) as Record<string,unknown>; }
function factEvidence(x:Fact):Record<string,unknown>{ const {factId:_,...rest}=x; return rest as unknown as Record<string,unknown>; }
function factKey(x:Fact):string{return `${x.subjectRef}\u0000${x.path}`;}
function indexUnique<T>(items:readonly T[],key:(x:T)=>string,code:string):Map<string,T>{const m=new Map<string,T>(); for(const item of items){const k=key(item); if(m.has(k)) throw new EnterpriseImportError(code,`Ambiguous semantic key ${k}.`); m.set(k,item);} return m;}

export function compareEnterpriseBaselines(previous:EnterpriseBaseline,next:EnterpriseBaseline):EnterpriseReimportDiff{
  if(previous.baselineId!==next.baselineId) throw new EnterpriseImportError("REIMPORT_BASELINE_ID_MISMATCH","Re-import diff requires the same baselineId.");
  const prevEntities=indexUnique(previous.entities,(x)=>x.entityId,"REIMPORT_DUPLICATE_ENTITY_KEY"); const nextEntities=indexUnique(next.entities,(x)=>x.entityId,"REIMPORT_DUPLICATE_ENTITY_KEY");
  const prevRelationships=indexUnique(previous.relationships,(x)=>x.relationshipId,"REIMPORT_DUPLICATE_RELATIONSHIP_KEY"); const nextRelationships=indexUnique(next.relationships,(x)=>x.relationshipId,"REIMPORT_DUPLICATE_RELATIONSHIP_KEY");
  const prevFacts=indexUnique(previous.facts,factKey,"REIMPORT_AMBIGUOUS_FACT_KEY"); const nextFacts=indexUnique(next.facts,factKey,"REIMPORT_AMBIGUOUS_FACT_KEY");
  const entityChanges:Array<EnterpriseReimportDiff["entityChanges"][number]>=[]; const relationshipChanges:Array<EnterpriseReimportDiff["relationshipChanges"][number]>=[]; const factChanges:Array<EnterpriseReimportDiff["factChanges"][number]>=[];
  let entitiesAdded=0,entitiesRemoved=0,entitiesChanged=0,entitiesProvenanceOnly=0,relationshipsAdded=0,relationshipsRemoved=0,relationshipsChanged=0,relationshipsProvenanceOnly=0,factsAdded=0,factsRemoved=0,factsChanged=0,factsProvenanceOnly=0;
  for(const id of [...new Set([...prevEntities.keys(),...nextEntities.keys()])].sort((a,b)=>a.localeCompare(b,"en"))){
    const a=prevEntities.get(id),b=nextEntities.get(id);
    if(!a&&b){entitiesAdded++;entityChanges.push({entityId:id,kind:"ADDED",after:entityEvidence(b)});continue;}
    if(a&&!b){entitiesRemoved++;entityChanges.push({entityId:id,kind:"REMOVED",before:entityEvidence(a)});continue;}
    if(!a||!b)continue;
    if(canonicalEnterpriseJson(entitySemantic(a))!==canonicalEnterpriseJson(entitySemantic(b))){entitiesChanged++;entityChanges.push({entityId:id,kind:"CHANGED",before:entityEvidence(a),after:entityEvidence(b)});}
    else if(canonicalEnterpriseJson(entityEvidence(a))!==canonicalEnterpriseJson(entityEvidence(b))){entitiesProvenanceOnly++;entityChanges.push({entityId:id,kind:"PROVENANCE_ONLY",before:entityEvidence(a),after:entityEvidence(b)});}
  }
  for(const id of [...new Set([...prevRelationships.keys(),...nextRelationships.keys()])].sort((a,b)=>a.localeCompare(b,"en"))){
    const a=prevRelationships.get(id),b=nextRelationships.get(id);
    if(!a&&b){relationshipsAdded++;relationshipChanges.push({relationshipId:id,kind:"ADDED",after:relationshipEvidence(b)});continue;}
    if(a&&!b){relationshipsRemoved++;relationshipChanges.push({relationshipId:id,kind:"REMOVED",before:relationshipEvidence(a)});continue;}
    if(!a||!b)continue;
    if(canonicalEnterpriseJson(relationshipSemantic(a))!==canonicalEnterpriseJson(relationshipSemantic(b))){relationshipsChanged++;relationshipChanges.push({relationshipId:id,kind:"CHANGED",before:relationshipEvidence(a),after:relationshipEvidence(b)});}
    else if(canonicalEnterpriseJson(relationshipEvidence(a))!==canonicalEnterpriseJson(relationshipEvidence(b))){relationshipsProvenanceOnly++;relationshipChanges.push({relationshipId:id,kind:"PROVENANCE_ONLY",before:relationshipEvidence(a),after:relationshipEvidence(b)});}
  }
  for(const key of [...new Set([...prevFacts.keys(),...nextFacts.keys()])].sort((a,b)=>a.localeCompare(b,"en"))){
    const a=prevFacts.get(key),b=nextFacts.get(key); const [subjectRef,path]=key.split("\u0000") as [string,string];
    if(!a&&b){factsAdded++;factChanges.push({subjectRef,path,kind:"ADDED",after:factEvidence(b)});continue;}
    if(a&&!b){factsRemoved++;factChanges.push({subjectRef,path,kind:"REMOVED",before:factEvidence(a)});continue;}
    if(!a||!b)continue;
    if(canonicalEnterpriseJson(factSemantic(a))!==canonicalEnterpriseJson(factSemantic(b))){factsChanged++;factChanges.push({subjectRef,path,kind:"CHANGED",before:factEvidence(a),after:factEvidence(b)});}
    else if(canonicalEnterpriseJson(factEvidence(a))!==canonicalEnterpriseJson(factEvidence(b))){factsProvenanceOnly++;factChanges.push({subjectRef,path,kind:"PROVENANCE_ONLY",before:factEvidence(a),after:factEvidence(b)});}
  }
  return {formatId:"infrastructure-cyber-lab.enterprise-reimport-diff",schemaVersion:"0.2.0",previousBaseline:{baselineId:previous.baselineId,baselineIdentity:previous.baselineIdentity},nextBaseline:{baselineId:next.baselineId,baselineIdentity:next.baselineIdentity},summary:{entitiesAdded,entitiesRemoved,entitiesChanged,entitiesProvenanceOnly,relationshipsAdded,relationshipsRemoved,relationshipsChanged,relationshipsProvenanceOnly,factsAdded,factsRemoved,factsChanged,factsProvenanceOnly},entityChanges,relationshipChanges,factChanges};
}
