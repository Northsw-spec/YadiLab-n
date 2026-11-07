import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EnterpriseImportError } from "../../dist-enterprise-import-test/enterprise-import/src/types.js";
import { previewOdtTableStructure, ODT_TABLES_PROFILE } from "../../dist-enterprise-import-test/enterprise-import/src/odt-tables-structural-preview.js";
import { selectEnterpriseImportAdapter } from "../../dist-enterprise-import-test/enterprise-import/src/adapters.js";
import { makeOdtZip, packageEntries, content, manifest, row, table, ODT_MIME } from "./odt_test_package.mjs";

const sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const CANARY="SECRET_ODT_CELL_DO_NOT_RENDER_932";
const doc=table([["Host","IP"],["node01",CANARY]]);
const standard=packageEntries({tables:[doc]});
const pack=entries=>makeOdtZip(entries);
let checks=0;
const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);checks++;};
async function denied(entries,code){
 const bytes=entries instanceof Uint8Array?entries:pack(entries);
 await assert.rejects(previewOdtTableStructure(bytes),
  e=>e instanceof EnterpriseImportError&&e.code===code,code);
 checks++;
}
const raw=pack(standard);
const actual=await previewOdtTableStructure(raw);
eq(Buffer.from(raw).readUInt32LE(0),0x04034b50);
eq(Buffer.from(raw).readUInt16LE(8),0,"mimetype truly stored");
eq(Buffer.from(raw).readUInt16LE(28),0,"mimetype local no extra");
eq(Buffer.from(raw).subarray(30,38).toString(),"mimetype");
eq(actual.profileId,ODT_TABLES_PROFILE);
eq(actual.semanticTrack,"CONFIG_DOCUMENTED");
eq(actual.status,"REVIEW_REQUIRED");
eq(actual.canActivate,false);
eq(actual.engineVerified,false);
eq(actual.physicalTopologyVerified,false);
eq(actual.textIncluded,false);
eq(actual.sourceSha256,sha(raw));
eq(actual.tables.length,1);
eq(actual.totalCells,4);
eq(actual.tables[0].rows.map(r=>r.cells.map(c=>c.textCodeUnits)),[[4,2],[6,CANARY.length]]);
eq(actual.tables[0].rows[1].cells[1].locator,
 {kind:"odt-table-cell",sourceSha256:sha(raw),part:"content.xml",
  tableOrdinal:0,rowOrdinal:1,cellOrdinal:1});
