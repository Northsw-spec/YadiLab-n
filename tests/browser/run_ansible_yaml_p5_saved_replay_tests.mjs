import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { previewAnsibleStaticInventory } from "../../dist-browser-test/enterprise-import/src/ansible-yaml-preview.js";
import { reviewAnsibleInventoryAssociations } from "../../dist-browser-test/enterprise-import/src/ansible-association-review.js";
import { replayAnsibleYamlSavedReferences } from "../../dist-browser-test/enterprise-import/src/ansible-yaml-report-replay.js";
import { replayAnsibleYamlSavedReportFiles } from "../../dist-browser-test/ui/src/browser/ansible-yaml-report-replay-file.js";
import { AnsibleYamlSavedReferenceReplayPanel } from "../../ui/app/ansible-yaml-reference-replay-panel.mjs";

const bytes=new Uint8Array(fs.readFileSync("tests/fixtures/import/ansible-yaml/valid-nested.yml"));
const repeated=new Uint8Array(fs.readFileSync("tests/fixtures/import/ansible-yaml/valid-repeated-host.yml"));
const sensitive=new Uint8Array(fs.readFileSync("tests/fixtures/import/ansible-yaml/valid-sensitive-vars.yml"));
const invalid=new Uint8Array(fs.readFileSync("tests/fixtures/import/ansible-yaml/invalid-alias.yml"));
const encoder=new TextEncoder();
const preview=await previewAnsibleStaticInventory(bytes);
const builder={scenarioId:"site_existing",sourceRevision:4,resources:[
 {id:"rds01",label:"RDS server"}, {id:"firewall01",label:"Firewall"},{id:"admin01",label:"Admin"}]};
const decision={sourceSha256:preview.sourceSha256,scenarioId:builder.scenarioId,
 sourceRevision:builder.sourceRevision,acknowledgeNotVerified:true,
 associations:[{hostOrdinal:0,resourceId:"rds01"},{hostOrdinal:2,resourceId:"firewall01"}]};
const exported=reviewAnsibleInventoryAssociations(preview,builder,decision);
assert.equal(exported.status,"READY_FOR_EXPORT");
const report=exported.sidecar;
const data=encoder.encode(JSON.stringify(report,null,2));
let count=0;const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);count++;};
const match=await replayAnsibleYamlSavedReferences(bytes,data,builder,true);
eq(match.status,"REFERENCE_REPLAY_MATCH");
eq(match.sourceSha256,createHash("sha256").update(bytes).digest("hex"));
eq(match.referencesChecked,2);
eq(match.reportFormat,"yadilab.ansible-inventory-associations");
eq(match.semanticTrack,"CONFIG_DOCUMENTED");
for(const k of ["engineVerified","identityVerified","physicalTopologyVerified","modelMutated"])eq(match[k],false);
eq(Object.isFrozen(match),true);
eq(Object.hasOwn(match,"associations"),false);
const originalReport=JSON.stringify(report),originalBuilder=JSON.stringify(builder);
const file=(name,raw,declared=raw.length)=>({name,size:declared,async arrayBuffer(){
 return raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
}});
let currentBuilder=builder,valid=true;
const local=()=>replayAnsibleYamlSavedReportFiles(
 file("original.yaml",bytes),file("saved.json",data),()=>currentBuilder,true,()=>valid);
eq(await local(),match);
async function block(source,saved,model,ack,code){
 await assert.rejects(replayAnsibleYamlSavedReferences(source,saved,model,ack),
  e=>e?.code===code&&e.message===code,code);count++;
}
async function bad(obj,code="ANSIBLE_YAML_REPLAY_REPORT_MISMATCH"){
 await block(bytes,encoder.encode(JSON.stringify(obj)),builder,true,code);
}
await block(bytes,data,builder,false,"ANSIBLE_YAML_REPLAY_CONSENT_REQUIRED");
await block(bytes,data,null,true,"ANSIBLE_YAML_REPLAY_BUILDER_REQUIRED");
await block(repeated,data,builder,true,"ANSIBLE_YAML_REPLAY_SOURCE_CHANGED");
await block(invalid,data,builder,true,"ANSIBLE_YAML_REPLAY_SOURCE_BLOCKED");
await block(bytes,encoder.encode("{broken"),builder,true,"ANSIBLE_YAML_REPLAY_REPORT_INVALID");
await block(bytes,new Uint8Array([0xff,0xfe]),builder,true,"ANSIBLE_YAML_REPLAY_REPORT_INVALID");
await block(bytes,new Uint8Array(256*1024+1),builder,true,"ANSIBLE_YAML_REPLAY_REPORT_SIZE_INVALID");
await block(bytes,encoder.encode("[]"),builder,true,"ANSIBLE_YAML_REPLAY_REPORT_INVALID");
await block(bytes,encoder.encode(JSON.stringify({...report,formatId:"wrong"})),builder,true,"ANSIBLE_YAML_REPLAY_FORMAT_UNSUPPORTED");
await bad({...report,schemaVersion:"2.0.0"},"ANSIBLE_YAML_REPLAY_REPORT_INVALID");
await bad({...report,status:"ENGINE_VERIFIED"},"ANSIBLE_YAML_REPLAY_REPORT_INVALID");
await bad({...report,engineVerified:true});
await bad({...report,physicalTopologyVerified:true});
await bad({...report,identityVerified:true});
await bad({...report,modelMutated:true});
await bad({...report,warnings:[]});
await bad({...report,variables:{ansible_password:"PASSWORD_NEVER_EXPOSED"}});
await bad({...report,source:{...report.source,profileId:"forged"}});
await bad({...report,source:{...report.source,sha256:"0".repeat(64)}},"ANSIBLE_YAML_REPLAY_SOURCE_CHANGED");
await bad({...report,targetModel:{...report.targetModel,sourceRevision:5}},"ANSIBLE_YAML_REPLAY_MODEL_MISMATCH");
await bad({...report,associations:[...report.associations].reverse()});
await bad({...report,associations:[]}, "ANSIBLE_YAML_REPLAY_COUNT_INVALID");
await bad({...report,associations:[report.associations[0],report.associations[0]]},
 "ANSIBLE_YAML_REPLAY_MODEL_MISMATCH");
