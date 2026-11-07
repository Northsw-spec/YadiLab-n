import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import { previewDrawioStructure } from "../../dist-browser-test/enterprise-import/src/drawio-structural-preview.js";
import { reviewDrawioVertexAssociations, validDrawioSummary } from "../../dist-browser-test/enterprise-import/src/drawio-association-review.js";
import { reviewDrawioOriginalFileReferences } from "../../dist-browser-test/ui/src/browser/drawio-association-file.js";
import { DrawioVertexAssociationReview } from "../../ui/app/drawio-association-review.mjs";
import { DrawioStructurePanel } from "../../ui/app/drawio-structure-panel.mjs";

const secret="SOURCE_PRIVATE_HOST_203.0.113.16_CREDENTIAL_905";
const root='<mxCell id="0"/><mxCell id="1" parent="0"/>';
const vertex=(id)=>'<mxCell id="'+id+'" vertex="1" parent="1" value="'+secret+'"/>';
const edge='<mxCell id="physical_NO" edge="1" parent="1" source="s1" target="s2"/>';
const model=(cells)=>'<mxGraphModel><root>'+root+cells+'</root></mxGraphModel>';
const pack=(xml)=>deflateRawSync(Buffer.from(encodeURIComponent(xml),"ascii")).toString("base64");
const xml=(text=secret)=>'<?xml version="1.0" encoding="UTF-8"?><mxfile>'+
 '<diagram id="SECRET_PAGE1" name="'+text+'">'+model(vertex("s1")+vertex("s2")+edge)+'</diagram>'+
 '<diagram id="SECRET_PAGE2">'+pack(model(vertex("s3")))+'</diagram></mxfile>';
const bytes=new TextEncoder().encode(xml());
const sha=createHash("sha256").update(bytes).digest("hex");
const preview=await previewDrawioStructure(bytes);
const builder={scenarioId:"demo_1",sourceRevision:4,resources:[
 {id:"resource_server",label:"Server in Builder"},
 {id:"resource_switch",label:"Switch in Builder"},
 {id:"resource_client",label:"Client in Builder"}
]};
const decision={sourceSha256:sha,scenarioId:builder.scenarioId,sourceRevision:builder.sourceRevision,
 acknowledgeNotVerified:true,references:[
 {pageOrdinal:1,vertexOrdinal:0,targetResourceId:"resource_switch"},
 {pageOrdinal:0,vertexOrdinal:1,targetResourceId:"resource_server"}]};
let count=0;
function eq(a,b,label){assert.deepEqual(a,b,label);count++;}
function file(name,raw){return {name,size:raw.byteLength,async arrayBuffer(){
 return raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
}};}
const before=JSON.stringify(builder),original=JSON.stringify(preview);
eq(validDrawioSummary(preview),true);
eq(preview.pageCount,2);
eq(preview.compressedPageCount,1);
eq(preview.vertexCount,3);
eq(preview.drawnEdgeCount,1);
const review=reviewDrawioVertexAssociations(preview,builder,decision);
eq(review.status,"READY_FOR_EXPORT");
const sidecar=review.sidecar;
eq(sidecar.formatId,"yadilab.drawio-reviewed-vertex-references");
eq(sidecar.schemaVersion,"1.0.0");
eq(sidecar.status,"REVIEWED_ASSOCIATIONS_ONLY");
eq(sidecar.source,{profileId:preview.profileId,sha256:sha,semanticTrack:"TOPOLOGY_DECLARED"});
eq(sidecar.targetModel,{scenarioId:"demo_1",sourceRevision:4});
eq(sidecar.associations.map(x=>[x.locator.pageOrdinal,x.locator.vertexOrdinal]),
 [[0,1],[1,0]]);
eq(sidecar.associations.map(x=>x.targetResourceId),["resource_server","resource_switch"]);
eq(sidecar.associations.every(x=>x.locator.kind==="drawio-vertex-ordinal" &&
 x.locator.sourceSha256===sha && x.assertion==="USER_ASSERTED_ASSOCIATION_NOT_VERIFIED"),true);
