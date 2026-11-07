import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createInitialEngineState, queryReachability,
  createSimulationTransitionState, inspectSimulationTransitionState,
  scheduleSimulationMarker, cancelSimulationMarker, advanceSimulationTransitions,
} from "../../dist-engine-test/engine/src/index.js";

const scenario = JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-normalized.json","utf8"));
const original = createInitialEngineState(scenario);
const owners = Object.keys(original.resources);
assert.ok(owners.length >= 2, "fixture requires separate resources");
const a = owners[0], b = owners[1];
let checks = 0;
function eq(x,y,label) { assert.deepEqual(x,y,label); checks++; }
function ok(x,label) { assert.ok(x,label); checks++; }
function good(result,label) { eq(result.ok,true,label); return result; }
function bad(result,code) {
  eq(result.ok,false,"reject " + code); eq(result.code,code,"diagnostic " + code);
}
const planned = createSimulationTransitionState(original);
eq(planned.clock.nowMs,0,"virtual time begins at zero");
eq(planned.originStateRevision,original.stateRevision,"exact revision binding");
eq(inspectSimulationTransitionState(planned,original),null,"valid empty plan");
const first = good(scheduleSimulationMarker(planned,original,{eventId:"event-b",ownerResourceId:b,atMs:12}),"first event");
let transition = good(scheduleSimulationMarker(first.transition,original,{eventId:"event-a",ownerResourceId:a,atMs:5}),"second event").transition;
transition = good(scheduleSimulationMarker(transition,original,{eventId:"event-c",ownerResourceId:a,atMs:5}),"equal-time event").transition;
const absent = good(scheduleSimulationMarker(transition,original,{eventId:"event-cancel",ownerResourceId:b,atMs:6}),"cancellable").transition;
bad(cancelSimulationMarker(absent,original,"event-cancel",a),"SIM_TRANSITION_OWNER_MISMATCH");
eq(cancelSimulationMarker(absent,original,"event-cancel",a).transition,absent,"wrong owner never mutates clock");
transition = good(cancelSimulationMarker(absent,original,"event-cancel",b),"owner cancels").transition;
eq(transition.cancelled.map(x=>x.eventId),["event-cancel"],"cancellation tombstone");
bad(scheduleSimulationMarker(transition,original,{eventId:"event-cancel",ownerResourceId:b,atMs:9}),"SIM_TRANSITION_EVENT_REUSED");
bad(scheduleSimulationMarker(transition,original,{eventId:"event-c",ownerResourceId:b,atMs:9}),"SIM_CLOCK_DUPLICATE_EVENT");
bad(scheduleSimulationMarker(transition,original,{eventId:"other",ownerResourceId:"missing",atMs:5}),"SIM_TRANSITION_OWNER_INVALID");
bad(advanceSimulationTransitions(transition,original,-1),"SIM_CLOCK_TIME_INVALID");

const beforeTruth = queryReachability(scenario,original,"attacker","rds01","tcp",3389);
const advanced = good(advanceSimulationTransitions(transition,original,5),"advance first due timestamp");
eq(advanced.dispatched.map(x=>x.eventId),["event-a","event-c"],"stable due-time and sequence ordering");
eq(advanced.dispatched.map(x=>x.revisionBefore),[0,1],"Engine revision handoff happens event by event");
eq(advanced.dispatched.map(x=>x.revisionAfter),[1,2],"revision increments exactly once per event");
eq(advanced.state.stateRevision,2,"exact Engine state revision");
eq(advanced.transition.clock.baseStateRevision,2,"clock rebound to new Engine revision");
eq(advanced.transition.clock.nowMs,5,"virtual clock advanced independently");
eq(original.stateRevision,0,"source Engine state unchanged");
eq(transition.clock.nowMs,0,"original event plan unchanged");
eq(advanced.state.resources[a].properties.__yadilabSimulationEventMarker.eventId,"event-c","only latest marker written");
eq(queryReachability(scenario,advanced.state,"attacker","rds01","tcp",3389).truth,beforeTruth.truth,"annotation never changes reachability truth");
eq(queryReachability(scenario,advanced.state,"attacker","rds01","tcp",3389).value?.path,beforeTruth.value?.path,"annotation never changes reachability path");
eq(inspectSimulationTransitionState(advanced.transition,advanced.state),null,"post-handoff plan valid");
bad(advanceSimulationTransitions(advanced.transition,original,12),"SIM_CLOCK_STALE_REVISION");
bad(advanceSimulationTransitions(advanced.transition,{...advanced.state,scenarioHash:"wrong"},12),"SIM_CLOCK_SOURCE_MISMATCH");
bad(scheduleSimulationMarker(advanced.transition,advanced.state,{eventId:"event-a",ownerResourceId:a,atMs:9}),"SIM_TRANSITION_EVENT_REUSED");
bad(cancelSimulationMarker(advanced.transition,advanced.state,"event-a",a),"SIM_TRANSITION_EVENT_NOT_PENDING");

