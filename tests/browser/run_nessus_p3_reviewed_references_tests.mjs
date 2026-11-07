import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { previewNessusSeveritySummary } from "../../dist-browser-test/enterprise-import/src/nessus-v2-preview.js";
import { reviewNessusHostReferences } from "../../dist-browser-test/enterprise-import/src/nessus-association-review.js";
import { reviewNessusOriginalFileAssociations } from "../../dist-browser-test/ui/src/browser/nessus-association-file.js";
import { NessusHostAssociationReview } from "../../ui/app/nessus-association-review.mjs";
import { NessusSeverityPanel } from "../../ui/app/nessus-severity-panel.mjs";
import fs from "node:fs";

const secret="DO_NOT_EXPORT_CREDENTIAL_HOST_NAME_4471";
const xml=(value=secret)=>`<?xml version="1.0" encoding="UTF-8"?>
<NessusClientData_v2><Report name="SECRET-REPORT">
 <ReportHost name="SECRET-HOST-192.0.2.99"><HostProperties><tag name="host-ip">192.0.2.99</tag></HostProperties>
 <ReportItem pluginID="19506" port="443" protocol="tcp" severity="3"><plugin_output>${value}</plugin_output></ReportItem></ReportHost>
 <ReportHost name="SECRET-HOST-2"><ReportItem pluginID="13536" port="22" protocol="tcp" severity="1"><description>TOP-SECRET-CVE-TEXT</description></ReportItem></ReportHost>
</Report></NessusClientData_v2>`;
const enc=s=>new TextEncoder().encode(s);
const bytes=enc(xml());
const preview=await previewNessusSeveritySummary(bytes);
const model={scenarioId:"org_labs_123",sourceRevision:3,resources:[
 {id:"server_1",label:"Server model"},{id:"switch_1",label:"Switch model"}]};
const decision={sourceSha256:preview.sourceSha256,scenarioId:model.scenarioId,
 sourceRevision:model.sourceRevision,acknowledgeNotVerified:true,
 references:[{hostOrdinal:1,targetResourceId:"switch_1"},{hostOrdinal:0,targetResourceId:"server_1"}]};
const file=(name,source)=>({name,size:source.byteLength,async arrayBuffer(){
 return source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength);
}});
let checks=0;
function eq(x,y,label){assert.deepEqual(x,y,label);checks++;}
const rawBefore=JSON.stringify(preview),modelBefore=JSON.stringify(model);
const approved=reviewNessusHostReferences(preview,model,decision);
eq(approved.status,"READY_FOR_EXPORT");
const sidecar=approved.sidecar;
eq(sidecar.schemaVersion,"1.0.0");
eq(sidecar.formatId,"yadilab.nessus-reviewed-host-references");
eq(sidecar.status,"REVIEWED_ASSOCIATIONS_ONLY");
eq(sidecar.source.sha256,preview.sourceSha256);
eq(sidecar.targetModel,{scenarioId:"org_labs_123",sourceRevision:3});
eq(sidecar.associations.map(r=>r.hostLocator.hostOrdinal),[0,1]);
eq(sidecar.associations.map(r=>r.targetResourceId),["server_1","switch_1"]);
eq(sidecar.associations.every(r=>r.hostLocator.kind==="nessus-report-host" &&
 r.hostLocator.sourceSha256===preview.sourceSha256),true);
eq(sidecar.associations.every(r=>r.assertion==="USER_ASSERTED_ASSOCIATION_NOT_VERIFIED"),true);
for(const flag of ["engineVerified","identityVerified","physicalTopologyVerified","modelMutated"]){
 eq(sidecar[flag],false);
}
eq(sidecar.source.semanticTrack,"EVIDENCE_OBSERVED");
eq(Object.hasOwn(sidecar,"resources"),false);
eq(Object.hasOwn(sidecar,"connections"),false);
eq(Object.hasOwn(sidecar,"pluginOutput"),false);
eq(JSON.stringify(preview),rawBefore);
eq(JSON.stringify(model),modelBefore);
const bridged=await reviewNessusOriginalFileAssociations(file("actual.nessus",bytes),preview,()=>model,decision,()=>true);
eq(bridged,sidecar);
const sensitive=[secret,"SECRET-HOST","192.0.2.99","13536","19506",
 "TOP-SECRET-CVE-TEXT","SECRET-REPORT","plugin_output","description"];
