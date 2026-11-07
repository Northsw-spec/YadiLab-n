import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createInitialEngineState, queryReachability,
  parseOspfLsaBody, compareOspfLsaHeaders,
  createOspfAreaLsdbSession, inspectOspfAreaLsdbSession,
  advanceOspfAreaLsdb, receiveOspfAreaLsaBatch, readOspfAreaLsdb,
  OSPF_AREA_LSDB_FORMAT, OSPF_AREA_LSDB_VERSION,
  OSPF_AREA_LSDB_MAX_BATCH, OSPF_AREA_LSDB_MAX_ENTRIES,
  OSPF_AREA_MIN_LS_ARRIVAL_MS,
} from "../../dist-engine-test/engine/src/index.js";

const fixture=JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-normalized.json","utf8"));
const router=id=>({id,type:"network.router",label:id,interfaces:[],properties:{},
  asset:{id:"network.router",version:"1.0.0"}});
const scenario={...fixture,scenarioId:"ospfv2-area-lsdb-model",sourceHash:"c".repeat(64),
  resources:[...fixture.resources,router("area-router")]};
const state=createInitialEngineState(scenario);
const truth=queryReachability(scenario,state,"attacker","rds01","tcp",3389);
const rawRouter=Array.from(Buffer.from("006402010a0000020a0000028000000182c8001800000000","hex"));
const rawNetwork=Array.from(Buffer.from(
  "00640202c00002010a0000028000000183fe001cffffff000a000002","hex"));

/** Independent test-only RFC 2328 Fletcher checksum generation. */
function seal(input) {
  const b=[...input],size=b.length;
  b[16]=0;b[17]=0;b[18]=(size>>>8)&255;b[19]=size&255;
  let c0=0,c1=0;
  for(let i=2;i<size;i++){c0=(c0+b[i])%255;c1=(c1+c0)%255;}
  const x=(((size-2)-15)*c0-c1+255*512)%255;
  const y=(510-c0-x)%255;
  b[16]=x;b[17]=y;
  let q0=0,q1=0;
  for(let i=2;i<size;i++){q0=(q0+b[i])%255;q1=(q1+q0)%255;}
  assert.deepEqual([q0,q1],[0,0],"fixture has independent Fletcher zero sums");
  return b;
}
function change(base,changes,reseal=true) {
  const b=[...base];
  for(const [offset,value] of changes)b[offset]=value;
  return reseal?seal(b):b;
}
function sequence(base,suffix) {return change(base,[[12,0x80],[13,0],[14,0],[15,suffix]]);}
function age(base,value){return change(base,[[0,(value>>>8)&255],[1,value&255]],false);}
function idRouter(octet){
  return change(rawRouter,[
    [4,10],[5,0],[6,0],[7,octet],[8,10],[9,0],[10,0],[11,octet],
  ]);
}
function parsed(bytes){const p=parseOspfLsaBody(bytes);assert.equal(p.ok,true);return p.lsa;}
const baseHeader=parsed(rawRouter).header;
const nextRouter=sequence(rawRouter,2),thirdRouter=sequence(rawRouter,3);
const nextHeader=parsed(nextRouter).header;
let checks=0;
function eq(a,b,label){assert.deepEqual(a,b,label);checks++;}
function ok(r,label){eq(r.ok,true,label);return r;}
function bad(r,code){eq(r.ok,false,"rejected "+code);eq(r.code,code,"exact code");}
function has(r,kind){return r.events.filter(x=>x.kind===kind).length;}
function observe(atMs,lsas,source="SYNC_MODEL",areaId="0.0.0.0"){
  return {atMs,lsas,source,areaId};
}
function now(s){return readOspfAreaLsdb(s,state);}
function fresh(area="0.0.0.0",time=0){return createOspfAreaLsdbSession(state,"area-router",area,time);}

