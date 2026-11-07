import type { NormalizedScenario } from "../../core-model/src/generated/contracts.js";
import type { EngineState, L2PropagationCounters, L2PropagationEvent, L2PropagationResult, TruthValue } from "./types.js";

export interface L2PropagationOptions { readonly maxEvents: number; readonly maxDepth: number; }
interface Work { readonly resourceId: string; readonly ingressInterface?: string; readonly ingressConnectionId?: string; readonly parentEventId: string; readonly depth: number; readonly path: readonly string[]; }

function eventId(n:number):string { return `l2e_${String(n).padStart(5,"0")}`; }
function stable<T extends {id:string}>(xs:readonly T[]):T[] { return [...xs].sort((a,b)=>a.id.localeCompare(b.id,"en")); }
function counters(events:readonly L2PropagationEvent[],limit:number):L2PropagationCounters {
  return { generated:events.filter(e=>e.kind==="FRAME_GENERATED").length, forwarded:events.filter(e=>e.kind==="FLOOD_FORWARD").length, loopReentries:events.filter(e=>e.kind==="LOOP_REENTRY").length, affectedNodes:new Set(events.map(e=>e.currentResourceId)).size, affectedLinks:new Set(events.flatMap(e=>e.connectionId?[e.connectionId]:[])).size, currentDepth:events.reduce((m,e)=>Math.max(m,e.propagationDepth),0), safetyLimit:limit };
}

