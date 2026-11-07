import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createInitialEngineState, queryReachability,
  createOspfP2pExchangeSession, advanceOspfP2pExchangeSession,
  receiveOspfP2pExchangeHello, receiveOspfP2pExchangeDescription,
  createOspfDdSummarySession,
  createOspfDdFinishSession, inspectOspfDdFinishSession,
  receiveOspfDdFinishDescription, receiveOspfDdFinishHello,
  advanceOspfDdFinishSession,
} from "../../dist-engine-test/engine/src/index.js";

const base=JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-normalized.json","utf8"));
const router=id=>({id,type:"network.router",label:id,interfaces:[],properties:{},
  asset:{id:"network.router",version:"1.0.0"}});
const scenario={...base,scenarioId:"ospf-dd-finish-test",sourceHash:"a".repeat(64),
  resources:[...base.resources,router("finish-a"),router("finish-b")]};
const state=createInitialEngineState(scenario);
const baseCfg={localResourceId:"finish-a",remoteResourceId:"finish-b",
  localRouterId:"10.0.0.1",remoteRouterId:"10.0.0.2",
  areaId:"0.0.0.0",helloIntervalMs:10000,deadIntervalMs:40000,
  localInterfaceMtu:1500,initialDdSequence:9001,rxmtIntervalMs:2000};
const cfgMaster={...baseCfg,localRouterId:"10.0.0.2",remoteRouterId:"10.0.0.1"};
const hello=(config,atMs,twoWay=true)=>({atMs,senderRouterId:config.remoteRouterId,
  areaId:config.areaId,helloIntervalMs:config.helloIntervalMs,
  deadIntervalMs:config.deadIntervalMs,
  seenRouterIds:twoWay?[config.localRouterId]:[]});
const dd=(config,atMs,extra={})=>({atMs,senderRouterId:config.remoteRouterId,
  areaId:config.areaId,interfaceMtu:1500,options:2,init:true,
  more:true,master:true,ddSequence:701,lsaHeaderCount:0,...extra});
const h1=(id,extra={})=>({lsAge:100,options:2,lsaType:1,
  linkStateId:id,advertisingRouter:id,lsSequenceNumber:-2147483647,
  lsChecksum:1234,length:36,...extra});
let n=0;
function eq(x,y,label){assert.deepEqual(x,y,label);n++;}
function pass(r,label){eq(r.ok,true,label);return r;}
function deny(r,code){eq(r.ok,false,"denied "+code);eq(r.code,code,"exact "+code);}
function events(r,k){return r.events.filter(x=>x.kind===k);}
function prepare(config=baseCfg,local=[],pageSize=1) {
  let ex=createOspfP2pExchangeSession(state,config);
  let r=advanceOspfP2pExchangeSession(ex,state,0);
  if(!r.ok) throw Error(r.code);ex=r.session;
  r=receiveOspfP2pExchangeHello(ex,state,hello(config,1000));
  if(!r.ok)throw Error(r.code);ex=r.session;
  const negotiation=config.localRouterId==="10.0.0.1"
    ? dd(config,2000)
    : dd(config,2000,{init:false,master:false,ddSequence:9001});
  r=receiveOspfP2pExchangeDescription(ex,state,negotiation);
  if(!r.ok)throw Error(r.code);
  const summary=createOspfDdSummarySession(state,r.session,local);
  return createOspfDdFinishSession(state,summary,pageSize);
}
const originalTruth=queryReachability(scenario,state,"attacker","rds01","tcp",3389);
assert.throws(()=>prepare(baseCfg,[],0),/OSPF_DD_FINISH_CONFIG_INVALID/);n++;
assert.throws(()=>prepare(baseCfg,[],33),/OSPF_DD_FINISH_CONFIG_INVALID/);n++;
assert.throws(()=>prepare(baseCfg,[h1("10.0.0.5",{lsAge:3600})],1),
  /OSPF_DD_FINISH_CONFIG_INVALID/);n++;
