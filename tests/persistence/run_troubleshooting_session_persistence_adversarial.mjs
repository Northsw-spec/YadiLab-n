import fs from "node:fs";
import assert from "node:assert/strict";
import {
  addRuntimeTroubleshootingNote,
  autosaveTroubleshootingSession,
  buildTroubleshootingSessionReplay,
  clearAutosavedTroubleshootingSession,
  compileBuilderWorkspace,
  computeTroubleshootingSessionIdentity,
  createBuilderWorkspace,
  createTroubleshootingSessionSnapshot,
  MemoryTroubleshootingSessionStore,
  previewRuntime,
  restoreAutosavedTroubleshootingSession,
  verifyTroubleshootingSessionSnapshot,
} from "../../dist-persistence-test/ui/src/browser/index.js";
import { addLearnerNoteToNotebook, createTroubleshootingNotebook } from "../../dist-persistence-test/observation-engine/src/index.js";
import { ENGINE_VERSION } from "../../dist-persistence-test/engine/src/index.js";
const source=JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-source.json","utf8"));const catalog=JSON.parse(fs.readFileSync("catalog/builtin-catalog.json","utf8"));const pass=()=>({valid:true,diagnostics:[]});const options={compilerContext:{validateSource:pass,validateNormalized:pass,catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},engineBaselineVersion:ENGINE_VERSION}};let builder=await compileBuilderWorkspace(createBuilderWorkspace(source),options);if(builder.compile.status!=="valid")process.exit(1);const p=previewRuntime(builder);if(!p.ok||p.workspace.mode!=="runtime")process.exit(1);const runtime=p.workspace;let checks=0;const reject=async(name,fn,code)=>{const result=await fn();assert.equal(result.ok,false,name);assert.ok(result.diagnostics.some(x=>x.code===code),`${name}: expected ${code}`);checks++;};
const note=await addRuntimeTroubleshootingNote(runtime,undefined,"hypothesis","Check route first.");if(!note.ok||!note.notebook)process.exit(1);const created=await createTroubleshootingSessionSnapshot(runtime,note.notebook);if(!created.ok)process.exit(1);const base=created.snapshot;const validators={validateSession:pass,validateSave:pass,validateNotebook:pass};

