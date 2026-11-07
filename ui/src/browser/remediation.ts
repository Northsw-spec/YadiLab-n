import { applyOperation, readPath } from "../../../engine/src/index.js";
import type { ScenarioOperation } from "../../../engine/src/index.js";
import { appendRemediationAction, canonicalTroubleshootingJson, listTypedRemediationActions, resolveTypedRemediationAction, reviewRemediationLoop, validateLearnerRemediationOperation, verifyTroubleshootingNotebook, type RemediationReview, type TroubleshootingNotebook, type TroubleshootingTypedRemediationAction, type TypedRemediationActionDefinition, type TypedRemediationRequest } from "../../../observation-engine/src/index.js";
import { applyRuntimeOperationWithHistory } from "./runtime-history.js";
import type { BrowserDiagnostic, BrowserWorkspace, RuntimeWorkspace } from "./types.js";

export interface RuntimeRemediationPreview { readonly token:string; readonly operation:ScenarioOperation; readonly beforeStateRevision:number; readonly afterStateRevision:number; readonly beforeValueState:"KNOWN"|"ABSENT"; readonly beforeValue?:unknown; readonly afterValueState:"KNOWN"|"ABSENT"; readonly afterValue?:unknown; }
export interface RuntimeRemediationResult { readonly ok:boolean; readonly workspace?:RuntimeWorkspace; readonly notebook?:TroubleshootingNotebook; readonly preview?:RuntimeRemediationPreview; readonly review?:RemediationReview; readonly diagnostics:readonly BrowserDiagnostic[]; }
export interface RuntimeTypedRemediationPreview extends RuntimeRemediationPreview { readonly baseToken:string; readonly typedAction:TroubleshootingTypedRemediationAction; }
export interface RuntimeTypedRemediationResult extends Omit<RuntimeRemediationResult,"preview"> { readonly preview?:RuntimeTypedRemediationPreview; }
export interface RuntimeTypedRemediationContext { readonly actions:readonly TypedRemediationActionDefinition[]; readonly interfaces:readonly {readonly index:number;readonly id:string;readonly label:string;readonly addresses:readonly string[]}[]; readonly services:readonly {readonly name:string;readonly enabled?:boolean;readonly port?:number}[]; }
function error(code:string,message:string):BrowserDiagnostic{return{severity:"error",code,message};}
async function sha256(input:string){const d=await globalThis.crypto.subtle.digest("SHA-256",new TextEncoder().encode(input));return Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,"0")).join("");}
function at(workspace:RuntimeWorkspace,op:ScenarioOperation){const r=workspace.engineState.resources[op.target]; if(!r)return{state:"ABSENT" as const}; const v=readPath(r,op.path); return v.found?{state:"KNOWN" as const,value:v.value}:{state:"ABSENT" as const};}
export async function previewRuntimeRemediation(workspace:BrowserWorkspace,notebook:TroubleshootingNotebook|undefined,operation:ScenarioOperation):Promise<RuntimeRemediationResult>{
 if(workspace.mode!=="runtime")return{ok:false,diagnostics:[error("REMEDIATION_UI_RUNTIME_REQUIRED","Remediation is available only in Runtime.")]};
 if(!notebook)return{ok:false,diagnostics:[error("REMEDIATION_UI_NOTEBOOK_REQUIRED","Save current evidence to the troubleshooting notebook before remediation.")]};
 const nv=await verifyTroubleshootingNotebook(notebook); if(!nv.ok)return{ok:false,diagnostics:nv.diagnostics.map(x=>error(x.code,x.message))};
 if(notebook.scenarioId!==workspace.scenario.scenarioId||notebook.scenarioHash!==workspace.scenario.sourceHash)return{ok:false,diagnostics:[error("REMEDIATION_UI_SCENARIO_MISMATCH","Notebook and Runtime scenario identities differ.")]};
 const vd=validateLearnerRemediationOperation(workspace.engineState,operation); if(vd.length)return{ok:false,diagnostics:vd.map(x=>error(x.code,x.message))};
 const hasBefore=notebook.entries.some(e=>(e.kind==="observation"||e.kind==="active_probe")&&e.stateRevision===workspace.engineState.stateRevision); if(!hasBefore)return{ok:false,diagnostics:[error("REMEDIATION_UI_BEFORE_EVIDENCE_REQUIRED","Save at least one current-revision observation or active probe before remediation.")]};
 const applied=applyOperation(workspace.engineState,operation); if(!applied.ok)return{ok:false,diagnostics:[error(applied.diagnostic.code,applied.diagnostic.message)]};
 const before=at(workspace,operation); const temp={...workspace,engineState:applied.state} as RuntimeWorkspace; const after=at(temp,operation);
 const token=await sha256(canonicalTroubleshootingJson({scenarioId:workspace.scenario.scenarioId,scenarioHash:workspace.scenario.sourceHash,stateRevision:workspace.engineState.stateRevision,notebookIdentity:notebook.notebookIdentity,operation,before,after}));
 return{ok:true,preview:{token,operation,beforeStateRevision:workspace.engineState.stateRevision,afterStateRevision:applied.state.stateRevision,beforeValueState:before.state,...(before.state==="KNOWN"?{beforeValue:before.value}:{}),afterValueState:after.state,...(after.state==="KNOWN"?{afterValue:after.value}:{})},diagnostics:[]};
}
export async function commitRuntimeRemediation(workspace:BrowserWorkspace,notebook:TroubleshootingNotebook|undefined,operation:ScenarioOperation,previewToken:string,learnerNote?:string,typedAction?:TroubleshootingTypedRemediationAction):Promise<RuntimeRemediationResult>{
 const p=await previewRuntimeRemediation(workspace,notebook,operation); if(!p.ok||!p.preview||workspace.mode!=="runtime"||!notebook)return p;
 if(p.preview.token!==previewToken)return{ok:false,diagnostics:[error("REMEDIATION_UI_PREVIEW_STALE","Remediation preview token is stale or does not match the exact current operation/notebook/Runtime revision.")]};
 const applied=applyRuntimeOperationWithHistory(workspace,operation); if(!applied.ok)return{ok:false,diagnostics:applied.diagnostics};
 const n=await appendRemediationAction(notebook,{beforeState:workspace.engineState,afterState:applied.workspace.engineState,operation,...(learnerNote?{learnerNote}:{}),...(typedAction?{typedAction}:{})}); if(!n.ok||!n.notebook)return{ok:false,diagnostics:n.diagnostics.map(x=>error(x.code,x.message))};
 return{ok:true,workspace:applied.workspace,notebook:n.notebook,diagnostics:[]};
}
export async function reviewRuntimeRemediation(workspace:BrowserWorkspace,notebook:TroubleshootingNotebook|undefined,entryId:string):Promise<RuntimeRemediationResult>{
 if(workspace.mode!=="runtime")return{ok:false,diagnostics:[error("REMEDIATION_UI_RUNTIME_REQUIRED","Remediation review is available only in Runtime.")]}; if(!notebook)return{ok:false,diagnostics:[error("REMEDIATION_UI_NOTEBOOK_REQUIRED","No troubleshooting notebook is available.")]};
 const result=await reviewRemediationLoop(notebook,entryId); return result.ok&&result.review?{ok:true,review:result.review,diagnostics:[]}:{ok:false,diagnostics:result.diagnostics.map(x=>error(x.code,x.message))};
}


