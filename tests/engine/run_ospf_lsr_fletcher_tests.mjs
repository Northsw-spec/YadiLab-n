import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createInitialEngineState, queryReachability,
  createOspfP2pExchangeSession, advanceOspfP2pExchangeSession,
  receiveOspfP2pExchangeHello, receiveOspfP2pExchangeDescription,
  createOspfDdSummarySession, receiveOspfDdSummaryDescription,
  verifyOspfLsaBinary, createOspfLsRequestSession,
  inspectOspfLsRequestSession, issueOspfLsRequest,
  advanceOspfLsRequestSession, receiveOspfLsRequestHello,
  receiveOspfLsRequestUpdate,
} from "../../dist-engine-test/engine/src/index.js";

// Independent precomputed Fletcher-16 fixtures. Both verification sums equal zero.
// The production verifier never calls any checksum-generation helper.
const RAW_OLD = "006402010a0000020a0000028000000182c8001800000000";
const RAW_NEW = "006402010a0000020a0000028000000280c9001800000000";
const RAW_C = "006402010a0000030a0000038000000172d6001800000000";
const RAW_D = "006402010a0000040a0000048000000162e4001800000000";
const RAW_NETWORK = "00640202c00002010a0000028000000183fe001cffffff000a000002";
const fromHex=(h)=>Array.from(Buffer.from(h,"hex"));
const rawOld=fromHex(RAW_OLD),rawNew=fromHex(RAW_NEW);
const rawC=fromHex(RAW_C),rawD=fromHex(RAW_D),rawNetwork=fromHex(RAW_NETWORK);
const source=JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-normalized.json","utf8"));
const router=id=>({id,type:"network.router",label:id,interfaces:[],properties:{},asset:{id:"network.router",version:"1.0.0"}});
const scenario={...source,scenarioId:"ospf-lsr-verified-bodies",sourceHash:"b".repeat(64),
  resources:[...source.resources,router("req-a"),router("req-b")]};
const state=createInitialEngineState(scenario);
const cfg={localResourceId:"req-a",remoteResourceId:"req-b",
  localRouterId:"10.0.0.1",remoteRouterId:"10.0.0.2",areaId:"0.0.0.0",
  helloIntervalMs:10000,deadIntervalMs:40000,
  localInterfaceMtu:1500,initialDdSequence:9001,rxmtIntervalMs:2000};
const hello=(c,atMs,twoWay=true)=>({
  atMs,senderRouterId:c.remoteRouterId,areaId:c.areaId,
  helloIntervalMs:c.helloIntervalMs,deadIntervalMs:c.deadIntervalMs,
  seenRouterIds:twoWay?[c.localRouterId]:[],
});
const dd=(c,atMs,over={})=>({
  atMs,senderRouterId:c.remoteRouterId,areaId:c.areaId,interfaceMtu:1500,
  options:2,init:true,more:true,master:true,ddSequence:701,lsaHeaderCount:0,...over,
});
let checks=0;
function eq(a,b,label){assert.deepEqual(a,b,label);checks++;}
function ok(r,label){eq(r.ok,true,label);return r;}
function denied(r,code){eq(r.ok,false,"denied "+code);eq(r.code,code,"diagnostic "+code);}
function ecount(r,k){return r.events.filter(x=>x.kind===k).length;}
const hOld=ok(verifyOspfLsaBinary(rawOld),"old Fletcher fixture").header;
const hNew=ok(verifyOspfLsaBinary(rawNew),"new Fletcher fixture").header;
const hC=ok(verifyOspfLsaBinary(rawC),"router C Fletcher fixture").header;
const hD=ok(verifyOspfLsaBinary(rawD),"router D Fletcher fixture").header;
const hNetwork=ok(verifyOspfLsaBinary(rawNetwork),"network Fletcher fixture").header;
eq(hNew.lsaType,1,"Type 1 LSA");
eq(hNew.linkStateId,"10.0.0.2","Type 1 link state ID");
eq(hNew.advertisingRouter,"10.0.0.2","Type 1 advertising Router ID");
eq(hNew.lsSequenceNumber,-2147483646,"signed LS sequence number");
eq(hNew.lsChecksum,0x80c9,"specific independently checked checksum");
eq(hNew.length,24,"Type 1 minimal 24-byte body");
eq(hNetwork.lsaType,2,"Type 2 LSA");
eq(hNetwork.linkStateId,"192.0.2.1","Type 2 network LS ID");
eq(hNetwork.length,28,"Type 2 one-router 28-byte LSA");
eq(hNetwork.lsChecksum,0x83fe,"network checksum fixture");
const ageChanged=rawNew.slice();ageChanged[0]=14;ageChanged[1]=16;
eq(ok(verifyOspfLsaBinary(ageChanged),"LS age excluded from Fletcher").header.lsAge,
   3600,"MaxAge does not invalidate Fletcher checksum");
