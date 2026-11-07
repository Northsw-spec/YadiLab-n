import assert from "node:assert/strict";
import fs from "node:fs";
import { previewNmapXmlFileReadOnly } from "../../dist-browser-test/ui/src/browser/nmap-xml-file-preview.js";
import { reviewNmapOriginalFileAssociations } from "../../dist-browser-test/ui/src/browser/nmap-association-file.js";

const enc=new TextEncoder();
const source=n=>enc.encode('<?xml version="1.0"?><nmaprun scanner="nmap" version="7.94">'+
  Array.from({length:n},(_,i)=>
    '<host><status state="up"/><address addrtype="ipv4" addr="10.'+Math.floor(i/256)+'.'+i%256+'.10"/>'+
    '<hostnames><hostname name="node'+i+'.example.test" type="user"/></hostnames>'+
    (i===160?'<ports><port protocol="tcp" portid="443"><state state="open"/></port></ports>':'')+
    '</host>').join('')+'</nmaprun>');
const toFile=(raw,name="original.xml")=>({
 name,size:raw.byteLength,async arrayBuffer(){return raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)}
});
const builder={scenarioId:"site_existing",sourceRevision:5,resources:[
 {id:"rds01",label:"RDS"},{id:"fw01",label:"Firewall"}]};
const originalBuilder=JSON.stringify(builder);
const review=(expected,ordinal)=>({
 sourceSha256:expected.sourceSha256,scenarioId:builder.scenarioId,
 sourceRevision:5,acknowledgeNotVerified:true,
 associations:[{hostOrdinal:ordinal,resourceId:"rds01"}],
});
let tests=0;
function eq(a,b,desc){assert.deepEqual(a,b,desc);tests++}
async function denied(call,code){
 await assert.rejects(call,e=>e?.code===code && e.message===code,code);tests++;
}
for(const count of [2,161,1000]){
 const raw=source(count),expected=(await previewNmapXmlFileReadOnly(toFile(raw))).preview;
 const decision=review(expected,count-1);
 const sidecar=await reviewNmapOriginalFileAssociations(toFile(raw),expected,()=>structuredClone(builder),decision,()=>true);
 eq(sidecar.formatId,"yadilab.nmap-observation-associations");
 eq(sidecar.schemaVersion,"1.0.0");
 eq(sidecar.source.sha256,expected.sourceSha256);
 eq(sidecar.associations.map(x=>x.hostLocator.hostOrdinal),[count-1]);
 eq(sidecar.associations[0].hostLocator.sourceSha256,expected.sourceSha256);
 eq(sidecar.associations[0].assertion,"USER_ASSERTED_ASSOCIATION_NOT_VERIFIED");
 eq(sidecar.engineVerified,false);eq(sidecar.physicalTopologyVerified,false);
 eq(Object.hasOwn(sidecar,"resources"),false);
 eq(Object.hasOwn(sidecar,"connections"),false);
 eq(JSON.stringify(builder),originalBuilder);
 const mutated=enc.encode(new TextDecoder().decode(raw).replace("site.example.test","else.example.test")
   .replace("node0.example.test","changed-node.example.test"));
 await denied(reviewNmapOriginalFileAssociations(toFile(mutated),expected,()=>builder,decision,()=>true),
   "NMAP_P4_SOURCE_CHANGED");
 await denied(reviewNmapOriginalFileAssociations(toFile(raw),{...expected,hosts:expected.hosts.slice(1)},
   ()=>builder,decision,()=>true),"NMAP_P4_SOURCE_CHANGED");
 await denied(reviewNmapOriginalFileAssociations(toFile(raw),{...expected,sourceSha256:"a".repeat(64)},
   ()=>builder,decision,()=>true),"NMAP_P4_SOURCE_CHANGED");
 await denied(reviewNmapOriginalFileAssociations(toFile(raw),expected,()=>builder,
   {...decision,acknowledgeNotVerified:false},()=>true),"NMAP_P4_ACK_REQUIRED");
 await denied(reviewNmapOriginalFileAssociations(toFile(raw),expected,()=>builder,
   {...decision,associations:[{hostOrdinal:count,resourceId:"rds01"}]},()=>true),
   "NMAP_ASSOC_SELECTION_INVALID");
 await denied(reviewNmapOriginalFileAssociations(toFile(raw),expected,()=>null,decision,()=>true),
   "NMAP_P4_BUILDER_REQUIRED");
 await denied(reviewNmapOriginalFileAssociations(toFile(raw),expected,()=>builder,decision,()=>false),
   "NMAP_P4_STALE");
 await denied(reviewNmapOriginalFileAssociations(toFile(raw),expected,()=>builder,
   {...decision,scenarioId:"other"},()=>true),"NMAP_ASSOC_STALE");
}
const raw=source(161),expected=(await previewNmapXmlFileReadOnly(toFile(raw))).preview;
const decision=review(expected,160);
await denied(reviewNmapOriginalFileAssociations(toFile(enc.encode('<!DOCTYPE nmaprun [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><nmaprun scanner="nmap"/>')),
 expected,()=>builder,decision,()=>true),"NMAP_P4_SOURCE_BLOCKED");
