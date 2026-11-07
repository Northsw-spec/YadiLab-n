import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {ZipJsArchiveBackend} from "../../dist-browser-test/package-io/src/zipjs-backend.js";
import {inspectSharedDocumentFileReadOnly} from "../../dist-browser-test/ui/src/browser/structured-document-inspection-file.js";
import {inspectOfficeStructureSourceReadOnly} from "../../dist-browser-test/enterprise-import/src/structured-office-source-inspection.js";
import {previewDocxTableStructure} from "../../dist-browser-test/enterprise-import/src/docx-tables-structural-preview.js";
import {previewOdtTableStructure} from "../../dist-browser-test/enterprise-import/src/odt-tables-structural-preview.js";
import {builtinEnterpriseImportAdapters,selectEnterpriseImportAdapter} from "../../dist-browser-test/enterprise-import/src/adapters.js";
import {StructuredXmlInspectionPanel,StructuredXmlInspectionDetails} from "../../ui/app/structured-xml-inspection-panel.mjs";
import {makeOdtZip,packageEntries,table,content} from "../enterprise-import/odt_test_package.mjs";

let count=0;
const eq=(x,y,m)=>{assert.deepEqual(x,y,m);count++};
const ok=(x,m)=>{assert.ok(x,m);count++};
const bytes=(x)=>new TextEncoder().encode(x);
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const file=(name,b,declared=b.byteLength)=>({name,size:declared,
  async arrayBuffer(){return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}});
const throws=async(task,code)=>{await assert.rejects(task,e=>e?.code===code,code);count++};

