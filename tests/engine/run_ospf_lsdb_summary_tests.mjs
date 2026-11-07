import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createInitialEngineState, queryReachability,
  createOspfP2pExchangeSession, advanceOspfP2pExchangeSession,
  receiveOspfP2pExchangeHello, receiveOspfP2pExchangeDescription,
  createOspfLsdbSummaryPlan, inspectOspfLsdbSummaryPlan,
  recordOspfLsdbSummaryBatch, compareOspfLsaHeaders, validOspfLsaHeader,
} from "../../dist-engine-test/engine/src/index.js";

const base = JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-normalized.json", "utf8"));
const router = (id) => ({ id, type:"network.router", label:id, interfaces:[], properties:{},
  asset:{ id:"network.router", version:"1.0.0" } });
const scenario = { ...base, scenarioId:"ospf-lsdb-summary-test", sourceHash:"f".repeat(64),
  resources:[...base.resources, router("lsdb-a"), router("lsdb-b")] };
const state = createInitialEngineState(scenario);
const cfg = { localResourceId:"lsdb-a", remoteResourceId:"lsdb-b",
  localRouterId:"10.0.0.1", remoteRouterId:"10.0.0.2", areaId:"0.0.0.0",
  helloIntervalMs:10000, deadIntervalMs:40000, localInterfaceMtu:1500,
  initialDdSequence:9001, rxmtIntervalMs:2000 };
const hello = (time, seen=[cfg.localRouterId]) => ({
  atMs:time, senderRouterId:cfg.remoteRouterId, areaId:cfg.areaId,
  helloIntervalMs:cfg.helloIntervalMs, deadIntervalMs:cfg.deadIntervalMs,
  seenRouterIds:seen,
});
const dd = (time) => ({ atMs:time, senderRouterId:cfg.remoteRouterId,
  areaId:cfg.areaId, interfaceMtu:1500, options:2,
  init:true, more:true, master:true, ddSequence:701, lsaHeaderCount:0 });
const h1 = (id, diff={}) => ({
  lsAge:100, options:2, lsaType:1, linkStateId:id, advertisingRouter:id,
  lsSequenceNumber:-2147483647, lsChecksum:1234, length:36, ...diff,
});
const h2 = (id, diff={}) => ({
  lsAge:100, options:2, lsaType:2, linkStateId:id, advertisingRouter:"10.0.0.2",
  lsSequenceNumber:7, lsChecksum:250, length:40, ...diff,
});
let n=0;
function eq(actual,expected,message){ assert.deepEqual(actual,expected,message); n++; }
function yes(value,message){ assert.ok(value,message); n++; }
function pass(result,message){ eq(result.ok,true,message); return result; }
function rejected(result,code){ eq(result.ok,false,"rejected "+code); eq(result.code,code,"exact diagnostic"); }
function exchangeReady(){
  let s=createOspfP2pExchangeSession(state,cfg);
  s=pass(advanceOspfP2pExchangeSession(s,state,0),"initial virtual tick").session;
  s=pass(receiveOspfP2pExchangeHello(s,state,hello(1000)),"P2P two way").session;
  s=pass(receiveOspfP2pExchangeDescription(s,state,dd(2000)),"ExStart complete").session;
  eq(s.dd.phase,"EXCHANGE","only synthetic negotiation complete");
  return s;
}
const ex=exchangeReady();
const reachability=queryReachability(scenario,state,"attacker","rds01","tcp",3389);
const old=h1("10.0.0.1");
const newer=h1("10.0.0.1",{lsSequenceNumber:1});
eq(compareOspfLsaHeaders(old,newer),1,"signed sequence number takes precedence");
eq(compareOspfLsaHeaders(newer,old),-1,"signed reverse comparison");
eq(compareOspfLsaHeaders(old,old),0,"same sequence/checksum/age");
eq(compareOspfLsaHeaders(old,h1("10.0.0.1",{lsChecksum:1235})),1,"higher unsigned checksum is newer");
eq(compareOspfLsaHeaders(old,h1("10.0.0.1",{lsChecksum:1233})),-1,"lower checksum is older");
eq(compareOspfLsaHeaders(old,h1("10.0.0.1",{lsAge:3600})),1,"remote MaxAge more recent");
eq(compareOspfLsaHeaders(h1("10.0.0.1",{lsAge:3600}),old),-1,"local MaxAge more recent");
eq(compareOspfLsaHeaders(h1("10.0.0.1",{lsAge:1000}),h1("10.0.0.1",{lsAge:100})),0,
  "MaxAgeDiff exact 900 not newer");
eq(compareOspfLsaHeaders(h1("10.0.0.1",{lsAge:1001}),h1("10.0.0.1",{lsAge:100})),1,
  "difference >900: younger remote newer");
eq(compareOspfLsaHeaders(h1("10.0.0.1",{lsAge:100}),h1("10.0.0.1",{lsAge:1001})),-1,
  "difference >900: younger local newer");
eq(compareOspfLsaHeaders(old,h1("10.0.0.1",{lsSequenceNumber:0,lsChecksum:1,lsAge:3600})),1,
  "LS sequence wins over checksum and MaxAge");
