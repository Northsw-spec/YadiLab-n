import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createInitialEngineState,
  createSimulationEventPlan,
  scheduleSimulationEvent,
  cancelSimulationEvent,
  advanceSimulationEventPlan,
  inspectSimulationEventPlan,
  SIMULATION_EVENT_QUEUE_LIMIT,
} from "../../dist-engine-test/engine/src/index.js";

const scenario = JSON.parse(fs.readFileSync("tests/fixtures/valid/scenario-normalized.json", "utf8"));
const state = createInitialEngineState(scenario);
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks += 1; }
function truth(actual, label) { assert.ok(actual, label); checks += 1; }
function successful(result, label) { equal(result.ok, true, label); return result.plan; }
function rejected(result, code) { equal(result.ok, false, code); equal(result.code, code, "stable diagnostic"); }
const firstTarget = Object.keys(state.resources)[0];
truth(firstTarget, "fixture has a resource");

const base = createSimulationEventPlan(state);
equal(base.nowMs, 0, "virtual epoch is zero and not wall time");
equal(base.baseStateRevision, 0, "source revision binding");
equal(base.scenarioHash, scenario.sourceHash, "source hash binding");
equal(inspectSimulationEventPlan(base, state), null, "initial plan valid");
let plan = successful(scheduleSimulationEvent(base, state, { eventId: "t3", kind: "TIMER", atMs: 11 }), "schedule t3");
plan = successful(scheduleSimulationEvent(plan, state, { eventId: "t1", kind: "TIMER", atMs: 5, targetResourceId: firstTarget }), "schedule t1");
plan = successful(scheduleSimulationEvent(plan, state, { eventId: "t2", kind: "TIMER", atMs: 5 }), "schedule t2");
equal(plan.pending.map((e) => e.eventId), ["t1", "t2", "t3"], "stable timestamp then insertion order");
equal(plan.pending.map((e) => e.sequence), [1, 2, 0], "insertion sequence remains independent of due time");
equal(base.pending, [], "original state is not mutated");
rejected(scheduleSimulationEvent(plan, state, {eventId:"t2",kind:"TIMER",atMs:6}), "SIM_CLOCK_DUPLICATE_EVENT");
rejected(scheduleSimulationEvent(plan, state, {eventId:"past",kind:"TIMER",atMs:-1}), "SIM_CLOCK_EVENT_INVALID");
rejected(scheduleSimulationEvent(plan, state, {eventId:"bad",kind:"TIMER",atMs:Number.NaN}), "SIM_CLOCK_EVENT_INVALID");
rejected(scheduleSimulationEvent(plan, state, {eventId:"bad2",kind:"TIMER",atMs:5.5}), "SIM_CLOCK_EVENT_INVALID");
rejected(scheduleSimulationEvent(plan, state, {eventId:"bad3",kind:"TIMER",atMs:5,targetResourceId:"__unknown__"}), "SIM_CLOCK_EVENT_INVALID");
rejected(scheduleSimulationEvent(plan, state, {eventId:"bad4",kind:"protocol event",atMs:5}), "SIM_CLOCK_EVENT_INVALID");
rejected(scheduleSimulationEvent(plan, state, {eventId:123,kind:"TIMER",atMs:5}), "SIM_CLOCK_EVENT_INVALID");
rejected(scheduleSimulationEvent(plan, state, {kind:"TIMER",atMs:5}), "SIM_CLOCK_EVENT_INVALID");
rejected(scheduleSimulationEvent(plan, state, {eventId:"good",kind:undefined,atMs:5}), "SIM_CLOCK_EVENT_INVALID");
equal(inspectSimulationEventPlan({...plan,pending:plan.pending.map((e,i)=>i===0?{...e,eventId:123}:e)},state), "SIM_CLOCK_PLAN_INVALID", "reject non-string restored event identity");
rejected(cancelSimulationEvent(plan, state, "absent"), "SIM_CLOCK_EVENT_NOT_FOUND");
rejected(advanceSimulationEventPlan(plan, state, -1), "SIM_CLOCK_TIME_INVALID");
rejected(advanceSimulationEventPlan(plan, state, 0.5), "SIM_CLOCK_TIME_INVALID");
let cancel = successful(cancelSimulationEvent(plan, state, "t2"), "cancel t2");
equal(cancel.pending.map((x) => x.eventId), ["t1", "t3"], "cancel one, preserve other events");
let dispatched = advanceSimulationEventPlan(cancel, state, 5);
equal(dispatched.ok, true, "advance 5");
equal(dispatched.dispatched.map((x) => x.eventId), ["t1"], "due event only");
equal(dispatched.plan.nowMs, 5, "clock is distinct from Engine revision");
equal(state.stateRevision, 0, "no Engine truth or revision mutation");
equal(dispatched.plan.pending.map((x) => x.eventId), ["t3"], "future event preserved");
rejected(advanceSimulationEventPlan(dispatched.plan, state, 4), "SIM_CLOCK_TIME_INVALID");
rejected(scheduleSimulationEvent(dispatched.plan, state, {eventId:"too-old",kind:"TIMER",atMs:4}), "SIM_CLOCK_EVENT_INVALID");
let end = advanceSimulationEventPlan(dispatched.plan, state, 12);
equal(end.dispatched.map((x) => x.eventId), ["t3"], "last timer emitted");
equal(end.plan.pending.length, 0, "no phantom events");
equal(advanceSimulationEventPlan(end.plan, state, 12).dispatched.length, 0, "no phantom re-dispatch");

