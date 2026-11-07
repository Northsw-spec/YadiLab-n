import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildRuntimeDetailModel, compileBuilderWorkspace, createBuilderWorkspace, previewRuntime } from "../../dist-browser-test/ui/src/browser/index.js";
import { ENGINE_VERSION } from "../../dist-browser-test/engine/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const source = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-source.json"), "utf8"));
const catalogFile = JSON.parse(fs.readFileSync(path.join(root, "catalog/builtin-catalog.json"), "utf8"));
const schemaPass=()=>({valid:true,diagnostics:[]});
const options={compilerContext:{validateSource:schemaPass,validateNormalized:schemaPass,catalog:{capabilities:catalogFile.capabilities,profiles:catalogFile.profiles,assets:catalogFile.assets},engineBaselineVersion:ENGINE_VERSION}};
let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks+=1;}; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks+=1;};
const builder=await compileBuilderWorkspace(createBuilderWorkspace(source),options); if(builder.compile.status!=="valid")process.exit(1);
const preview=previewRuntime(builder); if(!preview.ok||preview.workspace.mode!=="runtime")process.exit(1);
const runtime=preview.workspace;

const noHints={...runtime,scenario:{...runtime.scenario,hints:[]}};
const details=buildRuntimeDetailModel(noHints);
eq(details.hints,[],"empty hints remain explicit empty list");
eq(details.findings.length,runtime.evaluation.findings.length,"presenter never drops findings");
eq(details.objectives.length,runtime.evaluation.objectives.length,"presenter never drops objectives");
eq(details.evidence.map(x=>x.sequence),runtime.evaluation.evidence.map(x=>x.sequence),"evidence ordering preserved exactly");

const unknownEvaluation={...runtime.evaluation,completion:{truth:"UNKNOWN",explanation:["insufficient evidence"]}};
const unknownRuntime={...runtime,evaluation:unknownEvaluation};
const unknown=buildRuntimeDetailModel(unknownRuntime);
eq(unknown.progress.completion,"UNKNOWN","presenter preserves UNKNOWN instead of coercing to false");
eq(unknown.progress.completionExplanation,["insufficient evidence"],"UNKNOWN explanation preserved");

const sourceText=fs.readFileSync(path.join(root,"ui/app/main.mjs"),"utf8");
ok(!/\b(?:finding|item)\.active\b/.test(sourceText),"rendering does not infer finding activity from nonexistent boolean");
ok(!/\b(?:objective|item)\.truth\b/.test(sourceText),"rendering does not infer objective state from nonexistent truth field");
ok(sourceText.includes("item.explanation"),"explanation text is data-driven from Engine output");
ok(!sourceText.includes("FAIL\")"),"UI does not hardcode unexplained FAIL verdict text");

console.log(`PASS runtime explainability adversarial suite: ${checks} assertions.`);