for(const x of sensitive)eq(JSON.stringify(sidecar).includes(x),false,"No leaked source value "+x);
function blocked(d,code,m=model,p=preview){
 const r=reviewNessusHostReferences(p,m,d);
 eq(r.status,"BLOCKED",code);
 eq(r.diagnostics[0].code,code);
 eq(Object.hasOwn(r,"sidecar"),false);
}
blocked({...decision,acknowledgeNotVerified:false},"NESSUS_ASSOC_ACK_REQUIRED");
blocked({...decision,sourceSha256:"0".repeat(64)},"NESSUS_ASSOC_STALE");
blocked({...decision,scenarioId:"another"},"NESSUS_ASSOC_STALE");
blocked({...decision,sourceRevision:4},"NESSUS_ASSOC_STALE");
blocked(decision,"NESSUS_ASSOC_STALE",{...model,sourceRevision:4});
blocked(decision,"NESSUS_ASSOC_BUILDER_REQUIRED",null);
blocked(decision,"NESSUS_ASSOC_MODEL_INVALID",{...model,resources:[model.resources[0],model.resources[0]]});
blocked(decision,"NESSUS_ASSOC_MODEL_INVALID",{...model,resources:[{id:"__proto__",label:"bad"}]});
blocked({...decision,references:[]},"NESSUS_ASSOC_COUNT_INVALID");
blocked({...decision,references:[{hostOrdinal:2,targetResourceId:"server_1"}]},"NESSUS_ASSOC_SELECTION_INVALID");
blocked({...decision,references:[{hostOrdinal:-1,targetResourceId:"server_1"}]},"NESSUS_ASSOC_SELECTION_INVALID");
blocked({...decision,references:[{hostOrdinal:0.5,targetResourceId:"server_1"}]},"NESSUS_ASSOC_SELECTION_INVALID");
blocked({...decision,references:[{hostOrdinal:0,targetResourceId:"unknown"}]},"NESSUS_ASSOC_SELECTION_INVALID");
blocked({...decision,references:[{hostOrdinal:0,targetResourceId:"server_1"},{hostOrdinal:0,targetResourceId:"switch_1"}]},"NESSUS_ASSOC_SELECTION_INVALID");
blocked({...decision,references:[{hostOrdinal:0,targetResourceId:"server_1"},{hostOrdinal:1,targetResourceId:"server_1"}]},"NESSUS_ASSOC_SELECTION_INVALID");
blocked({...decision,references:Array.from({length:21},(_,i)=>({hostOrdinal:i,targetResourceId:"server_1"}))},"NESSUS_ASSOC_COUNT_INVALID");
blocked(decision,"NESSUS_ASSOC_SOURCE_INVALID",model,{...preview,canActivate:true});
blocked(decision,"NESSUS_ASSOC_SOURCE_INVALID",model,{...preview,severityCounts:[9,9,9,9,9]});
async function blockedBridge(data,p,d,code,m=model){
 await assert.rejects(reviewNessusOriginalFileAssociations(file("actual.nessus",data),p,()=>m,d,()=>true),
   e=>e?.code===code && !JSON.stringify(e).includes(secret),code);checks++;
}
await blockedBridge(enc(xml("MODIFIED_SECRET")),preview,decision,"NESSUS_P5_SOURCE_CHANGED");
await blockedBridge(enc('<!DOCTYPE NessusClientData_v2 [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><NessusClientData_v2/>'),
 preview,decision,"NESSUS_P5_SOURCE_BLOCKED");
await blockedBridge(bytes,preview,{...decision,acknowledgeNotVerified:false},"NESSUS_ASSOC_ACK_REQUIRED");
await blockedBridge(bytes,preview,decision,"NESSUS_ASSOC_BUILDER_REQUIRED",null);
await blockedBridge(bytes,preview,{...decision,sourceRevision:66},"NESSUS_ASSOC_STALE");
const ssr=renderToStaticMarkup(React.createElement(NessusHostAssociationReview,{
 preview,model,onExport(){throw Error("SSR export");}
}));
for(const marker of ['data-nessus-association-review="REVIEW_REQUIRED"',
 'data-nessus-associate-host="0"','data-nessus-associate-host="1"',
 'data-nessus-association-ack="true"','data-nessus-association-export="true"',
 'data-nessus-selected-count="0"','disabled=""']){
 assert.ok(ssr.includes(marker),"Missing UI marker "+marker);checks++;
}
for(const text of sensitive)eq(ssr.includes(text),false,"SSR secret "+text);
const runtime=renderToStaticMarkup(React.createElement(NessusHostAssociationReview,{
 preview,model:null,onExport(){throw Error("SSR export");}
}));
eq(runtime.includes('data-nessus-no-builder="true"'),true);
const panel=renderToStaticMarkup(React.createElement(NessusSeverityPanel,{
 inspectFile(){throw Error("SSR file read");},onClose(){throw Error("SSR close");}
}));
eq(panel.includes('data-nessus-summary="EVIDENCE_ONLY"'),false);
const main=fs.readFileSync("ui/app/main.mjs","utf8");
assert.match(fs.readFileSync("ui/app/nessus-severity-panel.mjs","utf8"),/return onExportReviewed\(source,result,decision/);checks++;
assert.match(main,/reviewNessusOriginalFileAssociations\(/);checks++;
assert.match(main,/if \(!isCurrent\(\)\)/);checks++;
for(const path of ["enterprise-import/src/nessus-association-review.ts",
 "ui/app/nessus-association-review.mjs","ui/src/browser/nessus-association-file.ts"]){
 const contents=fs.readFileSync(path,"utf8");
 for(const word of ["setWorkspace(","dangerouslySetInnerHTML","localStorage","indexedDB","console.log(","fetch("]){
  eq(contents.includes(word),false,"No mutations "+path);
 }
}
console.log("PASS NESSUS P3 "+checks+" source-bound metadata-only synthetic Nessus ZIP-free XML, no installed Nessus, privacy, stale and SSR");
