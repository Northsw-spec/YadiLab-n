import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {previewAnsibleIniFileReadOnly} from "../../dist-browser-test/ui/src/browser/ansible-ini-file-preview.js";
import {reviewAnsibleIniOriginalFileAssociations} from "../../dist-browser-test/ui/src/browser/ansible-ini-association-file.js";
import {reviewAnsibleIniInventoryAssociations} from "../../dist-browser-test/enterprise-import/src/ansible-ini-association-review.js";
import {AnsibleIniInventoryPanel} from "../../ui/app/ansible-ini-inspection-panel.mjs";
const read=p=>new Uint8Array(fs.readFileSync("tests/fixtures/import/ansible-ini/"+p));
const raw=read("valid-multigroup.ini");
const file=(name="source.ini",bytes=raw,declared=bytes.length)=>({name,size:declared,async arrayBuffer(){
 const copy=new ArrayBuffer(bytes.length);new Uint8Array(copy).set(bytes);return copy;
}});
const expected=(await previewAnsibleIniFileReadOnly(file())).preview;
const builder={scenarioId:"site_existing",sourceRevision:4,resources:[{id:"rds01",label:"RDS host"},{id:"fw01",label:"Firewall"}]};
const decision={sourceSha256:expected.sourceSha256,scenarioId:builder.scenarioId,sourceRevision:builder.sourceRevision,
 acknowledgeNotVerified:true,associations:[{hostOrdinal:0,resourceId:"rds01"}]};
let count=0;const eq=(x,y,msg)=>{assert.deepEqual(x,y,msg);count++};
const reviewed=reviewAnsibleIniInventoryAssociations(expected,builder,decision);
eq(reviewed.status,"READY_FOR_EXPORT");
const beforeModel=JSON.stringify(builder),beforeSource=JSON.stringify(expected);
const result=await reviewAnsibleIniOriginalFileAssociations(file(),expected,()=>builder,decision,()=>true);
eq(result,reviewed.sidecar,"P4 export is exact canonical P3 sidecar");
eq(result.status,"REVIEWED_ASSOCIATIONS_ONLY");
eq(result.source.sha256,expected.sourceSha256);
eq(result.associations[0].hostLocators,expected.hosts[0].locators);
eq(result.engineVerified,false);eq(result.physicalTopologyVerified,false);
eq(JSON.stringify(builder),beforeModel);
eq(JSON.stringify(expected),beforeSource);
async function blocked(input,preview,getModel,choice,isCurrent,code){
 await assert.rejects(reviewAnsibleIniOriginalFileAssociations(input,preview,getModel,choice,isCurrent),
   cause=>cause?.code===code&&cause.message===code,code);count++;
}
const normal=()=>builder;
await blocked(file("source.ini",read("valid-ungrouped.ini")),expected,normal,decision,()=>true,"ANSIBLE_INI_P4_SOURCE_CHANGED");
const changed=Uint8Array.from(raw);changed[changed.length-1]=changed[changed.length-1]===10?32:10;
await blocked(file("source.ini",changed),expected,normal,decision,()=>true,"ANSIBLE_INI_P4_SOURCE_CHANGED");
await blocked(file("source.txt"),expected,normal,decision,()=>true,"ANSIBLE_INI_P4_SOURCE_BLOCKED");
await blocked(file("../source.ini"),expected,normal,decision,()=>true,"ANSIBLE_INI_P4_SOURCE_BLOCKED");
await blocked(file("source.ini",raw,256*1024+1),expected,normal,decision,()=>true,"ANSIBLE_INI_P4_SOURCE_BLOCKED");
await blocked(file("source.ini",new Uint8Array([0xff,0xfe])),expected,normal,decision,()=>true,"ANSIBLE_INI_P4_SOURCE_BLOCKED");
await blocked(file("source.ini",read("invalid-duplicate-section.ini")),expected,normal,decision,()=>true,"ANSIBLE_INI_P4_SOURCE_BLOCKED");
await blocked(file("source.ini",read("invalid-ini-command.ini")),expected,normal,decision,()=>true,"ANSIBLE_INI_P4_SOURCE_BLOCKED");
await blocked(file("source.ini",read("invalid-host-range.ini")),expected,normal,decision,()=>true,"ANSIBLE_INI_P4_SOURCE_BLOCKED");
await blocked(null,expected,normal,decision,()=>true,"ANSIBLE_INI_P4_SOURCE_BLOCKED");
await blocked(file(),{...expected,hosts:expected.hosts.slice(1)},normal,decision,()=>true,"ANSIBLE_INI_P4_SOURCE_CHANGED");
await blocked(file(),{...expected,hosts:expected.hosts.map((h,i)=>i===0?{...h,locators:[]}:h)},normal,decision,()=>true,"ANSIBLE_INI_P4_SOURCE_CHANGED");
await blocked(file(),{...expected,groupChildren:{east:["forged_child"]}},normal,decision,()=>true,"ANSIBLE_INI_P4_SOURCE_CHANGED");
await blocked(file(),{...expected,canActivate:true},normal,decision,()=>true,"ANSIBLE_INI_P4_SOURCE_INVALID");
await blocked(file(),expected,normal,{...decision,acknowledgeNotVerified:false},()=>true,"ANSIBLE_INI_P4_ACK_REQUIRED");
await blocked(file(),expected,()=>null,decision,()=>true,"ANSIBLE_INI_P4_BUILDER_REQUIRED");
await blocked(file(),expected,normal,decision,()=>false,"ANSIBLE_INI_P4_STALE");
await blocked(file(),expected,normal,{...decision,sourceSha256:"a".repeat(64)},()=>true,"ANSIBLE_INI_ASSOC_STALE");
await blocked(file(),expected,normal,{...decision,associations:[{hostOrdinal:0,resourceId:"rds01"},{hostOrdinal:1,resourceId:"rds01"}]},()=>true,"ANSIBLE_INI_ASSOC_SELECTION_INVALID");
await blocked(file(),expected,()=>({...builder,sourceRevision:6}),decision,()=>true,"ANSIBLE_INI_ASSOC_STALE");
let reads=0;
await blocked(file(),expected,()=>++reads===1?builder:{...builder,sourceRevision:5},
 decision,()=>true,"ANSIBLE_INI_P4_STALE");
