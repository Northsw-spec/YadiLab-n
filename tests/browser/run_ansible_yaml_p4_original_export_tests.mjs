import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {previewAnsibleYamlFileReadOnly} from "../../dist-browser-test/ui/src/browser/ansible-yaml-file-preview.js";
import {reviewAnsibleYamlOriginalFileAssociations} from "../../dist-browser-test/ui/src/browser/ansible-yaml-association-file.js";
import {reviewAnsibleInventoryAssociations} from "../../dist-browser-test/enterprise-import/src/ansible-association-review.js";
import {AnsibleInventoryPanel} from "../../ui/app/ansible-inventory-panel.mjs";

const read=(p)=>new Uint8Array(fs.readFileSync("tests/fixtures/import/ansible-yaml/"+p));
const orig=read("valid-nested.yml");
const makeFile=(name,bytes=orig,declared=bytes.length)=>({name,size:declared,
  async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}});
const valid=await previewAnsibleYamlFileReadOnly(makeFile("inventory.yaml"));
const expected=valid.preview;
const builder={scenarioId:"site_existing",sourceRevision:4,resources:[
  {id:"rds01",label:"RDS host"},{id:"fw01",label:"Firewall"}]};
const choice={sourceSha256:expected.sourceSha256,scenarioId:builder.scenarioId,
  sourceRevision:builder.sourceRevision,acknowledgeNotVerified:true,
  associations:[{hostOrdinal:0,resourceId:"rds01"}]};
const modelBefore=JSON.stringify(builder),previewBefore=JSON.stringify(expected);
let count=0;const eq=(a,b,label)=>{assert.deepEqual(a,b,label);count++;};
const live=()=>builder;
const exact=reviewAnsibleInventoryAssociations(expected,builder,choice);
eq(exact.status,"READY_FOR_EXPORT");
const accepted=await reviewAnsibleYamlOriginalFileAssociations(makeFile("inventory.yaml"),
  expected,live,choice,()=>true);
eq(accepted,exact.sidecar,"Bridge must return canonical unchanged P3 sidecar");
eq(accepted.status,"REVIEWED_ASSOCIATIONS_ONLY");
eq(accepted.source.sha256,expected.sourceSha256);
eq(accepted.associations[0].hostLocators,expected.hosts[0].locators);
eq(accepted.engineVerified,false);
eq(accepted.physicalTopologyVerified,false);
eq(JSON.stringify(builder),modelBefore);
eq(JSON.stringify(expected),previewBefore);

async function blocked(file,prev,model,decision,current,code){
  await assert.rejects(reviewAnsibleYamlOriginalFileAssociations(file,prev,model,decision,current),
    e=>e?.code===code&&e?.message===code,code);
  count++;
}
const different=read("valid-repeated-host.yml");
await blocked(makeFile("inventory.yaml",different),expected,live,choice,()=>true,"ANSIBLE_YAML_ASSOC_SOURCE_CHANGED");
const changedContents=Uint8Array.from(orig);changedContents[changedContents.length-1]=32;
await blocked(makeFile("inventory.yaml",changedContents),expected,live,choice,()=>true,"ANSIBLE_YAML_ASSOC_SOURCE_CHANGED");
await blocked(makeFile("source.txt"),expected,live,choice,()=>true,"ANSIBLE_YAML_ASSOC_SOURCE_BLOCKED");
await blocked(makeFile("../source.yml"),expected,live,choice,()=>true,"ANSIBLE_YAML_ASSOC_SOURCE_BLOCKED");
await blocked(makeFile("source.yml",orig,256*1024+1),expected,live,choice,()=>true,"ANSIBLE_YAML_ASSOC_SOURCE_BLOCKED");
await blocked(makeFile("source.yml",new Uint8Array([0xff,0xfe])),expected,live,choice,()=>true,"ANSIBLE_YAML_ASSOC_SOURCE_BLOCKED");
await blocked(makeFile("source.yml",read("invalid-alias.yml")),expected,live,choice,()=>true,"ANSIBLE_YAML_ASSOC_SOURCE_BLOCKED");
await blocked(makeFile("source.yml",read("invalid-duplicate-key.yml")),expected,live,choice,()=>true,"ANSIBLE_YAML_ASSOC_SOURCE_BLOCKED");
await blocked(null,expected,live,choice,()=>true,"ANSIBLE_YAML_ASSOC_SOURCE_BLOCKED");
await blocked(makeFile("source.yml"),{...expected,hosts:expected.hosts.slice(1)},live,choice,()=>true,"ANSIBLE_YAML_ASSOC_SOURCE_CHANGED");
await blocked(makeFile("source.yml"),{...expected,hosts:expected.hosts.map((h,i)=>i===0?
  {...h,locators:[{...h.locators[0],groupPath:"all/forged"}]}:h)},live,choice,()=>true,"ANSIBLE_YAML_ASSOC_SOURCE_CHANGED");