for(const name of ["identityVerified","engineVerified","physicalTopologyVerified","modelMutated"])eq(sidecar[name],false);
eq(sidecar.associations.some(x=>Object.hasOwn(x,"edge")),false);
eq(Object.hasOwn(sidecar,"connections"),false);
eq(JSON.stringify(sidecar).includes(secret),false);
for(const secretValue of [secret,"203.0.113.16","SECRET_PAGE1","SECRET_PAGE2","physical_NO",
 "s1","s2","s3","mxCell","credential"]){
 if(secretValue==="s1"||secretValue==="s2"||secretValue==="s3")continue;
 eq(JSON.stringify(sidecar).includes(secretValue),false,"source data leak");
}
for(const forbiddenKey of ['"sourceId":','"targetId":','"nodeId":','"diagramId":','"edgeId":']){
 eq(JSON.stringify(sidecar).includes(forbiddenKey),false,"No source key "+forbiddenKey);
}
eq(JSON.stringify(builder),before);
eq(JSON.stringify(preview),original);
const current=()=>builder;
const checked=await reviewDrawioOriginalFileReferences(
 file("source.drawio",bytes),preview,current,decision,()=>true);
eq(checked,sidecar);
async function rejectBridge(raw,expectCode,p=preview,d=decision,modelFn=current,currentFn=()=>true){
 await assert.rejects(reviewDrawioOriginalFileReferences(file("source.drawio",raw),p,modelFn,d,currentFn),
  e=>e?.code===expectCode&&!String(e.message).includes(secret),expectCode);count++;
}
const changed=new TextEncoder().encode(xml("DIFFERENT_SOURCE_SAME_NAME"));
await rejectBridge(changed,"DRAWIO_ASSOC_SOURCE_CHANGED");
await rejectBridge(bytes,"DRAWIO_ASSOC_STALE",preview,decision,current,()=>false);
await rejectBridge(bytes,"DRAWIO_ASSOC_BUILDER_REQUIRED",preview,decision,()=>null);
await rejectBridge(bytes,"DRAWIO_ASSOC_ACK_REQUIRED",preview,{...decision,acknowledgeNotVerified:false});
await rejectBridge(new TextEncoder().encode('<!DOCTYPE mxfile [<!ENTITY x SYSTEM "file:///etc/passwd">]><mxfile/>'),
 "IMPORT_XML_DTD_FORBIDDEN");
await rejectBridge(new TextEncoder().encode('<mxfile><diagram id="bad">badBase64!!!</diagram></mxfile>'),
 "DRAWIO_BASE64_INVALID");
let snapshotCount=0;
await rejectBridge(bytes,"DRAWIO_ASSOC_STALE",preview,decision,
 ()=>{snapshotCount++;return {...builder,sourceRevision:4+(snapshotCount>1?1:0)};});
function blocked(d,code,m=builder,p=preview){
 const r=reviewDrawioVertexAssociations(p,m,d);
 eq(r.status,"BLOCKED");eq(r.diagnostics[0].code,code);
 eq(Object.hasOwn(r,"sidecar"),false);
}
blocked({...decision,acknowledgeNotVerified:false},"DRAWIO_ASSOC_ACK_REQUIRED");
blocked({...decision,sourceSha256:"0".repeat(64)},"DRAWIO_ASSOC_STALE");
blocked({...decision,sourceRevision:5},"DRAWIO_ASSOC_STALE");
blocked({...decision,scenarioId:"other"},"DRAWIO_ASSOC_STALE");
blocked(decision,"DRAWIO_ASSOC_BUILDER_REQUIRED",null);
blocked(decision,"DRAWIO_ASSOC_BUILDER_REQUIRED",{...builder,resources:[{id:"__proto__",label:"Bad"}]});
blocked(decision,"DRAWIO_ASSOC_BUILDER_REQUIRED",{...builder,resources:[builder.resources[0],builder.resources[0]]});
blocked({...decision,references:[]},"DRAWIO_ASSOC_COUNT_INVALID");
blocked({...decision,references:Array.from({length:21},(_,i)=>({pageOrdinal:0,vertexOrdinal:i,targetResourceId:"resource_server"}))},"DRAWIO_ASSOC_COUNT_INVALID");
blocked({...decision,references:[{pageOrdinal:-1,vertexOrdinal:0,targetResourceId:"resource_server"}]},"DRAWIO_ASSOC_SELECTION_INVALID");
blocked({...decision,references:[{pageOrdinal:0.5,vertexOrdinal:0,targetResourceId:"resource_server"}]},"DRAWIO_ASSOC_SELECTION_INVALID");
blocked({...decision,references:[{pageOrdinal:2,vertexOrdinal:0,targetResourceId:"resource_server"}]},"DRAWIO_ASSOC_SELECTION_INVALID");
blocked({...decision,references:[{pageOrdinal:0,vertexOrdinal:2,targetResourceId:"resource_server"}]},"DRAWIO_ASSOC_SELECTION_INVALID");
blocked({...decision,references:[{pageOrdinal:1,vertexOrdinal:1,targetResourceId:"resource_server"}]},"DRAWIO_ASSOC_SELECTION_INVALID");
blocked({...decision,references:[{pageOrdinal:0,vertexOrdinal:0.25,targetResourceId:"resource_server"}]},"DRAWIO_ASSOC_SELECTION_INVALID");
blocked({...decision,references:[{pageOrdinal:0,vertexOrdinal:1,targetResourceId:"unknown"}]},"DRAWIO_ASSOC_SELECTION_INVALID");
blocked({...decision,references:[{pageOrdinal:0,vertexOrdinal:1,targetResourceId:"__proto__"}]},"DRAWIO_ASSOC_SELECTION_INVALID");
blocked({...decision,references:[{pageOrdinal:0,vertexOrdinal:0,targetResourceId:"resource_server"},
 {pageOrdinal:0,vertexOrdinal:0,targetResourceId:"resource_switch"}]},"DRAWIO_ASSOC_DUPLICATE");
