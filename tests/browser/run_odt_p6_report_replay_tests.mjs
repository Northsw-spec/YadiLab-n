import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeOdtZip, packageEntries, table, content as odtContent } from "../enterprise-import/odt_test_package.mjs";
import { previewOdtTableStructure } from "../../dist-browser-test/enterprise-import/src/odt-tables-structural-preview.js";
import { discloseReviewedOdtCell } from "../../dist-browser-test/enterprise-import/src/odt-cell-disclosure.js";
import { reviewOdtCellAssociation } from "../../dist-browser-test/enterprise-import/src/odt-association-review.js";
import { reviewOdtMultiReferences } from "../../dist-browser-test/enterprise-import/src/odt-multi-reference-review.js";
import { replayReviewedOdtReferences } from "../../dist-browser-test/enterprise-import/src/odt-report-replay.js";
import { replaySavedOdtReportFiles } from "../../dist-browser-test/ui/src/browser/odt-report-replay-file.js";
import { OdtReferenceReplayPanel } from "../../ui/app/odt-reference-replay-panel.mjs";

const enc=s=>new TextEncoder().encode(s);
const secret="DO_NOT_DISPLAY_ODT_SECRET_9234";
const rows=[["Host","Password"],["node01",secret],["node02","abc123"]];
const source=makeOdtZip(packageEntries({tables:[table(rows)]}));
const preview=await previewOdtTableStructure(source);
const model={scenarioId:"org_lab_12",sourceRevision:6,resources:[
 {id:"model_host",label:"Server Model"},{id:"model_switch",label:"Switch Model"}]};
const makeSidecar=async(row,resource)=>{
 const locator=preview.tables[0].rows[row].cells[0].locator;
 const cell=await discloseReviewedOdtCell(source,preview.sourceSha256,locator,true);
 const result=reviewOdtCellAssociation(cell,model,{
  sourceSha256:preview.sourceSha256,scenarioId:model.scenarioId,sourceRevision:model.sourceRevision,
  targetResourceId:resource,acknowledgeNotVerified:true,
 });
 assert.equal(result.status,"READY_FOR_EXPORT");
 return result.sidecar;
};
const p4a=await makeSidecar(1,"model_host");
const p4b=await makeSidecar(2,"model_switch");
const p5Review=reviewOdtMultiReferences([p4a,p4b],model,{
 sourceSha256:preview.sourceSha256,scenarioId:model.scenarioId,sourceRevision:model.sourceRevision,
 acknowledgeNotVerified:true,
});
assert.equal(p5Review.status,"READY_FOR_EXPORT");
const p5=p5Review.sidecar;
const file=(name,bytes)=>({name,size:bytes.byteLength,
 async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}});
const report=s=>enc(JSON.stringify(s));
let assertions=0;
function eq(a,b,label){assert.deepEqual(a,b,label);assertions++;}
async function fail(odt,raw,mod,consent,code){
 await assert.rejects(replayReviewedOdtReferences(odt,raw,mod,consent),
  err=>err?.code===code && !JSON.stringify(err).includes(secret),code);
 assertions++;
}
for(const [original,n,format] of [[p4a,1,"yadilab.odt-reviewed-cell-references"],
 [p5,2,"yadilab.odt-reviewed-multi-references"]]){
 const first=await replayReviewedOdtReferences(source,report(original),model,true);
 eq(first.status,"REFERENCE_REPLAY_MATCH");
 eq(first.sourceSha256,preview.sourceSha256);
 eq(first.referencesChecked,n);
 eq(first.reportFormat,format);
 eq(first.semanticTrack,"CONFIG_DOCUMENTED");
 eq(first.engineVerified,false);
 eq(first.physicalTopologyVerified,false);
 eq(first.identityVerified,false);
 eq(first.modelMutated,false);
 eq(JSON.stringify(first).includes(secret),false);
 eq(JSON.stringify(first).includes("node01"),false);
 const bridged=await replaySavedOdtReportFiles(file("source.ODT",source),
  file("review.JSON",report(original)),model,true);
 eq(bridged,first);
 await fail(source,report(original),model,false,"ODT_REPLAY_CONSENT_REQUIRED");
 await fail(source,report(original),null,true,"ODT_REPLAY_BUILDER_REQUIRED");
 await fail(source,report(original),{...model,sourceRevision:7},true,"ODT_REPLAY_MODEL_MISMATCH");
 await fail(source,report(original),{...model,resources:model.resources.slice(1)},true,"ODT_REPLAY_MODEL_MISMATCH");
 await fail(source,report({...original,engineVerified:true}),model,true,"ODT_REPLAY_REPORT_MISMATCH");
 await fail(source,report({...original,physicalTopologyVerified:true}),model,true,"ODT_REPLAY_REPORT_MISMATCH");
 await fail(source,report({...original,extra:secret}),model,true,"ODT_REPLAY_REPORT_MISMATCH");
 await fail(source,report({...original,warnings:["forged"]}),model,true,"ODT_REPLAY_REPORT_MISMATCH");
}
const mutated=makeOdtZip(packageEntries({tables:[table([["Host","Password"],["node03",secret],["node02","abc123"]])]}));
await fail(mutated,report(p4a),model,true,"ODT_REPLAY_SOURCE_CHANGED");
await fail(mutated,report(p5),model,true,"ODT_REPLAY_SOURCE_CHANGED");
await fail(enc("invalid zip"),report(p4a),model,true,"ODT_REPLAY_SOURCE_BLOCKED");
const dtdXml=odtContent([table(rows)]).replace("<office:body>",
 '<!DOCTYPE office:document-content [<!ENTITY unsafe SYSTEM "file:///etc/passwd">]><office:body>');