export function runtimeTypedRemediationContext(workspace:BrowserWorkspace,targetId:string):RuntimeTypedRemediationContext {
 if(workspace.mode!=="runtime") return {actions:[],interfaces:[],services:[]};
 const resource=workspace.engineState.resources[targetId]; if(!resource)return {actions:[],interfaces:[],services:[]};
 const interfaces=resource.interfaces.map((raw,index)=>({index,id:typeof raw.id==="string"?raw.id:`interface-${index}`,label:typeof raw.label==="string"?raw.label:(typeof raw.id==="string"?raw.id:`interface-${index}`),addresses:Array.isArray(raw.addresses)&&raw.addresses.every(x=>typeof x==="string")?[...raw.addresses]:[]}));
 const services=Object.entries(resource.properties).flatMap(([name,raw])=>{ if(!raw||typeof raw!=="object"||Array.isArray(raw))return[]; const value=raw as Readonly<Record<string,unknown>>; return (typeof value.enabled==="boolean"||typeof value.port==="number")?[{name,...(typeof value.enabled==="boolean"?{enabled:value.enabled}:{}),...(typeof value.port==="number"?{port:value.port}:{})}]:[]; });
 return {actions:listTypedRemediationActions(workspace.engineState,targetId),interfaces,services};
}
export async function previewRuntimeTypedRemediation(workspace:BrowserWorkspace,notebook:TroubleshootingNotebook|undefined,request:TypedRemediationRequest):Promise<RuntimeTypedRemediationResult>{
 if(workspace.mode!=="runtime")return{ok:false,diagnostics:[error("TYPED_REMEDIATION_UI_RUNTIME_REQUIRED","Typed remediation is available only in Runtime.")]};
 const resolved=resolveTypedRemediationAction(workspace.engineState,request); if(!resolved.ok||!resolved.operation||!resolved.audit)return{ok:false,diagnostics:resolved.diagnostics.map(x=>error(x.code,x.message))};
 const base=await previewRuntimeRemediation(workspace,notebook,resolved.operation); if(!base.ok||!base.preview)return {ok:false,diagnostics:base.diagnostics};
 const token=await sha256(canonicalTroubleshootingJson({baseToken:base.preview.token,typedAction:resolved.audit}));
 return {ok:true,preview:{...base.preview,baseToken:base.preview.token,token,typedAction:resolved.audit},diagnostics:[]};
}
export async function commitRuntimeTypedRemediation(workspace:BrowserWorkspace,notebook:TroubleshootingNotebook|undefined,request:TypedRemediationRequest,previewToken:string,learnerNote?:string):Promise<RuntimeTypedRemediationResult>{
 const p=await previewRuntimeTypedRemediation(workspace,notebook,request); if(!p.ok||!p.preview)return p;
 if(p.preview.token!==previewToken)return{ok:false,diagnostics:[error("TYPED_REMEDIATION_UI_PREVIEW_STALE","Typed remediation preview is stale or does not match the exact action parameters, notebook and Runtime revision.")]};
 const committed=await commitRuntimeRemediation(workspace,notebook,p.preview.operation,p.preview.baseToken,learnerNote,p.preview.typedAction); return committed.ok?{ok:true,...(committed.workspace?{workspace:committed.workspace}:{}),...(committed.notebook?{notebook:committed.notebook}:{}),...(committed.review?{review:committed.review}:{}),diagnostics:committed.diagnostics}:{ok:false,diagnostics:committed.diagnostics};
}
