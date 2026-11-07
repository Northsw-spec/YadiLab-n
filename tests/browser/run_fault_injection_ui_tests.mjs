import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFaultDefinitionViews,
  computeFaultPreviewToken,
  createBuilderFaultDraft,
  injectBuilderFaultDraft,
  injectFaultIntoRuntime,
  materializeBuilderFaultVariant,
  previewBuilderFaultDraft,
  previewFaultUi,
  rollbackRuntimeFaultUi,
} from "../../dist-browser-test/ui/src/browser/fault-injection.js";
import { createBuilderWorkspace, previewRuntime } from "../../dist-browser-test/ui/src/browser/index.js";

const here=path.dirname(fileURLToPath(import.meta.url)); const root=path.resolve(here,"../..");
const scenario=JSON.parse(fs.readFileSync(path.join(root,"tests/fixtures/valid/scenario-normalized.json"),"utf8"));
const source=JSON.parse(fs.readFileSync(path.join(root,"tests/fixtures/valid/scenario-source.json"),"utf8"));
const pack=JSON.parse(fs.readFileSync(path.join(root,"fault-packs/builtin/network-core.json"),"utf8"));
const windowsPack=JSON.parse(fs.readFileSync(path.join(root,"fault-packs/builtin/windows-core.json"),"utf8"));
const linuxPack=JSON.parse(fs.readFileSync(path.join(root,"fault-packs/builtin/linux-core.json"),"utf8"));
const builder={...createBuilderWorkspace(source),compile:{status:"valid",model:scenario,diagnostics:[]}};
const runtimeResult=previewRuntime(builder); assert.equal(runtimeResult.ok,true); const runtime=runtimeResult.workspace;
let pass=0; const ok=async(name,fn)=>{await fn();pass++;console.log(`PASS ${name}`)};