const stale = { ...state, stateRevision: 1 };
rejected(scheduleSimulationEvent(plan, stale, {eventId:"new",kind:"TIMER",atMs:15}), "SIM_CLOCK_STALE_REVISION");
rejected(advanceSimulationEventPlan(plan, stale, 15), "SIM_CLOCK_STALE_REVISION");
rejected(cancelSimulationEvent(plan, stale, "t1"), "SIM_CLOCK_STALE_REVISION");
rejected(scheduleSimulationEvent(plan, {...state,scenarioHash:"foreign"}, {eventId:"new",kind:"TIMER",atMs:15}), "SIM_CLOCK_SOURCE_MISMATCH");
rejected(advanceSimulationEventPlan(plan, {...state,scenarioId:"foreign"}, 15), "SIM_CLOCK_SOURCE_MISMATCH");
equal(inspectSimulationEventPlan({...plan, pending:[...plan.pending].reverse()},state), "SIM_CLOCK_PLAN_INVALID", "reject reordered event list");
equal(inspectSimulationEventPlan({...plan, nextSequence:1},state), "SIM_CLOCK_PLAN_INVALID", "reject counter replay");
equal(inspectSimulationEventPlan({...plan, pending:[plan.pending[0],plan.pending[0]]},state), "SIM_CLOCK_PLAN_INVALID", "reject duplicate in restored plan");
equal(inspectSimulationEventPlan({...plan, nowMs:100},state), "SIM_CLOCK_PLAN_INVALID", "reject overdue events in restored plan");
equal(inspectSimulationEventPlan({...plan, pending:[...plan.pending,{eventId:"untracked",kind:"TIMER",atMs:13,sequence:10000}]},state), "SIM_CLOCK_PLAN_INVALID", "reject fabricated sequence");
equal(inspectSimulationEventPlan({...plan, pending:Array(SIMULATION_EVENT_QUEUE_LIMIT+1).fill(plan.pending[0])},state), "SIM_CLOCK_PLAN_INVALID", "bound restored queue");
equal(inspectSimulationEventPlan({...plan, nextSequence:Number.MAX_SAFE_INTEGER + 1},state), "SIM_CLOCK_PLAN_INVALID", "reject unsafe integer counters");

function replay() {
  let snapshot = createSimulationEventPlan(state);
  for(let n=0;n<24;n++) {
    snapshot=successful(scheduleSimulationEvent(snapshot,state,{
      eventId:"timer."+n,kind:"TIMER",atMs:(n*37)%101,targetResourceId:firstTarget,
    }), "replay schedule");
  }
  snapshot=successful(cancelSimulationEvent(snapshot,state,"timer.7"), "replay cancel");
  const out=advanceSimulationEventPlan(snapshot,state,150);
  truth(out.ok,"replay advance");
  return JSON.stringify({events:out.dispatched,now:out.plan.nowMs,revision:state.stateRevision});
}
const reference=replay();
for(let iteration=0;iteration<1000;iteration++) equal(replay(),reference,"exact 1000 replay outcomes");
console.log("PASS CONVERGENCE Dev.1 deterministic inert event plan: "+checks+" assertions, 1000 identical replays");
