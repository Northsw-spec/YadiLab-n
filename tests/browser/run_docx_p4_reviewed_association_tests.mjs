import assert from "node:assert/strict";
import crypto from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZipJsArchiveBackend } from "../../dist-browser-test/package-io/src/zipjs-backend.js";
import { previewDocxTableStructure } from "../../dist-browser-test/enterprise-import/src/docx-tables-structural-preview.js";
import { discloseReviewedDocxCell } from "../../dist-browser-test/enterprise-import/src/docx-cell-disclosure.js";
import { DOCX_REVIEWED_ASSOCIATION_FORMAT, reviewDocxCellAssociation } from "../../dist-browser-test/enterprise-import/src/docx-association-review.js";
import { DocxReviewedCellAssociation } from "../../ui/app/docx-reviewed-cell-association.mjs";

const e=React.createElement, enc=new TextEncoder();
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const secret="SECRET_DOCX_SIDE_CAR_MUST_NEVER_EXPOSE";
const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Hostname</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Password</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>node01</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>'+secret+'</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
const entries={
 "[Content_Types].xml":'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
 "_rels/.rels":'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
 "word/document.xml":xml,
};
const blob=await new ZipJsArchiveBackend().write(Object.entries(entries).map(([path,text])=>({path,bytes:enc.encode(text)})));
const bytes=new Uint8Array(await blob.arrayBuffer());
const preview=await previewDocxTableStructure(bytes);
const cell=preview.tables[0].rows[1].cells[0].locator;
const disclosed=await discloseReviewedDocxCell(bytes,preview.sourceSha256,cell,true);
const model={scenarioId:"scenario_1",sourceRevision:3,resources:[{id:"res_1",label:"Server 1"},{id:"res_2",label:"Router 2"}]};
const decision={sourceSha256:preview.sourceSha256,scenarioId:"scenario_1",sourceRevision:3,
 targetResourceId:"res_1",acknowledgeNotVerified:true};
let n=0;const eq=(a,b,label)=>{assert.deepEqual(a,b,label);n++};
const blocked=(source,target,d,code)=>{
 const review=reviewDocxCellAssociation(source,target,d);
 eq(review.status,"BLOCKED",code+" status");
 eq(review.diagnostics.map(x=>x.code),[code],code);
 eq(Object.hasOwn(review,"sidecar"),false);
};
const approved=reviewDocxCellAssociation(disclosed,model,decision);
eq(approved.status,"READY_FOR_EXPORT");
eq(approved.diagnostics,[]);
eq(approved.sidecar.formatId,DOCX_REVIEWED_ASSOCIATION_FORMAT);
eq(approved.sidecar.source.profileId,"office.docx-tables.structural.v1");
eq(approved.sidecar.source.sha256,sha(bytes));
eq(approved.sidecar.source.cellLocator,cell);
eq(approved.sidecar.targetModel,{scenarioId:"scenario_1",sourceRevision:3});
eq(approved.sidecar.association,{targetResourceId:"res_1",
  assertion:"USER_ASSERTED_ASSOCIATION_NOT_VERIFIED"});
