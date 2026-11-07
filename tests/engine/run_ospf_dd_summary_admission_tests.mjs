import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createInitialEngineState, queryReachability,
  createOspfP2pExchangeSession, advanceOspfP2pExchangeSession,
  receiveOspfP2pExchangeHello, receiveOspfP2pExchangeDescription,
  createOspfDdSummarySession, inspectOspfDdSummarySession,
  advanceOspfDdSummarySession, receiveOspfDdSummaryHello,
  receiveOspfDdSummaryDescription,
} from "../../dist-engine-test/engine/src/index.js";

const base=JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-normalized.json","utf8"));
const router=id=>({id,type:"network.router",label:id,interfaces:[],properties:{},
  asset:{id:"network.router",version:"1.0.0"}});
const scenario={...base,scenarioId:"ospfv2-dd-summary-admission",
  sourceHash:"f".repeat(64),resources:[...base.resources,router("sum-a"),router("sum-b")]};
const state=createInitialEngineState(scenario);
const cfg={localResourceId:"sum-a",remoteResourceId:"sum-b",
  localRouterId:"10.0.0.1",remoteRouterId:"10.0.0.2",areaId:"0.0.0.0",
  helloIntervalMs:10000,deadIntervalMs:40000,localInterfaceMtu:1500,
  initialDdSequence:9001,rxmtIntervalMs:2000};
const hello=(config,atMs,twoWay=true)=>({atMs,senderRouterId:config.remoteRouterId,
  areaId:config.areaId,helloIntervalMs:config.helloIntervalMs,
  deadIntervalMs:config.deadIntervalMs,seenRouterIds:twoWay?[config.localRouterId]:[]});
const packet=(config,atMs,options={})=>({
  atMs,senderRouterId:config.remoteRouterId,areaId:config.areaId,
  interfaceMtu:1500,options:2,init:true,more:true,master:true,
  ddSequence:701,lsaHeaderCount:0,...options,
});
const h1=(id,options={})=>({
  lsAge:100,options:2,lsaType:1,linkStateId:id,advertisingRouter:id,
  lsSequenceNumber:-2147483647,lsChecksum:1234,length:36,...options,
});
const h2=(id,options={})=>({
  lsAge:100,options:2,lsaType:2,linkStateId:id,advertisingRouter:"10.0.0.2",
  lsSequenceNumber:5,lsChecksum:200,length:40,...options,
});
let count=0;
function eq(a,b,label){assert.deepEqual(a,b,label);count++;}
function yes(x,label){assert.ok(x,label);count++;}
function ok(r,label){eq(r.ok,true,label);return r;}
function denied(r,code){eq(r.ok,false,"reject "+code);eq(r.code,code,"exact code");}
function init(config=cfg,local=[h1("10.0.0.1")]) {
  let ex=createOspfP2pExchangeSession(state,config);
  let r=advanceOspfP2pExchangeSession(ex,state,0);
  if(!r.ok)throw Error(r.code);ex=r.session;
  r=receiveOspfP2pExchangeHello(ex,state,hello(config,1000));
  if(!r.ok)throw Error(r.code);ex=r.session;
  const initial=config.localRouterId==="10.0.0.1"
    ? packet(config,2000)
    : packet(config,2000,{init:false,master:false,ddSequence:9001});
  r=receiveOspfP2pExchangeDescription(ex,state,initial);
  if(!r.ok)throw Error(r.code);ex=r.session;
  return createOspfDdSummarySession(state,ex,local);
}
const truth=queryReachability(scenario,state,"attacker","rds01","tcp",3389);
let s=init();
eq(inspectOspfDdSummarySession(s,state),null,"fresh exact Exchange plan valid");
eq(s.pages.length,0,"no fabricated DD pages");
eq(s.plan.requestIntents.length,0,"no requests without received headers");
assert.throws(()=>createOspfDdSummarySession(state,
  createOspfP2pExchangeSession(state,cfg),[]),/OSPF_LSDB_EXCHANGE_REQUIRED/);count++;
let unsupported=packet(cfg,3000,{init:false,ddSequence:702,lsaHeaderCount:1});
denied(receiveOspfDdSummaryDescription(s,state,unsupported,
  [h1("10.0.0.3",{lsaType:5})]),"OSPF_DD_SUMMARY_HEADERS_INVALID");
