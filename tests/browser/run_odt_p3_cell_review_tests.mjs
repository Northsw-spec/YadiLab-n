import assert from "node:assert/strict";
import crypto from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { previewOdtTableStructure } from "../../dist-browser-test/enterprise-import/src/odt-tables-structural-preview.js";
import { discloseReviewedOdtCell } from "../../dist-browser-test/enterprise-import/src/odt-cell-disclosure.js";
import { previewOdtFileStructure,reviewOdtFileCell } from "../../dist-browser-test/ui/src/browser/odt-file-structural-preview.js";
import { OdtCellDisclosureReview } from "../../ui/app/odt-cell-disclosure-review.mjs";
import { OdtStructurePanel } from "../../ui/app/odt-structure-panel.mjs";
import { makeOdtZip, packageEntries, content, table } from "../enterprise-import/odt_test_package.mjs";

const sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const CANARY="ODT_SECRET_DO_NOT_RENDER_CANARY_977";
const rows=[
 ["Hostname","Password","IPv4"],
 ["node01","abc123","192.0.2.15"],
 ["Token","hello","2001-db8-note"],
 ["edge02",CANARY,"203.0.113.2"],
];
const pack=(rows,config={})=>makeOdtZip(packageEntries({tables:[table(rows)],...config}));
const original=pack(rows);
const before=sha(original);
const p=await previewOdtTableStructure(original);
const loc=(r,c)=>p.tables[0].rows[r].cells[c].locator;
const file=(name,bytes=original,size=bytes.length)=>({
 name,size,async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}
});
let count=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);count++};
const fail=async(bytes,hash,locator,ack,code)=>{
 await assert.rejects(discloseReviewedOdtCell(bytes,hash,locator,ack),
   e=>e?.code===code&&!JSON.stringify(e).includes(CANARY),code);
 count++;
};
eq(p.totalCells,12);
eq(p.textIncluded,false);
eq(JSON.stringify(p).includes(CANARY),false);
eq(JSON.stringify(p).includes("node01"),false);
eq(p.sourceSha256,before);
await fail(original,before,loc(1,0),false,"ODT_CELL_CONSENT_REQUIRED");
const disclosed=await discloseReviewedOdtCell(original,before,loc(1,0),true);
eq(disclosed.status,"REVEALED_UNVERIFIED");
eq(disclosed.semanticTrack,"CONFIG_DOCUMENTED");
eq(disclosed.sourceSha256,before);
eq(disclosed.locator,loc(1,0));
eq(disclosed.text,"node01");
eq(disclosed.canActivate,false);
eq(disclosed.engineVerified,false);
eq(disclosed.physicalTopologyVerified,false);
eq(JSON.stringify(disclosed).includes(CANARY),false);
eq(sha(original),before,"ODT bytes unchanged");
eq((await discloseReviewedOdtCell(original,before,loc(1,2),true)).text,"192.0.2.15");
await fail(original,before,loc(1,1),true,"ODT_CELL_SENSITIVE_BLOCKED");
await fail(original,before,loc(3,1),true,"ODT_CELL_SENSITIVE_BLOCKED");
await fail(original,before,loc(2,0),true,"ODT_CELL_SENSITIVE_BLOCKED");
await fail(original,before,{...loc(1,0),tableOrdinal:-1},true,"ODT_CELL_LOCATOR_INVALID");
await fail(original,before,{...loc(1,0),rowOrdinal:1000},true,"ODT_CELL_LOCATOR_INVALID");
await fail(original,before,{...loc(1,0),cellOrdinal:0.5},true,"ODT_CELL_LOCATOR_INVALID");
await fail(original,before,{...loc(1,0),part:"word/document.xml"},true,"ODT_CELL_LOCATOR_INVALID");
await fail(original,before,{...loc(1,0),kind:"docx-table-cell"},true,"ODT_CELL_LOCATOR_INVALID");
await fail(original,before,{...loc(1,0),unexpected:"data"},true,"ODT_CELL_LOCATOR_INVALID");
await fail(original,before,{...loc(1,0),sourceSha256:"0".repeat(64)},true,"ODT_CELL_LOCATOR_INVALID");
const updated=pack(rows.map((r,i)=>i===1?["node02",...r.slice(1)]:r));
await fail(updated,before,loc(1,0),true,"ODT_CELL_STALE_SOURCE");
for(const suspicious of ["https://example.org","user@example.org","<img src=x>",
 "X".repeat(50),"new\nline","PRIVATE_KEY","Bearer token","some_password","abc/def",
 "123456789012345678901234567890"]){
 // XML-safe candidates; angle brackets require entity escaping for accepted simple XML fixture
 const text=suspicious.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
 const bytes=pack([["Name"],[text]]);
 const preview=await previewOdtTableStructure(bytes);
 const target=preview.tables[0].rows[1].cells[0].locator;
 await fail(bytes,preview.sourceSha256,target,true,"ODT_CELL_SENSITIVE_BLOCKED");
}
const dtd=pack(rows,{contentXml:content([table(rows)]).replace("<office:body>",
 '<!DOCTYPE office:document-content [<!ENTITY e SYSTEM "file:///etc/passwd">]><office:body>')});
