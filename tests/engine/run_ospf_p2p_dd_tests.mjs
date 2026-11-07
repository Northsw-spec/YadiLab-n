import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createInitialEngineState, queryReachability,
  createOspfP2pDdSession, inspectOspfP2pDdSession,
  receiveOspfP2pDdHello, receiveOspfP2pDdDescription, advanceOspfP2pDdSession,
} from "../../dist-engine-test/engine/src/index.js";

const baseline = JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-normalized.json", "utf8"));
const router = (id) => ({
  id, type:"network.router", label:id, interfaces:[], properties:{},
  asset:{id:"network.router",version:"1.0.0"},
});
const scenario = { ...baseline, scenarioId:"ospf-p2p-dd-negotiation-fixture",
  sourceHash:"a".repeat(64),
  resources:[...baseline.resources,router("dd-router-a"),router("dd-router-b")] };
const state = createInitialEngineState(scenario);
const cfg = {
  localResourceId:"dd-router-a",remoteResourceId:"dd-router-b",
  localRouterId:"10.0.0.1",remoteRouterId:"10.0.0.2",
  areaId:"0.0.0.0",helloIntervalMs:10000,deadIntervalMs:40000,
  localInterfaceMtu:1500,initialDdSequence:9001,
};
let count=0;
const eq=(a,b,why)=>{assert.deepEqual(a,b,why);count++;};
const ok=(r,why)=>{eq(r.ok,true,why);return r;};
const denied=(r,code)=>{eq(r.ok,false,"deny "+code);eq(r.code,code,"error "+code);};
const hello=(config,time,seen=[])=>({
  atMs:time,senderRouterId:config.remoteRouterId,areaId:config.areaId,
  helloIntervalMs:config.helloIntervalMs,deadIntervalMs:config.deadIntervalMs,
  seenRouterIds:seen,
});
const dd=(config,time,overrides={})=>({
  atMs:time,senderRouterId:config.remoteRouterId,areaId:config.areaId,
  interfaceMtu:1500,options:2,init:true,more:true,master:true,
  ddSequence:701,lsaHeaderCount:0,...overrides,
});
const truth=queryReachability(scenario,state,"attacker","rds01","tcp",3389);
assert.throws(()=>createOspfP2pDdSession(state,{...cfg,initialDdSequence:-1}),/OSPF_DD_CONFIG_INVALID/);count++;
assert.throws(()=>createOspfP2pDdSession(state,{...cfg,initialDdSequence:2**32}),/OSPF_DD_CONFIG_INVALID/);count++;
assert.throws(()=>createOspfP2pDdSession(state,{...cfg,localInterfaceMtu:0}),/OSPF_DD_CONFIG_INVALID/);count++;
assert.throws(()=>createOspfP2pDdSession(state,{...cfg,localResourceId:"attacker"}),/OSPF_P2P_CONFIG_INVALID/);count++;
let s=createOspfP2pDdSession(state,cfg);
eq(s.phase,"IDLE","initially no neighbor or DD");
eq(inspectOspfP2pDdSession(s,state),null,"initial state valid");
denied(receiveOspfP2pDdDescription(s,state,dd(cfg,0)),"OSPF_DD_NEIGHBOR_NOT_READY");
s=ok(advanceOspfP2pDdSession(s,state,0),"initial Hello tick").session;
const init=ok(receiveOspfP2pDdHello(s,state,hello(cfg,500)),"one-way Hello");
eq(init.session.phase,"IDLE","one-way cannot negotiate");
eq(init.session.hello.neighborState,"INIT","Hello sidecar remains source of Init");
s=ok(receiveOspfP2pDdHello(init.session,state,hello(cfg,1000,[cfg.localRouterId])),"two-way Hello").session;
eq(s.phase,"EXSTART","two-way starts DD negotiation");
const entering=ok(receiveOspfP2pDdHello(init.session,state,hello(cfg,1000,[cfg.localRouterId])),"initial intent evidence");
eq(entering.events.some(x=>x.kind==="DD_INITIAL_TX_INTENT"),true,"only intent, not network packet");
eq(inspectOspfP2pDdSession(s,state),null,"ExStart session valid");
denied(receiveOspfP2pDdDescription(s,state,dd(cfg,1000,{senderRouterId:"10.0.0.3"})),"OSPF_DD_PACKET_MISMATCH");
denied(receiveOspfP2pDdDescription(s,state,dd(cfg,1000,{areaId:"0.0.0.1"})),"OSPF_DD_PACKET_MISMATCH");
denied(receiveOspfP2pDdDescription(s,state,dd(cfg,1000,{interfaceMtu:9000})),"OSPF_DD_MTU_REJECTED");
denied(receiveOspfP2pDdDescription(s,state,dd(cfg,1000,{interfaceMtu:0})),"OSPF_DD_PACKET_INVALID");
denied(receiveOspfP2pDdDescription(s,state,dd(cfg,1000,{options:256})),"OSPF_DD_PACKET_INVALID");
denied(receiveOspfP2pDdDescription(s,state,dd(cfg,1000,{ddSequence:2**32})),"OSPF_DD_PACKET_INVALID");
denied(receiveOspfP2pDdDescription(s,state,dd(cfg,1000,{init:"true"})),"OSPF_DD_PACKET_INVALID");
denied(receiveOspfP2pDdDescription(s,state,dd(cfg,1000,{lsaHeaderCount:1})),"OSPF_DD_HEADERS_UNMODELED");
denied(receiveOspfP2pDdDescription(s,state,dd(cfg,1000,{more:false})),"OSPF_DD_NEGOTIATION_NOT_MATCHED");
denied(receiveOspfP2pDdDescription(s,state,dd(cfg,1000,{master:false})),"OSPF_DD_NEGOTIATION_NOT_MATCHED");
denied(receiveOspfP2pDdDescription(s,state,dd(cfg,999)),"OSPF_DD_PACKET_INVALID");
eq(s.phase,"EXSTART","rejects do not mutate DD state");
const rx=ok(receiveOspfP2pDdDescription(s,state,dd(cfg,2000)),"remote higher Router ID elected master");
eq(rx.session.phase,"EXCHANGE","only NegotiationDone reaches Exchange");
eq(rx.session.negotiated.role,"SLAVE","local lower RID is slave");
eq(rx.session.negotiated.agreedSequence,701,"slave adopts remote DD sequence");
eq(rx.events.at(-1).kind,"DD_NEGOTIATION_DONE","negotiation trace explicit");
eq(inspectOspfP2pDdSession(rx.session,state),null,"receipt validates after negotiation");
denied(receiveOspfP2pDdDescription(rx.session,state,dd(cfg,2500)),"OSPF_DD_EXCHANGE_UNMODELED");
const keep=ok(receiveOspfP2pDdHello(rx.session,state,hello(cfg,3000,[cfg.localRouterId])),"continued two-way Hello");
eq(keep.session.phase,"EXCHANGE","subsequent Hello preserves negotiated phase");
eq(keep.session.negotiated.role,"SLAVE","receipt persists on healthy Hello");
const lost=ok(receiveOspfP2pDdHello(keep.session,state,hello(cfg,3500)),"one-way fallback");
eq(lost.session.phase,"IDLE","one-way destroys DD negotiation");
eq(lost.session.negotiated,undefined,"clear stale DD receipt on one-way");
eq(lost.session.hello.neighborState,"INIT","parent state resets to INIT");
const restarted=ok(receiveOspfP2pDdHello(lost.session,state,hello(cfg,4000,[cfg.localRouterId])),"new bidirectional Hello");
eq(restarted.session.phase,"EXSTART","fresh ExStart after one-way");
eq(restarted.events.at(-1).kind,"DD_INITIAL_TX_INTENT","new initial DD intent");
const atDeadline=ok(advanceOspfP2pDdSession(keep.session,state,43000),"inactivity after latest Hello at 3000");
eq(atDeadline.session.phase,"IDLE","dead timer discards exchange");
eq(atDeadline.session.negotiated,undefined,"dead clears receipt");
eq(atDeadline.session.hello.neighborState,"DOWN","inactivity drives parent DOWN");
denied(receiveOspfP2pDdDescription(atDeadline.session,state,dd(cfg,43000)),"OSPF_DD_NEIGHBOR_NOT_READY");
const recovered=ok(receiveOspfP2pDdHello(keep.session,state,hello(cfg,44000,[cfg.localRouterId])),"expire before future recovery Hello");
eq(recovered.session.phase,"EXSTART","expired negotiation cannot survive new Hello");
eq(recovered.session.negotiated,undefined,"same-call dead and recovery drops receipt");
eq(recovered.events.some(x=>x.kind==="INACTIVITY_EXPIRED"),true,"explicit deadline trace");
eq(recovered.events.at(-1).kind,"DD_INITIAL_TX_INTENT","new intent after expiration");
eq(inspectOspfP2pDdSession({...rx.session,negotiated:{...rx.session.negotiated,role:"MASTER"}},state),
   "OSPF_DD_RECEIPT_INVALID","reject forged role");