export function simulateL2RepeatedPropagation(scenario:NormalizedScenario,state:EngineState,sourceResourceId:string,frameId="frame_1",options:L2PropagationOptions={maxEvents:128,maxDepth:32}):L2PropagationResult {
  const explanation:string[]=[];
  if (!Number.isInteger(options.maxEvents)||options.maxEvents<1||!Number.isInteger(options.maxDepth)||options.maxDepth<1) return {truth:"UNKNOWN",outcome:"UNKNOWN",events:[],counters:counters([],Math.max(0,options.maxEvents)),explanation:["Safety limits must be positive integers."]};
  if (!state.resources[sourceResourceId]||!scenario.resources.some(r=>r.id===sourceResourceId)) return {truth:"UNKNOWN",outcome:"UNKNOWN",events:[],counters:counters([],options.maxEvents),explanation:[`Source resource '${sourceResourceId}' is absent.`]};
  const events:L2PropagationEvent[]=[]; const queue:Work[]=[{resourceId:sourceResourceId,parentEventId:"",depth:0,path:[sourceResourceId]}];
  const emit=(event:Omit<L2PropagationEvent,"eventId"|"provenance">):L2PropagationEvent=>{ const e={...event,eventId:eventId(events.length+1),provenance:"ENGINE_L2_PROPAGATION" as const}; events.push(e); return e; };
  emit({frameId,kind:"FRAME_GENERATED",currentResourceId:sourceResourceId,propagationDepth:0,repetitionCount:0,forwardingReason:"source frame generated"});
  while(queue.length){
    const work=queue.shift()!;
    if (events.length>=options.maxEvents) { emit({frameId,kind:"SIMULATION_LIMIT",currentResourceId:work.resourceId,parentEventId:work.parentEventId,propagationDepth:work.depth,repetitionCount:0,forwardingReason:"maximum event budget reached"}); return {truth:"UNKNOWN",outcome:"SAFETY_CUTOFF",events,counters:counters(events,options.maxEvents),explanation:["L2 propagation stopped at the explicit event safety limit."]}; }
    if (work.depth>=options.maxDepth) { emit({frameId,kind:"SIMULATION_LIMIT",currentResourceId:work.resourceId,parentEventId:work.parentEventId,propagationDepth:work.depth,repetitionCount:0,forwardingReason:"maximum propagation depth reached"}); return {truth:"UNKNOWN",outcome:"SAFETY_CUTOFF",events,counters:counters(events,options.maxEvents),explanation:["L2 propagation stopped at the explicit depth safety limit."]}; }
    const edges=stable(scenario.connections.filter(c=>c.kind==="network"&&(c.from.resource===work.resourceId||c.to.resource===work.resourceId)));
    for(const edge of edges){
      if(edge.id===work.ingressConnectionId) continue;
      const fromCurrent=edge.from.resource===work.resourceId; const egress=fromCurrent?edge.from.port:edge.to.port; const ingress=fromCurrent?edge.to.port:edge.from.port; const next=fromCurrent?edge.to.resource:edge.from.resource;
      if(!egress||!ingress||!state.resources[next]) { explanation.push(`Connection '${edge.id}' has incomplete endpoints.`); return {truth:"UNKNOWN",outcome:"UNKNOWN",events,counters:counters(events,options.maxEvents),explanation}; }
    const current=state.resources[work.resourceId]; if(!current) { explanation.push(`Resource '${work.resourceId}' is absent from Engine state.`); return {truth:"UNKNOWN",outcome:"UNKNOWN",events,counters:counters(events,options.maxEvents),explanation}; } let stpState:L2PropagationEvent["stpState"];
      if(current.type==="network.switch") {
        const raw=current.properties.stpPorts;
        if(!Array.isArray(raw)) { explanation.push(`Switch '${current.id}' has no canonical stpPorts model.`); return {truth:"UNKNOWN",outcome:"UNKNOWN",events,counters:counters(events,options.maxEvents),explanation}; }
        const rows=raw.filter(x=>x&&typeof x==="object"&&(x as Record<string,unknown>).interface===egress);
        if(rows.length!==1) { explanation.push(`Switch '${current.id}' has missing or ambiguous STP state for '${egress}'.`); return {truth:"UNKNOWN",outcome:"UNKNOWN",events,counters:counters(events,options.maxEvents),explanation}; }
        const stateValue=(rows[0] as Record<string,unknown>).state; if(typeof stateValue!=="string") { explanation.push(`Switch '${current.id}' has malformed STP state for '${egress}'.`); return {truth:"UNKNOWN",outcome:"UNKNOWN",events,counters:counters(events,options.maxEvents),explanation}; }
        stpState=stateValue as L2PropagationEvent["stpState"];
        if(stpState!=="FORWARDING") continue;
      }
      const repetition=work.path.filter(id=>id===next).length;
      const kind:L2PropagationEvent["kind"]=repetition>0?"LOOP_REENTRY":"FLOOD_FORWARD";
      const emitted=emit({frameId,kind,currentResourceId:next,parentEventId:work.parentEventId,ingressInterface:ingress,egressInterface:egress,connectionId:edge.id,propagationDepth:work.depth+1,repetitionCount:repetition,forwardingReason:kind==="LOOP_REENTRY"?"resource re-entered on current branch":"deterministic L2 flood forwarding",...(stpState?{stpState}: {})});
      if(events.length>=options.maxEvents) { emit({frameId,kind:"SIMULATION_LIMIT",currentResourceId:next,parentEventId:emitted.eventId,propagationDepth:work.depth+1,repetitionCount:repetition,forwardingReason:"maximum event budget reached"}); return {truth:"UNKNOWN",outcome:"SAFETY_CUTOFF",events,counters:counters(events,options.maxEvents),explanation:["L2 propagation stopped at the explicit event safety limit."]}; }
      queue.push({resourceId:next,ingressInterface:ingress,ingressConnectionId:edge.id,parentEventId:emitted.eventId,depth:work.depth+1,path:[...work.path,next]});
    }
  }
  emit({frameId,kind:"PROPAGATION_COMPLETE",currentResourceId:sourceResourceId,propagationDepth:0,repetitionCount:0,forwardingReason:"deterministic queue exhausted"});
  return {truth:"TRUE",outcome:"COMPLETE",events,counters:counters(events,options.maxEvents),explanation:["L2 propagation completed within the configured safety bounds."]};
}
