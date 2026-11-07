import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeEnterpriseBaselineIdentity, verifyEnterpriseBaseline, enterpriseIdentityProjection } from "../../dist-enterprise-test/enterprise-model/src/index.js";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"../..");
const fixture=JSON.parse(fs.readFileSync(path.join(root,"tests/fixtures/valid/enterprise-baseline.json"),"utf8"));
let pass=0; const ok=(name,fn)=>Promise.resolve().then(fn).then(()=>{pass++; console.log(`PASS ${name}`);});

await ok("identity is a lowercase sha256", async()=>{ const h=await computeEnterpriseBaselineIdentity(fixture); assert.match(h,/^[0-9a-f]{64}$/); });
await ok("displayName is excluded from semantic identity", async()=>{ const a=await computeEnterpriseBaselineIdentity(fixture); const changed=structuredClone(fixture); changed.sources[0].displayName="renamed.xlsx"; assert.equal(await computeEnterpriseBaselineIdentity(changed),a); });
await ok("array order is canonicalized for identified collections", async()=>{ const a=await computeEnterpriseBaselineIdentity(fixture); const changed=structuredClone(fixture); changed.entities.reverse(); changed.facts.reverse(); changed.provenance.reverse(); changed.sources.reverse(); changed.relationships.reverse(); assert.equal(await computeEnterpriseBaselineIdentity(changed),a); });
await ok("projection excludes baselineIdentity", async()=>{ assert.equal(Object.hasOwn(enterpriseIdentityProjection(fixture),"baselineIdentity"),false); });
await ok("valid fixture verifies after identity is filled", async()=>{ const b=structuredClone(fixture); b.baselineIdentity=await computeEnterpriseBaselineIdentity(b); const result=await verifyEnterpriseBaseline(b); assert.equal(result.ok,true,JSON.stringify(result.diagnostics)); });
await ok("known ipv4 fact is type checked", async()=>{ const b=structuredClone(fixture); b.baselineIdentity=await computeEnterpriseBaselineIdentity(b); const result=await verifyEnterpriseBaseline(b); assert.equal(result.diagnostics.some(x=>x.code==="ENTERPRISE_VALUE_TYPE_MISMATCH"),false); });
await ok("inferred fact may cite existing input fact", async()=>{ const b=structuredClone(fixture); b.baselineIdentity=await computeEnterpriseBaselineIdentity(b); const result=await verifyEnterpriseBaseline(b); assert.equal(result.diagnostics.some(x=>x.code==="ENTERPRISE_UNKNOWN_INFERENCE_INPUT"),false); });
await ok("conflicting facts preserve two distinct sourced candidates", async()=>{ const f=fixture.facts.find(x=>x.state==="CONFLICTING"); assert.equal(f.candidates.length,2); assert.notDeepEqual(f.candidates[0].value,f.candidates[1].value); });
await ok("sourceId is content-addressed by source sha256", async()=>{ for(const s of fixture.sources) assert.equal(s.sourceId,`src_${s.sha256}`); });
await ok("same semantic model with reordered conflict candidates has same identity", async()=>{ const a=await computeEnterpriseBaselineIdentity(fixture); const b=structuredClone(fixture); b.facts.find(x=>x.state==="CONFLICTING").candidates.reverse(); assert.equal(await computeEnterpriseBaselineIdentity(b),a); });
console.log(`PASS enterprise model functional: ${pass}/10 assertions`);
