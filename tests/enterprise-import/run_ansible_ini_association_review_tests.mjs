import assert from "node:assert/strict";
import fs from "node:fs";
import { previewAnsibleIniStaticInventory } from "../../dist-enterprise-import-test/enterprise-import/src/ansible-ini-preview.js";
import { reviewAnsibleIniInventoryAssociations } from "../../dist-enterprise-import-test/enterprise-import/src/ansible-ini-association-review.js";

let assertions=0;
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);assertions++;};
const read=name=>Uint8Array.from(fs.readFileSync("tests/fixtures/import/ansible-ini/"+name));
const preview=await previewAnsibleIniStaticInventory(read("valid-ungrouped.ini"));
const model={scenarioId:"site_existing",sourceRevision:4,resources:[
 {id:"rds01",label:"RDS host"},{id:"fw01",label:"Firewall"},{id:"app01",label:"Application server"}]};
const decision={sourceSha256:preview.sourceSha256,scenarioId:model.scenarioId,
 sourceRevision:model.sourceRevision,acknowledgeNotVerified:true,
 associations:[{hostOrdinal:0,resourceId:"rds01"}]};
const deny=(choice,code,current=model,source=preview)=>{
 const got=reviewAnsibleIniInventoryAssociations(source,current,choice);
 eq(got.status,"BLOCKED",code);eq(got.diagnostics[0]?.code,code);
 eq(Object.hasOwn(got,"sidecar"),false,"No partial sidecar after a BLOCK");
};
const sourceBefore=JSON.stringify(preview),modelBefore=JSON.stringify(model);
const accepted=reviewAnsibleIniInventoryAssociations(preview,model,decision);
eq(accepted.status,"READY_FOR_EXPORT");
eq(accepted.diagnostics,[]);
eq(accepted.sidecar?.formatId,"yadilab.ansible-ini-inventory-associations");
eq(accepted.sidecar?.schemaVersion,"1.0.0");
eq(accepted.sidecar?.status,"REVIEWED_ASSOCIATIONS_ONLY");
eq(accepted.sidecar?.engineVerified,false);
eq(accepted.sidecar?.physicalTopologyVerified,false);
eq(accepted.sidecar?.source,{profileId:"ansible.inventory.static.ini.v1",
 sha256:preview.sourceSha256,semanticTrack:"CONFIG_DOCUMENTED"});
eq(accepted.sidecar?.targetModel,{scenarioId:"site_existing",sourceRevision:4});
eq(accepted.sidecar?.associations.length,1);
const first=accepted.sidecar?.associations[0];
eq(first?.inventoryName,"jump01");
eq(first?.hostOrdinal,0);
eq(first?.reportedConnectionAddress,"192.0.2.11");
eq(first?.addressTruth,"REPORTED_NOT_VERIFIED");
eq(first?.directGroups,[]);
eq(first?.hostLocators,[{kind:"ansible-ini-host",sourceSha256:preview.sourceSha256,
 lineNumber:2,section:"ungrouped",hostKey:"jump01"}]);
eq(first?.targetResourceId,"rds01");
eq(first?.assertion,"USER_ASSERTED_ASSOCIATION_NOT_VERIFIED");
for(const key of ["resources","connections","links","scenario","engineState","vars","tasks",
 "sourceRevision","physicalCables","credentials","verification"]){
 eq(Object.hasOwn(accepted.sidecar,key),false,"Sidecar cannot become modeled source: "+key);
}
eq(JSON.stringify(accepted),JSON.stringify(reviewAnsibleIniInventoryAssociations(preview,model,decision)),
 "Deterministic output");
eq(JSON.stringify(preview),sourceBefore,"Source preview MUST NOT mutate");
eq(JSON.stringify(model),modelBefore,"Current Builder model MUST NOT mutate");

const repeated=await previewAnsibleIniStaticInventory(read("valid-multigroup.ini"));
const groupedDecision={...decision,sourceSha256:repeated.sourceSha256,
 associations:[{hostOrdinal:1,resourceId:"fw01"},{hostOrdinal:0,resourceId:"rds01"}]};