await reject("tampered envelope identity fails closed",async()=>{const bad={...base,sessionIdentity:"0".repeat(64)};const ds=await verifyTroubleshootingSessionSnapshot(runtime,bad,validators);return{ok:ds.length===0,diagnostics:ds};},"TROUBLESHOOTING_SESSION_IDENTITY_MISMATCH");
await reject("progress revision mismatch fails closed",async()=>{const bad={...base,stateRevision:base.stateRevision+1};const bad2={...bad,sessionIdentity:await computeTroubleshootingSessionIdentity(bad)};const ds=await verifyTroubleshootingSessionSnapshot(runtime,bad2,validators);return{ok:ds.length===0,diagnostics:ds};},"TROUBLESHOOTING_SESSION_REVISION_MISMATCH");
await reject("notebook envelope identity mismatch fails closed",async()=>{const bad={...base,notebookIdentity:"1".repeat(64)};const bad2={...bad,sessionIdentity:await computeTroubleshootingSessionIdentity(bad)};const ds=await verifyTroubleshootingSessionSnapshot(runtime,bad2,validators);return{ok:ds.length===0,diagnostics:ds};},"TROUBLESHOOTING_SESSION_NOTEBOOK_IDENTITY_MISMATCH");
await reject("tampered nested notebook fails closed",async()=>{const badNotebook=JSON.parse(JSON.stringify(base.notebook));badNotebook.entries[0].text="hidden mutation";const bad={...base,notebook:badNotebook,sessionIdentity:"0".repeat(64)};bad.sessionIdentity=await computeTroubleshootingSessionIdentity(bad);const ds=await verifyTroubleshootingSessionSnapshot(runtime,bad,validators);return{ok:ds.length===0,diagnostics:ds};},"NOTEBOOK_IDENTITY_MISMATCH");
await reject("wrong scenario fails closed even with recomputed identities",async()=>{const bad={...base,scenarioId:"different_lab"};bad.sessionIdentity=await computeTroubleshootingSessionIdentity(bad);const ds=await verifyTroubleshootingSessionSnapshot(runtime,bad,validators);return{ok:ds.length===0,diagnostics:ds};},"TROUBLESHOOTING_SESSION_SCENARIO_MISMATCH");
await reject("session schema rejection stops restore",async()=>{const store=new MemoryTroubleshootingSessionStore();await store.put(base);return restoreAutosavedTroubleshootingSession(runtime,store,{...validators,validateSession:()=>({valid:false,diagnostics:["bad envelope"]})});},"TROUBLESHOOTING_SESSION_SCHEMA_INVALID");
await reject("embedded save schema rejection stops restore",async()=>{const store=new MemoryTroubleshootingSessionStore();await store.put(base);return restoreAutosavedTroubleshootingSession(runtime,store,{...validators,validateSave:()=>({valid:false,diagnostics:["bad save"]})});},"TROUBLESHOOTING_SESSION_SAVE_INVALID");
await reject("embedded notebook schema rejection stops restore",async()=>{const store=new MemoryTroubleshootingSessionStore();await store.put(base);return restoreAutosavedTroubleshootingSession(runtime,store,{...validators,validateNotebook:()=>({valid:false,diagnostics:["bad notebook"]})});},"TROUBLESHOOTING_SESSION_NOTEBOOK_INVALID");
await reject("missing exact-scenario session does not cross-load",async()=>{const store=new MemoryTroubleshootingSessionStore();return restoreAutosavedTroubleshootingSession(runtime,store,validators);},"TROUBLESHOOTING_SESSION_AUTOSAVE_NOT_FOUND");
await reject("store write failure surfaces",()=>autosaveTroubleshootingSession(runtime,note.notebook,{put:async()=>{throw new Error("disk full")},get:async()=>undefined,delete:async()=>{},list:async()=>[]}),"TROUBLESHOOTING_SESSION_AUTOSAVE_WRITE_FAILED");
await reject("store read failure surfaces",()=>restoreAutosavedTroubleshootingSession(runtime,{put:async()=>{},get:async()=>{throw new Error("read fail")},delete:async()=>{},list:async()=>[]},validators),"TROUBLESHOOTING_SESSION_AUTOSAVE_READ_FAILED");
await reject("store delete failure surfaces",()=>clearAutosavedTroubleshootingSession(runtime,{put:async()=>{},get:async()=>undefined,delete:async()=>{throw new Error("delete fail")},list:async()=>[]}),"TROUBLESHOOTING_SESSION_AUTOSAVE_DELETE_FAILED");

let reordered=await createTroubleshootingNotebook(runtime.scenario.scenarioId,runtime.scenario.sourceHash);let r=await addLearnerNoteToNotebook(reordered,5,"hypothesis","First captured sequence item.");if(!r.ok||!r.notebook)process.exit(1);reordered=r.notebook;r=await addLearnerNoteToNotebook(reordered,2,"next_step","Second captured sequence item.");if(!r.ok||!r.notebook)process.exit(1);reordered=r.notebook;const sequenceSnapshot=await createTroubleshootingSessionSnapshot(runtime,reordered);assert.equal(sequenceSnapshot.ok,true);const replay=buildTroubleshootingSessionReplay(sequenceSnapshot.snapshot);assert.deepEqual(replay.map(x=>x.sequence),[1,2]);assert.deepEqual(replay.map(x=>x.stateRevision),[5,2]);assert.deepEqual(replay.map(x=>x.relationToRestoredState),["different_revision","different_revision"]);checks++;
const serialized=JSON.stringify(base);for(const forbidden of ["faultOrigin","hiddenTruth","canonicalSolution","referenceInvestigationOrder"]){assert.equal(serialized.includes(forbidden),false,`session must not persist ${forbidden}`);}checks++;
console.log(`PASS troubleshooting session persistence adversarial: ${checks} assertions.`);
