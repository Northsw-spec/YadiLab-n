import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  csvImportAdapter, tsvImportAdapter, jsonImportAdapter, selectEnterpriseImportAdapter,
  createXlsxImportAdapter, createOdsImportAdapter, computeMappingProfileHash, runEnterpriseImport,
} from "../../dist-enterprise-import-test/enterprise-import/src/index.js";
import { nodeZipArchiveBackend } from "./node_zip_backend.mjs";

const here=path.dirname(fileURLToPath(import.meta.url)); const root=path.resolve(here,"../..");
const profile=JSON.parse(fs.readFileSync(path.join(root,"tests/fixtures/valid/enterprise-mapping-profile.json"),"utf8"));
const bytes=(name)=>new Uint8Array(fs.readFileSync(path.join(root,"tests/fixtures/import",name)));
const workbookBytes=(name)=>new Uint8Array(fs.readFileSync(path.join(root,"tests/fixtures/workbooks",name)));
const workbookProfile=structuredClone(profile); workbookProfile.tables[0].sourceTable="Devices";
const xlsx=createXlsxImportAdapter(nodeZipArchiveBackend); const ods=createOdsImportAdapter(nodeZipArchiveBackend);
let pass=0; const ok=async(name,fn)=>{await fn(); pass++; console.log(`PASS ${name}`);};

await ok("adapter selection is deterministic by media type",()=>{
  assert.equal(selectEnterpriseImportAdapter("text/csv").id,"builtin.csv");
  assert.equal(selectEnterpriseImportAdapter("text/tab-separated-values; charset=utf-8").id,"builtin.tsv");
  assert.equal(selectEnterpriseImportAdapter("application/json").id,"builtin.json");
  assert.equal(selectEnterpriseImportAdapter("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").id,"builtin.xlsx");
  assert.equal(selectEnterpriseImportAdapter("application/vnd.oasis.opendocument.spreadsheet").id,"builtin.ods");
});
await ok("mapping profile hash is canonical across object key order",async()=>{
  const a=await computeMappingProfileHash(profile); const reordered={...profile,version:profile.version,profileId:profile.profileId,formatId:profile.formatId,schemaVersion:profile.schemaVersion,tables:profile.tables};
  assert.equal(await computeMappingProfileHash(reordered),a);
});
await ok("CSV adapter parses two logical records",()=>{ const r=csvImportAdapter.parse({bytes:bytes("devices.csv"),mediaType:"text/csv"},{options:{}}); assert.equal(r.document.tables[0].records.length,2); });
await ok("TSV adapter parses two logical records",()=>{ const r=tsvImportAdapter.parse({bytes:bytes("devices.tsv"),mediaType:"text/tab-separated-values"},{options:{}}); assert.equal(r.document.tables[0].records.length,2); });
await ok("CSV adapter handles quoted commas, newlines and escaped quotes",()=>{ const special=new TextEncoder().encode('Asset ID,Hostname,Notes\r\npc01,"PC, 01","line1\nline2 ""quoted"""\r\n'); const r=csvImportAdapter.parse({bytes:special,mediaType:"text/csv"},{options:{}}); const f=r.document.tables[0].records[0].fields; assert.equal(f.Hostname.value,"PC, 01"); assert.equal(f.Notes.value,'line1\nline2 "quoted"'); });
await ok("JSON root array parses into records table",()=>{ const r=jsonImportAdapter.parse({bytes:bytes("devices.json"),mediaType:"application/json"},{options:{}}); assert.equal(r.document.tables[0].tableId,"records"); assert.equal(r.document.tables[0].records.length,2); });
await ok("JSON object-array parsing preserves unsupported metadata as warning",()=>{ const r=jsonImportAdapter.parse({bytes:bytes("devices-object.json"),mediaType:"application/json"},{options:{}}); assert.equal(r.document.tables[0].tableId,"records"); assert.ok(r.diagnostics.some(x=>x.code==="IMPORT_JSON_UNSUPPORTED_TOP_LEVEL_MEMBER")); });
const csv=await runEnterpriseImport({baselineId:"customer_lab",source:{bytes:bytes("devices.csv"),mediaType:"text/csv",displayName:"devices.csv"},mappingProfile:profile,options:{trimStrings:true}});
await ok("CSV import is READY",()=>{assert.equal(csv.report.status,"READY",JSON.stringify(csv.report.diagnostics)); assert.ok(csv.baseline);});
await ok("CSV import creates two deterministic entities",()=>{assert.deepEqual(csv.baseline.entities.map(x=>x.entityId),["pc01","pc02"]);});
await ok("source descriptor is content-addressed by exact source bytes",async()=>{ const {createHash}=await import("node:crypto"); const expected=createHash("sha256").update(Buffer.from(bytes("devices.csv"))).digest("hex"); assert.equal(csv.report.source.sha256,expected); assert.equal(csv.report.source.sourceId,`src_${expected}`); });
await ok("alias mapping is preserved in provenance",()=>{ const p=csv.baseline.provenance.find(x=>x.mapping?.mappingId==="ipv4"); assert.equal(p.mapping.class,"ALIAS"); assert.equal(p.field,"IP Address"); });
await ok("exact mapping is preserved in provenance",()=>{ const p=csv.baseline.provenance.find(x=>x.mapping?.mappingId==="hostname"); assert.equal(p.mapping.class,"EXACT"); assert.equal(p.field,"Hostname"); });
await ok("missing optional gateway becomes explicit UNKNOWN",()=>{ const f=csv.baseline.facts.find(x=>x.subjectRef==="pc02"&&x.path==="/network/defaultGateway"); assert.equal(f.state,"UNKNOWN"); assert.equal(f.reasonCode,"SOURCE_MISSING"); });
await ok("unmapped Notes column is reported transparently",()=>{ const u=csv.report.unmappedFields.find(x=>x.field==="Notes"); assert.equal(u.occurrences,2); });
await ok("USER_MAPPED class is preserved when explicitly configured",async()=>{ const user=structuredClone(profile); user.tables[0].facts.find(x=>x.mappingId==="os").selector.matches=[{field:"OS",class:"USER_MAPPED"}]; const r=await runEnterpriseImport({baselineId:"customer_lab",source:{bytes:bytes("devices.csv"),mediaType:"text/csv"},mappingProfile:user,options:{trimStrings:true}}); assert.equal(r.report.status,"READY"); const p=r.baseline.provenance.find(x=>x.mapping?.mappingId==="os"); assert.equal(p.mapping.class,"USER_MAPPED"); });
await ok("display filename does not change baseline identity",async()=>{ const other=await runEnterpriseImport({baselineId:"customer_lab",source:{bytes:bytes("devices.csv"),mediaType:"text/csv",displayName:"renamed.csv"},mappingProfile:profile,options:{trimStrings:true}}); assert.equal(other.baseline.baselineIdentity,csv.baseline.baselineIdentity); });
await ok("same exact import contract replays to same baseline identity",async()=>{ const again=await runEnterpriseImport({baselineId:"customer_lab",source:{bytes:bytes("devices.csv"),mediaType:"text/csv"},mappingProfile:profile,options:{trimStrings:true}}); assert.equal(again.baseline.baselineIdentity,csv.baseline.baselineIdentity); });
await ok("TSV and JSON adapters produce the same semantic entity/fact values",async()=>{
  const tsv=await runEnterpriseImport({baselineId:"customer_lab",source:{bytes:bytes("devices.tsv"),mediaType:"text/tab-separated-values"},mappingProfile:profile,options:{trimStrings:true}});
  const js=await runEnterpriseImport({baselineId:"customer_lab",source:{bytes:bytes("devices.json"),mediaType:"application/json"},mappingProfile:profile,options:{trimStrings:true}});
  assert.equal(tsv.report.status,"READY"); assert.equal(js.report.status,"READY");
  const project=(b)=>b.facts.map(({subjectRef,path,state,...rest})=>({subjectRef,path,state,value:"value" in rest?rest.value:undefined})).sort((a,b)=>`${a.subjectRef}${a.path}`.localeCompare(`${b.subjectRef}${b.path}`));
  assert.deepEqual(project(tsv.baseline),project(csv.baseline)); assert.deepEqual(project(js.baseline),project(csv.baseline));
});

