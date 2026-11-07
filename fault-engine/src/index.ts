import type { FaultGenerationPlan, FaultOverlay, FaultPack, NormalizedScenario, ScenarioSource } from "../../core-model/src/generated/contracts.js";
import { applyOperation, applyOperations, readPath, removePath, setPath } from "../../engine/src/index.js";
import type { EngineState, ScenarioOperation } from "../../engine/src/index.js";
import { canonicalFaultJson, computeFaultApplicationHash, computeFaultGenerationPlanIdentity, computeFaultOverlayIdentity, computeFaultPackIdentity, webCryptoFaultHashProvider } from "./canonical.js";
import { evaluateFaultCondition } from "./conditions.js";
import { deterministicChoiceIndex } from "./prng.js";
import type { FaultDiagnostic, FaultHashProvider, FaultInjectionRequest, FaultInjectionResult, FaultPackVerification, FaultRollback, FaultScenarioGenerationRequest, FaultScenarioGenerationResult, MaterializeFaultVariantResult } from "./types.js";

export * from "./canonical.js";
export * from "./conditions.js";
export * from "./prng.js";
export type * from "./types.js";

const ID=/^[a-z][a-z0-9_-]{0,63}$/;
type Fault = FaultPack["faults"][number];
type Condition = Fault["preconditions"][number];
type Mutation = Fault["mutations"][number];

function clone<T>(value:T):T { return JSON.parse(JSON.stringify(value)) as T; }
function diag(severity:FaultDiagnostic["severity"],code:string,message:string,objectId?:string):FaultDiagnostic { return objectId?{severity,code,message,objectId}:{severity,code,message}; }
function hasErrors(xs:readonly FaultDiagnostic[]):boolean { return xs.some(x=>x.severity==="error"); }
function jsonEqual(a:unknown,b:unknown):boolean { return canonicalFaultJson(a)===canonicalFaultJson(b); }
function faultPathsOverlap(a:string,b:string):boolean { return a===b||a.startsWith(`${b}.`)||b.startsWith(`${a}.`); }

function collectConditionBindings(condition:Condition,out:Set<string>):void {
  if (condition.op==="all"||condition.op==="any") for (const c of condition.conditions) collectConditionBindings(c,out);
  else if (condition.op==="not") collectConditionBindings(condition.condition,out);
  else out.add(condition.binding);
}

export async function verifyFaultPack(pack:FaultPack, hash:FaultHashProvider=webCryptoFaultHashProvider):Promise<FaultPackVerification> {
  const diagnostics:FaultDiagnostic[]=[];
  if (pack.formatId!=="infrastructure-cyber-lab.fault-pack") diagnostics.push(diag("error","FAULT_PACK_FORMAT_INVALID","Unsupported fault-pack format."));
  const identity=await computeFaultPackIdentity(pack,hash);
  if (identity!==pack.packIdentity) diagnostics.push(diag("error","FAULT_PACK_IDENTITY_MISMATCH","Fault-pack identity does not match its canonical content."));
  const faultIds=new Set<string>();
  for (const fault of pack.faults) {
    if (faultIds.has(fault.faultId)) diagnostics.push(diag("error","FAULT_PACK_DUPLICATE_FAULT",`Duplicate fault '${fault.faultId}'.`,fault.faultId));
    faultIds.add(fault.faultId);
    const bindings=new Set<string>();
    for (const binding of fault.targetBindings) {
      if (bindings.has(binding.name)) diagnostics.push(diag("error","FAULT_BINDING_DUPLICATE",`Fault '${fault.faultId}' repeats binding '${binding.name}'.`,fault.faultId));
      bindings.add(binding.name);
    }
    const mutationIds=new Set<string>();
    for (const mutation of fault.mutations) {
      if (mutationIds.has(mutation.mutationId)) diagnostics.push(diag("error","FAULT_MUTATION_DUPLICATE",`Fault '${fault.faultId}' repeats mutation '${mutation.mutationId}'.`,fault.faultId));
      mutationIds.add(mutation.mutationId);
      if (!bindings.has(mutation.binding)) diagnostics.push(diag("error","FAULT_MUTATION_BINDING_UNKNOWN",`Mutation '${mutation.mutationId}' references undeclared binding '${mutation.binding}'.`,fault.faultId));
    }
    const referenced=new Set<string>();
    for (const c of [...fault.preconditions,...fault.expectedEffects,...fault.negativeControls]) collectConditionBindings(c,referenced);
    for (const name of referenced) if (!bindings.has(name)) diagnostics.push(diag("error","FAULT_CONDITION_BINDING_UNKNOWN",`Fault '${fault.faultId}' condition references undeclared binding '${name}'.`,fault.faultId));
    for (const name of fault.blastRadius.allowedBindings) if (!bindings.has(name)) diagnostics.push(diag("error","FAULT_BLAST_BINDING_UNKNOWN",`Fault '${fault.faultId}' blast radius references undeclared binding '${name}'.`,fault.faultId));
    if (fault.blastRadius.maxChangedResources>fault.blastRadius.allowedBindings.length) diagnostics.push(diag("error","FAULT_BLAST_MAX_EXCEEDS_BINDINGS",`Fault '${fault.faultId}' maxChangedResources exceeds allowed binding count.`,fault.faultId));
    if (fault.incompatibilities.includes(fault.faultId)) diagnostics.push(diag("error","FAULT_SELF_INCOMPATIBLE",`Fault '${fault.faultId}' cannot declare itself incompatible.`,fault.faultId));
  }
  return {ok:!hasErrors(diagnostics),diagnostics};
}