eq(OSPF_AREA_LSDB_FORMAT,"yadilab.engine.ospfv2-area-lsdb-model","specific model format");
eq(OSPF_AREA_LSDB_VERSION,"1.0.0","versioned additive LSDB");
eq(OSPF_AREA_LSDB_MAX_BATCH,8,"bounded transaction");
eq(OSPF_AREA_LSDB_MAX_ENTRIES,128,"bounded LSDB");
eq(OSPF_AREA_MIN_LS_ARRIVAL_MS,1000,"RFC 1-second MinLSArrival");
assert.throws(()=>fresh("0.0.0.00"),/OSPF_AREA_LSDB_CONFIG_INVALID/);checks++;
assert.throws(()=>fresh("255.255.255.256"),/OSPF_AREA_LSDB_CONFIG_INVALID/);checks++;
assert.throws(()=>fresh("0.0.0.0",-1),/OSPF_AREA_LSDB_CONFIG_INVALID/);checks++;
assert.throws(()=>createOspfAreaLsdbSession(state,"absent","0.0.0.0"),
  /OSPF_AREA_LSDB_CONFIG_INVALID/);checks++;
const readFresh=now(fresh());
eq(readFresh.entries,[],"empty source-bound area has no invented links");
let s=fresh();
eq(inspectOspfAreaLsdbSession(s,state),null,"fresh exact scenario/area anchor valid");
const a=ok(receiveOspfAreaLsaBatch(s,state,observe(0,[rawNetwork,rawRouter])),
  "install two independent checksum-verified LSA snapshots");
s=a.session;
eq(has(a,"LSA_STAGED_MODEL"),2,"two model-only staging intents");
eq(s.entries.length,2,"two area-local stored records");
eq(s.entries.map(x=>x.header.lsaType),[1,2],"canonical sorted identities");
eq(now(s).entries.map(x=>x.body.kind),
  ["ROUTER_LSA_BODY","NETWORK_LSA_BODY"],"full LSA bodies retained");
eq(now(s).entries[0].header.lsAge,100,"original age 100");
eq(now(s).entries[0].currentAgeSeconds,100,"virtual age at received time");
eq(now(s).entries[0].maxAgeBlocked,false,"active age but no SPF implementation");
eq(s.entries[0].receivedAtMs,0,"install time saved");
eq(s.entries[0].source,"SYNC_MODEL","source provenance explicit");
eq(inspectOspfAreaLsdbSession(s,state),null,"readback rechecks all Fletcher bytes");

const otherArea=fresh("0.0.0.1");
eq(now(otherArea).entries.length,0,"different area starts empty");
bad(receiveOspfAreaLsaBatch(s,state,observe(100,[nextRouter],"SYNC_MODEL","0.0.0.1")),
  "OSPF_AREA_LSDB_OBSERVATION_INVALID");
const otherUpdate=ok(receiveOspfAreaLsaBatch(otherArea,state,
  observe(100,[nextRouter],"SYNC_MODEL","0.0.0.1")),"independent second-area staging");
eq(otherUpdate.session.entries.length,1,"second area independent");
eq(s.entries[0].header.lsSequenceNumber,baseHeader.lsSequenceNumber,
  "first area did not inherit second-area instance");
eq(now(s).entries.length,2,"first area remains two entries");

const snapshot=JSON.stringify(s);
bad(receiveOspfAreaLsaBatch(s,state,observe(-1,[nextRouter])),
  "OSPF_AREA_LSDB_OBSERVATION_INVALID");
bad(receiveOspfAreaLsaBatch(s,state,observe(1,[])),
  "OSPF_AREA_LSDB_BATCH_INVALID");
bad(receiveOspfAreaLsaBatch(s,state,observe(1,
  Array.from({length:9},()=>nextRouter))),"OSPF_AREA_LSDB_BATCH_INVALID");
bad(receiveOspfAreaLsaBatch(s,state,observe(1,[nextRouter,nextRouter])),
  "OSPF_AREA_LSDB_DUPLICATE_BATCH_IDENTITY");
const damaged=[...nextRouter];damaged[20]^=1;
bad(receiveOspfAreaLsaBatch(s,state,observe(1,[nextRouter,damaged])),
  "OSPF_LSA_FLETCHER_INVALID");
const malformed=change(rawRouter,[[20,0x87]]);
bad(receiveOspfAreaLsaBatch(s,state,observe(1,[nextRouter,malformed])),
  "OSPF_ROUTER_LSA_FLAGS_RESERVED");
bad(receiveOspfAreaLsaBatch(s,state,observe(1,[age(idRouter(7),3600)])),
  "OSPF_AREA_LSDB_MAXAGE_ORPHAN_UNMODELED");
