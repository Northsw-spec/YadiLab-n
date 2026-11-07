import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createInitialEngineState, queryReachability,
  createOspfP2pExchangeSession, inspectOspfP2pExchangeSession,
  advanceOspfP2pExchangeSession, receiveOspfP2pExchangeHello,
  receiveOspfP2pExchangeDescription,
} from "../../dist-engine-test/engine/src/index.js";

const base=JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-normalized.json","utf8"));
const router=id=>({id,type:"network.router",label:id,interfaces:[],properties:{},asset:{id:"network.router",version:"1.0.0"}});
const scenario={...base,scenarioId:"ospfv2-dd-exchange-tests",sourceHash:"e".repeat(64),
  resources:[...base.resources,router("dd-a"),router("dd-b")]};
const state=createInitialEngineState(scenario);
const cfg={localResourceId:"dd-a",remoteResourceId:"dd-b",localRouterId:"10.0.0.1",
  remoteRouterId:"10.0.0.2",areaId:"0.0.0.0",helloIntervalMs:10000,deadIntervalMs:40000,
  localInterfaceMtu:1500,initialDdSequence:9001,rxmtIntervalMs:2000};
const hello=(c,time,twoWay=true)=>({atMs:time,senderRouterId:c.remoteRouterId,
  areaId:c.areaId,helloIntervalMs:c.helloIntervalMs,deadIntervalMs:c.deadIntervalMs,
  seenRouterIds:twoWay?[c.localRouterId]:[]});
const dd=(c,time,extra={})=>({atMs:time,senderRouterId:c.remoteRouterId,areaId:c.areaId,
  interfaceMtu:1500,options:2,init:true,more:true,master:true,ddSequence:701,
  lsaHeaderCount:0,...extra});
let checks=0;
function eq(x,y,label){assert.deepEqual(x,y,label);checks++;}
function good(result,label){eq(result.ok,true,label);return result;}
function bad(result,code){eq(result.ok,false,"fail-closed "+code);eq(result.code,code,"error "+code);}
function trace(result,kind){return result.events.filter(x=>x.kind===kind);}
function start(c=cfg) {
  let session=createOspfP2pExchangeSession(state,c);
  session=good(advanceOspfP2pExchangeSession(session,state,0),"initial Hello tick").session;
  session=good(receiveOspfP2pExchangeHello(session,state,hello(c,1000)),"two-way Hello").session;
  eq(session.dd.phase,"EXSTART","two-way enters ExStart");
  return session;
}
const truth=queryReachability(scenario,state,"attacker","rds01","tcp",3389);
assert.throws(()=>createOspfP2pExchangeSession(state,{...cfg,rxmtIntervalMs:0}),/OSPF_EXCHANGE_CONFIG_INVALID/);checks++;
assert.throws(()=>createOspfP2pExchangeSession(state,{...cfg,rxmtIntervalMs:1001}),/OSPF_EXCHANGE_CONFIG_INVALID/);checks++;
assert.throws(()=>createOspfP2pExchangeSession(state,{...cfg,rxmtIntervalMs:61000}),/OSPF_EXCHANGE_CONFIG_INVALID/);checks++;

let slave=start();
bad(receiveOspfP2pExchangeDescription(slave,state,dd(cfg,1100,{lsaHeaderCount:2})),"OSPF_EXCHANGE_LSA_HEADERS_UNMODELED");
bad(receiveOspfP2pExchangeDescription(slave,state,dd(cfg,1100,{interfaceMtu:9000})),"OSPF_EXCHANGE_MTU_REJECTED");
const negotiated=good(receiveOspfP2pExchangeDescription(slave,state,dd(cfg,2000)),"remote higher RID as master");
slave=negotiated.session;
eq(slave.dd.phase,"EXCHANGE","NegotiationDone is Exchange only");
eq(slave.exchange.role,"SLAVE","local lower RID slave");
eq(slave.exchange.sequence,701,"adopt remote sequence");
eq(slave.exchange.nextRetransmitAtMs,undefined,"slave has no retransmission timer");
eq(trace(negotiated,"DD_NEW_TX_INTENT")[0].sequence,701,"slave replies once");
eq(inspectOspfP2pExchangeSession(slave,state),null,"valid slave session");
const repeat=good(receiveOspfP2pExchangeDescription(slave,state,dd(cfg,2500)),"duplicate initial master DD");
eq(trace(repeat,"DD_DUPLICATE_REPLY_INTENT").length,1,"slave resends prior reply");
eq(repeat.session.exchange.sequence,701,"duplicate never increments sequence");
slave=repeat.session;
const nextMaster=dd(cfg,3000,{init:false,master:true,ddSequence:702});
const progressed=good(receiveOspfP2pExchangeDescription(slave,state,nextMaster),"master next sequence");
eq(progressed.session.exchange.sequence,702,"slave copies master's next sequence");
eq(progressed.session.exchange.accepted,1,"one new empty DD accepted");
eq(trace(progressed,"DD_NEW_TX_INTENT")[0].sequence,702,"slave replies with same sequence");
slave=progressed.session;
const repeatTwo=good(receiveOspfP2pExchangeDescription(slave,state,dd(cfg,3100,{init:false,master:true,ddSequence:702})),"duplicate new DD");
eq(trace(repeatTwo,"DD_DUPLICATE_REPLY_INTENT").length,1,"slave repeats most recent response");
eq(repeatTwo.session.exchange.accepted,1,"duplicate does not alter accepted counter");
slave=repeatTwo.session;
const before=JSON.stringify(slave);
bad(receiveOspfP2pExchangeDescription(slave,state,dd(cfg,3200,{init:false,master:true,ddSequence:703,lsaHeaderCount:1})),
    "OSPF_EXCHANGE_LSA_HEADERS_UNMODELED");
