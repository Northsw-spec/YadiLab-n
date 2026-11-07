import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import fs from "node:fs";
import {previewNessusSeveritySummary} from "../../dist-browser-test/enterprise-import/src/nessus-v2-preview.js";
import {reviewNessusHostReferences} from "../../dist-browser-test/enterprise-import/src/nessus-association-review.js";
import {replayNessusSavedReferences} from "../../dist-browser-test/enterprise-import/src/nessus-report-replay.js";
import {replayNessusSavedReportFiles} from "../../dist-browser-test/ui/src/browser/nessus-report-replay-file.js";
import {NessusSavedReferenceReplayPanel} from "../../ui/app/nessus-reference-replay-panel.mjs";

const enc=new TextEncoder(),bytes=src=>enc.encode(src);
const scan=n=>bytes('<?xml version="1.0"?><NessusClientData_v2><Report name="PRIVATE_REPORT">'+
  Array.from({length:n},(_,i)=>'<ReportHost name="CONFIDENTIAL_NESSUS_HOST_'+i+'">'+
    '<HostProperties><tag name="host-ip">192.0.2.88</tag></HostProperties>'+
    '<ReportItem pluginID="19506" port="443" protocol="tcp" severity="3">'+
    '<plugin_output>DO_NOT_EXPOSE_SECRET_FINDING</plugin_output></ReportItem></ReportHost>').join('')+
  '</Report></NessusClientData_v2>');
const builder={scenarioId:"rds_site",sourceRevision:12,resources:[
  {id:"rds01",label:"Existing RDS"},{id:"fw01",label:"Firewall"}]};
