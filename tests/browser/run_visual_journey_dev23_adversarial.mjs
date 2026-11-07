import assert from "node:assert/strict";
import { buildVisualJourneyFromActiveProbe, visualJourneyXRayFrame } from "../../dist-browser-test/ui/src/browser/visual-journey.js";
const scenario={scenarioId:"x",sourceHash:"h",zones:[],resources:[
  {id:"a",type:"linux.host",label:"A",interfaces:[{id:"a0",addresses:[]}],properties:{}},
  {id:"b",type:"linux.host",label:"B",interfaces:[{id:"b0",addresses:[]}],properties:{}}
],connections:[{id:"ab",kind:"network",from:{resource:"a",port:"a0"},to:{resource:"b",port:"b0"},properties:{direction:"forward"}}]};
const t={engineId:"e",engineVersion:"1",modeled:true,boundary:"NO_GUEST_COMMAND_EXECUTION",probeMode:"ACTIVE_MODELED_PROBE",scenarioId:"x",scenarioHash:"h",stateRevision:1,sourceId:"a",sourceLabel:"A",sourceType:"linux.host",probeId:"p",command:"p",category:"connectivity",truth:"UNKNOWN",destinationId:"b",destinationLabel:"B",protocol:"icmp",path:["a"],lines:[],evidence:[{kind:"engine_query",subject:"q",state:"UNKNOWN",value:{}}]};
const r=buildVisualJourneyFromActiveProbe(scenario,t); assert.equal(r.ok,true,JSON.stringify(r.diagnostics));
let assertions=0; const eq=(a,b,m)=>{assertions++;assert.equal(a,b,m)};
const first=visualJourneyXRayFrame(r.model,-99); eq(first.cursor,0); eq(first.eventKind,"flow.started"); eq(first.decisionKind,"FLOW"); eq(first.outcome,undefined,"nonterminal X-Ray may not borrow terminal outcome");
const last=visualJourneyXRayFrame(r.model,999); eq(last.eventKind,"flow.uncertain"); eq(last.decisionKind,"FLOW"); eq(last.outcome.kind,"unknown"); eq(last.truth,"UNKNOWN");
// The model-level destination exists, but the current start event must not be relabeled as a routing/host decision.
eq(first.currentResourceId,"a"); eq(first.targetResourceId,"b");
console.log(`PASS dev23 synchronized Event X-Ray adversarial: ${assertions}`);
