import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZipJsArchiveBackend } from "../../dist-browser-test/package-io/src/zipjs-backend.js";
import { previewDocxTableStructure } from "../../dist-browser-test/enterprise-import/src/docx-tables-structural-preview.js";
import { discloseReviewedDocxCell } from "../../dist-browser-test/enterprise-import/src/docx-cell-disclosure.js";
import { reviewDocxCellAssociation } from "../../dist-browser-test/enterprise-import/src/docx-association-review.js";
import { reviewDocxMultiReferences } from "../../dist-browser-test/enterprise-import/src/docx-multi-reference-review.js";
import { replayReviewedDocxReferences } from "../../dist-browser-test/enterprise-import/src/docx-report-replay.js";
import { replaySavedDocxReportFiles } from "../../dist-browser-test/ui/src/browser/docx-report-replay-file.js";
import { DocxReferenceReplayPanel } from "../../ui/app/docx-reference-replay-panel.mjs";

const enc=s=>new TextEncoder().encode(s);
const secret="DO_NOT_DISPLAY_DOCX_SECRET_9234";
const t=value=>'<w:tc><w:p><w:r><w:t>'+value+'</w:t></w:r></w:p></w:tc>';
const tr=values=>'<w:tr>'+values.map(t).join("")+'</w:tr>';
const wordXml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>'+
 tr(["Host","Password"])+tr(["node01",secret])+tr(["node02","abc123"])+
 '</w:tbl></w:body></w:document>';
const files={
 "[Content_Types].xml":'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
 "_rels/.rels":'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
 "word/document.xml":wordXml,
};
const pack=async(fileset=files)=>{
 const zip=await new ZipJsArchiveBackend().write(Object.entries(fileset).map(([path,text])=>({path,bytes:enc(text)})));
 return new Uint8Array(await zip.arrayBuffer());
};
const source=await pack();
const preview=await previewDocxTableStructure(source);
const model={scenarioId:"org_lab_12",sourceRevision:6,resources:[
 {id:"model_host",label:"Server Model"},{id:"model_switch",label:"Switch Model"}]};
