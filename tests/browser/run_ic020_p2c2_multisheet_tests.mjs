import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import sourceSchema from "../../schema/scenario-source.schema.json" with { type:"json" };
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with { type:"json" };
import catalog from "../../catalog/builtin-catalog.json" with { type:"json" };
import { ENGINE_VERSION } from "../../dist-browser-test/engine/src/index.js";
import { previewNetworkTopologyFile, verifyNetworkTopologyOriginalForActivation }
  from "../../dist-browser-test/ui/src/browser/network-topology-import.js";
import { selectEnterpriseImportAdapter, mapNetworkWorkbookToScenario }
  from "../../dist-browser-test/enterprise-import/src/index.js";
import { compileBuilderWorkspace,createBuilderWorkspace,previewRuntime }
  from "../../dist-browser-test/ui/src/browser/index.js";
import {buildRuntimeActiveProbeModel,runRuntimeActiveProbe}
  from "../../dist-browser-test/ui/src/browser/observations.js";
import {runActiveProbe} from "../../dist-browser-test/observation-engine/src/index.js";
import {createInitialEngineState} from "../../dist-browser-test/engine/src/index.js";
import {udpIcmpScenario,server} from "../fixtures/phase97.mjs";

let assertions=0;
const eq=(x,y,name)=>{assert.deepEqual(x,y,name);assertions++};
const ok=(x,name)=>{assert.ok(x,name);assertions++};
const expectReject=async(t,code)=>{await assert.rejects(t,e=>e?.message===code||e?.code===code,code);assertions++};
const sha=x=>crypto.createHash("sha256").update(x).digest("hex");
const file=(name,bytes)=>({name,size:bytes.length,async arrayBuffer(){
 return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
}});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ic020-p2c2-"));
execFileSync("python3",["tests/fixtures/import/generate_ic020_p2c2_workbooks.py","--out-dir",dir],
 {stdio:["ignore","pipe","pipe"],timeout:15000});
