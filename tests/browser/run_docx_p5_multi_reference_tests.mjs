import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZipJsArchiveBackend } from "../../dist-browser-test/package-io/src/zipjs-backend.js";
import { previewDocxTableStructure } from "../../dist-browser-test/enterprise-import/src/docx-tables-structural-preview.js";
import { discloseReviewedDocxCell } from "../../dist-browser-test/enterprise-import/src/docx-cell-disclosure.js";
import { reviewDocxCellAssociation } from "../../dist-browser-test/enterprise-import/src/docx-association-review.js";
import { reviewDocxMultiReferences, DOCX_MULTI_REFERENCE_FORMAT } from "../../dist-browser-test/enterprise-import/src/docx-multi-reference-review.js";
import { DocxMultiReferenceQueue } from "../../ui/app/docx-multi-reference-queue.mjs";

const enc=new TextEncoder();
const canary="DO_NOT_INCLUDE_DOCUMENT_SECRET_9431";
const fileEntries={
  "[Content_Types].xml":'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  "_rels/.rels":'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  "word/document.xml":'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Host</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Password</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>node01</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>'+canary+'</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>node02</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>abc123</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
};
const blob=await new ZipJsArchiveBackend().write(Object.entries(fileEntries).map(([path,text])=>({path,bytes:enc.encode(text)})));
const bytes=new Uint8Array(await blob.arrayBuffer());
const preview=await previewDocxTableStructure(bytes);
const loc=(r,c)=>preview.tables[0].rows[r].cells[c].locator;
const model={scenarioId:"case_01",sourceRevision:7,resources:[
  {id:"res_a",label:"Server A"},{id:"res_b",label:"Router B"},
  {id:"res_c",label:"Switch C"},{id:"res_d",label:"Host D"},
]};
const associate=async(r,c,target)=>{
 const disclosed=await discloseReviewedDocxCell(bytes,preview.sourceSha256,loc(r,c),true);
 const result=reviewDocxCellAssociation(disclosed,model,{
   sourceSha256:preview.sourceSha256,scenarioId:model.scenarioId,sourceRevision:model.sourceRevision,
   targetResourceId:target,acknowledgeNotVerified:true,
 });
 assert.equal(result.status,"READY_FOR_EXPORT");
 return result.sidecar;
};
const a=await associate(1,0,"res_a");
const b=await associate(2,0,"res_b");
const c=await associate(0,0,"res_c");
let tests=0;const eq=(x,y,label)=>{assert.deepEqual(x,y,label);tests++};
const decision={sourceSha256:preview.sourceSha256,scenarioId:model.scenarioId,sourceRevision:7,acknowledgeNotVerified:true};
const blocked=(items,m,d,code)=>{
 const r=reviewDocxMultiReferences(items,m,d);
 eq(r.status,"BLOCKED",code+" status");eq(r.diagnostics.map(x=>x.code),[code],code+" diagnostic");
 eq(Object.hasOwn(r,"sidecar"),false,code+" sidecar absent");
};
const good=reviewDocxMultiReferences([b,a],model,decision);
eq(good.status,"READY_FOR_EXPORT");
eq(good.sidecar.formatId,DOCX_MULTI_REFERENCE_FORMAT);
eq(good.sidecar.schemaVersion,"1.0.0");
eq(good.sidecar.status,"REVIEWED_ASSOCIATIONS_ONLY");
eq(good.sidecar.engineVerified,false);
eq(good.sidecar.physicalTopologyVerified,false);
eq(good.sidecar.source.sha256,preview.sourceSha256);
eq(good.sidecar.targetModel,{scenarioId:"case_01",sourceRevision:7});
eq(good.sidecar.references.map(x=>x.cellLocator.rowOrdinal),[1,2]);
eq(good.sidecar.references.map(x=>x.targetResourceId),["res_a","res_b"]);
eq(good.sidecar.references.every(x=>x.assertion==="USER_ASSERTED_ASSOCIATION_NOT_VERIFIED"),true);
const serialized=JSON.stringify(good.sidecar);
for(const content of [canary,"node01","node02","Password","abc123","cellText","textCodeUnits",'"text"']){
 eq(serialized.includes(content),false,"no original DOCX text "+content);
}
eq(JSON.stringify(reviewDocxMultiReferences([a,b],model,decision).sidecar),serialized,"stable input ordering");
blocked([a],model,decision,"DOCX_MULTI_COUNT_INVALID");
blocked(Array(11).fill(a),model,decision,"DOCX_MULTI_COUNT_INVALID");
blocked([a,a],model,decision,"DOCX_MULTI_DUPLICATE_REFERENCE");
blocked([a,{...b,association:{...b.association,targetResourceId:"res_a"}}],model,decision,"DOCX_MULTI_DUPLICATE_REFERENCE");
blocked([a,b],null,decision,"DOCX_MULTI_BUILDER_REQUIRED");
blocked([a,b],model,{...decision,acknowledgeNotVerified:false},"DOCX_MULTI_ACK_REQUIRED");
blocked([a,b],model,{...decision,sourceRevision:3},"DOCX_MULTI_STALE");
blocked([a,b],model,{...decision,sourceSha256:"0".repeat(64)},"DOCX_MULTI_REFERENCE_INVALID");
blocked([a,b],{...model,sourceRevision:8},decision,"DOCX_MULTI_STALE");
blocked([a,b],{...model,resources:model.resources.filter(x=>x.id!=="res_a")},decision,"DOCX_MULTI_REFERENCE_INVALID");
blocked([a,b],{...model,resources:[model.resources[0],model.resources[0]]},decision,"DOCX_MULTI_MODEL_INVALID");
blocked([a,{...b,engineVerified:true}],model,decision,"DOCX_MULTI_REFERENCE_INVALID");
blocked([a,{...b,source:{...b.source,cellLocator:{...b.source.cellLocator,part:"other"}}}],model,decision,"DOCX_MULTI_LOCATOR_INVALID");
blocked([a,{...b,source:{...b.source,cellLocator:{...b.source.cellLocator,rowOrdinal:-1}}}],model,decision,"DOCX_MULTI_LOCATOR_INVALID");
blocked([a,{...b,unexpected:"unsafe"}],model,decision,"DOCX_MULTI_REFERENCE_INVALID");
blocked([a,{...b,source:{...b.source,extra:canary}}],model,decision,"DOCX_MULTI_REFERENCE_INVALID");
blocked([a,{...b,targetModel:{...b.targetModel,sourceRevision:0}}],model,decision,"DOCX_MULTI_REFERENCE_INVALID");
const ssr=renderToStaticMarkup(React.createElement(DocxMultiReferenceQueue,{
 items:[a,b],model,onExport(){throw Error("SSR never calls export")},onRemove(){throw Error("SSR never removes")}
}));
for(const id of ['data-docx-multi-queue="REVIEWED_ASSOCIATIONS_ONLY"',
 'data-docx-multi-count="2"','data-docx-multi-items="true"',
 'data-docx-multi-item="0"','data-docx-multi-item="1"',
 'data-docx-multi-ack="true"','data-docx-multi-export="true"','disabled=""']){
 assert.ok(ssr.includes(id),id);tests++;
}
for(const raw of [canary,"node01","node02","abc123"]){eq(ssr.includes(raw),false,"SSR must not include document contents");}
const fs=await import("node:fs");
const main=fs.readFileSync("ui/app/main.mjs","utf8");
for(const expression of [/reviewDocxMultiReferences\(staged,currentModel,decision\)/,
 /onBuildAssociation: \(reviewedCell, decision\)/,
 /onExportMulti: \(staged, decision\)/,
 /docx-reviewed-multi-/]){assert.match(main,expression);tests++;}
const panel=fs.readFileSync("ui/app/docx-structure-panel.mjs","utf8");
for(const expression of [/setMultiItems\(\[\]\)/,/const now=await reviewFile\(file,result.preview.sourceSha256,loc,true\)/,
 /onStageAssociation: stageReference/,/onExport:exportMulti/,
 /JSON.stringify\(verified\)!==JSON.stringify\(item\)/]){assert.match(panel,expression);tests++;}
for(const path of ["enterprise-import/src/docx-multi-reference-review.ts","ui/app/docx-multi-reference-queue.mjs"]){
 const src=fs.readFileSync(path,"utf8");
 for(const forbidden of ["setWorkspace(", "localStorage", "indexedDB", "fetch(", "dangerouslySetInnerHTML","console.log("]){
  eq(src.includes(forbidden),false,path+" must not mutate or store state");
 }
}
console.log("PASS DOCX P5 "+tests+" real ZIP, 2–10 typed reports, security negatives, zero value, deterministic output and SSR");