export async function verifyFaultOverlay(overlay:FaultOverlay, scenario?:NormalizedScenario, hash:FaultHashProvider=webCryptoFaultHashProvider):Promise<FaultPackVerification> {
  const diagnostics:FaultDiagnostic[]=[];
  const identity=await computeFaultOverlayIdentity(overlay,hash);
  if (identity!==overlay.overlayIdentity) diagnostics.push(diag("error","FAULT_OVERLAY_IDENTITY_MISMATCH","Fault overlay identity does not match its canonical content."));
  if (scenario&&(overlay.scenarioId!==scenario.scenarioId||overlay.scenarioHash!==scenario.sourceHash)) diagnostics.push(diag("error","FAULT_OVERLAY_SCENARIO_MISMATCH","Fault overlay belongs to a different scenario revision."));
  const locks=new Map<string,FaultOverlay["packLocks"][number]>();
  for (const lock of overlay.packLocks) {
    if (locks.has(lock.packId)) diagnostics.push(diag("error","FAULT_OVERLAY_DUPLICATE_PACK_LOCK",`Overlay repeats pack lock '${lock.packId}'.`));
    locks.set(lock.packId,lock);
  }
  const ids=new Set<string>(); let previousRevision=-1;
  for (const instance of overlay.instances) {
    if (ids.has(instance.instanceId)) diagnostics.push(diag("error","FAULT_OVERLAY_DUPLICATE_INSTANCE",`Overlay repeats instance '${instance.instanceId}'.`,instance.instanceId));
    ids.add(instance.instanceId);
    const lock=locks.get(instance.packId);
    if (!lock||lock.version!==instance.packVersion||lock.packIdentity!==instance.packIdentity) diagnostics.push(diag("error","FAULT_OVERLAY_PACK_LOCK_MISMATCH",`Instance '${instance.instanceId}' does not match its pack lock.`,instance.instanceId));
    const applicationHash=await computeFaultApplicationHash(instance,hash);
    if (applicationHash!==instance.applicationHash) diagnostics.push(diag("error","FAULT_APPLICATION_HASH_MISMATCH",`Instance '${instance.instanceId}' application hash is invalid.`,instance.instanceId));
    if (instance.afterStateRevision!==instance.beforeStateRevision+instance.operations.length) diagnostics.push(diag("error","FAULT_INSTANCE_REVISION_INVALID",`Instance '${instance.instanceId}' state revisions do not match its operation count.`,instance.instanceId));
    if (instance.beforeStateRevision<previousRevision) diagnostics.push(diag("error","FAULT_INSTANCE_REVISION_ORDER_INVALID",`Instance '${instance.instanceId}' starts before the previous instance completed.`,instance.instanceId));
    previousRevision=instance.afterStateRevision;
    const sorted=[...instance.changedResources].sort((a,b)=>a.localeCompare(b,"en"));
    if (!jsonEqual(sorted,instance.changedResources)) diagnostics.push(diag("error","FAULT_CHANGED_RESOURCES_NONCANONICAL",`Instance '${instance.instanceId}' changedResources must be sorted canonically.`,instance.instanceId));
    if (scenario) for (const resourceId of Object.values(instance.bindings)) if (!scenario.resources.some(r=>r.id===resourceId)) diagnostics.push(diag("error","FAULT_OVERLAY_BINDING_TARGET_UNKNOWN",`Instance '${instance.instanceId}' binds unknown scenario resource '${resourceId}'.`,instance.instanceId));
  }
  return {ok:!hasErrors(diagnostics),diagnostics};
}

function validateBindings(fault:Fault,state:EngineState,bindings:Readonly<Record<string,string>>):FaultDiagnostic[] {
  const diagnostics:FaultDiagnostic[]=[];
  const expected=[...fault.targetBindings].map(x=>x.name).sort();
  const actual=Object.keys(bindings).sort();
  if (!jsonEqual(expected,actual)) diagnostics.push(diag("error","FAULT_BINDING_SET_MISMATCH",`Fault '${fault.faultId}' requires exactly bindings [${expected.join(", ")}].`,fault.faultId));
  for (const spec of fault.targetBindings) {
    const id=bindings[spec.name]; if (!id) continue;
    const resource=state.resources[id];
    if (!resource) { diagnostics.push(diag("error","FAULT_BINDING_TARGET_UNKNOWN",`Binding '${spec.name}' targets unknown resource '${id}'.`,id)); continue; }
    if (!spec.resourceTypes.includes("*")&&!spec.resourceTypes.includes(resource.type)) diagnostics.push(diag("error","FAULT_BINDING_TYPE_MISMATCH",`Binding '${spec.name}' target '${id}' has type '${resource.type}', not one of [${spec.resourceTypes.join(", ")}].`,id));
  }
  return diagnostics;
}

function evaluateConditions(label:string,conditions:readonly Condition[],state:EngineState,bindings:Readonly<Record<string,string>>):FaultDiagnostic[] {
  const diagnostics:FaultDiagnostic[]=[];
  conditions.forEach((condition,index)=>{
    const result=evaluateFaultCondition(condition,state,bindings);
    if (result.truth!=="TRUE") diagnostics.push(diag("error",`FAULT_${label}_${result.truth}`,`${label.replaceAll("_"," ")} condition ${index+1} evaluated ${result.truth}: ${result.explanation.join(" ")}`));
  });
  return diagnostics;
}

function resolveValue(mutation:Extract<Mutation,{op:"set"}>,seed:number,faultId:string,resource:EngineState["resources"][string]):unknown {
  if (mutation.value.kind==="literal") return clone(mutation.value.value);
  if (mutation.value.kind==="stp_port_state") {
    const spec=mutation.value;
    const rows=resource.properties.stpPorts;
    if (!Array.isArray(rows)) throw new Error("canonical stpPorts is absent");
    const matches=rows.filter(x=>x&&typeof x==="object"&&(x as Record<string,unknown>).interface===spec.interface);
    if (matches.length!==1) throw new Error(`canonical STP interface '${spec.interface}' is missing or ambiguous`);
    return rows.map(x=>x&&typeof x==="object"&&(x as Record<string,unknown>).interface===spec.interface?{...(x as Record<string,unknown>),state:spec.state}:clone(x));
  }
  const i=deterministicChoiceIndex(seed,`${faultId}\u0000${mutation.mutationId}`,mutation.value.values.length);
  return clone(mutation.value.values[i]);
}

function changedResources(before:EngineState,after:EngineState):string[] {
  return Object.keys(before.resources).filter(id=>!jsonEqual(before.resources[id],after.resources[id])).sort((a,b)=>a.localeCompare(b,"en"));
}

