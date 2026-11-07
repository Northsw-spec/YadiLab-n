import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ZipJsArchiveBackend } from "../../dist-enterprise-import-test/package-io/src/zipjs-backend.js";
import { EnterpriseImportError } from "../../dist-enterprise-import-test/enterprise-import/src/types.js";
import { DOCX_TABLES_PROFILE, previewDocxTableStructure } from "../../dist-enterprise-import-test/enterprise-import/src/docx-tables-structural-preview.js";
import { selectEnterpriseImportAdapter } from "../../dist-enterprise-import-test/enterprise-import/src/adapters.js";

const word="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const rel="http://schemas.openxmlformats.org/package/2006/relationships";
const typ="http://schemas.openxmlformats.org/package/2006/content-types";
const mainType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const officeRel="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const enc=(s)=>new TextEncoder().encode(s);
const digest=(b)=>crypto.createHash("sha256").update(b).digest("hex");
const content=(type=mainType)=>`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${typ}"><Override PartName="/word/document.xml" ContentType="${type}"/></Types>`;
const relationships=(target="word/document.xml",extra="")=>`<?xml version="1.0"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${officeRel}" Target="${target}"/>${extra}</Relationships>`;
const tc=(value)=>`<w:tc><w:tcPr/><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`;
const tr=(cells)=>`<w:tr>${cells.map(tc).join("")}</w:tr>`;
const table=(rows)=>`<w:tbl><w:tblPr/><w:tblGrid/>${rows.map(tr).join("")}</w:tbl>`;
const doc=(tables,ns=word)=>`<?xml version="1.0"?><w:document xmlns:w="${ns}"><w:body>${tables.join("")}</w:body></w:document>`;
const canary="CANARY_SECRET_DO_NOT_LEAK_987";
const valid=doc([table([["Hostname","IP"],["edge01",canary]])]);
const base={"[Content_Types].xml":content(),"_rels/.rels":relationships(),"word/document.xml":valid};
const backend=new ZipJsArchiveBackend();
const pack=async(overrides={},extras={})=>{
 const paths={...base,...overrides,...extras};
 const blob=await backend.write(Object.entries(paths).filter(([,v])=>v!==null).map(([path,data])=>({path,bytes:enc(data)})));
 return new Uint8Array(await blob.arrayBuffer());
};
let assertions=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);assertions++;};
async function blocked(bytes,code){
 await assert.rejects(previewDocxTableStructure(bytes),e=>e instanceof EnterpriseImportError&&e.code===code,code);
 assertions++;
}
const raw=await pack();
const preview=await previewDocxTableStructure(raw);
eq(preview.profileId,DOCX_TABLES_PROFILE);
eq(preview.semanticTrack,"CONFIG_DOCUMENTED");
eq(preview.status,"REVIEW_REQUIRED");
eq(preview.canActivate,false);
eq(preview.engineVerified,false);
eq(preview.physicalTopologyVerified,false);
eq(preview.textIncluded,false);
eq(preview.sourceSha256,digest(raw),"ZIP original SHA256");
eq(preview.tables.length,1);
eq(preview.totalCells,4);
eq(preview.tables[0].rows.map(r=>r.cells.map(c=>c.textCodeUnits)),[[8,2],[6,canary.length]]);
eq(preview.tables[0].rows[1].cells[0].locator,{kind:"docx-table-cell",sourceSha256:digest(raw),
  part:"word/document.xml",tableOrdinal:0,rowOrdinal:1,cellOrdinal:0});
