import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {deflateRawSync} from "node:zlib";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import fs from "node:fs";
import {previewDrawioStructure} from "../../dist-browser-test/enterprise-import/src/drawio-structural-preview.js";
import {reviewDrawioVertexAssociations} from "../../dist-browser-test/enterprise-import/src/drawio-association-review.js";
import {replayDrawioSavedReferences} from "../../dist-browser-test/enterprise-import/src/drawio-report-replay.js";
import {replayDrawioSavedReportFiles} from "../../dist-browser-test/ui/src/browser/drawio-report-replay-file.js";
import {DrawioSavedReferenceReplayPanel} from "../../ui/app/drawio-reference-replay-panel.mjs";

const SECRET="SECRETHOST_192.0.2.23_AUTH_6473";
const root='<mxCell id="0"/><mxCell id="1" parent="0"/>';
const v=(id)=>'<mxCell id="'+id+'" vertex="1" parent="1" value="'+SECRET+'"/>';
const model=(s)=>'<mxGraphModel><root>'+root+s+'</root></mxGraphModel>';
const pack=s=>deflateRawSync(Buffer.from(encodeURIComponent(s),"ascii")).toString("base64");
const file=(one,two)=>'<?xml version="1.0"?><mxfile>'+
 '<diagram id="hiddenA" name="'+SECRET+'">'+one+'</diagram>'+
 '<diagram id="hiddenB" name="PRIVATE_SOURCE">'+two+'</diagram></mxfile>';
const xml=file(model(v("vertexA")+v("vertexB")+
 '<mxCell id="e0" parent="1" edge="1" source="vertexA" target="vertexB"/>'),
 pack(model(v("vertexC"))));
const raw=new TextEncoder().encode(xml);
const encoder=new TextEncoder();
const hash=createHash("sha256").update(raw).digest("hex");
const modelSnapshot={scenarioId:"example_1",sourceRevision:4,resources:[
 {id:"router_1",label:"Router"},{id:"switch_1",label:"Switch"},{id:"server_1",label:"Server"}]};
const preview=await previewDrawioStructure(raw);
const decision={sourceSha256:hash,scenarioId:"example_1",sourceRevision:4,
 acknowledgeNotVerified:true,references:[
 {pageOrdinal:1,vertexOrdinal:0,targetResourceId:"switch_1"},
 {pageOrdinal:0,vertexOrdinal:1,targetResourceId:"router_1"}]};
const r=reviewDrawioVertexAssociations(preview,modelSnapshot,decision);
assert.equal(r.status,"READY_FOR_EXPORT");
const report=r.sidecar;
const reportBytes=encoder.encode(JSON.stringify(report));
let n=0;
const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);n++;};
const match=await replayDrawioSavedReferences(raw,reportBytes,modelSnapshot,true);
eq(match.status,"REFERENCE_REPLAY_MATCH");
eq(match.sourceSha256,hash);
eq(match.referencesChecked,2);
eq(match.reportFormat,"yadilab.drawio-reviewed-vertex-references");
eq(match.semanticTrack,"TOPOLOGY_DECLARED");
for(const k of ["engineVerified","physicalTopologyVerified","identityVerified","modelMutated"])eq(match[k],false);
eq(JSON.stringify(match).includes(SECRET),false);
eq(Object.isFrozen(match),true);
const local=(name,bytes)=>({name,size:bytes.length,async arrayBuffer(){
 return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
}});
const mkfile=(name,bytes)=>local(name,bytes);
let state=modelSnapshot,valid=true;
const live=()=>state;
const replay=()=>replayDrawioSavedReportFiles(
 mkfile("source.drawio",raw),mkfile("references.json",reportBytes),live,true,()=>valid);