async function buildInjection(request:FaultInjectionRequest,hash:FaultHashProvider):Promise<FaultInjectionResult> {
  const diagnostics:FaultDiagnostic[]=[];
  if (request.state.scenarioId!==request.scenario.scenarioId||request.state.scenarioHash!==request.scenario.sourceHash) diagnostics.push(diag("error","FAULT_STATE_SCENARIO_MISMATCH","Engine state does not belong to the supplied normalized scenario."));
  if (!Number.isInteger(request.seed)||request.seed<0||request.seed>0xffffffff) diagnostics.push(diag("error","FAULT_SEED_INVALID","Fault seed must be an unsigned 32-bit integer."));
  const packVerification=await verifyFaultPack(request.pack,hash); diagnostics.push(...packVerification.diagnostics);
  const fault=request.pack.faults.find(x=>x.faultId===request.faultId);
  if (!fault) diagnostics.push(diag("error","FAULT_ID_UNKNOWN",`Fault '${request.faultId}' is not present in pack '${request.pack.packId}'.`));
  if (request.activeOverlay) {
    const overlayVerification=await verifyFaultOverlay(request.activeOverlay,request.scenario,hash); diagnostics.push(...overlayVerification.diagnostics);
    if (request.activeOverlay.mode!==request.mode) diagnostics.push(diag("error","FAULT_OVERLAY_MODE_MISMATCH","Fault injection mode must match the active overlay mode."));
  }
  if (!fault||hasErrors(diagnostics)) return {ok:false,state:request.state,diagnostics};
  diagnostics.push(...validateBindings(fault,request.state,request.bindings));
  const activeFaultIds=new Set(request.activeOverlay?.instances.map(x=>x.faultId)??[]);
  for (const incompatible of fault.incompatibilities) if (activeFaultIds.has(incompatible)) diagnostics.push(diag("error","FAULT_INCOMPATIBLE_ACTIVE",`Fault '${fault.faultId}' is incompatible with active fault '${incompatible}'.`,fault.faultId));
  for (const mutation of fault.mutations) {
    const target=request.bindings[mutation.binding]; if (!target) continue;
    for (const instance of request.activeOverlay?.instances??[]) for (const activeOperation of instance.operations) {
      if (activeOperation.target===target&&faultPathsOverlap(activeOperation.path,mutation.path)) diagnostics.push(diag("error","FAULT_MUTATION_PATH_CONFLICT_ACTIVE",`Fault '${fault.faultId}' mutation '${target}.${mutation.path}' overlaps active fault '${instance.faultId}' path '${activeOperation.path}'.`,target));
    }
  }
  diagnostics.push(...evaluateConditions("PRECONDITION",fault.preconditions,request.state,request.bindings));
  if (hasErrors(diagnostics)) return {ok:false,state:request.state,diagnostics};

  let current=request.state;
  const operations:ScenarioOperation[]=[]; const inverse:ScenarioOperation[]=[];
  for (const mutation of fault.mutations) {
    const target=request.bindings[mutation.binding]!;
    const resource=current.resources[target]!;
    const before=readPath(resource,mutation.path);
    let operation:ScenarioOperation;
    if (mutation.op==="set") {
      try { operation={op:"set",target,path:mutation.path,value:resolveValue(mutation,request.seed,fault.faultId,resource)}; }
      catch(error) { diagnostics.push(diag("error","FAULT_CANONICAL_STP_UNRESOLVED",error instanceof Error?error.message:"Canonical STP state could not be resolved.",target)); return {ok:false,state:request.state,diagnostics}; }
    } else operation={op:"remove",target,path:mutation.path};
    if (mutation.op==="remove"&&!before.found) { diagnostics.push(diag("error","FAULT_REMOVE_PATH_ABSENT",`Mutation '${mutation.mutationId}' cannot remove absent path '${target}.${mutation.path}'.`,target)); return {ok:false,state:request.state,diagnostics}; }
    const inverseOp:ScenarioOperation=before.found?{op:"set",target,path:mutation.path,value:clone(before.value)}:{op:"remove",target,path:mutation.path};
    const applied=applyOperation(current,operation);
    if (!applied.ok) { diagnostics.push(diag("error","FAULT_MUTATION_APPLY_FAILED",`Mutation '${mutation.mutationId}' failed: ${applied.diagnostic.message}`,target)); return {ok:false,state:request.state,diagnostics}; }
    operations.push(operation); inverse.push(inverseOp); current=applied.state;
  }
  const inverseOperations=[...inverse].reverse();
  diagnostics.push(...evaluateConditions("EXPECTED_EFFECT",fault.expectedEffects,current,request.bindings));
  diagnostics.push(...evaluateConditions("NEGATIVE_CONTROL",fault.negativeControls,current,request.bindings));
  const changed=changedResources(request.state,current);
  const allowedIds=new Set(fault.blastRadius.allowedBindings.map(name=>request.bindings[name]));
  if (changed.length>fault.blastRadius.maxChangedResources) diagnostics.push(diag("error","FAULT_BLAST_RADIUS_EXCEEDED",`Fault changed ${changed.length} resources; maximum is ${fault.blastRadius.maxChangedResources}.`));
  for (const id of changed) if (!allowedIds.has(id)) diagnostics.push(diag("error","FAULT_BLAST_RESOURCE_UNEXPECTED",`Fault changed resource '${id}' outside declared blast-radius bindings.`,id));
  const restored=applyOperations(current,inverseOperations);
  if (!restored.ok||!jsonEqual(restored.state.resources,request.state.resources)) diagnostics.push(diag("error","FAULT_RECOVERY_NOT_REVERSIBLE","Generated inverse operations do not restore exact pre-injection resource state."));
  if (hasErrors(diagnostics)) return {ok:false,state:request.state,diagnostics};

  const overlayId=request.activeOverlay?.overlayId??request.overlayId??"fault_overlay";
  const instanceId=request.instanceId??`fault_${String((request.activeOverlay?.instances.length??0)+1).padStart(4,"0")}`;
  if (!ID.test(overlayId)||!ID.test(instanceId)) return {ok:false,state:request.state,diagnostics:[...diagnostics,diag("error","FAULT_INSTANCE_ID_INVALID","Overlay/instance IDs must be stable scenario IDs.")]};
  const baseInstance={instanceId,packId:request.pack.packId,packVersion:request.pack.version,packIdentity:request.pack.packIdentity,faultId:fault.faultId,faultVersion:fault.version,seed:request.seed,bindings:{...request.bindings},operations:clone(operations),inverseOperations:clone(inverseOperations),beforeStateRevision:request.state.stateRevision,afterStateRevision:current.stateRevision,expectedEffectsVerified:true as const,negativeControlsVerified:true as const,changedResources:changed,applicationHash:"0".repeat(64)};
  const applicationHash=await computeFaultApplicationHash(baseInstance,hash);
  const instance={...baseInstance,applicationHash};
  const packLocks=[...(request.activeOverlay?.packLocks??[])];
  const existing=packLocks.find(x=>x.packId===request.pack.packId);
  if (existing&&(existing.version!==request.pack.version||existing.packIdentity!==request.pack.packIdentity)) return {ok:false,state:request.state,diagnostics:[...diagnostics,diag("error","FAULT_PACK_LOCK_CONFLICT",`Overlay already locks a different '${request.pack.packId}' pack revision.`)]};
  if (!existing) packLocks.push({packId:request.pack.packId,version:request.pack.version,packIdentity:request.pack.packIdentity});
  packLocks.sort((a,b)=>a.packId.localeCompare(b.packId,"en"));
  const overlayBase:FaultOverlay={formatId:"infrastructure-cyber-lab.fault-overlay",schemaVersion:"0.1.0",overlayId,scenarioId:request.scenario.scenarioId,scenarioHash:request.scenario.sourceHash,...(request.scenario.enterpriseOrigin?.baselineIdentity?{enterpriseBaselineIdentity:request.scenario.enterpriseOrigin.baselineIdentity}:{}),mode:request.mode,packLocks,instances:[...(request.activeOverlay?.instances??[]),instance],overlayIdentity:"0".repeat(64)};
  const overlayIdentity=await computeFaultOverlayIdentity(overlayBase,hash);
  return {ok:true,state:current,overlay:{...overlayBase,overlayIdentity},operations,inverseOperations,diagnostics};
}

