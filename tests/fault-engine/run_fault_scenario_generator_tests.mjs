import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyOperations, createInitialEngineState } from "../../dist-fault-engine-test/engine/src/index.js";
import {
  FAULT_SCENARIO_GENERATOR_ID,
  FAULT_SCENARIO_GENERATOR_VERSION,
  generateDeterministicFaultScenario,
  materializeFaultedScenarioVariant,
  verifyFaultGenerationPlan,
} from "../../dist-fault-engine-test/fault-engine/src/index.js";

const here=path.dirname(fileURLToPath(import.meta.url)); const root=path.resolve(here,"../..");
const read=(p)=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8"));
const scenario=read("tests/fixtures/valid/scenario-normalized.json");
const source=read("tests/fixtures/valid/scenario-source.json");
const network=read("fault-packs/builtin/network-core.json");
const windows=read("fault-packs/builtin/windows-core.json");
const linux=read("fault-packs/builtin/linux-core.json");
const packs=[network,windows,linux];
let checks=0;
const ok=(value,message)=>{assert.ok(value,message);checks+=1;};
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks+=1;};
const generated=await generateDeterministicFaultScenario({scenario,state:createInitialEngineState(scenario),packs,seed:7,faultCount:3});
ok(generated.ok,"three-fault generated scenario succeeds");
if (!generated.ok) throw new Error(JSON.stringify(generated.diagnostics));
eq(generated.plan.generatorId,FAULT_SCENARIO_GENERATOR_ID,"generator id locked");
eq(generated.plan.generatorVersion,FAULT_SCENARIO_GENERATOR_VERSION,"generator version locked");
eq(generated.plan.seed,7,"generation seed stored");
eq(generated.plan.selections.length,3,"exact requested fault count selected");
eq(generated.overlay.instances.length,3,"overlay has exact requested fault count");
eq(new Set(generated.plan.selections.map(x=>`${x.packId}:${x.faultId}`)).size,3,"fault definitions are distinct by default");
eq(generated.plan.groundTruth.faultCount,3,"ground truth count matches");
eq(generated.plan.groundTruth.overlayIdentity,generated.overlay.overlayIdentity,"plan locks overlay identity");
eq(generated.plan.groundTruth.finalStateRevision,generated.state.stateRevision,"final revision recorded");
eq(generated.plan.groundTruth.referenceInvestigationOrder.length,3,"reference investigation order emitted");
eq(generated.plan.groundTruth.recoveryOrder,[...generated.overlay.instances].reverse().map(x=>x.instanceId),"recovery order is exact reverse application order");
ok(generated.plan.groundTruth.expectedSymptoms.length>0,"ground truth contains expected symptoms");
ok(generated.plan.groundTruth.changedResources.length>0,"ground truth contains changed resources");
eq(generated.plan.groundTruth.solvabilityVerified,true,"solvability is explicitly verified");
const restored=applyOperations(generated.state,generated.plan.groundTruth.canonicalRecovery);
ok(restored.ok,"combined canonical recovery applies");
if (restored.ok) eq(restored.state.resources,createInitialEngineState(scenario).resources,"combined canonical recovery restores exact baseline resources");
const verified=await verifyFaultGenerationPlan(generated.plan,generated.overlay,scenario);
ok(verified.ok,"generated plan verifies against scenario and overlay");

const repeated=await generateDeterministicFaultScenario({scenario,state:createInitialEngineState(scenario),packs,seed:7,faultCount:3});
ok(repeated.ok,"same request repeats successfully");
if (repeated.ok) {
  eq(repeated.plan.planIdentity,generated.plan.planIdentity,"same inputs + seed + versions produce same plan identity");
  eq(repeated.overlay.overlayIdentity,generated.overlay.overlayIdentity,"same inputs + seed + versions produce same overlay identity");
  eq(repeated.plan.selections,generated.plan.selections,"same inputs + seed + versions produce same selections");
}
const reordered=await generateDeterministicFaultScenario({scenario,state:createInitialEngineState(scenario),packs:[linux,network,windows],seed:7,faultCount:3});
ok(reordered.ok,"pack input order does not affect solvability");
if (reordered.ok) eq(reordered.plan.planIdentity,generated.plan.planIdentity,"pack input order does not affect deterministic result");
const otherSeed=await generateDeterministicFaultScenario({scenario,state:createInitialEngineState(scenario),packs,seed:2,faultCount:3});
ok(otherSeed.ok,"alternate seed generates a valid scenario");
if (otherSeed.ok) ok(otherSeed.plan.planIdentity!==generated.plan.planIdentity,"alternate seed changes generation identity");

const restricted=await generateDeterministicFaultScenario({scenario,state:createInitialEngineState(scenario),packs:[windows],seed:11,faultCount:2,constraints:{allowedTargetTypes:["windows.rds_host"],difficulty:{evidenceVisibility:{min:1,max:2}},maxTotalChangedResources:1}});
ok(restricted.ok,"target-type/difficulty/blast constraints can be satisfied");
if (restricted.ok) {
  eq(restricted.plan.groundTruth.changedResources,["rds01"],"aggregate changed-resource constraint enforced");
  for (const selection of restricted.plan.selections) {
    eq(Object.values(selection.bindings),["rds01"],`selection ${selection.ordinal} respects allowed target type`);
    ok(selection.difficulty.evidenceVisibility>=1&&selection.difficulty.evidenceVisibility<=2,`selection ${selection.ordinal} respects explicit evidence bounds`);
  }
}

const impossible=await generateDeterministicFaultScenario({scenario,state:createInitialEngineState(scenario),packs:[network],seed:1,faultCount:1,constraints:{allowedFaultIds:["does.not.exist"]}});
eq(impossible.ok,false,"unsatisfiable request fails closed");
if (!impossible.ok) ok(impossible.diagnostics.some(x=>x.code==="FAULT_GENERATOR_UNSATISFIABLE"),"unsatisfiable diagnostic is explicit");

const variant=materializeFaultedScenarioVariant(source,scenario,generated.overlay,"generated_variant",{generatorId:generated.plan.generatorId,generatorVersion:generated.plan.generatorVersion,seed:generated.plan.seed,planIdentity:generated.plan.planIdentity});
ok(variant.ok,"generated overlay materializes as ordinary scenario variant");
if (variant.ok) {
  eq(variant.source.scenarioId,"generated_variant","generated variant gets requested scenario id");
  eq(variant.source.faultOrigin.generation,{generatorId:FAULT_SCENARIO_GENERATOR_ID,generatorVersion:FAULT_SCENARIO_GENERATOR_VERSION,seed:7,planIdentity:generated.plan.planIdentity},"variant preserves generator seed/version/plan identity");
  eq(variant.source.canonicalSolution.operations,generated.plan.groundTruth.canonicalRecovery,"variant canonical solution equals verified generated recovery");
}
console.log(`PASS deterministic multi-fault generator functional: ${checks} assertions.`);
