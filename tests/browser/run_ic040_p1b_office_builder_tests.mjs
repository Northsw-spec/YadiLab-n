import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import { ZipJsArchiveBackend } from "../../dist-browser-test/package-io/src/zipjs-backend.js";
import { makeOdtZip, packageEntries, table as odtTable } from "../enterprise-import/odt_test_package.mjs";
import { previewOfficeNodesFile, verifyOfficeCandidateFile } from "../../dist-browser-test/ui/src/browser/office-reviewed-nodes-file.js";
import { OfficeReviewedBuilderPanel, OfficeReviewedNodeChoices } from "../../ui/app/office-reviewed-builder-panel.mjs";

const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const enc=new TextEncoder(),backend=new ZipJsArchiveBackend();
const word="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const rel="http://schemas.openxmlformats.org/package/2006/relationships";
const typ="http://schemas.openxmlformats.org/package/2006/content-types";
const officeRel="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const mainType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const tc=value=>`<w:tc><w:tcPr/><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`;
const docxXml=rows=>`<w:document xmlns:w="${word}"><w:body><w:tbl><w:tblPr/><w:tblGrid/>${rows.map(row=>"<w:tr>"+row.map(tc).join("")+"</w:tr>").join("")}</w:tbl></w:body></w:document>`;
async function docx(rows){const parts={
  "[Content_Types].xml":`<Types xmlns="${typ}"><Override PartName="/word/document.xml" ContentType="${mainType}"/></Types>`,
  "_rels/.rels":`<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${officeRel}" Target="word/document.xml"/></Relationships>`,
  "word/document.xml":docxXml(rows),
};const b=await backend.write(Object.entries(parts).map(([path,s])=>({path,bytes:enc.encode(s)})));return new Uint8Array(await b.arrayBuffer());}
const odt=async rows=>makeOdtZip(packageEntries({tables:[odtTable(rows)]}));
const copy=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const file=(name,initial,next=initial)=>({name,size:initial.length,reads:0,async arrayBuffer(){this.reads++;return copy(this.reads===1?initial:next);}});
let assertions=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);assertions++};const yes=(v,m)=>{assert.ok(v,m);assertions++};
async function denies(task,code){await assert.rejects(task,e=>e?.code===code,code);assertions++;}
const base=[["Hostname","Private"],["node01","NONSELECTED_SECRET_22882"],["node02","SECOND_PRIVATE_11998"]];
const roles=["resource.generic","network.router","endpoint.linux","network.switch"];
for(const [format,make] of [["docx",docx],["odt",odt]]){
 const bytes=await make(base),f=file("sample."+format,bytes);
 const reviewed=await previewOfficeNodesFile(f);
 eq(f.reads,1,"initial preview reads original once");
 eq(reviewed.format,format);
 eq(reviewed.preview.sourceSha256,sha(bytes),"original ZIP digest");
 eq(reviewed.preview.textIncluded,false,"no text in preview");
 eq(reviewed.preview.tables.length,1);
 const decision={format,sourceSha256:reviewed.preview.sourceSha256,nodes:[
   {tableOrdinal:0,rowOrdinal:1,nodeIdCellOrdinal:0,role:"network.router",acknowledgeCell:true},
   {tableOrdinal:0,rowOrdinal:2,nodeIdCellOrdinal:0,role:"resource.generic",acknowledgeCell:true},
 ],acknowledgeModeledResources:true};
 const first=await verifyOfficeCandidateFile(f,reviewed,decision,()=>true);
 eq(first.source.resources.map(x=>[x.id,x.type]),[["node01","network.router"],["node02","resource.generic"]]);
 eq(first.source.connections,[],"no invented cables");
 eq(first.source.tests,[],"no modeled probe");
 eq(first.source.completion.path,"office_manual_verification");
 eq(first.origins.map(x=>x.locator.rowOrdinal),[1,2],"exact original cell provenance");
 eq(first.canActivate,false,"P1a source-only contract intact");
 for(const value of base.map(x=>x[1]).slice(1))yes(!JSON.stringify(first).includes(value),"unselected private cell omitted");
 const final=await verifyOfficeCandidateFile(f,reviewed,decision,()=>true);
 eq(f.reads,3,"last read after precompile candidate");
 eq(final,first,"final candidate source and origin exact match");
 const changed=await make(base.map((row,i)=>i===1?["node09",row[1]]:row));
 const swap=file("sample."+format,bytes,changed);
 const preview=await previewOfficeNodesFile(swap);
 const swapDecision={...decision,sourceSha256:preview.preview.sourceSha256};
 await denies(verifyOfficeCandidateFile(swap,preview,swapDecision,()=>true),"IC040_P1B_SOURCE_CHANGED");
 eq(swap.reads,2,"mutation read after preview, no stale Byte trust");
 const canceled=file("sample."+format,bytes);
 await denies(verifyOfficeCandidateFile(canceled,reviewed,decision,()=>false),"IC040_P1B_STALE");
 eq(canceled.reads,0,"stale selection does no IO");
 let current=true;const invalidated={name:"sample."+format,size:bytes.length,async arrayBuffer(){current=false;return copy(bytes);}};
 await denies(verifyOfficeCandidateFile(invalidated,reviewed,decision,()=>current),"IC040_P1B_STALE");
 const wrong=file("sample.other",bytes);
 await denies(previewOfficeNodesFile(wrong),"IC040_P1B_FILE_INVALID");
 eq(wrong.reads,0,"reject invalid extension before read");
 const rendered=renderToStaticMarkup(React.createElement(OfficeReviewedNodeChoices,{
   result:reviewed,manualRoleOptions:roles,onConfirm(){throw Error("SSR must not apply");}
 }));
 for(const marker of ["data-office-p1b-controls","data-office-p1b-add","data-office-p1b-source-sha","data-office-p1b-confirm","data-office-p1b-modeled-ack"]){
   yes(rendered.includes(marker),"UI original-only selector marker "+marker);
 }
 for(const secret of ["NONSELECTED_SECRET_22882","SECOND_PRIVATE_11998","node01","node02","Hostname","Private"]){
   yes(!rendered.includes(secret),"UI must not disclose source text "+secret);
 }
 yes(rendered.includes('disabled=""'),"default unconsented commit disabled");
}
const blank=renderToStaticMarkup(React.createElement(OfficeReviewedBuilderPanel,{inspectFile(){throw Error("SSR IO");},onClose(){}}));
yes(blank.includes('data-office-p1b-panel="REVIEW_REQUIRED"'),"isolated Office modal");
const main=fs.readFileSync("ui/app/main.mjs","utf8");
for(const token of ["data-review-office-builder","officeReviewedBuilderOpen ? e(OfficeReviewedBuilderPanel","await verifyOfficeCandidateFile(","IC040_P1B_WORKSPACE_CHANGED","IC040_P1B_STALE","setImportedProbeAutoOpen(false)"]){
 yes(main.includes(token),"Actual UI application gate "+token);
}
for(const p of ["ui/src/browser/office-reviewed-nodes-file.ts","ui/app/office-reviewed-builder-panel.mjs"]){
 const text=fs.readFileSync(p,"utf8");
 for(const bad of ["fetch(","localStorage","indexedDB","XMLHttpRequest","dangerouslySetInnerHTML"]){
   yes(!text.includes(bad),"No network/persistence/HTML source escape "+p+bad);
 }
}
for(const p of [".github/workflows/required-ci.yml",".github/workflows/release-identity.yml"]){
 const text=fs.readFileSync(p,"utf8");
 yes(text.includes("npm run test:ic040-p1b-office-builder"),"Focused P1b in "+p);
 yes(text.includes("run_ic040_p1b_office_builder_real_browser.py"),"Real Chromium P1b in "+p);
 yes(text.includes("npm run test:ic040-p1a-office-nodes"),"P1a regression preserved in "+p);
}
console.log("PASS IC-040 P1b: "+assertions+" source-bound actual DOCX/ODT, review consent, original-refetch and UI contract assertions");