reads=0;
await blocked(file(),expected,()=>++reads===1?builder:{...builder,resources:[{...builder.resources[0],label:"changed"},builder.resources[1]]},
 decision,()=>true,"ANSIBLE_INI_P4_STALE");
reads=0;
await blocked(file(),expected,()=>++reads<3?builder:{...builder,resources:[{...builder.resources[0],id:"changed"},builder.resources[1]]},
 decision,()=>true,"ANSIBLE_INI_P4_STALE");
let isValid=true;
const toggling={name:"source.ini",size:raw.length,async arrayBuffer(){
 isValid=false;const copy=new ArrayBuffer(raw.length);new Uint8Array(copy).set(raw);return copy;
}};
await blocked(toggling,expected,normal,decision,()=>isValid,"ANSIBLE_INI_P4_STALE");
const secrets=(await previewAnsibleIniFileReadOnly(file("hidden.ini",read("valid-sensitive-vars.ini")))).preview;
const privateReview=await reviewAnsibleIniOriginalFileAssociations(
 file("hidden.ini",read("valid-sensitive-vars.ini")),secrets,normal,
 {...decision,sourceSha256:secrets.sourceSha256,associations:[{hostOrdinal:0,resourceId:"rds01"}]},()=>true);
for(const token of ["SECRET_INI_HOST_CANARY_DONT_EXPORT","SECRET_INI_GROUP_CANARY_DONT_EXPORT",
  "SECRET_INI_BECOME_CANARY_DONT_EXPORT","private_key_canary"]){
 eq(JSON.stringify(privateReview).includes(token),false,"Secret excluded");
}
const dialog=renderToStaticMarkup(React.createElement(AnsibleIniInventoryPanel,{
 inspectFile:previewAnsibleIniFileReadOnly,onClose(){},model:builder,onExportAssociation(){}
}));
eq(dialog.includes('data-ansible-ini-panel="CONFIG_DOCUMENTED"'),true);
const ui=fs.readFileSync("ui/app/ansible-ini-inspection-panel.mjs","utf8");
for(const marker of ["originalFile.current=file","setSourceEpoch(epoch=>epoch+1)",
  "currentRequest.current===epoch&&originalFile.current===source","originalFile.current=null"]){
 eq(ui.includes(marker),true,marker);
}
for(const forbidden of ["setWorkspace(","indexedDB","localStorage","dangerouslySetInnerHTML"]){
 eq(ui.includes(forbidden),false,forbidden);
}
const main=fs.readFileSync("ui/app/main.mjs","utf8");
eq(main.includes("reviewAnsibleIniOriginalFileAssociations("),true);
eq(main.includes("latestDrawioWorkspaceRef.current"),true);
eq(main.includes("onExportAssociation: async (originalFile,inventoryPreview,decision,isCurrent)"),true);
eq(main.includes("reviewAnsibleIniInventoryAssociations(inventoryPreview, currentModel, decision)"),false);
eq(JSON.stringify(builder),beforeModel);eq(JSON.stringify(expected),beforeSource);
console.log("PASS ANSIBLE INI P4 "+count+" strict byte/provenance, consent, stale Builder, safe errors, private vars and SSR assertions");
