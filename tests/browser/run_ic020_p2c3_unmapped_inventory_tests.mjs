import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import sourceSchema from "../../schema/scenario-source.schema.json" with {type:"json"};
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with {type:"json"};
import catalog from "../../catalog/builtin-catalog.json" with {type:"json"};
import { ENGINE_VERSION } from "../../dist-browser-test/engine/src/index.js";
import { previewNetworkTopologyFile, verifyNetworkTopologyOriginalForActivation }
  from "../../dist-browser-test/ui/src/browser/network-topology-import.js";
import { compileBuilderWorkspace, createBuilderWorkspace, previewRuntime }
  from "../../dist-browser-test/ui/src/browser/index.js";
import { buildRuntimeActiveProbeModel, runRuntimeActiveProbe }
  from "../../dist-browser-test/ui/src/browser/observations.js";
import { builtinEnterpriseImportAdapters } from "../../dist-browser-test/enterprise-import/src/adapters.js";

let assertions=0;
const eq=(x,y,label)=>{assert.deepEqual(x,y,label);assertions++};
const yes=(x,label)=>{assert.ok(x,label);assertions++};
const reject=async(fn,code)=>{await assert.rejects(fn,e=>e?.message===code||e?.code===code,code);assertions++};
const bytes=x=>new TextEncoder().encode(x);
const sha=x=>crypto.createHash("sha256").update(x).digest("hex");
const file=(name,data)=>({name,size:data.byteLength,async arrayBuffer(){
  return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
}});
// CI source gate: Python parse only, no pycache/side-effect artifacts.
execFileSync("python3",["-c",
 "import ast,pathlib; ast.parse(pathlib.Path('tests/acceptance/run_ic020_p2c3_unmapped_real_browser.py').read_text(encoding='utf-8'))"],
 {stdio:["ignore","pipe","pipe"],timeout:8000});
assertions++;
const SECRET="SYNTHETIC_PRIVATE_UNMAPPED_COLUMN_4783_NOT_REAL";
const nodes=[
 {"Asset ID":"rtr01","Hostname":"Router","Device Type":"Router","IP Address":"10.7.0.1",
  "Connected To":"","Private Token":SECRET,"Cost Centre":"Operations","Blank Evidence":"",
  "Null Note":null},
 {"Asset ID":"sw01","Hostname":"Switch","Device Type":"Switch","IP Address":"10.7.0.2",
  "Connected To":"rtr01","Private-Token":SECRET,"Cost Centre":"Operations","Blank Evidence":"  "},
 {"Asset ID":"win01","Hostname":"Windows Host","Device Type":"Windows","IP Address":"10.7.0.20",
  "Connected To":"sw01","Private Token":SECRET,"Cost Centre":"","Blank Evidence":""},
];
const original=bytes(JSON.stringify({Devices:nodes}));
const p=await previewNetworkTopologyFile(file("unmapped.json",original));
eq(p.ok,true,"Valid JSON source with unknown optional fields still works");
eq(p.sourceSha256,sha(original),"Entire original JSON file SHA, not normalized projection");
eq(p.unmappedColumnCount,2,"Two populated distinct unsupported column names, aliases deduped");
eq(p.devices,3);
eq(p.links,2);
eq(p.source?.resources.map(x=>x.id),["rtr01","sw01","win01"]);
eq(p.source?.connections.map(x=>[x.from.resource,x.to.resource]),
 [["sw01","rtr01"],["win01","sw01"]],"No added links from private columns or IPv4");
yes(p.diagnostics.some(x=>x.code==="NETWORK_IMPORT_COLUMNS_UNMAPPED"&&x.severity==="warning"),
 "Fixed nonblocking warning shown for unsupported values");
yes(!JSON.stringify(p).includes(SECRET),"No source private token in projection, diagnostics or metadata");
yes(!JSON.stringify(p).includes("Private Token"),"Raw unmapped column name not included in preview");
yes(!JSON.stringify(p).includes("Cost Centre"),"Source header never disclosed to preview");
await verifyNetworkTopologyOriginalForActivation(file("unmapped.json",original),p,()=>true);
await reject(verifyNetworkTopologyOriginalForActivation(file("unmapped.json",original),
 {...p,unmappedColumnCount:0},()=>true),"IC020_P1_SOURCE_CHANGED");
await reject(verifyNetworkTopologyOriginalForActivation(file("unmapped.json",original),p,
 ()=>false),"IC020_P1_STALE");
const altered=bytes(new TextDecoder().decode(original).replaceAll(SECRET,"SYNTHETIC_PRIVATE_UNMAPPED_COLUMN_4784_NOT_REAL"));
eq(altered.byteLength,original.byteLength,"Same-length canary substitution");
await reject(verifyNetworkTopologyOriginalForActivation(file("unmapped.json",altered),p,
 ()=>true),"IC020_P1_SOURCE_CHANGED");

