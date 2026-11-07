import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createInitialEngineState, queryReachability,
  createOspfP2pExchangeSession, advanceOspfP2pExchangeSession,
  receiveOspfP2pExchangeHello, receiveOspfP2pExchangeDescription,
  createOspfDdSummarySession, createOspfDdFinishSession,
  verifyOspfLsaBinary,
  createOspfLoadingSession, inspectOspfLoadingSession,
  receiveOspfLoadingDescription, receiveOspfLoadingHello,
  advanceOspfLoadingSession, issueOspfLoadingRequest,
  receiveOspfLoadingUpdate,
} from "../../dist-engine-test/engine/src/index.js";

const base=JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-normalized.json","utf8"));
const router=id=>({id,type:"network.router",label:id,interfaces:[],properties:{},
  asset:{id:"network.router",version:"1.0.0"}});
const scenario={...base,scenarioId:"ospf-loading-test",sourceHash:"d".repeat(64),
  resources:[...base.resources,router("load-a"),router("load-b")]};
const state=createInitialEngineState(scenario);
const cfg={localResourceId:"load-a",remoteResourceId:"load-b",
  localRouterId:"10.0.0.1",remoteRouterId:"10.0.0.2",
  areaId:"0.0.0.0",helloIntervalMs:10000,deadIntervalMs:40000,
  localInterfaceMtu:1500,initialDdSequence:9001,rxmtIntervalMs:2000};
const master={...cfg,localRouterId:"10.0.0.2",remoteRouterId:"10.0.0.1"};
const fromHex=x=>Array.from(Buffer.from(x,"hex"));
const rawNew=fromHex("006402010a0000020a0000028000000280c9001800000000");
const rawC=fromHex("006402010a0000030a0000038000000172d6001800000000");
const rawOld=fromHex("006402010a0000020a0000028000000182c8001800000000");
function valid(bytes){
  const r=verifyOspfLsaBinary(bytes);
  if(!r.ok)throw Error(r.code);
  return r.header;
}
const hNew=valid(rawNew),hC=valid(rawC),hOld=valid(rawOld);
const hello=(c,atMs,twoWay=true)=>({
  atMs,senderRouterId:c.remoteRouterId,areaId:c.areaId,
  helloIntervalMs:c.helloIntervalMs,deadIntervalMs:c.deadIntervalMs,
  seenRouterIds:twoWay?[c.localRouterId]:[],
});
const dd=(c,atMs,extra={})=>({
  atMs,senderRouterId:c.remoteRouterId,areaId:c.areaId,
  interfaceMtu:1500,options:2,init:true,more:true,master:true,
  ddSequence:701,lsaHeaderCount:0,...extra,
});
const update=(c,atMs,lsas)=>({
  atMs,senderRouterId:c.remoteRouterId,areaId:c.areaId,lsas,
});
let n=0;
function eq(actual,expected,message){assert.deepEqual(actual,expected,message);n++;}
function yes(v,message){assert.ok(v,message);n++;}
function ok(r,message){eq(r.ok,true,message);return r;}
function deny(r,code){eq(r.ok,false,"fail closed "+code);eq(r.code,code,"exact diagnosis");}
function count(r,kind){return r.events.filter(e=>e.kind===kind).length;}
function fresh(c=cfg,local=[],maxPerPacket=1){
  let ex=createOspfP2pExchangeSession(state,c);
  let r=advanceOspfP2pExchangeSession(ex,state,0);
  if(!r.ok)throw Error(r.code);ex=r.session;
  r=receiveOspfP2pExchangeHello(ex,state,hello(c,1000));
  if(!r.ok)throw Error(r.code);ex=r.session;
  const initial=c.localRouterId==="10.0.0.1"
    ? dd(c,2000)
    : dd(c,2000,{init:false,master:false,ddSequence:9001});
  r=receiveOspfP2pExchangeDescription(ex,state,initial);
  if(!r.ok)throw Error(r.code);
  const sum=createOspfDdSummarySession(state,r.session,local);
  const finish=createOspfDdFinishSession(state,sum,2);
  return createOspfLoadingSession(state,finish,maxPerPacket);
}
function finishSlave(s,headers=[hNew,hC],time=3000){
  return receiveOspfLoadingDescription(s,state,
    dd(cfg,time,{init:false,master:true,more:false,ddSequence:702,
      lsaHeaderCount:headers.length}),headers);
}
function finishMaster(s,headers=[hNew],time=3000){
  return receiveOspfLoadingDescription(s,state,
    dd(master,time,{init:false,master:false,more:false,ddSequence:9002,
      lsaHeaderCount:headers.length}),headers);
}
const truth=queryReachability(scenario,state,"attacker","rds01","tcp",3389);
let start=fresh();
eq(start.phase,"EXCHANGE_MODEL","fresh negotiation is not Loading");
eq(start.finish.exchangeDone,false,"not an unearned DD completion");
eq(start.requests.completed.length,0,"no fabricated receipts");
eq(inspectOspfLoadingSession(start,state),null,"fresh cross-layer snapshot valid");
deny(issueOspfLoadingRequest(start,state),"OSPF_LOADING_REQUEST_NOT_PERMITTED");
deny(receiveOspfLoadingUpdate(start,state,update(cfg,2100,[rawNew])),
  "OSPF_LOADING_UPDATE_NOT_PERMITTED");