const dtd=makeOdtZip(packageEntries({contentXml:dtdXml}));
await fail(dtd,report(p4a),model,true,"ODT_REPLAY_SOURCE_BLOCKED");
await fail(source,enc("not JSON"),model,true,"ODT_REPLAY_REPORT_INVALID");
await fail(source,new Uint8Array([0xff,0xfe,0xfd]),model,true,"ODT_REPLAY_REPORT_INVALID");
await fail(source,report([]),model,true,"ODT_REPLAY_REPORT_INVALID");
await fail(source,report({...p4a,formatId:"yadilab.malicious"}),model,true,"ODT_REPLAY_FORMAT_UNSUPPORTED");
await fail(source,report({...p4a,source:{...p4a.source,sha256:"0".repeat(64)}}),
 model,true,"ODT_REPLAY_SOURCE_CHANGED");
await fail(source,report({...p4a,source:{...p4a.source,cellLocator:{...p4a.source.cellLocator,rowOrdinal:99}}}),
 model,true,"ODT_REPLAY_SOURCE_BLOCKED");
await fail(source,report({...p5,references:[...p5.references,p5.references[0]]}),
 model,true,"ODT_REPLAY_REPORT_MISMATCH");
await fail(source,report({...p5,references:[p5.references[0]]}),
 model,true,"ODT_REPLAY_COUNT_INVALID");
await fail(source,new Uint8Array(65537),model,true,"ODT_REPLAY_REPORT_SIZE_INVALID");
await fail(new Uint8Array(16*1024*1024+1),report(p4a),model,true,"ODT_REPLAY_ODT_SIZE_INVALID");
const credential=preview.tables[0].rows[1].cells[1].locator;
await fail(source,report({...p4a,source:{...p4a.source,cellLocator:credential}}),
 model,true,"ODT_REPLAY_SOURCE_BLOCKED");
for(const [odtName,reportName] of [
 ["source.doc","saved.json"],
 ["source.odt","saved.txt"],
 ["../source.odt","saved.json"]]){
 await assert.rejects(replaySavedOdtReportFiles(file(odtName,source),
  file(reportName,report(p4a)),model,true),err=>err.code==="ODT_REPLAY_FILE_INVALID");assertions++;
}
await assert.rejects(replaySavedOdtReportFiles(file("source.odt",source),
 file("saved.json",new Uint8Array(65537)),model,true),
 err=>err.code==="ODT_REPLAY_FILE_SIZE_INVALID");assertions++;
const markup=renderToStaticMarkup(React.createElement(OdtReferenceReplayPanel,{
 model,onReplay(){throw Error("SSR must not execute");},onClose(){throw Error("SSR must not close");}
}));
for(const marker of ['data-odt-replay-panel="CONFIG_DOCUMENTED"',
 'data-odt-replay-original="true"','data-odt-replay-report="true"',
 'data-odt-replay-consent="true"','data-odt-replay-verify="true"',
 'data-odt-replay-boundary="true"','disabled=""','read-only']){
 assert.ok(markup.includes(marker),marker);assertions++;
}
for(const forbidden of [secret,"node01","abc123","data-odt-replay-result"]){
 eq(markup.includes(forbidden),false);
}
const runtime=renderToStaticMarkup(React.createElement(OdtReferenceReplayPanel,{
 model:null,onReplay(){throw Error("SSR must not execute");},onClose(){throw Error("SSR must not close");}
}));
eq(runtime.includes('data-odt-replay-no-builder="true"'),true);
const fs=await import("node:fs");
const main=fs.readFileSync("ui/app/main.mjs","utf8");
for(const pattern of [/data-inspect-odt-replay": "CONFIG_DOCUMENTED"/,
 /odtReplayOpen \? e\(OdtReferenceReplayPanel/,
 /return replaySavedOdtReportFiles\(odtFile, reportFile, currentModel, acknowledged\)/]){
 assert.match(main,pattern);assertions++;
}
for(const path of ["ui/app/odt-reference-replay-panel.mjs","enterprise-import/src/odt-report-replay.ts"]){
 const text=fs.readFileSync(path,"utf8");
 for(const forbidden of ["setWorkspace(", "dangerouslySetInnerHTML", "localStorage", "indexedDB", "console.log(", "fetch("]){
  eq(text.includes(forbidden),false,"No side effects in "+path);
 }
}
console.log("PASS ODT P6 "+assertions+" synthetic ZIP, canonical saved reports, source/revision/secret gates, UI SSR and no Engine");
