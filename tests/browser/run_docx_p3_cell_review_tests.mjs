import assert from "node:assert/strict";
import crypto from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZipJsArchiveBackend } from "../../dist-browser-test/package-io/src/zipjs-backend.js";
import { EnterpriseImportError } from "../../dist-browser-test/enterprise-import/src/types.js";
import { previewDocxTableStructure } from "../../dist-browser-test/enterprise-import/src/docx-tables-structural-preview.js";
import { discloseReviewedDocxCell } from "../../dist-browser-test/enterprise-import/src/docx-cell-disclosure.js";
import { reviewDocxFileCell, previewDocxFileStructure } from "../../dist-browser-test/ui/src/browser/docx-file-structural-preview.js";
import { DocxCellDisclosureReview } from "../../ui/app/docx-cell-disclosure-review.mjs";
import { DocxTableStructurePanel } from "../../ui/app/docx-structure-panel.mjs";

const backend=new ZipJsArchiveBackend();
const encode=(str)=>new TextEncoder().encode(str);
const sha=(bytes)=>crypto.createHash("sha256").update(bytes).digest("hex");
const escape=(value)=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const table=(rows)=>'<w:tbl>'+rows.map(row=>'<w:tr>'+row.map(value=>'<w:tc><w:p><w:r><w:t>'+escape(value)+'</w:t></w:r></w:p></w:tc>').join("")+'</w:tr>').join("")+'</w:tbl>';
const rawDoc=(rows)=>'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+table(rows)+'</w:body></w:document>';
const packageFiles=(rows)=>({
  "[Content_Types].xml":'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  "_rels/.rels":'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  "word/document.xml":rawDoc(rows),
});
const pack=async(rows,extra={})=>{
  const blob=await backend.write(Object.entries({...packageFiles(rows),...extra}).map(([path,contents])=>({path,bytes:encode(contents)})));
  return Uint8Array.from(new Uint8Array(await blob.arrayBuffer()));
};
const canary="SECRET_DOCX_DO_NOT_EXPOSE_8765";
const rows=[
  ["Hostname","Password","IPv4"],
  ["node01","abc123","192.0.2.15"],
  ["Token","hello","2001-db8-note"],
  ["edge02",canary,"203.0.113.2"],
];
const bytes=await pack(rows),baselineHash=sha(bytes);
const p=await previewDocxTableStructure(bytes);
const get=(t,r,c)=>p.tables[t].rows[r].cells[c].locator;
const file=(name,data=bytes,size=data.length)=>({
  name,size,async arrayBuffer(){return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);}
});
let n=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);n++;};
const rejected=async(inBytes,hash,loc,consent,code)=>{
  await assert.rejects(discloseReviewedDocxCell(inBytes,hash,loc,consent),
    error=>error instanceof EnterpriseImportError&&error.code===code&&
      !JSON.stringify(error).includes(canary),"Expected exact safe code "+code);
  n++;
};
eq(p.totalCells,12);
eq(p.sourceSha256,baselineHash);
eq(Object.hasOwn(p,"text"),false);
eq(JSON.stringify(p).includes("node01"),false);
eq(JSON.stringify(p).includes(canary),false);
await rejected(bytes,baselineHash,get(0,1,0),false,"DOCX_CELL_CONSENT_REQUIRED");
const reveal=await discloseReviewedDocxCell(bytes,baselineHash,get(0,1,0),true);
eq(reveal.status,"REVEALED_UNVERIFIED");
eq(reveal.semanticTrack,"CONFIG_DOCUMENTED");
eq(reveal.canActivate,false);
eq(reveal.text,"node01");
eq(reveal.sourceSha256,baselineHash);
eq(reveal.locator,get(0,1,0));
eq(reveal.engineVerified,false);
eq(reveal.physicalTopologyVerified,false);
eq(JSON.stringify(reveal).includes(canary),false);
eq(sha(bytes),baselineHash);
eq((await discloseReviewedDocxCell(bytes,baselineHash,get(0,1,2),true)).text,"192.0.2.15");
await rejected(bytes,baselineHash,get(0,1,1),true,"DOCX_CELL_SENSITIVE_BLOCKED");
await rejected(bytes,baselineHash,get(0,3,1),true,"DOCX_CELL_SENSITIVE_BLOCKED");
await rejected(bytes,baselineHash,get(0,2,0),true,"DOCX_CELL_SENSITIVE_BLOCKED");
await rejected(bytes,baselineHash,{...get(0,1,0),rowOrdinal:1000},true,"DOCX_CELL_LOCATOR_INVALID");
await rejected(bytes,baselineHash,{...get(0,1,0),part:"word/other.xml"},true,"DOCX_CELL_LOCATOR_INVALID");
await rejected(bytes,baselineHash,{...get(0,1,0),other:1},true,"DOCX_CELL_LOCATOR_INVALID");
await rejected(bytes,baselineHash,{...get(0,1,0),sourceSha256:"0".repeat(64)},true,"DOCX_CELL_LOCATOR_INVALID");
await rejected(await pack(rows.map((r,i)=>i===1?["node02",...r.slice(1)]:r)),baselineHash,get(0,1,0),true,"DOCX_CELL_STALE_SOURCE");
const suspicious=["https://example.org","user@example.org","<img src=x>","X".repeat(44),"new\nline","PRIVATE_KEY",
  "Bearer token","some_password","abc/def","123456789012345678901234567890"];