assert.throws(()=>createOspfLoadingSession(state,start.finish,0),/OSPF_LSR_CONFIG_INVALID/);n++;
const loadedResult=ok(finishSlave(start),"accept DD M0 and two newer/missing headers");
let s=loadedResult.session;
eq(s.phase,"LOADING_MODEL","ExchangeDone + pending -> Loading");
eq(s.finish.exchangeDone,true,"DD completion required");
eq(s.remainingRequests,undefined,"remaining list on result not internal session");
eq(loadedResult.remainingRequests.map(r=>r.linkStateId),["10.0.0.2","10.0.0.3"],
  "two missing remote identities retained");
eq(count(loadedResult,"LOADING_ENTERED_MODEL"),1,"Loading emitted exactly once");
eq(count(loadedResult,"LOADING_DONE_ELIGIBLE_MODEL"),0,"not eligible before LSAs");
eq(inspectOspfLoadingSession(s,state),null,"DD and LSR share exact summary snapshot");
const captured=JSON.stringify(s);
deny(receiveOspfLoadingUpdate(s,state,update(cfg,3200,[rawNew])),
  "OSPF_LSR_NOT_OUTSTANDING");
eq(JSON.stringify(s),captured,"failed reply leaves state unchanged");
const issued=ok(issueOspfLoadingRequest(s,state),"issue first of two LSR intents");
s=issued.session;
eq(s.requests.outstanding.requests.length,1,"one request in packet");
eq(s.requests.outstanding.requests[0].linkStateId,"10.0.0.2","canonical first LSA");
eq(count(issued,"LSR_TX_INTENT"),1,"request trace only, not wire TX");
deny(issueOspfLoadingRequest(s,state),"OSPF_LSR_ALREADY_OUTSTANDING");
deny(receiveOspfLoadingUpdate(s,state,
  update({...cfg,remoteRouterId:"10.0.0.8"},3300,[rawNew])),
  "OSPF_LSR_UPDATE_SOURCE_INVALID");
deny(receiveOspfLoadingUpdate(s,state,update(cfg,3300,[rawOld])),
  "OSPF_LSR_UPDATE_OLDER_THAN_REQUESTED");
const badChecksum=rawNew.slice();badChecksum[23]^=1;
deny(receiveOspfLoadingUpdate(s,state,update(cfg,3300,[badChecksum])),
  "OSPF_LSA_FLETCHER_INVALID");
eq(s.requests.completed.length,0,"failed checksum cannot mark LoadingDone");
const beforeRetry=ok(advanceOspfLoadingSession(s,state,4999),"before next retry");
eq(count(beforeRetry,"LSR_RETRANSMIT_INTENT"),0,"no early LSR resend");
const retransmit=ok(advanceOspfLoadingSession(beforeRetry.session,state,5000),
  "retransmit at exact interval");
eq(count(retransmit,"LSR_RETRANSMIT_INTENT"),1,"retry event only at 5000");
eq(retransmit.session.phase,"LOADING_MODEL","retry does not satisfy LSA");
s=retransmit.session;
const first=ok(receiveOspfLoadingUpdate(s,state,update(cfg,5100,[rawNew])),
  "first checksum-verified LSA");
s=first.session;
eq(s.phase,"LOADING_MODEL","one of two still missing");
eq(s.requests.completed.length,1,"one verified receipt");
eq(first.remainingRequests.map(x=>x.linkStateId),["10.0.0.3"],"exact remaining request");
eq(count(first,"LOADING_DONE_ELIGIBLE_MODEL"),0,"premature LoadingDone suppressed");
eq(s.requests.outstanding,undefined,"first LSR batch completed");
const next=ok(issueOspfLoadingRequest(s,state),"next LSR intent");
s=next.session;
eq(s.requests.outstanding.requests[0].linkStateId,"10.0.0.3","second LSA requested");
const last=ok(receiveOspfLoadingUpdate(s,state,update(cfg,5200,[rawC])),
  "second checksum-verified reply");
