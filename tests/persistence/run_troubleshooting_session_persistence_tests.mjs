import fs from "node:fs";
import assert from "node:assert/strict";
import {
  addRuntimeTroubleshootingNote,
  applyRuntimeOperation,
  autosaveTroubleshootingSession,
  buildTroubleshootingSessionReplay,
  clearAutosavedTroubleshootingSession,
  compileBuilderWorkspace,
  computeTroubleshootingSessionIdentity,
  createBuilderWorkspace,
  createTroubleshootingSessionSnapshot,
  MemoryTroubleshootingSessionStore,
  previewRuntime,
  resetRuntime,
  restoreAutosavedTroubleshootingSession,
} from "../../dist-persistence-test/ui/src/browser/index.js";
import { ENGINE_VERSION } from "../../dist-persistence-test/engine/src/index.js";

const source=JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-source.json","utf8"));
const catalog=JSON.parse(fs.readFileSync("catalog/builtin-catalog.json","utf8"));
const schemaPass=()=>({valid:true,diagnostics:[]});
const options={compilerContext:{validateSource:schemaPass,validateNormalized:schemaPass,catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},engineBaselineVersion:ENGINE_VERSION}};
const validators={validateSession:schemaPass,validateSave:schemaPass,validateNotebook:schemaPass};
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++};const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};

let builder=await compileBuilderWorkspace(createBuilderWorkspace(source),options);eq(builder.compile.status,"valid","control compiles");if(builder.compile.status!=="valid")process.exit(1);
const preview=previewRuntime(builder);ok(preview.ok,"runtime starts");if(!preview.ok||preview.workspace.mode!=="runtime")process.exit(1);
const initial=preview.workspace;
const changedResult=applyRuntimeOperation(initial,{op:"set",target:"firewall01",path:"properties.rules.0.action",value:"deny"});ok(changedResult.ok,"runtime change succeeds");if(!changedResult.ok)process.exit(1);const changed=changedResult.workspace;eq(changed.engineState.stateRevision,1,"runtime revision is one");
const noted=await addRuntimeTroubleshootingNote(changed,undefined,"hypothesis","Firewall change explains the direct-access result.");ok(noted.ok,"notebook note created");if(!noted.ok||!noted.notebook)process.exit(1);const notebook=noted.notebook;eq(notebook.entries.length,1,"notebook has one learner entry");eq(notebook.entries[0].stateRevision,1,"note binds exact runtime revision");

const created=await createTroubleshootingSessionSnapshot(changed,notebook);ok(created.ok,"combined troubleshooting snapshot created");if(!created.ok)process.exit(1);const snapshot=created.snapshot;
eq(snapshot.formatId,"infrastructure-cyber-lab.troubleshooting-session","session format explicit");eq(snapshot.schemaVersion,"0.1.0","session version explicit");eq(snapshot.scenarioId,changed.scenario.scenarioId,"session binds scenario id");eq(snapshot.scenarioHash,changed.scenario.sourceHash,"session binds exact scenario hash");eq(snapshot.stateRevision,1,"session binds runtime revision");eq(snapshot.progress.stateRevision,1,"embedded progress revision matches envelope");eq(snapshot.notebookIdentity,notebook.notebookIdentity,"envelope binds notebook identity");eq(snapshot.notebook,notebook,"embedded notebook preserved exactly");ok(/^[0-9a-f]{64}$/.test(snapshot.sessionIdentity),"session has SHA-256 identity");eq(await computeTroubleshootingSessionIdentity(snapshot),snapshot.sessionIdentity,"session identity recomputes exactly");

const replay=buildTroubleshootingSessionReplay(snapshot);eq(replay.length,1,"replay has one frame");eq(replay[0].sequence,1,"replay preserves evidence sequence");eq(replay[0].kind,"learner_note","replay preserves entry kind");eq(replay[0].relationToRestoredState,"current_revision","replay labels equal revision without diagnosis");eq(replay[0].entry.text,"Firewall change explains the direct-access result.","replay preserves learner text");

const store=new MemoryTroubleshootingSessionStore();const saved=await autosaveTroubleshootingSession(changed,notebook,store);ok(saved.ok,"combined session autosaves");ok(saved.snapshot!==undefined,"autosave returns sealed snapshot");eq((await store.list()).length,1,"session store lists one snapshot");let stored=await store.get(changed.scenario.sourceHash);ok(stored!==undefined,"store keys by exact scenario hash");eq(stored?.sessionIdentity,snapshot.sessionIdentity,"stored session identity deterministic");if(stored){stored.notebook.entries[0].text="tampered-return-value";}stored=await store.get(changed.scenario.sourceHash);eq(stored?.notebook.entries[0].text,"Firewall change explains the direct-access result.","memory store isolates returned objects");

const reset=resetRuntime(changed);eq(reset.engineState.stateRevision,0,"control reset removes runtime progress");const restored=await restoreAutosavedTroubleshootingSession(reset,store,validators);ok(restored.ok,"combined troubleshooting session restores");if(!restored.ok||!restored.notebook)process.exit(1);eq(restored.workspace.engineState.stateRevision,1,"restore reinstates exact runtime revision");eq(restored.workspace.engineState.resources.firewall01.properties.rules[0].action,"deny","restore reinstates runtime resource state");eq(restored.notebook.notebookIdentity,notebook.notebookIdentity,"restore reinstates exact notebook");eq(buildTroubleshootingSessionReplay(restored.snapshot)[0].relationToRestoredState,"current_revision","restored snapshot replay is stable");

const continued=await addRuntimeTroubleshootingNote(restored.workspace,restored.notebook,"next_step","Verify the service path after the firewall change.");ok(continued.ok,"restored notebook can continue without export/import");if(!continued.ok||!continued.notebook)process.exit(1);eq(continued.notebook.entries.length,2,"continued session appends evidence-chain entry");const resaved=await autosaveTroubleshootingSession(restored.workspace,continued.notebook,store);ok(resaved.ok,"continued session can autosave again");ok(resaved.snapshot.sessionIdentity!==snapshot.sessionIdentity,"session identity changes when notebook content changes");

const emptyStore=new MemoryTroubleshootingSessionStore();const emptySaved=await autosaveTroubleshootingSession(initial,undefined,emptyStore);ok(emptySaved.ok,"autosave creates empty notebook when learner has not started one");eq(emptySaved.notebook.entries.length,0,"implicit notebook is empty");eq(emptySaved.snapshot.notebookIdentity,emptySaved.notebook.notebookIdentity,"implicit notebook identity sealed into session");

const cleared=await clearAutosavedTroubleshootingSession(restored.workspace,store);ok(cleared.ok,"combined session clears");eq(await store.get(changed.scenario.sourceHash),undefined,"cleared session absent");

const main=fs.readFileSync("ui/app/main.mjs","utf8");ok(main.includes("IndexedDbTroubleshootingSessionStore"),"browser app provisions persistent troubleshooting session store");ok(main.includes("autosaveTroubleshootingSession"),"browser autosave persists combined session");ok(main.includes("restoreAutosavedTroubleshootingSession"),"browser restore replays combined session");ok(main.includes('packageValidator("troubleshootingSession")'),"browser validates troubleshooting-session envelope");ok(main.includes("setNotebook(sessionResult.notebook ?? null)"),"browser restore reinstates notebook UI state");ok(main.includes("Runtime progress and Evidence Notebook were persisted together"),"browser tells learner both artifacts are bound together");
console.log(`PASS troubleshooting session persistence functional: ${checks} assertions.`);