eq(await replay(),match);
const unchanged=JSON.stringify(modelSnapshot);
const originalReport=JSON.stringify(report);
async function fail(source,saved,target,ack,code){
 await assert.rejects(replayDrawioSavedReferences(source,saved,target,ack),
 e=>e?.code===code&&e.message===code&&!e.message.includes(SECRET),code);n++;
}
async function failReport(obj,code="DRAWIO_REPLAY_REPORT_MISMATCH"){
 await fail(raw,encoder.encode(JSON.stringify(obj)),modelSnapshot,true,code);
}
await fail(raw,reportBytes,modelSnapshot,false,"DRAWIO_REPLAY_CONSENT_REQUIRED");
await fail(raw,reportBytes,null,true,"DRAWIO_REPLAY_BUILDER_REQUIRED");
await fail(encoder.encode(xml.replace(SECRET,"CHANGED_PRIVATE_SOURCE")),reportBytes,
 modelSnapshot,true,"DRAWIO_REPLAY_SOURCE_CHANGED");
await fail(raw,reportBytes,{...modelSnapshot,sourceRevision:5},true,"DRAWIO_REPLAY_MODEL_MISMATCH");
await fail(raw,reportBytes,{...modelSnapshot,scenarioId:"other"},true,"DRAWIO_REPLAY_MODEL_MISMATCH");
await fail(raw,reportBytes,{...modelSnapshot,resources:modelSnapshot.resources.slice(1)},
 true,"DRAWIO_REPLAY_MODEL_MISMATCH");
await fail(raw,reportBytes,{...modelSnapshot,resources:[modelSnapshot.resources[0],modelSnapshot.resources[0]]},
 true,"DRAWIO_REPLAY_MODEL_MISMATCH");
await fail(raw,encoder.encode("{broken"),modelSnapshot,true,"DRAWIO_REPLAY_REPORT_INVALID");
await fail(raw,new Uint8Array([0xff,0xfe,0xfd]),modelSnapshot,true,"DRAWIO_REPLAY_REPORT_INVALID");
await fail(raw,new Uint8Array(64*1024+1),modelSnapshot,true,"DRAWIO_REPLAY_REPORT_SIZE_INVALID");
await fail(raw,encoder.encode("{}"),modelSnapshot,true,"DRAWIO_REPLAY_FORMAT_UNSUPPORTED");
await fail(raw,encoder.encode(JSON.stringify({...report,formatId:"yadilab.wrong"})),modelSnapshot,true,"DRAWIO_REPLAY_FORMAT_UNSUPPORTED");
await fail(raw,encoder.encode(JSON.stringify({...report,associations:[]})),modelSnapshot,true,"DRAWIO_REPLAY_COUNT_INVALID");
for(const [k,value] of [
 ["engineVerified",true],["physicalTopologyVerified",true],
 ["identityVerified",true],["modelMutated",true],
 ["schemaVersion","2.0.0"],["status","ENGINE_VERIFIED"],
 ["warnings",[]],["injectedSourceValue",SECRET]]){
 await failReport({...report,[k]:value},k==="schemaVersion"||k==="status"?
 "DRAWIO_REPLAY_REPORT_INVALID":"DRAWIO_REPLAY_REPORT_MISMATCH");
}
await failReport({...report,source:{...report.source,sha256:"0".repeat(64)}},
 "DRAWIO_REPLAY_SOURCE_CHANGED");
await failReport({...report,associations:[...report.associations].reverse()});
await failReport({...report,associations:[
 report.associations[0],report.associations[0]]},"DRAWIO_REPLAY_MODEL_MISMATCH");
await failReport({...report,associations:[{...report.associations[0],
 locator:{...report.associations[0].locator,pageOrdinal:20}},report.associations[1]]},
 "DRAWIO_REPLAY_MODEL_MISMATCH");
await failReport({...report,associations:[{...report.associations[0],
 locator:{...report.associations[0].locator,vertexOrdinal:0.3}},report.associations[1]]},
 "DRAWIO_REPLAY_LOCATOR_INVALID");
await failReport({...report,associations:[{...report.associations[0],
 locator:{...report.associations[0].locator,sourceSha256:"0".repeat(64)}},report.associations[1]]});