const file=(name,b,declared=b.length)=>({name,size:declared,async arrayBuffer(){
  return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
}});
let checks=0;function eq(a,b,label){assert.deepEqual(a,b,label);checks++}
async function fails(operation,code){
  await assert.rejects(operation,e=>e?.code===code&&e.message===code,code);checks++;
}
const before=JSON.stringify(builder);
for(const n of [2,41,256]){
  const original=scan(n),preview=await previewNessusSeveritySummary(original);
  const decision={sourceSha256:preview.sourceSha256,scenarioId:builder.scenarioId,
    sourceRevision:builder.sourceRevision,acknowledgeNotVerified:true,
    references:[{hostOrdinal:n-1,targetResourceId:"rds01"}]};
  const made=reviewNessusHostReferences(preview,builder,decision);
  eq(made.status,"READY_FOR_EXPORT");
  const report=made.sidecar;
  const saved=bytes(JSON.stringify(report,null,2));
  const match=await replayNessusSavedReferences(original,saved,builder,true);
  const fromFiles=()=>replayNessusSavedReportFiles(
    file("original.nessus",original),file("saved.json",saved),()=>builder,true,()=>true);
  eq(await fromFiles(),match,"Actual two file replay equals pure result");
  eq(match.status,"REFERENCE_REPLAY_MATCH");
  eq(match.reportFormat,"yadilab.nessus-reviewed-host-references");
  eq(match.sourceSha256,preview.sourceSha256);
  eq(match.referencesChecked,1);
  eq(match.semanticTrack,"EVIDENCE_OBSERVED");
  eq(Object.isFrozen(match),true);
  for(const key of ["identityVerified","physicalTopologyVerified","engineVerified","modelMutated"]){
    eq(match[key],false,"No forged truth "+key);
  }
  eq(Object.hasOwn(match,"associations"),false);
  eq(JSON.stringify(match).includes("CONFIDENTIAL_NESSUS_HOST"),false);
  const shuffled=Object.fromEntries(Object.entries(report).reverse());
  eq(await replayNessusSavedReferences(original,bytes(JSON.stringify(shuffled)),builder,true),match,
    "JSON key order not material");
  const changed=bytes(new TextDecoder().decode(original).replace("CONFIDENTIAL_NESSUS_HOST_0","CHANGED_NESSUS_HOST_0"));
  await fails(replayNessusSavedReferences(changed,saved,builder,true),"NESSUS_REPLAY_SOURCE_CHANGED");
  await fails(replayNessusSavedReferences(original,saved,null,true),"NESSUS_REPLAY_BUILDER_REQUIRED");
  await fails(replayNessusSavedReferences(original,saved,builder,false),"NESSUS_REPLAY_CONSENT_REQUIRED");
  await fails(replayNessusSavedReferences(original,saved,{...builder,sourceRevision:13},true),
    "NESSUS_REPLAY_MODEL_MISMATCH");
  await fails(replayNessusSavedReferences(original,saved,{...builder,resources:[]},true),
    "NESSUS_REPLAY_MODEL_MISMATCH");
  for(const key of ["engineVerified","physicalTopologyVerified"]){
    await fails(replayNessusSavedReferences(original,bytes(JSON.stringify({...report,[key]:true})),builder,true),
      "NESSUS_REPLAY_REPORT_MISMATCH");
  }
  for(const variant of [
    {...report,warnings:[]},
    {...report,unexpectedNetworkLinks:[]},
    {...report,source:{...report.source,scanStart:255}},
    {...report,associations:[{...report.associations[0],observedIpv4:"192.0.2.99"}]},
    {...report,associations:[{...report.associations[0],observedPortCount:123}]},
    {...report,associations:[{...report.associations[0],hostLocator:{
      ...report.associations[0].hostLocator,sourceSha256:"0".repeat(64)}}]},
  ]){
    await fails(replayNessusSavedReferences(original,bytes(JSON.stringify(variant)),builder,true),
      "NESSUS_REPLAY_REPORT_MISMATCH");
  }
  await fails(replayNessusSavedReferences(original,bytes(JSON.stringify({...report,formatId:"another"})),builder,true),
    "NESSUS_REPLAY_FORMAT_UNSUPPORTED");
  await fails(replayNessusSavedReferences(original,bytes(JSON.stringify({...report,schemaVersion:"2.0.0"})),builder,true),
    "NESSUS_REPLAY_REPORT_INVALID");
  await fails(replayNessusSavedReferences(original,bytes(JSON.stringify({...report,associations:[]})),builder,true),
    "NESSUS_REPLAY_COUNT_INVALID");
  await fails(replayNessusSavedReferences(original,bytes(JSON.stringify({...report,associations:[
    {...report.associations[0],hostLocator:{...report.associations[0].hostLocator,hostOrdinal:n}}]})),builder,true),
    "NESSUS_REPLAY_MODEL_MISMATCH");
  await fails(replayNessusSavedReferences(original,bytes(JSON.stringify({...report,associations:[
    {...report.associations[0],hostLocator:{...report.associations[0].hostLocator,hostOrdinal:1.5}}]})),builder,true),
    "NESSUS_REPLAY_ASSOCIATION_INVALID");
  await fails(replayNessusSavedReferences(original,bytes(JSON.stringify({...report,associations:[
    {...report.associations[0],targetResourceId:"__proto__"}]})),builder,true),
    "NESSUS_REPLAY_ASSOCIATION_INVALID");
  await fails(replayNessusSavedReferences(original,saved,{...builder,scenarioId:"other"},true),
    "NESSUS_REPLAY_MODEL_MISMATCH");
  eq(JSON.stringify(builder),before);
}
const original=scan(41),preview=await previewNessusSeveritySummary(original);
const reviewed=reviewNessusHostReferences(preview,builder,{sourceSha256:preview.sourceSha256,
  scenarioId:builder.scenarioId,sourceRevision:12,acknowledgeNotVerified:true,
  references:[{hostOrdinal:40,targetResourceId:"rds01"}]});
const report=reviewed.sidecar, saved=bytes(JSON.stringify(report));
await fails(replayNessusSavedReferences(original,bytes("{BROKEN"),builder,true),"NESSUS_REPLAY_REPORT_INVALID");
await fails(replayNessusSavedReferences(original,new Uint8Array([0xff,0xfe]),builder,true),
 "NESSUS_REPLAY_REPORT_INVALID");
await fails(replayNessusSavedReferences(original,new Uint8Array(512*1024+1),builder,true),
 "NESSUS_REPLAY_REPORT_SIZE_INVALID");
await fails(replayNessusSavedReferences(original,bytes("[]"),builder,true),"NESSUS_REPLAY_REPORT_INVALID");
await fails(replayNessusSavedReferences(original,bytes(JSON.stringify(report).replace('"engineVerified":false',
  '"engineVerified":false,"engineVerified":true')),builder,true),"NESSUS_REPLAY_REPORT_INVALID");
await fails(replayNessusSavedReferences(original,bytes(JSON.stringify(report).replace('"source":{',
  '"source":{"sha256":"'+preview.sourceSha256+'",')),builder,true),"NESSUS_REPLAY_REPORT_INVALID");
await fails(replayNessusSavedReferences(original,bytes(JSON.stringify(report).replace('"source":{',
  '"source":{"__proto__":{},')),builder,true),"NESSUS_REPLAY_REPORT_INVALID");
