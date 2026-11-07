import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  enterpriseMediaTypeForFile,
  readEnterpriseImportFile,
  readEnterpriseMappingProfileFile,
  reviewEnterpriseImport,
  applyImportHelperMappingDecisions,
  importEnterpriseBaseline,
  previewEnterpriseReimport,
  planImportHelperMerge,
  applyImportHelperMerge,
  nextMappingProfileVersion,
  findEntityConflictCandidates,
  projectImportHelperBaseline,
} from "../../dist-browser-test/ui/src/browser/import-helper.js";

const here=path.dirname(fileURLToPath(import.meta.url)); const root=path.resolve(here,"../..");
const profile=JSON.parse(fs.readFileSync(path.join(root,"tests/fixtures/valid/enterprise-mapping-profile.json"),"utf8"));
const enc=(s)=>new TextEncoder().encode(s); let pass=0;
const ok=async(name,fn)=>{await fn();pass++;console.log(`PASS ${name}`)};

await ok("enterprise file extensions map deterministically",async()=>{
  assert.equal(enterpriseMediaTypeForFile("customer.xlsx"),"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(enterpriseMediaTypeForFile("customer.ods"),"application/vnd.oasis.opendocument.spreadsheet");
  assert.equal(enterpriseMediaTypeForFile("customer.csv"),"text/csv");
  assert.equal(enterpriseMediaTypeForFile("customer.tsv"),"text/tab-separated-values");
  assert.equal(enterpriseMediaTypeForFile("customer.json"),"application/json");
});
await ok("browser-like enterprise file becomes exact source bytes",async()=>{
  const bytes=enc("Asset ID,Hostname\npc01,PC-01\n");
  const source=await readEnterpriseImportFile({name:"customer.csv",type:"text/plain",arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
  assert.equal(source.mediaType,"text/csv"); assert.equal(source.displayName,"customer.csv"); assert.deepEqual([...source.bytes],[...bytes]);
});
await ok("mapping profile JSON file loads",async()=>{
  const loaded=await readEnterpriseMappingProfileFile({name:"map.json",text:async()=>JSON.stringify(profile)});
  assert.equal(loaded.profileId,profile.profileId); assert.equal(loaded.version,profile.version);
});
await ok("mapping review view uses deterministic backend review",async()=>{
  const source={bytes:enc("Asset ID,Hostname,IP Address,Default GW\npc01,PC-01,10.0.0.2,10.0.0.1\n"),mediaType:"text/csv",displayName:"customer.csv"};
  const result=await reviewEnterpriseImport({source,mappingProfile:profile});
  assert.equal(result.review.status,"READY"); assert.equal(result.view.sourceName,"customer.csv"); assert.ok(result.document);
  assert.ok(result.view.tables[0].mappings.every(x=>x.status==="RESOLVED"||!x.required));
});
await ok("explicit mapping choice becomes USER_MAPPED",async()=>{
  const source={bytes:enc("Asset ID,MachineName,IP Address\npc01,PC-01,10.0.0.2\n"),mediaType:"text/csv"};
  const reviewed=await reviewEnterpriseImport({source,mappingProfile:profile});
  assert.equal(reviewed.review.status,"REVIEW_REQUIRED"); assert.ok(reviewed.document);
  const next=applyImportHelperMappingDecisions({profile,document:reviewed.document,decisions:[{kind:"field",mappingId:"hostname",field:"MachineName"}],nextVersion:nextMappingProfileVersion(profile.version)});
  const rerun=await reviewEnterpriseImport({source,mappingProfile:next});
  const mapping=rerun.review.tables[0].mappings.find(x=>x.mappingId==="hostname");
  assert.equal(mapping.status,"RESOLVED"); assert.equal(mapping.selectedClass,"USER_MAPPED");
});
await ok("initial import view reports normalized baseline",async()=>{
  const source={bytes:enc("Asset ID,Hostname,IP Address,Default GW\npc01,PC-01,10.0.0.2,10.0.0.1\n"),mediaType:"text/csv"};
  const result=await importEnterpriseBaseline({baselineId:"corp",source,mappingProfile:profile});
  assert.equal(result.report.status,"READY"); assert.ok(result.baseline); assert.equal(result.view.entities,1); assert.ok(result.view.baselineIdentity);
});
await ok("re-import diff and merge helper preserve backend semantics",async()=>{
  const a=(await importEnterpriseBaseline({baselineId:"corp",source:{bytes:enc("Asset ID,Hostname,IP Address,Default GW\npc01,PC-01,10.0.0.2,10.0.0.1\n"),mediaType:"text/csv"},mappingProfile:profile})).baseline;
  const b=(await importEnterpriseBaseline({baselineId:"corp",source:{bytes:enc("Asset ID,Hostname,IP Address,Default GW\npc01,PC-01,10.0.0.2,10.0.0.254\n"),mediaType:"text/csv"},mappingProfile:profile})).baseline;
  assert.ok(a&&b); const diff=previewEnterpriseReimport(a,b); assert.equal(diff.view.changed,true); assert.ok(diff.view.summary.factsChanged>=1);
  const merge=await planImportHelperMerge(a,a,b); assert.equal(merge.plan.status,"READY"); const merged=await applyImportHelperMerge({ancestor:a,current:a,incoming:b,plan:merge.plan});
  assert.equal(merged.facts.find(x=>x.path==="/network/defaultGateway")?.value,"10.0.0.254");
});
await ok("entity collision candidates expose exact source rows",async()=>{
  const source={bytes:enc("Asset ID,Hostname,IP Address\npc01,First,10.0.0.2\npc01,Second,10.0.0.3\n"),mediaType:"text/csv"};
  const reviewed=await reviewEnterpriseImport({source,mappingProfile:profile}); assert.ok(reviewed.document);
  const candidates=findEntityConflictCandidates(reviewed.document,profile,"pc01");
  assert.deepEqual(candidates.map(x=>[x.table,x.row,x.label]),[["records",1,"First"],["records",2,"Second"]]);
});

await ok("verified baseline projects into ordinary Builder workspace",async()=>{
  const source={bytes:enc("Asset ID,Hostname,IP Address,Default GW\npc01,PC-01,10.0.0.2,10.0.0.1\n"),mediaType:"text/csv"};
  const imported=await importEnterpriseBaseline({baselineId:"corp",source,mappingProfile:profile}); assert.ok(imported.baseline);
  const projected=await projectImportHelperBaseline(imported.baseline);
  assert.equal(projected.report.status,"READY"); assert.ok(projected.workspace);
  assert.equal(projected.workspace.mode,"builder"); assert.equal(projected.workspace.source.enterpriseOrigin.baselineIdentity,imported.baseline.baselineIdentity);
  assert.equal(projected.workspace.source.resources.length,1);
});

await ok("Import Helper UI is the implemented nomenclature",async()=>{
  const main=fs.readFileSync(path.join(root,"ui/app/main.mjs"),"utf8");
  assert.ok(main.includes('"Importhjälp"')); assert.ok(!main.includes("Import Wizard UI"));
  assert.ok(main.includes('data-import-helper'));
});
console.log(`PASS Import Helper functional suite: ${pass}/10 assertions.`);
