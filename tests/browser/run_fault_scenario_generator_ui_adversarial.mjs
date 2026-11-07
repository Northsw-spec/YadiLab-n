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
let checks=0; const check=(name,value)=>{assert.ok(value,name);checks+=1;console.log(`PASS ${name}`);};

const uncompiled=createBuilderWorkspace(source);
check("uncompiled Builder blocks generator preview",!(await previewGeneratedBuilderFaultVariant({workspace:uncompiled,packs,seed:1,faultCount:2})).ok);
check("empty pack selection fails closed",!(await previewGeneratedBuilderFaultVariant({workspace:builder,packs:[],seed:1,faultCount:2})).ok);
check("impossible generator constraints fail closed",!(await previewGeneratedBuilderFaultVariant({workspace:builder,packs:[packs[0]],seed:1,faultCount:2,constraints:{allowedFaultIds:["does.not.exist"]}})).ok);
const preview=await previewGeneratedBuilderFaultVariant({workspace:builder,packs,seed:7,faultCount:2}); assert.equal(preview.ok,true);
const staleToken=await materializeGeneratedBuilderFaultVariant({workspace:builder,preview:preview.value,previewToken:"0".repeat(64),variantScenarioId:"generated_bad_token"});
check("stale generator preview token blocks materialization",!staleToken.ok&&staleToken.diagnostics.some(x=>x.code==="FAULT_GENERATOR_UI_PREVIEW_STALE"));
const tampered=structuredClone(preview.value); tampered.plan.selections[0].seed=(tampered.plan.selections[0].seed+1)>>>0;
const tamperedResult=await materializeGeneratedBuilderFaultVariant({workspace:builder,preview:tampered,previewToken:preview.value.token,variantScenarioId:"generated_tamper"});
check("tampered generator plan cannot materialize",!tamperedResult.ok);
const changed={...builder,sourceRevision:builder.sourceRevision+1};
const staleSource=await materializeGeneratedBuilderFaultVariant({workspace:changed,preview:preview.value,previewToken:preview.value.token,variantScenarioId:"generated_stale_source"});
check("Builder revision drift blocks generated materialization",!staleSource.ok&&staleSource.diagnostics.some(x=>x.code==="FAULT_GENERATOR_UI_PREVIEW_STALE"));
console.log(`PASS deterministic generator UI adversarial: ${checks}/6 assertions.`);
