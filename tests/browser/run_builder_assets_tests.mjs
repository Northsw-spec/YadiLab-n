import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createBuilderWorkspace, setBuilderSelection, buildBuilderAssetLibraryModel, applyAssetToSelectedResource, clearAssetFromSelectedResource } from "../../dist-browser-test/ui/src/browser/index.js";
const here=path.dirname(fileURLToPath(import.meta.url)); const root=path.resolve(here,"../..");
const source=JSON.parse(fs.readFileSync(path.join(root,"tests/fixtures/valid/scenario-source.json"),"utf8"));
const catalog=JSON.parse(fs.readFileSync(path.join(root,"catalog/builtin-catalog.json"),"utf8"));
let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++}; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};
let ws=createBuilderWorkspace(source); ws=setBuilderSelection(ws,["firewall01"],"firewall01");
let model=buildBuilderAssetLibraryModel(ws,catalog.assets);
eq(model.selectedResourceId,"firewall01","selected resource projected into Asset Library model");
ok(model.items.some(x=>x.id==="network.firewall" && x.compatibleWithSelection),"compatible firewall asset surfaced");
ok(model.items.some(x=>x.id==="actor.attacker" && !x.compatibleWithSelection),"incompatible asset visibly disabled by model");
const def=catalog.assets.find(x=>x.id==="network.firewall"); const applied=applyAssetToSelectedResource(ws,def); ok(applied.ok,"trusted compatible asset can be applied");
if(applied.ok){ ws=applied.workspace; eq(ws.source.resources.find(x=>x.id==="firewall01").asset,{id:"network.firewall",version:"1.0.0"},"explicit exact asset requirement written to source"); eq(ws.compile.status,"idle","asset edit invalidates compile state"); ok(ws.dirty,"asset edit marks builder dirty"); }
const cleared=clearAssetFromSelectedResource(ws); ok(cleared.ok,"explicit asset can be cleared"); if(cleared.ok){ws=cleared.workspace; ok(!("asset" in ws.source.resources.find(x=>x.id==="firewall01")),"clear returns resource to automatic resolution");}
const appSource=fs.readFileSync(path.join(root,"ui/app/main.mjs"),"utf8"); ok(appSource.includes('data-asset-library'),"browser source renders Asset Library panel"); ok(appSource.includes('className: "resource-asset"'),"resource node renders resolved asset image");
console.log(`PASS Builder Asset Library suite: ${checks} assertions.`);