bad(advanceOspfAreaLsdb(s,state,-1),"OSPF_AREA_LSDB_TIME_INVALID");
eq(JSON.stringify(s),snapshot,"all failed batches/time advances are fully atomic");

const sameAge=ok(receiveOspfAreaLsaBatch(s,state,observe(250,[rawRouter])),
  "same checksum and sequence produces equivalent ignore");
s=sameAge.session;
eq(has(sameAge,"LSA_EQUIVALENT_IGNORED"),1,"equivalent feedback");
eq(s.entries[0].receivedAtMs,0,"duplicate does not refresh age");
const older=ok(receiveOspfAreaLsaBatch(s,state,
  observe(500,[age(rawRouter,1100)])),"older age by exactly >900");
s=older.session;
eq(has(older,"LSA_OLDER_IGNORED"),1,"older age ignored");
const replaced=ok(receiveOspfAreaLsaBatch(s,state,observe(1000,[nextRouter])),
  "newer LS sequence replaces old snapshot");
s=replaced.session;
eq(has(replaced,"LSA_REPLACED_MODEL"),1,"replacement trace");
eq(s.entries[0].header.lsSequenceNumber,nextHeader.lsSequenceNumber,
  "signed LS sequence recency");
eq(s.entries[0].receivedAtMs,1000,"newer version installation timestamp");
const stale=ok(receiveOspfAreaLsaBatch(s,state,observe(1500,[rawRouter])),
  "old signed sequence never overwrites new");
s=stale.session;
eq(has(stale,"LSA_OLDER_IGNORED"),1,"stale LSA excluded");
const olderAge=age(nextRouter,3599);
const olderByAge=ok(receiveOspfAreaLsaBatch(s,state,observe(1600,[olderAge])),
  "same seq/checksum but >900s age difference");
s=olderByAge.session;
eq(has(olderByAge,"LSA_OLDER_IGNORED"),1,"older age correctly compared");
const collision=change(nextRouter,[[20,0x01]]);
const comparison=compareOspfLsaHeaders(parsed(nextRouter).header,parsed(collision).header);
eq([-1,1].includes(comparison),true,"body change affects checksum rank");
const high=comparison===1?collision:nextRouter;
const low=comparison===1?nextRouter:collision;
const checker=ok(receiveOspfAreaLsaBatch(fresh(),state,observe(0,[low])),
  "initial signed sequence and Fletcher ranked instance");
const highInstall=ok(receiveOspfAreaLsaBatch(checker.session,state,observe(1000,[high])),
  "higher unsigned Fletcher checksum wins equal LS sequence");
eq(highInstall.session.entries[0].header.lsChecksum,parsed(high).header.lsChecksum,
  "checksum recency precedence RFC 13.1");

// MinLSArrival applies only when existing copy was installed from flooding,
// and it is checked even for an incoming synthetic sync source.
let f=ok(receiveOspfAreaLsaBatch(fresh(),state,
  observe(0,[rawRouter],"FLOODING_MODEL")),"first flooded LSA").session;
const early=ok(receiveOspfAreaLsaBatch(f,state,
  observe(999,[nextRouter],"FLOODING_MODEL")),"sub-second newer flood");
eq(has(early,"LSA_MIN_LS_ARRIVAL_DISCARDED"),1,
  "MinLSArrival rejects new instance before 1000ms");
eq(early.session.entries[0].header.lsSequenceNumber,baseHeader.lsSequenceNumber,
  "early flood cannot replace existing bytes");
f=early.session;
const exactly=ok(receiveOspfAreaLsaBatch(f,state,
  observe(1000,[nextRouter],"FLOODING_MODEL")),"exact MinLSArrival boundary");
eq(exactly.session.entries[0].header.lsSequenceNumber,nextHeader.lsSequenceNumber,
  "1000ms is allowed");
f=exactly.session;
const earlySync=ok(receiveOspfAreaLsaBatch(f,state,
  observe(1500,[thirdRouter],"SYNC_MODEL")),"sync receipt before flooded copy cools");
eq(has(earlySync,"LSA_MIN_LS_ARRIVAL_DISCARDED"),1,
  "source of existing DB copy controls MinLSArrival");
f=earlySync.session;
const postWindow=ok(receiveOspfAreaLsaBatch(f,state,
  observe(2000,[thirdRouter],"SYNC_MODEL")),"post-MinLSArrival request receipt");