await fails(replayNessusSavedReferences(original,bytes('{"x":'.repeat(20)+"null"+"}".repeat(20)),
  builder,true),"NESSUS_REPLAY_REPORT_INVALID");
await fails(replayNessusSavedReferences(original,bytes(JSON.stringify({...report,
 associations:Array.from({length:1101},()=>report.associations[0])})),builder,true),
 "NESSUS_REPLAY_REPORT_INVALID");
await fails(replayNessusSavedReferences(bytes('<!DOCTYPE nessusrun><nessusrun scanner="nessus"/>'),
 saved,builder,true),"NESSUS_REPLAY_SOURCE_BLOCKED");
await fails(replayNessusSavedReferences(new Uint8Array(2*1024*1024+1),saved,builder,true),
 "NESSUS_REPLAY_SOURCE_SIZE_INVALID");
async function fileFails(o,r,get,ack,valid,code){
 await fails(replayNessusSavedReportFiles(o,r,get,ack,valid),code);
}
await fileFails(file("evil.txt",original),file("saved.json",saved),()=>builder,true,()=>true,
 "NESSUS_REPLAY_FILE_INVALID");
await fileFails(file("../original.nessus",original),file("saved.json",saved),()=>builder,true,()=>true,
 "NESSUS_REPLAY_FILE_INVALID");
await fileFails(file("original.nessus",original),file("../saved.json",saved),()=>builder,true,()=>true,
 "NESSUS_REPLAY_FILE_INVALID");
await fileFails(file("original.nessus",original,2*1024*1024+1),file("saved.json",saved),
 ()=>builder,true,()=>true,"NESSUS_REPLAY_FILE_SIZE_INVALID");
await fileFails(file("original.nessus",original),file("saved.json",saved),()=>builder,false,()=>true,
 "NESSUS_REPLAY_CONSENT_REQUIRED");
await fileFails(file("original.nessus",original),file("saved.json",saved),()=>null,true,()=>true,
 "NESSUS_REPLAY_BUILDER_REQUIRED");
await fileFails(file("original.nessus",original),file("saved.json",saved),()=>builder,true,()=>false,
 "NESSUS_REPLAY_STALE");
let current=builder;
const changingOriginal={name:"original.nessus",size:original.length,async arrayBuffer(){
 current={...builder,sourceRevision:13};
 return original.buffer.slice(original.byteOffset,original.byteOffset+original.length);
}};
await fileFails(changingOriginal,file("saved.json",saved),()=>current,true,()=>true,"NESSUS_REPLAY_STALE");
current=builder;
const changingSaved={name:"saved.json",size:saved.length,async arrayBuffer(){
 current={...builder,resources:builder.resources.map((x,i)=>i?x:{...x,label:"changed"})};
 return saved.buffer.slice(saved.byteOffset,saved.byteOffset+saved.length);
}};
await fileFails(file("original.nessus",original),changingSaved,()=>current,true,()=>true,
 "NESSUS_REPLAY_STALE");
current=builder;
const html=renderToStaticMarkup(React.createElement(NessusSavedReferenceReplayPanel,{
 model:builder,onReplay(){throw Error("No SSR replay");},onClose(){}
}));
for(const marker of [
 'data-nessus-replay-panel="EVIDENCE_OBSERVED"','data-nessus-replay-original="true"',
 'data-nessus-replay-report="true"','data-nessus-replay-consent="true"',
 'data-nessus-replay-verify="true"','data-nessus-replay-truth="true"','disabled=""'
])eq(html.includes(marker),true,marker);
eq(html.includes("CONFIDENTIAL_NESSUS_HOST"),false);
const main=fs.readFileSync("ui/app/main.mjs","utf8");
for(const text of ["data-inspect-nessus-replay","replayNessusSavedReportFiles(","latestDrawioWorkspaceRef.current",
 "NessusSavedReferenceReplayPanel"]){eq(main.includes(text),true,text)}
for(const path of ["enterprise-import/src/nessus-report-replay.ts",
 "ui/src/browser/nessus-report-replay-file.ts","ui/app/nessus-reference-replay-panel.mjs"]){
 const body=fs.readFileSync(path,"utf8");
 for(const f of ["fetch(","setWorkspace(","localStorage","indexedDB","dangerouslySetInnerHTML"]){
  eq(body.includes(f),false,"Read-only "+path+" "+f);
 }
}
eq(JSON.stringify(builder),before);
console.log("PASS NESSUS P6 "+checks+" source-bound exact sidecar replay, duplicate JSON keys, 256 hosts, no Engine");