eq(compareOspfLsaHeaders(h1("10.0.0.1",{lsChecksum:1,lsAge:3600}),
  h1("10.0.0.1",{lsChecksum:2,lsAge:0})),1,"checksum wins over MaxAge");
assert.throws(()=>compareOspfLsaHeaders(old,h1("10.0.0.3")),/OSPF_LSA_COMPARISON_INVALID/);n++;
assert.throws(()=>compareOspfLsaHeaders(old,h2("10.0.0.1")),/OSPF_LSA_COMPARISON_INVALID/);n++;
for (const invalid of [
  h1("10.0.0.1",{lsAge:3601}),h1("10.0.0.1",{lsAge:-1}),
  h1("10.0.0.1",{lsSequenceNumber:-2147483648}),
  h1("10.0.0.1",{lsSequenceNumber:2147483648}),
  h1("10.0.0.1",{lsSequenceNumber:0.5}),
  h1("10.0.0.1",{lsChecksum:0}),h1("10.0.0.1",{lsChecksum:65536}),
  h1("10.0.0.1",{length:19}),h1("10.0.0.1",{length:65536}),
  h1("10.0.0.1",{options:256}),h1("10.0.0.1",{lsaType:5}),
  h1("10.0.0.1",{linkStateId:"10.0.0.3"}),
  h1("10.0.0.1",{advertisingRouter:"0.0.0.0"}),
  h1("10.0.0.1",{linkStateId:"10.00.0.1"}),
  h2("192.0.2.1",{linkStateId:"256.0.0.1"}),
  h2("192.0.2.1",{lsChecksum:NaN}),
]) eq(validOspfLsaHeader(invalid),false,"invalid header blocked");
eq(validOspfLsaHeader(h1("10.0.0.1")),true,"Type-1 canonical valid");
eq(validOspfLsaHeader(h2("192.0.2.1")),true,"Type-2 canonical valid");
assert.throws(()=>createOspfLsdbSummaryPlan(state,
  createOspfP2pExchangeSession(state,cfg),[]),/OSPF_LSDB_EXCHANGE_REQUIRED/);n++;
assert.throws(()=>createOspfLsdbSummaryPlan(state,ex,[old,old]),/OSPF_LSDB_LOCAL_HEADERS_INVALID/);n++;
assert.throws(()=>createOspfLsdbSummaryPlan(state,ex,[h1("10.0.0.1",{lsaType:5})]),
  /OSPF_LSDB_LOCAL_HEADERS_INVALID/);n++;
const local = [h2("192.0.2.1",{lsSequenceNumber:10}),old,
  h1("10.0.0.3",{lsSequenceNumber:9}),
  h2("192.0.2.4",{lsAge:1001,lsChecksum:250})];
const plan=createOspfLsdbSummaryPlan(state,ex,local);
eq(plan.localHeaders.map(x=>x.lsaType),[1,1,2,2],"local headers canonical sorted");
eq(plan.batchIds,[],"starts with no pages");
eq(plan.requestIntents,[],"no unearned request before summary");
eq(inspectOspfLsdbSummaryPlan(plan,state,ex),null,"valid initial plan");
const batchA=[h1("10.0.0.1",{lsSequenceNumber:0}),h1("10.0.0.3",{lsSequenceNumber:5}),
  h2("192.0.2.2")];
const one=pass(recordOspfLsdbSummaryBatch(plan,state,ex,"batch.01",batchA),"first remote page");
eq(one.plan.requestIntents.map(x=>[x.lsaType,x.linkStateId,x.reason]),
  [[1,"10.0.0.1","REMOTE_NEWER"],[2,"192.0.2.2","MISSING_LOCAL"]],
  "newer remote and missing local request; older remote ignored");
eq(one.newRequests,one.plan.requestIntents,"first page new request delta");
eq(inspectOspfLsdbSummaryPlan(one.plan,state,ex),null,"post page consistency");
eq(plan.batchIds,[],"original page ID array unchanged");
const two=pass(recordOspfLsdbSummaryBatch(one.plan,state,ex,"batch.02",[
  h2("192.0.2.1",{lsSequenceNumber:8}),
  h2("192.0.2.3",{lsSequenceNumber:-2147483647}),
  h2("192.0.2.4",{lsAge:100}),
]),"second remote page");
eq(two.newRequests.map(x=>x.linkStateId),["192.0.2.3","192.0.2.4"],
  "only newly needed Type2 IDs are reported");
eq(two.plan.requestIntents.length,4,"global request ledger exact");
eq(two.plan.remoteHeaders.length,6,"two page snapshots");
rejected(recordOspfLsdbSummaryBatch(two.plan,state,ex,"batch.02",[]),"OSPF_LSDB_BATCH_ID_INVALID");
rejected(recordOspfLsdbSummaryBatch(two.plan,state,ex,"forbidden/id",[]),"OSPF_LSDB_BATCH_ID_INVALID");
rejected(recordOspfLsdbSummaryBatch(two.plan,state,ex,"batch.03",[batchA[0]]),
  "OSPF_LSDB_DUPLICATE_LSA");
