import assert from "node:assert/strict";
import crypto from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZipJsArchiveBackend } from "../../dist-browser-test/package-io/src/zipjs-backend.js";
import { previewDocxFileStructure } from "../../dist-browser-test/ui/src/browser/docx-file-structural-preview.js";
import { DocxTableStructureDetails, DocxTableStructurePanel } from "../../ui/app/docx-structure-panel.mjs";

const enc = new TextEncoder();
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const secret = "SECRET_DOCX_CELL_CANARY_DO_NOT_RENDER";
const pkg = {
  "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Host</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>IP</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>node1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>' + secret + '</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
};
const backend = new ZipJsArchiveBackend();
const zip = async (files = pkg) => {
  const blob = await backend.write(Object.entries(files).map(([path, value]) => ({path, bytes:enc.encode(value)})));
  return new Uint8Array(await blob.arrayBuffer());
};
const source = await zip();
const file = (name, bytes=source, size=bytes.length) => ({
  name,size,async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}
});
let checks=0;
const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);checks++;};
const blocks=async(f,code)=>{
  await assert.rejects(previewDocxFileStructure(f),err=>err?.code===code,code);
  checks++;
};
const valid=await previewDocxFileStructure(file("DocInventory.DOCX"));
eq(valid.filename,"DocInventory.DOCX");
eq(valid.preview.status,"REVIEW_REQUIRED");
eq(valid.preview.canActivate,false);
eq(valid.preview.semanticTrack,"CONFIG_DOCUMENTED");
eq(valid.preview.sourceSha256,sha(source));
eq(valid.preview.tables.length,1);
eq(valid.preview.totalCells,4);
eq(valid.preview.tables[0].rows.map(r=>r.cells.map(c=>c.textCodeUnits)),
   [[4,2],[5,secret.length]]);
eq(valid.preview.tables[0].rows[1].cells[0].locator,
  {kind:"docx-table-cell",part:"word/document.xml",tableOrdinal:0,rowOrdinal:1,cellOrdinal:0,sourceSha256:sha(source)});
eq(JSON.stringify(valid).includes(secret),false);
eq(valid.preview.engineVerified,false);
eq(valid.preview.physicalTopologyVerified,false);
const html=renderToStaticMarkup(React.createElement(DocxTableStructureDetails,{result:valid}));
for(const mark of ['data-docx-preview="CONFIG_DOCUMENTED"','data-docx-summary="true"',
  'Declared tables: 1','structural cells: 4','Table 1: 2 rows',
  'Row 2: 2 cells','data-docx-cell="0:1:1"','Original SHA-256: '+sha(source),
  'CONFIG_DOCUMENTED','REVIEW_REQUIRED','data-docx-activation-status="BLOCKED"']){
  assert.ok(html.includes(mark),"Missing structure UI marker "+mark);checks++;
}
for(const value of [secret,"node1","Host","<w:document"]){
  eq(html.includes(value),false,"No original document text in markup");
}
const modal=renderToStaticMarkup(React.createElement(DocxTableStructurePanel,{
 inspectFile:previewDocxFileStructure,onClose(){throw Error("SSR must not close");}
}));
for(const mark of ['role="dialog"','aria-modal="true"','data-docx-panel="CONFIG_DOCUMENTED"',
  'data-docx-file="true"','accept=".docx"','data-docx-close="true"']){
  assert.ok(modal.includes(mark),"Missing control "+mark);checks++;
}
eq(modal.includes('data-docx-preview="CONFIG_DOCUMENTED"'),false,"No default preview");
const hostile=renderToStaticMarkup(React.createElement(DocxTableStructureDetails,{
 result:{...valid,filename:'<script>alert("x")</script>'}
}));
eq(hostile.includes('<script>'),false);
eq(hostile.includes('&lt;script&gt;'),true);
await blocks(file("bad.doc"),"DOCX_FILE_EXTENSION_INVALID");
await blocks(file("../bad.docx"),"DOCX_FILE_EXTENSION_INVALID");
await blocks(file("..\\bad.docx"),"DOCX_FILE_EXTENSION_INVALID");
await blocks(file("bad.docx\0.png"),"DOCX_FILE_EXTENSION_INVALID");
await blocks(file("x".repeat(241)+".docx"),"DOCX_FILE_EXTENSION_INVALID");
await blocks(file("empty.docx",new Uint8Array()),"DOCX_FILE_SIZE_INVALID");
await blocks(file("huge.docx",source,16*1024*1024+1),"DOCX_FILE_SIZE_INVALID");
await blocks({...file("bad.docx"),arrayBuffer:async()=>new ArrayBuffer(16*1024*1024+1)},"DOCX_FILE_SIZE_INVALID");
await blocks(file("broken.docx",enc.encode("notzip")),"IMPORT_WORKBOOK_ARCHIVE_INVALID");
const brokenDoc={...pkg,"word/document.xml":pkg["word/document.xml"].replace("<w:body>","<!DOCTYPE w:document [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><w:body>")};
await blocks(file("malicious.docx",await zip(brokenDoc)),"IMPORT_XML_DTD_FORBIDDEN");
// P4 permits a separately reviewed zero-cell-content sidecar callback, but NEVER direct workspace/Engine/network mutation.
for(const forbidden of ["setWorkspace(", "dangerouslySetInnerHTML", "fetch(", "onActivate", "applyRuntimeOperation(", "setRuntimeSelection("]) {
  eq((await import("node:fs")).readFileSync("ui/app/docx-structure-panel.mjs","utf8").includes(forbidden),false);
}
const fs=await import("node:fs");
const main=fs.readFileSync("ui/app/main.mjs","utf8");
for(const regex of [
  /data-inspect-docx": "CONFIG_DOCUMENTED"/,
  /onInspectDocx: \(\) => setDocxStructureOpen\(true\)/,
  /docxStructureOpen \? e\(DocxTableStructurePanel/,
  /inspectFile: previewDocxFileStructure/,
  /onClose: \(\) => setDocxStructureOpen\(false\)/,
]){assert.match(main,regex);checks++;}
console.log("PASS DOCX-P2 "+checks+" real DOCX ZIP bridge, React SSR, structural truth, secret exclusion and no workspace activation assertions");
