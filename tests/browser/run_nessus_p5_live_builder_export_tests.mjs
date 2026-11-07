import assert from "node:assert/strict";
import fs from "node:fs";
import {previewNessusSeveritySummary} from "../../dist-browser-test/enterprise-import/src/nessus-v2-preview.js";
import {reviewNessusOriginalFileAssociations} from "../../dist-browser-test/ui/src/browser/nessus-association-file.js";

const enc=new TextEncoder();
const xml=n=>enc.encode('<?xml version="1.0"?><NessusClientData_v2><Report name="PRIVATE_NESSUS_P5_REPORT">'+
 Array.from({length:n},(_,i)=>'<ReportHost name="NESSUS_PRIVATE_HOST_CANARY_'+i+'">'+
 '<HostProperties><tag name="host-ip">192.0.2.47</tag></HostProperties>'+
 '<ReportItem pluginID="19506" port="443" protocol="tcp" severity="3">'+
 '<plugin_output>SECRET_NESSUS_P5_PLUGIN_VALUE</plugin_output></ReportItem></ReportHost>').join('')+
 '</Report></NessusClientData_v2>');
const file=(raw,name="original.nessus")=>({name,size:raw.byteLength,async arrayBuffer(){
 return raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
}});
const builder={scenarioId:"existing_org",sourceRevision:6,
 resources:[{id:"rds01",label:"RDS"},{id:"fw01",label:"Firewall"}]};
const prior=JSON.stringify(builder);
let total=0;
function eq(a,b,msg){assert.deepEqual(a,b,msg);total++}
async function fails(p,code){await assert.rejects(p,e=>e?.code===code&&e.message===code,code);total++}
for(const count of [2,41,256]){
 const raw=xml(count),preview=await previewNessusSeveritySummary(raw);
 const decision={sourceSha256:preview.sourceSha256,scenarioId:builder.scenarioId,
  sourceRevision:builder.sourceRevision,acknowledgeNotVerified:true,
  references:[{hostOrdinal:count-1,targetResourceId:"rds01"}]};
 const approved=await reviewNessusOriginalFileAssociations(file(raw),preview,()=>structuredClone(builder),
  decision,()=>true);
 eq(approved.formatId,"yadilab.nessus-reviewed-host-references");
 eq(approved.schemaVersion,"1.0.0");
 eq(approved.source.sha256,preview.sourceSha256);
 eq(approved.associations[0].hostLocator.hostOrdinal,count-1);
 eq(approved.associations[0].targetResourceId,"rds01");
 for(const flag of ["engineVerified","identityVerified","physicalTopologyVerified","modelMutated"])
  eq(approved[flag],false);
 for(const secret of ["PRIVATE_NESSUS_P5_REPORT","NESSUS_PRIVATE_HOST_CANARY",
  "192.0.2.47","19506","SECRET_NESSUS_P5_PLUGIN_VALUE"])
  eq(JSON.stringify(approved).includes(secret),false,"No private source leak");
 const changed=enc.encode(new TextDecoder().decode(raw).replace("NESSUS_PRIVATE_HOST_CANARY_0",
  "NESSUS_DIFFERENT_HOST_CANARY_0"));
 eq((await previewNessusSeveritySummary(changed)).findingCount,preview.findingCount,
  "Changed source deliberately holds aggregate finding count");
 eq((await previewNessusSeveritySummary(changed)).hostCount,preview.hostCount,
  "Changed source deliberately holds aggregate host count");
 await fails(reviewNessusOriginalFileAssociations(file(changed),preview,()=>builder,decision,()=>true),
  "NESSUS_P5_SOURCE_CHANGED");
 await fails(reviewNessusOriginalFileAssociations(file(raw),{...preview,severityCounts:[0,0,0,0,0]},
  ()=>builder,decision,()=>true),"NESSUS_P5_SOURCE_INVALID");
 await fails(reviewNessusOriginalFileAssociations(file(raw),{...preview,sourceSha256:"0".repeat(64)},
  ()=>builder,decision,()=>true),"NESSUS_P5_SOURCE_CHANGED");
 await fails(reviewNessusOriginalFileAssociations(file(raw),preview,()=>builder,
  {...decision,acknowledgeNotVerified:false},()=>true),"NESSUS_ASSOC_ACK_REQUIRED");
 await fails(reviewNessusOriginalFileAssociations(file(raw),preview,()=>null,decision,()=>true),
  "NESSUS_ASSOC_BUILDER_REQUIRED");
 await fails(reviewNessusOriginalFileAssociations(file(raw),preview,()=>builder,decision,()=>false),
  "NESSUS_P5_STALE");
 await fails(reviewNessusOriginalFileAssociations(file(raw),preview,()=>builder,
  {...decision,sourceRevision:7},()=>true),"NESSUS_ASSOC_STALE");
 await fails(reviewNessusOriginalFileAssociations(file(raw),preview,()=>builder,
  {...decision,references:[{hostOrdinal:count,targetResourceId:"rds01"}]},()=>true),
  "NESSUS_ASSOC_SELECTION_INVALID");
 eq(JSON.stringify(builder),prior);
}
const raw=xml(41),preview=await previewNessusSeveritySummary(raw);
const decision={sourceSha256:preview.sourceSha256,scenarioId:builder.scenarioId,
 sourceRevision:builder.sourceRevision,acknowledgeNotVerified:true,
 references:[{hostOrdinal:40,targetResourceId:"rds01"}]};
