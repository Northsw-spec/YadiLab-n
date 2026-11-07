import assert from "node:assert/strict";
import fs from "node:fs";
import { previewAnsibleStaticInventory } from "../../dist-enterprise-import-test/enterprise-import/src/ansible-yaml-preview.js";
import { reviewAnsibleInventoryAssociations } from "../../dist-enterprise-import-test/enterprise-import/src/ansible-association-review.js";

let checks = 0;
const eq = (a,b,label) => { assert.deepEqual(a,b,label); checks++; };
const read = name => Uint8Array.from(fs.readFileSync("tests/fixtures/import/ansible-yaml/" + name));
const preview = await previewAnsibleStaticInventory(read("valid-nested.yml"));
const model = { scenarioId: "site_existing", sourceRevision: 4,
  resources: [{ id:"fw01",label:"Firewall" },{ id:"rds01",label:"RDS host" }] };
const choice = { sourceSha256:preview.sourceSha256, scenarioId:model.scenarioId,
  sourceRevision:model.sourceRevision, associations:[{hostOrdinal:0,resourceId:"rds01"}],
  acknowledgeNotVerified:true };
const blocked=(change,code,current=model,source=preview)=>{
  const r=reviewAnsibleInventoryAssociations(source,current,change);
  eq(r.status,"BLOCKED",code);eq(r.diagnostics[0].code,code);
  eq(Object.hasOwn(r,"sidecar"),false,"No partial export on BLOCKED");
};
const originalSource = JSON.stringify(preview), originalModel = JSON.stringify(model);
const result=reviewAnsibleInventoryAssociations(preview,model,choice);
eq(result.status,"READY_FOR_EXPORT");
eq(result.diagnostics,[]);
eq(result.sidecar.formatId,"yadilab.ansible-inventory-associations");
eq(result.sidecar.schemaVersion,"1.0.0");
eq(result.sidecar.status,"REVIEWED_ASSOCIATIONS_ONLY");
eq(result.sidecar.engineVerified,false);
eq(result.sidecar.physicalTopologyVerified,false);
eq(result.sidecar.source,{profileId:"ansible.inventory.static.yaml.v1",
 sha256:preview.sourceSha256,semanticTrack:"CONFIG_DOCUMENTED"});
eq(result.sidecar.targetModel,{scenarioId:"site_existing",sourceRevision:4});
eq(result.sidecar.associations.length,1);
const first=result.sidecar.associations[0];
eq(first.hostOrdinal,0);
eq(first.inventoryName,"control01");
eq(first.reportedConnectionAddress,"192.0.2.10");
eq(first.addressTruth,"REPORTED_NOT_VERIFIED");
eq(first.groupPaths,["all"]);
eq(first.hostLocators,[{kind:"ansible-yaml-host",sourceSha256:preview.sourceSha256,
 groupPath:"all",hostKey:"control01"}]);
eq(first.targetResourceId,"rds01");
eq(first.assertion,"USER_ASSERTED_ASSOCIATION_NOT_VERIFIED");
for(const field of ["resources","connections","links","scenario","engineState","tasks","verification","vars"]) {
  eq(Object.hasOwn(result.sidecar,field),false,"Sidecar is not ScenarioSource or raw variables: "+field);
}
eq(JSON.stringify(result),JSON.stringify(reviewAnsibleInventoryAssociations(preview,model,choice)),
 "Deterministic identical decision");
eq(JSON.stringify(preview),originalSource,"Original preview not mutated");
eq(JSON.stringify(model),originalModel,"Original Builder snapshot not mutated");
const repeated=await previewAnsibleStaticInventory(read("valid-repeated-host.yml"));
const same={...choice,sourceSha256:repeated.sourceSha256,
 associations:[{hostOrdinal:0,resourceId:"rds01"},{hostOrdinal:1,resourceId:"fw01"}]};
const twice=reviewAnsibleInventoryAssociations(repeated,model,same);
eq(twice.status,"READY_FOR_EXPORT");
eq(twice.sidecar.associations.map(x=>x.hostOrdinal),[0,1]);
eq(twice.sidecar.associations[0].groupPaths,["all/east","all/west"]);
eq(twice.sidecar.associations[0].hostLocators.map(x=>x.groupPath),["all/east","all/west"]);
const reverse=reviewAnsibleInventoryAssociations(repeated,model,{...same,
 associations:[same.associations[1],same.associations[0]]});
eq(JSON.stringify(reverse.sidecar),JSON.stringify(twice.sidecar),"Canonical ordering regardless of selection order");
const hidden=await previewAnsibleStaticInventory(read("valid-sensitive-vars.yml"));
const secretReport=reviewAnsibleInventoryAssociations(hidden,model,{...choice,
 sourceSha256:hidden.sourceSha256});
