import assert from "node:assert/strict";
import fs from "node:fs";
import { buildGuidedLabCatalog, cloneGuidedLabSource } from "../../dist-browser-test/ui/src/browser/index.js";
let pass=0; const expectFail=(name,mutate,code)=>{const manifest=structuredClone(baseManifest);const sources=structuredClone(baseSources);mutate(manifest,sources);const r=buildGuidedLabCatalog(manifest,sources);assert.equal(r.ok,false,name);assert.ok(r.diagnostics.some(d=>d.code===code),`${name}: expected ${code}`);pass++;console.log(`PASS ${name}`)};
const baseManifest=JSON.parse(fs.readFileSync("curriculum/builtin/wave1-manifest.json","utf8"));
const baseSources={};for(const lab of baseManifest.labs)baseSources[lab.path]=JSON.parse(fs.readFileSync(lab.path,"utf8"));
expectFail("duplicate lab ID fails closed",m=>{m.labs[1].id=m.labs[0].id;m.labs[1].scenarioId=m.labs[0].id},"CURRICULUM_LAB_DUPLICATE_ID");
expectFail("duplicate sequence fails closed",m=>{m.labs[1].sequence=m.labs[0].sequence},"CURRICULUM_LAB_DUPLICATE_SEQUENCE");
expectFail("path traversal fails closed",m=>{m.labs[0].path="../secret.json"},"CURRICULUM_LAB_PATH_INVALID");
expectFail("learner-visible solution-like extra field fails closed",m=>{m.labs[0].solution="10.78.1.1"},"CURRICULUM_LAB_EXTRA_FIELD");
expectFail("missing source registration fails closed",(m,s)=>{delete s[m.labs[0].path]},"CURRICULUM_LAB_SOURCE_MISSING");
expectFail("scenario ID mismatch fails closed",(m,s)=>{s[m.labs[0].path].scenarioId="different_lab"},"CURRICULUM_LAB_SOURCE_ID_MISMATCH");
expectFail("missing troubleshooting objective fails closed",(m,s)=>{delete s[m.labs[0].path].troubleshootingObjectives},"CURRICULUM_LAB_EVIDENCE_REQUIRED");
expectFail("missing hidden acceptance solution fails closed",(m,s)=>{delete s[m.labs[0].path].canonicalSolution},"CURRICULUM_LAB_VERIFICATION_SOLUTION_REQUIRED");
{
 const r=buildGuidedLabCatalog(baseManifest,baseSources);assert.equal(r.ok,true);const clone=cloneGuidedLabSource(r.labs[0]);clone.metadata.title="mutated";assert.notEqual(clone.metadata.title,r.labs[0].source.metadata.title);pass++;console.log("PASS cloned lab source cannot mutate catalog source");
}
{
 const text=fs.readFileSync("ui/app/main.mjs","utf8");assert.ok(text.includes('data-guided-lab-catalog": "wave1"'));assert.ok(text.includes("Starta guidad labb"));assert.ok(text.includes("Öppna labb i byggläget"));assert.ok(text.indexOf("Guidad labb")<text.indexOf("Öppna scenario-JSON"));pass++;console.log("PASS app exposes built-in guided lab launcher before raw file import");
}
console.log(`PASS Guided Lab Curriculum Wave 1 adversarial: ${pass}/10 checks.`);