const grouped=reviewAnsibleIniInventoryAssociations(repeated,model,groupedDecision);
eq(grouped.status,"READY_FOR_EXPORT");
eq(grouped.sidecar?.associations.map(x=>x.hostOrdinal),[0,1]);
eq(grouped.sidecar?.associations[0].directGroups,["east","west"]);
eq(grouped.sidecar?.associations[0].hostLocators.map(x=>x.lineNumber),[2,6]);
eq(grouped.sidecar?.associations[0].hostLocators.map(x=>x.section),["east","west"]);
eq(JSON.stringify(grouped.sidecar),JSON.stringify(reviewAnsibleIniInventoryAssociations(
 repeated,model,{...groupedDecision,associations:[...groupedDecision.associations].reverse()}).sidecar),
 "Canonical order independent of UI selection order");

const sensitive=await previewAnsibleIniStaticInventory(read("valid-sensitive-vars.ini"));
const report=reviewAnsibleIniInventoryAssociations(sensitive,model,{
 ...decision,sourceSha256:sensitive.sourceSha256
});
eq(report.status,"READY_FOR_EXPORT");
for(const token of ["SECRET_INI_HOST_CANARY_DONT_EXPORT","SECRET_INI_GROUP_CANARY_DONT_EXPORT",
 "SECRET_INI_BECOME_CANARY_DONT_EXPORT","private_key_canary","ansible_password",
 "ansible_become_password","private_key_file"]){
 eq(JSON.stringify(report).includes(token),false,"No secrets from original source: "+token);
}
const unknown=await previewAnsibleIniStaticInventory(read("valid-ungrouped.ini"));
const unknownReport=reviewAnsibleIniInventoryAssociations(unknown,model,{
 ...decision,associations:[{hostOrdinal:2,resourceId:"app01"}]});
eq(unknownReport.status,"READY_FOR_EXPORT");
eq(unknownReport.sidecar?.associations[0].addressTruth,"UNKNOWN");
eq(Object.hasOwn(unknownReport.sidecar?.associations[0]??{},"reportedConnectionAddress"),false);

deny({...decision,sourceSha256:"a".repeat(64)},"ANSIBLE_INI_ASSOC_STALE");
deny({...decision,scenarioId:"another"},"ANSIBLE_INI_ASSOC_STALE");
deny({...decision,sourceRevision:5},"ANSIBLE_INI_ASSOC_STALE");
deny({...decision,acknowledgeNotVerified:false},"ANSIBLE_INI_ASSOC_ACK_REQUIRED");
deny({...decision,associations:[]},"ANSIBLE_INI_ASSOC_SELECTION_INVALID");
deny({...decision,associations:[{hostOrdinal:999,resourceId:"rds01"}]},"ANSIBLE_INI_ASSOC_SELECTION_INVALID");
deny({...decision,associations:[{hostOrdinal:-1,resourceId:"rds01"}]},"ANSIBLE_INI_ASSOC_SELECTION_INVALID");
deny({...decision,associations:[{hostOrdinal:0,resourceId:"unknown"}]},"ANSIBLE_INI_ASSOC_SELECTION_INVALID");
deny({...decision,associations:[{hostOrdinal:0,resourceId:"rds01"},
 {hostOrdinal:0,resourceId:"fw01"}]},"ANSIBLE_INI_ASSOC_SELECTION_INVALID");
deny({...decision,associations:[{hostOrdinal:0,resourceId:"rds01"},
 {hostOrdinal:1,resourceId:"rds01"}]},"ANSIBLE_INI_ASSOC_SELECTION_INVALID");
deny(decision,"ANSIBLE_INI_ASSOC_BUILDER_REQUIRED",null);
deny(decision,"ANSIBLE_INI_ASSOC_BUILDER_REQUIRED",{...model,sourceRevision:-1});
deny(decision,"ANSIBLE_INI_ASSOC_STALE",{...model,sourceRevision:9});
deny(decision,"ANSIBLE_INI_ASSOC_MODEL_INVALID",{...model,resources:[
 {id:"rds01",label:"first"},{id:"rds01",label:"duplicate"}]});
