import assert from "node:assert/strict";
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
import fs from "node:fs"; import path from "node:path"; import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));const root=path.resolve(here,"../..");const profile=JSON.parse(fs.readFileSync(path.join(root,"tests/fixtures/valid/enterprise-mapping-profile.json"),"utf8"));const enc=(s)=>new TextEncoder().encode(s);let pass=0;
const rejects=async(name,fn,pattern)=>{await assert.rejects(fn,pattern);pass++;console.log(`PASS ${name}`)};
await rejects("unsupported extension fails closed",async()=>enterpriseMediaTypeForFile("customer.xls"),/Unsupported enterprise import file/);
await rejects("declared MIME cannot override unsupported extension",async()=>enterpriseMediaTypeForFile("payload.exe","text/csv"),/Unsupported enterprise import file/);
await rejects("empty enterprise source rejected",async()=>readEnterpriseImportFile({name:"empty.csv",arrayBuffer:async()=>new ArrayBuffer(0)}),/is empty/);
await rejects("mapping profile must be JSON",async()=>readEnterpriseMappingProfileFile({name:"map.yaml",text:async()=>"{}"}),/must be a JSON file/);
await rejects("mapping profile wrong format rejected",async()=>readEnterpriseMappingProfileFile({name:"map.json",text:async()=>JSON.stringify({formatId:"wrong",profileId:"x",version:"1.0.0",tables:[]})}),/wrong formatId/);
await rejects("mapping profile malformed JSON rejected",async()=>readEnterpriseMappingProfileFile({name:"map.json",text:async()=>"{"}),/JSON is invalid/);
await rejects("mapping version bump rejects non-semver",async()=>nextMappingProfileVersion("version-one"),/not semantic versioning/);
await rejects("mapping decision cannot select unknown source field",async()=>{const src={bytes:enc("Asset ID,Hostname\npc01,A\n"),mediaType:"text/csv"};const r=await reviewEnterpriseImport({source:src,mappingProfile:profile});return applyImportHelperMappingDecisions({profile,document:r.document,decisions:[{kind:"field",mappingId:"hostname",field:"NoSuchField"}],nextVersion:"1.0.1"});},/does not exist/);
await rejects("diff rejects different baseline IDs",async()=>{const a=(await importEnterpriseBaseline({baselineId:"a",source:{bytes:enc("Asset ID,Hostname,IP Address\npc01,A,10.0.0.2\n"),mediaType:"text/csv"},mappingProfile:profile})).baseline;const b=(await importEnterpriseBaseline({baselineId:"b",source:{bytes:enc("Asset ID,Hostname,IP Address\npc01,A,10.0.0.2\n"),mediaType:"text/csv"},mappingProfile:profile})).baseline;return previewEnterpriseReimport(a,b);},/baselineId/i);
await rejects("stale merge plan rejected through helper",async()=>{const a=(await importEnterpriseBaseline({baselineId:"corp",source:{bytes:enc("Asset ID,Hostname,IP Address,Default GW\npc01,A,10.0.0.2,10.0.0.1\n"),mediaType:"text/csv"},mappingProfile:profile})).baseline;const b=(await importEnterpriseBaseline({baselineId:"corp",source:{bytes:enc("Asset ID,Hostname,IP Address,Default GW\npc01,A,10.0.0.2,10.0.0.2\n"),mediaType:"text/csv"},mappingProfile:profile})).baseline;const m=await planImportHelperMerge(a,a,b);const tampered=structuredClone(m.plan);tampered.entries[0].reason="UNCHANGED";return applyImportHelperMerge({ancestor:a,current:a,incoming:b,plan:tampered});},/plan does not match|stale/i);
await rejects("merge review requires explicit resolution",async()=>{const a=(await importEnterpriseBaseline({baselineId:"corp",source:{bytes:enc("Asset ID,Hostname,IP Address,Default GW\npc01,A,10.0.0.2,10.0.0.1\n"),mediaType:"text/csv"},mappingProfile:profile})).baseline;const current=structuredClone(a);const f=current.facts.find(x=>x.path==="/network/defaultGateway");f.value="10.0.0.9";const {computeEnterpriseBaselineIdentity}=await import("../../dist-browser-test/enterprise-model/src/index.js");current.baselineIdentity=await computeEnterpriseBaselineIdentity(current);const incoming=(await importEnterpriseBaseline({baselineId:"corp",source:{bytes:enc("Asset ID,Hostname,IP Address,Default GW\npc01,A,10.0.0.2,10.0.0.254\n"),mediaType:"text/csv"},mappingProfile:profile})).baseline;const m=await planImportHelperMerge(a,current,incoming);assert.equal(m.plan.status,"REVIEW_REQUIRED");return applyImportHelperMerge({ancestor:a,current,incoming,plan:m.plan});},/requires an explicit resolution/);

await rejects("tampered baseline cannot create Builder workspace",async()=>{
  const imported=await importEnterpriseBaseline({baselineId:"corp",source:{bytes:enc("Asset ID,Hostname,IP Address\npc01,A,10.0.0.2\n"),mediaType:"text/csv"},mappingProfile:profile});
  const bad=structuredClone(imported.baseline); bad.baselineIdentity="f".repeat(64);
  const projected=await projectImportHelperBaseline(bad); assert.equal(projected.workspace,undefined); assert.equal(projected.report.status,"BLOCKED");
  throw new Error("verified blocked projection");
},/verified blocked projection/);

await rejects("conflict candidate enumeration does not fuzzy-match entity IDs",async()=>{const src={bytes:enc("Asset ID,Hostname\npc01,A\nPC01,B\n"),mediaType:"text/csv"};const r=await reviewEnterpriseImport({source:src,mappingProfile:profile});const rows=findEntityConflictCandidates(r.document,profile,"pc01");assert.equal(rows.length,1);throw new Error("verified exact-only");},/verified exact-only/);
console.log(`PASS Import Helper adversarial suite: ${pass}/13 assertions.`);