eq(inspectOspfP2pDdSession({...rx.session,negotiated:{...rx.session.negotiated,agreedSequence:999}},state),
   "OSPF_DD_RECEIPT_INVALID","reject forged DD sequence");
eq(inspectOspfP2pDdSession({...rx.session,phase:"IDLE"},state),
   "OSPF_DD_STATE_INVALID","reject fake idle with active neighbor");
denied(advanceOspfP2pDdSession(rx.session,{...state,stateRevision:1},3000),"SIM_CLOCK_STALE_REVISION");
eq(state.stateRevision,0,"no Engine writes");
eq(state.resources["dd-router-a"].properties,{},"no changes to router properties");
eq(queryReachability(scenario,state,"attacker","rds01","tcp",3389).truth,truth.truth,"original reachability unchanged");

const masterCfg={...cfg,localRouterId:cfg.remoteRouterId,remoteRouterId:cfg.localRouterId};
let m=createOspfP2pDdSession(state,masterCfg);
m=ok(receiveOspfP2pDdHello(m,state,hello(masterCfg,1000,[masterCfg.localRouterId])),"master initial two-way").session;
denied(receiveOspfP2pDdDescription(m,state,dd(masterCfg,1100,{init:false,master:false,ddSequence:9002})),
       "OSPF_DD_NEGOTIATION_NOT_MATCHED");
