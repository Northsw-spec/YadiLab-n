import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createInitialEngineState, queryReachability,
  createOspfAreaLsdbSession, readOspfAreaLsdb,
  receiveOspfAreaLsaBatch, advanceOspfAreaLsdb,
  inspectOspfMaxAgeInventory, evaluateOspfMaxAgeFlush, removeOspfAreaMaxAgeModel,
  OSPF_MAXAGE_FLUSH_FORMAT, OSPF_MAXAGE_FLUSH_VERSION,
  OSPF_MAXAGE_INVENTORY_SOURCE, OSPF_MAXAGE_MAX_NEIGHBORS,
  OSPF_MAXAGE_MAX_RETRANSMISSION_IDS, OSPF_MAXAGE_MAX_REMOVAL_BATCH,
} from "../../dist-engine-test/engine/src/index.js";

const fixture=JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-normalized.json","utf8"));
const router=id=>({id,type:"network.router",label:id,interfaces:[],properties:{},
  asset:{id:"network.router",version:"1.0.0"}});
const scenario={...fixture,scenarioId:"ospf-maxage-model",sourceHash:"e".repeat(64),
  resources:[...fixture.resources,router("flush-rtr")]};
const state=createInitialEngineState(scenario);
const truth=queryReachability(scenario,state,"attacker","rds01","tcp",3389);

const rawRouter=Array.from(Buffer.from("006402010a0000020a0000028000000182c8001800000000","hex"));
const rawNetwork=Array.from(Buffer.from(
  "00640202c00002010a0000028000000183fe001cffffff000a000002","hex"));
const reseal=input=>{
  const b=[...input];b[16]=0;b[17]=0;b[18]=(b.length>>>8)&255;b[19]=b.length&255;
  let a=0,c=0;for(let i=2;i<b.length;i++){a=(a+b[i])%255;c=(c+a)%255;}
  const x=(((b.length-2)-15)*a-c+255*512)%255;
  b[16]=x;b[17]=(510-a-x)%255;
  let v=0,w=0;for(let i=2;i<b.length;i++){v=(v+b[i])%255;w=(w+v)%255;}
  assert.deepEqual([v,w],[0,0],"independent Fletcher sealed fixture");
  return b;
};
function age(bytes,seconds){
  const b=[...bytes];b[0]=(seconds>>>8)&255;b[1]=seconds&255;return b;
}
function idRouter(octet){
  const b=[...rawRouter];b[7]=octet;b[11]=octet;return reseal(b);
}
const headerId=h=>({
  lsaType:h.lsaType,linkStateId:h.linkStateId,advertisingRouter:h.advertisingRouter,
});
const identityFromBytes=b=>headerId({
  lsaType:b[3],linkStateId:[...b.slice(4,8)].join("."),
  advertisingRouter:[...b.slice(8,12)].join("."),
});
const routerId=identityFromBytes(rawRouter);
const networkId=identityFromBytes(rawNetwork);
const otherId=identityFromBytes(idRouter(8));
const nonexistingId=identityFromBytes(idRouter(99));
const newLsa=idRouter(9);
const peer=(routerId,phase="FULL",retransmissionIdentities=[])=>({
  routerId,phase,retransmissionListComplete:true,retransmissionIdentities,
});
function fresh(){return createOspfAreaLsdbSession(state,"flush-rtr","0.0.0.0");}
function ready(){
  let s=fresh();
  const r=receiveOspfAreaLsaBatch(s,state,{
    atMs:0,source:"SYNC_MODEL",areaId:"0.0.0.0",
    lsas:[age(rawRouter,3599),age(rawNetwork,3599),idRouter(8)],
  });
  if(!r.ok)throw Error(r.code);s=r.session;
  const advanced=advanceOspfAreaLsdb(s,state,1000);
  if(!advanced.ok)throw Error(advanced.code);
  return advanced.session;
}
function declaration(s,neighbors=[],props={}){
  return {
    formatId:OSPF_MAXAGE_FLUSH_FORMAT,
    schemaVersion:OSPF_MAXAGE_FLUSH_VERSION,
    source:OSPF_MAXAGE_INVENTORY_SOURCE,
    allNeighborsDeclared:true,
    observedAnchor:JSON.parse(JSON.stringify(s.anchor)),
    observedAtMs:s.clockMs,
    observedEntries:JSON.parse(JSON.stringify(s.entries)),
    neighbors, ...props,
  };
}
let checks=0;
function eq(a,b,label){assert.deepEqual(a,b,label);checks++;}
function ok(result,label){eq(result.ok,true,label);return result;}
function bad(result,code){eq(result.ok,false,"must reject "+code);
  eq(result.code,code,"exact error "+code);}
