import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeEnterpriseBaselineIdentity, verifyEnterpriseBaseline } from "../../dist-enterprise-test/enterprise-model/src/index.js";
const here=path.dirname(fileURLToPath(import.meta.url)); const root=path.resolve(here,"../.."); const base=JSON.parse(fs.readFileSync(path.join(root,"tests/fixtures/valid/enterprise-baseline.json"),"utf8"));
let pass=0; async function expectCode(name,mutate,code,{rehash=true}={}){ const b=structuredClone(base); mutate(b); if(rehash) b.baselineIdentity=await computeEnterpriseBaselineIdentity(b); const r=await verifyEnterpriseBaseline(b); assert.equal(r.ok,false); assert.ok(r.diagnostics.some(x=>x.code===code),JSON.stringify(r.diagnostics)); pass++; console.log(`PASS ${name}`); }
await expectCode("forged baseline identity rejected",b=>{b.baselineIdentity="f".repeat(64)},"ENTERPRISE_BASELINE_IDENTITY_MISMATCH",{rehash:false});
await expectCode("sourceId/hash mismatch rejected",b=>{b.sources[0].sourceId=`src_${"d".repeat(64)}`},"ENTERPRISE_SOURCE_ID_HASH_MISMATCH");
await expectCode("unknown provenance source rejected",b=>{b.provenance[0].sourceRef=`src_${"e".repeat(64)}`},"ENTERPRISE_UNKNOWN_SOURCE_REF");
await expectCode("unknown relationship endpoint rejected",b=>{b.relationships[0].toRef="missing"},"ENTERPRISE_UNKNOWN_RELATIONSHIP_ENDPOINT");
await expectCode("unknown entity provenance reference rejected",b=>{b.entities[0].provenanceRefs=["missing"]},"ENTERPRISE_UNKNOWN_PROVENANCE_REF");
await expectCode("unknown fact subject rejected",b=>{b.facts[0].subjectRef="missing"},"ENTERPRISE_UNKNOWN_FACT_SUBJECT");
await expectCode("unknown provenance reference rejected",b=>{b.facts[0].provenanceRefs=["missing"]},"ENTERPRISE_UNKNOWN_PROVENANCE_REF");
await expectCode("known ipv4 type mismatch rejected",b=>{b.facts.find(x=>x.factId==="fact_ip").value="999.20.30.44"},"ENTERPRISE_VALUE_TYPE_MISMATCH");
await expectCode("unknown inference input rejected",b=>{b.facts.find(x=>x.state==="INFERRED").inference.inputFactRefs=["missing"]},"ENTERPRISE_UNKNOWN_INFERENCE_INPUT");
await expectCode("self inference rejected",b=>{const f=b.facts.find(x=>x.state==="INFERRED"); f.inference.inputFactRefs=[f.factId]},"ENTERPRISE_SELF_INFERENCE");
await expectCode("duplicate conflicting value rejected",b=>{const f=b.facts.find(x=>x.state==="CONFLICTING"); f.candidates[1].value=f.candidates[0].value},"ENTERPRISE_DUPLICATE_CONFLICT_CANDIDATE");
await expectCode("global object id collision rejected",b=>{b.relationships[0].relationshipId=b.entities[0].entityId},"ENTERPRISE_GLOBAL_ID_COLLISION");
await expectCode("duplicate fact id rejected",b=>{b.facts.push(structuredClone(b.facts[0]))},"ENTERPRISE_DUPLICATE_ID");

await expectCode("lineage duplicate parent role rejected",b=>{b.lineage={kind:"REIMPORT_MERGE",mergePlanSha256:"a".repeat(64),parents:[{role:"ANCESTOR",baselineIdentity:"1".repeat(64)},{role:"ANCESTOR",baselineIdentity:"2".repeat(64)},{role:"INCOMING",baselineIdentity:"3".repeat(64)}],resolutions:[]}} ,"ENTERPRISE_LINEAGE_PARENT_ROLE_INVALID");
await expectCode("lineage duplicate resolution key rejected",b=>{b.lineage={kind:"REIMPORT_MERGE",mergePlanSha256:"a".repeat(64),parents:[{role:"ANCESTOR",baselineIdentity:"1".repeat(64)},{role:"CURRENT",baselineIdentity:"2".repeat(64)},{role:"INCOMING",baselineIdentity:"3".repeat(64)}],resolutions:[{entryKey:"entity:pc01",choice:"CURRENT"},{entryKey:"entity:pc01",choice:"INCOMING"}]}} ,"ENTERPRISE_LINEAGE_DUPLICATE_RESOLUTION");
console.log(`PASS enterprise model adversarial: ${pass}/15 assertions`);
