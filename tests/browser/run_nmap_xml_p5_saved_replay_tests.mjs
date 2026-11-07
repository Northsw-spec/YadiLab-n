import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import fs from "node:fs";
import {previewNmapXmlObservations} from "../../dist-browser-test/enterprise-import/src/nmap-xml-preview.js";
import {reviewNmapObservationAssociations} from "../../dist-browser-test/enterprise-import/src/nmap-association-review.js";
import {replayNmapSavedReferences} from "../../dist-browser-test/enterprise-import/src/nmap-report-replay.js";
import {replayNmapSavedReportFiles} from "../../dist-browser-test/ui/src/browser/nmap-report-replay-file.js";
import {NmapSavedReferenceReplayPanel} from "../../ui/app/nmap-reference-replay-panel.mjs";

const enc=new TextEncoder(),bytes=src=>enc.encode(src);
const scan=n=>bytes('<?xml version="1.0"?><nmaprun scanner="nmap" version="7.94" start="1761760000">'+
  Array.from({length:n},(_,i)=>'<host><status state="up"/><address addrtype="ipv4" addr="10.'+
    Math.floor(i/256)+'.'+(i%256)+'.10"/>'+
    '<hostnames><hostname name="CONFIDENTIAL_NMAP_HOST_'+i+'" type="user"/></hostnames>'+
    (i===160?'<ports><port protocol="tcp" portid="443"><state state="open"/>'+
    '<service name="https" method="probed" conf="9"/></port></ports>':'')+
    '</host>').join('')+'</nmaprun>');
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
for(const n of [2,161,1000]){
  const original=scan(n),preview=await previewNmapXmlObservations(original);
  const decision={sourceSha256:preview.sourceSha256,scenarioId:builder.scenarioId,
    sourceRevision:builder.sourceRevision,acknowledgeNotVerified:true,
    associations:[{hostOrdinal:n-1,resourceId:"rds01"}]};
  const made=reviewNmapObservationAssociations(preview,builder,decision);
  eq(made.status,"READY_FOR_EXPORT");
  const report=made.sidecar;
  const saved=bytes(JSON.stringify(report,null,2));
  const match=await replayNmapSavedReferences(original,saved,builder,true);
  const fromFiles=()=>replayNmapSavedReportFiles(
    file("original.xml",original),file("saved.json",saved),()=>builder,true,()=>true);
  eq(await fromFiles(),match,"Actual two file replay equals pure result");
  eq(match.status,"REFERENCE_REPLAY_MATCH");
  eq(match.reportFormat,"yadilab.nmap-observation-associations");
  eq(match.sourceSha256,preview.sourceSha256);
  eq(match.referencesChecked,1);
  eq(match.semanticTrack,"EVIDENCE_OBSERVED");
  eq(Object.isFrozen(match),true);
  for(const key of ["identityVerified","physicalTopologyVerified","engineVerified","modelMutated"]){
    eq(match[key],false,"No forged truth "+key);
  }
  eq(Object.hasOwn(match,"associations"),false);
  eq(JSON.stringify(match).includes("CONFIDENTIAL_NMAP_HOST"),false);
  const shuffled=Object.fromEntries(Object.entries(report).reverse());
  eq(await replayNmapSavedReferences(original,bytes(JSON.stringify(shuffled)),builder,true),match,
    "JSON key order not material");
  const changed=bytes(new TextDecoder().decode(original).replace("CONFIDENTIAL_NMAP_HOST_0","CHANGED_NMAP_HOST_0"));
  await fails(replayNmapSavedReferences(changed,saved,builder,true),"NMAP_REPLAY_SOURCE_CHANGED");
  await fails(replayNmapSavedReferences(original,saved,null,true),"NMAP_REPLAY_BUILDER_REQUIRED");
  await fails(replayNmapSavedReferences(original,saved,builder,false),"NMAP_REPLAY_CONSENT_REQUIRED");
  await fails(replayNmapSavedReferences(original,saved,{...builder,sourceRevision:13},true),
    "NMAP_REPLAY_MODEL_MISMATCH");
  await fails(replayNmapSavedReferences(original,saved,{...builder,resources:[]},true),
    "NMAP_REPLAY_MODEL_MISMATCH");
  for(const key of ["engineVerified","physicalTopologyVerified"]){
    await fails(replayNmapSavedReferences(original,bytes(JSON.stringify({...report,[key]:true})),builder,true),
      "NMAP_REPLAY_REPORT_MISMATCH");
  }
  for(const variant of [
    {...report,warnings:[]},
    {...report,unexpectedNetworkLinks:[]},
    {...report,source:{...report.source,scanStart:999}},
    {...report,associations:[{...report.associations[0],observedIpv4:"192.0.2.99"}]},
    {...report,associations:[{...report.associations[0],observedPortCount:123}]},
    {...report,associations:[{...report.associations[0],hostLocator:{
      ...report.associations[0].hostLocator,sourceSha256:"0".repeat(64)}}]},
  ]){
    await fails(replayNmapSavedReferences(original,bytes(JSON.stringify(variant)),builder,true),
      "NMAP_REPLAY_REPORT_MISMATCH");
  }
  await fails(replayNmapSavedReferences(original,bytes(JSON.stringify({...report,formatId:"another"})),builder,true),
    "NMAP_REPLAY_FORMAT_UNSUPPORTED");
  await fails(replayNmapSavedReferences(original,bytes(JSON.stringify({...report,schemaVersion:"2.0.0"})),builder,true),
    "NMAP_REPLAY_REPORT_INVALID");
  await fails(replayNmapSavedReferences(original,bytes(JSON.stringify({...report,associations:[]})),builder,true),
    "NMAP_REPLAY_COUNT_INVALID");
  await fails(replayNmapSavedReferences(original,bytes(JSON.stringify({...report,associations:[
    {...report.associations[0],hostLocator:{...report.associations[0].hostLocator,hostOrdinal:n}}]})),builder,true),
    "NMAP_REPLAY_MODEL_MISMATCH");
  await fails(replayNmapSavedReferences(original,bytes(JSON.stringify({...report,associations:[
    {...report.associations[0],hostLocator:{...report.associations[0].hostLocator,hostOrdinal:1.5}}]})),builder,true),
    "NMAP_REPLAY_ASSOCIATION_INVALID");
  await fails(replayNmapSavedReferences(original,bytes(JSON.stringify({...report,associations:[
    {...report.associations[0],targetResourceId:"__proto__"}]})),builder,true),
    "NMAP_REPLAY_ASSOCIATION_INVALID");
  await fails(replayNmapSavedReferences(original,saved,{...builder,scenarioId:"other"},true),
    "NMAP_REPLAY_MODEL_MISMATCH");
  eq(JSON.stringify(builder),before);
}
const original=scan(161),preview=await previewNmapXmlObservations(original);
const reviewed=reviewNmapObservationAssociations(preview,builder,{sourceSha256:preview.sourceSha256,
  scenarioId:builder.scenarioId,sourceRevision:12,acknowledgeNotVerified:true,
  associations:[{hostOrdinal:160,resourceId:"rds01"}]});
