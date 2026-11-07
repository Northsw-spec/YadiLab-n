import assert from "node:assert/strict";
import fs from "node:fs";
import { previewNmapXmlObservations } from "../../dist-enterprise-import-test/enterprise-import/src/nmap-xml-preview.js";
import { reviewNmapObservationAssociations } from "../../dist-enterprise-import-test/enterprise-import/src/nmap-association-review.js";

const buf = Uint8Array.from(fs.readFileSync("tests/fixtures/import/nmap-xml/valid-observed-hosts.xml"));
const scan = await previewNmapXmlObservations(buf);
const modeled = { scenarioId: "existing_site", sourceRevision: 4,
  resources: [{id:"router_1",label:"Router 1"},{id:"server_1",label:"Server 1"}] };
const decision = { sourceSha256:scan.sourceSha256,scenarioId:modeled.scenarioId,
  sourceRevision:modeled.sourceRevision,associations:[{hostOrdinal:0,resourceId:"server_1"}],
  acknowledgeNotVerified:true };
let cases = 0;
const eq=(a,b,msg)=>{ assert.deepEqual(a,b,msg); cases++; };
const blocked=(d,code,model=modeled,preview=scan)=>{
  const r=reviewNmapObservationAssociations(preview,model,d);
  eq(r.status,"BLOCKED",code);
  eq(r.diagnostics[0].code,code);
  eq(Object.hasOwn(r,"sidecar"),false,"BLOCKED must never output a sidecar");
};

const reviewed=reviewNmapObservationAssociations(scan,modeled,decision);
eq(reviewed.status,"READY_FOR_EXPORT");
eq(reviewed.diagnostics,[]);
eq(reviewed.sidecar.formatId,"yadilab.nmap-observation-associations");
eq(reviewed.sidecar.status,"REVIEWED_ASSOCIATIONS_ONLY");
eq(reviewed.sidecar.engineVerified,false);
eq(reviewed.sidecar.physicalTopologyVerified,false);
eq(reviewed.sidecar.source.sha256,scan.sourceSha256);
eq(reviewed.sidecar.source.scanStart,scan.scanStart);
eq(reviewed.sidecar.targetModel,{scenarioId:"existing_site",sourceRevision:4});
eq(reviewed.sidecar.associations.length,1);
eq(reviewed.sidecar.associations[0].targetResourceId,"server_1");
eq(reviewed.sidecar.associations[0].observedIpv4,"192.0.2.10");
eq(reviewed.sidecar.associations[0].observedStatus,"up");
eq(reviewed.sidecar.associations[0].observedPortCount,2);
eq(reviewed.sidecar.associations[0].hostLocator.kind,"nmap-host");
eq(reviewed.sidecar.associations[0].hostLocator.sourceSha256,scan.sourceSha256);
eq(reviewed.sidecar.associations[0].assertion,"USER_ASSERTED_ASSOCIATION_NOT_VERIFIED");
eq(Object.hasOwn(reviewed.sidecar,"scenario"),false);
eq(Object.hasOwn(reviewed.sidecar,"engineState"),false);
eq(Object.hasOwn(reviewed.sidecar,"links"),false);
eq(Object.hasOwn(reviewed.sidecar,"resources"),false);
eq(Object.hasOwn(reviewed.sidecar,"connections"),false);
eq(JSON.stringify(reviewed),JSON.stringify(reviewNmapObservationAssociations(scan,modeled,decision)),"Same inputs deterministic");
const originalJSON=JSON.stringify(scan);
const modelJSON=JSON.stringify(modeled);
eq(JSON.stringify(scan),originalJSON,"Parser observation not modified");
eq(JSON.stringify(modeled),modelJSON,"Current model snapshot not modified");

const reversed=reviewNmapObservationAssociations(scan,modeled,{
  ...decision,associations:[{hostOrdinal:1,resourceId:"router_1"},{hostOrdinal:0,resourceId:"server_1"}]});
eq(reversed.status,"READY_FOR_EXPORT");
eq(reversed.sidecar.associations.map(x=>x.hostLocator.hostOrdinal),[0,1],"Canonical host ordering");
eq(reversed.sidecar.associations.map(x=>x.targetResourceId),["server_1","router_1"]);
const sameHost=reviewNmapObservationAssociations(scan,modeled,{...decision,associations:[
 {hostOrdinal:0,resourceId:"server_1"}, {hostOrdinal:0,resourceId:"router_1"}]});
eq(sameHost.status,"BLOCKED");
eq(sameHost.diagnostics[0].code,"NMAP_ASSOC_SELECTION_INVALID");

blocked({...decision,sourceSha256:"a".repeat(64)},"NMAP_ASSOC_STALE");
blocked({...decision,scenarioId:"other_site"},"NMAP_ASSOC_STALE");
blocked({...decision,sourceRevision:3},"NMAP_ASSOC_STALE");
blocked({...decision,acknowledgeNotVerified:false},"NMAP_ASSOC_ACK_REQUIRED");
blocked({...decision,associations:[]},"NMAP_ASSOC_SELECTION_INVALID");
blocked({...decision,associations:[{hostOrdinal:99,resourceId:"server_1"}]},"NMAP_ASSOC_SELECTION_INVALID");
blocked({...decision,associations:[{hostOrdinal:-1,resourceId:"server_1"}]},"NMAP_ASSOC_SELECTION_INVALID");
blocked({...decision,associations:[{hostOrdinal:0,resourceId:"unknown"}]},"NMAP_ASSOC_SELECTION_INVALID");
blocked({...decision,associations:[{hostOrdinal:0,resourceId:"server_1"}, {hostOrdinal:1,resourceId:"server_1"}]},"NMAP_ASSOC_SELECTION_INVALID");
blocked(decision,"NMAP_ASSOC_BUILDER_REQUIRED",null);
blocked(decision,"NMAP_ASSOC_MODEL_INVALID",{...modeled,resources:[{id:"duplicated",label:"a"},{id:"duplicated",label:"b"}]});
blocked(decision,"NMAP_ASSOC_BUILDER_REQUIRED",{...modeled,sourceRevision:-1});
blocked(decision,"NMAP_ASSOC_STALE",{...modeled,sourceRevision:5});
const altered={...scan,hosts:scan.hosts.map((h,i)=>i===0?{...h,locator:{...h.locator,sourceSha256:"a".repeat(64)}}:h)};
blocked(decision,"NMAP_ASSOC_PROVENANCE_INVALID",modeled,altered);
const invalid={...scan,canActivate:true};
blocked(decision,"NMAP_ASSOC_SOURCE_INVALID",modeled,invalid);
console.log("PASS NMAP-XML-P3: "+cases+" strict provenance, consent, conflict, stale identity and observation/Engine separation assertions.");
