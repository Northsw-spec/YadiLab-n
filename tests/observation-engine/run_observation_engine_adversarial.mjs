import assert from "node:assert/strict";
import { createInitialEngineState } from "../../dist-observation-engine-test/engine/src/index.js";
import { listObservationCommands, runObservation } from "../../dist-observation-engine-test/observation-engine/src/index.js";

let pass=0; const ok=async(name,fn)=>{await fn();pass+=1;console.log(`PASS ${name}`);};
const scenario={formatId:"infrastructure-cyber-lab.scenario",schemaVersion:"0.1.0",scenarioId:"observation_adversarial",sourceHash:"8".repeat(64),metadata:{title:"Observation adversarial",description:"",language:"en",authors:[],tags:[],briefing:""},minimumEngineVersion:"0.8.0",capabilityLocks:[],profileLocks:[],assetLocks:[],zones:[],resources:[
{id:"win",type:"windows.workstation",label:"Win",interfaces:[{id:"e0",label:"Ethernet",addresses:["10.0.0.2/24"]}],properties:{dnsServers:["10.0.0.53"],rdp:{enabled:true,port:3389,protocol:"tcp"}}},
{id:"lin",type:"linux.server",label:"Lin",interfaces:[],properties:{dnsServers:["10.0.0.53"],ssh:{enabled:true,port:22,protocol:"tcp"}}},
{id:"router",type:"network.router",label:"Router",interfaces:[],properties:{}}
],connections:[],tests:[],findings:[],objectives:[],completion:{op:"all",rules:[]},hints:[]};
const state=createInitialEngineState(scenario);
await ok("unknown target fails closed",()=>{const r=runObservation({state,targetId:"missing",commandId:"windows.ipconfig_all"});assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,"OBSERVATION_TARGET_NOT_FOUND");});
await ok("unsupported resource fails closed",()=>{const r=runObservation({state,targetId:"router",commandId:"windows.ipconfig_all"});assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,"OBSERVATION_TARGET_UNSUPPORTED");});
await ok("unknown command fails closed",()=>{const r=runObservation({state,targetId:"win",commandId:"windows.magic"});assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,"OBSERVATION_COMMAND_UNKNOWN");});
await ok("cross-OS command fails closed",()=>{const r=runObservation({state,targetId:"win",commandId:"linux.ip_addr"});assert.equal(r.ok,false);assert.equal(r.diagnostics[0].code,"OBSERVATION_COMMAND_OS_MISMATCH");});
await ok("observations do not mutate Engine state",()=>{const before=JSON.stringify(state);const r=runObservation({state,targetId:"win",commandId:"windows.ipconfig_all"});assert.equal(r.ok,true);assert.equal(JSON.stringify(state),before);});
await ok("same state produces byte-stable transcript",()=>{const a=runObservation({state,targetId:"win",commandId:"windows.ipconfig_all"});const b=runObservation({state,targetId:"win",commandId:"windows.ipconfig_all"});assert.deepEqual(a,b);});
await ok("missing modeled values are explicit, never invented",()=>{const r=runObservation({state,targetId:"win",commandId:"windows.route_print"});assert.equal(r.ok,true);assert.ok(r.transcript.lines.some(x=>x.includes("<not modeled>")));assert.ok(r.transcript.evidence.some(x=>x.path==="properties.defaultGateway"&&x.state==="ABSENT"));});
await ok("malformed modeled values are warnings not fabricated output",()=>{const bad={...state,resources:{...state.resources,win:{...state.resources.win,properties:{...state.resources.win.properties,dnsServers:"8.8.8.8"}}}};const r=runObservation({state:bad,targetId:"win",commandId:"windows.ipconfig_all"});assert.equal(r.ok,true);assert.ok(r.transcript.lines.some(x=>x.includes("<malformed modeled value>")));assert.ok(r.diagnostics.some(x=>x.code==="OBSERVATION_VALUE_MALFORMED"));});
await ok("catalog is target scoped and deterministic",()=>{const a=listObservationCommands(state,"lin");const b=listObservationCommands(state,"lin");assert.deepEqual(a,b);assert.equal(a.length,7);assert.ok(a.every(x=>x.commandId.startsWith("linux.")));});
await ok("transcript never claims guest execution",()=>{const r=runObservation({state,targetId:"lin",commandId:"linux.ss_listen"});assert.equal(r.ok,true);assert.equal(r.transcript.modeled,true);assert.equal(r.transcript.boundary,"NO_GUEST_COMMAND_EXECUTION");assert.ok(r.transcript.lines[0].includes("no Linux guest command executed"));});
await ok("transcript contains no hidden fault ground truth channel",()=>{const r=runObservation({state,targetId:"win",commandId:"windows.get_service"});assert.equal(r.ok,true);const raw=JSON.stringify(r);assert.ok(!raw.includes("hiddenTruth"));assert.ok(!raw.includes("faultOrigin"));assert.ok(!raw.includes("canonicalSolution"));});
console.log(`PASS Diagnostic / Observation Engine Wave 1 adversarial: ${pass}/11 assertions.`);
