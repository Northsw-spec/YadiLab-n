import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInitialEngineState } from "../../dist-fault-engine-test/engine/src/index.js";
import {
  computeFaultGenerationPlanIdentity,
  computeFaultPackIdentity,
  generateDeterministicFaultScenario,
  verifyFaultGenerationPlan,
} from "../../dist-fault-engine-test/fault-engine/src/index.js";

const here=path.dirname(fileURLToPath(import.meta.url)); const root=path.resolve(here,"../..");
const read=(p)=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8"));
const scenario=read("tests/fixtures/valid/scenario-normalized.json");
const network=read("fault-packs/builtin/network-core.json");
const windows=read("fault-packs/builtin/windows-core.json");
let checks=0; const check=(name,value)=>{assert.ok(value,name);checks+=1;};
const code=(result,expected)=>!result.ok&&result.diagnostics.some(x=>x.code===expected);

check("duplicate pack ids fail closed",code(await generateDeterministicFaultScenario({scenario,state:createInitialEngineState(scenario),packs:[network,network],seed:1,faultCount:1}),"FAULT_GENERATOR_PACK_DUPLICATE"));
check("invalid seed fails closed",code(await generateDeterministicFaultScenario({scenario,state:createInitialEngineState(scenario),packs:[network],seed:-1,faultCount:1}),"FAULT_GENERATOR_SEED_INVALID"));
check("invalid fault count fails closed",code(await generateDeterministicFaultScenario({scenario,state:createInitialEngineState(scenario),packs:[network],seed:1,faultCount:0}),"FAULT_GENERATOR_COUNT_INVALID"));
const wrongState={...createInitialEngineState(scenario),scenarioHash:"f".repeat(64)};
check("foreign Engine state fails closed",code(await generateDeterministicFaultScenario({scenario,state:wrongState,packs:[network],seed:1,faultCount:1}),"FAULT_GENERATOR_STATE_SCENARIO_MISMATCH"));
check("invalid difficulty range fails closed",code(await generateDeterministicFaultScenario({scenario,state:createInitialEngineState(scenario),packs:[network],seed:1,faultCount:1,constraints:{difficulty:{layers:{min:3,max:1}}}}),"FAULT_GENERATOR_DIFFICULTY_RANGE_INVALID"));
check("invalid overlay id fails closed",code(await generateDeterministicFaultScenario({scenario,state:createInitialEngineState(scenario),packs:[network],seed:1,faultCount:1,overlayId:"BAD"}),"FAULT_GENERATOR_OVERLAY_ID_INVALID"));

const duplicateFaultPack=structuredClone(network); duplicateFaultPack.packId="thirdparty.network.copy"; duplicateFaultPack.packIdentity="0".repeat(64); duplicateFaultPack.packIdentity=await computeFaultPackIdentity(duplicateFaultPack);
check("ambiguous cross-pack fault ids fail closed",code(await generateDeterministicFaultScenario({scenario,state:createInitialEngineState(scenario),packs:[network,duplicateFaultPack],seed:1,faultCount:1}),"FAULT_GENERATOR_FAULT_ID_AMBIGUOUS"));

const template={
 version:"0.1.0",domain:"semantic.test",targetBindings:[{name:"target",resourceTypes:["windows.rds_host"]}],preconditions:[{op:"path_exists",binding:"target",path:"properties"}],incompatibilities:[],recovery:{mode:"restore_pre_injection"},blastRadius:{maxChangedResources:1,allowedBindings:["target"]},visibilityPolicy:{student:"SYMPTOMS_ONLY",instructor:"VISIBLE"},difficulty:{layers:1,dependencyDepth:1,evidenceVisibility:2,remediationConstraints:0},tags:["test"],learningObjectives:["test"]
};
const semanticPack={formatId:"infrastructure-cyber-lab.fault-pack",schemaVersion:"0.1.0",packId:"test.semantic.conflict",version:"0.1.0",domain:"semantic.test",packIdentity:"0".repeat(64),faults:[
 {...template,faultId:"semantic.keep_nla_false",title:"Keep NLA false while setting marker",mutations:[{mutationId:"mark",op:"set",binding:"target",path:"properties.markerA",value:{kind:"literal",value:true}}],expectedEffects:[{op:"path_equals",binding:"target",path:"properties.markerA",value:true}],negativeControls:[{op:"path_equals",binding:"target",path:"properties.nla",value:false}],observableSymptoms:["Marker A"] ,hiddenTruth:"Marker A is set and NLA must stay false."},
 {...template,faultId:"semantic.enable_nla",title:"Enable NLA",mutations:[{mutationId:"enable",op:"set",binding:"target",path:"properties.nla",value:{kind:"literal",value:true}}],expectedEffects:[{op:"path_equals",binding:"target",path:"properties.nla",value:true}],negativeControls:[],observableSymptoms:["NLA enabled"],hiddenTruth:"NLA is enabled."}
]};
semanticPack.packIdentity=await computeFaultPackIdentity(semanticPack);
const semantic=await generateDeterministicFaultScenario({scenario,state:createInitialEngineState(scenario),packs:[semanticPack],seed:1,faultCount:2});
check("semantic cross-fault regression is rejected even on different mutation paths",code(semantic,"FAULT_GENERATOR_UNSATISFIABLE"));

const valid=await generateDeterministicFaultScenario({scenario,state:createInitialEngineState(scenario),packs:[network,windows],seed:7,faultCount:2});
check("adversarial baseline generation succeeds",valid.ok);
if (valid.ok) {
  const tampered=structuredClone(valid.plan); tampered.selections[0].seed=(tampered.selections[0].seed+1)>>>0;
  const verifyTampered=await verifyFaultGenerationPlan(tampered,valid.overlay,scenario);
  check("plan content tamper breaks plan identity",!verifyTampered.ok&&verifyTampered.diagnostics.some(x=>x.code==="FAULT_GENERATION_PLAN_IDENTITY_MISMATCH"));
  const recoveryTampered=structuredClone(valid.plan); recoveryTampered.groundTruth.canonicalRecovery=[...recoveryTampered.groundTruth.canonicalRecovery].reverse(); recoveryTampered.planIdentity="0".repeat(64); recoveryTampered.planIdentity=await computeFaultGenerationPlanIdentity(recoveryTampered);
  const verifyRecovery=await verifyFaultGenerationPlan(recoveryTampered,valid.overlay,scenario);
  check("rehashed recovery tamper still fails semantic overlay binding",!verifyRecovery.ok&&verifyRecovery.diagnostics.some(x=>x.code==="FAULT_GENERATION_PLAN_RECOVERY_MISMATCH"));
}
console.log(`PASS deterministic multi-fault generator adversarial: ${checks}/${checks} assertions.`);