export async function previewFaultInjection(request:FaultInjectionRequest,hash:FaultHashProvider=webCryptoFaultHashProvider):Promise<FaultInjectionResult> { return buildInjection(request,hash); }
export async function injectFault(request:FaultInjectionRequest,hash:FaultHashProvider=webCryptoFaultHashProvider):Promise<FaultInjectionResult> { return buildInjection(request,hash); }

export const FAULT_SCENARIO_GENERATOR_ID="foundation.multi_fault";
export const FAULT_SCENARIO_GENERATOR_VERSION="0.1.0";
const GENERATOR_MAX_BINDING_ASSIGNMENTS=10000;
const GENERATOR_MAX_SEARCH_NODES=50000;

function lex(a:string,b:string):number { return a<b?-1:a>b?1:0; }
function stableUniqueStrings(values:readonly string[]):string[] { return [...new Set(values)].sort(lex); }
function generatorAcceptedType(type:string,allowed:readonly string[]|undefined):boolean { return !allowed||allowed.length===0||allowed.includes("*")||allowed.includes(type); }
function generatorFaultKey(packId:string,faultId:string):string { return `${packId}\u0000${faultId}`; }
function generatorBindingKey(bindings:Readonly<Record<string,string>>):string { return Object.entries(bindings).sort(([a],[b])=>lex(a,b)).map(([k,v])=>`${k}=${v}`).join("|"); }
function generatorSeed(seed:number,namespace:string):number { return deterministicChoiceIndex(seed,`${FAULT_SCENARIO_GENERATOR_ID}@${FAULT_SCENARIO_GENERATOR_VERSION}\u0000${namespace}`,0x100000000); }
function preconditionsHold(fault:Fault,state:EngineState,bindings:Readonly<Record<string,string>>):boolean { return fault.preconditions.every(condition=>evaluateFaultCondition(condition,state,bindings).truth==="TRUE"); }
function effectsHold(fault:Fault,state:EngineState,bindings:Readonly<Record<string,string>>):boolean {
  return [...fault.expectedEffects,...fault.negativeControls].every(condition=>evaluateFaultCondition(condition,state,bindings).truth==="TRUE");
}
function difficultyWithinBounds(fault:Fault,bounds:FaultGenerationPlan["request"]["difficulty"]|undefined):boolean {
  if (!bounds) return true;
  const values=fault.difficulty as Readonly<Record<string,number>>;
  for (const [name,bound] of Object.entries(bounds)) {
    if (!bound) continue;
    const value=values[name]; if (value===undefined) return false;
    if (bound.min!==undefined&&value<bound.min) return false;
    if (bound.max!==undefined&&value>bound.max) return false;
  }
  return true;
}
function generatorBindings(fault:Fault,state:EngineState,allowedTargetTypes:readonly string[]|undefined):{assignments:Readonly<Record<string,string>>[];exceeded:boolean} {
  const specs=[...fault.targetBindings].sort((a,b)=>lex(a.name,b.name));
  const options=specs.map(spec=>Object.values(state.resources)
    .filter(resource=>(spec.resourceTypes.includes("*")||spec.resourceTypes.includes(resource.type))&&generatorAcceptedType(resource.type,allowedTargetTypes))
    .map(resource=>resource.id).sort(lex));
  if (options.some(xs=>xs.length===0)) return {assignments:[],exceeded:false};
  const assignments:Readonly<Record<string,string>>[]=[]; let exceeded=false;
  const walk=(index:number,current:Record<string,string>):void=>{
    if (exceeded) return;
    if (index===specs.length) { assignments.push({...current}); if (assignments.length>GENERATOR_MAX_BINDING_ASSIGNMENTS) exceeded=true; return; }
    const spec=specs[index]!;
    for (const target of options[index]!) { current[spec.name]=target; walk(index+1,current); if (exceeded) break; }
    delete current[spec.name];
  };
  walk(0,{});
  if (exceeded) return {assignments:assignments.slice(0,GENERATOR_MAX_BINDING_ASSIGNMENTS),exceeded:true};
  return {assignments,exceeded:false};
}
function findFaultInPacks(packs:readonly FaultPack[],packId:string,faultId:string):Fault|undefined { return packs.find(pack=>pack.packId===packId)?.faults.find(fault=>fault.faultId===faultId); }
function overlaySemanticsHold(overlay:FaultOverlay,state:EngineState,packs:readonly FaultPack[]):boolean {
  for (const instance of overlay.instances) {
    const pack=packs.find(item=>item.packId===instance.packId&&item.version===instance.packVersion&&item.packIdentity===instance.packIdentity);
    const fault=pack?.faults.find(item=>item.faultId===instance.faultId&&item.version===instance.faultVersion);
    if (!fault||!effectsHold(fault,state,instance.bindings)) return false;
  }
  return true;
}
function overlayChangedResources(overlay:FaultOverlay):string[] { return stableUniqueStrings(overlay.instances.flatMap(instance=>instance.changedResources)); }
function symmetricIncompatibility(fault:Fault,overlay:FaultOverlay|undefined,packs:readonly FaultPack[]):boolean {
  for (const instance of overlay?.instances??[]) {
    const existing=findFaultInPacks(packs,instance.packId,instance.faultId);
    if (!existing) return true;
    if (fault.incompatibilities.includes(existing.faultId)||existing.incompatibilities.includes(fault.faultId)) return true;
  }
  return false;
}
function normalizedGeneratorRequest(request:FaultScenarioGenerationRequest):FaultGenerationPlan["request"] {
  const constraints=request.constraints;
  const out:FaultGenerationPlan["request"]={faultCount:request.faultCount,requireDistinctFaultDefinitions:constraints?.requireDistinctFaultDefinitions??true};
  const add=(name:"allowedDomains"|"allowedTargetTypes"|"allowedFaultIds"|"excludedFaultIds",values:readonly string[]|undefined):void=>{ if (values?.length) (out as unknown as Record<string,unknown>)[name]=stableUniqueStrings(values); };
  add("allowedDomains",constraints?.allowedDomains); add("allowedTargetTypes",constraints?.allowedTargetTypes); add("allowedFaultIds",constraints?.allowedFaultIds); add("excludedFaultIds",constraints?.excludedFaultIds);
  if (constraints?.maxTotalChangedResources!==undefined) (out as unknown as Record<string,unknown>).maxTotalChangedResources=constraints.maxTotalChangedResources;
  if (constraints?.difficulty!==undefined) (out as unknown as Record<string,unknown>).difficulty=clone(constraints.difficulty);
  return out;
}
function validateGeneratorRequest(request:FaultScenarioGenerationRequest):FaultDiagnostic[] {
  const diagnostics:FaultDiagnostic[]=[];
  if (request.state.scenarioId!==request.scenario.scenarioId||request.state.scenarioHash!==request.scenario.sourceHash) diagnostics.push(diag("error","FAULT_GENERATOR_STATE_SCENARIO_MISMATCH","Generator Engine state does not belong to the supplied normalized scenario."));
  if (!Number.isInteger(request.seed)||request.seed<0||request.seed>0xffffffff) diagnostics.push(diag("error","FAULT_GENERATOR_SEED_INVALID","Generator seed must be an unsigned 32-bit integer."));
  if (!Number.isInteger(request.faultCount)||request.faultCount<1||request.faultCount>32) diagnostics.push(diag("error","FAULT_GENERATOR_COUNT_INVALID","Generator faultCount must be an integer from 1 through 32."));
  if (request.packs.length===0) diagnostics.push(diag("error","FAULT_GENERATOR_PACKS_EMPTY","At least one exact-versioned Fault Pack is required."));
  const ids=new Set<string>(); const faultIds=new Set<string>();
  for (const pack of request.packs) {
    if (ids.has(pack.packId)) diagnostics.push(diag("error","FAULT_GENERATOR_PACK_DUPLICATE",`Generator input repeats packId '${pack.packId}'.`));
    ids.add(pack.packId);
    for (const fault of pack.faults) {
      if (faultIds.has(fault.faultId)) diagnostics.push(diag("error","FAULT_GENERATOR_FAULT_ID_AMBIGUOUS",`Fault id '${fault.faultId}' occurs in more than one selected pack.`));
      faultIds.add(fault.faultId);
    }
  }
  const maximum=request.constraints?.maxTotalChangedResources;
  if (maximum!==undefined&&(!Number.isInteger(maximum)||maximum<1)) diagnostics.push(diag("error","FAULT_GENERATOR_CHANGED_RESOURCE_LIMIT_INVALID","maxTotalChangedResources must be a positive integer."));
  const bounds=request.constraints?.difficulty;
  if (bounds) for (const [name,bound] of Object.entries(bounds)) {
    if (!bound) continue;
    if (bound.min!==undefined&&(!Number.isInteger(bound.min)||bound.min<0)) diagnostics.push(diag("error","FAULT_GENERATOR_DIFFICULTY_BOUND_INVALID",`Difficulty '${name}' minimum must be a non-negative integer.`));
    if (bound.max!==undefined&&(!Number.isInteger(bound.max)||bound.max<0)) diagnostics.push(diag("error","FAULT_GENERATOR_DIFFICULTY_BOUND_INVALID",`Difficulty '${name}' maximum must be a non-negative integer.`));
    if (bound.min!==undefined&&bound.max!==undefined&&bound.min>bound.max) diagnostics.push(diag("error","FAULT_GENERATOR_DIFFICULTY_RANGE_INVALID",`Difficulty '${name}' minimum exceeds its maximum.`));
  }
  if (request.overlayId!==undefined&&!ID.test(request.overlayId)) diagnostics.push(diag("error","FAULT_GENERATOR_OVERLAY_ID_INVALID","Generator overlayId must be a stable scenario ID."));
  return diagnostics;
}