const ajv=new Ajv2020({strict:true,allErrors:true,allowUnionTypes:false,validateSchema:true});
const validateSource=ajv.compile(sourceSchema),validateNormalized=ajv.compile(normalizedSchema);
const options={compilerContext:{
 validateSource:x=>({valid:!!validateSource(x),diagnostics:(validateSource.errors??[]).map(e=>e.message)}),
 validateNormalized:x=>({valid:!!validateNormalized(x),diagnostics:(validateNormalized.errors??[]).map(e=>e.message)}),
 catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},
 engineBaselineVersion:ENGINE_VERSION,
}};
const builder=await compileBuilderWorkspace(createBuilderWorkspace(p.source),options);
eq(builder.compile.status,"valid","Unmapped fields do not inhibit safe explicit declared topology");
const runtime=previewRuntime(builder);
eq(runtime.ok,true,"Canonical copied source compiles into modeled Runtime");
const model=buildRuntimeActiveProbeModel(runtime.workspace);
const windows=model.sources.find(x=>x.id==="win01"&&x.os==="windows");
yes(windows,"OS comes from explicit device role, not unmapped column");
const ping=model.probes.find(x=>x.probeId==="windows.ping");
const dest=model.destinations.find(x=>x.id==="rtr01");
yes(Boolean(ping&&dest),"Existing Engine supports explicitly declared Windows probe");
const res=runRuntimeActiveProbe(runtime.workspace,{
 sourceId:windows.id,probeId:ping.probeId,destinationId:dest.id,
});
eq(res.ok,true);
eq(res.transcript.modeled,true);
eq(res.transcript.boundary,"NO_GUEST_COMMAND_EXECUTION");
yes(["TRUE","FALSE","UNKNOWN"].includes(res.transcript.truth),
 "Truth comes from existing Engine only");
eq(runtime.workspace.mode,"runtime");

const unrecognizedOnly=nodes.map(x=>({...x,"Private Token":"","Private-Token":"","Cost Centre":"",
  "Blank Evidence":"", "Null Note":null}));
const blankPreview=await previewNetworkTopologyFile(file("blank.json",
 bytes(JSON.stringify({Devices:unrecognizedOnly}))));
eq(blankPreview.ok,true);
eq(blankPreview.unmappedColumnCount,0,"Blank-only unsupported fields ignored");
eq(blankPreview.diagnostics.filter(x=>x.code==="NETWORK_IMPORT_COLUMNS_UNMAPPED").length,0);

const csvRows=[
 ["Asset ID","Hostname","Device Type","IP Address","Connected To","Private Token","Cost Centre","Blank Evidence"],
 ["rtr01","Router","Router","10.7.0.1","",SECRET,"Operations",""],
 ["sw01","Switch","Switch","10.7.0.2","rtr01",SECRET,"Operations",""],
 ["win01","Windows Host","Windows","10.7.0.20","sw01",SECRET,"",""],
];
for(const [suffix,sep] of [["csv",","],["tsv","\t"]]){
 const data=bytes(csvRows.map(row=>row.join(sep)).join("\n")+"\n");
 const curr=await previewNetworkTopologyFile(file("inventory."+suffix,data));
 eq(curr.ok,true,"Original "+suffix+" producer supports unknown columns");
 eq(curr.unmappedColumnCount,2,suffix+" unmapped source column aggregate");
 eq(curr.sourceSha256,sha(data));
 eq(curr.links,2);
 eq(curr.devices,3);
 yes(!JSON.stringify(curr).includes(SECRET));
 await verifyNetworkTopologyOriginalForActivation(file("inventory."+suffix,data),curr,()=>true);
}
const dual=JSON.parse(fs.readFileSync("tests/fixtures/import/ic020-p2a-consultant-dual-source.json","utf8"));
const dualBytes=bytes(JSON.stringify(dual));
const conflicted=await previewNetworkTopologyFile(file("dual.json",dualBytes));
eq(conflicted.ok,false,"P2a still blocks dual link sources by default");
eq(conflicted.unmappedColumnCount,1,"Canary private field of original P2a fixture not leaked");
yes(conflicted.diagnostics.some(x=>x.code==="NETWORK_IMPORT_LINK_SOURCES_CONFLICT"));
const chosen=await previewNetworkTopologyFile(file("dual.json",dualBytes),{linkSourceChoice:"LINKS_SHEET"});
eq(chosen.ok,true,"P2a explicit choice unaffected");
eq(chosen.linkSourceChoice,"LINKS_SHEET");
eq(chosen.unmappedColumnCount,1);
eq(chosen.links,6);
await verifyNetworkTopologyOriginalForActivation(file("dual.json",dualBytes),chosen,()=>true);
yes(!JSON.stringify(chosen).includes("SECRET_IC020_P2A_CANARY_NOT_REAL"));