denied(receiveOspfDdSummaryDescription(s,state,unsupported,
  []),"OSPF_DD_SUMMARY_HEADERS_INVALID");
denied(receiveOspfDdSummaryDescription(s,state,
  {...unsupported,lsaHeaderCount:33},Array.from({length:33},(_,i)=>h2("192.0.2."+(i+1)))),
  "OSPF_DD_SUMMARY_HEADERS_INVALID");
eq(s.exchange.exchange.accepted,0,"malformed payload never advances DD sequence");
const firstHeaders=[h1("10.0.0.1",{lsSequenceNumber:1}),h2("192.0.2.1")];
const first=ok(receiveOspfDdSummaryDescription(s,state,
  packet(cfg,3000,{init:false,ddSequence:702,lsaHeaderCount:2}),firstHeaders),
  "accepted DD sequence with two headers");
s=first.session;
eq(s.exchange.exchange.sequence,702,"existing Exchange sequence advances");
eq(s.pages.length,1,"accepted DD contributes exactly one page");
eq(s.plan.remoteHeaders.length,2,"headers entered request model");
eq(s.plan.requestIntents.map(x=>[x.linkStateId,x.reason]),[
  ["10.0.0.1","REMOTE_NEWER"],["192.0.2.1","MISSING_LOCAL"]],
  "RFC local newer/missing differentiation");
eq(first.newRequests,s.plan.requestIntents,"new request delta exact");
eq(first.events.at(-1).kind,"DD_LSA_HEADERS_ADMITTED","explicit synthetic provenance");
eq(first.events.at(-1).headerCount,2,"provenance header count");
eq(inspectOspfDdSummarySession(s,state),null,"cross-layer state validates");

const duplicated=ok(receiveOspfDdSummaryDescription(s,state,
  packet(cfg,3200,{init:false,ddSequence:702,lsaHeaderCount:2}),firstHeaders),
  "duplicate DD same payload");
eq(duplicated.session.pages.length,1,"duplicate never adds a page");
eq(duplicated.newRequests.length,0,"duplicate never adds requests");
eq(duplicated.events.some(x=>x.kind==="DD_DUPLICATE_REPLY_INTENT"),true,
  "existing slave duplicate behavior preserved");
s=duplicated.session;
denied(receiveOspfDdSummaryDescription(s,state,
  packet(cfg,3300,{init:false,ddSequence:702,lsaHeaderCount:1}),[firstHeaders[0]]),
  "OSPF_DD_SUMMARY_DUPLICATE_MISMATCH");
denied(receiveOspfDdSummaryDescription(s,state,
  packet(cfg,3300,{init:false,ddSequence:702,lsaHeaderCount:2}),
  [firstHeaders[0],h2("192.0.2.5")]),"OSPF_DD_SUMMARY_DUPLICATE_MISMATCH");
eq(s.pages.length,1,"malformed duplicate input atomic");

const second=ok(receiveOspfDdSummaryDescription(s,state,
  packet(cfg,3500,{init:false,ddSequence:703,lsaHeaderCount:1}),
  [h1("10.0.0.3")]),"second accepted DD page");
s=second.session;
eq(s.exchange.exchange.accepted,2,"two accepted DD metadata pages");
eq(second.newRequests.map(x=>x.linkStateId),["10.0.0.3"],"new delta not duplicated");
eq(s.plan.requestIntents.length,3,"request ledger grows deterministically");
const before=JSON.stringify(s);
denied(receiveOspfDdSummaryDescription(s,state,
  packet(cfg,3600,{init:false,ddSequence:704,lsaHeaderCount:1,
    interfaceMtu:9000}),[h1("10.0.0.4")]),"OSPF_EXCHANGE_MTU_REJECTED");
denied(receiveOspfDdSummaryDescription(s,state,
  packet(cfg,3600,{init:false,ddSequence:704,lsaHeaderCount:1,
    senderRouterId:"10.0.0.77"}),[h1("10.0.0.4")]),"OSPF_EXCHANGE_PACKET_MISMATCH");