eq(approved.sidecar.engineVerified,false);
eq(approved.sidecar.physicalTopologyVerified,false);
const serial=JSON.stringify(approved.sidecar);
for(const forbidden of [secret,"node01","Hostname","Password","textCodeUnits","textValue",
 "192.0.2.15","cellText","password","<w:document"]){
 // "Password" is case sensitive; no source content is ever serialized.
 eq(serial.includes(forbidden),false,"sidecar secret/raw cell content excluded "+forbidden);
}
eq(JSON.stringify(reviewDocxCellAssociation(disclosed,model,decision).sidecar),serial,"deterministic");
blocked(disclosed,null,decision,"DOCX_ASSOC_BUILDER_REQUIRED");
blocked(disclosed,model,{...decision,acknowledgeNotVerified:false},"DOCX_ASSOC_ACK_REQUIRED");
blocked(disclosed,model,{...decision,sourceSha256:"0".repeat(64)},"DOCX_ASSOC_STALE");
blocked(disclosed,model,{...decision,sourceRevision:2},"DOCX_ASSOC_STALE");
blocked(disclosed,model,{...decision,scenarioId:"other"},"DOCX_ASSOC_STALE");
blocked(disclosed,model,{...decision,targetResourceId:"nonexistent"},"DOCX_ASSOC_TARGET_INVALID");
blocked(disclosed,model,{...decision,targetResourceId:"__proto__"},"DOCX_ASSOC_TARGET_INVALID");
blocked(disclosed,{...model,sourceRevision:4},decision,"DOCX_ASSOC_STALE");
blocked(disclosed,{...model,resources:[{id:"res_2",label:"Router 2"}]},decision,"DOCX_ASSOC_TARGET_INVALID");
blocked(disclosed,{...model,resources:[...model.resources,model.resources[0]]},decision,"DOCX_ASSOC_MODEL_INVALID");
blocked(disclosed,{...model,resources:[{id:"__proto__",label:"bad"}]},decision,"DOCX_ASSOC_MODEL_INVALID");
blocked({...disclosed,sourceSha256:"x".repeat(64)},model,decision,"DOCX_ASSOC_REVIEW_REQUIRED");
blocked({...disclosed,locator:{...cell,part:"wrong"}},model,decision,"DOCX_ASSOC_REVIEW_REQUIRED");
blocked({...disclosed,engineVerified:true},model,decision,"DOCX_ASSOC_REVIEW_REQUIRED");
const denied=await assert.rejects(discloseReviewedDocxCell(bytes,preview.sourceSha256,
 preview.tables[0].rows[1].cells[1].locator,true),err=>err.code==="DOCX_CELL_SENSITIVE_BLOCKED");n++;
const markup=renderToStaticMarkup(e(DocxReviewedCellAssociation,{disclosed,model,
 onExportAssociation(){throw Error("SSR must not export");}}));
for(const marker of ['data-docx-association="REVIEWED_ASSOCIATIONS_ONLY"',
 'data-docx-association-target="true"','data-docx-association-ack="true"',
 'data-docx-association-export="true"','data-docx-association-boundary="true"',
 'disabled=""','No resource selected (default)','UNVERIFIED']){
 assert.ok(markup.includes(marker),marker);n++;
}
eq(markup.includes(secret),false);
eq(markup.includes("node01"),false);
const runtimeMarkup=renderToStaticMarkup(e(DocxReviewedCellAssociation,{disclosed,model:null}));
eq(runtimeMarkup.includes('data-docx-association-model-blocked="true"'),true);
eq(runtimeMarkup.includes('data-docx-association-target="true"'),false);
const fs=await import("node:fs");
const main=fs.readFileSync("ui/app/main.mjs","utf8");
for(const pattern of [/reviewDocxCellAssociation\(reviewedCell, currentModel, decision\)/,
 /reviewFile: reviewDocxFileCell/,/onExportAssociation: \(reviewedCell, decision\)/,
 /filename: \`docx-reviewed-reference-/]){
 assert.match(main,pattern);n++;
}
const panel=fs.readFileSync("ui/app/docx-structure-panel.mjs","utf8");
assert.match(panel,/const current = await reviewFile\(selectedFile, result.preview.sourceSha256, disclosed.locator, true\)/);n++;
assert.match(panel,/current.text !== disclosed.text/);n++;
for(const path of ["ui/app/docx-reviewed-cell-association.mjs","enterprise-import/src/docx-association-review.ts"]){
 const src=fs.readFileSync(path,"utf8");
 for(const term of ["setWorkspace(", "fetch(", "localStorage", "dangerouslySetInnerHTML", "console.log(","console.error("]){
   eq(src.includes(term),false,"No active/persistent side effect in "+path);
 }
}
console.log("PASS DOCX P4 "+n+" pure reference sidecar/non-verified/revisions/consent/privacy plus SSR UI assertions");
