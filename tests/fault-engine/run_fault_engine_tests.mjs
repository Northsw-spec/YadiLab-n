import assert from "node:assert/strict";
import fs from "node:fs";
import {
  computeFaultOverlayIdentity,
  computeFaultPackIdentity,
  injectFault,
  materializeFaultedScenarioVariant,
  rollbackLatestFault,
  verifyFaultPack,
  verifyFaultOverlay,
} from "../../dist-fault-engine-test/fault-engine/src/index.js";
import { applyOperation, createInitialEngineState } from "../../dist-fault-engine-test/engine/src/index.js";

let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++;}; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const pack=JSON.parse(fs.readFileSync("fault-packs/builtin/network-core.json","utf8"));
const scenario={
  formatId:"infrastructure-cyber-lab.scenario",schemaVersion:"0.1.0",scenarioId:"fault_lab",sourceHash:"b".repeat(64),
  metadata:{title:"Fault Lab",description:"",language:"en",authors:[],tags:[],briefing:""},minimumEngineVersion:"0.8.0",capabilityLocks:[],profileLocks:[],assetLocks:[],zones:[],
  resources:[
    {id:"client1",type:"windows.workstation",label:"Client 1",interfaces:[],properties:{defaultGateway:"10.0.0.1",aclDefaultAction:"allow",stable:"keep"}},
    {id:"router1",type:"network.router",label:"Router 1",interfaces:[],properties:{defaultGateway:"10.0.0.254",stable:"keep"}}
  ],connections:[],tests:[],findings:[],objectives:[],completion:{op:"all",rules:[]},hints:[]
};
const source={
  formatId:"infrastructure-cyber-lab.scenario-source",schemaVersion:"0.1.0",scenarioId:"fault_lab",metadata:{title:"Fault Lab",language:"en"},requires:{capabilities:[],profiles:[]},zones:[],
  resources:[
    {id:"client1",type:"windows.workstation",label:"Client 1",interfaces:[],properties:{defaultGateway:"10.0.0.1",aclDefaultAction:"allow",stable:"keep"}},
    {id:"router1",type:"network.router",label:"Router 1",interfaces:[],properties:{defaultGateway:"10.0.0.254",stable:"keep"}}
  ],connections:[],tests:[],findings:[],objectives:[{id:"restore",title:"Restore",category:"fault",required:true,condition:{op:"equals",target:"client1",path:"properties.defaultGateway",value:"10.0.0.1"}}],completion:{op:"equals",target:"client1",path:"properties.defaultGateway",value:"10.0.0.1"}
};
async function finalizePack(p){ const copy=structuredClone(p); copy.packIdentity="0".repeat(64); copy.packIdentity=await computeFaultPackIdentity(copy); return copy; }

const verified=await verifyFaultPack(pack); ok(verified.ok,`builtin pack verifies: ${JSON.stringify(verified.diagnostics)}`); eq(await computeFaultPackIdentity(pack),pack.packIdentity,"builtin pack identity reproducible");
const initial=createInitialEngineState(scenario);
const request={scenario,state:initial,pack,faultId:"routing.remove_default_gateway",bindings:{target:"client1"},seed:7,mode:"RUNTIME_INJECTION"};
const injected=await injectFault(request); ok(injected.ok,`fault injects: ${JSON.stringify(injected.diagnostics)}`);
if(!injected.ok) process.exit(1);
eq(initial.resources.client1.properties.defaultGateway,"10.0.0.1","input engine state remains immutable");
ok(!Object.hasOwn(injected.state.resources.client1.properties,"defaultGateway"),"fault removes default gateway in returned state");
eq(injected.overlay.instances.length,1,"overlay records one instance");
eq(injected.overlay.instances[0].changedResources,["client1"],"blast radius records changed resource");
eq(await computeFaultOverlayIdentity(injected.overlay),injected.overlay.overlayIdentity,"overlay identity reproducible");
const overlayVerified=await verifyFaultOverlay(injected.overlay,scenario); ok(overlayVerified.ok,`overlay semantic verification passes: ${JSON.stringify(overlayVerified.diagnostics)}`);
const replay=await injectFault(request); ok(replay.ok,"same fault request replays"); if(replay.ok) eq(replay.overlay,injected.overlay,"deterministic same request produces byte-equivalent overlay object");
const rolled=await rollbackLatestFault(scenario,injected.state,injected.overlay); ok(rolled.ok,`latest fault rolls back: ${JSON.stringify(rolled.diagnostics)}`); if(rolled.ok){eq(rolled.state.resources,initial.resources,"rollback restores exact resource state");eq(rolled.overlay.instances.length,0,"rollback removes latest overlay instance");}

