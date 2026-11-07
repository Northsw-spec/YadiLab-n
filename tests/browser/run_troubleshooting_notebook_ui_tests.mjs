import assert from "node:assert/strict";
import fs from "node:fs";
import {
  addRuntimeTroubleshootingNote,
  applyRuntimeOperation,
  buildRuntimeActiveProbeModel,
  buildRuntimeObservationModel,
  captureRuntimeActiveProbeEvidence,
  captureRuntimeObservationEvidence,
  createBuilderWorkspace,
  createTroubleshootingNotebookDownload,
  loadTroubleshootingNotebookFile,
  previewRuntime,
  runRuntimeActiveProbe,
  runRuntimeObservation,
} from "../../dist-browser-test/ui/src/browser/index.js";
let pass=0;const ok=async(name,fn)=>{await fn();pass++;console.log(`PASS ${name}`);};
const source={formatId:"infrastructure-cyber-lab.scenario-source",schemaVersion:"0.1.0",scenarioId:"notebook_ui",metadata:{title:"Notebook UI",description:"",language:"en",authors:[],tags:[],briefing:""},requires:{capabilities:[],profiles:[]},zones:[],resources:[
{id:"win1",type:"windows.workstation",label:"Win",interfaces:[{id:"e0",label:"e0",addresses:["10.0.0.10/24"]}],properties:{defaultGateway:"10.0.0.1",dnsServers:[]}},
{id:"r1",type:"network.router",label:"Router",interfaces:[{id:"lan",label:"LAN",addresses:["10.0.0.1/24","10.0.2.1/24"]}],properties:{routes:[{id:"to-app",destination:"app1",via:"app1",action:"forward",enabled:true}]}},
{id:"app1",type:"linux.server",label:"App",interfaces:[{id:"e0",label:"e0",addresses:["10.0.2.80/24"]}],properties:{http:{enabled:true,port:80,protocol:"tcp"}}}
],connections:[{id:"w-r",kind:"network",from:{resource:"win1"},to:{resource:"r1"},properties:{}},{id:"r-a",kind:"network",from:{resource:"r1"},to:{resource:"app1"},properties:{}}],tests:[],findings:[],objectives:[],completion:{op:"all",rules:[]},hints:[]};
const normalized={...source,formatId:"infrastructure-cyber-lab.scenario",sourceHash:"e".repeat(64),minimumEngineVersion:"0.8.0",capabilityLocks:[],profileLocks:[],assetLocks:[],resources:source.resources.map(r=>({...r,asset:{mode:"auto"}}))};
const builder={...createBuilderWorkspace(source),compile:{status:"valid",model:normalized,diagnostics:[]}};const p=previewRuntime(builder);assert.equal(p.ok,true);const runtime=p.workspace;
await ok("observation evidence can create notebook from Runtime",async()=>{const model=buildRuntimeObservationModel(runtime,"win1");const r=runRuntimeObservation(runtime,"win1",model.commands[0].commandId);assert.equal(r.ok,true);const saved=await captureRuntimeObservationEvidence(runtime,undefined,r.transcript);assert.equal(saved.ok,true);assert.equal(saved.notebook.entries.length,1);assert.equal(saved.notebook.entries[0].kind,"observation");assert.equal(saved.notebook.entries[0].stateRevision,0);});
let notebook;let obsTranscript;
await ok("observation and active probe append in exact user order",async()=>{const obs=runRuntimeObservation(runtime,"win1","windows.route_print");assert.equal(obs.ok,true);obsTranscript=obs.transcript;let saved=await captureRuntimeObservationEvidence(runtime,undefined,obs.transcript);assert.equal(saved.ok,true);notebook=saved.notebook;const probe=runRuntimeActiveProbe(runtime,{sourceId:"win1",probeId:"windows.ping",destinationId:"app1"});assert.equal(probe.ok,true);saved=await captureRuntimeActiveProbeEvidence(runtime,notebook,probe.transcript);assert.equal(saved.ok,true);notebook=saved.notebook;assert.deepEqual(notebook.entries.map(x=>x.kind),["observation","active_probe"]);assert.deepEqual(notebook.entries.map(x=>x.sequence),[1,2]);});
await ok("learner hypothesis is separate evidence-chain entry",async()=>{const saved=await addRuntimeTroubleshootingNote(runtime,notebook,"hypothesis","Path works; test the service next.");assert.equal(saved.ok,true);notebook=saved.notebook;assert.equal(notebook.entries[2].kind,"learner_note");assert.equal(notebook.entries[2].noteKind,"hypothesis");assert.equal(notebook.entries[2].stateRevision,0);});
await ok("stale transcript cannot be captured after Runtime revision changes",async()=>{const changed=applyRuntimeOperation(runtime,{op:"set",target:"win1",path:"properties.defaultGateway",value:"203.0.113.1"});assert.equal(changed.ok,true);const stale=await captureRuntimeObservationEvidence(changed.workspace,notebook,obsTranscript);assert.equal(stale.ok,false);assert.ok(stale.diagnostics.some(x=>x.code==="NOTEBOOK_UI_STALE_TRANSCRIPT"));});
await ok("portable notebook export is exact and scenario-bound",async()=>{const d=createTroubleshootingNotebookDownload(notebook);assert.equal(d.filename,"notebook_ui.yadinotebook");assert.equal(d.mime,"application/json");assert.deepEqual(JSON.parse(d.text),notebook);});
await ok("portable notebook import verifies schema callback and canonical identity",async()=>{let calls=0;const file={name:"notebook_ui.yadinotebook",text:async()=>JSON.stringify(notebook)};const loaded=await loadTroubleshootingNotebookFile(runtime,file,(input)=>{calls++;return{valid:input?.formatId==="infrastructure-cyber-lab.troubleshooting-notebook",diagnostics:[]};});assert.equal(loaded.ok,true);assert.deepEqual(loaded.notebook,notebook);assert.equal(calls,1);const tampered={...notebook,entries:[...notebook.entries,{...notebook.entries[2],entryId:"entry-0004",sequence:4,text:"tampered"}]};const bad=await loadTroubleshootingNotebookFile(runtime,{name:"bad.yadinotebook",text:async()=>JSON.stringify(tampered)},()=>({valid:true}));assert.equal(bad.ok,false);assert.ok(bad.diagnostics.some(x=>x.code==="NOTEBOOK_IDENTITY_MISMATCH"));});
await ok("browser UI exposes explicit learner-owned evidence notebook without diagnosis automation",async()=>{const main=fs.readFileSync("ui/app/main.mjs","utf8");assert.ok(main.includes('data-troubleshooting-notebook'));assert.ok(main.includes("Spara evidens i anteckningar"));assert.ok(main.includes("Add note to proof chain"));assert.ok(main.includes("Export notebook"));assert.ok(main.includes("Import notebook"));assert.ok(main.includes("never imports hidden fault truth or canonical solution material"));assert.ok(!main.includes("Auto-diagnose root cause"));});
console.log(`PASS Troubleshooting Session / Evidence Notebook UI functional: ${pass}/7 assertions.`);
