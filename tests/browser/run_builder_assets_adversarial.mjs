import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createBuilderWorkspace, setBuilderSelection, applyAssetToSelectedResource, clearAssetFromSelectedResource } from "../../dist-browser-test/ui/src/browser/index.js";
const here=path.dirname(fileURLToPath(import.meta.url)); const root=path.resolve(here,"../..");
const source=JSON.parse(fs.readFileSync(path.join(root,"tests/fixtures/valid/scenario-source.json"),"utf8"));
const catalog=JSON.parse(fs.readFileSync(path.join(root,"catalog/builtin-catalog.json"),"utf8"));
let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++}; const eq=(a,b,m)=>{assert.equal(a,b,m);checks++};
let ws=createBuilderWorkspace(source);
{
 const result=applyAssetToSelectedResource(ws,catalog.assets[0]); ok(!result.ok,"asset application requires resource selection"); if(!result.ok)eq(result.diagnostics[0].code,"BUILDER_ASSET_RESOURCE_REQUIRED","selection diagnostic explicit");
}
ws=setBuilderSelection(ws,["firewall01"],"firewall01");
{
 const attacker=catalog.assets.find(x=>x.id==="actor.attacker"); const before=JSON.stringify(ws.source); const result=applyAssetToSelectedResource(ws,attacker); ok(!result.ok,"incompatible asset rejected before source mutation"); if(!result.ok)eq(result.diagnostics[0].code,"BUILDER_ASSET_TYPE_MISMATCH","type mismatch code"); eq(JSON.stringify(result.workspace.source),before,"failed asset edit atomic");
}
{
 const fake={...catalog.assets.find(x=>x.id==="network.firewall"),trusted:false}; const result=applyAssetToSelectedResource(ws,fake); ok(!result.ok,"untrusted catalog object rejected"); if(!result.ok)eq(result.diagnostics[0].code,"BUILDER_ASSET_UNTRUSTED","untrusted code");
}
{
 let noSelection=setBuilderSelection(ws,[]); const result=clearAssetFromSelectedResource(noSelection); ok(!result.ok,"clear requires selected resource"); if(!result.ok)eq(result.diagnostics[0].code,"BUILDER_ASSET_RESOURCE_REQUIRED","clear selection diagnostic");
}
console.log(`PASS Builder Asset Library adversarial suite: ${checks} assertions.`);