let m=prepare(cfgMaster,[],1);
eq(m.localTx.length,1,"master already has first local DD intent");
eq(m.localTx[0].sequence,9002,"first master DD is agreed+1");
eq(m.localTx[0].more,false,"empty frozen local summary -> M0");
eq(m.exchangeDone,false,"NegotiationDone is not ExchangeDone");
eq(inspectOspfDdFinishSession(m,state),null,"initial master ledger valid");
const mComplete=pass(receiveOspfDdFinishDescription(m,state,
  dd(cfgMaster,3000,{init:false,master:false,ddSequence:9002,more:false}),[]),
  "master final M0 acknowledged by slave final M0");
eq(mComplete.session.exchangeDone,true,"master ExchangeDone model evidence");
eq(events(mComplete,"DD_EXCHANGE_DONE_MODEL").length,1,"one completion event");
eq(events(mComplete,"DD_EMPTY_REQUESTS_UNVERIFIED").length,1,
  "empty requests cannot claim Full");
eq(events(mComplete,"DD_LOCAL_SUMMARY_TX_INTENT").length,0,"no phantom final DD");
eq(events(mComplete,"DD_NEW_TX_INTENT").length,0,
  "parent sidecar's mechanical extra new TX suppressed at finish");
m=mComplete.session;
eq(inspectOspfDdFinishSession(m,state),null,"closed master ledger valid");
const mDup=pass(receiveOspfDdFinishDescription(m,state,
  dd(cfgMaster,3200,{init:false,master:false,ddSequence:9002,more:false}),[]),
  "master duplicate last ack");
eq(mDup.session.exchangeDone,true,"duplicate preserves done");
eq(events(mDup,"DD_DUPLICATE_IGNORED").length,1,"master ignores duplicate");
eq(events(mDup,"DD_EXCHANGE_DONE_MODEL").length,0,"never repeat event");
deny(receiveOspfDdFinishDescription(mDup.session,state,
  dd(cfgMaster,3300,{init:false,master:false,ddSequence:9003,more:false}),[]),
  "OSPF_DD_FINISH_AFTER_DONE_UNMODELED");
const future=pass(advanceOspfDdFinishSession(mDup.session,state,6000),
  "virtual advance after completion");
eq(events(future,"DD_RETRANSMIT_INTENT").length,0,
  "stale parent's core retry hidden, not actual DD send");
eq(future.session.exchangeDone,true,"completion survives non-Dead time");

let masterMore=prepare(cfgMaster,[h1("10.0.0.8"),h1("10.0.0.9")],1);
eq(masterMore.localTx[0].headers.map(x=>x.linkStateId),["10.0.0.8"],
  "master page one local header");
eq(masterMore.localTx[0].more,true,"master has more local summaries");
const masterStep=pass(receiveOspfDdFinishDescription(masterMore,state,
  dd(cfgMaster,3000,{init:false,master:false,ddSequence:9002,more:false}),[]),
  "master has more local despite remote M0");
eq(masterStep.session.exchangeDone,false,"one side M1 prevents done");
eq(masterStep.session.localTx.length,2,"master sends second page");
eq(masterStep.session.localTx[1].sequence,9003,"master next DD seq");
eq(masterStep.session.localTx[1].more,false,"last master local header M0");
eq(masterStep.session.localTx[1].headers[0].linkStateId,"10.0.0.9",
  "last master header");
const masterEnd=pass(receiveOspfDdFinishDescription(masterStep.session,state,
  dd(cfgMaster,3500,{init:false,master:false,ddSequence:9003,more:false}),[]),
  "master last local DD acknowledged");
eq(masterEnd.session.exchangeDone,true,"master now completed both sequences");
eq(masterEnd.session.localTx.length,2,"no additional empty DD after done");
eq(events(masterEnd,"DD_EXCHANGE_DONE_MODEL").length,1,"completion exactly once");
let peerMore=prepare(cfgMaster,[],1);
const peerStep=pass(receiveOspfDdFinishDescription(peerMore,state,
  dd(cfgMaster,3000,{init:false,master:false,ddSequence:9002,more:true}),[]),
  "remote M1 after our local M0");
