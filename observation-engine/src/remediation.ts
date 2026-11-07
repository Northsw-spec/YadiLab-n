import { readPath } from "../../engine/src/index.js";
import type { EngineState, ScenarioOperation } from "../../engine/src/index.js";
import type { ObservationDiagnostic, RemediationEvidencePair, RemediationReview, RemediationReviewResult, TroubleshootingNotebook, TroubleshootingRemediationEntry, TroubleshootingTypedRemediationAction } from "./types.js";
import { canonicalTroubleshootingJson, computeTroubleshootingNotebookIdentity, TROUBLESHOOTING_NOTEBOOK_VERSION, verifyTroubleshootingNotebook } from "./notebook.js";
import { typedRemediationAuditMatchesOperation } from "./typed-remediation.js";

export const REMEDIATION_ENGINE_ID = "foundation.remediation" as const;
export const REMEDIATION_ENGINE_VERSION = "0.1.0" as const;
export const REMEDIATION_BOUNDARY = "LEARNER_OPERATION_NO_SOLUTION" as const;
export const REMEDIATION_REVIEW_ENGINE_ID = "foundation.remediation_review" as const;
export const REMEDIATION_REVIEW_ENGINE_VERSION = "0.1.0" as const;

function diagnostic(severity: ObservationDiagnostic["severity"], code: string, message: string): ObservationDiagnostic { return { severity, code, message }; }
async function sha256Utf8(input: string): Promise<string> { const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)); return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join(""); }
function cleanNote(value?: string): string | undefined { const v=value?.trim(); return v ? v.slice(0,4000) : undefined; }
function safePath(path: string): boolean { return /^properties\.[A-Za-z0-9_.-]+$/.test(path) || /^interfaces\.(0|[1-9][0-9]*)\.(addresses|mac)(?:\.(0|[1-9][0-9]*))?$/.test(path); }
function valueAt(state: EngineState, operation: ScenarioOperation): { state:"KNOWN"|"ABSENT"; value?:unknown } { const r=state.resources[operation.target]; if(!r) return {state:"ABSENT"}; const got=readPath(r, operation.path); return got.found ? {state:"KNOWN", value:got.value} : {state:"ABSENT"}; }
export function validateLearnerRemediationOperation(state: EngineState, operation: ScenarioOperation): readonly ObservationDiagnostic[] {
  const d: ObservationDiagnostic[]=[];
  if(!state.resources[operation.target]) d.push(diagnostic("error","REMEDIATION_TARGET_UNKNOWN",`Remediation target '${operation.target}' does not exist in Runtime state.`));
  if(!safePath(operation.path)) d.push(diagnostic("error","REMEDIATION_PATH_NOT_ALLOWED","Learner remediation may change only modeled properties.* values or interface address/MAC state; identity/type/label metadata is immutable."));
  return d;
}
export async function computeRemediationOperationIdentity(args:{ scenarioId:string; scenarioHash:string; beforeState:EngineState; afterState:EngineState; operation:ScenarioOperation }):Promise<string>{
  return sha256Utf8(canonicalTroubleshootingJson({scenarioId:args.scenarioId,scenarioHash:args.scenarioHash,beforeStateRevision:args.beforeState.stateRevision,afterStateRevision:args.afterState.stateRevision,operation:args.operation,before:valueAt(args.beforeState,args.operation),after:valueAt(args.afterState,args.operation)}));
}
export async function appendRemediationAction(notebook:TroubleshootingNotebook,args:{beforeState:EngineState;afterState:EngineState;operation:ScenarioOperation;learnerNote?:string;typedAction?:TroubleshootingTypedRemediationAction}):Promise<{ok:boolean;notebook?:TroubleshootingNotebook;diagnostics:readonly ObservationDiagnostic[]}>{
  const checked=await verifyTroubleshootingNotebook(notebook); if(!checked.ok) return {ok:false,diagnostics:checked.diagnostics};
  if(notebook.scenarioId!==args.beforeState.scenarioId || notebook.scenarioHash!==args.beforeState.scenarioHash || args.afterState.scenarioId!==notebook.scenarioId || args.afterState.scenarioHash!==notebook.scenarioHash) return {ok:false,diagnostics:[diagnostic("error","REMEDIATION_SCENARIO_MISMATCH","Runtime states and notebook must belong to the exact same scenario identity.")]};
  if(args.afterState.stateRevision!==args.beforeState.stateRevision+1) return {ok:false,diagnostics:[diagnostic("error","REMEDIATION_REVISION_INVALID","A remediation action must be exactly one committed Runtime operation.")]};
  const vd=validateLearnerRemediationOperation(args.beforeState,args.operation); if(vd.length) return {ok:false,diagnostics:vd};
  if(args.typedAction && !typedRemediationAuditMatchesOperation(args.typedAction,args.operation)) return {ok:false,diagnostics:[diagnostic("error","REMEDIATION_TYPED_ACTION_MISMATCH","Typed remediation audit must exactly match the committed Engine operation.")]};
  const hasBefore=notebook.entries.some(e=>(e.kind==="observation"||e.kind==="active_probe")&&e.stateRevision===args.beforeState.stateRevision);
  if(!hasBefore) return {ok:false,diagnostics:[diagnostic("error","REMEDIATION_BEFORE_EVIDENCE_REQUIRED","Save at least one observation or active probe from the current Runtime revision before committing remediation.")]};
  if(notebook.entries.length>=256) return {ok:false,diagnostics:[diagnostic("error","NOTEBOOK_ENTRY_LIMIT","Troubleshooting notebook may contain at most 256 entries.")]};
  const sequence=notebook.entries.length+1; const opid=await computeRemediationOperationIdentity({scenarioId:notebook.scenarioId,scenarioHash:notebook.scenarioHash,beforeState:args.beforeState,afterState:args.afterState,operation:args.operation});
  const before=valueAt(args.beforeState,args.operation), after=valueAt(args.afterState,args.operation), note=cleanNote(args.learnerNote);
  const entry:TroubleshootingRemediationEntry={entryId:`entry-${String(sequence).padStart(4,"0")}`,sequence,kind:"remediation_action",stateRevision:args.afterState.stateRevision,beforeStateRevision:args.beforeState.stateRevision,afterStateRevision:args.afterState.stateRevision,boundary:REMEDIATION_BOUNDARY,operation:JSON.parse(JSON.stringify(args.operation)),operationIdentity:opid,beforeValueState:before.state,...(before.state==="KNOWN"?{beforeValue:JSON.parse(JSON.stringify(before.value))}:{}),afterValueState:after.state,...(after.state==="KNOWN"?{afterValue:JSON.parse(JSON.stringify(after.value))}:{}),...(args.typedAction?{typedAction:JSON.parse(JSON.stringify(args.typedAction))}:{}),...(note?{learnerNote:note}:{})};
  const draft:TroubleshootingNotebook={...notebook,schemaVersion:TROUBLESHOOTING_NOTEBOOK_VERSION,notebookIdentity:"0".repeat(64),entries:[...notebook.entries,entry]};
  return {ok:true,notebook:{...draft,notebookIdentity:await computeTroubleshootingNotebookIdentity(draft)},diagnostics:[]};
}
function sameEvidence(a:any,b:any):boolean{ if(a.kind!==b.kind) return false; if(a.kind==="observation") return a.targetId===b.targetId&&a.command===b.command&&a.category===b.category; if(a.kind==="active_probe") return a.sourceId===b.sourceId&&a.command===b.command&&a.category===b.category&&a.destinationId===b.destinationId&&a.protocol===b.protocol&&a.port===b.port&&a.queryName===b.queryName; return false; }
export async function reviewRemediationLoop(notebook:TroubleshootingNotebook,remediationEntryId:string):Promise<RemediationReviewResult>{
  const verified=await verifyTroubleshootingNotebook(notebook); if(!verified.ok) return {ok:false,diagnostics:verified.diagnostics};
  const action=notebook.entries.find((e):e is TroubleshootingRemediationEntry=>e.entryId===remediationEntryId&&e.kind==="remediation_action"); if(!action) return {ok:false,diagnostics:[diagnostic("error","REMEDIATION_ENTRY_NOT_FOUND",`Remediation entry '${remediationEntryId}' does not exist.`)]};
  const before=notebook.entries.filter(e=>(e.kind==="observation"||e.kind==="active_probe")&&e.sequence<action.sequence&&e.stateRevision===action.beforeStateRevision);
  const after=notebook.entries.filter(e=>(e.kind==="observation"||e.kind==="active_probe")&&e.sequence>action.sequence&&e.stateRevision===action.afterStateRevision);
  const pairs:RemediationEvidencePair[]=[];
  for(const b of before){ const a=after.find(x=>sameEvidence(b,x)); if(!a) continue; if(b.kind==="active_probe"&&a.kind==="active_probe"){ let status:RemediationEvidencePair["status"]="UNCHANGED"; if(b.truth!=="TRUE"&&a.truth==="TRUE") status="RESTORED"; else if(b.truth==="TRUE"&&a.truth!=="TRUE") status="REGRESSED"; else if(b.truth!==a.truth) status="CHANGED"; pairs.push({kind:"active_probe",beforeEntryId:b.entryId,afterEntryId:a.entryId,status,beforeTruth:b.truth,afterTruth:a.truth}); } else if(b.kind==="observation"&&a.kind==="observation") pairs.push({kind:"observation",beforeEntryId:b.entryId,afterEntryId:a.entryId,status:b.transcriptIdentity===a.transcriptIdentity?"UNCHANGED":"CHANGED"}); }
  const status:RemediationReview["status"]=pairs.length===0?"PENDING_AFTER_EVIDENCE":pairs.some(p=>p.status==="REGRESSED")?"REGRESSION_DETECTED":pairs.some(p=>p.status==="RESTORED")?"VERIFIED_IMPROVEMENT":"NO_VERIFIED_IMPROVEMENT";
  const base={engineId:REMEDIATION_REVIEW_ENGINE_ID,engineVersion:REMEDIATION_REVIEW_ENGINE_VERSION,boundary:"NOTEBOOK_ONLY_NO_SOLUTION" as const,scenarioId:notebook.scenarioId,scenarioHash:notebook.scenarioHash,notebookIdentity:notebook.notebookIdentity,remediationEntryId,status,pairs};
  return {ok:true,review:{...base,reviewIdentity:await sha256Utf8(canonicalTroubleshootingJson(base))},diagnostics:[]};
}