blocked({...decision,references:[{pageOrdinal:0,vertexOrdinal:0,targetResourceId:"resource_server"},
 {pageOrdinal:0,vertexOrdinal:1,targetResourceId:"resource_server"}]},"DRAWIO_ASSOC_DUPLICATE");
blocked(decision,"DRAWIO_ASSOC_SOURCE_INVALID",builder,{...preview,sourceSha256:"bad"});
blocked(decision,"DRAWIO_ASSOC_SOURCE_INVALID",builder,{...preview,canActivate:true});
blocked(decision,"DRAWIO_ASSOC_SOURCE_INVALID",builder,{...preview,vertexCount:22});
blocked(decision,"DRAWIO_ASSOC_SOURCE_INVALID",builder,{...preview,pages:[preview.pages[1],preview.pages[0]]});
blocked(decision,"DRAWIO_ASSOC_SOURCE_INVALID",builder,{...preview,compressedPageCount:3});
const ssr=renderToStaticMarkup(React.createElement(DrawioVertexAssociationReview,{
 preview,model:builder,onExport(){throw Error("SSR must not export");}
}));
for(const marker of ['data-drawio-association-review="REVIEW_REQUIRED"',
 'data-drawio-associate-vertex="0:0"','data-drawio-associate-vertex="0:1"',
 'data-drawio-associate-vertex="1:0"','data-drawio-association-ack="true"',
 'data-drawio-association-export="true"','data-drawio-reference-count="0"',
 'disabled=""']){
 assert.ok(ssr.includes(marker),marker);count++;
}
for(const value of [secret,"SECRET_PAGE1","physical_NO","203.0.113.16"]){
 eq(ssr.includes(value),false);
}
const noModel=renderToStaticMarkup(React.createElement(DrawioVertexAssociationReview,{
 preview,model:null,onExport(){} }));
eq(noModel.includes('data-drawio-no-builder="true"'),true);
const panel=renderToStaticMarkup(React.createElement(DrawioStructurePanel,{
 inspectFile(){throw Error("SSR read");},onClose(){throw Error("SSR close");}
}));
eq(panel.includes('data-drawio-panel="PREVIEW_ONLY"'),true);
eq(panel.includes('data-drawio-association-review='),false);
const panelSrc=fs.readFileSync("ui/app/drawio-structure-panel.mjs","utf8");
eq(panelSrc.includes("originalFile.current=file"),true);
eq(panelSrc.includes("originalFile.current=null"),true);
const main=fs.readFileSync("ui/app/main.mjs","utf8");
assert.match(main,/reviewDrawioOriginalFileReferences\(/);count++;
assert.match(main,/latestDrawioWorkspaceRef\.current/);count++;
for(const path of ["enterprise-import/src/drawio-association-review.ts",
 "ui/src/browser/drawio-association-file.ts","ui/app/drawio-association-review.mjs"]){
 const body=fs.readFileSync(path,"utf8");
 for(const forbidden of ["setWorkspace(","localStorage","indexedDB","fetch(","dangerouslySetInnerHTML"]){
  eq(body.includes(forbidden),false,"Mutation check "+path);
 }
}
console.log("PASS DRAWIO P4 "+count+" bounded mixed-compressed vertex references, replay, privacy, consent, stale Builder, SSR");
