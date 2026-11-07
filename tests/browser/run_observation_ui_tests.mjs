import assert from "node:assert/strict";
import fs from "node:fs";
import {
  applyRuntimeOperation,
  buildRuntimeObservationModel,
  createBuilderWorkspace,
  previewRuntime,
  runRuntimeObservation,
  setRuntimeSelection,
} from "../../dist-browser-test/ui/src/browser/index.js";

let pass=0;const ok=async(name,fn)=>{await fn();pass++;console.log(`PASS ${name}`);};
const source={formatId:"infrastructure-cyber-lab.scenario-source",schemaVersion:"0.1.0",scenarioId:"observation_ui",metadata:{title:"Observation UI",description:"",language:"en",authors:[],tags:[],briefing:""},minimumEngineVersion:"0.8.0",capabilityLocks:[],profileLocks:[],assetLocks:[],zones:[],resources:[
{id:"win1",type:"windows.workstation",label:"Windows 1",interfaces:[{id:"eth0",label:"Ethernet",addresses:["10.0.0.10/24"]}],properties:{defaultGateway:"10.0.0.1",dnsServers:["10.0.0.53"],dhcp:{enabled:true},rdp:{enabled:true,port:3389,protocol:"tcp"}}},
{id:"linux1",type:"linux.server",label:"Linux 1",interfaces:[{id:"eth0",label:"eth0",addresses:["10.0.0.20/24"]}],properties:{defaultGateway:"10.0.0.1",dnsServers:["10.0.0.53"],dhcp:{enabled:true},ssh:{enabled:true,port:22,protocol:"tcp"},networkManager:{enabled:true},systemdResolved:{enabled:true}}}
],connections:[],tests:[],findings:[],objectives:[],completion:{op:"all",rules:[]},hints:[]};
const normalized={...source,formatId:"infrastructure-cyber-lab.scenario",sourceHash:"9".repeat(64),resources:source.resources.map(r=>({...r,asset:{mode:"auto"}}))};
const builder={...createBuilderWorkspace(source),compile:{status:"valid",model:normalized,diagnostics:[]}};
const preview=previewRuntime(builder);assert.equal(preview.ok,true);const runtime=preview.workspace;

await ok("runtime observation model lists exact OS targets and commands",()=>{const model=buildRuntimeObservationModel(runtime);assert.deepEqual(model.targets.map(x=>x.id),["linux1","win1"]);assert.equal(model.commands.length,7);});
await ok("Runtime selection drives preferred observation target",()=>{const selected=setRuntimeSelection(runtime,["win1"],"win1");const model=buildRuntimeObservationModel(selected);assert.equal(model.targetId,"win1");assert.ok(model.commands.every(x=>x.commandId.startsWith("windows.")));});
await ok("modeled observation runs through browser helper",()=>{const result=runRuntimeObservation(runtime,"win1","windows.ipconfig_all");assert.equal(result.ok,true);assert.equal(result.transcript.stateRevision,0);assert.ok(result.transcript.lines.join("\n").includes("10.0.0.10/24"));assert.equal(result.transcript.boundary,"NO_GUEST_COMMAND_EXECUTION");});
await ok("observation follows current Runtime revision",()=>{const changed=applyRuntimeOperation(runtime,{op:"set",target:"win1",path:"properties.defaultGateway",value:"198.51.100.1"});assert.equal(changed.ok,true);const result=runRuntimeObservation(changed.workspace,"win1","windows.route_print");assert.equal(result.ok,true);assert.equal(result.transcript.stateRevision,1);assert.ok(result.transcript.lines.join("\n").includes("198.51.100.1"));});
await ok("browser UI exposes explicit modeled observation panel",()=>{const main=fs.readFileSync("ui/app/main.mjs","utf8");assert.ok(main.includes('data-observation-engine'));assert.ok(main.includes('"Diagnostik / observationsmotor"'));assert.ok(main.includes('"Kör modellerad observation"'));assert.ok(main.includes("inget gäst-OS-, PowerShell-, shell-, systemctl- eller kärnkommando körs"));});
await ok("browser UI exposes direct evidence without hidden truth wording",()=>{const main=fs.readFileSync("ui/app/main.mjs","utf8");assert.ok(main.includes("Direkt modellerad evidens"));assert.ok(main.includes("NO_GUEST_COMMAND_EXECUTION")===false,"boundary is read from transcript rather than hardcoded as a fake status");});
console.log(`PASS Diagnostic / Observation UI Wave 1 functional: ${pass}/6 assertions.`);