eq(peerStep.session.exchangeDone,false,"peer M1 prevents completion");
eq(peerStep.session.localTx.length,2,"new empty DD intent until peer finishes");
eq(peerStep.session.localTx[1].more,false,"never invent local summaries");
eq(peerStep.session.localTx[1].headers.length,0,"empty local subsequent DD");
const peerEnd=pass(receiveOspfDdFinishDescription(peerStep.session,state,
  dd(cfgMaster,3500,{init:false,master:false,ddSequence:9003,more:false}),[]),
  "peer M0 after correct reply");
eq(peerEnd.session.exchangeDone,true,"eventual master close");

let slave=prepare(baseCfg,[h1("10.0.0.7"),h1("10.0.0.8")],1);
eq(slave.localTx.length,0,"slave waits for new master Exchange DD");
let first=pass(receiveOspfDdFinishDescription(slave,state,
  dd(baseCfg,3000,{init:false,master:true,ddSequence:702,more:false}),[]),
  "slave first new master M0");
eq(first.session.exchangeDone,false,"slave local M1 prevents close");
eq(first.session.localTx.length,1,"slave sends one response");
eq(first.session.localTx[0].sequence,702,"slave echoes master sequence");
eq(first.session.localTx[0].more,true,"first slave response M1");
const duplicate=pass(receiveOspfDdFinishDescription(first.session,state,
  dd(baseCfg,3100,{init:false,master:true,ddSequence:702,more:false}),[]),
  "duplicate master DD");
eq(duplicate.session.localTx.length,1,"slave duplicate retransmits existing intent");
eq(events(duplicate,"DD_DUPLICATE_REPLY_INTENT").length,1,"RFC duplicate reply");
const second=pass(receiveOspfDdFinishDescription(duplicate.session,state,
  dd(baseCfg,3400,{init:false,master:true,ddSequence:703,more:false}),[]),
  "slave last local M0 after master's M0");
eq(second.session.exchangeDone,true,"slave ExchangeDone event after reply");
eq(second.session.localTx[1].more,false,"last local slave DD M0");
eq(second.session.localTx[1].sequence,703,"slave sequence copied");
eq(events(second,"DD_EXCHANGE_DONE_MODEL").length,1,"slave completion event");
eq(events(second,"DD_EMPTY_REQUESTS_UNVERIFIED").length,1,"Full deliberately not claimed");

let loading=prepare(baseCfg,[],1);
const remoteHeader=h1("10.0.0.12");
const received=pass(receiveOspfDdFinishDescription(loading,state,
  dd(baseCfg,3000,{init:false,master:true,ddSequence:702,more:false,
    lsaHeaderCount:1}),[remoteHeader]),"slave received last DD with one missing LSA");
eq(received.session.exchangeDone,true,"ExchangeDone may have missing LSA");
eq(received.session.summary.plan.requestIntents.length,1,"missing LSA request remains");
eq(events(received,"DD_LOADING_REQUIRED_MODEL").length,1,"LOADING required model event");
eq(events(received,"DD_EMPTY_REQUESTS_UNVERIFIED").length,0,
  "nonempty LSR cannot yield empty-requests status");
eq(inspectOspfDdFinishSession(received.session,state),null,"LSA snapshot bound to finish");

let invalid=prepare(baseCfg,[],1);
const firstM0=pass(receiveOspfDdFinishDescription(invalid,state,
  dd(baseCfg,3000,{init:false,master:true,ddSequence:702,more:false}),[]),
  "slave with empty local finishes on M0");
eq(firstM0.session.exchangeDone,true,"slave finishes immediately with both M0");
deny(receiveOspfDdFinishDescription(firstM0.session,state,
  dd(baseCfg,3200,{init:false,master:true,ddSequence:703,more:true}),[]),
  "OSPF_DD_FINISH_AFTER_DONE_UNMODELED");
let monotone=prepare(cfgMaster,[h1("10.0.0.8"),h1("10.0.0.9")],1);
const monoFirst=pass(receiveOspfDdFinishDescription(monotone,state,
  dd(cfgMaster,3000,{init:false,master:false,ddSequence:9002,more:false}),[]),
  "master peer M0 first");
