import fs from "node:fs";
import assert from "node:assert/strict";
import {
  addRuntimeTroubleshootingNote,
  compileBuilderWorkspace,
  computeTroubleshootingSessionIdentity,
  createBuilderWorkspace,
  createTroubleshootingSessionDownload,
  loadTroubleshootingSessionFile,
  previewRuntime,
  TROUBLESHOOTING_SESSION_MAX_TEXT_CHARS,
} from "../../dist-persistence-test/ui/src/browser/index.js";
import { ENGINE_VERSION } from "../../dist-persistence-test/engine/src/index.js";

const source=JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-source.json","utf8"));
const catalog=JSON.parse(fs.readFileSync("catalog/builtin-catalog.json","utf8"));
const pass=()=>({valid:true,diagnostics:[]});
const options={compilerContext:{validateSource:pass,validateNormalized:pass,catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},engineBaselineVersion:ENGINE_VERSION}};
let builder=await compileBuilderWorkspace(createBuilderWorkspace(source),options); if(builder.compile.status!=="valid")process.exit(1);
const p=previewRuntime(builder); if(!p.ok||p.workspace.mode!=="runtime")process.exit(1); const runtime=p.workspace;
const note=await addRuntimeTroubleshootingNote(runtime,undefined,"hypothesis","Portable backup integrity test."); if(!note.ok||!note.notebook)process.exit(1);
const exported=await createTroubleshootingSessionDownload(runtime,note.notebook); if(!exported.ok)process.exit(1);
const base=JSON.parse(exported.descriptor.text); const validators={validateSession:pass,validateSave:pass,validateNotebook:pass};
let checks=0;
async function reject(name,file,expected,customValidators=validators){const before=runtime.engineState.stateRevision;const r=await loadTroubleshootingSessionFile(runtime,file,customValidators);assert.equal(r.ok,false,name);assert.equal(r.workspace.engineState.stateRevision,before,`${name}: workspace must remain unchanged`);assert.ok(r.diagnostics.some(x=>x.code===expected),`${name}: expected ${expected}, got ${r.diagnostics.map(x=>x.code).join(",")}`);checks++;}
const mk=(name,value)=>({name,text:async()=>typeof value==="string"?value:`${JSON.stringify(value)}\n`});

await reject("wrong extension blocked",mk("lab.yadiprogress",exported.descriptor.text),"TROUBLESHOOTING_SESSION_FILE_READ_FAILED");
await reject("malformed JSON blocked",mk("lab.yadisession","{broken"),"TROUBLESHOOTING_SESSION_FILE_READ_FAILED");
await reject("oversized text blocked",mk("lab.yadisession","x".repeat(TROUBLESHOOTING_SESSION_MAX_TEXT_CHARS+1)),"TROUBLESHOOTING_SESSION_FILE_READ_FAILED");
await reject("schema rejection blocks restore",mk("lab.yadisession",base),"TROUBLESHOOTING_SESSION_SCHEMA_INVALID",{...validators,validateSession:()=>({valid:false,diagnostics:["bad session"]})});

const tampered={...base,sessionIdentity:"0".repeat(64)}; await reject("tampered session identity blocked",mk("lab.yadisession",tampered),"TROUBLESHOOTING_SESSION_IDENTITY_MISMATCH");
const wrong={...base,scenarioId:"different_lab"}; wrong.sessionIdentity=await computeTroubleshootingSessionIdentity(wrong); await reject("cross-scenario portable restore blocked",mk("lab.yadisession",wrong),"TROUBLESHOOTING_SESSION_SCENARIO_MISMATCH");
const badNotebook=structuredClone(base); badNotebook.notebook.entries[0].text="tampered learner note"; badNotebook.sessionIdentity=await computeTroubleshootingSessionIdentity(badNotebook); await reject("nested notebook tampering blocked",mk("lab.yadisession",badNotebook),"NOTEBOOK_IDENTITY_MISMATCH");
await reject("nested save schema rejection blocks atomically",mk("lab.yadisession",base),"TROUBLESHOOTING_SESSION_SAVE_INVALID",{...validators,validateSave:()=>({valid:false,diagnostics:["bad save"]})});

console.log(`PASS portable troubleshooting session adversarial: ${checks}/8 assertions.`);