const report=reviewed.sidecar, saved=bytes(JSON.stringify(report));
await fails(replayNmapSavedReferences(original,bytes("{BROKEN"),builder,true),"NMAP_REPLAY_REPORT_INVALID");
await fails(replayNmapSavedReferences(original,new Uint8Array([0xff,0xfe]),builder,true),
 "NMAP_REPLAY_REPORT_INVALID");
await fails(replayNmapSavedReferences(original,new Uint8Array(512*1024+1),builder,true),
 "NMAP_REPLAY_REPORT_SIZE_INVALID");
await fails(replayNmapSavedReferences(original,bytes("[]"),builder,true),"NMAP_REPLAY_REPORT_INVALID");
await fails(replayNmapSavedReferences(original,bytes(JSON.stringify(report).replace('"engineVerified":false',
  '"engineVerified":false,"engineVerified":true')),builder,true),"NMAP_REPLAY_REPORT_INVALID");
await fails(replayNmapSavedReferences(original,bytes(JSON.stringify(report).replace('"source":{',
  '"source":{"sha256":"'+preview.sourceSha256+'",')),builder,true),"NMAP_REPLAY_REPORT_INVALID");
await fails(replayNmapSavedReferences(original,bytes(JSON.stringify(report).replace('"source":{',
  '"source":{"__proto__":{},')),builder,true),"NMAP_REPLAY_REPORT_INVALID");
await fails(replayNmapSavedReferences(original,bytes('{"x":'.repeat(20)+"null"+"}".repeat(20)),
  builder,true),"NMAP_REPLAY_REPORT_INVALID");