await failReport({...report,associations:[{...report.associations[0],targetResourceId:"constructor"},report.associations[1]]},
 "DRAWIO_REPLAY_LOCATOR_INVALID");
await failReport({...report,associations:[{...report.associations[0],assertion:"VERIFIED_REAL_DEVICE"},report.associations[1]]},
 "DRAWIO_REPLAY_LOCATOR_INVALID");
// Explicit malicious original source must fail regardless of matching sidecar.
await fail(encoder.encode('<!DOCTYPE mxfile [<!ENTITY x SYSTEM "file:///etc/passwd">]><mxfile/>'),
 reportBytes,modelSnapshot,true,"DRAWIO_REPLAY_SOURCE_BLOCKED");
await assert.rejects(replayDrawioSavedReportFiles(
 mkfile("wrong.xml",raw),mkfile("report.json",reportBytes),live,true,()=>true),
 e=>e.code==="DRAWIO_REPLAY_FILE_INVALID");n++;
await assert.rejects(replayDrawioSavedReportFiles(
 mkfile("source.drawio",raw),mkfile("../report.json",reportBytes),live,true,()=>true),
 e=>e.code==="DRAWIO_REPLAY_FILE_INVALID");n++;
await assert.rejects(replayDrawioSavedReportFiles(
 mkfile("source.drawio",raw),mkfile("report.json",reportBytes),live,false,()=>true),
 e=>e.code==="DRAWIO_REPLAY_CONSENT_REQUIRED");n++;
valid=false;
await assert.rejects(replay(),e=>e.code==="DRAWIO_REPLAY_STALE");n++;
valid=true;
const staleOriginal=mkfile("source.drawio",raw);
const changingReport={name:"report.json",size:reportBytes.length,async arrayBuffer(){
 state={...modelSnapshot,sourceRevision:6};
 return reportBytes.buffer.slice(reportBytes.byteOffset,reportBytes.byteOffset+reportBytes.byteLength);
}};
await assert.rejects(replayDrawioSavedReportFiles(staleOriginal,changingReport,live,true,()=>true),
 e=>e.code==="DRAWIO_REPLAY_STALE");n++;
state=modelSnapshot;
eq(JSON.stringify(modelSnapshot),unchanged);
eq(JSON.stringify(report),originalReport);
const ui=renderToStaticMarkup(React.createElement(DrawioSavedReferenceReplayPanel,{
 model:modelSnapshot,onReplay(){throw Error("SSR run");},onClose(){throw Error("SSR close");}}));
for(const term of ['data-drawio-replay-panel="TOPOLOGY_DECLARED"',
 'data-drawio-replay-original="true"','data-drawio-replay-report="true"',
 'data-drawio-replay-consent="true"','data-drawio-replay-verify="true"',
 'data-drawio-replay-truth="true"','disabled=""']){
 assert.ok(ui.includes(term),term);n++;
}
for(const term of [SECRET,"192.0.2.23","vertexA","hiddenB","source XML"]){
 eq(ui.includes(term),false);
}
for(const path of ["enterprise-import/src/drawio-report-replay.ts",
 "ui/src/browser/drawio-report-replay-file.ts",
 "ui/app/drawio-reference-replay-panel.mjs"]){
 const content=fs.readFileSync(path,"utf8");
 for(const banned of ["fetch(","localStorage","indexedDB","setWorkspace(","dangerouslySetInnerHTML"]){
  eq(content.includes(banned),false,"No mutations in "+path);
 }
}
const main=fs.readFileSync("ui/app/main.mjs","utf8");
assert.match(main,/data-inspect-drawio-replay/);n++;
assert.match(main,/replayDrawioSavedReportFiles\(/);n++;
assert.match(main,/latestDrawioWorkspaceRef\.current/);n++;
console.log("PASS DRAWIO P5 "+n+" original-file replay canonical sidecar, privacy, forged claims, stale state, SSR");