const final = good(advanceSimulationTransitions(advanced.transition,advanced.state,12),"advance remaining event");
eq(final.dispatched.map(x=>x.eventId),["event-b"],"remaining event delivered");
eq(final.state.stateRevision,3,"third Engine revision");
eq(final.transition.clock.baseStateRevision,3,"clock kept in sync");
eq(final.transition.clock.pending.length,0,"no pending events");
eq(final.transition.applied.length,3,"three provenance receipts");
eq(final.transition.cancelled.length,1,"one cancellation retained");
eq(inspectSimulationTransitionState(final.transition,final.state),null,"completed plan valid");
eq(good(advanceSimulationTransitions(final.transition,final.state,12),"idempotent same-time advance").dispatched,[],"no replay of consumed event");
eq(queryReachability(scenario,final.state,"attacker","rds01","tcp",3389).truth,beforeTruth.truth,"Engine truth unchanged");

eq(inspectSimulationTransitionState({...final.transition, schemaVersion:"99"},final.state),"SIM_TRANSITION_FORMAT_INVALID","reject unknown transition schema");
eq(inspectSimulationTransitionState({...final.transition, originStateRevision:1},final.state),"SIM_TRANSITION_LEDGER_INVALID","reject forged initial revision");
eq(inspectSimulationTransitionState({...final.transition, applied:[...final.transition.applied].reverse()},final.state),"SIM_TRANSITION_LEDGER_INVALID","reject out-of-order receipts");
eq(inspectSimulationTransitionState({...final.transition, applied:[...final.transition.applied,final.transition.applied[0]]},final.state),"SIM_TRANSITION_LEDGER_INVALID","reject duplicate receipt");
eq(inspectSimulationTransitionState({...final.transition, applied:[{...final.transition.applied[0], provenance:"INVENTED"},...final.transition.applied.slice(1)]},final.state),"SIM_TRANSITION_LEDGER_INVALID","reject fabricated provenance");
eq(inspectSimulationTransitionState({...final.transition, cancelled:[{...final.transition.cancelled[0],eventId:"event-c"},...final.transition.cancelled.slice(1)]},final.state),"SIM_TRANSITION_LEDGER_INVALID","reject reusing executed identity in cancellations");
eq(inspectSimulationTransitionState({...final.transition, clock:{...final.transition.clock, baseStateRevision:2}},final.state),"SIM_CLOCK_STALE_REVISION","reject stale clock despite receipts");
eq(inspectSimulationTransitionState({...final.transition, clock:{...final.transition.clock, pending:[{eventId:"unsafe",kind:"TIMER",atMs:12,sequence:4,targetResourceId:a}],nextSequence:5}},final.state),"SIM_TRANSITION_UNOWNED_EVENT","reject arbitrary handler kind");
const tampered = structuredClone(final.state);
tampered.resources[a].properties.__yadilabSimulationEventMarker.eventId="spoofed";
eq(inspectSimulationTransitionState(final.transition,tampered),"SIM_TRANSITION_MARKER_MISMATCH","reject marker change without revision transition");
const occupied = structuredClone(original);
occupied.resources[a].properties.__yadilabSimulationEventMarker={forged:true};
assert.throws(()=>createSimulationTransitionState(occupied),/SIM_TRANSITION_RESERVED_FIELD_OCCUPIED/); checks++;

function replay() {
  let state=createInitialEngineState(scenario);
  let transition=createSimulationTransitionState(state);
  for(let i=0;i<12;i++){
    const r=scheduleSimulationMarker(transition,state,{
      eventId:"ev." + i, ownerResourceId:i%2===0?a:b, atMs:(i*17)%50,
    });
    if(!r.ok) throw new Error(r.code);
    transition=r.transition;
  }
  let c=cancelSimulationMarker(transition,state,"ev.7",b);
  if(!c.ok) throw new Error(c.code);
  transition=c.transition;
  for(const time of [0,10,20,30,40,50]){
    const z=advanceSimulationTransitions(transition,state,time);
    if(!z.ok) throw new Error(z.code);
    transition=z.transition;
    state=z.state;
  }
  return JSON.stringify({state,transition});
}
const expected = replay();
for(let n=0;n<1000;n++)eq(replay(),expected,"1000 deterministic transactional replays");
console.log("PASS CONVERGENCE Dev.1b transactional revision handoff: " + checks + " assertions, 1000 identical full runs");