await denied(reviewNmapOriginalFileAssociations(toFile(raw,"evil.graphml"),
 expected,()=>builder,decision,()=>true),"NMAP_P4_SOURCE_BLOCKED");
await denied(reviewNmapOriginalFileAssociations({...toFile(raw),size:2*1024*1024+1},
 expected,()=>builder,decision,()=>true),"NMAP_P4_SOURCE_BLOCKED");
await denied(reviewNmapOriginalFileAssociations(toFile(raw),{...expected,canActivate:true},
 ()=>builder,decision,()=>true),"NMAP_P4_SOURCE_INVALID");
await denied(reviewNmapOriginalFileAssociations(toFile(raw),expected,()=>builder,decision,null),
 "NMAP_P4_STALE");
await denied(reviewNmapOriginalFileAssociations(toFile(raw),expected,null,decision,()=>true),
 "NMAP_P4_BUILDER_REQUIRED");

function deferred(){
 let release;
 const file={name:"source.xml",size:raw.byteLength,arrayBuffer(){
  return new Promise(resolve=>{release=()=>resolve(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength))});
 }};
 return {file,finish(){assert.equal(typeof release,"function");release()}};
}
let epoch=true;
let pending=deferred();
let inFlight=reviewNmapOriginalFileAssociations(pending.file,expected,()=>builder,decision,()=>epoch);
epoch=false;pending.finish();
await denied(inFlight,"NMAP_P4_STALE");
epoch=true;
let live=structuredClone(builder);
pending=deferred();
inFlight=reviewNmapOriginalFileAssociations(pending.file,expected,()=>structuredClone(live),decision,()=>true);
live={...live,sourceRevision:6};pending.finish();
await denied(inFlight,"NMAP_P4_STALE");
live=structuredClone(builder);
pending=deferred();
inFlight=reviewNmapOriginalFileAssociations(pending.file,expected,()=>structuredClone(live),decision,()=>true);
live={...live,resources:live.resources.map((x,i)=>i===0?{...x,label:"Changed after review"}:x)};
pending.finish();
await denied(inFlight,"NMAP_P4_STALE");
live=structuredClone(builder);
let calls=0;
await denied(reviewNmapOriginalFileAssociations(toFile(raw),expected,
 ()=>{calls++;return calls===3?{...builder,resources:[...builder.resources,{id:"new",label:"New"}]}:builder;},
 decision,()=>true),"NMAP_P4_STALE");
eq(calls,3,"Last live Builder must be checked just before return");

const ui=fs.readFileSync("ui/app/nmap-observation-panel.mjs","utf8");
const main=fs.readFileSync("ui/app/main.mjs","utf8");
const bridge=fs.readFileSync("ui/src/browser/nmap-association-file.ts","utf8");
for(const marker of ["originalFile.current = file","request.current === epoch","originalFile.current === original",
 "onExportAssociation(original, preview, decision","originalFile.current = null"]){
 eq(ui.includes(marker),true,"UI original File and epoch contract "+marker);
}
for(const marker of ["reviewNmapOriginalFileAssociations(","latestDrawioWorkspaceRef.current",
 "if (!isCurrent())","nmap-associations-"]){
 eq(main.includes(marker),true,"Main final gate "+marker);
}
for(const marker of ["previewNmapXmlFileReadOnly(original)","JSON.stringify(parsed)!==JSON.stringify(expected)",
 "reviewNmapObservationAssociations(parsed,after,decision)","NMAP_P4_SOURCE_CHANGED"]){
 eq(bridge.includes(marker),true,"Original reread hard security gate "+marker);
}
for(const forbidden of ["setWorkspace(","fetch(","dangerouslySetInnerHTML","localStorage"]){
 eq(bridge.includes(forbidden),false,"No network/Builder mutation in bridge");
}
console.log("PASS NMAP-XML-P4 "+tests+" strict 2/161/1000 real XML, raw source, async generation, live Builder gates");