const s=ready();
eq(OSPF_MAXAGE_FLUSH_FORMAT,"yadilab.engine.ospfv2-maxage-flush-model",
  "snapshot removal distinct from real LSDB");
eq(OSPF_MAXAGE_FLUSH_VERSION,"1.0.0","versioned proof contract");
eq(OSPF_MAXAGE_INVENTORY_SOURCE,"CALLER_DECLARED_SYNTHETIC_INVENTORY",
  "caller completeness never means external proof");
eq(OSPF_MAXAGE_MAX_NEIGHBORS,32,"bounded declared neighbor inventory");
eq(OSPF_MAXAGE_MAX_RETRANSMISSION_IDS,128,"bounded listed LSA references");
eq(OSPF_MAXAGE_MAX_REMOVAL_BATCH,8,"bounded atomic removal batch");
eq(s.clockMs,1000,"source clock exactly 1000 ms");
eq(readOspfAreaLsdb(s,state).entries.map(e=>e.maxAgeBlocked),
  [true,false,true],"two aged LSAs plus one non-aged router");
eq(s.entries.length,3,"raw bytes retained at MaxAge");
eq(inspectOspfMaxAgeInventory(s,state,declaration(s,[])),null,
  "zero neighbors requires explicit complete declaration");
let e=ok(evaluateOspfMaxAgeFlush(s,state,declaration(s,[])),
  "complete synthetic empty inventory");
eq(e.inventorySource,OSPF_MAXAGE_INVENTORY_SOURCE,
  "model authority never upgraded");
eq(e.candidates.map(x=>x.disposition),
  ["MODEL_ONLY_ELIGIBLE","MODEL_ONLY_ELIGIBLE"],"two independent MaxAge candidates");
eq(e.candidates.map(x=>x.ageSeconds),[3600,3600],"only MaxAge considered");
eq(e.candidates.map(x=>x.blockers),[[],[]],"declared no holders");
eq(e.candidates[0].identity,routerId,"first max-age router identity");
eq(e.candidates[1].identity,networkId,"second max-age network identity");
eq(s.entries[0].bytes.slice(0,2),age(rawRouter,3599).slice(0,2),
  "virtual time does not rewrite original raw bytes");
const peers=[peer("10.0.0.3","FULL"),peer("10.0.0.4","DOWN")];
eq(ok(evaluateOspfMaxAgeFlush(s,state,declaration(s,peers)),
  "nonblocking declared FULL and DOWN").candidates.every(x=>x.disposition==="MODEL_ONLY_ELIGIBLE"),
  true,"neighbor phase not falsely blocked");
eq(ok(evaluateOspfMaxAgeFlush(s,state,
  declaration(s,[peer("10.0.0.3","EXSTART")])),
  "ExStart is not Exchange or Loading per RFC 14").candidates[0].blockers,[],
  "strict RFC precondition excludes only Exchange/Loading");
for(const phase of ["EXCHANGE","LOADING"]){
  const blocked=ok(evaluateOspfMaxAgeFlush(s,state,
    declaration(s,[peer("10.0.0.3",phase)])),
    phase+" explicitly blocks all MaxAge removal");
  eq(blocked.candidates.map(x=>x.disposition),
    ["MODEL_ONLY_BLOCKED","MODEL_ONLY_BLOCKED"],"all identities blocked by "+phase);
  eq(blocked.candidates.map(x=>x.blockers),
    [["EXCHANGE_OR_LOADING"],["EXCHANGE_OR_LOADING"]],
    "reason is not a checksum or SPF failure");
  bad(removeOspfAreaMaxAgeModel(s,state,
    declaration(s,[peer("10.0.0.3",phase)]),[routerId]),
    "OSPF_MAXAGE_REMOVE_BLOCKED");
}
const retrans=declaration(s,[peer("10.0.0.3","FULL",[routerId]),
  peer("10.0.0.4","DOWN",[networkId])]);
const held=ok(evaluateOspfMaxAgeFlush(s,state,retrans),
  "retransmission list references despite neighbor not Exchange/Loading");
eq(held.candidates.map(x=>x.blockers),
  [["RETRANSMISSION"],["RETRANSMISSION"]],"per-identity suppression");