await bad({...report,associations:[{...report.associations[0],
  hostOrdinal:0.25},report.associations[1]]},"ANSIBLE_YAML_REPLAY_ASSOCIATION_INVALID");
await bad({...report,associations:[{...report.associations[0],
  hostOrdinal:80},report.associations[1]]},"ANSIBLE_YAML_REPLAY_MODEL_MISMATCH");
await bad({...report,associations:[{...report.associations[0],
  targetResourceId:"__proto__"},report.associations[1]]},"ANSIBLE_YAML_REPLAY_ASSOCIATION_INVALID");
await bad({...report,associations:[{...report.associations[0],
  assertion:"VERIFIED_PHYSICAL_DEVICE"},report.associations[1]]},"ANSIBLE_YAML_REPLAY_ASSOCIATION_INVALID");
await bad({...report,associations:[{...report.associations[0],
  inventoryName:"forged"},report.associations[1]]});
await bad({...report,associations:[{...report.associations[0],
  reportedConnectionAddress:"evil.example"},report.associations[1]]});
await bad({...report,associations:[{...report.associations[0],
  groupPaths:["all/fake"]},report.associations[1]]});
await bad({...report,associations:[{...report.associations[0],
  hostLocators:[]},report.associations[1]]});
await block(bytes,data,{...builder,sourceRevision:5},true,"ANSIBLE_YAML_REPLAY_MODEL_MISMATCH");
await block(bytes,data,{...builder,scenarioId:"other"},true,"ANSIBLE_YAML_REPLAY_MODEL_MISMATCH");
await block(bytes,data,{...builder,resources:builder.resources.slice(1)},true,"ANSIBLE_YAML_REPLAY_MODEL_MISMATCH");
await block(bytes,data,{...builder,resources:[builder.resources[0],builder.resources[0]]},true,"ANSIBLE_YAML_REPLAY_MODEL_MISMATCH");
// Duplicate JSON keys must be rejected BEFORE JSON.parse's last-key-wins behavior.
await block(bytes,encoder.encode(JSON.stringify(report).replace('"engineVerified":false',
 '"engineVerified":false,"engineVerified":false')),builder,true,"ANSIBLE_YAML_REPLAY_REPORT_INVALID");
await block(bytes,encoder.encode(JSON.stringify(report).replace('"source":{',
 '"source":{"sha256":"'+preview.sourceSha256+'",')),builder,true,"ANSIBLE_YAML_REPLAY_REPORT_INVALID");
await block(bytes,encoder.encode(JSON.stringify(report).replace('"source":{',
 '"source":{"__proto__":{},')),builder,true,"ANSIBLE_YAML_REPLAY_REPORT_INVALID");
const longArray=Array.from({length:201},()=>null);
await bad({...report,associations:longArray},"ANSIBLE_YAML_REPLAY_REPORT_INVALID");
const tooDeep='{"x":'.repeat(20)+'null'+'}'.repeat(20);
await block(bytes,encoder.encode(tooDeep),builder,true,"ANSIBLE_YAML_REPLAY_REPORT_INVALID");