eq(JSON.stringify(s),before,"rejected DD does not affect clock or summary");
const tick=ok(advanceOspfDdSummarySession(s,state,3900),"advance session virtual clock");
eq(tick.session.plan.anchor.exchangeTimeMs,3900,"summary rebinds clock explicitly");
eq(tick.session.plan.requestIntents,s.plan.requestIntents,"no information lost during time advance");
s=tick.session;
const maintained=ok(receiveOspfDdSummaryHello(s,state,hello(cfg,4000)),
  "two-way Hello refreshes inactivity");
eq(maintained.session.plan.anchor.exchangeTimeMs,4000,"Hello rebinds summary clock");
eq(maintained.session.pages.length,2,"healthy Hello preserves header pages");
s=maintained.session;
const outOfOrder=ok(receiveOspfDdSummaryDescription(s,state,
  packet(cfg,4200,{init:false,ddSequence:900,lsaHeaderCount:1}),
  [h1("10.0.0.4")]),"protocol sequence mismatch");
eq(outOfOrder.events.some(x=>x.kind==="DD_SEQUENCE_MISMATCH_RESET"),true,
  "core still owns SeqNumberMismatch");
eq(outOfOrder.events.some(x=>x.kind==="DD_SUMMARY_DISCARDED"),true,
  "summary reset has explicit trace");
eq(outOfOrder.session.pages.length,0,"old summary discarded after restart");
eq(outOfOrder.session.plan,undefined,"no stale request list in ExStart");
eq(outOfOrder.session.exchange.dd.phase,"EXSTART","adjacency renegotiation required");
const newNegotiation=ok(receiveOspfDdSummaryDescription(outOfOrder.session,state,
  packet(cfg,4300,{ddSequence:777,lsaHeaderCount:0}),[]),
  "new synthetic ExStart negotiation");
eq(newNegotiation.session.exchange.dd.phase,"EXCHANGE","fresh NegotiationDone");
eq(newNegotiation.session.plan.requestIntents.length,0,
  "old request metadata never resurrects");
const recovered=ok(receiveOspfDdSummaryDescription(newNegotiation.session,state,
  packet(cfg,4400,{init:false,ddSequence:778,lsaHeaderCount:1}),[h2("192.0.2.2")]),
  "new exchange accepts summary");
eq(recovered.session.pages.length,1,"one fresh page only");
eq(recovered.session.plan.requestIntents.length,1,"new request ledger only");

const oneWay=ok(receiveOspfDdSummaryHello(recovered.session,state,hello(cfg,4500,false)),
  "one-way peer loss");
eq(oneWay.session.exchange.dd.phase,"IDLE","parent reverts to INIT");
eq(oneWay.session.pages.length,0,"one-way wipes summary");
eq(oneWay.session.plan,undefined,"no plan retained after one-way");
const deadline=ok(advanceOspfDdSummarySession(recovered.session,state,44000),
  "neighbor inactivity expiry");
eq(deadline.session.exchange.dd.phase,"IDLE","Dead timer wins");
eq(deadline.session.pages.length,0,"deadline discards all LSA headers");
eq(deadline.session.plan,undefined,"deadline discards request intents");
denied(receiveOspfDdSummaryDescription(recovered.session,state,
  packet(cfg,44000,{init:false,ddSequence:779,lsaHeaderCount:1}),
  [h2("192.0.2.3")]),"OSPF_EXCHANGE_NEIGHBOR_NOT_READY");

eq(inspectOspfDdSummarySession({...s,pages:[]},state),
  "OSPF_DD_SUMMARY_LEDGER_INVALID","forged lost-page history rejected");
eq(inspectOspfDdSummarySession({...s,plan:{...s.plan,requestIntents:[]}},state),
  "OSPF_DD_SUMMARY_LEDGER_INVALID","forged request list rejected");
eq(inspectOspfDdSummarySession({...s,pages:[
  {...s.pages[0],headers:[h1("10.0.0.8")]},...s.pages.slice(1)]},state),
  "OSPF_DD_SUMMARY_INVALID","forged header-count mismatch blocked early");
eq(inspectOspfDdSummarySession({...s,pages:[
  {...s.pages[0],headers:[h1("10.0.0.8"),s.pages[0].headers[1]]},...s.pages.slice(1)]},state),
  "OSPF_DD_SUMMARY_LEDGER_INVALID","same-length forged accepted payload blocked by ledger");
