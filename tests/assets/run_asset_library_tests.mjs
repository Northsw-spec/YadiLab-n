import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildAssetPalette, resolveResourceAsset, safeBuiltinAssetPath } from "../../dist-assetlibrary-test/asset-library/src/index.js";
const here=path.dirname(fileURLToPath(import.meta.url)); const root=path.resolve(here,"../..");
const catalog=JSON.parse(fs.readFileSync(path.join(root,"catalog/builtin-catalog.json"),"utf8"));
const scenario=JSON.parse(fs.readFileSync(path.join(root,"tests/generated/compiled-foundation.json"),"utf8"));
let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++}; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};
const palette=buildAssetPalette(catalog.assets);
eq(palette.length,catalog.assets.length,"all trusted catalog assets appear in palette");
ok(palette.some(x=>x.id==="network.firewall"),"firewall asset present");
ok(palette.some(x=>x.id==="actor.attacker"),"attacker asset present");
ok(palette.every(x=>x.path.startsWith("assets/builtin/")),"palette exposes local paths only");
ok(palette.every(x=>safeBuiltinAssetPath(x.path)),"all palette paths pass strict local path policy");
for(const asset of catalog.assets){
  const sourcePath=path.join(root,"asset-library/builtin",path.basename(asset.path));
  ok(fs.existsSync(sourcePath),`builtin bytes exist: ${asset.id}`);
  const text=fs.readFileSync(sourcePath,"utf8");
  ok(text.startsWith("<svg"),`builtin svg root: ${asset.id}`);
  ok(!/<script\b/i.test(text),`no script in builtin svg: ${asset.id}`);
  ok(!/\bon[a-z]+\s*=/i.test(text),`no event handler in builtin svg: ${asset.id}`);
  ok(!/(?:href|src)\s*=\s*["'](?:https?:|\/\/)/i.test(text),`no remote reference in builtin svg: ${asset.id}`);
}
for(const resource of scenario.resources){
  const resolved=resolveResourceAsset(scenario,resource);
  ok(resolved.ok,`resource asset resolves: ${resource.id}`);
  if(resolved.ok){ eq(resolved.asset.id,resource.asset.id,`asset id exact: ${resource.id}`); eq(resolved.asset.objectFit,"contain",`contain rendering: ${resource.id}`); }
}
console.log(`PASS asset library suite: ${checks} assertions.`);