await fails(replayNmapSavedReferences(original,bytes(JSON.stringify({...report,
 associations:Array.from({length:1101},()=>report.associations[0])})),builder,true),
 "NMAP_REPLAY_REPORT_INVALID");
await fails(replayNmapSavedReferences(bytes('<!DOCTYPE nmaprun><nmaprun scanner="nmap"/>'),
 saved,builder,true),"NMAP_REPLAY_SOURCE_BLOCKED");
await fails(replayNmapSavedReferences(new Uint8Array(2*1024*1024+1),saved,builder,true),
 "NMAP_REPLAY_SOURCE_SIZE_INVALID");
async function fileFails(o,r,get,ack,valid,code){
 await fails(replayNmapSavedReportFiles(o,r,get,ack,valid),code);
}
await fileFails(file("evil.txt",original),file("saved.json",saved),()=>builder,true,()=>true,
 "NMAP_REPLAY_FILE_INVALID");
await fileFails(file("../original.xml",original),file("saved.json",saved),()=>builder,true,()=>true,
 "NMAP_REPLAY_FILE_INVALID");
await fileFails(file("original.xml",original),file("../saved.json",saved),()=>builder,true,()=>true,
 "NMAP_REPLAY_FILE_INVALID");
await fileFails(file("original.xml",original,2*1024*1024+1),file("saved.json",saved),
 ()=>builder,true,()=>true,"NMAP_REPLAY_FILE_SIZE_INVALID");
await fileFails(file("original.xml",original),file("saved.json",saved),()=>builder,false,()=>true,
 "NMAP_REPLAY_CONSENT_REQUIRED");
await fileFails(file("original.xml",original),file("saved.json",saved),()=>null,true,()=>true,
 "NMAP_REPLAY_BUILDER_REQUIRED");
await fileFails(file("original.xml",original),file("saved.json",saved),()=>builder,true,()=>false,
 "NMAP_REPLAY_STALE");
let current=builder;
const changingOriginal={name:"original.xml",size:original.length,async arrayBuffer(){
 current={...builder,sourceRevision:13};
 return original.buffer.slice(original.byteOffset,original.byteOffset+original.length);
}};
await fileFails(changingOriginal,file("saved.json",saved),()=>current,true,()=>true,"NMAP_REPLAY_STALE");
current=builder;
const changingSaved={name:"saved.json",size:saved.length,async arrayBuffer(){
 current={...builder,resources:builder.resources.map((x,i)=>i?x:{...x,label:"changed"})};
 return saved.buffer.slice(saved.byteOffset,saved.byteOffset+saved.length);
}};
await fileFails(file("original.xml",original),changingSaved,()=>current,true,()=>true,
 "NMAP_REPLAY_STALE");
current=builder;
const html=renderToStaticMarkup(React.createElement(NmapSavedReferenceReplayPanel,{
 model:builder,onReplay(){throw Error("No SSR replay");},onClose(){}
}));
for(const marker of [
 'data-nmap-replay-panel="EVIDENCE_OBSERVED"','data-nmap-replay-original="true"',
 'data-nmap-replay-report="true"','data-nmap-replay-consent="true"',
 'data-nmap-replay-verify="true"','data-nmap-replay-truth="true"','disabled=""'
])eq(html.includes(marker),true,marker);
eq(html.includes("CONFIDENTIAL_NMAP_HOST"),false);
const main=fs.readFileSync("ui/app/main.mjs","utf8");
for(const text of ["data-inspect-nmap-replay","replayNmapSavedReportFiles(","latestDrawioWorkspaceRef.current",
 "NmapSavedReferenceReplayPanel"]){eq(main.includes(text),true,text)}
for(const path of ["enterprise-import/src/nmap-report-replay.ts",
 "ui/src/browser/nmap-report-replay-file.ts","ui/app/nmap-reference-replay-panel.mjs"]){
 const body=fs.readFileSync(path,"utf8");
 for(const f of ["fetch(","setWorkspace(","localStorage","indexedDB","dangerouslySetInnerHTML"]){
  eq(body.includes(f),false,"Read-only "+path+" "+f);
 }
}
eq(JSON.stringify(builder),before);
console.log("PASS NMAP XML P5 "+checks+" source-bound exact sidecar replay, duplicate JSON keys, 1000 hosts, no Engine");
