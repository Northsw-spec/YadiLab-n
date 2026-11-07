import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolveResourceAsset, safeBuiltinAssetPath } from "../../dist-assetlibrary-test/asset-library/src/index.js";
const here=path.dirname(fileURLToPath(import.meta.url)); const root=path.resolve(here,"../..");
const base=JSON.parse(fs.readFileSync(path.join(root,"tests/generated/compiled-foundation.json"),"utf8"));
let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++}; const eq=(a,b,m)=>{assert.equal(a,b,m);checks++};
ok(!safeBuiltinAssetPath("../evil.svg"),"traversal rejected"); ok(!safeBuiltinAssetPath("https://x/a.svg"),"remote path rejected"); ok(!safeBuiltinAssetPath("assets/builtin/a.js"),"non-image extension rejected"); ok(!safeBuiltinAssetPath("assets\\builtin\\a.svg"),"backslash path rejected");
{
 const s=structuredClone(base); const r=s.resources[0]; r.asset={id:"missing.asset",version:"1.0.0"}; const x=resolveResourceAsset(s,r); ok(!x.ok,"missing lock rejected"); if(!x.ok)eq(x.code,"ASSET_LOCK_MISSING","missing lock code");
}
{
 const s=structuredClone(base); const r=s.resources[0]; const lock=s.assetLocks.find(x=>x.id===r.asset.id); s.assetLocks.push(structuredClone(lock)); const x=resolveResourceAsset(s,r); ok(!x.ok,"duplicate lock rejected"); if(!x.ok)eq(x.code,"ASSET_LOCK_DUPLICATE","duplicate lock code");
}
{
 const s=structuredClone(base); const r=s.resources[0]; const lock=s.assetLocks.find(x=>x.id===r.asset.id); lock.path="assets/builtin/../evil.svg"; const x=resolveResourceAsset(s,r); ok(!x.ok,"unsafe lock path rejected"); if(!x.ok)eq(x.code,"ASSET_LOCK_PATH_INVALID","unsafe path code");
}
{
 const s=structuredClone(base); const r=s.resources[0]; const lock=s.assetLocks.find(x=>x.id===r.asset.id); lock.mime="image/png"; const x=resolveResourceAsset(s,r); ok(!x.ok,"mime/path mismatch rejected"); if(!x.ok)eq(x.code,"ASSET_LOCK_MIME_INVALID","mime mismatch code");
}
console.log(`PASS asset library adversarial suite: ${checks} assertions.`);