async function fileFail(orig,saved,getModel,ack,current,code){
 await assert.rejects(replayAnsibleYamlSavedReportFiles(orig,saved,getModel,ack,current),
  e=>e?.code===code&&e.message===code,code);count++;
}
await fileFail(file("wrong.txt",bytes),file("saved.json",data),()=>builder,true,()=>true,"ANSIBLE_YAML_REPLAY_FILE_INVALID");
await fileFail(file("../original.yml",bytes),file("saved.json",data),()=>builder,true,()=>true,"ANSIBLE_YAML_REPLAY_FILE_INVALID");
await fileFail(file("source.yaml",bytes),file("../saved.json",data),()=>builder,true,()=>true,"ANSIBLE_YAML_REPLAY_FILE_INVALID");
await fileFail(file("source.yaml",bytes,256*1024+1),file("saved.json",data),()=>builder,true,()=>true,"ANSIBLE_YAML_REPLAY_FILE_SIZE_INVALID");
await fileFail(file("source.yaml",bytes),file("saved.json",data),()=>builder,false,()=>true,"ANSIBLE_YAML_REPLAY_CONSENT_REQUIRED");
await fileFail(file("source.yaml",bytes),file("saved.json",data),()=>null,true,()=>true,"ANSIBLE_YAML_REPLAY_BUILDER_REQUIRED");
valid=false;await fileFail(file("source.yaml",bytes),file("saved.json",data),()=>builder,true,()=>valid,"ANSIBLE_YAML_REPLAY_STALE");valid=true;
const changedOriginal={name:"source.yaml",size:bytes.length,async arrayBuffer(){
 currentBuilder={...builder,sourceRevision:10};
 return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
}};
await fileFail(changedOriginal,file("saved.json",data),()=>currentBuilder,true,()=>true,"ANSIBLE_YAML_REPLAY_STALE");
currentBuilder=builder;
const changedReport={name:"saved.json",size:data.length,async arrayBuffer(){
 currentBuilder={...builder,resources:[{...builder.resources[0],label:"Changed"},...builder.resources.slice(1)]};
 return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
}};
await fileFail(file("source.yaml",bytes),changedReport,()=>currentBuilder,true,()=>true,"ANSIBLE_YAML_REPLAY_STALE");currentBuilder=builder;
const privatePreview=await previewAnsibleStaticInventory(sensitive);
const privateReview=reviewAnsibleInventoryAssociations(privatePreview,builder,{
 ...decision,sourceSha256:privatePreview.sourceSha256,associations:[{hostOrdinal:0,resourceId:"rds01"}]});
eq(privateReview.status,"READY_FOR_EXPORT");
const privateMatch=await replayAnsibleYamlSavedReferences(sensitive,
 encoder.encode(JSON.stringify(privateReview.sidecar)),builder,true);
for(const term of ["SYNTHETIC_SECRET_CANARY_NOT_REAL","SYNTHETIC_PRIVATE_PATH",
 "SYNTHETIC_TOKEN_CANARY_NOT_REAL","ansible_password"]){
 eq(JSON.stringify(privateMatch).includes(term),false);
}
const html=renderToStaticMarkup(React.createElement(AnsibleYamlSavedReferenceReplayPanel,{
 model:builder,onReplay(){throw Error("SSR must not run");},onClose(){},
}));
for(const marker of ['data-ansible-yaml-replay-panel="CONFIG_DOCUMENTED"',
 'data-ansible-yaml-replay-original="true"','data-ansible-yaml-replay-report="true"',
 'data-ansible-yaml-replay-consent="true"','data-ansible-yaml-replay-verify="true"',
 'data-ansible-yaml-replay-truth="true"','disabled=""']){
 eq(html.includes(marker),true,marker);
}
const missing=renderToStaticMarkup(React.createElement(AnsibleYamlSavedReferenceReplayPanel,{
 model:null,onClose(){},onReplay(){}
}));
eq(missing.includes('data-ansible-yaml-replay-no-builder="true"'),true);
eq(JSON.stringify(report),originalReport);
eq(JSON.stringify(builder),originalBuilder);
const main=fs.readFileSync("ui/app/main.mjs","utf8");
for(const token of ["data-inspect-ansible-yaml-replay",
 "replayAnsibleYamlSavedReportFiles(","latestDrawioWorkspaceRef.current"]){
 eq(main.includes(token),true,token);
}
for(const path of ["enterprise-import/src/ansible-yaml-report-replay.ts",
 "ui/src/browser/ansible-yaml-report-replay-file.ts",
 "ui/app/ansible-yaml-reference-replay-panel.mjs"]){
 const source=fs.readFileSync(path,"utf8");
 for(const forbidden of ["fetch(","localStorage","indexedDB","setWorkspace(","dangerouslySetInnerHTML"]){
  eq(source.includes(forbidden),false,"No mutation/network: "+path+" "+forbidden);
 }
}
console.log("PASS ANSIBLE YAML P5 "+count+" source/report/canonical, duplicate-key, privacy, stale Builder, SSR and negative tests");