const choicePack=await finalizePack({formatId:"infrastructure-cyber-lab.fault-pack",schemaVersion:"0.1.0",packId:"test.choice",version:"0.1.0",domain:"test",packIdentity:"0".repeat(64),faults:[{faultId:"test.seeded_choice",version:"0.1.0",title:"Seeded choice",domain:"test",targetBindings:[{name:"target",resourceTypes:["*"]}],preconditions:[{op:"path_exists",binding:"target",path:"properties"}],incompatibilities:[],mutations:[{mutationId:"choice",op:"set",binding:"target",path:"properties.seeded",value:{kind:"choice",values:["a","b","c","d"]}}],expectedEffects:[{op:"path_exists",binding:"target",path:"properties.seeded"}],negativeControls:[],observableSymptoms:["seeded"],hiddenTruth:"seeded choice",recovery:{mode:"restore_pre_injection"},blastRadius:{maxChangedResources:1,allowedBindings:["target"]},visibilityPolicy:{student:"HIDDEN",instructor:"VISIBLE"},difficulty:{layers:1,dependencyDepth:0,evidenceVisibility:0,remediationConstraints:0},tags:["test"],learningObjectives:["determinism"]}]});
const c1=await injectFault({scenario,state:initial,pack:choicePack,faultId:"test.seeded_choice",bindings:{target:"client1"},seed:123,mode:"RUNTIME_INJECTION"});
const c2=await injectFault({scenario,state:initial,pack:choicePack,faultId:"test.seeded_choice",bindings:{target:"client1"},seed:123,mode:"RUNTIME_INJECTION"});
ok(c1.ok&&c2.ok,"seeded choice fault injects twice"); if(c1.ok&&c2.ok) eq(c1.state.resources.client1.properties.seeded,c2.state.resources.client1.properties.seeded,"same seed selects same value");

const multiPack=await finalizePack({formatId:"infrastructure-cyber-lab.fault-pack",schemaVersion:"0.1.0",packId:"test.multi",version:"0.1.0",domain:"test",packIdentity:"0".repeat(64),faults:[{faultId:"test.two_targets",version:"0.1.0",title:"Two targets",domain:"test",targetBindings:[{name:"left",resourceTypes:["*"]},{name:"right",resourceTypes:["*"]}],preconditions:[],incompatibilities:[],mutations:[{mutationId:"left_mark",op:"set",binding:"left",path:"properties.marker",value:{kind:"literal",value:"x"}},{mutationId:"right_mark",op:"set",binding:"right",path:"properties.marker",value:{kind:"literal",value:"x"}}],expectedEffects:[{op:"path_equals",binding:"left",path:"properties.marker",value:"x"},{op:"path_equals",binding:"right",path:"properties.marker",value:"x"}],negativeControls:[],observableSymptoms:["two"],hiddenTruth:"two resources",recovery:{mode:"restore_pre_injection"},blastRadius:{maxChangedResources:2,allowedBindings:["left","right"]},visibilityPolicy:{student:"HIDDEN",instructor:"VISIBLE"},difficulty:{layers:2,dependencyDepth:1,evidenceVisibility:1,remediationConstraints:0},tags:["test"],learningObjectives:["multi"]}]});
const multi=await injectFault({scenario,state:initial,pack:multiPack,faultId:"test.two_targets",bindings:{left:"client1",right:"router1"},seed:1,mode:"RUNTIME_INJECTION"}); ok(multi.ok,"multi-target fault injects"); if(multi.ok) eq(multi.overlay.instances[0].changedResources,["client1","router1"],"multi-target blast radius deterministic");

const variantInjection=await injectFault({...request,mode:"SCENARIO_VARIANT"}); ok(variantInjection.ok,"scenario-variant overlay can be generated");
if(variantInjection.ok){
 const before=structuredClone(source); const variant=materializeFaultedScenarioVariant(source,scenario,variantInjection.overlay,"fault_lab_variant"); ok(variant.ok,`variant materializes: ${JSON.stringify(variant.diagnostics)}`);
 if(variant.ok){ok(!Object.hasOwn(variant.source.resources.find(x=>x.id==="client1").properties,"defaultGateway"),"persistent variant materializes fault into author source");eq(variant.source.faultOrigin.baseScenarioHash,scenario.sourceHash,"variant binds base scenario hash");eq(variant.source.faultOrigin.overlayIdentity,variantInjection.overlay.overlayIdentity,"variant binds overlay identity");ok(variant.source.canonicalSolution.operations.some(x=>x.op==="set"&&x.path==="properties.defaultGateway"),"variant canonical solution contains captured recovery");}
 eq(source,before,"materialization does not mutate healthy source");
}
console.log(`PASS fault engine functional: ${checks} assertions.`);
