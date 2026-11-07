import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {previewAnsibleIniStaticInventory} from "../../dist-browser-test/enterprise-import/src/ansible-ini-preview.js";
import {reviewAnsibleIniInventoryAssociations} from "../../dist-browser-test/enterprise-import/src/ansible-ini-association-review.js";
import {replayAnsibleIniSavedReferences} from "../../dist-browser-test/enterprise-import/src/ansible-ini-report-replay.js";
import {AnsibleIniAssociationReview} from "../../ui/app/ansible-ini-association-review.mjs";

const encoder=new TextEncoder();
const source=n=>encoder.encode("[servers]\n"+Array.from({length:n},(_,i)=>`node${String(i).padStart(3,"0")} ansible_host=192.0.2.1`).join("\n")+"\n");
let assertions=0;
function eq(a,b,label){assert.deepEqual(a,b,label);assertions++;}
const builder={scenarioId:"enterprise_site",sourceRevision:7,resources:Array.from({length:85},(_,i)=>({id:`resource_${i}`,label:`Resource ${i}`}))};
const old=JSON.stringify(builder);
const small=await previewAnsibleIniStaticInventory(source(3));
const first=reviewAnsibleIniInventoryAssociations(small,builder,{
 sourceSha256:small.sourceSha256,scenarioId:builder.scenarioId,sourceRevision:7,acknowledgeNotVerified:true,
 associations:[{hostOrdinal:0,resourceId:"resource_0"}]});
eq(first.status,"READY_FOR_EXPORT","Unchanged P3 small source");
eq(first.sidecar.schemaVersion,"1.0.0","Keep P3 schema");
const smallHTML=renderToStaticMarkup(React.createElement(AnsibleIniAssociationReview,{
 result:{filename:"3.ini",preview:small},model:builder,onExportAssociation(){},
}));
eq((smallHTML.match(/data-ansible-ini-associate-host=/g)||[]).length,3,"Small source all visible");
eq(smallHTML.includes('data-ansible-ini-page-next="true"'),true,"Next control always present");
eq(smallHTML.includes('data-ansible-ini-association-range="0:2"'),true,"Small ordinal range");
eq(smallHTML.includes('data-ansible-ini-associate-host="3"'),false,"No out-of-range selector");
eq(smallHTML.includes('data-ansible-ini-page-previous="true" disabled=""'),true,"Previous initially disabled");
eq(smallHTML.includes('data-ansible-ini-page-next="true" disabled=""'),true,"Next disabled for small list");
for(const count of [81,161,500]){
 const raw=source(count);
 const parsed=await previewAnsibleIniStaticInventory(raw);
 eq(parsed.hosts.length,count,"Parser retains full bounded hosts "+count);
 const lastOrdinal=count-1;
 eq(parsed.hosts[lastOrdinal].inventoryName,`node${String(lastOrdinal).padStart(3,"0")}`);
 const pick=[{hostOrdinal:0,resourceId:"resource_0"},{hostOrdinal:lastOrdinal,resourceId:"resource_1"}];
 const saved=reviewAnsibleIniInventoryAssociations(parsed,builder,{
   sourceSha256:parsed.sourceSha256,scenarioId:builder.scenarioId,sourceRevision:7,
   acknowledgeNotVerified:true,associations:pick,
 });
 eq(saved.status,"READY_FOR_EXPORT","Late original ordinal is selectable");
 eq(saved.sidecar.associations.map(a=>a.hostOrdinal),[0,lastOrdinal]);
 eq(saved.sidecar.associations[1].inventoryName,`node${String(lastOrdinal).padStart(3,"0")}`);
 eq(saved.sidecar.associations[1].hostLocators[0].lineNumber,lastOrdinal+2,"Source line exact for late host");
 eq(saved.sidecar.engineVerified,false);eq(saved.sidecar.physicalTopologyVerified,false);
 const match=await replayAnsibleIniSavedReferences(raw,encoder.encode(JSON.stringify(saved.sidecar)),builder,true);
 eq(match.status,"REFERENCE_REPLAY_MATCH","P5 compatible with late source ordinal");
 eq(match.referencesChecked,2);
 const html=renderToStaticMarkup(React.createElement(AnsibleIniAssociationReview,{
   result:{filename:"source.ini",preview:parsed},model:builder,onExportAssociation(){},
 }));
 eq((html.match(/data-ansible-ini-associate-host=/g)||[]).length,80,"Never render >80 selectors");
 eq(html.includes('data-ansible-ini-associate-host="80"'),false,"Higher window not pre-rendered");
 eq(html.includes('data-ansible-ini-association-range="0:79"'),true);
 eq(html.includes('data-ansible-ini-page-next="true" disabled=""'),false,"Next window enabled");
 const rejected=reviewAnsibleIniInventoryAssociations(parsed,builder,{
   sourceSha256:parsed.sourceSha256,scenarioId:builder.scenarioId,sourceRevision:7,
   acknowledgeNotVerified:true,associations:[{hostOrdinal:count,resourceId:"resource_0"}],
 });
 eq(rejected.status,"BLOCKED","Outside parsed source blocked");
 eq(rejected.diagnostics[0].code,"ANSIBLE_INI_ASSOC_SELECTION_INVALID");
 const badDup=reviewAnsibleIniInventoryAssociations(parsed,builder,{
   sourceSha256:parsed.sourceSha256,scenarioId:builder.scenarioId,sourceRevision:7,
   acknowledgeNotVerified:true,associations:[{hostOrdinal:0,resourceId:"resource_0"},
     {hostOrdinal:lastOrdinal,resourceId:"resource_0"}],
 });
 eq(badDup.status,"BLOCKED","Duplicate target across hidden windows blocked");
 const badSource=encoder.encode(JSON.stringify({...saved.sidecar,
   associations:[saved.sidecar.associations[0],
     {...saved.sidecar.associations[1],hostLocators:[{...saved.sidecar.associations[1].hostLocators[0],lineNumber:2}]}]}));
 await assert.rejects(replayAnsibleIniSavedReferences(raw,badSource,builder,true),
    x=>x?.code==="ANSIBLE_INI_REPLAY_REPORT_MISMATCH");assertions++;
}
const parsed=await previewAnsibleIniStaticInventory(source(500));
const choices=Array.from({length:80},(_,i)=>({hostOrdinal:i*6,resourceId:`resource_${i}`}));
const decision={sourceSha256:parsed.sourceSha256,scenarioId:builder.scenarioId,
 sourceRevision:7,acknowledgeNotVerified:true,associations:choices};