eq(held.candidates.map(x=>x.retransmittingNeighborIds),
  [["10.0.0.3"],["10.0.0.4"]],"which neighbor retains each LSA");
bad(removeOspfAreaMaxAgeModel(s,state,retrans,[routerId,networkId]),
  "OSPF_MAXAGE_REMOVE_BLOCKED");
const both=ok(evaluateOspfMaxAgeFlush(s,state,
  declaration(s,[peer("10.0.0.3","EXCHANGE",[routerId])])),
  "simultaneous Exchange and retransmission blockers");
eq(both.candidates[0].blockers,["EXCHANGE_OR_LOADING","RETRANSMISSION"],
  "both independent RFC blockers visible");
eq(both.candidates[1].blockers,["EXCHANGE_OR_LOADING"],
  "Exchange blocker applies even without LSA reference");
const referenceNonlocal=ok(evaluateOspfMaxAgeFlush(s,state,
  declaration(s,[peer("10.0.0.3","FULL",[nonexistingId])])),
  "unknown retransmission identity tolerated conservatively");
eq(referenceNonlocal.candidates.every(x=>x.disposition==="MODEL_ONLY_ELIGIBLE"),
  true,"unrelated reference cannot block different identities");

const witness=declaration(s,peers);
const immutableBefore=JSON.stringify(s);
bad(removeOspfAreaMaxAgeModel(s,state,witness,[otherId]),
  "OSPF_MAXAGE_REMOVE_NOT_MAXAGE");
bad(removeOspfAreaMaxAgeModel(s,state,witness,[nonexistingId]),
  "OSPF_MAXAGE_REMOVE_UNKNOWN");
bad(removeOspfAreaMaxAgeModel(s,state,witness,[routerId,routerId]),
  "OSPF_MAXAGE_REMOVE_DUPLICATE");
bad(removeOspfAreaMaxAgeModel(s,state,witness,[]),
  "OSPF_MAXAGE_REMOVE_BATCH_INVALID");
bad(removeOspfAreaMaxAgeModel(s,state,witness,
  Array.from({length:9},()=>routerId)),"OSPF_MAXAGE_REMOVE_BATCH_INVALID");
bad(removeOspfAreaMaxAgeModel(s,state,witness,
  [{...routerId,linkStateId:"010.0.0.2"}]),"OSPF_MAXAGE_REMOVE_ID_INVALID");
bad(removeOspfAreaMaxAgeModel(s,state,witness,[routerId,otherId]),
  "OSPF_MAXAGE_REMOVE_NOT_MAXAGE");
bad(removeOspfAreaMaxAgeModel(s,state,retrans,[routerId,networkId]),
  "OSPF_MAXAGE_REMOVE_BLOCKED");
eq(JSON.stringify(s),immutableBefore,"all malformed/held requests atomic");

const removedOne=ok(removeOspfAreaMaxAgeModel(s,state,
  declaration(s,[peer("10.0.0.3","FULL",[routerId])]),[networkId]),
  "unreferenced MaxAge can be removed while separate MaxAge is held");
eq(removedOne.session.entries.length,2,"one removed only from synthetic snapshot");
eq(removedOne.events[0].kind,"MAXAGE_REMOVED_FROM_SYNTHETIC_SNAPSHOT",
  "event explicitly states synthetic removal");
eq(removedOne.events[0].identity,networkId,"correct network removed");
eq(readOspfAreaLsdb(removedOne.session,state).entries[0].maxAgeBlocked,true,
  "other MaxAge retained");
eq(removedOne.session.clockMs,1000,"removal does not invent virtual time advance");
const oldWitnessReused=evaluateOspfMaxAgeFlush(removedOne.session,state,witness);
bad(oldWitnessReused,"OSPF_MAXAGE_INVENTORY_STALE");
eq(removedOne.session.entries.map(x=>x.header.linkStateId),
  ["10.0.0.2","10.0.0.8"],"old Router LSA plus non-MaxAge remains");
eq(readOspfAreaLsdb(s,state).entries.length,3,"caller original remains unchanged");

const removal=ok(removeOspfAreaMaxAgeModel(s,state,witness,
  [routerId,networkId]),"two MaxAge records removed atomically on complete declared evidence");
eq(removal.events.length,2,"two explicit synthetic removal events");
eq(removal.events.map(x=>x.identity),[routerId,networkId],
  "requested removal order preserved");
eq(removal.session.entries.length,1,"non-MaxAge retained");
eq(removal.session.entries[0].header.linkStateId,"10.0.0.8",
  "unaltered non-MaxAge payload");