await fail(dtd,sha(dtd),{...loc(1,0),sourceSha256:sha(dtd)},true,"ODT_CELL_SOURCE_BLOCKED");
const repeated=pack(rows,{contentXml:content([table(rows)]).replace("<table:table-row>",
 '<table:table-row table:number-rows-repeated="2">')});
await fail(repeated,sha(repeated),{...loc(1,0),sourceSha256:sha(repeated)},true,"ODT_CELL_SOURCE_BLOCKED");
const bridged=await reviewOdtFileCell(file("inventory.ODT"),before,loc(1,0),true);
eq(bridged,disclosed);
const originalPreview=await previewOdtFileStructure(file("inventory.odt"));
eq(originalPreview.preview.sourceSha256,before);
await assert.rejects(reviewOdtFileCell(file("inventory.txt"),before,loc(1,0),true),
 e=>e.code==="ODT_FILE_EXTENSION_INVALID");count++;
await assert.rejects(reviewOdtFileCell(file("inventory.odt"),before,loc(1,0),false),
 e=>e.code==="ODT_CELL_CONSENT_REQUIRED");count++;
await assert.rejects(reviewOdtFileCell(file("inventory.odt",original,16*1024*1024+1),
 before,loc(1,0),true),e=>e.code==="ODT_FILE_SIZE_INVALID");count++;
const html=renderToStaticMarkup(React.createElement(OdtCellDisclosureReview,{
 preview:p,onRevealCell(){throw Error("SSR must not reveal");}
}));
for(const expected of ['data-odt-disclosure="OPERATOR_REVIEW_ONLY"',
 'data-odt-select-cell="true"','data-odt-consent="true"',
 'data-odt-reveal="true"','data-odt-disclosure-warning="true"',
 'Select a cell','disabled=""']){
 assert.ok(html.includes(expected),"Missing consent UI "+expected);count++;
}
for(const forbidden of [CANARY,"node01","abc123","192.0.2.15",
 'data-odt-revealed-value="true"']){
 eq(html.includes(forbidden),false,"No unconsented text: "+forbidden);
}
const blank=renderToStaticMarkup(React.createElement(OdtStructurePanel,{
 inspectFile:previewOdtFileStructure,reviewFile:reviewOdtFileCell,onClose(){} }));
eq(blank.includes('data-odt-disclosure="OPERATOR_REVIEW_ONLY"'),false,
 "Not offered before source validated");
const fs=await import("node:fs");
const main=fs.readFileSync("ui/app/main.mjs","utf8");
assert.match(main,/reviewFile: reviewOdtFileCell/);count++;
const panel=fs.readFileSync("ui/app/odt-structure-panel.mjs","utf8");
assert.match(panel,/key:result.sourceEpoch/);count++;
assert.match(panel,/localFile.current=null/);count++;
for(const path of ["ui/app/odt-cell-disclosure-review.mjs",
 "enterprise-import/src/odt-cell-disclosure.ts"]){
 const source=fs.readFileSync(path,"utf8");
 for(const forbidden of ["setWorkspace(", "dangerouslySetInnerHTML",
  "indexedDB", "localStorage", "fetch(", "console.log(", "console.error("]){
  eq(source.includes(forbidden),false,"No persistence/side effects "+path);
 }
}
console.log("PASS ODT P3 "+count+" exact source ZIP/SHA, single-cell consent, sensitive/header blocks, React SSR");