eq(JSON.stringify(await previewDocxTableStructure(raw)),JSON.stringify(preview),"deterministic");
eq(JSON.stringify(preview).includes(canary),false,"no secret leak");
eq(JSON.stringify(preview).includes("edge01"),false,"no raw host value");
eq(JSON.stringify(preview).includes("Hostname"),false,"no raw headers");
eq(Object.hasOwn(preview,"connections"),false,"no inferred physical links");
eq(Object.hasOwn(preview,"scenario"),false,"no scenario mutation");
eq(digest(raw),preview.sourceSha256,"input unchanged");
// Zero tables is a valid structural preview, not a supported active importer.
const empty=await previewDocxTableStructure(await pack({"word/document.xml":doc([])}));
eq(empty.tables.length,0);
eq(empty.totalCells,0);
const multi=await previewDocxTableStructure(await pack({"word/document.xml":doc([table([["one"]]),table([["two","three"]])])}));
eq(multi.tables.map(t=>t.rows.length),[1,1]);
eq(multi.totalCells,3);
eq(multi.tables[1].rows[0].cells[1].locator.cellOrdinal,1);
await blocked(new Uint8Array(),"DOCX_SOURCE_SIZE_INVALID");
await blocked(new Uint8Array(16*1024*1024+1),"DOCX_SOURCE_SIZE_INVALID");
await blocked(enc("not a zip"),"IMPORT_WORKBOOK_ARCHIVE_INVALID");
await blocked(await pack({"[Content_Types].xml":null}),"DOCX_REQUIRED_PACKAGE_MEMBER_MISSING");
await blocked(await pack({"_rels/.rels":null}),"DOCX_REQUIRED_PACKAGE_MEMBER_MISSING");
await blocked(await pack({"word/document.xml":null}),"DOCX_REQUIRED_PACKAGE_MEMBER_MISSING");
await blocked(await pack({"_rels/.rels":relationships("../external.xml")}),"DOCX_UNSUPPORTED_DOCUMENT_RELATIONSHIP");
await blocked(await pack({"[Content_Types].xml":content("application/other")}),"DOCX_UNSUPPORTED_CONTENT_TYPE");
await blocked(await pack({"_rels/.rels":relationships("word/document.xml",`<Relationship Id="rExt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External" Target="https://example.net/"/>`)}),"DOCX_EXTERNAL_RELATIONSHIP");
await blocked(await pack({},{"word/vbaProject.bin":"evil"}),"DOCX_ACTIVE_OR_EMBEDDED_CONTENT");
await blocked(await pack({},{"word/embeddings/object1.xml":"opaque"}),"DOCX_ACTIVE_OR_EMBEDDED_CONTENT");
await blocked(await pack({"word/document.xml":doc([table([["x"]])],"urn:wrong:namespace")}),"DOCX_UNSUPPORTED_NAMESPACE");
await blocked(await pack({"word/document.xml":doc([table([["x"]])]).replace("<w:body>","<w:body xmlns:w='urn:spoof'>")}),"DOCX_NAMESPACE_REDECLARATION");
await blocked(await pack({"word/document.xml":doc([table([["x"]])]).replace("<w:tcPr/>","<w:tcPr><w:gridSpan w:val='2'/></w:tcPr>")}),"DOCX_UNSUPPORTED_DOCUMENT_FEATURE");
await blocked(await pack({"word/document.xml":doc([table([["x"]])]).replace("</w:tc>","<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl></w:tc>")}),"DOCX_NESTED_OR_WRAPPED_TABLE");
await blocked(await pack({"word/document.xml":doc([table([["x"]])]).replace("<w:t>x</w:t>","<w:instrText>run-this</w:instrText>")}),"DOCX_UNSUPPORTED_DOCUMENT_FEATURE");
await blocked(await pack({"word/document.xml":doc([table([["x"]])]).replace("<w:t>x</w:t>","<w:drawing/>")}),"DOCX_UNSUPPORTED_DOCUMENT_FEATURE");
await blocked(await pack({"word/document.xml":doc([table([["x"]])]).replace("<w:t>x</w:t>","<w:t><w:r>not-a-cell-text</w:r></w:t>")}),"DOCX_UNSUPPORTED_CELL_MARKUP");
await blocked(await pack({"word/document.xml":doc([table([["x"]])]).replace("<w:p>","<w:p><w:hyperlink/>")}),"DOCX_UNSUPPORTED_DOCUMENT_FEATURE");
await blocked(await pack({"word/document.xml":doc([table([["x"]])]).replace("<w:body>","<!DOCTYPE w:document [<!ENTITY secret SYSTEM 'file:///etc/passwd'>]><w:body>")}),"IMPORT_XML_DTD_FORBIDDEN");
await blocked(await pack({"word/document.xml":doc([table([["x"]])]).replace("<w:body>","<w:body><w:altChunk/>")}),"DOCX_UNSUPPORTED_DOCUMENT_FEATURE");
await blocked(await pack({"word/document.xml":doc([table([[ "x".repeat(4097) ]])])}),"DOCX_CELL_TEXT_TOO_LARGE");
await blocked(await pack({"word/document.xml":doc(Array.from({length:21},()=>table([["v"]]))) }),"DOCX_TOO_MANY_TABLES");
await blocked(await pack({"word/document.xml":doc([table(Array.from({length:201},()=>["x"]))])}),"DOCX_ROW_COUNT_UNSUPPORTED");
await blocked(await pack({"word/document.xml":doc([table([Array.from({length:17},()=> "x")])])}),"DOCX_COLUMN_COUNT_UNSUPPORTED");
// DOCX P1 remains unregistered: active enterprise import selection must reject its MIME.
assert.throws(
  () => selectEnterpriseImportAdapter("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  e => e instanceof EnterpriseImportError && e.code === "IMPORT_UNSUPPORTED_MEDIA_TYPE",
);
assertions++;
console.log(`PASS DOCX structural P1: ${assertions} independent exact/negative, no-content and no-Engine assertions`);
