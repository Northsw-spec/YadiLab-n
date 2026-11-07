import assert from "node:assert/strict";
import crypto from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { previewOdtFileStructure } from "../../dist-browser-test/ui/src/browser/odt-file-structural-preview.js";
import { OdtStructureDetails, OdtStructurePanel } from "../../ui/app/odt-structure-panel.mjs";
import { makeOdtZip, packageEntries, content, table } from "../enterprise-import/odt_test_package.mjs";

const secret="ODT_SSR_SECRET_DO_NOT_RENDER_123";
const source=makeOdtZip(packageEntries({tables:[table([["Host","Address"],["node01",secret]])]}));
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const asFile=(name,bytes=source,size=bytes.length)=>({
  name,size,async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}
});
let count=0;
const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);count++};
const reject=async(file,code)=>{
 await assert.rejects(previewOdtFileStructure(file),err=>err?.code===code,code);count++;
};
const result=await previewOdtFileStructure(asFile("NetworkDocs.ODT"));
eq(result.filename,"NetworkDocs.ODT");
eq(result.preview.sourceSha256,sha(source));
eq(result.preview.totalCells,4);
eq(result.preview.tables[0].rows.map(r=>r.cells.map(c=>c.textCodeUnits)),
 [[4,7],[6,secret.length]]);
eq(result.preview.tables[0].rows[1].cells[0].locator,
 {kind:"odt-table-cell",sourceSha256:sha(source),part:"content.xml",tableOrdinal:0,rowOrdinal:1,cellOrdinal:0});
eq(result.preview.textIncluded,false);
eq(result.preview.canActivate,false);
eq(result.preview.engineVerified,false);
const html=renderToStaticMarkup(React.createElement(OdtStructureDetails,{result}));
for(const marker of ['data-odt-preview="CONFIG_DOCUMENTED"',
  'data-odt-summary="true"','Declared tables: 1','structural cells: 4',
  'Table 1: 2 rows','Row 2: 2 cells','data-odt-cell="0:1:1"',
  'Original SHA-256: '+sha(source),'REVIEW_REQUIRED',
  'data-odt-activation-status="BLOCKED"']){
  assert.ok(html.includes(marker),marker);count++;
}
for(const sensitive of [secret,"node01",">Host<",">Address<","<office:document-content"]){
  eq(html.includes(sensitive),false,"No raw original document bytes in UI");
}
const hostile=renderToStaticMarkup(React.createElement(OdtStructureDetails,{
 result:{...result,filename:'<script>console.log(1)</script>'}
}));
eq(hostile.includes('<script>'),false);
eq(hostile.includes('&lt;script&gt;'),true);
const blank=renderToStaticMarkup(React.createElement(OdtStructurePanel,{
 inspectFile:previewOdtFileStructure,onClose(){throw Error("SSR must not close");}
}));
for(const marker of ['role="dialog"','aria-modal="true"',
  'data-odt-panel="CONFIG_DOCUMENTED"','data-odt-file="true"',
  'accept=".odt"','data-odt-close="true"','data-odt-empty="true"']){
  assert.ok(blank.includes(marker),"Missing UI control "+marker);count++;
}
eq(blank.includes('data-odt-preview="CONFIG_DOCUMENTED"'),false);
await reject(asFile("wrong.odf"),"ODT_FILE_EXTENSION_INVALID");
await reject(asFile("../wrong.odt"),"ODT_FILE_EXTENSION_INVALID");
await reject(asFile("..\\wrong.odt"),"ODT_FILE_EXTENSION_INVALID");
await reject(asFile("x".repeat(245)+".odt"),"ODT_FILE_EXTENSION_INVALID");
await reject(asFile("wrong.odt",new Uint8Array()),"ODT_FILE_SIZE_INVALID");
await reject(asFile("wrong.odt",source,16*1024*1024+1),"ODT_FILE_SIZE_INVALID");
await reject({...asFile("wrong.odt"),arrayBuffer:async()=>new ArrayBuffer(16*1024*1024+1)},"ODT_FILE_SIZE_INVALID");
await reject(asFile("broken.odt",new Uint8Array(100)),"ODT_PACKAGE_HEADER_INVALID");
const dtd=makeOdtZip(packageEntries({
 contentXml:content([table([["Hello"]])]).replace("<office:body>",
 '<!DOCTYPE office:document-content [<!ENTITY x SYSTEM "file:///etc/passwd">]><office:body>')
}));
await reject(asFile("hostile.odt",dtd),"IMPORT_XML_DTD_FORBIDDEN");
const fs=await import("node:fs");
const main=fs.readFileSync("ui/app/main.mjs","utf8");
for(const regex of [
 /data-inspect-odt": "CONFIG_DOCUMENTED"/,
 /onInspectOdt: \(\) => setOdtStructureOpen\(true\)/,
 /odtStructureOpen \? e\(OdtStructurePanel/,
 /inspectFile: previewOdtFileStructure/,
 /onClose: \(\) => setOdtStructureOpen\(false\)/,
]){assert.match(main,regex);count++;}
const panel=fs.readFileSync("ui/app/odt-structure-panel.mjs","utf8");
// P4 permits ONLY a separate operator-reviewed zero-value sidecar callback; P2 still forbids direct Builder/Engine/network mutations.
for(const forbidden of ["setWorkspace(", "onActivate", "applyRuntimeOperation(", "setRuntimeSelection(", "dangerouslySetInnerHTML",
 "localStorage", "indexedDB", "fetch(", "console.log(", "console.error("]){
 eq(panel.includes(forbidden),false);
}
console.log("PASS ODT P2 "+count+" actual ZIP, React SSR, source SHA, no secrets and no Builder mutations");
