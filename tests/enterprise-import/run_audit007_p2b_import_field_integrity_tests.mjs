import assert from "node:assert/strict";
import { csvImportAdapter, tsvImportAdapter } from "../../dist-enterprise-import-test/enterprise-import/src/delimited.js";
import { jsonImportAdapter } from "../../dist-enterprise-import-test/enterprise-import/src/json.js";
import { tableFromPhysicalRows } from "../../dist-enterprise-import-test/enterprise-import/src/tabular.js";
import { EnterpriseImportError } from "../../dist-enterprise-import-test/enterprise-import/src/types.js";

const enc = str => new TextEncoder().encode(str);
let assertions = 0;
function eq(actual,expected,description) { assert.deepEqual(actual,expected,description);assertions++; }
function yes(actual,description) { assert.ok(actual,description);assertions++; }
function safeFields(fields,keys,format){
  eq(Object.getPrototypeOf(fields),Object.prototype,format+" prototype remains ordinary");
  for(const key of keys){
    eq(Object.hasOwn(fields,key),true,format+" literal own field "+key);
    yes(fields[key] && typeof fields[key]==="object",format+" ImportCell retained "+key);
    yes(fields[key].locator,format+" source locator retained "+key);
  }
  eq(Object.keys(fields),keys,format+" deterministic own field order");
  eq(fields.value,undefined,format+" no inherited fake value from __proto__ field");
  eq(fields.locator,undefined,format+" no inherited fake locator");
}
const names=["__proto__","constructor","toString","nodeId"];
for(const [name,adapter,delimiter,media] of [
  ["CSV",csvImportAdapter,",","text/csv"],
  ["TSV",tsvImportAdapter,"\t","text/tab-separated-values"],
]){
  const parsed=await adapter.parse({
    bytes:enc(names.join(delimiter)+"\n"+["explicit","own","method","node01"].join(delimiter)+"\n"),
    mediaType:media,
  },{options:{tableName:"Devices"}});
  const record=parsed.document.tables[0].records[0];
  safeFields(record.fields,names,name);
  eq(record.fields["__proto__"].value,"explicit",name+" own prototype-named value");
  eq(record.fields["constructor"].value,"own",name+" literal constructor value");
  eq(record.fields["toString"].value,"method",name+" literal toString value");
  eq(record.fields["nodeId"].value,"node01",name+" ordinary field preserved");
  eq(record.fields["__proto__"].locator,{kind:"record-row",table:"Devices",row:2},
    name+" exact row locator");
  const content=[
    "nodeId"+delimiter+"comment",
    "node01"+delimiter+'"alpha'+delimiter+'beta"',
    "node02"+delimiter+'"first\nsecond"',
    "node03"+delimiter+'"a""b"',
  ].join("\n")+"\n";
  const valid=await adapter.parse({bytes:enc(content),mediaType:media},{options:{tableName:"Devices"}});
  eq(valid.document.tables[0].records.map(x=>x.fields.comment.value),
    ["alpha"+delimiter+"beta","first\nsecond",'a"b'],name+" proper quoted delimiters multiline and doubled quotes");
  const crlf=await adapter.parse({bytes:enc("id"+delimiter+"note\r\nnode01"+delimiter+'"alpha"\r\n'),mediaType:media},{options:{}});
  eq(crlf.document.tables[0].records[0].fields.note.value,"alpha",name+" quoted CRLF field end");
  for(const [malformed,code] of [
    ['node01'+delimiter+'"alpha"junk',"IMPORT_MALFORMED_QUOTE"],
    ['node01'+delimiter+'""tail',"IMPORT_MALFORMED_QUOTE"],
    ['node01'+delimiter+'"alpha" ',"IMPORT_MALFORMED_QUOTE"],
    ['node01'+delimiter+'"alpha""tail',"IMPORT_UNCLOSED_QUOTE"],
    ['node01'+delimiter+'"alpha""tail"junk',"IMPORT_MALFORMED_QUOTE"],
  ]){
    await assert.rejects(
      async ()=>adapter.parse({
        bytes:enc("id"+delimiter+"comment\n"+malformed+"\n"),mediaType:media,
      },{options:{}}),
      e=>e instanceof EnterpriseImportError&&e.code===code,
      name+" rejects quoted source with the exact appropriate stable error");assertions++;
  }
}
for(const [label,payload,tableId,locator] of [
  ["JSON root",'{"__proto__":"own", "constructor":"custom", "toString":"literal", "nodeId":"node01"}',"records",
    "/__proto__"],
  ["JSON array",'[{"__proto__":"own", "constructor":"custom", "toString":"literal", "nodeId":"node01"}]',"records",
    "/0/__proto__"],
  ["JSON tables",'{"Devices":[{"__proto__":"own", "constructor":"custom", "toString":"literal", "nodeId":"node01"}]}',"Devices",
    "/Devices/0/__proto__"],
]){
  const actual=await jsonImportAdapter.parse({bytes:enc(payload),mediaType:"application/json"},{options:{}});
  const table=actual.document.tables[0];
  eq(table.tableId,tableId,label+" table ID preserved");
  safeFields(table.records[0].fields,names,label);
  eq(table.records[0].fields["__proto__"].value,"own",label+" own key value");
  eq(table.records[0].fields["__proto__"].locator,{kind:"json-pointer",pointer:locator},
    label+" exact JSON Pointer provenance");
}
const special=await jsonImportAdapter.parse({
  bytes:enc('{"a/b":{"ignored":true},"a~b":"literal","__proto__":"own"}'),mediaType:"application/json",
},{options:{}});
const sf=special.document.tables[0].records[0].fields;
eq(sf["a/b"].locator.pointer,"/a~1b","JSON Pointer slash encoded");
eq(sf["a~b"].locator.pointer,"/a~0b","JSON Pointer tilde encoded");
eq(Object.hasOwn(sf,"__proto__"),true,"JSON own magic key persisted with slash and tilde");
const fields=["__proto__","constructor","toString","nodeId"];
const worksheetRows=[
 {row:1,cells:new Map(fields.map((v,i)=>[String.fromCharCode(65+i),{
   value:v,locator:{kind:"table-cell",sheet:"Devices",row:1,column:String.fromCharCode(65+i)}}]))},
 {row:2,cells:new Map(fields.map((v,i)=>[String.fromCharCode(65+i),{
   value:["own","ctor","method","node01"][i],
   locator:{kind:"table-cell",sheet:"Devices",row:2,column:String.fromCharCode(65+i)}}]))},
];
const diag=[];
const table=tableFromPhysicalRows("Devices",worksheetRows,1,diag);
eq(diag,[],"physical XLSX/ODS shared mapper has no invented warnings");
eq(table.records.length,1,"physical XLSX/ODS mapper kept row");
safeFields(table.records[0].fields,fields,"XLSX/ODS shared physical mapper");
eq(table.records[0].fields["__proto__"].value,"own","XLSX/ODS own field retained");
eq(table.records[0].fields["__proto__"].locator,
  {kind:"table-cell",sheet:"Devices",row:2,column:"A"},
  "XLSX/ODS source-aligned table cell locator");
eq(Object.getPrototypeOf({}),Object.prototype,"Object.prototype globally unmodified");
console.log("PASS AUDIT-007 P2b: "+assertions+
  " actual compiled CSV TSV JSON and XLSX/ODS shared physical-row field/quote safety assertions");
