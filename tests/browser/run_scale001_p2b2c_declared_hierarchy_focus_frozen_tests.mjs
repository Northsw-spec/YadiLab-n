import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {build} from "esbuild";
import {validateDeclaredOfficeSiteHierarchy} from "../../ui/app/scaled-office-declared-site-hierarchy.mjs";

// P2b2C independent frozen SOURCE oracle. This is not real Chromium acceptance.
// Build only the actual production layout/module dependency graph into an
// isolated temporary Node ESM file. The TypeScript source imports resolve at
// bundle-time exactly like the real browser release; NOTHING is mocked.
const dir=mkdtempSync(join(tmpdir(),"yadilab-p2b2c-source-test-"));
process.on("exit",()=>rmSync(dir,{recursive:true,force:true}));
const bundled=join(dir,"hierarchy-focus.mjs");
await build({
  entryPoints:["ui/app/scaled-office-declared-hierarchy-focus.mjs"],
  outfile:bundled,bundle:true,format:"esm",platform:"node",
  target:["node22"],logLevel:"silent"
});
const {selectDeclaredOfficeHierarchySlice,buildDeclaredOfficeHierarchyFocus}=
  await import(pathToFileURL(bundled).href);
const id=i=>"dev"+String(i).padStart(6,"0");
const port=i=>"p"+String(i).padStart(6,"0");
const source={
  formatId:"infrastructure-cyber-lab.scenario",schemaVersion:"0.1.0",
  scenarioId:"p2b2c_independent_fixture",
  metadata:{title:"Independently authored synthetic source"},
  // Real canvas projection requires a normalized trusted asset lock and
  // normalized interface.addresses arrays. This adds no node, edge, or port.
  assetLocks:[{id:"fixture_icon",version:"1.0.0",
    path:"assets/builtin/endpoint.linux.svg",mime:"image/svg+xml",
    width:64,height:64,trusted:true}],
  zones:[],resources:Array.from({length:1000},(_,i)=>({
    id:id(i),label:id(i),
    type:i===0?"network.switch":"endpoint.windows",
    asset:{id:"fixture_icon",version:"1.0.0"},
    interfaces:i===0?Array.from({length:999},(_,j)=>({
      id:port(j+1),label:port(j+1),addresses:[]
    })):[{id:"eth0",label:"eth0",addresses:[]}],
    properties:{}
  })),
  connections:Array.from({length:999},(_,j)=>{
    const i=j+1;
    return {id:"office_link_t1_r"+i,kind:"network",
      from:{resource:id(i),port:"eth0"},to:{resource:id(0),port:port(i)},
      properties:{}};
  }),tests:[],findings:[],objectives:[],hints:[],notes:[],
  completion:{path:"imported_topology_manual_verification"}
};
const sourceString=JSON.stringify(source);
const hash=createHash("sha256").update(sourceString).digest("hex");
const declaration={
  formatId:"office.declared-site-hierarchy.v1",schemaVersion:"1.0.0",
  sourceModelHash:hash,sourceOriginalSha256:"b".repeat(64),declaredByUser:true,
  sites:[{id:"site_a",label:"Manually defined A",acknowledged:true},
    {id:"site_b",label:"Manually defined B",acknowledged:true}],
  buildings:[{id:"build_a",siteId:"site_a",label:"Building A",acknowledged:true},
    {id:"build_b",siteId:"site_b",label:"Building B",acknowledged:true}],
  floors:[{id:"floor_a",buildingId:"build_a",label:"Floor A",acknowledged:true},
    {id:"floor_b",buildingId:"build_b",label:"Floor B",acknowledged:true}],
  areas:[],
  assignments:Array.from({length:1000},(_,i)=>({
    deviceId:id(i),floorId:i<500?"floor_a":"floor_b",acknowledged:true
  }))
};
const verified=await validateDeclaredOfficeSiteHierarchy(source,declaration,{
  sourceModelHash:hash,sourceOriginalSha256:"b".repeat(64)
});
assert.equal(verified.crossSiteOriginalLinks.length,500);
// The caller supplies the independently attested canonical-source SHA;
// the validator (and real app host) separately hashes the full source bytes.
const select=(...args)=>selectDeclaredOfficeHierarchySlice(...args,{trustedSourceModelHash:hash});
const copy=JSON.parse(JSON.stringify(source));

const a1=select(source,verified,"site","site_a",1);
assert.equal(a1.canonicalNodes,1000);
assert.equal(a1.canonicalLinks,999);
assert.equal(a1.membersInScope,500);
assert.equal(a1.page,1);
assert.equal(a1.pageCount,5);
assert.equal(a1.viewNodeIds.length,100);
assert.deepEqual(a1.viewNodeIds,Array.from({length:100},(_,i)=>id(i)));
assert.deepEqual(a1.viewEdgeIds,Array.from({length:99},(_,i)=>"office_link_t1_r"+(i+1)));
assert.equal(a1.hiddenOriginalLinks,900);
assert.equal(a1.physicalTopologyVerified,false);
assert.equal(a1.engineVerified,false);
assert.equal(a1.canActivate,false);
for (let i=1;i<100;i++){
  const edge=a1.viewLinks.find(x=>x.id==="office_link_t1_r"+i);
  assert.ok(edge,"Original endpoint identity lost");
  assert.deepEqual(edge.from,{resource:id(i),port:"eth0"});
  assert.deepEqual(edge.to,{resource:id(0),port:port(i)});
}
const a2=select(source,verified,"site","site_a",2);
assert.equal(a2.viewNodeIds.length,100);
assert.equal(a2.viewEdgeIds.length,0,
  "No external hub or phantom cable allowed in source-filtered focus");