s=last.session;
eq(s.phase,"REQUESTS_SATISFIED_MODEL","bounded LoadingDone eligibility");
eq(last.remainingRequests.length,0,"request list exhausted");
eq(s.requests.completed.length,2,"two full raw LSA receipts retained");
eq(s.requests.outstanding,undefined,"no outstanding request");
eq(count(last,"LSR_REQUEST_LIST_EMPTY"),1,"underlying LSR list empty");
eq(count(last,"LOADING_DONE_ELIGIBLE_MODEL"),1,"one completion eligibility trace");
eq(count(last,"NO_LOADING_REQUIRED_UNVERIFIED_MODEL"),0,
  "not an empty-from-start summary");
eq(inspectOspfLoadingSession(s,state),null,"receipt ledger valid after completion");
deny(issueOspfLoadingRequest(s,state),"OSPF_LOADING_REQUEST_NOT_PERMITTED");
deny(receiveOspfLoadingUpdate(s,state,update(cfg,5300,[rawNew])),
  "OSPF_LOADING_UPDATE_NOT_PERMITTED");
const forward=ok(advanceOspfLoadingSession(s,state,7000),"no repeated LoadingDone");
eq(forward.session.phase,"REQUESTS_SATISFIED_MODEL","completed snapshot stable");
eq(count(forward,"LOADING_DONE_ELIGIBLE_MODEL"),0,"completion event not duplicated");
eq(inspectOspfLoadingSession({...s,phase:"NO_LOADING_REQUIRED_MODEL"},state),
  "OSPF_LOADING_PHASE_INVALID","forged empty-from-start status refused");
eq(inspectOspfLoadingSession({...s,requests:{...s.requests,completed:[]}},state),
  "OSPF_LOADING_PHASE_INVALID","forged lost LSA receipt refused");
eq(inspectOspfLoadingSession({...s,requests:{...s.requests,summary:loadedResult.session.requests.summary}},state),
  "OSPF_LOADING_SNAPSHOT_MISMATCH","different virtual timestamps refused");
eq(inspectOspfLoadingSession({...s,finish:{...s.finish,exchangeDone:false}},state),
  "OSPF_DD_FINISH_DONE_INVALID","forged DD completion refused");
const altered=s.requests.completed.map(c=>({...c,lsaBytes:[...c.lsaBytes]}));
altered[0].lsaBytes[22]^=1;
eq(inspectOspfLoadingSession({...s,requests:{...s.requests,completed:altered}},state),
  "OSPF_LSR_COMPLETION_INVALID","corrupted stored Fletcher receipt refused");

const noRequest=ok(finishSlave(fresh(cfg,[hNew,hC]),[hNew,hC]),
  "remote DD introduces no outdated local identities");
eq(noRequest.session.phase,"NO_LOADING_REQUIRED_MODEL","no Loading stage required");
eq(count(noRequest,"NO_LOADING_REQUIRED_UNVERIFIED_MODEL"),1,
  "conservative no-Full event");
eq(count(noRequest,"LOADING_ENTERED_MODEL"),0,"no fabricated Loading state");
deny(issueOspfLoadingRequest(noRequest.session,state),
  "OSPF_LOADING_REQUEST_NOT_PERMITTED");
const noRequestStep=ok(advanceOspfLoadingSession(noRequest.session,state,6000),
  "no-request time advancement");
eq(noRequestStep.session.phase,"NO_LOADING_REQUIRED_MODEL","no Full inferred over time");

const m=ok(finishMaster(fresh(master,[]),[hNew]),
  "master final empty DD acknowledged while remote advertises LSA");
eq(m.session.phase,"LOADING_MODEL","master role produces same bounded Loading");
eq(m.session.finish.exchangeDone,true,"master proper final DD acknowledged");
eq(count(m,"LOADING_ENTERED_MODEL"),1,"master Loading event");

const mid=ok(finishSlave(fresh(cfg),[hNew]),"single-request Loading setup");
const dropped=ok(receiveOspfLoadingHello(mid.session,state,hello(cfg,3500,false)),
  "one-way Hello destroys DD and LSR progress");