f=postWindow.session;
eq(f.entries[0].header.lsSequenceNumber,parsed(thirdRouter).header.lsSequenceNumber,
  "after 1000ms newer request receipt admitted");
eq(f.entries[0].source,"SYNC_MODEL","updated receipt provenance");
const immediateAfterSync=ok(receiveOspfAreaLsaBatch(f,state,
  observe(2001,[sequence(rawRouter,4)],"FLOODING_MODEL")),
  "snapshot-sourced copy does not fabricate flood MinLSArrival guard");
eq(has(immediateAfterSync,"LSA_REPLACED_MODEL"),1,
  "MinLSArrival not applied to previous SYNC_MODEL copy");

// Aging holds raw bytes unchanged; currentAgeSeconds virtual, max 3600.
const nearMax=age(rawRouter,3599);
let aging=ok(receiveOspfAreaLsaBatch(fresh(),state,observe(0,[nearMax])),
  "3599-age initial snapshot").session;
eq(now(aging).entries[0].maxAgeBlocked,false,"not MaxAge at t0");
const before=ok(advanceOspfAreaLsdb(aging,state,999),"advance short of one second");
eq(has(before,"LSA_MAXAGE_REACHED_MODEL"),0,"no premature MaxAge event");
eq(now(before.session).entries[0].currentAgeSeconds,3599,"age increments in whole seconds");
const at=ok(advanceOspfAreaLsdb(before.session,state,1000),"reach exact MaxAge");
aging=at.session;
eq(has(at,"LSA_MAXAGE_REACHED_MODEL"),1,"age crossing is explicit");
eq(now(aging).entries[0].currentAgeSeconds,3600,"MaxAge saturates at 3600");
eq(now(aging).entries[0].maxAgeBlocked,true,"excluded from any future SPF");
eq(aging.entries.length,1,"no invented flush, MaxAge retained");
eq(aging.entries[0].bytes.slice(0,2),nearMax.slice(0,2),
  "raw LS Age bytes never overwritten by virtual time");
const late=ok(advanceOspfAreaLsdb(aging,state,5000000),
  "large virtual age advance retains pending flush");
eq(has(late,"LSA_MAXAGE_REACHED_MODEL"),0,"MaxAge event only at crossing");
eq(late.session.entries.length,1,"unproven retransmission safety never deletes LSA");
const lessAge=ok(receiveOspfAreaLsaBatch(late.session,state,
  observe(5000500,[age(rawRouter,0)])),"non-MaxAge same-instance received later");
eq(has(lessAge,"LSA_OLDER_IGNORED"),1,"MaxAge instance dominates same seq/checksum");
eq(lessAge.session.entries[0].header.lsAge,3599,
  "original MaxAge storage remains source-canonical");

let premature=ok(receiveOspfAreaLsaBatch(fresh(),state,observe(0,[rawRouter])),
  "existing copy for explicit MaxAge receipt").session;
const maxReceipt=ok(receiveOspfAreaLsaBatch(premature,state,
  observe(1000,[age(rawRouter,3600)])),"newer MaxAge received for existing identity");
premature=maxReceipt.session;
eq(has(maxReceipt,"LSA_MAXAGE_RETAINED_MODEL"),1,
  "explicit MaxAge retained, no automatic purge");
eq(now(premature).entries[0].maxAgeBlocked,true,"received MaxAge is blocked");
const cannotInferFlush=ok(advanceOspfAreaLsdb(premature,state,20000000),
  "no proof of cleared neighbor retransmission lists");
eq(cannotInferFlush.session.entries.length,1,"no unsafe automatic deletion");

// Bounded capacity, 8 LSAs per transaction, stable identity sort.
let packed=fresh();
for(let i=0;i<16;i++){
  const batch=[];
  for(let j=0;j<8;j++)batch.push(idRouter(i*8+j+1));
  packed=ok(receiveOspfAreaLsaBatch(packed,state,observe(0,batch)),
    "bounded batch "+i).session;
}
eq(packed.entries.length,128,"all 128 entries retained");
eq(inspectOspfAreaLsdbSession(packed,state),null,"full capacity passes re-verification");
bad(receiveOspfAreaLsaBatch(packed,state,observe(1,[idRouter(129)])),
  "OSPF_AREA_LSDB_CAPACITY");