const DOCX_SECRET="SECRET_DOCX_P3C_RAW_CELL_CANARY_NOT_RENDER";
const ODT_SECRET="SECRET_ODT_P3C_RAW_CELL_CANARY_NOT_RENDER";
const WORD="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const TYPES="http://schemas.openxmlformats.org/package/2006/content-types";
const REL="http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const MAIN="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const packageEntriesDocx={
  "[Content_Types].xml":'<Types xmlns="'+TYPES+'"><Override PartName="/word/document.xml" ContentType="'+MAIN+'"/></Types>',
  "_rels/.rels":'<Relationships xmlns="'+REL+'"><Relationship Id="rId1" Type="'+OFFICE+'" Target="word/document.xml"/></Relationships>',
  "word/document.xml":'<w:document xmlns:w="'+WORD+'"><w:body><w:tbl>'+
    '<w:tr><w:tc><w:p><w:r><w:t>Host</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>IP</w:t></w:r></w:p></w:tc></w:tr>'+
    '<w:tr><w:tc><w:p><w:r><w:t>node01</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>'+DOCX_SECRET+
    '</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
};
const backend=new ZipJsArchiveBackend();
async function zip(doc=packageEntriesDocx){
  const blob=await backend.write(Object.entries(doc).map(([path,text])=>({path,bytes:bytes(text)})));
  return new Uint8Array(await blob.arrayBuffer());
}
const docx=await zip();
const odt=makeOdtZip(packageEntries({
  tables:[table([["Host","IP"],["node01",ODT_SECRET]])],
}));
const samples=[
  {name:"sample.DOCX",input:docx,profile:"office.docx-tables.structural.v1",kind:"DOCX_TABLE_STRUCTURE",secret:DOCX_SECRET},
  {name:"sample.odt",input:odt,profile:"office.odt-tables.structural.v1",kind:"ODT_TABLE_STRUCTURE",secret:ODT_SECRET},
];
for(const item of samples){
  const digest=sha(item.input);
  const inspect=await inspectSharedDocumentFileReadOnly(file(item.name,item.input));
  eq(inspect.status,"REVIEW_REQUIRED","Strict source parsed");
  eq(inspect.profileId,item.profile);
  eq(inspect.semanticTrack,"CONFIG_DOCUMENTED");
  eq(inspect.sourceSha256,digest,"Hash of the original full ZIP bytes");
  eq(inspect.documentLocator,{
    kind:"source-document",profileId:item.profile,sourceSha256:digest,
  },"Typed original ZIP locator only");
  eq(inspect.summary,{
    kind:item.kind,declaredTables:1,declaredRows:2,structuralCells:4,sourceBoundCellLocators:4,
  },"Aggregate only; no cell content, lengths or paths");
  eq(inspect.canActivate,false);
  eq(inspect.modelMutated,false);
  eq(inspect.engineVerified,false);
  eq(inspect.physicalTopologyVerified,false);
  ok(Object.isFrozen(inspect),"Frozen top-level");
  ok(Object.isFrozen(inspect.documentLocator),"Frozen document locator");
  ok(Object.isFrozen(inspect.summary),"Frozen summary");
  eq(sha(item.input),digest,"No source mutation");
  const original=item.kind==="DOCX_TABLE_STRUCTURE"?
    await previewDocxTableStructure(item.input):await previewOdtTableStructure(item.input);
  let locCount=0;
  for(const [t,table] of original.tables.entries()){
    eq(table.tableOrdinal,t,"Producer original table ordinal");
    for(const [rowIndex,row] of table.rows.entries()){
      eq(row.rowOrdinal,rowIndex,"Producer original row ordinal");
      for(const [cellIndex,cell] of row.cells.entries()){
        eq(cell.locator.sourceSha256,digest,"Original cell SHA provenance");
        eq(cell.locator.tableOrdinal,t,"Original table binding");
        eq(cell.locator.rowOrdinal,rowIndex,"Original row binding");
        eq(cell.locator.cellOrdinal,cellIndex,"Original cell binding");
        locCount++;
      }
    }
  }
  eq(inspect.summary.sourceBoundCellLocators,locCount,"All producer locators validated");
  const html=renderToStaticMarkup(React.createElement(StructuredXmlInspectionDetails,{result:inspect}));
  for(const needle of [
    'data-ic010-p2-profile="'+item.profile+'"','data-ic010-p2-track="CONFIG_DOCUMENTED"',
    'data-ic010-p2-counts="'+item.kind+'"','data-ic010-p2-activation="BLOCKED"',
    "Tables: 1","Rows: 2","Structural cells: 4","Source-bound cell references: 4",
    "Original SHA-256: "+digest,
  ])ok(html.includes(needle),"Result SSR contains only intended metadata "+needle);
  const serialized=JSON.stringify(inspect)+html;
  for(const forbidden of [
    item.secret,DOCX_SECRET,ODT_SECRET,"node01",">Host<",">IP<","textCodeUnits",
    "word/document.xml","content.xml","tableOrdinal","rowOrdinal","cellOrdinal",
    "locators","<w:document","<office:document","sourceText","cellText",
  ])eq(serialized.includes(forbidden),false,"No source disclosure or original ZIP detail "+forbidden);
  eq(JSON.stringify(await inspectSharedDocumentFileReadOnly(file(item.name,item.input))),
    JSON.stringify(inspect),"Deterministic output for unchanged full ZIP");
}
for(const [name,payload] of [
  ["fake.docx",odt],["fake.odt",docx],
  ["bad.docx",bytes("not-a-word-zip")],["bad.odt",bytes("not-an-odt-zip-but-long-enough-to-parse-and-fail!")],
  ["script.odt",makeOdtZip(packageEntries({extra:{"Scripts/startup.js":"alert(1)"}}))],
  ["wrongmime.odt",makeOdtZip(packageEntries({mime:"application/vnd.oasis.opendocument.spreadsheet"}))],
  ["dtd.odt",makeOdtZip(packageEntries({contentXml:content([table([["A"]])]).replace(
    "<office:body>",'<!DOCTYPE office:document-content [<!ENTITY x SYSTEM "file:///etc/passwd">]><office:body>')}))],
  ["script.docx",await zip({...packageEntriesDocx,"word/vbaProject.bin":"not a macro"})],
  ["external.docx",await zip({...packageEntriesDocx,"_rels/.rels":
    packageEntriesDocx["_rels/.rels"].replace('Target="word/document.xml"','Target="https://example.invalid/host" TargetMode="External"')})],
  ["dtd.docx",await zip({...packageEntriesDocx,"word/document.xml":
    packageEntriesDocx["word/document.xml"].replace("<w:body>",
      "<!DOCTYPE w:document [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><w:body>")})],
]){
  const v=await inspectSharedDocumentFileReadOnly(file(name,payload));
  eq(v.status,"BLOCKED","Malicious/wrong container denied: "+name);
  eq(v.code,"IC010_P3C_CONTENT_UNRECOGNIZED","Fixed safe blocked code: "+name);
  eq(Object.hasOwn(v,"sourceSha256"),false,"Blocked content never returns hash");
  eq(Object.hasOwn(v,"summary"),false,"Blocked content never returns parse details");
  eq(v.canActivate,false,"No activation after invalid source");
}
let reads=0;
await throws(inspectSharedDocumentFileReadOnly({
  name:"large.docx",size:16*1024*1024+1,
  async arrayBuffer(){reads++;return new ArrayBuffer(8)},
}),"IC010_P3C_SOURCE_SIZE_INVALID");
eq(reads,0,"Oversized declared input never read");
await throws(inspectSharedDocumentFileReadOnly({
  name:"empty.odt",size:12,
  async arrayBuffer(){reads++;return new ArrayBuffer(100)},
}),"IC010_P3C_SOURCE_SIZE_INVALID");
eq(reads,0,"Declared too-small ODT never read");
await throws(inspectSharedDocumentFileReadOnly({
  name:"large.odt",size:100,
  async arrayBuffer(){return new ArrayBuffer(16*1024*1024+1)},
}),"IC010_P3C_SOURCE_READ_INVALID");
await throws(inspectSharedDocumentFileReadOnly({
  name:"bad.docx",size:100,
  async arrayBuffer(){return bytes("string pretending to be ArrayBuffer")},
}),"IC010_P3C_SOURCE_READ_INVALID");
for(const invalid of ["../scan.odt","../../hidden.docx","C:\\temp\\host.docx","evil\u0000.docx","weird.tgz","future.pdf","future.pcap"]){
  await throws(inspectSharedDocumentFileReadOnly({name:invalid,size:200,
    async arrayBuffer(){reads++;return new ArrayBuffer(200)}}),
    /[\\/]/.test(invalid)||invalid.includes("\u0000")?"IC010_P3_FILE_INVALID":"IC010_P3_EXTENSION_UNSUPPORTED");
}
eq(reads,0,"Unsupported or traversal file is rejected before reading");
eq((await inspectOfficeStructureSourceReadOnly("evil.pdf",docx)).code,
  "IC010_P3C_EXTENSION_UNSUPPORTED","No generic Office archive interpretation");
