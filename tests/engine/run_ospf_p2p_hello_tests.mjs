import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createInitialEngineState, queryReachability,
  createOspfP2pSession, inspectOspfP2pSession,
  advanceOspfP2pSession, receiveOspfP2pHello,
} from "../../dist-engine-test/engine/src/index.js";

const base = JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-normalized.json", "utf8"));
const router = (id) => ({
  id, type: "network.router", label:id, interfaces:[], properties:{},
  asset:{id:"network.router",version:"1.0.0"},
});
const scenario = { ...base, scenarioId:"ospfv2-p2p-test", sourceHash:"b".repeat(64),
  resources:[...base.resources,router("router-a"),router("router-b")] };
const engine = createInitialEngineState(scenario);
const cfg = {
  localResourceId:"router-a",remoteResourceId:"router-b",
  localRouterId:"10.0.0.1",remoteRouterId:"10.0.0.2",
  areaId:"0.0.0.0",helloIntervalMs:10000,deadIntervalMs:40000,
};
let assertions=0;
function eq(got,expected,why){assert.deepEqual(got,expected,why);assertions++;}
function good(result,label){eq(result.ok,true,label);return result;}
function denied(result,code){eq(result.ok,false,"reject "+code);eq(result.code,code,"diagnostic code");}
function observed(atMs,seenRouterIds=[]){return {atMs, senderRouterId:cfg.remoteRouterId,
  areaId:cfg.areaId, helloIntervalMs:cfg.helloIntervalMs,
  deadIntervalMs:cfg.deadIntervalMs,seenRouterIds};}
const truthBefore=queryReachability(scenario,engine,"attacker","rds01","tcp",3389);
assert.throws(()=>createOspfP2pSession(engine,{...cfg,localResourceId:"attacker"}),/OSPF_P2P_CONFIG_INVALID/);assertions++;
assert.throws(()=>createOspfP2pSession(engine,{...cfg,remoteResourceId:"missing"}),/OSPF_P2P_CONFIG_INVALID/);assertions++;
assert.throws(()=>createOspfP2pSession(engine,{...cfg,remoteRouterId:cfg.localRouterId}),/OSPF_P2P_CONFIG_INVALID/);assertions++;
assert.throws(()=>createOspfP2pSession(engine,{...cfg,areaId:"999.0.0.0"}),/OSPF_P2P_CONFIG_INVALID/);assertions++;
assert.throws(()=>createOspfP2pSession(engine,{...cfg,deadIntervalMs:cfg.helloIntervalMs}),/OSPF_P2P_CONFIG_INVALID/);assertions++;
assert.throws(()=>createOspfP2pSession(engine,{...cfg,helloIntervalMs:1500}),/OSPF_P2P_CONFIG_INVALID/);assertions++;

const baseSession=createOspfP2pSession(engine,cfg);
eq(baseSession.neighborState,"DOWN","initial neighbor down");
eq(baseSession.clock.pending.map(x=>x.kind),["OSPF_HELLO_TX"],"one local Hello timer");
eq(inspectOspfP2pSession(baseSession,engine),null,"initial source and timer ownership valid");
const initial=good(advanceOspfP2pSession(baseSession,engine,0),"first synthetic tick");
eq(initial.events.map(e=>e.kind),["HELLO_TX_INTENT"],"intent not network packet");
eq(initial.session.clock.pending[0].atMs,10000,"Hello periodicity");
eq(baseSession.clock.nowMs,0,"input immutable");
denied(advanceOspfP2pSession(initial.session,engine,-1),"OSPF_P2P_TIME_INVALID");
denied(advanceOspfP2pSession(initial.session,{...engine,stateRevision:1},1000),"SIM_CLOCK_STALE_REVISION");
denied(advanceOspfP2pSession(initial.session,{...engine,scenarioHash:"foreign"},1000),"SIM_CLOCK_SOURCE_MISMATCH");
denied(receiveOspfP2pHello(initial.session,engine,{...observed(1000),senderRouterId:"10.0.0.3"}),"OSPF_P2P_HELLO_MISMATCH");
denied(receiveOspfP2pHello(initial.session,engine,{...observed(1000),deadIntervalMs:30000}),"OSPF_P2P_HELLO_MISMATCH");
denied(receiveOspfP2pHello(initial.session,engine,{...observed(1000),areaId:"1.0.0.0"}),"OSPF_P2P_HELLO_MISMATCH");
denied(receiveOspfP2pHello(initial.session,engine,{...observed(1000),seenRouterIds:["10.0.0.1","10.0.0.1"]}),"OSPF_P2P_HELLO_INVALID");
denied(receiveOspfP2pHello(initial.session,engine,{...observed(1000),seenRouterIds:["bad"]}),"OSPF_P2P_HELLO_INVALID");
denied(receiveOspfP2pHello(initial.session,engine,{...observed(1000),atMs:0.2}),"OSPF_P2P_HELLO_INVALID");
eq(initial.session.neighborState,"DOWN","rejected Hellos never change state");

