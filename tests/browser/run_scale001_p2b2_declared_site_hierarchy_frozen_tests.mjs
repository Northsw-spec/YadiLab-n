import assert from "node:assert/strict";
import {createHash} from "node:crypto";

// SCALE-001 P2b2A immutable independent source oracle FROZEN before product.
// No site/floor is inferred from IDs, IP addresses or graph coordinates.
const modulePath="../../ui/app/scaled-office-declared-site-hierarchy.mjs";
const {validateDeclaredOfficeSiteHierarchy}=await import(modulePath);
const id=i=>"dev"+String(i).padStart(6,"0");
const pt=i=>"p"+String(i).padStart(6,"0");
const nodes=Array.from({length:1000},(_,i)=>({
  id:id(i),type:i===0?"network.switch":"endpoint.windows",
  label:id(i),interfaces:i===0?Array.from({length:999},(_,j)=>({id:pt(j+1)})):[{id:"eth0"}],
  properties:{}
}));
const links=Array.from({length:999},(_,i)=>({
  id:"office_link_t1_r"+(i+1),kind:"network",
  from:{resource:id(i+1),port:"eth0"},
  to:{resource:id(0),port:pt(i+1)},properties:{}
}));
const source={formatId:"infrastructure-cyber-lab.scenario",schemaVersion:"0.1.0",
  scenarioId:"reviewed_office_scaled",metadata:{title:"Synthetic independent source"},
  zones:[],resources:nodes,connections:links,tests:[],findings:[],objectives:[],
  hints:[],notes:[],completion:{path:"imported_topology_manual_verification"}};
const immutableSource=JSON.stringify(source);
const sha=s=>createHash("sha256").update(s).digest("hex");
const sourceModelHash=sha(immutableSource);
const sourceOriginalSha256="b".repeat(64);
// Trusted host/source-import attestation, not a value supplied by the sidecar.
const expectedProvenance=Object.freeze({sourceModelHash,sourceOriginalSha256});
const base={
 formatId:"office.declared-site-hierarchy.v1",
 schemaVersion:"1.0.0",sourceModelHash,sourceOriginalSha256,
 declaredByUser:true,
 sites:[
  {id:"site_a",label:"Synthetic Campus Alpha",acknowledged:true},
  {id:"site_b",label:"Synthetic Campus Beta",acknowledged:true}
 ],
 buildings:[
  {id:"building_a",siteId:"site_a",label:"Synthetic Building Alpha",acknowledged:true},
  {id:"building_b",siteId:"site_b",label:"Synthetic Building Beta",acknowledged:true}
 ],
 floors:[
  {id:"floor_a",buildingId:"building_a",label:"Synthetic Floor 1 Alpha",acknowledged:true},
  {id:"floor_b",buildingId:"building_b",label:"Synthetic Floor 1 Beta",acknowledged:true}
 ],
 areas:[],
 assignments:Array.from({length:1000},(_,i)=>({
   deviceId:id(i),floorId:i<500?"floor_a":"floor_b",acknowledged:true
 }))
};
const expected=await validateDeclaredOfficeSiteHierarchy(source,base,expectedProvenance);
assert.equal(expected.status,"READY_FOR_PRESENTATION");
assert.equal(expected.physicalTopologyVerified,false);
assert.equal(expected.engineVerified,false);
assert.equal(expected.canActivate,false);
assert.equal(expected.sourceModelHash,sourceModelHash);
assert.equal(expected.memberships.length,1000);
assert.deepEqual(expected.unassignedDeviceIds,[]);
assert.equal(expected.crossSiteOriginalLinks.length,500);
assert.deepEqual(new Set(expected.crossSiteOriginalLinks.map(x=>x.linkId)).size,500);
for(const row of expected.crossSiteOriginalLinks){
 const original=links.find(x=>x.id===row.linkId);
 assert.ok(original,"No synthetic aggregate link can be created");
 assert.equal(row.from.resource,original.from.resource);
 assert.equal(row.from.port,original.from.port);
 assert.equal(row.to.resource,original.to.resource);
 assert.equal(row.to.port,original.to.port);
 assert.equal(row.fromSiteId,"site_b");
 assert.equal(row.toSiteId,"site_a");
}
assert.equal(JSON.stringify(source),immutableSource,"Presentation validation mutated Builder source");
const remove=(item)=>JSON.parse(JSON.stringify(item));
let rejected=0;
async function mustReject(modify,label){
 const changed=remove(base);modify(changed);
 let failed=false;
 try{await validateDeclaredOfficeSiteHierarchy(source,changed,expectedProvenance);}
 catch(error){
   failed=true;
   assert.match(String(error?.code||error?.message),/^SCALE_P2B2_[A-Z0-9_]+$/,label);
 }
 assert.ok(failed,"Failure-open P2b2 hierarchy: "+label);
 assert.equal(JSON.stringify(source),immutableSource,"Bad hierarchy changed Builder");
 rejected++;
}
await mustReject(x=>{x.sourceModelHash="0".repeat(64);},"stale source");
await mustReject(x=>{x.sourceOriginalSha256="a".repeat(64);},"changed original reference");
await mustReject(x=>{x.declaredByUser=false;},"implicit inferred hierarchy");
await mustReject(x=>{x.assignments[0].deviceId="missing_resource";},"unknown original device");
await mustReject(x=>{x.assignments[1].deviceId=x.assignments[0].deviceId;},"duplicate device ownership");
await mustReject(x=>{x.floors[0].buildingId="missing_building";},"missing building");
await mustReject(x=>{x.buildings[0].siteId="missing_site";},"missing site");
await mustReject(x=>{x.sites[0].label="";},"blank site");
await mustReject(x=>{x.assignments[0].acknowledged=false;},"unapproved membership");
await mustReject(x=>{x.sites[0].acknowledged=false;},"unapproved site");
await mustReject(x=>{x.assignments[0].rawPrivateOfficeCell="DO_NOT_EXPORT";},"unselected private column");
await mustReject(x=>{x.buildings[0].foreignFacilityName="UNKNOWN";},"inferred third-party metadata");
const unassigned=remove(base);
unassigned.assignments=unassigned.assignments.filter(x=>x.deviceId!==id(900));
const without=await validateDeclaredOfficeSiteHierarchy(source,unassigned,expectedProvenance);
assert.deepEqual(without.unassignedDeviceIds,[id(900)]);
assert.equal(without.memberships.length,999);
assert.equal(JSON.stringify(source),immutableSource);
console.log("PASS SCALE-001 P2b2A frozen independently authored user-declared site hierarchy source/original-link truth: 1000 original device IDs, 500 exact cross-site port pairs, "+rejected+" fail-closed denials and an explicit unassigned device.");