for(const value of suspicious){
  const hostile=await pack([["Item"],[value]]);
  const pv=await previewDocxTableStructure(hostile);
  await rejected(hostile,pv.sourceSha256,pv.tables[0].rows[1].cells[0].locator,true,
    "DOCX_CELL_SENSITIVE_BLOCKED");
}
const dtd=await pack(rows,{"word/document.xml":rawDoc(rows).replace("<w:body>","<!DOCTYPE w:document [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><w:body>")});
await rejected(dtd,sha(dtd),{...get(0,1,0),sourceSha256:sha(dtd)},true,"IMPORT_XML_DTD_FORBIDDEN");
const bridgeResult=await reviewDocxFileCell(file("review.DOCX"),baselineHash,get(0,1,0),true);
eq(bridgeResult.text,"node01");
await assert.rejects(reviewDocxFileCell(file("wrong.txt"),baselineHash,get(0,1,0),true),
  error=>error.code==="DOCX_FILE_EXTENSION_INVALID");n++;
const brPreview=await previewDocxFileStructure(file("sample.docx"));
eq(brPreview.preview.sourceSha256,baselineHash);
const staticMarkup=renderToStaticMarkup(React.createElement(DocxCellDisclosureReview,{
  preview:p,onRevealCell(){throw Error("SSR must not reveal");}
}));
for(const token of ['data-docx-select-cell="true"','data-docx-consent="true"',
   'data-docx-reveal="true"','data-docx-disclosure="OPERATOR_REVIEW_ONLY"',
   'data-docx-disclosure-warning="true"','disabled=""','Select a cell']){
  assert.ok(staticMarkup.includes(token),"No SSR consent/choice gate "+token);n++;
}
for(const token of [canary,"node01","abc123","192.0.2.15",'data-docx-revealed-value="true"']){
  eq(staticMarkup.includes(token),false,"No pre-consent value in SSR");
}
const panel=renderToStaticMarkup(React.createElement(DocxTableStructurePanel,{
 inspectFile:previewDocxFileStructure,reviewFile:reviewDocxFileCell,onClose(){throw Error("SSR must not close");}
}));
eq(panel.includes('data-docx-disclosure="OPERATOR_REVIEW_ONLY"'),false,"No reviewer before valid source");
const fs=await import("node:fs");
const main=fs.readFileSync("ui/app/main.mjs","utf8");
assert.match(main,/reviewFile: reviewDocxFileCell/);n++;
for(const fileName of ["ui/app/docx-cell-disclosure-review.mjs","enterprise-import/src/docx-cell-disclosure.ts"]){
 const src=fs.readFileSync(fileName,"utf8");
 for(const forbidden of ["setWorkspace(", "dangerouslySetInnerHTML", "localStorage", "indexedDB", "fetch(", "console.log(", "console.error("]){
   eq(src.includes(forbidden),false,"No persistence/DOM bypass/logging in "+fileName);
 }
}
console.log("PASS DOCX P3 "+n+" exact-source SHA, per-cell consent/secret blocking, SSR masked UI and no-Engine assertions");
