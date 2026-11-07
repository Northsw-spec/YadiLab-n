import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import { canonicalTroubleshootingJson } from "../../../observation-engine/src/index.js";

export const NETWORK_INTENT_VERSION = "0.1.0" as const;
export type IntentExpectation = "MUST REACH" | "MUST NOT REACH";
export type IntentCaseState = "READY" | "INVALID REFERENCE" | "NOT COMPARABLE";
export interface EndpointSet { readonly setId: string; readonly title: string; readonly nodeIds: readonly string[]; readonly identity: string; }
export interface FlowProfile { readonly profileId: string; readonly title: string; readonly flowId: string; readonly protocol?: string; readonly port?: number; readonly identity: string; }
export interface NetworkIntentRule { readonly ruleId: string; readonly title: string; readonly sourceSetId: string; readonly destinationSetId: string; readonly flowProfileId: string; readonly expectation: IntentExpectation; readonly expected: string; }
export interface NetworkIntentContract { readonly formatId: "infrastructure-cyber-lab.network-intent-contract"; readonly schemaVersion: "0.1.0"; readonly contractId: string; readonly title: string; readonly description: string; readonly scenarioId: string; readonly sourceIdentity: string; readonly endpointSets: readonly EndpointSet[]; readonly flowProfiles: readonly FlowProfile[]; readonly rules: readonly NetworkIntentRule[]; readonly revision: number; readonly identity: string; }
export interface IntentExpansionCase { readonly caseId: string; readonly ruleId: string; readonly sourceNodeId: string; readonly destinationNodeId: string; readonly flowId: string; readonly expected: string; readonly state: IntentCaseState; }
export interface IntentPreview { readonly formatId: "infrastructure-cyber-lab.network-intent-preview"; readonly schemaVersion: "0.1.0"; readonly contractIdentity: string; readonly sourceIdentity: string; readonly cases: readonly IntentExpansionCase[]; readonly counts: Readonly<Record<IntentCaseState, number>>; readonly identity: string; }
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
const hash=async(v:unknown)=>{const d=await globalThis.crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonicalTroubleshootingJson(v)));return Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,"0")).join("")};
const sourceNodes=(s:ScenarioSource)=>new Set(s.resources.map(r=>r.id));
const endpointProjection=(v:Pick<EndpointSet,"title"|"nodeIds">)=>v;
const flowProjection=(v:Pick<FlowProfile,"title"|"flowId"|"protocol"|"port">)=>v;
const contractProjection=(v:NetworkIntentContract)=>{const {contractId,identity,...rest}=v;return rest};
export const computeEndpointSetIdentity=(v:Pick<EndpointSet,"title"|"nodeIds">)=>hash(endpointProjection(v));
export const computeFlowProfileIdentity=(v:Pick<FlowProfile,"title"|"flowId"|"protocol"|"port">)=>hash(flowProjection(v));
export const computeNetworkIntentIdentity=(v:NetworkIntentContract)=>hash(contractProjection(v));
export async function createEndpointSet(a:{title:string;nodeIds:readonly string[];source:ScenarioSource}):Promise<EndpointSet>{const ids=[...new Set(a.nodeIds)].sort();if(!a.title.trim()||!ids.length)throw Error("INTENT_ENDPOINT_SET_EMPTY");if(ids.some(id=>!sourceNodes(a.source).has(id)))throw Error("INTENT_ENDPOINT_SET_UNKNOWN_NODE");const identity=await computeEndpointSetIdentity({title:a.title,nodeIds:ids});return {setId:identity,title:a.title,nodeIds:ids,identity}}
export async function createFlowProfile(a:{title:string;flowId:string;source:ScenarioSource;protocol?:string;port?:number}):Promise<FlowProfile>{const flow=a.source.tests.find(t=>t.id===a.flowId);if(!flow||flow.type!=="network.reachability")throw Error("INTENT_FLOW_PROFILE_UNKNOWN_FLOW");const p=flow.params as Record<string,unknown>;if(a.protocol!==undefined&&p.protocol!==a.protocol)throw Error("INTENT_FLOW_PROFILE_PROTOCOL_MISMATCH");if(a.port!==undefined&&p.port!==a.port)throw Error("INTENT_FLOW_PROFILE_PORT_MISMATCH");const draft={title:a.title,flowId:a.flowId,...(a.protocol===undefined?{}:{protocol:a.protocol}),...(a.port===undefined?{}:{port:a.port})};const identity=await computeFlowProfileIdentity(draft);return {profileId:identity,...draft,identity}}
export async function createNetworkIntentContract(a:{title:string;description?:string;source:ScenarioSource;sourceIdentity:string;endpointSets:readonly EndpointSet[];flowProfiles:readonly FlowProfile[];rules:readonly Omit<NetworkIntentRule,"ruleId">[];revision?:number}):Promise<NetworkIntentContract>{const sets=new Set(a.endpointSets.map(x=>x.setId)),profiles=new Set(a.flowProfiles.map(x=>x.profileId));if(sets.size!==a.endpointSets.length||profiles.size!==a.flowProfiles.length)throw Error("INTENT_CONTRACT_DUPLICATE_ID");const rules=a.rules.map((r,i)=>({...r,ruleId:`rule-${i+1}`}));for(const r of rules){if(!sets.has(r.sourceSetId)||!sets.has(r.destinationSetId))throw Error("INTENT_CONTRACT_ENDPOINT_REFERENCE_INVALID");if(!profiles.has(r.flowProfileId))throw Error("INTENT_CONTRACT_PROFILE_REFERENCE_INVALID");if(r.expectation==="MUST REACH"&&r.expected!=="SUCCESS")throw Error("INTENT_CONTRACT_REACH_EXPECTATION_INVALID");if(r.expectation==="MUST NOT REACH"&&!['DROP','BLOCKED','NO_ROUTE'].includes(r.expected))throw Error("INTENT_CONTRACT_DENY_EXPECTATION_NOT_MODELED")}const draft={formatId:"infrastructure-cyber-lab.network-intent-contract" as const,schemaVersion:NETWORK_INTENT_VERSION,contractId:"0".repeat(64),title:a.title,description:a.description??"",scenarioId:a.source.scenarioId,sourceIdentity:a.sourceIdentity,endpointSets:clone(a.endpointSets),flowProfiles:clone(a.flowProfiles),rules,revision:a.revision??1,identity:"0".repeat(64)};const identity=await computeNetworkIntentIdentity(draft);return {...draft,contractId:identity,identity}}
export async function verifyNetworkIntentContract(v:unknown,s:ScenarioSource){
  if(!v||typeof v!=="object")return{ok:false as const,diagnostics:["INTENT_CONTRACT_NOT_OBJECT"]};
  const c=v as NetworkIntentContract;const errors:string[]=[];
  if(c.formatId!=="infrastructure-cyber-lab.network-intent-contract")errors.push("INTENT_CONTRACT_FORMAT_INVALID");
  if(c.schemaVersion!==NETWORK_INTENT_VERSION)errors.push("INTENT_CONTRACT_VERSION_UNSUPPORTED");
  if(c.scenarioId!==s.scenarioId)errors.push("INTENT_CONTRACT_SCENARIO_MISMATCH");
  if(c.sourceIdentity!==await hash(s))errors.push("INTENT_CONTRACT_SOURCE_BINDING_MISMATCH");
  if(c.contractId!==c.identity)errors.push("INTENT_CONTRACT_ID_BINDING_FAILED");
  const endpointIds=new Set<string>();const endpointIdentities=new Set<string>();
  for(const e of c.endpointSets??[]){
    if(endpointIds.has(e.setId))errors.push("INTENT_CONTRACT_DUPLICATE_ENDPOINT_ID");endpointIds.add(e.setId);
    if(endpointIdentities.has(e.identity))errors.push("INTENT_CONTRACT_DUPLICATE_ENDPOINT_IDENTITY");endpointIdentities.add(e.identity);
    if(new Set(e.nodeIds).size!==e.nodeIds.length)errors.push("INTENT_CONTRACT_DUPLICATE_NODE_REFERENCE");
    if(!e.nodeIds.length||e.nodeIds.some(id=>!sourceNodes(s).has(id)))errors.push("INTENT_CONTRACT_INVALID_NODE_REFERENCE");
    if(await computeEndpointSetIdentity({title:e.title,nodeIds:e.nodeIds})!==e.identity)errors.push("INTENT_ENDPOINT_SET_INTEGRITY_FAILED");
  }
  const profileIds=new Set<string>();const profileIdentities=new Set<string>();
  for(const f of c.flowProfiles??[]){
    if(profileIds.has(f.profileId))errors.push("INTENT_CONTRACT_DUPLICATE_PROFILE_ID");profileIds.add(f.profileId);
    if(profileIdentities.has(f.identity))errors.push("INTENT_CONTRACT_DUPLICATE_PROFILE_IDENTITY");profileIdentities.add(f.identity);
    const flow=s.tests.find(t=>t.id===f.flowId);if(!flow||flow.type!=="network.reachability")errors.push("INTENT_FLOW_PROFILE_INVALID");
    if(await computeFlowProfileIdentity({title:f.title,flowId:f.flowId,...(f.protocol===undefined?{}:{protocol:f.protocol}),...(f.port===undefined?{}:{port:f.port})})!==f.identity)errors.push("INTENT_FLOW_PROFILE_INTEGRITY_FAILED");
  }
  const ruleIds=new Set<string>();
  for(const r of c.rules??[]){
    if(ruleIds.has(r.ruleId))errors.push("INTENT_CONTRACT_DUPLICATE_RULE_ID");ruleIds.add(r.ruleId);
    if(!endpointIds.has(r.sourceSetId)||!endpointIds.has(r.destinationSetId))errors.push("INTENT_CONTRACT_ENDPOINT_REFERENCE_INVALID");
    if(!profileIds.has(r.flowProfileId))errors.push("INTENT_CONTRACT_PROFILE_REFERENCE_INVALID");
    if(r.expectation==="MUST REACH"&&r.expected!=="SUCCESS")errors.push("INTENT_CONTRACT_REACH_EXPECTATION_INVALID");
    if(r.expectation==="MUST NOT REACH"&&!['DROP','BLOCKED','NO_ROUTE'].includes(r.expected))errors.push("INTENT_CONTRACT_DENY_EXPECTATION_NOT_MODELED");
    if(r.expectation!=="MUST REACH"&&r.expectation!=="MUST NOT REACH")errors.push("INTENT_CONTRACT_EXPECTATION_INVALID");
  }
  if(await computeNetworkIntentIdentity(c)!==c.identity)errors.push("INTENT_CONTRACT_IDENTITY_FAILED");
  return errors.length?{ok:false as const,diagnostics:[...new Set(errors)]}:{ok:true as const,value:clone(c)}
}
export async function previewNetworkIntent(c:NetworkIntentContract,s:ScenarioSource):Promise<IntentPreview>{const check=await verifyNetworkIntentContract(c,s);if(!check.ok)throw Error(check.diagnostics.join(","));const sets=new Map(check.value.endpointSets.map(x=>[x.setId,x])),profiles=new Map(check.value.flowProfiles.map(x=>[x.profileId,x]));const cases:IntentExpansionCase[]=[];for(const r of check.value.rules){const a=sets.get(r.sourceSetId),b=sets.get(r.destinationSetId),f=profiles.get(r.flowProfileId),flow=f&&s.tests.find(t=>t.id===f.flowId);for(const from of a?.nodeIds??[])for(const to of b?.nodeIds??[])cases.push({caseId:`${r.ruleId}:${from}:${to}`,ruleId:r.ruleId,sourceNodeId:from,destinationNodeId:to,flowId:f?.flowId??"",expected:r.expected,state:flow?"READY":"INVALID REFERENCE"})}const projection={formatId:"infrastructure-cyber-lab.network-intent-preview" as const,schemaVersion:NETWORK_INTENT_VERSION,contractIdentity:c.identity,sourceIdentity:c.sourceIdentity,cases,counts:{READY:cases.filter(x=>x.state==="READY").length,"INVALID REFERENCE":cases.filter(x=>x.state==="INVALID REFERENCE").length,"NOT COMPARABLE":cases.filter(x=>x.state==="NOT COMPARABLE").length}};return {...projection,identity:await hash(projection)}}
export const exportNetworkIntentContract=(v:NetworkIntentContract)=>`${JSON.stringify(v,null,2)}\n`;
export async function importNetworkIntentContract(text:string,source:ScenarioSource){
  let value:unknown;
  try { value=JSON.parse(text) as unknown; } catch { return {ok:false as const,diagnostics:["INTENT_CONTRACT_JSON_INVALID"]}; }
  return verifyNetworkIntentContract(value,source);
}