await blocked(makeFile("source.yml"),{...expected,canActivate:true},live,choice,()=>true,"ANSIBLE_YAML_ASSOC_SOURCE_INVALID");
await blocked(makeFile("source.yml"),expected,live,{...choice,acknowledgeNotVerified:false},()=>true,"ANSIBLE_YAML_ASSOC_ACK_REQUIRED");
await blocked(makeFile("source.yml"),expected,()=>null,choice,()=>true,"ANSIBLE_YAML_ASSOC_BUILDER_REQUIRED");
await blocked(makeFile("source.yml"),expected,live,choice,()=>false,"ANSIBLE_YAML_ASSOC_STALE");
await blocked(makeFile("source.yml"),expected,()=>({...builder,sourceRevision:5}),choice,()=>true,"ANSIBLE_ASSOC_STALE");
await blocked(makeFile("source.yml"),expected,live,{...choice,sourceSha256:"a".repeat(64)},()=>true,"ANSIBLE_ASSOC_STALE");
await blocked(makeFile("source.yml"),expected,live,{...choice,associations:[
  {hostOrdinal:0,resourceId:"rds01"},{hostOrdinal:1,resourceId:"rds01"}]},()=>true,"ANSIBLE_ASSOC_SELECTION_INVALID");
const staleBuilder={...builder};
let modelReads=0;
await blocked(makeFile("source.yml"),expected,()=>{
  modelReads++;return modelReads===1?builder:{...staleBuilder,sourceRevision:5};
},choice,()=>true,"ANSIBLE_YAML_ASSOC_STALE");
let labelReads=0;
await blocked(makeFile("source.yml"),expected,()=>{
  labelReads++;return labelReads===1?builder:{...builder,resources:[{id:"rds01",label:"CHANGED"},{id:"fw01",label:"Firewall"}]};
},choice,()=>true,"ANSIBLE_YAML_ASSOC_STALE");
let now=true;
await blocked({name:"source.yml",size:orig.length,async arrayBuffer(){
  now=false;return orig.buffer.slice(orig.byteOffset,orig.byteOffset+orig.byteLength);
}},expected,live,choice,()=>now,"ANSIBLE_YAML_ASSOC_STALE");
let afterRead=0;
await blocked(makeFile("source.yml"),expected,()=>{
  afterRead++;
  return afterRead<3?builder:{...builder,resources:[{id:"rds01",label:"CHANGED"},{id:"fw01",label:"Firewall"}]};
},choice,()=>true,"ANSIBLE_YAML_ASSOC_STALE");

const dialog=renderToStaticMarkup(React.createElement(AnsibleInventoryPanel,{
 inspectFile:previewAnsibleYamlFileReadOnly,onClose(){},model:builder,onExportAssociation(){},
}));
eq(dialog.includes('data-ansible-panel="CONFIG_DOCUMENTED"'),true);
const code=fs.readFileSync("ui/app/ansible-inventory-panel.mjs","utf8");
for(const marker of ["originalFile.current=file","setSelectionEpoch(value=>value+1)",
  "req.current===epoch&&originalFile.current===source","originalFile.current=null"]){
 eq(code.includes(marker),true,marker);
}
for(const forbidden of ["setWorkspace(","indexedDB","localStorage","dangerouslySetInnerHTML"]){
 eq(code.includes(forbidden),false,forbidden);
}
const main=fs.readFileSync("ui/app/main.mjs","utf8");
eq(main.includes("reviewAnsibleYamlOriginalFileAssociations("),true);
eq(main.includes("latestDrawioWorkspaceRef.current"),true);
eq(main.includes("onExportAssociation: async (originalFile,inventoryPreview,decision,isCurrent)"),true);
eq(main.includes("reviewAnsibleInventoryAssociations(inventoryPreview, currentModel, decision)"),false);
eq(JSON.stringify(builder),modelBefore);
eq(JSON.stringify(expected),previewBefore);
console.log("PASS ANSIBLE-YAML-P4 "+count+" exact original bytes/live Builder/source epoch, P3 schema, privacy, negative & SSR gates");