denied(advanceOspfDdSummarySession(s,{...state,stateRevision:1},4500),
  "SIM_CLOCK_STALE_REVISION");
denied(advanceOspfDdSummarySession(s,{...state,scenarioHash:"wrong"},4500),
  "SIM_CLOCK_SOURCE_MISMATCH");

const masterCfg={...cfg,localRouterId:"10.0.0.2",remoteRouterId:"10.0.0.1"};
let master=init(masterCfg,[]);
eq(master.exchange.exchange.role,"MASTER","master negotiation still RFC controlled");
const masterPage=ok(receiveOspfDdSummaryDescription(master,state,
  packet(masterCfg,3000,{init:false,master:false,ddSequence:9002,lsaHeaderCount:1}),
  [h2("198.51.100.1")]),"master accepted slave summary");
eq(masterPage.session.exchange.exchange.sequence,9003,"master advances after ack");
eq(masterPage.session.plan.requestIntents.length,1,"master request from slave summary");
const masterDup=ok(receiveOspfDdSummaryDescription(masterPage.session,state,
  packet(masterCfg,3200,{init:false,master:false,ddSequence:9002,lsaHeaderCount:1}),
  [h2("198.51.100.1")]),"master duplicate ack");
eq(masterDup.events.some(x=>x.kind==="DD_DUPLICATE_IGNORED"),true,"master ignores duplicate");
eq(masterDup.session.pages.length,1,"duplicate does not add new LSA");
const retried=ok(advanceOspfDdSummarySession(masterDup.session,state,5500),
  "master retry without LSA admission");
eq(retried.events.some(x=>x.kind==="DD_RETRANSMIT_INTENT"),true,
  "master retry remains modeled separately");
eq(retried.session.pages.length,1,"retransmit cannot invent received LSA headers");

let bounded=init();
for(let i=0;i<16;i++) {
  const r=receiveOspfDdSummaryDescription(bounded,state,
    packet(cfg,3000+i*100,{init:false,ddSequence:702+i,lsaHeaderCount:0}),[]);
  if(!r.ok)throw Error("bounded summary "+i+": "+r.code);
  bounded=r.session;
}
eq(bounded.pages.length,16,"16 accepted pages bounded");
denied(receiveOspfDdSummaryDescription(bounded,state,
  packet(cfg,4600,{init:false,ddSequence:718,lsaHeaderCount:0}),[]),
  "OSPF_DD_SUMMARY_BATCH_LIMIT");
eq(bounded.pages.length,16,"over-budget attempt atomic");
eq(state.stateRevision,0,"Engine state revision not mutated");
eq(state.resources["sum-a"].properties,{},"Engine router not modified");
eq(queryReachability(scenario,state,"attacker","rds01","tcp",3389).truth,truth.truth,
  "network reachability truth unchanged");

function replay(){
  let x=init();
  const history=[];
  function apply(r){if(!r.ok)throw Error(r.code);x=r.session;history.push(...r.events);}
  apply(receiveOspfDdSummaryDescription(x,state,
    packet(cfg,3000,{init:false,ddSequence:702,lsaHeaderCount:2}),firstHeaders));
  apply(receiveOspfDdSummaryDescription(x,state,
    packet(cfg,3100,{init:false,ddSequence:702,lsaHeaderCount:2}),firstHeaders));
  apply(receiveOspfDdSummaryDescription(x,state,
    packet(cfg,3500,{init:false,ddSequence:703,lsaHeaderCount:1}),[h1("10.0.0.3")]));
  apply(receiveOspfDdSummaryHello(x,state,hello(cfg,3600)));
  apply(advanceOspfDdSummarySession(x,state,4000));
  apply(receiveOspfDdSummaryHello(x,state,hello(cfg,4100,false)));
  return JSON.stringify({x,history,engineRevision:state.stateRevision});
}
const expected=replay();
for(let i=0;i<1000;i++)eq(replay(),expected,"1000 identical cross-layer DD summary transactions");
console.log("PASS CONVERGENCE OSPFv2 DD summary admission: "+count+" assertions; 1000 identical replays");
