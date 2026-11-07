import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { previewAnsibleStaticInventory } from "../../dist-browser-test/enterprise-import/src/ansible-yaml-preview.js";
import { reviewAnsibleInventoryAssociations } from "../../dist-browser-test/enterprise-import/src/ansible-association-review.js";
import { replayAnsibleYamlSavedReferences } from "../../dist-browser-test/enterprise-import/src/ansible-yaml-report-replay.js";
import { AnsibleAssociationReview } from "../../ui/app/ansible-association-review.mjs";

const encoder=new TextEncoder();
const source=n=>encoder.encode("all:\n  hosts:\n"+
 Array.from({length:n},(_,i)=>`    node${String(i).padStart(3,"0")}: null`).join("\n")+"\n");
let checks=0;
function eq(a,b,label){assert.deepEqual(a,b,label);checks++;}
const builder={scenarioId:"enterprise_site",sourceRevision:7,
 resources:Array.from({length:85},(_,i)=>({id:`resource_${i}`,label:`Resource ${i}`}))};
const originalBuilder=JSON.stringify(builder);
const small=await previewAnsibleStaticInventory(source(3));
const smallReview=reviewAnsibleInventoryAssociations(small,builder,{
 sourceSha256:small.sourceSha256,scenarioId:builder.scenarioId,sourceRevision:7,
 acknowledgeNotVerified:true,associations:[{hostOrdinal:0,resourceId:"resource_0"}]});
eq(smallReview.status,"READY_FOR_EXPORT","Small original P3 source review unchanged");
eq(smallReview.sidecar.schemaVersion,"1.0.0","P3 version unchanged");
const smallHtml=renderToStaticMarkup(React.createElement(AnsibleAssociationReview,{
 result:{filename:"small.yml",preview:small},model:builder,onExport(){},
}));
eq((smallHtml.match(/data-ansible-associate-host=/g)||[]).length,3,"Small source all visible");
eq(smallHtml.includes('data-ansible-page-next="true"'),true,"Next button exists");
eq(smallHtml.includes('data-ansible-association-range="0:2"'),true,"Small range");
eq(smallHtml.includes('data-ansible-associate-host="3"'),false,"No fake host");
eq(smallHtml.includes('data-ansible-page-previous="true" disabled=""'),true);
eq(smallHtml.includes('data-ansible-page-next="true" disabled=""'),true);
for(const count of [81,161,500]){
 const raw=source(count);
 const parsed=await previewAnsibleStaticInventory(raw);
 eq(parsed.hosts.length,count,"Original parser accepts "+count);
 const last=count-1, name=`node${String(last).padStart(3,"0")}`;
 eq(parsed.hosts[last].inventoryName,name,"Late inventory host key");
 const choices=[{hostOrdinal:0,resourceId:"resource_0"},{hostOrdinal:last,resourceId:"resource_1"}];
 const reviewed=reviewAnsibleInventoryAssociations(parsed,builder,{
   sourceSha256:parsed.sourceSha256,scenarioId:builder.scenarioId,sourceRevision:7,
   acknowledgeNotVerified:true,associations:choices,
 });
 eq(reviewed.status,"READY_FOR_EXPORT","Late original host now selectable");
 eq(reviewed.sidecar.associations.map(a=>a.hostOrdinal),[0,last],"Absolute ordinals sorted");
 eq(reviewed.sidecar.associations[1].inventoryName,name);
 eq(reviewed.sidecar.associations[1].groupPaths,["all"]);
 eq(reviewed.sidecar.associations[1].hostLocators.map(a=>a.groupPath),["all"]);
 eq(reviewed.sidecar.engineVerified,false);eq(reviewed.sidecar.physicalTopologyVerified,false);
 const match=await replayAnsibleYamlSavedReferences(raw,encoder.encode(JSON.stringify(reviewed.sidecar)),builder,true);
 eq(match.status,"REFERENCE_REPLAY_MATCH","P5 reconstructs late ordinal sidecar");
 eq(match.referencesChecked,2);
 const html=renderToStaticMarkup(React.createElement(AnsibleAssociationReview,{
   result:{filename:"source.yml",preview:parsed},model:builder,onExport(){},
 }));
 eq((html.match(/data-ansible-associate-host=/g)||[]).length,80,"At most 80 selectors in DOM");
 eq(html.includes('data-ansible-associate-host="80"'),false,"Other pages not in DOM");
 eq(html.includes('data-ansible-association-range="0:79"'),true);
 eq(html.includes('data-ansible-page-next="true" disabled=""'),false,"Next page enabled");
 const bad=reviewAnsibleInventoryAssociations(parsed,builder,{
   sourceSha256:parsed.sourceSha256,scenarioId:builder.scenarioId,sourceRevision:7,
   acknowledgeNotVerified:true,associations:[{hostOrdinal:count,resourceId:"resource_0"}],
 });
 eq(bad.status,"BLOCKED","Out-of-range source rejected");
 eq(bad.diagnostics[0].code,"ANSIBLE_ASSOC_SELECTION_INVALID");
 const dup=reviewAnsibleInventoryAssociations(parsed,builder,{
   sourceSha256:parsed.sourceSha256,scenarioId:builder.scenarioId,sourceRevision:7,
   acknowledgeNotVerified:true,associations:[{hostOrdinal:0,resourceId:"resource_0"},
     {hostOrdinal:last,resourceId:"resource_0"}],
 });
 eq(dup.status,"BLOCKED","Duplicate target across hidden pages");
 const forged=encoder.encode(JSON.stringify({...reviewed.sidecar,
   associations:[reviewed.sidecar.associations[0],{
     ...reviewed.sidecar.associations[1],groupPaths:["all/forged"]}]}));
 await assert.rejects(replayAnsibleYamlSavedReferences(raw,forged,builder,true),
   e=>e?.code==="ANSIBLE_YAML_REPLAY_REPORT_MISMATCH");checks++;
}
const parsed=await previewAnsibleStaticInventory(source(500));
const choices=Array.from({length:80},(_,i)=>({hostOrdinal:i*6,resourceId:`resource_${i}`}));
const decision={sourceSha256:parsed.sourceSha256,scenarioId:builder.scenarioId,
 sourceRevision:7,acknowledgeNotVerified:true,associations:choices};