rejected(recordOspfLsdbSummaryBatch(two.plan,state,ex,"batch.03",[old,old]),
  "OSPF_LSDB_BATCH_INVALID");
rejected(recordOspfLsdbSummaryBatch(two.plan,state,ex,"batch.03",[h1("10.0.0.1",{lsaType:5})]),
  "OSPF_LSDB_BATCH_INVALID");
eq(two.plan.batchIds.length,2,"rejection never alters original");
const staleState={...state,stateRevision:state.stateRevision+1};
rejected(recordOspfLsdbSummaryBatch(two.plan,staleState,ex,"batch.03",[]),"SIM_CLOCK_STALE_REVISION");
const tick=pass(advanceOspfP2pExchangeSession(ex,state,2500),"exchange clock advances independently");
rejected(recordOspfLsdbSummaryBatch(two.plan,state,tick.session,"batch.03",[]),"OSPF_LSDB_STALE_EXCHANGE");
eq(inspectOspfLsdbSummaryPlan({...two.plan,requestIntents:[]},state,ex),
  "OSPF_LSDB_REQUEST_LEDGER_INVALID","forged request list blocked");
eq(inspectOspfLsdbSummaryPlan({...two.plan,remoteHeaders:[...two.plan.remoteHeaders].reverse()},state,ex),
  "OSPF_LSDB_PLAN_INVALID","noncanonical remote header order rejected");
eq(inspectOspfLsdbSummaryPlan({...two.plan,batchIds:["batch.01","batch.01"]},state,ex),
  "OSPF_LSDB_PLAN_INVALID","duplicate batch IDs in restored plan rejected");
const noRequest=pass(recordOspfLsdbSummaryBatch(plan,state,ex,"empty",[]),"empty summary page");
eq(noRequest.plan.requestIntents.length,0,"empty batch never implies convergence");
const pages=Array.from({length:17},(_,i)=>"page-"+i);
let bounded=createOspfLsdbSummaryPlan(state,ex,[]);
for(let i=0;i<16;i++) bounded=pass(recordOspfLsdbSummaryBatch(bounded,state,ex,pages[i],[]),
  "bounded page "+i).plan;
rejected(recordOspfLsdbSummaryBatch(bounded,state,ex,pages[16],[]),"OSPF_LSDB_BATCH_LIMIT");
let full=createOspfLsdbSummaryPlan(state,ex,[]);
for(let batch=0;batch<8;batch++){
  const headers=Array.from({length:32},(_,i)=>h2("198.51."+batch+"."+(i+1)));
  full=pass(recordOspfLsdbSummaryBatch(full,state,ex,"full"+batch,headers),
    "32 valid headers in batch "+batch).plan;
}
eq(full.remoteHeaders.length,256,"total bounded at 256 metadata headers");
rejected(recordOspfLsdbSummaryBatch(full,state,ex,"overflow",[h2("198.51.99.1")]),
  "OSPF_LSDB_HEADER_LIMIT");
eq(full.requestIntents.length,256,"all missing identities have request intents");
rejected(recordOspfLsdbSummaryBatch(plan,state,ex,"oversized",
  Array.from({length:33},(_,i)=>h2("203.0.113."+(i+1)))), "OSPF_LSDB_BATCH_INVALID");
eq(state.stateRevision,0,"no Engine mutation");
eq(state.resources["lsdb-a"].properties,{},"no router property mutation");
eq(queryReachability(scenario,state,"attacker","rds01","tcp",3389).truth,
  reachability.truth,"LSDB header planning never changes network truth");

function replay() {
  const session=exchangeReadyQuiet();
  let p=createOspfLsdbSummaryPlan(state,session,local);
  for(const [id,headers] of [["one",batchA],["two",[
    h2("192.0.2.1",{lsSequenceNumber:8}),
    h2("192.0.2.3",{lsSequenceNumber:-2147483647}),
    h2("192.0.2.4",{lsAge:100})]],["three",[]]]){
    const r=recordOspfLsdbSummaryBatch(p,state,session,id,headers);
    if(!r.ok) throw Error(r.code);
    p=r.plan;
  }
  return JSON.stringify(p);
}
function exchangeReadyQuiet(){
  let s=createOspfP2pExchangeSession(state,cfg);
  let r=advanceOspfP2pExchangeSession(s,state,0);if(!r.ok)throw Error(r.code);s=r.session;
  r=receiveOspfP2pExchangeHello(s,state,hello(1000));if(!r.ok)throw Error(r.code);s=r.session;
  r=receiveOspfP2pExchangeDescription(s,state,dd(2000));if(!r.ok)throw Error(r.code);
  return r.session;
}
const expected=replay();
for(let i=0;i<1000;i++) eq(replay(),expected,"1000 identical LSDB header request-plan replays");
console.log("PASS CONVERGENCE OSPFv2 LSDB header request planning: "+n+" assertions; 1000 byte-identical replays");