eq(JSON.stringify(actual).includes(CANARY),false);
eq(JSON.stringify(actual).includes("node01"),false);
eq(JSON.stringify(actual).includes("Host"),false);
eq(JSON.stringify(actual).includes('"text"'),false);
eq(JSON.stringify(await previewOdtTableStructure(raw)),JSON.stringify(actual));
eq(sha(raw),actual.sourceSha256,"source unchanged");
const more=await previewOdtTableStructure(pack(packageEntries({
 tables:[table([["A"]]),table([["B","C"]])]
})));
eq(more.tables.length,2);
eq(more.totalCells,3);
eq(more.tables[1].rows[0].cells[1].locator.tableOrdinal,1);
const empty=await previewOdtTableStructure(pack(packageEntries({tables:[]})));
eq(empty.tables.length,0);
eq(empty.totalCells,0);
await denied(new Uint8Array(),"ODT_SOURCE_SIZE_INVALID");
await denied(new Uint8Array(16*1024*1024+1),"ODT_SOURCE_SIZE_INVALID");
await denied(new Uint8Array(100),"ODT_PACKAGE_HEADER_INVALID");
await denied(pack(packageEntries({compressedMimetype:true})),"ODT_MIMETYPE_MUST_BE_STORED");
await denied(pack([{...standard[1],stored:true},standard[0],standard[2]]),"ODT_MIMETYPE_HEADER_INVALID");
await denied(pack(packageEntries({mime:"application/vnd.oasis.opendocument.spreadsheet"})),"ODT_MIMETYPE_VALUE_INVALID");
await denied(pack(standard.filter(x=>x.path!=="content.xml")),"ODT_REQUIRED_MEMBER_MISSING");
await denied(pack(standard.filter(x=>x.path!=="META-INF/manifest.xml")),"ODT_REQUIRED_MEMBER_MISSING");
await denied(pack(packageEntries({manifestXml:manifest("application/vnd.oasis.opendocument.spreadsheet")})),"ODT_MANIFEST_MISMATCH");
await denied(pack(packageEntries({extra:{"Scripts/startup.js":"alert(1)"}})),"ODT_UNSUPPORTED_PACKAGE_MEMBER");
await denied(pack(packageEntries({extra:{"Pictures/image.png":"opaque"}})),"ODT_UNSUPPORTED_PACKAGE_MEMBER");
await denied(pack(packageEntries({contentXml:content([doc]).replace("<office:body>","<!DOCTYPE office:document-content [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><office:body>")})),"IMPORT_XML_DTD_FORBIDDEN");
await denied(pack(packageEntries({contentXml:content([doc]).replace("<office:body>","<office:body xmlns:office='urn:spoof'>")})),"ODT_NAMESPACE_REDECLARATION");
await denied(pack(packageEntries({contentXml:content([doc],"urn:wrong")})),"ODT_DOCUMENT_NAMESPACE_INVALID");
await denied(pack(packageEntries({contentXml:content([doc]).replace("<text:p>node01</text:p>","<text:p><text:span>node01</text:span></text:p>")})),"ODT_RICH_CELL_TEXT_UNSUPPORTED");
await denied(pack(packageEntries({contentXml:content([doc]).replace("<text:p>node01</text:p>","<text:p><text:a xlink:href='https://example.invalid'>node01</text:a></text:p>")})),"ODT_ACTIVE_OR_EXTERNAL_CONTENT");
await denied(pack(packageEntries({contentXml:content([doc]).replace("<table:table-row>","<table:table-row table:number-rows-repeated='2'>")})),"ODT_UNSUPPORTED_ATTRIBUTE");
await denied(pack(packageEntries({contentXml:content([doc]).replace("<table:table-cell office:value-type=\"string\">","<table:table-cell office:value-type=\"string\" table:number-columns-spanned='2'>")})),"ODT_UNSUPPORTED_ATTRIBUTE");
await denied(pack(packageEntries({contentXml:content([doc]).replace("<table:table-cell office:value-type=\"string\"><text:p>Host</text:p></table:table-cell>","<table:covered-table-cell/>")})),"ODT_UNSUPPORTED_MARKUP");
await denied(pack(packageEntries({contentXml:content([doc]).replace("<table:table-column/>","<table:table-column table:number-columns-repeated='2'/>")})),"ODT_UNSUPPORTED_ATTRIBUTE");
await denied(pack(packageEntries({contentXml:content([doc]).replace("<table:table-column/>","<table:table-column/><table:table-cell table:formula='of:=A1'/>")})),"ODT_UNSUPPORTED_MARKUP");
await denied(pack(packageEntries({contentXml:content([doc]).replace("</table:table-cell>","<table:table><table:table-row><table:table-cell/></table:table-row></table:table></table:table-cell>")})),"ODT_NESTED_OR_WRAPPED_TABLE");
await denied(pack(packageEntries({tables:[table([["x".repeat(4097)]])]})),"ODT_CELL_TEXT_TOO_LARGE");
await denied(pack(packageEntries({tables:Array.from({length:21},()=>table([["x"]]))})),"ODT_TOO_MANY_TABLES");
await denied(pack(packageEntries({tables:[table(Array.from({length:201},()=>["x"]))]})),"ODT_ROW_COUNT_UNSUPPORTED");
await denied(pack(packageEntries({tables:[table([Array.from({length:17},()=> "x")])]})),"ODT_COLUMN_COUNT_UNSUPPORTED");
assert.throws(
 ()=>selectEnterpriseImportAdapter("application/vnd.oasis.opendocument.text"),
 e=>e instanceof EnterpriseImportError&&e.code==="IMPORT_UNSUPPORTED_MEDIA_TYPE");
checks++;
console.log("PASS ODT P1 "+checks+" exact original ZIP/mimetype/manifest/safety and no-value table structure assertions");
