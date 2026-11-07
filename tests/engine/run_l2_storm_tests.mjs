import assert from "node:assert/strict";
import { simulateL2RepeatedPropagation } from "../../dist-engine-test/engine/src/index.js";

const resource=(id,states)=>({id,type:"network.switch",label:id,interfaces:["a","b","c"].map(x=>({id:x,addresses:[]})),properties:{stpPorts:["a","b","c"].map((iface)=>({interface:iface,role:"DESIGNATED",state:states[iface]??"BLOCKING"}))}});
const scenario=(blocked)=>({resources:[resource("s1",{a:"FORWARDING",b:"FORWARDING",c:blocked?"BLOCKING":"FORWARDING"}),resource("s2",{a:"FORWARDING",b:"FORWARDING",c:"FORWARDING"}),resource("s3",{a:"FORWARDING",b:blocked?"BLOCKING":"FORWARDING",c:"FORWARDING"})],connections:[
  {id:"l12",kind:"network",from:{resource:"s1",port:"b"},to:{resource:"s2",port:"a"},properties:{}},
  {id:"l23",kind:"network",from:{resource:"s2",port:"b"},to:{resource:"s3",port:"a"},properties:{}},
  {id:"l31",kind:"network",from:{resource:"s3",port:"b"},to:{resource:"s1",port:"c"},properties:{}}
]});
const state=(s)=>({scenarioId:"l2",scenarioHash:"a".repeat(64),stateRevision:0,resources:Object.fromEntries(s.resources.map(r=>[r.id,r]))});
let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++;}; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const healthy=scenario(true); const good=simulateL2RepeatedPropagation(healthy,state(healthy),"s1","frame_triangle",{maxEvents:32,maxDepth:8});
eq(good.truth,"TRUE","blocked STP link completes truthfully"); eq(good.outcome,"COMPLETE","blocked triangle terminates"); eq(good.counters.loopReentries,0,"blocked link produces no loop re-entry"); ok(good.events.every(e=>e.provenance==="ENGINE_L2_PROPAGATION"),"all events are Engine-provenanced");
const faulty=scenario(false); const storm=simulateL2RepeatedPropagation(faulty,state(faulty),"s1","frame_triangle",{maxEvents:18,maxDepth:8});
eq(storm.outcome,"SAFETY_CUTOFF","forwarding triangle is bounded by safety cutoff"); ok(storm.counters.loopReentries>0,"forwarding triangle emits explicit loop re-entry"); ok(storm.events.some(e=>e.kind==="SIMULATION_LIMIT"),"cutoff is explicit, not a flow drop");
const again=simulateL2RepeatedPropagation(faulty,state(faulty),"s1","frame_triangle",{maxEvents:18,maxDepth:8}); eq(again.events,storm.events,"repeated runs are byte-stable");
const missing=structuredClone(faulty); missing.resources[0].properties.stpPorts=undefined; const unknown=simulateL2RepeatedPropagation(missing,state(missing),"s1"); eq(unknown.truth,"UNKNOWN","missing canonical STP fails closed");
const zero=simulateL2RepeatedPropagation(healthy,state(healthy),"s1","f",{maxEvents:0,maxDepth:8}); eq(zero.outcome,"UNKNOWN","invalid safety budget is rejected");
console.log(`PASS Dev28 L2 repeated propagation: ${checks} assertions.`);