assert.equal(a2.hiddenOriginalLinks,999);
const b1=select(source,verified,"site","site_b",1);
assert.deepEqual(b1.viewNodeIds,Array.from({length:100},(_,i)=>id(i+500)));
assert.equal(b1.viewEdgeIds.length,0);
const building=select(source,verified,"building","build_a",1);
assert.deepEqual(building.viewNodeIds,a1.viewNodeIds);
assert.deepEqual(building.viewEdgeIds,a1.viewEdgeIds);
const floor=select(source,verified,"floor","floor_a",1);
assert.deepEqual(floor.viewNodeIds,a1.viewNodeIds);
const cross=verified.crossSiteOriginalLinks;
assert.equal(cross.length,500);
assert.equal(cross[0].linkId,"office_link_t1_r500");
assert.deepEqual(cross[0].from,{resource:id(500),port:"eth0"});
assert.deepEqual(cross[0].to,{resource:id(0),port:port(500)});
assert.equal(new Set(cross.map(x=>x.linkId)).size,500);
assert.equal(JSON.stringify(source),sourceString,"Read-only slice mutated canonical source");

// A tiny 3-node independently approved synthetic selection also exercises
// the REAL ELK auto-layout/ReactFlow projection, not just source arrays.
const sparse=JSON.parse(JSON.stringify(declaration));
sparse.assignments=[
  {deviceId:id(0),floorId:"floor_a",acknowledged:true},
  {deviceId:id(1),floorId:"floor_a",acknowledged:true},
  {deviceId:id(2),floorId:"floor_a",acknowledged:true},
  {deviceId:id(500),floorId:"floor_b",acknowledged:true}
];
const sparseApproval=await validateDeclaredOfficeSiteHierarchy(source,sparse,{
  sourceModelHash:hash,sourceOriginalSha256:"b".repeat(64)
});
assert.equal(sparseApproval.unassignedDeviceIds.length,996);
assert.equal(sparseApproval.crossSiteOriginalLinks.length,1);
const projected=await buildDeclaredOfficeHierarchyFocus(source,sparseApproval,
  "floor","floor_a",1,{trustedSourceModelHash:hash});
assert.deepEqual(new Set(projected.focusCanvas.nodes.map(x=>x.id)),
  new Set([id(0),id(1),id(2)]));
assert.deepEqual(new Set(projected.focusCanvas.edges.map(x=>x.id)),
  new Set(["office_link_t1_r1","office_link_t1_r2"]));
assert.equal(projected.focusedNodes,3);
assert.equal(projected.focusedEdges,2);
assert.equal(projected.hiddenOriginalLinks,997);
assert.equal(projected.physicalTopologyVerified,false);
const wrongTrusted=()=>selectDeclaredOfficeHierarchySlice(source,verified,
  "site","site_a",1,{trustedSourceModelHash:"0".repeat(64)});
assert.throws(wrongTrusted,e=>/^SCALE_P2B2_/.test(e?.code||""));

assert.equal(JSON.stringify(source),sourceString);

let rejected=0;
const denied=(action,label)=>{
  assert.throws(action,err=>/^SCALE_P2B2_[A-Z0-9_]+$/.test(err?.code||""),
    label);
  assert.equal(JSON.stringify(source),sourceString);
  rejected++;
};
denied(()=>select(source,verified,"site","missing",1),
  "Unknown declared site must fail closed");
denied(()=>select(source,verified,"subnet","site_a",1),
  "No subnet-derived grouping");
denied(()=>select(source,verified,"site","site_a",0),
  "Invalid page");
denied(()=>select(source,verified,"site","site_a",6),
  "Out-of-bounds page");
const stale={...verified,sourceModelHash:"a".repeat(64)};
denied(()=>select(source,stale,"site","site_a",1),
  "Wrong full original source hash");
const spoofed={...verified,memberships:[
  ...verified.memberships,{deviceId:"missing",siteId:"site_a",
    buildingId:"build_a",floorId:"floor_a"}]};
denied(()=>select(source,spoofed,"site","site_a",1),
  "Non-source membership forged");
const forgedLinks={...verified,crossSiteOriginalLinks:[
  ...verified.crossSiteOriginalLinks,
  {linkId:"invented",from:{resource:id(500),port:"eth0"},
    to:{resource:id(0),port:port(500)},fromSiteId:"site_b",toSiteId:"site_a"}]};
denied(()=>select(source,forgedLinks,"site","site_a",1),
  "Synthetic cross-site cable");
const wrongPorts={...verified,crossSiteOriginalLinks:verified.crossSiteOriginalLinks.map(
  (x,i)=>i===0?{...x,to:{...x.to,port:"p000501"}}:x)};
denied(()=>select(source,wrongPorts,"site","site_a",1),
  "Original cross-site port misroute");
assert.deepEqual(source,copy);
console.log("PASS SCALE-001 P2b2C frozen independent 1000/999 site→building→floor selection, exact 500 intersite port links, 100-node bounded pages, 3-node real layout, "+rejected+" fail-closed adversarial cases; actual mounted Chromium is required separately.");