denied(verifyOspfLsaBinary([]),"OSPF_LSA_BYTES_INVALID");
denied(verifyOspfLsaBinary(rawNew.slice(0,-1)),"OSPF_LSA_BYTES_INVALID");
denied(verifyOspfLsaBinary([...rawNew,300]),"OSPF_LSA_BYTES_INVALID");
const badLen=rawNew.slice();badLen[19]=23;
denied(verifyOspfLsaBinary(badLen),"OSPF_LSA_LENGTH_MISMATCH");
const badType=rawNew.slice();badType[3]=5;
denied(verifyOspfLsaBinary(badType),"OSPF_LSA_HEADER_INVALID");
const reserved=rawNew.slice();reserved[12]=0x80;reserved[13]=0;reserved[14]=0;reserved[15]=0;
denied(verifyOspfLsaBinary(reserved),"OSPF_LSA_HEADER_INVALID");
const bodyCorrupt=rawNetwork.slice();bodyCorrupt[25]^=1;
denied(verifyOspfLsaBinary(bodyCorrupt),"OSPF_LSA_FLETCHER_INVALID");
const chkCorrupt=rawNew.slice();chkCorrupt[17]^=1;
denied(verifyOspfLsaBinary(chkCorrupt),"OSPF_LSA_FLETCHER_INVALID");
const malformedNetwork=rawNetwork.slice(0,-1);malformedNetwork[19]=27;
denied(verifyOspfLsaBinary(malformedNetwork),"OSPF_LSA_NETWORK_BODY_INVALID");
const mutationCheck=ok(verifyOspfLsaBinary(rawNew),"checksum verified with defensive copy");
rawNew[21]^=1;
eq(mutationCheck.bytes[21],0,"returned raw bytes copy independent of input");
rawNew[21]^=1;

function ready(c=cfg,headerList=[hNew,hC,hNetwork],local=[hOld]) {
  let ex=createOspfP2pExchangeSession(state,c);
  let r=advanceOspfP2pExchangeSession(ex,state,0);if(!r.ok)throw Error(r.code);ex=r.session;
  r=receiveOspfP2pExchangeHello(ex,state,hello(c,1000));if(!r.ok)throw Error(r.code);ex=r.session;
  r=receiveOspfP2pExchangeDescription(ex,state,dd(c,2000));if(!r.ok)throw Error(r.code);ex=r.session;
  let sum=createOspfDdSummarySession(state,ex,local);
  r=receiveOspfDdSummaryDescription(sum,state,
    dd(c,3000,{init:false,ddSequence:702,lsaHeaderCount:headerList.length}),headerList);
  if(!r.ok)throw Error(r.code);
  return r.session;
}
const summary=ready();
eq(summary.plan.requestIntents.length,3,"one newer and two missing LSAs requested");
const truth=queryReachability(scenario,state,"attacker","rds01","tcp",3389);
assert.throws(()=>createOspfLsRequestSession(state,summary,0),/OSPF_LSR_CONFIG_INVALID/);checks++;
assert.throws(()=>createOspfLsRequestSession(state,summary,9),/OSPF_LSR_CONFIG_INVALID/);checks++;
let s=createOspfLsRequestSession(state,summary,2);
eq(inspectOspfLsRequestSession(s,state),null,"fresh request snapshot valid");
eq(s.completed.length,0,"no fabricated updates");
denied(receiveOspfLsRequestUpdate(s,state,{atMs:3100,senderRouterId:cfg.remoteRouterId,
  areaId:cfg.areaId,lsas:[rawNew]}),"OSPF_LSR_NOT_OUTSTANDING");
const sent=ok(issueOspfLsRequest(s,state),"initial two-request packet intent");
s=sent.session;
eq(sent.events[0].kind,"LSR_TX_INTENT","only TX intent; no packet transmitted");
eq(s.outstanding.requests.map(x=>x.linkStateId),["10.0.0.2","10.0.0.3"],"deterministic first two");
eq(s.outstanding.nextRetryAtMs,5000,"one retry timer");
denied(issueOspfLsRequest(s,state),"OSPF_LSR_ALREADY_OUTSTANDING");
denied(receiveOspfLsRequestUpdate(s,state,{atMs:3100,senderRouterId:"10.0.0.9",
  areaId:cfg.areaId,lsas:[rawNew]}),"OSPF_LSR_UPDATE_SOURCE_INVALID");