eq(secretReport.status,"READY_FOR_EXPORT");
for(const token of ["SYNTHETIC_SECRET_CANARY_NOT_REAL","SYNTHETIC_TOKEN_CANARY_NOT_REAL",
  "SYNTHETIC_PRIVATE_PATH","synthetic_admin","ansible_password","internal_token",
  "ansible_ssh_private_key_file"]) {
  eq(JSON.stringify(secretReport).includes(token),false,"No sensitive variable copied: "+token);
}
blocked({...choice,sourceSha256:"a".repeat(64)},"ANSIBLE_ASSOC_STALE");
blocked({...choice,scenarioId:"different"},"ANSIBLE_ASSOC_STALE");
blocked({...choice,sourceRevision:3},"ANSIBLE_ASSOC_STALE");
blocked({...choice,acknowledgeNotVerified:false},"ANSIBLE_ASSOC_ACK_REQUIRED");
blocked({...choice,associations:[]},"ANSIBLE_ASSOC_SELECTION_INVALID");
blocked({...choice,associations:[{hostOrdinal:99,resourceId:"rds01"}]},"ANSIBLE_ASSOC_SELECTION_INVALID");
blocked({...choice,associations:[{hostOrdinal:-1,resourceId:"rds01"}]},"ANSIBLE_ASSOC_SELECTION_INVALID");
blocked({...choice,associations:[{hostOrdinal:0,resourceId:"missing"}]},"ANSIBLE_ASSOC_SELECTION_INVALID");
blocked({...choice,associations:[{hostOrdinal:0,resourceId:"rds01"},{hostOrdinal:0,resourceId:"fw01"}]},"ANSIBLE_ASSOC_SELECTION_INVALID");
blocked({...choice,associations:[{hostOrdinal:0,resourceId:"rds01"},{hostOrdinal:1,resourceId:"rds01"}]},"ANSIBLE_ASSOC_SELECTION_INVALID");
blocked(choice,"ANSIBLE_ASSOC_BUILDER_REQUIRED",null);
blocked(choice,"ANSIBLE_ASSOC_BUILDER_REQUIRED",{...model,sourceRevision:-1});
blocked(choice,"ANSIBLE_ASSOC_STALE",{...model,sourceRevision:5});
blocked(choice,"ANSIBLE_ASSOC_MODEL_INVALID",{...model,resources:[{id:"same",label:"a"},{id:"same",label:"b"}]});
blocked(choice,"ANSIBLE_ASSOC_MODEL_INVALID",{...model,resources:[{id:"__proto__",label:"bad"}]});
blocked(choice,"ANSIBLE_ASSOC_SOURCE_INVALID",model,{...preview,canActivate:true});
blocked(choice,"ANSIBLE_ASSOC_SOURCE_INVALID",model,{...preview,semanticTrack:"TOPOLOGY_DECLARED"});
const mismatched={...preview,hosts:preview.hosts.map((h,i)=>i===0?
 {...h,locators:[{...h.locators[0],sourceSha256:"a".repeat(64)}]}:h)};
blocked(choice,"ANSIBLE_ASSOC_PROVENANCE_INVALID",model,mismatched);
const badGroup={...preview,hosts:preview.hosts.map((h,i)=>i===0?
 {...h,locators:[{...h.locators[0],groupPath:"different"}]}:h)};
blocked(choice,"ANSIBLE_ASSOC_PROVENANCE_INVALID",model,badGroup);
const badHost={...preview,hosts:preview.hosts.map((h,i)=>i===0?
 {...h,locators:[{...h.locators[0],hostKey:"other"}]}:h)};
blocked(choice,"ANSIBLE_ASSOC_PROVENANCE_INVALID",model,badHost);
const artificial={...preview,hosts:Array.from({length:81},(_,i)=>({
 inventoryName:"host_"+i,addressTruth:"UNKNOWN",groupPaths:["all"],
 locators:[{kind:"ansible-yaml-host",sourceSha256:preview.sourceSha256,
 groupPath:"all",hostKey:"host_"+i}],
}))};
const late=reviewAnsibleInventoryAssociations(artificial,model,{
 ...choice,associations:[{hostOrdinal:80,resourceId:"rds01"}]});
eq(late.status,"READY_FOR_EXPORT","Existing source ordinal 80 now selectable in P6");
eq(late.sidecar.associations[0].hostOrdinal,80);
blocked({...choice,associations:[{hostOrdinal:81,resourceId:"rds01"}]},
 "ANSIBLE_ASSOC_SELECTION_INVALID",model,artificial);
console.log("PASS ANSIBLE-YAML-P3: "+checks+" provenance, duplicate, stale, consent, redaction and non-Engine assertions.");