const makeSidecar=async(row,resource)=>{
 const locator=preview.tables[0].rows[row].cells[0].locator;
 const cell=await discloseReviewedDocxCell(source,preview.sourceSha256,locator,true);
 const result=reviewDocxCellAssociation(cell,model,{
  sourceSha256:preview.sourceSha256,scenarioId:model.scenarioId,sourceRevision:model.sourceRevision,
  targetResourceId:resource,acknowledgeNotVerified:true,
 });
 assert.equal(result.status,"READY_FOR_EXPORT");
 return result.sidecar;
};
const p4a=await makeSidecar(1,"model_host");
const p4b=await makeSidecar(2,"model_switch");
const p5Review=reviewDocxMultiReferences([p4a,p4b],model,{
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
async function fail(docx,raw,mod,consent,code){
 await assert.rejects(replayReviewedDocxReferences(docx,raw,mod,consent),
  err=>err?.code===code && !JSON.stringify(err).includes(secret),code);
 assertions++;
}
for(const [original,n,format] of [[p4a,1,"yadilab.docx-reviewed-cell-references"],
 [p5,2,"yadilab.docx-reviewed-multi-references"]]){
 const first=await replayReviewedDocxReferences(source,report(original),model,true);
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
 const bridged=await replaySavedDocxReportFiles(file("source.DOCX",source),
  file("review.JSON",report(original)),model,true);
 eq(bridged,first);
 await fail(source,report(original),model,false,"DOCX_REPLAY_CONSENT_REQUIRED");
 await fail(source,report(original),null,true,"DOCX_REPLAY_BUILDER_REQUIRED");
 await fail(source,report(original),{...model,sourceRevision:7},true,"DOCX_REPLAY_MODEL_MISMATCH");
 await fail(source,report(original),{...model,resources:model.resources.slice(1)},true,"DOCX_REPLAY_MODEL_MISMATCH");
 await fail(source,report({...original,engineVerified:true}),model,true,"DOCX_REPLAY_REPORT_MISMATCH");
 await fail(source,report({...original,physicalTopologyVerified:true}),model,true,"DOCX_REPLAY_REPORT_MISMATCH");
 await fail(source,report({...original,extra:secret}),model,true,"DOCX_REPLAY_REPORT_MISMATCH");
 await fail(source,report({...original,warnings:["forged"]}),model,true,"DOCX_REPLAY_REPORT_MISMATCH");
}
const mutated=await pack({...files,"word/document.xml":wordXml.replace("node01","node03")});
await fail(mutated,report(p4a),model,true,"DOCX_REPLAY_SOURCE_CHANGED");
await fail(mutated,report(p5),model,true,"DOCX_REPLAY_SOURCE_CHANGED");
await fail(enc("invalid zip"),report(p4a),model,true,"DOCX_REPLAY_SOURCE_BLOCKED");
const dtd=await pack({...files,"word/document.xml":wordXml.replace("<w:body>","<!DOCTYPE w:document [<!ENTITY unsafe SYSTEM 'file:///etc/passwd'>]><w:body>")});
await fail(dtd,report(p4a),model,true,"DOCX_REPLAY_SOURCE_BLOCKED");
await fail(source,enc("not JSON"),model,true,"DOCX_REPLAY_REPORT_INVALID");
await fail(source,new Uint8Array([0xff,0xfe,0xfd]),model,true,"DOCX_REPLAY_REPORT_INVALID");
await fail(source,report([]),model,true,"DOCX_REPLAY_REPORT_INVALID");
await fail(source,report({...p4a,formatId:"yadilab.malicious"}),model,true,"DOCX_REPLAY_FORMAT_UNSUPPORTED");
await fail(source,report({...p4a,source:{...p4a.source,sha256:"0".repeat(64)}}),
 model,true,"DOCX_REPLAY_SOURCE_CHANGED");
await fail(source,report({...p4a,source:{...p4a.source,cellLocator:{...p4a.source.cellLocator,rowOrdinal:99}}}),
 model,true,"DOCX_REPLAY_SOURCE_BLOCKED");
await fail(source,report({...p5,references:[...p5.references,p5.references[0]]}),
 model,true,"DOCX_REPLAY_REPORT_MISMATCH");
await fail(source,report({...p5,references:[p5.references[0]]}),
 model,true,"DOCX_REPLAY_COUNT_INVALID");
await fail(source,new Uint8Array(65537),model,true,"DOCX_REPLAY_REPORT_SIZE_INVALID");
await fail(new Uint8Array(16*1024*1024+1),report(p4a),model,true,"DOCX_REPLAY_DOCX_SIZE_INVALID");
const credential=preview.tables[0].rows[1].cells[1].locator;
await fail(source,report({...p4a,source:{...p4a.source,cellLocator:credential}}),
 model,true,"DOCX_REPLAY_SOURCE_BLOCKED");
for(const [docxName,reportName] of [
 ["source.doc","saved.json"],
 ["source.docx","saved.txt"],
 ["../source.docx","saved.json"]]){
 await assert.rejects(replaySavedDocxReportFiles(file(docxName,source),
  file(reportName,report(p4a)),model,true),err=>err.code==="DOCX_REPLAY_FILE_INVALID");assertions++;
}
await assert.rejects(replaySavedDocxReportFiles(file("source.docx",source),
 file("saved.json",new Uint8Array(65537)),model,true),
 err=>err.code==="DOCX_REPLAY_FILE_SIZE_INVALID");assertions++;
const markup=renderToStaticMarkup(React.createElement(DocxReferenceReplayPanel,{
 model,onReplay(){throw Error("SSR must not execute");},onClose(){throw Error("SSR must not close");}
}));
for(const marker of ['data-docx-replay-panel="CONFIG_DOCUMENTED"',
 'data-docx-replay-original="true"','data-docx-replay-report="true"',
 'data-docx-replay-consent="true"','data-docx-replay-verify="true"',
 'data-docx-replay-boundary="true"','disabled=""','read-only']){
 assert.ok(markup.includes(marker),marker);assertions++;
}
for(const forbidden of [secret,"node01","abc123","data-docx-replay-result"]){
 eq(markup.includes(forbidden),false);
}
const runtime=renderToStaticMarkup(React.createElement(DocxReferenceReplayPanel,{
 model:null,onReplay(){throw Error("SSR must not execute");},onClose(){throw Error("SSR must not close");}
}));
eq(runtime.includes('data-docx-replay-no-builder="true"'),true);
const fs=await import("node:fs");
const main=fs.readFileSync("ui/app/main.mjs","utf8");
for(const pattern of [/data-inspect-docx-replay": "CONFIG_DOCUMENTED"/,
 /docxReplayOpen \? e\(DocxReferenceReplayPanel/,
 /return replaySavedDocxReportFiles\(docxFile, reportFile, currentModel, acknowledged\)/]){
 assert.match(main,pattern);assertions++;
}
for(const path of ["ui/app/docx-reference-replay-panel.mjs","enterprise-import/src/docx-report-replay.ts"]){
 const text=fs.readFileSync(path,"utf8");
 for(const forbidden of ["setWorkspace(", "dangerouslySetInnerHTML", "localStorage", "indexedDB", "console.log(", "fetch("]){
  eq(text.includes(forbidden),false,"No side effects in "+path);
 }
}
console.log("PASS DOCX P6 "+assertions+" synthetic ZIP, canonical saved reports, source/revision/secret gates, UI SSR and no Engine");
