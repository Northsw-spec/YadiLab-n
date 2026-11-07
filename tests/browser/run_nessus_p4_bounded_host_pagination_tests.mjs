import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import fs from "node:fs";
import {previewNessusSeveritySummary} from "../../dist-browser-test/enterprise-import/src/nessus-v2-preview.js";
import {reviewNessusHostReferences} from "../../dist-browser-test/enterprise-import/src/nessus-association-review.js";
import {reviewNessusOriginalFileAssociations} from "../../dist-browser-test/ui/src/browser/nessus-association-file.js";
import {NessusHostAssociationReview} from "../../ui/app/nessus-association-review.mjs";

const secret="SENSITIVE_REPORT_HOST_P4_SECRET_CANARY";
const xml=n=>new TextEncoder().encode(
 `<?xml version="1.0"?><NessusClientData_v2><Report name="PRIVATE_REPORT_CANARY">`+
 Array.from({length:n},(_,i)=>`<ReportHost name="${secret}_${i}">
 <HostProperties><tag name="host-ip">192.0.2.88</tag></HostProperties>
 <ReportItem pluginID="19506" port="443" protocol="tcp" severity="3">
 <plugin_output>DO_NOT_EXPOSE_PRIVATE_PLUGIN</plugin_output></ReportItem>
 </ReportHost>`).join("")+"</Report></NessusClientData_v2>");
const file=(raw,name="report.nessus")=>({name,size:raw.byteLength,async arrayBuffer(){return raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)}});
const model={scenarioId:"site_existing",sourceRevision:4,
 resources:Array.from({length:25},(_,i)=>({id:`res_${i}`,label:`Existing ${i}`}))};
const before=JSON.stringify(model);
let checks=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++};
for(const count of [2,21,41,256]){
 const raw=xml(count),p=await previewNessusSeveritySummary(raw);
 eq(p.hostCount,count,"Original parser retains up to 256 host positions");
 eq(p.findingCount,count,"Every original ReportItem counted");
 eq(p.severityCounts,[0,0,0,count,0],"Aggregate only");
 const last=count-1;
 const decision={sourceSha256:p.sourceSha256,scenarioId:model.scenarioId,
   sourceRevision:4,acknowledgeNotVerified:true,references:[
   {hostOrdinal:0,targetResourceId:"res_0"},
   {hostOrdinal:last,targetResourceId:"res_1"}]};
 const review=reviewNessusHostReferences(p,model,decision);
 eq(review.status,"READY_FOR_EXPORT","Later original source ordinal supported");
 const report=review.sidecar;
 eq(report.schemaVersion,"1.0.0","Existing v1 sidecar preserved");
 eq(report.formatId,"yadilab.nessus-reviewed-host-references");
 eq(report.associations.map(r=>r.hostLocator.hostOrdinal),[0,last]);
 eq(report.associations.every(r=>r.hostLocator.sourceSha256===p.sourceSha256),true);
 for(const key of ["engineVerified","physicalTopologyVerified","identityVerified","modelMutated"])eq(report[key],false);
 for(const token of [secret,"192.0.2.88","19506","DO_NOT_EXPOSE_PRIVATE_PLUGIN","PRIVATE_REPORT_CANARY"]){
   eq(JSON.stringify(report).includes(token),false,"No Nessus private XML in JSON");
 }
 const original=await reviewNessusOriginalFileAssociations(file(raw),p,()=>model,decision,()=>true);
 eq(original,report,"P3 original-file reparse supports late ordinal");
 const ssr=renderToStaticMarkup(React.createElement(NessusHostAssociationReview,{preview:p,model,onExport(){}}));
 eq((ssr.match(/data-nessus-associate-host=/g)||[]).length,Math.min(count,20),"Only page selectors rendered");
 eq(ssr.includes('data-nessus-associate-host="20"'),false,"Other positions not present in page 1 DOM");
 eq(ssr.includes('data-nessus-association-range="0:'+String(Math.min(count,20)-1)+'"'),true);
 eq(ssr.includes('data-nessus-page-next="true"'),true);
 eq(ssr.includes('data-nessus-page-next="true" disabled=""'),count<=20);
 for(const token of [secret,"192.0.2.88","DO_NOT_EXPOSE_PRIVATE_PLUGIN","PRIVATE_REPORT_CANARY"]){
   eq(ssr.includes(token),false,"No private source in review DOM");
 }
 const wrong=reviewNessusHostReferences(p,model,{...decision,references:[
   {hostOrdinal:count,targetResourceId:"res_0"}]});
 eq(wrong.status,"BLOCKED","Out of preview bounds");
 eq(wrong.diagnostics[0].code,"NESSUS_ASSOC_SELECTION_INVALID");
 const dup=reviewNessusHostReferences(p,model,{...decision,references:[
   {hostOrdinal:0,targetResourceId:"res_0"},
   {hostOrdinal:last,targetResourceId:"res_0"}]});
 eq(dup.status,"BLOCKED","Different-page same target blocked");
 const stale=reviewNessusHostReferences({...p,sourceSha256:"a".repeat(64)},model,decision);
 eq(stale.status,"BLOCKED","Old SHA denied");
 eq(stale.diagnostics[0].code,"NESSUS_ASSOC_STALE");
}
const raw=xml(256),p=await previewNessusSeveritySummary(raw);
const references=Array.from({length:20},(_,i)=>({hostOrdinal:i*12,targetResourceId:`res_${i}`}));
const valid=reviewNessusHostReferences(p,model,{sourceSha256:p.sourceSha256,
 scenarioId:model.scenarioId,sourceRevision:4,acknowledgeNotVerified:true,references});