denied(receiveOspfLsRequestUpdate(s,state,{atMs:3100,senderRouterId:cfg.remoteRouterId,
  areaId:"0.0.0.1",lsas:[rawNew]}),"OSPF_LSR_UPDATE_SOURCE_INVALID");
denied(receiveOspfLsRequestUpdate(s,state,{atMs:3100,senderRouterId:cfg.remoteRouterId,
  areaId:cfg.areaId,lsas:[]}),"OSPF_LSR_UPDATE_BATCH_INVALID");
denied(receiveOspfLsRequestUpdate(s,state,{atMs:3100,senderRouterId:cfg.remoteRouterId,
  areaId:cfg.areaId,lsas:[rawOld]}),"OSPF_LSR_UPDATE_OLDER_THAN_REQUESTED");
denied(receiveOspfLsRequestUpdate(s,state,{atMs:3100,senderRouterId:cfg.remoteRouterId,
  areaId:cfg.areaId,lsas:[rawNetwork]}),"OSPF_LSR_UPDATE_UNEXPECTED_LSA");
denied(receiveOspfLsRequestUpdate(s,state,{atMs:3100,senderRouterId:cfg.remoteRouterId,
  areaId:cfg.areaId,lsas:[rawNew,rawNew]}),"OSPF_LSR_UPDATE_UNEXPECTED_LSA");
denied(receiveOspfLsRequestUpdate(s,state,{atMs:3100,senderRouterId:cfg.remoteRouterId,
  areaId:cfg.areaId,lsas:[bodyCorrupt]}),"OSPF_LSA_FLETCHER_INVALID");
denied(receiveOspfLsRequestUpdate(s,state,{atMs:3100,senderRouterId:cfg.remoteRouterId,
  areaId:cfg.areaId,lsas:[rawNew,bodyCorrupt]}),"OSPF_LSA_FLETCHER_INVALID");
eq(s.completed.length,0,"all malformed updates fail atomically");
eq(s.summary.exchange.dd.hello.clock.nowMs,3000,"failed updates do not advance clock");
const justBefore=ok(advanceOspfLsRequestSession(s,state,4999),"before RxmtInterval");
eq(ecount(justBefore,"LSR_RETRANSMIT_INTENT"),0,"no early retransmission");
s=justBefore.session;
const retried=ok(advanceOspfLsRequestSession(s,state,7000),"virtual retries at 5 and 7 seconds");
eq(retried.events.filter(x=>x.kind==="LSR_RETRANSMIT_INTENT").map(x=>x.atMs),[5000,7000],
  "two exact timer deadlines");
eq(retried.session.outstanding.retries,2,"bounded LSR retry count");
eq(retried.session.outstanding.requests.length,2,"no extra packet outstanding");
s=retried.session;
const first=ok(receiveOspfLsRequestUpdate(s,state,{atMs:7100,
  senderRouterId:cfg.remoteRouterId,areaId:cfg.areaId,lsas:[rawC]}),
  "first good LSA response");
s=first.session;
eq(s.completed.length,1,"one verified body retained");
eq(s.outstanding.requests.map(x=>x.linkStateId),["10.0.0.2"],
  "unresolved first batch only");
eq(ecount(first,"LSR_VERIFIED_LSA_RECEIVED"),1,"provenance for one verified reply");
eq(inspectOspfLsRequestSession(s,state),null,"partial response consistent");
const second=ok(receiveOspfLsRequestUpdate(s,state,{atMs:7200,
  senderRouterId:cfg.remoteRouterId,areaId:cfg.areaId,lsas:[rawNew]}),
  "second valid LSA, newer than local and equal advertised");
s=second.session;
eq(s.outstanding,undefined,"outstanding packet resolved");
eq(s.completed.length,2,"two verified LSA byte copies");
eq(ecount(second,"LSR_REQUEST_LIST_EMPTY"),0,"not empty while third request pending");
const n=ok(issueOspfLsRequest(s,state),"issue next packet after first complete");
s=n.session;
eq(s.outstanding.requests.map(x=>x.linkStateId),["192.0.2.1"],
  "subsequent packet contains remaining network LSA");
const final=ok(receiveOspfLsRequestUpdate(s,state,{atMs:7300,
  senderRouterId:cfg.remoteRouterId,areaId:cfg.areaId,lsas:[rawNetwork]}),
  "network LSA checksum and request identity");