await fails(reviewNessusOriginalFileAssociations(file(raw,"original.xml"),preview,()=>builder,
 decision,()=>true),"NESSUS_P5_SOURCE_BLOCKED");
await fails(reviewNessusOriginalFileAssociations(file(raw,"../original.nessus"),preview,()=>builder,
 decision,()=>true),"NESSUS_P5_SOURCE_BLOCKED");
await fails(reviewNessusOriginalFileAssociations({...file(raw),size:2*1024*1024+1},
 preview,()=>builder,decision,()=>true),"NESSUS_P5_SOURCE_BLOCKED");
await fails(reviewNessusOriginalFileAssociations(file(enc.encode(
 '<!DOCTYPE NessusClientData_v2 [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><NessusClientData_v2/>')),
 preview,()=>builder,decision,()=>true),"NESSUS_P5_SOURCE_BLOCKED");
await fails(reviewNessusOriginalFileAssociations(file(enc.encode('<nmaprun scanner="nmap"/>')),
 preview,()=>builder,decision,()=>true),"NESSUS_P5_SOURCE_BLOCKED");
await fails(reviewNessusOriginalFileAssociations(file(raw),preview,null,decision,()=>true),
 "NESSUS_ASSOC_BUILDER_REQUIRED");
await fails(reviewNessusOriginalFileAssociations(file(raw),preview,()=>builder,decision,null),
 "NESSUS_P5_STALE");
function deferred(){
 let done;const original={name:"original.nessus",size:raw.byteLength,async arrayBuffer(){
  return await new Promise(resolve=>{done=()=>resolve(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));});
 }};
 return {original,finish(){assert.equal(typeof done,"function");done();}};
}
let selected=true,hold=deferred();
let pending=reviewNessusOriginalFileAssociations(hold.original,preview,()=>builder,decision,()=>selected);
selected=false;hold.finish();await fails(pending,"NESSUS_P5_STALE");
selected=true;let live=structuredClone(builder);hold=deferred();
pending=reviewNessusOriginalFileAssociations(hold.original,preview,()=>structuredClone(live),decision,()=>true);
live={...live,sourceRevision:9};hold.finish();await fails(pending,"NESSUS_P5_STALE");
live=structuredClone(builder);hold=deferred();
pending=reviewNessusOriginalFileAssociations(hold.original,preview,()=>structuredClone(live),decision,()=>true);
live={...live,resources:live.resources.map((x,i)=>i?x:{...x,label:"Changed label"})};
hold.finish();await fails(pending,"NESSUS_P5_STALE");
let calls=0;
await fails(reviewNessusOriginalFileAssociations(file(raw),preview,
 ()=>{calls++;return calls===3?{...builder,resources:[...builder.resources,{id:"new",label:"New"}]}:builder;},
 decision,()=>true),"NESSUS_P5_STALE");
eq(calls,3,"Final gate queries truly current Builder after review");
const main=fs.readFileSync("ui/app/main.mjs","utf8");
for(const marker of ["const live = latestDrawioWorkspaceRef.current",
 "reviewNessusOriginalFileAssociations(","sourceFile, summary, getCurrentModel, decision, isCurrent",
 "if (!isCurrent())","NESSUS_P5_STALE"]){
 eq(main.includes(marker),true,"Production live wiring "+marker);
}
const bridge=fs.readFileSync("ui/src/browser/nessus-association-file.ts","utf8");
for(const marker of ["previewNessusFileReadOnly(original)","JSON.stringify(parsed)!==JSON.stringify(expected)",
 "JSON.stringify(before)!==JSON.stringify(after)","JSON.stringify(after)!==JSON.stringify(last)",
 "NESSUS_P5_SOURCE_CHANGED"]){
 eq(bridge.includes(marker),true,"P5 strict bridge "+marker);
}
for(const forbidden of ["fetch(","setWorkspace(","localStorage","indexedDB","dangerouslySetInnerHTML"]){
 eq(bridge.includes(forbidden),false,"No I/O or Engine mutation "+forbidden);
}
console.log("PASS NESSUS P5 "+total+" actual 2/41/256 Nessus hosts, original SHA, late ordinal, private metadata and async model/epoch gates");