bad(receiveOspfP2pExchangeDescription(slave,state,dd(cfg,3200,{init:false,master:true,ddSequence:703,interfaceMtu:2000})),
    "OSPF_EXCHANGE_MTU_REJECTED");
bad(receiveOspfP2pExchangeDescription(slave,state,dd(cfg,3200,{init:3})),
    "OSPF_EXCHANGE_PACKET_INVALID");
eq(JSON.stringify(slave),before,"invalid packets never mutate source");
const mismatch=good(receiveOspfP2pExchangeDescription(slave,state,
  dd(cfg,3300,{init:false,master:true,ddSequence:703,options:3})),"options mismatch");
eq(trace(mismatch,"DD_SEQUENCE_MISMATCH_RESET").length,1,"explicit RFC mismatch trace");
eq(mismatch.session.dd.phase,"EXSTART","mismatch tears Exchange down");
eq(mismatch.session.exchange,undefined,"stale slave exchange ledger cleared");
eq(mismatch.session.dd.initialDdSequence,cfg.initialDdSequence+1,"DD initial sequence increments on mismatch");
eq(trace(mismatch,"DD_INITIAL_TX_INTENT").length,1,"new ExStart intent");
const rejoined=good(receiveOspfP2pExchangeDescription(mismatch.session,state,dd(cfg,3400,{ddSequence:704})),"new exchange negotiation");
eq(rejoined.session.exchange.sequence,704,"new remote sequence after reset");
const down=good(advanceOspfP2pExchangeSession(rejoined.session,state,41000),"Dead timer");
eq(down.session.dd.phase,"IDLE","inactivity resets DD phase");
eq(down.session.exchange,undefined,"inactivity clears exchange ledger");
bad(receiveOspfP2pExchangeDescription(down.session,state,dd(cfg,41000)),"OSPF_EXCHANGE_NEIGHBOR_NOT_READY");
const restarted=good(receiveOspfP2pExchangeHello(rejoined.session,state,hello(cfg,42000)),"dead then recovery");
eq(restarted.session.dd.phase,"EXSTART","recovery must renegotiate");
eq(restarted.session.exchange,undefined,"recovery never keeps stale sequence ledger");
const oneWay=good(receiveOspfP2pExchangeHello(slave,state,hello(cfg,3400,false)),"one-way fallback");
eq(oneWay.session.dd.phase,"IDLE","one-way destroys Exchange");
eq(oneWay.session.exchange,undefined,"one-way clears sequence");
bad(advanceOspfP2pExchangeSession(slave,{...state,stateRevision:1},3400),"SIM_CLOCK_STALE_REVISION");
eq(inspectOspfP2pExchangeSession({...slave,exchange:{...slave.exchange,sequence:999}},state),
   "OSPF_EXCHANGE_LEDGER_INVALID","reject forged sequence");
eq(inspectOspfP2pExchangeSession({...slave,exchange:{...slave.exchange,lastReceived:{...slave.exchange.lastReceived,options:3}}},state),
   "OSPF_EXCHANGE_LEDGER_INVALID","reject forged packet options");
eq(inspectOspfP2pExchangeSession({...slave,exchange:{...slave.exchange,retransmissions:3}},state),
   "OSPF_EXCHANGE_LEDGER_INVALID","slave cannot forge retransmission timer count");

const masterCfg={...cfg,localRouterId:"10.0.0.2",remoteRouterId:"10.0.0.1"};
let master=start(masterCfg);
const masterAck=dd(masterCfg,2000,{init:false,master:false,ddSequence:9001});
const m0=good(receiveOspfP2pExchangeDescription(master,state,masterAck),"master negotiation");
master=m0.session;
eq(master.exchange.role,"MASTER","local higher Router ID master");
eq(master.exchange.sequence,9002,"master sends next sequence");
eq(master.exchange.nextRetransmitAtMs,4000,"master owns only retransmission timer");
eq(trace(m0,"DD_NEW_TX_INTENT")[0].sequence,9002,"master sends empty synthetic intent");
const beforeTimer=good(advanceOspfP2pExchangeSession(master,state,3999),"before RxmtInterval");
eq(trace(beforeTimer,"DD_RETRANSMIT_INTENT").length,0,"no early retransmit");
const timed=good(advanceOspfP2pExchangeSession(master,state,6000),"two exact retry deadlines");
eq(trace(timed,"DD_RETRANSMIT_INTENT").map(x=>x.atMs),[4000,6000],"retry every 2000 ms");
eq(timed.session.exchange.sequence,9002,"retries preserve DD sequence");
eq(timed.session.exchange.retransmissions,2,"bounded replay counter");
master=timed.session;
const ack=good(receiveOspfP2pExchangeDescription(master,state,
  dd(masterCfg,6500,{init:false,master:false,ddSequence:9002})),"slave echoes current seq");