await ok("XLSX adapter detects multiple sheets and physical cell locators",async()=>{
  const r=await xlsx.parse({bytes:workbookBytes("devices.xlsx"),mediaType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},{options:{}});
  assert.deepEqual(r.document.tables.map(x=>x.tableId),["Devices","Metadata"]);
  const c=r.document.tables[0].records[0].fields["IP Address"]; assert.deepEqual(c.locator,{kind:"table-cell",sheet:"Devices",row:2,column:"C"});
  assert.ok(r.diagnostics.some(x=>x.code==="IMPORT_WORKBOOK_SHEET_DETECTED"&&x.table==="Devices"));
});
const xlsxRun=await runEnterpriseImport({baselineId:"customer_lab",source:{bytes:workbookBytes("devices.xlsx"),mediaType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",displayName:"devices.xlsx"},mappingProfile:workbookProfile,adapter:xlsx,options:{trimStrings:true}});
await ok("XLSX import is READY and preserves cached-formula warning",()=>{ assert.equal(xlsxRun.report.status,"READY",JSON.stringify(xlsxRun.report.diagnostics)); assert.ok(xlsxRun.baseline); assert.ok(xlsxRun.report.diagnostics.some(x=>x.code==="IMPORT_WORKBOOK_CACHED_FORMULA_VALUE")); });
await ok("XLSX import produces the same semantic device facts as CSV",()=>{
  const project=(b)=>b.facts.map(({subjectRef,path,state,...rest})=>({subjectRef,path,state,value:"value" in rest?rest.value:undefined})).sort((a,b)=>`${a.subjectRef}${a.path}`.localeCompare(`${b.subjectRef}${b.path}`));
  assert.deepEqual(project(xlsxRun.baseline),project(csv.baseline));
});
await ok("XLSX provenance identifies exact sheet/cell",()=>{ const p=xlsxRun.baseline.provenance.find(x=>x.mapping?.mappingId==="ipv4"&&x.field==="IP Address"); assert.deepEqual(p.locator,{kind:"table-cell",sheet:"Devices",row:2,column:"C"}); });
await ok("XLSX supports explicit per-sheet header row",async()=>{ const r=await runEnterpriseImport({baselineId:"title_lab",source:{bytes:workbookBytes("devices-title-row.xlsx"),mediaType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},mappingProfile:workbookProfile,adapter:xlsx,options:{trimStrings:true,headerRows:{Devices:2}}}); assert.equal(r.report.status,"READY",JSON.stringify(r.report.diagnostics)); assert.deepEqual(r.baseline.entities.map(x=>x.entityId),["pc01"]); });
await ok("ODS adapter detects multiple sheets and physical cell locators",async()=>{
  const r=await ods.parse({bytes:workbookBytes("devices.ods"),mediaType:"application/vnd.oasis.opendocument.spreadsheet"},{options:{}});
  assert.deepEqual(r.document.tables.map(x=>x.tableId),["Devices","Metadata"]);
  const c=r.document.tables[0].records[0].fields["IP Address"]; assert.deepEqual(c.locator,{kind:"table-cell",sheet:"Devices",row:2,column:"C"});
});
const odsRun=await runEnterpriseImport({baselineId:"customer_lab",source:{bytes:workbookBytes("devices.ods"),mediaType:"application/vnd.oasis.opendocument.spreadsheet",displayName:"devices.ods"},mappingProfile:workbookProfile,adapter:ods,options:{trimStrings:true}});
await ok("ODS import is READY and preserves cached-formula warning",()=>{ assert.equal(odsRun.report.status,"READY",JSON.stringify(odsRun.report.diagnostics)); assert.ok(odsRun.baseline); assert.ok(odsRun.report.diagnostics.some(x=>x.code==="IMPORT_WORKBOOK_CACHED_FORMULA_VALUE")); });
await ok("ODS import produces the same semantic device facts as CSV",()=>{
  const project=(b)=>b.facts.map(({subjectRef,path,state,...rest})=>({subjectRef,path,state,value:"value" in rest?rest.value:undefined})).sort((a,b)=>`${a.subjectRef}${a.path}`.localeCompare(`${b.subjectRef}${b.path}`));
  assert.deepEqual(project(odsRun.baseline),project(csv.baseline));
});
await ok("workbook source format remains part of deterministic baseline identity",()=>{ assert.notEqual(xlsxRun.baseline.baselineIdentity,odsRun.baseline.baselineIdentity); });
await ok("ODS ordinary external hyperlink is ignored without network access",async()=>{ const r=await ods.parse({bytes:workbookBytes("ods-hyperlink.ods"),mediaType:"application/vnd.oasis.opendocument.spreadsheet"},{options:{}}); assert.ok(r.diagnostics.some(x=>x.code==="IMPORT_WORKBOOK_EXTERNAL_HYPERLINK_IGNORED")); assert.equal(r.document.tables[0].records[0].fields.Notes.value,"remote"); });



await ok("official XLSX enterprise template imports through normal pipeline",async()=>{ const templateProfile=JSON.parse(fs.readFileSync(path.join(root,"examples/enterprise-import/enterprise-import-template.mapping.json"),"utf8")); const b=new Uint8Array(fs.readFileSync(path.join(root,"examples/enterprise-import/enterprise-import-template.xlsx"))); const r=await runEnterpriseImport({baselineId:"template_lab",source:{bytes:b,mediaType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},mappingProfile:templateProfile,adapter:xlsx,options:{trimStrings:true}}); assert.equal(r.report.status,"READY",JSON.stringify(r.report.diagnostics)); assert.equal(r.baseline.entities.length,2); });
await ok("official ODS enterprise template imports through normal pipeline",async()=>{ const templateProfile=JSON.parse(fs.readFileSync(path.join(root,"examples/enterprise-import/enterprise-import-template.mapping.json"),"utf8")); const b=new Uint8Array(fs.readFileSync(path.join(root,"examples/enterprise-import/enterprise-import-template.ods"))); const r=await runEnterpriseImport({baselineId:"template_lab",source:{bytes:b,mediaType:"application/vnd.oasis.opendocument.spreadsheet"},mappingProfile:templateProfile,adapter:ods,options:{trimStrings:true}}); assert.equal(r.report.status,"READY",JSON.stringify(r.report.diagnostics)); assert.equal(r.baseline.entities.length,2); });

console.log(`PASS enterprise import functional: ${pass}/30 assertions`);