eq(dropped.session.phase,"EXCHANGE_MODEL","one-way forces lower state");
eq(dropped.session.finish.summary.exchange.dd.phase,"IDLE","underlying DD reset");
eq(dropped.session.requests.completed.length,0,"lost receipt ledger");
eq(dropped.session.requests.outstanding,undefined,"no stale retry timer");
eq(count(dropped,"LOADING_RESET_MODEL"),1,"progress invalidation traced");
eq(dropped.session.finish.localTx.length,0,"local DD summary plan discarded");
const expired=ok(advanceOspfLoadingSession(
  ok(issueOspfLoadingRequest(mid.session,state),"issued before Dead").session,
  state,41000),"Dead timer outranks request retry");
eq(expired.session.phase,"EXCHANGE_MODEL","Dead clears Loading");
eq(expired.session.finish.summary.exchange.dd.phase,"IDLE","Dead parent DD idle");
eq(expired.session.requests.completed.length,0,"Dead clears all received data");
eq(expired.session.requests.outstanding,undefined,"Dead clears outstanding");
eq(count(expired,"LOADING_RESET_MODEL"),1,"Dead reset trace");
const seqBreak=ok(receiveOspfLoadingDescription(mid.session,state,
  dd(cfg,3500,{init:false,master:true,ddSequence:999,more:false}),[]),
  "unexpected DD forces SeqNumberMismatch");
eq(seqBreak.session.phase,"EXCHANGE_MODEL","sequence mismatch clears Loading");
eq(seqBreak.session.finish.summary.exchange.dd.phase,"EXSTART","re-negotiate");
eq(seqBreak.session.requests.outstanding,undefined,"invalidated LSR cleared");
eq(count(seqBreak,"LOADING_RESET_MODEL"),1,"sequence reset traced");
const renegotiate=ok(receiveOspfLoadingDescription(seqBreak.session,state,
  dd(cfg,3700,{ddSequence:750}),[]),"negotiation after mismatch");
eq(renegotiate.session.phase,"EXCHANGE_MODEL","new Exchange not Loading");
eq(renegotiate.session.finish.exchangeDone,false,"no old DD done");
const reload=ok(receiveOspfLoadingDescription(renegotiate.session,state,
  dd(cfg,3800,{init:false,master:true,ddSequence:751,more:false,
    lsaHeaderCount:1}),[hC]),"fresh DD last packet");
eq(reload.session.phase,"LOADING_MODEL","fresh request from new Exchange");
eq(reload.session.requests.completed.length,0,"old LSA receipts not resurrected");
const stable=JSON.stringify(mid.session);
deny(receiveOspfLoadingDescription(mid.session,state,
  dd(cfg,3600,{init:false,master:true,ddSequence:703,
    interfaceMtu:9000,lsaHeaderCount:1}),[hC]),"OSPF_EXCHANGE_MTU_REJECTED");
eq(JSON.stringify(mid.session),stable,"bad DD atomic");
deny(advanceOspfLoadingSession(mid.session,{...state,stateRevision:1},3600),
  "SIM_CLOCK_STALE_REVISION");

const resetAfterReceipt=ok(receiveOspfLoadingHello(s,state,hello(cfg,8000,false)),
  "one-way after all requests satisfied");
eq(resetAfterReceipt.session.phase,"EXCHANGE_MODEL","completed model invalidated");
eq(resetAfterReceipt.session.requests.completed.length,0,"received LSA receipts discarded");
eq(count(resetAfterReceipt,"LOADING_RESET_MODEL"),1,"completed status reset");
eq(state.stateRevision,0,"Engine state never modified");
eq(state.resources["load-a"].properties,{},"router resource never modified");
eq(queryReachability(scenario,state,"attacker","rds01","tcp",3389).truth,
  truth.truth,"reachability truth unchanged");

function replay() {
  let x=fresh(),history=[];
  function step(r){if(!r.ok)throw Error(r.code);x=r.session;history.push(...r.events);}
  step(finishSlave(x));
  step(issueOspfLoadingRequest(x,state));
  step(advanceOspfLoadingSession(x,state,5000));
  step(receiveOspfLoadingUpdate(x,state,update(cfg,5100,[rawNew])));
  step(issueOspfLoadingRequest(x,state));
  step(receiveOspfLoadingUpdate(x,state,update(cfg,5200,[rawC])));
  step(receiveOspfLoadingHello(x,state,hello(cfg,6000)));
  step(receiveOspfLoadingHello(x,state,hello(cfg,6100,false)));
  return JSON.stringify({x,history,revision:state.stateRevision});
}
const reference=replay();
for(let i=0;i<1000;i++)eq(replay(),reference,"1000 byte-identical Loading coordination replays");
console.log("PASS CONVERGENCE OSPFv2 Loading coordinator: "+n+" assertions; 1000 identical replays");