eq(ack.session.exchange.sequence,9003,"new master seq only after ack");
eq(ack.session.exchange.accepted,1,"one new ack accepted");
eq(ack.session.exchange.nextRetransmitAtMs,8500,"new deadline follows new intent");
eq(trace(ack,"DD_NEW_TX_INTENT")[0].sequence,9003,"next master intent");
master=ack.session;
const dupAck=good(receiveOspfP2pExchangeDescription(master,state,
  dd(masterCfg,6600,{init:false,master:false,ddSequence:9002})),"repeat last ack");
eq(trace(dupAck,"DD_DUPLICATE_IGNORED").length,1,"master discards duplicate");
eq(dupAck.session.exchange.sequence,9003,"duplicate does not advance sequence");
master=dupAck.session;
const seqMismatch=good(receiveOspfP2pExchangeDescription(master,state,
  dd(masterCfg,6700,{init:false,master:false,ddSequence:9006})),"wrong ack sequence");
eq(seqMismatch.session.dd.phase,"EXSTART","sequence mismatch resets ExStart");
eq(seqMismatch.session.exchange,undefined,"sequence mismatch destroys outstanding TX");
eq(trace(seqMismatch,"DD_SEQUENCE_MISMATCH_RESET").length,1,"sequence mismatch explicitly traced");
const newMaster=good(receiveOspfP2pExchangeDescription(seqMismatch.session,state,
  dd(masterCfg,6800,{init:false,master:false,ddSequence:9002})),"new master negotiation after reset");
eq(newMaster.session.exchange.sequence,9003,"new initial DD sequence used");

const exhausted=start({...masterCfg,initialDdSequence:0xffffffff});
bad(receiveOspfP2pExchangeDescription(exhausted,state,
  dd(masterCfg,2000,{init:false,master:false,ddSequence:0xffffffff})),
  "OSPF_EXCHANGE_SEQUENCE_OVERFLOW");
const longCfg={...masterCfg,rxmtIntervalMs:1000,deadIntervalMs:900000};
let long=start(longCfg);
long=good(receiveOspfP2pExchangeDescription(long,state,
  dd(longCfg,2000,{init:false,master:false,ddSequence:9001})),"long-dead master").session;
bad(advanceOspfP2pExchangeSession(long,state,100000),"OSPF_EXCHANGE_ADVANCE_LIMIT");
eq(long.exchange.retransmissions,0,"over-budget advance is fully atomic");
eq(state.stateRevision,0,"no Engine mutations");
eq(state.resources["dd-a"].properties,{},"no router property modifications");
eq(queryReachability(scenario,state,"attacker","rds01","tcp",3389).truth,truth.truth,"Engine network truth unchanged");

function replay() {
  let s=startReplay();
  const events=[];
  function apply(r){if(!r.ok)throw Error(r.code);s=r.session;events.push(...r.events);}
  apply(receiveOspfP2pExchangeDescription(s,state,dd(cfg,2000)));
  apply(receiveOspfP2pExchangeDescription(s,state,dd(cfg,2200)));
  apply(receiveOspfP2pExchangeDescription(s,state,dd(cfg,2800,{init:false,master:true,ddSequence:702})));
  apply(receiveOspfP2pExchangeHello(s,state,hello(cfg,3000)));
  apply(advanceOspfP2pExchangeSession(s,state,43000));
  apply(receiveOspfP2pExchangeHello(s,state,hello(cfg,44000)));
  apply(receiveOspfP2pExchangeDescription(s,state,dd(cfg,45000,{ddSequence:750})));
  return JSON.stringify({s,events,revision:state.stateRevision});
}
function startReplay(){
  let s=createOspfP2pExchangeSession(state,cfg);
  let t=advanceOspfP2pExchangeSession(s,state,0);if(!t.ok)throw Error(t.code);s=t.session;
  t=receiveOspfP2pExchangeHello(s,state,hello(cfg,1000));if(!t.ok)throw Error(t.code);
  return t.session;
}
const reference=replay();
for(let i=0;i<1000;i++)eq(replay(),reference,"1000 byte-identical DD Exchange replays");
console.log("PASS CONVERGENCE OSPFv2 P2P DD Exchange: "+checks+" assertions; 1000 identical replays");