eq(valid.status,"READY_FOR_EXPORT","20 cross-window references permitted");
eq(valid.sidecar.associations.at(-1).hostLocator.hostOrdinal,228);
const base={sourceSha256:p.sourceSha256,scenarioId:model.scenarioId,sourceRevision:4,
 acknowledgeNotVerified:true,references};
const denied=reviewNessusHostReferences(p,model,{...base,references:[
 ...references,{hostOrdinal:255,targetResourceId:"res_20"}]});
eq(denied.status,"BLOCKED","21st reference denied");
eq(denied.diagnostics[0].code,"NESSUS_ASSOC_COUNT_INVALID");
eq(reviewNessusHostReferences(p,model,{...base,references:[
 {hostOrdinal:256,targetResourceId:"res_0"}]}).status,"BLOCKED","256 outside valid ordinals");
eq(reviewNessusHostReferences(p,model,{...base,references:[
 {hostOrdinal:255.2,targetResourceId:"res_0"}]}).status,"BLOCKED","Fractional ordinal");
eq(reviewNessusHostReferences(p,model,{...base,references:[
 {hostOrdinal:255,targetResourceId:"res_0"},{hostOrdinal:1,targetResourceId:"res_0"}]}).status,"BLOCKED","Duplicate target");
eq(JSON.stringify(model),before,"No Builder mutation");
await assert.rejects(previewNessusSeveritySummary(xml(257)),e=>e?.code==="NESSUS_XML_HOST_BUDGET");checks++;
await assert.rejects(reviewNessusOriginalFileAssociations(file(xml(255)),p,()=>model,base,()=>true),
 e=>e?.code==="NESSUS_P5_SOURCE_CHANGED");checks++;
const ui=fs.readFileSync("ui/app/nessus-association-review.mjs","utf8");
for(const k of ["PAGE_SIZE=20","MAX_REFERENCES=20","data-nessus-page-previous",
 "data-nessus-page-next","data-nessus-association-cap","firstOrdinal+index",
 "selectedCount>=MAX_REFERENCES","setAck(false)"]){eq(ui.includes(k),true,"UI contract "+k)}
for(const k of ["setWorkspace(","fetch(","dangerouslySetInnerHTML","localStorage","indexedDB"]){
 eq(ui.includes(k),false,"No network/Builder mutation");
}
console.log("PASS NESSUS P4 "+checks+" original-host 2/21/41/256, 20-reference cap, privacy, source reread and no Engine");