denied(receiveOspfP2pDdDescription(m,state,dd(masterCfg,1100,{init:true,master:true,ddSequence:9001})),
       "OSPF_DD_NEGOTIATION_NOT_MATCHED");
const master=ok(receiveOspfP2pDdDescription(m,state,
  dd(masterCfg,1200,{init:false,more:true,master:false,ddSequence:9001})),"remote lower RID acknowledges local sequence");
eq(master.session.phase,"EXCHANGE","master also reaches Exchange");
eq(master.session.negotiated.role,"MASTER","higher local Router ID is master");
eq(master.session.negotiated.agreedSequence,9001,"master preserves own DD sequence");

function replay() {
  let current=createOspfP2pDdSession(state,cfg);
  const trace=[];
  const apply=(r)=>{if(!r.ok) throw Error(r.code);current=r.session;trace.push(...r.events);};
  apply(advanceOspfP2pDdSession(current,state,0));
  apply(receiveOspfP2pDdHello(current,state,hello(cfg,1000,[cfg.localRouterId])));
  apply(receiveOspfP2pDdDescription(current,state,dd(cfg,2000)));
  apply(receiveOspfP2pDdHello(current,state,hello(cfg,8000,[cfg.localRouterId])));
  apply(advanceOspfP2pDdSession(current,state,48000));
  apply(receiveOspfP2pDdHello(current,state,hello(cfg,49000,[cfg.localRouterId])));
  apply(receiveOspfP2pDdDescription(current,state,dd(cfg,49500,{ddSequence:702})));
  apply(receiveOspfP2pDdHello(current,state,hello(cfg,50000)));
  return JSON.stringify({current,trace,revision:state.stateRevision});
}
const expected=replay();
for(let n=0;n<1000;n++)eq(replay(),expected,"1000 byte-identical negotiation replays");
console.log("PASS CONVERGENCE OSPFv2 P2P DD ExStart: "+count+" assertions, 1000 identical replays");
