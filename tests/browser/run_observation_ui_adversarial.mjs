import assert from "node:assert/strict";
import { buildRuntimeObservationModel, createBuilderWorkspace, previewRuntime, runRuntimeObservation } from "../../dist-browser-test/ui/src/browser/index.js";

let pass=0;const ok=async(name,fn)=>{await fn();pass++;console.log(`PASS ${name}`);};
const source={formatId:"infrastructure-cyber-lab.scenario-source",schemaVersion:"0.1.0",scenarioId:"observation_ui_adv",metadata:{title:"Observation UI adv",description:"",language:"en",authors:[],tags:[],briefing:""},minimumEngineVersion:"0.8.0",capabilityLocks:[],profileLocks:[],assetLocks:[],zones:[],resources:[{id:"win",type:"windows.workstation",label:"Win",interfaces:[],properties:{rdp:{enabled:true,port:3389,protocol:"tcp"}}},{id:"lin",type:"linux.server",label:"Lin",interfaces:[],properties:{ssh:{enabled:true,port:22,protocol:"tcp"}}}],connections:[],tests:[],findings:[],objectives:[],completion:{op:"all",rules:[]},hints:[]};
const normalized={...source,formatId:"infrastructure-cyber-lab.scenario",sourceHash:"a".repeat(64),resources:source.resources.map(r=>({...r,asset:{mode:"auto"}}))};
const builder={...createBuilderWorkspace(source),compile:{status:"valid",model:normalized,diagnostics:[]}};const p=previewRuntime(builder);assert.equal(p.ok,true);const runtime=p.workspace;
await ok("Builder cannot execute Runtime observations",()=>{const r=runRuntimeObservation(builder,"win","windows.ipconfig_all");assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,"OBSERVATION_UI_RUNTIME_REQUIRED");});
await ok("Builder observation model is empty",()=>{assert.deepEqual(buildRuntimeObservationModel(builder),{targets:[],commands:[]});});
await ok("scenario/state mismatch fails closed",()=>{const bad={...runtime,engineState:{...runtime.engineState,scenarioHash:"b".repeat(64)}};const r=runRuntimeObservation(bad,"win","windows.ipconfig_all");assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,"OBSERVATION_UI_STATE_SCENARIO_MISMATCH");});
await ok("cross-OS command remains rejected through browser helper",()=>{const r=runRuntimeObservation(runtime,"win","linux.ip_addr");assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,"OBSERVATION_COMMAND_OS_MISMATCH");});
await ok("browser observation does not mutate workspace/history",()=>{const before=JSON.stringify(runtime);const r=runRuntimeObservation(runtime,"lin","linux.ss_listen");assert.equal(r.ok,true);assert.equal(JSON.stringify(runtime),before);});
await ok("unknown target fails closed through browser helper",()=>{const r=runRuntimeObservation(runtime,"ghost","windows.ipconfig_all");assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,"OBSERVATION_TARGET_NOT_FOUND");});
console.log(`PASS Diagnostic / Observation UI Wave 1 adversarial: ${pass}/6 assertions.`);