eq(readOspfAreaLsdb(removal.session,state).entries[0].maxAgeBlocked,false,
  "only non-MaxAge remains");
eq(s.entries.length,3,"source LSDB untouched");
eq(state.stateRevision,0,"no Engine revision mutation");
eq(queryReachability(scenario,state,"attacker","rds01","tcp",3389).truth,
  truth.truth,"no SPF or network route effects");

const cases=[
  [declaration(s,[],{allNeighborsDeclared:false}),"OSPF_MAXAGE_INVENTORY_INCOMPLETE"],
  [declaration(s,[],{neighbors:null}),"OSPF_MAXAGE_INVENTORY_INCOMPLETE"],
  [declaration(s,[],{formatId:"fake"}),"OSPF_MAXAGE_INVENTORY_INVALID"],
  [declaration(s,[],{source:"NETWORK_PACKET_VERIFIED"}),"OSPF_MAXAGE_INVENTORY_INVALID"],
  [declaration(s,[],{schemaVersion:"9.9.9"}),"OSPF_MAXAGE_INVENTORY_INVALID"],
  [declaration(s,[],{observedAtMs:999}),"OSPF_MAXAGE_INVENTORY_STALE"],
  [declaration(s,[],{observedAnchor:{...s.anchor,areaId:"0.0.0.1"}}),
    "OSPF_MAXAGE_INVENTORY_STALE"],
  [declaration(s,[],{observedAnchor:{...s.anchor,scenarioHash:"fake"}}),
    "OSPF_MAXAGE_INVENTORY_STALE"],
  [declaration(s,[],{observedEntries:s.entries.slice(1)}),
    "OSPF_MAXAGE_INVENTORY_STALE"],
  [declaration(s,[],{neighbors:[peer("10.0.0.3","FULL"),
    peer("10.0.0.3","FULL")]}),"OSPF_MAXAGE_NEIGHBOR_ORDER_INVALID"],
  [declaration(s,[],{neighbors:[peer("10.0.0.9","FULL"),
    peer("10.0.0.3","FULL")]}),"OSPF_MAXAGE_NEIGHBOR_ORDER_INVALID"],
  [declaration(s,[],{neighbors:[peer("10.0.0.03","FULL")]}),
    "OSPF_MAXAGE_NEIGHBOR_INVALID"],
  [declaration(s,[],{neighbors:[peer("0.0.0.0","FULL")]}),
    "OSPF_MAXAGE_NEIGHBOR_INVALID"],
  [declaration(s,[],{neighbors:[peer("10.0.0.3","BROKEN")]}),
    "OSPF_MAXAGE_NEIGHBOR_INVALID"],
  [declaration(s,[],{neighbors:[{...peer("10.0.0.3"),
    retransmissionListComplete:false}]}),"OSPF_MAXAGE_INVENTORY_INCOMPLETE"],
  [declaration(s,[],{neighbors:[{...peer("10.0.0.3"),
    retransmissionIdentities:undefined}]}),"OSPF_MAXAGE_INVENTORY_INCOMPLETE"],
  [declaration(s,[],{neighbors:[peer("10.0.0.3","FULL",
    [routerId,routerId])]}),"OSPF_MAXAGE_RETRANSMISSION_ORDER_INVALID"],
  [declaration(s,[],{neighbors:[peer("10.0.0.3","FULL",
    [networkId,routerId])]}),"OSPF_MAXAGE_RETRANSMISSION_ORDER_INVALID"],
  [declaration(s,[],{neighbors:[peer("10.0.0.3","FULL",
    [{...routerId,linkStateId:"10.0.0.4"}])]}),
    "OSPF_MAXAGE_RETRANSMISSION_INVALID"],
  [declaration(s,[],{neighbors:[peer("10.0.0.3","FULL",
    [{...routerId,advertisingRouter:"0.0.0.0"}])]}),
    "OSPF_MAXAGE_RETRANSMISSION_INVALID"],
  [declaration(s,[],{neighbors:[peer("10.0.0.3","FULL",
    [{...routerId,extra:true}])]}),
    "OSPF_MAXAGE_RETRANSMISSION_INVALID"],
  [declaration(s,[],{neighbors:Array.from({length:33},(_,i)=>
    peer("10.0.0."+(i+1)))}),"OSPF_MAXAGE_INVENTORY_LIMIT"],
  [declaration(s,[],{neighbors:[peer("10.0.0.3","FULL",
    Array.from({length:129},(_,i)=>identityFromBytes(idRouter(i+1))) )]}),
    "OSPF_MAXAGE_RETRANSMISSION_LIMIT"],
];
for(const [declarationBad,code] of cases){
  bad(evaluateOspfMaxAgeFlush(s,state,declarationBad),code);
  bad(removeOspfAreaMaxAgeModel(s,state,declarationBad,[routerId]),code);
}
const refs=Array.from({length:128},(_,i)=>identityFromBytes(idRouter(i+1)));
const upper=declaration(s,[peer("10.0.0.3","FULL",refs)]);
eq(inspectOspfMaxAgeInventory(s,state,upper),null,
  "exact 128 retransmission references accepted");
