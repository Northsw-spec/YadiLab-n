import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createBuilderWorkspace,
  previewGeneratedBuilderFaultVariant,
  materializeGeneratedBuilderFaultVariant,
} from "../../dist-browser-test/ui/src/browser/index.js";

const here=path.dirname(fileURLToPath(import.meta.url)); const root=path.resolve(here,"../..");
const read=(p)=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8"));
const source=read("tests/fixtures/valid/scenario-source.json");
const scenario=read("tests/fixtures/valid/scenario-normalized.json");
const packs=[read("fault-packs/builtin/network-core.json"),read("fault-packs/builtin/windows-core.json"),read("fault-packs/builtin/linux-core.json")];
const builder={...createBuilderWorkspace(source),compile:{status:"valid",model:scenario,diagnostics:[]}};
let pass=0; const ok=async(name,fn)=>{await fn();pass+=1;console.log(`PASS ${name}`);};

await ok("generator preview is deterministic and non-destructive",async()=>{
 const before=JSON.stringify(builder.source);
 const a=await previewGeneratedBuilderFaultVariant({workspace:builder,packs,seed:7,faultCount:3});
 const b=await previewGeneratedBuilderFaultVariant({workspace:builder,packs:[...packs].reverse(),seed:7,faultCount:3});
 assert.equal(a.ok,true); assert.equal(b.ok,true); assert.equal(JSON.stringify(builder.source),before);
 assert.equal(a.value.plan.planIdentity,b.value.plan.planIdentity); assert.equal(a.value.token,b.value.token); assert.equal(a.value.plan.selections.length,3);
});
await ok("generator preview carries isolated draft and exact overlay",async()=>{
 const result=await previewGeneratedBuilderFaultVariant({workspace:builder,packs,seed:11,faultCount:2}); assert.equal(result.ok,true);
 assert.equal(result.value.draft.scenarioHash,builder.compile.model.sourceHash); assert.equal(result.value.draft.sourceRevision,builder.sourceRevision); assert.equal(result.value.draft.overlay.overlayIdentity,result.value.plan.groundTruth.overlayIdentity);
});
await ok("generated variant materialization requires and accepts preview token",async()=>{
 const preview=await previewGeneratedBuilderFaultVariant({workspace:builder,packs,seed:7,faultCount:2}); assert.equal(preview.ok,true);
 const materialized=await materializeGeneratedBuilderFaultVariant({workspace:builder,preview:preview.value,previewToken:preview.value.token,variantScenarioId:"generated_ui_variant"}); assert.equal(materialized.ok,true);
 assert.equal(materialized.value.source.scenarioId,"generated_ui_variant"); assert.deepEqual(materialized.value.source.faultOrigin.generation,{generatorId:preview.value.plan.generatorId,generatorVersion:preview.value.plan.generatorVersion,seed:7,planIdentity:preview.value.plan.planIdentity});
 assert.deepEqual(materialized.value.source.canonicalSolution.operations,preview.value.plan.groundTruth.canonicalRecovery);
});
await ok("generator constraints are forwarded through browser helper",async()=>{
 const result=await previewGeneratedBuilderFaultVariant({workspace:builder,packs:[packs[1]],seed:9,faultCount:2,constraints:{allowedTargetTypes:["windows.rds_host"],maxTotalChangedResources:1}}); assert.equal(result.ok,true);
 assert.deepEqual(result.value.plan.groundTruth.changedResources,["rds01"]);
});
await ok("browser surface exposes generator preview and materialization",async()=>{
 const main=fs.readFileSync(path.join(root,"ui/app/main.mjs"),"utf8");
 assert.ok(main.includes('data-fault-scenario-generator')); assert.ok(main.includes('"Deterministisk scenariogenerator"')); assert.ok(main.includes('"Förhandsgranska genererad variant"')); assert.ok(main.includes('"Skapa genererad scenariovariant"'));
});
await ok("browser surface states exact compatibility behavior",async()=>{
 const main=fs.readFileSync(path.join(root,"ui/app/main.mjs"),"utf8"); assert.ok(main.includes("broken earlier expected effects/negative controls")); assert.ok(main.includes("Diagnostik / observationsmotor"));
});
console.log(`PASS deterministic generator UI functional: ${pass}/6 assertions.`);