await ok("fault catalog exposes deterministic target options",async()=>{
  const views=buildFaultDefinitionViews(pack,scenario); const fault=views.find(x=>x.faultId==="firewall.force_default_deny");
  assert.ok(fault); assert.deepEqual(fault.bindings[0].options.map(x=>x.resourceId),["admin01","attacker","firewall01","rds01"]);
});
await ok("Wave 1 catalog exposes all 25 built-in faults",async()=>{
  const views=buildFaultDefinitionViews(pack,scenario); assert.equal(views.length,25);
  assert.equal(new Set(views.map(x=>x.faultId)).size,25);
});
await ok("Windows pack exposes only eligible Windows targets",async()=>{
  const views=buildFaultDefinitionViews(windowsPack,scenario); const fault=views.find(x=>x.faultId==="windows.rdp.disable_service"); assert.ok(fault); assert.deepEqual(fault.bindings[0].options.map(x=>x.resourceId),["admin01","rds01"]);
});
await ok("Linux pack exposes only eligible Linux targets",async()=>{
  const mixed=structuredClone(scenario); mixed.resources.push({id:"linux01",type:"linux.server",label:"Linux",interfaces:[],properties:{ssh:{enabled:true,port:22,protocol:"tcp"}}});
  const views=buildFaultDefinitionViews(linuxPack,mixed); const fault=views.find(x=>x.faultId==="linux.ssh.disable_service"); assert.ok(fault); assert.deepEqual(fault.bindings[0].options.map(x=>x.resourceId),["linux01"]);
});
await ok("runtime preview is non-mutating and reports actual blast radius",async()=>{
  const before=JSON.stringify(runtime.engineState);
  const preview=await previewFaultUi({scenario,state:runtime.engineState,pack,faultId:"firewall.force_default_deny",bindings:{target:"firewall01"},seed:7,mode:"RUNTIME_INJECTION"});
  assert.equal(preview.ok,true); assert.deepEqual(preview.changedResources,["firewall01"]); assert.equal(JSON.stringify(runtime.engineState),before); assert.ok(preview.token.length===64);
});
await ok("preview token is deterministic",async()=>{
  const args={scenario,state:runtime.engineState,pack,faultId:"firewall.force_default_deny",bindings:{target:"firewall01"},seed:9,mode:"RUNTIME_INJECTION"};
  assert.equal(await computeFaultPreviewToken(args),await computeFaultPreviewToken(args));
});
await ok("runtime injection becomes one history step",async()=>{
  const preview=await previewFaultUi({scenario,state:runtime.engineState,pack,faultId:"firewall.force_default_deny",bindings:{target:"firewall01"},seed:12,mode:"RUNTIME_INJECTION"});
  const injected=await injectFaultIntoRuntime({workspace:runtime,pack,faultId:"firewall.force_default_deny",bindings:{target:"firewall01"},seed:12,previewToken:preview.token});
  assert.equal(injected.ok,true); assert.equal(injected.value.workspace.history.past.length,runtime.history.past.length+1); assert.equal(injected.value.workspace.engineState.resources.firewall01.properties.aclDefaultAction,"deny"); assert.equal(injected.value.overlay.instances.length,1);
});
await ok("multiple runtime faults append to one overlay",async()=>{
  const p1=await previewFaultUi({scenario,state:runtime.engineState,pack,faultId:"firewall.force_default_deny",bindings:{target:"firewall01"},seed:1,mode:"RUNTIME_INJECTION"});
  const i1=await injectFaultIntoRuntime({workspace:runtime,pack,faultId:"firewall.force_default_deny",bindings:{target:"firewall01"},seed:1,previewToken:p1.token}); assert.equal(i1.ok,true);
  const p2=await previewFaultUi({scenario,state:i1.value.workspace.engineState,pack,faultId:"firewall.force_default_deny",bindings:{target:"rds01"},seed:2,mode:"RUNTIME_INJECTION",activeOverlay:i1.value.overlay});
  const i2=await injectFaultIntoRuntime({workspace:i1.value.workspace,pack,faultId:"firewall.force_default_deny",bindings:{target:"rds01"},seed:2,previewToken:p2.token,activeOverlay:i1.value.overlay});
  assert.equal(i2.ok,true); assert.equal(i2.value.overlay.instances.length,2); assert.equal(i2.value.workspace.engineState.resources.rds01.properties.aclDefaultAction,"deny");
});
await ok("runtime rollback restores latest fault",async()=>{
  const p=await previewFaultUi({scenario,state:runtime.engineState,pack,faultId:"firewall.force_default_deny",bindings:{target:"firewall01"},seed:4,mode:"RUNTIME_INJECTION"});
  const i=await injectFaultIntoRuntime({workspace:runtime,pack,faultId:"firewall.force_default_deny",bindings:{target:"firewall01"},seed:4,previewToken:p.token}); assert.equal(i.ok,true);
  const rolled=await rollbackRuntimeFaultUi({workspace:i.value.workspace,overlay:i.value.overlay}); assert.equal(rolled.ok,true); assert.equal(rolled.value.overlay.instances.length,0); assert.equal(rolled.value.workspace.engineState.resources.firewall01.properties.aclDefaultAction,undefined);
});
await ok("builder fault draft starts from healthy compiled state",async()=>{
  const draft=createBuilderFaultDraft(builder); assert.equal(draft.ok,true); assert.equal(draft.value.state.stateRevision,0); assert.equal(draft.value.overlay,undefined);
});
await ok("builder draft supports preview and injection without mutating source",async()=>{
  const draft=createBuilderFaultDraft(builder).value; const before=JSON.stringify(builder.source);
  const preview=await previewBuilderFaultDraft({workspace:builder,draft,pack,faultId:"firewall.force_default_deny",bindings:{target:"firewall01"},seed:3}); assert.equal(preview.ok,true);
  const injected=await injectBuilderFaultDraft({workspace:builder,draft,pack,faultId:"firewall.force_default_deny",bindings:{target:"firewall01"},seed:3,previewToken:preview.token}); assert.equal(injected.ok,true); assert.equal(JSON.stringify(builder.source),before); assert.equal(injected.value.overlay.instances.length,1);
});
await ok("builder draft materializes persistent ordinary scenario variant",async()=>{
  const draft=createBuilderFaultDraft(builder).value;
  const preview=await previewBuilderFaultDraft({workspace:builder,draft,pack,faultId:"firewall.force_default_deny",bindings:{target:"firewall01"},seed:5});
  const injected=await injectBuilderFaultDraft({workspace:builder,draft,pack,faultId:"firewall.force_default_deny",bindings:{target:"firewall01"},seed:5,previewToken:preview.token});
  const variant=materializeBuilderFaultVariant({workspace:builder,draft:injected.value,variantScenarioId:"fault_variant_ui"}); assert.equal(variant.ok,true); assert.equal(variant.value.source.scenarioId,"fault_variant_ui"); assert.equal(variant.value.source.faultOrigin.overlayIdentity,injected.value.overlay.overlayIdentity); assert.equal(variant.value.source.resources.find(x=>x.id==="firewall01").properties.aclDefaultAction,"deny");
});
await ok("difficulty is exposed as explicit dimensions not a hidden score",async()=>{
  const fault=buildFaultDefinitionViews(pack,scenario).find(x=>x.faultId==="firewall.force_default_deny"); assert.deepEqual(Object.keys(fault.difficulty).sort(),["dependencyDepth","evidenceVisibility","layers","remediationConstraints"]);
});
await ok("browser surface wires Fault Injection UI to verified helpers",async()=>{
  const main=fs.readFileSync(path.join(root,"ui/app/main.mjs"),"utf8"); assert.ok(main.includes('data-fault-injection-ui')); assert.ok(main.includes('"Preview fault"')); assert.ok(main.includes('"Inject fault"')); assert.ok(main.includes('"Create faulted scenario variant"'));
});
await ok("browser surface exposes explicit built-in fault-pack selection",async()=>{
  const main=fs.readFileSync(path.join(root,"ui/app/main.mjs"),"utf8"); assert.ok(main.includes('"Fault pack"')); assert.ok(main.includes('foundation.os.windows')); assert.ok(main.includes('foundation.os.linux')); assert.ok(main.includes('foundation.network.core'));
});
console.log(`PASS Fault Injection UI functional suite: ${pass}/15 assertions.`);