const top=declaration(s,Array.from({length:32},(_,i)=>peer("10.0.0."+(i+1))));
eq(inspectOspfMaxAgeInventory(s,state,top),null,
  "exact 32 declaration cap accepted");
eq(ok(evaluateOspfMaxAgeFlush(s,state,upper),
  "full reference list blocks Router-LSA").candidates[0].disposition,
  "MODEL_ONLY_BLOCKED","one matching reference sufficient among 128");

const future=advanceOspfAreaLsdb(s,state,1001);
eq(future.ok,true,"virtual clock can advance independently");
bad(evaluateOspfMaxAgeFlush(future.session,state,witness),
  "OSPF_MAXAGE_INVENTORY_STALE");
const sameClockChange=receiveOspfAreaLsaBatch(s,state,{
  atMs:1000,source:"SYNC_MODEL",areaId:"0.0.0.0",lsas:[newLsa],
});
eq(sameClockChange.ok,true,"LSDB changed at exactly same timestamp");
bad(evaluateOspfMaxAgeFlush(sameClockChange.session,state,witness),
  "OSPF_MAXAGE_INVENTORY_STALE");
const broken=[...s.entries[0].bytes];broken[20]^=1;
const corrupt={...s,entries:[{...s.entries[0],bytes:broken},...s.entries.slice(1)]};
bad(evaluateOspfMaxAgeFlush(corrupt,state,declaration(corrupt,[])),
  "OSPF_AREA_LSDB_ENTRY_INVALID");
bad(evaluateOspfMaxAgeFlush(s,{...state,stateRevision:1},witness),
  "OSPF_AREA_LSDB_STALE_SOURCE");
bad(removeOspfAreaMaxAgeModel(s,{...state,scenarioHash:"incorrect"},witness,[routerId]),
  "OSPF_AREA_LSDB_STALE_SOURCE");

// Required trust limitation: a syntactically consistent claimed inventory
// cannot PROVE that unseen real neighbors do not exist. Test never treats it
// as externally authenticated. Its source and result say MODEL only.
eq(inspectOspfMaxAgeInventory(s,state,declaration(s,[])),null,
  "caller-claimed complete zero-neighbor list is self-consistent only");
eq(ok(evaluateOspfMaxAgeFlush(s,state,declaration(s,[])),
  "synthetic claim is not independent network truth").candidates[0].disposition,
  "MODEL_ONLY_ELIGIBLE","source qualifier cannot silently disappear");

function replay(){
  let v=ready(),history=[];
  const w1=declaration(v,[peer("10.0.0.3","LOADING")]);
  const inspected=evaluateOspfMaxAgeFlush(v,state,w1);
  const badRequest=removeOspfAreaMaxAgeModel(v,state,w1,[routerId]);
  if(!inspected.ok || badRequest.ok)throw Error("negative barrier lost");
  history.push(inspected,badRequest.code);
  const w2=declaration(v,[peer("10.0.0.3","FULL",[routerId])]);
  const good=removeOspfAreaMaxAgeModel(v,state,w2,[networkId]);
  if(!good.ok)throw Error(good.code);
  v=good.session;history.push(...good.events);
  const w3=declaration(v,[peer("10.0.0.3","FULL")]);
  const final=removeOspfAreaMaxAgeModel(v,state,w3,[routerId]);
  if(!final.ok)throw Error(final.code);
  v=final.session;history.push(...final.events);
  return JSON.stringify({v,history,read:readOspfAreaLsdb(v,state),
    revision:state.stateRevision});
}
const reference=replay();
for(let i=0;i<1000;i++)eq(replay(),reference,
  "1000 byte-identical evidence gates/atomic synthetic flush replays");
console.log("PASS CONVERGENCE OSPFv2 MaxAge flush model: "+checks+
  " assertions; 1000 identical replays");