export async function verifyFaultGenerationPlan(plan:FaultGenerationPlan,overlay?:FaultOverlay,scenario?:NormalizedScenario,hash:FaultHashProvider=webCryptoFaultHashProvider):Promise<FaultPackVerification> {
  const diagnostics:FaultDiagnostic[]=[];
  if (plan.formatId!=="infrastructure-cyber-lab.fault-generation-plan") diagnostics.push(diag("error","FAULT_GENERATION_PLAN_FORMAT_INVALID","Unsupported fault-generation plan format."));
  if (plan.generatorId!==FAULT_SCENARIO_GENERATOR_ID||plan.generatorVersion!==FAULT_SCENARIO_GENERATOR_VERSION) diagnostics.push(diag("error","FAULT_GENERATION_PLAN_GENERATOR_UNSUPPORTED","Fault-generation plan was produced by an unsupported generator revision."));
  const identity=await computeFaultGenerationPlanIdentity(plan,hash);
  if (identity!==plan.planIdentity) diagnostics.push(diag("error","FAULT_GENERATION_PLAN_IDENTITY_MISMATCH","Fault-generation plan identity does not match its canonical content."));
  if (plan.request.faultCount!==plan.selections.length||plan.groundTruth.faultCount!==plan.selections.length) diagnostics.push(diag("error","FAULT_GENERATION_PLAN_COUNT_MISMATCH","Fault-generation plan counts do not agree."));
  if (scenario&&(plan.scenarioId!==scenario.scenarioId||plan.scenarioHash!==scenario.sourceHash)) diagnostics.push(diag("error","FAULT_GENERATION_PLAN_SCENARIO_MISMATCH","Fault-generation plan belongs to another scenario revision."));
  if (overlay) {
    if (plan.groundTruth.overlayIdentity!==overlay.overlayIdentity) diagnostics.push(diag("error","FAULT_GENERATION_PLAN_OVERLAY_MISMATCH","Fault-generation plan does not bind the supplied overlay identity."));
    if (plan.selections.length!==overlay.instances.length) diagnostics.push(diag("error","FAULT_GENERATION_PLAN_INSTANCE_COUNT_MISMATCH","Fault-generation plan selection count does not match overlay instances."));
    const locksA=[...plan.packLocks].sort((a,b)=>lex(a.packId,b.packId)); const locksB=[...overlay.packLocks].sort((a,b)=>lex(a.packId,b.packId));
    if (!jsonEqual(locksA,locksB)) diagnostics.push(diag("error","FAULT_GENERATION_PLAN_PACK_LOCK_MISMATCH","Fault-generation plan pack locks do not match its overlay."));
    plan.selections.forEach((selection,index)=>{ const instance=overlay.instances[index]; if (!instance||selection.instanceId!==instance.instanceId||selection.packId!==instance.packId||selection.faultId!==instance.faultId||selection.seed!==instance.seed||!jsonEqual(selection.bindings,instance.bindings)) diagnostics.push(diag("error","FAULT_GENERATION_PLAN_SELECTION_MISMATCH",`Selection ${index+1} does not match its overlay instance.`)); });
    const recovery=overlay.instances.slice().reverse().flatMap(instance=>instance.inverseOperations as readonly ScenarioOperation[]);
    if (!jsonEqual(recovery,plan.groundTruth.canonicalRecovery)) diagnostics.push(diag("error","FAULT_GENERATION_PLAN_RECOVERY_MISMATCH","Fault-generation plan canonical recovery does not match reverse overlay recovery."));
  }
  return {ok:!hasErrors(diagnostics),diagnostics};
}

