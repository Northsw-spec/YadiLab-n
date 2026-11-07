import assert from "node:assert/strict";
import fs from "node:fs";
import {
  applyRuntimeOperation,
  buildRuntimeActiveProbeModel,
  createBuilderWorkspace,
  previewRuntime,
  runRuntimeActiveProbe,
  setRuntimeSelection,
} from "../../dist-browser-test/ui/src/browser/index.js";
let pass=0;const ok=async(name,fn)=>{await fn();pass++;console.log(`PASS ${name}`);};
const resources=[
{id:"win1",type:"windows.workstation",label:"Windows 1",interfaces:[{id:"eth0",label:"Ethernet",addresses:["10.0.0.10/24"]}],properties:{defaultGateway:"10.0.0.1",dnsServers:["10.0.1.53"]}},
{id:"linux1",type:"linux.workstation",label:"Linux 1",interfaces:[{id:"eth0",label:"eth0",addresses:["10.0.0.20/24"]}],properties:{defaultGateway:"10.0.0.1",dnsServers:["10.0.1.53"]}},
{id:"r1",type:"network.router",label:"Router",interfaces:[{id:"lan",label:"LAN",addresses:["10.0.0.1/24","10.0.1.1/24","10.0.2.1/24"]}],properties:{routes:[{id:"to-app",destination:"app1",via:"app1",action:"forward",enabled:true},{id:"to-dns",destination:"dns1",via:"dns1",action:"forward",enabled:true}]}},
{id:"dns1",type:"network.dns_server",label:"DNS",interfaces:[{id:"e0",label:"e0",addresses:["10.0.1.53/24"]}],properties:{dns:{enabled:true,records:[{name:"app.lab.test",address:"10.0.2.80"}]}}},
{id:"app1",type:"linux.server",label:"App",interfaces:[{id:"e0",label:"e0",addresses:["10.0.2.80/24"]}],properties:{http:{enabled:true,port:80,protocol:"tcp"}}},
];
const connections=[
{id:"w-r",kind:"network",from:{resource:"win1"},to:{resource:"r1"},properties:{}},
{id:"l-r",kind:"network",from:{resource:"linux1"},to:{resource:"r1"},properties:{}},
{id:"r-d",kind:"network",from:{resource:"r1"},to:{resource:"dns1"},properties:{}},
{id:"r-a",kind:"network",from:{resource:"r1"},to:{resource:"app1"},properties:{}},
];
const source={formatId:"infrastructure-cyber-lab.scenario-source",schemaVersion:"0.1.0",scenarioId:"active_probe_ui",metadata:{title:"Active probe UI",description:"",language:"en",authors:[],tags:[],briefing:""},minimumEngineVersion:"0.8.0",capabilityLocks:[],profileLocks:[],assetLocks:[],zones:[],resources,connections,tests:[],findings:[],objectives:[],completion:{op:"all",rules:[]},hints:[]};
const normalized={...source,formatId:"infrastructure-cyber-lab.scenario",sourceHash:"d".repeat(64),resources:source.resources.map(r=>({...r,asset:{mode:"auto"}}))};
const builder={...createBuilderWorkspace(source),compile:{status:"valid",model:normalized,diagnostics:[]}};const p=previewRuntime(builder);assert.equal(p.ok,true);const runtime=p.workspace;
await ok("active-probe model lists exact source-scoped probes",()=>{const model=buildRuntimeActiveProbeModel(runtime,"win1");assert.equal(model.sourceId,"win1");assert.equal(model.probes.length,6);assert.ok(model.probes.some(x=>x.probeId === "windows.udp_delivery"));assert.ok(model.probes.every(x=>x.probeId.startsWith("windows.")));assert.deepEqual(model.destinations.map(x=>x.id),["app1","dns1","linux1","r1"]);});
await ok("Runtime selection drives active-probe source",()=>{const selected=setRuntimeSelection(runtime,["linux1"],"linux1");const model=buildRuntimeActiveProbeModel(selected);assert.equal(model.sourceId,"linux1");assert.ok(model.probes.every(x=>x.probeId.startsWith("linux.")));});
await ok("browser helper runs modeled ping with path",()=>{const r=runRuntimeActiveProbe(runtime,{sourceId:"win1",probeId:"windows.ping",destinationId:"app1"});assert.equal(r.ok,true);assert.equal(r.transcript.truth,"TRUE");assert.deepEqual(r.transcript.path,["win1","r1","app1"]);assert.equal(r.transcript.stateRevision,0);});
await ok("browser helper runs modeled DNS resolution",()=>{const r=runRuntimeActiveProbe(runtime,{sourceId:"win1",probeId:"windows.resolve_dnsname",queryName:"app.lab.test"});assert.equal(r.ok,true);assert.equal(r.transcript.truth,"TRUE");assert.equal(r.transcript.resolvedAddress,"10.0.2.80");assert.deepEqual(r.transcript.resolvedResourceIds,["app1"]);});
await ok("browser helper runs no-destination modeled DHCP probe",()=>{const r=runRuntimeActiveProbe(runtime,{sourceId:"win1",probeId:"windows.ipconfig_renew"});assert.equal(r.ok,true);assert.equal(r.transcript.category,"dhcp");assert.equal(r.transcript.destinationId,undefined);assert.equal(r.transcript.dhcpDoraDecision?.clientId,"win1");assert.equal(r.transcript.truth,"UNKNOWN");});
await ok("active probe follows current Runtime revision and gateway fault-like state",()=>{const changed=applyRuntimeOperation(runtime,{op:"set",target:"win1",path:"properties.defaultGateway",value:"203.0.113.1"});assert.equal(changed.ok,true);const r=runRuntimeActiveProbe(changed.workspace,{sourceId:"win1",probeId:"windows.ping",destinationId:"app1"});assert.equal(r.ok,true);assert.equal(r.transcript.stateRevision,1);assert.equal(r.transcript.truth,"FALSE");assert.equal(r.transcript.blockingPoint,"win1");});
await ok("browser UI exposes Wave-2 active probe panel and boundary",()=>{const main=fs.readFileSync("ui/app/main.mjs","utf8");assert.ok(main.includes('data-active-probe-engine'));assert.ok(main.includes('"Modellerade aktiva prober"'));assert.ok(main.includes('"Kör modellerad aktiv probe"'));assert.ok(main.includes("inget gästkommando, paket, socket, DNS-anrop eller DHCP-utbyte körs"));assert.ok(main.includes("probe.argumentKind === \"none\"")||main.includes("argumentKind === \"destination\""));});
await ok("browser active probe transcript exposes direct evidence and verdict",()=>{const main=fs.readFileSync("ui/app/main.mjs","utf8");assert.ok(main.includes('data-active-probe-transcript'));assert.ok(main.includes("verdict ${transcript.truth}"));assert.ok(main.includes("item.kind"));assert.ok(main.includes("item.subject"));});
console.log(`PASS Diagnostic / Observation UI Wave 2 active probes functional: ${pass}/8 assertions.`);
