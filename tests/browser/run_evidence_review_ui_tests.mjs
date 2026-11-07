import assert from "node:assert/strict";
import fs from "node:fs";
import {
  applyTroubleshootingObjectivesAuthoring,
  buildBuilderAuthoringModel,
  captureRuntimeActiveProbeEvidence,
  captureRuntimeObservationEvidence,
  createBuilderWorkspace,
  previewRuntime,
  reviewRuntimeTroubleshootingEvidence,
  runRuntimeActiveProbe,
  runRuntimeObservation,
} from "../../dist-browser-test/ui/src/browser/index.js";
let pass=0;const ok=async(name,fn)=>{await fn();pass++;console.log(`PASS ${name}`);};
const source={formatId:"infrastructure-cyber-lab.scenario-source",schemaVersion:"0.1.0",scenarioId:"review_ui",metadata:{title:"Review UI",description:"",language:"en",authors:[],tags:[],briefing:""},requires:{capabilities:[],profiles:[]},zones:[],resources:[
{id:"win1",type:"windows.workstation",label:"Win",interfaces:[{id:"e0",label:"e0",addresses:["10.0.0.10/24"]}],properties:{defaultGateway:"10.0.0.1",dnsServers:[]}},
{id:"r1",type:"network.router",label:"Router",interfaces:[{id:"lan",label:"LAN",addresses:["10.0.0.1/24","10.0.2.1/24"]}],properties:{routes:[{id:"to-app",destination:"app1",via:"app1",action:"forward",enabled:true}]}},
{id:"app1",type:"linux.server",label:"App",interfaces:[{id:"e0",label:"e0",addresses:["10.0.2.80/24"]}],properties:{http:{enabled:true,port:80,protocol:"tcp"}}}
],connections:[{id:"w-r",kind:"network",from:{resource:"win1"},to:{resource:"r1"},properties:{}},{id:"r-a",kind:"network",from:{resource:"r1"},to:{resource:"app1"},properties:{}}],tests:[],findings:[],objectives:[],troubleshootingObjectives:[{id:"proof",title:"Prove interface then path",required:true,evidenceOrder:"ordered",requirements:[{id:"iface",label:"Interface state",kind:"observation",category:"interface",targetId:"win1"},{id:"ping",label:"Ping app",kind:"active_probe",sourceId:"win1",destinationId:"app1",protocol:"icmp",truth:"TRUE"}]}],completion:{op:"all",rules:[]},hints:[]};
const normalized={...source,formatId:"infrastructure-cyber-lab.scenario",sourceHash:"9".repeat(64),minimumEngineVersion:"0.8.0",capabilityLocks:[],profileLocks:[],assetLocks:[],resources:source.resources.map(r=>({...r,asset:{mode:"auto"}}))};
const builder={...createBuilderWorkspace(source),compile:{status:"valid",model:normalized,diagnostics:[]}};const p=previewRuntime(builder);assert.equal(p.ok,true);const runtime=p.workspace;
await ok("builder authoring exposes troubleshooting objectives JSON",async()=>{const model=buildBuilderAuthoringModel(createBuilderWorkspace(source));assert.ok(model.troubleshootingObjectivesJson.includes('"proof"'));const next=applyTroubleshootingObjectivesAuthoring(createBuilderWorkspace({...source,troubleshootingObjectives:[]}),model.troubleshootingObjectivesJson);assert.equal(next.ok,true);assert.deepEqual(next.workspace.source.troubleshootingObjectives,source.troubleshootingObjectives);});
await ok("runtime review can show pending requirements before notebook exists",async()=>{const r=await reviewRuntimeTroubleshootingEvidence(runtime,undefined);assert.equal(r.ok,true);assert.equal(r.review.requiredEvidenceStatus,"PENDING");assert.deepEqual(r.review.objectives[0].requirements.map(x=>x.status),["PENDING","PENDING"]);});
let notebook;
await ok("saved observation updates transparent review",async()=>{const obs=runRuntimeObservation(runtime,"win1","windows.ipconfig_all");assert.equal(obs.ok,true);const saved=await captureRuntimeObservationEvidence(runtime,undefined,obs.transcript);assert.equal(saved.ok,true);notebook=saved.notebook;const r=await reviewRuntimeTroubleshootingEvidence(runtime,notebook);assert.equal(r.ok,true);assert.equal(r.review.objectives[0].requirements[0].status,"SATISFIED");assert.equal(r.review.objectives[0].requirements[1].status,"PENDING");});
await ok("ordered probe evidence completes required review without score",async()=>{const probe=runRuntimeActiveProbe(runtime,{sourceId:"win1",probeId:"windows.ping",destinationId:"app1"});assert.equal(probe.ok,true);const saved=await captureRuntimeActiveProbeEvidence(runtime,notebook,probe.transcript);assert.equal(saved.ok,true);notebook=saved.notebook;const r=await reviewRuntimeTroubleshootingEvidence(runtime,notebook);assert.equal(r.ok,true);assert.equal(r.review.requiredEvidenceStatus,"SATISFIED");assert.equal(r.review.objectives[0].status,"SATISFIED");assert.equal(r.review.objectives[0].requirements[1].matchedEntryId,"entry-0002");assert.equal(Object.prototype.hasOwnProperty.call(r.review,"score"),false);});
await ok("review is deterministic for exact notebook identity",async()=>{const a=await reviewRuntimeTroubleshootingEvidence(runtime,notebook);const b=await reviewRuntimeTroubleshootingEvidence(runtime,notebook);assert.equal(a.ok,true);assert.equal(b.ok,true);assert.equal(a.review.reviewIdentity,b.review.reviewIdentity);assert.equal(a.review.notebookIdentity,notebook.notebookIdentity);});
await ok("browser source presents evidence review as notebook-only no-diagnosis workflow",async()=>{const main=fs.readFileSync("ui/app/main.mjs","utf8");assert.ok(main.includes('data-evidence-review'));assert.ok(main.includes("Review collected evidence"));assert.ok(main.includes("learner-visible evidence requirements"));assert.ok(main.includes("does not inspect hidden fault truth"));assert.ok(!main.includes("Evidence score:"));assert.ok(!main.includes("Grade troubleshooting"));});
console.log(`PASS Troubleshooting Objectives / Evidence Review UI functional: ${pass}/6 assertions.`);