export async function generateDeterministicFaultScenario(request:FaultScenarioGenerationRequest,hash:FaultHashProvider=webCryptoFaultHashProvider):Promise<FaultScenarioGenerationResult> {
  const diagnostics=validateGeneratorRequest(request);
  const packs=[...request.packs].sort((a,b)=>lex(a.packId,b.packId)||lex(a.version,b.version)||lex(a.packIdentity,b.packIdentity));
  for (const pack of packs) { const verified=await verifyFaultPack(pack,hash); diagnostics.push(...verified.diagnostics); }
  if (hasErrors(diagnostics)) return {ok:false,state:request.state,diagnostics};
  const planRequest=normalizedGeneratorRequest(request);
  const allowedDomains=new Set(planRequest.allowedDomains??[]); const allowedFaultIds=new Set(planRequest.allowedFaultIds??[]); const excludedFaultIds=new Set(planRequest.excludedFaultIds??[]);
  const baselineState=request.state;
  const packSetKey=packs.map(pack=>`${pack.packId}@${pack.version}#${pack.packIdentity}`).join("|");
  const requestKey=canonicalFaultJson(planRequest);
  let searchedNodes=0; let searchLimitExceeded=false;
  type SearchState={state:EngineState;overlay?:FaultOverlay;used:ReadonlySet<string>;baselinePreconditions:ReadonlyMap<string,boolean>};
  const search=async(step:number,current:SearchState):Promise<SearchState|undefined>=>{
    if (step===request.faultCount) return current;
    const candidates:Array<{key:string;rank:number;pack:FaultPack;fault:Fault;seed:number;result:Extract<FaultInjectionResult,{ok:true}>;baselinePreconditions:boolean}>=[];
    for (const pack of packs) for (const fault of [...pack.faults].sort((a,b)=>lex(a.faultId,b.faultId))) {
      const definitionKey=generatorFaultKey(pack.packId,fault.faultId);
      if (planRequest.requireDistinctFaultDefinitions&&current.used.has(definitionKey)) continue;
      if (allowedDomains.size&&!allowedDomains.has(fault.domain)) continue;
      if (allowedFaultIds.size&&!allowedFaultIds.has(fault.faultId)) continue;
      if (excludedFaultIds.has(fault.faultId)) continue;
      if (!difficultyWithinBounds(fault,planRequest.difficulty)) continue;
      if (symmetricIncompatibility(fault,current.overlay,packs)) continue;
      const bindingsResult=generatorBindings(fault,current.state,planRequest.allowedTargetTypes);
      if (bindingsResult.exceeded) { searchLimitExceeded=true; return undefined; }
      for (const bindings of bindingsResult.assignments) {
        const key=`${pack.packId}|${fault.faultId}|${generatorBindingKey(bindings)}`;
        const candidateSeed=generatorSeed(request.seed,`fault-seed|${step+1}|${key}`);
        const result=await injectFault({scenario:request.scenario,state:current.state,pack,faultId:fault.faultId,bindings,seed:candidateSeed,mode:"SCENARIO_VARIANT",...(current.overlay?{activeOverlay:current.overlay}:{overlayId:request.overlayId??"generated_fault_overlay"}),instanceId:`generated_fault_${String(step+1).padStart(4,"0")}`},hash);
        if (!result.ok) continue;
        if (!overlaySemanticsHold(result.overlay,result.state,packs)) continue;
        if (planRequest.maxTotalChangedResources!==undefined&&overlayChangedResources(result.overlay).length>planRequest.maxTotalChangedResources) continue;
        const rank=deterministicChoiceIndex(request.seed,`candidate-rank|${step+1}|${requestKey}|${packSetKey}|${current.overlay?.overlayIdentity??request.scenario.sourceHash}|${key}`,0x100000000);
        candidates.push({key,rank,pack,fault,seed:candidateSeed,result,baselinePreconditions:preconditionsHold(fault,baselineState,bindings)});
      }
    }
    candidates.sort((a,b)=>a.rank-b.rank||lex(a.key,b.key)||a.seed-b.seed);
    for (const chosen of candidates) {
      searchedNodes+=1;
      if (searchedNodes>GENERATOR_MAX_SEARCH_NODES) { searchLimitExceeded=true; return undefined; }
      const instance=chosen.result.overlay.instances.at(-1)!;
      const used=new Set(current.used); used.add(generatorFaultKey(chosen.pack.packId,chosen.fault.faultId));
      const baselinePreconditions=new Map(current.baselinePreconditions); baselinePreconditions.set(instance.instanceId,chosen.baselinePreconditions);
      const found=await search(step+1,{state:chosen.result.state,overlay:chosen.result.overlay,used,baselinePreconditions});
      if (found) return found;
      if (searchLimitExceeded) return undefined;
    }
    return undefined;
  };
  const found=await search(0,{state:request.state,used:new Set<string>(),baselinePreconditions:new Map<string,boolean>()});
  if (!found) {
    const code=searchLimitExceeded?"FAULT_GENERATOR_SEARCH_LIMIT_EXCEEDED":"FAULT_GENERATOR_UNSATISFIABLE";
    const message=searchLimitExceeded?`Generator search exceeded ${GENERATOR_MAX_SEARCH_NODES} deterministic candidate nodes or ${GENERATOR_MAX_BINDING_ASSIGNMENTS} binding assignments for one fault.`:`No compatible deterministic ${request.faultCount}-fault combination satisfies the requested constraints.`;
    return {ok:false,state:request.state,diagnostics:[...diagnostics,diag("error",code,message)]};
  }
  const currentState=found.state; const overlay=found.overlay; const baselinePreconditions=found.baselinePreconditions;
  if (!overlay||overlay.instances.length!==request.faultCount) return {ok:false,state:request.state,diagnostics:[...diagnostics,diag("error","FAULT_GENERATOR_INTERNAL_COUNT_MISMATCH","Generator failed to produce the requested number of fault instances.")]};
  if (!overlaySemanticsHold(overlay,currentState,packs)) return {ok:false,state:request.state,diagnostics:[...diagnostics,diag("error","FAULT_GENERATOR_FINAL_EFFECT_REGRESSION","A selected fault no longer satisfies its declared final expected effects or negative controls.")]};
  const recovery=overlay.instances.slice().reverse().flatMap(instance=>instance.inverseOperations as readonly ScenarioOperation[]);
  const restored=applyOperations(currentState,recovery);
  if (!restored.ok||!jsonEqual(restored.state.resources,baselineState.resources)) return {ok:false,state:request.state,diagnostics:[...diagnostics,diag("error","FAULT_GENERATOR_RECOVERY_REGRESSION","Combined canonical recovery does not restore exact baseline resource state.")]};
  const selections:FaultGenerationPlan["selections"] = overlay.instances.map((instance,index)=>{
    const fault=findFaultInPacks(packs,instance.packId,instance.faultId)!;
    return {ordinal:index+1,instanceId:instance.instanceId,packId:instance.packId,packVersion:instance.packVersion,packIdentity:instance.packIdentity,faultId:instance.faultId,faultVersion:instance.faultVersion,seed:instance.seed,bindings:{...instance.bindings},changedResources:[...instance.changedResources],expectedSymptoms:[...fault.observableSymptoms],hiddenTruth:fault.hiddenTruth,learningObjectives:[...fault.learningObjectives],difficulty:clone(fault.difficulty),beforeStateRevision:instance.beforeStateRevision,afterStateRevision:instance.afterStateRevision,preconditionsHeldOnBaseline:baselinePreconditions.get(instance.instanceId)??false};
  });
  const expectedSymptoms=stableUniqueStrings(selections.flatMap(selection=>selection.expectedSymptoms));
  const changed=overlayChangedResources(overlay);
  const groundTruth:FaultGenerationPlan["groundTruth"]={overlayIdentity:overlay.overlayIdentity,faultCount:selections.length,changedResources:changed,expectedSymptoms,referenceInvestigationOrder:selections.map(selection=>({ordinal:selection.ordinal,instanceId:selection.instanceId,faultId:selection.faultId,rationale:selection.preconditionsHeldOnBaseline?"INDEPENDENT_STABLE_ORDER":"PRECONDITION_DEPENDENCY",expectedSymptoms:[...selection.expectedSymptoms],learningObjectives:[...selection.learningObjectives]})),recoveryOrder:overlay.instances.slice().reverse().map(instance=>instance.instanceId),canonicalRecovery:clone(recovery),finalStateRevision:currentState.stateRevision,solvabilityVerified:true};
  const planBase:FaultGenerationPlan={formatId:"infrastructure-cyber-lab.fault-generation-plan",schemaVersion:"0.1.0",generatorId:FAULT_SCENARIO_GENERATOR_ID,generatorVersion:FAULT_SCENARIO_GENERATOR_VERSION,scenarioId:request.scenario.scenarioId,scenarioHash:request.scenario.sourceHash,...(request.scenario.enterpriseOrigin?.baselineIdentity?{enterpriseBaselineIdentity:request.scenario.enterpriseOrigin.baselineIdentity}:{}),seed:request.seed,request:planRequest,packLocks:clone(overlay.packLocks),selections,groundTruth,planIdentity:"0".repeat(64)};
  const planIdentity=await computeFaultGenerationPlanIdentity(planBase,hash); const plan={...planBase,planIdentity};
  const planVerification=await verifyFaultGenerationPlan(plan,overlay,request.scenario,hash); diagnostics.push(...planVerification.diagnostics);
  if (!planVerification.ok) return {ok:false,state:request.state,diagnostics};
  return {ok:true,state:currentState,overlay,plan,diagnostics};
}