const expectedIds=["rtr01","sw01","sw02","win01","win02","lin01","lin02","unknown01"];
const expectedLinks=[
 ["rtr01","lan0","sw01","uplink0"],
 ["sw01","port1","sw02","uplink0"],
 ["sw01","port2","win01","eth0"],
 ["sw01","port3","win02","eth0"],
 ["sw02","port1","lin01","eth0"],
 ["sw02","port2","lin02","eth0"],
];
const expectedSheets=["Metadata","Zones","Nodes","Interfaces","Links","Layout"];
const ajv=new Ajv2020({strict:true,allErrors:true,allowUnionTypes:false,validateSchema:true});
const sourceValidate=ajv.compile(sourceSchema),normalizedValidate=ajv.compile(normalizedSchema);
const options={compilerContext:{
 validateSource:x=>({valid:!!sourceValidate(x),diagnostics:(sourceValidate.errors??[]).map(e=>e.message)}),
 validateNormalized:x=>({valid:!!normalizedValidate(x),diagnostics:(normalizedValidate.errors??[]).map(e=>e.message)}),
 catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},
 engineBaselineVersion:ENGINE_VERSION,
}};
const accepted={};
for(const format of ["xlsx","ods"]){
 const load=variant=>new Uint8Array(fs.readFileSync(path.join(dir,"ic020-p2c2-"+variant+"."+format)));
 const original=load("valid");
 const sourceFile=file("enterprise."+format,original);
 const result=await previewNetworkTopologyFile(sourceFile);
 eq(result.ok,true,"Actual 6-tab "+format+" producer accepts realistic workbook "+JSON.stringify(result.diagnostics));
 eq(result.sheets,expectedSheets,"Exact six producer-detected sheets");
 eq(result.sourceSha256,sha(original),"Original entire ZIP SHA matches expected");
 eq(result.sourceByteSize,original.byteLength,"Entire ZIP byte count");
 eq(result.filename,"enterprise."+format);
 eq(result.devices,8,"Only declared eight devices");
 eq(result.links,6,"Only six declared physical links");
 eq(result.source.scenarioId,"imported_network");
 eq(result.source.resources.map(x=>x.id),expectedIds);
 eq(result.source.connections.map(x=>[
   x.from.resource,x.from.port,x.to.resource,x.to.port,
 ]),expectedLinks,"Link endpoints and port identities are source-bound");
 const win=result.source.resources.find(x=>x.id==="win01");
 const lin=result.source.resources.find(x=>x.id==="lin01");
 const unnamed=result.source.resources.find(x=>x.id==="unknown01");
 eq(win.type,"endpoint.windows","Windows type is explicit, not guessed");
 eq(lin.type,"endpoint.linux");
 eq(unnamed.type,"resource.generic","Undocumented endpoint is not granted OS/probe eligibility");
 eq(unnamed.interfaces,undefined,"Undocumented interface remains UNKNOWN");
 eq(result.source.zones.length,3);
 eq(result.source.layoutHints.length,8);
 eq(result.source.notes.length,4,"Only four explicitly recorded gateway notes, never edges");
 ok(!result.source.connections.some(x=>x.from.resource==="unknown01"||x.to.resource==="unknown01"),
   "Partial unknown resource not connected by gateway/IP inference");
 ok(result.source.resources.filter(x=>x.interfaces).every(x=>x.interfaces.every(i=>i.id)),
   "Every imported port has an independently declared source ID");
 await verifyNetworkTopologyOriginalForActivation(sourceFile,result,()=>true);
 const compiled=await compileBuilderWorkspace(createBuilderWorkspace(result.source),options);
 eq(compiled.compile.status,"valid","Workbook produces valid Builder "+format);
 const runtime=previewRuntime(compiled);
 eq(runtime.ok,true,"Workbook enters modeled Runtime "+format);
 const model=buildRuntimeActiveProbeModel(runtime.workspace);
 eq(model.sources.some(x=>x.id==="unknown01"),false,"Unknown resource not an OS source");
 ok(model.sources.some(x=>x.id==="win01"&&x.os==="windows"));
 ok(model.sources.some(x=>x.id==="lin01"&&x.os==="linux"));
 for(const osName of ["windows","linux"]){
   const from=model.sources.find(x=>x.os===osName);
   const scoped=buildRuntimeActiveProbeModel(runtime.workspace,from?.id);
   const probe=scoped.probes.find(x=>x.probeId===osName+".ping");
   const dest=scoped.destinations.find(x=>x.id==="rtr01");
   ok(Boolean(from&&probe&&dest),"OS-specific modeled probe source/probe/target exists");
   const before=JSON.stringify(runtime.workspace.engineState);
   const response=runRuntimeActiveProbe(runtime.workspace,{
     sourceId:from.id,probeId:probe.probeId,destinationId:dest.id,
   });
   eq(response.ok,true,"Existing Engine accepts "+format+" "+osName+" modeled probe");
   eq(response.transcript.modeled,true);
   eq(response.transcript.boundary,"NO_GUEST_COMMAND_EXECUTION");
   eq(response.transcript.scenarioHash,runtime.workspace.scenario.sourceHash);
   ok(["TRUE","FALSE","UNKNOWN"].includes(response.transcript.truth),"Engine owns outcome and unknown");
   eq(JSON.stringify(runtime.workspace.engineState),before,"Modeled probe does not mutate Engine");
 }
 const parsed=await selectEnterpriseImportAdapter(format==="xlsx"
     ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
     : "application/vnd.oasis.opendocument.spreadsheet")
   .parse({bytes:original,mediaType:format==="xlsx"
     ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
     : "application/vnd.oasis.opendocument.spreadsheet"},{options:{tableName:"Devices"}});
 eq(parsed.document.tables.map(x=>x.tableId),expectedSheets);
 eq(parsed.document.tables.find(x=>x.tableId==="Interfaces").records.length,12);
 // Port-free explicit graph edges remain legal even without any Interfaces sheet.
 const shallow={tables:parsed.document.tables.map(t=>{
   if(t.tableId==="Links")return {...t,records:t.records.map(row=>({
     ...row,fields:Object.fromEntries(Object.entries(row.fields).filter(([k])=>k!=="interfaceA"&&k!=="interfaceB"))
   }))};
   if(t.tableId==="Interfaces")return {...t,records:[]};
   return t;
 })};
 eq(mapNetworkWorkbookToScenario(shallow).ok,true,"Port-free existing explicit link path remains supported");
 // Same port name on different devices is not duplicate within one device.
 const portIds=parsed.document.tables.find(x=>x.tableId==="Interfaces").records;
 ok(portIds.filter(x=>x.fields.interfaceId.value==="eth0").length>=4,
    "Shared name eth0 permitted on distinct nodes");
 for(const [variant,expectedCode] of [
   ["missing-port","WORKBOOK_LINK_PORT_UNKNOWN"],
   ["duplicate-interface","WORKBOOK_DUPLICATE_INTERFACE_ID"],
   ["missing-node","WORKBOOK_LINK_ENDPOINT_UNKNOWN"],
 ]){
   const badBytes=load(variant),badFile=file("invalid."+format,badBytes);
   const rejected=await previewNetworkTopologyFile(badFile);
   eq(rejected.ok,false,variant+" cannot create Builder");
   eq(Boolean(rejected.source),false,"Blocked preview has no ScenarioSource");
   ok(rejected.diagnostics.some(x=>x.code===expectedCode&&x.severity==="error"),expectedCode);
   await expectReject(verifyNetworkTopologyOriginalForActivation(badFile,rejected,()=>true),
     "IC020_P1_SOURCE_CHANGED");
   // Rejects a cross-file replay with identical extension but changed ZIP.
   await expectReject(verifyNetworkTopologyOriginalForActivation(
     file("enterprise."+format,badBytes),result,()=>true),"IC020_P1_SOURCE_CHANGED");
 }
 await expectReject(verifyNetworkTopologyOriginalForActivation(sourceFile,result,()=>false),
   "IC020_P1_STALE");
 accepted[format]={sha:sha(original),bytes:original.length,source:result.source};
}
// Same independent 8/6-source oracle for two actual archive producers.
eq(accepted.xlsx.source.resources,accepted.ods.source.resources,"XLSX and ODS no semantic divergence");
eq(accepted.xlsx.source.connections,accepted.ods.source.connections);
eq(accepted.xlsx.source.zones,accepted.ods.source.zones);
eq(accepted.xlsx.source.layoutHints,accepted.ods.source.layoutHints);
ok(accepted.xlsx.sha!==accepted.ods.sha,"Original ZIP SHA tracks actual producer bytes not normalized graph");

