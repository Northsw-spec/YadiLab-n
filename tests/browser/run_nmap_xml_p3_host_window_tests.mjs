import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import { previewNmapXmlObservations } from "../../dist-browser-test/enterprise-import/src/nmap-xml-preview.js";
import { reviewNmapObservationAssociations } from "../../dist-browser-test/enterprise-import/src/nmap-association-review.js";
import { NmapObservationDetails } from "../../ui/app/nmap-observation-panel.mjs";
import { NmapAssociationReview } from "../../ui/app/nmap-association-review.mjs";

const raw=n=>new TextEncoder().encode(
  '<?xml version="1.0"?><nmaprun scanner="nmap" version="7.94">'+
  Array.from({length:n},(_,i)=>
    '<host><status state="up"/><address addrtype="ipv4" addr="'+ip(i)+'"/>'+
    '<hostnames><hostname name="node'+i+'.example.test" type="user"/></hostnames>'+
    (i===160?'<ports><port protocol="tcp" portid="443"><state state="open"/>'+
      '<service name="https" method="probed" conf="7"/></port></ports>':'')+
    '</host>').join('')+'</nmaprun>');
const ip=i=>`10.${Math.floor(i/256)}.${i%256}.10`;
const model={scenarioId:"site_existing",sourceRevision:12,resources:[
  {id:"rds01",label:"RDS server"},{id:"fw01",label:"Firewall"},{id:"sw01",label:"Switch"}]};
const modelBefore=JSON.stringify(model);
let checks=0;
function eq(a,b,label){assert.deepEqual(a,b,label);checks++;}
for(const n of [2,81,161,1000]){
 const scan=await previewNmapXmlObservations(raw(n));
 eq(scan.hosts.length,n,"Original XML parser validates all source positions");
 eq(scan.canActivate,false,"P1 source remains observational");
 eq(scan.semanticTrack,"EVIDENCE_OBSERVED");
 const last=n-1;
 eq(scan.hosts[last].locator.hostOrdinal,last,"Original absolute locator");
 eq(scan.hosts[last].ipv4,ip(last),"Original source IP preserved");
 const decisions=[{hostOrdinal:0,resourceId:"rds01"},{hostOrdinal:last,resourceId:"fw01"}];
 const reviewed=reviewNmapObservationAssociations(scan,model,{
   sourceSha256:scan.sourceSha256,scenarioId:model.scenarioId,
   sourceRevision:12,acknowledgeNotVerified:true,associations:decisions});
 eq(reviewed.status,"READY_FOR_EXPORT","All original host ordinals supported by existing P2 reviewer");
 eq(reviewed.sidecar.schemaVersion,"1.0.0","Existing sidecar unchanged");
 eq(reviewed.sidecar.formatId,"yadilab.nmap-observation-associations");
 eq(reviewed.sidecar.associations.map(x=>x.hostLocator.hostOrdinal),[0,last]);
 eq(reviewed.sidecar.associations[1].observedIpv4,ip(last));
 eq(reviewed.sidecar.engineVerified,false);
 eq(reviewed.sidecar.physicalTopologyVerified,false);
 const details=renderToStaticMarkup(React.createElement(NmapObservationDetails,{
   result:{filename:"source.xml",preview:scan}}));
 const review=renderToStaticMarkup(React.createElement(NmapAssociationReview,{
   result:{filename:"source.xml",preview:scan},model,onExport(){}}));
 eq((details.match(/data-nmap-host=/g)||[]).length,Math.min(n,80),"Observation DOM bounded to page 1");
 eq((review.match(/data-nmap-associate-host=/g)||[]).length,Math.min(n,80),"Association DOM bounded to page 1");
 eq(details.includes('data-nmap-observation-range="0:'+String(Math.min(n,80)-1)+'"'),true);
 eq(review.includes('data-nmap-association-range="0:'+String(Math.min(n,80)-1)+'"'),true);
 eq(details.includes('data-nmap-host="80"'),false,"Next observation off-page");
 eq(review.includes('data-nmap-associate-host="80"'),false,"Next mapping off-page");
 eq(details.includes('data-nmap-observation-next="true"'),true);
 eq(review.includes('data-nmap-association-next="true"'),true);
 eq(details.includes('data-nmap-observation-next="true" disabled=""'),n<=80);
 eq(review.includes('data-nmap-association-next="true" disabled=""'),n<=80);
 eq(details.includes(ip(last)),last<80,"Off-page IP address absent");
 eq(review.includes(ip(last)),last<80,"Off-page association IP address absent");
 const bad=reviewNmapObservationAssociations(scan,model,{
   sourceSha256:scan.sourceSha256,scenarioId:model.scenarioId,
   sourceRevision:12,acknowledgeNotVerified:true,
   associations:[{hostOrdinal:n,resourceId:"rds01"}]});
 eq(bad.status,"BLOCKED","Invalid original source index denied");
 eq(bad.diagnostics[0].code,"NMAP_ASSOC_SELECTION_INVALID");
 const dup=reviewNmapObservationAssociations(scan,model,{
   sourceSha256:scan.sourceSha256,scenarioId:model.scenarioId,
   sourceRevision:12,acknowledgeNotVerified:true,
   associations:[{hostOrdinal:0,resourceId:"rds01"},{hostOrdinal:last,resourceId:"rds01"}]});
 eq(dup.status,"BLOCKED","Global target duplicate refused");
 eq(dup.diagnostics[0].code,"NMAP_ASSOC_SELECTION_INVALID");
}
const largest=await previewNmapXmlObservations(raw(1000));
eq(largest.hosts[999].locator.hostOrdinal,999);
const wouldBeBlocked=await assert.rejects(previewNmapXmlObservations(raw(1001)),
 e=>e?.code==="NMAP_XML_HOST_BUDGET");checks++;
eq(JSON.stringify(model),modelBefore,"No Builder changes");
const p=fs.readFileSync("ui/app/nmap-observation-panel.mjs","utf8");
const a=fs.readFileSync("ui/app/nmap-association-review.mjs","utf8");
for(const x of ["MAX_DISPLAY_HOSTS = 80","visibleHosts.map((host, i)","firstOrdinal + i",
  "data-nmap-observation-previous","data-nmap-observation-next","key: request.current",
  "${request.current}:${result.preview.sourceSha256}"]){
 eq(p.includes(x),true,"Observation page source contract "+x);
}
for(const x of ["PAGE_SIZE = 80","visibleHosts.map((host, index)","firstOrdinal + index",
 "data-nmap-association-previous","data-nmap-association-next","setAcknowledged(false)"]){
 eq(a.includes(x),true,"Reviewer source contract "+x);
}
for(const x of ["setWorkspace(","dangerouslySetInnerHTML","fetch(","localStorage","indexedDB"]){
 eq(p.includes(x)||a.includes(x),false,"Read-only no I/O or Engine mutation");
}
console.log("PASS NMAP XML P3 "+checks+" generated 2/81/161/1000 source hosts, original locators, bounded SSR, review and no mutation");