const candidates=[
 ["Devices+records",{Devices:nodes,records:[nodes[0]]}],
 ["Devices+Nodes",{Devices:nodes,Nodes:[nodes[0]]}],
 ["Devices+devices",{Devices:nodes,devices:[nodes[0]]}],
 ["canonical+Devices",{Metadata:[{scenarioId:"imported_network",title:"Imported Network"}],
   Nodes:[{nodeId:"rtr01",displayName:"Router",type:"network.router"}],Devices:nodes}],
 ["Nodes+records",{Nodes:nodes,records:nodes}],
];
for(const [label,raw] of candidates){
 const source=bytes(JSON.stringify(raw));
 const result=await previewNetworkTopologyFile(file("competing.json",source));
 eq(result.ok,false,label+" cannot silently select an inventory table");
 eq(result.source,undefined,label+" no ScenarioSource may become activatable");
 eq(result.sourceSha256,sha(source),"Bound original hash even on rejected candidate");
 eq(result.unmappedColumnCount,0,"No undefined device candidate chosen for unknown fields");
 yes(result.diagnostics.some(x=>x.code==="NETWORK_IMPORT_DEVICE_TABLE_AMBIGUOUS"&&x.severity==="error"),
   label+" fixed diagnostic");
 yes(!JSON.stringify(result).includes(SECRET),"No leak of ignored source into blocked review");
 await reject(verifyNetworkTopologyOriginalForActivation(file("competing.json",source),
   result,()=>true),"IC020_P1_SOURCE_CHANGED");
}
const conflictPlusLinks=bytes(JSON.stringify({Devices:nodes,records:nodes,Links:[
 {"Link ID":"L1","From":"sw01","To":"rtr01"},
]}));
const forced=await previewNetworkTopologyFile(file("ambiguous.json",conflictPlusLinks),
 {linkSourceChoice:"LINKS_SHEET"});
eq(forced.ok,false,"A P2a choice cannot bypass competing inventory sources");
yes(forced.diagnostics.some(x=>x.code==="NETWORK_IMPORT_DEVICE_TABLE_AMBIGUOUS"));

const singleExtra=await previewNetworkTopologyFile(file("one.json",
 bytes(JSON.stringify({Devices:nodes,AuditLog:[{event:"untrusted"}]}))));
eq(singleExtra.ok,true,"Unrelated non-candidate JSON table is not silently activated");
eq(singleExtra.devices,3);
eq(singleExtra.links,2);
eq(singleExtra.unmappedColumnCount,2);

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ic020-p2c3-"));
try{
 execFileSync("python3",["tests/fixtures/import/generate_ic020_p2c2_workbooks.py","--out-dir",dir],
  {stdio:["ignore","pipe","pipe"],timeout:20000});
 for(const suffix of ["xlsx","ods"]){
  const data=Uint8Array.from(fs.readFileSync(path.join(dir,"ic020-p2c2-valid."+suffix)));
  const curr=await previewNetworkTopologyFile(file("consultant."+suffix,data));
  eq(curr.ok,true,"Actual six-table ZIP producer "+suffix+" remains supported");
  eq(curr.unmappedColumnCount,0,"Canonical workbook does not gain arbitrary unmapped header warnings");
  eq(curr.devices,8);
  eq(curr.links,6);
  eq(curr.sourceSha256,sha(data));
  await verifyNetworkTopologyOriginalForActivation(file("consultant."+suffix,data),curr,()=>true);
 }
}finally{fs.rmSync(dir,{recursive:true,force:true})}

const app=fs.readFileSync("ui/app/main.mjs","utf8");
for(const k of ['data-network-import-unmapped','NETWORK_IMPORT_COLUMNS_UNMAPPED',
 "unmappedColumnCount: normalized.unmappedColumnCount"]){
 const sourceFile=k==="data-network-import-unmapped"?"ui/app/main.mjs":
  k==="NETWORK_IMPORT_COLUMNS_UNMAPPED"?"enterprise-import/src/network-inventory.ts":
  "ui/src/browser/network-topology-import.ts";
 yes(fs.readFileSync(sourceFile,"utf8").includes(k),"Actual code enforces "+k);
}
eq(builtinEnterpriseImportAdapters.map(x=>x.id),
 ["builtin.json","builtin.csv","builtin.tsv","builtin.xlsx","builtin.ods"],
 "All five real adapter registrations preserved");
console.log("PASS IC-020 P2c3 unmapped and competing Device source audit: "+assertions+
 " real JSON/CSV/TSV/XLSX/ODS, SHA, failed ambiguity, no private fields, modeled Engine and re-read assertions.");