const one=good(receiveOspfP2pHello(initial.session,engine,observed(1000)),"receive one-way Hello");
eq(one.session.neighborState,"INIT","one-way only INIT");
eq(one.session.deadAtMs,41000,"first inactivity deadline");
eq(one.session.clock.pending.filter(x=>x.kind==="OSPF_NEIGHBOR_DEAD").length,1,"only one inactivity timer");
const two=good(receiveOspfP2pHello(one.session,engine,observed(3000,[cfg.localRouterId])),"receive two-way");
eq(two.session.neighborState,"EXSTART","P2P starts adjacency negotiation; not FULL");
eq(two.session.deadAtMs,43000,"reset dead timer on accepted Hello");
eq(two.session.clock.pending.filter(x=>x.kind==="OSPF_NEIGHBOR_DEAD").length,1,"old dead timer canceled");
const keep=good(advanceOspfP2pSession(two.session,engine,42000),"tick without neighbor expiration");
eq(keep.session.neighborState,"EXSTART","neighbor remains up before deadline");
eq(keep.events.filter(x=>x.kind==="HELLO_TX_INTENT").map(x=>x.atMs),[10000,20000,30000,40000],"periodic synthetic Hello intent");
eq(keep.events.some(x=>x.kind==="INACTIVITY_EXPIRED"),false,"stale dead timer never expires");
const expire=good(advanceOspfP2pSession(keep.session,engine,43000),"deadline is inclusive");
eq(expire.session.neighborState,"DOWN","Dead timer takes neighbor Down");
eq(expire.session.lastHelloAtMs,undefined,"expiration clears receipt timestamp");
eq(expire.session.clock.pending.filter(x=>x.kind==="OSPF_NEIGHBOR_DEAD").length,0,"dead timer removed after firing");
eq(expire.events.map(x=>x.kind),["INACTIVITY_EXPIRED"],"explicit expiration trace");
const recover=good(receiveOspfP2pHello(expire.session,engine,observed(44000,[cfg.localRouterId])),"new synthetic two-way Hello after dead");
eq(recover.session.neighborState,"EXSTART","recovery re-enters adjacency attempt");
eq(recover.session.deadAtMs,84000,"recovered timer");
const oneWay=good(receiveOspfP2pHello(recover.session,engine,observed(45000,[])),"one-way regression");
eq(oneWay.session.neighborState,"INIT","loss of bidirectionality reverts to INIT");
eq(queryReachability(scenario,engine,"attacker","rds01","tcp",3389).truth,truthBefore.truth,"Engine truth unchanged");
eq(engine.stateRevision,0,"no Engine revision or routing mutation");
eq(engine.resources["router-a"].properties,{},"no router property mutation");
eq(inspectOspfP2pSession({...two.session,deadAtMs:50000},engine),"OSPF_P2P_TIMER_OWNERSHIP_INVALID","reject forged expiry");
eq(inspectOspfP2pSession({...two.session,neighborState:"DOWN"},engine),"OSPF_P2P_TIMER_OWNERSHIP_INVALID","reject fake DOWN with active timer");
eq(inspectOspfP2pSession({...two.session,clock:{...two.session.clock,pending:two.session.clock.pending.map(x=>x.kind==="OSPF_NEIGHBOR_DEAD"?{...x,kind:"OTHER"}:x)}},engine),"OSPF_P2P_TIMER_OWNERSHIP_INVALID","reject foreign timer");
eq(inspectOspfP2pSession({...two.session,nextHelloOrdinal:50},engine),"OSPF_P2P_TIMER_OWNERSHIP_INVALID","reject incorrect scheduler owner ordinal");
eq(inspectOspfP2pSession({...two.session,schemaVersion:"88"},engine),"OSPF_P2P_SESSION_INVALID","reject unsupported protocol schema");
denied(receiveOspfP2pHello(two.session,engine,observed(Number.MAX_SAFE_INTEGER,[cfg.localRouterId])),"OSPF_P2P_TIME_OVERFLOW");

function replay() {
  let current=createOspfP2pSession(engine,cfg);
  const records=[];
  const go=(r)=>{if(!r.ok)throw Error(r.code);current=r.session;records.push(...r.events);};
  go(advanceOspfP2pSession(current,engine,0));
  go(receiveOspfP2pHello(current,engine,observed(1000)));
  go(receiveOspfP2pHello(current,engine,observed(3500,[cfg.localRouterId])));
  go(receiveOspfP2pHello(current,engine,observed(12500,[cfg.localRouterId])));
  go(advanceOspfP2pSession(current,engine,52000));
  go(receiveOspfP2pHello(current,engine,observed(53000)));
  go(advanceOspfP2pSession(current,engine,100000));
  return JSON.stringify({current,records,engineRevision:engine.stateRevision});
}
const stable=replay();
for(let n=0;n<1000;n++)eq(replay(),stable,"1000 deterministic synthetic P2P replay runs");
console.log("PASS CONVERGENCE OSPFv2 P2P Hello/Dead: "+assertions+" assertions, 1000 identical replays");