deny(decision,"ANSIBLE_INI_ASSOC_MODEL_INVALID",{...model,resources:[{id:"__proto__",label:"host"}]});
deny(decision,"ANSIBLE_INI_ASSOC_SOURCE_INVALID",model,{...preview,canActivate:true});
deny(decision,"ANSIBLE_INI_ASSOC_SOURCE_INVALID",model,{...preview,semanticTrack:"EVIDENCE_OBSERVED"});
deny(decision,"ANSIBLE_INI_ASSOC_SOURCE_INVALID",model,{...preview,profileId:"ansible.inventory.static.yaml.v1"});
deny(decision,"ANSIBLE_INI_ASSOC_SOURCE_INVALID",model,{...preview,sourceSha256:"wrong-hash"});
deny(decision,"ANSIBLE_INI_ASSOC_STALE",model,{...preview,sourceSha256:"a".repeat(64)});
const alter=(change)=>({...preview,hosts:preview.hosts.map((h,i)=>i===0?{...h,...change(h)}:h)});
deny(decision,"ANSIBLE_INI_ASSOC_PROVENANCE_INVALID",model,alter(h=>({
 locators:[{...h.locators[0],sourceSha256:"a".repeat(64)}]})));
deny(decision,"ANSIBLE_INI_ASSOC_PROVENANCE_INVALID",model,alter(h=>({
 locators:[{...h.locators[0],section:"wronggroup"}]})));
deny(decision,"ANSIBLE_INI_ASSOC_PROVENANCE_INVALID",model,alter(h=>({
 locators:[{...h.locators[0],hostKey:"other"}]})));
deny(decision,"ANSIBLE_INI_ASSOC_PROVENANCE_INVALID",model,alter(h=>({
 locators:[{...h.locators[0],lineNumber:0}]})));
deny(decision,"ANSIBLE_INI_ASSOC_PROVENANCE_INVALID",model,alter(h=>({
 locators:[{...h.locators[0],lineNumber:-1}]})));
deny(decision,"ANSIBLE_INI_ASSOC_PROVENANCE_INVALID",model,alter(h=>({
 directGroups:["not_declared"]})));
deny(decision,"ANSIBLE_INI_ASSOC_PROVENANCE_INVALID",model,alter(h=>({
 addressTruth:"UNKNOWN"})));
deny(decision,"ANSIBLE_INI_ASSOC_PROVENANCE_INVALID",model,alter(h=>({
 locators:[]})));
const groupedInvalid={...repeated,hosts:repeated.hosts.map((h,i)=>i===0?{
 ...h,locators:[...h.locators].reverse()}:h)};
deny({...groupedDecision,associations:[{hostOrdinal:0,resourceId:"rds01"}]},
 "ANSIBLE_INI_ASSOC_PROVENANCE_INVALID",model,groupedInvalid);
const fakeHost={...preview,hosts:Array.from({length:81},(_,i)=>({
 inventoryName:"host_"+i,addressTruth:"UNKNOWN",directGroups:[],
 locators:[{kind:"ansible-ini-host",sourceSha256:preview.sourceSha256,
 lineNumber:i+1,section:"ungrouped",hostKey:"host_"+i}]
}))};
const late=reviewAnsibleIniInventoryAssociations(fakeHost,model,{
 ...decision,associations:[{hostOrdinal:80,resourceId:"rds01"}]});
eq(late.status,"READY_FOR_EXPORT");
eq(late.sidecar.associations[0].hostOrdinal,80);
deny({...decision,associations:[{hostOrdinal:81,resourceId:"rds01"}]},
 "ANSIBLE_INI_ASSOC_SELECTION_INVALID",model,fakeHost);
console.log("PASS ANSIBLE-INI-P3: "+assertions+" independent typed provenance, stale/conflict, consent, redaction and no-Engine assertions.");