s=final.session;
eq(ecount(final,"LSR_REQUEST_LIST_EMPTY"),1,"request snapshot now empty");
eq(s.completed.length,3,"all three requested identities verified");
eq(s.outstanding,undefined,"no outstanding request once all satisfied");
denied(issueOspfLsRequest(s,state),"OSPF_LSR_NO_PENDING");
eq(inspectOspfLsRequestSession(s,state),null,"recheck every stored LSA Fletcher checksum");
const forged=s.completed.map(x=>({...x,lsaBytes:[...x.lsaBytes]}));
forged[0].lsaBytes[22]^=1;
eq(inspectOspfLsRequestSession({...s,completed:forged},state),
  "OSPF_LSR_COMPLETION_INVALID","restored corrupted LSA byte contents rejected");
eq(inspectOspfLsRequestSession({...s,completed:[s.completed[0],s.completed[0]]},state),
  "OSPF_LSR_COMPLETION_INVALID","repeated completion is not valid");
const unexpected=ok(advanceOspfLsRequestSession(s,state,8000),"time advancement after empty");
eq(ecount(unexpected,"LSR_REQUEST_LIST_EMPTY"),0,"no duplicate list-empty events");

const dropped=ok(receiveOspfLsRequestHello(s,state,hello(cfg,8000,false)),
  "one-way Hello resets neighbor");
eq(dropped.session.summary.exchange.dd.phase,"IDLE","one-way neighbor state");
eq(dropped.session.completed.length,0,"all receipts discarded on one-way");
eq(dropped.session.outstanding,undefined,"no stale outstanding request");

const deadS=ok(issueOspfLsRequest(createOspfLsRequestSession(state,summary,2),state),
  "dead-time fixture").session;
const died=ok(advanceOspfLsRequestSession(deadS,state,41000),"exact Dead deadline after Hello 1000");
eq(died.session.summary.exchange.dd.phase,"IDLE","dead deadline overrides retry");
eq(died.session.completed.length,0,"no stale verified receipts");
eq(died.session.outstanding,undefined,"no old request outstanding");
eq(ecount(died,"LSR_DISCARDED"),1,"explicit trace for invalidated intent");
denied(receiveOspfLsRequestUpdate(deadS,state,{atMs:41000,
  senderRouterId:cfg.remoteRouterId,areaId:cfg.areaId,lsas:[rawNew]}),
  "OSPF_LSR_NOT_OUTSTANDING");
denied(advanceOspfLsRequestSession(deadS,{...state,stateRevision:1},4000),
  "SIM_CLOCK_STALE_REVISION");
denied(advanceOspfLsRequestSession(deadS,state,2999),"OSPF_LSR_TIME_INVALID");

const longCfg={...cfg,deadIntervalMs:900000};
const longSummary=ready(longCfg,[hNew],[hOld]);
const longS=ok(issueOspfLsRequest(createOspfLsRequestSession(state,longSummary,1),state),
  "long Dead test").session;
denied(advanceOspfLsRequestSession(longS,state,300000),"OSPF_LSR_ADVANCE_LIMIT");
eq(longS.outstanding.retries,0,"over-budget virtual-time call is atomic");
const emptySummary=ready(cfg,[],[]);
const empty=createOspfLsRequestSession(state,emptySummary);
denied(issueOspfLsRequest(empty,state),"OSPF_LSR_NO_PENDING");
eq(state.stateRevision,0,"no Engine revision mutation");
eq(state.resources["req-a"].properties,{},"no network router mutation");
eq(queryReachability(scenario,state,"attacker","rds01","tcp",3389).truth,truth.truth,
  "original network reachability unchanged");

function replay() {
  let v=createOspfLsRequestSession(state,summary,2),events=[];
  function step(r){if(!r.ok)throw Error(r.code);v=r.session;events.push(...r.events);}
  step(issueOspfLsRequest(v,state));
  step(advanceOspfLsRequestSession(v,state,5000));
  step(receiveOspfLsRequestUpdate(v,state,{atMs:5100,
    senderRouterId:cfg.remoteRouterId,areaId:cfg.areaId,lsas:[rawNew,rawC]}));
  step(issueOspfLsRequest(v,state));
  step(receiveOspfLsRequestUpdate(v,state,{atMs:5300,
    senderRouterId:cfg.remoteRouterId,areaId:cfg.areaId,lsas:[rawNetwork]}));
  step(receiveOspfLsRequestHello(v,state,hello(cfg,6000,false)));
  return JSON.stringify({v,events,revision:state.stateRevision});
}
const oracle=replay();
for(let i=0;i<1000;i++)eq(replay(),oracle,"1000 byte-identical request/LSA-response replays");
console.log("PASS CONVERGENCE OSPFv2 LSR/Fletcher lifecycle: "+checks+" assertions; 1000 identical replays");