// Existing Engine truth test fixtures have **explicit** route/listener data.
// Compare Engine verdicts; no spreadsheet field can upgrade that truth.
for(const osName of ["windows","linux"]){
 const positive=udpIcmpScenario(osName);
 const query=scenario=>runActiveProbe({scenario,state:createInitialEngineState(scenario),
   sourceId:"client",destinationId:"server",probeId:osName+".udp_delivery",port:5300});
 const delivered=query(positive);
 eq(delivered.ok,true);
 eq(delivered.transcript.udpIcmpFailureDecision.disposition,"DATAGRAM_DELIVERABLE",
   "Explicit full host/port snapshot is a positive reachability proof");
 eq(delivered.transcript.boundary,"NO_GUEST_COMMAND_EXECUTION");
 const noListener=structuredClone(positive);
 server(noListener).properties.hostStack.sockets=[];
 eq(query(noListener).transcript.udpIcmpFailureDecision.disposition,"NO_LISTENER",
   "Explicit absent listener gives separate failure disposition");
 const incomplete=structuredClone(noListener);
 server(incomplete).properties.hostStack.complete=false;
 eq(query(incomplete).transcript.udpIcmpFailureDecision.disposition,"SNAPSHOT_INCOMPLETE",
   "Missing evidence is not converted to a fabricated unreachable state");
 const noRoute=structuredClone(positive);
 server(noRoute).interfaces[0].addresses=["10.98.0.20/24"];
 eq(query(noRoute).transcript.truth,"FALSE","Known missing modeled gateway path is FALSE");
 const unknown=structuredClone(noRoute);
 unknown.resources[0].properties.defaultGateway="invalid";
 eq(query(unknown).transcript.truth,"UNKNOWN","Undocumented/invalid route must be UNKNOWN");
}
const app=fs.readFileSync("ui/app/main.mjs","utf8");
ok(app.includes('accept: ".json,.xlsx,.ods,.csv,.tsv"'),"Existing five-format picker preserved");
ok(app.includes("verifyNetworkTopologyOriginalForActivation(original, preview, isCurrent)"),
 "Existing last-moment original SHA reread retained");
console.log("PASS IC-020 P2c2 realistic six-sheet XLSX/ODS and typed port/Engine truth: "+
  assertions+" independent graph, original SHA, alias, stale, missing/duplicate port and modeled probe assertions.");
