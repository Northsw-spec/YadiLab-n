import fs from "node:fs";
import assert from "node:assert/strict";
import {
  addRuntimeTroubleshootingNote,
  applyRuntimeOperation,
  compileBuilderWorkspace,
  createBuilderWorkspace,
  createTroubleshootingSessionDownload,
  loadTroubleshootingSessionFile,
  previewRuntime,
  resetRuntime,
} from "../../dist-persistence-test/ui/src/browser/index.js";
import { ENGINE_VERSION } from "../../dist-persistence-test/engine/src/index.js";

const source=JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-source.json","utf8"));
const catalog=JSON.parse(fs.readFileSync("catalog/builtin-catalog.json","utf8"));
const pass=()=>({valid:true,diagnostics:[]});
const options={compilerContext:{validateSource:pass,validateNormalized:pass,catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},engineBaselineVersion:ENGINE_VERSION}};
const validators={validateSession:pass,validateSave:pass,validateNotebook:pass};
let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++}; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};

let builder=await compileBuilderWorkspace(createBuilderWorkspace(source),options); eq(builder.compile.status,"valid","control compiles");
const preview=previewRuntime(builder); ok(preview.ok,"runtime starts"); if(!preview.ok||preview.workspace.mode!=="runtime")process.exit(1);
const initial=preview.workspace;
const changedResult=applyRuntimeOperation(initial,{op:"set",target:"firewall01",path:"properties.rules.0.action",value:"deny"}); ok(changedResult.ok,"runtime change succeeds"); if(!changedResult.ok)process.exit(1);
const changed=changedResult.workspace;
const noted=await addRuntimeTroubleshootingNote(changed,undefined,"hypothesis","Portable session should preserve this note."); ok(noted.ok,"notebook note created"); if(!noted.ok||!noted.notebook)process.exit(1);

const exported=await createTroubleshootingSessionDownload(changed,noted.notebook); ok(exported.ok,"portable session export succeeds"); if(!exported.ok)process.exit(1);
eq(exported.descriptor.filename,`${changed.scenario.scenarioId}.yadisession`,"portable session extension explicit");
eq(exported.descriptor.mime,"application/json","portable session mime explicit");
ok(exported.descriptor.text.endsWith("\n"),"portable session text newline stable");
const parsed=JSON.parse(exported.descriptor.text); eq(parsed.sessionIdentity,exported.snapshot.sessionIdentity,"download serializes sealed session identity"); eq(parsed.notebookIdentity,noted.notebook.notebookIdentity,"download binds notebook identity");

const reset=resetRuntime(changed); eq(reset.engineState.stateRevision,0,"control reset clears runtime change");
const file={name:exported.descriptor.filename,text:async()=>exported.descriptor.text};
const loaded=await loadTroubleshootingSessionFile(reset,file,validators); ok(loaded.ok,"portable session imports"); if(!loaded.ok||!loaded.notebook)process.exit(1);
eq(loaded.workspace.engineState.stateRevision,1,"portable restore reinstates runtime revision");
eq(loaded.workspace.engineState.resources.firewall01.properties.rules[0].action,"deny","portable restore reinstates runtime state");
eq(loaded.notebook.notebookIdentity,noted.notebook.notebookIdentity,"portable restore reinstates exact notebook");
eq(loaded.notebook.entries[0].text,"Portable session should preserve this note.","portable restore preserves learner evidence");

const main=fs.readFileSync("ui/app/main.mjs","utf8"); ok(main.includes("Exportera sessionsbackup"),"Runtime UI exposes session export"); ok(main.includes("Importera sessionsbackup"),"Runtime UI exposes session import"); ok(main.includes("loadTroubleshootingSessionFile"),"Runtime UI uses verified session importer"); ok(main.includes("createTroubleshootingSessionDownload"),"Runtime UI uses sealed session exporter");
console.log(`PASS portable troubleshooting session functional: ${checks} assertions.`);