deny(receiveOspfDdFinishDescription(monoFirst.session,state,
  dd(cfgMaster,3500,{init:false,master:false,ddSequence:9003,more:true}),[]),
  "OSPF_DD_FINISH_REMOTE_MORE_REGRESSION");
eq(monoFirst.session.localTx.length,2,"M regression rejection atomic");

eq(inspectOspfDdFinishSession({...masterEnd.session,localTx:[...masterEnd.session.localTx].reverse()},state),
  "OSPF_DD_FINISH_TX_LEDGER_INVALID","forged send order rejected");
eq(inspectOspfDdFinishSession({...masterEnd.session,exchangeDone:false},state),
  "OSPF_DD_FINISH_TX_LEDGER_INVALID","fake incomplete master ledger rejected");
eq(inspectOspfDdFinishSession({...second.session,
  localTx:[{...second.session.localTx[0],more:false},second.session.localTx[1]]},state),
  "OSPF_DD_FINISH_TX_LEDGER_INVALID","tampered M-bit rejected");
eq(inspectOspfDdFinishSession({...m,localTx:[{...m.localTx[0],
  headers:[h1("10.0.0.99")]}]},state),
  "OSPF_DD_FINISH_TX_LEDGER_INVALID","forged local header rejected");

const oneWay=pass(receiveOspfDdFinishHello(received.session,state,
  hello(baseCfg,4000,false)),"one-way Hello tear-down");
eq(oneWay.session.summary.exchange.dd.phase,"IDLE","one-way phase idle");
eq(oneWay.session.localTx.length,0,"clear past local DD sends");
eq(oneWay.session.exchangeDone,false,"no stale Done state");
eq(events(oneWay,"DD_FINISH_DISCARDED").length,1,"explicit reset trace");
const timer=pass(advanceOspfDdFinishSession(received.session,state,41000),
  "Dead timer expiration");
eq(timer.session.localTx.length,0,"Dead resets local summaries");
eq(timer.session.exchangeDone,false,"Dead invalidates completion");
deny(advanceOspfDdFinishSession(received.session,{...state,stateRevision:1},4100),
  "SIM_CLOCK_STALE_REVISION");
eq(state.stateRevision,0,"no Engine revision changes");
eq(queryReachability(scenario,state,"attacker","rds01","tcp",3389).truth,
  originalTruth.truth,"no topology/routing truth modifications");

deny(receiveOspfDdFinishDescription(oneWay.session,state,
  dd(baseCfg,4500,{init:true,master:true,more:true,ddSequence:800}),[]),
  "OSPF_EXCHANGE_NEIGHBOR_NOT_READY");
eq(oneWay.session.summary.exchange.dd.phase,"IDLE","no resurrection without 2-way");

function replay() {
  let x=prepare(baseCfg,[h1("10.0.0.7"),h1("10.0.0.8")],1);
  const history=[];
  function step(result){if(!result.ok)throw Error(result.code);
    x=result.session;history.push(...result.events);}
  step(receiveOspfDdFinishDescription(x,state,
    dd(baseCfg,3000,{init:false,master:true,ddSequence:702,more:true}),[]));
  step(receiveOspfDdFinishDescription(x,state,
    dd(baseCfg,3100,{init:false,master:true,ddSequence:702,more:true}),[]));
  step(receiveOspfDdFinishDescription(x,state,
    dd(baseCfg,3400,{init:false,master:true,ddSequence:703,more:false}),[]));
  step(receiveOspfDdFinishHello(x,state,hello(baseCfg,3600)));
  step(advanceOspfDdFinishSession(x,state,4000));
  step(receiveOspfDdFinishHello(x,state,hello(baseCfg,4100,false)));
  return JSON.stringify({x,history,revision:state.stateRevision});
}
const expected=replay();
for(let i=0;i<1000;i++) eq(replay(),expected,"1000 byte-identical M-bit completion replays");
console.log("PASS CONVERGENCE OSPFv2 DD M-bit ExchangeDone: "+n+" assertions; 1000 identical replays");