const eighty=reviewAnsibleInventoryAssociations(parsed,builder,decision);
eq(eighty.status,"READY_FOR_EXPORT","80 valid late-ordinal choices");
eq(eighty.sidecar.associations.length,80);
eq(eighty.sidecar.associations.at(-1).hostOrdinal,474);
const eightyOne=reviewAnsibleInventoryAssociations(parsed,builder,{
 ...decision,associations:[...choices,{hostOrdinal:499,resourceId:"resource_80"}]});
eq(eightyOne.status,"BLOCKED","81 choices rejected");
eq(eightyOne.diagnostics[0].code,"ANSIBLE_ASSOC_SELECTION_INVALID");
eq(JSON.stringify(builder),originalBuilder,"Builder unchanged");
await assert.rejects(previewAnsibleStaticInventory(source(501)),
 e=>e?.code==="ANSIBLE_YAML_HOST_BUDGET");checks++;
const ui=fs.readFileSync("ui/app/ansible-association-review.mjs","utf8");
for(const marker of ["visibleHosts.map((host, index)","firstOrdinal + index",
 "MAX_ASSOCIATIONS = 80","setAcknowledged(false)","data-ansible-page-previous",
 "data-ansible-page-next","data-ansible-association-cap","selectedCount >= MAX_ASSOCIATIONS"]){
 eq(ui.includes(marker),true,"UI contract "+marker);
}
for(const forbidden of ["setWorkspace(","fetch(","localStorage","indexedDB","dangerouslySetInnerHTML"]){
 eq(ui.includes(forbidden),false,"No mutating or network review path");
}
console.log("PASS ANSIBLE YAML P6 "+checks+" strict 3/81/161/500 host pagination, late ordinals, P5 replay, 80 cap, no mutation");