eq(packed.entries.length,128,"over-capacity attempt atomic");
eq(packed.entries[0].header.linkStateId,"10.0.0.1","stable canonical first ID");
eq(packed.entries.at(-1).header.linkStateId,"10.0.0.128","stable canonical final ID");

// Structural restore/integrity checks. Source hash and area are authoritative.
eq(inspectOspfAreaLsdbSession({...s,entries:[...s.entries].reverse()},state),
  "OSPF_AREA_LSDB_ORDER_INVALID","forged reverse ordering refused");
eq(inspectOspfAreaLsdbSession({...s,entries:[s.entries[0],s.entries[0]]},state),
  "OSPF_AREA_LSDB_ORDER_INVALID","duplicate stored key refused");
const forged={...s.entries[0],header:{...s.entries[0].header,lsSequenceNumber:77}};
eq(inspectOspfAreaLsdbSession({...s,entries:[forged,...s.entries.slice(1)]},state),
  "OSPF_AREA_LSDB_ENTRY_INVALID","false header rejected against bytes");
const bytesForged=[...s.entries[0].bytes];bytesForged[20]^=1;
eq(inspectOspfAreaLsdbSession({...s,entries:[{
  ...s.entries[0],bytes:bytesForged,
},...s.entries.slice(1)]},state),
  "OSPF_AREA_LSDB_ENTRY_INVALID","stored corrupt Fletcher rechecked");
eq(inspectOspfAreaLsdbSession({...s,clockMs:0},state),
  "OSPF_AREA_LSDB_ENTRY_INVALID","future receive time rejected");
bad(receiveOspfAreaLsaBatch(s,state,
  observe(9000,[nextRouter],"SYNC_MODEL","0.0.0.1")),
  "OSPF_AREA_LSDB_OBSERVATION_INVALID");
eq(inspectOspfAreaLsdbSession({...s,anchor:{...s.anchor,areaId:"0.0.0.1"}},state),
  null,"without authenticated area authority, a consistent area rebind is not detectable");
eq(inspectOspfAreaLsdbSession(s,{...state,stateRevision:1}),
  "OSPF_AREA_LSDB_STALE_SOURCE","Engine state revision rebound refused");
eq(inspectOspfAreaLsdbSession(s,{...state,scenarioHash:"spoof"}),
  "OSPF_AREA_LSDB_STALE_SOURCE","Engine source hash mismatch refused");
bad(advanceOspfAreaLsdb(s,{...state,stateRevision:1},9000),
  "OSPF_AREA_LSDB_STALE_SOURCE");
bad(receiveOspfAreaLsaBatch(s,{...state,scenarioHash:"spoof"},observe(9000,[nextRouter])),
  "OSPF_AREA_LSDB_STALE_SOURCE");

// Model-only source makes no live routing decision.
eq(state.stateRevision,0,"no Engine revision modified");
eq(state.resources["area-router"].properties,{},"no router property modified");
eq(queryReachability(scenario,state,"attacker","rds01","tcp",3389).truth,truth.truth,
  "no network reachability or SPF modification");
function replay(){
  let v=fresh(),eventLog=[];
  function apply(r){if(!r.ok)throw Error(r.code);v=r.session;eventLog.push(...r.events);}
  apply(receiveOspfAreaLsaBatch(v,state,observe(0,[rawNetwork,rawRouter],"FLOODING_MODEL")));
  apply(receiveOspfAreaLsaBatch(v,state,observe(999,[nextRouter],"FLOODING_MODEL")));
  apply(receiveOspfAreaLsaBatch(v,state,observe(1000,[nextRouter],"SYNC_MODEL")));
  apply(receiveOspfAreaLsaBatch(v,state,observe(2000,[age(nextRouter,3600)])));
  apply(advanceOspfAreaLsdb(v,state,12000000));
  return JSON.stringify({v,eventLog,read:readOspfAreaLsdb(v,state),revision:state.stateRevision});
}
const expected=replay();
for(let i=0;i<1000;i++)eq(replay(),expected,
  "1000 byte-identical area-LSDB state/recency/aging replays");
console.log("PASS CONVERGENCE OSPFv2 area LSDB lifecycle: "+checks+
  " assertions; 1000 identical replays");