const eighty=reviewAnsibleIniInventoryAssociations(parsed,builder,decision);
eq(eighty.status,"READY_FOR_EXPORT","Exactly 80 distinct host mappings allowed");
eq(eighty.sidecar.associations.length,80);
eq(eighty.sidecar.associations.at(-1).hostOrdinal,474,"Late selected ordinal kept");
const eightyOne=reviewAnsibleIniInventoryAssociations(parsed,builder,{
 ...decision,associations:[...choices,{hostOrdinal:499,resourceId:"resource_80"}]});
eq(eightyOne.status,"BLOCKED","81 mappings forbidden");
eq(eightyOne.diagnostics[0].code,"ANSIBLE_INI_ASSOC_SELECTION_INVALID");
eq(JSON.stringify(builder),old,"Builder unchanged");
await assert.rejects(previewAnsibleIniStaticInventory(source(501)),
 x=>x?.code==="ANSIBLE_INI_HOST_BUDGET");assertions++;
const ui=fs.readFileSync("ui/app/ansible-ini-association-review.mjs","utf8");
for(const text of ["visibleHosts.map((host, index)","firstOrdinal+index","MAX_ASSOCIATIONS = 80",
  "setAcknowledged(false)","data-ansible-ini-page-previous","data-ansible-ini-page-next",
  "data-ansible-ini-association-cap","selectedCount>=MAX_ASSOCIATIONS"]){
 eq(ui.includes(text),true,"UI source contract "+text);
}
for(const forbidden of ["setWorkspace(","fetch(","localStorage","indexedDB","dangerouslySetInnerHTML"]){
 eq(ui.includes(forbidden),false,"No mutation or external I/O");
}
console.log("PASS ANSIBLE INI P6 "+assertions+" all 500 ordinals accessible in windows, 80-reference cap, P5 replay, negative source and no mutation");