export async function rollbackLatestFault(scenario:NormalizedScenario,state:EngineState,overlay:FaultOverlay,hash:FaultHashProvider=webCryptoFaultHashProvider):Promise<FaultRollback> {
  const diagnostics:FaultDiagnostic[]=[];
  if (overlay.scenarioId!==scenario.scenarioId||overlay.scenarioHash!==scenario.sourceHash||state.scenarioHash!==scenario.sourceHash) return {ok:false,state,diagnostics:[diag("error","FAULT_ROLLBACK_SCENARIO_MISMATCH","Scenario/state/overlay identity mismatch.")]};
  const overlayVerification=await verifyFaultOverlay(overlay,scenario,hash); if (!overlayVerification.ok) return {ok:false,state,diagnostics:overlayVerification.diagnostics};
  const last=overlay.instances.at(-1); if (!last) return {ok:false,state,diagnostics:[diag("error","FAULT_ROLLBACK_EMPTY","No active fault instance exists.")]};
  if (state.stateRevision!==last.afterStateRevision) return {ok:false,state,diagnostics:[diag("error","FAULT_ROLLBACK_STATE_ADVANCED","Runtime state changed after the latest fault; use Runtime history/checkpoint restore instead of unsafe inverse replay.")]};
  const restored=applyOperations(state,last.inverseOperations as readonly ScenarioOperation[]); if (!restored.ok) return {ok:false,state,diagnostics:[diag("error","FAULT_ROLLBACK_APPLY_FAILED",restored.diagnostic.message)]};
  const remaining=overlay.instances.slice(0,-1);
  const used=new Set(remaining.map(x=>x.packId)); const packLocks=overlay.packLocks.filter(x=>used.has(x.packId));
  const base={...overlay,packLocks,instances:remaining,overlayIdentity:"0".repeat(64)} as FaultOverlay;
  const overlayIdentity=await computeFaultOverlayIdentity(base,hash);
  return {ok:true,state:restored.state,overlay:{...base,overlayIdentity},diagnostics};
}

