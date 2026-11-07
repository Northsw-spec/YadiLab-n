import assert from "node:assert/strict";
import {
  captureActiveProbeInNotebook,
  captureObservationInNotebook,
  createTroubleshootingNotebook,
  reviewTroubleshootingEvidence,
  runActiveProbe,
  runObservation,
} from "../../dist-observation-engine-test/observation-engine/src/index.js";
import { createInitialEngineState } from "../../dist-observation-engine-test/engine/src/index.js";
let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++}; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};
const scenario={formatId:"infrastructure-cyber-lab.scenario",schemaVersion:"0.1.0",scenarioId:"review_lab",sourceHash:"4".repeat(64),metadata:{title:"Review lab",description:"",language:"en",authors:[],tags:[],briefing:""},minimumEngineVersion:"0.8.0",capabilityLocks:[],profileLocks:[],assetLocks:[],zones:[],resources:[
{id:"win1",type:"windows.workstation",label:"Windows client",interfaces:[{id:"eth0",label:"Ethernet",addresses:["10.0.0.10/24"]}],properties:{defaultGateway:"10.0.0.1",dnsServers:["10.0.1.53"],dhcp:{enabled:true},aclDefaultAction:"allow"}},
{id:"r1",type:"network.router",label:"Router",interfaces:[{id:"lan",label:"LAN",addresses:["10.0.0.1/24","10.0.2.1/24"]}],properties:{routes:[{id:"to-app",destination:"app1",via:"app1",action:"forward",enabled:true}]}},
{id:"app1",type:"linux.server",label:"App",interfaces:[{id:"e0",label:"e0",addresses:["10.0.2.80/24"]}],properties:{http:{enabled:true,port:80,protocol:"tcp"}}}
],connections:[{id:"w-r",kind:"network",from:{resource:"win1"},to:{resource:"r1"},properties:{}},{id:"r-a",kind:"network",from:{resource:"r1"},to:{resource:"app1"},properties:{}}],tests:[],findings:[],objectives:[],troubleshootingObjectives:[
{id:"network_chain",title:"Prove interface then path",description:"Collect visible evidence only.",required:true,evidenceOrder:"ordered",requirements:[
{id:"iface",label:"Capture interface state",kind:"observation",category:"interface",targetId:"win1"},
{id:"ping",label:"Prove app reachability",kind:"active_probe",category:"connectivity",sourceId:"win1",destinationId:"app1",protocol:"icmp",truth:"TRUE"}
]},
{id:"service_optional",title:"Optional service check",required:false,evidenceOrder:"unordered",requirements:[
{id:"tcp80",label:"Test TCP 80",kind:"active_probe",category:"connectivity",sourceId:"win1",destinationId:"app1",protocol:"tcp",port:80,truth:"TRUE"}
]}
],completion:{op:"all",rules:[]},hints:[]};
const state=createInitialEngineState(scenario);
const obs=runObservation({state,targetId:"win1",commandId:"windows.ipconfig_all"});ok(obs.ok,"observation runs");if(!obs.ok)process.exit(1);
const ping=runActiveProbe({scenario,state,sourceId:"win1",probeId:"windows.ping",destinationId:"app1"});ok(ping.ok,"ping probe runs");if(!ping.ok)process.exit(1);
const tcp=runActiveProbe({scenario,state,sourceId:"win1",probeId:"windows.test_netconnection",destinationId:"app1",port:80});ok(tcp.ok,"tcp probe runs");if(!tcp.ok)process.exit(1);
let notebook=await createTroubleshootingNotebook(scenario.scenarioId,scenario.sourceHash);
let review=await reviewTroubleshootingEvidence(scenario,notebook);ok(review.ok,"empty notebook review succeeds");if(!review.ok||!review.review)process.exit(1);
eq(review.review.requiredEvidenceStatus,"PENDING","required evidence starts pending");eq(review.review.objectives[0].status,"PENDING","ordered objective starts pending");eq(review.review.objectives[0].requirements.map(x=>x.status),["PENDING","PENDING"],"requirements pending explicitly");eq(review.review.objectives[1].status,"PENDING","optional objective is visible but pending");ok(/^[0-9a-f]{64}$/.test(review.review.reviewIdentity),"review is content-addressed");
let added=await captureObservationInNotebook(notebook,obs.transcript);ok(added.ok,"capture interface evidence");notebook=added.notebook;review=await reviewTroubleshootingEvidence(scenario,notebook);ok(review.ok,"review after interface capture");eq(review.review.objectives[0].requirements[0].status,"SATISFIED","interface requirement satisfied");eq(review.review.objectives[0].requirements[0].matchedEntryId,"entry-0001","matched entry explicit");eq(review.review.objectives[0].requirements[1].status,"PENDING","ping still pending");eq(review.review.requiredEvidenceStatus,"PENDING","required chain not complete");
added=await captureActiveProbeInNotebook(notebook,ping.transcript);ok(added.ok,"capture ping evidence");notebook=added.notebook;review=await reviewTroubleshootingEvidence(scenario,notebook);ok(review.ok,"review after ordered chain");eq(review.review.objectives[0].status,"SATISFIED","ordered chain satisfied");eq(review.review.objectives[0].requirements[1].matchedEntryId,"entry-0002","second requirement binds second entry");eq(review.review.requiredEvidenceStatus,"SATISFIED","all required evidence satisfied despite optional pending");eq(review.review.objectives[1].status,"PENDING","optional evidence does not block required status");
const stable=await reviewTroubleshootingEvidence(scenario,notebook);eq(stable.review.reviewIdentity,review.review.reviewIdentity,"same scenario/notebook yields deterministic review identity");
added=await captureActiveProbeInNotebook(notebook,tcp.transcript);ok(added.ok,"capture optional tcp evidence");notebook=added.notebook;const complete=await reviewTroubleshootingEvidence(scenario,notebook);ok(complete.ok,"review with optional evidence succeeds");eq(complete.review.objectives[1].status,"SATISFIED","unordered optional objective satisfied");ok(complete.review.reviewIdentity!==review.review.reviewIdentity,"review identity changes when notebook changes");
const noObjectives={...scenario,troubleshootingObjectives:[]};const none=await reviewTroubleshootingEvidence(noObjectives,await createTroubleshootingNotebook(scenario.scenarioId,scenario.sourceHash));ok(none.ok,"empty objective set is valid");eq(none.review.requiredEvidenceStatus,"NOT_CONFIGURED","no required objective is explicit NOT_CONFIGURED");eq(none.review.objectives,[],"no hidden objectives invented");
const serialized=JSON.stringify(complete.review);for(const forbidden of ["faultOrigin","canonicalSolution","hiddenTruth","rootCause","score","grade"]){ok(!serialized.includes(forbidden),`review does not contain forbidden hidden/evaluative field ${forbidden}`);}
console.log(`PASS Troubleshooting Objectives / Evidence Review functional: ${checks} assertions.`);
