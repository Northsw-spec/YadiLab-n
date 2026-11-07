import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildGuidedLabCatalog,
  cloneGuidedLabSource,
  captureRuntimeActiveProbeEvidence,
  commitRuntimeTypedRemediation,
  compileBuilderWorkspace,
  createBuilderWorkspace,
  previewRuntime,
  previewRuntimeTypedRemediation,
  reviewRuntimeRemediation,
  runRuntimeActiveProbe,
  buildGuidedTroubleshootingWorkflow,
} from "../../dist-browser-test/ui/src/browser/index.js";

let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++}; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};
const manifest=JSON.parse(fs.readFileSync("curriculum/builtin/wave1-manifest.json","utf8"));
const truth=JSON.parse(fs.readFileSync("tests/curriculum/wave1-ground-truth.json","utf8"));
const catalog=JSON.parse(fs.readFileSync("catalog/builtin-catalog.json","utf8"));
const sources={};
for(const lab of manifest.labs) sources[lab.path]=JSON.parse(fs.readFileSync(lab.path,"utf8"));
const built=buildGuidedLabCatalog(manifest,sources);
ok(built.ok,"Wave-1 curriculum manifest validates");
eq(built.labs.length,8,"Wave-1 exposes exactly eight guided labs");
eq(built.labs.filter(x=>x.platform==="windows").length,4,"Wave-1 has four Windows labs");
eq(built.labs.filter(x=>x.platform==="linux").length,4,"Wave-1 has four Linux labs");
eq(built.labs.map(x=>x.sequence),[1,2,3,4,5,6,7,8],"curriculum sequence is deterministic");
ok(built.labs.every(x=>x.boundary==="LEARNER_VISIBLE_NO_SOLUTION"),"catalog boundary explicitly excludes solution guidance");
const visible=JSON.stringify(built.labs.map(({source,...x})=>x));
for(const forbidden of ["canonicalSolution","faultOrigin","hiddenTruth","typedAction","parameters"]){ok(!visible.includes(forbidden),`learner-visible catalog omits ${forbidden}`)}

const compilerOptions={compilerContext:{validateSource:()=>({valid:true,diagnostics:[]}),validateNormalized:()=>({valid:true,diagnostics:[]}),catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},engineBaselineVersion:"0.8.0"}};
for(const lab of built.labs){
  const source=cloneGuidedLabSource(lab); const spec=truth[lab.id]; ok(!!spec,`${lab.id} has test-only acceptance truth`);
  ok(source.troubleshootingObjectives?.length===1,`${lab.id} has one transparent troubleshooting objective`);
  eq(source.troubleshootingObjectives[0].requirements.length,2,`${lab.id} requires a two-step baseline evidence chain`);
  let builder=createBuilderWorkspace(source); builder=await compileBuilderWorkspace(builder,compilerOptions); eq(builder.compile.status,"valid",`${lab.id} compiles semantically`);
  const runtimeResult=previewRuntime(builder); ok(runtimeResult.ok,`${lab.id} previews into Runtime`); let runtime=runtimeResult.workspace;
  const before=runRuntimeActiveProbe(runtime,spec.probe); ok(before.ok,`${lab.id} baseline probe runs`); eq(before.transcript.truth,spec.beforeTruth,`${lab.id} starts in the intended broken modeled state`);
  let saved=await captureRuntimeActiveProbeEvidence(runtime,undefined,before.transcript); ok(saved.ok,`${lab.id} baseline evidence saves`); let notebook=saved.notebook;
  const preview=await previewRuntimeTypedRemediation(runtime,notebook,spec.typedAction); ok(preview.ok,`${lab.id} typed remediation previews`);
  const committed=await commitRuntimeTypedRemediation(runtime,notebook,spec.typedAction,preview.preview.token,"Curriculum Wave 1 deterministic acceptance."); ok(committed.ok,`${lab.id} typed remediation commits`); runtime=committed.workspace; notebook=committed.notebook;
  const after=runRuntimeActiveProbe(runtime,spec.probe); ok(after.ok,`${lab.id} after-probe runs`); eq(after.transcript.truth,"TRUE",`${lab.id} becomes healthy for the same probe after typed remediation`);
  saved=await captureRuntimeActiveProbeEvidence(runtime,notebook,after.transcript); ok(saved.ok,`${lab.id} after-evidence saves`); notebook=saved.notebook;
  const remediationEntry=[...notebook.entries].reverse().find(e=>e.kind==="remediation_action"); ok(!!remediationEntry,`${lab.id} notebook records remediation action`);
  const review=await reviewRuntimeRemediation(runtime,notebook,remediationEntry.entryId); ok(review.ok,`${lab.id} remediation review runs`); eq(review.review.status,"VERIFIED_IMPROVEMENT",`${lab.id} proves a before/after improvement`);
  const workflow=await buildGuidedTroubleshootingWorkflow(runtime,notebook); ok(workflow.ok,`${lab.id} guided workflow rebuilds`); eq(workflow.workflow.phase,"VERIFICATION_COMPLETE",`${lab.id} reaches guided verification complete`);
  const canonical=source.canonicalSolution?.operations?.[0]; ok(!!canonical,`${lab.id} retains exactly authored hidden acceptance operation`); eq(source.canonicalSolution.operations.length,1,`${lab.id} hidden canonical solution is one deterministic operation`);
  eq(canonical,preview.preview.operation,`${lab.id} learner typed action resolves to the same deterministic operation used by author acceptance`);
}
console.log(`PASS Guided Lab Curriculum Wave 1 functional: ${checks} assertions.`);