eq((await inspectOfficeStructureSourceReadOnly("small.odt",bytes("short"))).code,
  "IC010_P3C_SOURCE_SIZE_INVALID","Short ODT source fail-closed");

const empty=renderToStaticMarkup(React.createElement(StructuredXmlInspectionPanel,{
  inspectFile:inspectSharedDocumentFileReadOnly,workspaceIdentity:{},
  getCurrentWorkspaceIdentity(){return {}},onClose(){},
}));
for(const marker of [
  'accept=".graphml,.drawio,.nessus,.xml,.yml,.yaml,.ini,.docx,.odt"',
  'data-ic010-p2-panel="READ_ONLY"',
  'data-ic010-p2-file="true"',
  'data-ic010-p2-inspect="true"',
  "structural DOCX/ODT tables",
  "Office cell contents are never displayed",
]){
  ok(empty.includes(marker),"Shared chooser marker "+marker);
}
for(const selector of ['data-ic010-p2-inspect','data-ic010-p2-consent']){
  const tag=empty.match(new RegExp("<(?:button|input)[^>]*"+selector+"[^>]*>"))?.[0]??"";
  ok(tag.includes("disabled"),"Initial consent/no-source denial "+selector);
}
eq(empty.includes('data-ic010-p3b-review='),false,"Office chooser cannot pre-authorize Ansible review");
eq(builtinEnterpriseImportAdapters.map(x=>x.id),
  ["builtin.json","builtin.csv","builtin.tsv","builtin.xlsx","builtin.ods"],
  "Five native adapters unchanged");
eq(selectEnterpriseImportAdapter("text/csv").id,"builtin.csv");
ok(fs.readFileSync("ui/app/structured-xml-inspection-panel.mjs","utf8")
  .includes("/^IC010_(?:XML|STATIC|P3|P3C|P3D)_[A-Z0-9_]+$/"),
  "Office fixed-size codes remain safely displayable rather than generic XML fallback");
console.log("PASS IC-010 P3c shared Office ZIP structural inspection: "+
  count+" producer, SHA, locator, secret redaction, archive spoof, size, consent and truth assertions.");