function applySourceOperation(source:ScenarioSource,operation:ScenarioOperation):ScenarioSource|undefined {
  const index=source.resources.findIndex(r=>r.id===operation.target); if (index<0) return undefined;
  const resource=source.resources[index] as unknown as Readonly<Record<string,unknown>>;
  const result=operation.op==="set"?setPath(resource,operation.path,operation.value):removePath(resource,operation.path);
  if (!result.ok) return undefined;
  const resources=[...source.resources]; resources[index]=result.value as unknown as ScenarioSource["resources"][number];
  return {...source,resources};
}

export function materializeFaultedScenarioVariant(source:ScenarioSource,compiledBase:NormalizedScenario,overlay:FaultOverlay,variantScenarioId:string,generation?:NonNullable<ScenarioSource["faultOrigin"]>["generation"]):MaterializeFaultVariantResult {
  const diagnostics:FaultDiagnostic[]=[];
  if (!ID.test(variantScenarioId)) diagnostics.push(diag("error","FAULT_VARIANT_ID_INVALID",`Variant scenarioId '${variantScenarioId}' is invalid.`));
  if (overlay.mode!=="SCENARIO_VARIANT") diagnostics.push(diag("error","FAULT_VARIANT_MODE_REQUIRED","Persistent materialization requires a SCENARIO_VARIANT overlay."));
  if (source.scenarioId!==compiledBase.scenarioId||overlay.scenarioId!==compiledBase.scenarioId||overlay.scenarioHash!==compiledBase.sourceHash) diagnostics.push(diag("error","FAULT_VARIANT_BASE_MISMATCH","Source, compiled base, and overlay do not refer to the same base scenario revision."));
  if (overlay.instances.length===0) diagnostics.push(diag("error","FAULT_VARIANT_EMPTY","Persistent fault variant requires at least one fault instance."));
  if (hasErrors(diagnostics)) return {ok:false,diagnostics};
  let variant:ScenarioSource=clone(source);
  for (const instance of overlay.instances) for (const operation of instance.operations as readonly ScenarioOperation[]) {
    const next=applySourceOperation(variant,operation); if (!next) return {ok:false,diagnostics:[...diagnostics,diag("error","FAULT_VARIANT_SOURCE_APPLY_FAILED",`Resolved operation '${operation.target}.${operation.path}' cannot be materialized into author source.`)]}; variant=next;
  }
  const recovery=overlay.instances.slice().reverse().flatMap(instance=>instance.inverseOperations as readonly ScenarioOperation[]);
  variant={...variant,scenarioId:variantScenarioId,canonicalSolution:{operations:clone(recovery)},faultOrigin:{baseScenarioId:compiledBase.scenarioId,baseScenarioHash:compiledBase.sourceHash,overlayIdentity:overlay.overlayIdentity,packLocks:clone(overlay.packLocks),instances:overlay.instances.map(x=>({instanceId:x.instanceId,faultId:x.faultId,faultVersion:x.faultVersion,seed:x.seed,bindings:{...x.bindings}})),...(generation?{generation:clone(generation)}:{})}};
  return {ok:true,source:variant,diagnostics};
}
